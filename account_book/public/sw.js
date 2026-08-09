/**
 * @file sw.js
 * @summary Smart Spendlog Service Worker
 * @description PWA 오프라인 캐싱 및 설치 기준 충족을 위한 서비스 워커입니다.
 */

const CACHE_NAME = 'smart-spendlog-rules-metadata-v1';
const ASSETS_TO_CACHE = [
  './index.html',
  './style.css',
  './variables.css',
  './navigation.css',
  './components.css',
  './views.css',
  './responsive.css',
  './app.js',
  './dashboard.js',
  './transactions.js',
  './card_bank_view.js',
  './rules.js',
  './analytics.js',
  './ai_report.js',
  './settings.js',
  './notifications.js',
  './icon/app_icon_192.png',
  './icon/app_icon_512.png'
];

// 설치 이벤트 - 에셋 캐싱
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] Caching app shell');
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => self.skipWaiting())
  );
});

// 활성화 이벤트 - 구버전 캐시 정리
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(
        keyList.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[Service Worker] Removing old cache', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// 페치 이벤트 - 네트워크 우선 + 캐시 폴백 전략 (API 요청은 제외)
self.addEventListener('fetch', (event) => {
  // API 요청이나 외부 CDN 등은 캐싱하지 않음
  if (event.request.url.includes('/api/') || !event.request.url.startsWith(self.location.origin)) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // 네트워크 요청 성공 시 캐시 업데이트
        if (response.status === 200) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      })
      .catch(() => {
        // 오프라인 시 캐시 반환
        return caches.match(event.request);
      })
  );
});
