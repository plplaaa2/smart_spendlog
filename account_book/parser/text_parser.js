function parseNotification(text, rules, fallbackDatetime = null) {
  if (!text) return null;

  const normalizedText = text.replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '').replace(/\r\n/g, '\n');

  for (const rule of rules) {
    try {
      const regex = new RegExp(rule.pattern, 'ds');
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

        if (match.indices && match.indices.groups && match.indices.groups.amount) {
          const [amountStart, amountEnd] = match.indices.groups.amount;
          
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

        let payMethod = groups.pay_method || rule.pay_method || '카드';
        payMethod = payMethod.trim();

        const paymentType = parsePaymentType(normalizedText, payMethod);
        if (paymentType === 'CHECK') {
          payMethod = resolveCheckCardToBank(normalizedText, payMethod);
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

        const isDeposit = /입금|환불|입금완료|수입|저축/.test(normalizedText);
        const isWithdrawal = /출금|송금|지출|결제|승인|사용|신용|체크/.test(normalizedText);
        const isCancel = /취소|반품/.test(normalizedText);

        let preemptiveType = null;
        if (isCancel) {
          if (/입금취소|입금\s*취소|수입취소/.test(normalizedText)) {
            preemptiveType = 'EXPENSE';
          } else {
            preemptiveType = 'INCOME';
          }
        } else if (isDeposit && !isWithdrawal) {
          preemptiveType = 'INCOME';
        } else if (isWithdrawal && !isDeposit) {
          preemptiveType = 'EXPENSE';
        }

        let transactionType = preemptiveType || rule.type || 'EXPENSE';
        let customMemo = '';
        
        if (preemptiveType) {
          if (isCancel) {
            if (/입금취소|입금\s*취소|수입취소/.test(normalizedText)) {
              customMemo = '[입금취소] ';
            } else {
              customMemo = '[승인취소] ';
            }
          }
        } else {
          const matchedStatus = groups.status || groups.type_text;
          if (matchedStatus) {
            const cleanStatus = matchedStatus.trim();
            if (/입금|수입|저축|환불|입금완료/.test(cleanStatus)) {
              transactionType = 'INCOME';
            } else if (/출금|송금|지출|결제|승인|사용|신용|체크/.test(cleanStatus)) {
              transactionType = 'EXPENSE';
            }
            
            if (/취소|반품/.test(cleanStatus)) {
              if (/입금취소|입금\s*취소|수입취소/.test(normalizedText)) {
                transactionType = 'EXPENSE';
                customMemo = '[입금취소] ';
              } else {
                transactionType = 'INCOME';
                customMemo = '[승인취소] ';
              }
            }
          } else {
            const isDep = /입금|환불|입금완료|수입|저축/.test(normalizedText);
            const isWith = /출금|송금|지출|결제|승인|사용|신용|체크/.test(normalizedText);
            
            if (isDep && !isWith) {
              transactionType = 'INCOME';
            } else if (isWith && !isDep) {
              transactionType = 'EXPENSE';
            }
            
            if (/취소|승인취소|반품/.test(normalizedText)) {
              if (/입금취소|입금\s*취소|수입취소/.test(normalizedText)) {
                transactionType = 'EXPENSE';
                customMemo = '[입금취소] ';
              } else {
                transactionType = 'INCOME';
                customMemo = '[승인취소] ';
              }
            }
          }
        }

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

function generatePatternFromText(text) {
  if (!text) return null;

  let cleanText = text.replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '').replace(/\[Web발신\]\s*/i, '');
  const blocks = [];

  const isOverlapping = (start, end) => {
    return blocks.some(b => Math.max(start, b.start) < Math.min(end, b.end));
  };

  const cardMatch = cleanText.match(/\[(.*?)\]/) || cleanText.match(/(NH농협|국민체크|신한체크|신한카드|삼성카드|현대카드|롯데카드|우리카드|하나카드|카카오뱅크|토스뱅크|신한은행|국민은행|우리은행|하나은행|농협은행|IBK|기업은행|우체국)/);
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

  const amountWithWonRegex = /([\d,]+)\s*원|([₩\\$])\s*([\d,]+)/g;
  let m;
  let amountDetected = false;
  while ((m = amountWithWonRegex.exec(cleanText)) !== null) {
    const idx = m.index;
    const len = m[0].length;
    if (!isOverlapping(idx, idx + len)) {
      let regexStr = '(?<amount>[\\d,]+)원';
      if (m[2]) {
        regexStr = `${escapeRegexChars(m[2])}\\s*(?<amount>[\\d,]+)`;
      }
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
        regex: '(?:포인트|P)\\s*(?<used_point>[\\d,]+)\\s*(?:원|점|P)?',
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
        regex: '(?<pay_method>[^\\s/]+)',
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
  let maxCleanLen = -1;

  gaps.forEach(g => {
    const txt = cleanText.substring(g.start, g.end);
    const cleanTxt = txt.replace(/\[?(입금|출금|잔액|잔고|누적|결제)\]?/g, '').trim();
    
    const cleanLetters = cleanTxt.replace(/[^가-힣a-zA-Z]/g, '');
    if (cleanLetters.length === 0) return;

    if (cleanLetters.length > maxCleanLen) {
      maxCleanLen = cleanLetters.length;
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
      const hasNums = /\d/.test(prefixGap);
      finalRegex += hasNums ? '\\s*(?<merchant>.+?)(?:\\s+[\\d,]+)?\\s*' : '\\s*(?<merchant>.+?)\\s*';
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
      finalRegex += hasNums ? '\\s*\\/\\s*(?<merchant>.+?)(?:\\s+[\\d,]+)?' : '\\s*\\/\\s*(?<merchant>.+?)';
    } else {
      finalRegex += hasNums ? '\\s*(?<merchant>.+?)(?:\\s+[\\d,]+)?' : '\\s*(?<merchant>.+?)';
    }
  } else {
    finalRegex += formatGapToRegex(suffixGap);
  }

  return finalRegex;
}

function escapeRegexChars(str) {
  return str.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
}

function addKoreanBrandName(merchant) {
  if (!merchant) return merchant;

  const brandMap = {
    'VIPS': '빕스',
    'STARBUCKS': '스타벅스',
    'MCDONALD': '맥도날드',
    'BURGER KING': '버거킹',
    'BURGERKING': '버거킹',
    'SUBWAY': '써브웨이',
    'SHAKE SHACK': '쉐이크쑑',
    'FIVE GUYS': '파이브가이즈',
    'PIZZA HUT': '피자헛',
    'DOMINO': '도미노',
    'PAPA JOHN': '파파존스',
    'OUTBACK': '아웃백',
    'DUNKIN': '던킨',
    'SMOOTHIE KING': '스무디킹',
    'BLUE BOTTLE': '블루보틀',
    '7-ELEVEN': '세븐일레븐',
    '7ELEVEN': '세븐일레븐',
    'MINISTOP': '미니스톱',
    'E-MART': '이마트',
    'HOMEPLUS': '홈플러스',
    'COSTCO': '코스트코',
    'TRADERS': '트레이더스',
    'DAISO': '다이소',
    'IKEA': '이케아',
    'COUPANG': '쿠팡',
    'AUCTION': '옥션',
    'AMAZON': '아마존',
    'ALIEXPRESS': '알리익스프레스',
    'TEMU': '테무',
    'SHEIN': '쉬인',
    'UNIQLO': '유니클로',
    'ZARA': '자라',
    '8SECONDS': '에잇세컨즈',
    'NIKE': '나이키',
    'ADIDAS': '아디다스',
    'NEW BALANCE': '뉴발란스',
    'THE NORTH FACE': '노스페이스',
    'POLO': '폴로',
    'MUSINSA': '무신사',
    'UBER': '우버',
    'NETFLIX': '넷플릭스',
    'SPOTIFY': '스포티파이',
    'STEAM': '스팀',
    'PLAYSTATION': '플레이스테이션',
    'UDEMY': '유데미',
    'COURSERA': '코세라'
  };

  let updatedMerchant = merchant;
  
  for (const [eng, kor] of Object.entries(brandMap)) {
    const engRegex = new RegExp(escapeRegexChars(eng), 'i');
    const korRegex = new RegExp(escapeRegexChars(kor));

    if (engRegex.test(updatedMerchant) && !korRegex.test(updatedMerchant)) {
      updatedMerchant = updatedMerchant.replace(engRegex, (match) => `${match}(${kor})`);
      break;
    }
  }

  return updatedMerchant;
}

function cleanMerchantName(merchant) {
  if (!merchant) return '알수없음';
  let cleaned = merchant.split('\n')[0].split('\r')[0].trim();
  
  cleaned = cleaned.replace(/^\((주|합|유|재|사)\)|^\(주식회사\)/g, '');
  cleaned = cleaned.replace(/\((주|합|유|재|사)\)$|\(주식회사\)$/g, '');
  cleaned = cleaned.replace(/^주식회사\s+|\s+주식회사$/g, '');
  
  cleaned = cleaned.replace(/^[\s,.\-_#@*&()\[\]{}]+|[\s,.\-_#@*&()\[\]{}]+$/g, '');
  return cleaned.trim() || '알수없음';
}

function parseFlexibleDatetime(timeStr, currentYear) {
  if (!timeStr) return '';
  
  let cleanStr = timeStr.replace(/\([가-힣a-zA-Z]{1,3}\)/g, '').replace(/\[[가-힣a-zA-Z]{1,3}\]/g, '').trim();
  
  let isPM = false;
  if (/오후|PM/i.test(cleanStr)) {
    isPM = true;
  }
  cleanStr = cleanStr.replace(/오전|오후|AM|PM/ig, '').replace(/\s+/g, ' ').trim();
  
  const stdMatch = cleanStr.match(/(?:(\d{4})[-/.])?(\d{1,2})[-/.](\d{1,2})\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/);
  if (stdMatch) {
    const year = stdMatch[1] ? parseInt(stdMatch[1], 10) : currentYear;
    const month = stdMatch[2].padStart(2, '0');
    const day = stdMatch[3].padStart(2, '0');
    let hour = parseInt(stdMatch[4], 10);
    if (isPM && hour < 12) hour += 12;
    if (!isPM && hour === 12) hour = 0;
    const minute = stdMatch[5].padStart(2, '0');
    const second = stdMatch[6] ? stdMatch[6].padStart(2, '0') : '00';
    return `${year}-${month}-${day} ${String(hour).padStart(2, '0')}:${minute}:${second}`;
  }
  
  const krMatch = cleanStr.match(/(?:(\d{4})년\s*)?(\d{1,2})월\s*(\d{1,2})일\s*(\d{1,2})시\s*(\d{1,2})분(?:\s*(\d{1,2})초)?/);
  if (krMatch) {
    const year = krMatch[1] ? parseInt(krMatch[1], 10) : currentYear;
    const month = krMatch[2].padStart(2, '0');
    const day = krMatch[3].padStart(2, '0');
    let hour = parseInt(krMatch[4], 10);
    if (isPM && hour < 12) hour += 12;
    if (!isPM && hour === 12) hour = 0;
    const minute = krMatch[5].padStart(2, '0');
    const second = krMatch[6] ? krMatch[6].padStart(2, '0') : '00';
    return `${year}-${month}-${day} ${String(hour).padStart(2, '0')}:${minute}:${second}`;
  }

  const digitMatch = cleanStr.match(/^\b(\d{8}|\d{12}|\d{14})\b$/);
  if (digitMatch) {
    const val = digitMatch[1];
    if (val.length === 8) {
      const month = val.slice(0, 2);
      const day = val.slice(2, 4);
      let hour = parseInt(val.slice(4, 6), 10);
      if (isPM && hour < 12) hour += 12;
      const minute = val.slice(6, 8);
      return `${currentYear}-${month}-${day} ${String(hour).padStart(2, '0')}:${minute}:00`;
    } else if (val.length === 12) {
      const year = '20' + val.slice(0, 2);
      const month = val.slice(2, 4);
      const day = val.slice(4, 6);
      let hour = parseInt(val.slice(6, 8), 10);
      if (isPM && hour < 12) hour += 12;
      const minute = val.slice(8, 10);
      const second = val.slice(10, 12);
      return `${year}-${month}-${day} ${String(hour).padStart(2, '0')}:${minute}:${second}`;
    } else if (val.length === 14) {
      const year = val.slice(0, 4);
      const month = val.slice(4, 6);
      const day = val.slice(6, 8);
      let hour = parseInt(val.slice(8, 10), 10);
      if (isPM && hour < 12) hour += 12;
      const minute = val.slice(10, 12);
      const second = val.slice(12, 14);
      return `${year}-${month}-${day} ${String(hour).padStart(2, '0')}:${minute}:${second}`;
    }
  }

  return '';
}

function parsePaymentType(text, payMethod) {
  const normalizedText = text || '';
  const normalizedPayMethod = payMethod || '';

  if (normalizedText.includes('체크') || normalizedPayMethod.includes('체크')) {
    return 'CHECK';
  }
  if (normalizedText.includes('신용') || normalizedPayMethod.includes('신용') || normalizedText.includes('일시불') || /할부/.test(normalizedText)) {
    return 'CREDIT';
  }
  if (/출금|입금|이체|송금/.test(normalizedText) && (normalizedPayMethod.includes('은행') || normalizedPayMethod.includes('뱅크') || ['우체국', '새마을금고', '신협', '수협', '계좌이체'].includes(normalizedPayMethod))) {
    return 'BANK_TRANSFER';
  }
  return 'UNKNOWN';
}

function resolveCheckCardToBank(text, payMethod) {
  const cardToBankMap = {
    'KB국민카드': '국민은행',
    '국민카드': '국민은행',
    'KB국민체크카드': '국민은행',
    '국민체크카드': '국민은행',
    '신한카드': '신한은행',
    '신한체크카드': '신한은행',
    '하나카드': '하나은행',
    '하나체크카드': '하나은행',
    '우리카드': '우리은행',
    '우리체크카드': '우리은행',
    'NH농협카드': '농협은행',
    '농협카드': '농협은행',
    'NH농협체크카드': '농협은행',
    '농협체크카드': '농협은행',
    '토스': '토스뱅크',
    '토스카드': '토스뱅크',
    '토스체크카드': '토스뱅크',
    '카카오': '카카오뱅크',
    '카카오카드': '카카오뱅크',
    '카카오체크카드': '카카오뱅크',
    '케이뱅크카드': '케이뱅크',
    'BC카드': '계좌이체',
    'BC체크카드': '계좌이체',
    '삼성카드': '계좌이체',
    '삼성체크카드': '계좌이체',
    '현대카드': '계좌이체',
    '현대체크카드': '계좌이체',
    '롯데카드': '계좌이체',
    '롯데체크카드': '계좌이체'
  };

  let targetBank = cardToBankMap[payMethod];

  const bankHints = {
    '국민': '국민은행',
    'KB국민': '국민은행',
    '신한': '신한은행',
    '우리': '우리은행',
    '하나': '하나은행',
    '농협': '농협은행',
    'NH': '농협은행',
    '기업': '기업은행',
    'IBK': '기업은행',
    '우체국': '우체국',
    '새마을': '새마을금고',
    '신협': '신협',
    '수협': '수협은행',
    '대구': '대구은행',
    '부산': '부산은행',
    '광주': '광주은행',
    '전북': '전북은행',
    '경남': '경남은행',
    '제주': '제주은행',
    '카카오': '카카오뱅크',
    '토스': '토스뱅크',
    '케이': '케이뱅크',
    'K뱅크': '케이뱅크'
  };

  for (const [hint, bankName] of Object.entries(bankHints)) {
    if (text.includes(hint)) {
      targetBank = bankName;
      break;
    }
  }

  if (!targetBank && payMethod.includes('카드')) {
    targetBank = '계좌이체';
  }

  return targetBank || payMethod;
}

module.exports = {
  parseNotification,
  generatePatternFromText,
  escapeRegexChars,
  addKoreanBrandName,
  cleanMerchantName,
  parseFlexibleDatetime,
  parsePaymentType,
  resolveCheckCardToBank
};
