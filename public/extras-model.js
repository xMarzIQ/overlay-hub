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
    return { x: num(r.x, 0, 1920, slot ? slot[0] : dx), y: num(r.y, 0, 1080, slot ? slot[1] : dy), scale: num(r.scale, 0.2, 4, SIZE[r.size] || 1), lock: r.lock === true };
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
      // Tactics pitch: player counters for each team (t 0 or 1), placed in metres on a 105 x 68 pitch
      men: arr(r.men).slice(0, 30).map((m) => ({ t: obj(m).t === 1 ? 1 : 0, n: str(obj(m).n, 3), x: num(obj(m).x, 0, 105, 52), y: num(obj(m).y, 0, 68, 34) })),
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
    s.music = { id: str(mu.id, 16), playing: false, at: num(mu.at, 0, 1e15, 0), vol: num(mu.vol, 0, 100, 70), loop: mu.loop !== false };
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
  function deskDefaults() { return { v: 2, onAir: true, rev: 0, writer: '', widgets: DESK.map((d) => widget(d, {})), rundown: rundownNormalize({}) }; }
  /* Stream Desk running order: plans (segments) kept separate from what actually happened (the session log).
     "pub" is the only part the OBS page ever gets: the current and next titles and the timing. */
  const roLog = (e) => ({ title: str(obj(e).title, 60), planned: num(obj(e).planned, 0, 1440, 0), start: num(obj(e).start, 0, 1e15, 0), end: num(obj(e).end, 0, 1e15, 0), skipped: obj(e).skipped === true });
  function rundownNormalize(raw) {
    const r = obj(raw), s = obj(r.session), pb = obj(r.pub);
    const seg = (x) => ({ id: str(obj(x).id, 12) || id(), title: str(obj(x).title, 60) || 'Segment', desc: str(obj(x).desc, 200), mins: num(obj(x).mins, 0, 1440, 10),
      note: str(obj(x).note, 400), who: str(obj(x).who, 40), kind: obj(x).kind === 'break' ? 'break' : 'seg', at: /^\d\d:\d\d$/.test(obj(x).at) ? obj(x).at : '',
      checks: arr(obj(x).checks).slice(0, 12).map((c) => ({ t: str(obj(c).t, 80), done: obj(c).done === true })) });
    return {
      lists: arr(r.lists).slice(0, 12).map((l) => ({ id: str(obj(l).id, 12) || id(), name: str(obj(l).name, 50) || 'Running order', segs: arr(obj(l).segs).slice(0, 40).map(seg) })),
      cur: str(r.cur, 12),
      session: s.on === true ? { on: true, list: str(s.list, 12), i: num(s.i, 0, 39, 0), start: num(s.start, 0, 1e15, 0), segStart: num(s.segStart, 0, 1e15, 0),
        paused: num(s.paused, 0, 1e15, 0), pausedMs: num(s.pausedMs, 0, 1e12, 0), log: arr(s.log).slice(0, 80).map(roLog) } : { on: false },
      past: arr(r.past).slice(0, 20).map((p) => ({ name: str(obj(p).name, 50), start: num(obj(p).start, 0, 1e15, 0), end: num(obj(p).end, 0, 1e15, 0), log: arr(obj(p).log).slice(0, 80).map(roLog) })),
      pub: { on: pb.on === true, now: str(pb.now, 60), next: str(pb.next, 60), mins: num(pb.mins, 0, 1440, 0), segStart: num(pb.segStart, 0, 1e15, 0), paused: num(pb.paused, 0, 1e15, 0), pausedMs: num(pb.pausedMs, 0, 1e12, 0) },
      look: Object.assign({ vis: vis(obj(r.look).vis, 'off'), color: hex(obj(r.look).color, '#ffffff') }, place(obj(r.look), 1640, 980)),
      remind: num(r.remind, 0, 60, 2),
    };
  }
  // How long the current segment has run (paused time left out), from saved times so every page agrees
  const roElapsed = (p, now) => (p.segStart ? Math.max(0, ((p.paused || now || Date.now()) - p.segStart - p.pausedMs) / 1000) : 0);

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
    return { v: 2, onAir: true, rev: num(r.rev, 0, 1e12, 0), writer: str(r.writer, 40), widgets: DESK.map((d) => widget(d, pick(d))), rundown: rundownNormalize(r.rundown) };
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
  const GAME_SPOT = { poll: [1540, 330], contexto: [1540, 760], flags: [960, 470], give: [960, 150], hunt: [340, 600], board: [1640, 260] };
  const name = (u) => str(u, 30);
  function gamesNormalize(raw) {
    const r = obj(raw);
    const base = (k, g) => Object.assign({ vis: vis(g.vis, 'off'), color: hex(g.color, '#ffffff') }, place(g, GAME_SPOT[k][0], GAME_SPOT[k][1]));
    const p = obj(r.poll);
    const c = obj(r.contexto);
    const f = obj(r.flags);
    const g = obj(r.give);
    const h = obj(r.hunt);
    const lb = obj(r.board);
    const size = [3, 4, 5].includes(h.size) ? h.size : 3;
    return {
      v: 1, onAir: true, rev: num(r.rev, 0, 1e12, 0), writer: str(r.writer, 40),
      mode: r.mode === 'bang' ? 'bang' : 'word', // any single word counts, or only "!g word"
      cool: [0, 2, 5].includes(r.cool) ? r.cool : 2, // seconds each person waits between guesses (stops spam-guessing)
      poll: Object.assign(base('poll', p), { q: str(p.q, 120), opts: [0, 1, 2, 3].map((i) => str(arr(p.opts)[i], 40)), open: p.open === true, votes: [0, 1, 2, 3].map((i) => num(arr(p.votes)[i], 0, 1e6, 0)), reset: num(p.reset, 0, 1e9, 0) }),
      contexto: Object.assign(base('contexto', c), { open: c.open === true, round: num(c.round, 0, 1e9, 0), count: num(c.count, 0, 1e7, 0), hint: num(c.hint, 0, 1e9, 0), reveal: num(c.reveal, 0, 1e9, 0), revealed: str(c.revealed, 20),
        guesses: arr(c.guesses).slice(0, 10).map((x) => ({ w: str(obj(x).w, 20), r: num(obj(x).r, 1, 1e6, 1), u: name(obj(x).u) })),
        last: obj(c.last).w ? { w: str(obj(c.last).w, 20), r: num(obj(c.last).r, 1, 1e6, 1), u: name(obj(c.last).u) } : null,
        winner: obj(c.winner).u ? { u: name(obj(c.winner).u), w: str(obj(c.winner).w, 20) } : null }),
      flags: Object.assign(base('flags', f), { open: f.open === true, round: num(f.round, 0, 1e9, 0), code: str(f.code, 8).replace(/[^a-z-]/g, ''), name: str(f.name, 60), auto: f.auto !== false, boardReset: num(f.boardReset, 0, 1e9, 0),
        winner: obj(f.winner).u ? { u: name(obj(f.winner).u), name: str(obj(f.winner).name, 60) } : null,
        board: arr(f.board).slice(0, 10).map((x) => ({ u: name(obj(x).u), pts: num(obj(x).pts, 0, 1e6, 0) })) }),
      give: Object.assign(base('give', g), { title: str(g.title, 40) || 'Giveaway', word: str(g.word, 20) || '!join', open: g.open === true, entries: num(g.entries, 0, 1e6, 0), winner: name(g.winner), draw: num(g.draw, 0, 1e9, 0), reset: num(g.reset, 0, 1e9, 0) }),
      board: Object.assign(base('board', lb), { title: str(lb.title, 40) || 'Leaderboard', reset: num(lb.reset, 0, 1e9, 0),
        list: arr(lb.list).slice(0, 10).map((x) => ({ u: name(obj(x).u), pts: num(obj(x).pts, 0, 1e6, 0) })) }),
      hunt: Object.assign(base('hunt', h), { title: str(h.title, 40) || 'Scavenger hunt', size, cells: Array.from({ length: size * size }, (_, i) => ({ t: str(obj(arr(h.cells)[i]).t, 40), found: obj(arr(h.cells)[i]).found === true })) }),
    };
  }
  const gamesDefaults = () => gamesNormalize({});

  /* ---------- Challenges: any number of challenge pieces, each with its own place, size, colour and visibility ---------- */
  const CH_KINDS = ['bingo', 'wheel', 'tracker', 'checklist', 'counter', 'versus', 'budget', 'lives', 'timer', 'forfeits', 'mystery', 'race', 'milestones', 'generator', 'teams', 'leaderboard'];
  const CH_NAME = { bingo: 'Bingo / scavenger hunt', wheel: 'Random wheel', tracker: 'Challenge tracker', checklist: 'Checklist', counter: 'Counter', versus: 'Versus', budget: 'Budget challenge', lives: 'Lives', timer: 'Challenge timer', forfeits: 'Forfeits', mystery: 'Mystery challenges', race: 'Challenge race', milestones: 'Milestones', generator: 'Random challenge', teams: 'Team generator', leaderboard: 'Leaderboard' };
  const CH_STATES = ['open', 'done', 'failed', 'skipped', 'cancelled', 'unlocked'];
  function chItem(raw) {
    const r = obj(raw);
    return { id: str(r.id, 12) || id(), t: str(r.t, 80), s: CH_STATES.includes(r.s) ? r.s : 'open', p: num(r.p, -1e6, 1e6, 0), n: num(r.n, -1e9, 1e9, 0), l: num(r.l, 0, 1e6, 0),
      who: str(r.who, 40), d: ['easy', 'medium', 'hard'].includes(r.d) ? r.d : '', cat: str(r.cat, 30), at: num(r.at, 0, 1e15, 0), tgt: num(r.tgt, 0, 1e9, 0),
      w: num(r.w, 0, 100, 1), on: r.on !== false, hide: r.hide === true, rep: r.rep === true, pen: num(r.pen, -3600, 3600, 0) };
  }
  function chWidget(raw) {
    const r = obj(raw);
    const kind = CH_KINDS.includes(r.kind) ? r.kind : 'counter';
    const w = Object.assign({ id: str(r.id, 12) || id(), kind, title: str(r.title, 60), vis: vis(r.vis, 'off'), color: hex(r.color, '#ffffff') }, place(r, 960, 540));
    w.items = arr(r.items).slice(0, 80).map(chItem);
    const show = obj(r.show);
    if (kind === 'bingo') {
      w.size = [3, 4, 5].includes(r.size) ? r.size : 3;
      w.free = r.free === true;
      w.rule = ['none', 'line', 'all', 'count'].includes(r.rule) ? r.rule : 'none';
      w.ruleN = num(r.ruleN, 1, 25, 5);
      w.cells = Array.from({ length: w.size * w.size }, (_, i) => { const c = obj(arr(r.cells)[i]); return { t: str(c.t, 60), done: c.done === true, at: num(c.at, 0, 1e15, 0), d: str(c.d, 120), p: num(c.p, 0, 1e6, 0) }; });
      w.show = { pct: show.pct !== false, left: show.left !== false };
    } else if (kind === 'wheel') {
      w.weighted = r.weighted === true;
      w.dur = num(r.dur, 2, 20, 6);
      w.removeWin = r.removeWin === true;
      const sp = obj(r.spin);
      w.spin = sp.id ? { id: str(sp.id, 16), i: num(sp.i, 0, 80, 0), t: str(sp.t, 80), at: num(sp.at, 0, 1e15, 0), dur: num(sp.dur, 1, 30, 6), test: sp.test === true } : null;
      w.hist = arr(r.hist).slice(0, 30).map((h) => ({ t: str(obj(h).t, 80), at: num(obj(h).at, 0, 1e15, 0), test: obj(h).test === true }));
    } else if (kind === 'counter') {
      w.value = num(r.value, -1e9, 1e9, 0); w.step = num(r.step, 1, 1e6, 1); w.start = num(r.start, -1e9, 1e9, 0);
      w.min = r.min === '' || r.min == null ? null : num(r.min, -1e9, 1e9, 0); w.max = r.max === '' || r.max == null ? null : num(r.max, -1e9, 1e9, 0);
      w.target = num(r.target, 0, 1e9, 0); w.group = str(r.group, 30);
    } else if (kind === 'versus') {
      w.step = num(r.step, 1, 1e6, 1); w.target = num(r.target, 0, 1e9, 0); w.showWinner = r.showWinner === true; w.round = num(r.round, 1, 999, 1);
    } else if (kind === 'budget') {
      w.start = num(r.start, 0, 1e9, 50); w.cur = str(r.cur, 4) || '£'; w.warn = r.warn !== false;
    } else if (kind === 'lives') {
      w.max = num(r.max, 1, 99, 3); w.left = num(r.left, 0, 99, w.max); w.unlimited = r.unlimited === true; w.out = r.out !== false;
    } else if (kind === 'timer') {
      w.mode = r.mode === 'down' ? 'down' : 'up'; w.dur = num(r.dur, 1, 360000, 600); w.base = num(r.base, -360000, 360000, w.mode === 'down' ? w.dur : 0);
      w.running = r.running === true; w.at = num(r.at, 0, 1e15, 0);
      w.laps = arr(r.laps).slice(0, 50).map((x) => num(x, 0, 360000, 0));
    } else if (kind === 'race') {
      w.start = num(r.start, 0, 1e15, 0);
    } else if (kind === 'generator' || kind === 'forfeits' || kind === 'mystery') {
      w.pick = str(r.pick, 12);
      w.hist = arr(r.hist).slice(0, 30).map((h) => str(h, 12));
    } else if (kind === 'teams') {
      w.count = num(r.count, 2, 8, 2);
      w.teams = arr(r.teams).slice(0, 8).map((t) => ({ name: str(obj(t).name, 30), who: arr(obj(t).who).slice(0, 40).map((x) => str(x, 40)) }));
    }
    if (['tracker', 'checklist', 'leaderboard', 'race', 'versus', 'milestones'].includes(kind)) w.show = { list: show.list !== false, stats: show.stats !== false };
    return w;
  }
  function challengesNormalize(raw) {
    const r = obj(raw);
    return { v: 1, onAir: true, rev: num(r.rev, 0, 1e12, 0), writer: str(r.writer, 40),
      widgets: arr(r.widgets).slice(0, 30).map(chWidget),
      // Saved, reusable grids, wheels and lists
      lib: arr(r.lib).slice(0, 40).map((x) => ({ id: str(obj(x).id, 12) || id(), name: str(obj(x).name, 40), kind: CH_KINDS.includes(obj(x).kind) ? obj(x).kind : 'tracker', data: obj(obj(x).data) })) };
  }
  const challengesDefaults = () => challengesNormalize({});
  // A timer's seconds right now, from its saved start time (stays right after refreshes and restarts)

  /* ---------- Media Centre: music, playlists, soundboard, slideshows, sponsors, GIFs and the mixer ---------- */
  const mid = (v) => str(v, 16).replace(/[^A-Za-z0-9_-]/g, '');
  const ids = (v, n) => arr(v).slice(0, n).map(mid).filter(Boolean);
  function mediaNormalize(raw) {
    const r = obj(raw);
    const mx = obj(r.mixer), mu = obj(r.music), sp = obj(r.sponsor), fi = obj(r.fire);
    const vols = {};
    Object.entries(obj(mu.vols)).slice(0, 200).forEach(([k, v]) => { if (mid(k)) vols[mid(k)] = num(v, 0, 100, 100); });
    const box = (x, dx, dy) => Object.assign({ vis: vis(x.vis, 'off'), color: hex(x.color, '#ffffff') }, place(x, dx, dy));
    return {
      v: 1, onAir: true, rev: num(r.rev, 0, 1e12, 0), writer: str(r.writer, 40),
      mixer: { master: num(mx.master, 0, 100, 100), music: num(mx.music, 0, 100, 70), sfx: num(mx.sfx, 0, 100, 100), mute: mx.mute === true, duck: mx.duck !== false },
      // Music: the queue, which track, and where playback is (from a saved start time, so every OBS page agrees)
      music: { q: ids(mu.q, 200), i: num(mu.i, 0, 199, 0), playing: mu.playing === true, at: num(mu.at, 0, 1e15, 0), pos: num(mu.pos, 0, 36000, 0),
        shuffle: mu.shuffle === true, repeat: ['off', 'one', 'all'].includes(mu.repeat) ? mu.repeat : 'all', vols, seq: num(mu.seq, 0, 1e9, 0) },
      playlists: arr(r.playlists).slice(0, 20).map((p) => ({ id: mid(obj(p).id) || id(), name: str(obj(p).name, 40) || 'Playlist', ids: ids(obj(p).ids, 200) })),
      sounds: arr(r.sounds).slice(0, 60).map((x) => ({ id: mid(obj(x).id) || id(), media: mid(obj(x).media), name: str(obj(x).name, 40), cat: str(obj(x).cat, 30), fav: obj(x).fav === true, vol: num(obj(x).vol, 0, 100, 100), cool: num(obj(x).cool, 0, 600, 0) })),
      overlap: r.overlap !== false,
      // A sound plays only when someone presses it: the hub sets fire, the OBS page plays it once
      fire: fi.id ? { id: mid(fi.id), sound: mid(fi.sound), at: num(fi.at, 0, 1e15, 0) } : null,
      stopSeq: num(r.stopSeq, 0, 1e9, 0),
      shows: arr(r.shows).slice(0, 10).map((x) => Object.assign(box(obj(x), 1500, 300), { id: mid(obj(x).id) || id(), name: str(obj(x).name, 40) || 'Slideshow', ids: ids(obj(x).ids, 100),
        dur: num(obj(x).dur, 2, 600, 8), playing: obj(x).playing === true, at: num(obj(x).at, 0, 1e15, 0), i: num(obj(x).i, 0, 99, 0), shuffle: obj(x).shuffle === true, repeat: obj(x).repeat !== false })),
      sponsor: Object.assign(box(sp, 1680, 960), { items: arr(sp.items).slice(0, 30).map((x) => ({ media: mid(obj(x).media), name: str(obj(x).name, 40), on: obj(x).on !== false })),
        show: num(sp.show, 3, 120, 10), every: num(sp.every, 10, 3600, 120), rotating: sp.rotating === true, at: num(sp.at, 0, 1e15, 0), trig: num(sp.trig, 0, 1e15, 0) }),
      gifs: arr(r.gifs).slice(0, 10).map((x) => Object.assign(box(obj(x), 960, 540), { id: mid(obj(x).id) || id(), media: mid(obj(x).media), loop: obj(x).loop !== false, dur: num(obj(x).dur, 1, 600, 5), at: num(obj(x).at, 0, 1e15, 0) })),
      hist: arr(r.hist).slice(0, 20).map((h) => ({ t: str(obj(h).t, 40), at: num(obj(h).at, 0, 1e15, 0) })),
    };
  }
  const mediaDefaults = () => mediaNormalize({});
  // Which sponsor shows right now (or none), from the rotation's start time; manual triggers show the next one
  function sponsorNow(sp, now) {
    const on = sp.items.filter((x) => x.on && x.media);
    if (!on.length) return null;
    const t = now || Date.now();
    if (sp.trig && t - sp.trig < sp.show * 1000) return on[Math.floor(sp.trig / 1000) % on.length];
    if (!sp.rotating || !sp.at) return null;
    const cycle = Math.floor((t - sp.at) / (sp.every * 1000));
    const into = (t - sp.at) - cycle * sp.every * 1000;
    return into < sp.show * 1000 ? on[cycle % on.length] : null;
  }
  // A slideshow's current picture: rotates from its start time while playing
  function slideNow(x, now) {
    if (!x.ids.length) return '';
    let k = x.i;
    if (x.playing && x.at) { const step = Math.floor(((now || Date.now()) - x.at) / (x.dur * 1000)); k = x.repeat ? x.i + step : Math.min(x.i + step, x.ids.length - 1); }
    if (x.shuffle) { const order = x.ids.map((m, j) => [m, Math.sin((j + 1) * (x.at % 997 + 1)) * 10000 % 1]).sort((a, b) => a[1] - b[1]).map((p) => p[0]); return order[((k % order.length) + order.length) % order.length]; }
    return x.ids[((k % x.ids.length) + x.ids.length) % x.ids.length];
  }

  /* ---------- Subathon & Goals ---------- */
  const SB_RULES = ['t1', 't2', 't3', 'prime', 'gift', 'resub', 'bits', 'follow', 'donation', 'custom'];
  const SB_DEFAULT = { t1: [300, 1], t2: [600, 2], t3: [1500, 5], prime: [300, 1], gift: [300, 1], resub: [300, 1], bits: [60, 0], follow: [0, 0], donation: [60, 0], custom: [60, 1] };
  const SB_SOURCES = ['subs', 'points', 'gifts', 'bits', 'follows', 'money', 'custom'];
  function subathonNormalize(raw) {
    const r = obj(raw);
    const t = obj(r.timer), sl = obj(r.sleep), sp = obj(r.spins), bo = obj(r.bonus), c = obj(r.counts);
    const look = (x, dx, dy) => Object.assign({ vis: vis(obj(x).vis, 'off'), color: hex(obj(x).color, '#ffffff') }, place(obj(x), dx, dy));
    const rules = {};
    SB_RULES.forEach((k) => { const x = obj(obj(r.rules)[k]); rules[k] = { on: x.on !== false, secs: num(x.secs, 0, 86400, SB_DEFAULT[k][0]), prog: num(x.prog, 0, 1000, SB_DEFAULT[k][1]), max: num(x.max, 0, 864000, 0), mult: num(x.mult, 0, 100, 1) }; });
    return {
      v: 1, onAir: true, rev: num(r.rev, 0, 1e12, 0), writer: str(r.writer, 40),
      // The timer runs on the server from saved times: end is when it reaches zero while running; left is what remains while paused
      timer: Object.assign(look(t, 1700, 120), { title: str(t.title, 40) || 'Subathon', state: ['idle', 'running', 'paused', 'grace', 'ended'].includes(t.state) ? t.state : 'idle',
        end: num(t.end, 0, 1e15, 0), left: num(t.left, 0, 1e8, 0), start: num(t.start, 0, 1e15, 0), added: num(t.added, -1e8, 1e8, 0), first: num(t.first, 0, 1e8, 0),
        max: num(t.max, 0, 1e8, 0), min: num(t.min, 0, 1e8, 0), grace: num(t.grace, 0, 3600, 0), graceEnd: num(t.graceEnd, 0, 1e15, 0), autoEnd: t.autoEnd === true, sleepPaused: t.sleepPaused === true }),
      mode: ['normal', 'sleep', 'break'].includes(r.mode) ? r.mode : 'normal',
      sleep: { pause: sl.pause === true, collect: sl.collect !== false, queue: sl.queue === true, mult: num(sl.mult, 0, 10, 1) },
      queued: num(r.queued, 0, 1e8, 0),
      rules,
      bonus: { mult: num(bo.mult, 1, 10, 2), prog: num(bo.prog, 1, 10, 1), types: arr(bo.types).filter((x) => SB_RULES.includes(x)).slice(0, 10), until: num(bo.until, 0, 1e15, 0), from: num(bo.from, 0, 1e15, 0), mins: num(bo.mins, 1, 1440, 30) },
      goals: arr(r.goals).slice(0, 12).map((g) => Object.assign(look(g, 960, 120), { id: str(obj(g).id, 12) || id(), name: str(obj(g).name, 40) || 'Goal', src: SB_SOURCES.includes(obj(g).src) ? obj(g).src : 'subs',
        start: num(obj(g).start, -1e9, 1e9, 0), cur: num(obj(g).cur, -1e9, 1e9, 0), target: num(obj(g).target, 1, 1e9, 10), deadline: num(obj(g).deadline, 0, 1e15, 0), unit: str(obj(g).unit, 4) })),
      milestones: arr(r.milestones).slice(0, 30).map((m) => ({ id: str(obj(m).id, 12) || id(), name: str(obj(m).name, 60), src: SB_SOURCES.includes(obj(m).src) ? obj(m).src : 'subs', target: num(obj(m).target, 1, 1e9, 10),
        reward: str(obj(m).reward, 80), s: ['locked', 'unlocked', 'done', 'skipped'].includes(obj(m).s) ? obj(m).s : 'locked', auto: obj(m).auto !== false, rep: obj(m).rep === true, times: num(obj(m).times, 0, 1e6, 0), at: num(obj(m).at, 0, 1e15, 0) })),
      mlook: look(r.mlook, 240, 520),
      spins: Object.assign(look(sp, 240, 860), { owed: num(sp.owed, 0, 9999, 0), done: num(sp.done, 0, 1e6, 0), perSubs: num(sp.perSubs, 0, 1000, 0), perBits: num(sp.perBits, 0, 1e6, 0), perMilestone: sp.perMilestone === true, wheel: str(sp.wheel, 12),
        hist: arr(sp.hist).slice(0, 30).map((h) => ({ t: str(obj(h).t, 80), at: num(obj(h).at, 0, 1e15, 0) })) }),
      blook: look(r.blook, 1680, 600),
      counts: { subs: num(c.subs, 0, 1e9, 0), resubs: num(c.resubs, 0, 1e9, 0), gifts: num(c.gifts, 0, 1e9, 0), bits: num(c.bits, 0, 1e12, 0), follows: num(c.follows, 0, 1e9, 0), points: num(c.points, 0, 1e9, 0), money: num(c.money, 0, 1e9, 0), custom: num(c.custom, 0, 1e9, 0) },
      // Every contribution, automatic or manual, with what it added; corrections are marked, never silently changed
      hist: arr(r.hist).slice(0, 400).map((h) => ({ id: str(obj(h).id, 40), kind: str(obj(h).kind, 12), user: str(obj(h).user, 40), tier: str(obj(h).tier, 6), qty: num(obj(h).qty, -1e9, 1e9, 0),
        secs: num(obj(h).secs, -1e8, 1e8, 0), prog: num(obj(h).prog, -1e9, 1e9, 0), at: num(obj(h).at, 0, 1e15, 0), src: obj(h).src === 'manual' ? 'manual' : obj(h).src === 'note' ? 'note' : 'auto', fixed: obj(h).fixed === true, note: str(obj(h).note, 80),
        gd: arr(obj(h).gd).slice(0, 12).map((x) => [str(arr(x)[0], 12), num(arr(x)[1], -1e9, 1e9, 0)]), cd: Object.fromEntries(Object.entries(obj(obj(h).cd)).filter(([k]) => ['subs', 'resubs', 'gifts', 'bits', 'follows', 'points', 'money', 'custom'].includes(k)).map(([k, v]) => [k, num(v, -1e12, 1e12, 0)])) })),
      sessions: arr(r.sessions).slice(0, 20).map((x) => ({ id: str(obj(x).id, 12) || id(), start: num(obj(x).start, 0, 1e15, 0), end: num(obj(x).end, 0, 1e15, 0), subs: num(obj(x).subs, 0, 1e9, 0), gifts: num(obj(x).gifts, 0, 1e9, 0),
        bits: num(obj(x).bits, 0, 1e12, 0), added: num(obj(x).added, -1e8, 1e8, 0), milestones: num(obj(x).milestones, 0, 1e6, 0), spins: num(obj(x).spins, 0, 1e6, 0), peak: num(obj(x).peak, 0, 1e9, 0) })),
      warn: obj(r.warn).gap ? { gap: true, since: num(obj(r.warn).since, 0, 1e15, 0) } : null,
    };
  }
  const subathonDefaults = () => subathonNormalize({});
  // Seconds left on the timer right now (server-authoritative: worked out from saved times)
  function subLeft(t, now) {
    const n = now || Date.now();
    if (t.state === 'running') return Math.max(0, (t.end - n) / 1000);
    if (t.state === 'paused') return t.left;
    if (t.state === 'grace') return 0;
    return t.state === 'idle' ? t.first : 0;
  }

  /* ---------- Twitch Centre: saved settings and history (the live numbers come from the server) ---------- */
  const TW_ALERTS = ['follow', 'sub', 'resub', 'gift', 'bits', 'raid', 'redeem'];
  function twitchNormalize(raw) {
    const r = obj(raw);
    const al = obj(r.alerts), d = obj(r.dash), pl = obj(r.plook);
    const list = (v, n, f) => arr(v).slice(0, n).map((x) => f(obj(x)));
    const on = {};
    TW_ALERTS.forEach((k) => { on[k] = obj(al.on)[k] === true; }); // every alert starts Off
    return {
      v: 1, onAir: true, rev: num(r.rev, 0, 1e12, 0), writer: str(r.writer, 40),
      dash: { live: d.live === true, viewers: num(d.viewers, 0, 1e8, 0), started: num(d.started, 0, 1e15, 0), title: str(d.title, 140), cat: str(d.cat, 80), catId: str(d.catId, 20),
        followers: num(d.followers, -1, 1e10, -1), subs: num(d.subs, -1, 1e10, -1), at: num(d.at, 0, 1e15, 0), err: str(d.err, 120),
        poll: d.poll && obj(d.poll).id ? { id: str(d.poll.id, 60), title: str(d.poll.title, 60), status: str(d.poll.status, 20), ends: num(d.poll.ends, 0, 1e15, 0), choices: list(d.poll.choices, 5, (c) => ({ id: str(c.id, 60), t: str(c.t, 25), v: num(c.v, 0, 1e9, 0) })) } : null,
        pred: d.pred && obj(d.pred).id ? { id: str(d.pred.id, 60), title: str(d.pred.title, 45), status: str(d.pred.status, 20), ends: num(d.pred.ends, 0, 1e15, 0), outs: list(d.pred.outs, 10, (c) => ({ id: str(c.id, 60), t: str(c.t, 25), users: num(c.users, 0, 1e9, 0), pts: num(c.pts, 0, 1e12, 0) })) } : null },
      titleFav: list(r.titleFav, 15, (x) => ({ t: str(x.t, 140) })).filter((x) => x.t),
      titleHist: list(r.titleHist, 30, (x) => ({ t: str(x.t, 140), by: str(x.by, 40), at: num(x.at, 0, 1e15, 0), ok: x.ok !== false })),
      catFav: list(r.catFav, 15, (x) => ({ id: str(x.id, 20), name: str(x.name, 80) })).filter((x) => x.id),
      catHist: list(r.catHist, 30, (x) => ({ id: str(x.id, 20), name: str(x.name, 80), by: str(x.by, 40), at: num(x.at, 0, 1e15, 0) })),
      clips: list(r.clips, 200, (x) => ({ id: str(x.id, 80), url: str(x.url, 200), at: num(x.at, 0, 1e15, 0), by: str(x.by, 40), title: str(x.title, 100), note: str(x.note, 200), cat: str(x.cat, 30), fav: x.fav === true, state: ['pending', 'ready', 'failed'].includes(x.state) ? x.state : 'ready' })).filter((x) => x.id),
      markers: list(r.markers, 300, (x) => ({ id: str(x.id, 80), desc: str(x.desc, 140), cat: str(x.cat, 30), pos: num(x.pos, 0, 1e7, 0), at: num(x.at, 0, 1e15, 0), by: str(x.by, 40), stream: str(x.stream, 20) })).filter((x) => x.id),
      alerts: Object.assign({ vis: vis(al.vis, 'off'), color: hex(al.color, '#2ee59d') }, place(al, 960, 260), { on, dur: num(al.dur, 2, 30, 6), sound: str(al.sound, 16), vol: num(al.vol, 0, 100, 80), cool: num(al.cool, 0, 600, 0), minBits: num(al.minBits, 0, 1e6, 0),
        cur: al.cur && obj(al.cur).id ? { id: str(al.cur.id, 40), kind: str(al.cur.kind, 12), user: str(al.cur.user, 40), amount: num(al.cur.amount, 0, 1e9, 0), extra: str(al.cur.extra, 80), at: num(al.cur.at, 0, 1e15, 0), test: al.cur.test === true } : null,
        queue: list(al.queue, 30, (x) => ({ id: str(x.id, 40), kind: str(x.kind, 12), user: str(x.user, 40), amount: num(x.amount, 0, 1e9, 0), extra: str(x.extra, 80), test: x.test === true })),
        hist: list(al.hist, 30, (x) => ({ t: str(x.t, 100), at: num(x.at, 0, 1e15, 0) })) }),
      plook: Object.assign({ vis: vis(pl.vis, 'off'), color: hex(pl.color, '#9147ff') }, place(pl, 1640, 300)),
      timers: list(r.timers, 15, (x) => ({ id: str(x.id, 12) || id(), text: str(x.text, 400), every: num(x.every, 5, 240, 20), minChat: num(x.minChat, 0, 1000, 5), on: x.on === true, liveOnly: x.liveOnly !== false, last: num(x.last, 0, 1e15, 0) })),
      cmds: list(r.cmds, 40, (x) => ({ id: str(x.id, 12) || id(), name: str(x.name, 25).toLowerCase().replace(/[^a-z0-9_]/g, ''), resp: str(x.resp, 400), cool: num(x.cool, 0, 3600, 10), userCool: num(x.userCool, 0, 3600, 30), level: ['all', 'sub', 'mod', 'owner'].includes(x.level) ? x.level : 'all', on: x.on === true, uses: num(x.uses, 0, 1e9, 0) })).filter((x) => x.name),
      chatHist: list(r.chatHist, 40, (x) => ({ t: str(x.t, 160), at: num(x.at, 0, 1e15, 0), ok: x.ok !== false })),
      modHist: list(r.modHist, 40, (x) => ({ t: str(x.t, 160), by: str(x.by, 40), at: num(x.at, 0, 1e15, 0) })),
      polls: list(r.polls, 30, (x) => ({ title: str(x.title, 60), res: str(x.res, 200), at: num(x.at, 0, 1e15, 0) })),
      preds: list(r.preds, 30, (x) => ({ title: str(x.title, 45), res: str(x.res, 200), at: num(x.at, 0, 1e15, 0) })),
      shouts: list(r.shouts, 30, (x) => ({ to: str(x.to, 40), ok: x.ok !== false, msg: str(x.msg, 120), at: num(x.at, 0, 1e15, 0) })),
      links: list(r.links, 30, (x) => ({ reward: str(x.reward, 60), title: str(x.title, 45), act: ['spin', 'alert'].includes(x.act) ? x.act : 'spin', on: x.on === true })),
      streams: list(r.streams, 60, (x) => ({ id: str(x.id, 20) || id(), start: num(x.start, 0, 1e15, 0), end: num(x.end, 0, 1e15, 0), titles: arr(x.titles).slice(0, 10).map((t) => str(t, 140)), cats: arr(x.cats).slice(0, 10).map((t) => str(t, 80)),
        subs: num(x.subs, 0, 1e9, 0), follows: num(x.follows, 0, 1e9, 0), bits: num(x.bits, 0, 1e12, 0), clips: num(x.clips, 0, 1e6, 0), markers: num(x.markers, 0, 1e6, 0), peak: num(x.peak, 0, 1e8, 0), sum: num(x.sum, 0, 1e12, 0), n: num(x.n, 0, 1e7, 0), open: x.open === true })),
    };
  }
  const twitchDefaults = () => twitchNormalize({});

  return { rundownNormalize, roElapsed, TW_ALERTS, twitchDefaults, twitchNormalize, SB_RULES, SB_SOURCES, subathonDefaults, subathonNormalize, subLeft, mediaDefaults, mediaNormalize, sponsorNow, slideNow, CH_KINDS, CH_NAME, chWidget, challengesDefaults, challengesNormalize, gamesDefaults, gamesNormalize, canvasDefaults, canvasNormalize, canvasItem, stroke, deskDefaults, deskNormalize, widget, timerNow, fmt, shows, newId: id, DESK };
}));
