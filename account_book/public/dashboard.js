// ==========================================
// 1. 대시보드 탭 로직
// ==========================================

async function loadDashboardData() {
  try {
    const stats = await fetch(`api/stats?month=${state.currentMonth}`).then(r => r.json());
    const recent = await fetch(`api/transactions?month=${state.currentMonth}`).then(r => r.json());

    // 상단 카드 세팅 (소득, 소비, 예산, 저축액)
    // 의존성: public/index.html의 #dashboard-total-income, #dashboard-income-footer 요소와 연동됩니다.
    const totalIncome = stats.totalIncome || 0;
    const incomeEl = document.getElementById('dashboard-total-income');
    const incomeFooterEl = document.getElementById('dashboard-income-footer');

    // 주 소득 방식에 맞춘 평균 소득 계산
    const primaryIncomeType = (state.settings && state.settings.primary_income_type) || 'regular';
    const limitMonths = primaryIncomeType === 'regular' ? 3 : 6;
    const sortedPriorMonths = (stats.trend || [])
      .filter(t => t.month < state.currentMonth)
      .sort((a, b) => b.month.localeCompare(a.month));
    const targetPriorMonths = sortedPriorMonths.slice(0, limitMonths);
    const priorIncomeMonths = targetPriorMonths.filter(t => t.income > 0);

    let avgPriorIncome = 0;
    if (priorIncomeMonths.length > 0) {
      const sumPriorIncome = priorIncomeMonths.reduce((sum, t) => sum + t.income, 0);
      avgPriorIncome = Math.round(sumPriorIncome / priorIncomeMonths.length);
    }

    if (totalIncome >= 1000000) {
      // 100만원 이상 소득 유입 시 실제 소득 표시
      incomeEl.textContent = formatCurrency(totalIncome);
      if (incomeFooterEl) {
        incomeFooterEl.textContent = '이번 달 소득 금액 합계';
      }
    } else if (totalIncome > 0) {
      // 100만원 미만 소득 유입 시 평균 소득을 표시하고, 푸터에 실제 소득 표기
      incomeEl.textContent = avgPriorIncome > 0 ? `(평균) ${formatCurrency(avgPriorIncome)}` : formatCurrency(totalIncome);
      if (incomeFooterEl) {
        incomeFooterEl.textContent = `실제 소득: ${formatCurrency(totalIncome)}`;
      }
    } else {
      // 소득이 없을 시 평균 소득 대체 표기
      if (avgPriorIncome > 0) {
        incomeEl.textContent = `(평균) ${formatCurrency(avgPriorIncome)}`;
        if (incomeFooterEl) {
          incomeFooterEl.textContent = '이번 달 소득이 없어 월 평균 소득 표시';
        }
      } else {
        incomeEl.textContent = formatCurrency(0);
        if (incomeFooterEl) {
          incomeFooterEl.textContent = '이번 달 소득 금액 합계';
        }
      }
    }

    document.getElementById('dashboard-total-spent').textContent = formatCurrency(stats.totalExpense);
    document.getElementById('dashboard-budget-total').textContent = formatCurrency(stats.budget);

    // 평균 대비 소비 등락률 계산 (최근 6개월 소비 평균 비교로 유지)
    const comparisonEl = document.getElementById('dashboard-spent-comparison');
    if (comparisonEl) {
      const priorMonths = (stats.trend || []).slice(-6).filter(t => t.month < state.currentMonth && t.expense > 0);
      if (priorMonths.length > 0) {
        const sumPriorExpense = priorMonths.reduce((sum, t) => sum + t.expense, 0);
        const avgPriorExpense = sumPriorExpense / priorMonths.length;
        const currentExpense = stats.totalExpense || 0;
        const diff = currentExpense - avgPriorExpense;
        
        let displayHtml = '';
        if (diff > 0) {
          const rate = (diff / avgPriorExpense) * 100;
          displayHtml = `평균 월 소비(${formatCurrency(Math.round(avgPriorExpense))}) 대비 <span style="color:var(--danger-color); font-weight:bold;">▲${rate.toFixed(1)}%</span>`;
        } else if (diff < 0) {
          const rate = (Math.abs(diff) / avgPriorExpense) * 100;
          displayHtml = `평균 월 소비(${formatCurrency(Math.round(avgPriorExpense))}) 대비 <span style="color:var(--success-color); font-weight:bold;">▼${rate.toFixed(1)}%</span>`;
        } else {
          displayHtml = `평균 월 소비(${formatCurrency(Math.round(avgPriorExpense))})와 동일`;
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

    // 개별 결제 수단별 초기 잔액의 합계 계산
    let initialBalancesSum = 0;
    if (state.settings.initial_balances) {
      try {
        const parsed = typeof state.settings.initial_balances === 'string' ? JSON.parse(state.settings.initial_balances) : state.settings.initial_balances;
        if (parsed) {
          Object.values(parsed).forEach(v => {
            initialBalancesSum += parseInt(v, 10) || 0;
          });
        }
      } catch (e) {}
    }

    // 요약: 이번 달 소득이 100만원 미만일 때, 월 평균 소득을 적용하여 예상 순수이익으로 대체 표시합니다.
    // 의존성: public/index.html의 #dashboard-net-savings, #dashboard-net-savings-label, #dashboard-net-savings-footer 요소와 연동됩니다.
    
    // 100만원 미만 시 평균 소득 기준 예상 순수이익 활용
    let isUsingAverageIncome = false;
    if (totalIncome < 1000000 && avgPriorIncome > 0) {
      isUsingAverageIncome = true;
    }

    let monthlyNet = (stats.totalIncome || 0) - stats.totalExpense;
    let netSavings = initialBalancesSum + (stats.totalIncome || 0) - stats.totalExpense;

    if (isUsingAverageIncome) {
      monthlyNet = avgPriorIncome - stats.totalExpense;
      netSavings = initialBalancesSum + avgPriorIncome - stats.totalExpense;
      if (savingsLabelEl) {
        savingsLabelEl.textContent = '예상 순수이익';
      }
    } else {
      if (savingsLabelEl) {
        savingsLabelEl.textContent = '이번 달 순수이익';
      }
    }

    savingsEl.textContent = (monthlyNet > 0 ? '+' : '') + formatCurrency(monthlyNet);
    if (monthlyNet < 0) {
      savingsEl.style.color = 'var(--danger-color)';
    } else {
      savingsEl.style.color = 'var(--success-color)';
    }

    if (savingsFooterEl) {
      if (isUsingAverageIncome) {
        savingsFooterEl.innerHTML = `<span class="text-secondary">누적 저축액: ${formatCurrency(netSavings)} (평균 소득 기준)</span>`;
      } else {
        savingsFooterEl.innerHTML = `<span class="text-secondary">누적 저축액: ${formatCurrency(netSavings)}</span>`;
      }
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
      } else {
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
    }

    // 결제 수단별(자산/카드) 현황 렌더링
    renderAssetGrid(stats.assets || []);

  } catch (err) {
    console.error('대시보드 데이터 로드 오류:', err);
  }
}

// Helper to determine closest card placement for grid drag and drop
function getDragPlacement(container, x, y) {
  const draggableElements = [...container.querySelectorAll('.asset-card-item:not(.total-type):not(.dragging)')];

  let closest = { distance: Number.POSITIVE_INFINITY, element: null, centerX: 0, centerY: 0 };

  draggableElements.forEach(child => {
    const box = child.getBoundingClientRect();
    const centerX = box.left + box.width / 2;
    const centerY = box.top + box.height / 2;
    const distance = Math.pow(x - centerX, 2) + Math.pow(y - centerY, 2);

    if (distance < closest.distance) {
      closest = { distance, element: child, centerX, centerY };
    }
  });

  return closest;
}

// Helper to save pay methods order to backend
async function saveCardOrder(container) {
  const cards = [...container.querySelectorAll('.asset-card-item:not(.total-type)')];
  const newOrder = cards.map(c => c.dataset.name);

  try {
    const response = await fetch('api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pay_methods_order: JSON.stringify(newOrder)
      })
    }).then(r => r.json());

    if (response.success) {
      console.log('결제수단 순서가 드래그로 저장되었습니다.');
      state.settings.pay_methods_order = JSON.stringify(newOrder);
    } else {
      console.error('순서 저장 실패:', response.error);
    }
  } catch (err) {
    console.error('순서 저장 중 오류:', err);
  }
}

