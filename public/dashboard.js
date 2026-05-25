// ==========================================
// 1. 대시보드 탭 로직
// ==========================================

async function loadDashboardData() {
  try {
    const stats = await fetch(`api/stats?month=${state.currentMonth}`).then(r => r.json());
    const recent = await fetch(`api/transactions?month=${state.currentMonth}`).then(r => r.json());

    // 상단 카드 세팅 (수입, 지출, 예산, 저축액)
    document.getElementById('dashboard-total-income').textContent = formatCurrency(stats.totalIncome || 0);
    document.getElementById('dashboard-total-spent').textContent = formatCurrency(stats.totalExpense);
    document.getElementById('dashboard-budget-total').textContent = formatCurrency(stats.budget);

    // 평균 대비 지출 등락률 계산
    const comparisonEl = document.getElementById('dashboard-spent-comparison');
    if (comparisonEl) {
      const priorMonths = (stats.trend || []).filter(t => t.month < state.currentMonth && t.expense > 0);
      if (priorMonths.length > 0) {
        const sumPriorExpense = priorMonths.reduce((sum, t) => sum + t.expense, 0);
        const avgPriorExpense = sumPriorExpense / priorMonths.length;
        const currentExpense = stats.totalExpense || 0;
        const diff = currentExpense - avgPriorExpense;
        
        let displayHtml = '';
        if (diff > 0) {
          const rate = (diff / avgPriorExpense) * 100;
          displayHtml = `평균 월 지출(${formatCurrency(Math.round(avgPriorExpense))}) 대비 <span style="color:var(--danger-color); font-weight:bold;">▲${rate.toFixed(1)}%</span>`;
        } else if (diff < 0) {
          const rate = (Math.abs(diff) / avgPriorExpense) * 100;
          displayHtml = `평균 월 지출(${formatCurrency(Math.round(avgPriorExpense))}) 대비 <span style="color:var(--success-color); font-weight:bold;">▼${rate.toFixed(1)}%</span>`;
        } else {
          displayHtml = `평균 월 지출(${formatCurrency(Math.round(avgPriorExpense))})과 동일`;
        }
        comparisonEl.innerHTML = displayHtml;
        comparisonEl.style.display = 'block';
      } else {
        comparisonEl.style.display = 'none';
      }
    }
    
    const budgetLeft = stats.budget - stats.totalExpense;
    const budgetLeftEl = document.getElementById('dashboard-budget-left');
    budgetLeftEl.textContent = formatCurrency(budgetLeft);
    if (budgetLeft < 0) {
      budgetLeftEl.className = 'stat-value text-primary';
      budgetLeftEl.style.color = 'var(--danger-color)';
    } else {
      budgetLeftEl.className = 'stat-value';
      budgetLeftEl.style.color = '';
    }

    const initialBalance = parseInt(state.settings.initial_balance || 0, 10);
    const netSavings = initialBalance + (stats.totalIncome || 0) - stats.totalExpense;
    const savingsEl = document.getElementById('dashboard-net-savings');
    savingsEl.textContent = formatCurrency(netSavings);
    if (netSavings < 0) {
      savingsEl.style.color = 'var(--danger-color)';
    } else {
      savingsEl.style.color = 'var(--success-color)';
    }

    const [year, month] = state.currentMonth.split('-');

    // 차트 렌더링
    renderCategoryChart(stats.categories);
    renderTrendChart(stats.daily, year, month);

    // 최근 내역 5개 렌더링 (지출/수입 맞춤 스타일)
    const recentContainer = document.getElementById('dashboard-recent-list');
    if (recentContainer) {
      recentContainer.innerHTML = '';
      
      const top5 = recent.slice(0, 5);
      if (top5.length === 0) {
        recentContainer.innerHTML = '<p class="empty-message">이번 달 내역이 없습니다.</p>';
        return;
      }

      top5.forEach(tx => {
        const catStyle = state.categoryMap[tx.category] || { color: '#868e96', icon: 'tag' };
        const isIncome = tx.type === 'INCOME';
        const amtPrefix = isIncome ? '+' : '';
        const amtClass = isIncome ? 'text-income' : 'text-expense';

        const item = document.createElement('div');
        item.className = 'tx-compact-item';
        item.innerHTML = `
          <div class="tx-compact-left">
            <span class="category-badge" style="background-color: ${catStyle.color}15; color: ${catStyle.color}">
              ${tx.category}
            </span>
            <div class="tx-details">
              <span class="tx-merchant">${tx.merchant}</span>
              <span class="tx-time">${formatShortDate(tx.datetime)}</span>
            </div>
          </div>
          <div class="tx-compact-right">
            <span class="tx-pay-method">${tx.pay_method}</span>
            <span class="tx-amount ${amtClass}">${amtPrefix}${formatCurrency(tx.amount)}</span>
          </div>
        `;
        recentContainer.appendChild(item);
      });
    }

    // 결제 수단별(자산/카드) 현황 렌더링
    renderAssetGrid(stats.assets || []);

  } catch (err) {
    console.error('대시보드 데이터 로드 오류:', err);
  }
}

