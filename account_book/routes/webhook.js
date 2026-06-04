/**
 * @file routes/webhook.js
 * @summary HA 알림 이벤트 수집 및 HTTP Webhook 처리 API 라우터
 * @description 웹훅 수신 및 WebSocket 센서 상태 변경 시 알림 문자열을 파싱하여 가계부 자동 매핑/저장 및 센서 동기화를 처리하는 핵심 엔진입니다.
 * @dependencies
 *   - database.js: getDB, findCategoryByMerchant, updateHASensors
 *   - parser.js: parseNotification
 */

const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { getDB, findCategoryByMerchant, updateHASensors, sendHANotification, createInAppNotification } = require('../database');

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
const { parseNotification, generatePatternFromText, parseNotificationWithAI, generatePatternWithAI } = require('../parser');
const cryptoHelper = require('../crypto_helper');

// 현재 한국 시간(KST, UTC+9) 문자열을 YYYY-MM-DD HH:mm:ss 포맷으로 반환하는 헬퍼 함수
function getKSTDateString() {
  const now = new Date();
  const kstOffset = 9 * 60 * 60 * 1000;
  const kstDate = new Date(now.getTime() + kstOffset);
  const pad = (n) => String(n).padStart(2, '0');
  return `${kstDate.getUTCFullYear()}-${pad(kstDate.getUTCMonth() + 1)}-${pad(kstDate.getUTCDate())} ${pad(kstDate.getUTCHours())}:${pad(kstDate.getUTCMinutes())}:${pad(kstDate.getUTCSeconds())}`;
}

