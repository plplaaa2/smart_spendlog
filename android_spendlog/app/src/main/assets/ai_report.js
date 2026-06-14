/**
 * @file public/ai_report.js
 * @summary AI 소비 리포트 화면 UI 제어 및 API 연동 스크립트
 * @description 월간/연간 가계부 소비 분석 데이터를 바탕으로 AI 리포트를 조회, 생성 및 마크다운 렌더링을 처리합니다.
 * @dependencies
 *   - public/app.js: state, showToast
 *   - public/index.html: tab-ai-report 관련 UI 컴포넌트
 */

let aiReportInitialized = false;

/**
 * AI 소비 리포트 탭 초기화 함수
 */
async function initAiReportTab() {
  if (aiReportInitialized) {
    // 탭을 다시 들어왔을 때 데이터를 새로 고침
    await loadAiReport();
    return;
  }

  initAiReportDateSelectors();
  initAiReportEvents();
  aiReportInitialized = true;
  
  // 초기 리포트 로드
  await loadAiReport();
}

/**
 * 연도 및 월 셀렉트박스 설정 및 초기값 매핑
 */
function initAiReportDateSelectors() {
  const yearSelect = document.getElementById('ai-report-year');
  if (!yearSelect) return;

  // 대시보드나 다른 탭에서 활용하는 연도 범위를 수집하여 주입
  const currentYear = new Date().getFullYear();
  yearSelect.innerHTML = '';
  
  // 최근 5개년도 생성
  for (let y = currentYear; y >= currentYear - 4; y--) {
    const opt = document.createElement('option');
    opt.value = y;
    opt.textContent = `${y}년`;
    yearSelect.appendChild(opt);
  }

  // 기본 연월 설정 (오늘 기준)
  const today = new Date();
  yearSelect.value = today.getFullYear();
  
  const monthSelect = document.getElementById('ai-report-month');
  if (monthSelect) {
    monthSelect.value = today.getMonth() + 1; // 1-indexed
  }
}

/**
 * AI 소비 리포트 이벤트 리스너 등록
 */
function initAiReportEvents() {
  const btnLoad = document.getElementById('btn-load-ai-report');
  const btnGenerate = document.getElementById('btn-generate-ai-report');
  const btnCopy = document.getElementById('btn-copy-ai-report');

  if (btnLoad) {
    btnLoad.addEventListener('click', async () => {
      await loadAiReport();
    });
  }

  if (btnGenerate) {
    btnGenerate.addEventListener('click', async () => {
      await generateAiReport();
    });
  }

  if (btnCopy) {
    btnCopy.addEventListener('click', () => {
      const summaryText = document.getElementById('ai-report-summary-text')?.textContent || '';
      const markdownContent = document.getElementById('ai-report-markdown-content')?.innerText || '';
      const titleDate = document.getElementById('ai-report-title-date')?.textContent || '소비 분석 리포트';

      const fullText = `[${titleDate}]\n\n* AI 요약: ${summaryText}\n\n${markdownContent}`;

      navigator.clipboard.writeText(fullText)
        .then(() => {
          showToast('리포트 내용이 클립보드에 복사되었습니다.', 'success');
        })
        .catch(err => {
          console.error('클립보드 복사 실패:', err);
          showToast('클립보드 복사에 실패했습니다.', 'danger');
        });
    });
  }
}

/**
 * AI 소비 리포트 조회 API 호출 및 화면 렌더링
 */
