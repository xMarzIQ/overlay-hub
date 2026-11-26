/*
  Match state, shared by the server, the overlay and the control app.
  No page code in here, so server.js checks every change with exactly the same rules.
*/
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Match = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  /* ---------- Periods ---------- */
  const PERIODS = ['pre', '1h', 'ht', '2h', 'brk', 'et1', 'et2', 'pens', 'ft'];
  const PLAY = ['1h', '2h', 'et1', 'et2'];
  const START = { '1h': 0, '2h': 45 * 60, et1: 90 * 60, et2: 105 * 60 };
  const END = { '1h': 45 * 60, '2h': 90 * 60, et1: 105 * 60, et2: 120 * 60 };
  const HALF = { '1h': '1st half', '2h': '2nd half', et1: 'ET 1st half', et2: 'ET 2nd half' };

  /* ---------- Competitions ESPN can follow. Logos are ESPN's, loaded from their image server. ---------- */
  const LEAGUE_LOGO = (id) => `https://a.espncdn.com/i/leaguelogos/soccer/500-dark/${id}.png`;
  const COMPETITIONS = [
    { key: 'pl', name: 'Premier League', slug: 'eng.1', logo: LEAGUE_LOGO(23) },
    { key: 'champ', name: 'Championship', slug: 'eng.2', logo: LEAGUE_LOGO(24) },
    { key: 'l1', name: 'League One', slug: 'eng.3', logo: LEAGUE_LOGO(25) },
    { key: 'l2', name: 'League Two', slug: 'eng.4', logo: LEAGUE_LOGO(26) },
    { key: 'fac', name: 'FA Cup', slug: 'eng.fa', logo: LEAGUE_LOGO(40) },
    { key: 'efl', name: 'Carabao Cup', slug: 'eng.league_cup', logo: LEAGUE_LOGO(41) },
    { key: 'ucl', name: 'Champions League', slug: 'uefa.champions', logo: LEAGUE_LOGO(2) },
    { key: 'uel', name: 'Europa League', slug: 'uefa.europa', logo: LEAGUE_LOGO(2310) },
    { key: 'uecl', name: 'Conference League', slug: 'uefa.europa.conf', logo: LEAGUE_LOGO(20296) },
  ];
  const isLeagueLogo = (v) => /^https:\/\/a\.espncdn\.com\/i\/leaguelogos\/soccer\/[\w-]+\/\d+\.png$/.test(String(v || ''));

  /* ---------- Stats. `espn` is the name ESPN uses. Pass accuracy is worked out from ESPN's pass counts. ---------- */
  const STATS = [
    { key: 'poss', label: 'Possession', kind: 'pct', espn: 'possessionPct' },
    { key: 'shots', label: 'Shots', espn: 'totalShots' },
    { key: 'sot', label: 'On target', espn: 'shotsOnTarget' },
    { key: 'corners', label: 'Corners', espn: 'wonCorners' },
    { key: 'fouls', label: 'Fouls', espn: 'foulsCommitted' },
    { key: 'yellows', label: 'Yellow cards', espn: 'yellowCards' },
    { key: 'offsides', label: 'Offsides', espn: 'offsides' },
    { key: 'saves', label: 'Saves', espn: 'saves' },
    { key: 'blocked', label: 'Blocked shots', espn: 'blockedShots' },
    { key: 'passes', label: 'Passes', espn: 'totalPasses' },
    { key: 'passPct', label: 'Pass accuracy', kind: 'rate' },
    { key: 'tackles', label: 'Tackles', espn: 'totalTackles' },
    { key: 'interceptions', label: 'Interceptions', espn: 'interceptions' },
    { key: 'crosses', label: 'Crosses', espn: 'totalCrosses' },
  ];
  const STAT = {};
  STATS.forEach((s) => { STAT[s.key] = s; });
  const SHOWN_DEFAULT = ['poss', 'shots', 'sot', 'corners'];
  const MAX_SHOWN = 8;

  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const pad = (n) => String(n).padStart(2, '0');
  const str = (v) => (v == null ? '' : String(v));
  const copy = (o) => JSON.parse(JSON.stringify(o));
  const isHex = (v) => /^#[0-9a-f]{6}$/i.test(str(v));
  const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  const int = (v, lo, hi, fallback) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? clamp(n, lo, hi) : fallback;
  };
  const num = (v, lo, hi, fallback) => {
    const n = Number(v);
    return v !== null && v !== '' && v !== undefined && Number.isFinite(n) ? clamp(n, lo, hi) : fallback;
  };
  const statMax = (s) => (s.kind === 'pct' || s.kind === 'rate' ? 100 : s.kind === 'dec' ? 20 : 999);
  const statClean = (s, v) => (s.kind === 'dec' ? Math.round(num(v, 0, 20, 0) * 100) / 100 : int(v, 0, statMax(s), 0));

  function zeroStats() {
    const out = {};
    STATS.forEach((s) => { out[s.key] = s.kind === 'pct' ? [50, 50] : [0, 0]; });
    return out;
  }
  const sampleStats = (o) => Object.assign(zeroStats(), o);

  // Sample states for the preview buttons in the control app. They never reach the overlay.
  const SAMPLES = {
    pre: { label: 'Pre-match', period: 'pre', clock: [0, false], added: 0, score: [0, 0], stats: zeroStats(), reds: [] },
    live: {
      label: 'Live 71’', period: '2h', clock: [4286, true], added: 0, score: [1, 2],
      stats: sampleStats({ poss: [44, 56], shots: [10, 13], sot: [4, 6], corners: [4, 5], fouls: [9, 11], yellows: [1, 2], offsides: [2, 1], saves: [4, 3], blocked: [2, 3], passes: [402, 517], passPct: [81, 86], tackles: [14, 11], interceptions: [7, 9], crosses: [12, 15] }),
      reds: [{ team: 0, player: '', minute: '63’' }],
    },
    add1: {
      label: '45+ added', period: '1h', clock: [2837, true], added: 4, score: [1, 1],
      stats: sampleStats({ poss: [46, 54], shots: [7, 9], sot: [3, 4], corners: [2, 3], fouls: [6, 7], yellows: [1, 1], offsides: [1, 0], saves: [3, 2], passes: [251, 288], passPct: [80, 84] }),
      reds: [],
    },
    ht: {
      label: 'Half-time', period: 'ht', clock: [2940, false], added: 0, score: [1, 1],
      stats: sampleStats({ poss: [46, 54], shots: [7, 9], sot: [3, 4], corners: [2, 3], fouls: [6, 7], yellows: [1, 1], offsides: [1, 0], saves: [3, 2], passes: [251, 288], passPct: [80, 84] }),
      reds: [],
    },
    add2: {
      label: '90+ added', period: '2h', clock: [5592, true], added: 5, score: [2, 2],
      stats: sampleStats({ poss: [45, 55], shots: [14, 17], sot: [6, 7], corners: [5, 6], fouls: [12, 14], yellows: [2, 3], offsides: [3, 2], saves: [5, 4], passes: [488, 562], passPct: [82, 85] }),
      reds: [{ team: 1, player: '', minute: '58’' }],
    },
    ft: {
      label: 'Full-time', period: 'ft', clock: [5700, false], added: 0, score: [2, 2],
      stats: sampleStats({ poss: [45, 55], shots: [14, 17], sot: [6, 7], corners: [5, 6], fouls: [12, 14], yellows: [2, 3], offsides: [3, 2], saves: [5, 4], passes: [488, 562], passPct: [82, 85] }),
      reds: [{ team: 1, player: '', minute: '58’' }],
    },
  };

  /* Every page lines its clock up with the server's, so a phone and the OBS machine show the same time. */
  let skew = 0;
  let synced = false;
  function syncTime(serverNow) {
    const sample = Number(serverNow) - Date.now();
    if (!Number.isFinite(sample)) return;
    if (!synced || Math.abs(sample - skew) > 1000) {
      skew = sample;
      synced = true;
    } else {
      skew += (sample - skew) * 0.2;
    }
  }
  const now = () => Date.now() + skew;

  function defaultFeed() {
    return {
      available: false, fixtureId: 0, compKey: '', title: '', status: '', statusShort: '',
      updatedAt: 0, nextAt: 0, error: '', remaining: null, limit: null, done: false,
      pollSeconds: 3, kitColours: true, crests: true, statsKeys: [],
    };
  }

  function defaults() {
    return {
      v: 2,
      ts: 0,
      writer: '',
      rev: 0,
      mode: 'manual',          // 'live' follows the feed, 'manual' never changes by itself
      onAir: false,            // the whole overlay on or off screen; new overlays start off until shown
      scale: 1,                // size of the whole overlay
      clockOffset: 0,          // seconds added to the feed clock, to line it up with the TV picture
      comp: 'Champions League',
      compKey: '',
      compLogo: '',
      kickoff: '20:00',
      kickoffAt: 0,
      home: { name: 'Sporting CP', code: 'SCP', color: '#12a05c', crestV: 0 },
      away: { name: 'Manchester United', code: 'MUN', color: '#e0232e', crestV: 0 },
      period: 'pre',
      note: '',                // 'aet' or 'pens' once a match is decided that way
      clock: { base: 0, running: false, at: 0 },
      added: 0,
      score: [0, 0],
      pens: null,              // shoot-out score, [home, away]
      stats: zeroStats(),
      statsShown: SHOWN_DEFAULT.slice(),
      goals: [],               // { team, scorer, minute, src: 'manual' | 'feed', key, at, typed }
      reds: [],                // { team, player, minute, src, key, at }
      anims: [],               // { id, kind: 'goal' | 'scorer' | 'red', team, name, minute, t }
      show: { bug: true, drawer: true, card: 'auto' },
      bug: { x: 64, y: 44, s: 1 },
      card: { x: 960, y: 1016, s: 1 },
      feed: defaultFeed(),
    };
  }

  /* Turns anything (saved file, network message) into a complete, safe match state. */
  function normalize(raw) {
    const s = defaults();
    if (!raw || typeof raw !== 'object' || (raw.v !== 1 && raw.v !== 2)) return s;
    const obj = (v) => (isObj(v) ? v : {});
    const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
    const text = (o, k, max, fallback) => (has(o, k) ? str(o[k]).slice(0, max) : fallback);
    const team = (t) => t === 0 || t === 1;

    s.ts = num(raw.ts, 0, 1e15, 0);
    s.writer = str(raw.writer).slice(0, 40);
    s.rev = int(raw.rev, 0, 1e15, 0);
    s.mode = raw.mode === 'live' ? 'live' : 'manual';
    s.onAir = raw.onAir === true;
    s.scale = num(raw.scale, 0.5, 1.6, 1);
    s.clockOffset = int(raw.clockOffset, -600, 600, 0);
    s.comp = text(raw, 'comp', 40, s.comp);
    s.compKey = COMPETITIONS.some((c) => c.key === raw.compKey) ? raw.compKey : '';
    s.compLogo = isLeagueLogo(raw.compLogo) ? raw.compLogo : '';
    s.kickoff = text(raw, 'kickoff', 5, s.kickoff);
    s.kickoffAt = num(raw.kickoffAt, 0, 1e15, 0);
    ['home', 'away'].forEach((side) => {
      const t = obj(raw[side]);
      const d = s[side];
      s[side] = {
        name: text(t, 'name', 40, d.name),
        code: text(t, 'code', 4, d.code),
        color: isHex(t.color) ? t.color.toLowerCase() : d.color,
        crestV: num(t.crestV, 0, 1e15, 0),
      };
    });
    s.period = PERIODS.includes(raw.period) ? raw.period : s.period;
    s.note = raw.note === 'aet' || raw.note === 'pens' ? raw.note : '';
    const c = obj(raw.clock);
    s.clock = { base: num(c.base, 0, 1e6, 0), running: !!c.running, at: num(c.at, 0, 1e15, 0) };
    s.added = int(raw.added, 0, 30, 0);
    if (Array.isArray(raw.score) && raw.score.length === 2) s.score = raw.score.map((n) => int(n, 0, 99, 0));
    s.pens = Array.isArray(raw.pens) && raw.pens.length === 2 ? raw.pens.map((n) => int(n, 0, 99, 0)) : null;
    const st = obj(raw.stats);
    STATS.forEach((def) => {
      const v = st[def.key];
      if (!Array.isArray(v) || v.length !== 2) return;
      const pair = v.map((n) => statClean(def, n));
      if (def.kind === 'pct') pair[1] = 100 - pair[0];
      s.stats[def.key] = pair;
    });
    if (Array.isArray(raw.statsShown)) {
      const want = raw.statsShown.filter((k) => STAT[k]);
      s.statsShown = STATS.map((d) => d.key).filter((k) => want.includes(k)).slice(0, MAX_SHOWN);
    }
    s.goals = (Array.isArray(raw.goals) ? raw.goals : [])
      .filter((g) => g && team(g.team))
      .slice(-60)
      .map((g) => ({
        team: g.team,
        scorer: str(g.scorer).slice(0, 40),
        minute: str(g.minute).slice(0, 8),
        src: g.src === 'feed' ? 'feed' : 'manual',
        key: str(g.key).slice(0, 80),
        at: num(g.at, 0, 1e15, 0),
        typed: !!g.typed,
      }));
    s.reds = (Array.isArray(raw.reds) ? raw.reds : [])
      .filter((r) => r && team(r.team))
      .slice(-20)
      .map((r) => ({
        team: r.team,
        player: str(r.player).slice(0, 40),
        minute: str(r.minute).slice(0, 8),
        src: r.src === 'feed' ? 'feed' : 'manual',
        key: str(r.key).slice(0, 80),
        at: num(r.at, 0, 1e15, 0),
      }));
    s.anims = (Array.isArray(raw.anims) ? raw.anims : [])
      .filter((a) => a && ['goal', 'scorer', 'red'].includes(a.kind) && team(a.team) && a.id)
      .slice(-12)
      .map((a) => ({ id: str(a.id).slice(0, 40), kind: a.kind, team: a.team, name: str(a.name).slice(0, 40), minute: str(a.minute).slice(0, 8), t: num(a.t, 0, 1e15, 0) }));
    const sh = obj(raw.show);
    s.show = {
      bug: sh.bug !== false,
      drawer: sh.drawer !== false,
      card: ['show', 'auto', 'off'].includes(sh.card) ? sh.card : s.show.card,
    };
    const b = obj(raw.bug);
    const k = obj(raw.card);
    s.bug = { x: num(b.x, -400, 1920, s.bug.x), y: num(b.y, -400, 1080, s.bug.y), s: num(b.s, 0.6, 1.5, 1) };
    s.card = { x: num(k.x, 0, 1920, s.card.x), y: num(k.y, 0, 1500, s.card.y), s: num(k.s, 0.6, 1.3, 1) };
    const f = obj(raw.feed);
    const df = s.feed;
    s.feed = {
      available: !!f.available,
      fixtureId: int(f.fixtureId, 0, 1e12, 0),
      compKey: COMPETITIONS.some((cc) => cc.key === f.compKey) ? f.compKey : '',
      title: text(f, 'title', 90, ''),
      status: text(f, 'status', 60, ''),
      statusShort: text(f, 'statusShort', 8, ''),
      updatedAt: num(f.updatedAt, 0, 1e15, 0),
      nextAt: num(f.nextAt, 0, 1e15, 0),
      error: text(f, 'error', 200, ''),
      remaining: f.remaining == null ? null : int(f.remaining, 0, 1e9, null),
      limit: f.limit == null ? null : int(f.limit, 0, 1e9, null),
      done: !!f.done,
      pollSeconds: [3, 5, 10, 30].includes(+f.pollSeconds) ? +f.pollSeconds : df.pollSeconds,
      kitColours: f.kitColours !== false,
      crests: f.crests !== false,
      statsKeys: Array.isArray(f.statsKeys) ? f.statsKeys.filter((key) => STAT[key]) : [],
    };
    return s;
  }

  /* ---------- Clock ---------- */
  const inPlay = (s) => PLAY.includes(s.period);
  function elapsed(s) {
    const c = s.clock;
    return Math.max(0, c.running ? c.base + (now() - c.at) / 1000 : c.base);
  }
  function setClock(s, base, running) {
    s.clock = { base: Math.max(0, base), running: !!running, at: now() };
  }
  // The minute a goal or card goes down as: 23’, or 45+2’ in added time.
  function minuteMark(s) {
    const sec = Math.floor(elapsed(s));
    const end = END[s.period];
    if (end && sec >= end) return `${end / 60}+${Math.floor((sec - end) / 60) + 1}’`;
    return `${Math.floor(sec / 60) + 1}’`;
  }
  function kickoffLeft(s) {
    if (!s.kickoffAt) return null;
    const left = Math.ceil((s.kickoffAt - now()) / 1000);
    return left > 0 && left <= 12 * 3600 ? left : null;
  }
  // What the clock part of the scoreboard shows right now.
  function clockView(s) {
    const p = s.period;
    if (p === 'pre') {
      const left = kickoffLeft(s);
      if (left != null) {
        const h = Math.floor(left / 3600);
        const m = Math.floor((left % 3600) / 60);
        const sec = left % 60;
        return { text: h ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`, label: 'Kick-off in', dot: 'is-none', added: false };
      }
      return { text: str(s.kickoff).trim() || '--:--', label: 'Kick-off', dot: 'is-none', added: false };
    }
    if (p === 'ht') return { text: 'HT', label: 'Half-time', dot: 'is-idle', added: false };
    if (p === 'brk') return { text: 'ET', label: 'Break', dot: 'is-idle', added: false };
    if (p === 'pens') return { text: 'PENS', label: s.pens ? `Penalties ${s.pens[0]}–${s.pens[1]}` : 'Penalties', dot: 'is-live', added: false };
    if (p === 'ft') {
      const label = s.note === 'pens' && s.pens ? `${s.pens[0]}–${s.pens[1]} on pens` : s.note === 'aet' ? 'After extra time' : 'Full-time';
      return { text: 'FT', label, dot: 'is-idle', added: false };
    }
    const sec = Math.floor(elapsed(s));
    const end = END[p];
    const dot = s.clock.running ? 'is-live' : 'is-paused';
    if (sec >= end) {
      const x = sec - end;
      return { text: `${end / 60}+${Math.floor(x / 60)}:${pad(x % 60)}`, label: HALF[p], dot, added: true };
    }
    return { text: `${pad(Math.floor(sec / 60))}:${pad(sec % 60)}`, label: HALF[p], dot, added: false };
  }
  // Accepts 63:20, 63, or added time like 45+2 and 90+3:12. Returns seconds, or null.
  function parseClock(input) {
    const t = str(input).trim().replace(/\s+/g, '');
    let m = /^(\d{1,3})\+(\d{1,2})(?::(\d{1,2}))?$/.exec(t);
    if (m && +(m[3] || 0) < 60) return (+m[1] + +m[2]) * 60 + +(m[3] || 0);
    m = /^(\d{1,3}):(\d{1,2})$/.exec(t);
    if (m && +m[2] < 60) return +m[1] * 60 + +m[2];
    m = /^(\d{1,3})$/.exec(t);
    if (m) return +m[1] * 60;
    return null;
  }
  // Kick-off time typed on the control device, in that device's time zone, as server time.
  function kickoffAtFor(hhmm) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(str(hhmm).trim());
    if (!m || +m[1] > 23 || +m[2] > 59) return 0;
    const d = new Date();
    let at = new Date(d.getFullYear(), d.getMonth(), d.getDate(), +m[1], +m[2], 0, 0).getTime();
    if (at < Date.now() - 3 * 3600 * 1000) at += 24 * 3600 * 1000;
    return at + skew;
  }

  /* ---------- Teams and events ---------- */
  const initialOf = (t) => (str(t.name || t.code).trim().charAt(0) || '?').toUpperCase();
  const codeOf = (t) => (str(t.code).trim() || str(t.name).replace(/\s+/g, '').slice(0, 3) || '???').toUpperCase().slice(0, 4);
  const nameOf = (t) => str(t.name).trim() || codeOf(t);
  const redsOf = (s, team) => s.reds.filter((r) => r.team === team).length;
  function scorers(s, team) {
    return s.goals
      .filter((g) => g.team === team)
      .map((g) => [str(g.scorer).trim(), str(g.minute)].filter(Boolean).join(' '))
      .filter(Boolean)
      .join(', ');
  }
  const cardVisible = (s) => s.show.card === 'show' || (s.show.card === 'auto' && ['ht', 'brk', 'ft'].includes(s.period));
  const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  function pushAnim(s, anim) {
    s.anims = s.anims.concat([Object.assign({ id: newId(), t: now(), name: '', minute: '' }, anim)]).slice(-12);
  }
  function formatStat(def, v) {
    if (def.kind === 'pct' || def.kind === 'rate') return `${Math.round(v)}%`;
    if (def.kind === 'dec') return (Math.round(v * 100) / 100).toFixed(2);
    return String(Math.round(v));
  }

  // A copy of the match with a sample's period, clock, score and stats, for previewing a state.
  function withSample(s, key) {
    const smp = SAMPLES[key];
    const out = copy(s);
    if (!smp) return out;
    out.period = smp.period;
    out.note = '';
    out.pens = null;
    setClock(out, smp.clock[0], smp.clock[1]);
    out.added = smp.added;
    out.score = smp.score.slice();
    out.stats = copy(smp.stats);
    out.reds = smp.reds.map((r) => Object.assign({ src: 'manual', key: '', at: 0 }, r));
    out.goals = [];
    out.anims = [];
    out.onAir = true;
    return out;
  }

  /* ---------- Small changes travel as patches: [[path, value], ...] ---------- */
  function diff(a, b, path, out) {
    path = path || [];
    out = out || [];
    if (isObj(a) && isObj(b)) {
      const keys = new Set(Object.keys(a).concat(Object.keys(b)));
      keys.forEach((k) => diff(a[k], b[k], path.concat(k), out));
    } else if (JSON.stringify(a) !== JSON.stringify(b)) {
      out.push([path, b === undefined ? null : b]);
    }
    return out;
  }
  const BLOCKED = ['__proto__', 'constructor', 'prototype'];
  function applyPatch(target, patch, allowTop) {
    (Array.isArray(patch) ? patch : []).forEach((entry) => {
      if (!Array.isArray(entry) || !Array.isArray(entry[0]) || !entry[0].length) return;
      const [path, value] = entry;
      if (path.some((k) => typeof k !== 'string' || BLOCKED.includes(k))) return;
      if (allowTop && !allowTop.includes(path[0])) return;
      let o = target;
      for (let i = 0; i < path.length - 1; i += 1) {
        if (!isObj(o[path[i]])) o[path[i]] = {};
        o = o[path[i]];
      }
      o[path[path.length - 1]] = value;
    });
    return target;
  }

  return {
    PERIODS, PLAY, START, END, HALF, COMPETITIONS, STATS, STAT, SHOWN_DEFAULT, MAX_SHOWN, SAMPLES,
    clamp, pad, str, copy, isHex, isObj, statClean, zeroStats, formatStat,
    syncTime, now, defaults, defaultFeed, normalize,
    inPlay, elapsed, setClock, minuteMark, kickoffLeft, clockView, parseClock, kickoffAtFor,
    initialOf, codeOf, nameOf, redsOf, scorers, cardVisible, newId, pushAnim, withSample,
    diff, applyPatch,
  };
}));
