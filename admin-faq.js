/* ══════════════════════════════════════════════════════════════
   관리자 — 등록한 답변 (FAQ)
   '봇 미해결 질문' 의 「답변 등록」 또는 이 탭의 「새 답변 추가」로 넣는다.
   저장하면 모바일 FAQ 화면에 바로 보이고, 봇은 다음 날 05:00 KB 재빌드 때 반영된다.
   지우지 않고 숨김으로 내리며, 고칠 때마다 이전 내용이 이력으로 남는다.
   DB 함수는 schema_faq.sql 참고. admin.html 의 sb 와 admin-bot.js 의 loadUnanswered·buildPager 를 쓴다.
   ══════════════════════════════════════════════════════════════ */

// 모바일 FAQ(faq.json) 의 카테고리 — 새 카테고리를 만들면 FAQ 화면에 탭이 하나 늘어난다
const FAQ_CATEGORIES = ['개통', '요금제/부가서비스', '유심', '결합', '기타'];

let faqAnswers = [];
let faqLoaded = false;
let faqFilter = 'visible';   // visible | hidden | all
let faqSearch = '';
let faqPage = 1;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function faqDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

/* ── 목록 ── */
async function loadFaqAnswers() {
  setFaqLoading('불러오는 중...');
  const { data, error } = await sb.rpc('admin_list_faq_answers');
  if (error) {
    const m = error.message || '';
    setFaqLoading(/Could not find the function|PGRST202/i.test(m)
      ? 'admin_list_faq_answers 함수가 없습니다. schema_faq.sql 을 먼저 실행해주세요.'
      : '불러오기 실패: ' + m);
    return;
  }
  faqAnswers = data || [];
  faqLoaded = true;
  renderFaqAnswers();
}

function setFaqFilter(f) {
  faqFilter = f;
  faqPage = 1;
  document.querySelectorAll('[data-ffilter]').forEach(b => b.classList.toggle('active', b.dataset.ffilter === f));
  renderFaqAnswers();
}

function setFaqSearch(v) {
  faqSearch = v.trim().toLowerCase().replace(/\s+/g, '');
  faqPage = 1;
  renderFaqAnswers();
}

function renderFaqAnswers() {
  const shown = faqAnswers.filter(r => !r.hidden).length;
  document.getElementById('faq-count').textContent =
    'FAQ에 보이는 답변 ' + shown + '건' + (faqAnswers.length > shown ? ' · 숨김 ' + (faqAnswers.length - shown) + '건' : '');

  const norm = s => String(s || '').toLowerCase().replace(/\s+/g, '');
  const rows = faqAnswers.filter(r =>
    (faqFilter === 'all' || (faqFilter === 'hidden') === !!r.hidden) &&
    (!faqSearch || [r.q, r.a, r.category, r.source_query].some(x => norm(x).includes(faqSearch))));

  const c = document.getElementById('faq-list-container');
  c.textContent = '';
  if (!rows.length) {
    const empty = el('div', 'empty');
    empty.appendChild(el('div', 'empty-text', faqAnswers.length
      ? '조건에 맞는 답변이 없습니다.'
      : '아직 등록한 답변이 없습니다. 봇 미해결 질문에서 「답변 등록」을 누르거나 「새 답변 추가」로 넣어주세요.'));
    c.appendChild(empty);
    return;
  }
  faqPage = clampPage(faqPage, rows.length);
  const from = (faqPage - 1) * PAGE_SIZE;
  const list = el('div', 'uq-list');
  rows.slice(from, from + PAGE_SIZE).forEach(r => list.appendChild(buildFaqRow(r)));
  c.appendChild(list);
  const pager = buildPager(rows.length, faqPage, p => {
    faqPage = p; renderFaqAnswers(); scrollListTop('faq-list-container');
  });
  if (pager) c.appendChild(pager);
}