// 결제 수단별 월간 현황(자산 & 카드) 렌더링
function renderAssetGrid(assets) {
  const container = document.getElementById('dashboard-asset-grid');
  if (!container) return;

  container.innerHTML = '';

  // 유의미한 내역(초기 자산이 있거나, 이번 달 수입/지출 내역이 존재하는 결제수단만 필터링)
  const activeAssets = assets.filter(a => a.initialBalance !== 0 || a.monthIncome !== 0 || a.monthExpense !== 0);

  if (activeAssets.length === 0) {
    container.innerHTML = '<p class="empty-message" style="grid-column: 1 / -1; text-align: center; padding: 2rem; color: var(--text-secondary);">이번 달 입출금 내역 또는 설정된 자산 초기 잔액이 없습니다. [설정] 탭에서 결제 수단별 초기 잔액을 등록해 보세요.</p>';
    return;
  }

  activeAssets.forEach(asset => {
    const card = document.createElement('div');
    card.className = `asset-card-item glass ${asset.isCard ? 'card-type' : 'bank-type'}`;
    card.style.padding = '1.25rem';
    card.style.borderRadius = '12px';
    card.style.border = '1px solid rgba(255, 255, 255, 0.08)';
    
    if (asset.isCard) {
      // 의존성: index.js의 /api/stats 응답 구조에서 제공하는 initialPoint 및 remainingPoint와 연동됩니다.
      const hasPoint = asset.initialPoint && asset.initialPoint > 0;
      let pointHtml = '';
      if (hasPoint) {
        pointHtml = `
          <div class="asset-card-detail-rows" style="border-top: 1px solid rgba(255,255,255,0.04); padding-top: 0.5rem; display: flex; flex-direction: column; gap: 0.35rem; margin-top: 0.5rem;">
            <div class="asset-card-detail-row" style="display: flex; justify-content: space-between; font-size: 0.75rem;">
              <span style="color: var(--text-secondary);">지원금/포인트 한도</span>
              <span style="color: var(--text-color); font-weight: 500;">${formatCurrency(asset.initialPoint)}</span>
            </div>
            <div class="asset-card-detail-row" style="display: flex; justify-content: space-between; font-size: 0.75rem;">
              <span style="color: var(--text-secondary);">남은 지원금 잔액</span>
              <span style="color: #38bdf8; font-weight: 600;">${formatCurrency(asset.remainingPoint)}</span>
            </div>
          </div>
        `;
      }
      card.innerHTML = `
        <div class="asset-card-item-header" style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 1rem;">
          <div class="asset-card-icon card-icon" style="background: rgba(99, 102, 241, 0.15); color: #6366f1; width: 36px; height: 36px; border-radius: 8px; display: flex; align-items: center; justify-content: center;">
            <i data-lucide="credit-card" style="width: 18px; height: 18px;"></i>
          </div>
          <div class="asset-card-title-info" style="display: flex; flex-direction: column;">
            <span class="asset-card-name" style="font-weight: 600; font-size: 0.9rem; color: var(--text-color);">${asset.name}</span>
            <span class="asset-card-badge badge-card" style="font-size: 0.7rem; color: #6366f1; font-weight: 500; margin-top: 2px;">카드</span>
          </div>
        </div>
        <div class="asset-card-item-body">
          <div class="asset-card-value-row" style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 0.75rem;">
            <span class="asset-card-label" style="font-size: 0.8rem; color: var(--text-secondary);">이번 달 결제금액</span>
            <span class="asset-card-value card-color" style="font-weight: 700; font-size: 1.1rem; color: #f43f5e;">${formatCurrency(asset.monthExpense)}</span>
          </div>
          ${pointHtml}
          <div class="asset-card-footer-row" style="border-top: 1px solid rgba(255,255,255,0.04); padding-top: 0.5rem; margin-top: ${hasPoint ? '0.5rem' : '0px'}">
            <span class="asset-card-subtext" style="font-size: 0.75rem; color: var(--text-secondary);">이번 달 신용/체크 누적 사용 금액</span>
          </div>
        </div>
      `;
    } else {
      const balanceColor = asset.currentBalance < 0 ? '#ef4444' : '#10b981';
      card.innerHTML = `
        <div class="asset-card-item-header" style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 1rem;">
          <div class="asset-card-icon bank-icon" style="background: rgba(16, 185, 129, 0.15); color: #10b981; width: 36px; height: 36px; border-radius: 8px; display: flex; align-items: center; justify-content: center;">
            <i data-lucide="landmark" style="width: 18px; height: 18px;"></i>
          </div>
          <div class="asset-card-title-info" style="display: flex; flex-direction: column;">
            <span class="asset-card-name" style="font-weight: 600; font-size: 0.9rem; color: var(--text-color);">${asset.name}</span>
            <span class="asset-card-badge badge-bank" style="font-size: 0.7rem; color: #10b981; font-weight: 500; margin-top: 2px;">자산/은행</span>
          </div>
        </div>
        <div class="asset-card-item-body">
          <div class="asset-card-value-row" style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 0.75rem;">
            <span class="asset-card-label" style="font-size: 0.8rem; color: var(--text-secondary);">현재 잔액</span>
            <span class="asset-card-value" style="font-weight: 700; font-size: 1.1rem; color: ${balanceColor};">${formatCurrency(asset.currentBalance)}</span>
          </div>
          <div class="asset-card-detail-rows" style="border-top: 1px solid rgba(255,255,255,0.04); padding-top: 0.5rem; display: flex; flex-direction: column; gap: 0.35rem;">
            <div class="asset-card-detail-row" style="display: flex; justify-content: space-between; font-size: 0.75rem;">
              <span style="color: var(--text-secondary);">이번 달 입금 (수입)</span>
              <span class="text-income" style="color: #10b981; font-weight: 500;">+${formatCurrency(asset.monthIncome)}</span>
            </div>
            <div class="asset-card-detail-row" style="display: flex; justify-content: space-between; font-size: 0.75rem;">
              <span style="color: var(--text-secondary);">이번 달 출금 (지출)</span>
              <span class="text-expense" style="color: #6366f1; font-weight: 500;">-${formatCurrency(asset.monthExpense)}</span>
            </div>
          </div>
        </div>
      `;
    }
    container.appendChild(card);
  });

  if (window.lucide) {
    window.lucide.createIcons();
  }
}

