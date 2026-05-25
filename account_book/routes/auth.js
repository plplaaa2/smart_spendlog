/**
 * @file routes/auth.js
 * @summary 로그인 및 인증 세션 제어 API 라우터
 * @description 로그인 시도 관리, 연속 실패 시 임시 IP/계정 차단(Ban) 정책을 처리합니다.
 * @dependencies
 *   - database.js: getLoginSecurity, updateLoginSecurity, clearLoginSecurity
 *   - index.js: app.locals.config 로더를 통해 config.users 정보 참조
 */

const express = require('express');
const router = express.Router();
const { getLoginSecurity, updateLoginSecurity, clearLoginSecurity } = require('../database');

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const now = Date.now();
  const config = req.app.locals.config;

  try {
    // 1. IP 밴 확인
    const ipSec = await getLoginSecurity(ip);
    if (ipSec.banned_until && ipSec.banned_until > now) {
      const remainingMin = Math.ceil((ipSec.banned_until - now) / 60000);
      return res.status(403).json({
        success: false,
        message: `잦은 로그인 실패로 인해 IP가 임시 차단되었습니다. ${remainingMin}분 후 다시 시도해 주세요.`
      });
    }

    // IP 실패 기록이 15분 경과했으면 리셋
    if (ipSec.fail_count > 0 && now - ipSec.last_failed_at > 15 * 60 * 1000) {
      await clearLoginSecurity(ip);
      ipSec.fail_count = 0;
    }

    // 2. 계정(username) 밴 확인 (username이 존재하는 경우)
    let userSec = null;
    if (username) {
      userSec = await getLoginSecurity(username);
      if (userSec.banned_until && userSec.banned_until > now) {
        const remainingMin = Math.ceil((userSec.banned_until - now) / 60000);
        return res.status(403).json({
          success: false,
          message: `잦은 로그인 실패로 인해 해당 계정('${username}')이 임시 잠금되었습니다. ${remainingMin}분 후 다시 시도해 주세요.`
        });
      }

      // 계정 실패 기록이 15분 경과했으면 리셋
      if (userSec.fail_count > 0 && now - userSec.last_failed_at > 15 * 60 * 1000) {
        await clearLoginSecurity(username);
        userSec.fail_count = 0;
      }
    }

    // 3. 사용자 검증
    const user = config.users.find(u => u.username === username && u.password === password);
    const success = !!user || (!config.users.length && username === 'admin');

    console.log(`[로그인 시도] User: ${username}, IP: ${ip}, 결과: ${success ? '성공' : '실패'}`);

    if (success) {
      // 로그인 성공 시 IP 및 계정 실패 기록 리셋
      await clearLoginSecurity(ip);
      if (username) {
        await clearLoginSecurity(username);
      }
      
      // 사용자 식별을 위한 계정 결합 토큰 발급
      const userToken = `${config.token}:${username}`;
      return res.json({ success: true, username, token: userToken });
    } else {
      // 로그인 실패 시 실패 기록 및 밴 처리
      const newIpFailCount = ipSec.fail_count + 1;
      let newIpBannedUntil = 0;
      if (newIpFailCount >= 5) {
        newIpBannedUntil = now + 15 * 60 * 1000; // 15분 차단
        console.warn(`[보안 경보] IP ${ip}가 5회 연속 로그인 실패로 15분간 차단되었습니다.`);
      }
      await updateLoginSecurity(ip, 'IP', newIpFailCount, now, newIpBannedUntil);

      let newUserFailCount = 0;
      let newUserBannedUntil = 0;
      if (username) {
        const currentFailCount = userSec ? userSec.fail_count : 0;
        newUserFailCount = currentFailCount + 1;
        if (newUserFailCount >= 5) {
          newUserBannedUntil = now + 15 * 60 * 1000; // 15분 잠금
          console.warn(`[보안 경보] 계정 ${username}이 5회 연속 로그인 실패로 15분간 차단되었습니다.`);
        }
        await updateLoginSecurity(username, 'USER', newUserFailCount, now, newUserBannedUntil);
      }

      // IP 밴에 걸렸거나 계정 밴에 걸린 경우 차단 메시지 반환
      if (newIpBannedUntil > 0) {
        return res.status(403).json({
          success: false,
          message: '로그인 5회 실패로 인해 IP가 15분간 차단되었습니다.'
        });
      }
      if (newUserBannedUntil > 0) {
        return res.status(403).json({
          success: false,
          message: `로그인 5회 실패로 인해 계정('${username}')이 15분간 차단되었습니다.`
        });
      }

      // 둘 다 차단 조건이 아닐 경우 남은 기회 계산
      const remainIp = 5 - newIpFailCount;
      const remainUser = username ? (5 - newUserFailCount) : 5;
      const remain = Math.min(remainIp, remainUser);

      return res.status(401).json({
        success: false,
        message: `아이디 또는 비밀번호가 올바르지 않습니다. (남은 기회: ${remain}회)`
      });
    }
  } catch (err) {
    console.error('[로그인 오류] 로그인 처리 중 예외 발생:', err);
    return res.status(500).json({ success: false, message: '로그인 처리 중 서버 오류가 발생했습니다.' });
  }
});

module.exports = router;