function buildFaqRow(r) {
  const row = el('div', 'uq-row fa-row' + (r.hidden ? ' resolved' : ''));
  const main = el('div', 'uq-main');

  const head = el('div', 'fa-head');
  head.appendChild(el('span', 'fa-cat', r.category));
  if (r.hidden) head.appendChild(el('span', 'fa-hidden', '숨김'));
  head.appendChild(el('span', 'uq-query', r.q));
  main.appendChild(head);

  const ans = el('div', 'fa-answer', r.a);
  ans.title = '눌러서 전체 보기';
  ans.onclick = () => ans.classList.toggle('open');
  main.appendChild(ans);

  const meta = [];
  meta.push('등록 ' + faqDate(r.created_at) + (r.created_by_name ? ' ' + r.created_by_name : ''));
  if (r.history_count > 0) meta.push('마지막 수정 ' + faqDate(r.updated_at) + (r.updated_by_name ? ' ' + r.updated_by_name : ''));
  if (r.source_query) meta.push('직원 질문: ' + r.source_query);
  main.appendChild(el('div', 'uq-meta', meta.join(' · ')));

  const act = el('div', 'uq-actions fa-actions');
  const edit = el('button', 'account-btn', '수정');
  edit.onclick = () => openFaqEditor(r);
  const hide = el('button', 'account-btn' + (r.hidden ? ' approve' : ' reject'), r.hidden ? '다시 보이기' : '숨김');
  hide.onclick = () => setFaqHidden(r, !r.hidden, hide);
  act.append(edit, hide);
  if (r.history_count > 0) {
    const hist = el('button', 'account-btn', '이력 ' + r.history_count);
    hist.onclick = () => openFaqHistory(r);
    act.appendChild(hist);
  }

  row.append(main, act);
  return row;
}

async function setFaqHidden(r, hidden, btn) {
  if (hidden && !confirm('이 답변을 숨길까요?\nFAQ 화면에서 바로 빠지고, 봇은 다음 날 아침부터 이 답을 쓰지 않습니다.\n(기록은 남고 다시 보이게 할 수 있습니다)')) return;
  btn.disabled = true;
  const { error } = await sb.rpc('admin_set_faq_answer_hidden', { answer_id: r.id, p_hidden: hidden });
  if (error) { alert('처리 실패: ' + (error.message || '')); btn.disabled = false; return; }
  loadFaqAnswers();
}

function setFaqLoading(msg) {
  const c = document.getElementById('faq-list-container');
  c.textContent = '';
  c.appendChild(el('div', 'loading', msg));
}

/* ── 등록·수정 창 ──
   r: 기존 답변이면 {id, category, q, a, source_query}, 새로 쓰면 {q?, source_query?} */
function faqModal() {
  let ov = document.getElementById('faqOverlay');
  if (ov) return ov;
  ov = el('div', 'pw-overlay');
  ov.id = 'faqOverlay';
  ov.innerHTML =
    '<div class="pw-modal fa-modal" role="dialog" aria-modal="true" aria-labelledby="faqTitle">' +
      '<h3 id="faqTitle"></h3>' +
      '<div class="pw-target" id="faqSource"></div>' +
      '<div id="faqBody"></div>' +
      '<div class="pw-msg error" id="faqMsg"></div>' +
      '<div class="pw-actions" id="faqActions"></div>' +
    '</div>';
  ov.addEventListener('click', e => { if (e.target === ov) closeFaqModal(); });
  document.body.appendChild(ov);
  return ov;
}

function closeFaqModal() {
  const ov = document.getElementById('faqOverlay');
  if (ov) ov.classList.remove('open');
}

function openFaqEditor(r) {
  const ov = faqModal();
  const isNew = !r.id;
  document.getElementById('faqTitle').textContent = isNew ? '답변 등록' : '답변 수정';
  const src = document.getElementById('faqSource');
  src.textContent = r.source_query ? '직원 질문: ' + r.source_query : '';
  src.style.display = r.source_query ? '' : 'none';
  document.getElementById('faqMsg').textContent = '';

  const body = document.getElementById('faqBody');
  body.textContent = '';

  body.appendChild(el('label', 'pw-label', '카테고리'));
  const cat = el('select', 'fa-input');
  const ph = el('option', null, '카테고리 선택');
  ph.value = ''; ph.disabled = true;
  cat.appendChild(ph);
  const cats = [...new Set([...FAQ_CATEGORIES, ...faqAnswers.map(x => x.category)])];
  if (r.category && !cats.includes(r.category)) cats.push(r.category);
  cats.forEach(c => { const o = el('option', null, c); o.value = c; cat.appendChild(o); });
  cat.value = r.category || '';
  body.appendChild(cat);

  body.appendChild(el('label', 'pw-label', 'FAQ 질문 (FAQ 화면에 보이는 제목)'));
  const q = el('input', 'fa-input');
  q.type = 'text'; q.maxLength = 200;
  q.value = r.q || '';
  q.placeholder = '예) 명의변경 필요 서류';
  body.appendChild(q);

  body.appendChild(el('label', 'pw-label', '답변'));
  const a = el('textarea', 'fa-input fa-textarea');
  a.maxLength = 4000; a.rows = 9;
  a.value = r.a || '';
  a.placeholder = '줄바꿈은 그대로 FAQ 화면에 보입니다.';
  body.appendChild(a);

  body.appendChild(el('div', 'pw-note',
    '저장하면 모바일 FAQ 화면에 바로 보이고, 텔레그램 봇은 다음 날 아침부터 이 내용으로 답합니다.' +
    (r.source_query ? '\n이 미해결 질문은 처리 완료(메모: FAQ 등록)로 바뀝니다.' : '')));

  const actions = document.getElementById('faqActions');
  actions.textContent = '';
  const cancel = el('button', 'pw-cancel', '취소');
  cancel.onclick = closeFaqModal;
  const save = el('button', 'pw-confirm', '저장');
  save.onclick = () => saveFaqAnswer(r, { category: cat.value, q: q.value, a: a.value }, save);
  actions.append(cancel, save);

  ov.classList.add('open');
  (r.q ? a : q).focus();
}