// 1-A. 카테고리 파이 차트
function renderCategoryChart(categories) {
  const ctx = document.getElementById('categoryChart').getContext('2d');
  
  if (categoryChartInstance) {
    categoryChartInstance.destroy();
  }

  if (categories.length === 0) {
    ctx.clearRect(0, 0, 300, 300);
    categoryChartInstance = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['내역 없음'],
        datasets: [{
          data: [1],
          backgroundColor: ['rgba(255,255,255,0.05)'],
          borderWidth: 0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } }
      }
    });
    return;
  }

  const labels = categories.map(c => c.category);
  const data = categories.map(c => c.total);
  const colors = categories.map(c => {
    const style = state.categoryMap[c.category];
    return style ? style.color : '#868e96';
  });

  categoryChartInstance = new Chart(ctx, {
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
      cutout: '70%',
      plugins: {
        legend: {
          position: 'right',
          labels: {
            color: '#f8fafc',
            font: { family: 'Outfit, Noto Sans KR', size: 11 },
            boxWidth: 12,
            padding: 8
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

// 1-B. 일별 추이 라인 차트
function renderTrendChart(dailyData, year, month) {
  const ctx = document.getElementById('trendChart').getContext('2d');
  
  if (trendChartInstance) {
    trendChartInstance.destroy();
  }

  const daysInMonth = new Date(parseInt(year, 10), parseInt(month, 10), 0).getDate();
  const labels = Array.from({ length: daysInMonth }, (_, i) => String(i + 1).padStart(2, '0'));
  
  const expenseMap = {};
  dailyData.forEach(d => {
    const day = d.date.split('-')[2];
    expenseMap[day] = d.expense || 0;
  });

  const expenseData = labels.map(day => expenseMap[day] || 0);

  const expGradient = ctx.createLinearGradient(0, 0, 0, 250);
  expGradient.addColorStop(0, 'rgba(99, 102, 241, 0.25)');
  expGradient.addColorStop(1, 'rgba(99, 102, 241, 0.0)');

  trendChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels.map(l => `${parseInt(l, 10)}일`),
      datasets: [
        {
          label: '지출',
          data: expenseData,
          borderColor: '#6366f1',
          borderWidth: 2,
          backgroundColor: expGradient,
          fill: true,
          tension: 0.3,
          pointBackgroundColor: '#6366f1',
          pointRadius: 2,
          pointHoverRadius: 5
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: '#94a3b8', font: { size: 10 } }
        },
        y: {
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: { 
            color: '#94a3b8', 
            font: { size: 10 },
            precision: 0,
            callback: function(value) {
              if (Math.floor(value) !== value) {
                return null;
              }
              if (value >= 10000) {
                const manValue = value / 10000;
                return parseFloat(manValue.toFixed(4)) + '만';
              }
              return value;
            }
          }
        }
      },
      plugins: {
        legend: {
          display: true,
          labels: { color: '#94a3b8', font: { size: 10 } }
        },
        tooltip: {
          mode: 'index',
          intersect: false,
          callbacks: {
            label: function(context) {
              return ` ${context.dataset.label}: ${formatCurrency(context.raw)}`;
            }
          }
        }
      }
    }
  });
}
