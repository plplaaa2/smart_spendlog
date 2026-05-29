// database.js 요약: 사용자별로 독립된 SQLite 데이터베이스 파일을 생성하고 관리하는 다중 테넌트 DB 핸들러
// 의존성: index.js에서 사용자별 DB 인스턴스를 요청할 때 호출되며, parser.js의 알림 파싱 결과와 default_rules.json의 시드 룰을 활용합니다.
//         franchise_presets.js의 프랜차이즈 키워드→카테고리 프리셋을 merchant_categories 테이블에 자동 시딩합니다.

const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// franchise_presets.js를 안전하게 로드 (파일 없을 경우 빈 배열로 폴백하여 크래시 방지)
let FRANCHISE_PRESETS = [];
try {
  FRANCHISE_PRESETS = require('./franchise_presets').FRANCHISE_PRESETS || [];
} catch (e) {
  console.warn('[DB] franchise_presets.js를 찾을 수 없습니다. 프리셋 없이 실행합니다.', e.message);
}

const dbs = {}; // username -> db instance
const notifiedStates = {}; // 중복 알림 방지를 위한 전송 여부 상태 저장소 (username_YYYY-MM_type -> boolean)

// 타임아웃 기능이 보강된 fetch 헬퍼 함수
async function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`요청 타임아웃 (${timeoutMs}ms 초과)`);
    }
    throw err;
  } finally {
    clearTimeout(id);
  }
}

// 한글/특수문자 사용자명도 내부 식별자로 안전하게 사용할 수 있도록 ASCII 슬러그를 생성합니다.
function getUserDbSlug(username) {
  if (!username || username === 'admin') {
    return 'admin';
  }

  // 오직 영어 대소문자, 숫자, 언더바(_)로만 이루어진 경우에만 안전한 슬러그로 사용합니다.
  const isSafe = /^[a-zA-Z0-9_]+$/.test(username);
  if (isSafe) {
    return username.toLowerCase();
  }

  return `u_${crypto.createHash('sha1').update(String(username), 'utf8').digest('hex').slice(0, 12)}`;
}

function getUserDbPath(dbDir, username) {
  if (username === 'admin') {
    return path.join(dbDir, 'account_book_admin.db');
  }

  return path.join(dbDir, `account_book_${getUserDbSlug(username)}.db`);
}

/**
 * 특정 사용자의 데이터베이스 파일을 초기화하고 커넥션을 반환합니다.
 */
