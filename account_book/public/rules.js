// ==========================================
// 3. 정규식 규칙 및 알림 로그 탭 로직
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
    loadLogs();
  } else if (subtab === 'rules') {
    loadRules();
  } else if (subtab === 'pass-rules') {
    loadPassRules();
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

// ==========================================
// 4. 수신 로그 탭 로직
// ==========================================
// 수신 로그 탭 데이터 로드
// 요약: Home Assistant로부터 수신된 알림 이력 데이터를 가져와 카드 그리드 형태로 렌더링하고, title과 text를 구분하여 보여줍니다.
// 의존성: public/index.html의 logs-grid-container, public/style.css의 카드 클래스들과 매핑됩니다.
async function loadLogs() {
  try {
    const logs = await fetch('api/notification_logs').then(r => r.json());
    const container = document.getElementById('logs-grid-container');
    if (!container) return;
    container.innerHTML = '';

    if (logs.length === 0) {
      container.innerHTML = '<p class="empty-message" style="grid-column: 1 / -1;">수신된 알림 이력이 없습니다.</p>';
      return;
    }

    logs.forEach(log => {
      let statusBadge = '';
      if (log.parsed_status === 'SUCCESS') {
        statusBadge = '<span class="badge-status success">등록 성공</span>';
      } else if (log.parsed_status === 'PASS') {
        statusBadge = '<span class="badge-status pass" style="background: rgba(59,130,246,0.18); color: #93c5fd; border: 1px solid rgba(59,130,246,0.45); font-weight: 700; padding: 2px 6px; border-radius: 4px; font-size: 0.72rem; line-height: 1;">PASS</span>';
      } else {
        statusBadge = '<span class="badge-status failed">등록 실패</span>';
      }

      const showRetry = (log.parsed_status !== 'PASS');
      const retryHtml = showRetry 
        ? `<button class="badge-status btn-retry-log" style="cursor: pointer; border: none; background: rgba(16, 185, 129, 0.2); color: var(--success-color); display: inline-flex; align-items: center; gap: 3px; font-family: inherit; transition: opacity 0.2s;" onmouseover="this.style.opacity='0.8'" onmouseout="this.style.opacity='1'">
             <i data-lucide="refresh-cw" style="width:11px;height:11px;"></i> 재시도
           </button>`
        : '';

      const showFooter = (log.parsed_status !== 'PASS');
      const footerHtml = showFooter 
        ? `<div class="log-card-footer" style="gap: 6px;">
             <button class="btn btn-secondary btn-sm btn-create-tx">
               <i data-lucide="plus" style="width:12px;height:12px;"></i> 수동 등록
             </button>
             <button class="btn btn-secondary btn-sm btn-create-rule">
               <i data-lucide="sliders" style="width:12px;height:12px;"></i> 규칙 만들기
             </button>
           </div>`
        : '';

      const card = document.createElement('div');
      card.className = 'log-card-item';
      card.innerHTML = `
        <div class="log-card-header">
          <span class="log-card-time">${formatShortDate(log.created_at, true)}</span>
          <span class="log-card-status" style="display: flex; align-items: center; gap: 0.35rem;">
            ${statusBadge}
            ${retryHtml}
          </span>
        </div>
        <div class="log-card-body">
          <div class="log-card-row">
            <span class="log-card-label">발신처(앱/번호)</span>
            <span class="log-card-value text-bold" style="font-family: monospace; font-size: 0.8rem; display: flex; align-items: center; gap: 0.25rem;">
              <span>${escapeHtml(log.sender || '-')}</span>
              ${log.sender ? `
              <button class="icon-btn btn-copy-package" title="앱 패키지 매핑에 추가" style="padding: 2px; color: var(--accent-color); background: none; border: none; cursor: pointer; display: inline-flex; align-items: center;">
                <i data-lucide="plus" style="width: 13px; height: 13px; stroke-width: 2.5;"></i>
              </button>` : ''}
            </span>
          </div>
          <div class="log-card-row">
            <span class="log-card-label">알림 제목</span>
            <span class="log-card-value text-bold">${escapeHtml(log.title || '-')}</span>
          </div>
          <div class="log-card-row block">
            <span class="log-card-label">알림 내용</span>
            <div class="log-card-text-content">${escapeHtml(log.text || log.raw_text || '-')}</div>
          </div>
        </div>
        ${footerHtml}
      `;

      const txBtn = card.querySelector('.btn-create-tx');
      if (txBtn) {
        txBtn.addEventListener('click', () => createTransactionFromLog(log));
      }
      const ruleBtn = card.querySelector('.btn-create-rule');
      if (ruleBtn) {
        ruleBtn.addEventListener('click', () => createRuleFromLog(log));
      }

      const retryBtn = card.querySelector('.btn-retry-log');
      if (retryBtn) {
        retryBtn.addEventListener('click', () => retryLogParsing(log.id));
      }
      if (log.sender) {
        const copyBtn = card.querySelector('.btn-copy-package');
        if (copyBtn) {
          copyBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            linkToPackageMapping(log.sender);
          });
        }
      }
      container.appendChild(card);
    });

    lucide.createIcons();

  } catch (err) {
    console.error('로그 조회 실패:', err);
  }
}

