const fs = require('fs');
const path = require('path');
const cryptoHelper = require('../crypto_helper');
const { getDB, getUserDbSlug, getUserDbPath, getActiveUsers, migrateCategoriesAndData } = require('./connection');
const { updateHASensors } = require('./ha_sync');
const { createInAppNotification } = require('./notifications');

const schedulerHistory = {}; // username -> executionKey

async function uploadToWebDAV(localFilePath, filename, url, username, password) {
  if (!url) throw new Error('WebDAV URL이 설정되지 않았습니다.');
  
  let targetUrl = url;
  if (!targetUrl.endsWith('/')) {
    targetUrl += '/';
  }
  targetUrl += encodeURIComponent(filename);

  const fileData = fs.readFileSync(localFilePath);
  
  const headers = {
    'Content-Type': 'application/octet-stream'
  };

  if (username) {
    const auth = Buffer.from(`${username}:${password}`).toString('base64');
    headers['Authorization'] = `Basic ${auth}`;
  }

  console.log(`[네트워크 백업] WebDAV 전송 시도: ${targetUrl}`);
  
  const response = await fetch(targetUrl, {
    method: 'PUT',
    headers: headers,
    body: fileData,
    signal: AbortSignal.timeout(30000)
  });

  if (!response.ok) {
    throw new Error(`WebDAV 전송 실패 (HTTP ${response.status} ${response.statusText})`);
  }
  
  console.log(`[네트워크 백업] WebDAV 전송 완료: ${filename}`);
}

async function cleanupWebDAVBackups(url, username, password, slug) {
  try {
    const headers = {
      'Depth': '1',
      'Content-Type': 'application/xml; charset="utf-8"'
    };
    if (username) {
      const auth = Buffer.from(`${username}:${password}`).toString('base64');
      headers['Authorization'] = `Basic ${auth}`;
    }

    console.log(`[WebDAV 백업 정리] WebDAV 파일 목록 조회 시도: ${url}`);
    const response = await fetch(url, {
      method: 'PROPFIND',
      headers: headers,
      body: '<?xml version="1.0" encoding="utf-8" ?><propfind xmlns="DAV:"><prop><displayname/><getlastmodified/><resourcetype/></prop></propfind>',
      signal: AbortSignal.timeout(30000)
    });

    if (!response.ok) {
      console.warn(`[WebDAV 백업 정리] WebDAV 파일 목록 조회 실패 (HTTP ${response.status})`);
      return;
    }

    const responseText = await response.text();
    const responseRegex = /<[^:>]*response>([\s\S]*?)<\/[^:>]*response>/gi;
    let match;
    const files = [];

    while ((match = responseRegex.exec(responseText)) !== null) {
      const content = match[1];
      
      const hrefMatch = /<[^:>]*href>([\s\S]*?)<\/[^:>]*href>/i.exec(content);
      if (!hrefMatch) continue;
      const href = hrefMatch[1].trim();

      const dateMatch = /<[^:>]*getlastmodified>([\s\S]*?)<\/[^:>]*getlastmodified>/i.exec(content);
      if (!dateMatch) continue;
      const lastModifiedStr = dateMatch[1].trim();

      const isDirectory = /<[^:>]*resourcetype[^>]*>\s*<[^:>]*collection/i.test(content);
      if (isDirectory) continue;

      files.push({ href, lastModified: new Date(lastModifiedStr) });
    }

    const oneWeekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    const prefix = `account_book_${slug}_`;

    for (const file of files) {
      const decHref = decodeURIComponent(file.href);
      const fileName = decHref.substring(decHref.lastIndexOf('/') + 1);

      if (fileName.startsWith(prefix) && fileName.endsWith('.json')) {
        if (file.lastModified.getTime() < oneWeekAgo) {
          let deleteUrl = url;
          if (!deleteUrl.endsWith('/')) {
            deleteUrl += '/';
          }
          deleteUrl += encodeURIComponent(fileName);

          console.log(`[WebDAV 백업 정리] 7일 경과된 파일 삭제 시도: ${fileName} (${file.lastModified.toISOString()})`);
          
          try {
            const delHeaders = {};
            if (username) {
              const auth = Buffer.from(`${username}:${password}`).toString('base64');
              delHeaders['Authorization'] = `Basic ${auth}`;
            }
            const delRes = await fetch(deleteUrl, {
              method: 'DELETE',
              headers: delHeaders,
              signal: AbortSignal.timeout(15000)
            });
            if (delRes.ok) {
              console.log(`[WebDAV 백업 정리] 원격 파일 삭제 성공: ${fileName}`);
            } else {
              console.error(`[WebDAV 백업 정리] 원격 파일 삭제 실패: ${fileName} (HTTP ${delRes.status})`);
            }
          } catch (delErr) {
            console.error(`[WebDAV 백업 정리] 원격 파일 삭제 중 에러 (${fileName}):`, delErr.message);
          }
        }
      }
    }
  } catch (err) {
    console.error('[WebDAV 백업 정리] 백업 정리 프로세스 진행 중 에러 발생:', err.message);
  }
}

