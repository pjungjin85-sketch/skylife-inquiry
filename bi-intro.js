/* ============================================================
   BI 인트로 — 페이지를 넘어와 로그인을 확인하는 동안
   'kt skylife' 글자가 화면 여기저기 흩어져 있다가 가운데로 모여 로고가 된다.
   - 확인 성공: BiIntro.reveal(cb)  로고가 다 모인 뒤 살짝 커지며 화면이 걷힌다
   - 로그인 필요: BiIntro.toLogin(cb) 로고가 다 모인 뒤 로그인 상자로 바뀐다
   확인이 애니메이션보다 빨리 끝나도 다 모일 때까지(약 0.9초) 기다리고,
   페이지로 넘어갈 때는 완성된 로고를 1초 더 보여준 뒤 걷는다.
   스타일은 base.css의 'BI 인트로'. <head>에서 읽는다.
   ============================================================ */
(function(){
  const WORDS = [['k','t'], ['s','k','y','l','i','f','e']];
  const ASSEMBLE_MS = 900;
  const HOLD_MS = 1000; // 로고가 다 모인 뒤 페이지로 넘어가기 전까지 보여주는 시간
  let el = null, t0 = 0, active = false;

  // 첫 화면에 로그인 상자가 비치지 않도록 파싱 전에 표시해 둔다
  document.documentElement.classList.add('bi-pending');

  function build(){
    document.documentElement.classList.remove('bi-pending');
    const ov = document.getElementById('lock-overlay');
    if(!ov || ov.classList.contains('hidden')) return;
    el = document.createElement('div');
    el.className = 'bi-intro';
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', 'kt skylife');
    let i = 0;
    WORDS.forEach((word, w) => {
      const wd = document.createElement('span');
      wd.className = 'bi-word' + (w ? ' bi-red' : '');
      word.forEach(ch => {
        const s = document.createElement('span');
        s.className = 'bi-ch';
        s.textContent = ch;
        // 화면 가운데를 기준으로 사방 120~300px 거리에 흩어 놓는다
        const ang = Math.random() * Math.PI * 2;
        const dist = 120 + Math.random() * 180;
        s.style.setProperty('--x', Math.round(Math.cos(ang) * dist) + 'px');
        s.style.setProperty('--y', Math.round(Math.sin(ang) * dist) + 'px');
        s.style.setProperty('--r', Math.round(Math.random() * 140 - 70) + 'deg');
        s.style.setProperty('--i', i++);
        wd.appendChild(s);
      });
      el.appendChild(wd);
    });
    ov.classList.add('bi-intro-on');
    ov.appendChild(el);
    t0 = performance.now();
    active = true;
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('go')));
    // 확인이 길어지면 완성된 로고가 숨 쉬듯 깜빡이며 기다린다
    setTimeout(() => { if(active) el.classList.add('wait'); }, ASSEMBLE_MS + HOLD_MS + 200);
  }

  function afterAssembled(cb, hold){
    setTimeout(cb, Math.max(0, ASSEMBLE_MS + (hold || 0) - (performance.now() - t0)));
  }

  window.BiIntro = {
    reveal(cb){
      if(!active){ cb && cb(); return; }
      active = false;
      afterAssembled(() => {
        const ov = document.getElementById('lock-overlay');
        el.classList.remove('wait');
        ov.classList.add('bi-out');
        setTimeout(() => {
          cb && cb();
          ov.classList.remove('bi-intro-on', 'bi-out');
          el.remove();
        }, 420);
      }, HOLD_MS);
    },
    toLogin(cb){
      if(!active){ cb && cb(); return; }
      active = false;
      afterAssembled(() => {
        const ov = document.getElementById('lock-overlay');
        el.classList.add('leave');
        setTimeout(() => {
          el.remove();
          ov.classList.remove('bi-intro-on');
          ov.querySelector('.lock-box')?.classList.add('bi-enter');
          cb && cb();
        }, 260);
      });
    }
  };

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})();
