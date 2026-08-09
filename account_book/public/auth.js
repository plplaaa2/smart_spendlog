// ==========================================
// HA Account Book - Authentication & Session Management
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
      const clockCard = document.getElementById('sidebar_clock_card');
      if (clockCard) clockCard.style.display = 'flex';
      const toggleBtn = document.getElementById('sidebar-collapse-toggle');
      if (toggleBtn) toggleBtn.style.display = 'flex';
      const mobileNav = document.querySelector('.mobile-bottom-nav');
      if (mobileNav) mobileNav.style.display = '';
      document.body.classList.remove('login-screen');
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
  const toggleBtn = document.getElementById('sidebar-collapse-toggle');
  const mobileNav = document.querySelector('.mobile-bottom-nav');
  if (currentUser) {
    if (overlay) overlay.style.display = 'none';
    const clockCard = document.getElementById('sidebar_clock_card');
    if (clockCard) clockCard.style.display = 'flex';
    if (toggleBtn) toggleBtn.style.display = 'flex';
    if (mobileNav) mobileNav.style.display = '';
    document.body.classList.remove('login-screen');
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
    const clockCard = document.getElementById('sidebar_clock_card');
    if (clockCard) clockCard.style.display = 'none';
    if (toggleBtn) toggleBtn.style.display = 'none';
    if (profile) profile.style.display = 'none';
    if (mobileNav) mobileNav.style.display = 'none';
    document.body.classList.add('login-screen');
    
    if (currentSession) {
      attemptLogin(true);
    }
    return false;
  }
}
