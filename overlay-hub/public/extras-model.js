/*
  The shape of the Canvas and Stream Desk overlays, shared by the server and the browser.
  Every overlay has one of three states: off, preview (only in the hub) or live (on stream).
  Positions are free: x and y are the centre, in the 1920×1080 stream, and scale is the size.
  normalize() always returns a complete, safe state, whatever it's given.
*/
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ExtrasModel = factory();
}(typeof self !== 'undefined' ? self : this, () => {
  'use strict';
  const str = (v, n) => String(v == null ? '' : v).slice(0, n);
  // Missing or empty values fall back to the default (Number(null) would otherwise turn them into 0)
  const num = (v, lo, hi, d) => { if (v === null || v === undefined || v === '') return d; const x = Number(v); return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d; };
  const arr = (v) => (Array.isArray(v) ? v : []);
  const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  const hex = (v, d) => (/^#[0-9a-f]{6}$/i.test(String(v)) ? String(v) : d);
  const id = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const vis = (v, d) => (['off', 'preview', 'live'].includes(v) ? v : d);
  // Older saves used nine fixed places; they become positions
  const SLOT = { tl: [300, 140], tc: [960, 140], tr: [1620, 140], ml: [300, 540], mc: [960, 540], mr: [1620, 540], bl: [300, 940], bc: [960, 940], br: [1620, 940] };
  const SIZE = { s: 0.7, m: 1, l: 1.4, xl: 1.9 };
  function place(r, dx, dy) {
    const slot = SLOT[r.pos];
    return { x: num(r.x, 0, 1920, slot ? slot[0] : dx), y: num(r.y, 0, 1080, slot ? slot[1] : dy), scale: num(r.scale, 0.2, 4, SIZE[r.size] || 1) };
  }
  const oldVis = (r) => vis(r.vis, r.shown === true ? 'live' : 'off');

  /* ---------- Canvas: pen, items, spotlight, music ---------- */
  const ITEM_TYPES = ['image', 'web', 'youtube', 'text', 'qr', 'pitch'];
  function canvasItem(raw) {
    const r = obj(raw);
    return Object.assign({
      id: str(r.id, 16) || id(),
      type: ITEM_TYPES.includes(r.type) ? r.type : 'text',
      vis: oldVis(r),
      z: num(r.z, 0, 99, 1),
      src: str(r.src, 400),
      text: str(r.text, 200),
      color: hex(r.color, '#ffffff'),
      until: num(r.until, 0, 1e15, 0), // timed items turn themselves off at this time
    }, place(r, 960, 540));
  }
  function stroke(raw) {
    const r = obj(raw);
    return {
      id: str(r.id, 16) || id(),
      c: hex(r.c, '#ff3b5c'),
      w: num(r.w, 2, 40, 6),
      pts: arr(r.pts).slice(0, 400).map((p) => [Math.round(num(arr(p)[0], 0, 1920, 0)), Math.round(num(arr(p)[1], 0, 1080, 0))]),
      arrow: r.arrow === true,
      fade: r.fade === true,
      t: num(r.t, 0, 1e15, 0),
    };
  }
  function canvasDefaults() {
    return { v: 2, onAir: true, rev: 0, writer: '', items: [], strokes: [], ink: 'preview', spot: { on: false, x: 960, y: 540, r: 220 }, music: { id: '', playing: false, at: 0, vol: 70, loop: true }, boards: [] };
  }
  function canvasNormalize(raw) {
    const s = canvasDefaults();
    const r = obj(raw);
    s.onAir = true; // each item has its own state now
    s.rev = num(r.rev, 0, 1e12, 0);
    s.writer = str(r.writer, 40);
    s.items = arr(r.items).slice(0, 50).map(canvasItem);
    s.strokes = arr(r.strokes).slice(-200).map(stroke);
    s.ink = vis(r.ink, r.onAir === false ? 'off' : 'preview');
    const sp = obj(r.spot);
    s.spot = { on: sp.on === true, x: num(sp.x, 0, 1920, 960), y: num(sp.y, 0, 1080, 540), r: num(sp.r, 60, 600, 220) };
    const mu = obj(r.music);
    s.music = { id: str(mu.id, 16), playing: mu.playing === true, at: num(mu.at, 0, 1e15, 0), vol: num(mu.vol, 0, 100, 70), loop: mu.loop !== false };
    s.boards = arr(r.boards).slice(0, 10).map((b) => ({ id: str(obj(b).id, 16) || id(), name: str(obj(b).name, 24) || 'Board', items: arr(obj(b).items).slice(0, 50).map(canvasItem), strokes: arr(obj(b).strokes).slice(-200).map(stroke) }));
    return s;
  }

  /* ---------- Stream Desk: a fixed set of everyday widgets, bold floating text ---------- */
  const DESK = [
    { id: 'timer', type: 'timer', name: 'Timer', x: 1680, y: 90 },
    { id: 'countdown', type: 'countdown', name: 'Countdown', x: 960, y: 90 },
    { id: 'counter', type: 'counter', name: 'Counter', x: 1680, y: 190 },
    { id: 'text', type: 'text', name: 'Text', x: 960, y: 980 },
    { id: 'checklist', type: 'checklist', name: 'Checklist', x: 240, y: 420 },
    { id: 'budget', type: 'budget', name: 'Budget list', x: 1660, y: 520 },
    { id: 'clock', type: 'clock', name: 'Clock', x: 240, y: 90 },
  ];
  function widget(def, raw) {
    const r = obj(raw);
    const w = Object.assign({ id: def.id, type: def.type, vis: oldVis(r), label: str(r.label != null ? r.label : r.title, 40), color: hex(r.color, '#ffffff') }, place(Object.assign({}, r, r.x == null && !r.pos ? { x: def.x, y: def.y } : {}), def.x, def.y));
    if (def.type === 'timer') Object.assign(w, { mode: r.mode === 'up' ? 'up' : 'down', base: num(r.base, 0, 864000, 300), dur: num(r.dur, 0, 864000, num(r.base, 0, 864000, 300)), running: r.running === true, at: num(r.at, 0, 1e15, 0) });
    if (def.type === 'countdown') Object.assign(w, { target: num(r.target, 0, 1e15, 0), end: str(r.end, 40) });
    if (def.type === 'counter') Object.assign(w, { value: num(r.value, -99999, 999999, 0), step: num(r.step, 1, 1000, 1), goal: num(r.goal, 0, 999999, 0) });
    if (def.type === 'text') Object.assign(w, { text: str(r.text, 300), scroll: r.scroll === true || r.style === 'ticker' });
    if (def.type === 'checklist' || def.type === 'budget') {
      w.items = arr(r.items).slice(0, 20).map((x) => ({ t: str(obj(x).t, 60), done: obj(x).done === true, price: num(obj(x).price, 0, 1e6, 0) }));
      if (def.type === 'budget') w.budget = num(r.budget, 0, 1e6, 10);
    }
    if (def.type === 'clock') Object.assign(w, { tz: str(r.tz, 40) || 'Europe/London', seconds: r.seconds !== false });
    return w;
  }
  function deskDefaults() { return { v: 2, onAir: true, rev: 0, writer: '', widgets: DESK.map((d) => widget(d, {})) }; }
  function deskNormalize(raw) {
    const r = obj(raw);
    const given = arr(r.widgets);
    // Older saves: the first widget of each kind becomes that kind's widget
    const pick = (d) => given.find((w) => obj(w).id === d.id)
      || given.find((w) => obj(w).type === d.type)
      || (d.type === 'countdown' && given.find((w) => obj(w).type === 'timer' && obj(w).mode === 'to'))
      || (d.type === 'checklist' && given.find((w) => obj(w).type === 'list' && obj(w).kind === 'todo'))
      || (d.type === 'budget' && given.find((w) => obj(w).type === 'list' && obj(w).kind === 'shopping'))
      || {};
    return { v: 2, onAir: true, rev: num(r.rev, 0, 1e12, 0), writer: str(r.writer, 40), widgets: DESK.map((d) => widget(d, pick(d))) };
  }
  // Seconds left (or gone) on a timer right now
  function timerNow(w, now) {
    const t = now || Date.now();
    if (w.type === 'countdown') return Math.max(0, Math.round((w.target - t) / 1000));
    const run = w.running ? Math.max(0, (t - w.at) / 1000) : 0;
    return w.mode === 'down' ? Math.max(0, Math.round(w.base - run)) : Math.round(w.base + run);
  }
  // Always xx:xx:xx
  const fmt = (sec) => {
    const s = Math.max(0, Math.round(sec));
    const pad = (x) => String(x).padStart(2, '0');
    return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
  };
  // What the hub's preview shows: live things, plus things in preview
  const shows = (v, inHub) => v === 'live' || (inHub && v === 'preview');

  /* ---------- Chat Games: poll, Contexto, flag game, giveaway, scavenger hunt ---------- */
  const GAME_SPOT = { poll: [1540, 330], contexto: [1540, 760], flags: [960, 470], give: [960, 150], hunt: [340, 600] };
  const name = (u) => str(u, 30);
  function gamesNormalize(raw) {
    const r = obj(raw);
    const base = (k, g) => Object.assign({ vis: vis(g.vis, 'off'), color: hex(g.color, '#ffffff') }, place(g, GAME_SPOT[k][0], GAME_SPOT[k][1]));
    const p = obj(r.poll);
    const c = obj(r.contexto);
    const f = obj(r.flags);
    const g = obj(r.give);
    const h = obj(r.hunt);
    const size = [3, 4, 5].includes(h.size) ? h.size : 3;
    return {
      v: 1, onAir: true, rev: num(r.rev, 0, 1e12, 0), writer: str(r.writer, 40),
      mode: r.mode === 'bang' ? 'bang' : 'word', // any single word counts, or only "!g word"
      poll: Object.assign(base('poll', p), { q: str(p.q, 120), opts: [0, 1, 2, 3].map((i) => str(arr(p.opts)[i], 40)), open: p.open === true, votes: [0, 1, 2, 3].map((i) => num(arr(p.votes)[i], 0, 1e6, 0)), reset: num(p.reset, 0, 1e9, 0) }),
      contexto: Object.assign(base('contexto', c), { open: c.open === true, round: num(c.round, 0, 1e9, 0), count: num(c.count, 0, 1e7, 0), hint: num(c.hint, 0, 1e9, 0),
        guesses: arr(c.guesses).slice(0, 10).map((x) => ({ w: str(obj(x).w, 20), r: num(obj(x).r, 1, 1e6, 1), u: name(obj(x).u) })),
        last: obj(c.last).w ? { w: str(obj(c.last).w, 20), r: num(obj(c.last).r, 1, 1e6, 1), u: name(obj(c.last).u) } : null,
        winner: obj(c.winner).u ? { u: name(obj(c.winner).u), w: str(obj(c.winner).w, 20) } : null }),
      flags: Object.assign(base('flags', f), { open: f.open === true, round: num(f.round, 0, 1e9, 0), code: str(f.code, 8).replace(/[^a-z-]/g, ''), auto: f.auto !== false, boardReset: num(f.boardReset, 0, 1e9, 0),
        winner: obj(f.winner).u ? { u: name(obj(f.winner).u), name: str(obj(f.winner).name, 60) } : null,
        board: arr(f.board).slice(0, 10).map((x) => ({ u: name(obj(x).u), pts: num(obj(x).pts, 0, 1e6, 0) })) }),
      give: Object.assign(base('give', g), { title: str(g.title, 40) || 'Giveaway', word: str(g.word, 20) || '!join', open: g.open === true, entries: num(g.entries, 0, 1e6, 0), winner: name(g.winner), draw: num(g.draw, 0, 1e9, 0), reset: num(g.reset, 0, 1e9, 0) }),
      hunt: Object.assign(base('hunt', h), { title: str(h.title, 40) || 'Scavenger hunt', size, cells: Array.from({ length: size * size }, (_, i) => ({ t: str(obj(arr(h.cells)[i]).t, 40), found: obj(arr(h.cells)[i]).found === true })) }),
    };
  }
  const gamesDefaults = () => gamesNormalize({});

  return { gamesDefaults, gamesNormalize, canvasDefaults, canvasNormalize, canvasItem, stroke, deskDefaults, deskNormalize, widget, timerNow, fmt, shows, newId: id, DESK };
}));
