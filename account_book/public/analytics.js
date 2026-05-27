// ==========================================
// 6. 소비 분석(Analytics) 탭 로직
// ==========================================

if (window.Chart) {
  Chart.defaults.font.family = "'Outfit', 'Noto Sans KR', sans-serif";
}

async function loadAnalytics() {
  const yearSelect = document.getElementById('analytics-year-select');
  const compareModeSelect = document.getElementById('analytics-compare-mode');
  const monthSelect = document.getElementById('analytics-month-select');
  const monthContainer = document.getElementById('analytics-month-select-container');
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

  // 테이블 제목 및 헤더 텍스트 변경
  if (tableTitle) {
    const compareModeSelect = document.getElementById('analytics-compare-mode');
    const isMom = compareModeSelect && compareModeSelect.value === 'mom';
    tableTitle.textContent = isMom ? '카테고리별 전월 대비 소비 증감' : '카테고리별 전년 대비 소비 증감';
  }
  if (headerPrev) headerPrev.textContent = prev_label;
  if (headerCurrent) headerCurrent.textContent = current_label;

  // 당월/올해 또는 전월/전년에 지출 실적이 하나라도 있는 것만 표시
  const list = compare.filter(c => c.current_total > 0 || c.prev_total > 0);

  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-message">비교할 데이터가 부족합니다.</td></tr>';
    return;
  }

  list.forEach(c => {
    const diff = c.current_total - c.prev_total;
    let rateStr = '--';
    if (c.prev_total > 0) {
      const rate = (diff / c.prev_total) * 100;
      rateStr = (rate > 0 ? '+' : '') + rate.toFixed(1) + '%';
    } else if (c.current_total > 0) {
      rateStr = '+100%';
    }

    let diffText = '0원';
    let diffClass = '';

    if (diff > 0) {
      diffText = `▲ +${formatCurrency(diff)}`;
      diffClass = 'text-down'; // 소비 증가 = 부정적(적색)
    } else if (diff < 0) {
      diffText = `▼ ${formatCurrency(diff)}`;
      diffClass = 'text-up'; // 소비 감소 = 긍정적(녹색)
    }

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td data-label="카테고리" class="text-bold">${c.category}</td>
      <td data-label="${prev_label}" class="text-right font-mono">${formatCurrency(c.prev_total)}</td>
      <td data-label="${current_label}" class="text-right font-mono">${formatCurrency(c.current_total)}</td>
      <td data-label="변동액" class="text-right font-mono ${diffClass}">${diffText}</td>
      <td data-label="증감률" class="text-right font-mono ${diffClass}">${rateStr}</td>
    `;
    tbody.appendChild(tr);
  });
}