async function runWithUNCConnection(targetPath, username, password, callback) {
  const isWin = process.platform === 'win32';
  const isUNC = typeof targetPath === 'string' && targetPath.startsWith('\\\\');

  if (isWin && isUNC && username) {
    const { exec } = require('child_process');
    const util = require('util');
    const execPromise = util.promisify(exec);

    const match = targetPath.match(/^(\\\\[^\\]+\\[^\\]+)/);
    const uncRoot = match ? match[1] : targetPath;

    console.log(`[UNC 연결] 공유폴더 연결 수립 시도: ${uncRoot} (사용자: ${username})`);
    
    try {
      await execPromise(`net use "${uncRoot}" /delete /y`);
    } catch (e) {
    }

    try {
      await execPromise(`net use "${uncRoot}" "${password}" /user:"${username}"`);
      console.log(`[UNC 연결] 공유폴더 연결 완료: ${uncRoot}`);
    } catch (err) {
      throw new Error(`네트워크 공유폴더 자격 증명 로그인 실패: ${err.message}`);
    }

    try {
      return await callback();
    } finally {
      try {
        console.log(`[UNC 연결] 공유폴더 연결 해제 시도: ${uncRoot}`);
        await execPromise(`net use "${uncRoot}" /delete /y`);
      } catch (e) {
        console.warn(`[UNC 연결] 공유폴더 연결 해제 실패:`, e.message);
      }
    }
  } else {
    if (!isWin && isUNC) {
      console.warn(`[네트워크 백업] 리눅스 환경에서는 Samba(UNC) 경로 직접 쓰기 및 자격증명 자동 마운트를 지원하지 않습니다. (입력된 경로: ${targetPath})`);
      throw new Error('리눅스/도커 애드온 환경에서는 삼바 UNC 경로(\\\\)를 직접 사용할 수 없습니다. WebDAV 전송 방식을 사용하시거나, Home Assistant [시스템 -> 스토리지] 메뉴에서 네트워크 스토리지를 추가한 후 마운트된 로컬 경로를 지정해 주십시오.');
    }
    return await callback();
  }
}

