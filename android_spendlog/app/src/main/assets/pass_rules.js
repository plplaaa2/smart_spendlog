// ==========================================
// 3-1. 자동 패스 규칙 관리 로직 (pass_rules.js)
// ==========================================

// 자동 패스 규칙 목록 로드
async function loadPassRules() {
  try {
    const rules = await fetch('api/pass_rules').then(r => r.json());
    
    const container = document.getElementById('pass-rules-list-container');
    if (!container) return;
    container.innerHTML = '';

    if (rules.length === 0) {
      container.innerHTML = '<p class="empty-message">등록된 자동 패스 규칙이 없습니다.</p>';
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
    console.error('패스 규칙 로드 실패:', err);
  }
}

// 자동 패스 규칙 편집기 로드 및 모달 노출
function loadPassRuleToEditor(rule) {
  const formCard = document.getElementById('pass-rule-form-card');
  if (!formCard) return;
  formCard.style.display = 'block';
  document.getElementById('pass-rule-form-title').textContent = rule ? '자동 패스규칙 편집' : '새 패스규칙 추가';

  document.getElementById('pass-rule-id').value = rule ? rule.id : '';
  document.getElementById('pass-rule-name').value = rule ? rule.name : '';
  document.getElementById('pass-rule-pattern').value = rule ? rule.pattern : '';

  // 실시간 테스터 패턴 자동 채우기
  document.getElementById('test-pass-pattern').value = rule ? rule.pattern : '';
  document.getElementById('test-pass-result-container').style.display = 'none';

  // 모달 활성화
  const modal = document.getElementById('pass-rule-modal');
  if (modal) {
    modal.classList.add('active');
  }
}

// 자동 패스 규칙 삭제
async function deletePassRule(id) {
  if (!confirm('정말로 이 패스 규칙을 삭제하시겠습니까?')) return;
  try {
    const res = await fetch(`api/pass_rules/${id}`, { method: 'DELETE' }).then(r => r.json());
    if (res.success) {
      loadPassRules();
      document.getElementById('pass-rule-form-card').style.display = 'none';
      const modal = document.getElementById('pass-rule-modal');
      if (modal) modal.classList.remove('active');
    }
  } catch (err) {
    alert('패스 규칙 삭제 실패: ' + err.message);
  }
}

// 실시간 패스 규칙 정규식 테스트 실행
function runPassRegexTest() {
  const text = document.getElementById('test-pass-text').value;
  const pattern = document.getElementById('test-pass-pattern').value;

  if (!text || !pattern) {
    alert('테스트할 알림 내용과 정규식 패턴을 입력해 주세요.');
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
        <h4 style="color:#10b981; margin-bottom:0.5rem; font-weight:600;">PASS 매칭 성공</h4>
        <p class="text-sm" style="color:var(--text-primary); line-height:1.4; margin-bottom:0;">
          알림 내용이 패스 규칙과 일치합니다. 이 알림이 수신되면 가계부에 등록되지 않고 즉시 <strong>PASS</strong> 상태로 기록 및 제외됩니다.
        </p>
      `;
    } else {
      container.style.background = 'rgba(244, 63, 94, 0.15)';
      container.style.border = '1px solid rgba(244, 63, 94, 0.3)';
      container.innerHTML = `
        <h4 style="color:#f43f5e; margin-bottom:0.5rem; font-weight:600;">PASS 매칭 실패</h4>
        <p class="text-sm" style="color:var(--text-primary); line-height:1.4; margin-bottom:0;">
          알림 내용이 패스 규칙과 일치하지 않습니다. 일반적인 알림 분류 정규식 규칙을 탐색하여 등록을 시도하게 됩니다.
        </p>
      `;
    }
  } catch (err) {
    container.style.background = 'rgba(244, 63, 94, 0.15)';
    container.style.border = '1px solid rgba(244, 63, 94, 0.3)';
    container.innerHTML = `
      <h4 style="color:#f43f5e; margin-bottom:0.5rem; font-weight:600;">정규식 문법 오류</h4>
      <p class="text-sm" style="color:var(--text-primary); line-height:1.4; margin-bottom:0;">
        ${escapeHtml(err.message)}
      </p>
    `;
  }
}
