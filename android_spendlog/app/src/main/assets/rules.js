// ==========================================
// 3. ?뺢퇋??洹쒖튃 諛??뚮┝ 濡쒓렇 ??濡쒖쭅
// ==========================================

// 濡쒓렇 ?붾㈃ ?대? ?쒕툕 ??愿??諛붿씤???곹깭
let isLogsSubTabInitialized = false;

function initLogsSubTabs() {
  if (isLogsSubTabInitialized) return;
  
  const tabBtns = document.querySelectorAll('.logs-tab-btn');
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const subtab = btn.dataset.subtab;
      switchLogsSubTab(subtab);
    });
  });
  
  isLogsSubTabInitialized = true;
}

function switchLogsSubTab(subtab) {
  state.currentLogsSubTab = subtab;

  // 踰꾪듉 ?≫떚釉??대옒??議곗젙
  document.querySelectorAll('.logs-tab-btn').forEach(btn => {
    if (btn.dataset.subtab === subtab) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  // 而⑦뀗痢??≫떚釉??대옒??議곗젙
  document.querySelectorAll('.sub-logs-content').forEach(content => {
    if (content.id === `subtab-${subtab}`) {
      content.classList.add('active');
    } else {
      content.classList.remove('active');
    }
  });

  // ?ㅻ뜑 ?낅뜲?댄듃
  if (typeof updateHeaderTitle === 'function') {
    updateHeaderTitle('logs', subtab);
  }

  // ?쒕툕 ??퀎 ?곗씠??濡쒕뱶
  if (subtab === 'logs-list') {
    loadLogs();
  } else if (subtab === 'rules') {
    loadRules();
  } else if (subtab === 'pass-rules') {
    loadPassRules();
  } else if (subtab === 'merchant') {
    if (typeof loadMerchantCategories === 'function') {
      loadMerchantCategories();
    }
  }
}


async function loadRules() {
  try {
    const rules = await fetch('api/rules').then(r => r.json());
    state.rules = rules;

    const container = document.getElementById('rules-list-container');
    if (!container) return;
    container.innerHTML = '';

    if (rules.length === 0) {
      container.innerHTML = '<p class="empty-message">?깅줉??遺꾨쪟 洹쒖튃???놁뒿?덈떎.</p>';
      return;
    }

    rules.forEach(rule => {
      const isIncome = rule.type === 'INCOME';
      const typeLabel = isIncome ? '?섏엯' : '吏異?;
      const typeClass = isIncome ? 'success' : 'failed';

      const div = document.createElement('div');
      div.className = 'rule-item';
      div.innerHTML = `
        <div class="rule-info">
          <div class="rule-title" style="display:flex; align-items:center; gap:0.5rem;">
            <span>${rule.name}</span>
            <span class="badge-status ${typeClass}" style="padding: 0.1rem 0.4rem; font-size: 0.7rem;">${typeLabel}</span>
          </div>
          <div class="rule-pattern-text">${escapeHtml(rule.pattern)}</div>
          <div class="rule-badges">
            <span class="tx-pay-method">${rule.pay_method === '_AUTO_MAPPING_' ? '?봽 ?먮룞 留ㅽ븨' : rule.pay_method}</span>
          </div>
        </div>
        <div class="rule-actions">
          <button class="icon-btn btn-edit-rule">
            <i data-lucide="edit-2" style="width:16px;height:16px;"></i>
          </button>
          <button class="icon-btn btn-delete-rule" style="color:var(--danger-color)">
            <i data-lucide="trash" style="width:16px;height:16px;"></i>
          </button>
        </div>
      `;
      div.querySelector('.btn-edit-rule').addEventListener('click', () => loadRuleToEditor(rule));
      div.querySelector('.btn-delete-rule').addEventListener('click', () => deleteRule(rule.id));
      container.appendChild(div);
    });

    lucide.createIcons();

  } catch (err) {
    console.error('洹쒖튃 濡쒕뱶 ?ㅽ뙣:', err);
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

// 洹쒖튃 ?몄쭛李??쒖꽦??
function loadRuleToEditor(rule) {
  const formCard = document.getElementById('rule-form-card');
  if (!formCard) return;
  formCard.style.display = 'block';
  document.getElementById('rule-form-title').textContent = rule ? '洹쒖튃 ?몄쭛' : '??洹쒖튃 異붽?';

  const type = rule ? rule.type : 'EXPENSE';

  document.getElementById('rule-id').value = rule ? rule.id : '';
  document.getElementById('rule-name').value = rule ? rule.name : '';
  document.getElementById('rule-pattern').value = rule ? rule.pattern : '';
  document.getElementById('rule-type').value = type;
  
  // 嫄곕옒?좏삎 蹂寃쎌뿉 ?곕Ⅸ 移댄뀒怨좊━ ??됲듃 ?앺벐?덉씠??
  updateCategorySelect('#rule-category', type, rule ? rule.category : '');
  
  document.getElementById('rule-pay-method').value = rule ? rule.pay_method : '_AUTO_MAPPING_';
  
  const actionSelect = document.getElementById('rule-action');
  if (actionSelect) {
    actionSelect.value = 'REGISTER';
  }
  const payMethodSelect = document.getElementById('rule-pay-method');
  if (payMethodSelect) {
    payMethodSelect.disabled = false;
    payMethodSelect.style.opacity = '1';
    payMethodSelect.style.cursor = 'default';
  }

  // ?ㅼ떆媛??뚯뒪?곗뿉???먮룞?쇰줈 ?⑦꽩 梨꾩썙二쇨린
  if (rule) {
    document.getElementById('test-pattern').value = rule.pattern;
  }

  // 紐⑤떖 ?쒖꽦??
  const modal = document.getElementById('rule-modal');
  if (modal) {
    modal.classList.add('active');
  }
}

// 洹쒖튃 ?쒓굅
async function deleteRule(id) {
  if (!confirm('?뺣쭚濡???洹쒖튃????젣?섏떆寃좎뒿?덇퉴?')) return;
  try {
    const res = await fetch(`api/rules/${id}`, { method: 'DELETE' }).then(r => r.json());
    if (res.success) {
      loadRules();
      document.getElementById('rule-form-card').style.display = 'none';
    }
  } catch (err) {
    alert('洹쒖튃 ??젣 ?ㅽ뙣: ' + err.message);
  }
}

// ?뺢퇋???ㅼ떆媛??뚯뒪???ㅽ뻾
async function runRegexTest() {
  const text = document.getElementById('test-text').value;
  const pattern = document.getElementById('test-pattern').value;
  const category = document.getElementById('rule-category').value;
  const payMethod = document.getElementById('rule-pay-method').value;

  if (!text || !pattern) {
    alert('?뚯뒪?명븷 ?뚮┝ ?먮낯怨??뺢퇋???⑦꽩???낅젰??二쇱꽭??');
    return;
  }

  const container = document.getElementById('test-result-container');
  const successBox = document.getElementById('test-result-success');
  const failBox = document.getElementById('test-result-fail');

  if (!container || !successBox || !failBox) return;

  container.style.display = 'block';
  successBox.style.display = 'none';
  failBox.style.display = 'none';

  try {
    const type = document.getElementById('rule-type').value;

    const res = await fetch('api/parse-test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, pattern, category, pay_method: payMethod, type })
    }).then(r => r.json());

    if (res.success) {
      successBox.style.display = 'block';
      const r = res.result;
      
      const isIncome = r.type === 'INCOME';
      const typeEl = document.getElementById('result-val-type');
      typeEl.textContent = isIncome ? '?섏엯' : '吏異?;
      typeEl.className = isIncome ? 'text-bold text-income' : 'text-bold';

      document.getElementById('result-val-amount').textContent = formatCurrency(r.amount);
      document.getElementById('result-val-point').textContent = r.used_point ? formatCurrency(r.used_point) + '?? : '0??;
      document.getElementById('result-val-merchant').textContent = r.merchant;
      document.getElementById('result-val-datetime').textContent = r.datetime;
      document.getElementById('result-val-paymethod').textContent = r.pay_method === '_AUTO_MAPPING_' ? '?봽 ?먮룞 留ㅽ븨' : r.pay_method;
      document.getElementById('result-val-category').textContent = r.category;
    } else {
      failBox.style.display = 'block';
      document.getElementById('test-fail-message').textContent = res.message || '留ㅼ묶 ?ㅽ뙣';
    }
  } catch (err) {
    failBox.style.display = 'block';
    document.getElementById('test-fail-message').textContent = '?쒕쾭 ?듭떊 ?먮윭: ' + err.message;
  }
}

// ==========================================
// 4. ?섏떊 濡쒓렇 ??濡쒖쭅
// ==========================================
// ?섏떊 濡쒓렇 ???곗씠??濡쒕뱶
// ?붿빟: Home Assistant濡쒕????섏떊???뚮┝ ?대젰 ?곗씠?곕? 媛?몄? 移대뱶 洹몃━???뺥깭濡??뚮뜑留곹븯怨? title怨?text瑜?援щ텇?섏뿬 蹂댁뿬以띾땲??
// ?섏〈?? public/index.html??logs-grid-container, public/style.css??移대뱶 ?대옒?ㅻ뱾怨?留ㅽ븨?⑸땲??
async function loadLogs() {
  try {
    const logs = await fetch('api/notification_logs').then(r => r.json());
    const container = document.getElementById('logs-grid-container');
    if (!container) return;
    container.innerHTML = '';

    if (logs.length === 0) {
      container.innerHTML = '<p class="empty-message" style="grid-column: 1 / -1;">?섏떊???뚮┝ ?대젰???놁뒿?덈떎.</p>';
      return;
    }

    logs.forEach(log => {
      let statusBadge = '';
      if (log.parsed_status === 'SUCCESS') {
        statusBadge = '<span class="badge-status success">?깅줉 ?깃났</span>';
      } else if (log.parsed_status === 'PASS') {
        statusBadge = '<span class="badge-status pass" style="background: rgba(59,130,246,0.18); color: #93c5fd; border: 1px solid rgba(59,130,246,0.45); font-weight: 700; padding: 2px 6px; border-radius: 4px; font-size: 0.72rem; line-height: 1;">PASS</span>';
      } else {
        statusBadge = '<span class="badge-status failed">?깅줉 ?ㅽ뙣</span>';
      }

      const showRetry = (log.parsed_status !== 'PASS');
      const retryHtml = showRetry 
        ? `<button class="badge-status btn-retry-log" style="cursor: pointer; border: none; background: rgba(16, 185, 129, 0.2); color: var(--success-color); display: inline-flex; align-items: center; gap: 3px; font-family: inherit; transition: opacity 0.2s;" onmouseover="this.style.opacity='0.8'" onmouseout="this.style.opacity='1'">
             <i data-lucide="refresh-cw" style="width:11px;height:11px;"></i> ?ъ떆??
           </button>`
        : '';

      const showFooter = (log.parsed_status !== 'PASS');
      const footerHtml = showFooter 
        ? `<div class="log-card-footer" style="gap: 6px;">
             <button class="btn btn-secondary btn-sm btn-create-tx">
               <i data-lucide="plus" style="width:12px;height:12px;"></i> ?섎룞 ?깅줉
             </button>
             <button class="btn btn-secondary btn-sm btn-create-rule">
               <i data-lucide="sliders" style="width:12px;height:12px;"></i> 洹쒖튃 留뚮뱾湲?
             </button>
           </div>`
        : '';

      const card = document.createElement('div');
      card.className = 'log-card-item';
      card.innerHTML = `
        <div class="log-card-header">
          <span class="log-card-time">${formatShortDate(log.created_at, true)}</span>
          <span class="log-card-status" style="display: flex; align-items: center; gap: 0.35rem;">
            ${statusBadge}
            ${retryHtml}
          </span>
        </div>
        <div class="log-card-body">
          <div class="log-card-row">
            <span class="log-card-label">諛쒖떊泥???踰덊샇)</span>
            <span class="log-card-value text-bold" style="font-family: monospace; font-size: 0.8rem; display: flex; align-items: center; gap: 0.25rem;">
              <span>${escapeHtml(log.sender || '-')}</span>
              ${log.sender ? `
              <button class="icon-btn btn-copy-package" title="???⑦궎吏 留ㅽ븨??異붽?" style="padding: 2px; color: var(--accent-color); background: none; border: none; cursor: pointer; display: inline-flex; align-items: center;">
                <i data-lucide="plus" style="width: 13px; height: 13px; stroke-width: 2.5;"></i>
              </button>` : ''}
            </span>
          </div>
          <div class="log-card-row">
            <span class="log-card-label">?뚮┝ ?쒕ぉ</span>
            <span class="log-card-value text-bold">${escapeHtml(log.title || '-')}</span>
          </div>
          <div class="log-card-row block">
            <span class="log-card-label">?뚮┝ ?댁슜</span>
            <div class="log-card-text-content">${escapeHtml(log.text || log.raw_text || '-')}</div>
          </div>
        </div>
        ${footerHtml}
      `;

      const txBtn = card.querySelector('.btn-create-tx');
      if (txBtn) {
        txBtn.addEventListener('click', () => createTransactionFromLog(log));
      }
      const ruleBtn = card.querySelector('.btn-create-rule');
      if (ruleBtn) {
        ruleBtn.addEventListener('click', () => createRuleFromLog(log));
      }

      const retryBtn = card.querySelector('.btn-retry-log');
      if (retryBtn) {
        retryBtn.addEventListener('click', () => retryLogParsing(log.id));
      }
      if (log.sender) {
        const copyBtn = card.querySelector('.btn-copy-package');
        if (copyBtn) {
          copyBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            linkToPackageMapping(log.sender);
          });
        }
      }
      container.appendChild(card);
    });

    lucide.createIcons();

  } catch (err) {
    console.error('濡쒓렇 議고쉶 ?ㅽ뙣:', err);
  }
}

// 濡쒓렇 ?ㅽ뙣 ?ъ떆???ㅽ뻾 ?⑥닔
async function retryLogParsing(id) {
  try {
    const res = await fetch(`api/notification_logs/${id}/retry`, {
      method: 'POST'
    }).then(r => r.json());

    if (res.success) {
      alert('?깃났?곸쑝濡??뚯떛?섏뼱 媛怨꾨????깅줉?섏뿀?듬땲??');
      loadLogs();
      if (typeof loadDashboardData === 'function') {
        loadDashboardData();
      }
    } else {
      alert('?ъ떆???ㅽ뙣: ' + (res.error || '?????녿뒗 ?ㅻ쪟'));
    }
  } catch (err) {
    alert('?ъ떆??以??ㅻ쪟 諛쒖깮: ' + err.message);
  }
}

// 濡쒓렇?먯꽌 媛怨꾨? 吏곸젒 ?깅줉 ?앹뾽 ?꾩슦湲?
function createTransactionFromLog(log) {
  openAddTransactionModal();
  const rawTextEl = document.getElementById('tx-raw-text');
  const rawText = log.raw_text || log.text || '';
  if (rawTextEl) rawTextEl.value = rawText;
  
  const amountMatch = rawText.replace(/,/g, '').match(/\d{3,}/);
  const amountEl = document.getElementById('tx-amount');
  if (amountMatch && amountEl) {
    amountEl.value = amountMatch[0];
  }

  // ?뚮┝ ?섏떊 ?쒓컖??媛怨꾨? ?섎룞 ?깅줉 湲곕낯 ?쒓컖?쇰줈 ?명똿
  if (log.created_at) {
    let dateObj;
    if (log.created_at.includes('-') && log.created_at.includes(':')) {
      const cleanStr = log.created_at.replace(/-/g, '/') + ' UTC';
      dateObj = new Date(cleanStr);
    } else {
      dateObj = new Date(log.created_at);
    }
    
    if (!isNaN(dateObj.getTime())) {
      const offset = dateObj.getTimezoneOffset() * 60000;
      const localISOTime = (new Date(dateObj - offset)).toISOString().slice(0, 16);
      const datetimeEl = document.getElementById('tx-datetime');
      if (datetimeEl) {
        datetimeEl.value = localISOTime;
      }
    }
  }

  // 諛쒖떊泥??⑦궎吏紐?媛 ?덈뒗 寃쎌슦 ?⑦궎吏紐??낅젰 ?쒖꽦??諛?湲곕낯媛?泥댄겕
  if (log.sender) {
    const pkgRow = document.getElementById('tx-package-row');
    const pkgInput = document.getElementById('tx-package');
    const chkMap = document.getElementById('tx-map-package');
    if (pkgRow && pkgInput && chkMap) {
      pkgRow.style.display = 'flex';
      pkgInput.value = log.sender;
      chkMap.checked = true;
    }
  }
}

// 濡쒓렇?먯꽌 洹쒖튃 ?몄쭛 ?ㅽ뻾
function createRuleFromLog(log) {
  loadRuleToEditor(null);
  const testTextEl = document.getElementById('test-text');
  const rawText = log.raw_text || log.text || '';
  if (testTextEl) testTextEl.value = rawText;
  
  // 諛쒖떊???뺣낫媛 ?덈떎硫?洹쒖튃 ?대쫫?쇰줈 ?곗꽑 異붿쿇
  const ruleNameEl = document.getElementById('rule-name');
  if (ruleNameEl && log.sender) {
    ruleNameEl.value = `${log.sender} 洹쒖튃`;
  }
  
  // ?먮룞 ?⑦꽩 ?앹꽦 ?ㅽ뻾 (?ъ슜??洹李?쓬 諛⑹?瑜??꾪빐 ?뚮┝李??놁씠 臾댁쓬 ?ㅽ뻾)
  autoGeneratePattern(true);
}

/**
 * [?섏〈??寃쎄퀬] ???⑥닔??諛깆뿏?쒖쓽 ?먮룞 洹쒖튃 ?앹꽦 濡쒖쭅(parser.js??generatePatternFromText)怨?
 * ?숈씪???뺢퇋??異붿텧 ?뚭퀬由ъ쬁???ъ슜?섎?濡? ?섏젙 ?????뚯씪??諛섎뱶???④퍡 ?숆린?뷀빐???⑸땲??
 * 
 * 洹쒖튃 愿由??붾㈃?먯꽌 ?ъ슜?먭? ?낅젰???뚮┝ 蹂몃Ц??諛뷀깢?쇰줈 ?뺢퇋???⑦꽩???먮룞 ?꾩꽦 諛?異붿쿇?댁＜???⑥닔?낅땲??
 */
function autoGeneratePattern(silent = false) {
  const text = document.getElementById('test-text').value.trim();
  if (!text) {
    if (!silent) alert('?⑦꽩??異붿텧???뚮┝ 蹂몃Ц??癒쇱? ?낅젰??二쇱꽭??');
    return;
  }

  let cleanText = text.replace(/\[Web諛쒖떊\]\s*/i, '');
  const blocks = [];

  // ?덉쟾??寃뱀묠 寃???ы띁 (援ш컙????1湲?먮씪??寃뱀튂硫?true)
  const isOverlapping = (start, end) => {
    return blocks.some(b => Math.max(start, b.start) < Math.min(end, b.end));
  };

  // 1. 移대뱶紐???됰챸 媛먯?
  const cardMatch = cleanText.match(/\[(.*?)\]/) || cleanText.match(/(NH?랁삊|援??泥댄겕|?좏븳泥댄겕|?좏븳移대뱶|?쇱꽦移대뱶|?꾨?移대뱶|濡?뜲移대뱶|?곕━移대뱶|?섎굹移대뱶|移댁뭅?ㅻ콉???좎뒪諭낇겕|?좏븳???援??????곕━????섎굹????랁삊???IBK|湲곗뾽????곗껜援?/);
  if (cardMatch) {
    const value = cardMatch[1] || cardMatch[0];
    const isBracket = cardMatch[0].startsWith('[');
    // [?낃툑], [異쒓툑] 媛숈? 吏㏃? ?곹깭 臾멸뎄?닿굅???レ옄媛 ?ы븿??寃쎌슦留??ㅽ궢 (?낆텧湲덉븣由?媛숈? ?ㅻ뜑??臾멸뎄??移대뱶紐???됰챸 釉붾줉?쇰줈 ?몄젙)
    const isDepositOrWithdraw = isBracket && ((value.length <= 5 && /異쒓툑|?낃툑/.test(value)) || /\d/.test(value));
    
    if (!isDepositOrWithdraw) {
      const start = cardMatch.index;
      const end = cardMatch.index + cardMatch[0].length;
      if (!isOverlapping(start, end)) {
        blocks.push({
          type: '移대뱶紐???됰챸',
          start,
          end,
          regex: isBracket ? `\\[${escapeRegexChars(cardMatch[1])}\\]` : escapeRegexChars(cardMatch[0]),
          value: value
        });
      }
    }
  }

  // 2. ?쒓컙/?쇱떆 媛먯? (湲덉븸 媛먯?蹂대떎 癒쇱? 泥섎━?섏뿬 ?곕룄/?좎쭨媛 湲덉븸?쇰줈 ?ㅼ씤?섎뒗 寃껋쓣 諛⑹??⑸땲??
  const timeMatch = cleanText.match(/\d{4}[/\-.]\d{1,2}[/\-.]\d{1,2}\s+\d{2}:\d{2}(?::\d{2})?/) || 
                    cleanText.match(/\d{2}[/\-.]\d{1,2}[/\-.]\d{1,2}\s+\d{2}:\d{2}(?::\d{2})?/) || 
                    cleanText.match(/\d{1,2}??s*\d{1,2}??s*\d{2}:\d{2}(?::\d{2})?/) || 
                    cleanText.match(/\d{2}[/\-.]\d{2}\s+\d{2}:\d{2}(?::\d{2})?/) || 
                    cleanText.match(/\d{2}:\d{2}(?::\d{2})?/);
  if (timeMatch) {
    let regex = '(?<time>\\d{2}:\\d{2}(?::\\d{2})?)';
    const rawTime = timeMatch[0];
    const start = timeMatch.index;
    const end = timeMatch.index + rawTime.length;
    
    if (!isOverlapping(start, end)) {
      if (rawTime.includes('??) && rawTime.includes('??)) {
        regex = '(?<time>\\d{1,2}??\s*\\d{1,2}??\s*\\d{2}:\\d{2}(?::\\d{2})?)';
      } else if (rawTime.includes(':') && (rawTime.includes('/') || rawTime.includes('-') || rawTime.includes('.'))) {
        const sep = rawTime.match(/[/\-.]/)[0];
        const partCount = (rawTime.split(sep).length - 1);
        if (partCount === 2) {
          const yearLen = rawTime.split(sep)[0].length;
          regex = `(?<time>\\d{${yearLen}}${escapeRegexChars(sep)}\\d{1,2}${escapeRegexChars(sep)}\\d{1,2}\\s+\\d{2}:\\d{2}(?::\\d{2})?)`;
        } else {
          regex = `(?<time>\\d{2}${escapeRegexChars(sep)}\\d{2}\\s+\\d{2}:\\d{2}(?::\\d{2})?)`;
        }
      }
      blocks.push({
        type: '?쒓컙',
        start,
        end,
        regex,
        value: rawTime
      });
    }
  } else {
    const dateMatch = cleanText.match(/\d{2}[/\-.]\d{2}/) || cleanText.match(/\d{1,2}??s*\d{1,2}??);
    if (dateMatch) {
      const rawDate = dateMatch[0];
      const start = dateMatch.index;
      const end = dateMatch.index + rawDate.length;
      
      if (!isOverlapping(start, end)) {
        let regex = `(?<time>\\d{2}[/\\-.]\\d{2})`;
        if (rawDate.includes('??)) {
          regex = '(?<time>\\d{1,2}??\s*\\d{1,2}??';
        } else {
          const sep = rawDate.match(/[/\-.]/)[0];
          regex = `(?<time>\\d{2}${escapeRegexChars(sep)}\\d{2})`;
        }
        blocks.push({
          type: '?좎쭨',
          start,
          end,
          regex,
          value: rawDate
        });
      }
    }
  }

  // 3. 湲덉븸 媛먯? ("????遺숈뼱?덈뒗 湲덉븸 ?곗꽑 媛먯?)
  const amountWithWonRegex = /([\d,]+)\s*??g;
  let m;
  let amountDetected = false;
  while ((m = amountWithWonRegex.exec(cleanText)) !== null) {
    const idx = m.index;
    const len = m[0].length;
    if (!isOverlapping(idx, idx + len)) {
      blocks.push({
        type: '湲덉븸',
        start: idx,
        end: idx + len,
        regex: '(?<amount>[\\d,]+)??,
        value: m[0]
      });
      amountDetected = true;
      break;
    }
  }

  // 3-2. "??????遺숈? ?쒖닔 ?レ옄 湲덉븸 媛먯?
  if (!amountDetected) {
    const nakedAmountRegex = /(?<!\d|\*|-)([1-9]\d{0,2}(?:,\d{3})+|[1-9]\d{3,8})(?!\d|\*|-)/g;
    let nm;
    while ((nm = nakedAmountRegex.exec(cleanText)) !== null) {
      const idx = nm.index;
      const len = nm[0].length;
      if (!isOverlapping(idx, idx + len)) {
        const prefix = cleanText.substring(Math.max(0, idx - 10), idx);
        if (!/?붿븸|?붽퀬/.test(prefix)) {
          blocks.push({
            type: '湲덉븸',
            start: idx,
            end: idx + len,
            regex: '(?<amount>[\\d,]+)',
            value: nm[0]
          });
          amountDetected = true;
          break;
        }
      }
    }
  }

  // 4. ?붿븸 媛먯?
  const balanceMatch = cleanText.match(/(?:?붿븸|?붽퀬)\s*:?\s*([\d,]+)\s*??/);
  if (balanceMatch) {
    const start = balanceMatch.index;
    const end = balanceMatch.index + balanceMatch[0].length;
    if (!isOverlapping(start, end)) {
      const regex = balanceMatch[0].includes('??) 
                    ? '(?:?붿븸|?붽퀬)\\s*:?\\s*(?<balance>[\\d,]+)?? 
                    : '(?:?붿븸|?붽퀬)\\s*:?\\s*(?<balance>[\\d,]+)';
      blocks.push({
        type: '?붿븸',
        start,
        end,
        regex,
        value: balanceMatch[0]
      });
    }
  }

  // 5. ?꾩쟻湲덉븸 媛먯?
  const cumulativeMatch = cleanText.match(/?꾩쟻(?:.*?湲덉븸)?\s*:?\s*([\d,]+)\s*??/);
  if (cumulativeMatch) {
    const start = cumulativeMatch.index;
    const end = cumulativeMatch.index + cumulativeMatch[0].length;
    if (!isOverlapping(start, end)) {
      const regex = cumulativeMatch[0].includes('??) 
                    ? '?꾩쟻(?:.*?湲덉븸)?\\s*:?\\s*(?<cumulative>[\\d,]+)?? 
                    : '?꾩쟻(?:.*?湲덉븸)?\\s*:?\\s*(?<cumulative>[\\d,]+)';
      blocks.push({
        type: '?꾩쟻湲덉븸',
        start,
        end,
        regex,
        value: cumulativeMatch[0]
      });
    }
  }

  // 6. ?ъ씤??留덉씪由ъ? 媛먯? (used_point)
  const pointRegex = /(?:?ъ씤???먯닔|P|留덉씪由ъ?|?섑듃)\s*([\d,]+)\s*(?:????P)?/g;
  let pm;
  while ((pm = pointRegex.exec(cleanText)) !== null) {
    const idx = pm.index;
    const len = pm[0].length;
    if (!isOverlapping(idx, idx + len)) {
      blocks.push({
        type: '?ъ씤?몄감媛?,
        start: idx,
        end: idx + len,
        regex: '(?:?ъ씤??P)\\s*(?<used_point>[\\d,]+)\\s*(?:????P)?',
        value: pm[0]
      });
      break;
    }
  }

  // 7. ?곹깭 媛먯? (?뱀씤, ?ъ슜, 痍⑥냼, 異쒓툑, ?낃툑 ?? - ?ㅼ쨷 媛먯??섏뿬 以묐났?섏? ?딅뒗 紐⑤뱺 ?곹깭 ?섏쭛
  const statusRegex = /(?뱀씤|?ъ슜|痍⑥냼|異쒓툑|?낃툑|寃곗젣)/g;
  let sm;
  while ((sm = statusRegex.exec(cleanText)) !== null) {
    const idx = sm.index;
    const len = sm[0].length;
    if (!isOverlapping(idx, idx + len)) {
      blocks.push({
        type: '?곹깭',
        start: idx,
        end: idx + len,
        regex: escapeRegexChars(sm[0]),
        value: sm[0]
      });
    }
  }

  // 8. 寃곗젣諛⑹떇 媛먯?
  const payMethodMatch = cleanText.match(/(?:?좎슜|泥댄겕)(?:\(?쇱떆遺?[\d*]+\))?/) || cleanText.match(/(?:?좎슜|泥댄겕|?쇱떆遺?\d+媛쒖썡\s*?좊?)/);
  if (payMethodMatch) {
    const idx = payMethodMatch.index;
    const len = payMethodMatch[0].length;
    if (!isOverlapping(idx, idx + len)) {
      blocks.push({
        type: '寃곗젣諛⑹떇',
        start: idx,
        end: idx + len,
        regex: '(?<pay_method>[^\\s/]+)',
        value: payMethodMatch[0]
      });
    }
  }

  // 9. 怨꾩쥖踰덊샇 媛먯? (留덉뒪??臾몄옄 '*'媛 ?ы븿??怨꾩쥖踰덊샇 ?⑦꽩 理쒖슦??媛먯? 諛??ㅼ쨷 ?먯깋)
  const accountRegexes = [
    /\d{3,}\*+[-\d*]*/g,
    /[-\d*]*\*+[-\d*]*/g,
    /\d{3,}[-\d*]{2,}/g,
    /[\d*-]{5,}/g
  ];

  for (const acRegex of accountRegexes) {
    let am;
    while ((am = acRegex.exec(cleanText)) !== null) {
      const val = am[0];
      if (val.includes('/') || val.includes(':') || val.includes('??)) continue;
      // ?レ옄???섏씠?덉씠 ?꾪? ?녾퀬 ?ㅼ쭅 蹂꾪몴(*)留??덈뒗 臾몄옄?댁? 怨꾩쥖踰덊샇?먯꽌 ?쒖쇅 (?대쫫 留덉뒪???ㅼ씤 李⑤떒)
      if (!/[\d-]/.test(val)) continue;
      
      const start = am.index;
      const end = am.index + val.length;
      if (!isOverlapping(start, end)) {
        blocks.push({
          type: '怨꾩쥖踰덊샇',
          start,
          end,
          regex: '(?<account>[\\d*-]+)',
          value: val
        });
      }
    }
  }

  // 10. 怨좉컼紐??덇툑二쇰챸 留덉뒪??媛먯?
  const nameMatch = cleanText.match(/[媛-??\*[媛-??(?:??????/);
  if (nameMatch) {
    const start = nameMatch.index;
    const end = nameMatch.index + nameMatch[0].length;
    if (!isOverlapping(start, end)) {
      blocks.push({
        type: '怨좉컼紐?,
        start,
        end,
        regex: '[媛-??\\*[媛-??(?:??????',
        value: nameMatch[0]
      });
    }
  }

  // 媛먯???怨좎쑀 釉붾줉 ?뺣젹
  blocks.sort((a, b) => a.start - b.start);

  // 11. ?ъ슜泥?merchant) 媛먯? (釉붾줉???ъ씠??鍮?怨듦컙 以?媛???곸젏紐낅떎??臾몄옄??異붿텧)
  let bestGapIndex = -1;
  let maxCleanLen = -1;

  const gaps = [];
  gaps.push({ start: 0, end: blocks[0] ? blocks[0].start : cleanText.length, index: 0 });
  for (let i = 1; i < blocks.length; i++) {
    gaps.push({ start: blocks[i-1].end, end: blocks[i].start, index: i });
  }
  if (blocks.length > 0) {
    gaps.push({ start: blocks[blocks.length-1].end, end: cleanText.length, index: blocks.length });
  }

  gaps.forEach(g => {
    const txt = cleanText.substring(g.start, g.end);
    // ?붿븸, ?붽퀬, ?꾩쟻 ??媛留뱀젏紐낆씠 ?????녿뒗 吏?쒖뼱瑜??쒖쇅???대┛ ?띿뒪??異붿텧 (?낃툑/異쒓툑 ??釉뚮씪耳볤낵 吏?쒖슜???쒖쇅)
    const cleanTxt = txt.replace(/\[?(?낃툑|異쒓툑|?붿븸|?붽퀬|?꾩쟻|寃곗젣)\]?/g, '').trim();
    
    // ?쒓??대굹 ?곷Ц??理쒖냼 1湲???댁긽 ?ы븿?섏뼱 ?덉? ?딆? gap? ?쒖쇅 (?レ옄, ?뱀닔臾몄옄, 留덉뒪?밸쭔 ?덈뒗 寃쎌슦 諛⑹?)
    const cleanLetters = cleanTxt.replace(/[^媛-?즑-zA-Z]/g, '');
    if (cleanLetters.length === 0) return;

    if (cleanLetters.length > maxCleanLen) {
      maxCleanLen = cleanLetters.length;
      bestGapIndex = g.index;
    }
  });

  let merchantBlock = null;
  if (bestGapIndex !== -1 && maxCleanLen > 0) {
    const targetGap = gaps.find(g => g.index === bestGapIndex);
    const rawGap = cleanText.substring(targetGap.start, targetGap.end);
    
    const leadTrim = rawGap.match(/^[\s\-/\\:*]+/);
    const leadLen = leadTrim ? leadTrim[0].length : 0;
    const trailTrim = rawGap.match(/[\s\-/\\:*]+$/);
    const trailLen = trailTrim ? trailTrim[0].length : 0;
    const gapText = rawGap.substring(leadLen, rawGap.length - trailLen).trim();

    if (gapText.length > 0) {
      const mStart = targetGap.start + leadLen + (rawGap.substring(leadLen).length - rawGap.substring(leadLen).trimStart().length);
      const mEnd = mStart + gapText.length;
      const hasNums = /\d/.test(gapText);
      merchantBlock = {
        type: '?ъ슜泥?,
        start: mStart,
        end: mEnd,
        regex: hasNums ? '(?<merchant>.+?)(?:\\s+[\\d,]+)?' : '(?<merchant>.+?)',
        value: gapText
      };
    }
  }

  if (merchantBlock) {
    blocks.push(merchantBlock);
    blocks.sort((a, b) => a.start - b.start);
  } else {
    blocks.push({
      type: '?ъ슜泥?,
      start: cleanText.length,
      end: cleanText.length,
      regex: '(?<merchant>.+?)',
      value: ''
    });
  }

  // ?붾㈃ ?꾨뱶??異붿텧 ?쒖꽌 梨꾩슦湲?
  const inferredSequence = blocks.map(b => b.type).join(', ');
  const sequenceInput = document.getElementById('test-sequence');
  if (sequenceInput) {
    sequenceInput.value = inferredSequence;
  }

  // ?뺢퇋??議곕┰
  let suggested = '';
  if (text.includes('[Web諛쒖떊]')) {
    suggested += '(?:(?:\\[Web諛쒖떊\\])?\\s*)?';
  }

  // 媛??띿뒪?몄쓽 ?뺤쟻 臾몄옄(?뱀닔臾몄옄 ?ы븿)??蹂댁〈?섍퀬 怨듬갚? ?뺢퇋?앹쑝濡??좎뿰?뷀븯???ы띁 ?⑥닔
  function formatGapToRegex(gapText) {
    if (!gapText) return '';
    let result = '';
    let i = 0;
    while (i < gapText.length) {
      const char = gapText[i];
      if (/\s/.test(char)) {
        result += '\\s*';
        while (i < gapText.length && /\s/.test(gapText[i])) {
          i++;
        }
      } else {
        result += escapeRegexChars(char);
        i++;
      }
    }
    return result;
  }

  // 1. 泥?釉붾줉 ??媛?泥섎━
  if (blocks.length > 0 && blocks[0].start > 0) {
    const frontGap = cleanText.substring(0, blocks[0].start);
    suggested += formatGapToRegex(frontGap);
  }

  const usedTypes = new Set();

  // 2. 釉붾줉怨?釉붾줉 ?ъ씠 媛??뺣? 寃고빀
  for (let i = 0; i < blocks.length; i++) {
    let blockRegex = blocks[i].regex;
    if (blocks[i].type === '?ъ슜泥? && i === blocks.length - 1) {
      blockRegex = '(?<merchant>.+)(?:\\s+[\\d,]+)?';
    }
    
    if (blocks[i].type !== '?ъ슜泥?) {
      if (usedTypes.has(blocks[i].type)) {
        blockRegex = blockRegex.replace(/\(\?<[a-zA-Z0-9_]+>/g, '(?:');
      } else {
        usedTypes.add(blocks[i].type);
      }
    }
    
    suggested += blockRegex;
    if (i < blocks.length - 1) {
      const gapText = cleanText.substring(blocks[i].end, blocks[i+1].start);
      suggested += formatGapToRegex(gapText);
    }
  }

  // 3. 留덉?留?釉붾줉 ??媛?泥섎━
  if (blocks.length > 0 && blocks[blocks.length - 1].end < cleanText.length) {
    const backGap = cleanText.substring(blocks[blocks.length - 1].end);
    suggested += formatGapToRegex(backGap);
  }

  const patternInput = document.getElementById('test-pattern');
  const rulePatternInput = document.getElementById('rule-pattern');
  if (patternInput) patternInput.value = suggested;
  if (rulePatternInput) rulePatternInput.value = suggested;

  // 移대뱶/??됰챸???덉쑝硫?洹쒖튃 ?대쫫???먮룞 異붿쿇 (鍮꾩뼱?덈뒗 寃쎌슦?먮쭔 異붿쿇?섍굅?????곗꽑?쒖쐞 ?믪? ?뺣낫濡?媛깆떊)
  const cardBlock = blocks.find(b => b.type === '移대뱶紐???됰챸');
  const ruleNameEl = document.getElementById('rule-name');
  if (ruleNameEl) {
    if (cardBlock && cardBlock.value) {
      ruleNameEl.value = `${cardBlock.value} 洹쒖튃`;
    } else if (!ruleNameEl.value) {
      ruleNameEl.value = '?먮룞 ?앹꽦 洹쒖튃';
    }
  }

  // 洹쒖튃 ?앹꽦 移대뱶李쎌씠 ???대젮?덉쑝硫?媛뺤젣濡??쒖꽦??
  const formCard = document.getElementById('rule-form-card');
  if (formCard && formCard.style.display === 'none') {
    loadRuleToEditor(null);
    if (patternInput) rulePatternInput.value = patternInput.value;
  }

  // 蹂몃Ц ?띿뒪???댁슜??湲곕컲?쇰줈 嫄곕옒 ?좏삎(?섏엯/吏異? 媛먯? 諛??곌퀎 移댄뀒怨좊━ 媛깆떊
  let autoType = 'EXPENSE';
  if (text.includes('?낃툑') || text.includes('湲됱뿬') || text.includes('?섏엯')) {
    autoType = 'INCOME';
  } else if (text.includes('異쒓툑') || text.includes('?ъ슜') || text.includes('吏異?) || text.includes('寃곗젣')) {
    autoType = 'EXPENSE';
  }

  const ruleTypeSelect = document.getElementById('rule-type');
  if (ruleTypeSelect) {
    ruleTypeSelect.value = autoType;
    // 移댄뀒怨좊━ ??됲듃 媛깆떊
    if (typeof updateCategorySelect === 'function') {
      updateCategorySelect('#rule-category', autoType, '');
    }
  }

  if (!silent) {
    alert('?뚮┝ ?띿뒪?몄쓽 媛??붿냼瑜??꾩튂 湲곕컲?쇰줈 ?뺣? ?먮룞 遺꾩꽍?섏뿬 ?뺢퇋???⑦꽩???앹꽦?덉뒿?덈떎! 諛붾줈 [?뚯뒪???ㅽ뻾]??吏꾪뻾??蹂댁꽭??');
  }
}

async function aiGeneratePattern() {
  const text = document.getElementById('test-text').value.trim();
  if (!text) {
    alert('AI ?⑦꽩 ?앹꽦??吏꾪뻾???뚮┝ 蹂몃Ц??癒쇱? ?낅젰??二쇱꽭??');
    return;
  }

  const aiGenBtn = document.getElementById('btn-ai-generate-pattern');
  const originalHtml = aiGenBtn.innerHTML;

  try {
    aiGenBtn.disabled = true;
    aiGenBtn.innerHTML = '<i data-lucide="loader" class="animate-spin" style="width:14px;height:14px;"></i> ?앹꽦 以?..';
    lucide.createIcons();

    const res = await fetch('api/rules/ai-generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    }).then(r => r.json());

    if (res.success && res.pattern) {
      const patternInput = document.getElementById('test-pattern');
      const rulePatternInput = document.getElementById('rule-pattern');
      if (patternInput) patternInput.value = res.pattern;
      if (rulePatternInput) rulePatternInput.value = res.pattern;

      // 洹쒖튃 ?대쫫 ?먮룞 異붿쿇
      const ruleNameEl = document.getElementById('rule-name');
      if (ruleNameEl && !ruleNameEl.value) {
        ruleNameEl.value = 'AI ?앹꽦 洹쒖튃';
      }

      // 洹쒖튃 ?앹꽦 移대뱶李쎌씠 ???대젮?덉쑝硫?媛뺤젣濡??쒖꽦??
      const formCard = document.getElementById('rule-form-card');
      if (formCard && formCard.style.display === 'none') {
        loadRuleToEditor(null);
        if (patternInput) rulePatternInput.value = patternInput.value;
      }

      alert('AI媛 ?뚮┝ ?댁슜???꾨꼍???뚯떛?????덈뒗 ?뺢퇋???⑦꽩???앹꽦?덉뒿?덈떎! 諛붾줈 [?뚯뒪???ㅽ뻾]???대┃???뺤긽 ?묐룞?섎뒗吏 寃利앺빐 蹂댁꽭??');
    } else {
      alert('AI ?⑦꽩 ?앹꽦 ?ㅽ뙣: ' + (res.error || '?????녿뒗 ?ㅻ쪟'));
    }
  } catch (err) {
    alert('AI ?⑦꽩 ?앹꽦 以??ㅻ쪟 諛쒖깮: ' + err.message);
  } finally {
    aiGenBtn.disabled = false;
    aiGenBtn.innerHTML = originalHtml;
    lucide.createIcons();
  }
}

function escapeRegexChars(str) {
  return str.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
}

// ?뚮┝ 濡쒓렇??諛쒖떊泥??⑦궎吏瑜??ㅼ젙???⑦궎吏-寃곗젣?섎떒 留ㅽ븨 ?쇱쑝濡??꾨떖 諛??대룞
function linkToPackageMapping(senderPackage) {
  openPackageMappingModal(senderPackage);
}

// ?먮룞 ?⑥뒪 洹쒖튃 紐⑸줉 濡쒕뱶
async function loadPassRules() {
  try {
    const rules = await fetch('api/pass_rules').then(r => r.json());
    
    const container = document.getElementById('pass-rules-list-container');
    if (!container) return;
    container.innerHTML = '';

    if (rules.length === 0) {
      container.innerHTML = '<p class="empty-message">?깅줉???먮룞 ?⑥뒪 洹쒖튃???놁뒿?덈떎.</p>';
      return;
    }

    rules.forEach(rule => {
      const div = document.createElement('div');
      div.className = 'rule-item';
      div.innerHTML = `
        <div class="rule-info">
          <div class="rule-title" style="display:flex; align-items:center; gap:0.5rem;">
            <span>${rule.name}</span>
            <span class="badge-status info" style="padding: 0.1rem 0.4rem; font-size: 0.7rem; background: rgba(59,130,246,0.15); color: #60a5fa; border: 1px solid rgba(59,130,246,0.3);">PASS</span>
          </div>
          <div class="rule-pattern-text">${escapeHtml(rule.pattern)}</div>
        </div>
        <div class="rule-actions">
          <button class="icon-btn btn-edit-pass-rule">
            <i data-lucide="edit-2" style="width:16px;height:16px;"></i>
          </button>
          <button class="icon-btn btn-delete-pass-rule" style="color:var(--danger-color)">
            <i data-lucide="trash" style="width:16px;height:16px;"></i>
          </button>
        </div>
      `;
      div.querySelector('.btn-edit-pass-rule').addEventListener('click', () => loadPassRuleToEditor(rule));
      div.querySelector('.btn-delete-pass-rule').addEventListener('click', () => deletePassRule(rule.id));
      container.appendChild(div);
    });

    lucide.createIcons();

  } catch (err) {
    console.error('?⑥뒪 洹쒖튃 濡쒕뱶 ?ㅽ뙣:', err);
  }
}

// ?먮룞 ?⑥뒪 洹쒖튃 ?몄쭛湲?濡쒕뱶 諛?紐⑤떖 ?몄텧
function loadPassRuleToEditor(rule) {
  const formCard = document.getElementById('pass-rule-form-card');
  if (!formCard) return;
  formCard.style.display = 'block';
  document.getElementById('pass-rule-form-title').textContent = rule ? '?먮룞 ?⑥뒪洹쒖튃 ?몄쭛' : '???⑥뒪洹쒖튃 異붽?';

  document.getElementById('pass-rule-id').value = rule ? rule.id : '';
  document.getElementById('pass-rule-name').value = rule ? rule.name : '';
  document.getElementById('pass-rule-pattern').value = rule ? rule.pattern : '';

  // ?ㅼ떆媛??뚯뒪???⑦꽩 ?먮룞 梨꾩슦湲?
  document.getElementById('test-pass-pattern').value = rule ? rule.pattern : '';
  document.getElementById('test-pass-result-container').style.display = 'none';

  // 紐⑤떖 ?쒖꽦??
  const modal = document.getElementById('pass-rule-modal');
  if (modal) {
    modal.classList.add('active');
  }
}

// ?먮룞 ?⑥뒪 洹쒖튃 ??젣
async function deletePassRule(id) {
  if (!confirm('?뺣쭚濡????⑥뒪 洹쒖튃????젣?섏떆寃좎뒿?덇퉴?')) return;
  try {
    const res = await fetch(`api/pass_rules/${id}`, { method: 'DELETE' }).then(r => r.json());
    if (res.success) {
      loadPassRules();
      document.getElementById('pass-rule-form-card').style.display = 'none';
      const modal = document.getElementById('pass-rule-modal');
      if (modal) modal.classList.remove('active');
    }
  } catch (err) {
    alert('?⑥뒪 洹쒖튃 ??젣 ?ㅽ뙣: ' + err.message);
  }
}

// ?ㅼ떆媛??⑥뒪 洹쒖튃 ?뺢퇋???뚯뒪???ㅽ뻾
function runPassRegexTest() {
  const text = document.getElementById('test-pass-text').value;
  const pattern = document.getElementById('test-pass-pattern').value;

  if (!text || !pattern) {
    alert('?뚯뒪?명븷 ?뚮┝ ?댁슜怨??뺢퇋???⑦꽩???낅젰??二쇱꽭??');
    return;
  }

  const container = document.getElementById('test-pass-result-container');
  container.style.display = 'block';

  try {
    const regex = new RegExp(pattern);
    const isMatched = regex.test(text);

    if (isMatched) {
      container.style.background = 'rgba(16, 185, 129, 0.15)';
      container.style.border = '1px solid rgba(16, 185, 129, 0.3)';
      container.innerHTML = `
        <h4 style="color:#10b981; margin-bottom:0.5rem; font-weight:600;">PASS 留ㅼ묶 ?깃났</h4>
        <p class="text-sm" style="color:var(--text-primary); line-height:1.4; margin-bottom:0;">
          ?뚮┝ ?댁슜???⑥뒪 洹쒖튃怨??쇱튂?⑸땲?? ???뚮┝???섏떊?섎㈃ 媛怨꾨????깅줉?섏? ?딄퀬 利됱떆 <strong>PASS</strong> ?곹깭濡?湲곕줉 諛??쒖쇅?⑸땲??
        </p>
      `;
    } else {
      container.style.background = 'rgba(244, 63, 94, 0.15)';
      container.style.border = '1px solid rgba(244, 63, 94, 0.3)';
      container.innerHTML = `
        <h4 style="color:#f43f5e; margin-bottom:0.5rem; font-weight:600;">PASS 留ㅼ묶 ?ㅽ뙣</h4>
        <p class="text-sm" style="color:var(--text-primary); line-height:1.4; margin-bottom:0;">
          ?뚮┝ ?댁슜???⑥뒪 洹쒖튃怨??쇱튂?섏? ?딆뒿?덈떎. ?쇰컲?곸씤 ?뚮┝ 遺꾨쪟 ?뺢퇋??洹쒖튃???먯깋?섏뿬 ?깅줉???쒕룄?섍쾶 ?⑸땲??
        </p>
      `;
    }
  } catch (err) {
    container.style.background = 'rgba(244, 63, 94, 0.15)';
    container.style.border = '1px solid rgba(244, 63, 94, 0.3)';
    container.innerHTML = `
      <h4 style="color:#f43f5e; margin-bottom:0.5rem; font-weight:600;">?뺢퇋??臾몃쾿 ?ㅻ쪟</h4>
      <p class="text-sm" style="color:var(--text-primary); line-height:1.4; margin-bottom:0;">
        ${escapeHtml(err.message)}
      </p>
    `;
  }
}