async function backupToNetwork(username, localFilePath, filename) {
  const db = await getDB(username);
  
  const enabledRow = await db.get("SELECT value FROM settings WHERE key = 'auto_backup'");
  const typeRow = await db.get("SELECT value FROM settings WHERE key = 'network_backup_type'");
  
  if (!enabledRow || enabledRow.value !== 'true') {
    console.log(`[네트워크 백업][${username}] 자동 네트워크 백업 옵션이 비활성화 상태입니다.`);
    return;
  }

  const type = typeRow ? typeRow.value : 'path';
  console.log(`[네트워크 백업][${username}] 네트워크 백업 진행 시작 (방식: ${type})`);

  if (type === 'path') {
    const pathRow = await db.get("SELECT value FROM settings WHERE key = 'network_backup_path'");
    const userRow = await db.get("SELECT value FROM settings WHERE key = 'network_backup_path_username'");
    const passRow = await db.get("SELECT value FROM settings WHERE key = 'network_backup_path_password'");
    
    if (!pathRow || !pathRow.value) {
      throw new Error('네트워크 백업 경로가 설정되지 않았습니다.');
    }
    
    const targetPathVal = pathRow.value;
    const targetUser = userRow ? userRow.value : '';
    const targetPassEnc = passRow ? passRow.value : '';
    const targetPass = targetPassEnc ? cryptoHelper.decrypt(targetPassEnc) : '';

    await runWithUNCConnection(targetPathVal, targetUser, targetPass, async () => {
      const baseDir = path.resolve(targetPathVal);
      if (!fs.existsSync(baseDir)) {
        fs.mkdirSync(baseDir, { recursive: true });
      }
      
      const targetDir = path.join(baseDir, 'account_book_backup');
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
        console.log(`[네트워크 백업][${username}] 신규 백업 폴더 생성 완료: ${targetDir}`);
      }
      
      const targetPath = path.join(targetDir, filename);
      fs.copyFileSync(localFilePath, targetPath);
      console.log(`[네트워크 백업][${username}] 네트워크 경로 파일 복사 완료: ${targetPath}`);

      try {
        const files = fs.readdirSync(targetDir);
        const slug = getUserDbSlug(username);
        const prefix = `account_book_${slug}_`;
        const oneWeekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);

        for (const file of files) {
          if (file.startsWith(prefix) && file.endsWith('.json')) {
            const filePath = path.join(targetDir, file);
            try {
              const stats = fs.statSync(filePath);
              if (stats.mtimeMs < oneWeekAgo) {
                fs.unlinkSync(filePath);
                console.log(`[네트워크 백업][${username}] 7일 경과한 오래된 네트워크 백업 파일 삭제 완료: ${file}`);
              }
            } catch (e) {
              console.error(`[네트워크 백업][${username}] 네트워크 백업 파일 정보 조회/삭제 중 에러 (${file}):`, e.message);
            }
          }
        }
      } catch (cleanErr) {
        console.error(`[네트워크 백업][${username}] 네트워크 디렉토리 백업 정리 중 오류 발생:`, cleanErr.message);
      }
    });
    
  } else if (type === 'webdav') {
    const urlRow = await db.get("SELECT value FROM settings WHERE key = 'network_backup_webdav_url'");
    const userRow = await db.get("SELECT value FROM settings WHERE key = 'network_backup_webdav_username'");
    const passRow = await db.get("SELECT value FROM settings WHERE key = 'network_backup_webdav_password'");
    
    if (!urlRow || !urlRow.value) {
      throw new Error('WebDAV URL이 설정되지 않았습니다.');
    }

    const rawPassword = passRow && passRow.value ? cryptoHelper.decrypt(passRow.value) : '';
    
    await uploadToWebDAV(
      localFilePath,
      filename,
      urlRow.value,
      userRow ? userRow.value : '',
      rawPassword
    );

    const slug = getUserDbSlug(username);
    await cleanupWebDAVBackups(
      urlRow.value,
      userRow ? userRow.value : '',
      rawPassword,
      slug
    );
  } else {
    throw new Error(`알 수 없는 백업 방식: ${type}`);
  }
}

