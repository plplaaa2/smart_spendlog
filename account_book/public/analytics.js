// ==========================================
// 6. 소비 분석(Analytics) 탭 로직
// ==========================================

let selectedGeneralCategory = null; // 일반지출 카테고리 필터링 상태 전역 변수
let selectedFixedCategory = null; // 고정지출 카테고리 필터링 상태 전역 변수

if (window.Chart) {
  Chart.defaults.font.family = "'Outfit', 'Noto Sans KR', sans-serif";
}

async function loadAnalytics() {
  const yearSelect = document.getElementById('analytics-year-select');
  const compareModeSelect = document.getElementById('analytics-compare-mode');
  const monthSelect = document.getElementById('analytics-month-select');
  const monthContainer = document.getElementById('analytics-month-select-container');
  const compareModeContainer = document.getElementById('analytics-compare-mode-container');
  if (!yearSelect) return;

  // 연도 선택 목록 초기화 (현재 연도 기준 최근 3개년)
  if (yearSelect.options.length === 0) {
    const currentYear = new Date().getFullYear();
    for (let y = currentYear; y >= currentYear - 2; y--) {
      const opt = document.createElement('option');
      opt.value = String(y);
      opt.textContent = `${y}년`;
      yearSelect.appendChild(opt);
    }
    yearSelect.value = String(currentYear);
    
    // 연도 변경 시 분석 리로드 이벤트 추가
    yearSelect.addEventListener('change', () => {
      loadAnalytics();
    });
  }

  // 비교 기준 및 월 초기화
  if (compareModeSelect && !compareModeSelect.dataset.initialized) {
    compareModeSelect.dataset.initialized = 'true';
    
    // 기본값 설정 (대상 월은 현재 월로 세팅)
    if (monthSelect) {
      const currentMonth = new Date().getMonth() + 1;
      monthSelect.value = String(currentMonth);
      monthSelect.addEventListener('change', () => {
        loadAnalytics();
      });
    }

    compareModeSelect.addEventListener('change', () => {
      const mode = compareModeSelect.value;
      if (mode === 'mom') {
        if (monthContainer) monthContainer.style.display = 'flex';
      } else {
        if (monthContainer) monthContainer.style.display = 'none';
      }
      loadAnalytics();
    });
  }

  const selectedYear = yearSelect.value;
  const compareMode = compareModeSelect ? compareModeSelect.value : 'yoy';
  const selectedMonth = monthSelect ? monthSelect.value : '1';

  // 서브 탭에 따라 control-bar 표시 제어
  if (state.currentAnalyticsSubTab === 'general' || state.currentAnalyticsSubTab === 'fixed') {
    if (compareModeContainer) compareModeContainer.style.display = 'none';
    if (monthContainer) monthContainer.style.display = 'flex';
  } else {
    if (compareModeContainer) compareModeContainer.style.display = 'flex';
    if (compareMode === 'mom') {
      if (monthContainer) monthContainer.style.display = 'flex';
    } else {
      if (monthContainer) monthContainer.style.display = 'none';
    }
  }

  // 일반지출 서브 탭일 경우 전용 로더 호출
  if (state.currentAnalyticsSubTab === 'general') {
    loadGeneralAnalytics(selectedYear, selectedMonth);
    return;
  }

  // 고정지출 서브 탭일 경우 전용 로더 호출
  if (state.currentAnalyticsSubTab === 'fixed') {
    loadFixedAnalytics(selectedYear, selectedMonth);
    return;
  }

  const chart1Title = document.getElementById('analytics-chart1-title');
  const chart2Title = document.getElementById('analytics-chart2-title');

  try {
    if (compareMode === 'mom') {
      // 월간 분석 모드일 때 타이틀 변경
      if (chart1Title) chart1Title.textContent = `${selectedMonth}월 수입 vs 지출 일별 추이`;
      if (chart2Title) chart2Title.textContent = `카테고리별 ${selectedMonth}월 소비 누적`;

      // API 호출: 월간 상세(일별 흐름 및 카테고리별 지출), 최근 12개월 추이, 비교 데이터
      const [monthlyDetail, monthlyData, compareData] = await Promise.all([
        fetch(`api/analytics/monthly-detail?year=${selectedYear}&month=${selectedMonth}`).then(r => r.json()),
        fetch(`api/analytics/monthly`).then(r => r.json()),
        fetch(`api/analytics/compare?mode=${compareMode}&year=${selectedYear}&month=${selectedMonth}`).then(r => r.json())
      ]);

      // 1. 월간 수입 vs 지출 일별 추이 차트 렌더링
      renderAnalyticsDailyChart(monthlyDetail.daily, selectedMonth);

      // 2. 카테고리별 월간 누적 소비 차트 렌더링 (isMonthly = true)
      renderAnalyticsCategoryChart(monthlyDetail.categories, true);

      // 3. 최근 12개월 자산 추이 차트 렌더링
      renderAnalyticsMonthlyChart(monthlyData);

      // 4. 전년/전월 대비 소비 증감 테이블 렌더링
      renderAnalyticsCategoryTable(compareData);
    } else {
      // 연간 분석 모드일 때 타이틀 변경
      if (chart1Title) chart1Title.textContent = `${selectedYear}년 수입 vs 지출 월별 추이`;
      if (chart2Title) chart2Title.textContent = `카테고리별 ${selectedYear}년 소비 누적`;

      // API 호출: 연도별 월별 흐름, 최근 12개월 추이, 비교 데이터
      const [yearlyData, monthlyData, compareData] = await Promise.all([
        fetch(`api/analytics/yearly?year=${selectedYear}`).then(r => r.json()),
        fetch(`api/analytics/monthly`).then(r => r.json()),
        fetch(`api/analytics/compare?mode=${compareMode}&year=${selectedYear}&month=${selectedMonth}`).then(r => r.json())
      ]);

      // 1. 연간 수입 vs 지출 월별 비교 차트 렌더링
      renderAnalyticsYearlyChart(yearlyData.monthly);

      // 2. 카테고리별 연간 누적 소비 차트 렌더링 (isMonthly = false)
      renderAnalyticsCategoryChart(yearlyData.categories, false);

      // 3. 최근 12개월 자산 추이 차트 렌더링
      renderAnalyticsMonthlyChart(monthlyData);

      // 4. 전년/전월 대비 소비 증감 테이블 렌더링
      renderAnalyticsCategoryTable(compareData);
    }
  } catch (err) {
    console.error('소비 분석 데이터 로드 실패:', err);
  }
}