// 로그 실패 재시도 실행 함수
async function retryLogParsing(id) {
  try {
    const res = await fetch(`api/notification_logs/${id}/retry`, {
      method: 'POST'
    }).then(r => r.json());

    if (res.success) {
      alert('성공적으로 파싱되어 가계부에 등록되었습니다!');
      loadLogs();
      if (typeof loadDashboardData === 'function') {
        loadDashboardData();
      }
    } else {
      alert('재시도 실패: ' + (res.error || '알 수 없는 오류'));
    }
  } catch (err) {
    alert('재시도 중 오류 발생: ' + err.message);
  }
}

// 로그에서 가계부 직접 등록 팝업 띄우기
function createTransactionFromLog(log) {
  openAddTransactionModal();
  const rawTextEl = document.getElementById('tx-raw-text');
  if (rawTextEl) rawTextEl.value = log.raw_text;
  
  const amountMatch = log.raw_text.replace(/,/g, '').match(/\d{3,}/);
  const amountEl = document.getElementById('tx-amount');
  if (amountMatch && amountEl) {
    amountEl.value = amountMatch[0];
  }

  // 알림 수신 시각을 가계부 수동 등록 기본 시각으로 세팅
  if (log.created_at) {
    let dateObj;
    if (log.created_at.includes('-') && log.created_at.includes(':')) {
      const cleanStr = log.created_at.replace(/-/g, '/') + ' UTC';
      dateObj = new Date(cleanStr);
    } else {
      dateObj = new Date(log.created_at);
    }
    
    if (!isNaN(dateObj.getTime())) {
      const offset = dateObj.getTimezoneOffset() * 60000;
      const localISOTime = (new Date(dateObj - offset)).toISOString().slice(0, 16);
      const datetimeEl = document.getElementById('tx-datetime');
      if (datetimeEl) {
        datetimeEl.value = localISOTime;
      }
    }
  }

  // 발신처(패키지명)가 있는 경우 패키지명 입력 활성화 및 기본값 체크
  if (log.sender) {
    const pkgRow = document.getElementById('tx-package-row');
    const pkgInput = document.getElementById('tx-package');
    const chkMap = document.getElementById('tx-map-package');
    if (pkgRow && pkgInput && chkMap) {
      pkgRow.style.display = 'flex';
      pkgInput.value = log.sender;
      chkMap.checked = true;
    }
  }
}

// 로그에서 규칙 편집 실행
function createRuleFromLog(log) {
  loadRuleToEditor(null);
  const testTextEl = document.getElementById('test-text');
  if (testTextEl) testTextEl.value = log.raw_text;
  
  // 발신자 정보가 있다면 규칙 이름으로 우선 추천
  const ruleNameEl = document.getElementById('rule-name');
  if (ruleNameEl && log.sender) {
    ruleNameEl.value = `${log.sender} 규칙`;
  }
  
  // 자동 패턴 생성 실행 (사용자 귀찮음 방지를 위해 알림창 없이 무음 실행)
  autoGeneratePattern(true);
}

