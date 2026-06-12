// ==========================================
// 3-2. 수신 알림 로그 조회 및 조작 로직 (notification_logs.js)
// ==========================================

// 수신 로그 탭 데이터 로드
// 요약: Home Assistant/Android로부터 수신된 알림 이력 데이터를 가져와 카드 그리드 형태로 렌더링하고, title과 text를 구분하여 보여줍니다.
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
