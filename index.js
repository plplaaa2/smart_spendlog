/**
 * @file index.js
 * @summary 가계부 Add-on Express 서버 진입점
 * @description 미들웨어 설정, WebSocket을 통한 HA 연동 및 라우터들을 연관 바인딩하는 서버 코어 파일입니다.
 * @dependencies
 *   - database.js: initDB, getDB, getActiveUsers, updateHASensors
 *   - routes/*.js: auth, transactions, analytics, rules, settings, webhook
 */

const express = require('express');
const path = require('path');
const WebSocket = require('ws');
const fs = require('fs');
const { initDB, getDB, getActiveUsers, updateHASensors } = require('./database');

const app = express();
const PORT = process.env.PORT || 8124;

// options.json 파일 읽기 및 설정 로드
const isWin = process.platform === 'win32';
const optionsPath = isWin ? './data/options.json' : '/data/options.json';
let config = {
  token: 'accountbook_secret_token',
  users: [
    { username: 'admin', password: 'password' }
  ]
};

try {
  if (fs.existsSync(optionsPath)) {
    const fileConfig = JSON.parse(fs.readFileSync(optionsPath, 'utf8'));
    config = { ...config, ...fileConfig };
    console.log('[보안] options.json 로드 완료');
  } else {
    console.log('[보안] options.json 파일이 없습니다. 기본 사용자 설정을 사용합니다.');
  }
} catch (err) {
  console.error('[보안] options.json 읽기 실패:', err);
}

// 라우터 공유 전역 설정 바인딩
app.locals.config = config;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 1. [인증 제외] 로그인 및 웹훅 수신 라우터 등록
const webhookModule = require('./routes/webhook');
app.use('/api', require('./routes/auth'));
app.use('/api', webhookModule.router);

// 토큰 인증 미들웨어 (모든 API 엔드포인트 보호, 단 webhook 및 login 제외)
const authenticateToken = (req, res, next) => {
  const token = req.headers['authorization'] || req.query.token || req.body.token;

  if (!token) {
    return res.status(403).json({ error: 'Forbidden: Missing token' });
  }

  // 토큰 파싱: token_secret:username 형식
  const parts = token.split(':');
  const secretToken = parts[0];
  const username = parts[1] || 'admin';

  if (secretToken === config.token) {
    req.username = username;
    return next();
  }

  res.status(403).json({ error: 'Forbidden: Invalid or missing token' });
};

// 2. [인증 필요 미들웨어 일괄 적용]
app.use('/api', authenticateToken);

// 3. [인증 필요] 라우터 바인딩
app.use('/api', require('./routes/transactions'));
app.use('/api', require('./routes/analytics'));
app.use('/api', require('./routes/rules'));
app.use('/api', require('./routes/settings'));

let haWs = null;
let wsSubscribedEntities = {};

// Home Assistant WebSocket 연동
async function connectHA() {
  const token = process.env.SUPERVISOR_TOKEN;
  if (!token) {
    console.log('[HA WS] SUPERVISOR_TOKEN이 없습니다. 단독 모드로 작동합니다.');
    return;
  }

  const users = getActiveUsers();
  wsSubscribedEntities = {};

  for (const u of users) {
    const db = await getDB(u);
    try {
      const row = await db.get("SELECT value FROM settings WHERE key = 'ws_sensor_entity'");
      if (row && row.value) {
        wsSubscribedEntities[row.value.trim()] = u;
      }
    } catch (err) {
      console.error(`[HA WS] ${u} 설정을 읽어오는 중 에러:`, err);
    }
  }

  const entitiesToSub = Object.keys(wsSubscribedEntities);
  if (entitiesToSub.length === 0) {
    console.log('[HA WS] 웹소켓으로 모니터링할 센서가 설정되지 않았습니다. 대기 중.');
    return;
  }

  console.log(`[HA WS] 모니터링 센서 목록:`, entitiesToSub);

  const url = 'ws://supervisor/core/websocket';
  console.log(`[HA WS] Home Assistant WebSocket 연결 시도: ${url}...`);

  if (haWs) {
    try {
      haWs.terminate();
    } catch (e) {}
  }

  haWs = new WebSocket(url);

  haWs.on('open', () => {
    console.log('[HA WS] 연결 성공.');
  });

  haWs.on('message', async (data) => {
    try {
      const msg = JSON.parse(data);

      if (msg.type === 'auth_required') {
        console.log('[HA WS] 인증 정보 전송 중...');
        haWs.send(JSON.stringify({
          type: 'auth',
          access_token: token
        }));
      } else if (msg.type === 'auth_ok') {
        console.log('[HA WS] 인증 완료. 이벤트 구독 시작.');
        haWs.send(JSON.stringify({
          id: 1,
          type: 'subscribe_events',
          event_type: 'state_changed'
        }));
      } else if (msg.type === 'auth_invalid') {
        console.error('[HA WS] 인증 실패:', msg.message);
      } else if (msg.type === 'event' && msg.event && msg.event.event_type === 'state_changed') {
        const eventData = msg.event.data;
        if (eventData && eventData.entity_id) {
          const matchedUser = wsSubscribedEntities[eventData.entity_id];
          if (matchedUser) {
            const newState = eventData.new_state;
            if (newState && newState.state !== 'unknown' && newState.state !== 'unavailable') {
              console.log(`[HA WS] [${matchedUser}] ${eventData.entity_id} 상태 변경 감지:`, newState.state);
              // 웹훅 모듈 내의 파싱 처리 코어 호출
              await webhookModule.processIncomingNotification(newState, matchedUser);
            }
          }
        }
      }
    } catch (err) {
      console.error('[HA WS] 메시지 처리 중 에러:', err);
    }
  });

  haWs.on('close', () => {
    console.log('[HA WS] 연결이 닫혔습니다. 10초 후 재시도합니다.');
    setTimeout(connectHA, 10000);
  });

  haWs.on('error', (err) => {
    console.error('[HA WS] 에러 발생:', err.message);
  });
}

// settings.js 라우터에서 호출 가능하도록 전역 바인딩
app.locals.connectHA = connectHA;

// 서버 기동
async function startServer() {
  await initDB(config.users);
  
  app.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(` 가계부 Add-on 서버가 포트 ${PORT}에서 작동 중입니다.`);
    console.log(`====================================================`);
  });

  connectHA();

  // 초기 1회 센서 상태 동기화 (3초 지연)
  setTimeout(() => {
    const users = getActiveUsers();
    for (const u of users) {
      updateHASensors(u);
    }
  }, 3000);
}

startServer().catch(err => {
  console.error('서버 기동 중 치명적 에러 발생:', err);
});
