/* ══════════════════════════════════════════════════════════════
   관리자 — 업무지원 텔레그램 봇 연동
   1) 회원 목록의 '텔레그램 ID' 칸: 승인된 계정에 ID를 연결하면 봇 사용 가능
   2) '봇 미해결 질문' 탭: 봇이 자료가 없어 답하지 못한 질문 → KB 보강 후 처리 완료
   DB 함수는 schema_bot.sql 참고. admin.html 의 sb / escapeHtml 을 쓴다.
   ══════════════════════════════════════════════════════════════ */

/* ── 1. 텔레그램 ID ── */
function buildTelegramCell(a) {
  const wrap = document.createElement('div');
  wrap.className = 'account-tg';
  const input = document.createElement('input');
  input.type = 'text';
  input.inputMode = 'numeric';
  input.className = 'tg-input';
  input.placeholder = '미연결';
  input.value = a.telegram_id ? String(a.telegram_id) : '';
  input.setAttribute('aria-label', a.name + ' 텔레그램 ID');
  const btn = document.createElement('button');
  btn.className = 'account-btn';
  btn.textContent = '저장';
  btn.disabled = true;
  const original = input.value;
  input.oninput = () => { btn.disabled = input.value.trim() === original; };
  input.onkeydown = e => { if (e.key === 'Enter' && !btn.disabled) btn.click(); };
  btn.onclick = () => saveTelegramId(a, input.value.trim(), btn);
  wrap.appendChild(input); wrap.appendChild(btn);
  if (a.telegram_id && a.status !== 'approved') {
    wrap.title = '승인된 계정만 봇을 사용할 수 있습니다';
    wrap.classList.add('inactive');
  }
  return wrap;
}

async function saveTelegramId(a, value, btn) {
  if (value && !/^\d{5,15}$/.test(value)) {
    alert('텔레그램 ID는 숫자만 입력해주세요.\n(봇에 말을 걸면 "내 텔레그램 ID: …" 로 알려줍니다)');
    return;
  }
  btn.disabled = true; btn.textContent = '저장 중';
  // bigint 를 숫자로 보내면 JS 정밀도 문제 없이 들어간다 (텔레그램 ID 는 2^53 미만)
  const { error } = await sb.rpc('admin_set_telegram_id', { account_id: a.id, tg_id: value ? Number(value) : null });
  btn.textContent = '저장';
  if (error) {
    const m = error.message || '';
    if (/already used/i.test(m)) alert('이미 다른 계정에 연결된 텔레그램 ID입니다.');
    else if (/unauthorized/i.test(m)) alert('관리자 권한이 없습니다. 다시 로그인해주세요.');
    else alert('저장 실패: ' + (m || JSON.stringify(error)));
    btn.disabled = false;
    return;
  }
  const { data } = await sb.rpc('admin_list_accounts');
  allAccounts = data || allAccounts;
  renderAccounts();
}

/* ── 2. 봇 미해결 질문 ── */
const ROUTE_LABEL = {
  no_coverage: '자료 없음',
  no_result: '자료 없음',
  clarify_nohit: '되물음',
  llm_general: '일반 상식 답변',
};
let unanswered = [];
let unansweredLoaded = false;
let unansweredDays = 30;
let unansweredShowResolved = false;

async function loadUnanswered() {
  setUnansweredLoading('불러오는 중...');
  const { data, error } = await sb.rpc('admin_list_unanswered', {
    days: unansweredDays, include_resolved: unansweredShowResolved,
  });
  if (error) {
    const m = error.message || '';
    setUnansweredLoading(/Could not find the function|PGRST202/i.test(m)
      ? 'admin_list_unanswered 함수가 없습니다. schema_bot.sql 을 먼저 실행해주세요.'
      : '불러오기 실패: ' + m);
    return;
  }
  unanswered = data || [];
  unansweredLoaded = true;
  renderUnanswered();
}

function setUnansweredDays(d) {
  unansweredDays = d;
  document.querySelectorAll('[data-udays]').forEach(b => b.classList.toggle('active', Number(b.dataset.udays) === d));
  loadUnanswered();
}

function toggleUnansweredResolved(on) {
  unansweredShowResolved = on;
  loadUnanswered();
}

function renderUnanswered() {
  const open = unanswered.filter(r => !r.resolved_at).length;
  document.getElementById('unanswered-count').textContent =
    '미처리 ' + open + '건' + (unansweredShowResolved ? ' · 처리 완료 ' + (unanswered.length - open) + '건' : '');
  const c = document.getElementById('unanswered-list-container');
  c.textContent = '';
  if (!unanswered.length) {
    c.innerHTML = '<div class="empty"><div class="empty-icon"><svg><use href="#i-inbox"></use></svg></div>' +
      '<div class="empty-text">최근 ' + unansweredDays + '일간 자료가 없어 답하지 못한 질문이 없습니다.</div></div>';
    return;
  }
  const list = document.createElement('div');
  list.className = 'uq-list';
  unanswered.forEach(r => list.appendChild(buildUnansweredRow(r)));
  c.appendChild(list);
}

function buildUnansweredRow(r) {
  const row = document.createElement('div');
  row.className = 'uq-row' + (r.resolved_at ? ' resolved' : '');

  const main = document.createElement('div');
  main.className = 'uq-main';
  const q = document.createElement('div');
  q.className = 'uq-query';
  q.textContent = r.query;
  const meta = document.createElement('div');
  meta.className = 'uq-meta';
  const last = new Date(r.last_asked).toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const kinds = [...new Set((r.routes || '').split(',').map(x => ROUTE_LABEL[x] || x))].join(' · ');
  const BOT_LABEL = { main: '운영 봇', personal: '개인 봇' };
  const bots = (r.bots || '').split(',').filter(Boolean).map(b => BOT_LABEL[b] || b).join('·');
  meta.textContent = kinds + ' · ' + r.ask_count + '회 · 마지막 ' + last +
    (bots ? ' · ' + bots : '') + (r.askers ? ' · ' + r.askers : '');
  main.appendChild(q); main.appendChild(meta);
  if (r.resolved_at) {
    const done = document.createElement('div');
    done.className = 'uq-done';
    done.textContent = '처리 완료 ' + new Date(r.resolved_at).toLocaleDateString('ko-KR') + (r.resolved_note ? ' — ' + r.resolved_note : '');
    main.appendChild(done);
  }

  const act = document.createElement('div');
  act.className = 'uq-actions';
  if (!r.resolved_at) {
    const btn = document.createElement('button');
    btn.className = 'account-btn approve';
    btn.textContent = '처리 완료';
    btn.onclick = () => resolveUnanswered(r, btn);
    act.appendChild(btn);
  }
  row.appendChild(main); row.appendChild(act);
  return row;
}

async function resolveUnanswered(r, btn) {
  const note = prompt('어디에 반영했는지 메모 (선택)\n예) FAQ 추가, 매뉴얼 수정, 답변 불필요', '');
  if (note === null) return;  // 취소
  btn.disabled = true; btn.textContent = '처리 중';
  const { error } = await sb.rpc('admin_resolve_query', { q: r.query, note });
  if (error) { alert('처리 실패: ' + (error.message || JSON.stringify(error))); btn.disabled = false; btn.textContent = '처리 완료'; return; }
  loadUnanswered();
}

function setUnansweredLoading(msg) {
  const el = document.createElement('div'); el.className = 'loading'; el.textContent = msg;
  const c = document.getElementById('unanswered-list-container'); c.textContent = ''; c.appendChild(el);
}
