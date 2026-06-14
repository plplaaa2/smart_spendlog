// ==========================================
// 6-C. 일반지출 분석 (General Expense Analytics) 로직
// ==========================================

// 일반지출 데이터 로드 및 렌더링 총괄 함수
async function loadGeneralAnalytics(year, month) {
  try {
    const res = await fetch(`api/analytics/general?year=${year}&month=${month}`).then(r => r.json());
    
    const isYearly = (month === 'all');
    const periodLabel = isYearly ? '올해' : '이번 달';
    const periodDetailLabel = isYearly ? `${year}년 전체` : `${parseInt(month, 10)}월`;

    // 다이나믹 라벨 및 타이틀 세팅
    const totalLabelEl = document.getElementById('general-total-label');
    if (totalLabelEl) totalLabelEl.textContent = `${periodLabel} 일반지출`;
    const nonGeneralLabelEl = document.getElementById('non-general-total-label');
    if (nonGeneralLabelEl) nonGeneralLabelEl.textContent = `일반지출 제외 지출액 (${periodLabel})`;

    const subviewTitleEl = document.getElementById('general-subview-title');
    if (subviewTitleEl) subviewTitleEl.textContent = `${periodDetailLabel} 일반지출 거래 내역`;
    const emptyMsgEl = document.getElementById('general-transaction-table-empty-msg');
    if (emptyMsgEl) emptyMsgEl.textContent = `${periodDetailLabel} 일반지출 거래 내역이 없습니다.`;

    const trendTitleEl = document.getElementById('general-trend-title');
    if (trendTitleEl) {
      trendTitleEl.textContent = isYearly ? `일반지출 월별 추이 (${year}년)` : '일반지출 월별 추이 (최근 6개월)';
    }

    // 1. 상단 요약 카드 데이터 반영
    const generalTotal = res.generalTotal || 0;
    const totalSpent = res.totalSpent || 0;
    
    const generalRatio = totalSpent > 0 ? Math.round((generalTotal / totalSpent) * 100) : 0;
    const nonGeneralTotal = Math.max(0, totalSpent - generalTotal);

    document.getElementById('general-total-value').textContent = formatCurrency(generalTotal);
    document.getElementById('general-ratio-value').textContent = `${generalRatio}%`;
    document.getElementById('non-general-total-value').textContent = formatCurrency(nonGeneralTotal);

    // 필터 상태 초기화
    selectedGeneralCategory = null;

    // 2. 월별 일반지출 추이 차트 렌더링
    renderGeneralMonthlyTrendChart(res.trend);

    // 3. 일반지출 카테고리별 비중 차트 렌더링
    renderGeneralCategoryChart(res.categories);

    // [NEW] 카테고리별 일반소비 요약 테이블 렌더링
    renderGeneralCategorySummaryTable(res.categories, totalSpent, generalTotal, res.transactions);

    // 4. 일반지출 상세 거래 내역 테이블 렌더링
    renderGeneralTransactionTable(res.transactions);

    // 아이콘 새로 렌더링
    if (window.lucide) {
      lucide.createIcons();
    }
  } catch (err) {
    console.error('일반지출 분석 데이터 로드 실패:', err);
  }
}

// [NEW] 카테고리별 일반소비 요약 테이블 렌더링
function renderGeneralCategorySummaryTable(categories, totalSpent, generalTotal, transactions) {
  const tbody = document.getElementById('general-category-summary-body');
  const resetBtn = document.getElementById('reset-general-category-filter-btn');
  if (!tbody) return;

  tbody.innerHTML = '';

  const filtered = categories.filter(c => c.total > 0);

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty-message">카테고리별 요약 데이터가 없습니다.</td></tr>';
    if (resetBtn) resetBtn.style.display = 'none';
    return;
  }

  // 필터 초기화 버튼 보이기 제어 및 이벤트 바인딩
  if (resetBtn) {
    resetBtn.style.display = 'inline';
    // 기존에 바인딩되었을 수 있는 리스너 오염을 막기 위해 버튼을 복제 후 치환
    const newResetBtn = resetBtn.cloneNode(true);
    resetBtn.parentNode.replaceChild(newResetBtn, resetBtn);
    newResetBtn.addEventListener('click', () => {
      if (selectedGeneralCategory !== null) {
        selectedGeneralCategory = null;
        document.querySelectorAll('.general-summary-row-clickable').forEach(r => r.classList.remove('active'));
        renderGeneralTransactionTable(transactions);
        if (window.lucide) lucide.createIcons();
      }
    });
  }

  filtered.forEach(c => {
    const tr = document.createElement('tr');
    tr.className = 'summary-row-clickable general-summary-row-clickable';
    if (selectedGeneralCategory === c.category) {
      tr.classList.add('active');
    }

    const catStyle = state.categoryMap[c.category] || { color: '#868e96', icon: 'help-circle' };
    const ratioToTotal = totalSpent > 0 ? ((c.total / totalSpent) * 100).toFixed(1) : '0.0';
    const ratioToGeneral = generalTotal > 0 ? ((c.total / generalTotal) * 100).toFixed(1) : '0.0';

    tr.innerHTML = `
      <td data-label="카테고리">
        <span class="category-badge" style="background-color: ${catStyle.color}15; color: ${catStyle.color}; border: 1px solid ${catStyle.color}30;">
          <i data-lucide="${catStyle.icon}"></i>
          ${c.category}
        </span>
      </td>
      <td data-label="소비액" class="text-right text-bold font-mono text-expense">${formatCurrency(c.total)}</td>
      <td data-label="전체 지출 대비 비율" class="text-right font-mono text-secondary">${ratioToTotal}%</td>
      <td data-label="일반소비 대비 비율" class="text-right font-mono text-primary text-bold">${ratioToGeneral}%</td>
    `;

    tr.addEventListener('click', () => {
      // 이미 선택된 카테고리를 다시 누르면 필터 해제
      if (selectedGeneralCategory === c.category) {
        selectedGeneralCategory = null;
        tr.classList.remove('active');
        renderGeneralTransactionTable(transactions);
      } else {
        selectedGeneralCategory = c.category;
        document.querySelectorAll('.general-summary-row-clickable').forEach(r => r.classList.remove('active'));
        tr.classList.add('active');
        const filteredTx = transactions.filter(t => t.category === c.category);
        renderGeneralTransactionTable(filteredTx);
      }
      if (window.lucide) {
        lucide.createIcons();
      }
    });

    tbody.appendChild(tr);
  });
}

