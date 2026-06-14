// ==========================================
// HA Account Book - Frontend Application Core
// ==========================================

// 글로벌 상태 관리
let state = {
  currentTab: 'dashboard',
  currentSubTab: 'all', // transactions 탭 내 서브 탭 ('all', 'cards', 'banks')
  currentAnalyticsSubTab: 'trend', // analytics 탭 내 서브 탭 ('trend', 'fixed')
  currentLogsSubTab: 'logs-list', // logs 탭 내 서브 탭 ('logs-list', 'rules', 'pass-rules', 'merchant')
  currentSettingsSubTab: 'default', // settings 탭 내 서브 탭 ('default', 'balance', 'data')
  currentMonth: '', // YYYY-MM 포맷
  categories: [],
  payMethods: [],
  rules: [],
  settings: {},
  categoryMap: {}, // name -> {color, icon}
  franchisePresets: [], // 가맹점 프리셋 가중치 계산용
};

// Chart.js 객체 참조용
let categoryChartInstance = null;
let trendChartInstance = null;
let analyticsYearlyChartInstance = null;
let analyticsCategoryChartInstance = null;
let analyticsMonthlyChartInstance = null;
let fixedMonthlyTrendChartInstance = null;
let fixedCategoryChartInstance = null;
let generalMonthlyTrendChartInstance = null;
let generalCategoryChartInstance = null;
let incomeMonthlyTrendChartInstance = null;
let incomeCategoryChartInstance = null;

// 초기화
let isAppInitialized = false;

document.addEventListener('DOMContentLoaded', async () => {
  if (!checkLogin()) {
    // Lucide 아이콘 로드 (로그인 화면용)
    lucide.createIcons();
    return;
  }
  await initApp();
});

async function initApp() {
  if (isAppInitialized) {
    console.log("[SpendLog] initApp()이 이미 실행되었습니다. 중복 실행을 무시합니다.");
    return;
  }
  isAppInitialized = true;

  initMonth();
  await loadMetadata();
  initEventListeners();
  initSidebarCollapse();
  startSidebarClock();
  switchTab('dashboard'); // 첫 페이지 로드
  lucide.createIcons();

  // 스플래시 화면 페이드아웃 및 제거 (첫 실행 권한 설정 흐름 대응)
  const splash = document.getElementById('splash_screen');
  if (splash) {
    let isSetupInProgress = false;
    if (window.AndroidBridge && typeof window.AndroidBridge.isFirstRunSetupInProgress === 'function') {
      isSetupInProgress = window.AndroidBridge.isFirstRunSetupInProgress();
    }

    if (!isSetupInProgress) {
      setTimeout(() => {
        hideSplashScreen();
      }, 2500); // 로고 애니메이션 감상을 위해 2.5초간 노출 유지
    } else {
      console.log("[SpendLog] 첫 실행 권한 설정 진행 중으로 스플래시 화면을 유지합니다.");
    }
  }
}

