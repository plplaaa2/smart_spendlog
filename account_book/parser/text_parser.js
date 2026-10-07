const { supportsDFlag, escapeRegexChars, cleanMerchantName, sanitizePattern } = require('./utils');
const { parseFlexibleDatetime } = require('./datetime_parser');
const { addKoreanBrandName } = require('./brand_mapper');
const { parsePaymentType, resolveCheckCardToBank, resolvePaymentType } = require('./payment_resolver');
const { determineTransactionType } = require('./transaction_classifier');
const { generatePatternFromText } = require('./pattern_generator');
const { validateParsingResult } = require('./result_validator');

// Suppress repeated syntax warnings per rule and pattern, without hiding later corrected versions.
// Related: database/backup.js, parser/utils.js, routes/rules.js.
const invalidPatternWarnings = new Set();
function parseNotification(text, rules, fallbackDatetime = null) {
  if (!text) return null;

  const normalizedText = text.replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '').replace(/\r\n/g, '\n');

  for (const rule of rules) {
    if (rule.enabled === 0 || rule.enabled === false || rule.enabled === '0') continue;
    let regex;
    try {
      if (typeof rule.pattern !== 'string' || !rule.pattern.trim()) throw new Error('empty pattern');
      const flags = supportsDFlag ? 'ds' : 's';
      regex = new RegExp(sanitizePattern(rule.pattern), flags);
    } catch (_) {
      const warningKey = `${rule.id}:${rule.pattern}`;
      if (!invalidPatternWarnings.has(warningKey)) {
        if (invalidPatternWarnings.size >= 100) invalidPatternWarnings.clear();
        invalidPatternWarnings.add(warningKey);
        console.warn(`[WARN] 정규식 오류로 규칙 ID ${rule.id}를 건너뜁니다.`);
      }
      continue;
    }
    try {
      const match = regex.exec(normalizedText);

      if (match) {
        const groups = match.groups || {};
        
        let amount = null;
        let original_amount = null;
        let currency = null;

        if (groups.amount) {
          const hasDollarSign = /\$|USD/i.test(groups.amount) || /\$|USD/i.test(normalizedText);
          if (hasDollarSign) {
            const cleanAmount = groups.amount.replace(/,/g, '').match(/\d+(?:\.\d+)?/);
            if (cleanAmount) {
              original_amount = parseFloat(cleanAmount[0]);
              currency = 'USD';
              amount = Math.round(original_amount * 1350); // 임시 환율 적용
            }
          } else {
            const cleanAmount = groups.amount.replace(/,/g, '').match(/\d+/);
            if (cleanAmount) {
              amount = parseInt(cleanAmount[0], 10);
            }
          }
        }

        if (amount === null || isNaN(amount)) {
          continue;
        }

        let amountStart = -1;
        let amountEnd = -1;

        if (supportsDFlag && match.indices && match.indices.groups && match.indices.groups.amount) {
          [amountStart, amountEnd] = match.indices.groups.amount;
        } else if (groups.amount) {
          const amountIdxInMatch = match[0].indexOf(groups.amount);
          if (amountIdxInMatch !== -1) {
            amountStart = match.index + amountIdxInMatch;
            amountEnd = amountStart + groups.amount.length;
          }
        }

        if (amountStart !== -1 && amountEnd !== -1) {
          const dateTimeRegexes = [
            /\b\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2}\b/g,
            /\b\d{1,2}[.\-/]\d{1,2}\b/g,
            /\b\d{1,2}월\s*\d{1,2}일\b/g,
            /\b\d{2}:\d{2}(?::\d{2})?\b/g
          ];
          
          let isDateTime = false;
          for (const dtRegex of dateTimeRegexes) {
            let dtMatch;
            while ((dtMatch = dtRegex.exec(normalizedText)) !== null) {
              const dtStart = dtMatch.index;
              const dtEnd = dtMatch.index + dtMatch[0].length;
              
              if (amountStart >= dtStart && amountEnd <= dtEnd) {
                isDateTime = true;
                break;
              }
            }
            if (isDateTime) break;
          }
          
          if (isDateTime) {
            console.log(`[파서] 금액(${amount})이 날짜/시간 영역(${normalizedText.substring(amountStart, amountEnd)})에 속하므로 이중등록 및 오인매핑 방지를 위해 규칙 "${rule.name}" 매칭을 거부합니다.`);
            continue;
          }
        }

        let merchant = groups.merchant || groups.usage || '알수없음';
        merchant = cleanMerchantName(merchant);
        merchant = addKoreanBrandName(merchant);

        const now = new Date();
        const currentYear = now.getFullYear();
        const timeStr = groups.time || groups.datetime || groups.date;
        let datetimeStr = parseFlexibleDatetime(timeStr, currentYear);

        if (!datetimeStr) {
          if (fallbackDatetime) {
            datetimeStr = fallbackDatetime;
          } else {
            const pad = (n) => String(n).padStart(2, '0');
            datetimeStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
          }
        }

        let payMethod = groups.payMethod || groups.pay_method || rule.pay_method || '카드';
        payMethod = payMethod.trim();

        // 결제 방식 결정 (정규식 그룹 매칭이 우선, 다음으로 규칙에 지정된 pay_type, 없거나 UNKNOWN 이면 텍스트로부터 판별)
        let paymentType = groups.payType || groups.pay_type || rule.pay_type;

        // A captured card type is stronger evidence than an installment detail or rule default.
        // Related: pattern_generator.js, payment_resolver.js, database/check_notification.js.
        if (/^(신용|체크|이체|송금|현금)$/.test(payMethod)) {
          paymentType = payMethod;
          payMethod = rule.pay_method || '카드';
        }

        if (paymentType) {
          const cleanPt = paymentType.trim();
          if (/체크/.test(cleanPt)) paymentType = 'CHECK';
          else if (/이체|송금/.test(cleanPt)) paymentType = 'TRANSFER';
          else if (/현금/.test(cleanPt)) paymentType = 'CASH';
          else if (/신용|일시불|할부/.test(cleanPt)) paymentType = 'CREDIT';
        }
        if (!paymentType || paymentType === 'UNKNOWN') {
          paymentType = parsePaymentType(normalizedText, payMethod);
          // Bank deposit/withdrawal signals identify transfers without assuming a card type.
          // Related: payment_resolver.js, test/payment_required.test.js.
          if (paymentType === 'UNKNOWN' && !/카드/.test(payMethod) && /은행|뱅크|농협|우체국|새마을|신협|수협/.test(payMethod) && /입금|출금/.test(normalizedText)) paymentType = 'TRANSFER';
          if (paymentType === 'BANK_TRANSFER') {
            paymentType = 'TRANSFER';
          }
        }
        // Reject unresolved automatic payment types; webhook/retry retain failed logs.
        // Related: routes/webhook.js, routes/rules.js, parser/payment_resolver.js.

        let category = rule.category || '기타';

        // Support both generated camelCase groups and legacy snake_case rule groups.
        // Related files: parser/utils.js, parser/pattern_generator.js, parser/ai_parser.js.
        let usedPoint = 0;
        const capturedUsedPoint = groups.usedPoint || groups.used_point;
        if (capturedUsedPoint) {
          const cleanPoint = capturedUsedPoint.replace(/,/g, '');
          usedPoint = parseInt(cleanPoint, 10) || 0;
        } else {
          const pointMatch = normalizedText.match(/(?:포인트|점수|P|마일리지|하트)\s*(\d{1,3}(?:,\d{3})*)\s*(?:원|점|P)?/i);
          if (pointMatch) {
            const cleanPoint = pointMatch[1].replace(/,/g, '');
            usedPoint = parseInt(cleanPoint, 10) || 0;
          }
        }

        let memoParts = [];
        if (groups.account) memoParts.push(`계좌: ${groups.account.trim()}`);
        if (groups.balance) memoParts.push(`잔액: ${groups.balance.trim()}`);
        if (groups.cumulative) memoParts.push(`누적: ${groups.cumulative.trim()}`);

        const { transactionType, customMemo } = determineTransactionType(normalizedText, groups, rule.type);
        // Validate after direction and merchant extraction so ATM evidence can resolve cash.
        // Related: payment_resolver.resolvePaymentType, Android NotificationPolicy.java.
        paymentType = resolvePaymentType(normalizedText, payMethod, merchant, transactionType, paymentType);
        if (!['CREDIT', 'CHECK', 'TRANSFER', 'CASH'].includes(paymentType)) continue;

        const memo = customMemo + memoParts.join(' | ');

        const parsedResult = {
          amount,
          merchant,
          datetime: datetimeStr,
          pay_method: payMethod,
          payment_type: paymentType,
          category,
          type: transactionType,
          rule_id: rule.id,
          rule_name: rule.name,
          used_point: usedPoint,
          memo,
          original_amount,
          currency
        };
        const validation = validateParsingResult(parsedResult);
        if (!validation.valid) {
          console.warn(`[파서] 규칙 "${rule.name}" 결과 검증 실패: ${validation.errors.join(', ')}`);
          continue;
        }
        return validation.value;
      }
    } catch (err) {
      console.error(`규칙 "${rule.name}" 분석 중 에러:`, err);
    }
  }

  return null;
}

module.exports = {
  parseNotification,
  generatePatternFromText,
  escapeRegexChars,
  addKoreanBrandName,
  cleanMerchantName,
  parseFlexibleDatetime,
  parsePaymentType,
  resolveCheckCardToBank,
  determineTransactionType
};
