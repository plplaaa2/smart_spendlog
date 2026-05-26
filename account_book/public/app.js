// ==========================================
// HA Account Book - Frontend Application Core
// ==========================================

// 로그인 세션 상태 관리
let currentUser = sessionStorage.getItem('ab_user') || localStorage.getItem('ab_user') || null;
let currentSession = localStorage.getItem('ab_session') || null;

// 전역 Fetch 인터셉터 (인증 토큰 자동 주입 및 403 대응)
// 요약: 모든 API 요청 시 로컬 스토리지의 토큰을 헤더에 삽입하고, 비-ASCII 문자(한글) 포함 시 인코딩하여 브라우저 fetch 오류를 방지합니다.
// 의존성: index.js의 토큰 인증 미들웨어(decodeURIComponent 처리)와 유기적으로 동기화됩니다.
const originalFetch = window.fetch;
window.fetch = async function (resource, options = {}) {
  const urlStr = typeof resource === 'string' ? resource : resource.url;
  if (urlStr.includes('api/') && !urlStr.includes('api/login') && !urlStr.includes('api/webhook')) {
    const token = localStorage.getItem('ab_token') || sessionStorage.getItem('ab_token') || '';
    if (token) {
      if (!options.headers) {
        options.headers = {};
      }
      
      // 토큰 내에 한글 등 ISO-8859-1 범위를 벗어나는 문자가 있으면 안전하게 인코딩하여 헤더 오류 방지
      let safeToken = token;
      const parts = token.split(':');
      if (parts.length > 1) {
        const secret = parts[0];
        const rawUsername = parts.slice(1).join(':');
        if (/[^\x00-\x7F]/.test(rawUsername)) {
          safeToken = `${secret}:${encodeURIComponent(rawUsername)}`;
        }
      }
      options.headers['Authorization'] = safeToken;
    }
  }

  const response = await originalFetch(resource, options);

  if (response.status === 403 && urlStr.includes('api/') && !urlStr.includes('api/login')) {
    console.warn('[보안] 인증 실패(403). 로그아웃 처리합니다.');
    logout();
  }

  return response;
};

// 글로벌 상태 관리
let state = {
  currentTab: 'dashboard',
  currentSubTab: 'all', // transactions 탭 내 서브 탭 ('all', 'cards', 'banks')
  currentMonth: '', // YYYY-MM 포맷
  categories: [],
  payMethods: [],
  rules: [],
  settings: {},
  categoryMap: {}, // name -> {color, icon}
};

// Chart.js 객체 참조용
let categoryChartInstance = null;
let trendChartInstance = null;
let analyticsYearlyChartInstance = null;
let analyticsCategoryChartInstance = null;
let analyticsMonthlyChartInstance = null;

// 초기화
document.addEventListener('DOMContentLoaded', async () => {
  if (!checkLogin()) {
    // Lucide 아이콘 로드 (로그인 화면용)
    lucide.createIcons();
    return;
  }
  await initApp();
});

async function initApp() {
  initMonth();
  await loadMetadata();
  initEventListeners();
  switchTab('dashboard'); // 첫 페이지 로드
  lucide.createIcons();
}