async function initUserDB(username) {
  const isWin = process.platform === 'win32';
  let dbDir = '/data';
  if (isWin) {
    dbDir = path.join(__dirname, 'data');
  }
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  // admin 계정 호환성: 기존 단일 DB 파일(account_book.db)이 존재하고 account_book_admin.db가 없을 경우 이동
  if (username === 'admin') {
    const oldDbPath = path.join(dbDir, 'account_book.db');
    const newDbPath = getUserDbPath(dbDir, username);
    if (fs.existsSync(oldDbPath) && !fs.existsSync(newDbPath)) {
      try {
        fs.renameSync(oldDbPath, newDbPath);
        console.log(`[DB 마이그레이션] 기존 단일 DB(${oldDbPath})를 admin DB(${newDbPath})로 마이그레이션 완료.`);
      } catch (err) {
        console.error('[DB 마이그레이션] 기존 DB 파일 이동 실패:', err);
      }
    }
  } else {
    // 한글 ID 등 파일명에 직접 쓰기 애매한 계정은 안전한 슬러그 파일명으로 마이그레이션합니다.
    const oldDbPath = path.join(dbDir, `account_book_${username}.db`);
    const newDbPath = getUserDbPath(dbDir, username);
    if (oldDbPath !== newDbPath && fs.existsSync(oldDbPath) && !fs.existsSync(newDbPath)) {
      try {
        fs.renameSync(oldDbPath, newDbPath);
        console.log(`[DB 마이그레이션] 사용자 DB(${oldDbPath})를 안전한 파일명(${newDbPath})으로 마이그레이션 완료.`);
      } catch (err) {
        console.error('[DB 마이그레이션] 사용자 DB 파일 이동 실패:', err);
      }
    }
  }

  const dbPath = getUserDbPath(dbDir, username);

  const dbInstance = await open({
    filename: dbPath,
    driver: sqlite3.Database
  });

  // package_pay_methods 요약: 알림 수신 시 앱 패키지명에 따라 카드사/은행 결제수단을 자동으로 매핑하는 마스터 테이블
  // 의존성: index.js에서 알림 자동 파싱 및 등록 시 참조하며, public/settings.js 및 public/app.js에서 UI 설정과 동기화됩니다.

  // 테이블 생성
  await dbInstance.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE,
      color TEXT,
      icon TEXT,
      type TEXT DEFAULT 'EXPENSE'
    );

    CREATE TABLE IF NOT EXISTS pay_methods (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE
    );

    CREATE TABLE IF NOT EXISTS rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE,
      pattern TEXT,
      category TEXT,
      pay_method TEXT,
      merchant_template TEXT,
      type TEXT DEFAULT 'EXPENSE'
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT DEFAULT 'EXPENSE',
      amount INTEGER,
      merchant TEXT,
      category TEXT,
      pay_method TEXT,
      datetime TEXT,
      memo TEXT,
      raw_text TEXT,
      used_point INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS notification_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender TEXT,
      raw_text TEXT,
      title TEXT,
      text TEXT,
      parsed_status TEXT,
      matched_rule_id INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS package_pay_methods (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      package TEXT UNIQUE,
      pay_method TEXT
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS merchant_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      merchant TEXT UNIQUE,
      category TEXT
    );

    CREATE TABLE IF NOT EXISTS login_security (
      target TEXT PRIMARY KEY,
      type TEXT,
      fail_count INTEGER DEFAULT 0,
      last_failed_at INTEGER DEFAULT 0,
      banned_until INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS pass_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE,
      pattern TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS inapp_notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT,
      title TEXT,
      message TEXT,
      is_read INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 마이그레이션: 기존 DB에 컬럼이 없는 경우 동적 추가
  try {
    await dbInstance.exec("ALTER TABLE transactions ADD COLUMN type TEXT DEFAULT 'EXPENSE'");
  } catch (e) {}
  try {
    await dbInstance.exec("ALTER TABLE transactions ADD COLUMN used_point INTEGER DEFAULT 0");
  } catch (e) {}
  try {
    await dbInstance.exec("ALTER TABLE rules ADD COLUMN type TEXT DEFAULT 'EXPENSE'");
  } catch (e) {}
  try {
    await dbInstance.exec("ALTER TABLE categories ADD COLUMN type TEXT DEFAULT 'EXPENSE'");
  } catch (e) {}
  try {
    await dbInstance.exec("ALTER TABLE notification_logs ADD COLUMN title TEXT");
  } catch (e) {}
  try {
    await dbInstance.exec("ALTER TABLE notification_logs ADD COLUMN text TEXT");
  } catch (e) {}

  // 이체/송금 및 이체/입금 카테고리 강제 마이그레이션 주입
  try {
    await dbInstance.run("INSERT OR IGNORE INTO categories (name, color, icon, type) VALUES ('이체/송금', '#7950f2', 'arrow-left-right', 'EXPENSE')");
  } catch (e) {}
  try {
    await dbInstance.run("INSERT OR IGNORE INTO categories (name, color, icon, type) VALUES ('이체/입금', '#228be6', 'arrow-left-right', 'INCOME')");
  } catch (e) {}
  // 투자 카테고리 강제 마이그레이션 주입
  try {
    await dbInstance.run("INSERT OR IGNORE INTO categories (name, color, icon, type) VALUES ('투자', '#087f5b', 'trending-up', 'EXPENSE')");
  } catch (e) {}
  // 공과금 카테고리 강제 마이그레이션 주입
  try {
    await dbInstance.run("INSERT OR IGNORE INTO categories (name, color, icon, type) VALUES ('공과금', '#e8590c', 'receipt', 'EXPENSE')");
  } catch (e) {}
  // 구독 카테고리 강제 마이그레이션 주입
  try {
    await dbInstance.run("INSERT OR IGNORE INTO categories (name, color, icon, type) VALUES ('구독', '#862e9c', 'repeat', 'EXPENSE')");
  } catch (e) {}
  // 교통/주유 카테고리 강제 마이그레이션 주입 및 기존 데이터 병합
  try {
    await dbInstance.run("INSERT OR IGNORE INTO categories (name, color, icon, type) VALUES ('교통/주유', '#37b24d', 'car', 'EXPENSE')");
    await dbInstance.run("UPDATE transactions SET category = '교통/주유' WHERE category IN ('교통', '주유')");
    await dbInstance.run("UPDATE rules SET category = '교통/주유' WHERE category IN ('교통', '주유')");
    await dbInstance.run("UPDATE merchant_categories SET category = '교통/주유' WHERE category IN ('교통', '주유')");
    await dbInstance.run("DELETE FROM categories WHERE name IN ('교통', '주유')");
  } catch (e) {}
  // 보험 카테고리 강제 마이그레이션 주입
  try {
    await dbInstance.run("INSERT OR IGNORE INTO categories (name, color, icon, type) VALUES ('보험', '#1864ab', 'shield', 'EXPENSE')");
  } catch (e) {}
  // 페이류 카테고리 강제 마이그레이션 주입
  try {
    await dbInstance.run("INSERT OR IGNORE INTO categories (name, color, icon, type) VALUES ('페이류', '#0ca678', 'wallet', 'EXPENSE')");
  } catch (e) {}
  // 렌탈 카테고리 강제 마이그레이션 주입
  try {
    await dbInstance.run("INSERT OR IGNORE INTO categories (name, color, icon, type) VALUES ('렌탈', '#5c7cfa', 'key', 'EXPENSE')");
  } catch (e) {}

  // 쇼핑 -> 온라인쇼핑 카테고리 명칭 변경 및 해외직구 추가 마이그레이션
  try {
    // 1. categories 테이블에서 '쇼핑'을 '온라인쇼핑'으로 변경
    await dbInstance.run("UPDATE categories SET name = '온라인쇼핑' WHERE name = '쇼핑'");
    // 2. categories 테이블에 '해외직구' 주입
    await dbInstance.run("INSERT OR IGNORE INTO categories (name, color, icon, type) VALUES ('해외직구', '#15aabf', 'globe', 'EXPENSE')");
    // 3. 기존 테이블들의 '쇼핑' 카테고리를 '온라인쇼핑'으로 일괄 전환
    await dbInstance.run("UPDATE transactions SET category = '온라인쇼핑' WHERE category = '쇼핑'");
    await dbInstance.run("UPDATE rules SET category = '온라인쇼핑' WHERE category = '쇼핑'");
    await dbInstance.run("UPDATE merchant_categories SET category = '온라인쇼핑' WHERE category = '쇼핑'");

    // 4. 프리셋 카테고리를 강제로 최신으로 업데이트 (해외직구 및 패션/의류 이동 대응)
    for (const preset of FRANCHISE_PRESETS) {
      await dbInstance.run(
        "UPDATE merchant_categories SET category = ? WHERE merchant = ? AND category = '온라인쇼핑'",
        [preset.category, preset.keyword]
      );
      // 5. 기존 거래내역 및 규칙 중 패션/의류 및 해외직구에 매칭되는 내역 소급 업데이트
      if (['패션/의류', '해외직구'].includes(preset.category)) {
        await dbInstance.run(
          "UPDATE transactions SET category = ? WHERE category = '온라인쇼핑' AND merchant LIKE ?",
          [preset.category, `%${preset.keyword}%`]
        );
        await dbInstance.run(
          "UPDATE rules SET category = ? WHERE category = '온라인쇼핑' AND pattern LIKE ?",
          [preset.category, `%${preset.keyword}%`]
        );
      }
    }
  } catch (e) {
    console.error('[DB 마이그레이션] 쇼핑 카테고리 고도화 마이그레이션 실패:', e);
  }

  // 대출상환 카테고리 강제 마이그레이션 주입
  // 의존성: default_rules.json의 카테고리 구성 정의 및 routes/analytics.js의 fixedCategories 와 연결됩니다.
  try {
    await dbInstance.run("INSERT OR IGNORE INTO categories (name, color, icon, type) VALUES ('대출상환', '#e03131', 'landmark', 'EXPENSE')");
  } catch (e) {}

  // 기존 카테고리 중 수입(INCOME) 카테고리의 type 값을 올바르게 강제 보정 (수입 수정 시 카테고리 누락 방지)
  // 의존성: default_rules.json의 카테고리 구성 정의 및 public/app.js의 updateCategorySelect와 연결됩니다.
  try {
    await dbInstance.run("UPDATE categories SET type = 'INCOME' WHERE name IN ('월급', '부수입', '용돈(수입)', '이체/입금', 'ATM/입금', '기타수입')");
  } catch (e) {}


  await seedDefaultData(dbInstance, username);

  console.log(`[DB] 사용자 '${username}'의 데이터베이스가 성공적으로 초기화되었습니다.`);
  return dbInstance;
}

