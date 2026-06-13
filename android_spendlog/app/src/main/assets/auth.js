// ==========================================
// HA Account Book - Authentication & Session Management
// ==========================================

// 로그인 세션 상태 관리 (로컬 가계부 환경이므로 항상 'admin' 유저 세션 고정)
let currentUser = "admin";
let currentSession = null;

// 전역 Fetch 인터셉터 (모든 api/ 요청을 안드로이드 네이티브 브릿지 callApi로 중계)
const originalFetch = window.fetch;
window.fetch = async function (resource, options = {}) {
  const urlStr = typeof resource === 'string' ? resource : resource.url;
  
  if (urlStr.includes('api/') && window.AndroidBridge && typeof window.AndroidBridge.callApi === 'function') {
    try {
      let cleanUrl = urlStr;
      const apiIndex = urlStr.indexOf('api/');
      if (apiIndex !== -1) {
        cleanUrl = urlStr.substring(apiIndex);
      }
      
      const method = options.method || 'GET';
      const body = options.body || null;
      
      const resStr = await window.AndroidBridge.callApi(cleanUrl, JSON.stringify({
        method: method,
        body: body
      }));
      
      const apiRes = JSON.parse(resStr);
      
      return new Response(JSON.stringify(apiRes.body), {
        status: apiRes.status || 200,
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (e) {
      console.error('[Android Bridge Fetch Redirect Error]', e);
      return new Response(JSON.stringify({ success: false, error: e.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
  
  return await originalFetch(resource, options);
};

// 로그인/로그아웃 관련 보안 함수군 (로컬 전용 무력화)
async function attemptLogin(isAuto = false) {
  // 로컬 단독 구동이므로 아무것도 처리하지 않음
}

function logout() {
  // 로컬 단독 구동이므로 무효화
}

function checkLogin() {
  const overlay = document.getElementById('login_overlay');
  const profile = document.getElementById('user_profile');
  const mobileUserContainer = document.querySelector('.mobile-user-container');
  
  if (overlay) overlay.style.display = 'none'; // 로그인 오버레이 항상 강제 숨김
  if (profile) profile.style.display = 'none'; // 사이드바 프로필 항상 강제 숨김
  if (mobileUserContainer) mobileUserContainer.style.display = 'none'; // 모바일 프로필 항상 강제 숨김
  
  return true; // 로그인 검증 항상 통과
}
