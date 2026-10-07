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
            <span class="tx-pay-method">우선순위 ${rule.priority ?? 100}</span>
            <span class="tx-pay-method">${rule.source || 'USER'}</span>
            <span class="badge-status ${Number(rule.enabled) === 0 ? 'failed' : 'success'}">${Number(rule.enabled) === 0 ? '비활성' : '활성'}</span>
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
  document.getElementById('rule-pay-type').value = rule ? (rule.pay_type || 'CREDIT') : 'CREDIT';
  document.getElementById('rule-priority').value = rule ? (rule.priority ?? 100) : 50;
  document.getElementById('rule-enabled').checked = rule ? Number(rule.enabled) !== 0 : true;
  document.getElementById('rule-source').value = rule ? (rule.source || 'USER') : 'USER';
  
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

    const payType = document.getElementById('rule-pay-type').value;

    const res = await fetch('api/parse-test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, pattern, category, pay_method: payMethod, pay_type: payType, type, package: document.getElementById('test-package').value.trim() })
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
      
      const payTypeMap = {
        'CREDIT': '💳 신용',
        'CHECK': '🏦 체크',
        'TRANSFER': '💸 이체',
        'CASH': '💵 현금'
      };
      document.getElementById('result-val-paytype').textContent = payTypeMap[r.payment_type] || r.payment_type || '--';
      
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

      const showFooter = true;
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

  // 알림 텍스트를 분석하여 수입 여부 감지
  const isIncome = /입금|환불|입금완료|수입|저축|급여|이자/.test(log.raw_text) && !/출금|송금|지출|결제|승인|사용|신용|체크/.test(log.raw_text);
  const type = isIncome ? 'INCOME' : 'EXPENSE';
  document.getElementById('tx-type').value = type;
  document.getElementById('transaction-modal-title').textContent = type === 'INCOME' ? '수동 수입 추가' : '수동 지출 추가';
  updateCategorySelect('#tx-category', type);

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
// Share the validated add-on generator; do not maintain a separate UI regex algorithm.
// Related: parser_policy.js, parser/pattern_generator.js, android_spendlog/tools/sync_parser.cjs.
async function autoGeneratePattern(silent = false) {
  const text = document.getElementById('test-text').value.trim();
  const pattern = window.SpendLogParser.generatePatternFromText(text);
  if (!pattern) { if (!silent) alert('유효한 거래금액을 포함한 패턴을 생성하지 못했습니다.'); return; }
  const normalized = text.replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '').replace(/\[Web발신\]\s*/i, '');
  const groups = new RegExp(pattern, 's').exec(normalized).groups || {};
  const blocks = [];
  if (groups.payMethod) blocks.push({ type: '카드명/은행명', value: groups.payMethod });
  if (groups.payType) blocks.push({ type: '결제방식', value: groups.payType });
  let selectedProvider = document.getElementById('rule-pay-method').value;
  const packageInput = document.getElementById('test-package');
  if (packageInput && packageInput.value.trim()) {
    try {
      const mappings = await fetch('api/package_pay_methods').then(response => response.json());
      const mapped = mappings.find(row => row.package === packageInput.value.trim());
      if (mapped && mapped.pay_method) selectedProvider = mapped.pay_method;
    } catch (_) { /* Keep explicit provider evidence when package lookup is unavailable. */ }
  }
  applySuggestedPattern(pattern, text, blocks, silent);
  // Reparse generated captures without carrying an old credit default into a new rule.
  // Related: parser/payment_resolver.js, parser_policy.js, app.js rule form.
  const provider = selectedProvider && selectedProvider !== '_AUTO_MAPPING_' ? selectedProvider : groups.payMethod || '_AUTO_MAPPING_';
  const result = window.SpendLogParser.parseNotification(text, [{ pattern, pay_method: provider, type: document.getElementById('rule-type').value }]);
  document.getElementById('rule-pay-type').value = result ? result.payment_type : '';
  if (result) {
    document.getElementById('rule-type').value = result.type;
    const methodSelect = document.getElementById('rule-pay-method');
    if (Array.from(methodSelect.options).some(option => option.value === result.pay_method)) methodSelect.value = result.pay_method;
    const category = window.SpendLogParser.resolveAutomaticAtmCategory('', text, result.type, result.merchant, result.pay_method);
    if (typeof updateCategorySelect === 'function') updateCategorySelect('#rule-category', result.type, category);
  } else if (!silent) alert('결제방식을 확인할 수 없습니다. 결제 방법을 선택한 뒤 테스트해 주세요.');
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

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000); // 30초 타임아웃 제한

  try {
    aiGenBtn.disabled = true;
    aiGenBtn.innerHTML = '<i data-lucide="loader" class="animate-spin" style="width:14px;height:14px;"></i> 생성 중...';
    lucide.createIcons();

    const res = await fetch('api/rules/ai-generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: controller.signal
    }).then(r => r.json());

    clearTimeout(timeoutId);

    if (res.success && res.pattern) {
      const patternInput = document.getElementById('test-pattern');
      const rulePatternInput = document.getElementById('rule-pattern');
      if (patternInput) patternInput.value = res.pattern;
      if (rulePatternInput) rulePatternInput.value = res.pattern;

      // AI가 추출한 결제정보 동기화 (결제수단, 결제타입, 지출/수입 구분)
      if (res.pay_method) {
        const payMethodSelect = document.getElementById('rule-pay-method');
        if (payMethodSelect) {
          let hasOption = Array.from(payMethodSelect.options).some(opt => opt.value === res.pay_method);
          if (!hasOption && res.pay_method !== '_AUTO_MAPPING_') {
            const opt = document.createElement('option');
            opt.value = res.pay_method;
            opt.text = res.pay_method;
            payMethodSelect.add(opt);
          }
          payMethodSelect.value = res.pay_method;
        }
      }

      if (res.pay_type) {
        const payTypeSelect = document.getElementById('rule-pay-type');
        if (payTypeSelect) {
          payTypeSelect.value = res.pay_type;
        }
      }

      if (res.type) {
        const typeSelect = document.getElementById('rule-type');
        if (typeSelect) {
          typeSelect.value = res.type;
          if (typeof updateCategorySelect === 'function') {
            updateCategorySelect('#rule-category', res.type, '');
          }
        }
      }

      // 규칙 이름 자동 추천
      const ruleNameEl = document.getElementById('rule-name');
      if (ruleNameEl && (!ruleNameEl.value || ruleNameEl.value === 'AI 생성 규칙')) {
        let tempMerchant = 'AI';
        try {
          const match = new RegExp(res.pattern).exec(text);
          if (match && match.groups && (match.groups.merchant || match.groups.usage)) {
            tempMerchant = match.groups.merchant || match.groups.usage;
          }
        } catch (e) {
          console.warn('Regex exec failed for name recommendation:', e);
        }
        
        let suffix = '지출';
        if (res.type === 'INCOME') {
          suffix = '수입';
        } else {
          if (res.pay_type === 'CHECK' || text.includes('체크')) {
            suffix = '체크';
          } else if (res.pay_type === 'CREDIT' || text.includes('신용') || text.includes('카드')) {
            suffix = '신용';
          }
        }
        ruleNameEl.value = `${tempMerchant.trim()} ${suffix} (AI)`;
      }

      // 규칙 생성 카드창이 안 열려있으면 강제로 활성화
      const formCard = document.getElementById('rule-form-card');
      if (formCard && formCard.style.display === 'none') {
        loadRuleToEditor(null);
        if (patternInput) rulePatternInput.value = patternInput.value;
        if (res.pay_method) {
          const pmSel = document.getElementById('rule-pay-method');
          if (pmSel) {
            let hasOpt = Array.from(pmSel.options).some(o => o.value === res.pay_method);
            if (!hasOpt && res.pay_method !== '_AUTO_MAPPING_') {
              const opt = document.createElement('option');
              opt.value = res.pay_method; opt.text = res.pay_method; pmSel.add(opt);
            }
            pmSel.value = res.pay_method;
          }
        }
        if (res.pay_type) {
          const ptSel = document.getElementById('rule-pay-type');
          if (ptSel) ptSel.value = res.pay_type;
        }
        if (res.type) {
          const tSel = document.getElementById('rule-type');
          if (tSel) {
            tSel.value = res.type;
            if (typeof updateCategorySelect === 'function') {
              updateCategorySelect('#rule-category', res.type, '');
            }
          }
        }
      }

      alert('AI가 알림 내용을 완벽히 파싱할 수 있는 정규식 패턴을 생성했습니다! 바로 [테스트 실행]을 클릭해 정상 작동하는지 검증해 보세요.');
    } else {
      alert('AI 패턴 생성 실패: ' + (res.error || '알 수 없는 오류'));
    }
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      alert('AI 패턴 생성 실패: 요청 시간이 초과되었습니다. AI 서버의 네트워크 상태를 점검해 주세요.');
    } else {
      alert('AI 패턴 생성 중 오류 발생: ' + err.message);
    }
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
