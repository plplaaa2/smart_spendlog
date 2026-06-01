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
const path = require('path');
const fs = require('fs');
const router = express.Router();
const { getDB, resetAllData, updateHASensors, migrateCategoriesAndData, testNetworkBackup, executeRestore } = require('../database');
const cryptoHelper = require('../crypto_helper'); // 민감 정보 암호화/복호화용 헬퍼 로드

// HA 호스트에 마운트된 네트워크 스토리지 목록 조회
router.get('/settings/ha_mounts', async (req, res) => {
  const token = process.env.SUPERVISOR_TOKEN;
  if (!token) {
    return res.json([]);
  }

  try {
    const mountsData = await new Promise((resolve, reject) => {
      const options = {
        hostname: 'supervisor',
        port: 80,
        path: '/mounts',
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

      request.on('error', (err) => reject(err));
      request.setTimeout(5000);
      request.end();
    });

    if (mountsData && mountsData.result === 'ok' && mountsData.data && Array.isArray(mountsData.data.mounts)) {
      return res.json(mountsData.data.mounts);
    }
    return res.json([]);
  } catch (err) {
    console.error('[HA mounts] 네트워크 스토리지 목록 조회 실패:', err.message);
    return res.json([]);
  }
});

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

      request.setTimeout(10000);
      request.on('timeout', () => {
        request.destroy(new Error('Connection timeout (10s)'));
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
      if ((r.key === 'network_backup_webdav_password' || r.key === 'network_backup_path_password') && r.value) {
        settings[r.key] = '******'; // 보안 및 전송 보호를 위해 마스킹 처리
      } else {
        settings[r.key] = r.value;
      }
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
    const { 
      ws_sensor_entity, monthly_budget, initial_balance, initial_balances, initial_points, 
      card_performance_goals, card_performance_days, user_real_name, auto_rule_generation, 
      pay_methods_order, auto_backup, backup_time, backup_days,
      network_backup_enabled, network_backup_type, network_backup_path, 
      network_backup_path_username, network_backup_path_password,
      network_backup_webdav_url, network_backup_webdav_username, network_backup_webdav_password 
    } = req.body;

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
    if (card_performance_days !== undefined) {
      await db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('card_performance_days', ?)", [typeof card_performance_days === 'string' ? card_performance_days : JSON.stringify(card_performance_days)]);
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
    if (auto_backup !== undefined) {
      await db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('auto_backup', ?)", [String(auto_backup)]);
    }
    if (backup_time !== undefined) {
      await db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('backup_time', ?)", [backup_time]);
    }
    if (backup_days !== undefined) {
      await db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('backup_days', ?)", [backup_days]);
    }

    // [신규] 네트워크 백업 설정 개별 업데이트 및 패스워드 대칭 암호화 저장
    if (network_backup_enabled !== undefined) {
      await db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('network_backup_enabled', ?)", [String(network_backup_enabled)]);
    }
    if (network_backup_type !== undefined) {
      await db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('network_backup_type', ?)", [network_backup_type]);
    }
    if (network_backup_path !== undefined) {
      await db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('network_backup_path', ?)", [network_backup_path]);
    }
    if (network_backup_path_username !== undefined) {
      await db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('network_backup_path_username', ?)", [network_backup_path_username]);
    }
    if (network_backup_path_password !== undefined) {
      if (network_backup_path_password !== '******') {
        const encrypted = network_backup_path_password ? cryptoHelper.encrypt(network_backup_path_password) : '';
        await db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('network_backup_path_password', ?)", [encrypted]);
      }
    }
    if (network_backup_webdav_url !== undefined) {
      await db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('network_backup_webdav_url', ?)", [network_backup_webdav_url]);
    }
    if (network_backup_webdav_username !== undefined) {
      await db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('network_backup_webdav_username', ?)", [network_backup_webdav_username]);
    }
    if (network_backup_webdav_password !== undefined) {
      if (network_backup_webdav_password !== '******') {
        const encrypted = network_backup_webdav_password ? cryptoHelper.encrypt(network_backup_webdav_password) : '';
        await db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('network_backup_webdav_password', ?)", [encrypted]);
      }
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
    const { password } = req.body;
    const config = req.app.locals.config;
    const user = config.users.find(u => u.username === req.username);
    
    let isPasswordValid = false;
    if (user) {
      isPasswordValid = (user.password === password);
    } else if (!config.users.length && req.username === 'admin') {
      isPasswordValid = true;
    }
    
    if (!isPasswordValid) {
      return res.status(401).json({ error: '비밀번호가 올바르지 않습니다.' });
    }

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
    const { password } = req.body;
    const config = req.app.locals.config;
    const user = config.users.find(u => u.username === req.username);
    
    let isPasswordValid = false;
    if (user) {
      isPasswordValid = (user.password === password);
    } else if (!config.users.length && req.username === 'admin') {
      isPasswordValid = true;
    }
    
    if (!isPasswordValid) {
      return res.status(401).json({ error: '비밀번호가 올바르지 않습니다.' });
    }

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
      version: '1.9.19',
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
    const rawFilename = `account_book_backup_${req.username}_${new Date().toISOString().slice(0, 10)}.json`;
    const encodedFilename = encodeURIComponent(rawFilename);
    res.setHeader('Content-disposition', `attachment; filename="${encodedFilename}"; filename*=UTF-8''${encodedFilename}`);
    
    const encrypt = req.query.encrypt === 'true';
    let outputContent;
    if (encrypt) {
      outputContent = cryptoHelper.encrypt(JSON.stringify(backupData));
      res.setHeader('Content-type', 'text/plain');
    } else {
      outputContent = JSON.stringify(backupData, null, 2);
      res.setHeader('Content-type', 'application/json');
    }
    res.send(outputContent);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});



// 데이터 복원 API (가져오기)
router.post('/settings/restore', async (req, res) => {
  try {
    const backupObj = req.body;
    const result = await executeRestore(req.username, backupObj);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// [신규] 네트워크 백업 즉시 테스트 수행 API
// 의존성: public/settings.js의 백업 테스트 버튼 클릭 시 호출됩니다.
router.post('/settings/backups/test-network', async (req, res) => {
  try {
    const result = await testNetworkBackup(req.username);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = {
  router
};
