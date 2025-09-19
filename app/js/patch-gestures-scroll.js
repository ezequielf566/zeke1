
/**
 * Patch: Mobile edge-swipe "Back" + resilient mouse-wheel scrolling
 * - Keeps the original layout and sounds intact (runs after script.js).
 * - Mobile: swipe from very left/right edge to go Back (history.back), like native gesture.
 * - Desktop: if some handler prevents default wheel scrolling globally, emulate scroll so it never "freezes".
 * - Mobile scroll sanity: ensure page can scroll vertically outside of the drawing board.
 */

(function(){
  // ------- Edge swipe back (mobile) -------
  const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  const EDGE = 18;         // px from screen edge to start the gesture
  const THRESH = 48;       // horizontal movement threshold to trigger back
  const MAX_SLOPE = Math.tan(30 * Math.PI / 180); // allow ~30° angle

  let startX = null, startY = 0, active = false, fromEdge = false;

  if(isTouch){
    window.addEventListener('touchstart', function(e){
      if(e.touches.length !== 1) return;
      const t = e.touches[0];
      startX = t.clientX; startY = t.clientY;
      const w = window.innerWidth;
      fromEdge = (startX <= EDGE) || (startX >= w - EDGE);
      active = fromEdge;
      // do NOT preventDefault; we only detect
    }, {passive:true, capture:true});

    window.addEventListener('touchmove', function(e){
      if(!active || startX == null) return;
      const t = e.touches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      if(Math.abs(dx) > THRESH && Math.abs(dy) <= Math.abs(dx) * MAX_SLOPE){
        // Only go back if there is actually a back entry
        if(history.length > 1){
          try { history.back(); } catch(_) {}
        } else {
          // Fall back to in-app navigation if available
          var prev = document.querySelector('#prevBtn');
          var next = document.querySelector('#nextBtn');
          try {
            // If gesture started at left edge and moved right => previous
            // If gesture started at right edge and moved left => previous as well (keeping "voltar")
            if(prev) prev.click();
            else if(next && t.clientX < startX) next.click();
          } catch(_){}
        }
        // One-shot
        active = false;
        startX = null;
      }
    }, {passive:true});
    window.addEventListener('touchend', function(){
      active = false; startX = null;
    }, {passive:true});
  }

  // ------- Resilient wheel scroll (desktop & laptops) -------
  // Some apps accidentally call preventDefault() on 'wheel' and freeze page scroll until reload.
  // If that happens while NOT on top of the drawing board, we emulate the scroll.
  function isOverDrawingBoard(target){
    if(!target) return false;
    return !!(target.closest && target.closest('#svgMount, .svgMount'));
  }

  window.addEventListener('wheel', function(e){
    // If another handler prevented default, but we are not over the board, emulate.
    if(e.defaultPrevented && !isOverDrawingBoard(e.target)){
      // Emulate natural scroll
      try {
        window.scrollBy({ top: e.deltaY, left: 0, behavior: 'auto' });
      } catch(_){
        window.scrollBy(0, e.deltaY);
      }
    }
  }, {passive:true}); // passive ensures we never block the browser's native scroll

  // ------- CSS nudge (non-invasive) -------
  try {
    const style = document.createElement('style');
    style.textContent = `
      /* Allow vertical panning on the page; the board itself can still handle its own gestures */
      html, body { overscroll-behavior-y: contain; touch-action: pan-y; }
      /* Make sure the drawing surface doesn't accidentally disable the entire page scrolling */
      .svgMount { -webkit-overflow-scrolling: touch; }
      /* Keep mouse-wheel on nested scroll containers smooth */
      .scroll-y, .panel, .wrap { -webkit-overflow-scrolling: touch; }
    `;
    document.head.appendChild(style);
  } catch(_){}
})();
