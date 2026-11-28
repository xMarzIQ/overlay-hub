/*
  Subathon & Goals on stream: the countdown (worked out from the server's saved times, so every OBS page shows the
  same), goal bars, milestones, spins owed and the top gifters and cheerers. Every piece starts Off.
*/
(() => {
  'use strict';
  const X = window.ExtrasModel;
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const hms = (sec) => { sec = Math.max(0, Math.floor(sec)); return [Math.floor(sec / 3600), Math.floor(sec / 60) % 60, sec % 60].map((n) => String(n).padStart(2, '0')).join(':'); };
  const STATUS = { paused: 'Paused', grace: 'Last chance', ended: 'Ended', idle: 'Starting soon' };
  const MODE = { sleep: 'Sleep mode', break: 'On a break' };

  function leaders(s) {
    const add = (map, k, v) => { if (k) map.set(k, (map.get(k) || 0) + v); };
    const gifts = new Map(), bits = new Map();
    s.hist.forEach((h) => { if (h.fixed || !h.user || h.user === 'Anonymous') return; if (h.kind === 'gift') add(gifts, h.user, h.qty); if (h.kind === 'bits') add(bits, h.user, h.qty); });
    const top = (m) => Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3);
    return { gifts: top(gifts), bits: top(bits) };
  }
  function body(key, s, part) {
    const now = Date.now();
    if (key === 'timer') {
      const t = s.timer;
      const chips = [MODE[s.mode], STATUS[t.state], s.bonus.until > now ? `×${s.bonus.mult} time` : ''].filter(Boolean).map((c) => `<span>${esc(c)}</span>`).join('');
      return `<div class="sb-title">${esc(t.title)}</div><div class="sb-time" data-left>${hms(X.subLeft(t, now))}</div>${chips ? `<div class="sb-chips">${chips}</div>` : ''}`;
    }
    if (key.startsWith('goal:')) {
      const p = Math.max(0, Math.min(100, Math.round((part.cur / part.target) * 100)));
      const n = (v) => (part.src === 'money' ? `${esc(part.unit || '£')}${Math.round(v * 100) / 100}` : Math.round(v * 100) / 100);
      return `<div class="sb-goal-head"><b>${esc(part.name)}</b><span>${n(part.cur)} / ${n(part.target)}</span></div><div class="sb-bar"><i style="width:${p}%"></i></div><div class="sb-goal-foot">${p}%${part.deadline ? `, ends ${new Date(part.deadline).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : ''}</div>`;
    }
    if (key === 'milestones') {
      const list = s.milestones.filter((m) => m.name && m.s !== 'skipped').slice(0, 6);
      return `<div class="sb-title">Milestones</div><ul class="ch-list">${list.map((m) => `<li class="is-${m.s === 'done' ? 'done' : 'open'}"><i>${m.s === 'locked' ? '🔒' : m.s === 'done' ? '✓' : '◆'}</i><span>${esc(m.name)}${m.s !== 'locked' && m.reward ? ` <small>${esc(m.reward)}</small>` : ''}</span><b>${m.target}</b></li>`).join('') || '<li><span>No milestones yet</span></li>'}</ul>`;
    }
    if (key === 'spins') return `<div class="sb-title">Wheel spins owed</div><div class="sb-time">${s.spins.owed}</div>`;
    if (key === 'board') {
      const l = leaders(s);
      const col = (title, rows, unit) => `<div class="sb-col"><b>${title}</b>${rows.map(([u, v], i) => `<span>${i + 1}. ${esc(u)} <em>${v}${unit}</em></span>`).join('') || '<span>Nobody yet</span>'}</div>`;
      return `<div class="sb-title">Top supporters</div><div class="sb-cols">${col('Gifted subs', l.gifts, '')}${col('Bits', l.bits, '')}</div>`;
    }
    return '';
  }

  function mount(stage, opts = {}) {
    const preview = !!opts.preview;
    const root = document.createElement('div');
    root.className = 'dk sbt';
    root.classList.toggle('is-hub', preview);
    stage.el.appendChild(root);
    const nodes = new Map();
    let current = null;
    function drag(node) {
      if (!preview || !opts.onDrag) return;
      node.addEventListener('pointerdown', (e) => {
        if (node.dataset.lock === '1') return;
        e.preventDefault();
        node.setPointerCapture(e.pointerId);
        const k = 1920 / root.getBoundingClientRect().width;
        const start = [e.clientX, e.clientY];
        const from = [parseFloat(node.style.left), parseFloat(node.style.top)];
        let to = from;
        node.classList.add('is-dragging');
        const move = (ev) => { to = [Math.round(from[0] + (ev.clientX - start[0]) * k), Math.round(from[1] + (ev.clientY - start[1]) * k)]; if (Math.abs(to[0] - 960) < 16) to[0] = 960; if (Math.abs(to[1] - 540) < 16) to[1] = 540; node.style.left = `${to[0]}px`; node.style.top = `${to[1]}px`; };
        const up = () => { node.removeEventListener('pointermove', move); node.classList.remove('is-dragging'); if (to !== from) opts.onDrag(node.dataset.id, Math.max(0, Math.min(1920, to[0])), Math.max(0, Math.min(1080, to[1]))); };
        node.addEventListener('pointermove', move);
        node.addEventListener('pointerup', up, { once: true });
      });
    }
    function render(s) {
      current = s;
      const parts = [['timer', s.timer], ['milestones', s.mlook], ['spins', s.spins], ['board', s.blook]].concat(s.goals.map((g) => [`goal:${g.id}`, g]));
      const seen = new Set();
      parts.forEach(([key, part]) => {
        seen.add(key);
        let node = nodes.get(key);
        if (!node) { node = document.createElement('div'); node.dataset.id = key; root.appendChild(node); nodes.set(key, node); drag(node); }
        const html = body(key, s, part);
        if (node._html !== html) { node._html = html; node.innerHTML = html; }
        node.className = `dk-w sb-w sbk-${key.split(':')[0]}${X.shows(part.vis, preview) ? ' is-on' : ''}${preview && part.vis === 'preview' ? ' is-pv' : ''}${node.classList.contains('is-dragging') ? ' is-dragging' : ''}`;
        if (!node.classList.contains('is-dragging')) { node.style.left = `${part.x}px`; node.style.top = `${part.y}px`; }
        node.dataset.lock = part.lock ? '1' : '';
        node.style.setProperty('--c', part.color);
        node.style.transform = `translate(-50%, -50%) scale(${part.scale})`;
      });
      nodes.forEach((n, k) => { if (!seen.has(k)) { n.remove(); nodes.delete(k); } });
    }
    // The countdown ticks on every page from the same saved times
    setInterval(() => { if (!current) return; const n = nodes.get('timer'); const el = n && n.querySelector('[data-left]'); if (el) el.textContent = hms(X.subLeft(current.timer, Date.now())); }, 250);
    return { el: { root }, render };
  }
  window.SubathonOverlay = { mount, hms, leaders };
})();