// 스플래시 화면 수동/자동 숨김 헬퍼 함수
function hideSplashScreen() {
  const splash = document.getElementById('splash_screen');
  if (splash && !splash.classList.contains('fade-out')) {
    splash.classList.add('fade-out');
    setTimeout(() => {
      splash.style.display = 'none';
    }, 500); // CSS transition 시간(0.5초) 대기 후 숨김
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
    const [categories, payMethods, settings, presets] = await Promise.all([
      fetch('api/categories').then(r => r.json()),
      fetch('api/pay_methods').then(r => r.json()),
      fetch('api/settings').then(r => r.json()),
      fetch('api/rules/presets').then(r => r.json()).catch(() => [])
    ]);

    state.categories = categories;
    state.payMethods = payMethods;
    state.settings = settings;
    state.franchisePresets = presets;

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
const subTabTitles = {
  transactions: {
    all: ['거래 내역 - 전체 내역', '전체 수입 및 지출 상세 내역 조회 및 편집'],
    cards: ['거래 내역 - 카드 지출', '카드사별 이번 달 누적 결제 및 사용 분석'],
    banks: ['거래 내역 - 은행별 입출금', '각 은행 및 계좌별 실시간 잔액 및 입출금 분석']
  },
  analytics: {
    trend: ['소비 분석 - 소비 추이', '월별/연도별 자산 흐름 및 전년 대비 소비 비교'],
    general: ['소비 분석 - 일반지출 분석', '고정지출을 제외한 변동성 소비 패턴 분석'],
    fixed: ['소비 분석 - 고정지출 분석', '공과금/구독/보험/통신 등 매달 나가는 고정 비용 분석']
  },
  logs: {
    'logs-list': ['알림 로그 - 수신 로그', '안드로이드 기기에서 수집된 스마트폰 알림 원본 이력'],
    rules: ['알림 로그 - 자동 분류규칙', '알림에서 금액/사용처를 추출하기 위한 정규식 설정'],
    'pass-rules': ['알림 로그 - 자동 패스규칙', '가계부 등록을 생략하고 패스할 알림 패턴 설정'],
    merchant: ['알림 로그 - 사용처 설정', '사용처(가맹점)별 자동 분류 카테고리 매핑 설정']
  },
  settings: {
    default: ['설정 - 사용자 설정', '사용자 이름 및 기본 예산 설정'],
    balance: ['설정 - 잔액 설정', '각 자산별 초기 보유 잔액 및 포인트, 카드 실적 설정'],
    data: ['설정 - 데이터 관리', '가계부 데이터 백업, 복원 및 전체 초기화 관리']
  }
};

function getSubTabIdForTab(tabId) {
  if (tabId === 'transactions') return state.currentSubTab;
  if (tabId === 'analytics') return state.currentAnalyticsSubTab;
  if (tabId === 'logs') return state.currentLogsSubTab;
  if (tabId === 'settings') return state.currentSettingsSubTab;
  return null;
}

function updateHeaderTitle(mainTabId, subTabId) {
  const mainTitles = {
    dashboard: ['대시보드', '이번 달 소비 패턴 분석 및 통계'],
    transactions: ['거래 내역', '상세 가계부 내역 조회 및 편집'],
    analytics: ['소비 분석', '월별/연도별 자산 흐름 및 전년 대비 소비 비교'],
    income: ['소득 분석', '월별/연도별 수입 추이 및 카테고리별 비중 분석'],
    'ai-report': ['AI 소비 리포트', 'AI 모델 분석에 의한 월간 및 연간 종합 가계 피드백'],
    logs: ['알림 로그', '안드로이드 기기에서 수집된 스마트폰 알림 원본 이력'],
    settings: ['설정', '시스템 연동 정보 및 마스터 데이터 관리']
  };

  const titleEl = document.getElementById('page-title');
  const subtitleEl = document.getElementById('page-subtitle');
  if (!titleEl || !subtitleEl) return;

  if (subTabId && subTabTitles[mainTabId] && subTabTitles[mainTabId][subTabId]) {
    titleEl.textContent = subTabTitles[mainTabId][subTabId][0];
    subtitleEl.textContent = subTabTitles[mainTabId][subTabId][1];
  } else if (mainTitles[mainTabId]) {
    titleEl.textContent = mainTitles[mainTabId][0];
    subtitleEl.textContent = mainTitles[mainTabId][1];
  }
}

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
  updateHeaderTitle(tabId, getSubTabIdForTab(tabId));

  refreshCurrentTabData();
}

function switchTransactionSubTab(subtab) {
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

  // 헤더 업데이트
  updateHeaderTitle('transactions', subtab);
}

function navigateToAsset(name, isCard) {
  // 1. 거래 내역 탭으로 메인 전환
  switchTab('transactions');
  
  if (isCard) {
    // 2. 카드 서브 탭으로 전환
    switchTransactionSubTab('cards');
    // 3. 필터 셀렉터 값 변경
    const filter = document.getElementById('card-select-filter');
    if (filter) {
      filter.value = name;
    }
    // 4. 데이터 로드
    if (typeof loadCardExpenses === 'function') {
      loadCardExpenses();
    }
  } else {
    // 2. 은행 서브 탭으로 전환
    switchTransactionSubTab('banks');
    // 3. 필터 셀렉터 값 변경
    const filter = document.getElementById('bank-select-filter');
    if (filter) {
      filter.value = name;
    }
    // 4. 데이터 로드
    if (typeof loadBankTransactions === 'function') {
      loadBankTransactions();
    }
  }
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
    case 'income':
      if (typeof loadIncomeAnalytics === 'function') loadIncomeAnalytics();
      break;
    case 'logs':
      // 요약: 서브 탭 유지 상태에서 데이터 새로고침 및 설정/로그 서브탭 데이터 갱신 분기 처리.
      // 의존성: account_book/public/settings.js, account_book/public/rules.js
      initLogsSubTabs();
      if (state.currentLogsSubTab === 'logs-list') {
        if (typeof loadLogs === 'function') loadLogs();
      } else if (state.currentLogsSubTab === 'rules') {
        if (typeof loadRules === 'function') loadRules();
      } else if (state.currentLogsSubTab === 'pass-rules') {
        if (typeof loadPassRules === 'function') loadPassRules();
      } else if (state.currentLogsSubTab === 'merchant') {
        if (typeof loadMerchantCategories === 'function') loadMerchantCategories();
      }
      break;
    case 'ai-report':
      if (typeof initAiReportTab === 'function') initAiReportTab();
      break;
    case 'settings':
      initSettingsSubTabs();
      if (state.currentSettingsSubTab === 'default') {
        loadSettingsTab();
      } else if (state.currentSettingsSubTab === 'balance') {
        if (typeof loadBalanceSettings === 'function') loadBalanceSettings();
      } else if (state.currentSettingsSubTab === 'ai') {
        if (typeof loadAISettings === 'function') loadAISettings();
      } else if (state.currentSettingsSubTab === 'data') {
        if (typeof loadDataSettings === 'function') loadDataSettings();
      }
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

  // 소비 분석 내 서브 탭 클릭 이벤트
  document.querySelectorAll('.analytics-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const subtab = btn.dataset.subtab;
      state.currentAnalyticsSubTab = subtab;

      // 서브 탭 버튼 active 클래스 토글
      document.querySelectorAll('.analytics-tab-btn').forEach(b => {
        if (b.dataset.subtab === subtab) {
          b.classList.add('active');
        } else {
          b.classList.remove('active');
        }
      });

      // 서브 탭 뷰 토글
      document.querySelectorAll('.analytics-subview-content').forEach(view => {
        if (view.id === `analytics-subview-${subtab}`) {
          view.style.display = 'block';
          view.classList.add('active');
        } else {
          view.style.display = 'none';
          view.classList.remove('active');
        }
      });

      // 헤더 업데이트
      updateHeaderTitle('analytics', subtab);

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

  // 소득 분석 탭 내 연도 및 월 선택기 리스너
  const incomeYearSelect = document.getElementById('income-year-select');
  if (incomeYearSelect) {
    incomeYearSelect.addEventListener('change', () => {
      if (typeof loadIncomeAnalytics === 'function') loadIncomeAnalytics();
    });
  }
  const incomeMonthSelect = document.getElementById('income-month-select');
  if (incomeMonthSelect) {
    incomeMonthSelect.addEventListener('change', () => {
      if (typeof loadIncomeAnalytics === 'function') loadIncomeAnalytics();
    });
  }

  // 거래내역 검색 및 필터 변경
  document.getElementById('transaction-search').addEventListener('input', debounce(loadTransactions, 300));
  document.getElementById('filter-category').addEventListener('change', loadTransactions);

  // 수동 내역 추가 모달 트리거
  document.getElementById('add-transaction-btn').addEventListener('click', openAddTransactionModal);
  document.getElementById('transaction-modal-close').addEventListener('click', closeModal);
  document.getElementById('tx-modal-cancel').addEventListener('click', closeModal);

  // 수동 거래 구분(타입) 변경에 따른 카테고리 업데이트 및 모달 타이틀 변경
  document.getElementById('tx-type').addEventListener('change', (e) => {
    const type = e.target.value;
    updateCategorySelect('#tx-category', type);
    const titleEl = document.getElementById('transaction-modal-title');
    if (titleEl) {
      titleEl.textContent = type === 'INCOME' ? '수동 수입 추가' : '수동 지출 추가';
    }
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
    const pay_type = document.getElementById('tx-pay-type').value;
    
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
        body: JSON.stringify({ id, type, amount, merchant, category, pay_method, pay_type, datetime, memo, raw_text, used_point, package: pkgName })
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

        // 인앱 알림 상태 즉시 동기화
        if (window.NotificationsManager && typeof window.NotificationsManager.loadNotifications === 'function') {
          window.NotificationsManager.loadNotifications();
        }
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

  // 자동 패스 규칙 생성 버튼 트리거
  const newPassRuleBtn = document.getElementById('new-pass-rule-btn');
  if (newPassRuleBtn) {
    newPassRuleBtn.addEventListener('click', () => {
      loadPassRuleToEditor(null);
    });
  }

  const passRuleModal = document.getElementById('pass-rule-modal');
  const closePassRuleModal = () => {
    if (passRuleModal) passRuleModal.classList.remove('active');
  };

  const passCancelBtn = document.getElementById('pass-rule-cancel-btn');
  if (passCancelBtn) {
    passCancelBtn.addEventListener('click', closePassRuleModal);
  }

  const passModalCloseBtn = document.getElementById('pass-rule-modal-close-btn');
  if (passModalCloseBtn) {
    passModalCloseBtn.addEventListener('click', closePassRuleModal);
  }

  // 모달 외부 클릭 시 닫기
  if (ruleModal) {
    ruleModal.addEventListener('click', (e) => {
      if (e.target === ruleModal) {
        closeRuleModal();
      }
    });
  }
  if (passRuleModal) {
    passRuleModal.addEventListener('click', (e) => {
      if (e.target === passRuleModal) {
        closePassRuleModal();
      }
    });
  }

  // 규칙 처리 유형(등록/패스) 변경 리스너
  const ruleActionSelect = document.getElementById('rule-action');
  if (ruleActionSelect) {
    ruleActionSelect.addEventListener('change', () => {
      const payMethodSelect = document.getElementById('rule-pay-method');
      const payTypeSelect = document.getElementById('rule-pay-type');
      const categoryGroup = document.getElementById('rule-category-group');
      if (ruleActionSelect.value === 'PASS') {
        if (payMethodSelect) {
          payMethodSelect.disabled = true;
          payMethodSelect.style.opacity = '0.5';
          payMethodSelect.style.cursor = 'not-allowed';
        }
        if (payTypeSelect) {
          payTypeSelect.disabled = true;
          payTypeSelect.style.opacity = '0.5';
          payTypeSelect.style.cursor = 'not-allowed';
        }
        if (categoryGroup) {
          categoryGroup.style.display = 'none';
        }
      } else {
        if (payMethodSelect) {
          payMethodSelect.disabled = false;
          payMethodSelect.style.opacity = '1';
          payMethodSelect.style.cursor = 'default';
        }
        if (payTypeSelect) {
          payTypeSelect.disabled = false;
          payTypeSelect.style.opacity = '1';
          payTypeSelect.style.cursor = 'default';
        }
        if (categoryGroup) {
          categoryGroup.style.display = 'block';
        }
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
    const pay_type = document.getElementById('rule-pay-type').value;
    const action = document.getElementById('rule-action') ? document.getElementById('rule-action').value : 'REGISTER';

    try {
      const isPass = (action === 'PASS');
      const url = isPass ? 'api/pass_rules' : 'api/rules';
      const bodyData = isPass 
        ? { id, name, pattern }
        : { id, name, pattern, category, pay_method, pay_type, merchant_template: '${merchant}', type };

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyData)
      }).then(r => r.json());

      if (res.success) {
        closeRuleModal();
        loadRules();
        if (typeof loadPassRules === 'function') {
          loadPassRules();
        }
      }
    } catch (err) {
      alert('규칙 저장 실패: ' + err.message);
    }
  });

  // 패스 규칙 저장 서브밋
  const passRuleForm = document.getElementById('pass-rule-form');
  if (passRuleForm) {
    passRuleForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = document.getElementById('pass-rule-id').value;
      const name = document.getElementById('pass-rule-name').value;
      const pattern = document.getElementById('pass-rule-pattern').value;

      try {
        const res = await fetch('api/pass_rules', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, name, pattern })
        }).then(r => r.json());

        if (res.success) {
          closePassRuleModal();
          loadPassRules();
        }
      } catch (err) {
        alert('패스 규칙 저장 실패: ' + err.message);
      }
    });
  }

  // 규칙 테스터 실행 버튼
  const testRunBtn = document.getElementById('test-run-btn');
  if (testRunBtn) {
    testRunBtn.addEventListener('click', runRegexTest);
  }

  // 패스 규칙 테스터 실행 버튼
  const testPassRunBtn = document.getElementById('test-pass-run-btn');
  if (testPassRunBtn) {
    testPassRunBtn.addEventListener('click', runPassRegexTest);
  }

  // 정규식 패턴 자동 생성 버튼
  const autoGenBtn = document.getElementById('btn-auto-generate-pattern');
  if (autoGenBtn) {
    autoGenBtn.addEventListener('click', () => autoGeneratePattern(false));
  }

  // AI 정규식 패턴 자동 생성 버튼
  const aiGenBtn = document.getElementById('btn-ai-generate-pattern');
  if (aiGenBtn) {
    aiGenBtn.addEventListener('click', aiGeneratePattern);
  }

  // 로그 탭 새로고침
  document.getElementById('refresh-logs-btn').addEventListener('click', loadLogs);

  // 사용자 설정 폼 서브밋
  const settingsForm = document.getElementById('settings-form');
  if (settingsForm) {
    settingsForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const monthly_budget = parseInt(document.getElementById('settings-budget').value, 10);
      const user_real_name = document.getElementById('settings-real-name').value.trim();
      const auto_rule_generation = document.getElementById('settings-auto-rule').checked;

      try {
        const res = await fetch('api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ monthly_budget, user_real_name, auto_rule_generation })
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
        const encryptEl = document.getElementById('settings-manual-encrypt');
        const isEncrypt = encryptEl ? encryptEl.checked : false;

        if (window.AndroidBridge && typeof window.AndroidBridge.callApi === 'function') {
          const resStr = await window.AndroidBridge.callApi(`api/settings/backup?encrypt=${isEncrypt}`, JSON.stringify({ method: 'GET' }));
          const res = JSON.parse(resStr);
          if (res.body && res.body.success) {
            const backupStr = JSON.stringify(res.body.backupData, null, 2);
            window.AndroidBridge.shareText(backupStr, `account_book_backup_${new Date().toISOString().slice(0, 10)}.json`);
          } else {
            alert('백업 생성 실패: ' + (res.body?.error || '알 수 없는 오류'));
          }
        } else {
          window.location.href = `api/settings/backup?token=${encodeURIComponent(token)}&encrypt=${isEncrypt}`;
        }
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
          const fileContent = event.target.result.trim();
          let backupObj;

          if (fileContent.startsWith('{')) {
            backupObj = JSON.parse(fileContent);
          } else {
            // 암호화된 파일일 경우 백엔드에서 복호화하도록 감싸서 전송
            backupObj = { isEncrypted: true, rawBody: fileContent };
          }
          
          let res;
          if (window.AndroidBridge && typeof window.AndroidBridge.callApi === 'function') {
            const resStr = await window.AndroidBridge.callApi('api/settings/restore', JSON.stringify({
              method: 'POST',
              body: JSON.stringify(backupObj)
            }));
            const apiRes = JSON.parse(resStr);
            res = apiRes.body;
          } else {
            res = await fetch('api/settings/restore', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(backupObj)
            }).then(r => r.json());
          }

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

      // 카드사별 월 실적 목표 객체 구성
      const card_performance_goals = {};
      document.querySelectorAll('.settings-card-performance-goal-input').forEach(input => {
        const name = input.dataset.name;
        const val = parseInt(input.value, 10) || 0;
        card_performance_goals[name] = val;
      });

      // 카드사별 월 실적 기준일 객체 구성
      const card_performance_days = {};
      document.querySelectorAll('.settings-card-performance-day-input').forEach(input => {
        const name = input.dataset.name;
        const val = Math.max(1, Math.min(28, parseInt(input.value, 10) || 1));
        card_performance_days[name] = val;
      });

      try {
        const res = await fetch('api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ initial_balance, initial_balances, initial_points, card_performance_goals, card_performance_days })
        });

        if (!res.ok) {
          const errData = await res.json();
          throw new Error(errData.error || '서버 오류');
        }

        const data = await res.json();
        if (data.success) {
          alert('잔액, 포인트 및 실적 설정이 저장되었습니다.');
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
      
      const password = prompt('⚠️ 잔액을 초기화하려면 가계부 로그인 비밀번호를 입력해 주십시오:');
      if (password === null) return; // 취소 시 종료
      if (!password.trim()) {
        alert('비밀번호를 입력해야 합니다.');
        return;
      }

      try {
        const res = await fetch('api/settings/reset-balance', { 
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password })
        }).then(r => r.json());

        if (res.success) {
          alert('초기 잔액이 초기화되었습니다.');
          const balanceEl = document.getElementById('settings-initial-balance');
          if (balanceEl) balanceEl.value = 0;
          await loadMetadata();
          await loadBalanceSettings();
        } else {
          alert('초기화 실패: ' + (res.error || '오류 발생'));
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

      const password = prompt('⚠️ 전체 데이터를 영구 초기화하려면 가계부 로그인 비밀번호를 입력해 주십시오:');
      if (password === null) return; // 취소 시 종료
      if (!password.trim()) {
        alert('비밀번호를 입력해야 합니다.');
        return;
      }

      try {
        const res = await fetch('api/settings/reset-all', { 
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password })
        }).then(r => r.json());

        if (res.success) {
          alert('가계부의 모든 데이터와 설정이 초기화되었습니다. 페이지를 새로고침합니다.');
          location.reload();
        } else {
          alert('초기화 실패: ' + (res.error || '오류 발생'));
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

// 사이드바 접기/펼치기 제어
function initSidebarCollapse() {
  console.log("[SpendLog] initSidebarCollapse 실행 시작");
  const toggleBtn = document.getElementById('sidebar-collapse-toggle');
  if (!toggleBtn) {
    console.error("[SpendLog] 오류: sidebar-collapse-toggle 버튼 엘리먼트를 찾을 수 없습니다.");
    return;
  }
  console.log("[SpendLog] sidebar-collapse-toggle 버튼을 찾았습니다.");

  // 로컬스토리지에서 이전 상태 복원. 저장된 값이 없으면서 화면 너비가 1024px 이하(태블릿/모바일)인 경우 기본값 접힘(true)
  let isCollapsed = false;
  const storedVal = localStorage.getItem('sidebar-collapsed');
  if (storedVal !== null) {
    isCollapsed = storedVal === 'true';
    console.log("[SpendLog] 로컬스토리지 복원 collapsed 값:", isCollapsed);
  } else if (window.innerWidth <= 1024) {
    isCollapsed = true;
    localStorage.setItem('sidebar-collapsed', 'true');
    console.log("[SpendLog] 기본 1024px 이하에 의한 collapsed 기본값 설정: true");
  }

  if (isCollapsed) {
    document.body.classList.add('sidebar-collapsed');
  }

  let lastToggleTime = 0;
  const handleToggle = (e) => {
    // 포커스로 인한 아웃라인 및 탭 하이라이트 제거를 위해 강제 blur 처리
    if (toggleBtn) toggleBtn.blur();

    const now = Date.now();
    // 400ms 이내 연속 클릭/터치는 노이즈로 간주하고 차단
    if (now - lastToggleTime < 400) {
      console.log(`[SpendLog] 토글 이벤트 무시 (더블 탭 방지) - 간격: ${now - lastToggleTime}ms`);
      e.preventDefault();
      return;
    }
    lastToggleTime = now;

    e.preventDefault();
    console.log(`[SpendLog] 토글 이벤트 트리거됨 - 타입: ${e.type}`);
    const collapsed = document.body.classList.toggle('sidebar-collapsed');
    localStorage.setItem('sidebar-collapsed', collapsed);
    console.log("[SpendLog] 토글 완료, 현재 collapsed 상태:", collapsed);
    
    // 차트 크기가 변하므로 리사이즈 이벤트 강제 트리거
    setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
      console.log("[SpendLog] 리사이즈 이벤트 디스패치 완료");
    }, 300); // CSS 트랜지션 완료 후 실행
  };

  // 모바일 터치 반응성 확보 및 웹뷰 터치 무시 방지
  toggleBtn.addEventListener('click', handleToggle);
  toggleBtn.addEventListener('touchend', handleToggle);
  console.log("[SpendLog] click 및 touchend 이벤트 핸들러 바인딩 완료");
}

// 실시간 사이드바 날짜/시간 업데이트
function startSidebarClock() {
  const dateEl = document.getElementById('clock-date');
  const timeEl = document.getElementById('clock-time');
  if (!dateEl || !timeEl) return;

  function updateClock() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const date = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    
    dateEl.textContent = `${year}-${month}-${date}`;
    timeEl.textContent = `${hours}:${minutes}:${seconds}`;
  }

  updateClock();
  setInterval(updateClock, 1000);
}
