// ==========================================
// 3. 정규식 분류 규칙 관리 및 패턴 메이커 (rules.js)
// ==========================================

// 로그 화면 내부 서브 탭 관련 바인딩 상태
let isLogsSubTabInitialized = false;

function initLogsSubTabs() {
  if (isLogsSubTabInitialized) return;
  
  const tabBtns = document.querySelectorAll('.logs-tab-btn');
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const subtab = btn.dataset.subtab;
      switchLogsSubTab(subtab);
    });
  });
  
  isLogsSubTabInitialized = true;
}

function switchLogsSubTab(subtab) {
  state.currentLogsSubTab = subtab;

  // 버튼 액티브 클래스 조정
  document.querySelectorAll('.logs-tab-btn').forEach(btn => {
    if (btn.dataset.subtab === subtab) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  // 컨텐츠 액티브 클래스 조정
  document.querySelectorAll('.sub-logs-content').forEach(content => {
    if (content.id === `subtab-${subtab}`) {
      content.classList.add('active');
    } else {
      content.classList.remove('active');
    }
  });

  // 헤더 업데이트
  if (typeof updateHeaderTitle === 'function') {
    updateHeaderTitle('logs', subtab);
  }

  // 서브 탭별 데이터 로드
  if (subtab === 'logs-list') {
    if (typeof loadLogs === 'function') {
      loadLogs();
    }
  } else if (subtab === 'rules') {
    loadRules();
  } else if (subtab === 'pass-rules') {
    if (typeof loadPassRules === 'function') {
      loadPassRules();
    }
  } else if (subtab === 'merchant') {
    if (typeof loadMerchantCategories === 'function') {
      loadMerchantCategories();
    }
  }
}

async function loadRules() {
  try {
    const rules = await fetch('api/rules').then(r => r.json());
    state.rules = rules;

    const container = document.getElementById('rules-list-container');
    if (!container) return;
    container.innerHTML = '';

    if (rules.length === 0) {
      container.innerHTML = '<p class="empty-message">등록된 분류 규칙이 없습니다.</p>';
      return;
    }

    rules.forEach(rule => {
      const isIncome = rule.type === 'INCOME';
      const typeLabel = isIncome ? '수입' : '지출';
      const typeClass = isIncome ? 'success' : 'failed';

      const div = document.createElement('div');
      div.className = 'rule-item';
      div.innerHTML = `
        <div class="rule-info">
          <div class="rule-title" style="display:flex; align-items:center; gap:0.5rem;">
            <span>${rule.name}</span>
            <span class="badge-status ${typeClass}" style="padding: 0.1rem 0.4rem; font-size: 0.7rem;">${typeLabel}</span>
          </div>
          <div class="rule-pattern-text">${escapeHtml(rule.pattern)}</div>
          <div class="rule-badges">
            <span class="tx-pay-method">${rule.pay_method === '_AUTO_MAPPING_' ? '🔄 자동 매핑' : rule.pay_method}</span>
          </div>
        </div>
        <div class="rule-actions">
          <button class="icon-btn btn-edit-rule">
            <i data-lucide="edit-2" style="width:16px;height:16px;"></i>
          </button>
          <button class="icon-btn btn-delete-rule" style="color:var(--danger-color)">
            <i data-lucide="trash" style="width:16px;height:16px;"></i>
          </button>
        </div>
      `;
      div.querySelector('.btn-edit-rule').addEventListener('click', () => loadRuleToEditor(rule));
      div.querySelector('.btn-delete-rule').addEventListener('click', () => deleteRule(rule.id));
      container.appendChild(div);
    });

    lucide.createIcons();

  } catch (err) {
    console.error('규칙 로드 실패:', err);
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

// 규칙 편집창 활성화
function loadRuleToEditor(rule) {
  const formCard = document.getElementById('rule-form-card');
  if (!formCard) return;
  formCard.style.display = 'block';
  document.getElementById('rule-form-title').textContent = rule ? '규칙 편집' : '새 규칙 추가';

  const type = rule ? rule.type : 'EXPENSE';

  document.getElementById('rule-id').value = rule ? rule.id : '';
  document.getElementById('rule-name').value = rule ? rule.name : '';
  document.getElementById('rule-pattern').value = rule ? rule.pattern : '';
  document.getElementById('rule-type').value = type;
  
  // 거래유형 변경에 따른 카테고리 셀렉트 팝퓰레이션
  updateCategorySelect('#rule-category', type, rule ? rule.category : '');
  
  document.getElementById('rule-pay-method').value = rule ? rule.pay_method : '_AUTO_MAPPING_';
  
  const actionSelect = document.getElementById('rule-action');
  if (actionSelect) {
    actionSelect.value = 'REGISTER';
  }
  const payMethodSelect = document.getElementById('rule-pay-method');
  if (payMethodSelect) {
    payMethodSelect.disabled = false;
    payMethodSelect.style.opacity = '1';
    payMethodSelect.style.cursor = 'default';
  }
  const categoryGroup = document.getElementById('rule-category-group');
  if (categoryGroup) {
    categoryGroup.style.display = 'block';
  }

  // 실시간 테스터에도 자동으로 패턴 채워주기
  if (rule) {
    document.getElementById('test-pattern').value = rule.pattern;
  }

  // 모달 활성화
  const modal = document.getElementById('rule-modal');
  if (modal) {
    modal.classList.add('active');
  }
}

// 규칙 제거
async function deleteRule(id) {
  if (!confirm('정말로 이 규칙을 삭제하시겠습니까?')) return;
  try {
    const res = await fetch(`api/rules/${id}`, { method: 'DELETE' }).then(r => r.json());
    if (res.success) {
      loadRules();
      document.getElementById('rule-form-card').style.display = 'none';
    }
  } catch (err) {
    alert('규칙 삭제 실패: ' + err.message);
  }
}

// 정규식 실시간 테스트 실행
async function runRegexTest() {
  const text = document.getElementById('test-text').value;
  const pattern = document.getElementById('test-pattern').value;
  const category = document.getElementById('rule-category').value;
  const payMethod = document.getElementById('rule-pay-method').value;

  if (!text || !pattern) {
    alert('테스트할 알림 원본과 정규식 패턴을 입력해 주세요.');
    return;
  }

  const container = document.getElementById('test-result-container');
  const successBox = document.getElementById('test-result-success');
  const failBox = document.getElementById('test-result-fail');

  if (!container || !successBox || !failBox) return;

  container.style.display = 'block';
  successBox.style.display = 'none';
  failBox.style.display = 'none';

  try {
    const type = document.getElementById('rule-type').value;

    const res = await fetch('api/parse-test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, pattern, category, pay_method: payMethod, type })
    }).then(r => r.json());

    if (res.success) {
      successBox.style.display = 'block';
      const r = res.result;
      
      const isIncome = r.type === 'INCOME';
      const typeEl = document.getElementById('result-val-type');
      typeEl.textContent = isIncome ? '수입' : '지출';
      typeEl.className = isIncome ? 'text-bold text-income' : 'text-bold';

      document.getElementById('result-val-amount').textContent = formatCurrency(r.amount);
      document.getElementById('result-val-point').textContent = r.used_point ? formatCurrency(r.used_point) + '점' : '0점';
      document.getElementById('result-val-merchant').textContent = r.merchant;
      document.getElementById('result-val-datetime').textContent = r.datetime;
      document.getElementById('result-val-paymethod').textContent = r.pay_method === '_AUTO_MAPPING_' ? '🔄 자동 매핑' : r.pay_method;
      document.getElementById('result-val-category').textContent = r.category;
    } else {
      failBox.style.display = 'block';
      document.getElementById('test-fail-message').textContent = res.message || '매칭 실패';
    }
  } catch (err) {
    failBox.style.display = 'block';
    document.getElementById('test-fail-message').textContent = '서버 통신 에러: ' + err.message;
  }
}

/**
 * [의존성 경고] 이 함수는 백엔드의 자동 규칙 생성 로직(parser/pattern_generator.js)과
 * 동일한 정규식 추출 알고리즘을 사용하므로, 수정 시 두 파일을 반드시 함께 동기화해야 합니다.
 * 
 * 규칙 관리 화면에서 사용자가 입력한 알림 본문을 바탕으로 정규식 패턴을 자동 완성 및 추천해주는 함수입니다.
 */
function autoGeneratePattern(silent = false) {
  const text = document.getElementById('test-text').value.trim();
  if (!text) {
    if (!silent) alert('패턴을 추출할 알림 본문을 먼저 입력해 주세요.');
    return;
  }

  let cleanText = text.replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '').replace(/\[Web발신\]\s*/i, '');
  const blocks = [];

  const isOverlapping = (start, end) => {
    return blocks.some(b => Math.max(start, b.start) < Math.min(end, b.end));
  };

  // 1. 카드명/은행명 감지
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

  // 2. 시간/일시 감지
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

  // 6. 포인트/마일리지 감지 (used_point)
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

  // 7. 상태 감지 (승인, 사용, 취소, 출금, 입금 등)
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

  // 8. 결제방식 감지
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

  // 9. 계좌번호 감지
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

  // 10. 고객명/예금주명 마스킹 감지
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

  // 감지된 고유 블록 정렬
  blocks.sort((a, b) => a.start - b.start);

  if (blocks.length === 0) {
    const resultPattern = '\\s*(?<merchant>.+?)(?:\\s+[\\d,]+)?\\s*';
    applySuggestedPattern(resultPattern, text, blocks, silent);
    return;
  }

  // Gap 계산 및 가장 적합한 가맹점 영역 점수 평가
  const gaps = [];
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

    let score = 0;
    if (len >= 2 && len <= 8) {
      score += 15;
    } else if (len > 8 && len <= 12) {
      score += 10;
    } else if (len === 1) {
      score += 2;
    } else {
      score -= (len - 12) * 1.5;
    }

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

    let matchesFranchise = false;
    const presets = state.franchisePresets || [];
    for (const preset of presets) {
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
      // [사용처 구분자 분리] 가맹점 영역 뒤에 슬래시(/)가 존재할 경우 강제 분리 처리 (연결 파일: parser/pattern_generator.js, public/rules.js, NotificationParser.kt)
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

  applySuggestedPattern(finalRegex, text, blocks, silent);
}

function applySuggestedPattern(suggested, text, blocks, silent) {
  const patternInput = document.getElementById('test-pattern');
  const rulePatternInput = document.getElementById('rule-pattern');
  if (patternInput) patternInput.value = suggested;
  if (rulePatternInput) rulePatternInput.value = suggested;

  // 본문 텍스트 내용을 기반으로 거래 유형(수입/지출) 감지 및 연계 카테고리 갱신
  let autoType = 'EXPENSE';
  if (text.includes('입금') || text.includes('급여') || text.includes('수입')) {
    autoType = 'INCOME';
  } else if (text.includes('출금') || text.includes('사용') || text.includes('지출') || text.includes('결제')) {
    autoType = 'EXPENSE';
  }

  // 카드/은행명이 있으면 규칙 이름도 자동 추천 및 지불 방식(수입/체크/신용/결제/지출) 자동 조합
  const cardBlock = blocks.find(b => b.type === '카드명/은행명');
  const payMethodBlock = blocks.find(b => b.type === '결제방식');
  const ruleNameEl = document.getElementById('rule-name');
  if (ruleNameEl) {
    let baseName = '';

    // 카드/은행명 블록 값 우선 사용 (사용처 자동 추출 배제)
    if (cardBlock && cardBlock.value) {
      baseName = cardBlock.value;
    }

    // 기존에 입력된 이름이 있다면 접미사를 제외하고 사용
    if (!baseName && ruleNameEl.value && ruleNameEl.value !== '자동 생성 규칙') {
      baseName = ruleNameEl.value.replace(/\s*(수입|체크|신용|결제|지출)?\s*규칙$/, '').trim();
    }

    if (!baseName) {
      baseName = '자동 생성';
    }

    // 수식어 결정 (수입, 체크, 신용, 결제, 지출)
    let modifier = '결제';
    if (autoType === 'INCOME') {
      modifier = '수입';
    } else {
      const isCheck = text.includes('체크') || (cardBlock && cardBlock.value && cardBlock.value.includes('체크')) || (payMethodBlock && payMethodBlock.value && payMethodBlock.value.includes('체크'));
      const isCredit = text.includes('신용') || text.includes('카드') || (cardBlock && cardBlock.value && (cardBlock.value.includes('카드') || cardBlock.value.includes('신용'))) || (payMethodBlock && payMethodBlock.value && (payMethodBlock.value.includes('카드') || payMethodBlock.value.includes('신용')));

      if (isCheck) {
        modifier = '체크';
      } else if (isCredit) {
        modifier = '신용';
      } else if (text.includes('결제') || text.includes('승인') || text.includes('사용') || text.includes('페이')) {
        modifier = '결제';
      } else {
        modifier = '지출';
      }
    }

    let finalRuleName = `${baseName} ${modifier} 규칙`;
    if (baseName.includes(modifier)) {
      finalRuleName = `${baseName} 규칙`;
    }
    ruleNameEl.value = finalRuleName;
  }

  // 규칙 생성 카드창이 안 열려있으면 강제로 활성화
  const formCard = document.getElementById('rule-form-card');
  if (formCard && formCard.style.display === 'none') {
    loadRuleToEditor(null);
    if (patternInput) rulePatternInput.value = patternInput.value;
  }

  const ruleTypeSelect = document.getElementById('rule-type');
  if (ruleTypeSelect) {
    ruleTypeSelect.value = autoType;
    if (typeof updateCategorySelect === 'function') {
      updateCategorySelect('#rule-category', autoType, '');
    }
  }

  if (!silent) {
    alert('알림 텍스트의 각 요소를 위치 기반으로 정밀 자동 분석하여 정규식 패턴을 생성했습니다! 바로 [테스트 실행]을 진행해 보세요.');
  }
}

async function aiGeneratePattern() {
  const text = document.getElementById('test-text').value.trim();
  if (!text) {
    alert('AI 패턴 생성을 진행할 알림 본문을 먼저 입력해 주세요.');
    return;
  }

  const aiGenBtn = document.getElementById('btn-ai-generate-pattern');
  const originalHtml = aiGenBtn.innerHTML;

  try {
    aiGenBtn.disabled = true;
    aiGenBtn.innerHTML = '<i data-lucide="loader" class="animate-spin" style="width:14px;height:14px;"></i> 생성 중...';
    lucide.createIcons();

    const res = await fetch('api/rules/ai-generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    }).then(r => r.json());

    if (res.success && res.pattern) {
      const patternInput = document.getElementById('test-pattern');
      const rulePatternInput = document.getElementById('rule-pattern');
      if (patternInput) patternInput.value = res.pattern;
      if (rulePatternInput) rulePatternInput.value = res.pattern;

      // 규칙 이름 자동 추천
      const ruleNameEl = document.getElementById('rule-name');
      if (ruleNameEl && !ruleNameEl.value) {
        ruleNameEl.value = 'AI 생성 규칙';
      }

      // 규칙 생성 카드창이 안 열려있으면 강제로 활성화
      const formCard = document.getElementById('rule-form-card');
      if (formCard && formCard.style.display === 'none') {
        loadRuleToEditor(null);
        if (patternInput) rulePatternInput.value = patternInput.value;
      }

      alert('AI가 알림 내용을 완벽히 파싱할 수 있는 정규식 패턴을 생성했습니다! 바로 [테스트 실행]을 클릭해 정상 작동하는지 검증해 보세요.');
    } else {
      alert('AI 패턴 생성 실패: ' + (res.error || '알 수 없는 오류'));
    }
  } catch (err) {
    alert('AI 패턴 생성 중 오류 발생: ' + err.message);
  } finally {
    aiGenBtn.disabled = false;
    aiGenBtn.innerHTML = originalHtml;
    lucide.createIcons();
  }
}

function escapeRegexChars(str) {
  return str.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
}

// 알림 로그의 발신처 패키지를 설정의 패키지-결제수단 매핑 폼으로 전달 및 이동
function linkToPackageMapping(senderPackage) {
  if (typeof openPackageMappingModal === 'function') {
    openPackageMappingModal(senderPackage);
  }
}