/**
 * [의존성 경고] 이 함수는 백엔드의 자동 규칙 생성 로직(parser.js의 generatePatternFromText)과
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
        regex: '(?:포인트|P)\\s*(?<used_point>[\\d,]+)\\s*(?:원|점|P)?',
        value: pm[0]
      });
      break;
    }
  }

  // 7. 상태 감지 (승인, 사용, 취소, 출금, 입금 등)
  const statusMatch = cleanText.match(/(승인|사용|취소|출금|입금|결제)/);
  if (statusMatch) {
    const idx = statusMatch.index;
    const len = statusMatch[0].length;
    if (!isOverlapping(idx, idx + len)) {
      blocks.push({
        type: '상태',
        start: idx,
        end: idx + len,
        regex: escapeRegexChars(statusMatch[0]),
        value: statusMatch[0]
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
        regex: '(?<pay_method>[^\\s/]+)',
        value: payMethodMatch[0]
      });
    }
  }

  // 9. 계좌번호 감지 (마스킹 문자 '*'가 포함된 계좌번호 패턴 최우선 감지 및 다중 탐색)
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

  // 11. 사용처(merchant) 감지 (블록들 사이에 빈 공간 중 가장 상점명다운 문자열 추출)
  let bestGapIndex = -1;
  let maxCleanLen = -1;

  const gaps = [];
  gaps.push({ start: 0, end: blocks[0] ? blocks[0].start : cleanText.length, index: 0 });
  for (let i = 1; i < blocks.length; i++) {
    gaps.push({ start: blocks[i-1].end, end: blocks[i].start, index: i });
  }
  if (blocks.length > 0) {
    gaps.push({ start: blocks[blocks.length-1].end, end: cleanText.length, index: blocks.length });
  }

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

  let merchantBlock = null;
  if (bestGapIndex !== -1 && maxCleanLen > 0) {
    const targetGap = gaps.find(g => g.index === bestGapIndex);
    const rawGap = cleanText.substring(targetGap.start, targetGap.end);
    
    const leadTrim = rawGap.match(/^[\s\-/\\:*]+/);
    const leadLen = leadTrim ? leadTrim[0].length : 0;
    const trailTrim = rawGap.match(/[\s\-/\\:*]+$/);
    const trailLen = trailTrim ? trailTrim[0].length : 0;
    const gapText = rawGap.substring(leadLen, rawGap.length - trailLen).trim();

    if (gapText.length > 0) {
      const mStart = targetGap.start + leadLen + (rawGap.substring(leadLen).length - rawGap.substring(leadLen).trimStart().length);
      const mEnd = mStart + gapText.length;
      merchantBlock = {
        type: '사용처',
        start: mStart,
        end: mEnd,
        regex: '(?<merchant>.+?)(?:\\s+[\\d,]+)?',
        value: gapText
      };
    }
  }

  if (merchantBlock) {
    blocks.push(merchantBlock);
    blocks.sort((a, b) => a.start - b.start);
  } else {
    blocks.push({
      type: '사용처',
      start: cleanText.length,
      end: cleanText.length,
      regex: '(?<merchant>.+?)(?:\\s+[\\d,]+)?',
      value: ''
    });
  }

  // 화면 필드에 추출 순서 채우기
  const inferredSequence = blocks.map(b => b.type).join(', ');
  const sequenceInput = document.getElementById('test-sequence');
  if (sequenceInput) {
    sequenceInput.value = inferredSequence;
  }

  // 정규식 조립
  let suggested = '';
  if (text.includes('[Web발신]')) {
    suggested += '(?:(?:\\[Web발신\\])?\\s*)?';
  }

  // 갭 텍스트의 정적 문자(특수문자 포함)는 보존하고 공백은 정규식으로 유연화하는 헬퍼 함수
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

  // 1. 첫 블록 전 갭 처리
  if (blocks.length > 0 && blocks[0].start > 0) {
    const frontGap = cleanText.substring(0, blocks[0].start);
    suggested += formatGapToRegex(frontGap);
  }

  const usedTypes = new Set();

  // 2. 블록과 블록 사이 갭 정밀 결합
  for (let i = 0; i < blocks.length; i++) {
    let blockRegex = blocks[i].regex;
    if (blocks[i].type === '사용처' && i === blocks.length - 1) {
      blockRegex = '(?<merchant>.+)(?:\\s+[\\d,]+)?';
    }
    
    if (blocks[i].type !== '사용처') {
      if (usedTypes.has(blocks[i].type)) {
        blockRegex = blockRegex.replace(/\(\?<[a-zA-Z0-9_]+>/g, '(?:');
      } else {
        usedTypes.add(blocks[i].type);
      }
    }
    
    suggested += blockRegex;
    if (i < blocks.length - 1) {
      const gapText = cleanText.substring(blocks[i].end, blocks[i+1].start);
      suggested += formatGapToRegex(gapText);
    }
  }

  // 3. 마지막 블록 뒤 갭 처리
  if (blocks.length > 0 && blocks[blocks.length - 1].end < cleanText.length) {
    const backGap = cleanText.substring(blocks[blocks.length - 1].end);
    suggested += formatGapToRegex(backGap);
  }

  const patternInput = document.getElementById('test-pattern');
  const rulePatternInput = document.getElementById('rule-pattern');
  if (patternInput) patternInput.value = suggested;
  if (rulePatternInput) rulePatternInput.value = suggested;

  // 카드/은행명이 있으면 규칙 이름도 자동 추천 (비어있는 경우에만 추천하거나 더 우선순위 높은 정보로 갱신)
  const cardBlock = blocks.find(b => b.type === '카드명/은행명');
  const ruleNameEl = document.getElementById('rule-name');
  if (ruleNameEl) {
    if (cardBlock && cardBlock.value) {
      ruleNameEl.value = `${cardBlock.value} 규칙`;
    } else if (!ruleNameEl.value) {
      ruleNameEl.value = '자동 생성 규칙';
    }
  }

  // 규칙 생성 카드창이 안 열려있으면 강제로 활성화
  const formCard = document.getElementById('rule-form-card');
  if (formCard && formCard.style.display === 'none') {
    loadRuleToEditor(null);
    if (patternInput) rulePatternInput.value = patternInput.value;
  }

  if (!silent) {
    alert('알림 텍스트의 각 요소를 위치 기반으로 정밀 자동 분석하여 정규식 패턴을 생성했습니다! 바로 [테스트 실행]을 진행해 보세요.');
  }
}

function escapeRegexChars(str) {
  return str.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
}

// 알림 로그의 발신처 패키지를 설정의 패키지-결제수단 매핑 폼으로 전달 및 이동
function linkToPackageMapping(senderPackage) {
  openPackageMappingModal(senderPackage);
}

// 자동 패스 규칙 목록 로드
async function loadPassRules() {
  try {
    const rules = await fetch('api/pass_rules').then(r => r.json());
    
    const container = document.getElementById('pass-rules-list-container');
    if (!container) return;
    container.innerHTML = '';

    if (rules.length === 0) {
      container.innerHTML = '<p class="empty-message">등록된 자동 패스 규칙이 없습니다.</p>';
      return;
    }

    rules.forEach(rule => {
      const div = document.createElement('div');
      div.className = 'rule-item';
      div.innerHTML = `
        <div class="rule-info">
          <div class="rule-title" style="display:flex; align-items:center; gap:0.5rem;">
            <span>${rule.name}</span>
            <span class="badge-status info" style="padding: 0.1rem 0.4rem; font-size: 0.7rem; background: rgba(59,130,246,0.15); color: #60a5fa; border: 1px solid rgba(59,130,246,0.3);">PASS</span>
          </div>
          <div class="rule-pattern-text">${escapeHtml(rule.pattern)}</div>
        </div>
        <div class="rule-actions">
          <button class="icon-btn btn-edit-pass-rule">
            <i data-lucide="edit-2" style="width:16px;height:16px;"></i>
          </button>
          <button class="icon-btn btn-delete-pass-rule" style="color:var(--danger-color)">
            <i data-lucide="trash" style="width:16px;height:16px;"></i>
          </button>
        </div>
      `;
      div.querySelector('.btn-edit-pass-rule').addEventListener('click', () => loadPassRuleToEditor(rule));
      div.querySelector('.btn-delete-pass-rule').addEventListener('click', () => deletePassRule(rule.id));
      container.appendChild(div);
    });

    lucide.createIcons();

  } catch (err) {
    console.error('패스 규칙 로드 실패:', err);
  }
}

// 자동 패스 규칙 편집기 로드 및 모달 노출
function loadPassRuleToEditor(rule) {
  const formCard = document.getElementById('pass-rule-form-card');
  if (!formCard) return;
  formCard.style.display = 'block';
  document.getElementById('pass-rule-form-title').textContent = rule ? '자동 패스규칙 편집' : '새 패스규칙 추가';

  document.getElementById('pass-rule-id').value = rule ? rule.id : '';
  document.getElementById('pass-rule-name').value = rule ? rule.name : '';
  document.getElementById('pass-rule-pattern').value = rule ? rule.pattern : '';

  // 실시간 테스터 패턴 자동 채우기
  document.getElementById('test-pass-pattern').value = rule ? rule.pattern : '';
  document.getElementById('test-pass-result-container').style.display = 'none';

  // 모달 활성화
  const modal = document.getElementById('pass-rule-modal');
  if (modal) {
    modal.classList.add('active');
  }
}

// 자동 패스 규칙 삭제
async function deletePassRule(id) {
  if (!confirm('정말로 이 패스 규칙을 삭제하시겠습니까?')) return;
  try {
    const res = await fetch(`api/pass_rules/${id}`, { method: 'DELETE' }).then(r => r.json());
    if (res.success) {
      loadPassRules();
      document.getElementById('pass-rule-form-card').style.display = 'none';
      const modal = document.getElementById('pass-rule-modal');
      if (modal) modal.classList.remove('active');
    }
  } catch (err) {
    alert('패스 규칙 삭제 실패: ' + err.message);
  }
}

// 실시간 패스 규칙 정규식 테스트 실행
function runPassRegexTest() {
  const text = document.getElementById('test-pass-text').value;
  const pattern = document.getElementById('test-pass-pattern').value;

  if (!text || !pattern) {
    alert('테스트할 알림 내용과 정규식 패턴을 입력해 주세요.');
    return;
  }

  const container = document.getElementById('test-pass-result-container');
  container.style.display = 'block';

  try {
    const regex = new RegExp(pattern);
    const isMatched = regex.test(text);

    if (isMatched) {
      container.style.background = 'rgba(16, 185, 129, 0.15)';
      container.style.border = '1px solid rgba(16, 185, 129, 0.3)';
      container.innerHTML = `
        <h4 style="color:#10b981; margin-bottom:0.5rem; font-weight:600;">PASS 매칭 성공</h4>
        <p class="text-sm" style="color:var(--text-primary); line-height:1.4; margin-bottom:0;">
          알림 내용이 패스 규칙과 일치합니다. 이 알림이 수신되면 가계부에 등록되지 않고 즉시 <strong>PASS</strong> 상태로 기록 및 제외됩니다.
        </p>
      `;
    } else {
      container.style.background = 'rgba(244, 63, 94, 0.15)';
      container.style.border = '1px solid rgba(244, 63, 94, 0.3)';
      container.innerHTML = `
        <h4 style="color:#f43f5e; margin-bottom:0.5rem; font-weight:600;">PASS 매칭 실패</h4>
        <p class="text-sm" style="color:var(--text-primary); line-height:1.4; margin-bottom:0;">
          알림 내용이 패스 규칙과 일치하지 않습니다. 일반적인 알림 분류 정규식 규칙을 탐색하여 등록을 시도하게 됩니다.
        </p>
      `;
    }
  } catch (err) {
    container.style.background = 'rgba(244, 63, 94, 0.15)';
    container.style.border = '1px solid rgba(244, 63, 94, 0.3)';
    container.innerHTML = `
      <h4 style="color:#f43f5e; margin-bottom:0.5rem; font-weight:600;">정규식 문법 오류</h4>
      <p class="text-sm" style="color:var(--text-primary); line-height:1.4; margin-bottom:0;">
        ${escapeHtml(err.message)}
      </p>
    `;
  }
}