// Helper to initialize drag-and-drop on asset cards (supports both mouse and touch)
function initDragAndDropForCard(card, container) {
  const handle = card.querySelector('.drag-handle');
  if (!handle) return;

  // Mouse drag-and-drop
  handle.addEventListener('mousedown', () => {
    card.setAttribute('draggable', 'true');
  });

  handle.addEventListener('mouseup', () => {
    card.setAttribute('draggable', 'false');
  });

  card.addEventListener('dragstart', (e) => {
    card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', card.dataset.name);
  });

  card.addEventListener('dragend', async () => {
    card.classList.remove('dragging');
    card.setAttribute('draggable', 'false');
    await saveCardOrder(container);
  });

  // Touch drag-and-drop for Mobile
  handle.addEventListener('touchstart', (e) => {
    card.classList.add('dragging');
  }, { passive: true });

  handle.addEventListener('touchmove', (e) => {
    const dragging = container.querySelector('.dragging');
    if (!dragging) return;

    const touch = e.touches[0];
    e.preventDefault(); // Prevent scrolling while dragging

    const closest = getDragPlacement(container, touch.clientX, touch.clientY);
    if (closest.element) {
      if (touch.clientX > closest.centerX) {
        container.insertBefore(dragging, closest.element.nextSibling);
      } else {
        container.insertBefore(dragging, closest.element);
      }
    } else {
      container.appendChild(dragging);
    }
  }, { passive: false });

  handle.addEventListener('touchend', async () => {
    const dragging = container.querySelector('.dragging');
    if (dragging) {
      card.classList.remove('dragging');
    }
    await saveCardOrder(container);
  });
}

