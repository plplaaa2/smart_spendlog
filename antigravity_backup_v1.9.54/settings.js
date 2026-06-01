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

  } catch (err) {
    console.error('설정 로드 실패:', err);
  }
}

async function loadBalanceSettings() {
  try {
    const settings = await fetch('api/settings').then(r => r.json());
    const balanceEl = document.getElementById('settings-initial-balance');
    if (balanceEl) balanceEl.value = settings.initial_balance || 0;

    // 개별 결제 수단별 초기 잔액 입력창 그리기
    const container = document.getElementById('settings-initial-balances-container');
    if (container) {
      container.innerHTML = '';
      
      // 이미 저장된 개별 잔액 데이터
      let initialBalances = {};
      if (settings.initial_balances) {
        try {
          initialBalances = typeof settings.initial_balances === 'string' ? JSON.parse(settings.initial_balances) : settings.initial_balances;
        } catch (e) {
          initialBalances = {};
        }
      }

      // payMethods 목록은 전역 state.payMethods에 저장되어 있음 (loadMetadata()를 통해 최신화됨)
      let payMethods = state.payMethods;
      if (!payMethods || payMethods.length === 0) {
        payMethods = await fetch('api/pay_methods').then(r => r.json());
        state.payMethods = payMethods;
      }

      // 카드 및 계좌이체 명칭을 제외한 모든 결제 수단을 자산(초기 잔액 설정 대상)으로 분류하도록 유연하게 필터링 적용
      // 의존성: routes/analytics.js의 api/stats 엔드포인트 내 자산 판정(isAsset) 로직과 완벽히 호환되어야 합니다.
      const filteredPayMethods = payMethods.filter(pm => {
        const name = pm.name;
        if (name.includes('카드') || name === '계좌이체' || name.includes('페이') || name.includes('머니')) {
          return false;
        }
        return true;
      });

      if (filteredPayMethods.length === 0) {
        container.innerHTML = '<p class="text-secondary text-xs" style="text-align:center; padding:1rem;">등록된 결제 수단이 없습니다. 규칙을 먼저 생성하거나 결제 수단을 추가하세요.</p>';
      } else {
        filteredPayMethods.forEach(pm => {
          const val = initialBalances[pm.name] || 0;
          const row = document.createElement('div');
          row.style.display = 'flex';
          row.style.justifyContent = 'space-between';
          row.style.alignItems = 'center';
          row.style.gap = '1rem';
          row.style.padding = '0.4rem 0';
          row.style.borderBottom = '1px solid rgba(255,255,255,0.03)';

          row.innerHTML = `
            <span style="font-size: 0.85rem; color: var(--text-color); font-weight: 500;">${pm.name}</span>
            <input type="number" class="settings-initial-balance-input" data-name="${pm.name}" value="${val}" min="0" placeholder="0" 
                   style="width: 150px; font-size: 0.85rem; padding: 0.35rem 0.5rem; text-align: right; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 4px; color: var(--text-color);">
          `;
          container.appendChild(row);
        });
      }
    }

    // 카드사 결제수단만 필터링하여 초기 포인트(지원금) 입력창 그리기
    // 의존성: public/app.js의 balance-form submit 이벤트 및 index.js의 settings API와 결합해 작동합니다.
    const pointsContainer = document.getElementById('settings-initial-points-container');
    if (pointsContainer) {
      pointsContainer.innerHTML = '';
      
      let initialPoints = {};
      if (settings.initial_points) {
        try {
          initialPoints = typeof settings.initial_points === 'string' ? JSON.parse(settings.initial_points) : settings.initial_points;
        } catch (e) {
          initialPoints = {};
        }
      }

      let payMethods = state.payMethods;
      if (!payMethods || payMethods.length === 0) {
        payMethods = await fetch('api/pay_methods').then(r => r.json());
        state.payMethods = payMethods;
      }

      const cardPayMethods = payMethods.filter(pm => pm.name.includes('카드'));

      if (cardPayMethods.length === 0) {
        pointsContainer.innerHTML = '<p class="text-secondary text-xs" style="text-align:center; padding:1rem;">등록된 카드사 결제 수단이 없습니다.</p>';
      } else {
        cardPayMethods.forEach(pm => {
          const val = initialPoints[pm.name] || 0;
          const row = document.createElement('div');
          row.style.display = 'flex';
          row.style.justifyContent = 'space-between';
          row.style.alignItems = 'center';
          row.style.gap = '1rem';
          row.style.padding = '0.4rem 0';
          row.style.borderBottom = '1px solid rgba(255,255,255,0.03)';

          row.innerHTML = `
            <span style="font-size: 0.85rem; color: var(--text-color); font-weight: 500;">${pm.name} 연동 포인트</span>
            <input type="number" class="settings-initial-point-input" data-name="${pm.name}" value="${val}" min="0" placeholder="0" 
                   style="width: 150px; font-size: 0.85rem; padding: 0.35rem 0.5rem; text-align: right; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 4px; color: var(--text-color);">
          `;
          pointsContainer.appendChild(row);
        });
      }
    }

    // 카드사 결제수단만 필터링하여 카드 실적 목표 입력창 그리기
    const performanceGoalsContainer = document.getElementById('settings-card-performance-goals-container');
    if (performanceGoalsContainer) {
      performanceGoalsContainer.innerHTML = '';
      
      let cardPerformanceGoals = {};
      if (settings.card_performance_goals) {
        try {
          cardPerformanceGoals = typeof settings.card_performance_goals === 'string' ? JSON.parse(settings.card_performance_goals) : settings.card_performance_goals;
        } catch (e) {
          cardPerformanceGoals = {};
        }
      }

      let cardPerformanceDays = {};
      if (settings.card_performance_days) {
        try {
          cardPerformanceDays = typeof settings.card_performance_days === 'string' ? JSON.parse(settings.card_performance_days) : settings.card_performance_days;
        } catch (e) {
          cardPerformanceDays = {};
        }
      }

      let payMethods = state.payMethods;
      if (!payMethods || payMethods.length === 0) {
        payMethods = await fetch('api/pay_methods').then(r => r.json());
        state.payMethods = payMethods;
      }

      const cardPayMethods = payMethods.filter(pm => pm.name.includes('카드'));

      if (cardPayMethods.length === 0) {
        performanceGoalsContainer.innerHTML = '<p class="text-secondary text-xs" style="text-align:center; padding:1rem;">등록된 카드사 결제 수단이 없습니다.</p>';
      } else {
        cardPayMethods.forEach(pm => {
          const val = cardPerformanceGoals[pm.name] || 0;
          const dayVal = cardPerformanceDays[pm.name] || 1;
          const row = document.createElement('div');
          row.style.display = 'flex';
          row.style.justifyContent = 'space-between';
          row.style.alignItems = 'center';
          row.style.gap = '1rem';
          row.style.padding = '0.5rem 0';
          row.style.borderBottom = '1px solid rgba(255,255,255,0.03)';

          row.innerHTML = `
            <div style="display: flex; flex-direction: column; gap: 0.15rem;">
              <span style="font-size: 0.85rem; color: var(--text-color); font-weight: 500;">${pm.name}</span>
            </div>
            <div style="display: flex; align-items: center; gap: 0.75rem;">
              <div style="display: flex; align-items: center; gap: 0.35rem;">
                <span style="font-size: 0.75rem; color: var(--text-secondary);">목표:</span>
                <input type="number" class="settings-card-performance-goal-input" data-name="${pm.name}" value="${val}" min="0" placeholder="0" 
                       style="width: 100px; font-size: 0.85rem; padding: 0.35rem 0.5rem; text-align: right; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 4px; color: var(--text-color);">
              </div>
              <div style="display: flex; align-items: center; gap: 0.35rem;">
                <span style="font-size: 0.75rem; color: var(--text-secondary);">시작일:</span>
                <input type="number" class="settings-card-performance-day-input" data-name="${pm.name}" value="${dayVal}" min="1" max="28" placeholder="1" 
                       style="width: 50px; font-size: 0.85rem; padding: 0.35rem 0.5rem; text-align: right; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 4px; color: var(--text-color);">
                <span style="font-size: 0.75rem; color: var(--text-secondary);">일</span>
              </div>
            </div>
          `;
          performanceGoalsContainer.appendChild(row);
        });
      }
    }
  } catch (err) {
    console.error('잔액/포인트/실적 설정 로드 실패:', err);
  }
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
          tr.style.borderBottom = '1px solid rgba(255,255,255,0.04)';
          
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
        tr.style.borderBottom = '1px solid rgba(255,255,255,0.04)';
        
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
    const autoBackupEl = document.getElementById('settings-auto-backup');
    if (autoBackupEl) {
      autoBackupEl.checked = settings.auto_backup === 'true';

      // 토글 변경 시 즉시 저장
      autoBackupEl.onchange = async () => {
        try {
          const res = await fetch('api/settings', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': localStorage.getItem('token') || ''
            },
            body: JSON.stringify({
              auto_backup: autoBackupEl.checked
            })
          }).then(r => r.json());

          if (res.success) {
            alert('자동 백업 설정이 변경되었습니다.');
          } else {
            alert('설정 저장 실패: ' + (res.error || '오류 발생'));
          }
        } catch (e) {
          console.error('자동 백업 설정 저장 중 에러:', e);
          alert('자동 백업 설정 저장 중 오류가 발생했습니다.');
        }
      };
    }
  } catch (err) {
    console.error('데이터 설정 로드 실패:', err);
  }
}

// ==========================================
// 설정 초기화
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
  // 초기 로드에 필요한 바인딩 코드가 있다면 추가
});

