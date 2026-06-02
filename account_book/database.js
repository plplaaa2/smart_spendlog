// database.js 요약: 사용자별로 독립된 SQLite 데이터베이스 파일을 생성하고 관리하는 다중 테넌트 DB 핸들러
// 의존성: index.js에서 사용자별 DB 인스턴스를 요청할 때 호출되며, parser.js의 알림 파싱 결과와 default_rules.json의 시드 룰을 활용합니다.
//         franchise_presets.js의 프랜차이즈 키워드→카테고리 프리셋을 merchant_categories 테이블에 자동 시딩합니다.

const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const cryptoHelper = require('./crypto_helper'); // 민감 데이터 암복호화 헬퍼 로드


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

/**
 * DB의 스키마 변경 및 카테고리 병합/분리에 따른 정합성 마이그레이션을 수행합니다.
 * (initUserDB 및 백업 복원 완료 시점에 실행하여 구버전 데이터 정합성을 보장합니다.)
 */
async function migrateCategoriesAndData(dbInstance, username) {
  // AI 소비 리포트 테이블 신설 마이그레이션
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
  // 수도광열비 카테고리 강제 마이그레이션 주입
  try {
    await dbInstance.run("INSERT OR IGNORE INTO categories (name, color, icon, type) VALUES ('수도광열비', '#e8590c', 'receipt', 'EXPENSE')");
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

  // 기본 패키지 결제수단 매핑 강제 주입
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

  // 쇼핑 -> 온라인쇼핑 카테고리 명칭 변경 및 해외직구 추가 마이그레이션
  // 요약: '쇼핑' 카테고리를 '온라인쇼핑'으로 안전하게 통합/변경하고 '해외직구' 카테고리를 추가합니다.
  // 의존성: default_rules.json, franchise_presets.js의 카테고리 설정과 일치해야 합니다.
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
  try {
    await dbInstance.run("INSERT OR IGNORE INTO categories (name, color, icon, type) VALUES ('대출상환', '#e03131', 'landmark', 'EXPENSE')");
  } catch (e) {}

  // 세금 카테고리 강제 마이그레이션 주입 및 기존 데이터 분류 재지정
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

  // 공과금 -> 수도광열비 카테고리 명칭 변경 및 기존 데이터 이관 마이그레이션
  // 요약: '공과금' 카테고리를 '수도광열비'로 안전하게 통합/변경합니다.
  // 의존성: default_rules.json, franchise_presets.js의 카테고리 설정과 일치해야 합니다.
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

  // 주거/통신 -> 주거 명칭 변경 및 통신비 분리 마이그레이션
  // 요약: '주거/통신' 카테고리를 '주거'로 통합/변경하고 '통신비' 카테고리를 분리하여 데이터를 매핑합니다.
  // 의존성: default_rules.json, franchise_presets.js의 카테고리 설정과 일치해야 합니다.
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

  // 기존 카테고리 중 수입(INCOME) 카테고리의 type 값을 올바르게 강제 보정
  try {
    await dbInstance.run("INSERT OR IGNORE INTO categories (name, color, icon, type) VALUES ('연금', '#fab005', 'piggy-bank', 'INCOME')");
    await dbInstance.run("INSERT OR IGNORE INTO categories (name, color, icon, type) VALUES ('지원금/환급금', '#be4bdb', 'gift', 'INCOME')");
    await dbInstance.run("UPDATE categories SET type = 'INCOME' WHERE name IN ('월급', '부수입', '용돈(수입)', '이체/입금', 'ATM/입금', '기타수입', '연금', '지원금/환급금')");
  } catch (e) {}

  // 편의점 및 생활/마트 -> 마트/편의점 및 생활/잡화 마이그레이션
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

  // 기부금 카테고리 강제 마이그레이션 주입
  try {
    await dbInstance.run("INSERT OR IGNORE INTO categories (name, color, icon, type) VALUES ('기부금', '#e64980', 'heart', 'EXPENSE')");
  } catch (e) {
    console.error('[DB 마이그레이션] 기부금 마이그레이션 실패:', e);
  }

  // [체크카드 폐지 및 은행 연동 마이그레이션]
  // 요약: 기존 체크카드 결제수단들을 각각 대응하는 시중은행 또는 '계좌이체' 결제수단으로 이관합니다.
  // 의존성: default_rules.json의 pay_methods 정리 스크립트와 정합해야 합니다.
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
      // 1. 거래내역 마이그레이션
      await dbInstance.run(
        "UPDATE transactions SET pay_method = ? WHERE pay_method = ?",
        [bank, card]
      );
      // 2. 규칙 마이그레이션
      await dbInstance.run(
        "UPDATE rules SET pay_method = ? WHERE pay_method = ?",
        [bank, card]
      );
      // 3. 패키지 결제수단 매핑 마이그레이션
      await dbInstance.run(
        "UPDATE package_pay_methods SET pay_method = ? WHERE pay_method = ?",
        [bank, card]
      );
    }
  } catch (e) {
    console.error('[DB 마이그레이션] 체크카드 은행이관 마이그레이션 실패:', e);
  }

  await seedDefaultData(dbInstance, username);
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

    // [신규] 네트워크 백업 설정 추가 시드 데이터 주입
    // 의존성: routes/settings.js의 사용자 설정 저장 API 및 public/settings.js의 UI 필드와 매핑됩니다.
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

    // [신규] AI 파싱 설정 추가 시드 데이터 주입
    // 의존성: routes/settings.js의 사용자 설정 저장 API 및 public/settings.js의 UI 필드와 매핑됩니다.
    const aiParsingKeys = [
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

    // 6. 패키지별 결제수단 자동 매핑 기본 프리셋 시딩
    // 주요 은행/카드사 앱 패키지에 대한 기본 매핑 테이블 주입
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
      const idx = upperMerchant.indexOf(upperKeyword);
      if (idx !== -1) {
        // [예외 1] 키워드가 '마트'인데 상호명에 '스마트'가 포함된 경우 마트/편의점 오분류 방지
        if (upperKeyword === '마트' && upperMerchant.includes('스마트')) {
          continue;
        }
        // [예외 2] 키워드 바로 뒷글자가 한글(가-힣)인 경우 다른 단어의 일부로 간주해 매칭 제외 (예: '마트폰'의 '마트', '카페트'의 '카페')
        const nextChar = upperMerchant.charAt(idx + upperKeyword.length);
        if (nextChar && /^[가-힣]$/.test(nextChar)) {
          continue;
        }
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
      if (['편의점', '음료/카페', '배달음식', '디저트', '패션/의류', '병원/약국', '해외직구', '구독', '렌탈', '세금', '수도광열비', '주거', '통신비', '연금', '지원금/환급금', '기부금'].includes(preset.category)) {
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
        } else if (preset.category === '세금') {
          sourceCategories = ["수도광열비", "공과금", "주거/통신", "기타"];
        } else if (preset.category === '수도광열비') {
          sourceCategories = ["공과금", "주거/통신", "기타"];
        } else if (preset.category === '통신비') {
          sourceCategories = ["주거/통신", "주거", "기타"];
        } else if (preset.category === '주거') {
          sourceCategories = ["주거/통신", "기타"];
        } else if (preset.category === '연금') {
          sourceCategories = ["기타수입", "부수입", "기타"];
        } else if (preset.category === '지원금/환급금') {
          sourceCategories = ["기타수입", "부수입", "기타"];
        } else if (preset.category === '기부금') {
          sourceCategories = ["기타", "경조사/용돈"];
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

/**
 * WebDAV 프로토콜을 사용해 네트워크 백업 파일을 전송합니다.
 * @param {string} localFilePath - 업로드할 로컬 백업 파일 경로
 * @param {string} filename - 전송할 파일명
 * @param {string} url - WebDAV 서버 URL
 * @param {string} username - WebDAV 사용자명
 * @param {string} password - WebDAV 비밀번호
 * 의존성: backupToNetwork에서 WebDAV 모드로 백업 전송 시 호출됩니다.
 */
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

/**
 * WebDAV 원격지 폴더 내 7일이 경과한 백업본을 롤링 삭제합니다.
 * @param {string} url - WebDAV 서버 URL
 * @param {string} username - WebDAV 사용자명
 * @param {string} password - WebDAV 비밀번호
 * @param {string} slug - 사용자 식별자 슬러그
 */
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

/**
 * 윈도우 환경에서 UNC 공유폴더 연결을 임시로 수립하고 실행 후 해제합니다.
 */
async function runWithUNCConnection(targetPath, username, password, callback) {
  const isWin = process.platform === 'win32';
  const isUNC = typeof targetPath === 'string' && targetPath.startsWith('\\\\');

  if (isWin && isUNC && username) {
    const { exec } = require('child_process');
    const util = require('util');
    const execPromise = util.promisify(exec);

    // UNC 경로의 루트 부분 추출 (예: \\192.168.1.100\Backup)
    const match = targetPath.match(/^(\\\\[^\\]+\\[^\\]+)/);
    const uncRoot = match ? match[1] : targetPath;

    console.log(`[UNC 연결] 공유폴더 연결 수립 시도: ${uncRoot} (사용자: ${username})`);
    
    try {
      await execPromise(`net use "${uncRoot}" /delete /y`);
    } catch (e) {
      // 기존 연결이 없는 경우 통과
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

/**
 * 사용자의 가계부 DB 백업 파일을 지정된 로컬/네트워크 경로 혹은 WebDAV 서버로 전송합니다.
 * @param {string} username - 대상 사용자
 * @param {string} localFilePath - 전송할 로컬 백업본 경로
 * @param {string} filename - 백업 파일명
 * 의존성: backupUserDB 및 routes/settings.js의 네트워크 백업 수동 테스트 API와 연결됩니다.
 */
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
      
      // 혼란을 막기 위해 지정 경로 하위에 'account_book_backup' 폴더를 생성하여 저장 (이미 있으면 패스)
      const targetDir = path.join(baseDir, 'account_book_backup');
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
        console.log(`[네트워크 백업][${username}] 신규 백업 폴더 생성 완료: ${targetDir}`);
      }
      
      const targetPath = path.join(targetDir, filename);
      fs.copyFileSync(localFilePath, targetPath);
      console.log(`[네트워크 백업][${username}] 네트워크 경로 파일 복사 완료: ${targetPath}`);

      // 오래된 네트워크 백업 롤링 삭제 (7일 유지)
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

    // 오래된 WebDAV 백업 롤링 삭제 (7일 유지)
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

/**
 * 네트워크 백업 설정을 테스트하기 위해 즉시 백업을 생성하고 전송을 테스트합니다.
 * @param {string} username - 대상 사용자
 * 의존성: routes/settings.js의 POST /api/settings/backups/test-network API와 연결됩니다.
 */
async function testNetworkBackup(username) {
  const isWin = process.platform === 'win32';
  const dbDir = isWin ? path.join(__dirname, 'data') : '/data';
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

  // 1. 임시 JSON 백업 파일 생성
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

    // 로컬 임시 백업 파일 삭제
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
    const cryptoHelper = require('./crypto_helper');
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

/**
 * 특정 사용자의 데이터베이스 백업 파일을 생성하고, 네트워크 전송 후 로컬 임시 파일을 즉시 삭제합니다.
 */
async function backupUserDB(username) {
  const isWin = process.platform === 'win32';
  const dbDir = isWin ? path.join(__dirname, 'data') : '/data';
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

    // 1. 데이터베이스 JSON 데이터 직렬화 백업
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

    // JSON 데이터 전체 암호화 (options.json token 기반 AES-256-CBC)
    const cryptoHelper = require('./crypto_helper');
    const encryptedJSON = cryptoHelper.encrypt(JSON.stringify(backupData));
    
    fs.writeFileSync(backupPath, encryptedJSON, 'utf8');
    console.log(`[백업] 사용자 '${username}'의 JSON 백업 암호화 완료: ${backupFileName}`);

    // 2. 네트워크 백업 실행
    try {
      await backupToNetwork(username, backupPath, backupFileName);
    } catch (netErr) {
      console.error(`[백업][${username}] 네트워크 백업 실패:`, netErr.message);
    }
  } catch (err) {
    console.error(`[백업] 사용자 '${username}'의 JSON 백업 진행 중 에러 발생:`, err);
  } finally {
    // 로컬 디바이스 용량 누적 방지를 위해 전송 성공/실패와 무관하게 로컬 임시 백업 파일은 즉시 삭제
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

const schedulerHistory = {}; // username -> executionKey

/**
 * 활성 사용자들의 개별 일정(시간, 요일)에 맞추어 자동 백업을 처리하는 백그라운드 스케줄러를 작동시킵니다.
 */
function startBackupScheduler() {
  console.log('[백업] 사용자 맞춤 자동 백업 스케줄러가 활성화되었습니다.');
  
  // 1분마다 스케줄 체크
  setInterval(async () => {
    try {
      const kstOffset = 9 * 60; // KST = UTC+9
      const now = new Date();
      const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
      const kstDate = new Date(utc + (kstOffset * 60000));

      const currentDay = kstDate.getDay(); // 0(일) ~ 6(토)
      const currentHour = String(kstDate.getHours()).padStart(2, '0');
      const currentMin = String(kstDate.getMinutes()).padStart(2, '0');
      const currentTimeStr = `${currentHour}:${currentMin}`;
      const dateStr = kstDate.toISOString().slice(0, 10);
      
      const executionKey = `${dateStr} ${currentTimeStr}`;

      const users = getActiveUsers();
      for (const username of users) {
        // 동일 분 내에 중복 실행되는 것을 방지
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

          // 시간 매칭 및 요일 매칭 확인
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

/**
 * 특정 사용자의 로컬 백업 파일 목록을 가져옵니다.
 * 의존성: routes/settings.js의 GET /api/settings/backups API와 연결됩니다.
 */
async function getUserBackups(username) {
  try {
    const isWin = process.platform === 'win32';
    const dbDir = isWin ? path.join(__dirname, 'data') : '/data';
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
          // 파일명에서 타임스탬프 추출 (예: account_book_admin_20260531_201654.json)
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

    // 최신 순 정렬
    backupList.sort((a, b) => b.mtime - a.mtime);
    return backupList;
  } catch (err) {
    console.error(`[백업조회] 사용자 '${username}'의 백업 목록 조회 에러:`, err);
    return [];
  }
}

/**
 * 특정 로컬 백업 파일로 사용자의 데이터베이스를 복원합니다.
 * 의존성: routes/settings.js의 POST /api/settings/backups/restore API와 연결됩니다.
 */
async function restoreUserDBBackup(username, backupFileName) {
  try {
    const isWin = process.platform === 'win32';
    const dbDir = isWin ? path.join(__dirname, 'data') : '/data';
    const backupDir = path.join(dbDir, 'backups');
    const backupPath = path.join(backupDir, backupFileName);

    if (!fs.existsSync(backupPath)) {
      throw new Error('백업 파일이 존재하지 않습니다.');
    }

    const slug = getUserDbSlug(username);
    // 보안 검증: 요청된 백업 파일명이 본인의 백업본이 맞는지 확인
    if (!backupFileName.startsWith(`account_book_${slug}_`) || !backupFileName.endsWith('.json')) {
      throw new Error('권한이 없거나 잘못된 백업 파일명입니다.');
    }

    // 1. JSON 백업 데이터 로드
    const rawData = fs.readFileSync(backupPath, 'utf8');
    const backupObj = JSON.parse(rawData);

    // 2. executeRestore 공통 함수를 사용해 트랜잭션 내에서 데이터를 교체
    const result = await executeRestore(username, backupObj);
    return result;
  } catch (err) {
    console.error(`[복원] 사용자 '${username}'의 DB 복원 중 에러 발생:`, err);
    throw err;
  }
}

/**
 * 특정 백업 파일을 삭제합니다.
 * 의존성: routes/settings.js의 DELETE /api/settings/backups/:filename API와 연결됩니다.
 */
async function deleteUserBackup(username, backupFileName) {
  try {
    const isWin = process.platform === 'win32';
    const dbDir = isWin ? path.join(__dirname, 'data') : '/data';
    const backupDir = path.join(dbDir, 'backups');
    const backupPath = path.join(backupDir, backupFileName);

    if (!fs.existsSync(backupPath)) {
      throw new Error('백업 파일이 존재하지 않습니다.');
    }

    const slug = getUserDbSlug(username);
    // 보안 검증
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
  createInAppNotification,
  backupUserDB,
  startBackupScheduler,
  migrateCategoriesAndData,
  getUserBackups,
  restoreUserDBBackup,
  deleteUserBackup,
  backupToNetwork,
  testNetworkBackup,
  executeRestore
};
