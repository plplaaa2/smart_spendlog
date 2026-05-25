/**
 * @file routes/webhook.js
 * @summary HA 알림 이벤트 수집 및 HTTP Webhook 처리 API 라우터
 * @description 웹훅 수신 및 WebSocket 센서 상태 변경 시 알림 문자열을 파싱하여 가계부 자동 매핑/저장 및 센서 동기화를 처리하는 핵심 엔진입니다.
 * @dependencies
 *   - database.js: getDB, findCategoryByMerchant, updateHASensors
 *   - parser.js: parseNotification
 */

const express = require('express');
const router = express.Router();
const { getDB, findCategoryByMerchant, updateHASensors } = require('../database');
const { parseNotification, generatePatternFromText } = require('../parser');

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
  const rules = await adminDb.all('SELECT * FROM rules');
  const fallbackKST = getKSTDateString();
  let result = parseNotification(rawText, rules, fallbackKST);

  let parsedStatus = 'FAILED';
  let matchedRuleId = null;

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

    // 사용처 카테고리 자동 매핑
    // 요약: 정규식 규칙에 카테고리를 고정하지 않고, 파싱된 사용처명을 기준으로 사용처 매핑 테이블을 조회해 동적으로 할당(없으면 '기타')합니다.
    // 의존성: database.js의 findCategoryByMerchant 헬퍼 함수를 호출합니다.
    const matchedCategory = await findCategoryByMerchant(db, result.merchant);
    let finalCategory = matchedCategory || '기타';

    // 패키지별 결제수단 자동 매핑
    let finalPayMethod = result.pay_method;
    if (finalPayMethod === '_AUTO_MAPPING_') {
      if (packageVal) {
        const mappedPayMethodRow = await db.get('SELECT pay_method FROM package_pay_methods WHERE package = ?', [packageVal]);
        if (mappedPayMethodRow && mappedPayMethodRow.pay_method) {
          finalPayMethod = mappedPayMethodRow.pay_method;
        } else {
          finalPayMethod = '카드';
        }
      } else {
        finalPayMethod = '카드';
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
    
    const isTransferMerchant = (realName && result.merchant === realName) || 
                               ['입금', '이체', '송금', '출금', '대체'].includes(result.merchant) ||
                               isKoreanName(result.merchant);

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

      if (isSimilarMerchant && duplicateCheck.pay_method !== finalPayMethod) {
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

// HTTP Webhook 수신 엔드포인트
router.post('/webhook', async (req, res) => {
  const { title, text, package, username } = req.body;
  const targetUser = username || 'admin';

  console.log(`[웹훅][${targetUser}] 알림 수신: title="${title}", text="${text}", package="${package}"`);

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

    const finalSender = package || title || 'Unknown';
    const titleText = title || '';
    const bodyText = text || '';

    const adminDb = await getDB('admin');
    const rules = await adminDb.all('SELECT * FROM rules');
    const fallbackKST = getKSTDateString();
    let result = parseNotification(finalRawText, rules, fallbackKST);

    let parsedStatus = 'FAILED';
    let matchedRuleId = null;

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

      // 사용처 카테고리 자동 매핑
      // 요약: 정규식 규칙에 카테고리를 고정하지 않고, 파싱된 사용처명을 기준으로 사용처 매핑 테이블을 조회해 동적으로 할당(없으면 '기타')합니다.
      const matchedCategory = await findCategoryByMerchant(db, result.merchant);
      let finalCategory = matchedCategory || '기타';

      // 패키지별 결제수단 자동 매핑
      let finalPayMethod = result.pay_method;
      if (finalPayMethod === '_AUTO_MAPPING_') {
        if (package) {
          const mappedPayMethodRow = await db.get('SELECT pay_method FROM package_pay_methods WHERE package = ?', [package]);
          if (mappedPayMethodRow && mappedPayMethodRow.pay_method) {
            finalPayMethod = mappedPayMethodRow.pay_method;
          } else {
            finalPayMethod = '카드';
          }
        } else {
          finalPayMethod = '카드';
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
      
      const isTransferMerchant = (realName && result.merchant === realName) || 
                                 ['입금', '이체', '송금', '출금', '대체'].includes(result.merchant) ||
                                 isKoreanName(result.merchant);

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

        if (isSimilarMerchant && duplicateCheck.pay_method !== finalPayMethod) {
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
