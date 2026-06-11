// ==========================================
// 6-D. 소득 분석 (Income Analytics) 로직
// ==========================================

let selectedIncomeCategory = null;

// 소득 데이터 로드 및 렌더링 총괄 함수
async function loadIncomeAnalytics(year, month) {
  const yearSelect = document.getElementById('income-year-select');
  const monthSelect = document.getElementById('income-month-select');

  // 연도 선택 목록 초기화 (현재 연도 기준 최근 3개년)
  if (yearSelect && yearSelect.options.length === 0) {
    const currentYear = new Date().getFullYear();
    for (let y = currentYear; y >= currentYear - 2; y--) {
      const opt = document.createElement('option');
      opt.value = String(y);
      opt.textContent = `${y}년`;
      yearSelect.appendChild(opt);
    }
    yearSelect.value = String(currentYear);
  }

  const targetYear = year || (yearSelect ? yearSelect.value : new Date().getFullYear());
  const targetMonth = month || (monthSelect ? monthSelect.value : 'all');

  try {
    const res = await fetch(`api/analytics/income?year=${targetYear}&month=${targetMonth}`).then(r => r.json());
    
    const isYearly = (targetMonth === 'all');
    const periodLabel = isYearly ? '올해' : '이번 달';
    const periodDetailLabel = isYearly ? `${targetYear}년 전체` : `${parseInt(targetMonth, 10)}월`;

    // 다이나믹 라벨 및 타이틀 세팅
    const totalLabelEl = document.getElementById('income-total-label');
    if (totalLabelEl) totalLabelEl.textContent = `${periodLabel} 총 수입`;

    const subviewTitleEl = document.getElementById('income-subview-title');
    if (subviewTitleEl) subviewTitleEl.textContent = `${periodDetailLabel} 수입 거래 내역`;
    const emptyMsgEl = document.getElementById('income-transaction-table-empty-msg');
    if (emptyMsgEl) emptyMsgEl.textContent = `${periodDetailLabel} 수입 거래 내역이 없습니다.`;

    const trendTitleEl = document.getElementById('income-trend-title');
    if (trendTitleEl) {
      trendTitleEl.textContent = isYearly ? `수입 월별 추이 (${year}년)` : '수입 월별 추이 (최근 6개월)';
    }

    // 1. 상단 요약 카드 데이터 반영
    const incomeTotal = res.incomeTotal || 0;
    const totalSpent = res.totalSpent || 0;
    
    const savingsAmount = Math.max(0, incomeTotal - totalSpent);
    const savingsRatio = incomeTotal > 0 ? Math.round((savingsAmount / incomeTotal) * 100) : 0;

    let averageIncome = 0;
    if (res.trend && res.trend.length > 0) {
      const sum = res.trend.reduce((acc, cur) => acc + (cur.total || 0), 0);
      averageIncome = Math.round(sum / (isYearly ? 12 : res.trend.length));
    }

    document.getElementById('income-total-value').textContent = formatCurrency(incomeTotal);
    document.getElementById('income-savings-ratio-value').textContent = `${savingsRatio}%`;
    document.getElementById('income-average-value').textContent = formatCurrency(averageIncome);

    // 필터 상태 초기화
    selectedIncomeCategory = null;

    // 2. 월별 수입 추이 차트 렌더링
    renderIncomeMonthlyTrendChart(res.trend);

    // 3. 수입 카테고리별 비중 차트 렌더링
    renderIncomeCategoryChart(res.categories);

    // 4. 카테고리별 수입 요약 테이블 렌더링
    renderIncomeCategorySummaryTable(res.categories, incomeTotal, res.transactions);

    // 5. 수입 상세 거래 내역 테이블 렌더링
    renderIncomeTransactionTable(res.transactions);

    // 아이콘 새로 렌더링
    if (window.lucide) {
      lucide.createIcons();
    }
  } catch (err) {
    console.error('소득 분석 데이터 로드 실패:', err);
  }
}