/**
 * 기본 시드 데이터 주입
 */
async function seedDefaultData(dbInstance, username = 'admin') {
  try {
    const defaultsPath = path.join(__dirname, 'default_rules.json');
    if (!fs.existsSync(defaultsPath)) {
      console.warn('[DB Seed] default_rules.json 파일이 없습니다. 시딩을 건너뜁니다.');
      return;
    }
    const defaults = JSON.parse(fs.readFileSync(defaultsPath, 'utf8'));

    // 1. 기본 카테고리 시딩
    if (defaults.categories) {
      for (const cat of defaults.categories) {
        await dbInstance.run(
          'INSERT OR IGNORE INTO categories (name, color, icon, type) VALUES (?, ?, ?, ?)',
          [cat.name, cat.color, cat.icon, cat.type]
        );
      }
    }

    // 2. 기본 결제수단 시딩 및 일치화 (삭제된 결제수단 정리)
    if (defaults.pay_methods) {
      for (const name of defaults.pay_methods) {
        await dbInstance.run('INSERT OR IGNORE INTO pay_methods (name) VALUES (?)', [name]);
      }
      // default_rules.json의 pay_methods 목록에 없는 잔존 결제수단(예: 카카오페이, 토스페이머니)을 DB에서 자동 삭제 정리
      const placeholders = defaults.pay_methods.map(() => '?').join(',');
      await dbInstance.run(
        `DELETE FROM pay_methods WHERE name NOT IN (${placeholders})`,
        defaults.pay_methods
      );
    }

    // 3. 기본 파싱 규칙 시딩 (모든 사용자가 admin의 규칙을 공유하므로 admin 계정인 경우에만 rules 테이블에 시딩 처리)
    if (defaults.rules && username === 'admin') {
      for (const rule of defaults.rules) {
        await dbInstance.run(
          `INSERT INTO rules (name, pattern, category, pay_method, merchant_template, type) 
           VALUES (?, ?, ?, ?, ?, ?) 
           ON CONFLICT(name) DO UPDATE SET 
             pattern = excluded.pattern,
             category = excluded.category,
             pay_method = excluded.pay_method,
             merchant_template = excluded.merchant_template,
             type = excluded.type`,
          [rule.name, rule.pattern, rule.category, rule.pay_method, rule.merchant_template, rule.type]
        );
      }
    }

    // 4. 기본 설정 추가 (Seed)
    const settingsCount = await dbInstance.get('SELECT COUNT(*) as count FROM settings');
    if (settingsCount.count === 0) {
      await dbInstance.run("INSERT INTO settings (key, value) VALUES ('ws_sensor_entity', '')");
      await dbInstance.run("INSERT INTO settings (key, value) VALUES ('monthly_budget', '500000')");
      await dbInstance.run("INSERT INTO settings (key, value) VALUES ('initial_balance', '0')");
    } else {
      const hasBalance = await dbInstance.get("SELECT 1 FROM settings WHERE key='initial_balance'");
      if (!hasBalance) {
        await dbInstance.run("INSERT INTO settings (key, value) VALUES ('initial_balance', '0')");
      }
      const hasBudget = await dbInstance.get("SELECT 1 FROM settings WHERE key='monthly_budget'");
      if (!hasBudget) {
        await dbInstance.run("INSERT INTO settings (key, value) VALUES ('monthly_budget', '500000')");
      }
    }

    // 5. 프랜차이즈 프리셋 자동 시딩
    // INSERT OR IGNORE: 사용자가 이미 직접 등록한 동일 키워드 항목은 건드리지 않습니다.
    // 의존성: franchise_presets.js의 FRANCHISE_PRESETS 배열을 사용합니다.
    if (FRANCHISE_PRESETS && FRANCHISE_PRESETS.length > 0) {
      for (const preset of FRANCHISE_PRESETS) {
        await dbInstance.run(
          'INSERT OR IGNORE INTO merchant_categories (merchant, category) VALUES (?, ?)',
          [preset.keyword, preset.category]
        );
      }
    }
  } catch (err) {
    console.error('[DB Seed] 기본 데이터 시딩 실패:', err);
  }
}