// 수신된 알림 상태 파싱 및 저장 (WebSocket 및 HTTP Webhook 양방향 지원 핵심 로직)
async function processIncomingNotification(newState, username) {
  const targetUser = username || 'admin';
  const db = await getDB(targetUser);
  const attrs = newState.attributes || {};
  
  const title = attrs['android.title'] || (attrs.android && attrs.android.title) || attrs.title || '';
  const text = attrs['android.text'] || (attrs.android && attrs.android.text) || attrs.text || newState.state || '';
  
  const packageVal = attrs.package || (attrs.android && attrs.android.package) || '';
  const sender = packageVal || title || newState.entity_id || 'Unknown';

  if (!text && !title) return;

  let rawText = '';
  if (title && text && title !== text) {
    if (title.startsWith('[') || title.startsWith('(')) {
      rawText = `${title} ${text}`;
    } else {
      rawText = `[${title}] ${text}`;
    }
  } else {
    rawText = text || title;
  }

  const adminDb = await getDB('admin');

  // 0. 자동 패스 규칙 검사 우선 수행
  const passRules = await adminDb.all('SELECT * FROM pass_rules');
  let isPassed = false;
  let matchedPassRuleId = null;
  for (const pRule of passRules) {
    try {
      const pRegex = new RegExp(pRule.pattern);
      if (pRegex.test(rawText)) {
        isPassed = true;
        matchedPassRuleId = pRule.id;
        break;
      }
    } catch (e) {
      console.error(`[웹훅] 패스 규칙 "${pRule.name}" 패턴 분석 에러:`, e);
    }
  }

  if (isPassed) {
    console.log(`[웹훅][${targetUser}] 자동 패스 규칙에 매칭되어 처리를 제외(PASS)합니다. (알림: "${rawText}")`);
    await db.run(
      'INSERT INTO notification_logs (sender, raw_text, title, text, parsed_status, matched_rule_id) VALUES (?, ?, ?, ?, ?, ?)',
      [sender, rawText, title, text, 'PASS', matchedPassRuleId]
    );
    return;
  }

  const rules = await adminDb.all('SELECT * FROM rules');
  const fallbackKST = getKSTDateString();
  let result = parseNotification(rawText, rules, fallbackKST);

  let parsedStatus = 'FAILED';
  let matchedRuleId = null;

  // 정규식 매칭 실패 시 AI 파싱 시도
  if (!result) {
    const aiMasterEnabledRow = await db.get("SELECT value FROM settings WHERE key = 'ai_enabled'");
    const aiParsingEnabledRow = await db.get("SELECT value FROM settings WHERE key = 'ai_parsing_enabled'");
    const isAiParsingEnabled = (aiMasterEnabledRow && aiMasterEnabledRow.value === 'true') && (aiParsingEnabledRow && aiParsingEnabledRow.value === 'true');
    if (isAiParsingEnabled) {
      const aiProviderRow = await db.get("SELECT value FROM settings WHERE key = 'ai_provider'");
      const aiApiKeyRow = await db.get("SELECT value FROM settings WHERE key = 'ai_api_key'");
      const aiLocalIpRow = await db.get("SELECT value FROM settings WHERE key = 'ai_local_ip'");
      const aiLocalModelRow = await db.get("SELECT value FROM settings WHERE key = 'ai_local_model'");

      const provider = aiProviderRow ? aiProviderRow.value : 'gemini';
      const encryptedKey = aiApiKeyRow ? aiApiKeyRow.value : '';
      let apiKey = '';
      if (encryptedKey && encryptedKey !== '******') {
        try {
          apiKey = cryptoHelper.decrypt(encryptedKey);
        } catch (decErr) {
          console.error(`[웹훅][${targetUser}] AI API Key 복호화 실패:`, decErr.message);
        }
      }
      const localIp = aiLocalIpRow ? aiLocalIpRow.value : '';
      const localModel = aiLocalModelRow ? aiLocalModelRow.value : '';

      console.log(`[웹훅][${targetUser}] 정규식 파싱 실패. AI 파싱 시도 (${provider})`);
      result = await parseNotificationWithAI(rawText, {
        provider,
        apiKey,
        localIp,
        localModel
      }, fallbackKST);
      if (result) {
        parsedStatus = 'SUCCESS';
        
        // AI 피드백 루프: 성공한 경우 정규식을 자동으로 생성하여 DB 규칙으로 등록 (캐싱)
        try {
          console.log(`[웹훅][${targetUser}] AI 파싱 성공. 정규식 캐싱 등록 시도...`);
          const generatedPattern = await generatePatternWithAI(rawText, {
            provider,
            apiKey,
            localIp,
            localModel
          });
          
          if (generatedPattern) {
            const ruleName = `${result.merchant} (AI 자동 생성)`;
            const insertRes = await adminDb.run(
              "INSERT OR IGNORE INTO rules (name, pattern, category, pay_method, merchant_template, type) VALUES (?, ?, ?, ?, ?, ?)",
              [ruleName, generatedPattern, result.category || '_AUTO_MAPPING_', result.pay_method || '_AUTO_MAPPING_', '${merchant}', result.type || 'EXPENSE']
            );
            if (insertRes.changes > 0) {
              console.log(`[웹훅][${targetUser}] AI 생성 정규식 등록 완료: "${ruleName}" (패턴: ${generatedPattern})`);
              matchedRuleId = insertRes.lastID;
              result.rule_id = insertRes.lastID;
              result.rule_name = ruleName;
            }
          }
        } catch (cacheErr) {
          console.warn(`[웹훅][${targetUser}] AI 정규식 캐싱 규칙 등록 중 예외 발생:`, cacheErr.message);
        }
      }
    }
  }

  if (!result) {
    const autoRuleRow = await db.get("SELECT value FROM settings WHERE key = 'auto_rule_generation'");
    const isAutoRuleEnabled = autoRuleRow && autoRuleRow.value === 'true';

    if (isAutoRuleEnabled) {
      const generatedPattern = generatePatternFromText(rawText);
      if (generatedPattern) {
        const isIncome = /입금|저축|환불|입금완료|수입/.test(rawText);
        const resultType = isIncome ? 'INCOME' : 'EXPENSE';
        
        const dummyRule = { 
          pattern: generatedPattern, 
          pay_method: '_AUTO_MAPPING_', 
          category: '_AUTO_MAPPING_', 
          type: resultType, 
          id: 9999, 
          name: '임시' 
        };
        const tempParsed = parseNotification(rawText, [dummyRule]);
        const merchantName = (tempParsed && tempParsed.merchant) ? tempParsed.merchant : '자동 생성 규칙';
        
        const insertRes = await adminDb.run(
          "INSERT INTO rules (name, pattern, category, pay_method, merchant_template, type) VALUES (?, ?, ?, ?, ?, ?)",
          [merchantName, generatedPattern, '_AUTO_MAPPING_', '_AUTO_MAPPING_', '${merchant}', resultType]
        );
        matchedRuleId = insertRes.lastID;
        
        console.log(`[파서][자동규칙생성][${targetUser}] 알림 파싱 실패로 인해 새 규칙을 자동 생성했습니다: "${merchantName}" (ID: ${matchedRuleId})`);
        
        const updatedRules = await adminDb.all('SELECT * FROM rules');
        result = parseNotification(rawText, updatedRules, fallbackKST);
      }
    }
  }

  if (result) {
    parsedStatus = 'SUCCESS';
    matchedRuleId = result.rule_id || matchedRuleId;

    // 패키지별 결제수단 자동 매핑 (패키지 매핑이 있으면 최우선 적용, 없으면 규칙/파싱 결과 적용)
    let finalPayMethod = result.pay_method;
    if (packageVal) {
      const mappedPayMethodRow = await db.get('SELECT pay_method FROM package_pay_methods WHERE package = ?', [packageVal]);
      if (mappedPayMethodRow && mappedPayMethodRow.pay_method) {
        finalPayMethod = mappedPayMethodRow.pay_method;
      }
    }

    if (finalPayMethod === '_AUTO_MAPPING_') {
      finalPayMethod = '카드';
    }

    // 패키지 매핑이나 규칙 등에 의해 결정된 최종 결제수단이 카드사이고, 원래 문자 텍스트에 '체크'가 포함되어 있다면 은행 결제로 변환
    if (rawText.includes('체크') || finalPayMethod.includes('체크')) {
      const cardToBankMap = {
        'KB국민카드': '국민은행',
        '신한카드': '신한은행',
        '하나카드': '하나은행',
        '우리카드': '우리은행',
        'NH농협카드': '농협은행',
        'BC카드': '계좌이체',
        '삼성카드': '계좌이체',
        '현대카드': '계좌이체',
        '롯데카드': '계좌이체'
      };
      if (cardToBankMap[finalPayMethod]) {
        finalPayMethod = cardToBankMap[finalPayMethod];
      } else if (finalPayMethod.includes('카드') && !finalPayMethod.includes('체크')) {
        finalPayMethod = '계좌이체';
      }
    }

    // 사용처 카테고리 자동 매핑
    // 요약: 정규식 규칙에 카테고리를 고정하지 않고, 파싱된 사용처명을 기준으로 사용처 매핑 테이블을 조회해 동적으로 할당(없으면 '기타'/'페이류')합니다.
    // 의존성: database.js의 findCategoryByMerchant 헬퍼 함수를 호출합니다.
    const matchedCategory = await findCategoryByMerchant(db, result.merchant);
    let finalCategory = matchedCategory;
    if (!finalCategory) {
      if (result.type === 'INCOME') {
        finalCategory = '기타수입';
      } else {
        const lowerMerchant = result.merchant.toLowerCase();
        const isPayCharge = lowerMerchant.includes('페이충전') || 
                             lowerMerchant.includes('페이 충전') || 
                             lowerMerchant.includes('페이머니') || 
                             lowerMerchant.includes('네이버페이') || 
                             lowerMerchant.includes('카카오페이') || 
                             lowerMerchant.includes('토스페이') || 
                             lowerMerchant.includes('토스머니');
        const isPayMethod = (finalPayMethod.includes('페이') || finalPayMethod.includes('머니')) && !finalPayMethod.includes('삼성페이');
        finalCategory = (isPayCharge || isPayMethod) ? '페이류' : '기타';
      }
    }

    // 통장 이동(자산 이동) 감지 및 강제 카테고리 변경
    const realNameRow = await db.get("SELECT value FROM settings WHERE key = 'user_real_name'");
    const realName = realNameRow ? realNameRow.value.trim() : '';
    const isBank = finalPayMethod.includes('은행') || finalPayMethod.includes('뱅크') || finalPayMethod.includes('농협') || ['우체국', '새마을금고', '신협', '수협', '계좌이체'].includes(finalPayMethod);
    
    const isKoreanName = (name) => {
      if (!name) return false;
      const clean = name.trim();
      const singleLastNames = '김이박최정강조윤장임한오서신권황안송전홍유육설배고문손양백허소남심노하곽성차구우주민진지채원천방공현함변염여추도석마가기길나단탁국';
      const doubleLastNames = ['남궁', '독고', '황보', '사공', '선우', '동방', '제갈', '서문'];
      if (clean.length === 3 && singleLastNames.includes(clean[0]) && /^[가-힣]{3}$/.test(clean)) {
        return true;
      }
      if (clean.length === 4 && doubleLastNames.includes(clean.slice(0, 2)) && /^[가-힣]{4}$/.test(clean)) {
        return true;
      }
      return false;
    };
    
    const isCardCompany = result.merchant.endsWith('카드') || 
                          /카드대금|카드결제|카드출금/.test(result.merchant);

    const isTransferMerchant = (realName && result.merchant === realName) || 
                               ['입금', '이체', '송금', '출금', '대체'].includes(result.merchant) ||
                               isCardCompany;

    if (isTransferMerchant && isBank) {
      if (result.type === 'INCOME') {
        finalCategory = '이체/입금';
      } else {
        finalCategory = '이체/송금';
      }
      console.log(`[파서][${targetUser}] 통장 이동(자산 이동) 감지: 카테고리를 '${finalCategory}'으로 강제 변경하여 등록합니다.`);
    }

    // 이중 등록(체크카드 카드사 승인 문자 & 은행 출금 문자 중복 수신 등) 방지 로직:
    // 최근 30초 이내에 동일한 금액과 유형(INCOME/EXPENSE)을 가지고,
    // 사용처가 유사하며(상호 포함), 결제수단이 서로 다른 거래가 이미 존재하는지 검사합니다.
    const duplicateCheck = await db.get(
      "SELECT id, merchant, pay_method FROM transactions " +
      "WHERE type = ? AND amount = ? " +
      "AND abs(strftime('%s', datetime) - strftime('%s', ?)) <= 30 " +
      "ORDER BY id DESC LIMIT 1",
      [result.type || 'EXPENSE', result.amount, result.datetime]
    );

    if (duplicateCheck) {
      const existingMerchant = duplicateCheck.merchant;
      const currentMerchant = result.merchant;
      
      const cleanStr = (s) => s.replace(/[^a-zA-Z0-9가-힣]/g, '');
      const cleanExisting = cleanStr(existingMerchant);
      const cleanCurrent = cleanStr(currentMerchant);
      
      const isSimilarMerchant = cleanExisting.includes(cleanCurrent) || 
                               cleanCurrent.includes(cleanExisting) ||
                               cleanExisting === cleanCurrent;

      // 체크카드 관련 거래였는지 판단 (기존 거래 또는 현재 알림 중 하나라도 '체크' 관련인 경우)
      const isCheck1 = duplicateCheck.raw_text && (duplicateCheck.raw_text.includes('체크') || duplicateCheck.pay_method.includes('체크'));
      const isCheck2 = rawText.includes('체크') || finalPayMethod.includes('체크');
      const isCheckRelated = isCheck1 || isCheck2;

      if (isSimilarMerchant && (duplicateCheck.pay_method !== finalPayMethod || isCheckRelated)) {
        console.log(`[파서][${targetUser}] 중복 거래 감지 차단: 기존 거래 ID ${duplicateCheck.id} (${existingMerchant}, ${duplicateCheck.pay_method})와 현재 알림 (${currentMerchant}, ${finalPayMethod})의 금액/시간/사용처가 일치하므로 이중 등록을 방지합니다.`);
        
        parsedStatus = 'IGNORED_DUPLICATE';
        const hasAmount = /(\d+[,.\d]*\s*원|₩\s*\d+[,.\d]*|\\\s*\d+[,.\d]*|\b\d{1,3}(,\d{3})+\b)/.test(rawText);
        if (hasAmount || parsedStatus === 'SUCCESS') {
          await db.run(
            'INSERT INTO notification_logs (sender, raw_text, title, text, parsed_status, matched_rule_id) VALUES (?, ?, ?, ?, ?, ?)',
            [sender, rawText, title, text, parsedStatus, matchedRuleId]
          );
        }
        return;
      }
    }

    // 가계부 내역에 추가 (used_point 저장 포함)
    await db.run(
      'INSERT INTO transactions (type, amount, merchant, category, pay_method, datetime, memo, raw_text, used_point) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [result.type || 'EXPENSE', result.amount, result.merchant, finalCategory, finalPayMethod, result.datetime, result.memo || '', rawText, result.used_point || 0]
    );
    console.log(`[파서][${targetUser}] 자동 등록 성공: ${result.merchant} - ${result.amount}원 (${finalCategory}) [결제수단: ${finalPayMethod}, 사용 포인트: ${result.used_point || 0}]`);

    if (finalCategory === '기타') {
      const nameTag = targetUser === 'admin' ? '' : ` (${targetUser})`;
      sendHANotification(
        `🔍 [Smart Spendlog] 미분류 거래 등록 안내${nameTag}`,
        `카테고리가 '기타'로 분류된 거래가 등록되었습니다.\n\n` +
        `- 사용처: **${result.merchant}**\n` +
        `- 금액: **${result.amount.toLocaleString()}원**\n\n` +
        `정확한 소비 분석을 위해 규칙 설정을 확인해 주세요.`
      );
      await createInAppNotification(
        targetUser,
        'UNCLASSIFIED',
        `미분류 거래 등록 안내`,
        `카테고리가 '기타'로 분류된 거래가 등록되었습니다.\n- 사용처: ${result.merchant}\n- 금액: ${result.amount.toLocaleString()}원\n규칙 설정을 확인해 주세요.`
      );
    }

    updateHASensors(targetUser);
  } else {
    console.log(`[파서][${targetUser}] 일치하는 정규식 규칙이 없습니다.`);
  }

  // 금액 표기가 있는 알림이거나 성공 파싱된 경우 로그에 기록
  const hasAmount = /(\d+[,.\d]*\s*원|₩\s*\d+[,.\d]*|\\\s*\d+[,.\d]*|\b\d{1,3}(,\d{3})+\b)/.test(rawText);
  if (hasAmount || parsedStatus === 'SUCCESS') {
    await db.run(
      'INSERT INTO notification_logs (sender, raw_text, title, text, parsed_status, matched_rule_id) VALUES (?, ?, ?, ?, ?, ?)',
      [sender, rawText, title, text, parsedStatus, matchedRuleId]
    );
  }
}

