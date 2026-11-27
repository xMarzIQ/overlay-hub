/*
  Stream Desk: everyday widgets for any stream, drawn as bold floating text (no boxes) in each widget's colour.
  Timer and countdown read xx:xx:xx. Each widget is off, in preview (only in the hub) or live, and can be
  dragged anywhere in the hub's preview.
*/
(() => {
  'use strict';
  const X = window.ExtrasModel;
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (v) => `£${(Math.round(v * 100) / 100).toFixed(2)}`;
  const clockText = (w) => { try { return new Date().toLocaleTimeString('en-GB', { timeZone: w.tz, hour: '2-digit', minute: '2-digit', second: w.seconds ? '2-digit' : undefined, hour12: false }); } catch (e) { return new Date().toLocaleTimeString('en-GB', { hour12: false }); } };

  function inner(w) {
    const label = w.label ? `<div class="dk-label">${esc(w.label)}</div>` : '';
    if (w.type === 'timer' || w.type === 'countdown') {
      const left = X.timerNow(w);
      const done = w.type === 'countdown' && left === 0 && w.end;
      return `${label}<div class="dk-big" data-tick>${done ? esc(w.end) : X.fmt(left)}</div>`;
    }
    if (w.type === 'clock') return `${label}<div class="dk-big" data-tick>${clockText(w)}</div>`;
    if (w.type === 'counter') return `${label}<div class="dk-big">${w.value}${w.goal ? `<span class="dk-of"> / ${w.goal}</span>` : ''}</div>`;
    if (w.type === 'text') return w.scroll ? `<div class="dk-scroll"><span>${esc(w.text)}</span><span aria-hidden="true">${esc(w.text)}</span></div>` : `<div class="dk-text">${esc(w.text)}</div>`;
    if (w.type === 'checklist') return `${label}<ul class="dk-lines">${w.items.filter((x) => x.t).map((x) => `<li class="${x.done ? 'is-done' : ''}"><i>${x.done ? '✓' : ''}</i>${esc(x.t)}</li>`).join('')}</ul>`;
    if (w.type === 'budget') {
      const spent = w.items.filter((x) => x.done).reduce((n, x) => n + x.price, 0);
      const left = w.budget - spent;
      const tone = left < 0 ? 'is-over' : left < w.budget * 0.2 ? 'is-low' : '';
      return `${label}<ul class="dk-lines">${w.items.filter((x) => x.t).map((x) => `<li class="${x.done ? 'is-bought' : ''}"><i>${x.done ? '✓' : ''}</i>${esc(x.t)}<b>${x.price ? money(x.price) : ''}</b></li>`).join('')}</ul><div class="dk-left ${tone}">${left < 0 ? `Over by ${money(-left)}` : `${money(left)} left`}</div>`;
    }
    return '';
  }

  function mount(stage, opts = {}) {
    const preview = !!opts.preview;
    const root = document.createElement('div');
    root.className = 'dk';
    root.classList.toggle('is-hub', !!(opts && opts.preview));
    stage.el.appendChild(root);
    const nodes = {};
    let current = null;
    function drag(node, wid) {
      if (!preview || !opts.onDrag) return;
      node.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        node.setPointerCapture(e.pointerId);
        const k = 1920 / root.getBoundingClientRect().width;
        const start = [e.clientX, e.clientY];
        const from = [parseFloat(node.style.left), parseFloat(node.style.top)];
        let to = from;
        node.classList.add('is-dragging');
        const move = (ev) => { to = [Math.round(from[0] + (ev.clientX - start[0]) * k), Math.round(from[1] + (ev.clientY - start[1]) * k)]; node.style.left = `${to[0]}px`; node.style.top = `${to[1]}px`; };
        const up = () => { node.removeEventListener('pointermove', move); node.classList.remove('is-dragging'); if (to !== from) opts.onDrag(wid, Math.max(0, Math.min(1920, to[0])), Math.max(0, Math.min(1080, to[1]))); };
        node.addEventListener('pointermove', move);
        node.addEventListener('pointerup', up, { once: true });
        node.addEventListener('pointercancel', up, { once: true });
      });
    }
    function render(s) {
      current = s;
      s.widgets.forEach((w) => {
        let node = nodes[w.id];
        if (!node) {
          node = document.createElement('div');
          node.className = `dk-w dkw-${w.type}`;
          node.dataset.id = w.id;
          root.appendChild(node);
          nodes[w.id] = node;
          drag(node, w.id);
        }
        const html = inner(w);
        if (node._html !== html) { node._html = html; node.innerHTML = html; }
        if (!node.classList.contains('is-dragging')) { node.style.left = `${w.x}px`; node.style.top = `${w.y}px`; }
        node.style.setProperty('--c', w.color);
        node.style.transform = `translate(-50%, -50%) scale(${w.scale})`;
        node.classList.toggle('is-on', X.shows(w.vis, preview));
        node.classList.toggle('is-pv', preview && w.vis === 'preview');
      });
    }
    // Timers, countdowns and the clock tick every quarter of a second
    setInterval(() => {
      if (!current) return;
      current.widgets.forEach((w) => {
        if (!['timer', 'countdown', 'clock'].includes(w.type)) return;
        const n = nodes[w.id] && nodes[w.id].querySelector('[data-tick]');
        if (!n) return;
        const left = X.timerNow(w);
        const text = w.type === 'clock' ? clockText(w) : w.type === 'countdown' && left === 0 && w.end ? w.end : X.fmt(left);
        if (n.textContent !== text) n.textContent = text;
      });
    }, 250);
    return { el: { root }, render };
  }
  window.DeskOverlay = { mount };
})();