/**
 * 모든 사용자들의 DB를 초기화합니다. (서버 기동 시 호출)
 */
async function initDB(users = []) {
  // 사용자가 정의되지 않았거나 비어있는 경우 최소한 'admin' 유저는 초기화합니다.
  const userList = users.length > 0 ? users : [{ username: 'admin' }];
  for (const user of userList) {
    const uname = user.username;
    if (uname) {
      try {
        const dbInstance = await initUserDB(uname);
        dbs[uname] = dbInstance;
      } catch (err) {
        console.error(`[DB] 사용자 '${uname}'의 DB 초기화 중 에러 발생:`, err);
      }
    }
  }
  console.log('[DB] 모든 사용자의 데이터베이스가 성공적으로 기동 완료되었습니다.');
}

/**
 * 특정 사용자의 DB 커넥션을 가져옵니다. (없으면 동적 생성)
 */
async function getDB(username) {
  const targetUser = username || 'admin';
  if (dbs[targetUser]) {
    return dbs[targetUser];
  }
  // 동적 로드
  const dbInstance = await initUserDB(targetUser);
  dbs[targetUser] = dbInstance;
  return dbInstance;
}

/**
 * 특정 사용자의 데이터를 완전히 초기화합니다.
 */
async function resetAllData(username) {
  const targetUser = username || 'admin';
  const dbInstance = await getDB(targetUser);
  if (!dbInstance) throw new Error(`사용자 '${targetUser}'의 데이터베이스가 초기화되지 않았습니다.`);
  
  await dbInstance.run('DELETE FROM transactions');
  await dbInstance.run('DELETE FROM notification_logs');
  await dbInstance.run('DELETE FROM categories');
  await dbInstance.run('DELETE FROM pay_methods');
  await dbInstance.run('DELETE FROM settings');
  await dbInstance.run('DELETE FROM merchant_categories');
  await dbInstance.run('DELETE FROM package_pay_methods');

  // rules 및 pass_rules 테이블은 모든 사용자가 공유하므로 admin 계정일 때만 초기화/시딩합니다.
  if (targetUser === 'admin') {
    await dbInstance.run('DELETE FROM rules');
    await dbInstance.run('DELETE FROM pass_rules');
  }

  await seedDefaultData(dbInstance, targetUser);
}

/**
 * 현재 메모리에 활성화된 모든 사용자 이름 목록을 반환합니다.
 */
function getActiveUsers() {
  return Object.keys(dbs);
}

// 로그인 보안 관련 함수 (의존성: index.js의 로그인 API 및 미들웨어에서 IP/계정 차단을 체크하기 위해 호출됩니다)
/**
 * 로그인 보안 정보 조회 (IP 또는 사용자명)
 */
async function getLoginSecurity(target) {
  const db = await getDB('admin');
  const row = await db.get('SELECT * FROM login_security WHERE target = ?', [target]);
  if (row) {
    return row;
  }
  return {
    target,
    type: (target.includes('.') || target.includes(':')) ? 'IP' : 'USER',
    fail_count: 0,
    last_failed_at: 0,
    banned_until: 0
  };
}

/**
 * 로그인 보안 정보 업데이트
 */
async function updateLoginSecurity(target, type, failCount, lastFailedAt, bannedUntil) {
  const db = await getDB('admin');
  await db.run(
    'INSERT OR REPLACE INTO login_security (target, type, fail_count, last_failed_at, banned_until) VALUES (?, ?, ?, ?, ?)',
    [target, type, failCount, lastFailedAt, bannedUntil]
  );
}

/**
 * 로그인 보안 정보 리셋 (로그인 성공 시 실패 기록 제거)
 */
async function clearLoginSecurity(target) {
  const db = await getDB('admin');
  await db.run('DELETE FROM login_security WHERE target = ?', [target]);
}

/**
 * 사용처명(merchant)으로 카테고리를 검색합니다.
 * 우선순위: 1) 정확한 일치 → 2) 키워드 부분 포함 일치
 * 의존성: index.js의 웹훅 파싱 단계에서 호출됩니다.
 */