// 6개월 수입 추이 바 차트
function renderIncomeMonthlyTrendChart(trendData) {
  const ctx = document.getElementById('incomeMonthlyTrendChart').getContext('2d');
  if (incomeMonthlyTrendChartInstance) {
    incomeMonthlyTrendChartInstance.destroy();
  }

  const labels = trendData.map(d => {
    const [y, m] = d.month.split('-');
    return `${y.slice(2)}/${m}`;
  });
  const data = trendData.map(d => d.total || 0);

  incomeMonthlyTrendChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: '수입 합계',
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
              return ` 수입: ${formatCurrency(context.raw)}`;
            }
          }
        }
      }
    }
  });
}

// 수입 카테고리별 비중 도넛 차트
function renderIncomeCategoryChart(categories) {
  const ctx = document.getElementById('incomeCategoryChart').getContext('2d');
  if (incomeCategoryChartInstance) {
    incomeCategoryChartInstance.destroy();
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
    incomeCategoryChartInstance = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['데이터 없음'],
        datasets: [{ data: [1], backgroundColor: ['rgba(255,255,255,0.05)'], borderWidth: 0 }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
    });
    return;
  }

  incomeCategoryChartInstance = new Chart(ctx, {
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

// 카테고리별 수입 요약 테이블 렌더링
function renderIncomeCategorySummaryTable(categories, incomeTotal, transactions) {
  const tbody = document.getElementById('income-category-summary-body');
  const resetBtn = document.getElementById('reset-income-category-filter-btn');
  if (!tbody) return;

  tbody.innerHTML = '';

  const filtered = categories.filter(c => c.total > 0);

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" class="empty-message">카테고리별 요약 데이터가 없습니다.</td></tr>';
    if (resetBtn) resetBtn.style.display = 'none';
    return;
  }

  if (resetBtn) {
    resetBtn.style.display = 'inline';
    const newResetBtn = resetBtn.cloneNode(true);
    resetBtn.parentNode.replaceChild(newResetBtn, resetBtn);
    newResetBtn.addEventListener('click', () => {
      if (selectedIncomeCategory !== null) {
        selectedIncomeCategory = null;
        document.querySelectorAll('.income-summary-row-clickable').forEach(r => r.classList.remove('active'));
        renderIncomeTransactionTable(transactions);
        if (window.lucide) lucide.createIcons();
      }
    });
  }

  filtered.forEach(c => {
    const tr = document.createElement('tr');
    tr.className = 'summary-row-clickable income-summary-row-clickable';
    if (selectedIncomeCategory === c.category) {
      tr.classList.add('active');
    }

    const catStyle = state.categoryMap[c.category] || { color: '#868e96', icon: 'help-circle' };
    const ratioToIncome = incomeTotal > 0 ? ((c.total / incomeTotal) * 100).toFixed(1) : '0.0';

    tr.innerHTML = `
      <td data-label="카테고리">
        <span class="category-badge" style="background-color: ${catStyle.color}15; color: ${catStyle.color}; border: 1px solid ${catStyle.color}30;">
          <i data-lucide="${catStyle.icon}"></i>
          ${c.category}
        </span>
      </td>
      <td data-label="수입액" class="text-right text-bold font-mono text-income">${formatCurrency(c.total)}</td>
      <td data-label="전체 수입 대비 비율" class="text-right font-mono text-primary text-bold">${ratioToIncome}%</td>
    `;

    tr.addEventListener('click', () => {
      if (selectedIncomeCategory === c.category) {
        selectedIncomeCategory = null;
        tr.classList.remove('active');
        renderIncomeTransactionTable(transactions);
      } else {
        selectedIncomeCategory = c.category;
        document.querySelectorAll('.income-summary-row-clickable').forEach(r => r.classList.remove('active'));
        tr.classList.add('active');
        const filteredTx = transactions.filter(t => t.category === c.category);
        renderIncomeTransactionTable(filteredTx);
      }
      if (window.lucide) {
        lucide.createIcons();
      }
    });

    tbody.appendChild(tr);
  });
}

// 수입 거래 내역 테이블 렌더링
function renderIncomeTransactionTable(transactions) {
  const tbody = document.getElementById('income-transaction-table-body');
  const footer = document.getElementById('income-transaction-table-footer');
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
      <td data-label="금액" class="text-right text-bold font-mono text-income">${formatCurrency(t.amount)}</td>
      <td data-label="메모" class="text-secondary text-sm">${t.memo || '-'}</td>
    `;
    tbody.appendChild(tr);
  });
}
