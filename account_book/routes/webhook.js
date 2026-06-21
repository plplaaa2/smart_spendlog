/**
 * @file routes/webhook.js
 * @summary HA 알림 이벤트 수집 및 HTTP Webhook 처리 API 라우터
 * @description 웹훅 수신 및 WebSocket 센서 상태 변경 시 알림 문자열을 파싱하여 가계부 자동 매핑/저장 및 센서 동기화를 처리하는 핵심 엔진입니다.
 * @dependencies
 *   - database.js: getDB, findCategoryByMerchant, updateHASensors, sendHANotification, createInAppNotification
 *   - parser.js: parseNotification, generatePatternFromText, parseNotificationWithAI, generatePatternWithAI
 */

const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { getDB, findCategoryByMerchant, updateHASensors, sendHANotification, createInAppNotification } = require('../database');
const { parseNotification, generatePatternFromText, parseNotificationWithAI, generatePatternWithAI, sanitizePattern } = require('../parser');
const cryptoHelper = require('../crypto_helper');

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

// 실시간 USD 환율 조회 (실패 시 DB 설정의 default_usd_exchange_rate 값 로드)
async function getUSDExchangeRate(db) {
  let exchangeRate = 1350; // 기본 백업값
  try {
    const userRateRow = await db.get("SELECT value FROM settings WHERE key = 'default_usd_exchange_rate'");
    if (userRateRow && userRateRow.value) {
      exchangeRate = parseFloat(userRateRow.value) || 1350;
    }
  } catch (dbErr) {
    console.warn('[웹훅] DB에서 default_usd_exchange_rate 조회 실패:', dbErr.message);
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000); // 3초 타임아웃
    const response = await fetch('https://open.er-api.com/v6/latest/USD', { signal: controller.signal });
    clearTimeout(timeoutId);

    if (response.ok) {
      const data = await response.json();
      if (data && data.rates && data.rates.KRW) {
        exchangeRate = parseFloat(data.rates.KRW);
        console.log(`[환율 API] 실시간 USD 환율 조회 완료: ${exchangeRate}원`);
      }
    }
  } catch (err) {
    console.warn(`[환율 API] 실시간 USD 환율 조회 실패(기본값 ${exchangeRate}원 사용):`, err.message);
  }
  return exchangeRate;
}

// 현재 한국 시간(KST, UTC+9) 문자열을 YYYY-MM-DD HH:mm:ss 포맷으로 반환하는 헬퍼 함수
function getKSTDateString() {
  const now = new Date();
  const kstOffset = 9 * 60 * 60 * 1000;
  const kstDate = new Date(now.getTime() + kstOffset);
  const pad = (n) => String(n).padStart(2, '0');
  return `${kstDate.getUTCFullYear()}-${pad(kstDate.getUTCMonth() + 1)}-${pad(kstDate.getUTCDate())} ${pad(kstDate.getUTCHours())}:${pad(kstDate.getUTCMinutes())}:${pad(kstDate.getUTCSeconds())}`;
}

// 규칙 테이블의 name UNIQUE 제약 조건 충돌 방지를 위해 중복 시 숫자를 붙여 유니크한 규칙 이름을 만드는 헬퍼 함수
async function getUniqueRuleName(db, baseName) {
  let name = baseName;
  let counter = 1;
  while (true) {
    const row = await db.get('SELECT id FROM rules WHERE name = ?', [name]);
    if (!row) {
      return name;
    }
    counter++;
    name = `${baseName} (${counter})`;
  }
}