// 6개월 일반지출 추이 바 차트
function renderGeneralMonthlyTrendChart(trendData) {
  const ctx = document.getElementById('generalMonthlyTrendChart').getContext('2d');
  if (generalMonthlyTrendChartInstance) {
    generalMonthlyTrendChartInstance.destroy();
  }

  const labels = trendData.map(d => {
    const [y, m] = d.month.split('-');
    return `${y.slice(2)}/${m}`;
  });
  const data = trendData.map(d => d.total || 0);

  generalMonthlyTrendChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: '일반지출 합계',
        data,
        backgroundColor: '#10b981',
        borderRadius: 4,
        maxBarThickness: 25
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { grid: { display: false }, ticks: { color: '#94a3b8' } },
        y: {
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: {
            color: '#94a3b8',
            precision: 0,
            callback: function(value) {
              if (Math.floor(value) !== value) return null;
              if (value >= 10000) {
                return (value / 10000).toFixed(0) + '만';
              }
              return value;
            }
          }
        }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: function(context) {
              return ` 일반지출: ${formatCurrency(context.raw)}`;
            }
          }
        }
      }
    }
  });
}

// 일반지출 카테고리별 비중 도넛 차트
function renderGeneralCategoryChart(categories) {
  const ctx = document.getElementById('generalCategoryChart').getContext('2d');
  if (generalCategoryChartInstance) {
    generalCategoryChartInstance.destroy();
  }

  const filtered = categories.filter(c => c.total > 0);
  const labels = filtered.map(c => c.category);
  const data = filtered.map(c => c.total);
  const colors = filtered.map(c => {
    const style = state.categoryMap[c.category];
    return style ? style.color : '#868e96';
  });

  if (filtered.length === 0) {
    ctx.clearRect(0, 0, 300, 300);
    generalCategoryChartInstance = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['데이터 없음'],
        datasets: [{ data: [1], backgroundColor: ['rgba(255,255,255,0.05)'], borderWidth: 0 }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
    });
    return;
  }

  generalCategoryChartInstance = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: colors,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.1)',
        hoverOffset: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '60%',
      plugins: {
        legend: {
          position: 'right',
          labels: {
            color: '#f8fafc',
            font: { size: 10 },
            boxWidth: 10,
            padding: 6
          }
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              const val = context.raw;
              const total = context.dataset.data.reduce((a, b) => a + b, 0);
              const percentage = Math.round((val / total) * 100);
              return ` ${context.label}: ${formatCurrency(val)} (${percentage}%)`;
            }
          }
        }
      }
    }
  });
}

// 일반지출 거래 내역 테이블 렌더링
function renderGeneralTransactionTable(transactions) {
  const tbody = document.getElementById('general-transaction-table-body');
  const footer = document.getElementById('general-transaction-table-footer');
  if (!tbody) return;

  tbody.innerHTML = '';

  if (transactions.length === 0) {
    if (footer) footer.style.display = 'block';
    return;
  }

  if (footer) footer.style.display = 'none';

  transactions.forEach(t => {
    const tr = document.createElement('tr');
    const catStyle = state.categoryMap[t.category] || { color: '#868e96', icon: 'help-circle' };

    tr.innerHTML = `
      <td data-label="날짜/시간" class="font-mono text-sm">${formatShortDate(t.datetime)}</td>
      <td data-label="사용처" class="text-bold">${t.merchant}</td>
      <td data-label="카테고리">
        <span class="category-badge" style="background-color: ${catStyle.color}15; color: ${catStyle.color}; border: 1px solid ${catStyle.color}30;">
          <i data-lucide="${catStyle.icon}"></i>
          ${t.category}
        </span>
      </td>
      <td data-label="결제수단" class="text-secondary text-sm">${t.pay_method || '-'}</td>
      <td data-label="금액" class="text-right text-bold font-mono text-expense">${formatCurrency(t.amount)}</td>
      <td data-label="메모" class="text-secondary text-sm">${t.memo || '-'}</td>
    `;
    tbody.appendChild(tr);
  });
}
