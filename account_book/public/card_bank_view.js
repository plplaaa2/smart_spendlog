// ==========================================
// 2-B. 카드별 지출 및 은행별 입출금 내역 로직
// 요약: 거래 내역 탭 하위의 서브 탭 화면에서 카드별 지출 및 은행별 입출금을 조회하는 스크립트입니다.
// 의존성: public/index.html의 서브 탭 엘리먼트들과 public/app.js 및 public/transactions.js의 모달/삭제 유틸리티 함수들과 연동됩니다.
// ==========================================

// 드롭다운 변경 이벤트 등록
document.addEventListener('DOMContentLoaded', () => {
  const cardSelect = document.getElementById('card-select-filter');
  if (cardSelect) {
    cardSelect.addEventListener('change', () => {
      loadCardExpenses();
    });
  }

  const bankSelect = document.getElementById('bank-select-filter');
  if (bankSelect) {
    bankSelect.addEventListener('change', () => {
      loadBankTransactions();
    });
  }

  const bankTypeSelect = document.getElementById('bank-type-filter');
  if (bankTypeSelect) {
    bankTypeSelect.addEventListener('change', () => {
      loadBankTransactions();
    });
  }
});

// 카드별 지출 로드
async function loadCardExpenses() {
  try {
    // 1. 카드 및 페이(간편결제/머니/포인트 등) 목록 로드 및 셀렉터 구성
    const stats = await fetch(`api/stats?month=${state.currentMonth}`).then(r => r.json());
    const cardAssets = (stats.assets || []).filter(a => {
      if (a.isTotal) return false;
      const name = a.name;
      return a.isCard || name.includes('페이') || name.includes('머니') || name.includes('포인트');
    });

    const cardSelect = document.getElementById('card-select-filter');
    if (!cardSelect) return;

    const previousSelected = cardSelect.value;
    cardSelect.innerHTML = '';

    const favorites = JSON.parse(localStorage.getItem(getFavoriteKey()) || '[]');
    // 즐겨찾기 우선 정렬
    cardAssets.sort((a, b) => {
      const aFav = favorites.includes(a.name) ? 1 : 0;
      const bFav = favorites.includes(b.name) ? 1 : 0;
      if (aFav !== bFav) return bFav - aFav;
      return a.name.localeCompare(b.name);
    });

    if (cardAssets.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = '등록된 카드/페이 없음';
      cardSelect.appendChild(opt);
      
      document.getElementById('card-summary-box').innerHTML = '<p class="empty-message">설정 탭에서 결제 수단으로 카드 및 페이를 등록해 보세요.</p>';
      document.getElementById('card-transaction-table-body').innerHTML = '';
      document.getElementById('card-transaction-table-footer').style.display = 'block';
      return;
    }

    cardAssets.forEach(card => {
      const opt = document.createElement('option');
      opt.value = card.name;
      const isFav = favorites.includes(card.name);
      opt.textContent = (isFav ? '⭐ ' : '') + card.name;
      cardSelect.appendChild(opt);
    });

    // 기존 선택값 복구 또는 첫 번째 카드 선택
    if (previousSelected && cardAssets.some(c => c.name === previousSelected)) {
      cardSelect.value = previousSelected;
    } else {
      cardSelect.value = cardAssets[0].name;
    }

    const selectedCardName = cardSelect.value;
    const selectedCard = cardAssets.find(c => c.name === selectedCardName);

    // 2. 카드/페이 요약 정보 바인딩
    const summaryBox = document.getElementById('card-summary-box');
    if (summaryBox && selectedCard) {
      const hasPoint = selectedCard.initialPoint && selectedCard.initialPoint > 0;
      let pointHtml = '';
      if (hasPoint) {
        pointHtml = `
          <div style="display: flex; gap: 1.5rem; border-left: 1px solid rgba(255,255,255,0.08); padding-left: 1.5rem;">
            <div>
              <span style="font-size: 0.8rem; color: var(--text-secondary); display: block; margin-bottom: 0.25rem;">지원금 한도</span>
              <span style="font-size: 1.05rem; font-weight: 600; color: var(--text-primary);">${formatCurrency(selectedCard.initialPoint)}</span>
            </div>
            <div>
              <span style="font-size: 0.8rem; color: var(--text-secondary); display: block; margin-bottom: 0.25rem;">남은 지원금</span>
              <span style="font-size: 1.05rem; font-weight: 600; color: #38bdf8;">${formatCurrency(selectedCard.remainingPoint)}</span>
            </div>
          </div>
        `;
      }

      // 페이 종류 자산인지 검사하여 전용 아이콘 및 라벨 제공
      const isPayOrMoney = selectedCard.name.includes('페이') || selectedCard.name.includes('머니') || selectedCard.name.includes('포인트');
      const iconName = isPayOrMoney ? 'wallet' : 'credit-card';
      const iconBg = isPayOrMoney ? 'rgba(16, 185, 129, 0.15)' : 'rgba(99, 102, 241, 0.15)';
      const iconColor = isPayOrMoney ? '#10b981' : '#6366f1';
      const assetTypeLabel = isPayOrMoney ? '페이' : '카드';

      const isFav = favorites.includes(selectedCard.name);
      const starFill = isFav ? '#f59e0b' : 'none';
      const starColor = isFav ? '#f59e0b' : 'var(--text-secondary)';
      const starIconHtml = `
        <button class="icon-btn fav-star-btn" style="color: ${starColor}; margin-left: 0.25rem; display: inline-flex; align-items: center; justify-content: center; padding: 0.15rem; transition: all 0.2s;" onclick="toggleFavoriteAsset('${selectedCard.name}', 'card')" title="${isFav ? '즐겨찾기 해제' : '즐겨찾기 등록'}">
          <i data-lucide="star" style="width: 18px; height: 18px; fill: ${starFill}; stroke: ${starColor};"></i>
        </button>
      `;

      summaryBox.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem;">
          <div style="display: flex; align-items: center; gap: 1rem;">
            <div style="background: ${iconBg}; color: ${iconColor}; width: 44px; height: 44px; border-radius: 10px; display: flex; align-items: center; justify-content: center;">
              <i data-lucide="${iconName}" style="width: 22px; height: 22px;"></i>
            </div>
            <div>
              <h4 style="font-size: 1.1rem; font-weight: 700; color: var(--text-primary); margin-bottom: 0.15rem; display: inline-flex; align-items: center; gap: 0.25rem;">
                ${selectedCard.name}
                ${starIconHtml}
              </h4>
              <span style="font-size: 0.75rem; color: var(--text-secondary);">이번 달 ${assetTypeLabel} 누적 사용 분석</span>
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: 1.5rem; flex-wrap: wrap;">
            <div>
              <span style="font-size: 0.8rem; color: var(--text-secondary); display: block; margin-bottom: 0.25rem;">이번 달 결제금액</span>
              <span style="font-size: 1.25rem; font-weight: 800; color: #f43f5e;">${formatCurrency(selectedCard.monthExpense)}</span>
            </div>
            ${pointHtml}
          </div>
        </div>
      `;
    }

    // 3. 카드 지출 내역 로드 (지출 내역 위주로 조회)
    let url = `api/transactions?month=${state.currentMonth}&pay_method=${encodeURIComponent(selectedCardName)}&type=EXPENSE`;
    const data = await fetch(url).then(r => r.json());

    const tbody = document.getElementById('card-transaction-table-body');
    const footer = document.getElementById('card-transaction-table-footer');

    if (!tbody || !footer) return;
    tbody.innerHTML = '';

    if (data.length === 0) {
      footer.style.display = 'block';
    } else {
      footer.style.display = 'none';
      data.forEach(tx => {
        const catStyle = state.categoryMap[tx.category] || { color: '#868e96', icon: 'tag' };
        const tr = document.createElement('tr');
        
        let pointDeduction = '';
        if (tx.used_point && tx.used_point > 0) {
          pointDeduction = `<span style="font-size: 0.75rem; color: #38bdf8; display: block; font-weight: 500;">(P ${formatCurrency(tx.used_point).replace('원', '')} 차감)</span>`;
        }

        tr.innerHTML = `
          <td data-label="날짜/시간" class="text-secondary" style="font-size: 0.85rem;">${formatShortDate(tx.datetime)}</td>
          <td data-label="사용처" class="text-bold">${tx.merchant}</td>
          <td data-label="카테고리">
            <span class="category-badge" style="background-color: ${catStyle.color}15; color: ${catStyle.color}">
              ${tx.category}
            </span>
          </td>
          <td data-label="금액" class="text-bold text-right text-expense">
            ${formatCurrency(tx.amount)}
            ${pointDeduction}
          </td>
          <td data-label="메모" class="text-secondary text-sm">${tx.memo || '-'}</td>
          <td data-label="관리">
            <div class="table-actions">
              <button class="icon-btn" onclick="openEditTransactionModal(${JSON.stringify(tx).replace(/"/g, '&quot;')})">
                <i data-lucide="edit-2" style="width:16px;height:16px;"></i>
              </button>
              <button class="icon-btn" onclick="deleteTransaction(${tx.id})" style="color:var(--danger-color)">
                <i data-lucide="trash" style="width:16px;height:16px;"></i>
              </button>
            </div>
          </td>
        `;
        tbody.appendChild(tr);
      });
    }

    if (window.lucide) {
      window.lucide.createIcons();
    }

  } catch (err) {
    console.error('카드별 지출 내역 로드 실패:', err);
  }
}

// 은행별 입출금 로드
async function loadBankTransactions() {
  try {
    // 1. 은행 목록 로드 및 셀렉터 구성
    const stats = await fetch(`api/stats?month=${state.currentMonth}`).then(r => r.json());
    // 총 자산(모든 은행 합계) 및 카드를 제외하고, 현금/페이/포인트 등 비-은행 성격 자산 제외
    const bankAssets = (stats.assets || []).filter(a => {
      if (a.isCard || a.isTotal) return false;
      const name = a.name;
      if (
        name === '현금' || 
        name.includes('페이') || 
        name.includes('머니') || 
        name.includes('포인트') ||
        name.includes('쿠폰') ||
        name.includes('상품권')
      ) {
        return false;
      }
      return true;
    });

    const bankSelect = document.getElementById('bank-select-filter');
    if (!bankSelect) return;

    const previousSelected = bankSelect.value;
    bankSelect.innerHTML = '';

    const favorites = JSON.parse(localStorage.getItem(getFavoriteKey()) || '[]');
    // 즐겨찾기 우선 정렬
    bankAssets.sort((a, b) => {
      const aFav = favorites.includes(a.name) ? 1 : 0;
      const bFav = favorites.includes(b.name) ? 1 : 0;
      if (aFav !== bFav) return bFav - aFav;
      return a.name.localeCompare(b.name);
    });

    if (bankAssets.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = '등록된 은행 없음';
      bankSelect.appendChild(opt);

      document.getElementById('bank-summary-box').innerHTML = '<p class="empty-message">설정 탭에서 결제 수단으로 은행/계좌를 등록하고 초기 잔액을 설정해 보세요.</p>';
      document.getElementById('bank-transaction-table-body').innerHTML = '';
      document.getElementById('bank-transaction-table-footer').style.display = 'block';
      return;
    }

    bankAssets.forEach(bank => {
      const opt = document.createElement('option');
      opt.value = bank.name;
      const isFav = favorites.includes(bank.name);
      opt.textContent = (isFav ? '⭐ ' : '') + bank.name;
      bankSelect.appendChild(opt);
    });

    // 기존 선택값 복구 또는 첫 번째 계좌 선택
    if (previousSelected && bankAssets.some(b => b.name === previousSelected)) {
      bankSelect.value = previousSelected;
    } else {
      bankSelect.value = bankAssets[0].name;
    }

    const selectedBankName = bankSelect.value;
    const selectedBank = bankAssets.find(b => b.name === selectedBankName);

    // 2. 은행 요약 정보 바인딩
    const summaryBox = document.getElementById('bank-summary-box');
    if (summaryBox && selectedBank) {
      const balanceColor = selectedBank.currentBalance < 0 ? '#ef4444' : '#10b981';

      const isFav = favorites.includes(selectedBank.name);
      const starFill = isFav ? '#f59e0b' : 'none';
      const starColor = isFav ? '#f59e0b' : 'var(--text-secondary)';
      const starIconHtml = `
        <button class="icon-btn fav-star-btn" style="color: ${starColor}; margin-left: 0.25rem; display: inline-flex; align-items: center; justify-content: center; padding: 0.15rem; transition: all 0.2s;" onclick="toggleFavoriteAsset('${selectedBank.name}', 'bank')" title="${isFav ? '즐겨찾기 해제' : '즐겨찾기 등록'}">
          <i data-lucide="star" style="width: 18px; height: 18px; fill: ${starFill}; stroke: ${starColor};"></i>
        </button>
      `;

      summaryBox.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem;">
          <div style="display: flex; align-items: center; gap: 1rem;">
            <div style="background: rgba(16, 185, 129, 0.15); color: #10b981; width: 44px; height: 44px; border-radius: 10px; display: flex; align-items: center; justify-content: center;">
              <i data-lucide="landmark" style="width: 22px; height: 22px;"></i>
            </div>
            <div>
              <h4 style="font-size: 1.1rem; font-weight: 700; color: var(--text-primary); margin-bottom: 0.15rem; display: inline-flex; align-items: center; gap: 0.25rem;">
                ${selectedBank.name}
                ${starIconHtml}
              </h4>
              <span style="font-size: 0.75rem; color: var(--text-secondary);">실시간 통장 잔액 및 이번 달 흐름</span>
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: 1.5rem; flex-wrap: wrap;">
            <div>
              <span style="font-size: 0.8rem; color: var(--text-secondary); display: block; margin-bottom: 0.25rem;">현재 잔액</span>
              <span style="font-size: 1.25rem; font-weight: 800; color: ${balanceColor};">${formatCurrency(selectedBank.currentBalance)}</span>
            </div>
            <div style="display: flex; gap: 1.5rem; border-left: 1px solid rgba(255,255,255,0.08); padding-left: 1.5rem;">
              <div>
                <span style="font-size: 0.8rem; color: var(--text-secondary); display: block; margin-bottom: 0.25rem;">이번 달 입금 (수입)</span>
                <span style="font-size: 1.05rem; font-weight: 600; color: #10b981;">+${formatCurrency(selectedBank.monthIncome)}</span>
              </div>
              <div>
                <span style="font-size: 0.8rem; color: var(--text-secondary); display: block; margin-bottom: 0.25rem;">이번 달 출금 (지출)</span>
                <span style="font-size: 1.05rem; font-weight: 600; color: #6366f1;">-${formatCurrency(selectedBank.monthExpense)}</span>
              </div>
            </div>
          </div>
        </div>
      `;
    }

    // 3. 은행 거래 내역 로드 (입출금 유형 필터 반영)
    const typeFilter = document.getElementById('bank-type-filter').value;
    let url = `api/transactions?month=${state.currentMonth}&pay_method=${encodeURIComponent(selectedBankName)}`;
    if (typeFilter) {
      url += `&type=${typeFilter}`;
    }
    const data = await fetch(url).then(r => r.json());

    const tbody = document.getElementById('bank-transaction-table-body');
    const footer = document.getElementById('bank-transaction-table-footer');

    if (!tbody || !footer) return;
    tbody.innerHTML = '';

    if (data.length === 0) {
      footer.style.display = 'block';
    } else {
      footer.style.display = 'none';
      data.forEach(tx => {
        const catStyle = state.categoryMap[tx.category] || { color: '#868e96', icon: 'tag' };
        const isIncome = tx.type === 'INCOME';
        const amtClass = isIncome ? 'text-income' : 'text-expense';
        const amtPrefix = isIncome ? '+' : '-';
        const typeBadge = isIncome 
          ? `<span class="category-badge" style="background-color: rgba(16, 185, 129, 0.15); color: #10b981;">입금</span>` 
          : `<span class="category-badge" style="background-color: rgba(99, 102, 241, 0.15); color: #6366f1;">출금</span>`;

        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td data-label="날짜/시간" class="text-secondary" style="font-size: 0.85rem;">${formatShortDate(tx.datetime)}</td>
          <td data-label="사용처" class="text-bold">${tx.merchant}</td>
          <td data-label="유형">${typeBadge}</td>
          <td data-label="카테고리">
            <span class="category-badge" style="background-color: ${catStyle.color}15; color: ${catStyle.color}">
              ${tx.category}
            </span>
          </td>
          <td data-label="금액" class="text-bold text-right ${amtClass}">${amtPrefix}${formatCurrency(tx.amount)}</td>
          <td data-label="메모" class="text-secondary text-sm">${tx.memo || '-'}</td>
          <td data-label="관리">
            <div class="table-actions">
              <button class="icon-btn" onclick="openEditTransactionModal(${JSON.stringify(tx).replace(/"/g, '&quot;')})">
                <i data-lucide="edit-2" style="width:16px;height:16px;"></i>
              </button>
              <button class="icon-btn" onclick="deleteTransaction(${tx.id})" style="color:var(--danger-color)">
                <i data-lucide="trash" style="width:16px;height:16px;"></i>
              </button>
            </div>
          </td>
        `;
        tbody.appendChild(tr);
      });
    }

    if (window.lucide) {
      window.lucide.createIcons();
    }

  } catch (err) {
    console.error('은행별 입출금 내역 로드 실패:', err);
  }
}

// 사용자별 즐겨찾기 격리 키 반환
function getFavoriteKey() {
  const user = (typeof currentUser !== 'undefined' ? currentUser : null) || sessionStorage.getItem('ab_user') || localStorage.getItem('ab_user') || 'default';
  return `favorite_assets_${user}`;
}

// 즐겨찾기 자산 토글 처리 함수
function toggleFavoriteAsset(assetName, type) {
  const key = getFavoriteKey();
  const favorites = JSON.parse(localStorage.getItem(key) || '[]');
  const index = favorites.indexOf(assetName);
  if (index > -1) {
    favorites.splice(index, 1);
  } else {
    favorites.push(assetName);
  }
  localStorage.setItem(key, JSON.stringify(favorites));
  
  if (type === 'card') {
    loadCardExpenses();
  } else if (type === 'bank') {
    loadBankTransactions();
  }
}
window.toggleFavoriteAsset = toggleFavoriteAsset;