async function saveFaqAnswer(r, v, btn) {
  const msg = document.getElementById('faqMsg');
  if (!v.category) { msg.textContent = '카테고리를 골라주세요.'; return; }
  if (!v.q.trim()) { msg.textContent = 'FAQ 질문을 입력해주세요.'; return; }
  if (!v.a.trim()) { msg.textContent = '답변을 입력해주세요.'; return; }
  btn.disabled = true; btn.textContent = '저장 중...';
  const { error } = await sb.rpc('admin_save_faq_answer', {
    answer_id: r.id || null, p_category: v.category, p_q: v.q, p_a: v.a,
    p_source_query: r.id ? null : (r.source_query || null),
  });
  btn.disabled = false; btn.textContent = '저장';
  if (error) {
    const m = error.message || '';
    msg.textContent = /Could not find the function|PGRST202/i.test(m) ? 'schema_faq.sql 을 먼저 실행해주세요.'
      : /too long/.test(m) ? '내용이 너무 깁니다. (질문 200자, 답변 4000자까지)'
      : '저장 실패: ' + m;
    return;
  }
  closeFaqModal();
  if (faqLoaded || document.getElementById('tab-faq').classList.contains('active')) loadFaqAnswers();
  if (r.source_query && typeof loadUnanswered === 'function') loadUnanswered();
}

/* ── 수정 이력 ── 이전 내용을 보고, 원하면 그 내용으로 되돌린다 (되돌리기도 이력에 남는다) */
async function openFaqHistory(r) {
  const ov = faqModal();
  document.getElementById('faqTitle').textContent = '수정 이력';
  const src = document.getElementById('faqSource');
  src.textContent = '지금: ' + r.q; src.style.display = '';
  document.getElementById('faqMsg').textContent = '';
  const body = document.getElementById('faqBody');
  body.textContent = '';
  body.appendChild(el('div', 'loading', '불러오는 중...'));
  const actions = document.getElementById('faqActions');
  actions.textContent = '';
  const close = el('button', 'pw-cancel', '닫기');
  close.onclick = closeFaqModal;
  actions.appendChild(close);
  ov.classList.add('open');

  const { data, error } = await sb.rpc('admin_faq_answer_history', { answer_id: r.id });
  body.textContent = '';
  if (error) { body.appendChild(el('div', 'loading', '불러오기 실패: ' + (error.message || ''))); return; }
  const list = el('div', 'fa-hist');
  (data || []).forEach(h => {
    const item = el('div', 'fa-hist-item');
    item.appendChild(el('div', 'uq-meta', faqDate(h.changed_at) + (h.changed_by_name ? ' ' + h.changed_by_name : '') + ' 수정 전 내용' + (h.hidden ? ' (숨김 상태)' : '')));
    const head = el('div', 'fa-head');
    head.appendChild(el('span', 'fa-cat', h.category));
    head.appendChild(el('span', 'uq-query', h.q));
    item.appendChild(head);
    item.appendChild(el('div', 'fa-answer open', h.a));
    const same = h.category === r.category && h.q === r.q && h.a === r.a;
    if (!same) {
      const back = el('button', 'account-btn', '이 내용으로 되돌리기');
      back.onclick = () => openFaqEditor({ id: r.id, category: h.category, q: h.q, a: h.a });
      item.appendChild(back);
    }
    list.appendChild(item);
  });
  body.appendChild(list);
}