async function findCategoryByMerchant(db, merchantName) {
  if (!merchantName) return null;

  // 1. 정확한 일치 우선
  const exactRow = await db.get(
    'SELECT category FROM merchant_categories WHERE merchant = ?',
    [merchantName]
  );
  if (exactRow) return exactRow.category;

  // 2. 부분 일치: 키워드가 merchantName에 포함되는 경우 (예: "스타벅스 강남점" → "스타벅스" 매칭)
  const allMappings = await db.all('SELECT merchant, category FROM merchant_categories');
  const upperMerchant = merchantName.toUpperCase();
  for (const row of allMappings) {
    if (row.merchant) {
      const upperKeyword = row.merchant.toUpperCase();
      if (upperMerchant.includes(upperKeyword)) {
        return row.category;
      }
    }
  }

  return null;
}

/**
 * 프랜차이즈 프리셋을 DB에 시딩합니다.
 * @param {boolean} force - true이면 기존 항목도 최신 카테고리로 업데이트
 * 의존성: index.js의 /api/merchant_categories/seed-presets API에서 호출됩니다.
 */
async function seedFranchisePresets(db, force = false) {
  let inserted = 0;
  let updated = 0;
  for (const preset of FRANCHISE_PRESETS) {
    if (force) {
      const existing = await db.get(
        'SELECT id FROM merchant_categories WHERE merchant = ?',
        [preset.keyword]
      );
      if (existing) {
        const result = await db.run(
          'UPDATE merchant_categories SET category = ? WHERE merchant = ?',
          [preset.category, preset.keyword]
        );
        if (result.changes > 0) updated++;
      } else {
        const result = await db.run(
          'INSERT INTO merchant_categories (merchant, category) VALUES (?, ?)',
          [preset.keyword, preset.category]
        );
        if (result.changes > 0) inserted++;
      }
    } else {
      const result = await db.run(
        'INSERT OR IGNORE INTO merchant_categories (merchant, category) VALUES (?, ?)',
        [preset.keyword, preset.category]
      );
      if (result.changes > 0) inserted++;
    }
  }

  // 기존 거래내역(transactions) 소급 업데이트 (원래 '식비', '쇼핑', '생활/마트', '의료/건강' 이었던 항목 중 신규 카테고리 키워드를 포함하는 거래)
  let txUpdatedCount = 0;
  if (force) {
    for (const preset of FRANCHISE_PRESETS) {
      if (['편의점', '음료/카페', '배달음식', '디저트', '패션/의류', '병원/약국', '해외직구', '구독', '렌탈'].includes(preset.category)) {
        let sourceCategories = ["식비"];
        if (preset.category === '패션/의류') {
          sourceCategories = ["식비", "온라인쇼핑", "생활/마트"];
        } else if (preset.category === '해외직구') {
          sourceCategories = ["식비", "온라인쇼핑", "생활/마트"];
        } else if (preset.category === '병원/약국') {
          sourceCategories = ["식비", "기타", "의료/건강"];
        } else if (preset.category === '구독') {
          sourceCategories = ["식비", "온라인쇼핑", "문화/여가", "기타"];
        } else if (preset.category === '렌탈') {
          sourceCategories = ["식비", "온라인쇼핑", "생활/마트", "기타"];
        }
        for (const srcCat of sourceCategories) {
          const txResult = await db.run(
            "UPDATE transactions SET category = ? WHERE category = ? AND merchant LIKE ?",
            [preset.category, srcCat, `%${preset.keyword}%`]
          );
          txUpdatedCount += txResult.changes;
        }
      }
    }
  }

  return { total: FRANCHISE_PRESETS.length, inserted, updated, txUpdated: txUpdatedCount };
}

// Home Assistant 센서 entity_id용 안전한 Suffix 반환 헬퍼 함수
function getSafeSuffix(username) {
  if (!username || username === 'admin') return '';

  // 오직 영어 대소문자, 숫자, 언더바(_)로만 이루어진 경우에만 안전한 Suffix로 사용합니다.
  const isSafe = /^[a-zA-Z0-9_]+$/.test(username);
  if (isSafe) {
    return `_${username.toLowerCase()}`;
  }

  return `_${crypto.createHash('sha1').update(String(username), 'utf8').digest('hex').slice(0, 12)}`;
}

