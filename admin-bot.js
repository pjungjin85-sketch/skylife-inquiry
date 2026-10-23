/* ══════════════════════════════════════════════════════════════
   관리자 — 업무지원 텔레그램 봇 연동
   1) 회원 목록의 '텔레그램 ID' 칸: 직원이 가이드에서 연결한 ID 표시 (읽기 전용)
   2) '봇 미해결 질문' 탭: 봇이 자료가 없어 답하지 못한 질문 → 「답변 등록」(admin-faq.js) 또는 처리 완료
   DB 함수는 schema_bot.sql 참고. admin.html 의 sb / escapeHtml 을 쓴다.
   ══════════════════════════════════════════════════════════════ */

/* ── 0. 최근 접속 (회원 목록) ── */
function formatLastSeen(ts) {
  if (!ts) return '기록 없음';  // 모바일은 앞에 '접속 ' 라벨이 붙는다 (style.css)
  const d = new Date(ts);
  const now = new Date();
  const hm = d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
  if (d.toDateString() === now.toDateString()) return '오늘 ' + hm;
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return '어제 ' + hm;
  return d.toLocaleDateString('ko-KR', { year: '2-digit', month: '2-digit', day: '2-digit' });
}

/* ── 1. 텔레그램 ID (읽기 전용) ──
   연결·해제는 직원이 현장영업 가이드 로그아웃 옆에서 직접 한다. 여기서는 상태만 보여준다.
   정지된 계정은 ID 가 남아 있어도 봇을 못 쓰므로 줄을 그어 표시한다. */
function buildTelegramCell(a) {
  const c = document.createElement('span');
  c.className = 'account-tg' + (a.telegram_id ? '' : ' none') + (a.telegram_id && a.status !== 'approved' ? ' inactive' : '');
  c.textContent = a.telegram_id ? String(a.telegram_id) : '미연결';
  if (a.telegram_id && a.status !== 'approved') c.title = '승인된 계정만 봇을 사용할 수 있습니다';
  return c;
}

/* ── 페이지 나누기 (미해결 질문·등록한 답변 공용) ── */
const PAGE_SIZE = 10;

function clampPage(page, total) {
  return Math.min(Math.max(1, page), Math.max(1, Math.ceil(total / PAGE_SIZE)));
}

// [이전] 1 2 3 4 5 [다음] — 현재 페이지 주변 5개만 보여준다. 한 페이지뿐이면 null
function buildPager(total, page, onPage) {
  const pages = Math.ceil(total / PAGE_SIZE);
  if (pages <= 1) return null;
  const nav = document.createElement('nav');
  nav.className = 'pager';
  nav.setAttribute('aria-label', '페이지');
  const add = (label, target, opts = {}) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pager-btn' + (opts.current ? ' active' : '');
    b.textContent = label;
    if (opts.aria) b.setAttribute('aria-label', opts.aria);
    if (opts.current) b.setAttribute('aria-current', 'page');
    b.disabled = !!opts.disabled;
    b.onclick = () => onPage(target);
    nav.appendChild(b);
  };
  add('‹', page - 1, { disabled: page === 1, aria: '이전 페이지' });
  let start = Math.max(1, page - 2);
  const end = Math.min(pages, start + 4);
  start = Math.max(1, end - 4);
  for (let i = start; i <= end; i++) add(String(i), i, { current: i === page });
  add('›', page + 1, { disabled: page === pages, aria: '다음 페이지' });
  return nav;
}

