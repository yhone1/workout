(() => {
  const scrollThreshold = 320;
  let animationFrame = 0;
  let drag = null;
  let movedByUser = false;
  let suppressClick = false;

  function initialize() {
    if (!document.body || document.querySelector('.back-to-top')) return;

    const button = document.createElement('button');
    button.className = 'back-to-top';
    button.type = 'button';
    button.setAttribute('aria-label', '返回页面顶部');
    button.setAttribute('aria-hidden', 'true');
    button.title = '返回顶部（可拖动）';
    button.tabIndex = -1;
    button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 19V5M6.5 10.5 12 5l5.5 5.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    document.body.append(button);

    const placeAboveFixedControls = () => {
      if (movedByUser) return;
      button.style.top = '';
      button.style.bottom = '';
      const buttonRect = button.getBoundingClientRect();
      const blockers = document.querySelectorAll('#timerDock, .focus-bar');
      let raisedTop = null;

      blockers.forEach((blocker) => {
        const style = getComputedStyle(blocker);
        if (style.position !== 'fixed' || style.display === 'none' || style.visibility === 'hidden') return;
        const rect = blocker.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        const overlaps = buttonRect.left < rect.right && buttonRect.right > rect.left
          && buttonRect.top < rect.bottom && buttonRect.bottom > rect.top;
        if (overlaps && rect.top > 0) {
          const candidate = Math.max(12, rect.top - buttonRect.height - 12);
          raisedTop = raisedTop === null ? candidate : Math.min(raisedTop, candidate);
        }
      });

      if (raisedTop !== null) {
        button.style.top = `${raisedTop}px`;
        button.style.bottom = 'auto';
      }
    };

    const update = () => {
      animationFrame = 0;
      const isLongAndScrolled = document.documentElement.scrollHeight > window.innerHeight + 24
        && window.scrollY > scrollThreshold;
      button.classList.toggle('is-visible', isLongAndScrolled);
      button.setAttribute('aria-hidden', String(!isLongAndScrolled));
      button.tabIndex = isLongAndScrolled ? 0 : -1;
      placeAboveFixedControls();
    };

    const scheduleUpdate = () => {
      if (!animationFrame) animationFrame = window.requestAnimationFrame(update);
    };

    const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
    button.addEventListener('pointerdown', (event) => {
      if (event.button !== undefined && event.button !== 0) return;
      const rect = button.getBoundingClientRect();
      drag = {id: event.pointerId, startX: event.clientX, startY: event.clientY, left: rect.left, top: rect.top, moved: false};
      button.setPointerCapture?.(event.pointerId);
    });

    button.addEventListener('pointermove', (event) => {
      if (!drag || drag.id !== event.pointerId) return;
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      if (!drag.moved && Math.hypot(dx, dy) < 5) return;
      drag.moved = true;
      movedByUser = true;
      button.classList.add('is-dragging');
      const rect = button.getBoundingClientRect();
      const maxLeft = Math.max(8, window.innerWidth - rect.width - 8);
      const maxTop = Math.max(8, window.innerHeight - rect.height - 8);
      button.style.left = `${clamp(drag.left + dx, 8, maxLeft)}px`;
      button.style.top = `${clamp(drag.top + dy, 8, maxTop)}px`;
      button.style.right = 'auto';
      button.style.bottom = 'auto';
    });

    const endDrag = (event) => {
      if (!drag || drag.id !== event.pointerId) return;
      suppressClick = drag.moved;
      drag = null;
      button.classList.remove('is-dragging');
      if (suppressClick) window.setTimeout(() => { suppressClick = false; }, 400);
    };
    button.addEventListener('pointerup', endDrag);
    button.addEventListener('pointercancel', endDrag);

    button.addEventListener('click', (event) => {
      if (suppressClick) {
        event.preventDefault();
        event.stopPropagation();
        suppressClick = false;
        return;
      }
      const behavior = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
      window.scrollTo({top: 0, behavior});
    });

    window.addEventListener('scroll', scheduleUpdate, {passive: true});
    window.addEventListener('resize', () => {
      if (movedByUser) {
        const rect = button.getBoundingClientRect();
        button.style.left = `${clamp(rect.left, 8, Math.max(8, window.innerWidth - rect.width - 8))}px`;
        button.style.top = `${clamp(rect.top, 8, Math.max(8, window.innerHeight - rect.height - 8))}px`;
      }
      scheduleUpdate();
    });
    window.addEventListener('pageshow', scheduleUpdate);
    if ('ResizeObserver' in window) new ResizeObserver(scheduleUpdate).observe(document.body);

    const controlsObserver = new MutationObserver(scheduleUpdate);
    document.querySelectorAll('#timerDock, .focus-bar').forEach((element) => {
      controlsObserver.observe(element, {attributes: true, attributeFilter: ['class', 'style', 'hidden']});
    });
    scheduleUpdate();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, {once: true});
  else initialize();
})();
