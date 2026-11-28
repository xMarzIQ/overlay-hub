/*
  Challenges on stream: bingo / scavenger hunt, random wheel, tracker, checklist, counters, versus, budget, lives, timers,
  forfeits, mystery challenges, race, milestones, random challenge, teams and leaderboard. Same floating style as
  Stream Desk; every piece has Off, preview and on screen, a colour, a size, and can be dragged in the hub's preview.
  The wheel's result is chosen by the server; the animation only lands on it.
*/
(() => {
  'use strict';
  const X = window.ExtrasModel;
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const SEG = ['#2563eb', '#16a34a', '#f59e0b', '#dc2626', '#7c3aed', '#0891b2', '#ea580c', '#65a30d'];
  const money = (w, v) => `${v < 0 ? '−' : ''}${esc(w.cur)}${Math.abs(v).toFixed(Math.abs(v) % 1 ? 2 : 0)}`;
  const clock = (sec) => X.fmt(Math.max(0, Math.round(sec)));
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

  // Bingo: completed lines (rows, columns, diagonals)
  function lines(w) {
    const n = w.size, on = (r, c) => w.cells[r * n + c].done || (w.free && r === (n - 1) / 2 && c === (n - 1) / 2);
    let k = 0;
    for (let i = 0; i < n; i += 1) {
      if ([...Array(n)].every((_, j) => on(i, j))) k += 1;
      if ([...Array(n)].every((_, j) => on(j, i))) k += 1;
    }
    if ([...Array(n)].every((_, j) => on(j, j))) k += 1;
    if ([...Array(n)].every((_, j) => on(j, n - 1 - j))) k += 1;
    return k;
  }
  function wheelSvg(w) {
    const opts = w.items.filter((o) => o.on && o.t);
    if (!opts.length) return '<div class="ch-empty">Add options to the wheel</div>';
    const total = opts.reduce((a, o) => a + (w.weighted ? Math.max(0.01, o.w) : 1), 0);
    let a0 = 0;
    const segs = opts.map((o, i) => {
      const span = ((w.weighted ? Math.max(0.01, o.w) : 1) / total) * 360;
      const a1 = a0 + span;
      const p = (a) => [100 + 96 * Math.sin((a * Math.PI) / 180), 100 - 96 * Math.cos((a * Math.PI) / 180)];
      const [x0, y0] = p(a0), [x1, y1] = p(a1);
      const mid = a0 + span / 2;
      const seg = opts.length === 1 ? '<circle cx="100" cy="100" r="96"/>' : `<path d="M100 100L${x0.toFixed(2)} ${y0.toFixed(2)}A96 96 0 ${span > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}Z"/>`;
      const label = `<text transform="rotate(${mid.toFixed(2)} 100 100)" x="100" y="22" text-anchor="middle">${esc(o.t.length > 14 ? `${o.t.slice(0, 13)}…` : o.t)}</text>`;
      a0 = a1;
      return `<g fill="${SEG[i % SEG.length]}">${seg}</g>${label}`;
    }).join('');
    return `<div class="ch-wheel-box"><svg class="ch-wheel" viewBox="0 0 200 200"><g class="ch-spin">${segs}<circle cx="100" cy="100" r="10" fill="#111827" stroke="#fff" stroke-width="2"/></g></svg><i class="ch-pointer"></i></div>`;
  }
  // Where the chosen option's middle sits, in degrees from the top
  function centreOf(w, t) {
    const opts = w.items.filter((o) => o.on && o.t);
    const total = opts.reduce((a, o) => a + (w.weighted ? Math.max(0.01, o.w) : 1), 0);
    let a0 = 0;
    for (const o of opts) { const span = ((w.weighted ? Math.max(0.01, o.w) : 1) / total) * 360; if (o.t === t) return a0 + span / 2; a0 += span; }
    return 0;
  }
  const STATE_MARK = { done: '✓', failed: '✗', skipped: '–', cancelled: '–', unlocked: '◆', open: '' };

  function inner(w, preview) {
    const head = `<div class="ch-title">${esc(w.title || X.CH_NAME[w.kind])}</div>`;
    const items = w.items.filter((x) => x.t);
    const done = items.filter((x) => x.s === 'done').length, failed = items.filter((x) => x.s === 'failed').length, skipped = items.filter((x) => x.s === 'skipped').length;
    switch (w.kind) {
      case 'bingo': {
        const free = (i) => w.free && i === (w.size * w.size - 1) / 2;
        const used = w.cells.filter((c, i) => c.t || free(i));
        const got = w.cells.filter((c, i) => (c.t && c.done) || free(i)).length;
        const cells = w.cells.map((c, i) => `<div class="hn-cell${c.done || free(i) ? ' is-found' : ''}${c.t || free(i) ? '' : ' is-empty'}"><span>${free(i) ? 'FREE' : esc(c.t)}</span></div>`).join('');
        const won = w.rule === 'line' ? lines(w) > 0 : w.rule === 'all' ? got === used.length && used.length > 0 : w.rule === 'count' ? got >= w.ruleN : false;
        const foot = [w.show.left ? `${got} of ${used.length} done` : '', w.show.pct ? `${pct(got, used.length)}%` : ''].filter(Boolean).map((x) => `<span>${x}</span>`).join('');
        return `${head}<div class="hn-grid" style="--n:${w.size}">${cells}</div>${won ? `<div class="ch-win">${w.rule === 'line' ? 'Line complete!' : w.rule === 'all' ? 'All done!' : `${got} done!`}</div>` : ''}${foot ? `<div class="gm-foot">${foot}</div>` : ''}`;
      }
      case 'wheel': {
        const sp = w.spin && (!w.spin.test || preview) ? w.spin : null;
        return `${head}${wheelSvg(w)}<div class="ch-result" data-res>${sp && Date.now() > sp.at + sp.dur * 1000 ? esc(sp.t) : ''}</div>`;
      }
      case 'tracker': case 'checklist': {
        const left = items.length - done - failed - skipped;
        const stats = w.show.stats ? `<div class="ch-stats"><span>Completed <b>${done}</b></span><span>Failed <b>${failed}</b></span><span>Left <b>${left}</b></span><span><b>${pct(done, items.length)}%</b></span></div><div class="ch-bar"><i style="width:${pct(done, items.length)}%"></i></div>` : '';
        const list = w.show.list ? `<ul class="ch-list">${items.slice(0, 10).map((x) => `<li class="is-${x.s}"><i>${STATE_MARK[x.s] || ''}</i><span>${esc(x.t)}</span>${x.p ? `<b>${x.p} pts</b>` : ''}</li>`).join('')}</ul>` : '';
        return head + stats + list;
      }
      case 'counter':
        return `${head}<div class="ch-big">${w.value}${w.target ? `<small> / ${w.target}</small>` : ''}</div>`;
      case 'versus': {
        const top = Math.max(...items.map((x) => x.n), 0);
        const winner = w.showWinner && w.target && items.find((x) => x.n >= w.target);
        return `${head}${w.round > 1 ? `<div class="ch-sub">Round ${w.round}</div>` : ''}<ul class="ch-list ch-vs">${items.map((x) => `<li class="${x.n === top && top > 0 ? 'is-top' : ''}"><span>${esc(x.t)}</span><b>${x.n}</b></li>`).join('')}</ul>${w.target ? `<div class="ch-sub">First to ${w.target}</div>` : ''}${winner ? `<div class="ch-win">${esc(winner.t)} wins!</div>` : ''}`;
      }
      case 'budget': {
        const spent = items.filter((x) => x.n < 0).reduce((a, x) => a - x.n, 0);
        const plus = items.filter((x) => x.n > 0).reduce((a, x) => a + x.n, 0);
        const left = w.start + plus - spent;
        return `${head}<div class="ch-big${left < 0 && w.warn ? ' is-over' : ''}">${money(w, left)}<small> left</small></div><div class="ch-stats"><span>Spent <b>${money(w, spent)}</b></span><span>Budget <b>${money(w, w.start + plus)}</b></span></div><ul class="ch-list">${items.slice(-4).reverse().map((x) => `<li><span>${esc(x.t)}</span><b>${x.n < 0 ? '−' : '+'}${money(w, Math.abs(x.n))}</b></li>`).join('')}</ul>`;
      }
      case 'lives':
        if (w.unlimited) return `${head}<div class="ch-big">♥ ${w.left}</div>`;
        return `${head}<div class="ch-hearts">${Array.from({ length: w.max }, (_, i) => `<i class="${i < w.left ? 'on' : ''}">♥</i>`).join('')}</div>${w.out && w.left === 0 ? '<div class="ch-win is-bad">Out!</div>' : ''}`;
      case 'timer': {
        const laps = w.laps;
        const best = laps.length ? Math.min(...laps) : 0;
        const avg = laps.length ? laps.reduce((a, b) => a + b, 0) / laps.length : 0;
        return `${head}<div class="ch-big ch-time" data-timer>${clock(X.timerNow(w))}</div>${laps.length ? `<div class="ch-stats"><span>Last <b>${clock(laps[laps.length - 1])}</b></span><span>Best <b>${clock(best)}</b></span><span>Average <b>${clock(avg)}</b></span></div>` : ''}`;
      }
      case 'forfeits': {
        const owed = items.filter((x) => x.s === 'open').length;
        const pick = items.find((x) => x.id === w.pick);
        return `${head}${pick ? `<div class="ch-pick">${esc(pick.t)}${pick.who ? `<small>${esc(pick.who)}</small>` : ''}</div>` : ''}<div class="ch-stats"><span>Owed <b>${owed}</b></span><span>Done <b>${done}</b></span></div>`;
      }
      case 'mystery': {
        const shown = items.filter((x) => !x.hide);
        const hidden = items.length - shown.length;
        return `${head}<ul class="ch-list">${shown.slice(-6).map((x) => `<li class="is-${x.s}"><i>${STATE_MARK[x.s] || '?'}</i><span>${esc(x.t)}</span></li>`).join('')}${hidden ? `<li class="ch-mystery"><i>?</i><span>${hidden} still hidden</span></li>` : ''}</ul>`;
      }
      case 'race': {
        const now = Date.now();
        const time = (x) => (x.at && w.start ? (x.at - w.start) / 1000 + x.pen : null);
        const rows = items.slice().sort((a, b) => (time(a) ?? 1e12) - (time(b) ?? 1e12));
        return `${head}${w.start ? `<div class="ch-sub ch-time" data-race="${w.start}">${clock((now - w.start) / 1000)}</div>` : '<div class="ch-sub">Ready</div>'}<ul class="ch-list ch-vs">${rows.map((x, i) => `<li class="is-${x.s}"><span>${time(x) !== null ? `${i + 1}. ` : ''}${esc(x.t)}</span><b>${x.s === 'skipped' ? 'Out' : time(x) !== null ? clock(time(x)) : 'Racing'}</b></li>`).join('')}</ul>`;
      }
      case 'milestones':
        return `${head}<ul class="ch-list">${items.map((x) => `<li class="is-${x.s}"><i>${x.s === 'done' ? '✓' : x.s === 'unlocked' ? '◆' : '🔒'}</i><span>${esc(x.t)}</span>${x.tgt ? `<b>${Math.min(x.n, x.tgt)} / ${x.tgt}</b>` : ''}</li>`).join('')}</ul>`;
      case 'generator': {
        const pick = items.find((x) => x.id === w.pick);
        return `${head}<div class="ch-pick">${pick ? esc(pick.t) : 'Ready to pick'}${pick && (pick.cat || pick.d) ? `<small>${esc([pick.cat, pick.d].filter(Boolean).join(', '))}</small>` : ''}</div>`;
      }
      case 'teams':
        return `${head}<div class="ch-teams">${w.teams.map((t, i) => `<div class="ch-team"><b style="color:${SEG[i % SEG.length]}">${esc(t.name || `Team ${i + 1}`)}</b>${t.who.map((p) => `<span>${esc(p)}</span>`).join('')}</div>`).join('')}</div>`;
      case 'leaderboard': {
        const rows = items.slice().sort((a, b) => b.p - a.p || b.n - a.n).slice(0, 8);
        return `${head}<ul class="ch-list ch-vs">${rows.map((x, i) => `<li class="${i === 0 && x.p > 0 ? 'is-top' : ''}"><span>${i + 1}. ${esc(x.t)}</span><b>${x.p}</b>${x.n || x.l ? `<small>${x.n}W ${x.l}L</small>` : ''}</li>`).join('')}</ul>`;
      }
      default: return head;
    }
  }

  function mount(stage, opts = {}) {
    const preview = !!opts.preview;
    const root = document.createElement('div');
    root.className = 'dk ch';
    root.classList.toggle('is-hub', preview);
    stage.el.appendChild(root);
    const nodes = new Map();
    let current = null;
    function drag(node) {
      if (!preview || !opts.onDrag) return;
      node.addEventListener('pointerdown', (e) => {
        if (node.dataset.lock === '1') return; // locked: stays where it is
        e.preventDefault();
        node.setPointerCapture(e.pointerId);
        const k = 1920 / root.getBoundingClientRect().width;
        const start = [e.clientX, e.clientY];
        const from = [parseFloat(node.style.left), parseFloat(node.style.top)];
        let to = from;
        node.classList.add('is-dragging');
        const move = (ev) => { to = [Math.round(from[0] + (ev.clientX - start[0]) * k), Math.round(from[1] + (ev.clientY - start[1]) * k)]; if (Math.abs(to[0] - 960) < 16) to[0] = 960; if (Math.abs(to[1] - 540) < 16) to[1] = 540; root.classList.toggle('guide-x', to[0] === 960); root.classList.toggle('guide-y', to[1] === 540); node.style.left = `${to[0]}px`; node.style.top = `${to[1]}px`; };
        const up = () => { node.removeEventListener('pointermove', move); root.classList.remove('guide-x', 'guide-y'); node.classList.remove('is-dragging'); if (to !== from) opts.onDrag(node.dataset.id, Math.max(0, Math.min(1920, to[0])), Math.max(0, Math.min(1080, to[1]))); };
        node.addEventListener('pointermove', move);
        node.addEventListener('pointerup', up, { once: true });
        node.addEventListener('pointercancel', up, { once: true });
      });
    }
    // The wheel turns to the server's result; a page opened later shows it already landed
    function spinWheel(node, w) {
      const sp = w.spin && (!w.spin.test || preview) ? w.spin : null;
      const g = node.querySelector('.ch-spin');
      if (!sp || !g) return;
      const target = 360 - centreOf(w, sp.t);
      const left = sp.at + sp.dur * 1000 - Date.now();
      if (node._spin === sp.id) { g.style.transform = `rotate(${node._rot}deg)`; return; }
      node._spin = sp.id;
      const base = (node._rot || 0) - ((node._rot || 0) % 360);
      if (left <= 0) { node._rot = base + target; g.style.transition = 'none'; g.style.transform = `rotate(${node._rot}deg)`; return; }
      node._rot = base + 360 * Math.max(3, Math.round(sp.dur)) + target;
      g.style.transition = 'none';
      g.getBoundingClientRect();
      g.style.transition = `transform ${left / 1000}s cubic-bezier(.12,.6,.12,1)`;
      g.style.transform = `rotate(${node._rot}deg)`;
      const res = node.querySelector('[data-res]');
      clearTimeout(node._resT);
      node._resT = setTimeout(() => { if (res) res.textContent = sp.t; }, left);
    }
    function render(s) {
      current = s;
      const seen = new Set();
      s.widgets.forEach((w) => {
        seen.add(w.id);
        let node = nodes.get(w.id);
        if (!node) {
          node = document.createElement('div');
          node.dataset.id = w.id;
          root.appendChild(node);
          nodes.set(w.id, node);
          drag(node);
        }
        node.className = `dk-w ch-w chk-${w.kind}${X.shows(w.vis, preview) ? ' is-on' : ''}${preview && w.vis === 'preview' ? ' is-pv' : ''}${node.classList.contains('is-dragging') ? ' is-dragging' : ''}`;
        const key = JSON.stringify([w, preview, w.kind === 'wheel' ? 0 : Math.floor(Date.now() / 1000)]);
        const html = inner(w, preview);
        if (node._html !== html || w.kind === 'wheel') {
          if (w.kind !== 'wheel' || node._wkey !== JSON.stringify([w.items, w.weighted, w.title, w.color])) {
            node._html = html; node.innerHTML = html; node._wkey = JSON.stringify([w.items, w.weighted, w.title, w.color]);
          }
          node._key = key;
        }
        if (!node.classList.contains('is-dragging')) { node.style.left = `${w.x}px`; node.style.top = `${w.y}px`; }
        node.dataset.lock = w.lock ? '1' : '';
        node.style.setProperty('--c', w.color);
        node.style.transform = `translate(-50%, -50%) scale(${w.scale})`;
        if (w.kind === 'wheel') spinWheel(node, w);
      });
      nodes.forEach((node, wid) => { if (!seen.has(wid)) { node.remove(); nodes.delete(wid); } });
    }
    // Running timers and race clocks tick here; everything else only changes when the state does
    setInterval(() => {
      if (!current) return;
      current.widgets.forEach((w) => {
        const node = nodes.get(w.id);
        if (!node) return;
        if (w.kind === 'timer' && w.running) { const t = node.querySelector('[data-timer]'); if (t) t.textContent = clock(X.timerNow(w)); }
        if (w.kind === 'race' && w.start) { const t = node.querySelector('[data-race]'); if (t) t.textContent = clock((Date.now() - w.start) / 1000); }
      });
    }, 250);
    return { el: { root }, render };
  }
  window.ChallengesOverlay = { mount, centreOf };
})();
