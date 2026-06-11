const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const cryptoHelper = require('../crypto_helper');

let FRANCHISE_PRESETS = [];
try {
  FRANCHISE_PRESETS = require('../franchise_presets').FRANCHISE_PRESETS || [];
} catch (e) {
  console.warn('[DB] franchise_presets.js를 찾을 수 없습니다. 프리셋 없이 실행합니다.', e.message);
}

const dbs = {}; // username -> db instance

function getUserDbSlug(username) {
  if (!username || username === 'admin') {
    return 'admin';
  }
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

async function initUserDB(username) {
  const isWin = process.platform === 'win32';
  let dbDir = '/data';
  if (isWin) {
    dbDir = path.join(__dirname, '..', 'data'); // __dirname is database/ so '..' is account_book/
  }
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

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

    CREATE TABLE IF NOT EXISTS ai_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      report_type TEXT NOT NULL,
      target_year INTEGER NOT NULL,
      target_month INTEGER,
      summary TEXT,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_reports_unique 
    ON ai_reports (report_type, target_year, target_month);
  `);

  await migrateCategoriesAndData(dbInstance, username);

  console.log(`[DB] 사용자 '${username}'의 데이터베이스가 성공적으로 초기화되었습니다.`);
  return dbInstance;
}

async function migrateCategoriesAndData(dbInstance, username) {
  try {
    await dbInstance.exec(`
      CREATE TABLE IF NOT EXISTS ai_reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        report_type TEXT NOT NULL,
        target_year INTEGER NOT NULL,
        target_month INTEGER,
        summary TEXT,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_reports_unique 
      ON ai_reports (report_type, target_year, target_month);
    `);
  } catch (e) {
    console.error('[DB 마이그레이션] ai_reports 테이블 마이그레이션 실패:', e);
  }

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

  try {
    await dbInstance.run("INSERT OR IGNORE INTO categories (name, color, icon, type) VALUES ('이체/송금', '#7950f2', 'arrow-left-right', 'EXPENSE')");
  } catch (e) {}
  try {
    await dbInstance.run("INSERT OR IGNORE INTO categories (name, color, icon, type) VALUES ('이체/입금', '#228be6', 'arrow-left-right', 'INCOME')");
  } catch (e) {}
  try {
    await dbInstance.run("INSERT OR IGNORE INTO categories (name, color, icon, type) VALUES ('투자', '#087f5b', 'trending-up', 'EXPENSE')");
  } catch (e) {}
  try {
    await dbInstance.run("INSERT OR IGNORE INTO categories (name, color, icon, type) VALUES ('수도광열비', '#e8590c', 'receipt', 'EXPENSE')");
  } catch (e) {}
  try {
    await dbInstance.run("INSERT OR IGNORE INTO categories (name, color, icon, type) VALUES ('구독', '#862e9c', 'repeat', 'EXPENSE')");
  } catch (e) {}
  try {
    await dbInstance.run("INSERT OR IGNORE INTO categories (name, color, icon, type) VALUES ('교통/주유', '#37b24d', 'car', 'EXPENSE')");
    await dbInstance.run("UPDATE transactions SET category = '교통/주유' WHERE category IN ('교통', '주유')");
    await dbInstance.run("UPDATE rules SET category = '교통/주유' WHERE category IN ('교통', '주유')");
    await dbInstance.run("UPDATE merchant_categories SET category = '교통/주유' WHERE category IN ('교통', '주유')");
    await dbInstance.run("DELETE FROM categories WHERE name IN ('교통', '주유')");
  } catch (e) {}
  try {
    await dbInstance.run("INSERT OR IGNORE INTO categories (name, color, icon, type) VALUES ('보험', '#1864ab', 'shield', 'EXPENSE')");
  } catch (e) {}
  try {
    await dbInstance.run("INSERT OR IGNORE INTO categories (name, color, icon, type) VALUES ('페이류', '#0ca678', 'wallet', 'EXPENSE')");
  } catch (e) {}
  try {
    await dbInstance.run("INSERT OR IGNORE INTO categories (name, color, icon, type) VALUES ('렌탈', '#5c7cfa', 'key', 'EXPENSE')");
  } catch (e) {}

  try {
    const defaultPackageMappings = [
      { package: 'viva.republica.toss', pay_method: '토스' },
      { package: 'com.hanaskcard.paycla', pay_method: '하나카드' },
      { package: 'com.kbstar.kbbank', pay_method: '국민은행' },
      { package: 'com.hanabank.oqf', pay_method: '하나은행' },
      { package: 'com.shcard.smartpay', pay_method: '신한카드' },
      { package: 'com.wooricard.smartapp', pay_method: '우리카드' },
      { package: 'com.hyundaicard.appcard', pay_method: '현대카드' },
      { package: 'kr.co.samsungcard.mpocket', pay_method: '삼성카드' },
      { package: 'com.lcacApp', pay_method: '롯데카드' },
      { package: 'com.nhcard.smartpay', pay_method: 'NH농협카드' },
      { package: 'com.kbcard.cxh.appcard', pay_method: 'KB국민카드' },
      { package: 'com.shinhan.sbanking', pay_method: '신한은행' },
      { package: 'com.wooribank.pib.smart', pay_method: '우리은행' },
      { package: 'com.nonghyup.smnhb', pay_method: '농협은행' },
      { package: 'com.ibk.neobanking', pay_method: '기업은행' },
      { package: 'com.kakaobank.channel', pay_method: '카카오뱅크' }
    ];
    for (const mapping of defaultPackageMappings) {
      await dbInstance.run('INSERT OR IGNORE INTO pay_methods (name) VALUES (?)', [mapping.pay_method]);
      await dbInstance.run(
        'INSERT OR IGNORE INTO package_pay_methods (package, pay_method) VALUES (?, ?)',
        [mapping.package, mapping.pay_method]
      );
    }
  } catch (e) {}

  try {
    const hasOnlineShopping = await dbInstance.get("SELECT 1 FROM categories WHERE name = '온라인쇼핑'");
    if (hasOnlineShopping) {
      await dbInstance.run("DELETE FROM categories WHERE name = '쇼핑'");
    } else {
      await dbInstance.run("UPDATE categories SET name = '온라인쇼핑', color = '#4dadf7', icon = 'shopping-bag' WHERE name = '쇼핑'");
    }
    await dbInstance.run("INSERT OR IGNORE INTO categories (name, color, icon, type) VALUES ('온라인쇼핑', '#4dadf7', 'shopping-bag', 'EXPENSE')");
    await dbInstance.run("INSERT OR IGNORE INTO categories (name, color, icon, type) VALUES ('해외직구', '#15aabf', 'globe', 'EXPENSE')");
    await dbInstance.run("UPDATE transactions SET category = '온라인쇼핑' WHERE category = '쇼핑'");
    await dbInstance.run("UPDATE rules SET category = '온라인쇼핑' WHERE category = '쇼핑'");
    await dbInstance.run("UPDATE merchant_categories SET category = '온라인쇼핑' WHERE category = '쇼핑'");

    for (const preset of FRANCHISE_PRESETS) {
      await dbInstance.run(
        "UPDATE merchant_categories SET category = ? WHERE merchant = ? AND category = '온라인쇼핑'",
        [preset.category, preset.keyword]
      );
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

  try {
    await dbInstance.run("INSERT OR IGNORE INTO categories (name, color, icon, type) VALUES ('대출상환', '#e03131', 'landmark', 'EXPENSE')");
  } catch (e) {}

  try {
    await dbInstance.run("INSERT OR IGNORE INTO categories (name, color, icon, type) VALUES ('세금', '#495057', 'landmark', 'EXPENSE')");
    const taxKeywords = ['세금', '지방세', '국세', '재산세', '자동차세', '과태료', '벌금', '위택스', 'WETAX', '인터넷지로', '지로', 'GIRO', '경찰청', '경찰서', '시청', '구청', '도청', '구청'];
    for (const kw of taxKeywords) {
      await dbInstance.run(
        "UPDATE merchant_categories SET category = '세금' WHERE merchant = ? AND category IN ('공과금', '수도광열비')",
        [kw]
      );
      await dbInstance.run(
        "UPDATE transactions SET category = '세금' WHERE category IN ('공과금', '수도광열비') AND merchant LIKE ?",
        [`%${kw}%`]
      );
      await dbInstance.run(
        "UPDATE rules SET category = '세금' WHERE category IN ('공과금', '수도광열비') AND pattern LIKE ?",
        [`%${kw}%`]
      );
    }
  } catch (e) {
    console.error('[DB 마이그레이션] 세금 카테고리 분리 마이그레이션 실패:', e);
  }

  try {
    const hasWaterExpense = await dbInstance.get("SELECT 1 FROM categories WHERE name = '수도광열비'");
    if (hasWaterExpense) {
      await dbInstance.run("DELETE FROM categories WHERE name = '공과금'");
    } else {
      await dbInstance.run("UPDATE categories SET name = '수도광열비', color = '#e8590c', icon = 'receipt' WHERE name = '공과금'");
    }
    await dbInstance.run("INSERT OR IGNORE INTO categories (name, color, icon, type) VALUES ('수도광열비', '#e8590c', 'receipt', 'EXPENSE')");
    await dbInstance.run("UPDATE transactions SET category = '수도광열비' WHERE category = '공과금'");
    await dbInstance.run("UPDATE rules SET category = '수도광열비' WHERE category = '공과금'");
    await dbInstance.run("UPDATE merchant_categories SET category = '수도광열비' WHERE category = '공과금'");
    await dbInstance.run("DELETE FROM categories WHERE name = '공과금'");
  } catch (e) {
    console.error('[DB 마이그레이션] 수도광열비 명칭 변경 마이그레이션 실패:', e);
  }

  try {
    const hasHousing = await dbInstance.get("SELECT 1 FROM categories WHERE name = '주거'");
    if (hasHousing) {
      await dbInstance.run("DELETE FROM categories WHERE name = '주거/통신'");
    } else {
      await dbInstance.run("UPDATE categories SET name = '주거', color = '#fcc419', icon = 'home' WHERE name = '주거/통신'");
    }
    await dbInstance.run("INSERT OR IGNORE INTO categories (name, color, icon, type) VALUES ('주거', '#fcc419', 'home', 'EXPENSE')");
    await dbInstance.run("INSERT OR IGNORE INTO categories (name, color, icon, type) VALUES ('통신비', '#1c7ed6', 'phone', 'EXPENSE')");
    const telecomKeywords = ['SKT', 'KT', 'LGU+', 'LG유플러스', '알뜰폰', '통신', '텔레콤', '대리점'];
    for (const kw of telecomKeywords) {
      await dbInstance.run(
        "UPDATE merchant_categories SET category = '통신비' WHERE merchant = ? AND category IN ('주거/통신', '주거')",
        [kw]
      );
      await dbInstance.run(
        "UPDATE transactions SET category = '통신비' WHERE category IN ('주거/통신', '주거') AND merchant LIKE ?",
        [`%${kw}%`]
      );
      await dbInstance.run(
        "UPDATE rules SET category = '통신비' WHERE category IN ('주거/통신', '주거') AND pattern LIKE ?",
        [`%${kw}%`]
      );
    }
    await dbInstance.run("UPDATE transactions SET category = '주거' WHERE category = '주거/통신'");
    await dbInstance.run("UPDATE rules SET category = '주거' WHERE category = '주거/통신'");
    await dbInstance.run("UPDATE merchant_categories SET category = '주거' WHERE category = '주거/통신'");
    await dbInstance.run("DELETE FROM categories WHERE name = '주거/통신'");
  } catch (e) {
    console.error('[DB 마이그레이션] 주거 및 통신비 분리 마이그레이션 실패:', e);
  }

  try {
    await dbInstance.run("INSERT OR IGNORE INTO categories (name, color, icon, type) VALUES ('연금', '#fab005', 'piggy-bank', 'INCOME')");
    await dbInstance.run("INSERT OR IGNORE INTO categories (name, color, icon, type) VALUES ('지원금/환급금', '#be4bdb', 'gift', 'INCOME')");
    await dbInstance.run("UPDATE categories SET type = 'INCOME' WHERE name IN ('월급', '부수입', '용돈(수입)', '이체/입금', 'ATM/입금', '기타수입', '연금', '지원금/환급금')");
  } catch (e) {}

  try {
    await dbInstance.run("INSERT OR IGNORE INTO categories (name, color, icon, type) VALUES ('마트/편의점', '#38bdf8', 'store', 'EXPENSE')");
    await dbInstance.run("INSERT OR IGNORE INTO categories (name, color, icon, type) VALUES ('생활/잡화', '#cc5de8', 'shopping-cart', 'EXPENSE')");

    await dbInstance.run("UPDATE transactions SET category = '마트/편의점' WHERE category IN ('편의점', '생활/마트')");
    await dbInstance.run("UPDATE rules SET category = '마트/편의점' WHERE category IN ('편의점', '생활/마트')");
    await dbInstance.run("UPDATE merchant_categories SET category = '마트/편의점' WHERE category IN ('편의점', '생활/마트')");

    const lifeKeywords = ['다이소', 'DAISO', '이케아', 'IKEA', '버터', '상점', '철물', '가구', '잡화'];
    for (const kw of lifeKeywords) {
      await dbInstance.run(
        "UPDATE merchant_categories SET category = '생활/잡화' WHERE merchant = ? AND category = '마트/편의점'",
        [kw]
      );
      await dbInstance.run(
        "UPDATE transactions SET category = '생활/잡화' WHERE category = '마트/편의점' AND merchant LIKE ?",
        [`%${kw}%`]
      );
      await dbInstance.run(
        "UPDATE rules SET category = '생활/잡화' WHERE category = '마트/편의점' AND pattern LIKE ?",
        [`%${kw}%`]
      );
    }
    await dbInstance.run("DELETE FROM categories WHERE name IN ('편의점', '생활/마트')");
  } catch (e) {
    console.error('[DB 마이그레이션] 마트/편의점 및 생활/잡화 마이그레이션 실패:', e);
  }

  try {
    await dbInstance.run("INSERT OR IGNORE INTO categories (name, color, icon, type) VALUES ('기부금', '#e64980', 'heart', 'EXPENSE')");
  } catch (e) {
    console.error('[DB 마이그레이션] 기부금 마이그레이션 실패:', e);
  }

  try {
    const hasDiningOut = await dbInstance.get("SELECT 1 FROM categories WHERE name = '외식비'");
    if (hasDiningOut) {
      await dbInstance.run("DELETE FROM categories WHERE name = '식비'");
    } else {
      await dbInstance.run("UPDATE categories SET name = '외식비' WHERE name = '식비'");
    }
    await dbInstance.run("INSERT OR IGNORE INTO categories (name, color, icon, type) VALUES ('외식비', '#ff6b6b', 'utensils', 'EXPENSE')");
    await dbInstance.run("UPDATE transactions SET category = '외식비' WHERE category = '식비'");
    await dbInstance.run("UPDATE rules SET category = '외식비' WHERE category = '식비'");
    await dbInstance.run("UPDATE merchant_categories SET category = '외식비' WHERE category = '식비'");
    await dbInstance.run("DELETE FROM categories WHERE name = '식비'");
  } catch (e) {
    console.error('[DB 마이그레이션] 식비 -> 외식비 카테고리 변경 마이그레이션 실패:', e);
  }

  try {
    const checkCardToBank = {
      'KB국민체크카드': '국민은행',
      '신한체크카드': '신한은행',
      '하나체크카드': '하나은행',
      '우리체크카드': '우리은행',
      'NH농협체크카드': '농협은행',
      '삼성체크카드': '계좌이체',
      '현대체크카드': '계좌이체',
      '롯데체크카드': '계좌이체',
      'BC체크카드': '계좌이체'
    };

    for (const [card, bank] of Object.entries(checkCardToBank)) {
      await dbInstance.run(
        "UPDATE transactions SET pay_method = ? WHERE pay_method = ?",
        [bank, card]
      );
      await dbInstance.run(
        "UPDATE rules SET pay_method = ? WHERE pay_method = ?",
        [bank, card]
      );
      await dbInstance.run(
        "UPDATE package_pay_methods SET pay_method = ? WHERE pay_method = ?",
        [bank, card]
      );
      await dbInstance.run(
        "DELETE FROM pay_methods WHERE name = ?",
        [card]
      );
    }
    await dbInstance.run("DELETE FROM pay_methods WHERE name LIKE '%체크%'");
  } catch (e) {
    console.error('[DB 마이그레이션] 체크카드 은행이관 마이그레이션 실패:', e);
  }

  await seedDefaultData(dbInstance, username);
}

async function seedDefaultData(dbInstance, username = 'admin') {
  try {
    const defaultsPath = path.join(__dirname, '..', 'default_rules.json');
    if (!fs.existsSync(defaultsPath)) {
      console.warn('[DB Seed] default_rules.json 파일이 없습니다. 시딩을 건너뜁니다.');
      return;
    }
    const defaults = JSON.parse(fs.readFileSync(defaultsPath, 'utf8'));

    if (defaults.categories) {
      for (const cat of defaults.categories) {
        await dbInstance.run(
          'INSERT OR IGNORE INTO categories (name, color, icon, type) VALUES (?, ?, ?, ?)',
          [cat.name, cat.color, cat.icon, cat.type]
        );
      }
    }

    if (defaults.pay_methods) {
      for (const name of defaults.pay_methods) {
        await dbInstance.run('INSERT OR IGNORE INTO pay_methods (name) VALUES (?)', [name]);
      }
      const placeholders = defaults.pay_methods.map(() => '?').join(',');
      await dbInstance.run(
        `DELETE FROM pay_methods WHERE name NOT IN (${placeholders})`,
        defaults.pay_methods
      );
    }

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

    const settingsCount = await dbInstance.get('SELECT COUNT(*) as count FROM settings');
    if (settingsCount.count === 0) {
      await dbInstance.run("INSERT INTO settings (key, value) VALUES ('ws_sensor_entity', '')");
      await dbInstance.run("INSERT INTO settings (key, value) VALUES ('monthly_budget', '500000')");
      await dbInstance.run("INSERT INTO settings (key, value) VALUES ('initial_balance', '0')");
      await dbInstance.run("INSERT INTO settings (key, value) VALUES ('auto_backup', 'false')");
      await dbInstance.run("INSERT INTO settings (key, value) VALUES ('backup_time', '00:00')");
      await dbInstance.run("INSERT INTO settings (key, value) VALUES ('backup_days', '0,1,2,3,4,5,6')");
    } else {
      const hasBalance = await dbInstance.get("SELECT 1 FROM settings WHERE key='initial_balance'");
      if (!hasBalance) {
        await dbInstance.run("INSERT INTO settings (key, value) VALUES ('initial_balance', '0')");
      }
      const hasBudget = await dbInstance.get("SELECT 1 FROM settings WHERE key='monthly_budget'");
      if (!hasBudget) {
        await dbInstance.run("INSERT INTO settings (key, value) VALUES ('monthly_budget', '500000')");
      }
      const hasAutoBackup = await dbInstance.get("SELECT 1 FROM settings WHERE key='auto_backup'");
      if (!hasAutoBackup) {
        await dbInstance.run("INSERT INTO settings (key, value) VALUES ('auto_backup', 'false')");
      }
      const hasBackupTime = await dbInstance.get("SELECT 1 FROM settings WHERE key='backup_time'");
      if (!hasBackupTime) {
        await dbInstance.run("INSERT INTO settings (key, value) VALUES ('backup_time', '00:00')");
      }
      const hasBackupDays = await dbInstance.get("SELECT 1 FROM settings WHERE key='backup_days'");
      if (!hasBackupDays) {
        await dbInstance.run("INSERT INTO settings (key, value) VALUES ('backup_days', '0,1,2,3,4,5,6')");
      }
    }

    const networkBackupKeys = [
      { key: 'network_backup_enabled', val: 'false' },
      { key: 'network_backup_type', val: 'path' },
      { key: 'network_backup_path', val: '' },
      { key: 'network_backup_webdav_url', val: '' },
      { key: 'network_backup_webdav_username', val: '' },
      { key: 'network_backup_webdav_password', val: '' }
    ];
    for (const item of networkBackupKeys) {
      const hasKey = await dbInstance.get("SELECT 1 FROM settings WHERE key=?", [item.key]);
      if (!hasKey) {
        await dbInstance.run("INSERT INTO settings (key, value) VALUES (?, ?)", [item.key, item.val]);
      }
    }

    const aiParsingKeys = [
      { key: 'ai_enabled', val: 'false' },
      { key: 'ai_parsing_enabled', val: 'false' },
      { key: 'ai_provider', val: 'gemini' },
      { key: 'ai_api_key', val: '' },
      { key: 'ai_local_ip', val: '' },
      { key: 'ai_local_model', val: '' }
    ];
    for (const item of aiParsingKeys) {
      const hasKey = await dbInstance.get("SELECT 1 FROM settings WHERE key=?", [item.key]);
      if (!hasKey) {
        await dbInstance.run("INSERT INTO settings (key, value) VALUES (?, ?)", [item.key, item.val]);
      }
    }

    if (FRANCHISE_PRESETS && FRANCHISE_PRESETS.length > 0) {
      for (const preset of FRANCHISE_PRESETS) {
        await dbInstance.run(
          'INSERT OR IGNORE INTO merchant_categories (merchant, category) VALUES (?, ?)',
          [preset.keyword, preset.category]
        );
      }
    }

    const defaultPackageMappings = [
      { package: 'viva.republica.toss', pay_method: '토스' },
      { package: 'com.hanaskcard.paycla', pay_method: '하나카드' },
      { package: 'com.kbstar.kbbank', pay_method: '국민은행' },
      { package: 'com.hanabank.oqf', pay_method: '하나은행' },
      { package: 'com.shcard.smartpay', pay_method: '신한카드' },
      { package: 'com.wooricard.smartapp', pay_method: '우리카드' },
      { package: 'com.hyundaicard.appcard', pay_method: '현대카드' },
      { package: 'kr.co.samsungcard.mpocket', pay_method: '삼성카드' },
      { package: 'com.lcacApp', pay_method: '롯데카드' },
      { package: 'com.nhcard.smartpay', pay_method: 'NH농협카드' },
      { package: 'com.kbcard.cxh.appcard', pay_method: 'KB국민카드' },
      { package: 'com.shinhan.sbanking', pay_method: '신한은행' },
      { package: 'com.wooribank.pib.smart', pay_method: '우리은행' },
      { package: 'com.nonghyup.smnhb', pay_method: '농협은행' },
      { package: 'com.ibk.neobanking', pay_method: '기업은행' },
      { package: 'com.kakaobank.channel', pay_method: '카카오뱅크' }
    ];
    for (const mapping of defaultPackageMappings) {
      await dbInstance.run(
        'INSERT OR IGNORE INTO package_pay_methods (package, pay_method) VALUES (?, ?)',
        [mapping.package, mapping.pay_method]
      );
    }

    if (username === 'admin') {
      const defaultPassRules = defaults.pass_rules || [
        { name: '잔액부족 거절', pattern: '잔액\\s*부족|잔액\\s*초과' },
        { name: '한도초과 거절', pattern: '한도\\s*초과' },
        { name: '승인거절 및 오류', pattern: '승인\\s*거절|출금\\s*거절|결제\\s*실패|오류' },
        { name: '인증번호 알림', pattern: '인증\\s*번호|본인\\s*확인' }
      ];
      for (const rule of defaultPassRules) {
        await dbInstance.run(
          `INSERT INTO pass_rules (name, pattern) 
           VALUES (?, ?) 
           ON CONFLICT(name) DO UPDATE SET 
             pattern = excluded.pattern`,
          [rule.name, rule.pattern]
        );
      }
    }
  } catch (err) {
    console.error('[DB Seed] 기본 데이터 시딩 실패:', err);
  }
}

async function initDB(users = []) {
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

async function getDB(username) {
  const targetUser = username || 'admin';
  if (dbs[targetUser]) {
    return dbs[targetUser];
  }
  const dbInstance = await initUserDB(targetUser);
  dbs[targetUser] = dbInstance;
  return dbInstance;
}

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

  if (targetUser === 'admin') {
    await dbInstance.run('DELETE FROM rules');
    await dbInstance.run('DELETE FROM pass_rules');
  }

  await seedDefaultData(dbInstance, targetUser);
}

function getActiveUsers() {
  return Object.keys(dbs);
}

module.exports = {
  dbs,
  getUserDbSlug,
  getUserDbPath,
  initUserDB,
  migrateCategoriesAndData,
  seedDefaultData,
  initDB,
  getDB,
  resetAllData,
  getActiveUsers
};
