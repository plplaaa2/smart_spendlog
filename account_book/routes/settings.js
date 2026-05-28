/**
 * @file routes/settings.js
 * @summary 사용자 환경설정 및 백업/복원 관리 API 라우터
 * @description 월간 예산 설정, 초기 잔액/포인트 입력 설정, 전체 데이터베이스 리셋 및 JSON 내보내기/가져오기를 통한 백업 복원 동작을 관리합니다.
 * @dependencies
 *   - database.js: getDB, resetAllData, updateLoginSecurity, updateHASensors
 *   - index.js: req.app.locals.connectHA 함수 동적 등록 후 바인딩 활용
 */

const express = require('express');
const http = require('http');
const router = express.Router();
const { getDB, resetAllData, updateHASensors } = require('../database');

// HA의 last_notification 엔티티 목록 조회
router.get('/settings/ha_notification_sensors', async (req, res) => {
  const token = process.env.SUPERVISOR_TOKEN;
  if (!token) {
    return res.json([]);
  }

  try {
    const states = await new Promise((resolve, reject) => {
      const options = {
        hostname: 'supervisor',
        port: 80,
        path: '/core/api/states',
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      };

      const request = http.request(options, (response) => {
        let data = '';
        response.on('data', (chunk) => { data += chunk; });
        response.on('end', () => {
          if (response.statusCode >= 200 && response.statusCode < 300) {
            try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
          } else {
            reject(new Error(`Status: ${response.statusCode}`));
          }
        });
      });

      request.on('error', (err) => { reject(err); });
      request.end();
    });

    if (!Array.isArray(states)) {
      return res.json([]);
    }

    const sensors = states
      .filter(s => s.entity_id && s.entity_id.endsWith('_last_notification'))
      .map(s => ({
        entity_id: s.entity_id,
        friendly_name: (s.attributes && s.attributes.friendly_name) || s.entity_id
      }));

    res.json(sensors);
  } catch (err) {
    console.error('[HA API] HA states 조회 오류:', err);
    res.json([]);
  }
});

