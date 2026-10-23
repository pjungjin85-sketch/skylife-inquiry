/* ══════════════════════════════════════════════════════════════
   관리자 — 봇 공지 (텔레그램 대화방 상단 고정)
   저장하면 직원이 다음에 봇에 말을 걸 때 대화방 위에 고정된다 (운영 봇·개인 봇 모두).
   새로 저장하면 이전 공지 고정은 풀리고, 「공지 내리기」면 고정만 풀린다.
   DB 함수는 schema_bot_notice.sql 참고. 봇 쪽은 mobile-work-support-bot/bot/notice.py.
   admin.html 의 sb 를 쓴다.
   ══════════════════════════════════════════════════════════════ */

let botNotices = [];
let botNoticeLoaded = false;

function bnDate(ts) {
  const d = new Date(ts);
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

async function loadBotNotices() {
  const box = document.getElementById('bn-current');
  box.textContent = '불러오는 중...';
  const { data, error } = await sb.rpc('admin_list_bot_notices');
  if (error) {
    const m = error.message || '';
    box.textContent = /Could not find the function|PGRST202/i.test(m)
      ? 'admin_list_bot_notices 함수가 없습니다. schema_bot_notice.sql 을 먼저 실행해주세요.'
      : '불러오기 실패: ' + m;
    return;
  }
  botNotices = data || [];
  botNoticeLoaded = true;
  renderBotNotices();
}

function renderBotNotices() {
  const cur = botNotices[0];
  const live = cur && cur.body;

  const box = document.getElementById('bn-current');
  box.textContent = '';
  box.classList.toggle('off', !live);
  const head = document.createElement('div');
  head.className = 'bn-current-head';
  head.textContent = live
    ? '지금 공지 · ' + bnDate(cur.created_at) + (cur.created_by_name ? ' ' + cur.created_by_name : '') + ' · 받은 사람 ' + cur.delivered + '명'
    : '지금 공지 없음';
  box.appendChild(head);
  if (live) {
    const body = document.createElement('div');
    body.className = 'bn-current-body';
    body.textContent = cur.body;
    box.appendChild(body);
  }

  const ta = document.getElementById('bn-body');
  if (!ta.dataset.touched) ta.value = live ? cur.body : '';
  updateBotNoticeCount();
  document.getElementById('bn-off-btn').style.display = live ? '' : 'none';

  const list = document.getElementById('bn-history');
  list.textContent = '';
  const past = botNotices.slice(1);
  document.getElementById('bn-history-wrap').style.display = past.length ? '' : 'none';
  past.forEach(n => {
    const row = document.createElement('div');
    row.className = 'uq-row bn-row';
    const main = document.createElement('div');
    main.className = 'uq-main';
    const b = document.createElement('div');
    b.className = 'fa-answer' + (n.body ? '' : ' bn-off');
    b.textContent = n.body || '(공지 내림)';
    b.onclick = () => b.classList.toggle('open');
    const meta = document.createElement('div');
    meta.className = 'uq-meta';
    meta.textContent = bnDate(n.created_at) + (n.created_by_name ? ' ' + n.created_by_name : '');
    main.append(b, meta);
    row.appendChild(main);
    if (n.body) {
      const act = document.createElement('div');
      act.className = 'uq-actions';
      const reuse = document.createElement('button');
      reuse.className = 'account-btn';
      reuse.textContent = '이 내용 불러오기';
      reuse.onclick = () => {
        ta.value = n.body; ta.dataset.touched = '1'; updateBotNoticeCount();
        ta.focus(); ta.scrollIntoView({ block: 'center' });
      };
      act.appendChild(reuse);
      row.appendChild(act);
    }
    list.appendChild(row);
  });
}

function updateBotNoticeCount() {
  const ta = document.getElementById('bn-body');
  document.getElementById('bn-count').textContent = ta.value.length + ' / 1000';
}

async function saveBotNotice(off) {
  const ta = document.getElementById('bn-body');
  const body = off ? '' : ta.value.trim();
  const cur = botNotices[0];
  if (!off && !body) { alert('공지 내용을 입력해주세요. 공지를 없애려면 「공지 내리기」를 누르세요.'); return; }
  if (!off && cur && cur.body === body) { alert('지금 공지와 내용이 같습니다.'); return; }
  const ask = off
    ? '공지를 내릴까요?\n직원이 다음에 봇에 말을 걸 때 대화방 위 고정이 풀립니다.'
    : '이 내용으로 공지할까요?\n직원이 다음에 봇에 말을 걸 때 대화방 위에 고정됩니다. (운영 봇·개인 봇)';
  if (!confirm(ask)) return;
  const { error } = await sb.rpc('admin_set_bot_notice', { p_body: body });
  if (error) {
    alert(/too long/.test(error.message || '') ? '공지는 1000자까지 쓸 수 있습니다.' : '저장 실패: ' + (error.message || ''));
    return;
  }
  delete ta.dataset.touched;
  loadBotNotices();
}