async function loadAiReport() {
  const year = document.getElementById('ai-report-year')?.value;
  const month = document.getElementById('ai-report-month')?.value;

  if (!year || !month) return;

  const emptyView = document.getElementById('ai-report-empty-view');
  const loadingView = document.getElementById('ai-report-loading-view');
  const resultView = document.getElementById('ai-report-result-view');

  // 로딩 뷰 활성화
  if (emptyView) emptyView.style.display = 'none';
  if (resultView) resultView.style.display = 'none';
  if (loadingView) {
    loadingView.style.display = 'flex';
    document.getElementById('ai-report-loading-text').innerHTML = '가계부 통계를 불러오는 중입니다...';
  }

  try {
    const token = localStorage.getItem('ab_token') || sessionStorage.getItem('ab_token');
    const res = await fetch(`api/analytics/ai-report?year=${year}&month=${month}`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (!res.ok) {
      throw new Error(`HTTP 에러: ${res.status}`);
    }

    const data = await res.json();
    if (loadingView) loadingView.style.display = 'none';

    if (data.success && data.report) {
      renderAiReportData(data.report, year, month);
    } else {
      if (emptyView) emptyView.style.display = 'flex';
    }
  } catch (err) {
    console.error('[AI 리포트 로드 오류]', err);
    if (loadingView) loadingView.style.display = 'none';
    if (emptyView) emptyView.style.display = 'flex';
    showToast('AI 리포트를 불러오는데 실패했습니다.', 'danger');
  }
}

/**
 * AI 소비 리포트 생성 API 호출
 */
async function generateAiReport() {
  const year = document.getElementById('ai-report-year')?.value;
  const month = document.getElementById('ai-report-month')?.value;

  if (!year || !month) return;

  // AI 연동 정보 사전 체크 (제공자가 local이 아니면 API Key가 존재해야 함)
  const provider = state.settings?.ai_provider || 'gemini';
  const apiKey = state.settings?.ai_api_key;
  const localIp = state.settings?.ai_local_ip;

  if (provider === 'local') {
    if (!localIp) {
      showToast('설정 탭의 AI 설정에서 로컬 API 주소를 먼저 입력해 주세요.', 'warning');
      return;
    }
  } else {
    if (!apiKey) {
      showToast('설정 탭의 AI 설정에서 API Key를 먼저 설정해 주세요.', 'warning');
      return;
    }
  }

  const emptyView = document.getElementById('ai-report-empty-view');
  const loadingView = document.getElementById('ai-report-loading-view');
  const resultView = document.getElementById('ai-report-result-view');

  if (emptyView) emptyView.style.display = 'none';
  if (resultView) resultView.style.display = 'none';
  if (loadingView) {
    loadingView.style.display = 'flex';
    document.getElementById('ai-report-loading-text').innerHTML = 
      `가계부 데이터를 수집하여 AI 분석 모델에 전달 중입니다.<br>
       소비 패턴을 꼼꼼하게 분석하느라 <strong>약 10~30초</strong> 정도 소요될 수 있습니다.`;
  }

  try {
    const token = localStorage.getItem('ab_token') || sessionStorage.getItem('ab_token');
    const res = await fetch('api/analytics/ai-report/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ year, month })
    });

    const data = await res.json();
    if (loadingView) loadingView.style.display = 'none';

    if (data.success && data.report) {
      renderAiReportData(data.report, year, month);
      showToast('AI 소비 분석 리포트가 성공적으로 생성되었습니다.', 'success');
    } else {
      if (emptyView) emptyView.style.display = 'flex';
      alert(`[AI 리포트 생성 실패]\n\n${data.error || '리포트 생성에 실패했습니다.'}`);
    }
  } catch (err) {
    console.error('[AI 리포트 생성 오류]', err);
    if (loadingView) loadingView.style.display = 'none';
    if (emptyView) emptyView.style.display = 'flex';
    alert(`[AI 리포트 생성 실패 - 네트워크/서버 오류]\n\n상세 내용: ${err.message || err}`);
  }
}

/**
 * 리포트 데이터를 DOM에 렌더링
 */
