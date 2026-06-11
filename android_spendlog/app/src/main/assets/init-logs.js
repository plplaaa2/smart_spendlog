/**
 * 알림 로그 메뉴의 하부 탭(수신 로그, 자동 분류규칙 등) 클릭이 작동하지 않는 문제를 해결하기 위한 초기화 스크립트
 */

function initLogsSubTabs() {
  if (window.isLogsSubTabInitialized) return;

  const tabBtns = document.querySelectorAll('.logs-tab-btn');
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const subtab = btn.dataset.subtab;
      switchLogsSubTab(subtab);
    });
  });

  window.isLogsSubTabInitialized = true;
}

function switchLogsSubTab(subtab) {
  if (!subtab) return;

  // Update active class on buttons
  const tabBtns = document.querySelectorAll('.logs-tab-btn');
  tabBtns.forEach(btn => {
    if (btn.dataset.subtab === subtab) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  // Update visibility of content sections
  const contents = document.querySelectorAll('.sub-logs-content');
  contents.forEach(content => {
    if (content.id === `subtab-${subtab}`) {
      content.style.display = 'block';
      content.classList.add('active');
    } else {
      content.style.display = 'none';
      content.classList.remove('active');
    }
  });
}

// 페이지 로드 시 또는 탭 전환 시 실행되도록 보장
if (document.readyState === 'complete') {
  initLogsSubTabs();
} else {
  window.addEventListener('load', initLogsSubTabs);
}

// 사이드바에서 '알림 로그' 탭을 클릭했을 때도 초기화가 필요할 수 있음
const navLogsBtn = document.getElementById('nav-logs-btn');
if (navLogsBtn) {
  navLogsBtn.addEventListener('click', () => {
    initLogsSubTabs();
  });
}