// 로그인/로그아웃 관련 보안 함수군
async function attemptLogin(isAuto = false) {
  console.log(`[보안] 로그인 시도 (자동: ${isAuto})`);
  let username, password, remember;
  
  if (isAuto && currentSession) {
    try {
      const sessionData = JSON.parse(decodeURIComponent(escape(window.atob(currentSession))));
      username = sessionData.u;
      password = sessionData.p;
      remember = true;
    } catch (e) {
      console.error("세션 복구 실패", e);
      logout();
      return;
    }
  } else {
    username = document.getElementById('login_username').value.trim();
    password = document.getElementById('login_password').value.trim();
    remember = document.getElementById('login_remember').checked;
  }

  if (!username || !password) {
    if (!isAuto) alert("아이디와 비밀번호를 입력해 주세요.");
    return;
  }

  try {
    const res = await fetch(`api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    
    if (res.status === 403 || res.status === 401) {
      const errorData = await res.json();
      if (!isAuto) alert("로그인 실패: " + (errorData.message || "정보를 확인하세요."));
      else logout();
      return;
    }

    const data = await res.json();

    if (data.success) {
      currentUser = data.username;
      
      if (remember) {
        localStorage.setItem('ab_user', currentUser);
        localStorage.setItem('ab_token', data.token);
        const sessionData = JSON.stringify({ u: username, p: password });
        localStorage.setItem('ab_session', window.btoa(unescape(encodeURIComponent(sessionData))));
        sessionStorage.removeItem('ab_user');
        sessionStorage.removeItem('ab_token');
      } else {
        sessionStorage.setItem('ab_user', currentUser);
        sessionStorage.setItem('ab_token', data.token);
        localStorage.removeItem('ab_user');
        localStorage.removeItem('ab_token');
        localStorage.removeItem('ab_session');
      }
      
      document.getElementById('login_overlay').style.display = 'none';
      document.getElementById('user_profile').style.display = 'flex';
      document.getElementById('current_user_name').textContent = `${currentUser}`;
      const mobileNameEl = document.getElementById('mobile_current_user_name');
      if (mobileNameEl) mobileNameEl.textContent = `${currentUser}`;
      
      await initApp();
    } else {
      if (!isAuto) alert("로그인 실패: " + (data.message || "정보를 확인하세요."));
      else logout();
    }
  } catch (e) {
    if (!isAuto) alert("서버 연결 실패");
  }
}

function logout() {
  localStorage.removeItem('ab_user');
  localStorage.removeItem('ab_token');
  localStorage.removeItem('ab_session');
  sessionStorage.removeItem('ab_user');
  sessionStorage.removeItem('ab_token');
  location.reload();
}

function checkLogin() {
  const overlay = document.getElementById('login_overlay');
  const profile = document.getElementById('user_profile');
  if (currentUser) {
    if (overlay) overlay.style.display = 'none';
    if (profile) {
      profile.style.display = 'flex';
      const nameEl = document.getElementById('current_user_name');
      if (nameEl) nameEl.textContent = `${currentUser}`;
      const mobileNameEl = document.getElementById('mobile_current_user_name');
      if (mobileNameEl) mobileNameEl.textContent = `${currentUser}`;
    }
    return true;
  } else {
    if (overlay) overlay.style.display = 'flex';
    if (profile) profile.style.display = 'none';
    
    if (currentSession) {
      attemptLogin(true);
    }
    return false;
  }
}

// ==========================================
// 공통 데이터 로드 & 포맷
// ==========================================

// 현재 월 세팅 (오늘 기준)
function initMonth() {
  const now = new Date();
  state.currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  updateMonthDisplay();
}

function updateMonthDisplay() {
  const [year, month] = state.currentMonth.split('-');
  document.getElementById('current-month-display').textContent = `${year}년 ${month}월`;
}

// 다음/이전 달 이동
function changeMonth(offset) {
  const [yearStr, monthStr] = state.currentMonth.split('-');
  let year = parseInt(yearStr, 10);
  let month = parseInt(monthStr, 10) - 1; // 0-indexed

  const date = new Date(year, month + offset, 1);
  state.currentMonth = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  
  updateMonthDisplay();
  refreshCurrentTabData();
}

// 메타데이터 로드 (카테고리, 결제수단, 규칙, 설정)
async function loadMetadata() {
  try {
    const [categories, payMethods, settings] = await Promise.all([
      fetch('api/categories').then(r => r.json()),
      fetch('api/pay_methods').then(r => r.json()),
      fetch('api/settings').then(r => r.json())
    ]);

    state.categories = categories;
    state.payMethods = payMethods;
    state.settings = settings;

    // 카테고리 맵 생성
    state.categoryMap = {};
    categories.forEach(c => {
      state.categoryMap[c.name] = { color: c.color, icon: c.icon };
    });

    // 폼 셀렉트 박스 채우기
    populateSelects();

  } catch (err) {
    console.error('메타데이터 로드 실패:', err);
  }
}

function populateSelects() {
  const catSelectors = ['#filter-category', '#rule-category', '#tx-category'];
  const pmSelectors = ['#rule-pay-method', '#tx-pay-method', '#pkm-modal-pay-method'];

  catSelectors.forEach(sel => {
    const el = document.querySelector(sel);
    if (!el) return;
    
    // 첫 옵션(예: "전체 카테고리" 또는 비어있는 기본값) 유지
    const firstOption = el.options[0];
    el.innerHTML = '';
    if (firstOption) el.add(firstOption);

    // 필터링 카테고리는 수입/지출 전체 표시
    state.categories.forEach(c => {
      if (sel === '#filter-category') {
        const opt = document.createElement('option');
        opt.value = c.name;
        opt.textContent = `${c.type === 'INCOME' ? '[수입] ' : ''}${c.name}`;
        el.appendChild(opt);
      }
    });
  });

  // 수동 입력 및 규칙 설정 카테고리는 기본적으로 EXPENSE용으로 초기 세팅
  updateCategorySelect('#tx-category', 'EXPENSE');
  updateCategorySelect('#rule-category', 'EXPENSE');

  pmSelectors.forEach(sel => {
    const el = document.querySelector(sel);
    if (!el) return;

    el.innerHTML = '';

    // 자동 분류 규칙 및 수동지출 추가 결제수단 셀렉트박스의 경우, 첫 번째 항목으로 "앱 패키지 매핑 수단" 추가
    if (sel === '#rule-pay-method' || sel === '#tx-pay-method') {
      const opt = document.createElement('option');
      opt.value = '_AUTO_MAPPING_';
      opt.textContent = '🔄 [앱 패키지 매핑 결제수단]';
      el.appendChild(opt);
    }

    state.payMethods.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.name;
      opt.textContent = p.name;
      el.appendChild(opt);
    });
  });
}

// 거래 유형별 카테고리 목록 동적 채우기 헬퍼 함수
// 요약: 거래유형(수입/지출)에 맞는 카테고리 리스트를 셀렉트 박스에 바인딩하며, 규칙 생성용 셀렉트일 경우 '자동 매핑' 옵션을 최상단에 주입합니다.
// 의존성: public/index.html의 rule-category 셀렉트 요소 및 public/rules.js의 loadRuleToEditor와 연계됩니다.
function updateCategorySelect(selector, type, selectedValue) {
  const el = document.querySelector(selector);
  if (!el) return;
  
  el.innerHTML = '';

  // 규칙 편집 카테고리의 경우, 첫 번째 항목으로 "사용처 카테고리 자동 매핑" 추가
  if (selector === '#rule-category') {
    const opt = document.createElement('option');
    opt.value = '_AUTO_MAPPING_';
    opt.textContent = '🔄 [사용처 카테고리 자동 매핑]';
    el.appendChild(opt);
  }

  const filtered = state.categories.filter(c => c.type === type);
  filtered.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.name;
    opt.textContent = c.name;
    el.appendChild(opt);
  });

  if (selectedValue && (selectedValue === '_AUTO_MAPPING_' || filtered.some(c => c.name === selectedValue))) {
    el.value = selectedValue;
  } else if (selector === '#rule-category' && !selectedValue) {
    el.value = '_AUTO_MAPPING_';
  } else if (filtered.length > 0) {
    el.value = filtered[0].name;
  }
}

// 화폐 포맷 (예: 12,500원)
function formatCurrency(value) {
  return new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW' })
    .format(value)
    .replace('₩', '') + '원';
}

// 날짜 포맷 (YYYY-MM-DD HH:mm:ss -> MM-DD HH:mm)
// isUtc가 true이면 해당 날짜 문자열을 UTC 시간대로 취급하여 브라우저 로컬 시간대(KST 등)로 변환해 줍니다.
function formatShortDate(dateStr, isUtc = false) {
  if (!dateStr) return '';
  
  if (isUtc) {
    let dateObj;
    if (dateStr.includes('-') && dateStr.includes(':')) {
      const cleanStr = dateStr.replace(/-/g, '/') + ' UTC';
      dateObj = new Date(cleanStr);
    } else {
      dateObj = new Date(dateStr);
    }
    
    if (!isNaN(dateObj.getTime())) {
      const pad = (n) => String(n).padStart(2, '0');
      const month = pad(dateObj.getMonth() + 1);
      const date = pad(dateObj.getDate());
      const hours = pad(dateObj.getHours());
      const minutes = pad(dateObj.getMinutes());
      return `${month}-${date} ${hours}:${minutes}`;
    }
  }

  const parts = dateStr.split(' ');
  if (parts.length < 2) return dateStr;
  const dateParts = parts[0].split('-');
  const timeParts = parts[1].split(':');
  if (dateParts.length < 3 || timeParts.length < 2) return dateStr;
  return `${dateParts[1]}-${dateParts[2]} ${timeParts[0]}:${timeParts[1]}`;
}

// ==========================================
// 탭 이동 및 데이터 새로고침
// ==========================================
function switchTab(tabId) {
  state.currentTab = tabId;

  // 네비게이션 버튼 클래스 토글
  document.querySelectorAll('.nav-item').forEach(btn => {
    if (btn.dataset.tab === tabId) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  // 모바일 하단 네비게이션 버튼 클래스 토글
  document.querySelectorAll('.mobile-nav-item').forEach(btn => {
    if (btn.dataset.tab === tabId) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  // 콘텐츠 전환
  document.querySelectorAll('.tab-content').forEach(content => {
    if (content.id === `tab-${tabId}`) {
      content.classList.add('active');
    } else {
      content.classList.remove('active');
    }
  });

  // 타이틀 변경
  const titles = {
    dashboard: ['대시보드', '이번 달 소비 패턴 분석 및 통계'],
    transactions: ['거래 내역', '상세 가계부 내역 조회 및 편집'],
    rules: ['자동 분류 규칙', '알림에서 금액/사용처를 추출하기 위한 정규식 설정'],
    analytics: ['소비 분석', '월별/연도별 자산 흐름 및 전년 대비 소비 비교'],
    logs: ['알림 수신 로그', 'Home Assistant에서 수신된 스마트폰 알림 원본 이력'],
    settings: ['설정', '시스템 연동 정보 및 마스터 데이터 관리']
  };

  if (titles[tabId]) {
    document.getElementById('page-title').textContent = titles[tabId][0];
    document.getElementById('page-subtitle').textContent = titles[tabId][1];
  }

  refreshCurrentTabData();
}

function refreshCurrentTabData() {
  switch (state.currentTab) {
    case 'dashboard':
      loadDashboardData();
      break;
    case 'transactions':
      if (state.currentSubTab === 'all') {
        loadTransactions();
      } else if (state.currentSubTab === 'cards') {
        if (typeof loadCardExpenses === 'function') loadCardExpenses();
      } else if (state.currentSubTab === 'banks') {
        if (typeof loadBankTransactions === 'function') loadBankTransactions();
      }
      break;
    case 'rules':
      loadRules();
      break;
    case 'analytics':
      loadAnalytics();
      break;
    case 'logs':
      loadLogs();
      break;
    case 'settings':
      loadSettingsTab();
      break;
  }
}

// ==========================================
// 이벤트 리스너 설정
// ==========================================
function initEventListeners() {
  // 탭 클릭 이벤트
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      switchTab(btn.dataset.tab);
    });
  });

  // 모바일 하단 네비게이션 클릭 이벤트
  document.querySelectorAll('.mobile-nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      switchTab(btn.dataset.tab);
    });
  });

  // 거래 내역 내 서브 탭 클릭 이벤트
  document.querySelectorAll('.tx-subtab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const subtab = btn.dataset.subtab;
      state.currentSubTab = subtab;

      // 서브 탭 버튼 active 클래스 토글
      document.querySelectorAll('.tx-subtab-btn').forEach(b => {
        if (b.dataset.subtab === subtab) {
          b.classList.add('active');
        } else {
          b.classList.remove('active');
        }
      });

      // 서브 탭 뷰 토글
      document.querySelectorAll('.tx-subview-content').forEach(view => {
        if (view.id === `tx-subview-${subtab}`) {
          view.style.display = 'block';
        } else {
          view.style.display = 'none';
        }
      });

      // 데이터 새로고침
      refreshCurrentTabData();
    });
  });

  // 월 선택기
  document.getElementById('prev-month-btn').addEventListener('click', () => changeMonth(-1));
  document.getElementById('next-month-btn').addEventListener('click', () => changeMonth(1));
  
  const monthInput = document.getElementById('month-input');
  document.getElementById('month-select-trigger').addEventListener('click', () => {
    monthInput.value = state.currentMonth;
    monthInput.showPicker();
  });
  
  monthInput.addEventListener('change', (e) => {
    if (e.target.value) {
      state.currentMonth = e.target.value;
      updateMonthDisplay();
      refreshCurrentTabData();
    }
  });

  // 거래내역 검색 및 필터 변경
  document.getElementById('transaction-search').addEventListener('input', debounce(loadTransactions, 300));
  document.getElementById('filter-category').addEventListener('change', loadTransactions);

  // 수동 내역 추가 모달 트리거
  document.getElementById('add-transaction-btn').addEventListener('click', openAddTransactionModal);
  document.getElementById('transaction-modal-close').addEventListener('click', closeModal);
  document.getElementById('tx-modal-cancel').addEventListener('click', closeModal);

  // 수동 거래 구분(타입) 변경에 따른 카테고리 업데이트
  document.getElementById('tx-type').addEventListener('change', (e) => {
    updateCategorySelect('#tx-category', e.target.value);
  });

  // 규칙 거래 구분(타입) 변경에 따른 카테고리 업데이트
  document.getElementById('rule-type').addEventListener('change', (e) => {
    updateCategorySelect('#rule-category', e.target.value);
  });

  // 수동 내역 저장 서브밋
  // 의존성: 이 이벤트 리스너는 public/index.html의 폼과 index.js의 api/transactions 엔드포인트와 연결됩니다.
  document.getElementById('transaction-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('tx-id').value;
    const type = document.getElementById('tx-type').value;
    const amount = parseInt(document.getElementById('tx-amount').value, 10);
    const merchant = document.getElementById('tx-merchant').value;
    const category = document.getElementById('tx-category').value;
    const pay_method = document.getElementById('tx-pay-method').value;
    
    // YYYY-MM-DDTHH:mm -> YYYY-MM-DD HH:mm:00
    const rawDt = document.getElementById('tx-datetime').value;
    const datetime = rawDt.replace('T', ' ') + ':00';

    const memo = document.getElementById('tx-memo').value;
    const raw_text = document.getElementById('tx-raw-text').value;
    const used_point = parseInt(document.getElementById('tx-used-point').value, 10) || 0;

    const mapPackage = document.getElementById('tx-map-package').checked;
    const pkgName = document.getElementById('tx-package').value.trim();

    try {
      const res = await fetch('api/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, type, amount, merchant, category, pay_method, datetime, memo, raw_text, used_point, package: pkgName })
      }).then(r => r.json());

      if (res.success) {
        // 결제수단 패키지 매핑 등록
        if (mapPackage && pkgName) {
          try {
            await fetch('api/package_pay_methods', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ package: pkgName, pay_method })
            });
          } catch (pkmErr) {
            console.error('패키지 매핑 등록 중 오류 발생:', pkmErr);
          }
        }

        closeModal();
        if (state.currentTab === 'transactions') loadTransactions();
        else if (state.currentTab === 'dashboard') loadDashboardData();
      }
    } catch (err) {
      alert('저장 실패: ' + err.message);
    }
  });

  // 규칙 생성 버튼 트리거
  document.getElementById('new-rule-btn').addEventListener('click', () => {
    loadRuleToEditor(null);
  });

  const ruleModal = document.getElementById('rule-modal');
  const closeRuleModal = () => {
    if (ruleModal) ruleModal.classList.remove('active');
  };

  document.getElementById('rule-cancel-btn').addEventListener('click', closeRuleModal);

  const ruleModalCloseBtn = document.getElementById('rule-modal-close-btn');
  if (ruleModalCloseBtn) {
    ruleModalCloseBtn.addEventListener('click', closeRuleModal);
  }

  // 모달 외부 클릭 시 닫기
  if (ruleModal) {
    ruleModal.addEventListener('click', (e) => {
      if (e.target === ruleModal) {
        closeRuleModal();
      }
    });
  }

  // 규칙 저장 서브밋
  document.getElementById('rule-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('rule-id').value;
    const name = document.getElementById('rule-name').value;
    const type = document.getElementById('rule-type').value;
    const pattern = document.getElementById('rule-pattern').value;
    const category = document.getElementById('rule-category').value;
    const pay_method = document.getElementById('rule-pay-method').value;

    try {
      const res = await fetch('api/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, name, pattern, category, pay_method, merchant_template: '${merchant}', type })
      }).then(r => r.json());

      if (res.success) {
        closeRuleModal();
        loadRules();
      }
    } catch (err) {
      alert('규칙 저장 실패: ' + err.message);
    }
  });

  // 규칙 테스터 실행 버튼
  const testRunBtn = document.getElementById('test-run-btn');
  if (testRunBtn) {
    testRunBtn.addEventListener('click', runRegexTest);
  }

  // 정규식 패턴 자동 생성 버튼
  const autoGenBtn = document.getElementById('btn-auto-generate-pattern');
  if (autoGenBtn) {
    autoGenBtn.addEventListener('click', autoGeneratePattern);
  }

  // 수동 순서 조정 옵션 토글
  const toggleSeqOpts = document.getElementById('toggle-sequence-opts');
  if (toggleSeqOpts) {
    toggleSeqOpts.addEventListener('click', () => {
      const container = document.getElementById('sequence-opts-container');
      if (container) {
        if (container.style.display === 'none') {
          container.style.display = 'block';
          toggleSeqOpts.innerHTML = '<i data-lucide="sliders" style="width: 14px; height: 14px;"></i> 수동 순서 조정 옵션 접기';
        } else {
          container.style.display = 'none';
          toggleSeqOpts.innerHTML = '<i data-lucide="sliders" style="width: 14px; height: 14px;"></i> 수동 순서 조정 옵션';
        }
        lucide.createIcons();
      }
    });
  }

  // 로그 탭 새로고침
  document.getElementById('refresh-logs-btn').addEventListener('click', loadLogs);

  // 사용자 설정 폼 서브밋
  const settingsForm = document.getElementById('settings-form');
  if (settingsForm) {
    settingsForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const entitySelect = document.getElementById('settings-ws-entity');
      let ws_sensor_entity = entitySelect ? entitySelect.value.trim() : '';
      if (ws_sensor_entity === '__MANUAL__') {
        const manualInput = document.getElementById('settings-ws-entity-manual');
        ws_sensor_entity = manualInput ? manualInput.value.trim() : '';
      }
      const monthly_budget = parseInt(document.getElementById('settings-budget').value, 10);
      const user_real_name = document.getElementById('settings-real-name').value.trim();
      const auto_rule_generation = document.getElementById('settings-auto-rule').checked;

      try {
        const res = await fetch('api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ws_sensor_entity, monthly_budget, user_real_name, auto_rule_generation })
        }).then(r => r.json());

        if (res.success) {
          alert('사용자 설정이 저장되었습니다.');
          await loadMetadata();
          if (state.currentTab === 'dashboard') {
            loadDashboardData();
          }
        }
      } catch (err) {
        alert('사용자 설정 저장 실패: ' + err.message);
      }
    });
  }

  // 데이터 백업(내보내기) 버튼 이벤트
  // 의존성: index.js의 GET /api/settings/backup API와 연결됩니다.
  const backupBtn = document.getElementById('btn-backup-data');
  if (backupBtn) {
    backupBtn.addEventListener('click', async () => {
      try {
        const token = localStorage.getItem('ab_token') || sessionStorage.getItem('ab_token') || '';
        window.location.href = `api/settings/backup?token=${encodeURIComponent(token)}`;
      } catch (err) {
        alert('백업 다운로드 실패: ' + err.message);
      }
    });
  }

  // 데이터 복원(가져오기) 파일 선택 이벤트
  // 의존성: index.js의 POST /api/settings/restore API와 연결됩니다.
  const restoreInput = document.getElementById('restore-file-input');
  if (restoreInput) {
    restoreInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const confirmed = confirm('주의: 데이터 복원 시 현재 등록된 모든 가계부 내역과 설정이 업로드한 파일의 내용으로 완전히 대체(덮어쓰기)됩니다.\n정말로 복원을 진행하시겠습니까?');
      if (!confirmed) {
        restoreInput.value = '';
        return;
      }

      const loader = document.getElementById('restore-loading-indicator');
      if (loader) {
        loader.style.display = 'inline-flex';
        // Lucide 로더 스핀 애니메이션 지원
        lucide.createIcons();
      }

      const reader = new FileReader();
      reader.onload = async (event) => {
        try {
          const backupObj = JSON.parse(event.target.result);
          
          const res = await fetch('api/settings/restore', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(backupObj)
          }).then(r => r.json());

          if (res.success) {
            alert('데이터가 성공적으로 복원되었습니다. 페이지를 새로고침합니다.');
            location.reload();
          } else {
            alert('복원 실패: ' + (res.error || '오류 발생'));
          }
        } catch (err) {
          alert('파일 파싱 또는 업로드 실패: ' + err.message);
        } finally {
          if (loader) loader.style.display = 'none';
          restoreInput.value = '';
        }
      };

      reader.onerror = () => {
        alert('파일을 읽는 중 에러가 발생했습니다.');
        if (loader) loader.style.display = 'none';
        restoreInput.value = '';
      };

      reader.readAsText(file);
    });
  }

  // 잔액 설정 폼 서브밋
  // 의존성: 이 폼은 public/settings.js의 렌더링 영역 및 index.js의 settings 저장 API와 직접 연결됩니다.
  const balanceForm = document.getElementById('balance-form');
  if (balanceForm) {
    balanceForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const initial_balance = parseInt(document.getElementById('settings-initial-balance').value, 10) || 0;

      // 결제 수단별 개별 초기 잔액 객체 구성
      const initial_balances = {};
      document.querySelectorAll('.settings-initial-balance-input').forEach(input => {
        const name = input.dataset.name;
        const val = parseInt(input.value, 10) || 0;
        initial_balances[name] = val;
      });

      // 카드사별 개별 초기 포인트(지원금) 객체 구성
      const initial_points = {};
      document.querySelectorAll('.settings-initial-point-input').forEach(input => {
        const name = input.dataset.name;
        const val = parseInt(input.value, 10) || 0;
        initial_points[name] = val;
      });

      try {
        const res = await fetch('api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ initial_balance, initial_balances, initial_points })
        });

        if (!res.ok) {
          const errData = await res.json();
          throw new Error(errData.error || '서버 오류');
        }

        const data = await res.json();
        if (data.success) {
          alert('잔액 및 포인트 설정이 저장되었습니다.');
          await loadMetadata();
          await loadBalanceSettings();
          if (state.currentTab === 'dashboard') {
            loadDashboardData();
          }
        } else {
          alert('잔액 및 포인트 설정 저장 실패: ' + (data.error || '알 수 없는 오류'));
        }
      } catch (err) {
        alert('잔액 및 포인트 설정 저장 실패: ' + err.message);
      }
    });
  }

  // 사용처별 카테고리 매핑 폼 서브밋
  const mcatForm = document.getElementById('merchant-category-form');
  if (mcatForm) {
    mcatForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = document.getElementById('mcat-id').value;
      const merchant = document.getElementById('mcat-merchant').value.trim();
      const category = document.getElementById('mcat-category').value;

      if (!merchant || !category) return;

      try {
        const payload = { merchant, category };
        if (id) payload.id = parseInt(id, 10);

        const res = await fetch('api/merchant_categories', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        }).then(r => r.json());

        if (res.success) {
          document.getElementById('mcat-id').value = '';
          document.getElementById('mcat-merchant').value = '';
          document.getElementById('btn-mcat-submit').textContent = '추가/변경';
          document.getElementById('btn-mcat-cancel').style.display = 'none';
          await loadMerchantCategories();
          alert(id ? '사용처 카테고리 설정이 수정되었습니다.' : '사용처 카테고리 설정이 추가되었습니다.');
        } else {
          alert('저장 실패: ' + (res.error || '오류가 발생했습니다.'));
        }
      } catch (err) {
        alert('매핑 저장 실패: ' + err.message);
      }
    });

    const mcatCancelBtn = document.getElementById('btn-mcat-cancel');
    if (mcatCancelBtn) {
      mcatCancelBtn.addEventListener('click', () => {
        document.getElementById('mcat-id').value = '';
        document.getElementById('mcat-merchant').value = '';
        document.getElementById('btn-mcat-submit').textContent = '추가/변경';
        mcatCancelBtn.style.display = 'none';
      });
    }
  }

  // 앱 패키지별 결제수단 매핑 폼 서브밋
  // 요약: 설정 탭 내 앱 패키지별 결제수단 매핑 폼을 서브밋할 때 API를 호출하여 저장하고 테이블을 갱신합니다.
  // 의존성: public/index.html의 package-paymethod-form 및 public/settings.js의 loadPackagePayMethods와 연동됩니다.
  const pkmForm = document.getElementById('package-paymethod-form');
  if (pkmForm) {
    pkmForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = document.getElementById('pkm-id').value;
      const package = document.getElementById('pkm-package').value.trim();
      const pay_method = document.getElementById('pkm-pay-method').value;

      if (!package || !pay_method) return;

      try {
        const payload = { package, pay_method };
        if (id) payload.id = parseInt(id, 10);

        const res = await fetch('api/package_pay_methods', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        }).then(r => r.json());

        if (res.success) {
          document.getElementById('pkm-id').value = '';
          document.getElementById('pkm-package').value = '';
          document.getElementById('btn-pkm-submit').textContent = '추가/변경';
          document.getElementById('btn-pkm-cancel').style.display = 'none';
          await loadPackagePayMethods();
          alert(id ? '앱 패키지 결제수단 설정이 수정되었습니다.' : '앱 패키지 결제수단 설정이 추가되었습니다.');
        } else {
          alert('저장 실패: ' + (res.message || '오류가 발생했습니다.'));
        }
      } catch (err) {
        alert('매핑 저장 실패: ' + err.message);
      }
    });

    const pkmCancelBtn = document.getElementById('btn-pkm-cancel');
    if (pkmCancelBtn) {
      pkmCancelBtn.addEventListener('click', () => {
        document.getElementById('pkm-id').value = '';
        document.getElementById('pkm-package').value = '';
        document.getElementById('btn-pkm-submit').textContent = '추가/변경';
        pkmCancelBtn.style.display = 'none';
      });
    }
  }

  // 잔액 초기화 버튼
  const resetBalanceBtn = document.getElementById('btn-reset-balance');
  if (resetBalanceBtn) {
    resetBalanceBtn.addEventListener('click', async () => {
      if (!confirm('초기 보유 잔액 설정을 0원으로 초기화하시겠습니까?')) return;
      try {
        const res = await fetch('api/settings/reset-balance', { method: 'POST' }).then(r => r.json());
        if (res.success) {
          alert('초기 잔액이 초기화되었습니다.');
          const balanceEl = document.getElementById('settings-initial-balance');
          if (balanceEl) balanceEl.value = 0;
          await loadMetadata();
          await loadBalanceSettings();
        }
      } catch (err) {
        alert('잔액 초기화 실패: ' + err.message);
      }
    });
  }

  // 전체 초기화 버튼
  const resetAllBtn = document.getElementById('btn-reset-all');
  if (resetAllBtn) {
    resetAllBtn.addEventListener('click', async () => {
      const confirmed1 = confirm('경고: 모든 거래 내역, 알림 로그, 등록된 규칙 및 설정 정보가 완전히 영구 삭제됩니다.\n정말로 전체 초기화를 진행하시겠습니까?');
      if (!confirmed1) return;
      
      const confirmed2 = confirm('진짜로 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다. 모든 데이터가 소멸하고 기본 규칙들로만 재설정됩니다.');
      if (!confirmed2) return;

      try {
        const res = await fetch('api/settings/reset-all', { method: 'POST' }).then(r => r.json());
        if (res.success) {
          alert('가계부의 모든 데이터와 설정이 초기화되었습니다. 페이지를 새로고침합니다.');
          location.reload();
        }
      } catch (err) {
        alert('전체 초기화 실패: ' + err.message);
      }
    });
  }

  // 앱 패키지 매핑 모달 닫기
  const pkmClose = document.getElementById('pkm-modal-close');
  if (pkmClose) pkmClose.addEventListener('click', closePackageMappingModal);
  const pkmCancel = document.getElementById('pkm-modal-cancel');
  if (pkmCancel) pkmCancel.addEventListener('click', closePackageMappingModal);

  // 앱 패키지 매핑 모달 저장
  const pkmModalForm = document.getElementById('pkm-modal-form');
  if (pkmModalForm) {
    pkmModalForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const pkg = document.getElementById('pkm-modal-package').value;
      const pay_method = document.getElementById('pkm-modal-pay-method').value;

      try {
        const res = await fetch('api/package_pay_methods', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ package: pkg, pay_method })
        }).then(r => r.json());

        if (res.success) {
          closePackageMappingModal();
          // 설정 탭에 현재 있다면 리스트 새로고침
          if (typeof loadPackagePayMethods === 'function') {
            await loadPackagePayMethods();
          }
          alert('앱 패키지 매핑 규칙이 저장되었습니다!');
        } else {
          alert('저장 실패: ' + (res.message || '오류 발생'));
        }
      } catch (err) {
        alert('저장 실패: ' + err.message);
      }
    });
  }
}

// 디바운스 헬퍼
function debounce(func, wait) {
  let timeout;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

// 앱 패키지 매핑 모달 제어 함수
function openPackageMappingModal(senderPackage) {
  const modal = document.getElementById('package-mapping-modal');
  if (!modal) return;

  const pkgInput = document.getElementById('pkm-modal-package');
  if (pkgInput) pkgInput.value = senderPackage || '';

  // 드롭다운 초기값 선택
  const paySel = document.getElementById('pkm-modal-pay-method');
  if (paySel && state.payMethods.length > 0) {
    paySel.value = state.payMethods[0].name;
  }

  modal.classList.add('active');
}

function closePackageMappingModal() {
  const modal = document.getElementById('package-mapping-modal');
  if (modal) modal.classList.remove('active');
}