// 페이지를 넘기면 목록 맨 위가 보이게
function scrollListTop(containerId) {
  const c = document.getElementById(containerId);
  if (c && c.getBoundingClientRect().top < 0) c.scrollIntoView({ block: 'start' });
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
let unansweredPage = 1;
let unansweredShowDismissed = false;   // true = 삭제한 질문만 보기
const unansweredSelected = new Set();  // 체크한 질문 (페이지를 넘겨도 유지)

async function loadUnanswered() {
  setUnansweredLoading('불러오는 중...');
  const { data, error } = await sb.rpc('admin_list_unanswered', {
    days: unansweredDays, include_resolved: unansweredShowResolved, show_dismissed: unansweredShowDismissed,
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
  unansweredSelected.clear();
  renderUnanswered();
}

function setUnansweredDays(d) {
  unansweredDays = d;
  unansweredPage = 1;
  document.querySelectorAll('[data-udays]').forEach(b => b.classList.toggle('active', Number(b.dataset.udays) === d));
  loadUnanswered();
}

function toggleUnansweredResolved(on) {
  unansweredShowResolved = on;
  unansweredPage = 1;
  loadUnanswered();
}

function toggleUnansweredDismissed(on) {
  unansweredShowDismissed = on;
  unansweredPage = 1;
  // 삭제한 질문 보기에서는 처리 완료 구분이 의미 없어 체크를 숨긴다
  document.getElementById('uq-resolved-toggle').style.display = on ? 'none' : '';
  loadUnanswered();
}

function renderUnanswered() {
  const open = unanswered.filter(r => !r.resolved_at).length;
  document.getElementById('unanswered-count').textContent = unansweredShowDismissed
    ? '삭제한 질문 ' + unanswered.length + '건'
    : '미처리 ' + open + '건' + (unansweredShowResolved ? ' · 처리 완료 ' + (unanswered.length - open) + '건' : '');
  const c = document.getElementById('unanswered-list-container');
  c.textContent = '';
  if (!unanswered.length) {
    c.innerHTML = '<div class="empty"><div class="empty-icon"><svg><use href="#i-inbox"></use></svg></div>' +
      '<div class="empty-text">' + (unansweredShowDismissed
        ? '최근 ' + unansweredDays + '일간 삭제한 질문이 없습니다.'
        : '최근 ' + unansweredDays + '일간 자료가 없어 답하지 못한 질문이 없습니다.') + '</div></div>';
    return;
  }
  unansweredPage = clampPage(unansweredPage, unanswered.length);
  const from = (unansweredPage - 1) * PAGE_SIZE;
  const pageRows = unanswered.slice(from, from + PAGE_SIZE);
  c.appendChild(buildSelectBar(pageRows));
  const list = document.createElement('div');
  list.className = 'uq-list';
  pageRows.forEach(r => list.appendChild(buildUnansweredRow(r)));
  c.appendChild(list);
  const pager = buildPager(unanswered.length, unansweredPage, p => {
    unansweredPage = p; renderUnanswered(); scrollListTop('unanswered-list-container');
  });
  if (pager) c.appendChild(pager);
}

function buildUnansweredRow(r) {
  const row = document.createElement('div');
  row.className = 'uq-row' + (r.resolved_at || r.dismissed_at ? ' resolved' : '');

  const pick = document.createElement('input');
  pick.type = 'checkbox';
  pick.className = 'uq-pick';
  pick.checked = unansweredSelected.has(r.query);
  pick.setAttribute('aria-label', '선택: ' + r.query);
  pick.onchange = () => {
    if (pick.checked) unansweredSelected.add(r.query); else unansweredSelected.delete(r.query);
    updateSelectBar();
  };
  row.appendChild(pick);

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
  if (r.dismissed_at) {
    const done = document.createElement('div');
    done.className = 'uq-done dismissed';
    done.textContent = '삭제함 ' + new Date(r.dismissed_at).toLocaleDateString('ko-KR');
    main.appendChild(done);
  } else if (r.resolved_at) {
    const done = document.createElement('div');
    done.className = 'uq-done';
    done.textContent = '처리 완료 ' + new Date(r.resolved_at).toLocaleDateString('ko-KR') + (r.resolved_note ? ' — ' + r.resolved_note : '');
    main.appendChild(done);
  }

  const act = document.createElement('div');
  act.className = 'uq-actions';
  if (r.dismissed_at) {
    const back = document.createElement('button');
    back.className = 'account-btn';
    back.textContent = '되살리기';
    back.onclick = () => dismissUnanswered([r.query], false, back);
    act.appendChild(back);
  } else if (!r.resolved_at) {
    // 답변을 쓰면 FAQ 에 등록되고 이 질문은 처리 완료로 (admin-faq.js)
    const reg = document.createElement('button');
    reg.className = 'account-btn primary';
    reg.textContent = '답변 등록';
    reg.onclick = () => openFaqEditor({ q: r.query.replace(/[?？!.~\s]+$/, ''), source_query: r.query });
    act.appendChild(reg);
    const btn = document.createElement('button');
    btn.className = 'account-btn approve';
    btn.textContent = '처리 완료';
    btn.onclick = () => resolveUnanswered(r, btn);
    act.appendChild(btn);
  }
  if (!r.dismissed_at) {
    const del = document.createElement('button');
    del.className = 'account-btn reject';
    del.textContent = '삭제';
    del.onclick = () => dismissUnanswered([r.query], true, del);
    act.appendChild(del);
  }
  row.appendChild(main); row.appendChild(act);
  return row;
}

/* 선택 막대: [이 페이지 전체 선택] N개 선택 [선택 삭제 / 선택 되살리기] */
function buildSelectBar(pageRows) {
  const bar = document.createElement('div');
  bar.className = 'uq-select-bar';
  bar.id = 'uq-select-bar';
  const all = document.createElement('label');
  all.className = 'checkbox-label';
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.id = 'uq-pick-page';
  box.onchange = () => {
    pageRows.forEach(r => { if (box.checked) unansweredSelected.add(r.query); else unansweredSelected.delete(r.query); });
    document.querySelectorAll('#unanswered-list-container .uq-pick').forEach(p => { p.checked = box.checked; });
    updateSelectBar();
  };
  const t = document.createElement('span');
  t.textContent = '이 페이지 전체 선택';
  all.append(box, t);
  const count = document.createElement('span');
  count.className = 'list-count';
  count.id = 'uq-pick-count';
  const go = document.createElement('button');
  go.id = 'uq-pick-btn';
  go.className = 'account-btn ' + (unansweredShowDismissed ? '' : 'reject');
  go.textContent = unansweredShowDismissed ? '선택 되살리기' : '선택 삭제';
  go.onclick = () => dismissUnanswered([...unansweredSelected], !unansweredShowDismissed, go);
  bar.append(all, count, go);
  bar._pageRows = pageRows;
  setTimeout(updateSelectBar);
  return bar;
}

function updateSelectBar() {
  const bar = document.getElementById('uq-select-bar');
  if (!bar) return;
  const n = unansweredSelected.size;
  document.getElementById('uq-pick-count').textContent = n ? n + '개 선택' : '';
  document.getElementById('uq-pick-btn').disabled = !n;
  const rows = bar._pageRows || [];
  document.getElementById('uq-pick-page').checked = rows.length > 0 && rows.every(r => unansweredSelected.has(r.query));
}

// 삭제 = 목록에서만 뺀다 (기록은 남음, 같은 질문이 또 와도 다시 안 올라옴). dismiss=false 면 되살리기
async function dismissUnanswered(queries, dismiss, btn) {
  if (!queries.length) return;
  const ask = dismiss
    ? queries.length + '개 질문을 목록에서 삭제할까요?\n기록은 남고, 「삭제한 질문 보기」에서 되살릴 수 있습니다.\n같은 질문이 또 들어와도 다시 올라오지 않습니다.'
    : queries.length + '개 질문을 미해결 목록으로 되살릴까요?';
  if (!confirm(ask)) return;
  btn.disabled = true;
  const { error } = await sb.rpc('admin_dismiss_queries', { qs: queries, dismiss });
  if (error) { alert('처리 실패: ' + (error.message || '')); btn.disabled = false; return; }
  loadUnanswered();
}

async function resolveUnanswered(r, btn) {
  const note = prompt('어디에 반영했는지 메모 (선택)\n예) FAQ 추가, 매뉴얼 수정, 답변 불필요', '');
  if (note === null) return;  // 취소
  btn.disabled = true; btn.textContent = '처리 중';
  const { error } = await sb.rpc('admin_resolve_query', { q: r.query, note });
  if (error) { alert('처리 실패: ' + (error.message || JSON.stringify(error))); btn.disabled = false; btn.textContent = '처리 완료'; return; }
  loadUnanswered();
}

/* 엑셀에 붙여넣으면 칸이 나뉘도록 탭 구분(TSV)으로 복사. 지금 화면의 기간·처리완료 포함 조건 그대로.
   페이지와 상관없이 목록 전체를 복사한다.
   맨 끝 '답변' 칸은 비워 둔다 — 유관부서에 보내 채워 받는 용도. */
async function copyUnanswered(btn) {
  if (!unanswered.length) { alert('복사할 질문이 없습니다.'); return; }
  const BOT_LABEL = { main: '운영 봇', personal: '개인 봇' };
  // 엑셀이 날짜로 인식하는 형식 (정렬·필터 가능): 2026-10-23 11:34
  const pad = n => String(n).padStart(2, '0');
  const fmt = ts => {
    if (!ts) return '';
    const d = new Date(ts);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  };
  // 셀 안의 탭·줄바꿈은 칸이 밀리지 않게 공백으로
  // = + - @ 로 시작하는 칸은 엑셀이 수식으로 실행한다 (직원 질문이 그대로 들어오므로) → ' 를 붙여 글자로
  const clean = v => {
    const t = String(v == null ? '' : v).replace(/[\t\r\n]+/g, ' ').trim();
    return /^[=+\-@]/.test(t) ? "'" + t : t;
  };
  const head = ['번호', '질문', '유형', '질문 횟수', '질문자(횟수)', '처음 질문', '마지막 질문', '출처', '처리 상태', '처리 메모', '답변'];
  const rows = unanswered.map((r, i) => [
    i + 1,
    r.query,
    [...new Set((r.routes || '').split(',').map(x => ROUTE_LABEL[x] || x))].join(' · '),
    r.ask_count,
    r.askers,
    fmt(r.first_asked),
    fmt(r.last_asked),
    (r.bots || '').split(',').filter(Boolean).map(b => BOT_LABEL[b] || b).join(' · '),
    r.resolved_at ? '처리 완료 ' + fmt(r.resolved_at) : '미처리',
    r.resolved_note,
    '',
  ]);
  const tsv = [head, ...rows].map(cols => cols.map(clean).join('\t')).join('\n');

  let ok = false;
  try { await navigator.clipboard.writeText(tsv); ok = true; } catch (e) {
    // 클립보드 권한이 없을 때(오래된 브라우저 등) 대체 방법
    const ta = document.createElement('textarea');
    ta.value = tsv; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { ok = document.execCommand('copy'); } catch (e2) { ok = false; }
    ta.remove();
  }
  if (!ok) { alert('복사하지 못했습니다. 브라우저를 바꿔 다시 시도해주세요.'); return; }
  const original = btn.textContent;
  btn.textContent = '복사됨 ✓ ' + rows.length + '건 — 엑셀에 붙여넣기';
  btn.disabled = true;
  setTimeout(() => { btn.textContent = original; btn.disabled = false; }, 2500);
}

function setUnansweredLoading(msg) {
  const el = document.createElement('div'); el.className = 'loading'; el.textContent = msg;
  const c = document.getElementById('unanswered-list-container'); c.textContent = ''; c.appendChild(el);
}