// 수신된 알림 상태 파싱 및 저장 공통 코어 비즈니스 로직
async function processNotificationCore({ title, text, packageVal, username }) {
  const targetUser = username || 'admin';
  const db = await getDB(targetUser);
  const sender = packageVal || title || 'Unknown';

  if (!text && !title) {
    return { success: false, message: '알림의 Title 또는 Text가 제공되지 않았습니다.' };
  }

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

  // 인증번호/OTP/보안코드/광고 등의 스팸성/인증성 알림은 알림로그 및 DB 처리에서 즉시 제외
  const excludeRegex = /(\(광고\)|\[광고\]|^광고|인증번호|인증\s*번호|인증코드|인증\s*코드|본인\s*인증|본인\s*확인|인증문자|인증요청|임시\s*비밀번호|임시\s*비밀\s*번호|OTP|이벤트|혜택|쿠폰|특가)/i;
  if (excludeRegex.test(rawText)) {
    console.log(`[웹훅][${targetUser}] 인증/보안 또는 광고 알림으로 감지되어 무시 및 로그 등록을 제외합니다: "${rawText}"`);
    return { success: true, message: '인증/보안/광고 알림으로 처리가 제외되었습니다.', isIgnoredSec: true };
  }

  const adminDb = await getDB('admin');

  // 0. 자동 패스 규칙 검사 우선 수행
  const passRules = await adminDb.all('SELECT * FROM pass_rules');
  let isPassed = false;
  let matchedPassRuleId = null;
  for (const pRule of passRules) {
    try {
      const pRegex = new RegExp(sanitizePattern(pRule.pattern));
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
    return { success: true, message: '자동 패스 규칙에 의해 처리가 제외되었습니다.', isPassed: true };
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
          const aiPatternResult = await generatePatternWithAI(rawText, {
            provider,
            apiKey,
            localIp,
            localModel
          });
          const generatedPattern = aiPatternResult ? aiPatternResult.pattern : null;
          
          if (generatedPattern) {
            let isPatternValid = false;
            try {
              const sanitized = sanitizePattern(generatedPattern);
              new RegExp(sanitized, 'ds');
              if (sanitized.includes('(?<amount>') && (sanitized.includes('(?<merchant>') || sanitized.includes('(?<usage>'))) {
                isPatternValid = true;
              } else {
                console.warn(`[웹훅][${targetUser}] AI 생성 정규식에 필수 그룹(?<amount> 또는 (?<merchant>)이 누락되어 캐싱을 제외합니다: "${sanitized}"`);
              }
            } catch (regErr) {
              console.warn(`[웹훅][${targetUser}] AI 생성 정규식이 올바르지 않은 문법입니다:`, regErr.message);
            }

            if (isPatternValid) {
              let suffix = '지출';
              if (result.type === 'INCOME') {
                suffix = '수입';
              } else {
                if (rawText.includes('체크') || (result.pay_method && result.pay_method.includes('체크'))) {
                  suffix = '체크';
                } else if (rawText.includes('신용') || rawText.includes('카드') || (result.pay_method && result.pay_method.includes('카드'))) {
                  suffix = '신용';
                }
              }
              const baseRuleName = `${result.merchant} ${suffix} (AI)`;
              const ruleName = await getUniqueRuleName(adminDb, baseRuleName);
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
        const isIncome = /입금|환불|입금완료|수입|저축/.test(rawText) && !/출금|송금|지출|결제|승인|사용|신용|체크/.test(rawText);
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
        const parsedMerchant = (tempParsed && tempParsed.merchant) ? tempParsed.merchant : '자동 생성 규칙';
        let suffix = '지출';
        if (resultType === 'INCOME') {
          suffix = '수입';
        } else {
          if (rawText.includes('체크')) {
            suffix = '체크';
          } else if (rawText.includes('신용') || rawText.includes('카드')) {
            suffix = '신용';
          }
        }
        const baseRuleName = `${parsedMerchant} ${suffix}`;
        const ruleName = await getUniqueRuleName(adminDb, baseRuleName);
        
        const insertRes = await adminDb.run(
          "INSERT INTO rules (name, pattern, category, pay_method, merchant_template, type) VALUES (?, ?, ?, ?, ?, ?)",
          [ruleName, generatedPattern, '_AUTO_MAPPING_', '_AUTO_MAPPING_', '${merchant}', resultType]
        );
        matchedRuleId = insertRes.lastID;
        
        console.log(`[파서][자동규칙생성][${targetUser}] 알림 파싱 실패로 인해 새 규칙을 자동 생성했습니다: "${ruleName}" (ID: ${matchedRuleId})`);
        
        const updatedRules = await adminDb.all('SELECT * FROM rules');
        result = parseNotification(rawText, updatedRules, fallbackKST);
      }
    }
  }

  if (result) {
    parsedStatus = 'SUCCESS';
    matchedRuleId = result.rule_id || matchedRuleId;

    // 패키지별 결제수단 자동 매핑
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

    // 체크카드 -> 은행 변환
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

    // 카테고리 매핑
    let finalCategory = result.category;
    if (!finalCategory || finalCategory === '_AUTO_MAPPING_') {
      const matchedCategory = await findCategoryByMerchant(db, result.merchant);
      finalCategory = matchedCategory;
    }
    if (!finalCategory) {
      if (result.type === 'INCOME') {
        finalCategory = '기타수입';
      } else {
        finalCategory = '기타';
      }
    }

    // 통장이동 자산 이동 감지
    const realNameRow = await db.get("SELECT value FROM settings WHERE key = 'user_real_name'");
    const realName = realNameRow ? realNameRow.value.trim() : '';
    const isBank = finalPayMethod.includes('은행') || finalPayMethod.includes('뱅크') || finalPayMethod.includes('농협') || ['우체국', '새마을금고', '신협', '수협', '계좌이체'].includes(finalPayMethod);
    
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

    // 이중 등록 방지
    // 이중 등록 방지 (체크카드 승인 후 은행 연쇄 출금 중복 감지 포함)
    const duplicateCheck = await db.get(
      "SELECT id, merchant, pay_method, pay_type, raw_text FROM transactions " +
      "WHERE type = ? AND amount = ? " +
      "AND abs(strftime('%s', datetime) - strftime('%s', ?)) <= 60 " +
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

      const isCheck1 = duplicateCheck.pay_type === 'CHECK' || (duplicateCheck.raw_text && duplicateCheck.raw_text.includes('체크')) || (duplicateCheck.pay_method && duplicateCheck.pay_method.includes('체크'));
      const isCheck2 = finalPayType === 'CHECK' || rawText.includes('체크') || finalPayMethod.includes('체크');
      
      const isTransfer1 = duplicateCheck.pay_type === 'TRANSFER' || duplicateCheck.pay_type === 'CASH';
      const isTransfer2 = finalPayType === 'TRANSFER' || finalPayType === 'CASH';

      const cardCompanyRegex = /(카드|삼성|현대|롯데|신한|국민|우리|하나|농협|비씨|실적|승인|체크)/;
      
      let isCheckCardDoubleNotification = false;
      if (isCheck1 && isTransfer2 && cardCompanyRegex.test(currentMerchant)) {
        isCheckCardDoubleNotification = true;
      }
      if (isTransfer1 && isCheck2 && cardCompanyRegex.test(existingMerchant)) {
        isCheckCardDoubleNotification = true;
      }

      if (isSimilarMerchant || isCheckCardDoubleNotification) {
        console.log(`[파서][${targetUser}] 중복 거래 감지 차단: 기존 거래 ID ${duplicateCheck.id} (${existingMerchant}, ${duplicateCheck.pay_method})와 현재 알림 (${currentMerchant}, ${finalPayMethod})의 금액/시간이 일치하고 체크카드-은행 연계 출금으로 감지되어 이중 등록을 방지합니다.`);
        
        parsedStatus = 'IGNORED_DUPLICATE';
        const hasAmount = /(\d+[,.\d]*\s*(?:원|USD|\$)|[₩\\$]\s*\d+[,.\d]*|\b\d{1,3}(,\d{3})+\b)/i.test(rawText);
        if (hasAmount || parsedStatus === 'SUCCESS') {
          await db.run(
            'INSERT INTO notification_logs (sender, raw_text, title, text, parsed_status, matched_rule_id) VALUES (?, ?, ?, ?, ?, ?)',
            [sender, rawText, title, text, parsedStatus, matchedRuleId]
          );
        }
        return { success: true, message: '이중 등록(중복) 거래로 감지되어 등록이 생략되었습니다.', isDuplicate: true };
      }
    }

    // 가계부 내역 저장
    const finalPayType = result.payment_type || 'CREDIT';
    let originalAmount = result.original_amount || null;
    let currency = result.currency || null;
    let exchangeRate = null;

    if (currency === 'USD' && originalAmount) {
      exchangeRate = await getUSDExchangeRate(db);
      result.amount = Math.round(originalAmount * exchangeRate);
    }

    await db.run(
      'INSERT INTO transactions (type, amount, merchant, category, pay_method, pay_type, datetime, memo, raw_text, used_point, original_amount, currency, exchange_rate) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [result.type || 'EXPENSE', result.amount, result.merchant, finalCategory, finalPayMethod, finalPayType, result.datetime, result.memo || '', rawText, result.used_point || 0, originalAmount, currency, exchangeRate]
    );
    console.log(`[파서][${targetUser}] 자동 등록 성공: ${result.merchant} - ${result.amount}원 (${finalCategory}) [결제수단: ${finalPayMethod}, 결제방법: ${finalPayType}, 사용 포인트: ${result.used_point || 0}]${currency === 'USD' ? ` (외화: ${originalAmount} USD, 환율: ${exchangeRate}원)` : ''}`);

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

    const hasAmount = /(\d+[,.\d]*\s*(?:원|USD|\$)|[₩\\$]\s*\d+[,.\d]*|\b\d{1,3}(,\d{3})+\b)/i.test(rawText);
    if (hasAmount || parsedStatus === 'SUCCESS') {
      await db.run(
        'INSERT INTO notification_logs (sender, raw_text, title, text, parsed_status, matched_rule_id) VALUES (?, ?, ?, ?, ?, ?)',
        [sender, rawText, title, text, parsedStatus, matchedRuleId]
      );
    }

    return { 
      success: true, 
      transaction: { 
        ...result, 
        category: finalCategory, 
        pay_method: finalPayMethod 
      } 
    };
  } else {
    console.log(`[파서][${targetUser}] 일치하는 정규식 규칙이 없습니다.`);

    const hasAmount = /(\d+[,.\d]*\s*원|₩\s*\d+[,.\d]*|\\\s*\d+[,.\d]*|\b\d{1,3}(,\d{3})+\b)/.test(rawText);
    if (hasAmount || parsedStatus === 'SUCCESS') {
      await db.run(
        'INSERT INTO notification_logs (sender, raw_text, title, text, parsed_status, matched_rule_id) VALUES (?, ?, ?, ?, ?, ?)',
        [sender, rawText, title, text, parsedStatus, matchedRuleId]
      );
    }
    return { success: false, message: '일치하는 정규식 규칙이 없습니다. 알림 로그에 저장됩니다.' };
  }
}

// 알림 수신 이벤트를 순차적으로 실행하기 위한 가상 큐(Queue)
const notificationQueue = [];
let isQueueProcessing = false;

function enqueueNotification(task) {
  return new Promise((resolve, reject) => {
    notificationQueue.push({ task, resolve, reject });
    processNotificationQueue();
  });
}

async function processNotificationQueue() {
  if (isQueueProcessing || notificationQueue.length === 0) return;
  isQueueProcessing = true;

  const { task, resolve, reject } = notificationQueue.shift();
  try {
    const result = await task();
    resolve(result);
  } catch (err) {
    reject(err);
  } finally {
    isQueueProcessing = false;
    if (typeof setImmediate !== 'undefined') {
      setImmediate(processNotificationQueue);
    } else {
      setTimeout(processNotificationQueue, 0);
    }
  }
}

// WebSocket 알림 이벤트 수신 처리 인터페이스
async function processIncomingNotification(newState, username) {
  const attrs = newState.attributes || {};
  const title = attrs['android.title'] || (attrs.android && attrs.android.title) || attrs.title || '';
  const text = attrs['android.text'] || (attrs.android && attrs.android.text) || attrs.text || newState.state || '';
  const packageVal = attrs.package || (attrs.android && attrs.android.package) || '';

  try {
    await enqueueNotification(() => processNotificationCore({
      title,
      text,
      packageVal,
      username
    }));
  } catch (err) {
    console.error(`[웹훅][WebSocket] 알림 처리 중 예외 발생:`, err);
  }
}

// HTTP Webhook 수신 엔드포인트 API 라우트
router.post('/webhook', express.json({ limit: '10kb' }), async (req, res) => {
  const { title, text, package: reqPackage, packageName, package_name, username } = req.body;
  const packageVal = reqPackage || packageName || package_name || '';
  const targetUser = username || 'admin';

  const config = req.app.locals.config;
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
    const resObj = await enqueueNotification(() => processNotificationCore({
      title,
      text,
      packageVal,
      username: targetUser
    }));

    if (resObj.success) {
      if (resObj.isPassed) {
        return res.json({ success: true, message: '자동 패스 규칙에 의해 처리가 제외되었습니다.' });
      }
      if (resObj.isDuplicate) {
        return res.json({ success: true, message: '이중 등록(중복) 거래로 감지되어 등록이 생략되었습니다.' });
      }
      return res.json({ success: true, transaction: resObj.transaction });
    } else {
      return res.json({ success: false, message: resObj.message });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = {
  router,
  processIncomingNotification
};
