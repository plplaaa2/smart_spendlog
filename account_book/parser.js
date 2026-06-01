/**
 * 알림 텍스트를 등록된 규칙들과 대조하여 결제 정보(금액, 사용처, 일시, 결제수단 등)를 추출합니다.
 */
function parseNotification(text, rules, fallbackDatetime = null) {
  if (!text) return null;

  for (const rule of rules) {
    try {
      // 정규식 컴파일 (amount 캡처 인덱스를 획득하기 위해 'd' 플래그 추가)
      const regex = new RegExp(rule.pattern, 'd');
      const match = regex.exec(text);

      if (match) {
        const groups = match.groups || {};
        
        // 1. 금액(amount) 파싱
        let amount = null;
        if (groups.amount) {
          // 쉼표 제거 및 숫자만 추출
          const cleanAmount = groups.amount.replace(/,/g, '').match(/\d+/);
          if (cleanAmount) {
            amount = parseInt(cleanAmount[0], 10);
          }
        }

        // 금액이 정상적으로 파싱되지 않으면 규칙이 부적합하다고 보고 다른 규칙 탐색
        if (amount === null || isNaN(amount)) {
          continue;
        }

        // [중요] 금액 오인 매칭 검증 (날짜/시간의 연도, 시, 분 등을 금액으로 오인하여 가계부 자동등록되는 것 방지)
        if (match.indices && match.indices.groups && match.indices.groups.amount) {
          const [amountStart, amountEnd] = match.indices.groups.amount;
          
          // 텍스트에 나타날 수 있는 표준 날짜 및 시간 형식들
          const dateTimeRegexes = [
            /\b\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2}\b/g,
            /\b\d{1,2}[.\-/]\d{1,2}\b/g,
            /\b\d{1,2}월\s*\d{1,2}일\b/g,
            /\b\d{2}:\d{2}(?::\d{2})?\b/g
          ];
          
          let isDateTime = false;
          for (const dtRegex of dateTimeRegexes) {
            let dtMatch;
            while ((dtMatch = dtRegex.exec(text)) !== null) {
              const dtStart = dtMatch.index;
              const dtEnd = dtMatch.index + dtMatch[0].length;
              
              // 추출된 금액 캡처 영역이 날짜/시간 포맷 영역 내부에 완전히 포함되어 있는 경우
              if (amountStart >= dtStart && amountEnd <= dtEnd) {
                isDateTime = true;
                break;
              }
            }
            if (isDateTime) break;
          }
          
          if (isDateTime) {
            console.log(`[파서] 금액(${amount})이 날짜/시간 영역(${text.substring(amountStart, amountEnd)})에 속하므로 이중등록 및 오인매핑 방지를 위해 규칙 "${rule.name}" 매칭을 거부합니다.`);
            continue;
          }
        }

        // 2. 사용처(merchant) 파싱
        let merchant = groups.merchant || groups.usage || '알수없음';
        merchant = merchant.trim();
        merchant = addKoreanBrandName(merchant); // 영문 브랜드 한글명 추가 (예: VIPS -> VIPS(빕스))

        // 3. 결제 일시(datetime) 파싱
        let datetimeStr = '';
        const now = new Date();
        const currentYear = now.getFullYear();

        const timeStr = groups.time || groups.datetime || groups.date;
        if (timeStr) {
          // 다양한 포맷 시도 (예: MM/DD HH:mm, MM-DD HH:mm, YYYY-MM-DD HH:mm 등)
          const dateMatch = timeStr.match(/(?:(\d{4})[-/.])?(\d{1,2})[-/.](\d{1,2})\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/);
          if (dateMatch) {
            const year = dateMatch[1] ? parseInt(dateMatch[1], 10) : currentYear;
            const month = dateMatch[2].padStart(2, '0');
            const day = dateMatch[3].padStart(2, '0');
            const hour = dateMatch[4].padStart(2, '0');
            const minute = dateMatch[5].padStart(2, '0');
            const second = dateMatch[6] ? dateMatch[6].padStart(2, '0') : '00';
            datetimeStr = `${year}-${month}-${day} ${hour}:${minute}:${second}`;
          }
        }

        // 일시 파싱 실패 시 현재 시간 또는 fallbackDatetime 적용
        if (!datetimeStr) {
          if (fallbackDatetime) {
            datetimeStr = fallbackDatetime;
          } else {
            const pad = (n) => String(n).padStart(2, '0');
            datetimeStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
          }
        }

        // 4. 결제수단(pay_method) 파싱
        let payMethod = groups.pay_method || rule.pay_method || '카드';
        payMethod = payMethod.trim();

        // [보정] 본문에 '체크' 문구가 있고, payMethod 명칭에 '카드'가 들어가며 '체크'가 없을 때 '체크카드'로 변환
        if (text.includes('체크') && payMethod.includes('카드') && !payMethod.includes('체크')) {
          payMethod = payMethod.replace('카드', '체크카드');
        }

        // 5. 카테고리(category)
        let category = rule.category || '기타';

        // 5-2. 문자 내 명시적 포인트/지원금 차감액 추출
        // 의존성: index.js의 DB insert 구문 및 stats 계산 로직과 유기적으로 연동됩니다.
        let usedPoint = 0;
        if (groups.used_point) {
          const cleanPoint = groups.used_point.replace(/,/g, '');
          usedPoint = parseInt(cleanPoint, 10) || 0;
        } else {
          const pointMatch = text.match(/(?:포인트|점수|P|마일리지|하트)\s*(\d{1,3}(?:,\d{3})*)\s*(?:원|점|P)?/i);
          if (pointMatch) {
            const cleanPoint = pointMatch[1].replace(/,/g, '');
            usedPoint = parseInt(cleanPoint, 10) || 0;
          }
        }

        // 6. 메모(memo) 자동 조립 (계좌, 잔액, 누적금액 정보 포함)
        let memoParts = [];
        if (groups.account) memoParts.push(`계좌: ${groups.account.trim()}`);
        if (groups.balance) memoParts.push(`잔액: ${groups.balance.trim()}`);
        if (groups.cumulative) memoParts.push(`누적: ${groups.cumulative.trim()}`);
        const memo = memoParts.join(' | ');

        return {
          amount,
          merchant,
          datetime: datetimeStr,
          pay_method: payMethod,
          category,
          type: rule.type || 'EXPENSE',
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

  return null; // 일치하는 규칙 없음
}

/**
 * [의존성 경고] 이 함수는 웹 UI의 패턴 자동 생성 로직(public/rules.js의 autoGeneratePattern)과
 * 동일한 정규식 추출 알고리즘을 사용하므로, 수정 시 두 파일을 반드시 함께 동기화해야 합니다.
 * 
 * 알림 분석 실패 시 백그라운드에서 자동으로 최적의 정규식 매칭 패턴을 생성해주는 함수입니다.
 */
function generatePatternFromText(text) {
  if (!text) return null;

  let cleanText = text.replace(/\[Web발신\]\s*/i, '');
  const blocks = [];

  // 안전한 겹침 검사 헬퍼 (구간이 단 1글자라도 겹치면 true)
  const isOverlapping = (start, end) => {
    return blocks.some(b => Math.max(start, b.start) < Math.min(end, b.end));
  };

  // 1. 카드명/은행명 감지
  const cardMatch = cleanText.match(/\[(.*?)\]/) || cleanText.match(/(NH농협|국민체크|신한체크|신한카드|삼성카드|현대카드|롯데카드|우리카드|하나카드|카카오뱅크|토스뱅크|신한은행|국민은행|우리은행|하나은행|농협은행|IBK|기업은행|우체국)/);
  if (cardMatch) {
    const value = cardMatch[1] || cardMatch[0];
    const isBracket = cardMatch[0].startsWith('[');
    // [입금], [출금] 같은 짧은 상태 문구이거나 숫자가 포함된 경우만 스킵 (입출금알림 같은 헤더성 문구는 카드명/은행명 블록으로 인정)
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

  // 2. 시간/일시 감지 (금액 감지보다 먼저 처리하여 연도/날짜가 금액으로 오인되는 것을 방지합니다)
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

  // 3. 금액 감지 ("원"이 붙어있는 금액 우선 감지)
  const amountWithWonRegex = /([\d,]+)\s*원/g;
  let m;
  let amountDetected = false;
  while ((m = amountWithWonRegex.exec(cleanText)) !== null) {
    const idx = m.index;
    const len = m[0].length;
    if (!isOverlapping(idx, idx + len)) {
      blocks.push({
        type: '금액',
        start: idx,
        end: idx + len,
        regex: '(?<amount>[\\d,]+)원',
        value: m[0]
      });
      amountDetected = true;
      break;
    }
  }

  // 3-2. "원"이 안 붙은 순수 숫자 금액 감지
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

  // 4. 잔액 감지
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

  // 5. 누적금액 감지
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

  // 6. 포인트/마일리지 감지
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

  // 상태 감지 (승인, 사용, 취소, 출금, 입금 등) - 다중 감지하여 중복되지 않는 모든 상태 수집
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

  // 결제방식 감지
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

  // 7. 계좌번호 감지 (마스킹 문자 '*'가 포함된 계좌번호 패턴 최우선 감지 및 다중 탐색)
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
      // 숫자나 하이픈이 전혀 없고 오직 별표(*)만 있는 문자열은 계좌번호에서 제외 (이름 마스킹 오인 차단)
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

  // 8. 고객명/예금주명 마스킹 감지
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

  // 블록들을 텍스트 위치 순서대로 정렬
  blocks.sort((a, b) => a.start - b.start);

  // 9. 여백(gap) 분석을 통해 가장 유의미한 사용처(merchant) 영역 선정
  const gaps = [];
  if (blocks.length === 0) {
    return '\\s*(?<merchant>.+?)(?:\\s+[\\d,]+)?\\s*';
  }

  // 첫 번째 블록 전 여백
  gaps.push({ start: 0, end: blocks[0].start, index: 0 });
  // 블록들 사이 여백
  for (let i = 1; i < blocks.length; i++) {
    gaps.push({ start: blocks[i-1].end, end: blocks[i].start, index: i });
  }
  // 마지막 블록 후 여백
  gaps.push({ start: blocks[blocks.length-1].end, end: cleanText.length, index: blocks.length });

  let bestGapIndex = -1;
  let maxCleanLen = -1;

  gaps.forEach(g => {
    const txt = cleanText.substring(g.start, g.end);
    // 잔액, 잔고, 누적 등 가맹점명이 될 수 없는 지시어를 제외한 클린 텍스트 추출 (입금/출금 등 브라켓과 지시용어 제외)
    const cleanTxt = txt.replace(/\[?(입금|출금|잔액|잔고|누적|결제)\]?/g, '').trim();
    
    // 한글이나 영문이 최소 1글자 이상 포함되어 있지 않은 gap은 제외 (숫자, 특수문자, 마스킹만 있는 경우 방지)
    const cleanLetters = cleanTxt.replace(/[^가-힣a-zA-Z]/g, '');
    if (cleanLetters.length === 0) return;

    if (cleanLetters.length > maxCleanLen) {
      maxCleanLen = cleanLetters.length;
      bestGapIndex = g.index;
    }
  });

  // 10. 최종 정규식 조립
  let finalRegex = '^';
  let lastIndex = 0;
  const usedTypes = new Set();

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const prefixGap = cleanText.substring(lastIndex, b.start);
    
    // 이 여백 구간이 선정된 가맹점명(merchant) 구간인 경우
    if (i === bestGapIndex && maxCleanLen > 0) {
      const hasNums = /\d/.test(prefixGap);
      finalRegex += hasNums ? '\\s*(?<merchant>.+?)(?:\\s+[\\d,]+)?\\s*' : '\\s*(?<merchant>.+?)\\s*';
    } else {
      finalRegex += escapeRegexChars(prefixGap);
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

  // 마지막 블록 후 남은 텍스트(Suffix) 처리
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
    finalRegex += escapeRegexChars(suffixGap);
  }

  return finalRegex;
}

function escapeRegexChars(str) {
  return str.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
}

/**
 * 영문 브랜드명을 감지하여 한글명을 괄호와 함께 추가합니다. (예: VIPS -> VIPS(빕스))
 * 이미 한글명이 포함되어 있는 경우 중복 추가를 방지합니다.
 * @param {string} merchant 사용처 이름
 * @returns {string} 변환된 사용처 이름
 */
function addKoreanBrandName(merchant) {
  if (!merchant) return merchant;

  // 영문 브랜드 -> 한글 브랜드 매핑
  const brandMap = {
    'VIPS': '빕스',
    'STARBUCKS': '스타벅스',
    'MCDONALD': '맥도날드',
    'BURGER KING': '버거킹',
    'BURGERKING': '버거킹',
    'SUBWAY': '써브웨이',
    'SHAKE SHACK': '쉐이크쉑',
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

module.exports = {
  parseNotification,
  generatePatternFromText
};
