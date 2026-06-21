// ==========================================
// 5. 설정 탭 로직
// ==========================================

// 설정 화면 내부 서브 탭 관련 바인딩 상태
let isSettingsSubTabInitialized = false;

function initSettingsSubTabs() {
  if (isSettingsSubTabInitialized) return;
  
  const tabBtns = document.querySelectorAll('.settings-tab-btn');
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const subtab = btn.dataset.subtab;
      switchSettingsSubTab(subtab);
    });
  });
  
  isSettingsSubTabInitialized = true;
}

function switchSettingsSubTab(subtab) {
  state.currentSettingsSubTab = subtab;

  // 버튼 액티브 클래스 조정
  document.querySelectorAll('.settings-tab-btn').forEach(btn => {
    if (btn.dataset.subtab === subtab) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  // 컨텐츠 액티브 클래스 조정
  document.querySelectorAll('.sub-settings-content').forEach(content => {
    if (content.id === `subtab-${subtab}`) {
      content.classList.add('active');
    } else {
      content.classList.remove('active');
    }
  });

  // 헤더 업데이트
  if (typeof updateHeaderTitle === 'function') {
    updateHeaderTitle('settings', subtab);
  }

  // 서브 탭별 데이터 로드
  if (subtab === 'default') {
    loadSettingsTab();
  } else if (subtab === 'balance') {
    loadBalanceSettings();
  } else if (subtab === 'ai') {
    loadAISettings();
  } else if (subtab === 'data') {
    loadDataSettings();
    lucide.createIcons();
  }
}

async function loadSettingsTab() {
  try {
    initSettingsSubTabs(); // 설정 탭 로드 시 항상 바인딩 검사
    
    // 1. HA에서 last_notification 센서 목록 조회
    let haSensors = [];
    try {
      haSensors = await fetch('api/settings/ha_notification_sensors').then(r => r.json());
    } catch (e) {
      console.warn('HA 알림 센서 목록 조회 실패 (단독 모드로 보임):', e);
    }

    const settings = await fetch('api/settings').then(r => r.json());
    const entityEl = document.getElementById('settings-ws-entity');
    const manualEl = document.getElementById('settings-ws-entity-manual');
    const budgetEl = document.getElementById('settings-budget');
    const realNameEl = document.getElementById('settings-real-name');
    const autoRuleEl = document.getElementById('settings-auto-rule');

    if (entityEl) {
      // select 박스 옵션 초기화 및 채우기
      entityEl.innerHTML = `
        <option value="">센서 선택 안함</option>
      `;
      if (Array.isArray(haSensors) && haSensors.length > 0) {
        haSensors.forEach(sensor => {
          const opt = document.createElement('option');
          opt.value = sensor.entity_id;
          opt.textContent = `${sensor.friendly_name} (${sensor.entity_id})`;
          entityEl.appendChild(opt);
        });
      }
      
      // 직접 입력 옵션 추가
      const manualOpt = document.createElement('option');
      manualOpt.value = '__MANUAL__';
      manualOpt.textContent = '✍️ 직접 입력...';
      entityEl.appendChild(manualOpt);

      const savedVal = settings.ws_sensor_entity || '';
      
      // 선택값 복원
      if (savedVal === '') {
        entityEl.value = '';
        if (manualEl) {
          manualEl.style.display = 'none';
          manualEl.value = '';
        }
      } else {
        // 이미 가져온 센서 리스트에 존재하는지 체크
        const exists = haSensors.some(s => s.entity_id === savedVal);
        if (exists) {
          entityEl.value = savedVal;
          if (manualEl) {
            manualEl.style.display = 'none';
            manualEl.value = '';
          }
        } else {
          // 리스트에 없으면 직접 입력으로 복원
          entityEl.value = '__MANUAL__';
          if (manualEl) {
            manualEl.style.display = 'block';
            manualEl.value = savedVal;
          }
        }
      }

      // change 이벤트 리스너 바인딩 (이전 핸들러 덮어쓰기 위해 onchange 사용)
      entityEl.onchange = () => {
        if (entityEl.value === '__MANUAL__') {
          if (manualEl) {
            manualEl.style.display = 'block';
            manualEl.focus();
          }
        } else {
          if (manualEl) {
            manualEl.style.display = 'none';
            manualEl.value = '';
          }
        }
      };
    }

    if (budgetEl) budgetEl.value = settings.monthly_budget || 500000;
    if (realNameEl) realNameEl.value = settings.user_real_name || '';
    if (autoRuleEl) autoRuleEl.checked = settings.auto_rule_generation === 'true';
    const defaultUsdRateEl = document.getElementById('settings-default-usd-rate');
    if (defaultUsdRateEl) defaultUsdRateEl.value = settings.default_usd_exchange_rate || 1350;
    
    const themeEl = document.getElementById('settings-theme');
    if (themeEl) themeEl.value = settings.theme || 'dark';

  } catch (err) {
    console.error('설정 로드 실패:', err);
  }
}

let isAssetModalBound = false;

function bindAssetModalEvents() {
  if (isAssetModalBound) return;
  isAssetModalBound = true;

  const modal = document.getElementById('asset-modal');
  const form = document.getElementById('asset-modal-form');
  const typeSelect = document.getElementById('asset-modal-type');
  const bankGroup = document.getElementById('asset-field-bank-group');
  const cardGroup = document.getElementById('asset-field-card-group');
  
  // 유형 선택 시 필드 토글
  typeSelect.addEventListener('change', () => {
    if (typeSelect.value === 'card') {
      bankGroup.style.display = 'none';
      cardGroup.style.display = 'flex';
    } else {
      bankGroup.style.display = 'block';
      cardGroup.style.display = 'none';
    }
  });

  // 닫기 및 취소 버튼
  document.getElementById('asset-modal-close').addEventListener('click', closeModal);
  document.getElementById('asset-modal-cancel').addEventListener('click', closeModal);
  
  function closeModal() {
    modal.classList.remove('active');
  }

  // 폼 제출
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const mode = document.getElementById('asset-modal-mode').value;
    const originalName = document.getElementById('asset-modal-original-name').value;
    const name = document.getElementById('asset-modal-name').value.trim();
    const type = typeSelect.value;

    if (!name) {
      alert('자산/결제수단명을 입력해주세요.');
      return;
    }

    try {
      // 1. 결제수단 추가 API 호출 (pay_methods 테이블)
      if (mode === 'add' || (mode === 'edit' && originalName !== name)) {
        await fetch('api/pay_methods', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name })
        });
        
        // 기존 결제수단명이 변경된 경우, 이전 이름의 데이터 삭제 처리
        if (mode === 'edit' && originalName !== name) {
          await fetch(`api/pay_methods/${encodeURIComponent(originalName)}`, {
            method: 'DELETE'
          });
        }
      }

      // 2. settings 설정 객체 로드 및 업데이트
      const settings = await fetch('api/settings').then(r => r.json());
      
      let initialBalances = settings.initial_balances ? (typeof settings.initial_balances === 'string' ? JSON.parse(settings.initial_balances) : settings.initial_balances) : {};
      let initialPoints = settings.initial_points ? (typeof settings.initial_points === 'string' ? JSON.parse(settings.initial_points) : settings.initial_points) : {};
      let cardPerformanceGoals = settings.card_performance_goals ? (typeof settings.card_performance_goals === 'string' ? JSON.parse(settings.card_performance_goals) : settings.card_performance_goals) : {};
      let cardPerformanceDays = settings.card_performance_days ? (typeof settings.card_performance_days === 'string' ? JSON.parse(settings.card_performance_days) : settings.card_performance_days) : {};
      let cardPaymentDays = settings.card_payment_days ? (typeof settings.card_payment_days === 'string' ? JSON.parse(settings.card_payment_days) : settings.card_payment_days) : {};

      if (type === 'bank') {
        const initBal = parseInt(document.getElementById('asset-modal-initial-balance').value, 10) || 0;
        initialBalances[name] = initBal;
        
        // 카드 관련 값 제거
        delete initialPoints[name];
        delete cardPerformanceGoals[name];
        delete cardPerformanceDays[name];
        delete cardPaymentDays[name];
      } else {
        const initPt = parseInt(document.getElementById('asset-modal-initial-point').value, 10) || 0;
        const perfGoal = parseInt(document.getElementById('asset-modal-performance-goal').value, 10) || 0;
        const perfDay = Math.max(1, Math.min(28, parseInt(document.getElementById('asset-modal-performance-day').value, 10) || 1));
        const payDay = Math.max(1, Math.min(28, parseInt(document.getElementById('asset-modal-payment-day').value, 10) || 14));

        initialPoints[name] = initPt;
        cardPerformanceGoals[name] = perfGoal;
        cardPerformanceDays[name] = perfDay;
        cardPaymentDays[name] = payDay;
        
        // 계좌 관련 값 제거
        delete initialBalances[name];
      }

      if (mode === 'edit' && originalName !== name) {
        delete initialBalances[originalName];
        delete initialPoints[originalName];
        delete cardPerformanceGoals[originalName];
        delete cardPerformanceDays[originalName];
        delete cardPaymentDays[originalName];
      }

      const res = await fetch('api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          initial_balances: JSON.stringify(initialBalances),
          initial_points: JSON.stringify(initialPoints),
          card_performance_goals: JSON.stringify(cardPerformanceGoals),
          card_performance_days: JSON.stringify(cardPerformanceDays),
          card_payment_days: JSON.stringify(cardPaymentDays)
        })
      });

      if (!res.ok) {
        throw new Error('설정 저장 중 오류가 발생했습니다.');
      }

      const data = await res.json();
      if (data.success) {
        modal.classList.remove('active');
        await loadMetadata();
        await loadBalanceSettings();
        if (state.currentTab === 'dashboard') {
          loadDashboardData();
        }
      } else {
        alert('저장 실패: ' + (data.error || '알 수 없는 오류'));
      }

    } catch (err) {
      alert('저장 중 에러 발생: ' + err.message);
    }
  });
}