async function testNetworkBackup(username) {
  const isWin = process.platform === 'win32';
  const dbDir = isWin ? path.join(__dirname, '..', 'data') : '/data';
  const dbPath = getUserDbPath(dbDir, username);

  if (!fs.existsSync(dbPath)) {
    throw new Error('데이터베이스 파일이 존재하지 않습니다.');
  }

  const slug = getUserDbSlug(username);
  const tempFileName = `account_book_${slug}_net_test_${Date.now()}.json`;
  
  const backupDir = path.join(dbDir, 'backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }
  const tempBackupPath = path.join(backupDir, tempFileName);

  const db = await getDB(username);
  const adminDb = await getDB('admin');
  const tables = ['categories', 'pay_methods', 'rules', 'transactions', 'notification_logs', 'package_pay_methods', 'settings', 'merchant_categories'];
  const backupData = {
    version: '1.9.84',
    username: username,
    backup_date: new Date().toISOString(),
    data: {}
  };
  for (const table of tables) {
    const targetDb = table === 'rules' ? adminDb : db;
    const rows = await targetDb.all(`SELECT * FROM ${table}`);
    backupData.data[table] = rows;
  }
  fs.writeFileSync(tempBackupPath, JSON.stringify(backupData, null, 2), 'utf8');

  try {
    const db = await getDB(username);
    const typeRow = await db.get("SELECT value FROM settings WHERE key = 'network_backup_type'");
    const type = typeRow ? typeRow.value : 'path';
    
    console.log(`[네트워크 백업 테스트][${username}] 테스트 시작 (방식: ${type})`);

    if (type === 'path') {
      const pathRow = await db.get("SELECT value FROM settings WHERE key = 'network_backup_path'");
      const userRow = await db.get("SELECT value FROM settings WHERE key = 'network_backup_path_username'");
      const passRow = await db.get("SELECT value FROM settings WHERE key = 'network_backup_path_password'");
      
      if (!pathRow || !pathRow.value) {
        throw new Error('네트워크 백업 경로가 설정되지 않았습니다.');
      }
      
      const targetPathVal = pathRow.value;
      const targetUser = userRow ? userRow.value : '';
      const targetPassEnc = passRow ? passRow.value : '';
      const targetPass = targetPassEnc ? cryptoHelper.decrypt(targetPassEnc) : '';

      await runWithUNCConnection(targetPathVal, targetUser, targetPass, async () => {
        const targetDir = path.resolve(targetPathVal);
        if (!fs.existsSync(targetDir)) {
          fs.mkdirSync(targetDir, { recursive: true });
        }
        const targetPath = path.join(targetDir, tempFileName);
        fs.copyFileSync(tempBackupPath, targetPath);
        console.log(`[네트워크 백업 테스트][${username}] 경로 파일 복사 완료: ${targetPath}`);
      });
    } else if (type === 'webdav') {
      const urlRow = await db.get("SELECT value FROM settings WHERE key = 'network_backup_webdav_url'");
      const userRow = await db.get("SELECT value FROM settings WHERE key = 'network_backup_webdav_username'");
      const passRow = await db.get("SELECT value FROM settings WHERE key = 'network_backup_webdav_password'");
      
      if (!urlRow || !urlRow.value) {
        throw new Error('WebDAV URL이 설정되지 않았습니다.');
      }
      const rawPassword = passRow && passRow.value ? cryptoHelper.decrypt(passRow.value) : '';
      await uploadToWebDAV(
        tempBackupPath,
        tempFileName,
        urlRow.value,
        userRow ? userRow.value : '',
        rawPassword
      );
    } else {
      throw new Error(`알 수 없는 백업 방식: ${type}`);
    }

    fs.unlinkSync(tempBackupPath);
    return { success: true, filename: tempFileName };
  } catch (err) {
    if (fs.existsSync(tempBackupPath)) {
      try { fs.unlinkSync(tempBackupPath); } catch (e) {}
    }
    throw err;
  }
}

async function executeRestore(username, backupObj) {
  const db = await getDB(username);
  const adminDb = await getDB('admin');

  let dataObj = backupObj;
  if (backupObj && backupObj.isEncrypted && backupObj.rawBody) {
    const cryptoHelper = require('../crypto_helper');
    try {
      const decrypted = cryptoHelper.decrypt(backupObj.rawBody);
      dataObj = JSON.parse(decrypted);
    } catch (decErr) {
      throw new Error('암호화된 백업 복호화 실패: 보안 토큰이 변경되었거나 파일이 손상되었습니다.');
    }
  }

  if (!dataObj || !dataObj.data || typeof dataObj.data !== 'object') {
    throw new Error('올바르지 않은 백업 데이터 포맷입니다.');
  }

  const tables = [
    'categories',
    'pay_methods',
    'rules',
    'transactions',
    'notification_logs',
    'package_pay_methods',
    'settings',
    'merchant_categories'
  ];

  for (const table of tables) {
    if (!Array.isArray(dataObj.data[table])) {
      throw new Error(`백업 데이터 내 '${table}' 테이블 정보가 유실되었습니다.`);
    }
  }

  await db.run('BEGIN TRANSACTION');
  const runAdminTx = (username !== 'admin');
  if (runAdminTx) {
    await adminDb.run('BEGIN TRANSACTION');
  }

  try {
    for (const table of tables) {
      if (table === 'rules') {
        await adminDb.run('DELETE FROM rules');
      } else {
        await db.run(`DELETE FROM ${table}`);
      }
    }

    if (dataObj.data.categories.length > 0) {
      const stmt = await db.prepare('INSERT INTO categories (id, name, color, icon, type) VALUES (?, ?, ?, ?, ?)');
      for (const row of dataObj.data.categories) {
        await stmt.run(row.id, row.name, row.color, row.icon, row.type || 'EXPENSE');
      }
      await stmt.finalize();
    }

    await db.run("INSERT OR IGNORE INTO categories (name, color, icon, type) VALUES ('이체/송금', '#7950f2', 'arrow-left-right', 'EXPENSE')");
    await db.run("INSERT OR IGNORE INTO categories (name, color, icon, type) VALUES ('이체/입금', '#228be6', 'arrow-left-right', 'INCOME')");
    await db.run("INSERT OR IGNORE INTO categories (name, color, icon, type) VALUES ('페이류', '#0ca678', 'wallet', 'EXPENSE')");

    if (dataObj.data.pay_methods.length > 0) {
      const stmt = await db.prepare('INSERT INTO pay_methods (id, name) VALUES (?, ?)');
      for (const row of dataObj.data.pay_methods) {
        await stmt.run(row.id, row.name);
      }
      await stmt.finalize();
    }

    if (dataObj.data.rules.length > 0) {
      const stmt = await adminDb.prepare('INSERT INTO rules (id, name, pattern, category, pay_method, merchant_template, type) VALUES (?, ?, ?, ?, ?, ?, ?)');
      for (const row of dataObj.data.rules) {
        await stmt.run(row.id, row.name, row.pattern, row.category, row.pay_method, row.merchant_template, row.type || 'EXPENSE');
      }
      await stmt.finalize();
    }

    if (dataObj.data.transactions.length > 0) {
      const stmt = await db.prepare('INSERT INTO transactions (id, type, amount, merchant, category, pay_method, datetime, memo, raw_text, used_point) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      for (const row of dataObj.data.transactions) {
        await stmt.run(row.id, row.type || 'EXPENSE', row.amount, row.merchant, row.category, row.pay_method, row.datetime, row.memo, row.raw_text, row.used_point || 0);
      }
      await stmt.finalize();
    }

    if (dataObj.data.notification_logs.length > 0) {
      const stmt = await db.prepare('INSERT INTO notification_logs (id, sender, raw_text, parsed_status, matched_rule_id, title, text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
      for (const row of dataObj.data.notification_logs) {
        await stmt.run(row.id, row.sender, row.raw_text, row.parsed_status, row.matched_rule_id, row.title, row.text, row.created_at || row.received_at);
      }
      await stmt.finalize();
    }

    if (dataObj.data.package_pay_methods.length > 0) {
      const stmt = await db.prepare('INSERT INTO package_pay_methods (id, package, pay_method) VALUES (?, ?, ?)');
      for (const row of dataObj.data.package_pay_methods) {
        await stmt.run(row.id, row.package, row.pay_method);
      }
      await stmt.finalize();
    }

    if (dataObj.data.settings.length > 0) {
      const stmt = await db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
      for (const row of dataObj.data.settings) {
        await stmt.run(row.key, row.value);
      }
      await stmt.finalize();
    }

    if (dataObj.data.merchant_categories.length > 0) {
      const stmt = await db.prepare('INSERT INTO merchant_categories (id, merchant, category) VALUES (?, ?, ?)');
      for (const row of dataObj.data.merchant_categories) {
        await stmt.run(row.id, row.merchant, row.category);
      }
      await stmt.finalize();
    }

    await migrateCategoriesAndData(db, username);

    await db.run('COMMIT');
    if (runAdminTx) {
      await adminDb.run('COMMIT');
    }

    updateHASensors(username);
    return { success: true, message: '데이터가 성공적으로 복원되었습니다.' };
  } catch (txErr) {
    await db.run('ROLLBACK');
    if (runAdminTx) {
      try { await adminDb.run('ROLLBACK'); } catch (e) {}
    }
    throw txErr;
  }
}

async function backupUserDB(username) {
  const isWin = process.platform === 'win32';
  const dbDir = isWin ? path.join(__dirname, '..', 'data') : '/data';
  const backupDir = path.join(dbDir, 'backups');
  let backupPath = '';
  let backupFileName = '';

  try {
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    const slug = getUserDbSlug(username);
    const now = new Date();
    const timestamp = now.getFullYear() +
      String(now.getMonth() + 1).padStart(2, '0') +
      String(now.getDate()).padStart(2, '0') + '_' +
      String(now.getHours()).padStart(2, '0') +
      String(now.getMinutes()).padStart(2, '0') +
      String(now.getSeconds()).padStart(2, '0');
    
    backupFileName = `account_book_${slug}_${timestamp}.json`;
    backupPath = path.join(backupDir, backupFileName);

    const db = await getDB(username);
    const adminDb = await getDB('admin');
    const tables = ['categories', 'pay_methods', 'rules', 'transactions', 'notification_logs', 'package_pay_methods', 'settings', 'merchant_categories'];
    const backupData = {
      version: '1.9.85',
      username: username,
      backup_date: new Date().toISOString(),
      data: {}
    };
    for (const table of tables) {
      const targetDb = table === 'rules' ? adminDb : db;
      const rows = await targetDb.all(`SELECT * FROM ${table}`);
      backupData.data[table] = rows;
    }

    const encryptedJSON = cryptoHelper.encrypt(JSON.stringify(backupData));
    
    fs.writeFileSync(backupPath, encryptedJSON, 'utf8');
    console.log(`[백업] 사용자 '${username}'의 JSON 백업 암호화 완료: ${backupFileName}`);

    try {
      await backupToNetwork(username, backupPath, backupFileName);
    } catch (netErr) {
      console.error(`[백업][${username}] 네트워크 백업 실패:`, netErr.message);
    }
  } catch (err) {
    console.error(`[백업] 사용자 '${username}'의 JSON 백업 진행 중 에러 발생:`, err);
  } finally {
    if (backupPath && fs.existsSync(backupPath)) {
      try {
        fs.unlinkSync(backupPath);
        console.log(`[백업] 임시 로컬 백업 파일 자동 삭제 완료: ${backupFileName}`);
      } catch (e) {
        console.error(`[백업] 임시 백업 파일 삭제 실패 (${backupFileName}):`, e.message);
      }
    }
  }
}

function startBackupScheduler() {
  console.log('[백업] 사용자 맞춤 자동 백업 스케줄러가 활성화되었습니다.');
  
  setInterval(async () => {
    try {
      const kstOffset = 9 * 60;
      const now = new Date();
      const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
      const kstDate = new Date(utc + (kstOffset * 60000));

      const currentDay = kstDate.getDay();
      const currentHour = String(kstDate.getHours()).padStart(2, '0');
      const currentMin = String(kstDate.getMinutes()).padStart(2, '0');
      const currentTimeStr = `${currentHour}:${currentMin}`;
      const dateStr = kstDate.toISOString().slice(0, 10);
      
      const executionKey = `${dateStr} ${currentTimeStr}`;

      const users = getActiveUsers();
      for (const username of users) {
        if (schedulerHistory[username] === executionKey) {
          continue;
        }

        try {
          const db = await getDB(username);
          const autoBackupRow = await db.get("SELECT value FROM settings WHERE key = 'auto_backup'");
          const backupTimeRow = await db.get("SELECT value FROM settings WHERE key = 'backup_time'");
          const backupDaysRow = await db.get("SELECT value FROM settings WHERE key = 'backup_days'");

          const isAutoBackupEnabled = autoBackupRow && autoBackupRow.value === 'true';
          if (!isAutoBackupEnabled) {
            continue;
          }

          const targetTime = backupTimeRow ? backupTimeRow.value : '00:00';
          const targetDays = (backupDaysRow && backupDaysRow.value) 
            ? backupDaysRow.value.split(',') 
            : ['0', '1', '2', '3', '4', '5', '6'];

          if (currentTimeStr === targetTime && targetDays.includes(String(currentDay))) {
            schedulerHistory[username] = executionKey;
            console.log(`[스케줄러] 사용자 '${username}' 자동 백업 조건 충족. 백업 실행 (설정 시간: ${targetTime}, 요일: ${targetDays.join(',')})`);
            await backupUserDB(username);
          }
        } catch (dbErr) {
          console.error(`[스케줄러] 사용자 '${username}'의 백업 설정 로드 중 에러:`, dbErr.message);
        }
      }
    } catch (schedErr) {
      console.error('[스케줄러] 백업 스케줄링 연산 중 에러:', schedErr.message);
    }
  }, 60000);
}

async function getUserBackups(username) {
  try {
    const isWin = process.platform === 'win32';
    const dbDir = isWin ? path.join(__dirname, '..', 'data') : '/data';
    const backupDir = path.join(dbDir, 'backups');

    if (!fs.existsSync(backupDir)) {
      return [];
    }

    const slug = getUserDbSlug(username);
    const prefix = `account_book_${slug}_`;
    const files = fs.readdirSync(backupDir);
    const backupList = [];

    for (const file of files) {
      if (file.startsWith(prefix) && file.endsWith('.json')) {
        const filePath = path.join(backupDir, file);
        try {
          const stats = fs.statSync(filePath);
          const parts = file.replace(prefix, '').replace('.json', '').split('_');
          let displayDate = stats.mtime;
          if (parts.length >= 2) {
            const ymd = parts[0];
            const hms = parts[1];
            if (ymd.length === 8 && hms.length === 6) {
              displayDate = `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)} ${hms.slice(0, 2)}:${hms.slice(2, 4)}:${hms.slice(4, 6)}`;
            }
          }
          backupList.push({
            filename: file,
            size: stats.size,
            mtime: stats.mtimeMs,
            displayDate: displayDate
          });
        } catch (e) {
          console.error(`[백업조회] 파일 정보 획득 실패 (${file}):`, e.message);
        }
      }
    }

    backupList.sort((a, b) => b.mtime - a.mtime);
    return backupList;
  } catch (err) {
    console.error(`[백업조회] 사용자 '${username}'의 백업 목록 조회 에러:`, err);
    return [];
  }
}

async function restoreUserDBBackup(username, backupFileName) {
  try {
    const isWin = process.platform === 'win32';
    const dbDir = isWin ? path.join(__dirname, '..', 'data') : '/data';
    const backupDir = path.join(dbDir, 'backups');
    const backupPath = path.join(backupDir, backupFileName);

    if (!fs.existsSync(backupPath)) {
      throw new Error('백업 파일이 존재하지 않습니다.');
    }

    const slug = getUserDbSlug(username);
    if (!backupFileName.startsWith(`account_book_${slug}_`) || !backupFileName.endsWith('.json')) {
      throw new Error('권한이 없거나 잘못된 백업 파일명입니다.');
    }

    const rawData = fs.readFileSync(backupPath, 'utf8');
    const backupObj = JSON.parse(rawData);

    const result = await executeRestore(username, backupObj);
    return result;
  } catch (err) {
    console.error(`[복원] 사용자 '${username}'의 DB 복원 중 에러 발생:`, err);
    throw err;
  }
}

async function deleteUserBackup(username, backupFileName) {
  try {
    const isWin = process.platform === 'win32';
    const dbDir = isWin ? path.join(__dirname, '..', 'data') : '/data';
    const backupDir = path.join(dbDir, 'backups');
    const backupPath = path.join(backupDir, backupFileName);

    if (!fs.existsSync(backupPath)) {
      throw new Error('백업 파일이 존재하지 않습니다.');
    }

    const slug = getUserDbSlug(username);
    if (!backupFileName.startsWith(`account_book_${slug}_`) || !backupFileName.endsWith('.json')) {
      throw new Error('권한이 없거나 잘못된 백업 파일명입니다.');
    }

    fs.unlinkSync(backupPath);
    console.log(`[백업삭제] 사용자 '${username}'의 백업 파일 삭제 완료: ${backupFileName}`);
    return { success: true };
  } catch (err) {
    console.error(`[백업삭제] 사용자 '${username}'의 백업 파일 삭제 실패:`, err);
    throw err;
  }
}

module.exports = {
  schedulerHistory,
  backupUserDB,
  restoreUserDBBackup,
  deleteUserBackup,
  backupToNetwork,
  testNetworkBackup,
  executeRestore,
  getUserBackups,
  startBackupScheduler,
  uploadToWebDAV,
  cleanupWebDAVBackups,
  runWithUNCConnection
};
