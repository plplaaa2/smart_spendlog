/**
 * @file public/notifications.js
 * @summary 가계부 인앱 알림 센터 제어 스크립트
 * @description 알림 종 배지 제어, 슬라이딩 오프캔버스 드로어 렌더링 및 실시간 토스트 알림 팝업을 담당합니다.
 */

const NotificationsManager = {
  unreadCount: 0,
  notificationsList: [],
  lastMaxId: 0,
  pollingInterval: null,

  // DOM elements
  elements: {},

  init() {
    this.elements = {
      bellBtn: document.getElementById('notification-bell-btn'),
      badge: document.getElementById('notification-badge'),
      drawer: document.getElementById('notification-drawer'),
      closeBtn: document.getElementById('notification-drawer-close'),
      listContainer: document.getElementById('notification-drawer-list'),
      readAllBtn: document.getElementById('btn-notifications-read-all'),
      deleteAllBtn: document.getElementById('btn-notifications-delete-all'),
      toastContainer: document.getElementById('toast-container'),
      overlay: document.getElementById('notification-drawer-overlay')
    };

    if (!this.elements.bellBtn) return;

    this.bindEvents();
    this.loadNotifications(true); // 첫 로드
    this.startPolling();
  },

  bindEvents() {
    // 알림 종 클릭 -> 드로어 토글
    this.elements.bellBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isActive = this.elements.drawer.classList.toggle('active');
      if (this.elements.overlay) {
        this.elements.overlay.classList.toggle('active', isActive);
      }
      if (isActive) {
        // 드로어를 열 때 전체 읽음 처리하진 않고, 목록을 한 번 갱신
        this.loadNotifications();
      }
    });

    // 드로어 닫기 버튼
    this.elements.closeBtn.addEventListener('click', () => {
      this.elements.drawer.classList.remove('active');
      if (this.elements.overlay) {
        this.elements.overlay.classList.remove('active');
      }
    });

    // 드로어 overlay 클릭 시 닫기
    if (this.elements.overlay) {
      this.elements.overlay.addEventListener('click', () => {
        this.elements.drawer.classList.remove('active');
        this.elements.overlay.classList.remove('active');
      });
    }

    // 드로어 바깥 클릭 시 닫기
    document.addEventListener('click', (e) => {
      if (this.elements.drawer.classList.contains('active') &&
          !this.elements.drawer.contains(e.target) &&
          !this.elements.bellBtn.contains(e.target)) {
        this.elements.drawer.classList.remove('active');
        if (this.elements.overlay) {
          this.elements.overlay.classList.remove('active');
        }
      }
    });

    // 모두 읽음 버튼
    this.elements.readAllBtn.addEventListener('click', () => {
      this.markAsRead(null, true);
    });

    // 모두 삭제 버튼
    this.elements.deleteAllBtn.addEventListener('click', () => {
      if (confirm('모든 알림을 삭제하시겠습니까?')) {
        this.deleteNotification(null, true);
      }
    });
  },

  startPolling() {
    if (this.pollingInterval) clearInterval(this.pollingInterval);
    // 30초마다 알림 정보 폴링
    this.pollingInterval = setInterval(() => {
      this.loadNotifications(false);
    }, 30000);
  },

  async loadNotifications(isFirstLoad = false) {
    try {
      const token = localStorage.getItem('ab_token') || sessionStorage.getItem('ab_token');
      if (!token) return;

      const res = await fetch(`/api/notifications?token=${encodeURIComponent(token)}`);
      if (!res.ok) return;

      const data = await res.json();
      if (!data.success) return;

      this.unreadCount = data.unreadCount || 0;
      this.notificationsList = data.list || [];

      this.updateBadge();
      this.renderList();

      // 최댓값 ID 계산
      const currentMaxId = this.notificationsList.length > 0 
        ? Math.max(...this.notificationsList.map(n => n.id)) 
        : 0;

      // 첫 로드가 아니고, 새로운 알림이 수신되었을 경우 토스트 알림 띄움
      if (!isFirstLoad && this.lastMaxId > 0 && currentMaxId > this.lastMaxId) {
        const newItems = this.notificationsList.filter(n => n.id > this.lastMaxId);
        // 타임스탬프 순서대로 토스트 표출
        newItems.reverse().forEach(item => {
          this.showToast(item);
        });
      }

      this.lastMaxId = currentMaxId;
    } catch (err) {
      console.error('[Notification] 알림 로드 중 에러:', err);
    }
  },

  updateBadge() {
    if (this.unreadCount > 0) {
      this.elements.badge.style.display = 'block';
    } else {
      this.elements.badge.style.display = 'none';
    }
  },

  renderList() {
    const container = this.elements.listContainer;
    if (!container) return;

    if (this.notificationsList.length === 0) {
      container.innerHTML = `
        <div class="empty-notifications">
          <i data-lucide="bell-off" style="width:32px; height:32px; opacity:0.5; margin-bottom:0.5rem;"></i>
          <p>최근 알림이 없습니다.</p>
        </div>
      `;
      if (window.lucide) lucide.createIcons();
      return;
    }

    let html = '';
    this.notificationsList.forEach(item => {
      const unreadClass = item.is_read === 0 ? 'unread' : '';
      const iconDetails = this.getIconDetails(item.type);
      const timeStr = this.timeAgo(item.created_at);

      html += `
        <div class="notification-item ${unreadClass}" data-id="${item.id}">
          <div class="notification-item-icon ${item.type.toLowerCase()}">
            <i data-lucide="${iconDetails.icon}" style="width:16px; height:16px;"></i>
          </div>
          <div class="notification-item-body">
            <div class="notification-item-title">${item.title}</div>
            <div class="notification-item-desc">${item.message}</div>
            <div class="notification-item-time">${timeStr}</div>
          </div>
          <button class="notification-item-delete" data-id="${item.id}" title="알림 삭제">
            <i data-lucide="x" style="width:14px; height:14px;"></i>
          </button>
        </div>
      `;
    });

    container.innerHTML = html;
    if (window.lucide) lucide.createIcons();

    // 개별 알림 클릭 시 읽음 처리 바인딩
    container.querySelectorAll('.notification-item').forEach(el => {
      el.addEventListener('click', (e) => {
        // 만약 삭제 버튼 클릭 시 중복 처리 방지
        if (e.target.closest('.notification-item-delete')) return;
        const id = parseInt(el.getAttribute('data-id'), 10);
        const item = this.notificationsList.find(n => n.id === id);
        if (item && item.is_read === 0) {
          this.markAsRead(id);
        }
      });
    });

    // 개별 삭제 버튼 이벤트 바인딩
    container.querySelectorAll('.notification-item-delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = parseInt(btn.getAttribute('data-id'), 10);
        this.deleteNotification(id);
      });
    });
  },

  showToast(item) {
    if (!this.elements.toastContainer) return;

    const toast = document.createElement('div');
    toast.className = 'toast';
    const iconDetails = this.getIconDetails(item.type);

    toast.innerHTML = `
      <div class="toast-icon ${item.type.toLowerCase()}">
        <i data-lucide="${iconDetails.icon}" style="width:16px; height:16px;"></i>
      </div>
      <div class="toast-body">
        <div class="toast-title">${item.title}</div>
        <div class="toast-desc">${item.message.split('\n')[0]}</div>
      </div>
    `;

    this.elements.toastContainer.appendChild(toast);
    if (window.lucide) lucide.createIcons({ props: { style: 'width:16px; height:16px;' } });

    // 토스트 클릭 시 알림 센터 드로어 열기
    toast.addEventListener('click', () => {
      this.elements.drawer.classList.add('active');
      if (this.elements.overlay) {
        this.elements.overlay.classList.add('active');
      }
      this.markAsRead(item.id);
      toast.remove();
    });

    // 4초 후 서서히 사라짐
    setTimeout(() => {
      toast.classList.add('fade-out');
      toast.addEventListener('animationend', () => {
        toast.remove();
      });
    }, 4000);
  },

  async markAsRead(id, all = false) {
    try {
      const token = localStorage.getItem('ab_token') || sessionStorage.getItem('ab_token');
      if (!token) return;

      const res = await fetch(`/api/notifications/read?token=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ id, all })
      });

      if (res.ok) {
        this.loadNotifications();
      }
    } catch (err) {
      console.error('[Notification] 읽음 처리 실패:', err);
    }
  },

  async deleteNotification(id, all = false) {
    try {
      const token = localStorage.getItem('ab_token') || sessionStorage.getItem('ab_token');
      if (!token) return;

      const res = await fetch(`/api/notifications/delete?token=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ id, all })
      });

      if (res.ok) {
        this.loadNotifications();
      }
    } catch (err) {
      console.error('[Notification] 삭제 처리 실패:', err);
    }
  },

  getIconDetails(type) {
    switch (type) {
      case 'BUDGET_OVER':
        return { icon: 'alert-triangle' };
      case 'BUDGET_NEAR':
        return { icon: 'alert-circle' };
      case 'DEFICIT':
        return { icon: 'trending-down' };
      case 'CARD_PERF':
        return { icon: 'award' };
      case 'UNCLASSIFIED':
        return { icon: 'help-circle' };
      default:
        return { icon: 'bell' };
    }
  },

  timeAgo(dateStr) {
    try {
      let past;
      if (dateStr.includes(' ')) {
        const formatted = dateStr.replace(' ', 'T') + 'Z';
        past = new Date(formatted);
      } else {
        past = new Date(dateStr);
      }

      if (isNaN(past.getTime())) {
        return dateStr;
      }

      const now = new Date();
      const diffMs = now.getTime() - past.getTime();
      const diffMin = Math.floor(diffMs / 60000);

      if (diffMin < 1) return '방금 전';
      if (diffMin < 60) return `${diffMin}분 전`;

      const diffHr = Math.floor(diffMin / 60);
      if (diffHr < 24) return `${diffHr}시간 전`;

      const diffDay = Math.floor(diffHr / 24);
      if (diffDay === 1) return '어제';
      if (diffDay < 7) return `${diffDay}일 전`;

      const year = past.getFullYear();
      const month = String(past.getMonth() + 1).padStart(2, '0');
      const day = String(past.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    } catch (e) {
      return dateStr;
    }
  }
};

// DOM 로드 시 매니저 초기화 등록
document.addEventListener('DOMContentLoaded', () => {
  NotificationsManager.init();
});