function getBillingCycleText(startDay) {
  startDay = parseInt(startDay, 10) || 1;
  if (startDay === 1) {
    return '매달 1일 ~ 말일';
  } else {
    const endDay = startDay - 1;
    return `전월 ${startDay}일 ~ 당월 ${endDay}일`;
  }
}

async function loadBalanceSettings() {
  try {
    bindAssetModalEvents();

    const settings = await fetch('api/settings').then(r => r.json());
    
    const grid = document.getElementById('settings-assets-grid');
    if (!grid) return;
    grid.innerHTML = '';

    let initialBalances = {};
    if (settings.initial_balances) {
      try {
        initialBalances = typeof settings.initial_balances === 'string' ? JSON.parse(settings.initial_balances) : settings.initial_balances;
      } catch (e) { initialBalances = {}; }
    }
    let initialPoints = {};
    if (settings.initial_points) {
      try {
        initialPoints = typeof settings.initial_points === 'string' ? JSON.parse(settings.initial_points) : settings.initial_points;
      } catch (e) { initialPoints = {}; }
    }
    let cardPerformanceGoals = {};
    if (settings.card_performance_goals) {
      try {
        cardPerformanceGoals = typeof settings.card_performance_goals === 'string' ? JSON.parse(settings.card_performance_goals) : settings.card_performance_goals;
      } catch (e) { cardPerformanceGoals = {}; }
    }
    let cardPerformanceDays = {};
    if (settings.card_performance_days) {
      try {
        cardPerformanceDays = typeof settings.card_performance_days === 'string' ? JSON.parse(settings.card_performance_days) : settings.card_performance_days;
      } catch (e) { cardPerformanceDays = {}; }
    }
    let cardPaymentDays = {};
    if (settings.card_payment_days) {
      try {
        cardPaymentDays = typeof settings.card_payment_days === 'string' ? JSON.parse(settings.card_payment_days) : settings.card_payment_days;
      } catch (e) { cardPaymentDays = {}; }
    }

    let payMethods = state.payMethods;
    if (!payMethods || payMethods.length === 0) {
      payMethods = await fetch('api/pay_methods').then(r => r.json());
      state.payMethods = payMethods;
    }

    const displayMethods = payMethods.filter(pm => pm.name !== '계좌이체' && pm.name !== '신용카드' && pm.name !== '체크카드');

    if (displayMethods.length === 0) {
      grid.innerHTML = '<p class="text-secondary text-xs" style="grid-column: 1/-1; text-align:center; padding:2rem;">등록된 결제 수단이 없습니다. 자산/카드 추가 버튼을 눌러 등록하세요.</p>';
    } else {
      displayMethods.forEach(pm => {
        const name = pm.name;
        const isCard = name.includes('카드') || name.includes('페이') || name.includes('머니');
        
        const initBal = initialBalances[name] || 0;
        const initPt = initialPoints[name] || 0;
        const perfGoal = cardPerformanceGoals[name] || 0;
        const perfDay = cardPerformanceDays[name] || 1;
        const payDay = cardPaymentDays[name] || 14;

        const cardEl = document.createElement('div');
        cardEl.className = `asset-card-item glass ${isCard ? 'card-type' : 'bank-type'}`;
        cardEl.style.cssText = 'padding: 1.25rem; border-radius: 12px; display: flex; flex-direction: column; justify-content: space-between; position: relative; min-height: 140px; box-shadow: 0 4px 15px rgba(0,0,0,0.15); transition: transform 0.2s;';
        
        cardEl.onmouseover = () => { cardEl.style.transform = 'translateY(-2px)'; };
        cardEl.onmouseout = () => { cardEl.style.transform = 'translateY(0)'; };

        cardEl.innerHTML = `
          <button class="btn-delete-asset" data-name="${name}" style="position: absolute; top: 0.75rem; right: 0.75rem; background: none; border: none; color: #f43f5e; opacity: 0.6; cursor: pointer; padding: 0.25rem; display: flex; align-items: center; justify-content: center; z-index: 10;">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-trash-2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>
          </button>

          <div class="asset-card-click-area" style="cursor: pointer; flex: 1; display: flex; flex-direction: column; justify-content: space-between;">
            <div style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.75rem;">
              <div style="background: ${isCard ? 'rgba(99, 102, 241, 0.15)' : 'rgba(16, 185, 129, 0.15)'}; color: ${isCard ? '#818cf8' : '#34d399'}; width: 36px; height: 36px; border-radius: 8px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                ${isCard ? 
                  `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-credit-card"><rect width="20" height="14" rx="2" y="5" x="2"/><line x1="2" x2="22" y1="10" y2="10"/></svg>` : 
                  `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-landmark"><line x1="3" x2="21" y1="22" y2="22"/><line x1="6" x2="6" y1="18" y2="11"/><line x1="10" x2="10" y1="18" y2="11"/><line x1="14" x2="14" y1="18" y2="11"/><line x1="18" x2="18" y1="18" y2="11"/><polygon points="12 2 3 7 21 7"/></svg>`
                }
              </div>
              <div style="display: flex; flex-direction: column; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                <span class="asset-card-name" style="font-weight: 600; font-size: 0.9rem; color: var(--text-color);">${name}</span>
                <span style="font-size: 0.7rem; color: ${isCard ? '#818cf8' : '#34d399'}; font-weight: 600; margin-top: 1px;">
                  ${isCard ? '카드' : '계좌'}
                </span>
              </div>
            </div>

            <div style="display: flex; flex-direction: column; gap: 0.35rem; border-top: 1px solid rgba(255, 255, 255, 0.05); padding-top: 0.5rem; flex: 1; justify-content: center;">
              ${isCard ? `
                <div style="display: flex; justify-content: space-between; font-size: 0.75rem; color: var(--text-secondary);">
                  <span>포인트 한도</span>
                  <span style="font-weight: 600; color: var(--text-color);">${formatCurrency(initPt)}</span>
                </div>
                <div style="display: flex; justify-content: space-between; font-size: 0.75rem; color: var(--text-secondary);">
                  <span>목표 실적</span>
                  <span style="font-weight: 600; color: var(--text-color);">${formatCurrency(perfGoal)}</span>
                </div>
                <div style="display: flex; justify-content: space-between; font-size: 0.75rem; color: var(--text-secondary);">
                  <span>결제일 / 시작일</span>
                  <span style="font-weight: 600; color: var(--text-color);">${payDay}일 / ${perfDay}일</span>
                </div>
                <div style="display: flex; justify-content: space-between; font-size: 0.68rem; color: #a5b4fc; background: rgba(99, 102, 241, 0.06); padding: 0.15rem 0.4rem; border-radius: 4px; margin-top: 0.2rem;">
                  <span>이용기간 범위</span>
                  <span style="font-weight: 500;">${getBillingCycleText(perfDay)}</span>
                </div>
              ` : `
                <div style="display: flex; justify-content: space-between; font-size: 0.75rem; color: var(--text-secondary);">
                  <span>초기 잔액</span>
                  <span style="font-weight: 600; color: var(--text-color);">${formatCurrency(initBal)}</span>
                </div>
              `}
            </div>
          </div>
        `;
        
        cardEl.querySelector('.asset-card-click-area').addEventListener('click', () => {
          openAssetModal('edit', {
            name,
            isCard,
            initBal,
            initPt,
            perfGoal,
            perfDay,
            payDay
          });
        });

        const delBtn = cardEl.querySelector('.btn-delete-asset');
        delBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (confirm(`정말 '${name}' 자산/결제수단을 삭제하시겠습니까? 관련 설정도 함께 삭제됩니다.`)) {
            try {
              const res = await fetch(`api/pay_methods/${encodeURIComponent(name)}`, {
                method: 'DELETE'
              });
              if (res.ok) {
                await loadMetadata();
                await loadBalanceSettings();
                if (state.currentTab === 'dashboard') {
                  loadDashboardData();
                }
              } else {
                alert('삭제 실패');
              }
            } catch (err) {
              alert('삭제 에러: ' + err.message);
            }
          }
        });

        grid.appendChild(cardEl);
      });
    }

    const addBtn = document.getElementById('btn-add-asset');
    if (addBtn) {
      addBtn.onclick = () => {
        openAssetModal('add');
      };
    }

  } catch (err) {
    console.error('잔액/포인트/실적 설정 로드 실패:', err);
  }
}

function openAssetModal(mode, data = {}) {
  const modal = document.getElementById('asset-modal');
  const title = document.getElementById('asset-modal-title');
  const form = document.getElementById('asset-modal-form');
  
  const modeInput = document.getElementById('asset-modal-mode');
  const origNameInput = document.getElementById('asset-modal-original-name');
  const nameInput = document.getElementById('asset-modal-name');
  const typeSelect = document.getElementById('asset-modal-type');
  
  const initBalInput = document.getElementById('asset-modal-initial-balance');
  const initPtInput = document.getElementById('asset-modal-initial-point');
  const goalInput = document.getElementById('asset-modal-performance-goal');
  const perfDayInput = document.getElementById('asset-modal-performance-day');
  const payDayInput = document.getElementById('asset-modal-payment-day');
  
  const bankGroup = document.getElementById('asset-field-bank-group');
  const cardGroup = document.getElementById('asset-field-card-group');

  form.reset();
  
  if (mode === 'add') {
    title.textContent = '자산 및 결제수단 추가';
    modeInput.value = 'add';
    origNameInput.value = '';
    typeSelect.disabled = false;
    
    typeSelect.value = 'bank';
    bankGroup.style.display = 'block';
    cardGroup.style.display = 'none';
  } else {
    title.textContent = '자산 및 결제수단 편집';
    modeInput.value = 'edit';
    origNameInput.value = data.name || '';
    nameInput.value = data.name || '';
    typeSelect.value = data.isCard ? 'card' : 'bank';
    typeSelect.disabled = true;

    if (data.isCard) {
      bankGroup.style.display = 'none';
      cardGroup.style.display = 'flex';
      initPtInput.value = data.initPt || 0;
      goalInput.value = data.perfGoal || 0;
      perfDayInput.value = data.perfDay || 1;
      payDayInput.value = data.payDay || 14;
    } else {
      bankGroup.style.display = 'block';
      cardGroup.style.display = 'none';
      initBalInput.value = data.initBal || 0;
    }
  }

  modal.classList.add('active');
}

// 사용처별 카테고리 매핑 목록 로드 및 렌더링
// 요약: merchant_categories 테이블의 전체 목록을 불러와 테이블과 프리셋 뱃지를 업데이트합니다.
// 의존성: index.js의 /api/merchant_categories, /api/merchant_categories/seed-presets API와 연결됩니다.
async function loadMerchantCategories() {
  try {
    // 1. 카테고리 셀렉트 옵션 채우기 (지출용만)
    const mcatSel = document.getElementById('mcat-category');
    if (mcatSel) {
      mcatSel.innerHTML = '';
      const expenseCats = state.categories.filter(c => c.type === 'EXPENSE');
      expenseCats.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.name;
        opt.textContent = c.name;
        mcatSel.appendChild(opt);
      });
    }

    // 2. 매핑 테이블 렌더링
    const response = await fetch('api/merchant_categories');
    const list = await response.json();
    const tbody = document.getElementById('merchant-category-table-body');
    if (tbody) {
      tbody.innerHTML = '';
      if (list.length === 0) {
        tbody.innerHTML = `
          <tr>
            <td colspan="3" class="text-secondary" style="text-align: center; padding: 1.5rem; font-size: 0.85rem;">
              등록된 사용처별 카테고리 설정이 없습니다.
            </td>
          </tr>
        `;
      } else {
        list.forEach(item => {
          const tr = document.createElement('tr');
          tr.style.borderBottom = '1px solid var(--inner-border-light)';
          
          // 카테고리 배지 렌더링을 위해 색상 맵 활용
          const catMeta = state.categoryMap[item.category] || { color: '#868e96' };
          
          tr.innerHTML = `
            <td data-label="사용처명" style="padding: 10px 12px; font-weight: 500; color: var(--text-color);">${item.merchant}</td>
            <td data-label="매핑 카테고리" style="padding: 10px 12px;">
              <span class="badge" style="background: ${catMeta.color}15; color: ${catMeta.color}; border: 1px solid ${catMeta.color}30; padding: 4px 8px; border-radius: 4px; font-size: 0.75rem;">
                ${item.category}
              </span>
            </td>
            <td data-label="동작" style="padding: 10px 12px; text-align: center; display: flex; justify-content: center; gap: 4px;">
              <button class="btn btn-edit-merchant-cat" style="background: none; border: none; color: var(--text-muted); cursor: pointer; padding: 4px; border-radius: 4px; transition: all 0.2s;">
                <i data-lucide="edit-2" style="width: 14px; height: 14px;"></i>
              </button>
              <button class="btn btn-delete-merchant-cat" data-id="${item.id}" style="background: none; border: none; color: var(--text-muted); cursor: pointer; padding: 4px; border-radius: 4px; transition: all 0.2s;">
                <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i>
              </button>
            </td>
          `;
          
          // 수정 이벤트 핸들러 바인딩
          const editBtn = tr.querySelector('.btn-edit-merchant-cat');
          editBtn.addEventListener('click', () => {
            const idInput = document.getElementById('mcat-id');
            const merchantInput = document.getElementById('mcat-merchant');
            const catSelect = document.getElementById('mcat-category');
            const submitBtn = document.getElementById('btn-mcat-submit');
            const cancelBtn = document.getElementById('btn-mcat-cancel');
            
            if (idInput) idInput.value = item.id;
            if (merchantInput) merchantInput.value = item.merchant;
            if (catSelect) catSelect.value = item.category;
            if (submitBtn) submitBtn.textContent = '수정 완료';
            if (cancelBtn) cancelBtn.style.display = 'inline-block';
            
            // 상단 입력창으로 스크롤 이동
            merchantInput.focus();
          });

          // 삭제 이벤트 핸들러 바인딩
          const delBtn = tr.querySelector('.btn-delete-merchant-cat');
          delBtn.addEventListener('click', async () => {
            if (confirm(`'${item.merchant}' 사용처 카테고리 매핑을 삭제하시겠습니까?`)) {
              try {
                const res = await fetch(`api/merchant_categories/${item.id}`, { method: 'DELETE' }).then(r => r.json());
                if (res.success) {
                  loadMerchantCategories();
                }
              } catch (err) {
                alert('삭제 실패: ' + err.message);
              }
            }
          });

          tbody.appendChild(tr);
        });
        
        // lucide 아이콘 생성
        lucide.createIcons();
      }
    }

    // 프리셋 현황 뱃지 업데이트
    updatePresetBadge(list);

    // 추가: 패키지별 결제수단 목록 로딩
    await loadPackagePayMethods();

  } catch (err) {
    console.error('사용처별 카테고리 목록 로드 실패:', err);
  }
}

// 프리셋 현황 뱃지: 전체 목록에서 등록 수를 표시합니다.
// 의존성: index.html의 #merchant-preset-badge 요소와 연결됩니다.
function updatePresetBadge(list) {
  const badge = document.getElementById('merchant-preset-badge');
  if (!badge) return;
  badge.textContent = `총 ${list.length}개 등록됨`;
}

// 프랜차이즈 프리셋 일괄 적용 함수
// 요약: /api/merchant_categories/seed-presets?force=true API를 호출합니다.
//       신규 항목 추가 + 기존 프리셋 항목의 카테고리도 최신 분류로 업데이트합니다.
//       사용자가 직접 등록한 항목(프리셋 키워드가 아닌 항목)은 건드리지 않습니다.
// 의존성: index.html의 #btn-seed-presets 버튼 클릭 이벤트에서 호출됩니다.
async function applyFranchisePresets() {
  const btn = document.getElementById('btn-seed-presets');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '적용 중...';
  }
  try {
    const res = await fetch('api/merchant_categories/seed-presets?force=true', { method: 'POST' }).then(r => r.json());
    if (res.success) {
      const parts = [];
      if (res.inserted > 0) parts.push(`신규 ${res.inserted}개 추가`);
      if (res.updated > 0) parts.push(`기존 ${res.updated}개 카테고리 업데이트`);
      if (res.txUpdated > 0) parts.push(`기존 거래내역 ${res.txUpdated}건 소급 재분류 완료`);
      const detail = parts.length > 0 ? parts.join(', ') : '변경 없음';
      const msg = `✅ 프랜차이즈 프리셋 적용 완료 (전체 ${res.total}개)\n${detail}`;
      alert(msg);
      loadMerchantCategories();
    } else {
      alert('프리셋 적용 실패: ' + (res.error || '알 수 없는 오류'));
    }
  } catch (err) {
    alert('프리셋 적용 중 오류: ' + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i data-lucide="zap" style="width:14px;height:14px;display:inline-block;vertical-align:middle;margin-right:4px;"></i> 프랜차이즈 프리셋 적용';
      lucide.createIcons();
    }
  }
}

// 패키지별 결제수단 자동 매핑 로드 및 렌더링
// 요약: 앱 패키지명(package)과 결제수단 간의 매핑 리스트를 백엔드로부터 가져와 셀렉트박스와 테이블 뷰에 렌더링합니다.
// 의존성: public/index.html의 pkm-pay-method 셀렉트박스 및 package-paymethod-table-body 테이블과 연계됩니다.
async function loadPackagePayMethods() {
  try {
    // 1. 결제수단 셀렉트 옵션 채우기
    const pkmSel = document.getElementById('pkm-pay-method');
    if (pkmSel) {
      pkmSel.innerHTML = '';
      state.payMethods.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.name;
        opt.textContent = p.name;
        pkmSel.appendChild(opt);
      });
    }

    // 2. 매핑 테이블 렌더링
    const response = await fetch('api/package_pay_methods');
    const list = await response.json();
    const tbody = document.getElementById('package-paymethod-table-body');
    if (tbody) {
      tbody.innerHTML = '';
      if (list.length === 0) {
        tbody.innerHTML = `
          <tr>
            <td colspan="3" class="text-secondary" style="text-align: center; padding: 1.5rem; font-size: 0.85rem;">
              등록된 패키지별 결제수단 설정이 없습니다.
            </td>
          </tr>
        `;
        return;
      }

      list.forEach(item => {
        const tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid var(--inner-border-light)';
        
        tr.innerHTML = `
          <td data-label="앱 패키지명(Package)" style="padding: 10px 12px; font-weight: 500; color: var(--text-color); font-family: monospace; font-size: 0.85rem;">${item.package}</td>
          <td data-label="매핑 결제수단" style="padding: 10px 12px;">
            <span class="tx-pay-method">
              ${item.pay_method}
            </span>
          </td>
          <td data-label="동작" style="padding: 10px 12px; text-align: center; display: flex; justify-content: center; gap: 4px;">
            <button class="btn btn-edit-package-pay-method" style="background: none; border: none; color: var(--text-muted); cursor: pointer; padding: 4px; border-radius: 4px; transition: all 0.2s;">
              <i data-lucide="edit-2" style="width: 14px; height: 14px;"></i>
            </button>
            <button class="btn btn-delete-package-pay-method" data-id="${item.id}" style="background: none; border: none; color: var(--text-muted); cursor: pointer; padding: 4px; border-radius: 4px; transition: all 0.2s;">
              <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i>
            </button>
          </td>
        `;
        
        // 수정 이벤트 핸들러 바인딩
        const editBtn = tr.querySelector('.btn-edit-package-pay-method');
        editBtn.addEventListener('click', () => {
          const idInput = document.getElementById('pkm-id');
          const packageInput = document.getElementById('pkm-package');
          const payMethodSelect = document.getElementById('pkm-pay-method');
          const submitBtn = document.getElementById('btn-pkm-submit');
          const cancelBtn = document.getElementById('btn-pkm-cancel');
          
          if (idInput) idInput.value = item.id;
          if (packageInput) packageInput.value = item.package;
          if (payMethodSelect) payMethodSelect.value = item.pay_method;
          if (submitBtn) submitBtn.textContent = '수정 완료';
          if (cancelBtn) cancelBtn.style.display = 'inline-block';
          
          // 상단 입력창으로 스크롤 이동
          packageInput.focus();
        });

        // 삭제 이벤트 핸들러 바인딩
        const delBtn = tr.querySelector('.btn-delete-package-pay-method');
        delBtn.addEventListener('click', async () => {
          if (confirm(`'${item.package}' 패키지 결제수단 매핑을 삭제하시겠습니까?`)) {
            try {
              const res = await fetch(`api/package_pay_methods/${item.id}`, { method: 'DELETE' }).then(r => r.json());
              if (res.success) {
                loadPackagePayMethods();
              }
            } catch (err) {
              alert('삭제 실패: ' + err.message);
            }
          }
        });

        tbody.appendChild(tr);
      });
      
      // lucide 아이콘 생성
      lucide.createIcons();
    }
  } catch (err) {
    console.error('패키지별 결제수단 목록 로드 실패:', err);
  }
}

async function loadDataSettings() {
  try {
    const settings = await fetch('api/settings').then(r => r.json());
    
    // 자동 백업 시간 및 요일 스케줄러 바인딩
    const autoBackupEl = document.getElementById('settings-auto-backup');
    const backupTimeEl = document.getElementById('settings-backup-time');
    const backupDaysEls = document.querySelectorAll('.settings-backup-day');
    const scheduleOptionsContainer = document.getElementById('auto-backup-schedule-options');

    if (autoBackupEl) {
      autoBackupEl.checked = settings.auto_backup === 'true';
      if (scheduleOptionsContainer) {
        scheduleOptionsContainer.style.display = autoBackupEl.checked ? 'flex' : 'none';
      }
      autoBackupEl.onchange = () => {
        if (scheduleOptionsContainer) {
          scheduleOptionsContainer.style.display = autoBackupEl.checked ? 'flex' : 'none';
        }
      };
    }

    if (backupTimeEl) {
      backupTimeEl.value = settings.backup_time || '00:00';
    }

    if (backupDaysEls.length > 0) {
      const activeDays = (settings.backup_days || '0,1,2,3,4,5,6').split(',');
      backupDaysEls.forEach(el => {
        el.checked = activeDays.includes(el.value);
      });
    }

    // [네트워크 백업 설정 데이터 연동 및 이벤트 바인딩]
    const netTypeEl = document.getElementById('settings-network-backup-type');
    const netPathEl = document.getElementById('settings-network-backup-path');
    const netUrlEl = document.getElementById('settings-network-webdav-url');
    const netUserEl = document.getElementById('settings-network-webdav-user');
    const netPassEl = document.getElementById('settings-network-webdav-pass');

    const pathGroup = document.getElementById('network-path-group');
    const webdavGroup = document.getElementById('network-webdav-group');

    if (netTypeEl) {
      netTypeEl.value = settings.network_backup_type || 'path';
      
      const toggleGroups = (type) => {
        if (pathGroup) pathGroup.style.display = type === 'path' ? 'block' : 'none';
        if (webdavGroup) webdavGroup.style.display = type === 'webdav' ? 'flex' : 'none';
      };

      toggleGroups(netTypeEl.value);

      netTypeEl.onchange = () => {
        toggleGroups(netTypeEl.value);
      };
    }

    // HA 네트워크 마운트 목록 불러오기 및 드롭다운 연동
    const haMountsDropdown = document.getElementById('settings-ha-mounts-dropdown');
    const haMountsContainer = document.getElementById('ha-mounts-selector-container');
    if (haMountsDropdown && haMountsContainer) {
      (async () => {
        try {
          const token = localStorage.getItem('ab_token') || sessionStorage.getItem('ab_token') || '';
          const mounts = await fetch('api/settings/ha_mounts', {
            headers: {
              'Authorization': token
            }
          }).then(r => r.json());

          if (Array.isArray(mounts) && mounts.length > 0) {
            haMountsContainer.style.display = 'block';
            mounts.forEach(mount => {
              const opt = document.createElement('option');
              const mountPath = `/share/${mount.name}`;
              opt.value = mountPath;
              opt.textContent = `${mount.name} (${mount.type.toUpperCase()} ➔ ${mountPath})`;
              haMountsDropdown.appendChild(opt);
            });

            if (settings.network_backup_path) {
              const matched = mounts.some(m => `/share/${m.name}` === settings.network_backup_path);
              if (matched) {
                haMountsDropdown.value = settings.network_backup_path;
              }
            }

            haMountsDropdown.onchange = () => {
              if (haMountsDropdown.value && netPathEl) {
                netPathEl.value = haMountsDropdown.value;
              }
            };
          }
        } catch (err) {
          console.error('HA 마운트 목록 로드 에러:', err);
        }
      })();
    }

    if (netPathEl) netPathEl.value = settings.network_backup_path || '';
    if (netUrlEl) netUrlEl.value = settings.network_backup_webdav_url || '';
    if (netUserEl) netUserEl.value = settings.network_backup_webdav_username || '';
    if (netPassEl) netPassEl.value = settings.network_backup_webdav_password || '';

    const saveNetworkBackupSettings = async () => {
      // 선택된 요일 수집
      const selectedDays = [];
      document.querySelectorAll('.settings-backup-day').forEach(el => {
        if (el.checked) {
          selectedDays.push(el.value);
        }
      });

      const payload = {
        auto_backup: autoBackupEl ? autoBackupEl.checked : false,
        backup_time: backupTimeEl ? backupTimeEl.value : '00:00',
        backup_days: selectedDays.join(','),
        network_backup_enabled: autoBackupEl ? autoBackupEl.checked : false,
        network_backup_type: netTypeEl ? netTypeEl.value : 'path',
        network_backup_path: netPathEl ? netPathEl.value.trim() : '',
        network_backup_path_username: '',
        network_backup_path_password: '',
        network_backup_webdav_url: netUrlEl ? netUrlEl.value.trim() : '',
        network_backup_webdav_username: netUserEl ? netUserEl.value.trim() : '',
        network_backup_webdav_password: netPassEl ? netPassEl.value : ''
      };

      const res = await fetch('api/settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': localStorage.getItem('ab_token') || sessionStorage.getItem('ab_token') || ''
        },
        body: JSON.stringify(payload)
      }).then(r => r.json());

      if (!res.success) {
        throw new Error(res.error || '설정 저장 실패');
      }
      return res;
    };

    // 네트워크 백업 저장 폼 바인딩
    const netForm = document.getElementById('network-backup-form');
    if (netForm) {
      netForm.onsubmit = async (e) => {
        e.preventDefault();
        try {
          await saveNetworkBackupSettings();
          alert('자동 네트워크 백업 설정이 저장되었습니다.');
        } catch (err) {
          console.error('설정 저장 중 에러:', err);
          alert('설정 저장 중 오류가 발생했습니다: ' + err.message);
        }
      };
    }

    // 네트워크 백업 테스트 실행 바인딩
    const btnTest = document.getElementById('btn-test-network-backup');
    const testIndicator = document.getElementById('network-test-indicator');

    if (btnTest) {
      btnTest.onclick = async () => {
        if (btnTest.disabled) return;
        
        btnTest.disabled = true;
        if (testIndicator) testIndicator.style.display = 'inline-flex';
        try {
          // 테스트 실행 전 입력된 설정을 자동으로 먼저 저장
          await saveNetworkBackupSettings();
          
          const res = await fetch('api/settings/backups/test-network', {
            method: 'POST',
            headers: {
              'Authorization': localStorage.getItem('ab_token') || sessionStorage.getItem('ab_token') || ''
            }
          }).then(r => r.json());

          if (res.success) {
            alert(`✅ 네트워크 백업 설정이 저장되었으며 테스트에 성공했습니다!\n파일이 지정된 네트워크 저장소로 정상 전송되었습니다.\n파일명: ${res.filename}`);
          } else {
            alert('❌ 네트워크 백업 테스트 실패: ' + (res.error || '알 수 없는 전송 실패'));
          }
        } catch (err) {
          console.error('네트워크 백업 테스트 에러:', err);
          alert('❌ 네트워크 백업 저장 및 테스트 중 오류가 발생했습니다: ' + err.message);
        } finally {
          btnTest.disabled = false;
          if (testIndicator) testIndicator.style.display = 'none';
        }
      };
    }

  } catch (err) {
    console.error('데이터 설정 로드 실패:', err);
  }
}

async function loadAISettings() {
  try {
    const settings = await fetch('api/settings').then(r => r.json());

    const aiEnabledEl = document.getElementById('settings-ai-enabled');
    const aiParsingEnabledEl = document.getElementById('settings-ai-parsing-enabled');
    const aiProviderEl = document.getElementById('settings-ai-provider');
    const aiApiKeyEl = document.getElementById('settings-ai-api-key');
    const aiLocalIpEl = document.getElementById('settings-ai-local-ip');
    const aiLocalModelEl = document.getElementById('settings-ai-local-model');

    const optionsContainer = document.getElementById('ai-options-container');
    const apiKeyGroup = document.getElementById('ai-api-key-group');
    const localGroup = document.getElementById('ai-local-group');

    // 마스터 스위치 상태 변경 시 UI 제어 헬퍼
    const updateAISubFieldsVisibility = () => {
      const isMasterEnabled = aiEnabledEl && aiEnabledEl.checked;
      if (aiParsingEnabledEl) {
        aiParsingEnabledEl.disabled = !isMasterEnabled;
        if (!isMasterEnabled) {
          aiParsingEnabledEl.checked = false;
        }
      }
      if (optionsContainer) {
        optionsContainer.style.display = isMasterEnabled ? 'flex' : 'none';
      }
    };

    if (aiEnabledEl) {
      aiEnabledEl.checked = settings.ai_enabled === 'true';
      aiEnabledEl.onchange = updateAISubFieldsVisibility;
    }

    if (aiParsingEnabledEl) {
      aiParsingEnabledEl.checked = settings.ai_parsing_enabled === 'true';
    }

    // 초기 상태 반영
    updateAISubFieldsVisibility();

    if (aiProviderEl) {
      aiProviderEl.value = settings.ai_provider || 'gemini';

      const toggleProviderFields = () => {
        const provider = aiProviderEl.value;
        if (provider === 'local') {
          if (localGroup) localGroup.style.display = 'flex';
          if (apiKeyGroup) apiKeyGroup.style.display = 'none';
        } else {
          if (localGroup) localGroup.style.display = 'none';
          if (apiKeyGroup) apiKeyGroup.style.display = 'block';
        }
      };
      toggleProviderFields();
      aiProviderEl.onchange = toggleProviderFields;
    }

    if (aiApiKeyEl) aiApiKeyEl.value = settings.ai_api_key || '';
    if (aiLocalIpEl) aiLocalIpEl.value = settings.ai_local_ip || '';
    if (aiLocalModelEl) aiLocalModelEl.value = settings.ai_local_model || '';

    // AI 설정 폼 저장 핸들러 등록
    const aiForm = document.getElementById('ai-settings-form');
    if (aiForm) {
      aiForm.onsubmit = async (e) => {
        e.preventDefault();
        
        const payload = {
          ai_enabled: aiEnabledEl ? aiEnabledEl.checked : false,
          ai_parsing_enabled: aiParsingEnabledEl ? aiParsingEnabledEl.checked : false,
          ai_provider: aiProviderEl ? aiProviderEl.value : 'gemini',
          ai_api_key: aiApiKeyEl ? aiApiKeyEl.value : '',
          ai_local_ip: aiLocalIpEl ? aiLocalIpEl.value.trim() : '',
          ai_local_model: aiLocalModelEl ? aiLocalModelEl.value.trim() : ''
        };

        try {
          const res = await fetch('api/settings', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': localStorage.getItem('ab_token') || sessionStorage.getItem('ab_token') || ''
            },
            body: JSON.stringify(payload)
          }).then(r => r.json());

          if (res.success) {
            alert('AI 설정이 저장되었습니다.');
            loadAISettings(); // 마스킹 갱신 등을 위해 다시 불러오기
          } else {
            alert('설정 저장 실패: ' + (res.error || '알 수 없는 오류'));
          }
        } catch (err) {
          console.error('AI 설정 저장 오류:', err);
          alert('설정 저장 중 오류가 발생했습니다: ' + err.message);
        }
      };
    }

  } catch (err) {
    console.error('AI 설정 로드 실패:', err);
  }
}

// ==========================================
// 설정 초기화
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
  // Lucide 아이콘 변환 강제 실행 (정적 마크업 파싱)
  if (typeof lucide !== 'undefined') {
    lucide.createIcons();
  }
});

