// ==========================================
// 2. 가계부 거래 내역 탭 로직
// ==========================================

async function loadTransactions() {
  try {
    const search = document.getElementById('transaction-search').value;
    const category = document.getElementById('filter-category').value;
    
    let url = `api/transactions?month=${state.currentMonth}`;
    if (category) url += `&category=${encodeURIComponent(category)}`;
    if (search) url += `&search=${encodeURIComponent(search)}`;

    const data = await fetch(url).then(r => r.json());
    const tbody = document.getElementById('transaction-table-body');
    const footer = document.getElementById('transaction-table-footer');
    
    if (!tbody || !footer) return;
    tbody.innerHTML = '';

    if (data.length === 0) {
      footer.style.display = 'block';
      return;
    } else {
      footer.style.display = 'none';
    }

    data.forEach(tx => {
      const catStyle = state.categoryMap[tx.category] || { color: '#868e96', icon: 'tag' };
      const isIncome = tx.type === 'INCOME';
      const amtClass = isIncome ? 'text-income' : 'text-expense';
      const amtPrefix = isIncome ? '+' : '';

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td data-label="날짜/시간" class="text-secondary" style="font-size: 0.85rem;">${formatShortDate(tx.datetime)}</td>
        <td data-label="사용처" class="text-bold">${tx.merchant}</td>
        <td data-label="카테고리">
          <span class="category-badge" style="background-color: ${catStyle.color}15; color: ${catStyle.color}">
            ${tx.category}
          </span>
        </td>
        <td data-label="결제수단"><span class="tx-pay-method">${tx.pay_method}</span></td>
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

    lucide.createIcons();

  } catch (err) {
    console.error('거래 내역 로드 실패:', err);
  }
}

// 내역 삭제
async function deleteTransaction(id) {
  if (!confirm('정말로 이 내역을 삭제하시겠습니까?')) return;
  try {
    const res = await fetch(`api/transactions/${id}`, { method: 'DELETE' }).then(r => r.json());
    if (res.success) {
      refreshCurrentTabData();
    }
  } catch (err) {
    alert('삭제 오류: ' + err.message);
  }
}

// 모달 다이얼로그 제어
// 의존성: 이 모달 제어 함수들은 public/index.html의 폼과 public/app.js의 서브밋 이벤트와 밀기/받기 연동됩니다.
function openAddTransactionModal() {
  const modal = document.getElementById('transaction-modal');
  document.getElementById('transaction-form').reset();
  document.getElementById('tx-id').value = '';
  document.getElementById('tx-used-point').value = '';
  document.getElementById('transaction-modal-title').textContent = '수동 지출 추가';
  
  // 패키지 매핑 관련 초기화
  document.getElementById('tx-package-row').style.display = 'none';
  document.getElementById('tx-package').value = '';
  document.getElementById('tx-map-package').checked = false;

  // 기본 일시는 현재 시간
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  const localISOTime = (new Date(now - offset)).toISOString().slice(0, 16);
  document.getElementById('tx-datetime').value = localISOTime;

  document.getElementById('tx-type').value = 'EXPENSE';
  updateCategorySelect('#tx-category', 'EXPENSE');
  document.getElementById('tx-pay-method').value = '_AUTO_MAPPING_';

  modal.classList.add('active');
}

function openEditTransactionModal(tx) {
  const modal = document.getElementById('transaction-modal');
  document.getElementById('transaction-form').reset();
  
  document.getElementById('transaction-modal-title').textContent = tx.type === 'INCOME' ? '수입 내역 수정' : '지출 내역 수정';
  document.getElementById('tx-id').value = tx.id;
  document.getElementById('tx-type').value = tx.type || 'EXPENSE';
  document.getElementById('tx-amount').value = tx.amount;
  document.getElementById('tx-merchant').value = tx.merchant;
  document.getElementById('tx-used-point').value = tx.used_point || 0;

  // 패키지 매핑 관련 초기화
  document.getElementById('tx-package-row').style.display = 'none';
  document.getElementById('tx-package').value = '';
  document.getElementById('tx-map-package').checked = false;
  
  // 타입에 맞게 카테고리 로드 및 값 바인딩
  updateCategorySelect('#tx-category', tx.type || 'EXPENSE', tx.category);

  document.getElementById('tx-pay-method').value = tx.pay_method;
  document.getElementById('tx-memo').value = tx.memo || '';
  document.getElementById('tx-raw-text').value = tx.raw_text || '';

  // Datetime 포맷 변환 (YYYY-MM-DD HH:mm:ss -> YYYY-MM-DDTHH:mm)
  if (tx.datetime) {
    const dt = tx.datetime.replace(' ', 'T').slice(0, 16);
    document.getElementById('tx-datetime').value = dt;
  }

  modal.classList.add('active');
}

function closeModal() {
  document.getElementById('transaction-modal').classList.remove('active');
}
