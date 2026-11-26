/*
  The 1920×1080 stage every overlay draws into, scaled to fit whatever box it sits in.
  Used by the OBS page (/overlay) and by the hub's preview monitor.
*/
(() => {
  'use strict';
  const W = 1920;
  const H = 1080;

  function create(viewport, opts = {}) {
    const preview = !!opts.preview;
    const el = document.createElement('div');
    el.className = `stage${preview ? ' is-preview' : ''}`;
    if (preview) el.innerHTML = '<div class="backdrop" data-bg="checker" aria-hidden="true"></div><div class="safe" aria-hidden="true"></div><div class="guide" aria-hidden="true"></div>';
    viewport.appendChild(el);
    let scale = 1;
    function fit() {
      const r = viewport.getBoundingClientRect();
      if (!r.width || !r.height) return;
      scale = Math.min(r.width / W, r.height / H);
      const ox = (r.width - W * scale) / 2;
      const oy = (r.height - H * scale) / 2;
      el.style.transform = `translate(${ox}px, ${oy}px) scale(${scale})`;
    }
    window.addEventListener('resize', fit);
    if ('ResizeObserver' in window) new ResizeObserver(fit).observe(viewport);
    fit();
    return {
      el,
      guide: el.querySelector('.guide'),
      fit,
      get scale() { return scale; },
      setBackdrop(mode) { const b = el.querySelector('.backdrop'); if (b) b.dataset.bg = mode; },
      setSafeArea(on) { el.classList.toggle('show-safe', !!on); },
    };
  }

  window.Stage = { create, W, H };
})();
