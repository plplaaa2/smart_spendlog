const { franchisePresets } = require('./constants');
const { escapeRegexChars } = require('./utils');

function generatePatternFromText(text) {
  if (!text) return null;

  let cleanText = text.replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '').replace(/\[Web발신\]\s*/i, '');
  const blocks = [];

  const isOverlapping = (start, end) => {
    return blocks.some(b => Math.max(start, b.start) < Math.min(end, b.end));
  };

  const cardMatch = cleanText.match(/\[(.*?)\]/) || cleanText.match(/(NH농협|신한카드|삼성카드|현대카드|롯데카드|우리카드|하나카드|국민카드|농협카드|비씨카드|BC카드|카카오뱅크|토스뱅크|케이뱅크|신한은행|국민은행|우리은행|하나은행|농협은행|기업은행|IBK|우체국|새마을금고|새마을|신협|수협은행|수협|씨티은행|씨티|SC제일은행|SC제일|산업은행|저축은행|광주은행|제주은행|전북은행|대구은행|부산은행|경남은행|증권|카카오페이|네이버페이)/);
  if (cardMatch) {
    const value = cardMatch[1] || cardMatch[0];
    const isBracket = cardMatch[0].startsWith('[');
    const isDepositOrWithdraw = isBracket && ((value.length <= 5 && /출금|입금/.test(value)) || /\d/.test(value));
    
    if (!isDepositOrWithdraw) {
      const start = cardMatch.index;
      const end = cardMatch.index + cardMatch[0].length;
      if (!isOverlapping(start, end)) {
        blocks.push({
          type: '카드명/은행명',
          start,
          end,
          regex: isBracket ? `\\[${escapeRegexChars(cardMatch[1])}\\]` : escapeRegexChars(cardMatch[0]),
          value: value
        });
      }
    }
  }

  const timeMatch = cleanText.match(/\d{4}[/\-.]\d{1,2}[/\-.]\d{1,2}\s+\d{2}:\d{2}(?::\d{2})?/) || 
                    cleanText.match(/\d{2}[/\-.]\d{1,2}[/\-.]\d{1,2}\s+\d{2}:\d{2}(?::\d{2})?/) || 
                    cleanText.match(/\d{1,2}월\s*\d{1,2}일\s*\d{2}:\d{2}(?::\d{2})?/) || 
                    cleanText.match(/\d{2}[/\-.]\d{2}\s+\d{2}:\d{2}(?::\d{2})?/) || 
                    cleanText.match(/\d{2}:\d{2}(?::\d{2})?/);
  if (timeMatch) {
    let regex = '(?<time>\\d{2}:\\d{2}(?::\\d{2})?)';
    const rawTime = timeMatch[0];
    const start = timeMatch.index;
    const end = timeMatch.index + rawTime.length;
    
    if (!isOverlapping(start, end)) {
      if (rawTime.includes('월') && rawTime.includes('일')) {
        regex = '(?<time>\\d{1,2}월\\s*\\d{1,2}일\\s*\\d{2}:\\d{2}(?::\\d{2})?)';
      } else if (rawTime.includes(':') && (rawTime.includes('/') || rawTime.includes('-') || rawTime.includes('.'))) {
        const sep = rawTime.match(/[/\-.]/)[0];
        const partCount = (rawTime.split(sep).length - 1);
        if (partCount === 2) {
          const yearLen = rawTime.split(sep)[0].length;
          regex = `(?<time>\\d{${yearLen}}${escapeRegexChars(sep)}\\d{1,2}${escapeRegexChars(sep)}\\d{1,2}\\s+\\d{2}:\\d{2}(?::\\d{2})?)`;
        } else {
          regex = `(?<time>\\d{2}${escapeRegexChars(sep)}\\d{2}\\s+\\d{2}:\\d{2}(?::\\d{2})?)`;
        }
      }
      blocks.push({
        type: '시간',
        start,
        end,
        regex,
        value: rawTime
      });
    }
  } else {
    const dateMatch = cleanText.match(/\d{2}[/\-.]\d{2}/) || cleanText.match(/\d{1,2}월\s*\d{1,2}일/);
    if (dateMatch) {
      const rawDate = dateMatch[0];
      const start = dateMatch.index;
      const end = dateMatch.index + rawDate.length;
      
      if (!isOverlapping(start, end)) {
        let regex = `(?<time>\\d{2}[/\\-.]\\d{2})`;
        if (rawDate.includes('월')) {
          regex = '(?<time>\\d{1,2}월\\s*\\d{1,2}일)';
        } else {
          const sep = rawDate.match(/[/\-.]/)[0];
          regex = `(?<time>\\d{2}${escapeRegexChars(sep)}\\d{2})`;
        }
        blocks.push({
          type: '날짜',
          start,
          end,
          regex,
          value: rawDate
        });
      }
    }
  }

  const amountWithWonRegex = /([\d,]+)\s*원/g;
  let m;
  let amountDetected = false;
  while ((m = amountWithWonRegex.exec(cleanText)) !== null) {
    const idx = m.index;
    const len = m[0].length;
    if (!isOverlapping(idx, idx + len)) {
      let regexStr = '(?<amount>[\\d,]+)원';
      blocks.push({
        type: '금액',
        start: idx,
        end: idx + len,
        regex: regexStr,
        value: m[0]
      });
      amountDetected = true;
      break;
    }
  }

  if (!amountDetected) {
    const nakedAmountRegex = /(?<!\d|\*|-)([1-9]\d{0,2}(?:,\d{3})+|[1-9]\d{3,8})(?!\d|\*|-)/g;
    let nm;
    while ((nm = nakedAmountRegex.exec(cleanText)) !== null) {
      const idx = nm.index;
      const len = nm[0].length;
      if (!isOverlapping(idx, idx + len)) {
        const prefix = cleanText.substring(Math.max(0, idx - 10), idx);
        if (!/잔액|잔고/.test(prefix)) {
          blocks.push({
            type: '금액',
            start: idx,
            end: idx + len,
            regex: '(?<amount>[\\d,]+)',
            value: nm[0]
          });
          amountDetected = true;
          break;
        }
      }
    }
  }

  const balanceMatch = cleanText.match(/(?:잔액|잔고)\s*:?\s*([\d,]+)\s*원?/);
  if (balanceMatch) {
    const start = balanceMatch.index;
    const end = balanceMatch.index + balanceMatch[0].length;
    if (!isOverlapping(start, end)) {
      const regex = balanceMatch[0].includes('원') 
                    ? '(?:잔액|잔고)\\s*:?\\s*(?<balance>[\\d,]+)원' 
                    : '(?:잔액|잔고)\\s*:?\\s*(?<balance>[\\d,]+)';
      blocks.push({
        type: '잔액',
        start,
        end,
        regex,
        value: balanceMatch[0]
      });
    }
  }

  const cumulativeMatch = cleanText.match(/누적(?:.*?금액)?\s*:?\s*([\d,]+)\s*원?/);
  if (cumulativeMatch) {
    const start = cumulativeMatch.index;
    const end = cumulativeMatch.index + cumulativeMatch[0].length;
    if (!isOverlapping(start, end)) {
      const regex = cumulativeMatch[0].includes('원') 
                    ? '누적(?:.*?금액)?\\s*:?\\s*(?<cumulative>[\\d,]+)원' 
                    : '누적(?:.*?금액)?\\s*:?\\s*(?<cumulative>[\\d,]+)';
      blocks.push({
        type: '누적금액',
        start,
        end,
        regex,
        value: cumulativeMatch[0]
      });
    }
  }

  const pointRegex = /(?:포인트|점수|P|마일리지|하트)\s*([\d,]+)\s*(?:원|점|P)?/g;
  let pm;
  while ((pm = pointRegex.exec(cleanText)) !== null) {
    const idx = pm.index;
    const len = pm[0].length;
    if (!isOverlapping(idx, idx + len)) {
      blocks.push({
        type: '포인트차감',
        start: idx,
        end: idx + len,
        regex: '(?:포인트|P)\\s*(?<usedPoint>[\\d,]+)\\s*(?:원|점|P)?',
        value: pm[0]
      });
      break;
    }
  }

  const statusRegex = /(승인|사용|취소|출금|입금|결제)/g;
  let sm;
  while ((sm = statusRegex.exec(cleanText)) !== null) {
    const idx = sm.index;
    const len = sm[0].length;
    if (!isOverlapping(idx, idx + len)) {
      blocks.push({
        type: '상태',
        start: idx,
        end: idx + len,
        regex: escapeRegexChars(sm[0]),
        value: sm[0]
      });
    }
  }

  const payMethodMatch = cleanText.match(/(?:신용|체크)(?:\(일시불,[\d*]+\))?/) || cleanText.match(/(?:신용|체크|일시불|\d+개월\s*할부)/);
  if (payMethodMatch) {
    const idx = payMethodMatch.index;
    const len = payMethodMatch[0].length;
    if (!isOverlapping(idx, idx + len)) {
      blocks.push({
        type: '결제방식',
        start: idx,
        end: idx + len,
        regex: '(?<payMethod>[^\\s/]+)',
        value: payMethodMatch[0]
      });
    }
  }

  const accountRegexes = [
    /\d{3,}\*+[-\d*]*/g,
    /[-\d*]*\*+[-\d*]*/g,
    /\d{3,}[-\d*]{2,}/g,
    /[\d*-]{5,}/g
  ];

  for (const acRegex of accountRegexes) {
    let am;
    while ((am = acRegex.exec(cleanText)) !== null) {
      const val = am[0];
      if (val.includes('/') || val.includes(':') || val.includes('원')) continue;
      if (!/[\d-]/.test(val)) continue;
      
      const start = am.index;
      const end = am.index + val.length;
      if (!isOverlapping(start, end)) {
        blocks.push({
          type: '계좌번호',
          start,
          end,
          regex: '(?<account>[\\d*-]+)',
          value: val
        });
      }
    }
  }

  const nameMatch = cleanText.match(/[가-힣]\*[가-힣](?:님|대님)?/);
  if (nameMatch) {
    const start = nameMatch.index;
    const end = nameMatch.index + nameMatch[0].length;
    if (!isOverlapping(start, end)) {
      blocks.push({
        type: '고객명',
        start,
        end,
        regex: '[가-힣]\\*[가-힣](?:님|대님)?',
        value: nameMatch[0]
      });
    }
  }

  blocks.sort((a, b) => a.start - b.start);

  const gaps = [];
  if (blocks.length === 0) {
    return '\\s*(?<merchant>.+?)(?:\\s+[\\d,]+)?\\s*';
  }

  gaps.push({ start: 0, end: blocks[0].start, index: 0 });
  for (let i = 1; i < blocks.length; i++) {
    gaps.push({ start: blocks[i-1].end, end: blocks[i].start, index: i });
  }
  gaps.push({ start: blocks[blocks.length-1].end, end: cleanText.length, index: blocks.length });

  let bestGapIndex = -1;
  let maxScore = -Infinity;
  let maxCleanLen = -1;

  gaps.forEach(g => {
    const txt = cleanText.substring(g.start, g.end);
    const cleanTxt = txt.replace(/\[?(입금|출금|잔액|잔고|누적|결제)\]?/g, '').trim();
    
    const cleanLetters = cleanTxt.replace(/[^가-힣a-zA-Z]/g, '');
    const len = cleanLetters.length;
    if (len === 0) return;

    if (len > maxCleanLen) {
      maxCleanLen = len;
    }

    // 1. 글자 수 기반 기본 점수 (일반적인 가맹점명은 2~12자 내외)
    let score = 0;
    if (len >= 2 && len <= 8) {
      score += 15;
    } else if (len > 8 && len <= 12) {
      score += 10;
    } else if (len === 1) {
      score += 2;
    } else {
      // 13자 이상의 긴 문장 형태는 가맹점명이 아닐 확률이 높으므로 페널티 적용
      score -= (len - 12) * 1.5;
    }

    // 2. 금액(금액 블록) 및 거래상태(상태 블록)와의 인접도 가중치
    let minAmtDist = Infinity;
    let minStatusDist = Infinity;

    blocks.forEach(b => {
      if (b.type === '금액') {
        const dist = Math.min(Math.abs(g.start - b.end), Math.abs(b.start - g.end));
        if (dist < minAmtDist) minAmtDist = dist;
      }
      if (b.type === '상태') {
        const dist = Math.min(Math.abs(g.start - b.end), Math.abs(b.start - g.end));
        if (dist < minStatusDist) minStatusDist = dist;
      }
    });

    if (minAmtDist <= 3) {
      score += 10;
    } else if (minAmtDist <= 10) {
      score += 5;
    }

    if (minStatusDist <= 3) {
      score += 8;
    } else if (minStatusDist <= 10) {
      score += 4;
    }

    // 3. 안내/안전 메시지 키워드 페널티
    const systemKeywords = [
      /타행이체/i, /즉시이체/i, /계좌이체/i, /모바일/i, /뱅킹/i,
      /인터넷/i, /수수료/i, /이자/i, /안내/i, /공지/i, /고객/i,
      /인증/i, /보안/i, /점검/i, /대기/i, /완료/i, /감사/i, /이용/i,
      /확인/i, /등록/i, /성공/i, /실패/i, /[가-힣]{2,4}\s*님/
    ];
    let hasSystemKeyword = false;
    systemKeywords.forEach(kw => {
      if (kw.test(txt)) {
        hasSystemKeyword = true;
      }
    });
    if (hasSystemKeyword) {
      score -= 30;
    }

    // 4. 프랜차이즈 프리셋 가중치
    let matchesFranchise = false;
    for (const preset of franchisePresets) {
      if (preset.keyword && preset.keyword.length >= 2 && txt.includes(preset.keyword)) {
        matchesFranchise = true;
        break;
      }
    }
    if (matchesFranchise) {
      score += 20;
    }

    if (score > maxScore) {
      maxScore = score;
      bestGapIndex = g.index;
    }
  });

  let finalRegex = '^';
  if (text.includes('[Web발신]')) {
    finalRegex += '(?:(?:\\[Web발신\\])?\\s*)?';
  }

  let lastIndex = 0;
  const usedTypes = new Set();

  function formatGapToRegex(gapText) {
    if (!gapText) return '';
    let result = '';
    let i = 0;
    while (i < gapText.length) {
      const char = gapText[i];
      if (/\s/.test(char)) {
        result += '\\s*';
        while (i < gapText.length && /\s/.test(gapText[i])) {
          i++;
        }
      } else {
        result += escapeRegexChars(char);
        i++;
      }
    }
    return result;
  }

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const prefixGap = cleanText.substring(lastIndex, b.start);
    
    if (i === bestGapIndex && maxCleanLen > 0) {
      // [사용처 구분자 분리] 가맹점 영역 뒤에 슬래시(/)가 존재할 경우 강제 분리 처리 (연결 파일: public/rules.js, assets/rules.js, NotificationParser.kt)
      const slashMatch = prefixGap.match(/^(.*?)\s*\/\s*$/);
      if (slashMatch) {
        const merchantPart = slashMatch[1];
        const hasNums = /\d/.test(merchantPart);
        finalRegex += hasNums 
          ? '\\s*(?<merchant>.+?)(?:\\s+[\\d,]+)?\\s*\\/\\s*' 
          : '\\s*(?<merchant>.+?)\\s*\\/\\s*';
      } else {
        const hasNums = /\d/.test(prefixGap);
        finalRegex += hasNums ? '\\s*(?<merchant>.+?)(?:\\s+[\\d,]+)?\\s*' : '\\s*(?<merchant>.+?)\\s*';
      }
    } else {
      finalRegex += formatGapToRegex(prefixGap);
    }
    
    let blockRegex = b.regex;
    if (usedTypes.has(b.type)) {
      blockRegex = blockRegex.replace(/\(\?<[a-zA-Z0-9_]+>/g, '(?:');
    } else {
      usedTypes.add(b.type);
    }
    
    finalRegex += blockRegex;
    lastIndex = b.end;
  }

  const suffixGap = cleanText.substring(lastIndex);
  if (blocks.length === bestGapIndex && maxCleanLen > 0) {
    const slashMatch = suffixGap.match(/^\s*\/\s*(.+)/);
    const hasNums = /\d/.test(suffixGap);
    if (slashMatch) {
      finalRegex += hasNums ? '\\s*\\/\\s*(?<merchant>.+?)(?:\\s+[\\d,]+)?$' : '\\s*\\/\\s*(?<merchant>.+)$';
    } else {
      finalRegex += hasNums ? '\\s*(?<merchant>.+?)(?:\\s+[\\d,]+)?$' : '\\s*(?<merchant>.+)$';
    }
  } else {
    finalRegex += formatGapToRegex(suffixGap) + '$';
  }

  return finalRegex;
}

module.exports = {
  generatePatternFromText
};