// 1. 연간 월별 비교 차트 (Grouped Bar Chart)
function renderAnalyticsYearlyChart(monthlyData) {
  const ctx = document.getElementById('analyticsYearlyChart').getContext('2d');
  if (analyticsYearlyChartInstance) {
    analyticsYearlyChartInstance.destroy();
  }

  const labels = Array.from({ length: 12 }, (_, i) => `${i + 1}월`);
  
  // 12개월 데이터 매핑
  const incomeData = Array(12).fill(0);
  const expenseData = Array(12).fill(0);

  monthlyData.forEach(d => {
    const mIdx = parseInt(d.month, 10) - 1;
    if (mIdx >= 0 && mIdx < 12) {
      incomeData[mIdx] = d.income || 0;
      expenseData[mIdx] = d.expense || 0;
    }
  });

  analyticsYearlyChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: '수입',
          data: incomeData,
          backgroundColor: '#10b981',
          borderRadius: 4,
          maxBarThickness: 15
        },
        {
          label: '지출',
          data: expenseData,
          backgroundColor: '#6366f1',
          borderRadius: 4,
          maxBarThickness: 15
        }
      ]
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
        legend: { labels: { color: '#f8fafc' } },
        tooltip: {
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

// 1-2. 월간 일별 수입 vs 지출 비교 차트 (Grouped Bar Chart)
function renderAnalyticsDailyChart(dailyData, month) {
  const ctx = document.getElementById('analyticsYearlyChart').getContext('2d');
  if (analyticsYearlyChartInstance) {
    analyticsYearlyChartInstance.destroy();
  }

  // 해당 월의 정확한 총 일수 구하기
  const yearSelect = document.getElementById('analytics-year-select');
  const year = yearSelect ? parseInt(yearSelect.value, 10) : new Date().getFullYear();
  const numDays = new Date(year, parseInt(month, 10), 0).getDate();

  const labels = Array.from({ length: numDays }, (_, i) => `${i + 1}일`);
  const incomeData = Array(numDays).fill(0);
  const expenseData = Array(numDays).fill(0);

  dailyData.forEach(d => {
    const dIdx = parseInt(d.day, 10) - 1;
    if (dIdx >= 0 && dIdx < numDays) {
      incomeData[dIdx] = d.income || 0;
      expenseData[dIdx] = d.expense || 0;
    }
  });

  analyticsYearlyChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: '수입',
          data: incomeData,
          backgroundColor: '#10b981',
          borderRadius: 3,
          maxBarThickness: 8
        },
        {
          label: '지출',
          data: expenseData,
          backgroundColor: '#6366f1',
          borderRadius: 3,
          maxBarThickness: 8
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { 
          grid: { display: false }, 
          ticks: { 
            color: '#94a3b8',
            font: { size: 9 },
            autoSkip: true,
            maxRotation: 0
          } 
        },
        y: {
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: {
            color: '#94a3b8',
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
        legend: { labels: { color: '#f8fafc' } },
        tooltip: {
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

// 2. 카테고리별 누적 소비 차트 (Doughnut Chart / Horizontal Bar)
function renderAnalyticsCategoryChart(categories, isMonthly = false) {
  const ctx = document.getElementById('analyticsCategoryChart').getContext('2d');
  if (analyticsCategoryChartInstance) {
    analyticsCategoryChartInstance.destroy();
  }

  // 지출 카테고리 중 실적이 있는 것들만 필터링 (월간 데이터는 total, 연간 데이터는 current_year_total)
  const filtered = categories.filter(c => isMonthly ? (c.total > 0) : (c.current_year_total > 0));
  const labels = filtered.map(c => c.category);
  const data = filtered.map(c => isMonthly ? c.total : c.current_year_total);
  const colors = filtered.map(c => {
    const style = state.categoryMap[c.category];
    return style ? style.color : '#868e96';
  });

  if (filtered.length === 0) {
    ctx.clearRect(0, 0, 300, 300);
    analyticsCategoryChartInstance = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['데이터 없음'],
        datasets: [{ data: [1], backgroundColor: ['rgba(255,255,255,0.05)'], borderWidth: 0 }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
    });
    return;
  }

  analyticsCategoryChartInstance = new Chart(ctx, {
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

// 3. 최근 12개월 추이 차트 (Line Chart)
function renderAnalyticsMonthlyChart(monthlyData) {
  const ctx = document.getElementById('analyticsMonthlyChart').getContext('2d');
  if (analyticsMonthlyChartInstance) {
    analyticsMonthlyChartInstance.destroy();
  }

  const labels = monthlyData.map(d => {
    const [y, m] = d.month.split('-');
    return `${y.slice(2)}/${m}`;
  });
  const incomeData = monthlyData.map(d => d.income || 0);
  const expenseData = monthlyData.map(d => d.expense || 0);

  analyticsMonthlyChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: '수입',
          data: incomeData,
          borderColor: '#10b981',
          borderWidth: 2,
          backgroundColor: 'transparent',
          tension: 0.3,
          pointBackgroundColor: '#10b981',
          pointRadius: 3
        },
        {
          label: '지출',
          data: expenseData,
          borderColor: '#6366f1',
          borderWidth: 2,
          backgroundColor: 'transparent',
          tension: 0.3,
          pointBackgroundColor: '#6366f1',
          pointRadius: 3
        }
      ]
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
        legend: { labels: { color: '#f8fafc' } },
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

// 4. 전년/전월 대비 증감 테이블 작성
// 의존성: 이 함수는 index.html의 테이블 엘리먼트와 연동되어 데이터를 채웁니다.
function renderAnalyticsCategoryTable(compareData) {
  const tbody = document.getElementById('analytics-category-table-body');
  const tableTitle = document.getElementById('analytics-table-title');
  const headerPrev = document.getElementById('analytics-header-prev');
  const headerCurrent = document.getElementById('analytics-header-current');
  
  if (!tbody) return;

  tbody.innerHTML = '';

  const { compare, current_label, prev_label } = compareData;

  // 테이블 제목 및 헤더 텍스트 변경 (단위 표기 추가)
  if (tableTitle) {
    const compareModeSelect = document.getElementById('analytics-compare-mode');
    const isMom = compareModeSelect && compareModeSelect.value === 'mom';
    tableTitle.innerHTML = (isMom ? '카테고리별 전월 대비 소비 증감' : '카테고리별 전년 대비 소비 증감') + 
      ' <span style="font-size: 0.85rem; font-weight: normal; color: var(--text-secondary); margin-left: 6px;">(단위: 천원)</span>';
  }
  if (headerPrev) headerPrev.textContent = prev_label;
  if (headerCurrent) headerCurrent.textContent = current_label;

  // 당월/올해 또는 전월/전년에 지출 실적이 하나라도 있는 것만 표시
  const list = compare.filter(c => c.current_total > 0 || c.prev_total > 0);

  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-message">비교할 데이터가 부족합니다.</td></tr>';
    return;
  }

  // 천원 단위 콤마 포맷 헬퍼
  const formatThousand = (val) => {
    const rounded = Math.round(val / 1000);
    return new Intl.NumberFormat('ko-KR').format(rounded);
  };

  list.forEach(c => {
    const diff = c.current_total - c.prev_total;
    let rateStr = '--';
    if (c.prev_total > 0) {
      const rate = (diff / c.prev_total) * 100;
      rateStr = (rate > 0 ? '+' : '') + rate.toFixed(1) + '%';
    } else if (c.current_total > 0) {
      rateStr = '+100%';
    }

    let diffText = '0';
    let diffClass = '';

    const diffRounded = Math.round(diff / 1000);
    const diffAbsFormatted = new Intl.NumberFormat('ko-KR').format(Math.abs(diffRounded));

    if (diffRounded > 0) {
      diffText = `▲ +${diffAbsFormatted}`;
      diffClass = 'text-down'; // 소비 증가 = 부정적(적색)
    } else if (diffRounded < 0) {
      diffText = `▼ -${diffAbsFormatted}`;
      diffClass = 'text-up'; // 소비 감소 = 긍정적(녹색)
    }

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td data-label="카테고리" class="text-bold">${c.category}</td>
      <td data-label="${prev_label}" class="text-right font-mono">${formatThousand(c.prev_total)}</td>
      <td data-label="${current_label}" class="text-right font-mono">${formatThousand(c.current_total)}</td>
      <td data-label="변동액" class="text-right font-mono ${diffClass}">${diffText}</td>
      <td data-label="증감률" class="text-right font-mono ${diffClass}">${rateStr}</td>
    `;
    tbody.appendChild(tr);
  });
}

// 고정지출 데이터 로드 및 렌더링 총괄 함수
// 요약: 선택한 년/월의 고정지출 정보를 API에서 호출하고, 카드 통계, 월별 추이 차트, 카테고리별 비중 차트, 내역 테이블을 그립니다.
// 의존성: index.html의 fixed-total-value, fixed-ratio-value, variable-total-value 등 DOM 엘리먼트 및 /api/analytics/fixed 와 연동됩니다.
async function loadFixedAnalytics(year, month) {
  try {
    const res = await fetch(`api/analytics/fixed?year=${year}&month=${month}`).then(r => r.json());
    
    const isYearly = (month === 'all');
    const periodLabel = isYearly ? '올해' : '이번 달';
    const periodDetailLabel = isYearly ? `${year}년 전체` : `${parseInt(month, 10)}월`;

    // 다이나믹 라벨 및 타이틀 세팅
    const totalLabelEl = document.getElementById('fixed-total-label');
    if (totalLabelEl) totalLabelEl.textContent = `${periodLabel} 고정지출`;
    const variableLabelEl = document.getElementById('variable-total-label');
    if (variableLabelEl) variableLabelEl.textContent = `고정비 제외 지출액 (${periodLabel})`;

    const subviewTitleEl = document.getElementById('fixed-subview-title');
    if (subviewTitleEl) subviewTitleEl.textContent = `${periodDetailLabel} 고정지출 거래 내역`;
    const emptyMsgEl = document.getElementById('fixed-transaction-table-empty-msg');
    if (emptyMsgEl) emptyMsgEl.textContent = `${periodDetailLabel} 고정지출 거래 내역이 없습니다.`;

    const trendTitleEl = document.getElementById('fixed-trend-title');
    if (trendTitleEl) {
      trendTitleEl.textContent = isYearly ? `고정지출 월별 추이 (${year}년)` : '고정지출 월별 추이 (최근 6개월)';
    }

    // 1. 상단 요약 카드 데이터 반영
    const fixedTotal = res.fixedTotal || 0;
    const totalSpent = res.totalSpent || 0;
    
    const fixedRatio = totalSpent > 0 ? Math.round((fixedTotal / totalSpent) * 100) : 0;
    const variableTotal = Math.max(0, totalSpent - fixedTotal);

    document.getElementById('fixed-total-value').textContent = formatCurrency(fixedTotal);
    document.getElementById('fixed-ratio-value').textContent = `${fixedRatio}%`;
    document.getElementById('variable-total-value').textContent = formatCurrency(variableTotal);

    // 필터 상태 초기화
    selectedFixedCategory = null;

    // 2. 월별 고정지출 추이 차트 렌더링
    renderFixedMonthlyTrendChart(res.trend);

    // 3. 고정지출 카테고리별 비중 차트 렌더링
    renderFixedCategoryChart(res.categories);

    // [NEW] 카테고리별 고정소비 요약 테이블 렌더링
    renderFixedCategorySummaryTable(res.categories, totalSpent, fixedTotal, res.transactions);

    // 4. 고정지출 상세 거래 내역 테이블 렌더링
    renderFixedTransactionTable(res.transactions);

    // 아이콘 새로 렌더링
    if (window.lucide) {
      lucide.createIcons();
    }
  } catch (err) {
    console.error('고정지출 분석 데이터 로드 실패:', err);
  }
}

// 6개월 고정지출 추이 바 차트
function renderFixedMonthlyTrendChart(trendData) {
  const ctx = document.getElementById('fixedMonthlyTrendChart').getContext('2d');
  if (fixedMonthlyTrendChartInstance) {
    fixedMonthlyTrendChartInstance.destroy();
  }

  const labels = trendData.map(d => {
    const [y, m] = d.month.split('-');
    return `${y.slice(2)}/${m}`;
  });
  const data = trendData.map(d => d.total || 0);

  fixedMonthlyTrendChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: '고정지출 합계',
        data,
        backgroundColor: '#3b82f6',
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
              return ` 고정지출: ${formatCurrency(context.raw)}`;
            }
          }
        }
      }
    }
  });
}

// 고정지출 카테고리별 비중 도넛 차트
function renderFixedCategoryChart(categories) {
  const ctx = document.getElementById('fixedCategoryChart').getContext('2d');
  if (fixedCategoryChartInstance) {
    fixedCategoryChartInstance.destroy();
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
    fixedCategoryChartInstance = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['데이터 없음'],
        datasets: [{ data: [1], backgroundColor: ['rgba(255,255,255,0.05)'], borderWidth: 0 }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
    });
    return;
  }

  fixedCategoryChartInstance = new Chart(ctx, {
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

// 고정지출 거래 내역 테이블 렌더링
function renderFixedTransactionTable(transactions) {
  const tbody = document.getElementById('fixed-transaction-table-body');
  const footer = document.getElementById('fixed-transaction-table-footer');
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

// 일반지출 데이터 로드 및 렌더링 총괄 함수
// 요약: 선택한 년/월의 일반지출 정보를 API에서 호출하고, 카드 통계, 월별 추이 차트, 카테고리별 비중 차트, 내역 테이블을 그립니다.
// 의존성: index.html의 general-total-value, general-ratio-value, non-general-total-value 등 DOM 엘리먼트 및 /api/analytics/general 과 연동됩니다.
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

// [NEW] 카테고리별 고정소비 요약 테이블 렌더링
function renderFixedCategorySummaryTable(categories, totalSpent, fixedTotal, transactions) {
  const tbody = document.getElementById('fixed-category-summary-body');
  const resetBtn = document.getElementById('reset-fixed-category-filter-btn');
  if (!tbody) return;

  tbody.innerHTML = '';

  const filtered = categories.filter(c => c.total > 0);

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty-message">카테고리별 요약 데이터가 없습니다.</td></tr>';
    if (resetBtn) resetBtn.style.display = 'none';
    return;
  }

  if (resetBtn) {
    resetBtn.style.display = 'inline';
    const newResetBtn = resetBtn.cloneNode(true);
    resetBtn.parentNode.replaceChild(newResetBtn, resetBtn);
    newResetBtn.addEventListener('click', () => {
      if (selectedFixedCategory !== null) {
        selectedFixedCategory = null;
        document.querySelectorAll('.fixed-summary-row-clickable').forEach(r => r.classList.remove('active'));
        renderFixedTransactionTable(transactions);
        if (window.lucide) lucide.createIcons();
      }
    });
  }

  filtered.forEach(c => {
    const tr = document.createElement('tr');
    tr.className = 'summary-row-clickable fixed-summary-row-clickable';
    if (selectedFixedCategory === c.category) {
      tr.classList.add('active');
    }

    const catStyle = state.categoryMap[c.category] || { color: '#868e96', icon: 'help-circle' };
    const ratioToTotal = totalSpent > 0 ? ((c.total / totalSpent) * 100).toFixed(1) : '0.0';
    const ratioToFixed = fixedTotal > 0 ? ((c.total / fixedTotal) * 100).toFixed(1) : '0.0';

    tr.innerHTML = `
      <td data-label="카테고리">
        <span class="category-badge" style="background-color: ${catStyle.color}15; color: ${catStyle.color}; border: 1px solid ${catStyle.color}30;">
          <i data-lucide="${catStyle.icon}"></i>
          ${c.category}
        </span>
      </td>
      <td data-label="소비액" class="text-right text-bold font-mono text-expense">${formatCurrency(c.total)}</td>
      <td data-label="전체 지출 대비 비율" class="text-right font-mono text-secondary">${ratioToTotal}%</td>
      <td data-label="고정소비 대비 비율" class="text-right font-mono text-primary text-bold">${ratioToFixed}%</td>
    `;

    tr.addEventListener('click', () => {
      if (selectedFixedCategory === c.category) {
        selectedFixedCategory = null;
        tr.classList.remove('active');
        renderFixedTransactionTable(transactions);
      } else {
        selectedFixedCategory = c.category;
        document.querySelectorAll('.fixed-summary-row-clickable').forEach(r => r.classList.remove('active'));
        tr.classList.add('active');
        const filteredTx = transactions.filter(t => t.category === c.category);
        renderFixedTransactionTable(filteredTx);
      }
      if (window.lucide) {
        lucide.createIcons();
      }
    });

    tbody.appendChild(tr);
  });
}

// 6개월 일반지출 추이 바 차트
// 요약: 최근 6개월 동안의 일반지출 월별 합계를 바 차트로 렌더링합니다.
// 의존성: index.html의 generalMonthlyTrendChart 캔버스 엘리먼트와 연동됩니다.
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
// 요약: 해당 월의 일반지출 카테고리별 비율을 도넛 차트로 표시합니다.
// 의존성: index.html의 generalCategoryChart 캔버스 엘리먼트와 연동됩니다.
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
// 요약: 해당 월의 일반지출 상세 내역 목록을 테이블에 렌더링합니다.
// 의존성: index.html의 general-transaction-table-body 및 general-transaction-table-footer 엘리먼트와 연동됩니다.
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