function renderAiReportData(report, year, month) {
  const resultView = document.getElementById('ai-report-result-view');
  const summaryEl = document.getElementById('ai-report-summary-text');
  const contentEl = document.getElementById('ai-report-markdown-content');
  const titleEl = document.getElementById('ai-report-title-date');
  const dateEl = document.getElementById('ai-report-created-at');

  if (!resultView) return;

  // 제목 연월 포맷팅
  if (titleEl) {
    titleEl.textContent = month === 'all' 
      ? `${year}년 연간 종합 소비 분석 리포트`
      : `${year}년 ${month}월 소비 분석 리포트`;
  }

  // 생성 시각 포맷팅
  if (dateEl && report.created_at) {
    const dateObj = new Date(report.created_at);
    const yyyy = dateObj.getFullYear();
    const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
    const dd = String(dateObj.getDate()).padStart(2, '0');
    const hh = String(dateObj.getHours()).padStart(2, '0');
    const min = String(dateObj.getMinutes()).padStart(2, '0');
    dateEl.textContent = `분석일: ${yyyy}-${mm}-${dd} ${hh}:${min}`;
  }

  // 한 줄 요약
  if (summaryEl) {
    summaryEl.textContent = report.summary || '요약 내용이 없습니다.';
  }

  // 마크다운 파싱 렌더링
  if (contentEl) {
    contentEl.innerHTML = parseMarkdownToHtml(report.content);
  }

  // 뷰 표시
  resultView.style.display = 'flex';
  
  // Lucide 아이콘 동적 갱신
  if (typeof lucide !== 'undefined') {
    lucide.createIcons();
  }
}

/**
 * 순수 Javascript 기반의 마크다운 렌더러
 * @param {string} markdown 
 * @returns {string} HTML 문자열
 */
function parseMarkdownToHtml(markdown) {
  if (!markdown) return '<p class="text-secondary">작성된 분석 본문이 비어있습니다.</p>';

  // HTML XSS 방지
  let html = markdown
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // 1. Bold 파싱: **text**
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

  // 2. Italic 파싱: *text* 또는 _text_
  html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');

  // 3. Headers 파싱 (H5, H4, H3 순서대로 매칭)
  html = html.replace(/^### (.*?)$/gm, '<h5 style="font-size: 1.05rem; font-weight: 600; margin-top: 1.25rem; margin-bottom: 0.5rem; color: var(--text-primary); display: flex; align-items: center; gap: 6px;">$1</h5>');
  html = html.replace(/^## (.*?)$/gm, '<h4 style="font-size: 1.15rem; font-weight: 600; margin-top: 1.5rem; margin-bottom: 0.75rem; color: var(--primary-color); padding-bottom: 0.25rem; border-bottom: 1px solid rgba(255,255,255,0.06); display: flex; align-items: center; gap: 8px;">$1</h4>');
  html = html.replace(/^# (.*?)$/gm, '<h3 style="font-size: 1.3rem; font-weight: 700; margin-top: 1.75rem; margin-bottom: 1rem; color: var(--accent-color);">$1</h3>');

  // 4. 리스트 아이템 파싱
  // Unordered list: - item
  html = html.replace(/^\s*-\s+(.*?)$/gm, '<li style="margin-left: 1.25rem; margin-bottom: 0.5rem; list-style-type: disc; color: rgba(255, 255, 255, 0.8); line-height: 1.6;">$1</li>');
  // Ordered list: 1. item
  html = html.replace(/^\s*(\d+)\.\s+(.*?)$/gm, '<li style="margin-left: 1.25rem; margin-bottom: 0.5rem; list-style-type: decimal; color: rgba(255, 255, 255, 0.8); line-height: 1.6;">$2</li>');

  // 5. 단락 구분 및 줄바꿈 처리
  const lines = html.split('\n');
  let insideList = false;
  let result = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (!line) {
      if (insideList) {
        result.push('</ul>');
        insideList = false;
      }
      result.push('<div style="height: 0.75rem;"></div>');
      continue;
    }

    if (line.startsWith('<li')) {
      if (!insideList) {
        result.push('<ul style="margin-bottom: 1rem; display: flex; flex-direction: column; gap: 0.25rem;">');
        insideList = true;
      }
      result.push(line);
    } else {
      if (insideList) {
        result.push('</ul>');
        insideList = false;
      }

      if (line.startsWith('<h') || line.startsWith('<div')) {
        result.push(line);
      } else {
        result.push(`<p style="margin-bottom: 0.75rem; line-height: 1.65; color: rgba(255, 255, 255, 0.85);">${line}</p>`);
      }
    }
  }

  if (insideList) {
    result.push('</ul>');
  }

  return result.join('\n');
}