// Home Assistant 센서 상태 실시간 동기화 함수
// 의존성: 가계부 데이터가 추가/수정/삭제/백업복원될 때 호출되어 HA Core API로 메트릭 센서를 업데이트합니다.
async function updateHASensors(targetUser) {
  const token = process.env.SUPERVISOR_TOKEN;
  if (!token) {
    return; // SUPERVISOR_TOKEN이 없으면 동기화 생략 (단독 구동 모드)
  }

  const db = await getDB(targetUser);
  if (!db) return;

  try {
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    // 이번 달 예산 조회
    const budgetRow = await db.get("SELECT value FROM settings WHERE key = 'monthly_budget'");
    const budget = budgetRow ? parseInt(budgetRow.value, 10) || 0 : 0;

    // 초기 잔액 및 개별 결제 수단별 초기 잔액 조회 (대시보드 저축액 카드와 완벽 동기화)
    const initialBalanceRow = await db.get("SELECT value FROM settings WHERE key = 'initial_balance'");
    const initialBalance = initialBalanceRow ? parseInt(initialBalanceRow.value, 10) || 0 : 0;

    const initialBalancesRow = await db.get("SELECT value FROM settings WHERE key = 'initial_balances'");
    let initialBalancesSum = 0;
    if (initialBalancesRow && initialBalancesRow.value) {
      try {
        const parsed = JSON.parse(initialBalancesRow.value);
        if (parsed) {
          Object.values(parsed).forEach(v => {
            initialBalancesSum += parseInt(v, 10) || 0;
          });
        }
      } catch (e) {}
    }

    const effectiveInitialBalance = Math.max(initialBalance, initialBalancesSum);

    // 이번 달 수입/지출 총합 집계 (이체 카테고리는 제외)
    const summaryRow = await db.get(
      "SELECT " +
      "SUM(CASE WHEN type = 'INCOME' AND category != '이체/입금' THEN amount ELSE 0 END) as income, " +
      "SUM(CASE WHEN type = 'EXPENSE' AND category != '이체/송금' THEN amount ELSE 0 END) as expense " +
      "FROM transactions WHERE datetime LIKE ?",
      [`${currentMonth}%`]
    );

    const income = summaryRow ? summaryRow.income || 0 : 0;
    const expense = summaryRow ? summaryRow.expense || 0 : 0;
    
    const remainingBudget = Math.max(0, budget - expense);
    const netProfit = income - expense;
    const savings = effectiveInitialBalance + income - expense; // 저축액은 초기 잔액 반영 (대시보드 순수 이익/저축액 카드와 일치)

    const suffix = getSafeSuffix(targetUser);
    const nameTag = targetUser === 'admin' ? '' : ` (${targetUser})`;

    // 예산 관련 알림 (초과 및 90% 임박) 판정
    if (budget > 0) {
      const overLimitKey = `${targetUser}_${currentMonth}_over_limit`;
      const nearLimitKey = `${targetUser}_${currentMonth}_near_limit`;

      // 1. 예산 초과 경고
      if (expense > budget) {
        if (!notifiedStates[overLimitKey]) {
          notifiedStates[overLimitKey] = true;
          const overAmount = expense - budget;
          await sendHANotification(
            `🚨 [Smart Spendlog] 이번 달 예산 초과 경고${nameTag}`,
            `이번 달 지출액이 설정하신 예산을 초과했습니다!\n\n` +
            `- 현재 지출: **${expense.toLocaleString()}원**\n` +
            `- 설정 예산: **${budget.toLocaleString()}원**\n` +
            `- 초과 금액: **${overAmount.toLocaleString()}원**`
          );
          await createInAppNotification(
            targetUser,
            'BUDGET_OVER',
            `이번 달 예산 초과 경고`,
            `이번 달 지출액이 설정하신 예산을 초과했습니다!\n- 현재 지출: ${expense.toLocaleString()}원\n- 설정 예산: ${budget.toLocaleString()}원\n- 초과 금액: ${overAmount.toLocaleString()}원`
          );
        }
      } else {
        // 지출을 취소/수정하여 예산 이하로 떨어졌다면, 알림 플래그를 해제
        if (notifiedStates[overLimitKey]) {
          delete notifiedStates[overLimitKey];
        }

        // 2. 예산 90% 소진 알림
        if (expense >= budget * 0.9) {
          if (!notifiedStates[nearLimitKey]) {
            notifiedStates[nearLimitKey] = true;
            await sendHANotification(
              `⚠️ [Smart Spendlog] 예산 90% 소진 안내${nameTag}`,
              `이번 달 설정하신 예산의 90% 이상을 소진했습니다. 계획적인 소비를 권장합니다.\n\n` +
              `- 현재 지출: **${expense.toLocaleString()}원**\n` +
              `- 남은 예산: **${(budget - expense).toLocaleString()}원**`
            );
            await createInAppNotification(
              targetUser,
              'BUDGET_NEAR',
              `예산 90% 소진 안내`,
              `이번 달 설정하신 예산의 90% 이상을 소진했습니다. 계획적인 소비를 권장합니다.\n- 현재 지출: ${expense.toLocaleString()}원\n- 남은 예산: ${(budget - expense).toLocaleString()}원`
            );
          }
        } else {
          // 지출을 취소/수정하여 90% 미만으로 떨어졌다면 알림 플래그 해제
          if (notifiedStates[nearLimitKey]) {
            delete notifiedStates[nearLimitKey];
          }
        }
      }
    }

    // 순수이익 적자 경고 판정 (수입과 지출이 있고, 순수이익이 마이너스인 경우)
    if (income > 0 && expense > 0) {
      const deficitKey = `${targetUser}_${currentMonth}_net_profit_deficit`;
      if (income < expense) {
        if (!notifiedStates[deficitKey]) {
          notifiedStates[deficitKey] = true;
          const deficitAmount = expense - income;
          await sendHANotification(
            `📉 [Smart Spendlog] 이번 달 재정 적자 전환 경고${nameTag}`,
            `이번 달 지출이 수입을 초과하여 적자 상태로 전환되었습니다!\n\n` +
            `- 현재 수입: **${income.toLocaleString()}원**\n` +
            `- 현재 지출: **${expense.toLocaleString()}원**\n` +
            `- 적자 금액: **${deficitAmount.toLocaleString()}원**`
          );
          await createInAppNotification(
            targetUser,
            'DEFICIT',
            `이번 달 재정 적자 전환 경고`,
            `이번 달 지출이 수입을 초과하여 적자 상태로 전환되었습니다!\n- 현재 수입: ${income.toLocaleString()}원\n- 현재 지출: ${expense.toLocaleString()}원\n- 적자 금액: ${deficitAmount.toLocaleString()}원`
          );
        }
      } else {
        // 수입이 증가하거나 지출이 취소되어 다시 흑자가 되었다면 플래그 해제
        if (notifiedStates[deficitKey]) {
          delete notifiedStates[deficitKey];
        }
      }
    }

    // 3. 카드별 실적 달성 알림 판정
    const goalsRow = await db.get("SELECT value FROM settings WHERE key = 'card_performance_goals'");
    if (goalsRow && goalsRow.value) {
      let cardGoals = {};
      try {
        cardGoals = JSON.parse(goalsRow.value);
      } catch (e) {}

      if (Object.keys(cardGoals).length > 0) {
        // 카드 실적 기준일 설정 읽기
        const perfDaysRow = await db.get("SELECT value FROM settings WHERE key = 'card_performance_days'");
        let cardPerformanceDays = {};
        if (perfDaysRow && perfDaysRow.value) {
          try {
            cardPerformanceDays = JSON.parse(perfDaysRow.value);
          } catch (e) {}
        }

        const [yearStr, monthStr] = currentMonth.split('-');
        const yearVal = parseInt(yearStr, 10);
        const monthVal = parseInt(monthStr, 10);

        for (const cardName of Object.keys(cardGoals)) {
          const goal = parseInt(cardGoals[cardName], 10) || 0;
          if (goal <= 0) continue;

          const startDay = parseInt(cardPerformanceDays[cardName] || 1, 10);
          let currentExpense = 0;

          if (startDay > 1) {
            // 커스텀 기간 계산
            const startYear = monthVal === 1 ? yearVal - 1 : yearVal;
            const startMonth = monthVal === 1 ? 12 : monthVal - 1;
            const startStr = `${startYear}-${String(startMonth).padStart(2, '0')}-${String(startDay).padStart(2, '0')} 00:00:00`;
            const endStr = `${yearVal}-${String(monthVal).padStart(2, '0')}-${String(startDay - 1).padStart(2, '0')} 23:59:59`;

            const customRow = await db.get(
              "SELECT SUM(amount) as expense FROM transactions " +
              "WHERE pay_method = ? AND type = 'EXPENSE' AND category != '이체/송금' " +
              "AND datetime >= ? AND datetime <= ?",
              [cardName, startStr, endStr]
            );
            currentExpense = customRow ? customRow.expense || 0 : 0;
          } else {
            // 달력 기준 당월 지출
            const calendarRow = await db.get(
              "SELECT SUM(amount) as expense FROM transactions " +
              "WHERE pay_method = ? AND type = 'EXPENSE' AND category != '이체/송금' " +
              "AND datetime LIKE ?",
              [cardName, `${currentMonth}%`]
            );
            currentExpense = calendarRow ? calendarRow.expense || 0 : 0;
          }

          const perfKey = `${targetUser}_${currentMonth}_perf_achieved_${cardName}`;
          if (currentExpense >= goal) {
            if (!notifiedStates[perfKey]) {
              notifiedStates[perfKey] = true;
              await sendHANotification(
                `🎉 [Smart Spendlog] ${cardName} 실적 달성 완료${nameTag}`,
                `축하합니다! 이번 달 **${cardName}**의 목표 실적을 달성했습니다.\n\n` +
                `- 누적 실적: **${currentExpense.toLocaleString()}원**\n` +
                `- 목표 실적: **${goal.toLocaleString()}원**`
              );
              await createInAppNotification(
                targetUser,
                'CARD_PERF',
                `${cardName} 실적 달성 완료`,
                `축하합니다! 이번 달 **${cardName}**의 목표 실적을 달성했습니다.\n- 누적 실적: ${currentExpense.toLocaleString()}원\n- 목표 실적: ${goal.toLocaleString()}원`
              );
            }
          } else {
            if (notifiedStates[perfKey]) {
              delete notifiedStates[perfKey];
            }
          }
        }
      }
    }

    const sensors = [
      {
        entity_id: `sensor.account_book_monthly_income${suffix}`,
        state: income,
        friendly_name: `가계부 이번 달 수입${nameTag}`,
        icon: 'mdi:cash-plus'
      },
      {
        entity_id: `sensor.account_book_monthly_expense${suffix}`,
        state: expense,
        friendly_name: `가계부 이번 달 지출${nameTag}`,
        icon: 'mdi:cash-minus'
      },
      {
        entity_id: `sensor.account_book_remaining_budget${suffix}`,
        state: remainingBudget,
        friendly_name: `가계부 남은 예산${nameTag}`,
        icon: 'mdi:piggy-bank'
      },
      {
        entity_id: `sensor.account_book_net_profit${suffix}`,
        state: netProfit,
        friendly_name: `가계부 순수 이익${nameTag}`,
        icon: 'mdi:scale-balance'
      },
      {
        entity_id: `sensor.account_book_savings${suffix}`,
        state: savings,
        friendly_name: `가계부 저축액${nameTag}`,
        icon: 'mdi:bank-transfer-in'
      }
    ];

    for (const sensor of sensors) {
      const url = `http://supervisor/core/api/states/${sensor.entity_id}`;
      const payload = {
        state: String(sensor.state),
        attributes: {
          friendly_name: sensor.friendly_name,
          unit_of_measurement: '원',
          icon: sensor.icon,
          last_updated_at: new Date().toISOString()
        }
      };

      try {
        const response = await fetchWithTimeout(url, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        });
        if (!response.ok) {
          console.error(`[HA WS] 센서 ${sensor.entity_id} 업데이트 실패: HTTP ${response.status}`);
        }
      } catch (err) {
        console.error(`[HA WS] 센서 ${sensor.entity_id} 전송 에러:`, err.message);
      }
    }
    console.log(`[HA WS][${targetUser}] 이번 달 가계부 지표 센서 동기화 완료 (수입: ${income}원, 지출: ${expense}원, 남은예산: ${remainingBudget}원)`);
  } catch (err) {
    console.error(`[HA WS][${targetUser}] 가계부 지표 집계 및 센서 전송 중 오류:`, err);
  }
}

