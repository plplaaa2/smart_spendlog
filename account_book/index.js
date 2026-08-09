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
const crypto = require('crypto');
const { initDB, getDB, getActiveUsers, updateHASensors, cleanupOrphanedHASensors, createInAppNotification, startBackupScheduler } = require('./database');

const app = express();
app.set('trust proxy', true);
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

// [신규] 보안 HTTP 헤더 주입 (브라우저 취약점 방어)
// 의존성: 외부 노출 시 클릭재킹, XSS 등의 브라우저 단 공격 시도를 완화하기 위해 브라우저 보안 헤더들을 직접 설정합니다.
app.use((req, res, next) => {
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self' 'unsafe-inline' 'unsafe-eval' https://fonts.googleapis.com https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'");
  next();
});

// [신규] IP별 API 요청 속도 제한 (Rate Limiting)
// 의존성: 외부 무차별 대입 공격 및 DoS 방어를 위해 Express 전역/개별 라우트에 적용합니다.
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1분
const GENERAL_LIMIT = 300; // 1분당 일반 API 최대 300회 (계좌 삭제 및 다중 데이터 수정 지원)
const SENSITIVE_LIMIT = 10; // 1분당 로그인/웹훅 등 민감 API 최대 10회

const createRateLimiter = (limit, message) => {
  return (req, res, next) => {
    const rawIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const ip = typeof rawIp === 'string' ? rawIp.split(',')[0].trim() : rawIp;
    const now = Date.now();
    
    if (!rateLimitMap.has(ip)) {
      rateLimitMap.set(ip, []);
    }
    
    const timestamps = rateLimitMap.get(ip);
    const activeTimestamps = timestamps.filter(time => now - time < RATE_LIMIT_WINDOW);
    activeTimestamps.push(now);
    rateLimitMap.set(ip, activeTimestamps);

    if (activeTimestamps.length > limit) {
      console.warn(`[보안] IP ${ip}가 요청 제한을 초과했습니다. (${activeTimestamps.length}/${limit}회)`);
      return res.status(429).json({ error: message || 'Too Many Requests: 요청 속도가 너무 빠릅니다. 잠시 후 다시 시도해 주세요.' });
    }
    next();
  };
};

const generalLimiter = createRateLimiter(GENERAL_LIMIT, '요청 속도가 너무 빠릅니다. 잠시 후 다시 시도해 주세요.');
const sensitiveLimiter = createRateLimiter(SENSITIVE_LIMIT, '인증 및 웹훅 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.');

app.use(express.json());

// 민감 API 및 일반 API 개별 제한 순차 적용
app.use('/api/login', sensitiveLimiter);
app.use('/api/webhook', sensitiveLimiter);
app.use('/api', generalLimiter);

// 에러 메시지 마스킹 미들웨어 (Information Disclosure 방지)
app.use((req, res, next) => {
  const originalJson = res.json;
  res.json = function (obj) {
    if (res.statusCode === 500 && obj && typeof obj.error === 'string') {
      console.error(`[서버 에러] [${req.method}] ${req.url} :`, obj.error);
      obj.error = '서버 처리 중 오류가 발생했습니다. 자세한 오류 내용은 시스템 로그를 확인해 주세요.';
    }
    return originalJson.call(this, obj);
  };
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

// 1. [인증 제외] 로그인 및 웹훅 수신 라우터 등록
const webhookModule = require('./routes/webhook');
app.use('/api', require('./routes/auth'));
app.use('/api', webhookModule.router);

// 타이밍 공격(Timing Attack) 방지를 위한 안전한 문자열 비교 함수
function safeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

// 토큰 인증 미들웨어 (모든 API 엔드포인트 보호, 단 webhook, login 제외)
const authenticateToken = (req, res, next) => {
  const token = req.headers['authorization'] || req.query.token || req.body.token;

  if (!token) {
    return res.status(403).json({ error: 'Forbidden: Missing token' });
  }

  // 토큰 파싱: token_secret:username 형식
  const parts = token.split(':');
  const secretToken = parts[0];
  const username = decodeURIComponent(parts[1] || 'admin');

  if (safeCompare(secretToken, config.token)) {
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
app.use('/api', require('./routes/settings').router);
app.use('/api', require('./routes/notifications'));

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
  startBackupScheduler();

  // 초기 1회 센서 상태 동기화 및 고아 센서 제거 (3초 지연)
  setTimeout(async () => {
    const users = getActiveUsers();
    
    // 삭제된 사용자의 고아 센서 일괄 제거
    await cleanupOrphanedHASensors(users);

    for (const u of users) {
      updateHASensors(u);
    }

    // 기본 보안 자격증명 사용 여부 검사 및 경고 등록
    const hasDefaultToken = config.token === 'accountbook_secret_token';
    const hasDefaultPassword = config.users && config.users.some(u => u.password === 'password');
    
    if (hasDefaultToken || hasDefaultPassword) {
      console.warn(`\x1b[33m%s\x1b[0m`, `====================================================`);
      console.warn(`\x1b[33m%s\x1b[0m`, ` ⚠️ [보안 경고] 기본 보안 설정이 감지되었습니다.`);
      if (hasDefaultToken) console.warn(`\x1b[33m%s\x1b[0m`, ` - 기본 API 토큰(accountbook_secret_token)을 사용 중입니다.`);
      if (hasDefaultPassword) console.warn(`\x1b[33m%s\x1b[0m`, ` - 기본 비밀번호(password)를 사용하는 계정이 존재합니다.`);
      console.warn(`\x1b[33m%s\x1b[0m`, ` 외부망과 연결 시 심각한 보안 침해로 이어질 수 있으니`);
      console.warn(`\x1b[33m%s\x1b[0m`, ` 반드시 options.json에서 토큰 및 비밀번호를 재설정하십시오.`);
      console.warn(`\x1b[33m%s\x1b[0m`, `====================================================`);
    
      for (const u of users) {
        try {
          const warnMessage = `기본 보안 자격증명(기본 토큰 또는 기본 비밀번호)이 사용되고 있습니다. 외부망 노출 시 가계부 해킹 등의 위험이 있으므로, 애드온 구성(options.json)에서 고유한 보안 토큰과 비밀번호로 즉시 변경해 주십시오.`;
          await createInAppNotification(u, 'SECURITY_ALERT', '⚠️ 시스템 보안 취약점 경고', warnMessage);
        } catch (e) {
          console.error(`[보안] 사용자 ${u}의 보안 인앱 알림 생성 실패:`, e.message);
        }
      }
    }
  }, 3000);
}

startServer().catch(err => {
  console.error('서버 기동 중 치명적 에러 발생:', err);
});