// HTTP Webhook 수신 엔드포인트 (용량을 최대 10kb로 엄격 제한)
router.post('/webhook', express.json({ limit: '10kb' }), async (req, res) => {
  const { title, text, package: reqPackage, packageName, package_name, username } = req.body;
  const packageVal = reqPackage || packageName || package_name || '';
  const targetUser = username || 'admin';

  const config = req.app.locals.config;
  // webhook_token 보안 검증 (options.json에 webhook_token이 정의되어 있는 경우에만 검증하여 하위 호환성 유지)
  if (config && config.webhook_token) {
    const receivedToken = req.headers['authorization'] || req.query.token || req.body.token;
    if (!safeCompare(receivedToken, config.webhook_token)) {
      console.warn(`[웹훅 보안 경고][${targetUser}] 잘못된 웹훅 토큰으로 접근이 차단되었습니다.`);
      return res.status(403).json({ error: 'Forbidden: Invalid webhook token' });
    }
  }

  console.log(`[웹훅][${targetUser}] 알림 수신: title="${title}", text="${text}", package="${packageVal}"`);

  if (!title && !text) {
    return res.status(400).json({ error: '알림의 Title 또는 Text가 제공되지 않았습니다.' });
  }

  try {
    const db = await getDB(targetUser);
    
    // rawText 조합
    let finalRawText = '';
    if (title && text && title !== text) {
      if (title.startsWith('[') || title.startsWith('(')) {
        finalRawText = `${title} ${text}`;
      } else {
        finalRawText = `[${title}] ${text}`;
      }
    } else {
      finalRawText = text || title;
    }

    const finalSender = packageVal || title || 'Unknown';
    const titleText = title || '';
    const bodyText = text || '';

    const adminDb = await getDB('admin');

    // 0. 자동 패스 규칙 검사 우선 수행
    const passRules = await adminDb.all('SELECT * FROM pass_rules');
    let isPassed = false;
    let matchedPassRuleId = null;
    for (const pRule of passRules) {
      try {
        const pRegex = new RegExp(pRule.pattern);
        if (pRegex.test(finalRawText)) {
          isPassed = true;
          matchedPassRuleId = pRule.id;
          break;
        }
      } catch (e) {
        console.error(`[웹훅 API] 패스 규칙 "${pRule.name}" 패턴 분석 에러:`, e);
      }
    }

    if (isPassed) {
      console.log(`[웹훅 API][${targetUser}] 자동 패스 규칙에 매칭되어 처리를 제외(PASS)합니다. (알림: "${finalRawText}")`);
      await db.run(
        'INSERT INTO notification_logs (sender, raw_text, title, text, parsed_status, matched_rule_id) VALUES (?, ?, ?, ?, ?, ?)',
        [finalSender, finalRawText, titleText, bodyText, 'PASS', matchedPassRuleId]
      );
      return res.json({ success: true, message: '자동 패스 규칙에 의해 처리가 제외되었습니다.' });
    }

    const rules = await adminDb.all('SELECT * FROM rules');
    const fallbackKST = getKSTDateString();
    let result = parseNotification(finalRawText, rules, fallbackKST);

    let parsedStatus = 'FAILED';
    let matchedRuleId = null;

    // 정규식 매칭 실패 시 AI 파싱 시도
    if (!result) {
      const aiEnabledRow = await db.get("SELECT value FROM settings WHERE key = 'ai_parsing_enabled'");
      const isAiEnabled = aiEnabledRow && aiEnabledRow.value === 'true';
      if (isAiEnabled) {
        const aiProviderRow = await db.get("SELECT value FROM settings WHERE key = 'ai_provider'");
        const aiApiKeyRow = await db.get("SELECT value FROM settings WHERE key = 'ai_api_key'");
        const aiLocalIpRow = await db.get("SELECT value FROM settings WHERE key = 'ai_local_ip'");
        const aiLocalModelRow = await db.get("SELECT value FROM settings WHERE key = 'ai_local_model'");

        const provider = aiProviderRow ? aiProviderRow.value : 'gemini';
        const encryptedKey = aiApiKeyRow ? aiApiKeyRow.value : '';
        let apiKey = '';
        if (encryptedKey && encryptedKey !== '******') {
          try {
            apiKey = cryptoHelper.decrypt(encryptedKey);
          } catch (decErr) {
            console.error(`[웹훅][${targetUser}] AI API Key 복호화 실패:`, decErr.message);
          }
        }
        const localIp = aiLocalIpRow ? aiLocalIpRow.value : '';
        const localModel = aiLocalModelRow ? aiLocalModelRow.value : '';

        console.log(`[웹훅][${targetUser}] 정규식 파싱 실패. AI 파싱 시도 (${provider})`);
        result = await parseNotificationWithAI(finalRawText, {
          provider,
          apiKey,
          localIp,
          localModel
        }, fallbackKST);
        if (result) {
          parsedStatus = 'SUCCESS';
          
          // AI 피드백 루프: 성공한 경우 정규식을 자동으로 생성하여 DB 규칙으로 등록 (캐싱)
          try {
            console.log(`[웹훅][${targetUser}] AI 파싱 성공. 정규식 캐싱 등록 시도...`);
            const generatedPattern = await generatePatternWithAI(finalRawText, {
              provider,
              apiKey,
              localIp,
              localModel
            });
            
            if (generatedPattern) {
              const ruleName = `${result.merchant} (AI 자동 생성)`;
              const insertRes = await adminDb.run(
                "INSERT OR IGNORE INTO rules (name, pattern, category, pay_method, merchant_template, type) VALUES (?, ?, ?, ?, ?, ?)",
                [ruleName, generatedPattern, result.category || '_AUTO_MAPPING_', result.pay_method || '_AUTO_MAPPING_', '${merchant}', result.type || 'EXPENSE']
              );
              if (insertRes.changes > 0) {
                console.log(`[웹훅][${targetUser}] AI 생성 정규식 등록 완료: "${ruleName}" (패턴: ${generatedPattern})`);
                matchedRuleId = insertRes.lastID;
                result.rule_id = insertRes.lastID;
                result.rule_name = ruleName;
              }
            }
          } catch (cacheErr) {
            console.warn(`[웹훅][${targetUser}] AI 정규식 캐싱 규칙 등록 중 예외 발생:`, cacheErr.message);
          }
        }
      }
    }

    if (!result) {
      const autoRuleRow = await db.get("SELECT value FROM settings WHERE key = 'auto_rule_generation'");
      const isAutoRuleEnabled = autoRuleRow && autoRuleRow.value === 'true';

      if (isAutoRuleEnabled) {
        const generatedPattern = generatePatternFromText(finalRawText);
        if (generatedPattern) {
          const isIncome = /입금|저축|환불|입금완료|수입/.test(finalRawText);
          const resultType = isIncome ? 'INCOME' : 'EXPENSE';
          
          const dummyRule = { 
            pattern: generatedPattern, 
            pay_method: '_AUTO_MAPPING_', 
            category: '_AUTO_MAPPING_', 
            type: resultType, 
            id: 9999, 
            name: '임시' 
          };
          const tempParsed = parseNotification(finalRawText, [dummyRule]);
          const merchantName = (tempParsed && tempParsed.merchant) ? tempParsed.merchant : '자동 생성 규칙';
          
          const insertRes = await adminDb.run(
            "INSERT INTO rules (name, pattern, category, pay_method, merchant_template, type) VALUES (?, ?, ?, ?, ?, ?)",
            [merchantName, generatedPattern, '_AUTO_MAPPING_', '_AUTO_MAPPING_', '${merchant}', resultType]
          );
          matchedRuleId = insertRes.lastID;
          
          console.log(`[웹훅][자동규칙생성][${targetUser}] 알림 파싱 실패로 인해 새 규칙을 자동 생성했습니다: "${merchantName}" (ID: ${matchedRuleId})`);
          
          const updatedRules = await adminDb.all('SELECT * FROM rules');
          result = parseNotification(finalRawText, updatedRules, fallbackKST);
        }
      }
    }

    if (result) {
      parsedStatus = 'SUCCESS';
      matchedRuleId = result.rule_id || matchedRuleId;

      // 패키지별 결제수단 자동 매핑 (패키지 매핑이 있으면 최우선 적용, 없으면 규칙/파싱 결과 적용)
      let finalPayMethod = result.pay_method;
      if (packageVal) {
        const mappedPayMethodRow = await db.get('SELECT pay_method FROM package_pay_methods WHERE package = ?', [packageVal]);
        if (mappedPayMethodRow && mappedPayMethodRow.pay_method) {
          finalPayMethod = mappedPayMethodRow.pay_method;
        }
      }

      if (finalPayMethod === '_AUTO_MAPPING_') {
        finalPayMethod = '카드';
      }

      // 패키지 매핑이나 규칙 등에 의해 결정된 최종 결제수단이 카드사이고, 원래 문자 텍스트에 '체크'가 포함되어 있다면 은행 결제로 변환
      if (finalRawText.includes('체크') || finalPayMethod.includes('체크')) {
        const cardToBankMap = {
          'KB국민카드': '국민은행',
          '신한카드': '신한은행',
          '하나카드': '하나은행',
          '우리카드': '우리은행',
          'NH농협카드': '농협은행',
          'BC카드': '계좌이체',
          '삼성카드': '계좌이체',
          '현대카드': '계좌이체',
          '롯데카드': '계좌이체'
        };
        if (cardToBankMap[finalPayMethod]) {
          finalPayMethod = cardToBankMap[finalPayMethod];
        } else if (finalPayMethod.includes('카드') && !finalPayMethod.includes('체크')) {
          finalPayMethod = '계좌이체';
        }
      }

      // 사용처 카테고리 자동 매핑
      // 요약: 정규식 규칙에 카테고리를 고정하지 않고, 파싱된 사용처명을 기준으로 사용처 매핑 테이블을 조회해 동적으로 할당(없으면 '기타'/'페이류')합니다.
      const matchedCategory = await findCategoryByMerchant(db, result.merchant);
      let finalCategory = matchedCategory;
      if (!finalCategory) {
        if (result.type === 'INCOME') {
          finalCategory = '기타수입';
        } else {
          const lowerMerchant = result.merchant.toLowerCase();
          const isPayCharge = lowerMerchant.includes('페이충전') || 
                               lowerMerchant.includes('페이 충전') || 
                               lowerMerchant.includes('페이머니') || 
                               lowerMerchant.includes('네이버페이') || 
                               lowerMerchant.includes('카카오페이') || 
                               lowerMerchant.includes('토스페이') || 
                               lowerMerchant.includes('토스머니');
          const isPayMethod = (finalPayMethod.includes('페이') || finalPayMethod.includes('머니')) && !finalPayMethod.includes('삼성페이');
          finalCategory = (isPayCharge || isPayMethod) ? '페이류' : '기타';
        }
      }

      // 통장 이동(자산 이동) 감지 및 강제 카테고리 매핑
      const realNameRow = await db.get("SELECT value FROM settings WHERE key = 'user_real_name'");
      const realName = realNameRow ? realNameRow.value.trim() : '';
      const isBank = finalPayMethod.includes('은행') || finalPayMethod.includes('뱅크') || finalPayMethod.includes('농협') || ['우체국', '새마을금고', '신협', '수협', '계좌이체'].includes(finalPayMethod);
      
      const isKoreanName = (name) => {
        if (!name) return false;
        const clean = name.trim();
        const singleLastNames = '김이박최정강조윤장임한오서신권황안송전홍유육설배고문손양백허소남심노하곽성차구우주민진지채원천방공현함변염여추도석마가기길나단탁국';
        const doubleLastNames = ['남궁', '독고', '황보', '사공', '선우', '동방', '제갈', '서문'];
        if (clean.length === 3 && singleLastNames.includes(clean[0]) && /^[가-힣]{3}$/.test(clean)) {
          return true;
        }
        if (clean.length === 4 && doubleLastNames.includes(clean.slice(0, 2)) && /^[가-힣]{4}$/.test(clean)) {
          return true;
        }
        return false;
      };
      
      const isCardCompany = result.merchant.endsWith('카드') || 
                            /카드대금|카드결제|카드출금/.test(result.merchant);

      const isTransferMerchant = (realName && result.merchant === realName) || 
                                 ['입금', '이체', '송금', '출금', '대체'].includes(result.merchant) ||
                                 isCardCompany;

      if (isTransferMerchant && isBank) {
        if (result.type === 'INCOME') {
          finalCategory = '이체/입금';
        } else {
          finalCategory = '이체/송금';
        }
        console.log(`[웹훅][${targetUser}] 통장 이동(자산 이동) 감지: 카테고리를 '${finalCategory}'으로 강제 변경하여 등록합니다.`);
      }

      // 이중 등록(체크카드 카드사 승인 문자 & 은행 출금 문자 중복 수신 등) 방지 로직:
      // 최근 30초 이내에 동일한 금액과 유형(INCOME/EXPENSE)을 가지고,
      // 사용처가 유사하며(상호 포함), 결제수단이 서로 다른 거래가 이미 존재하는지 검사합니다.
      const duplicateCheck = await db.get(
        "SELECT id, merchant, pay_method FROM transactions " +
        "WHERE type = ? AND amount = ? " +
        "AND abs(strftime('%s', datetime) - strftime('%s', ?)) <= 30 " +
        "ORDER BY id DESC LIMIT 1",
        [result.type || 'EXPENSE', result.amount, result.datetime]
      );

      if (duplicateCheck) {
        const existingMerchant = duplicateCheck.merchant;
        const currentMerchant = result.merchant;
        
        const cleanStr = (s) => s.replace(/[^a-zA-Z0-9가-힣]/g, '');
        const cleanExisting = cleanStr(existingMerchant);
        const cleanCurrent = cleanStr(currentMerchant);
        
        const isSimilarMerchant = cleanExisting.includes(cleanCurrent) || 
                                 cleanCurrent.includes(cleanExisting) ||
                                 cleanExisting === cleanCurrent;

        // 체크카드 관련 거래였는지 판단 (기존 거래 또는 현재 알림 중 하나라도 '체크' 관련인 경우)
        const isCheck1 = duplicateCheck.raw_text && (duplicateCheck.raw_text.includes('체크') || duplicateCheck.pay_method.includes('체크'));
        const isCheck2 = finalRawText.includes('체크') || finalPayMethod.includes('체크');
        const isCheckRelated = isCheck1 || isCheck2;

        if (isSimilarMerchant && (duplicateCheck.pay_method !== finalPayMethod || isCheckRelated)) {
          console.log(`[웹훅][${targetUser}] 중복 거래 감지 차단: 기존 거래 ID ${duplicateCheck.id} (${existingMerchant}, ${duplicateCheck.pay_method})와 현재 알림 (${currentMerchant}, ${finalPayMethod})의 금액/시간/사용처가 일치하므로 이중 등록을 방지합니다.`);
          
          parsedStatus = 'IGNORED_DUPLICATE';
          res.json({ success: true, message: '이중 등록(중복) 거래로 감지되어 등록이 생략되었습니다.' });
          
          // 금액 표기가 있는 알림이거나 성공 파싱된 경우 로그에 기록
          const hasAmount = /(\d+[,.\d]*\s*원|₩\s*\d+[,.\d]*|\\\s*\d+[,.\d]*|\b\d{1,3}(,\d{3})+\b)/.test(finalRawText);
          if (hasAmount || parsedStatus === 'SUCCESS') {
            await db.run(
              'INSERT INTO notification_logs (sender, raw_text, title, text, parsed_status, matched_rule_id) VALUES (?, ?, ?, ?, ?, ?)',
              [finalSender, finalRawText, titleText, bodyText, parsedStatus, matchedRuleId]
            );
          }
          return;
        }
      }

      await db.run(
        'INSERT INTO transactions (type, amount, merchant, category, pay_method, datetime, memo, raw_text, used_point) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [result.type || 'EXPENSE', result.amount, result.merchant, finalCategory, finalPayMethod, result.datetime, result.memo || '', finalRawText, result.used_point || 0]
      );

      if (finalCategory === '기타') {
        const nameTag = targetUser === 'admin' ? '' : ` (${targetUser})`;
        sendHANotification(
          `🔍 [Smart Spendlog] 미분류 거래 등록 안내${nameTag}`,
          `카테고리가 '기타'로 분류된 거래가 등록되었습니다.\n\n` +
          `- 사용처: **${result.merchant}**\n` +
          `- 금액: **${result.amount.toLocaleString()}원**\n\n` +
          `정확한 소비 분석을 위해 규칙 설정을 확인해 주세요.`
        );
        await createInAppNotification(
          targetUser,
          'UNCLASSIFIED',
          `미분류 거래 등록 안내`,
          `카테고리가 '기타'로 분류된 거래가 등록되었습니다.\n- 사용처: ${result.merchant}\n- 금액: ${result.amount.toLocaleString()}원\n규칙 설정을 확인해 주세요.`
        );
      }

      res.json({ success: true, transaction: { ...result, category: finalCategory, pay_method: finalPayMethod } });
      updateHASensors(targetUser);
    } else {
      res.json({ success: false, message: '일치하는 정규식 규칙이 없습니다. 알림 로그에 저장됩니다.' });
    }

    // 금액 표기가 있는 알림이거나 성공 파싱된 경우 로그에 기록
    const hasAmount = /(\d+[,.\d]*\s*원|₩\s*\d+[,.\d]*|\\\s*\d+[,.\d]*|\b\d{1,3}(,\d{3})+\b)/.test(finalRawText);
    if (hasAmount || parsedStatus === 'SUCCESS') {
      await db.run(
        'INSERT INTO notification_logs (sender, raw_text, title, text, parsed_status, matched_rule_id) VALUES (?, ?, ?, ?, ?, ?)',
        [finalSender, finalRawText, titleText, bodyText, parsedStatus, matchedRuleId]
      );
    }

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = {
  router,
  processIncomingNotification
};
