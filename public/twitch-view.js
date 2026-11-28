/*
  Twitch Centre on stream: alerts (one at a time, each only if switched on) and the official Twitch poll or
  prediction with live results. Test alerts only ever show in the hub's preview, never on stream.
*/
(() => {
  'use strict';
  const X = window.ExtrasModel;
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const WORDS = { follow: ['♥', 'just followed'], sub: ['★', 'just subscribed'], resub: ['★', 'resubscribed'], gift: ['🎁', 'gifted'], bits: ['◆', 'cheered'], raid: ['⚑', 'is raiding'], redeem: ['✦', 'redeemed'] };
  function alertHtml(a) {
    const [icon, verb] = WORDS[a.kind] || ['✦', a.kind];
    const amount = a.kind === 'gift' ? `${a.amount} sub${a.amount === 1 ? '' : 's'}` : a.kind === 'bits' ? `${a.amount} bits` : a.kind === 'raid' ? `with ${a.amount}` : a.kind === 'resub' && a.amount > 1 ? '' : '';
    return `<div class="tw-alert-icon">${icon}</div><div class="tw-alert-text"><b>${esc(a.user)}</b> ${verb}${amount ? ` <em>${esc(amount)}</em>` : ''}${a.extra ? `<small>${esc(a.extra)}</small>` : ''}</div>`;
  }
  function pollHtml(d) {
    const p = d.poll && d.poll.status !== 'ARCHIVED' ? d.poll : null;
    const r = d.pred && !['CANCELED', 'RESOLVED'].includes(d.pred.status) ? d.pred : null;
    if (!p && !r) return '';
    const rows = p ? p.choices.map((c) => [c.t, c.v]) : r.outs.map((o) => [o.t, o.pts]);
    const total = rows.reduce((a, x) => a + x[1], 0) || 1;
    const left = Math.max(0, Math.round(((p || r).ends - Date.now()) / 1000));
    const state = (p || r).status === 'ACTIVE' ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} left` : (p || r).status === 'LOCKED' ? 'Locked' : 'Ended';
    return `<div class="tw-poll-head"><b>${esc((p || r).title)}</b><span>${state}</span></div>${rows.map(([t, v]) => `<div class="tw-poll-row"><span>${esc(t)}</span><em>${Math.round((v / total) * 100)}%</em><div class="sb-bar"><i style="width:${(v / total) * 100}%"></i></div></div>`).join('')}`;
  }
  function mount(stage, opts = {}) {
    const preview = !!opts.preview;
    const root = document.createElement('div');
    root.className = 'dk twv';
    root.classList.toggle('is-hub', preview);
    stage.el.appendChild(root);
    const alert = document.createElement('div');
    alert.dataset.id = 'alerts';
    const poll = document.createElement('div');
    poll.dataset.id = 'poll';
    root.append(alert, poll);
    let lastAlert = '';
    let current = null;
    [alert, poll].forEach((node) => {
      if (!preview || !opts.onDrag) return;
      node.addEventListener('pointerdown', (e) => {
        if (node.dataset.lock === '1') return;
        e.preventDefault();
        node.setPointerCapture(e.pointerId);
        const k = 1920 / root.getBoundingClientRect().width;
        const start = [e.clientX, e.clientY];
        const from = [parseFloat(node.style.left), parseFloat(node.style.top)];
        let to = from;
        const move = (ev) => { to = [Math.round(from[0] + (ev.clientX - start[0]) * k), Math.round(from[1] + (ev.clientY - start[1]) * k)]; node.style.left = `${to[0]}px`; node.style.top = `${to[1]}px`; };
        node.addEventListener('pointermove', move);
        node.addEventListener('pointerup', () => { node.removeEventListener('pointermove', move); if (to !== from) opts.onDrag(node.dataset.id, to[0], to[1]); }, { once: true });
      });
    });
    function place(node, look, on, cls) {
      node.className = `dk-w ${cls}${on ? ' is-on' : ''}${preview && look.vis === 'preview' ? ' is-pv' : ''}`;
      node.style.left = `${look.x}px`;
      node.style.top = `${look.y}px`;
      node.dataset.lock = look.lock ? '1' : '';
      node.style.setProperty('--c', look.color);
      node.style.transform = `translate(-50%, -50%) scale(${look.scale})`;
    }
    function render(s) {
      current = s;
      const a = s.alerts.cur;
      const showA = !!a && X.shows(s.alerts.vis, preview) && (!a.test || preview) && Date.now() - a.at < s.alerts.dur * 1000;
      if (a && a.id !== lastAlert) {
        lastAlert = a.id;
        alert.innerHTML = alertHtml(a);
        alert.classList.remove('is-pop'); void alert.offsetWidth; alert.classList.add('is-pop');
        // The alert sound plays on the OBS page only, and never for a test alert
        if (!preview && !a.test && s.alerts.sound && showA) { const au = new Audio(`/media/${s.alerts.sound}`); au.volume = s.alerts.vol / 100; au.play().catch(() => {}); }
      }
      place(alert, s.alerts, showA, 'tw-alert is-pop');
      const ph = pollHtml(s.dash);
      if (poll._html !== ph) { poll._html = ph; poll.innerHTML = ph; }
      place(poll, s.plook, !!ph && X.shows(s.plook.vis, preview), 'tw-poll');
    }
    setInterval(() => { if (current) render(current); }, 1000);
    return { el: { root }, render };
  }
  window.TwitchOverlay = { mount };
})();
