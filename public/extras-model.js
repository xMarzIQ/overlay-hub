/*
  The shape of the Canvas and Stream Desk overlays, shared by the server and the browser.
  normalize() always returns a complete, safe state, whatever it's given, so a bad save or message can't break a page.
*/
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ExtrasModel = factory();
}(typeof self !== 'undefined' ? self : this, () => {
  'use strict';
  const str = (v, n) => String(v == null ? '' : v).slice(0, n);
  const num = (v, lo, hi, d) => { const x = Number(v); return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d; };
  const arr = (v) => (Array.isArray(v) ? v : []);
  const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  const hex = (v, d) => (/^#[0-9a-f]{6}$/i.test(String(v)) ? String(v) : d);
  const id = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const POS = ['tl', 'tc', 'tr', 'ml', 'mc', 'mr', 'bl', 'bc', 'br'];
  const pos = (v, d) => (POS.includes(v) ? v : d);
  const size = (v) => (['s', 'm', 'l', 'xl'].includes(v) ? v : 'm');

  /* ---------- Canvas: pen, items, spotlight, music ---------- */
  const ITEM_TYPES = ['image', 'web', 'youtube', 'text', 'qr', 'pitch'];
  function canvasItem(raw) {
    const r = obj(raw);
    return {
      id: str(r.id, 16) || id(),
      type: ITEM_TYPES.includes(r.type) ? r.type : 'text',
      pos: pos(r.pos, 'mc'),
      size: size(r.size),
      z: num(r.z, 0, 99, 1),
      shown: r.shown !== false,
      src: str(r.src, 400),       // a media id for images, or a link for web pages, YouTube and QR codes
      text: str(r.text, 200),
      color: hex(r.color, '#ffffff'),
      until: num(r.until, 0, 1e15, 0), // timed items hide themselves at this time
    };
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
    return { v: 1, onAir: true, rev: 0, writer: '', items: [], strokes: [], spot: { on: false, x: 960, y: 540, r: 220 }, music: { id: '', playing: false, at: 0, vol: 70, loop: true }, boards: [] };
  }
  function canvasNormalize(raw) {
    const s = canvasDefaults();
    const r = obj(raw);
    s.onAir = r.onAir !== false;
    s.rev = num(r.rev, 0, 1e12, 0);
    s.writer = str(r.writer, 40);
    s.items = arr(r.items).slice(0, 50).map(canvasItem);
    s.strokes = arr(r.strokes).slice(-200).map(stroke);
    const sp = obj(r.spot);
    s.spot = { on: sp.on === true, x: num(sp.x, 0, 1920, 960), y: num(sp.y, 0, 1080, 540), r: num(sp.r, 60, 600, 220) };
    const mu = obj(r.music);
    s.music = { id: str(mu.id, 16), playing: mu.playing === true, at: num(mu.at, 0, 1e15, 0), vol: num(mu.vol, 0, 100, 70), loop: mu.loop !== false };
    s.boards = arr(r.boards).slice(0, 10).map((b) => ({ id: str(obj(b).id, 16) || id(), name: str(obj(b).name, 24) || 'Board', items: arr(obj(b).items).slice(0, 50).map(canvasItem), strokes: arr(obj(b).strokes).slice(-200).map(stroke) }));
    return s;
  }

  /* ---------- Stream Desk: timers, counters, text, lists, your own match scoreboard ---------- */
  const WIDGETS = ['timer', 'counter', 'text', 'list', 'match'];
  function widget(raw) {
    const r = obj(raw);
    const type = WIDGETS.includes(r.type) ? r.type : 'text';
    const w = { id: str(r.id, 16) || id(), type, title: str(r.title, 40), pos: pos(r.pos, 'tr'), size: size(r.size), shown: r.shown !== false };
    if (type === 'timer') Object.assign(w, { mode: ['down', 'up', 'to'].includes(r.mode) ? r.mode : 'down', base: num(r.base, 0, 864000, 300), dur: num(r.dur, 0, 864000, num(r.base, 0, 864000, 300)), running: r.running === true, at: num(r.at, 0, 1e15, 0), target: num(r.target, 0, 1e15, 0), end: str(r.end, 40) });
    if (type === 'counter') Object.assign(w, { value: num(r.value, -99999, 999999, 0), step: num(r.step, 1, 1000, 1), goal: num(r.goal, 0, 999999, 0) });
    if (type === 'text') Object.assign(w, { text: str(r.text, 300), style: r.style === 'ticker' ? 'ticker' : 'headline' });
    if (type === 'list') {
      Object.assign(w, { kind: ['todo', 'shopping', 'top', 'tier'].includes(r.kind) ? r.kind : 'todo', budget: num(r.budget, 0, 1e6, 0) });
      w.items = arr(r.items).slice(0, 30).map((x) => ({ t: str(obj(x).t, 60), done: obj(x).done === true, price: num(obj(x).price, 0, 1e6, 0), tier: ['S', 'A', 'B', 'C', 'D'].includes(obj(x).tier) ? obj(x).tier : 'B' }));
    }
    if (type === 'match') Object.assign(w, { a: str(r.a, 24) || 'Home', b: str(r.b, 24) || 'Away', sa: num(r.sa, 0, 99, 0), sb: num(r.sb, 0, 99, 0), w: num(r.w, 0, 9999, 0), d: num(r.d, 0, 9999, 0), l: num(r.l, 0, 9999, 0), squad: arr(r.squad).slice(0, 30).map((x) => str(x, 30)) });
    return w;
  }
  function deskDefaults() { return { v: 1, onAir: true, rev: 0, writer: '', widgets: [] }; }
  function deskNormalize(raw) {
    const s = deskDefaults();
    const r = obj(raw);
    s.onAir = r.onAir !== false;
    s.rev = num(r.rev, 0, 1e12, 0);
    s.writer = str(r.writer, 40);
    s.widgets = arr(r.widgets).slice(0, 12).map(widget);
    return s;
  }
  // Seconds left (or gone) on a timer right now
  function timerNow(w, now) {
    const t = now || Date.now();
    if (w.mode === 'to') return Math.max(0, Math.round((w.target - t) / 1000));
    const run = w.running ? Math.max(0, (t - w.at) / 1000) : 0;
    return w.mode === 'down' ? Math.max(0, Math.round(w.base - run)) : Math.round(w.base + run);
  }
  const fmt = (sec) => {
    const s = Math.max(0, Math.round(sec));
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const pad = (x) => String(x).padStart(2, '0');
    if (d) return `${d}d ${pad(h)}:${pad(m)}:${pad(s % 60)}`;
    if (h) return `${h}:${pad(m)}:${pad(s % 60)}`;
    return `${pad(m)}:${pad(s % 60)}`;
  };

  return { canvasDefaults, canvasNormalize, canvasItem, stroke, deskDefaults, deskNormalize, widget, timerNow, fmt, newId: id, POS };
}));
