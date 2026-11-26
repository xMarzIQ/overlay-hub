/*
  Stream Desk: the everyday widgets. Timers (including a countdown to a date, like matchday), counters, text,
  lists (to-do, shopping with a budget, top lists, tier lists) and your own match scoreboard.
  Widgets stack in nine places on the screen; each place stacks its widgets neatly.
*/
(() => {
  'use strict';
  const X = window.ExtrasModel;
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (v) => `£${(Math.round(v * 100) / 100).toFixed(2)}`;

  function body(w) {
    if (w.type === 'timer') {
      const left = X.timerNow(w);
      const done = (w.mode === 'down' || w.mode === 'to') && left === 0 && w.end;
      return `<div class="dk-time${done ? ' is-done' : ''}" data-timer>${done ? esc(w.end) : X.fmt(left)}</div>`;
    }
    if (w.type === 'counter') return `<div class="dk-count">${w.value}${w.goal ? `<small> / ${w.goal}</small>` : ''}</div>${w.goal ? `<div class="dk-bar"><i style="width:${Math.min(100, (w.value / w.goal) * 100)}%"></i></div>` : ''}`;
    if (w.type === 'text') return w.style === 'ticker' ? `<div class="dk-ticker"><span>${esc(w.text)}</span><span aria-hidden="true">${esc(w.text)}</span></div>` : `<div class="dk-headline">${esc(w.text)}</div>`;
    if (w.type === 'match') {
      return `<div class="dk-match"><b>${esc(w.a)}</b><span class="dk-ms">${w.sa}–${w.sb}</span><b>${esc(w.b)}</b></div>${w.w || w.d || w.l ? `<div class="dk-tally"><span class="t-w">W ${w.w}</span><span class="t-d">D ${w.d}</span><span class="t-l">L ${w.l}</span></div>` : ''}`;
    }
    if (w.type === 'list') {
      if (w.kind === 'tier') {
        return ['S', 'A', 'B', 'C', 'D'].map((t) => { const row = w.items.filter((x) => x.tier === t); return row.length ? `<div class="dk-tier"><i class="tier-${t}">${t}</i><span>${row.map((x) => esc(x.t)).join(', ')}</span></div>` : ''; }).join('') || '<div class="dk-empty">Nothing ranked yet</div>';
      }
      const lis = w.items.map((x, i) => `<li class="${x.done ? 'is-done' : ''}">${w.kind === 'top' ? `<i>${i + 1}</i>` : `<i class="dk-check"></i>`}<span>${esc(x.t)}</span>${w.kind === 'shopping' && x.price ? `<small>${money(x.price)}</small>` : ''}</li>`).join('');
      let foot = '';
      if (w.kind === 'shopping' && w.budget) {
        const spent = w.items.filter((x) => x.done).reduce((n, x) => n + x.price, 0);
        const left = w.budget - spent;
        foot = `<div class="dk-budget${left < 0 ? ' is-over' : ''}">${left < 0 ? `Over by ${money(-left)}` : `${money(left)} left of ${money(w.budget)}`}</div>`;
      }
      return `<ol class="dk-list kind-${w.kind}">${lis || '<li class="dk-empty">Nothing yet</li>'}</ol>${foot}`;
    }
    return '';
  }

  function mount(stage) {
    const root = document.createElement('div');
    root.className = 'dk';
    root.innerHTML = X.POS.map((p) => `<div class="dk-slot slot-${p}" data-slot="${p}"></div>`).join('');
    stage.el.appendChild(root);
    let current = null;
    function render(s) {
      current = s;
      root.classList.toggle('is-off', !s.onAir);
      X.POS.forEach((p) => {
        const slot = root.querySelector(`[data-slot="${p}"]`);
        const list = s.widgets.filter((w) => w.pos === p);
        const html = list.map((w) => `<section class="dk-w dk-${w.type} size-${w.size}${w.shown ? ' is-on' : ''}" data-id="${w.id}">${w.title ? `<header>${esc(w.title)}</header>` : ''}<div class="dk-body">${body(w)}</div></section>`).join('');
        if (slot._html !== html) { slot._html = html; slot.innerHTML = html; }
      });
    }
    // Timers count every quarter of a second
    setInterval(() => {
      if (!current) return;
      current.widgets.filter((w) => w.type === 'timer').forEach((w) => {
        const node = root.querySelector(`[data-id="${w.id}"] [data-timer]`);
        if (!node) return;
        const left = X.timerNow(w);
        const done = (w.mode === 'down' || w.mode === 'to') && left === 0 && w.end;
        const text = done ? w.end : X.fmt(left);
        if (node.textContent !== text) node.textContent = text;
        node.classList.toggle('is-done', !!done);
      });
    }, 250);
    return { el: { root }, render };
  }
  window.DeskOverlay = { mount };
})();
