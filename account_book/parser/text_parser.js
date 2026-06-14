const { supportsDFlag, escapeRegexChars, cleanMerchantName, sanitizePattern } = require('./utils');
const { parseFlexibleDatetime } = require('./datetime_parser');
const { addKoreanBrandName } = require('./brand_mapper');
const { parsePaymentType, resolveCheckCardToBank } = require('./payment_resolver');
const { determineTransactionType } = require('./transaction_classifier');
const { generatePatternFromText } = require('./pattern_generator');

function parseNotification(text, rules, fallbackDatetime = null) {
  if (!text) return null;

  const normalizedText = text.replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '').replace(/\r\n/g, '\n');

  for (const rule of rules) {
    try {
      const flags = supportsDFlag ? 'ds' : 's';
      const regex = new RegExp(sanitizePattern(rule.pattern), flags);
      const match = regex.exec(normalizedText);

      if (match) {
        const groups = match.groups || {};
        
        let amount = null;
        if (groups.amount) {
          const cleanAmount = groups.amount.replace(/,/g, '').match(/\d+/);
          if (cleanAmount) {
            amount = parseInt(cleanAmount[0], 10);
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

        // 하위 호환성 보정: 만약 payMethod에 결제방식 관련 단어가 잘못 캡처된 경우 보정
        if (/^(신용|체크|이체|송금|현금)$/.test(payMethod)) {
          if (!paymentType || paymentType === 'UNKNOWN') {
            paymentType = payMethod;
          }
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
          if (paymentType === 'BANK_TRANSFER') {
            paymentType = 'TRANSFER';
          }
        }
        if (!paymentType || paymentType === 'UNKNOWN') {
          paymentType = 'CREDIT'; // 기본값
        }

        let category = rule.category || '기타';

        let usedPoint = 0;
        if (groups.used_point) {
          const cleanPoint = groups.used_point.replace(/,/g, '');
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

        const memo = customMemo + memoParts.join(' | ');

        return {
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
          memo
        };
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