// 결제 수단별 월간 현황(자산 & 카드) 렌더링
function renderAssetGrid(assets) {
  const container = document.getElementById('dashboard-asset-grid');
  if (!container) return;

  container.innerHTML = '';

  // Initialize dragover on container once
  if (!container.dataset.dragInitialized) {
    container.dataset.dragInitialized = 'true';
    
    container.addEventListener('dragover', (e) => {
      e.preventDefault();
      const dragging = container.querySelector('.dragging');
      if (!dragging) return;

      const closest = getDragPlacement(container, e.clientX, e.clientY);
      if (closest.element) {
        if (e.clientX > closest.centerX) {
          container.insertBefore(dragging, closest.element.nextSibling);
        } else {
          container.insertBefore(dragging, closest.element);
        }
      } else {
        container.appendChild(dragging);
      }
    });
  }

  // 유의미한 내역(초기 자산이 있거나, 이번 달 수입/지출 내역이 존재하는 결제수단만 필터링)
  const activeAssets = assets.filter(a => a.initialBalance !== 0 || a.monthIncome !== 0 || a.monthExpense !== 0);

  // 요약: 모든 은행/자산 계좌의 잔액을 합산하여 '모든 은행 합계 (총 잔액)' 카드를 생성
  // 의존성: routes/analytics.js의 /api/stats 응답 구조에서 제공하는 assets 배열과 연동됩니다.
  const bankAssets = assets.filter(a => !a.isCard);
  if (bankAssets.length > 0) {
    const totalBankBalance = bankAssets.reduce((sum, a) => sum + (a.currentBalance || 0), 0);
    const totalBankIncome = bankAssets.reduce((sum, a) => sum + (a.monthIncome || 0), 0);
    const totalBankExpense = bankAssets.reduce((sum, a) => sum + (a.monthExpense || 0), 0);

    const totalAsset = {
      name: "모든 은행 합계 (총 잔액)",
      isCard: false,
      isTotal: true,
      currentBalance: totalBankBalance,
      monthIncome: totalBankIncome,
      monthExpense: totalBankExpense
    };
    activeAssets.unshift(totalAsset);
  }

  if (activeAssets.length === 0) {
    container.innerHTML = '<p class="empty-message" style="grid-column: 1 / -1; text-align: center; padding: 2rem; color: var(--text-secondary);">이번 달 입출금 내역 또는 설정된 자산 초기 잔액이 없습니다. [설정] 탭에서 결제 수단별 초기 잔액을 등록해 보세요.</p>';
    return;
  }

  activeAssets.forEach(asset => {
    const card = document.createElement('div');
    card.className = `asset-card-item glass ${asset.isCard ? 'card-type' : 'bank-type'}`;
    card.style.padding = '1.25rem';
    card.style.borderRadius = '12px';
    card.style.border = '1px solid var(--glass-border)';

    if (!asset.isTotal) {
      card.dataset.name = asset.name;
    }

    // 결제 수단 클릭 시 거래 내역 탭의 해당 자산 뷰로 필터링 연동
    if (!asset.isTotal) {
      card.style.cursor = 'pointer';
      card.style.transition = 'transform 0.2s ease, box-shadow 0.2s ease';
      card.addEventListener('click', (e) => {
        // 드래그 핸들을 클릭한 경우에는 네비게이션을 동작시키지 않음
        if (e.target.closest('.drag-handle')) return;
        navigateToAsset(asset.name, asset.isCard);
      });

      // 마우스 호버 마이크로 애니메이션 효과
      card.addEventListener('mouseenter', () => {
        card.style.transform = 'translateY(-3px)';
        card.style.border = '1px solid var(--accent-color)';
      });
      card.addEventListener('mouseleave', () => {
        card.style.transform = 'translateY(0)';
        card.style.border = '1px solid var(--glass-border)';
      });
    }
    
    if (asset.isCard) {
      // 의존성: index.js의 /api/stats 응답 구조에서 제공하는 initialPoint 및 remainingPoint와 연동됩니다.
      const hasPoint = asset.initialPoint && asset.initialPoint > 0;
      let pointHtml = '';
      if (hasPoint) {
        pointHtml = `
          <div class="asset-card-detail-rows" style="border-top: 1px solid var(--glass-border); padding-top: 0.5rem; display: flex; flex-direction: column; gap: 0.35rem; margin-top: 0.5rem;">
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

      // 카드 실적 목표 정보
      let performanceGoalHtml = '';
      let cardGoals = {};
      if (state.settings.card_performance_goals) {
        try {
          cardGoals = typeof state.settings.card_performance_goals === 'string' 
            ? JSON.parse(state.settings.card_performance_goals) 
            : state.settings.card_performance_goals;
        } catch (e) {
          cardGoals = {};
        }
      }

      let cardPerformanceDays = {};
      if (state.settings.card_performance_days) {
        try {
          cardPerformanceDays = typeof state.settings.card_performance_days === 'string'
            ? JSON.parse(state.settings.card_performance_days)
            : state.settings.card_performance_days;
        } catch (e) {
          cardPerformanceDays = {};
        }
      }

      let cardPaymentDays = {};
      if (state.settings.card_payment_days) {
        try {
          cardPaymentDays = typeof state.settings.card_payment_days === 'string'
            ? JSON.parse(state.settings.card_payment_days)
            : state.settings.card_payment_days;
        } catch (e) {
          cardPaymentDays = {};
        }
      }

      const payDay = cardPaymentDays[asset.name] || 14;
      const startDay = parseInt(cardPerformanceDays[asset.name] || 1, 10);
      
      const goalAmount = cardGoals[asset.name] ? parseInt(cardGoals[asset.name], 10) || 0 : 0;
      const hasGoal = goalAmount > 0;
      if (hasGoal) {
        const spent = asset.monthExpense || 0;
        const percent = Math.min(100, Math.round((spent / goalAmount) * 100));
        const diffAmount = goalAmount - spent;
        
        let statusText = '';
        if (diffAmount > 0) {
          statusText = `실적 달성까지 <span style="font-weight: 600; color: #a5b4fc;">${formatCurrency(diffAmount)}</span> 남음`;
        } else {
          statusText = `<span style="font-weight: 600; color: #10b981;">실적 충족 완료! 🎉</span>`;
        }

        let periodText = '';
        if (startDay > 1) {
          const [yearStr, monthStr] = state.currentMonth.split('-');
          const yearVal = parseInt(yearStr, 10);
          const monthVal = parseInt(monthStr, 10);
          const startYear = monthVal === 1 ? yearVal - 1 : yearVal;
          const startMonth = monthVal === 1 ? 12 : monthVal - 1;
          
          const startMonthFormatted = String(startMonth).padStart(2, '0');
          const startDayFormatted = String(startDay).padStart(2, '0');
          const endMonthFormatted = String(monthVal).padStart(2, '0');
          const endDayFormatted = String(startDay - 1).padStart(2, '0');
          
          periodText = ` <span style="font-size: 0.7rem; color: var(--text-secondary); font-weight: normal;">(${startMonthFormatted}/${startDayFormatted}~${endMonthFormatted}/${endDayFormatted})</span>`;
        }
        
        performanceGoalHtml = `
          <div class="asset-card-detail-rows" style="border-top: 1px solid var(--glass-border); padding-top: 0.5rem; display: flex; flex-direction: column; gap: 0.35rem; margin-top: 0.5rem;">
            <div class="asset-card-detail-row" style="display: flex; justify-content: space-between; font-size: 0.75rem;">
              <span style="color: var(--text-secondary);">월 실적 달성률 (${percent}%)${periodText}</span>
              <span style="color: var(--text-color); font-weight: 500;">${formatCurrency(spent)} / ${formatCurrency(goalAmount)}</span>
            </div>
            <div style="width: 100%; height: 6px; background: var(--glass-border); border-radius: 3px; overflow: hidden; margin-top: 0.15rem;">
              <div style="width: ${percent}%; height: 100%; background: linear-gradient(90deg, #6366f1, #a855f7); border-radius: 3px; transition: width 0.3s ease;"></div>
            </div>
            <div class="asset-card-detail-row" style="display: flex; justify-content: space-between; font-size: 0.7rem; margin-top: 0.15rem;">
              <span style="color: var(--text-secondary); width: 100%; text-align: right;">${statusText}</span>
            </div>
          </div>
        `;
      }

      function localGetBillingCycleText(day) {
        day = parseInt(day, 10) || 1;
        if (day === 1) return '매달 1일~말일';
        return `전월 ${day}일~당월 ${day - 1}일`;
      }

      card.innerHTML = `
        <div class="asset-card-item-header" style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 1rem;">
          <div style="display: flex; align-items: center; gap: 0.75rem;">
            <div class="asset-card-icon card-icon" style="background: rgba(99, 102, 241, 0.15); color: #6366f1; width: 36px; height: 36px; border-radius: 8px; display: flex; align-items: center; justify-content: center;">
              <i data-lucide="credit-card" style="width: 18px; height: 18px;"></i>
            </div>
            <div class="asset-card-title-info" style="display: flex; flex-direction: column;">
              <span class="asset-card-name" style="font-weight: 600; font-size: 0.9rem; color: var(--text-color);">${asset.name}</span>
              <span class="asset-card-badge badge-card" style="font-size: 0.7rem; color: #6366f1; font-weight: 500; margin-top: 2px;">카드</span>
            </div>
          </div>
          <div class="drag-handle" style="cursor: grab; color: var(--text-secondary); padding: 4px; display: flex; align-items: center; opacity: 0.3; transition: opacity 0.2s;">
            <i data-lucide="grip-vertical" style="width: 16px; height: 16px;"></i>
          </div>
        </div>
        <div class="asset-card-item-body">
          <div class="asset-card-value-row" style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 0.75rem;">
            <span class="asset-card-label" style="font-size: 0.8rem; color: var(--text-secondary);">이번 달 결제금액</span>
            <span class="asset-card-value card-color" style="font-weight: 700; font-size: 1.1rem; color: #f43f5e;">${formatCurrency(asset.monthExpense)}</span>
          </div>
          ${pointHtml}
          ${performanceGoalHtml}
          
          <!-- 결제일 및 이용기간 정보 -->
          <div style="display: flex; justify-content: space-between; font-size: 0.7rem; color: var(--text-secondary); border-top: 1px solid var(--glass-border); padding-top: 0.5rem; margin-top: 0.5rem;">
            <span>결제일 / 이용기간</span>
            <span style="font-weight: 500; color: var(--text-color);">${payDay}일 / ${localGetBillingCycleText(startDay)}</span>
          </div>
          
          <div class="asset-card-footer-row" style="border-top: 1px solid var(--glass-border); padding-top: 0.5rem; margin-top: 0.5rem;">
            <span class="asset-card-subtext" style="font-size: 0.75rem; color: var(--text-secondary);">이번 달 신용/체크 누적 사용 금액</span>
          </div>
        </div>
      `;
    } else if (asset.isTotal) {
      const balanceColor = asset.currentBalance < 0 ? '#ef4444' : '#10b981';
      card.className = `asset-card-item glass total-type`;
      card.style.background = 'linear-gradient(135deg, rgba(16, 185, 129, 0.15) 0%, rgba(99, 102, 241, 0.08) 100%)';
      card.style.border = '1px solid rgba(16, 185, 129, 0.25)';
      
      card.innerHTML = `
        <div class="asset-card-item-header" style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 1rem;">
          <div class="asset-card-icon bank-icon" style="background: rgba(16, 185, 129, 0.25); color: #10b981; width: 36px; height: 36px; border-radius: 8px; display: flex; align-items: center; justify-content: center;">
            <i data-lucide="wallet" style="width: 18px; height: 18px;"></i>
          </div>
          <div class="asset-card-title-info" style="display: flex; flex-direction: column;">
            <span class="asset-card-name" style="font-weight: 700; font-size: 0.95rem; color: var(--text-color);">${asset.name}</span>
            <span class="asset-card-badge badge-bank" style="font-size: 0.7rem; color: #10b981; font-weight: 600; margin-top: 2px;">총 자산</span>
          </div>
        </div>
        <div class="asset-card-item-body">
          <div class="asset-card-value-row" style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 0.75rem;">
            <span class="asset-card-label" style="font-size: 0.8rem; color: var(--text-secondary); font-weight: 500;">현재 총 잔액</span>
            <span class="asset-card-value" style="font-weight: 800; font-size: 1.25rem; color: ${balanceColor};">${formatCurrency(asset.currentBalance)}</span>
          </div>
          <div class="asset-card-detail-rows" style="border-top: 1px solid var(--glass-border); padding-top: 0.5rem; display: flex; flex-direction: column; gap: 0.35rem;">
            <div class="asset-card-detail-row" style="display: flex; justify-content: space-between; font-size: 0.75rem;">
              <span style="color: var(--text-secondary);">총 입금 (수입)</span>
              <span class="text-income" style="color: #10b981; font-weight: 500;">+${formatCurrency(asset.monthIncome)}</span>
            </div>
            <div class="asset-card-detail-row" style="display: flex; justify-content: space-between; font-size: 0.75rem;">
              <span style="color: var(--text-secondary);">총 출금 (지출)</span>
              <span class="text-expense" style="color: #6366f1; font-weight: 500;">-${formatCurrency(asset.monthExpense)}</span>
            </div>
          </div>
        </div>
      `;
    } else {
      const balanceColor = asset.currentBalance < 0 ? '#ef4444' : '#10b981';
      card.innerHTML = `
        <div class="asset-card-item-header" style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 1rem;">
          <div style="display: flex; align-items: center; gap: 0.75rem;">
            <div class="asset-card-icon bank-icon" style="background: rgba(16, 185, 129, 0.15); color: #10b981; width: 36px; height: 36px; border-radius: 8px; display: flex; align-items: center; justify-content: center;">
              <i data-lucide="landmark" style="width: 18px; height: 18px;"></i>
            </div>
            <div class="asset-card-title-info" style="display: flex; flex-direction: column;">
              <span class="asset-card-name" style="font-weight: 600; font-size: 0.9rem; color: var(--text-color);">${asset.name}</span>
              <span class="asset-card-badge badge-bank" style="font-size: 0.7rem; color: #10b981; font-weight: 500; margin-top: 2px;">자산/은행</span>
            </div>
          </div>
          <div class="drag-handle" style="cursor: grab; color: var(--text-secondary); padding: 4px; display: flex; align-items: center; opacity: 0.3; transition: opacity 0.2s;">
            <i data-lucide="grip-vertical" style="width: 16px; height: 16px;"></i>
          </div>
        </div>
        <div class="asset-card-item-body">
          <div class="asset-card-value-row" style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 0.75rem;">
            <span class="asset-card-label" style="font-size: 0.8rem; color: var(--text-secondary);">현재 잔액</span>
            <span class="asset-card-value" style="font-weight: 700; font-size: 1.1rem; color: ${balanceColor};">${formatCurrency(asset.currentBalance)}</span>
          </div>
          <div class="asset-card-detail-rows" style="border-top: 1px solid var(--glass-border); padding-top: 0.5rem; display: flex; flex-direction: column; gap: 0.35rem;">
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

    if (!asset.isTotal) {
      initDragAndDropForCard(card, container);
    }
  });

  if (window.lucide) {
    window.lucide.createIcons();
  }
}

// 1-A. 카테고리 파이 차트
function renderCategoryChart(categories) {
  const textColor = getComputedStyle(document.documentElement).getPropertyValue('--text-primary').trim() || '#f8fafc';
  const textSecondary = getComputedStyle(document.documentElement).getPropertyValue('--text-secondary').trim() || '#94a3b8';
  const gridColor = getComputedStyle(document.documentElement).getPropertyValue('--glass-border').trim() || 'rgba(255,255,255,0.05)';
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

  let displayCategories = [...categories];
  if (categories.length > 11) {
    const topCategories = categories.slice(0, 10);
    const otherTotal = categories.slice(10).reduce((sum, c) => sum + c.total, 0);
    displayCategories = [
      ...topCategories,
      { category: '기타', total: otherTotal }
    ];
  }

  const labels = displayCategories.map(c => c.category);
  const data = displayCategories.map(c => c.total);
  const colors = displayCategories.map(c => {
    if (c.category === '기타') return '#64748b';
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
            color: textColor,
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
  const textColor = getComputedStyle(document.documentElement).getPropertyValue('--text-primary').trim() || '#f8fafc';
  const textSecondary = getComputedStyle(document.documentElement).getPropertyValue('--text-secondary').trim() || '#94a3b8';
  const gridColor = getComputedStyle(document.documentElement).getPropertyValue('--glass-border').trim() || 'rgba(255,255,255,0.05)';
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
          ticks: { color: textSecondary, font: { size: 10 } }
        },
        y: {
          grid: { color: gridColor },
          ticks: { 
            color: textSecondary, 
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
          labels: { color: textSecondary, font: { size: 10 } }
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
