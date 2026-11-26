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
  // `accent` colours the competition tab, the progress line and the highlights while that competition is on.
  const COMPETITIONS = [
    { key: 'pl', name: 'Premier League', slug: 'eng.1', logo: LEAGUE_LOGO(23), accent: '#7b2fd6' },
    { key: 'champ', name: 'Championship', slug: 'eng.2', logo: LEAGUE_LOGO(24), accent: '#1f6fd1' },
    { key: 'l1', name: 'League One', slug: 'eng.3', logo: LEAGUE_LOGO(25), accent: '#d0263f' },
    { key: 'l2', name: 'League Two', slug: 'eng.4', logo: LEAGUE_LOGO(26), accent: '#14935a' },
    { key: 'fac', name: 'FA Cup', slug: 'eng.fa', logo: LEAGUE_LOGO(40), accent: '#2c55c9' },
    { key: 'efl', name: 'Carabao Cup', slug: 'eng.league_cup', logo: LEAGUE_LOGO(41), accent: '#0d9b5f' },
    { key: 'ucl', name: 'Champions League', slug: 'uefa.champions', logo: LEAGUE_LOGO(2), accent: '#2440b8' },
    { key: 'uel', name: 'Europa League', slug: 'uefa.europa', logo: LEAGUE_LOGO(2310), accent: '#ee7a12' },
    { key: 'uecl', name: 'Conference League', slug: 'uefa.europa.conf', logo: LEAGUE_LOGO(20296), accent: '#18a84c' },
  ];
  const ACCENT_DEFAULT = '#e11d48';
  // Time zones offered for kick-off times. The device's own zone is added in the control app.
  const TIMEZONES = ['Europe/London', 'Europe/Dublin', 'Europe/Lisbon', 'Europe/Paris', 'Europe/Madrid', 'Europe/Berlin', 'Europe/Istanbul',
    'Africa/Lagos', 'Asia/Dubai', 'Asia/Kolkata', 'Asia/Singapore', 'Australia/Sydney', 'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'UTC'];
  const validZone = (z) => {
    if (typeof z !== 'string' || !z || z.length > 64) return false;
    try { new Intl.DateTimeFormat('en-GB', { timeZone: z }); return true; } catch (e) { return false; }
  };
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
    pre: { label: 'Pre-match', period: 'pre', clock: [0, false], added: 0, score: [0, 0], stats: zeroStats(), reds: [], countdown: 5 * 60 + 12 },
    live: {
      label: 'Live', period: '2h', clock: [3812, true], added: 0, score: [1, 2],
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
      delay: 0,                // stream delay in seconds: Live updates and the clock wait this long, to match what viewers see
      tz: 'Europe/London',     // time zone for kick-off times
      look: { accent: 'comp', brand: ACCENT_DEFAULT, sheen: true, celebrate: true },
      comp: 'Champions League',
      compKey: '',
      compLogo: '',
      kickoff: '20:00',
      kickoffAt: 0,
      home: { name: 'Sporting CP', full: 'Sporting Clube de Portugal', code: 'SCP', color: '#12a05c', crestV: 0, swatches: [] },
      away: { name: 'Manchester United', full: 'Manchester United', code: 'MUN', color: '#e0232e', crestV: 0, swatches: [] },
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
      yellows: [],             // the same shape as reds
      subs: [],                // { team, on, off, minute, key } from ESPN
      shoot: [[], []],         // penalty shoot-out kicks per team: 1 scored, 0 missed
      board: 'none',           // the card in the middle of the screen: none, lineups, info, form, h2h or table
      lineups: [],             // [{ f: '4-3-3', xi: [{ n, name, pos }] }, ...] from ESPN
      info: {},                // { venue, city, ref, att } from ESPN
      form: ['', ''],          // last five results, newest last, like 'WWDLW', from ESPN
      h2h: { text: '', games: [] }, // recent meetings: { d, h, a, hs, as } from ESPN
      table: [],               // league table rows: { p, n, c, g, gd, pts, t } (t: 0 home, 1 away, -1 others)
      others: [],              // other games in the competition: { h, a, hs, as, st }
      follow: { team: '', comps: [] },             // follow my team: picks up their next match by itself
      auto: { on: false, pre: 'info', ftOff: 10 }, // autopilot
      scenes: [],              // saved setups: { id, name, snap }
      anims: [],               // { id, kind: 'goal' | 'scorer' | 'red', team, name, minute, t }
      show: { bug: true, drawer: true, card: 'auto', scorers: 'always', names: 'code', yellows: true, timeline: true, banners: true, spotlight: true, splash: true, ticker: false, subs: true, style: 'broadcast' },
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
    s.delay = int(raw.delay, 0, 300, 0);
    s.tz = validZone(raw.tz) ? raw.tz : s.tz;
    const lk = obj(raw.look);
    s.look = {
      accent: lk.accent === 'brand' ? 'brand' : 'comp',
      brand: isHex(lk.brand) ? lk.brand.toLowerCase() : s.look.brand,
      sheen: lk.sheen !== false,
      celebrate: lk.celebrate !== false,
    };
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
        full: text(t, 'full', 48, has(t, 'name') ? text(t, 'name', 40, d.name) : d.full),
        code: text(t, 'code', 4, d.code),
        color: isHex(t.color) ? t.color.toLowerCase() : d.color,
        crestV: num(t.crestV, 0, 1e15, 0),
        // Colours ESPN gives for this team: the kit worn in this match, the club colour and its second colour.
        swatches: (Array.isArray(t.swatches) ? t.swatches : [])
          .filter((w) => w && isHex(w.c) && ['kit', 'club', 'alt', 'trim'].includes(w.l))
          .slice(0, 4)
          .map((w) => ({ c: w.c.toLowerCase(), l: w.l })),
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
        number: str(g.number).replace(/[^0-9]/g, '').slice(0, 3), // shirt number, for the scorer spotlight
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
    s.yellows = (Array.isArray(raw.yellows) ? raw.yellows : [])
      .filter((r) => r && team(r.team))
      .slice(-30)
      .map((r) => ({ team: r.team, player: str(r.player).slice(0, 40), minute: str(r.minute).slice(0, 8), src: r.src === 'feed' ? 'feed' : 'manual', key: str(r.key).slice(0, 80), at: num(r.at, 0, 1e15, 0) }));
    s.anims = (Array.isArray(raw.anims) ? raw.anims : [])
      .filter((a) => a && ['goal', 'scorer', 'red', 'nogoal', 'sub', 'banner', 'added'].includes(a.kind) && team(a.team) && a.id)
      .slice(-12)
      .map((a) => ({ id: str(a.id).slice(0, 40), kind: a.kind, team: a.team, name: str(a.name).slice(0, 40), minute: str(a.minute).slice(0, 8), t: num(a.t, 0, 1e15, 0), off: str(a.off).slice(0, 40) }));
    const sh = obj(raw.show);
    s.show = {
      bug: sh.bug !== false,
      drawer: sh.drawer !== false,
      card: ['show', 'auto', 'off'].includes(sh.card) ? sh.card : s.show.card,
      scorers: ['always', 'goals', 'off'].includes(sh.scorers) ? sh.scorers : s.show.scorers,
      names: ['code', 'name', 'full'].includes(sh.names) ? sh.names : s.show.names,
      yellows: sh.yellows !== false,
      timeline: sh.timeline !== false,
      banners: sh.banners !== false,
      spotlight: sh.spotlight !== false,
      splash: sh.splash !== false,
      ticker: sh.ticker === true,
      subs: sh.subs !== false,
      style: ['broadcast', 'minimal', 'bold', 'mini'].includes(sh.style) ? sh.style : 'broadcast',
    };
    // Round 3 extras. Everything from ESPN is kept small, so saves and updates stay tiny.
    const arr = (v) => (Array.isArray(v) ? v : []);
    s.subs = arr(raw.subs).filter((x) => x && team(x.team)).slice(-24)
      .map((x) => ({ team: x.team, on: str(x.on).slice(0, 40), off: str(x.off).slice(0, 40), minute: str(x.minute).slice(0, 8), key: str(x.key).slice(0, 80) }));
    s.shoot = [0, 1].map((t) => arr(arr(raw.shoot)[t]).slice(0, 20).map((k) => (k ? 1 : 0)));
    s.board = ['none', 'lineups', 'info', 'form', 'h2h', 'table'].includes(raw.board) ? raw.board : 'none';
    s.lineups = arr(raw.lineups).slice(0, 2).map((l) => ({ f: str(obj(l).f).slice(0, 12), xi: arr(obj(l).xi).slice(0, 11).map((p) => ({ n: str(obj(p).n).slice(0, 3), name: str(obj(p).name).slice(0, 30), pos: str(obj(p).pos).slice(0, 4) })) }));
    const inf = obj(raw.info);
    s.info = { venue: str(inf.venue).slice(0, 60), city: str(inf.city).slice(0, 40), ref: str(inf.ref).slice(0, 40), att: num(inf.att, 0, 1e6, 0) };
    s.form = [0, 1].map((t) => str(arr(raw.form)[t]).replace(/[^WDL]/g, '').slice(-5));
    const h2 = obj(raw.h2h);
    s.h2h = { text: str(h2.text).slice(0, 60), games: arr(h2.games).slice(0, 5).map((g) => ({ d: str(obj(g).d).slice(0, 10), h: str(obj(g).h).slice(0, 5), a: str(obj(g).a).slice(0, 5), hs: num(obj(g).hs, 0, 99, 0), as: num(obj(g).as, 0, 99, 0) })) };
    s.table = arr(raw.table).slice(0, 24).map((r) => ({ p: num(obj(r).p, 0, 99, 0), n: str(obj(r).n).slice(0, 30), c: str(obj(r).c).slice(0, 5), g: num(obj(r).g, 0, 99, 0), gd: str(obj(r).gd).slice(0, 5), pts: num(obj(r).pts, 0, 300, 0), t: [0, 1].includes(obj(r).t) ? obj(r).t : -1 }));
    s.others = arr(raw.others).slice(0, 16).map((o) => ({ h: str(obj(o).h).slice(0, 5), a: str(obj(o).a).slice(0, 5), hs: str(obj(o).hs).slice(0, 3), as: str(obj(o).as).slice(0, 3), st: str(obj(o).st).slice(0, 10) }));
    const fl = obj(raw.follow);
    s.follow = { team: str(fl.team).slice(0, 40), comps: arr(fl.comps).map(String).slice(0, 12) };
    const au = obj(raw.auto);
    s.auto = { on: au.on === true, pre: ['info', 'lineups', 'none'].includes(au.pre) ? au.pre : 'info', ftOff: [0, 5, 10, 15].includes(au.ftOff) ? au.ftOff : 10 };
    s.scenes = arr(raw.scenes).slice(0, 8).map((x) => ({ id: str(obj(x).id).slice(0, 12) || newId(), name: str(obj(x).name).slice(0, 24) || 'Scene', snap: obj(obj(x).snap) }));
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
  const fullOf = (t) => str(t.full).trim() || nameOf(t);
  // What the scoreboard calls a team: its code, its name or its full club name, as chosen in Layout.
  const labelOf = (s, t) => (s.show.names === 'full' ? fullOf(t) : s.show.names === 'name' ? nameOf(t) : codeOf(t));
  // The card and the goal flash use names: the full club name when that's chosen.
  const titleOf = (s, t) => (s.show.names === 'full' ? fullOf(t) : nameOf(t));
  // Red cards for one team, for the tab above the bar: surname and minute.
  function redList(s, team) {
    return s.reds.filter((r) => r.team === team).map((r) => {
      const words = str(r.player).trim().split(/\s+/).filter(Boolean);
      return { name: words.length > 1 ? words.slice(1).join(' ') : (words[0] || ''), minute: str(r.minute) };
    });
  }
  const redsOf = (s, team) => s.reds.filter((r) => r.team === team).length;
  // For the big card: each scorer once, with all their minutes, like "Chris Wood 12’ 58’, Cole Palmer 34’ (pen)".
  function scorers(s, team) {
    const out = [];
    s.goals.filter((g) => g.team === team).forEach((g) => {
      const raw = str(g.scorer).trim();
      if (!raw) return;
      const tag = /\((og|pen)\)/i.exec(raw);
      const name = raw.replace(/\((og|pen)\)/ig, '').trim();
      let e = out.find((x) => x.name === name);
      if (!e) { e = { name, mins: [] }; out.push(e); }
      e.mins.push(`${str(g.minute)}${tag ? ` (${tag[1].toLowerCase()})` : ''}`.trim());
    });
    return out.map((e) => `${e.name} ${e.mins.join(' ')}`.trim()).join(', ');
  }
  // For the strip under each team: one entry per scorer, surname first, with every minute they scored.
  function scorerList(s, team) {
    const out = [];
    s.goals.filter((g) => g.team === team).forEach((g) => {
      const raw = str(g.scorer).trim();
      if (!raw) return;
      const tag = /\(og\)/i.test(raw) ? 'og' : /\(pen\)/i.test(raw) ? 'pen' : '';
      const full = raw.replace(/\((og|pen)\)/ig, '').trim();
      const words = full.split(/\s+/);
      const name = words.length > 1 ? words.slice(1).join(' ') : full;
      let entry = out.find((e) => e.name === name);
      if (!entry) { entry = { name, mins: [] }; out.push(entry); }
      entry.mins.push({ m: str(g.minute), tag });
    });
    return out;
  }
  // The accent colour: the brand colour if chosen, else the competition's colour, else crimson.
  function accentOf(s) {
    if (s.look && s.look.accent === 'brand' && isHex(s.look.brand)) return s.look.brand;
    const c = COMPETITIONS.find((x) => x.key === s.compKey)
      || COMPETITIONS.find((x) => x.logo && x.logo === s.compLogo)
      || COMPETITIONS.find((x) => x.name.toLowerCase() === str(s.comp).trim().toLowerCase());
    return c ? c.accent : ACCENT_DEFAULT;
  }
  // How far through the current half or period the clock is, from 0 to 1.
  function progressOf(s) {
    if (!inPlay(s)) return s.period === 'ht' || s.period === 'ft' || s.period === 'brk' ? 1 : 0;
    const start = START[s.period];
    const end = END[s.period];
    return clamp((elapsed(s) - start) / (end - start), 0, 1);
  }
  // "45+2’" -> 47, "63’" -> 63: where something goes on the timeline
  const minuteNum = (m) => { const x = /(\d+)(?:\+(\d+))?/.exec(str(m)); return x ? Number(x[1]) + Number(x[2] || 0) : null; };
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
    if (smp.countdown) out.kickoffAt = now() + smp.countdown * 1000;
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
    PERIODS, PLAY, START, END, HALF, COMPETITIONS, ACCENT_DEFAULT, TIMEZONES, validZone, STATS, STAT, SHOWN_DEFAULT, MAX_SHOWN, SAMPLES,
    clamp, pad, str, copy, isHex, isObj, statClean, zeroStats, formatStat,
    syncTime, now, defaults, defaultFeed, normalize,
    inPlay, elapsed, setClock, minuteMark, kickoffLeft, clockView, parseClock, kickoffAtFor,
    initialOf, codeOf, nameOf, fullOf, labelOf, titleOf, redList, redsOf, minuteNum, scorers, scorerList, accentOf, progressOf, cardVisible, newId, pushAnim, withSample,
    diff, applyPatch,
  };
}));