/**
 * 활성화되지 않은(삭제된) 사용자의 가계부 관련 HA 센서를 HA에서 삭제 처리합니다.
 * 요약: HA Core API를 호출하여 현재 가계부 센서들을 조회하고, 활성 사용자가 아닌 고아 센서들을 찾아 삭제 요청을 보냅니다.
 * 의존성: index.js의 startServer() 단계에서 1회 실행하며, SUPERVISOR_TOKEN 환경변수를 사용하여 HA Core API를 호출합니다.
 */
async function cleanupOrphanedHASensors(activeUsers = []) {
  const token = process.env.SUPERVISOR_TOKEN;
  if (!token) return;

  try {
    const activeSuffixes = activeUsers.map(u => getSafeSuffix(u));
    const url = 'http://supervisor/core/api/states';
    const response = await fetchWithTimeout(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      console.error(`[HA WS][Cleanup] HA 상태 조회 실패: HTTP ${response.status}`);
      return;
    }

    const states = await response.json();
    if (!Array.isArray(states)) return;

    const abSensors = states.filter(s => s.entity_id.startsWith('sensor.account_book_'));
    const baseNames = ['monthly_income', 'monthly_expense', 'remaining_budget', 'net_profit', 'savings'];

    for (const sensor of abSensors) {
      const entityId = sensor.entity_id;
      const subName = entityId.replace('sensor.account_book_', '');
      
      let matchedBase = null;
      for (const base of baseNames) {
        if (subName.startsWith(base)) {
          matchedBase = base;
          break;
        }
      }

      if (matchedBase) {
        const suffix = subName.replace(matchedBase, '');
        if (!activeSuffixes.includes(suffix)) {
          console.log(`[HA WS][Cleanup] 고아 센서 감지: ${entityId} (Suffix: '${suffix}'). 삭제를 시도합니다.`);
          const deleteUrl = `http://supervisor/core/api/states/${entityId}`;
          try {
            const delRes = await fetchWithTimeout(deleteUrl, {
              method: 'DELETE',
              headers: {
                'Authorization': `Bearer ${token}`
              }
            });
            if (delRes.ok) {
              console.log(`[HA WS][Cleanup] 고아 센서 삭제 성공: ${entityId}`);
            } else {
              console.error(`[HA WS][Cleanup] 고아 센서 삭제 실패: ${entityId} (HTTP ${delRes.status})`);
            }
          } catch (delErr) {
            console.error(`[HA WS][Cleanup] 고아 센서 ${entityId} 삭제 요청 중 에러:`, delErr.message);
          }
        }
      }
    }
  } catch (err) {
    console.error('[HA WS][Cleanup] 고아 센서 정리 중 오류 발생:', err);
  }
}