// 설정 조회
router.get('/settings', async (req, res) => {
  try {
    const db = await getDB(req.username);
    const rows = await db.all('SELECT * FROM settings');
    const settings = {};
    rows.forEach(r => {
      settings[r.key] = r.value;
    });
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 설정 저장
router.post('/settings', async (req, res) => {
  try {
    const db = await getDB(req.username);
    const { ws_sensor_entity, monthly_budget, initial_balance, initial_balances, initial_points, card_performance_goals, user_real_name, auto_rule_generation, pay_methods_order } = req.body;

    if (ws_sensor_entity !== undefined) {
      await db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('ws_sensor_entity', ?)", [ws_sensor_entity]);
    }
    if (monthly_budget !== undefined) {
      await db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('monthly_budget', ?)", [String(monthly_budget)]);
    }
    if (initial_balance !== undefined) {
      await db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('initial_balance', ?)", [String(initial_balance)]);
    }
    if (initial_balances !== undefined) {
      await db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('initial_balances', ?)", [typeof initial_balances === 'string' ? initial_balances : JSON.stringify(initial_balances)]);
    }
    if (initial_points !== undefined) {
      await db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('initial_points', ?)", [typeof initial_points === 'string' ? initial_points : JSON.stringify(initial_points)]);
    }
    if (card_performance_goals !== undefined) {
      await db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('card_performance_goals', ?)", [typeof card_performance_goals === 'string' ? card_performance_goals : JSON.stringify(card_performance_goals)]);
    }
    if (user_real_name !== undefined) {
      await db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('user_real_name', ?)", [user_real_name]);
    }
    if (auto_rule_generation !== undefined) {
      await db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('auto_rule_generation', ?)", [String(auto_rule_generation)]);
    }
    if (pay_methods_order !== undefined) {
      await db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('pay_methods_order', ?)", [pay_methods_order]);
    }

    res.json({ success: true });
    updateHASensors(req.username);

    // 센서 설정이 변경된 경우 웹소켓 재접속하여 구독 대상 업데이트
    if (ws_sensor_entity !== undefined && typeof req.app.locals.connectHA === 'function') {
      console.log(`[HA WS][${req.username}] 모니터링 대상 변경 감지. 재연동을 진행합니다.`);
      req.app.locals.connectHA();
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 전체 초기화 API
router.post('/settings/reset-all', async (req, res) => {
  try {
    await resetAllData(req.username);
    res.json({ success: true, message: '모든 데이터와 설정이 성공적으로 초기화되었습니다.' });
    updateHASensors(req.username);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 잔액 초기화 API
router.post('/settings/reset-balance', async (req, res) => {
  try {
    const db = await getDB(req.username);
    await db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('initial_balance', '0')");
    res.json({ success: true, message: '초기 잔액이 0원으로 초기화되었습니다.' });
    updateHASensors(req.username);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 데이터 백업 API (내보내기)
router.get('/settings/backup', async (req, res) => {
  try {
    const db = await getDB(req.username);
    const adminDb = await getDB('admin');
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

    const backupData = {
      version: '1.9.18',
      username: req.username,
      backup_date: new Date().toISOString(),
      data: {}
    };

    for (const table of tables) {
      // 자동 분류 규칙(rules) 테이블은 공통 공유되므로 무조건 admin DB에서 가져옵니다.
      const targetDb = table === 'rules' ? adminDb : db;
      const rows = await targetDb.all(`SELECT * FROM ${table}`);
      backupData.data[table] = rows;
    }

    // 한글 ID 포함 시 Content-Disposition 헤더 인코딩 오류(TypeError) 방지를 위해 RFC 6266 규격 준수 인코딩 적용
    const rawFilename = `account_book_backup_${req.username}_${new Date().toISOString().slice(0,10)}.json`;
    const encodedFilename = encodeURIComponent(rawFilename);
    res.setHeader('Content-disposition', `attachment; filename="${encodedFilename}"; filename*=UTF-8''${encodedFilename}`);
    res.setHeader('Content-type', 'application/json');
    res.send(JSON.stringify(backupData, null, 2));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 데이터 복원 API (가져오기)
router.post('/settings/restore', async (req, res) => {
  try {
    const db = await getDB(req.username);
    const adminDb = await getDB('admin');
    const backupObj = req.body;

    if (!backupObj || !backupObj.data || typeof backupObj.data !== 'object') {
      return res.status(400).json({ error: '올바르지 않은 백업 데이터 포맷입니다.' });
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

    // 데이터 구조 검증
    for (const table of tables) {
      if (!Array.isArray(backupObj.data[table])) {
        return res.status(400).json({ error: `백업 데이터 내 '${table}' 테이블 정보가 유실되었습니다.` });
      }
    }

    // SQLite 트랜잭션 구동으로 일괄 안전하게 교체
    await db.run('BEGIN TRANSACTION');
    const runAdminTx = (req.username !== 'admin');
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

      // categories 복구 (type 속성 복원 포함)
      // 의존성: public/app.js의 updateCategorySelect 및 default_rules.json의 스키마와 연결됩니다.
      if (backupObj.data.categories.length > 0) {
        const stmt = await db.prepare('INSERT INTO categories (id, name, color, icon, type) VALUES (?, ?, ?, ?, ?)');
        for (const row of backupObj.data.categories) {
          await stmt.run(row.id, row.name, row.color, row.icon, row.type || 'EXPENSE');
        }
        await stmt.finalize();
      }

      // 복원 시 필수 이체 카테고리가 누락되지 않도록 강제 보강 주입
      await db.run("INSERT OR IGNORE INTO categories (name, color, icon, type) VALUES ('이체/송금', '#7950f2', 'arrow-left-right', 'EXPENSE')");
      await db.run("INSERT OR IGNORE INTO categories (name, color, icon, type) VALUES ('이체/입금', '#228be6', 'arrow-left-right', 'INCOME')");
      await db.run("INSERT OR IGNORE INTO categories (name, color, icon, type) VALUES ('페이류', '#0ca678', 'wallet', 'EXPENSE')");

      // pay_methods 복구
      if (backupObj.data.pay_methods.length > 0) {
        const stmt = await db.prepare('INSERT INTO pay_methods (id, name) VALUES (?, ?)');
        for (const row of backupObj.data.pay_methods) {
          await stmt.run(row.id, row.name);
        }
        await stmt.finalize();
      }

      // rules 복구 (공공 공유 규칙이므로 adminDb에 입력)
      if (backupObj.data.rules.length > 0) {
        const stmt = await adminDb.prepare('INSERT INTO rules (id, name, pattern, category, pay_method, merchant_template, type) VALUES (?, ?, ?, ?, ?, ?, ?)');
        for (const row of backupObj.data.rules) {
          await stmt.run(row.id, row.name, row.pattern, row.category, row.pay_method, row.merchant_template, row.type || 'EXPENSE');
        }
        await stmt.finalize();
      }

      // transactions 복구
      if (backupObj.data.transactions.length > 0) {
        const stmt = await db.prepare('INSERT INTO transactions (id, type, amount, merchant, category, pay_method, datetime, memo, raw_text, used_point) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
        for (const row of backupObj.data.transactions) {
          await stmt.run(row.id, row.type || 'EXPENSE', row.amount, row.merchant, row.category, row.pay_method, row.datetime, row.memo, row.raw_text, row.used_point || 0);
        }
        await stmt.finalize();
      }

      // notification_logs 복구
      // 의존성: database.js의 notification_logs 테이블 구조(created_at 컬럼)와 일치하도록 쿼리를 수정하고, 구버전 호환용 received_at 폴백을 처리합니다.
      if (backupObj.data.notification_logs.length > 0) {
        const stmt = await db.prepare('INSERT INTO notification_logs (id, sender, raw_text, parsed_status, matched_rule_id, title, text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
        for (const row of backupObj.data.notification_logs) {
          await stmt.run(row.id, row.sender, row.raw_text, row.parsed_status, row.matched_rule_id, row.title, row.text, row.created_at || row.received_at);
        }
        await stmt.finalize();
      }

      // package_pay_methods 복구
      if (backupObj.data.package_pay_methods.length > 0) {
        const stmt = await db.prepare('INSERT INTO package_pay_methods (id, package, pay_method) VALUES (?, ?, ?)');
        for (const row of backupObj.data.package_pay_methods) {
          await stmt.run(row.id, row.package, row.pay_method);
        }
        await stmt.finalize();
      }

      // settings 복구
      if (backupObj.data.settings.length > 0) {
        const stmt = await db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
        for (const row of backupObj.data.settings) {
          await stmt.run(row.key, row.value);
        }
        await stmt.finalize();
      }

      // merchant_categories 복구
      if (backupObj.data.merchant_categories.length > 0) {
        const stmt = await db.prepare('INSERT INTO merchant_categories (id, merchant, category) VALUES (?, ?, ?)');
        for (const row of backupObj.data.merchant_categories) {
          await stmt.run(row.id, row.merchant, row.category);
        }
        await stmt.finalize();
      }

      await db.run('COMMIT');
      if (runAdminTx) {
        await adminDb.run('COMMIT');
      }
      
      // HA 센서 동기화
      updateHASensors(req.username);

      res.json({ success: true, message: '데이터가 성공적으로 복원되었습니다.' });
    } catch (txErr) {
      await db.run('ROLLBACK');
      if (runAdminTx) {
        try {
          await adminDb.run('ROLLBACK');
        } catch (e) {}
      }
      throw txErr;
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
