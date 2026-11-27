/*
  Chat Games on stream: the poll, Contexto, the flag game, the giveaway and the scavenger hunt grid.
  Same bold floating style as Stream Desk; each game has Off, preview and on screen, a colour and a size,
  and can be dragged anywhere in the hub's preview.
*/
(() => {
  'use strict';
  const X = window.ExtrasModel;
  const KEYS = ['poll', 'contexto', 'flags', 'give', 'hunt'];
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // Contexto: green when close, yellow when warm, red when far; the bar is longer the closer it is
  const heat = (r) => (r <= 300 ? 'hot' : r <= 1500 ? 'warm' : 'cold');
  const reach = (r) => Math.max(6, Math.round(100 - (Math.log10(r) / Math.log10(20000)) * 94));
  const orList = (nums) => (nums.length > 1 ? `${nums.slice(0, -1).join(', ')} or ${nums[nums.length - 1]}` : String(nums[0] || ''));

  function inner(k, g, mode) {
    if (k === 'poll') {
      const opts = g.opts.map((t, i) => ({ t, i, v: g.votes[i] })).filter((o) => o.t);
      const total = opts.reduce((n, o) => n + o.v, 0);
      const rows = opts.map((o) => {
        const pct = total ? Math.round((o.v / total) * 100) : 0;
        return `<div class="gm-row"><i style="width:${pct}%"></i><b>${o.i + 1}</b><span class="gm-t">${esc(o.t)}</span><em>${pct}%</em></div>`;
      }).join('');
      return `<div class="gm-title">${esc(g.q || 'Poll')}</div>${rows}<div class="gm-foot"><span>${g.open ? `Type ${orList(opts.map((o) => o.i + 1))} in chat` : 'Voting closed'}</span><span>${total} vote${total === 1 ? '' : 's'}</span></div>`;
    }
    if (k === 'contexto') {
      if (g.winner) return `<div class="gm-title">Contexto</div><div class="gm-win"><small>${esc(g.winner.u)} got it</small><b>${esc(g.winner.w)}</b></div><div class="gm-foot"><span>${g.count} guesses</span></div>`;
      const rows = g.guesses.slice(0, 8).map((x) => `<div class="gm-row cx ${heat(x.r)}"><i style="width:${reach(x.r)}%"></i><span class="gm-t">${esc(x.w)}</span><span class="gm-by">${esc(x.u)}</span><em>${x.r}</em></div>`).join('');
      const last = g.last ? `<div class="gm-last">Latest: <b>${esc(g.last.w)}</b> ${g.last.r} <span>${esc(g.last.u)}</span></div>` : '';
      const ask = mode === 'bang' ? 'Type !g and a word in chat' : 'Type a word in chat';
      return `<div class="gm-title">Contexto</div>${rows || '<div class="gm-empty">Guess the secret word</div>'}${last}<div class="gm-foot"><span>${g.open ? ask : 'Round over'}</span><span>${g.count} guesses</span></div>`;
    }
    if (k === 'flags') {
      const top = g.board.slice(0, 3).map((x, i) => `<span>${i + 1}. ${esc(x.u)} <b>${x.pts}</b></span>`).join('');
      const flag = g.code ? `<img class="fl-img" src="/flags/${esc(g.code)}.svg" alt="">` : '<div class="fl-img fl-none"></div>';
      const ask = mode === 'bang' ? 'Type !g and the country in chat' : 'Name the country in chat';
      const line = g.winner ? `<div class="gm-win"><small>${esc(g.winner.u)} got it</small><b>${esc(g.winner.name)}</b></div>` : `<div class="gm-foot"><span>${g.open ? ask : 'Next flag coming up'}</span></div>`;
      return `<div class="gm-title">Name the flag</div>${flag}${line}${top ? `<div class="fl-top">${top}</div>` : ''}`;
    }
    if (k === 'give') {
      if (g.winner) return `<div class="gm-title">${esc(g.title)}</div><div class="gm-win"><small>Winner</small><b>${esc(g.winner)}</b></div>`;
      return `<div class="gm-title">${esc(g.title)}</div><div class="gv-join">${g.open ? `Type <b>${esc(g.word)}</b> to enter` : 'Entries closed'}</div><div class="gm-foot"><span>${g.entries} entered</span></div>`;
    }
    const filled = g.cells.filter((c) => c.t);
    const cells = g.cells.map((c) => `<div class="hn-cell${c.found ? ' is-found' : ''}${c.t ? '' : ' is-empty'}"><span>${esc(c.t)}</span></div>`).join('');
    return `<div class="gm-title">${esc(g.title)}</div><div class="hn-grid" style="--n:${g.size}">${cells}</div><div class="gm-foot"><span>${filled.filter((c) => c.found).length} of ${filled.length} found</span></div>`;
  }

  function mount(stage, opts = {}) {
    const preview = !!opts.preview;
    const root = document.createElement('div');
    root.className = 'dk gm';
    root.classList.toggle('is-hub', preview);
    stage.el.appendChild(root);
    const nodes = {};
    function drag(node, key) {
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
        const up = () => { node.removeEventListener('pointermove', move); node.classList.remove('is-dragging'); if (to !== from) opts.onDrag(key, Math.max(0, Math.min(1920, to[0])), Math.max(0, Math.min(1080, to[1]))); };
        node.addEventListener('pointermove', move);
        node.addEventListener('pointerup', up, { once: true });
        node.addEventListener('pointercancel', up, { once: true });
      });
    }
    function render(s) {
      KEYS.forEach((k) => {
        const g = s[k];
        let node = nodes[k];
        if (!node) {
          node = document.createElement('div');
          node.className = `dk-w gm-w gmw-${k}`;
          node.dataset.id = k;
          root.appendChild(node);
          nodes[k] = node;
          drag(node, k);
        }
        const html = inner(k, g, s.mode);
        if (node._html !== html) { node._html = html; node.innerHTML = html; }
        if (!node.classList.contains('is-dragging')) { node.style.left = `${g.x}px`; node.style.top = `${g.y}px`; }
        node.style.setProperty('--c', g.color);
        node.style.transform = `translate(-50%, -50%) scale(${g.scale})`;
        node.classList.toggle('is-on', X.shows(g.vis, preview));
        node.classList.toggle('is-pv', preview && g.vis === 'preview');
      });
    }
    return { el: { root }, render };
  }
  window.GamesOverlay = { mount, KEYS };
})();
