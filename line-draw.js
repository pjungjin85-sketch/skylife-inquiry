/* ============================================================
   라인 드로잉 — skylife-guide 바로가기 아이콘과 같은 효과
   페이지에 있는 <svg><use href="#i-..."></use></svg> 아이콘을 인라인 SVG로
   바꾸고(선마다 pathLength=1) 위에서부터 차례로 그린다. 다 그린 뒤에는
   버튼·링크에 마우스를 올릴 때마다 다시 그린다. 스타일은 base.css의 '라인 드로잉'.
   잠금이 풀리는 순간 startLineDraw()를 부른다. 저장소마다 같은 파일.
   ============================================================ */
(function(){
  const SHAPES = 'path,rect,circle,line,polyline,polygon,ellipse';
  function inline(svg){
    const use = svg.querySelector(':scope > use');
    if(!use) return false;
    const id = (use.getAttribute('href') || use.getAttribute('xlink:href') || '').replace('#', '');
    const sym = id && document.getElementById(id);
    if(!sym) return false;
    for(const a of sym.attributes){ if(a.name !== 'id' && !svg.hasAttribute(a.name)) svg.setAttribute(a.name, a.value); }
    svg.innerHTML = sym.innerHTML;
    svg.querySelectorAll(SHAPES).forEach(el => el.setAttribute('pathLength', '1'));
    svg.setAttribute('aria-hidden', 'true');
    svg.classList.add('ld');
    return true;
  }
  let started = false;
  window.startLineDraw = function(){
    if(started) return;
    started = true;
    let i = 0;
    document.querySelectorAll('svg').forEach(svg => {
      if(svg.closest('#lock-overlay, symbol, defs')) return;
      if(inline(svg)) svg.style.setProperty('--ld-i', Math.min(i++, 12));
    });
    document.body.classList.add('ld-run');
    setTimeout(() => document.body.classList.add('ld-done'), 800 + Math.min(i, 12) * 90 + 600);
  };
})();