/**
 * Home Assistant에 persistent_notification 알림을 전송합니다.
 * @param {string} title - 알림 제목
 * @param {string} message - 알림 내용
 * 의존성: SUPERVISOR_TOKEN 환경변수를 사용하여 HA Core API를 호출합니다.
 */
async function sendHANotification(title, message) {
  const token = process.env.SUPERVISOR_TOKEN;
  if (!token) return;

  const url = 'http://supervisor/core/api/services/persistent_notification/create';
  const payload = {
    title: title,
    message: message
  };

  try {
    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      console.error(`[HA WS][Notification] 알림 전송 실패: HTTP ${response.status}`);
    }
  } catch (err) {
    console.error('[HA WS][Notification] 알림 전송 중 에러 발생:', err.message);
  }
}

/**
 * 가계부 자체 인앱 알림을 생성하고 저장합니다.
 * 또한, 30일이 지난 오래된 알림을 자동으로 정리합니다.
 * @param {string} username - 대상 사용자
 * @param {string} type - 알림 타입 ('BUDGET_OVER', 'BUDGET_NEAR', 'DEFICIT', 'CARD_PERF', 'UNCLASSIFIED')
 * @param {string} title - 알림 제목
 * @param {string} message - 알림 내용
 */
async function createInAppNotification(username, type, title, message) {
  try {
    const db = await getDB(username);
    if (!db) return;

    // 1. 알림 저장
    await db.run(
      'INSERT INTO inapp_notifications (type, title, message) VALUES (?, ?, ?)',
      [type, title, message]
    );

    // 2. 30일 지난 알림 자동 정리 (Auto-cleanup)
    await db.run(
      "DELETE FROM inapp_notifications WHERE created_at < datetime('now', '-30 days')"
    );
  } catch (err) {
    console.error(`[InApp Notification][${username}] 알림 생성 중 오류:`, err);
  }
}

module.exports = {
  initDB,
  resetAllData,
  getDB,
  getActiveUsers,
  getLoginSecurity,
  updateLoginSecurity,
  clearLoginSecurity,
  findCategoryByMerchant,
  seedFranchisePresets,
  FRANCHISE_PRESETS,
  updateHASensors,
  cleanupOrphanedHASensors,
  sendHANotification,
  createInAppNotification
};
