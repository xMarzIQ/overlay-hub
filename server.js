'use strict';
/*
  Overlay hub server (Node.js, Express and ws).
  - /control is the hub. /overlay/<code> is each streamer's OBS page; /overlay still works for the first
    streamer until its link is reset. /hide/<code> is a one-button page that takes a streamer's overlays off screen.
  - Each streamer has their own overlays (the live scoreboard so far), their own overlay link and their own ESPN match.
  - Changes go to open pages over a WebSocket (/ws) as small "what changed" messages, compressed, so traffic stays tiny.
  - People: the owner (CONTROL_KEY, or the owner password set in the hub) can do everything. Editors sign in with a
    username and the editor password, and the owner approves them, for a set time and for chosen streamers.
*/
const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { WebSocketServer } = require('ws');
const Match = require('./public/match.js');
const Extras = require('./public/extras-model.js');
const Games = require('./games');
const { createTwitch } = require('./twitch');
const Sub = require('./subathon');
const { createCentre } = require('./twitchcentre');
const { createOps, normOps } = require('./ops');
const APP_VERSION = '2026.11.27';
const STARTED_AT = Date.now();
// The chat games' word list and flags; the games stay off if the files are missing
let gameEngine = null;
try { gameEngine = Games.createEngine(path.join(__dirname, 'wordlist')); } catch (e) { console.warn('Chat games word list not found:', e.message); }
// All 190 flags live in one file (so the project stays under GitHub's 100-files-per-upload limit); each is served as /flags/<code>.svg
let flagSvgs = {};
try { flagSvgs = JSON.parse(fs.readFileSync(path.join(__dirname, 'wordlist', 'flags.json'), 'utf8')); } catch (e) { console.warn('Flags file not found:', e.message); }
const gameMem = new Map(); // per streamer: the secret Contexto word, poll voters, giveaway entrants (memory only)
const memFor = (st) => { if (!gameMem.has(st.id)) gameMem.set(st.id, { voters: new Map(), entrants: new Map() }); return gameMem.get(st.id); };
// The games' memory is saved with the setup (server side only), so a restart mid-game keeps the secret word, votes and entries
function memSave(id) {
  const m = gameMem.get(id);
  if (!m) return undefined;
  return { secret: gameEngine && m.rank ? gameEngine.secretWord(m) : '', guessed: m.guessed ? Array.from(m.guessed) : [], voters: Array.from(m.voters || []), entrants: Array.from(m.entrants || []) };
}
function memLoad(st, saved) {
  if (!st || !saved || typeof saved !== 'object') return;
  const m = memFor(st);
  if (Array.isArray(saved.voters)) m.voters = new Map(saved.voters.filter((x) => Array.isArray(x) && x.length === 2).slice(0, 50000));
  if (Array.isArray(saved.entrants)) m.entrants = new Map(saved.entrants.filter((x) => Array.isArray(x) && x.length === 2).slice(0, 50000));
  if (saved.secret && gameEngine) {
    const r = gameEngine.contextoStart(m, String(saved.secret));
    if (r.ok) m.guessed = new Set((Array.isArray(saved.guessed) ? saved.guessed : []).map(String));
  }
}
const createChat = require('./chat.js');
const createEspn = require('./espn.js');

const PORT = Number(process.env.PORT) || 8080;
const CONTROL_KEY = String(process.env.CONTROL_KEY || '').trim();
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'state.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const DEFAULT_TZ = Match.validZone(process.env.MATCH_TIMEZONE) ? process.env.MATCH_TIMEZONE : 'Europe/London';
const MAX_STREAMERS = 10;
const MAX_CONNECTIONS = 30;
const MAX_ACTIVITY = 500;            // activity entries kept per streamer
const DEVICE_IDLE_MS = 30 * 864e5;   // a "never expires" editor signs in again after 30 days without using a device
const REQUEST_TTL_MS = 864e5;        // sign-in requests nobody answers are declined after 24 hours
const HISTORY_MS = 30 * 864e5;       // sign-in history is kept for 30 days

// A fingerprint of the pages, so open overlays reload themselves after an update.
const BUILD = (() => {
  const h = crypto.createHash('sha1');
  fs.readdirSync(PUBLIC_DIR).sort().forEach((f) => { try { h.update(f); h.update(fs.readFileSync(path.join(PUBLIC_DIR, f))); } catch (e) { /* folder */ } });
  return h.digest('hex').slice(0, 12);
})();

/* ---------- What each overlay keeps, and what the hub may change ---------- */
const MODULES = {
  canvas: {
    defaults: Extras.canvasDefaults,
    normalize: Extras.canvasNormalize,
    patchable: ['onAir', 'items', 'strokes', 'ink', 'spot', 'music', 'boards', 'writer', 'rev'],
    keep() {},
    after() {},
  },
  games: {
    defaults: Extras.gamesDefaults,
    normalize: Extras.gamesNormalize,
    patchable: ['mode', 'cool', 'poll', 'contexto', 'flags', 'give', 'hunt', 'board', 'writer', 'rev'],
    // Votes, guesses, winners, scores and entries come from chat; the hub can end a round but not fake results
    keep(prev, next) {
      next.poll.votes = prev.poll.votes;
      const endC = next.contexto.open;
      ['round', 'count', 'guesses', 'last', 'winner', 'revealed'].forEach((k) => { next.contexto[k] = prev.contexto[k]; });
      next.contexto.open = prev.contexto.open && endC;
      const endF = next.flags.open;
      ['code', 'name', 'winner', 'board'].forEach((k) => { next.flags[k] = prev.flags[k]; });
      next.flags.open = prev.flags.open && endF;
      next.give.entries = prev.give.entries;
      next.board.list = prev.board.list;
      next.give.winner = prev.give.winner;
    },
    after(st, prev, s) { gamesAfter(st, prev, s); },
  },
  twitch: {
    defaults: Extras.twitchDefaults,
    normalize: Extras.twitchNormalize,
    patchable: ['titleFav', 'catFav', 'alerts', 'plook', 'timers', 'cmds', 'links', 'writer', 'rev'],
    // The dashboard, histories, clips, markers and stream records only change on the server
    keep(prev, next) {
      ['cur', 'queue', 'hist'].forEach((k) => { next.alerts[k] = prev.alerts[k]; });
      next.timers.forEach((x) => { const p = prev.timers.find((y) => y.id === x.id); x.last = p ? p.last : 0; });
      next.cmds.forEach((x) => { const p = prev.cmds.find((y) => y.id === x.id); x.uses = p ? p.uses : 0; });
    },
    after() {},
  },
  subathon: {
    defaults: Extras.subathonDefaults,
    normalize: Extras.subathonNormalize,
    patchable: ['timer', 'sleep', 'rules', 'bonus', 'goals', 'milestones', 'mlook', 'spins', 'blook', 'writer', 'rev'],
    // The timer, totals, goal progress, milestone states and owed spins only change on the server (contributions and the buttons)
    keep(prev, next) {
      ['state', 'end', 'left', 'start', 'added', 'first', 'graceEnd', 'sleepPaused'].forEach((k) => { next.timer[k] = prev.timer[k]; });
      ['until', 'from'].forEach((k) => { next.bonus[k] = prev.bonus[k]; });
      next.goals.forEach((g) => { const p = prev.goals.find((x) => x.id === g.id); g.cur = p ? p.cur : g.start; });
      next.milestones.forEach((m) => { const p = prev.milestones.find((x) => x.id === m.id); if (p) { m.s = p.s; m.times = p.times; m.at = p.at; } });
      ['owed', 'done', 'hist'].forEach((k) => { next.spins[k] = prev.spins[k]; });
    },
    after() {},
  },
  media: {
    defaults: Extras.mediaDefaults,
    normalize: Extras.mediaNormalize,
    patchable: ['mixer', 'music', 'playlists', 'sounds', 'overlap', 'fire', 'stopSeq', 'shows', 'sponsor', 'gifs', 'hist', 'writer', 'rev'],
    keep() {},
    after() {},
  },
  challenges: {
    defaults: Extras.challengesDefaults,
    normalize: Extras.challengesNormalize,
    patchable: ['widgets', 'lib', 'writer', 'rev'],
    // A wheel's results come from the server only
    keep(prev, next) { next.widgets.forEach((w) => { if (w.kind !== 'wheel') return; const p = prev.widgets.find((x) => x.id === w.id); w.spin = p ? p.spin : null; w.hist = p ? p.hist : []; }); },
    after() {},
  },
  desk: {
    defaults: Extras.deskDefaults,
    normalize: Extras.deskNormalize,
    patchable: ['onAir', 'widgets', 'writer', 'rev'],
    keep() {},
    after() {},
  },
  scoreboard: {
    defaults: () => Object.assign(Match.defaults(), { tz: DEFAULT_TZ }),
    normalize: Match.normalize,
    patchable: ['mode', 'onAir', 'scale', 'delay', 'tz', 'look', 'comp', 'compLogo', 'kickoff', 'kickoffAt', 'home', 'away', 'period', 'note', 'clock',
      'added', 'score', 'pens', 'stats', 'statsShown', 'goals', 'reds', 'yellows', 'anims', 'show', 'bug', 'card', 'writer', 'rev',
      'shoot', 'board', 'follow', 'auto', 'scenes', 'preview'],
    keep(prev, next) { // ESPN's details, crest versions, swatches and the competition link belong to the server
      ['home', 'away'].forEach((side) => { next[side].crestV = prev[side].crestV; next[side].swatches = prev[side].swatches; });
      next.compKey = prev.compKey;
      next.feed = prev.feed;
      ['lineups', 'info', 'form', 'h2h', 'table', 'others', 'subs'].forEach((k) => { next[k] = prev[k]; }); // these come from ESPN
    },
    after(st, prev, next, msg) {
      const espn = st.espn;
      if (!prev.show.ticker && next.show.ticker) setTimeout(() => espn.extrasTick(), 50); // fill the ticker straight away
      if (next.follow.team && JSON.stringify(prev.follow) !== JSON.stringify(next.follow)) setTimeout(() => espn.extrasTick(true), 50); // look for their match now
      if (Array.isArray(msg.ignore)) espn.ignore(msg.ignore);
      if (next.mode === 'live' && prev.mode === 'live' && next.period !== prev.period) espn.holdPeriod(next.period);
      if (next.mode !== prev.mode) espn.onModeChange();
      else if (next.delay !== prev.delay) espn.resync();
    },
  },
};

/* ---------- Streamers ---------- */
const streamers = []; // in display order: { id, name, code, legacy, modules: { scoreboard }, crests, espn, sent }
const rid = (n) => crypto.randomBytes(24).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, n);
const byId = (id) => streamers.find((x) => x.id === id);
const byCode = (code) => streamers.find((x) => x.code === code);
const legacyStreamer = () => streamers.find((x) => x.legacy) || null;
// A streamer's name doubles as their Twitch channel: "Chazza" reads twitch.tv/chazza
const toChannel = (name) => String(name || '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 25);
const cleanName = (v, fallback) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, 32) || fallback;
// One look for all of a streamer's overlays: the font, the corners, and how overlays come on and go off.
const cleanLook = (l) => ({
  font: ['barlow', 'oswald', 'saira'].includes(l && l.font) ? l.font : 'barlow',
  corners: (l && l.corners) === 'sharp' ? 'sharp' : 'rounded',
  anim: ['slide', 'fade', 'wipe'].includes(l && l.anim) ? l.anim : 'slide',
  brand: /^#[0-9a-f]{6}$/i.test(String(l && l.brand)) ? String(l.brand) : '#e11d48',
});
// Which overlay sits on top when they overlap, top first.
const cleanStack = (v) => {
  const ids = Object.keys(MODULES);
  const given = Array.isArray(v) ? v.filter((x) => ids.includes(x)) : [];
  return given.concat(ids.filter((x) => !given.includes(x)));
};

function makeStreamer(fields) {
  const st = {
    id: fields.id || rid(10),
    name: cleanName(fields.name, 'My stream'),
    code: fields.code || rid(16),
    legacy: !!fields.legacy,
    modules: {},
    crests: { home: null, away: null },
    sent: {},
    look: cleanLook(fields.look),
    setups: Array.isArray(fields.setups) ? fields.setups.filter((x) => x && x.id && x.snap).slice(0, 8) : [], // saved setups: what's on screen in every tab
    subSeen: Array.isArray(fields.subSeen) ? fields.subSeen.map(String).slice(-1000) : [], // Twitch events already counted by Subathon
    ops: normOps(fields.ops), // quick actions, automations, locks
    media: Array.isArray(fields.media) ? fields.media.slice(0, 200) : [],  // uploaded images and music: { id, name, kind, size, at, pinned, ext }
    playlistMB: Number(fields.playlistMB) > 0 ? Number(fields.playlistMB) : 0, // 0 means the streamer's whole share
    chat: Object.assign({ channel: '', commands: false, allow: ['marzvise'] }, fields.chat || {}),
    chatLog: [],
    stack: cleanStack(fields.stack),
    activity: Array.isArray(fields.activity) ? fields.activity.slice(-MAX_ACTIVITY) : [],
  };
  Object.keys(MODULES).forEach((m) => {
    st.modules[m] = fields.modules && fields.modules[m] ? MODULES[m].normalize(fields.modules[m]) : MODULES[m].defaults();
  });
  if (!(fields.modules && fields.modules.media) && st.modules.canvas.music && st.modules.canvas.music.id) {
    st.modules.media.music.q = [st.modules.canvas.music.id];
    st.modules.canvas.music.playing = false;
  }
  if (!(fields.modules && fields.modules.challenges)) {
    const h = st.modules.games && st.modules.games.hunt;
    if (h && h.cells.some((c) => c.t)) {
      st.modules.challenges.widgets.push(Extras.chWidget({ kind: 'bingo', title: h.title, size: h.size, cells: h.cells.map((c) => ({ t: c.t, done: !!c.found })), x: h.x, y: h.y, scale: h.scale, color: h.color, lock: h.lock }));
      h.vis = 'off';
    }
  }
  ['home', 'away'].forEach((side) => {
    const c = fields.crests && fields.crests[side];
    st.crests[side] = c && /^image\/(png|jpeg|webp)$/.test(c.type) && typeof c.base64 === 'string' ? c : null;
    if (!st.crests[side]) st.modules.scoreboard[side].crestV = 0;
  });
  st.espn = createEspn({
    get: () => st.modules.scoreboard,
    changed: () => changed(st, 'scoreboard', true),
    log: (text) => logActivity(st, 'Live', text),
    setCrest(side, crest) {
      st.crests[side] = crest || null;
      st.modules.scoreboard[side].crestV = crest ? Date.now() : 0;
    },
    activeMatches,
  });
  return st;
}
// How many different matches the server is following right now, for ESPN's request budget.
function activeMatches() {
  const ids = new Set();
  streamers.forEach((x) => {
    const s = x.modules.scoreboard;
    if (s.mode === 'live' && s.feed.fixtureId && !s.feed.done) ids.add(s.feed.fixtureId);
  });
  return ids.size;
}

/* ---------- Saving to disk, so a restart keeps everything ---------- */
function load() {
  try {
    const saved = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (saved && saved.v === 3 && Array.isArray(saved.streamers)) {
      saved.streamers.slice(0, MAX_STREAMERS).forEach((x) => { const st = makeStreamer(x); streamers.push(st); memLoad(st, x.gameMem); });
      loadHub(saved.hub);
    } else {
      // Older saves had one scoreboard: it becomes the first streamer, and /overlay keeps working for it.
      const board = (saved.modules && saved.modules.scoreboard) || saved.state;
      streamers.push(makeStreamer({ name: 'My stream', legacy: true, modules: { scoreboard: board }, crests: saved.crests }));
    }
    streamers.forEach((x) => {
      const s = x.modules.scoreboard;
      if (s.clock.running && s.mode !== 'live' && Date.now() - s.clock.at > 6 * 3600 * 1000) s.clock.running = false;
    });
    freshStart = false;
    console.log(`Loaded ${streamers.length} streamer(s) from ${DATA_FILE}`);
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn(`Could not read the saved overlays, starting fresh: ${err.message}`);
  }
  if (!streamers.length) streamers.push(makeStreamer({ name: 'My stream', legacy: true }));
}
let saveTimer = null;
const saveStats = { at: 0, fails: 0, err: '' };
function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 400);
}
function saveNow() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${DATA_FILE}.tmp`;
    const out = { v: 3, hub, streamers: streamers.map(streamerData) };
    fs.writeFileSync(tmp, JSON.stringify(out));
    fs.renameSync(tmp, DATA_FILE);
    saveStats.at = Date.now();
  } catch (err) {
    console.warn(`Could not save the overlays: ${err.message}`);
    saveStats.fails += 1;
    saveStats.err = String(err.message).slice(0, 120);
  }
}
const streamerData = (x) => ({ id: x.id, name: x.name, code: x.code, legacy: x.legacy, modules: x.modules, crests: x.crests, look: x.look, stack: x.stack, activity: x.activity, media: x.media, playlistMB: x.playlistMB, chat: x.chat, gameMem: memSave(x.id), setups: x.setups, subSeen: (x.subSeen || []).slice(-1000), ops: x.ops });
let freshStart = true; // no saved file when the server started: the hub offers to restore from a device's copy

/* ---------- The hub's own settings, people and passwords ---------- */
const hub = {
  tiles: { mode: 'auto', order: [], names: {} },
  links: [],
  editorPass: null,  // { salt, hash }
  ownerPass: null,   // { salt, hash }; CONTROL_KEY always works as well
  owners: [],        // owner devices: { tokenHash, device, name, createdAt, lastSeen }
  people: [],        // editors: { id, username, streamers, expiresAt, createdAt, lastSeen, devices: [{ tokenHash, device, name, createdAt, lastSeen }] }
  requests: [],      // waiting for the owner: { id, username, device, name, at, tokenHash }
  signins: [],       // { at, username, device, ok, what }
};
function loadHub(h) {
  if (!h || typeof h !== 'object') return;
  const t = h.tiles || {};
  hub.tiles = { mode: t.mode === 'custom' ? 'custom' : 'auto', order: Array.isArray(t.order) ? t.order.slice(0, 20).map(String) : [], names: t.names && typeof t.names === 'object' ? t.names : {} };
  hub.links = Array.isArray(h.links) ? h.links.slice(0, 50) : [];
  ['editorPass', 'ownerPass'].forEach((k) => { hub[k] = h[k] && h[k].salt && h[k].hash ? h[k] : null; });
  ['owners', 'people', 'requests', 'signins'].forEach((k) => { hub[k] = Array.isArray(h[k]) ? h[k] : []; });
  hub.traffic = h.traffic && h.traffic.month ? { month: String(h.traffic.month), bytes: Number(h.traffic.bytes) || 0 } : { month: '', bytes: 0 };
}
const sha = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');
function hashPass(pass) {
  const salt = crypto.randomBytes(16).toString('hex');
  return { salt, hash: crypto.scryptSync(String(pass), salt, 32).toString('hex') };
}
function passMatches(stored, pass) {
  if (!stored || !pass) return false;
  const a = crypto.scryptSync(String(pass), stored.salt, 32);
  const b = Buffer.from(stored.hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const newToken = () => crypto.randomBytes(32).toString('base64url');
const cleanUser = (v) => String(v == null ? '' : v).replace(/[^\p{L}\p{N} _.-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 24);
const deviceName = (ua) => {
  const u = String(ua || '');
  const os2 = /iPhone/.test(u) ? 'iPhone' : /iPad/.test(u) ? 'iPad' : /Android/.test(u) ? 'Android' : /Windows/.test(u) ? 'Windows' : /Mac OS X|Macintosh/.test(u) ? 'Mac' : /Linux/.test(u) ? 'Linux' : 'Device';
  const br = /Edg\//.test(u) ? 'Edge' : /OBS/.test(u) ? 'OBS' : /Chrome\//.test(u) ? 'Chrome' : /Firefox\//.test(u) ? 'Firefox' : /Safari\//.test(u) ? 'Safari' : '';
  return br ? `${os2}, ${br}` : os2;
};
function remember(entry) {
  hub.signins.push(Object.assign({ at: Date.now() }, entry));
  const cut = Date.now() - HISTORY_MS;
  hub.signins = hub.signins.filter((x) => x.at > cut).slice(-300);
}
// Who a token belongs to: the owner, an approved editor, someone waiting for approval, or nobody.
function whoIs(token) {
  if (!CONTROL_KEY) return { role: 'owner', name: 'Owner' };
  if (!token) return { role: 'none' };
  const h = sha(token);
  const own = hub.owners.find((d) => d.tokenHash === h);
  if (own) return { role: 'owner', name: 'Owner', device: own };
  for (const p of hub.people) {
    const d = p.devices.find((x) => x.tokenHash === h);
    if (!d) continue;
    if (p.expiresAt && Date.now() > p.expiresAt) return { role: 'none', reason: 'expired', username: p.username };
    if (!p.expiresAt && Date.now() - (d.lastSeen || d.createdAt) > DEVICE_IDLE_MS) return { role: 'none', reason: 'idle', username: p.username };
    return { role: 'editor', name: p.username, person: p, device: d };
  }
  const r = hub.requests.find((x) => x.tokenHash === h);
  if (r) return { role: 'pending', name: r.username, request: r };
  return { role: 'none' };
}
function touch(who) {
  if (who.device) who.device.lastSeen = Date.now();
  if (who.person) who.person.lastSeen = Date.now();
}
const canSee = (who, st) => who.role === 'owner' || (who.role === 'editor' && who.person.streamers.includes(st.id));
// Owner-only fields that editors can't change on the scoreboard: its look and its time zone.
const EDITOR_BLOCKED = ['look', 'tz', 'follow'];
// Which tabs each editor can use. The owner ticks them per person; people approved before this keep every tab.
const TABS = ['scoreboard', 'canvas', 'desk', 'games', 'challenges', 'media', 'subathon', 'twitch'];
const LEGACY_TABS = ['scoreboard', 'canvas', 'desk', 'games'];
const tabsOf = (who) => (who && who.role === 'editor' ? (who.person && Array.isArray(who.person.tabs) ? who.person.tabs.filter((t) => TABS.includes(t)) : LEGACY_TABS.slice()) : TABS.slice());
const canTab = (who, id) => !who || who.role === 'owner' || tabsOf(who).includes(id);
// Twitch Centre: a separate permission for every action; every editor starts with none (owner grants them in People)
const TW_PERMS = ['dash', 'feed', 'chat', 'say', 'clips', 'markers', 'title', 'category', 'delete', 'timeout', 'ban', 'unban', 'chatset', 'polls', 'preds', 'points', 'timers', 'cmds', 'shout', 'alerts', 'history'];
const TW_PRESETS = { none: [], content: ['clips', 'markers'], manager: ['dash', 'clips', 'markers', 'title', 'category'], moderator: ['chat', 'say', 'delete', 'timeout', 'ban', 'unban', 'chatset'] };
const twPerms = (who) => (!who || who.role === 'owner' ? TW_PERMS.slice() : who.person && who.person.tw && Array.isArray(who.person.tw.perms) ? who.person.tw.perms.filter((p) => TW_PERMS.includes(p)) : []);
const hasTw = (who, p) => !!who && (who.role === 'owner' || (canTab(who, 'twitch') && twPerms(who).includes(p)));
// What a page may receive: the OBS page gets only what the overlays draw; editors only what their permissions allow
function viewFor(who, id, m) {
  if (id === 'twitch') {
    if (who === 'overlay') { const d = Extras.twitchDefaults(); return Object.assign(d, { rev: m.rev, dash: Object.assign(d.dash, { poll: m.dash.poll, pred: m.dash.pred }), alerts: Object.assign({}, m.alerts, { hist: [], queue: [] }), plook: m.plook }); }
    if (!who || who.role === 'owner') return m;
    const has = (p) => twPerms(who).includes(p);
    return Object.assign({}, m, {
      dash: has('dash') || has('title') || has('category') ? m.dash : Object.assign({}, m.dash, { viewers: 0, followers: -1, subs: -1, started: 0 }),
      titleFav: has('title') ? m.titleFav : [], titleHist: has('title') ? m.titleHist : [], catFav: has('category') ? m.catFav : [], catHist: has('category') ? m.catHist : [],
      clips: has('clips') ? m.clips : [], markers: has('markers') ? m.markers : [],
      chatHist: has('say') || has('timers') || has('cmds') ? m.chatHist : [], modHist: ['delete', 'timeout', 'ban', 'unban'].some(has) ? m.modHist : [],
      polls: has('polls') ? m.polls : [], preds: has('preds') ? m.preds : [], shouts: has('shout') ? m.shouts : [], links: has('points') ? m.links : [],
      streams: has('history') ? m.streams : [], timers: has('timers') ? m.timers : [], cmds: has('cmds') ? m.cmds : [],
      alerts: has('alerts') ? m.alerts : Object.assign({}, m.alerts, { hist: [], queue: [] }),
    });
  }
  if (id === 'desk') {
    if (who === 'overlay') return Object.assign({}, m, { rundown: Object.assign({}, m.rundown, { lists: [], cur: '', session: { on: false }, past: [] }) });
    if (who && who.role !== 'owner') return Object.assign({}, m, { rundown: Object.assign({}, m.rundown, { lists: m.rundown.lists.map((l) => Object.assign({}, l, { segs: l.segs.map((g) => Object.assign({}, g, { note: '' })) })) }) });
    return m;
  }
  if (id === 'subathon') {
    // The OBS page only needs gifter and cheerer names for the leaderboard; editors without Activity see no names
    if (who === 'overlay') return Object.assign({}, m, { hist: m.hist.filter((h) => !h.fixed && h.user && (h.kind === 'gift' || h.kind === 'bits')).map((h) => ({ id: h.id, kind: h.kind, user: h.user, qty: h.qty, at: h.at, src: h.src, fixed: false, tier: '', secs: 0, prog: 0, note: '', gd: [], cd: {} })), sessions: [], spins: Object.assign({}, m.spins, { hist: [] }), warn: null });
    if (who && who.role !== 'owner' && !hasTw(who, 'feed')) return Object.assign({}, m, { hist: m.hist.map((h) => Object.assign({}, h, { user: h.user ? 'Someone' : '' })), spins: Object.assign({}, m.spins, { hist: m.spins.hist.map((x) => ({ t: 'Spin', at: x.at })) }) });
  }
  return m;
}
const TRIMMED = ['twitch', 'subathon', 'desk'];
const modulesFor = (who, st) => Object.fromEntries(Object.entries(st.modules).filter(([k]) => !who || who.role !== 'editor' || canTab(who, k)).map(([k, m]) => [k, TRIMMED.includes(k) ? viewFor(who, k, m) : m]));
const cleanTabs = (v) => (Array.isArray(v) ? TABS.filter((t) => v.includes(t)) : null);

/* ---------- Activity: what happened on each streamer, newest last ---------- */
function logActivity(st, who, text) {
  if (!text) return;
  const entry = { t: Date.now(), who: who || 'Owner', text: String(text).slice(0, 160) };
  st.activity.push(entry);
  if (st.activity.length > MAX_ACTIVITY) st.activity.splice(0, st.activity.length - MAX_ACTIVITY);
  const monthAgo = Date.now() - 30 * 86400000;
  while (st.activity.length && (st.activity[0].at || st.activity[0].t || Date.now()) < monthAgo) st.activity.shift();
  wss.clients.forEach((ws) => { if (ws.role === 'control' && ws.who && ws.who.role === 'owner' && ws.streamerId === st.id) send(ws, { type: 'activity', streamer: st.id, entry }); });
}
const PERIOD_WORDS = { pre: 'Pre-match', '1h': '1st half', ht: 'Half-time', '2h': '2nd half', brk: 'Break before extra time', et1: 'Extra time, 1st half', et2: 'Extra time, 2nd half', pens: 'Penalties', ft: 'Full-time' };
// Turns a change to the scoreboard into short lines for the activity log.
function describe(prev, next) {
  const out = [];
  const team = (t) => Match.nameOf(t === 0 ? next.home : next.away);
  if (prev.onAir !== next.onAir) out.push(next.onAir ? 'Put the scoreboard on screen' : 'Took the scoreboard off screen');
  if (prev.mode !== next.mode) out.push(next.mode === 'live' ? 'Switched the scoreboard to Live' : 'Switched the scoreboard to Manual');
  if (prev.period !== next.period) out.push(`Period: ${PERIOD_WORDS[next.period] || next.period}`);
  const seen = new Set(prev.anims.map((a) => a.id));
  next.anims.filter((a) => !seen.has(a.id)).forEach((a) => {
    const who = [a.name, a.minute].filter(Boolean).join(' ');
    if (a.kind === 'goal') out.push(`Goal for ${team(a.team)}${who ? ` (${who})` : ''}`);
    else if (a.kind === 'scorer') out.push(`Scorer named: ${a.name} for ${team(a.team)}`);
    else if (a.kind === 'red') out.push(`Red card for ${team(a.team)}${who ? ` (${who})` : ''}`);
  });
  if (prev.score.join('-') !== next.score.join('-') && !out.some((x) => x.startsWith('Goal'))) out.push(`Score set to ${next.score[0]}–${next.score[1]}`);
  if (prev.delay !== next.delay) out.push(next.delay ? `Stream delay set to ${next.delay} s` : 'Stream delay cleared');
  if (prev.home.name !== next.home.name || prev.away.name !== next.away.name || prev.home.color !== next.home.color || prev.away.color !== next.away.color) out.push('Changed the teams');
  return out;
}

// What's worth saving or sending: everything except timestamps that change on every ESPN check.
const shape = (state) => JSON.stringify(state, (k, v) => (k === 'ts' || k === 'updatedAt' || k === 'nextAt' ? undefined : v));
let lastSaved = '';

/* ---------- Live updates over WebSocket ---------- */
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 512 * 1024, perMessageDeflate: { threshold: 512 } });
const send = (ws, msg) => { if (ws.readyState === 1) ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg)); };
const keyMatches = (given) => {
  if (!CONTROL_KEY) return true;
  const a = Buffer.from(String(given || ''));
  const b = Buffer.from(CONTROL_KEY);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
const isLive = (x) => {
  const m = x.modules;
  return !!(m.scoreboard && m.scoreboard.onAir)
    || !!(m.canvas && (m.canvas.items.some((i) => i.vis === 'live') || (m.canvas.ink === 'live' && m.canvas.strokes.length) || m.canvas.spot.on || m.canvas.music.playing))
    || !!(m.desk && m.desk.widgets.some((w) => w.vis === 'live'))
    || !!(m.games && ['poll', 'contexto', 'flags', 'give', 'hunt', 'board'].some((k) => m.games[k].vis === 'live'))
    || !!(m.challenges && m.challenges.widgets.some((w) => w.vis === 'live'))
    || !!(m.twitch && (m.twitch.alerts.vis === 'live' || m.twitch.plook.vis === 'live'))
    || !!(m.subathon && [m.subathon.timer, m.subathon.mlook, m.subathon.spins, m.subathon.blook].concat(m.subathon.goals).some((x) => x.vis === 'live'))
    || !!(m.media && (m.media.music.playing || m.media.sponsor.vis === 'live' || m.media.shows.some((x) => x.vis === 'live') || m.media.gifs.some((x) => x.vis === 'live')));
};
const streamerList = (who) => (who ? visibleStreamers(who) : []).map((x) => Object.assign(
  { id: x.id, name: x.name, live: isLive(x) },
  who && who.role === 'owner' ? { code: x.code, legacy: x.legacy } : {},
));
const visibleStreamers = (who) => streamers.filter((x) => canSee(who, x));
function hello(ws) {
  const st = byId(ws.streamerId);
  if (!st) return;
  const owner = ws.role === 'control' && ws.who && ws.who.role === 'owner';
  const seeIt = ws.role === 'overlay' || (ws.who && canSee(ws.who, st));
  if (ws.role === 'overlay' && !ws.counted) { ws.counted = true; st.obsConnects = (st.obsConnects || 0) + 1; } // reconnects, for the status page
  if (!seeIt) return;
  send(ws, {
    type: 'hello', now: Date.now(), build: BUILD, locked: !!CONTROL_KEY,
    streamer: Object.assign({ id: st.id, name: st.name, look: st.look, stack: st.stack }, owner ? { code: st.code, legacy: st.legacy, hideCode: st.code } : {}),
    modules: ws.role === 'control' ? modulesFor(ws.who, st) : Object.fromEntries(Object.entries(st.modules).map(([k, m]) => [k, TRIMMED.includes(k) ? viewFor('overlay', k, m) : m])),
  });
  if (ws.role === 'control') {
    send(ws, { type: 'streamers', list: streamerList(ws.who) });
    send(ws, { type: 'hub', tiles: hub.tiles, links: owner ? hub.links : undefined, people: owner ? peopleSummary() : undefined });
    if (owner) send(ws, { type: 'activityAll', streamer: st.id, list: st.activity.slice(-200) });
    if (canTab(ws.who, 'canvas')) send(ws, { type: 'media', streamer: st.id, list: st.media, playlistMB: st.playlistMB || Math.floor(shareOf() / 1048576) });
    send(ws, { type: 'obs', streamer: st.id, count: obsCount(st.id) });
    send(ws, { type: 'restore', streamer: st.id, count: st.restore ? st.restore.count : 0 });
    if (owner) send(ws, { type: 'twitchStatus', streamer: st.id, status: twitch.status(st.id) });
    if (owner) send(ws, { type: 'ops', streamer: st.id, ops: opsView(st) });
    send(ws, { type: 'setups', streamer: st.id, list: setupList(st) });
    if (owner || hasTw(ws.who, 'chat')) send(ws, { type: 'chatAll', streamer: st.id, chat: owner ? st.chat : undefined, list: st.chatLog, state: chat.status });
  }
}
const peopleSummary = () => ({ requests: hub.requests.length });
const obsCount = (id) => Array.from(wss.clients).filter((c) => c.role === 'overlay' && c.streamerId === id && c.readyState === 1).length;
function obsChanged(id) {
  const count = obsCount(id);
  wss.clients.forEach((c) => { if (c.role === 'control' && c.streamerId === id) send(c, { type: 'obs', streamer: id, count }); });
}
// Sends only what changed since the last message; if just the "last checked" time moved, a tiny tick.
function changed(st, id, fromLive) {
  const m = st.modules[id];
  m.ts = Date.now();
  const now = shape(m);
  const prev = st.sent[id];
  if (fromLive && prev && id === 'scoreboard') describe(prev.state, m).forEach((line) => logActivity(st, 'Live', line));
  let msg;
  if (prev && prev.shape === now) {
    msg = JSON.stringify({ type: 'tick', module: id, updatedAt: m.feed ? m.feed.updatedAt : 0, nextAt: m.feed ? m.feed.nextAt : 0, now: Date.now() });
  } else {
    const patch = prev ? Match.diff(prev.state, m) : null;
    msg = JSON.stringify(patch && patch.length < 60
      ? { type: 'delta', module: id, patch, now: Date.now() }
      : { type: 'state', module: id, state: m, now: Date.now() });
  }
  st.sent[id] = { shape: now, state: Match.copy(m) };
  const wasLive = st.lastLive;
  st.lastLive = isLive(st);
  const tick = !!(prev && prev.shape === now);
  wss.clients.forEach((ws) => {
    if (ws.streamerId !== st.id || (ws.role === 'control' && !canTab(ws.who, id))) return;
    const v = TRIMMED.includes(id) && !tick ? viewFor(ws.role === 'control' ? ws.who : 'overlay', id, m) : m;
    send(ws, v === m ? msg : { type: 'state', module: id, state: v, now: Date.now() });
  });
  if (wasLive !== st.lastLive) listChanged();
  if (now !== lastSaved) {
    lastSaved = now;
    saveSoon();
  }
}
function listChanged() {
  wss.clients.forEach((ws) => { if (ws.role === 'control') send(ws, { type: 'streamers', list: streamerList(ws.who) }); });
  saveSoon();
}
function hubChanged() {
  wss.clients.forEach((ws) => {
    if (ws.role !== 'control') return;
    const owner = ws.who && ws.who.role === 'owner';
    send(ws, { type: 'hub', tiles: hub.tiles, links: owner ? hub.links : undefined, people: owner ? peopleSummary() : undefined });
  });
  saveSoon();
}
// After someone is approved, removed, timed out or changed: every open hub re-checks who it belongs to.
function sessionsChanged() {
  wss.clients.forEach((ws) => {
    if (ws.role !== 'control') return;
    const before = ws.who ? ws.who.role : 'none';
    ws.who = whoIs(ws.token);
    if (ws.who.role !== before || ws.who.role === 'editor') {
      send(ws, { type: 'session', role: ws.who.role, reason: ws.who.reason || '', tabs: tabsOf(ws.who) });
      const first = visibleStreamers(ws.who)[0];
      if (!byId(ws.streamerId) || !canSee(ws.who, byId(ws.streamerId))) ws.streamerId = first ? first.id : '';
      hello(ws);
    }
  });
  hubChanged();
}
wss.on('connection', (ws, req) => {
  if (wss.clients.size > MAX_CONNECTIONS) { ws.close(1013, 'Too many devices connected'); return; }
  const q = new URL(req.url, 'http://x').searchParams;
  ws.alive = true;
  ws.token = '';
  ws.who = whoIs('');
  if (q.has('o')) {
    // An OBS overlay: its code decides whose overlays it shows. An empty code is the old /overlay link.
    const code = q.get('o');
    const st = code ? byCode(code) : legacyStreamer();
    ws.code = code;
    ws.role = 'overlay';
    ws.streamerId = st ? st.id : '';
    if (!st) { send(ws, { type: 'gone', now: Date.now(), build: BUILD }); }
  } else if (q.get('role') === 'control') {
    ws.role = 'control';
    ws.streamerId = (byId(q.get('s')) || streamers[0]).id; // checked against who it is once it signs in
  } else {
    // Overlay pages from before streamer tabs connect without a code: they show the first streamer.
    const st = legacyStreamer();
    ws.role = 'overlay';
    ws.streamerId = st ? st.id : '';
  }
  ws.on('pong', () => { ws.alive = true; ws.lastPong = Date.now(); });
  ws.on('error', () => {});
  // The hub's "OBS connected" light: tell it whenever an OBS page for this streamer connects or drops
  if (ws.role === 'overlay' && ws.streamerId) setTimeout(() => obsChanged(ws.streamerId), 50);
  ws.on('close', () => { if (ws.role === 'overlay' && ws.streamerId) setTimeout(() => obsChanged(ws.streamerId), 50); });
  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(String(data)); } catch (e) { return; }
    if (!msg || typeof msg !== 'object') return;
    // The OBS page confirms each change it has drawn; the hub shows "applied"
    if (ws.role === 'overlay') {
      if (msg.type === 'mediaEnded' && ws.streamerId) {
        const stE = byId(ws.streamerId);
        const mu = stE && stE.modules.media && stE.modules.media.music;
        if (mu && mu.playing && mu.seq === Number(msg.seq) && mu.i === Number(msg.i) && mu.q.length) {
          const now = Date.now();
          if (mu.repeat === 'one') mu.at = now;
          else if (mu.shuffle && mu.q.length > 1) { let k = mu.i; while (k === mu.i) k = Math.floor(Math.random() * mu.q.length); mu.i = k; mu.at = now; }
          else if (mu.i + 1 < mu.q.length) { mu.i += 1; mu.at = now; }
          else if (mu.repeat === 'all') { mu.i = 0; mu.at = now; }
          else { mu.playing = false; mu.pos = 0; }
          mu.pos = 0; mu.seq += 1;
          changed(stE, 'media');
        }
        return;
      }
      if (msg.type === 'applied' && ws.streamerId) { const sa = byId(ws.streamerId); if (sa) sa.lastApplied = Date.now(); }
      // Which tab each hub tab is on (for People and the "also editing" warning); never other sites or keystrokes
      if (msg.type === 'view' && ws.role === 'control') { ws.view = String(msg.view || '').replace(/[^a-z]/g, '').slice(0, 20); ws.viewAt = Date.now(); return; }
      if (msg.type === 'applied' && ws.streamerId && typeof msg.module === 'string') {
        const out = { type: 'applied', streamer: ws.streamerId, module: msg.module.slice(0, 20), ts: Number(msg.ts) || 0 };
        wss.clients.forEach((c) => { if (c.role === 'control' && c.streamerId === ws.streamerId) send(c, out); });
      }
      return;
    }
    if (ws.role !== 'control') return;
    if (msg.type === 'auth') {
      // A session token from signing in; the CONTROL_KEY itself still works for the owner.
      ws.token = msg.token ? String(msg.token) : '';
      ws.install = String(msg.install || '').replace(/[^a-z0-9]/gi, '').slice(0, 20);
      ws.who = msg.key && CONTROL_KEY && keyMatches(msg.key) ? { role: 'owner', name: 'Owner' } : whoIs(ws.token);
      touch(ws.who);
      send(ws, { type: 'auth', ok: ws.who.role === 'owner' || ws.who.role === 'editor', role: ws.who.role, reason: ws.who.reason || '', locked: !!CONTROL_KEY });
      const st = byId(ws.streamerId);
      if (!st || !canSee(ws.who, st)) { const first = visibleStreamers(ws.who)[0]; ws.streamerId = first ? first.id : ''; }
      hello(ws);
      return;
    }
    if (msg.type === 'watch') {
      const st = byId(msg.streamer);
      if (st && canSee(ws.who, st)) { ws.streamerId = st.id; hello(ws); }
      return;
    }
    if (msg.type === 'laser') {
      const st = byId(msg.streamer);
      if (!st || !ws.who || !canSee(ws.who, st)) return;
      const out = { type: 'laser', on: !!msg.on, x: Math.round(Number(msg.x) || 0), y: Math.round(Number(msg.y) || 0) };
      wss.clients.forEach((o) => { if (o.role === 'overlay' && o.streamerId === st.id) send(o, out); });
      return;
    }
    if (msg.type === 'patch') {
      const st = byId(msg.streamer);
      const def = MODULES[msg.module];
      if (!st || !def) { send(ws, { type: 'ack', id: msg.id, ok: false, error: 'That streamer or overlay doesn’t exist any more.' }); return; }
      if (!canSee(ws.who, st)) { send(ws, { type: 'ack', id: msg.id, ok: false, error: 'auth' }); return; }
      if (!canTab(ws.who, msg.module)) { send(ws, { type: 'ack', id: msg.id, ok: false, error: 'You don’t have access to that tab. Ask the owner.' }); return; }
      touch(ws.who);
      const lk = ws.who.role !== 'owner' ? ops.lockOf(st, msg.module) : null;
      if (lk && (lk.kind === 'all' || /"(x|y|scale|lock)"/.test(JSON.stringify(msg.patch || '')))) { send(ws, { type: 'ack', id: msg.id, ok: false, error: `The owner has locked ${lk.kind === 'layout' ? 'the layout of ' : ''}this tab${lk.reason ? ` (${lk.reason})` : ''}.` }); return; }
      ws.lastAct = Date.now();
      const prev = st.modules[msg.module];
      const draft = Match.copy(prev);
      const TW_FIELD = { alerts: 'alerts', plook: 'polls', timers: 'timers', cmds: 'cmds', links: 'points', titleFav: 'title', catFav: 'category' };
      const allowed = ws.who.role === 'owner' ? def.patchable : def.patchable.filter((k) => !EDITOR_BLOCKED.includes(k) && (msg.module !== 'twitch' || !TW_FIELD[k] || twPerms(ws.who).includes(TW_FIELD[k])));
      Match.applyPatch(draft, msg.patch, allowed);
      const next = def.normalize(draft);
      def.keep(prev, next);
      st.modules[msg.module] = next;
      def.after(st, prev, next, msg);
      if (msg.module === 'scoreboard') describe(prev, next).forEach((line) => logActivity(st, ws.who.name, line));
      changed(st, msg.module);
      send(ws, { type: 'ack', id: msg.id, ok: true });
      ops.noteChange(st, msg.module, ws.who.name);
      coedit(st, ws, msg.module);
    }
  });
  hello(ws);
});
// Every 15 seconds: drop dead connections, keep proxies from closing live ones, and keep every clock in sync.
setInterval(() => {
  const ping = JSON.stringify({ type: 'ping', now: Date.now() });
  wss.clients.forEach((ws) => {
    if (!ws.alive) { ws.terminate(); return; }
    ws.alive = false;
    try { ws.ping(); } catch (e) { /* closing */ }
    send(ws, ping);
  });
}, 15000).unref();

/* ---------- HTTP routes ---------- */
app.disable('x-powered-by');
app.set('trust proxy', true);
app.use(express.json({ limit: '6mb' }));
const tokenOf = (req) => { const m = /^Bearer\s+(.+)$/i.exec(req.get('authorization') || ''); return m ? m[1].trim() : ''; };
// The CONTROL_KEY header still works for the owner (old hubs, scripts and tests); otherwise the sign-in token decides.
const whoFor = (req) => (CONTROL_KEY && req.get('x-control-key') && keyMatches(req.get('x-control-key')) ? { role: 'owner', name: 'Owner' } : whoIs(tokenOf(req)));
const requireOwner = (req, res, next) => {
  const who = whoFor(req);
  if (who.role !== 'owner') return res.status(who.role === 'editor' ? 403 : 401).json({ error: who.role === 'editor' ? 'Only the owner can do that.' : 'Sign in first.' });
  req.who = who; touch(who); return next();
};
const requireEditor = (req, res, next) => {
  const who = whoFor(req);
  if (who.role !== 'owner' && who.role !== 'editor') return res.status(401).json({ error: who.reason === 'expired' ? 'Your access has ended. Ask the owner to approve you again.' : 'Sign in first.' });
  req.who = who; touch(who); return next();
};
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const streamerFrom = (req, res) => {
  const st = byId(String((req.body && req.body.streamer) || req.query.streamer || req.params.streamer || ''));
  if (!st || (req.who && !canSee(req.who, st))) { res.status(404).json({ error: 'That streamer doesn’t exist, or you don’t have access to it.' }); return null; }
  return st;
};
// Sign-in attempts are limited per address, so passwords can't be guessed quickly.
const attempts = new Map();
function slowDown(req, res) {
  const ip = req.ip || 'x';
  const now = Date.now();
  const list = (attempts.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  list.push(now);
  attempts.set(ip, list);
  if (list.length > 8) { res.status(429).json({ error: 'Too many tries. Wait a few minutes, then try again.' }); return true; }
  return false;
}

app.get('/healthz', (req, res) => res.type('text').send('ok'));
app.get('/', (req, res) => res.redirect(302, '/control'));
app.get('/control', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'control.html')));
app.get(['/overlay', '/overlay/:code'], (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'overlay.html')));
app.get('/hide/:code', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'hide.html')));
app.use(express.static(PUBLIC_DIR, { index: false, setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache') }));

/* Signing in */
app.get('/api/session', (req, res) => {
  const who = whoFor(req);
  touch(who);
  res.json({
    locked: !!CONTROL_KEY, build: BUILD, role: who.role, name: who.name || who.username || '', reason: who.reason || '',
    expiresAt: who.person ? who.person.expiresAt || 0 : 0,
    tabs: tabsOf(who),
    fresh: who.role === 'owner' && freshStart,
    editorPassSet: !!hub.editorPass,
    ok: who.role === 'owner' || who.role === 'editor', // for older hub pages
  });
});
app.post('/api/login', (req, res) => { // the owner, with the CONTROL_KEY or the owner password
  if (!CONTROL_KEY) return res.json({ token: '', role: 'owner' });
  if (slowDown(req, res)) return undefined;
  const b = req.body || {};
  const given = String(b.key || b.password || '');
  const ok = (given && keyMatches(given)) || passMatches(hub.ownerPass, given); // the control key or the owner password, in the same box
  remember({ username: 'Owner', device: deviceName(req.get('user-agent')), ok: !!ok, what: 'Owner sign-in' });
  if (!ok) { saveSoon(); return res.status(401).json({ error: 'That isn’t the owner password or control key.' }); }
  const token = newToken();
  hub.owners.push({ tokenHash: sha(token), device: String(b.device || '').slice(0, 40), name: deviceName(req.get('user-agent')), createdAt: Date.now(), lastSeen: Date.now() });
  hub.owners = hub.owners.slice(-20);
  saveSoon();
  return res.json({ token, role: 'owner' });
});
app.post('/api/signin', (req, res) => { // an editor: username and the editor password, then the owner approves
  if (slowDown(req, res)) return undefined;
  const b = req.body || {};
  const username = cleanUser(b.username);
  const device = String(b.device || '').slice(0, 40);
  const name = deviceName(req.get('user-agent'));
  if (!username) return res.status(400).json({ error: 'Type a username first.' });
  if (!hub.editorPass) return res.status(400).json({ error: 'The owner hasn’t set an editor password yet.' });
  if (!passMatches(hub.editorPass, b.password)) {
    remember({ username, device: name, ok: false, what: 'Wrong editor password' });
    saveSoon();
    return res.status(401).json({ error: 'That isn’t the editor password.' });
  }
  const token = newToken();
  const person = hub.people.find((p) => p.username.toLowerCase() === username.toLowerCase());
  const known = person && person.devices.find((d) => d.device && d.device === device);
  if (person && known && !(person.expiresAt && Date.now() > person.expiresAt)) {
    // A device that was approved before: no new approval needed.
    known.tokenHash = sha(token);
    known.lastSeen = Date.now();
    remember({ username: person.username, device: name, ok: true, what: 'Signed in' });
    saveSoon();
    return res.json({ token, role: 'editor' });
  }
  hub.requests = hub.requests.filter((r) => !(r.device && r.device === device));
  if (hub.requests.length >= 20) return res.status(429).json({ error: 'There are too many requests waiting. Ask the owner to answer them.' });
  hub.requests.push({ id: rid(10), username, device, name, at: Date.now(), tokenHash: sha(token) });
  remember({ username, device: name, ok: true, what: 'Asked for access' });
  hubChanged();
  return res.json({ token, role: 'pending' });
});
app.post('/api/logout', (req, res) => {
  const h = sha(tokenOf(req));
  hub.owners = hub.owners.filter((d) => d.tokenHash !== h);
  hub.people.forEach((p) => { p.devices.forEach((d) => { if (d.tokenHash === h) d.tokenHash = ''; }); });
  hub.requests = hub.requests.filter((r) => r.tokenHash !== h);
  saveSoon();
  res.json({ ok: true });
});

/* People (owner) */
const expiryFrom = (v) => {
  const spans = { '1h': 3600e3, '24h': 864e5, '7d': 7 * 864e5, '30d': 30 * 864e5 };
  if (v === 'never') return 0;
  if (spans[v]) return Date.now() + spans[v];
  const t = Date.parse(v);
  return Number.isFinite(t) && t > Date.now() ? t : Date.now() + 864e5;
};
const personView = (p) => ({
  id: p.id, username: p.username, streamers: p.streamers, tabs: Array.isArray(p.tabs) ? p.tabs : TABS.slice(), expiresAt: p.expiresAt || 0, createdAt: p.createdAt, lastSeen: p.lastSeen || 0,
  online: Array.from(wss.clients).some((ws) => ws.who && ws.who.person && ws.who.person.id === p.id),
  tabsOpen: Array.from(wss.clients).filter((ws) => ws.who && ws.who.person && ws.who.person.id === p.id).length,
  browsers: new Set(Array.from(wss.clients).filter((ws) => ws.who && ws.who.person && ws.who.person.id === p.id).map((ws) => ws.install || ws.token)).size,
  tw: p.tw || { preset: 'none', perms: [] },
  views: [...new Set(Array.from(wss.clients).filter((ws) => ws.who && ws.who.person && ws.who.person.id === p.id).map((ws) => ws.view).filter(Boolean))],
  lastAct: Math.max(0, ...Array.from(wss.clients).filter((ws) => ws.who && ws.who.person && ws.who.person.id === p.id).map((ws) => ws.lastAct || 0)),
  devices: p.devices.filter((d) => d.tokenHash).map((d) => ({ name: d.name, lastSeen: d.lastSeen || d.createdAt })),
});
app.get('/api/people', requireOwner, (req, res) => res.json({
  requests: hub.requests.map(({ id, username, name, at }) => ({ id, username, device: name, at })),
  people: hub.people.map(personView),
  signins: hub.signins.slice(-150).reverse(),
  editorPassSet: !!hub.editorPass, ownerPassSet: !!hub.ownerPass,
}));
app.post('/api/people/requests/:id/:action(accept|decline)', requireOwner, (req, res) => {
  const r = hub.requests.find((x) => x.id === req.params.id);
  if (!r) return res.status(404).json({ error: 'That request has already been answered.' });
  hub.requests = hub.requests.filter((x) => x !== r);
  if (req.params.action === 'decline') {
    remember({ username: r.username, device: r.name, ok: false, what: 'Declined by the owner' });
    sessionsChanged();
    return res.json({ ok: true });
  }
  const b = req.body || {};
  const ids = (Array.isArray(b.streamers) ? b.streamers : []).filter((id) => byId(id));
  let p = hub.people.find((x) => x.username.toLowerCase() === r.username.toLowerCase());
  if (!p) { p = { id: rid(10), username: r.username, streamers: [], expiresAt: 0, createdAt: Date.now(), lastSeen: 0, devices: [] }; hub.people.push(p); }
  p.streamers = ids.length ? ids : p.streamers.length ? p.streamers : [streamers[0].id];
  if (cleanTabs(b.tabs)) p.tabs = cleanTabs(b.tabs);
  p.expiresAt = expiryFrom(b.expires || '24h');
  p.devices = p.devices.filter((d) => d.device !== r.device).concat({ tokenHash: r.tokenHash, device: r.device, name: r.name, createdAt: Date.now(), lastSeen: Date.now() }).slice(-6);
  remember({ username: p.username, device: r.name, ok: true, what: 'Approved by the owner' });
  sessionsChanged();
  return res.json({ ok: true, person: personView(p) });
});
// Sign out one of an editor's devices: it loses access straight away
app.post('/api/people/:id/devices/:i/signout', requireOwner, (req, res) => {
  const p = hub.people.find((x) => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'That person isn’t on the list any more.' });
  const signedIn = p.devices.filter((d) => d.tokenHash);
  const d = signedIn[Number(req.params.i)];
  if (!d) return res.status(404).json({ error: 'That device isn’t signed in any more.' });
  d.tokenHash = '';
  remember({ username: p.username, device: d.name, ok: true, what: 'Signed out by the owner' });
  sessionsChanged();
  saveSoon();
  return res.json({ ok: true });
});
app.patch('/api/people/:id', requireOwner, (req, res) => {
  const p = hub.people.find((x) => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'That person isn’t on the list any more.' });
  const b = req.body || {};
  if (b.expires) p.expiresAt = expiryFrom(b.expires);
  if (Array.isArray(b.streamers)) p.streamers = b.streamers.filter((id) => byId(id));
  if (cleanTabs(b.tabs)) p.tabs = cleanTabs(b.tabs);
  if (b.tw && typeof b.tw === 'object') {
    const preset = ['none', 'content', 'manager', 'moderator', 'custom'].includes(b.tw.preset) ? b.tw.preset : 'custom';
    p.tw = { preset, perms: preset === 'custom' ? (Array.isArray(b.tw.perms) ? TW_PERMS.filter((x) => b.tw.perms.includes(x)) : []) : TW_PRESETS[preset].slice() };
    remember({ username: p.username, device: '', ok: true, what: `Twitch Centre permissions set to ${preset === 'custom' ? p.tw.perms.join(', ') || 'none' : preset}` });
  }
  sessionsChanged();
  saveSoon();
  return res.json({ ok: true, person: personView(p) });
});
app.delete('/api/people/:id', requireOwner, (req, res) => {
  const p = hub.people.find((x) => x.id === req.params.id);
  hub.people = hub.people.filter((x) => x.id !== req.params.id);
  if (p) remember({ username: p.username, device: '', ok: false, what: 'Removed by the owner' });
  if (p) twitch.forget(`ed:${p.id}`);
  sessionsChanged();
  res.json({ ok: true });
});
app.post('/api/passwords', requireOwner, (req, res) => {
  const b = req.body || {};
  if (b.editor !== undefined) {
    if (String(b.editor).length < 6) return res.status(400).json({ error: 'Make the editor password at least 6 characters.' });
    hub.editorPass = hashPass(b.editor);
  }
  if (b.owner !== undefined) {
    if (String(b.owner).length < 8) return res.status(400).json({ error: 'Make the owner password at least 8 characters.' });
    hub.ownerPass = hashPass(b.owner);
  }
  if (b.signOutEditors) hub.people.forEach((p) => { p.devices = []; });
  sessionsChanged();
  return res.json({ ok: true });
});

/* The hub's own settings: tile order and names, and links (owner) */
app.patch('/api/hub', requireOwner, (req, res) => {
  const t = (req.body && req.body.tiles) || {};
  if (t.mode) hub.tiles.mode = t.mode === 'custom' ? 'custom' : 'auto';
  if (Array.isArray(t.order)) hub.tiles.order = t.order.slice(0, 20).map(String);
  if (t.names && typeof t.names === 'object') {
    hub.tiles.names = {};
    Object.entries(t.names).forEach(([k, v]) => { const n = cleanName(v, ''); if (n) hub.tiles.names[String(k).slice(0, 32)] = n; });
  }
  hubChanged();
  res.json({ ok: true });
});
const cleanUrl = (v) => { try { const u = new URL(String(v).trim()); return /^https?:$/.test(u.protocol) ? u.href : ''; } catch (e) { return ''; } };
app.post('/api/links', requireOwner, (req, res) => {
  const url = cleanUrl(req.body && req.body.url);
  if (!url) return res.status(400).json({ error: 'Paste a full link, starting with https://' });
  if (hub.links.length >= 50) return res.status(400).json({ error: 'That’s the most links the hub holds. Remove one first.' });
  hub.links.push({ id: rid(8), name: cleanName(req.body.name, new URL(url).hostname), url });
  hubChanged();
  return res.json({ ok: true });
});
app.patch('/api/links/:id', requireOwner, (req, res) => {
  const l = hub.links.find((x) => x.id === req.params.id);
  if (!l) return res.status(404).json({ error: 'That link has gone.' });
  const b = req.body || {};
  if (b.name !== undefined) l.name = cleanName(b.name, l.name);
  if (b.url !== undefined) { const u = cleanUrl(b.url); if (!u) return res.status(400).json({ error: 'Paste a full link, starting with https://' }); l.url = u; }
  if (b.move) { const i = hub.links.indexOf(l); const j = Math.max(0, Math.min(hub.links.length - 1, i + (b.move > 0 ? 1 : -1))); hub.links.splice(i, 1); hub.links.splice(j, 0, l); }
  hubChanged();
  return res.json({ ok: true });
});
app.delete('/api/links/:id', requireOwner, (req, res) => { hub.links = hub.links.filter((x) => x.id !== req.params.id); hubChanged(); res.json({ ok: true }); });

/* Activity (owner) */
app.get('/api/activity', requireOwner, (req, res) => { const st = streamerFrom(req, res); if (st) res.json({ list: st.activity.slice(-MAX_ACTIVITY) }); });

/* Backup and restore (owner): one streamer or everything. People and passwords are never in a backup. */
app.get('/api/backup', requireOwner, (req, res) => {
  const one = req.query.streamer ? streamerFrom(req, res) : null;
  if (req.query.streamer && !one) return undefined;
  const list = one ? [one] : streamers;
  res.set('Content-Disposition', `attachment; filename="overlay-hub-${one ? one.name.replace(/[^\w-]+/g, '-') : 'everything'}-${new Date().toISOString().slice(0, 10)}.json"`);
  return res.json({ kind: 'overlay-hub-backup', v: 1, at: Date.now(), scope: one ? 'streamer' : 'all', hub: one ? undefined : { tiles: hub.tiles, links: hub.links }, streamers: list.map(streamerData) });
});
app.post('/api/restore', requireOwner, (req, res) => {
  const b = (req.body && req.body.backup) || {};
  if (b.kind !== 'overlay-hub-backup' || !Array.isArray(b.streamers) || !b.streamers.length) return res.status(400).json({ error: 'That file isn’t an overlay hub backup.' });
  const target = req.body.streamer ? streamerFrom(req, res) : null;
  if (req.body.streamer && !target) return undefined;
  if (target) {
    // One streamer: their overlays, crests and look come back; their name and OBS link stay as they are.
    const src = makeStreamer(Object.assign({}, b.streamers[0], { id: target.id, code: target.code, name: target.name, legacy: target.legacy }));
    target.espn.stop();
    streamers.splice(streamers.indexOf(target), 1, src);
    logActivity(src, req.who.name, 'Restored from a backup');
  } else {
    streamers.forEach((x) => x.espn.stop());
    streamers.splice(0, streamers.length, ...b.streamers.slice(0, MAX_STREAMERS).map((x) => makeStreamer(x)));
    b.streamers.slice(0, MAX_STREAMERS).forEach((x, i) => memLoad(streamers[i], x.gameMem));
    if (b.hub) { loadHub(Object.assign({}, hub, { tiles: b.hub.tiles, links: b.hub.links })); }
    streamers.forEach((x) => logActivity(x, req.who.name, 'Restored from a backup'));
  }
  streamers.forEach((x) => x.espn.start());
  freshStart = false;
  wss.clients.forEach((ws) => {
    if (ws.role === 'overlay') { const st = ws.code ? byCode(ws.code) : legacyStreamer(); ws.streamerId = st ? st.id : ''; }
    if (ws.role === 'control') { if (!byId(ws.streamerId)) ws.streamerId = (visibleStreamers(ws.who || {})[0] || {}).id || ''; }
    hello(ws);
  });
  listChanged();
  hubChanged();
  return res.json({ ok: true });
});

/* Streamers (owner manages; editors can hide their own streamers' overlays) */
app.get('/api/streamers', requireEditor, (req, res) => res.json({ streamers: streamerList(req.who) }));
app.post('/api/streamers', requireOwner, (req, res) => {
  if (streamers.length >= MAX_STREAMERS) return res.status(400).json({ error: `The hub holds up to ${MAX_STREAMERS} streamers, to stay inside the free plan.` });
  const st = makeStreamer({ name: cleanName(req.body && req.body.name, `Streamer ${streamers.length + 1}`) });
  if (req.body && req.body.name && toChannel(st.name).length >= 3) st.chat.channel = toChannel(st.name);
  streamers.push(st);
  updateChat();
  logActivity(st, req.who.name, `Added ${st.name}`);
  listChanged();
  return res.json({ streamer: { id: st.id, name: st.name, code: st.code } });
});
app.patch('/api/streamers/:streamer', requireOwner, (req, res) => {
  const st = streamerFrom(req, res);
  if (!st) return undefined;
  const b = req.body || {};
  if (b.name !== undefined) {
    const before = st.name;
    st.name = cleanName(b.name, st.name);
    // The chat channel follows the name, unless the owner typed a different channel
    if (!st.chat.channel || st.chat.channel === toChannel(before)) { st.chat.channel = toChannel(st.name).length >= 3 ? toChannel(st.name) : st.chat.channel; updateChat(); }
  }
  if (b.look) st.look = cleanLook(Object.assign({}, st.look, b.look));
  if (b.stack) st.stack = cleanStack(b.stack);
  listChanged();
  wss.clients.forEach((ws) => { if (ws.streamerId === st.id) hello(ws); });
  return res.json({ ok: true });
});
app.post('/api/streamers/:streamer/link', requireOwner, (req, res) => {
  const st = streamerFrom(req, res);
  if (!st) return undefined;
  st.code = rid(16);
  st.legacy = false;
  // Overlays using the old link stop showing anything straight away.
  wss.clients.forEach((ws) => { if (ws.role === 'overlay' && ws.streamerId === st.id) { send(ws, { type: 'gone', now: Date.now(), build: BUILD }); ws.streamerId = ''; } });
  logActivity(st, req.who.name, 'Reset the OBS link');
  listChanged();
  wss.clients.forEach((ws) => { if (ws.role === 'control' && ws.streamerId === st.id) hello(ws); });
  return res.json({ code: st.code });
});
app.delete('/api/streamers/:streamer', requireOwner, (req, res) => {
  const st = streamerFrom(req, res);
  if (st) twitch.forget(st.id); // their Twitch connection goes too
  if (!st) return undefined;
  if (streamers.length === 1) return res.status(400).json({ error: 'The hub needs at least one streamer.' });
  st.espn.stop();
  streamers.splice(streamers.indexOf(st), 1);
  hub.people.forEach((p) => { p.streamers = p.streamers.filter((id) => id !== st.id); });
  wss.clients.forEach((ws) => {
    if (ws.streamerId !== st.id) return;
    if (ws.role === 'overlay') { send(ws, { type: 'gone', now: Date.now(), build: BUILD }); ws.streamerId = ''; } else { ws.streamerId = (visibleStreamers(ws.who || {})[0] || {}).id || ''; hello(ws); }
  });
  listChanged();
  return res.json({ ok: true });
});
// Takes every overlay of one streamer off screen at once.
// Autopilot: shows the right things at kick-off and full time by itself. It acts once at each moment, so anything
// changed by hand afterwards stays, and Hide everything stops it putting anything back for 10 minutes.
function autopilot(st) {
  const s = st.modules.scoreboard;
  const mem = st.autoMem || (st.autoMem = { phase: s.period });
  if (!s.auto.on) { mem.phase = s.period; return; }
  const now = Date.now();
  const lines = [];
  const paused = st.hiddenAt && now - st.hiddenAt < 10 * 60 * 1000;
  if (!paused && s.period === 'pre' && s.kickoffAt && s.kickoffAt - now < 15 * 60 * 1000 && s.kickoffAt - now > -5 * 60 * 1000 && mem.pre !== s.kickoffAt) {
    mem.pre = s.kickoffAt;
    if (!s.onAir) { s.onAir = true; lines.push('Put the scoreboard on screen before kick-off'); }
    if (s.auto.pre !== 'none' && s.board === 'none') { s.board = s.auto.pre; lines.push(`Showed the ${s.auto.pre === 'lineups' ? 'line-ups' : 'match info'} card`); }
  }
  if (mem.phase === 'pre' && s.period !== 'pre' && ['lineups', 'info'].includes(s.board)) { s.board = 'none'; lines.push('Took the pre-match card off at kick-off'); }
  if (s.period === 'ft') {
    if (!mem.ftAt) mem.ftAt = now;
    if (!paused && s.auto.ftOff && !mem.ftDone && s.onAir && now - mem.ftAt > s.auto.ftOff * 60 * 1000) { mem.ftDone = true; s.onAir = false; s.board = 'none'; lines.push(`Took the scoreboard off screen ${s.auto.ftOff} minutes after full time`); }
  } else { mem.ftAt = 0; mem.ftDone = false; }
  mem.phase = s.period;
  if (lines.length) { lines.forEach((l) => logActivity(st, 'Autopilot', l)); changed(st, 'scoreboard'); listChanged(); }
}
setInterval(() => streamers.forEach(autopilot), 10 * 1000).unref();

function hideAll(st, who) {
  st.hiddenAt = Date.now();
  // Remember exactly what was on screen, so Restore can bring that back, then tell OBS to hide instantly (no exit animation)
  {
    const sb0 = st.modules.scoreboard, cv0 = st.modules.canvas, dk0 = st.modules.desk, gm0 = st.modules.games;
    const snap = { at: Date.now(), scoreboard: !!sb0.onAir, items: cv0.items.filter((i) => i.vis === 'live').map((i) => i.id), ink: cv0.ink === 'live', spot: !!cv0.spot.on, music: !!cv0.music.playing,
      desk: dk0.widgets.filter((w) => w.vis === 'live').map((w) => w.id), games: gm0 ? ['poll', 'contexto', 'flags', 'give', 'hunt', 'board'].filter((k) => gm0[k].vis === 'live') : [],
      challenges: st.modules.challenges ? st.modules.challenges.widgets.filter((w) => w.vis === 'live').map((w) => w.id) : [],
      media: st.modules.media ? mediaLive(st.modules.media) : [], mediaMusic: !!(st.modules.media && st.modules.media.music.playing), subathon: st.modules.subathon ? subLive(st.modules.subathon) : [], twitch: st.modules.twitch ? tcLive(st.modules.twitch) : [] };
    snap.count = (snap.scoreboard ? 1 : 0) + snap.items.length + (snap.ink ? 1 : 0) + (snap.spot ? 1 : 0) + (snap.music ? 1 : 0) + snap.desk.length + snap.games.length + snap.challenges.length + snap.media.length + (snap.mediaMusic ? 1 : 0) + snap.subathon.length + snap.twitch.length;
    if (snap.count) st.restore = snap;
    wss.clients.forEach((c) => { if (c.role === 'overlay' && c.streamerId === st.id) send(c, { type: 'instant', ms: 1500 }); });
  }
  // Every overlay off: the scoreboard, each Canvas item and the drawing, and each Stream Desk widget, previews included
  const sb = st.modules.scoreboard;
  if (sb.onAir || sb.preview) { sb.onAir = false; sb.preview = false; changed(st, 'scoreboard'); }
  const cv = st.modules.canvas;
  if (cv.items.some((i) => i.vis !== 'off') || cv.ink !== 'off' || cv.spot.on || cv.music.playing) {
    cv.items.forEach((i) => { i.vis = 'off'; });
    cv.ink = 'off';
    cv.spot.on = false;
    cv.music.playing = false;
    changed(st, 'canvas');
  }
  const dk = st.modules.desk;
  if (dk.widgets.some((w) => w.vis !== 'off')) { dk.widgets.forEach((w) => { w.vis = 'off'; }); changed(st, 'desk'); }
  const gm = st.modules.games;
  const GK = ['poll', 'contexto', 'flags', 'give', 'hunt', 'board'];
  if (gm && GK.some((k) => gm[k].vis !== 'off')) { GK.forEach((k) => { gm[k].vis = 'off'; }); changed(st, 'games'); }
  const chm = st.modules.challenges;
  if (chm && chm.widgets.some((w) => w.vis !== 'off')) { chm.widgets.forEach((w) => { w.vis = 'off'; }); changed(st, 'challenges'); }
  const sbm = st.modules.subathon;
  if (sbm && subLive(sbm).length) { subSet(sbm, [], true); changed(st, 'subathon'); }
  const tcm = st.modules.twitch;
  if (tcm && (tcm.alerts.vis !== 'off' || tcm.plook.vis !== 'off')) { tcm.alerts.vis = 'off'; tcm.plook.vis = 'off'; changed(st, 'twitch'); }
  const md = st.modules.media;
  if (md) {
    const mv = [md.sponsor].concat(md.shows, md.gifs);
    if (mv.some((x) => x.vis !== 'off') || md.music.playing) {
      mv.forEach((x) => { x.vis = 'off'; });
      if (md.music.playing) { md.music.pos = (Date.now() - md.music.at) / 1000; md.music.playing = false; md.music.seq += 1; }
      md.stopSeq += 1;
      changed(st, 'media');
    }
  }
  logActivity(st, who, 'Hid everything');
  listChanged();
  restoreChanged(st);
}
// Saved setups: what's on screen in every tab, saved with a name and put back in one tap
const GAME_KEYS = ['poll', 'contexto', 'flags', 'give', 'hunt', 'board'];
function snapshotLive(st) {
  const sb = st.modules.scoreboard, cv = st.modules.canvas, dk = st.modules.desk, gm = st.modules.games;
  const snap = { scoreboard: !!sb.onAir, items: cv.items.filter((i) => i.vis === 'live').map((i) => i.id), ink: cv.ink === 'live', spot: !!cv.spot.on, music: !!cv.music.playing,
    desk: dk.widgets.filter((w) => w.vis === 'live').map((w) => w.id), games: gm ? GAME_KEYS.filter((k) => gm[k].vis === 'live') : [],
    challenges: st.modules.challenges ? st.modules.challenges.widgets.filter((w) => w.vis === 'live').map((w) => w.id) : [],
    media: st.modules.media ? mediaLive(st.modules.media) : [], subathon: st.modules.subathon ? subLive(st.modules.subathon) : [], twitch: st.modules.twitch ? tcLive(st.modules.twitch) : [] };
  snap.count = (snap.scoreboard ? 1 : 0) + snap.items.length + (snap.ink ? 1 : 0) + (snap.spot ? 1 : 0) + (snap.music ? 1 : 0) + snap.desk.length + snap.games.length + snap.challenges.length + snap.media.length + snap.subathon.length + snap.twitch.length;
  return snap;
}
function applySetup(st, r) {
  const sb = st.modules.scoreboard, cv = st.modules.canvas, dk = st.modules.desk, gm = st.modules.games;
  if (sb.onAir !== r.scoreboard || sb.preview) { sb.onAir = r.scoreboard; sb.preview = false; changed(st, 'scoreboard'); }
  cv.items.forEach((i) => { i.vis = r.items.includes(i.id) ? 'live' : 'off'; });
  cv.ink = r.ink ? 'live' : 'off'; cv.spot.on = r.spot; cv.music.playing = r.music;
  changed(st, 'canvas');
  dk.widgets.forEach((w) => { w.vis = r.desk.includes(w.id) ? 'live' : 'off'; });
  changed(st, 'desk');
  if (gm) { GAME_KEYS.forEach((k) => { gm[k].vis = r.games.includes(k) ? 'live' : 'off'; }); changed(st, 'games'); }
  const ch = st.modules.challenges;
  if (ch) { ch.widgets.forEach((w) => { w.vis = (r.challenges || []).includes(w.id) ? 'live' : 'off'; }); changed(st, 'challenges'); }
  if (st.modules.media) { mediaSet(st.modules.media, r.media || [], true); changed(st, 'media'); }
  if (st.modules.subathon) { subSet(st.modules.subathon, r.subathon || [], true); changed(st, 'subathon'); }
  if (st.modules.twitch) { tcSet(st.modules.twitch, r.twitch || [], true); changed(st, 'twitch'); }
}
const tcParts = (t) => [['alerts', t.alerts], ['poll', t.plook]];
function tcLive(t) { return tcParts(t).filter(([, x]) => x.vis === 'live').map(([k]) => k); }
function tcSet(t, keys, only) { tcParts(t).forEach(([k, x]) => { if (keys.includes(k)) x.vis = 'live'; else if (only) x.vis = 'off'; }); }
// Subathon pieces on screen, as keys: "timer", "milestones", "spins", "board", "goal:<id>"
const subParts = (s) => [['timer', s.timer], ['milestones', s.mlook], ['spins', s.spins], ['board', s.blook]].concat(s.goals.map((g) => [`goal:${g.id}`, g]));
function subLive(s) { return subParts(s).filter(([, x]) => x.vis === 'live').map(([k]) => k); }
function subSet(s, keys, only) { subParts(s).forEach(([k, x]) => { if (keys.includes(k)) x.vis = 'live'; else if (only) x.vis = 'off'; }); }
// Media Centre pictures on screen, as keys: "sponsor", "show:<id>", "gif:<id>"
function mediaLive(md) { return [['sponsor', md.sponsor]].concat(md.shows.map((x) => [`show:${x.id}`, x]), md.gifs.map((x) => [`gif:${x.id}`, x])).filter(([, x]) => x.vis === 'live').map(([k]) => k); }
function mediaSet(md, keys, only) { [['sponsor', md.sponsor]].concat(md.shows.map((x) => [`show:${x.id}`, x]), md.gifs.map((x) => [`gif:${x.id}`, x])).forEach(([k, x]) => { if (keys.includes(k)) x.vis = 'live'; else if (only) x.vis = 'off'; }); }
// The random wheel: the server picks the result (weighted if set), one spin at a time; test spins only show in the preview
app.post('/api/streamers/:streamer/challenges/spin', requireEditor, (req, res) => {
  const st = streamerFrom(req, res);
  if (!st) return;
  if (!canTab(req.who, 'challenges')) return res.status(403).json({ error: 'You don’t have access to Challenges. Ask the owner.' });
  const w = st.modules.challenges.widgets.find((x) => x.id === String(req.body && req.body.widget) && x.kind === 'wheel');
  if (!w) return res.status(404).json({ error: 'That wheel isn’t there any more.' });
  const now = Date.now();
  if (w.spin && now < w.spin.at + w.spin.dur * 1000) return res.status(409).json({ error: 'The wheel is still spinning.' });
  // Remove each winner: the last real result comes off before the next spin
  if (w.removeWin && w.spin && !w.spin.test) { const won = w.items.find((o) => o.on && o.t === w.spin.t); if (won) won.on = false; }
  const opts = w.items.filter((o) => o.on && o.t);
  if (!opts.length) return res.status(400).json({ error: 'Add some options to the wheel first.' });
  const weight = (o) => (w.weighted ? Math.max(0, o.w) : 1);
  const total = opts.reduce((a, o) => a + weight(o), 0);
  let r = Math.random() * (total || opts.length);
  const pick = total ? opts.find((o) => (r -= weight(o)) < 0) || opts[opts.length - 1] : opts[Math.floor(r)];
  const test = !!(req.body && req.body.test);
  w.spin = { id: rid(8), i: opts.indexOf(pick), t: pick.t, at: now + 200, dur: w.dur, test };
  w.hist = [{ t: pick.t, at: now, test }].concat(w.hist).slice(0, 30);
  if (!test) logActivity(st, req.who.name, `Spun “${w.title || 'the wheel'}”: ${pick.t}`);
  changed(st, 'challenges');
  return res.json({ ok: true, result: pick.t });
});
app.post('/api/streamers/:streamer/challenges/undo-spin', requireEditor, (req, res) => {
  const st = streamerFrom(req, res);
  if (!st) return;
  if (!canTab(req.who, 'challenges')) return res.status(403).json({ error: 'You don’t have access to Challenges. Ask the owner.' });
  const w = st.modules.challenges.widgets.find((x) => x.id === String(req.body && req.body.widget) && x.kind === 'wheel');
  if (!w || !w.hist.length) return res.status(404).json({ error: 'There’s no result to undo.' });
  const last = w.hist.shift();
  const back = w.items.find((o) => !o.on && o.t === last.t);
  if (back && w.removeWin) back.on = true;
  w.spin = null;
  logActivity(st, req.who.name, `Undid the wheel result: ${last.t}`);
  changed(st, 'challenges');
  return res.json({ ok: true });
});
const setupList = (st) => st.setups.map((x) => ({ id: x.id, name: x.name, count: x.snap.count }));
function setupsChanged(st) { wss.clients.forEach((c) => { if (c.role === 'control' && c.streamerId === st.id && c.who && canSee(c.who, st)) send(c, { type: 'setups', streamer: st.id, list: setupList(st) }); }); }
app.post('/api/streamers/:streamer/setups', requireEditor, (req, res) => {
  const st = streamerFrom(req, res);
  if (!st) return;
  const name = String((req.body && req.body.name) || '').trim().slice(0, 30);
  if (!name) return res.status(400).json({ error: 'Give the setup a name first.' });
  const snap = snapshotLive(st);
  if (!snap.count) return res.status(400).json({ error: 'Put something on screen first, then save it as a setup.' });
  const same = st.setups.find((x) => x.name.toLowerCase() === name.toLowerCase());
  if (same) same.snap = snap;
  else { if (st.setups.length >= 8) return res.status(400).json({ error: 'You can keep 8 setups. Delete one first.' }); st.setups.push({ id: rid(8), name, snap, at: Date.now() }); }
  logActivity(st, req.who.name, `Saved the setup “${name}”`);
  setupsChanged(st); saveSoon();
  return res.json({ ok: true, count: snap.count, replaced: !!same });
});
app.post('/api/streamers/:streamer/setups/:id/apply', requireEditor, (req, res) => {
  const st = streamerFrom(req, res);
  if (!st) return;
  const x = st.setups.find((y) => y.id === req.params.id);
  if (!x) return res.status(404).json({ error: 'That setup isn’t there any more.' });
  applySetup(st, x.snap);
  logActivity(st, req.who.name, `Put the setup “${x.name}” on screen`);
  listChanged();
  return res.json({ ok: true, name: x.name });
});
app.delete('/api/streamers/:streamer/setups/:id', requireEditor, (req, res) => {
  const st = streamerFrom(req, res);
  if (!st) return;
  st.setups = st.setups.filter((y) => y.id !== req.params.id);
  setupsChanged(st); saveSoon();
  return res.json({ ok: true });
});
function restoreChanged(st) {
  const r = st.restore;
  wss.clients.forEach((c) => { if (c.role === 'control' && c.streamerId === st.id && c.who && canSee(c.who, st)) send(c, { type: 'restore', streamer: st.id, count: r ? r.count : 0 }); });
}
// Restore: puts back exactly what was on screen before Hide everything
app.post('/api/streamers/:streamer/restore', requireEditor, (req, res) => {
  const st = streamerFrom(req, res);
  if (!st) return;
  const r = st.restore;
  if (!r) return res.status(404).json({ error: 'There’s nothing to restore.' });
  const sb = st.modules.scoreboard, cv = st.modules.canvas, dk = st.modules.desk, gm = st.modules.games;
  if (r.scoreboard && !sb.onAir) { sb.onAir = true; changed(st, 'scoreboard'); }
  let c = 0;
  cv.items.forEach((i) => { if (r.items.includes(i.id)) { i.vis = 'live'; c += 1; } });
  if (r.ink) { cv.ink = 'live'; c += 1; }
  if (r.spot) { cv.spot.on = true; c += 1; }
  if (r.music) { cv.music.playing = true; c += 1; }
  if (c) changed(st, 'canvas');
  c = 0;
  dk.widgets.forEach((w) => { if (r.desk.includes(w.id)) { w.vis = 'live'; c += 1; } });
  if (c) changed(st, 'desk');
  if (gm && r.games.length) { r.games.forEach((k) => { gm[k].vis = 'live'; }); changed(st, 'games'); }
  const chr = st.modules.challenges;
  if (chr && (r.challenges || []).length) { chr.widgets.forEach((w) => { if (r.challenges.includes(w.id)) w.vis = 'live'; }); changed(st, 'challenges'); }
  if (st.modules.subathon && (r.subathon || []).length) { subSet(st.modules.subathon, r.subathon, false); changed(st, 'subathon'); }
  if (st.modules.twitch && (r.twitch || []).length) { tcSet(st.modules.twitch, r.twitch, false); changed(st, 'twitch'); }
  const mdr = st.modules.media;
  if (mdr && ((r.media || []).length || r.mediaMusic)) { mediaSet(mdr, r.media || [], false); if (r.mediaMusic && !mdr.music.playing) { mdr.music.at = Date.now() - mdr.music.pos * 1000; mdr.music.playing = true; mdr.music.seq += 1; } changed(st, 'media'); }
  st.restore = null;
  logActivity(st, req.who.name, 'Restored what was on screen');
  restoreChanged(st);
  listChanged();
  return res.json({ ok: true, count: r.count });
});
app.post('/api/streamers/:streamer/hide', requireEditor, (req, res) => { const st = streamerFrom(req, res); if (st) { hideAll(st, req.who.name); res.json({ ok: true }); } });
app.post('/api/hide/:code', (req, res) => { // the streamer's own one-button page, no sign-in: the secret is the code
  const st = byCode(String(req.params.code || ''));
  if (!st) return res.status(404).json({ error: 'This link doesn’t work any more. Ask the owner for the new one.' });
  hideAll(st, `${st.name} (hide button)`);
  return res.json({ ok: true, name: st.name });
});

/* ---------- Media: images and music, owner uploads only, inside the free plan's caps ---------- */
const MEDIA_DIR = path.join(DATA_DIR, 'media');
const UPLOAD_CAP = 700 * 1024 * 1024;           // all uploads together; the rest of the 1 GB volume stays free
// A hard ceiling on everything the app keeps on disk (uploads, crests and the saved setup): it never goes over 900 MB
const DISK_CAP = 900 * 1024 * 1024;
let diskCache = { at: 0, bytes: 0 };
function diskUsed(fresh) {
  if (!fresh && Date.now() - diskCache.at < 5000) return diskCache.bytes;
  let bytes = 0;
  const walk = (dir) => {
    let list = [];
    try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    list.forEach((d) => { const p = path.join(dir, d.name); if (d.isDirectory()) walk(p); else { try { bytes += fs.statSync(p).size; } catch (e) { /* gone */ } } });
  };
  walk(DATA_DIR);
  diskCache = { at: Date.now(), bytes };
  return bytes;
}
const diskFull = (extra) => diskUsed(true) + extra > DISK_CAP;
const DISK_FULL = 'The server’s storage is at its 900 MB limit. Remove some uploads first.';
const TRAFFIC_CAP = 8 * 1000 * 1000 * 1000;      // a month of media downloads
const LIMITS = { image: 8 * 1024 * 1024, audio: 30 * 1024 * 1024 };
hub.traffic = hub.traffic || { month: '', bytes: 0 };
const monthNow = () => new Date().toISOString().slice(0, 7);
const mediaBytes = (st) => st.media.reduce((n, f) => n + (f.size || 0), 0);
const allMediaBytes = () => streamers.reduce((n, x) => n + mediaBytes(x), 0);
const shareOf = () => Math.floor(UPLOAD_CAP / Math.max(1, streamers.length));
const findMedia = (mid) => { for (const x of streamers) { const f = x.media.find((m) => m.id === mid); if (f) return { st: x, f }; } return null; };
function sniff(buf) { // what the file really is, from its first bytes, not its name
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50) return { kind: 'image', ext: 'png', type: 'image/png' };
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8) return { kind: 'image', ext: 'jpg', type: 'image/jpeg' };
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return { kind: 'image', ext: 'webp', type: 'image/webp' };
  if (buf.length > 6 && buf.toString('ascii', 0, 3) === 'GIF') return { kind: 'image', ext: 'gif', type: 'image/gif' };
  if (buf.length > 3 && (buf.toString('ascii', 0, 3) === 'ID3' || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0))) return { kind: 'audio', ext: 'mp3', type: 'audio/mpeg' };
  return null;
}
function removeMedia(st, f) {
  st.media = st.media.filter((m) => m.id !== f.id);
  fs.promises.unlink(path.join(MEDIA_DIR, `${f.id}.${f.ext}`)).catch(() => {});
}
function mediaChanged(st) {
  wss.clients.forEach((ws) => { if (ws.role === 'control' && ws.streamerId === st.id && ws.who && canSee(ws.who, st) && canTab(ws.who, 'canvas')) send(ws, { type: 'media', streamer: st.id, list: st.media, playlistMB: st.playlistMB || Math.floor(shareOf() / 1048576) }); });
  saveSoon();
}
app.post('/api/media', requireOwner, express.raw({ type: () => true, limit: '31mb' }), wrap(async (req, res) => {
  const st = streamerFrom(req, res);
  if (!st) return;
  if (req.query.rights !== '1') { res.status(400).json({ error: 'Tick that you have the right to use this file first. Music and pictures can be copyrighted on stream.' }); return; }
  const buf = req.body;
  const what = Buffer.isBuffer(buf) ? sniff(buf) : null;
  if (!what) { res.status(400).json({ error: 'Upload a PNG, JPEG, WebP or GIF picture, or an MP3.' }); return; }
  if (buf.length > LIMITS[what.kind]) { res.status(413).json({ error: what.kind === 'audio' ? 'MP3s can be up to 30 MB.' : 'Pictures can be up to 8 MB.' }); return; }
  // The same file uploaded again is reused instead of stored twice, so it doesn't eat into the 700 MB
  const hash = crypto.createHash('sha256').update(buf).digest('hex');
  const dupe = st.media.find((m) => m.hash === hash);
  if (dupe) { hub.dupes = (hub.dupes || 0) + 1; saveSoon(); res.json({ ok: true, media: dupe, duplicate: true }); return; }
  // Music: the playlist keeps to its space limit, removing the oldest unpinned song that isn't playing
  if (what.kind === 'audio') {
    const limit = (st.playlistMB || Math.floor(shareOf() / 1048576)) * 1048576;
    if (buf.length > limit) { res.status(413).json({ error: 'That song is bigger than the whole playlist limit. Raise the limit, or use a smaller file.' }); return; }
    const playing = st.modules.canvas.music.playing ? st.modules.canvas.music.id : '';
    const songs = () => st.media.filter((m) => m.kind === 'audio');
    while (songs().reduce((n, m) => n + m.size, 0) + buf.length > limit) {
      const oldest = songs().filter((m) => !m.pinned && m.id !== playing).sort((a, b) => a.at - b.at)[0];
      if (!oldest) { res.status(413).json({ error: 'The playlist is full of pinned songs. Unpin or remove one first.' }); return; }
      removeMedia(st, oldest);
      logActivity(st, 'Playlist', `Removed the oldest song to make room: ${oldest.name}`);
    }
  }
  if (mediaBytes(st) + buf.length > shareOf()) { res.status(413).json({ error: `That’s more than this streamer’s storage share (${Math.floor(shareOf() / 1048576)} MB). Remove something first.` }); return; }
  if (allMediaBytes() + buf.length > UPLOAD_CAP) { res.status(413).json({ error: 'Uploads are at the 700 MB limit that keeps the hub on the free plan. Remove something first.' }); return; }
  if (diskFull(buf.length)) { res.status(413).json({ error: DISK_FULL }); return; }
  await fs.promises.mkdir(MEDIA_DIR, { recursive: true });
  const f = { id: rid(16), name: cleanName(req.query.name, what.kind === 'audio' ? 'Song' : 'Picture'), kind: what.kind, size: buf.length, at: Date.now(), pinned: false, ext: what.ext, type: what.type, hash };
  await fs.promises.writeFile(path.join(MEDIA_DIR, `${f.id}.${f.ext}`), buf);
  st.media.push(f);
  logActivity(st, req.who.name, `Uploaded ${f.kind === 'audio' ? 'a song' : 'a picture'}: ${f.name}`);
  mediaChanged(st);
  res.json({ ok: true, media: f });
}));
app.patch('/api/media/:id', requireOwner, (req, res) => {
  const hit = findMedia(req.params.id);
  if (!hit) return res.status(404).json({ error: 'That file has gone.' });
  if (typeof (req.body || {}).pinned === 'boolean') hit.f.pinned = req.body.pinned;
  if ((req.body || {}).name) hit.f.name = cleanName(req.body.name, hit.f.name);
  if (typeof (req.body || {}).fav === 'boolean') hit.f.fav = req.body.fav;
  if (typeof (req.body || {}).cat === 'string') hit.f.cat = String(req.body.cat).trim().slice(0, 30);
  mediaChanged(hit.st);
  return res.json({ ok: true });
});
app.delete('/api/media/:id', requireOwner, (req, res) => {
  const hit = findMedia(req.params.id);
  if (!hit) return res.status(404).json({ error: 'That file has gone.' });
  removeMedia(hit.st, hit.f);
  logActivity(hit.st, req.who.name, `Removed ${hit.f.name}`);
  mediaChanged(hit.st);
  return res.json({ ok: true });
});
app.post('/api/streamers/:streamer/playlist', requireOwner, (req, res) => {
  const st = streamerFrom(req, res);
  if (!st) return;
  st.playlistMB = Math.max(5, Math.min(Math.floor(shareOf() / 1048576), Math.round(Number((req.body || {}).mb) || 0)));
  mediaChanged(st);
  res.json({ ok: true, playlistMB: st.playlistMB });
});
// Files for OBS and the hub. Every byte counts toward the monthly traffic budget.
app.get('/media/:id', (req, res) => {
  const hit = findMedia(String(req.params.id).replace(/\.\w+$/, ''));
  if (!hit) return res.status(404).end();
  if (hub.traffic.month !== monthNow()) hub.traffic = { month: monthNow(), bytes: 0 };
  if (hub.traffic.bytes >= TRAFFIC_CAP && hit.f.size > 1024 * 1024) return res.status(429).type('text').send('This month’s traffic budget is used up. Big files are back on the 1st.');
  res.set({ 'Content-Type': hit.f.type, 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' });
  hub.traffic.bytes += hit.f.size;
  saveSoon();
  return res.sendFile(path.join(MEDIA_DIR, `${hit.f.id}.${hit.f.ext}`), (err) => { if (err && !res.headersSent) res.status(404).end(); });
});
app.get('/api/usage', requireOwner, (req, res) => {
  if (hub.traffic.month !== monthNow()) hub.traffic = { month: monthNow(), bytes: 0 };
  res.json({
    uploads: { used: allMediaBytes(), cap: UPLOAD_CAP, share: shareOf() },
    disk: { used: diskUsed(true), cap: DISK_CAP },
    dupes: hub.dupes || 0,
    streamers: streamers.map((x) => ({ name: x.name, used: mediaBytes(x), files: x.media.length })),
    traffic: { month: hub.traffic.month, used: hub.traffic.bytes, cap: TRAFFIC_CAP },
    limits: { streamers: MAX_STREAMERS, connections: MAX_CONNECTIONS, open: wss.clients.size },
  });
});

/* ---------- Chat: read each streamer's Twitch chat; commands only from people on their list ---------- */
const chat = createChat({
  onMessage(channel, m) {
    streamers.filter((x) => x.chat.channel && x.chat.channel.toLowerCase() === channel).forEach((st) => {
      st.chatLog.push(m);
      if (st.chatLog.length > 80) st.chatLog.shift();
      wss.clients.forEach((ws) => { if (ws.role === 'control' && ws.streamerId === st.id && ws.who && hasTw(ws.who, 'chat')) send(ws, { type: 'chat', streamer: st.id, msg: m }); });
      routeChat(st, m);
    });
  },
  onStatus(state) { wss.clients.forEach((ws) => { if (ws.role === 'control' && ws.who && ws.who.role === 'owner') send(ws, { type: 'chatStatus', state }); }); },
});
function routeChat(st, m) {
  centre.onChat(st, m);
  if (st.chat.commands && m.text.startsWith('!') && st.chat.allow.includes(m.login)) chatCommand(st, m);
  const gm = st.modules.games;
  if (!gameEngine || !gm) return;
  const hadFlagWinner = !!gm.flags.winner;
  if (!Games.handleChat(gm, memFor(st), m, gameEngine)) return;
  gamesChanged(st);
  // The flag game moves on to the next flag by itself after a few seconds
  if (!hadFlagWinner && gm.flags.winner && gm.flags.auto) {
    const round = gm.flags.round;
    setTimeout(() => {
      const g = st.modules.games;
      if (!g || g.flags.round !== round || g.flags.open || g.flags.vis === 'off') return;
      g.flags.round += 1; g.flags.code = gameEngine.flagPick(g.flags.code); g.flags.name = gameEngine.countryName(g.flags.code); g.flags.winner = null; g.flags.open = true;
      changed(st, 'games');
    }, 6000);
  }
}
// Many messages at once: send the games' changes to pages at most four times a second
const gameTimers = new Map();
function gamesChanged(st) {
  if (gameTimers.has(st.id)) return;
  gameTimers.set(st.id, setTimeout(() => { gameTimers.delete(st.id); changed(st, 'games'); listChanged(); }, 250));
}
// Host buttons (reset votes, next flag, draw a winner, hint) take effect here
function gamesAfter(st, prev, s) {
  const mem = memFor(st);
  if (s.poll.reset !== prev.poll.reset) { mem.voters.clear(); s.poll.votes = [0, 0, 0, 0]; }
  if (s.flags.round !== prev.flags.round && gameEngine) { s.flags.code = gameEngine.flagPick(prev.flags.code); s.flags.name = gameEngine.countryName(s.flags.code); s.flags.winner = null; s.flags.open = true; }
  // Reveal: ends the Contexto round and shows the word
  if (s.contexto.reveal !== prev.contexto.reveal && gameEngine && s.contexto.open) { s.contexto.revealed = gameEngine.secretWord(mem); s.contexto.open = false; }
  if (s.flags.boardReset !== prev.flags.boardReset) s.flags.board = [];
  if (s.board.reset !== prev.board.reset) s.board.list = [];
  if (s.give.reset !== prev.give.reset) { mem.entrants.clear(); s.give.entries = 0; s.give.winner = ''; }
  if (s.give.draw !== prev.give.draw) {
    const all = Array.from(mem.entrants.values());
    s.give.winner = all.length ? all[Math.floor(Math.random() * all.length)] : '';
    s.give.open = false;
  }
  if (s.contexto.hint !== prev.contexto.hint && gameEngine && s.contexto.open) {
    const h = gameEngine.contextoHint(mem, s.contexto.guesses.length ? s.contexto.guesses[0].r : 3000);
    if (h) {
      mem.guessed.add(h.w);
      s.contexto.last = { w: h.w, r: h.r, u: 'Hint' };
      s.contexto.guesses = s.contexto.guesses.concat({ w: h.w, r: h.r, u: 'Hint' }).sort((a, b) => a.r - b.r).slice(0, 10);
    }
  }
}
// ---------- Twitch (free): each streamer connects their own account; tokens never leave the server ----------
const twitchFeed = new Map(); // streamer -> recent events (memory only)
const twitchHooks = [];       // later features (Subathon & Goals, alerts) listen here
const twitch = createTwitch({
  dataDir: DATA_DIR, clientId: process.env.TWITCH_CLIENT_ID || '', clientSecret: process.env.TWITCH_CLIENT_SECRET || '', secretKey: CONTROL_KEY,
  log: (m) => console.warn(m),
  onStatus: (sid) => { const st = byId(sid); if (st && st.modules.subathon && Sub.gap(st.modules.subathon, twitch.status(sid).events === 'connected' || !twitch.status(sid).connected, Date.now())) changed(st, 'subathon'); if (st) wss.clients.forEach((c) => { if (c.role === 'control' && c.streamerId === sid && c.who && c.who.role === 'owner') send(c, { type: 'twitchStatus', streamer: sid, status: twitch.status(sid) }); }); },
  onEvent: (sid, ev) => twitchEvent(sid, ev),
});
function twitchEvent(sid, ev) {
  const st = byId(sid);
  if (!st) return;
  const list = [ev].concat(twitchFeed.get(sid) || []).slice(0, 50);
  twitchFeed.set(sid, list);
  const words = { sub: 'subscribed', resub: `resubscribed${ev.months ? ` (${ev.months} months)` : ''}`, gift: `gifted ${ev.amount} sub${ev.amount === 1 ? '' : 's'}`, bits: `cheered ${ev.amount} bits`, raid: `raided with ${ev.amount} viewers` };
  if (words[ev.kind]) logActivity(st, 'Twitch', `${ev.user} ${words[ev.kind]}`);
  wss.clients.forEach((c) => { if (c.role === 'control' && c.streamerId === sid && c.who && canSee(c.who, st) && hasTw(c.who, 'feed')) send(c, { type: 'twitchEvent', streamer: sid, ev }); });
  twitchHooks.forEach((h) => { try { h(st, ev); } catch (e) { console.warn('Twitch event handler:', e.message); } });
}
twitchHooks.push((st, ev) => {
  const s = st.modules.subathon;
  if (!s || !ev.id) return;
  if (!st.subSeen) st.subSeen = [];
  if (st.subSeen.includes(ev.id)) return;
  st.subSeen.push(ev.id);
  if (st.subSeen.length > 1000) st.subSeen.splice(0, st.subSeen.length - 1000);
  const before = subMarks(s);
  if (Sub.apply(s, ev, 'auto', Date.now())) { changed(st, 'subathon'); saveSoon(); subEvents(st, before); }
});
// Goals reached and milestones unlocked become events automations can use (only when they cross, never repeatedly)
function subMarks(s) { return { goals: s.goals.map((g) => [g.id, g.cur >= g.target]), ms: s.milestones.map((m) => [m.id, m.s, m.times]) }; }
function subEvents(st, before) {
  const s = st.modules.subathon;
  s.goals.forEach((g) => { const b = before.goals.find((x) => x[0] === g.id); if (b && !b[1] && g.cur >= g.target) ops.onEvent(st, { kind: 'goal', name: g.name, id: `goal:${g.id}:${s.timer.start}:${g.target}` }); });
  s.milestones.forEach((m) => { const b = before.ms.find((x) => x[0] === m.id); if (b && m.s === 'unlocked' && (b[1] === 'locked' || b[2] !== m.times)) ops.onEvent(st, { kind: 'milestone', name: m.name, id: `ms:${m.id}:${s.timer.start}:${m.times}` }); });
}
// The subathon timer: reaching zero, grace periods and automatic ending happen here, once a second
setInterval(() => { const now = Date.now(); streamers.forEach((st) => { const s = st.modules.subathon; if (s && (s.timer.state === 'running' || s.timer.state === 'grace') && Sub.tick(s, now)) changed(st, 'subathon'); }); }, 1000);
app.post('/api/streamers/:streamer/subathon', requireEditor, (req, res) => {
  const st = streamerFrom(req, res);
  if (!st) return;
  if (!canTab(req.who, 'subathon')) return res.status(403).json({ error: 'You don’t have access to Subathon & Goals. Ask the owner.' });
  const a = String((req.body && req.body.action) || '');
  if (a === 'session-del' && req.who.role !== 'owner') return res.status(403).json({ error: 'Only the owner can delete past subathons.' });
  const marks = subMarks(st.modules.subathon);
  const err = Sub.act(st.modules.subathon, a, req.body || {}, Date.now(), req.who.name);
  if (!err) setImmediate(() => subEvents(st, marks));
  if (err) return res.status(400).json({ error: err });
  if (['start', 'end', 'reset', 'bonus-start', 'bonus-end', 'mode'].includes(a)) logActivity(st, req.who.name, `Subathon: ${a.replace('-', ' ')}`);
  changed(st, 'subathon');
  saveSoon();
  return res.json({ ok: true });
});
// Twitch Centre: dashboard, alerts, timed messages, commands and every official Twitch action
const centre = createCentre({ twitch, streamers, changed, saveSoon, logActivity, onSpin: (st, why) => { const s = st.modules.subathon; if (s) { s.spins.owed += 1; s.spins.hist.unshift({ t: `Owed from channel points: ${why}`.slice(0, 80), at: Date.now() }); changed(st, 'subathon'); } } });
twitchHooks.push((st, ev) => centre.onEvent(st, ev));
// Stream tools: quick actions, automations, test mode, running order, locks, presets, profiles and versions
const notices = new Map(); // private warnings for the owner, per streamer (deduplicated)
function notify(st, text) {
  const list = notices.get(st.id) || [];
  if (!list.some((n) => n.text === text && Date.now() - n.at < 600000)) { list.unshift({ id: rid(6), text, at: Date.now() }); notices.set(st.id, list.slice(0, 20)); }
  logActivity(st, 'Hub', text);
  wss.clients.forEach((c) => { if (c.role === 'control' && c.streamerId === st.id && c.who && c.who.role === 'owner') send(c, { type: 'notice', streamer: st.id, text }); });
}
const applySetupById = (st, id) => { const x = (st.setups || []).find((y) => y.id === id); if (!x) return 'That saved setup has gone.'; applySetup(st, x.snap); return ''; };
const ops = createOps({ Extras, Sub, MODULES, streamers, changed, saveSoon, logActivity, hideAll, applySetupById, canTab, DATA_DIR, notify,
  testAlert: (st) => centre.act(st, 'alert-test', { kind: 'follow' }, 'Test mode').then(() => changed(st, 'twitch')).catch(() => {}),
  opsChanged: (st) => opsChanged(st) });
twitchHooks.push((st, ev) => ops.onEvent(st, ev)); // Twitch events can trigger automations (each event once)
function opsView(st) {
  const o = ops.ops(st);
  const b = ops.bag(st);
  return { buttons: o.buttons, rules: o.rules, locks: o.locks.filter((l) => !l.until || l.until > Date.now()), runs: o.runs.slice(0, 40), actions: ops.ACTION_LIST,
    targets: ops.targets(st).map((t) => ({ key: t.key, name: t.name })), setups: (st.setups || []).map((x) => ({ id: x.id, name: x.name })),
    sounds: st.modules.media ? st.modules.media.sounds.map((x) => ({ id: x.id, name: x.name })) : [], counters: st.modules.challenges ? st.modules.challenges.widgets.filter((w) => w.kind === 'counter').map((w) => ({ id: w.id, name: w.title || 'Counter' })) : [],
    configs: b.configs.map((c) => ({ id: c.id, name: c.name, desc: c.desc, kind: c.kind, fav: c.fav, at: c.at, by: c.by, mods: Object.keys(c.data), rules: c.ops ? c.ops.rules.length : 0 })),
    versions: b.versions.slice(0, 60).map((v) => ({ id: v.id, at: v.at, by: v.by, mod: v.mod, name: v.name })), tests: ops.tests.get(st.id) || [], notices: notices.get(st.id) || [] };
}
function opsChanged(st) { wss.clients.forEach((c) => { if (c.role === 'control' && c.streamerId === st.id && c.who && c.who.role === 'owner') send(c, { type: 'ops', streamer: st.id, ops: opsView(st) }); }); }
// "Someone else is changing this tab too": owners see the name, editors only that it's someone else
const coeditSaid = new Map();
function coedit(st, ws, mod) {
  const me = ws.who.person ? ws.who.person.id : 'owner';
  wss.clients.forEach((c) => {
    if (c === ws || c.role !== 'control' || c.streamerId !== st.id || !c.who || (c.who.person ? c.who.person.id : 'owner') === me) return;
    if (c.view !== mod || Date.now() - (c.viewAt || 0) > 3600000) return;
    const k = `${me}:${c.who.person ? c.who.person.id : 'owner'}:${mod}`;
    if (Date.now() - (coeditSaid.get(k) || 0) < 120000) return;
    coeditSaid.set(k, Date.now());
    send(c, { type: 'coedit', streamer: st.id, module: mod, who: c.who.role === 'owner' ? ws.who.name : 'Someone else' });
  });
}
app.post('/api/streamers/:streamer/ops/:action', requireOwner, wrap(async (req, res) => {
  const st = streamerFrom(req, res);
  if (!st) return;
  const b = req.body || {};
  const o = ops.ops(st);
  const who = req.who;
  const done = (extra) => { saveSoon(); opsChanged(st); res.json(Object.assign({ ok: true }, extra || {})); };
  const fail = (msg, code = 400) => res.status(code).json({ error: msg });
  switch (req.params.action) {
    case 'button-save': { const btn = normOps({ buttons: [b.button] }).buttons[0]; if (!btn) return fail('That button isn’t valid.'); const i = o.buttons.findIndex((x) => x.id === btn.id); if (i >= 0) o.buttons[i] = btn; else { if (o.buttons.length >= 30) return fail('You can have 30 buttons.'); o.buttons.push(btn); } logActivity(st, who.name, `Saved the quick action “${btn.name}”`); return done({ button: btn }); }
    case 'button-del': o.buttons = o.buttons.filter((x) => x.id !== b.id); return done();
    case 'button-move': { const i = o.buttons.findIndex((x) => x.id === b.id); const j = i + (b.dir === 'up' ? -1 : 1); if (i >= 0 && j >= 0 && j < o.buttons.length) [o.buttons[i], o.buttons[j]] = [o.buttons[j], o.buttons[i]]; return done(); }
    case 'button-run': return done(ops.runButton(st, String(b.id), who, String(b.nonce || ''), b.confirmed === true));
    case 'rule-save': { const r = normOps({ rules: [b.rule] }).rules[0]; if (!r) return fail('That automation isn’t valid.'); const i = o.rules.findIndex((x) => x.id === r.id); if (i >= 0) { r.on = o.rules[i].on && b.keepOn === true; r.ver = o.rules[i].ver + 1; r.runs = o.rules[i].runs; r.day = o.rules[i].day; r.last = o.rules[i].last; o.rules[i] = r; } else { if (o.rules.length >= 40) return fail('You can have 40 automations.'); r.on = false; o.rules.push(r); } logActivity(st, who.name, `Saved the automation “${r.name}” (version ${r.ver})`); return done({ rule: r }); }
    case 'rule-del': o.rules = o.rules.filter((x) => x.id !== b.id); return done();
    case 'rule-on': { const r = o.rules.find((x) => x.id === b.id); if (!r) return fail('That automation has gone.'); r.on = b.on === true; r.errors = 0; logActivity(st, who.name, `${r.on ? 'Switched on' : 'Switched off'} the automation “${r.name}”`); return done(); }
    case 'rules-stop': o.rules.forEach((r) => { r.on = false; }); logActivity(st, who.name, 'Stopped every automation'); return done();
    case 'rule-test': { const r = o.rules.find((x) => x.id === b.id); if (!r) return fail('That automation has gone.'); return done({ result: ops.runRule(st, r, { kind: r.trigger.type, id: `dry-${Date.now()}`, amount: r.trigger.min || 1, tier: r.trigger.tier || '1000', reward: r.trigger.reward, name: r.trigger.name, user: 'Test viewer' }, 1, true) }); }
    case 'test': return done({ report: ops.simulate(st, b.ev || {}, who) });
    case 'lock': { if (o.locks.length >= 20) return fail('You can have 20 locks.'); const mod = TABS.includes(b.mod) || b.mod === 'all' ? b.mod : ''; if (!mod) return fail('Choose what to lock.'); o.locks.push({ id: rid(6), mod, kind: b.kind === 'layout' ? 'layout' : 'all', reason: String(b.reason || '').slice(0, 80), by: who.name, at: Date.now(), until: Number(b.mins) > 0 ? Date.now() + Number(b.mins) * 60000 : 0, auto: b.auto === true }); logActivity(st, who.name, `Locked ${mod === 'all' ? 'every tab' : mod}${b.kind === 'layout' ? ' (layout only)' : ''}`); return done(); }
    case 'unlock': o.locks = o.locks.filter((l) => l.id !== b.id); logActivity(st, who.name, 'Removed a lock'); return done();
    case 'checkpoint': { const v = ops.addVersion(st, '*', who.name, String(b.name || 'Checkpoint').slice(0, 50)); return v ? done() : fail('Nothing to save.'); }
    case 'version-check': { const r = ops.restoreVersion(st, String(b.id), who.name, false); return r.error ? fail(r.error) : done(r); }
    case 'version-restore': { const r = ops.restoreVersion(st, String(b.id), who.name, true); return r.error ? fail(r.error) : done(r); }
    case 'config-save': { const r = ops.saveConfig(st, b, who.name); return r.error ? fail(r.error) : done(); }
    case 'config-check': { const r = ops.applyConfig(st, String(b.id), b.mode, who.name, false); return r.error ? fail(r.error) : done(r); }
    case 'config-apply': { const r = ops.applyConfig(st, String(b.id), b.mode, who.name, true); return r.error ? fail(r.error) : done(r); }
    case 'config-del': { const bg = ops.bag(st); bg.configs = bg.configs.filter((c) => c.id !== b.id); ops.saveStore(); return done(); }
    case 'config-fav': { const c = ops.bag(st).configs.find((x) => x.id === b.id); if (c) { c.fav = !c.fav; ops.saveStore(); } return done(); }
    case 'config-export': { const c = ops.exportConfig(st, String(b.id)); return c ? res.json({ ok: true, file: c }) : fail('That preset or profile has gone.'); }
    case 'config-import': { const r = ops.importConfig(st, b.file, who.name); return r.error ? fail(r.error) : done({ missing: r.missing }); }
    case 'notice-ack': notices.set(st.id, (notices.get(st.id) || []).filter((n) => n.id !== b.id)); return done();
    default: return fail('Unknown action.');
  }
}));
// The running order: owner, and editors who have the Stream Desk tab, can run it
app.post('/api/streamers/:streamer/rundown', requireEditor, (req, res) => {
  const st = streamerFrom(req, res);
  if (!st) return;
  if (!canTab(req.who, 'desk')) return res.status(403).json({ error: 'You don’t have access to Stream Desk.' });
  const lk = req.who.role !== 'owner' ? ops.lockOf(st, 'desk') : null;
  if (lk) return res.status(403).json({ error: `The owner has locked Stream Desk${lk.reason ? ` (${lk.reason})` : ''}.` });
  const b = req.body || {};
  if (req.who.role !== 'owner' && ['del-list', 'look'].includes(b.a)) return res.status(403).json({ error: 'Only the owner can do that.' });
  const err = ops.roAct(st, String(b.a || ''), b, req.who.name, 0);
  if (err) return res.status(400).json({ error: err });
  changed(st, 'desk');
  saveSoon();
  return res.json({ ok: true });
});
// Activity as a file (owner)
app.get('/api/streamers/:streamer/activity.csv', requireOwner, (req, res) => {
  const st = streamerFrom(req, res);
  if (!st) return;
  const q = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  res.type('text/csv').set('Content-Disposition', `attachment; filename="activity-${st.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.csv"`).send(['Time,Who,What'].concat(st.activity.slice().reverse().map((a) => [new Date(a.at || a.t || 0).toISOString(), q(a.who), q(a.text || a.what)].join(','))).join('\n'));
});
// Add to home screen: served by the server, so they don't count as files
app.get('/manifest.webmanifest', (req, res) => res.type('application/manifest+json').send(JSON.stringify({ name: 'Overlay Hub', short_name: 'Overlay Hub', start_url: '/control', display: 'standalone', background_color: '#1d1612', theme_color: '#1d1612', icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }] })));
app.get('/icon.svg', (req, res) => res.type('image/svg+xml').send('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="#1d1612"/><rect x="96" y="150" width="320" height="212" rx="36" fill="#f2a65a"/><rect x="132" y="186" width="248" height="140" rx="20" fill="#2b1a0c"/><circle cx="256" cy="256" r="34" fill="#f2a65a"/></svg>'));
// System status (owner): plain-English health, measured values marked as measured, nothing secret
let loopLag = { last: 0, max: 0 };
let loopAt = Date.now();
setInterval(() => { const lag = Math.max(0, Date.now() - loopAt - 2000); loopLag = { last: lag, max: Math.max(lag, loopLag.max * 0.95) }; loopAt = Date.now(); }, 2000);
function memLimit() {
  for (const f of ['/sys/fs/cgroup/memory.max', '/sys/fs/cgroup/memory/memory.limit_in_bytes']) { try { const v = Number(fs.readFileSync(f, 'utf8').trim()); if (v > 0 && v < 1e13) return v; } catch (e) { /* not available here */ } }
  return 0;
}
function systemReport() {
  const mem = process.memoryUsage();
  const limit = memLimit();
  const plan = (Number(process.env.MEM_LIMIT_MB) || 256) * 1048576;
  if (hub.traffic.month !== monthNow()) hub.traffic = { month: monthNow(), bytes: 0 };
  const disk = diskUsed(true);
  const warn = [];
  const memPct = mem.rss / (limit || plan);
  if (memPct > 0.8) warn.push({ level: 'bad', text: `Memory is at ${Math.round(memPct * 100)}% of the limit. Close extra OBS links or restart when nobody's live.` });
  if (disk / DISK_CAP > 0.85) warn.push({ level: 'bad', text: 'Storage is nearly full. Delete unused uploads in Media Centre, Storage.' });
  if (hub.traffic.bytes / TRAFFIC_CAP > 0.7) warn.push({ level: hub.traffic.bytes / TRAFFIC_CAP > 0.9 ? 'bad' : 'warn', text: `This month's traffic is at ${Math.round((hub.traffic.bytes / TRAFFIC_CAP) * 100)}% of the 8 GB allowance.` });
  if (saveStats.fails) warn.push({ level: 'bad', text: `Saving failed ${saveStats.fails} time${saveStats.fails === 1 ? '' : 's'} since the last restart (${saveStats.err}).` });
  if (loopLag.max > 500) warn.push({ level: 'warn', text: 'The server has been slow to respond at times (busy). Overlays may lag a little.' });
  const per = streamers.map((st) => {
    const obs = Array.from(wss.clients).filter((c) => c.role !== 'control' && c.streamerId === st.id);
    const tw = twitch.status(st.id);
    const sb = st.modules.subathon;
    if (tw.connected && tw.events !== 'connected' && sb && ['running', 'paused'].includes(sb.timer.state)) warn.push({ level: 'bad', text: `${st.name}: Twitch events aren't arriving during the subathon. Contributions may need adding by hand.` });
    (notices.get(st.id) || []).forEach((n) => warn.push({ level: 'warn', text: `${st.name}: ${n.text}`, id: n.id, streamer: st.id }));
    const feed = twitchFeed.get(st.id) || [];
    return { name: st.name, obs: { open: obs.length, lastBeat: Math.max(0, ...obs.map((c) => c.lastPong || 0)), lastApplied: st.lastApplied || 0, connects: st.obsConnects || 0 },
      twitch: { configured: tw.configured, connected: tw.connected, revoked: tw.revoked, events: tw.events, missingScopes: tw.missingScopes.length, missingEvents: tw.missingEvents.length, lastEvent: feed[0] ? feed[0].at : 0 },
      tools: { buttons: st.ops ? st.ops.buttons.length : 0, rules: st.ops ? st.ops.rules.filter((r) => r.on).length : 0, locks: st.ops ? st.ops.locks.length : 0 } };
  });
  const tabs = Array.from(wss.clients).filter((c) => c.role === 'control');
  return {
    version: APP_VERSION, node: process.version, started: STARTED_AT, uptime: Math.round((Date.now() - STARTED_AT) / 1000),
    memory: { rss: mem.rss, heap: mem.heapUsed, limit, limitMeasured: !!limit, plan },
    loop: { lagMs: Math.round(loopLag.last), worstMs: Math.round(loopLag.max) },
    data: { lastSave: saveStats.at, fails: saveStats.fails, stateBytes: (() => { try { return fs.statSync(DATA_FILE).size; } catch (e) { return 0; } })(), toolsBytes: ops.size(), startedEmpty: freshStart },
    storage: { disk, diskCap: DISK_CAP, uploads: allMediaBytes(), uploadCap: UPLOAD_CAP, traffic: hub.traffic.bytes, trafficCap: TRAFFIC_CAP },
    presence: { hubTabs: tabs.length, browsers: new Set(tabs.map((c) => c.install || c.token)).size, overlays: Array.from(wss.clients).length - tabs.length },
    chat: chat.status, streamers: per, warnings: warn,
  };
}
app.get('/api/system', requireOwner, (req, res) => res.json(systemReport()));
app.post('/api/system/:action', requireOwner, (req, res) => {
  const a = req.params.action;
  if (a === 'retry-twitch') { streamers.forEach((st) => { if (twitch.userOf(st.id)) twitch.listen(st.id); }); return res.json({ ok: true, note: 'Reconnecting Twitch for every connected streamer.' }); }
  if (a === 'resync') { let n = 0; streamers.forEach((st) => { Object.keys(st.modules).forEach((id) => { wss.clients.forEach((c) => { if (c.role !== 'control' && c.streamerId === st.id) { send(c, { type: 'state', module: id, state: TRIMMED.includes(id) ? viewFor('overlay', id, st.modules[id]) : st.modules[id], now: Date.now() }); n += 1; } }); }); }); return res.json({ ok: true, note: `Sent fresh state to the OBS pages (${n} updates).` }); }
  if (a === 'verify') {
    try { const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); return res.json({ ok: true, note: `The saved file on the server opens and reads correctly: ${raw.streamers.length} streamer${raw.streamers.length === 1 ? '' : 's'}, saved ${saveStats.at ? new Date(saveStats.at).toISOString().slice(11, 16) : 'not yet this run'}. (This checks the file; a full restore test needs a spare copy of the hub.)` }); }
    catch (e) { return res.json({ ok: false, note: `The saved file couldn't be read: ${String(e.message).slice(0, 80)}` }); }
  }
  if (a === 'export') { const r = systemReport(); r.streamers = r.streamers.map((x, i) => Object.assign({}, x, { name: `Streamer ${i + 1}` })); r.warnings = r.warnings.map((w) => ({ level: w.level, text: w.text.replace(/^[^:]+: /, '') })); return res.type('application/json').set('Content-Disposition', 'attachment; filename="overlay-hub-status.json"').send(JSON.stringify(Object.assign({ exported: new Date().toISOString() }, r), null, 2)); }
  return res.status(400).json({ error: 'Unknown action.' });
});
// Owner-only always: anything that uses the broadcaster's own powers. Editors given the tab can only view, look up, clip and mark.
const TW_ACTION = { refresh: 'dash', 'cat-search': 'category', category: 'category', title: 'title', clip: 'clips', 'clip-edit': 'clips', 'clip-del': 'clips', marker: 'markers', 'marker-edit': 'markers', 'marker-del': 'markers',
  'chat-send': 'say', 'mod-delete': 'delete', 'mod-unban': 'unban', 'chat-settings': 'chatset', 'chat-settings-set': 'chatset', rewards: 'points', 'reward-create': 'points', 'reward-toggle': 'points', redemptions: 'points', 'redeem-set': 'points',
  'poll-create': 'polls', 'poll-end': 'polls', 'pred-create': 'preds', 'pred-lock': 'preds', 'pred-resolve': 'preds', 'pred-cancel': 'preds', 'shout-search': 'shout', shoutout: 'shout', 'alert-test': 'alerts', 'alert-skip': 'alerts', 'timer-send': 'timers' };
const twActionPerm = (a, b) => (a === 'mod-ban' ? (Number(b.secs) ? 'timeout' : 'ban') : TW_ACTION[a]);
const TW_MOD = ['mod-delete', 'mod-ban', 'mod-unban', 'chat-settings-set'];
const ED_SCOPES = ['moderator:manage:banned_users', 'moderator:manage:chat_messages', 'moderator:manage:chat_settings', 'user:read:moderated_channels'];
const modChecks = new Map();
// Being an editor here doesn't make someone a Twitch moderator: they link their own account and Twitch must confirm it
async function modActor(who, st) {
  const key = `ed:${who.person.id}`;
  const me = twitch.userOf(key);
  const bc = twitch.userOf(st.id);
  if (!me) return { err: 'Link your own Twitch account first (Settings, Personal). Moderation uses your account, not the streamer’s.' };
  if (!bc) return { err: 'This streamer’s Twitch isn’t connected.' };
  const ck = `${key}:${st.id}`;
  const c = modChecks.get(ck);
  let ok = c && Date.now() - c.at < 300000 ? c.ok : null;
  if (ok === null) {
    ok = me.userId === bc.userId;
    if (!ok) { try { const r = await twitch.helix(key, 'GET', `/moderation/channels?user_id=${me.userId}&first=100`); ok = (r.data || []).some((x) => x.broadcaster_id === bc.userId); } catch (e) { ok = false; } }
    if (ok) modChecks.set(ck, { ok, at: Date.now() }); // a 'no' is checked again next time, so a new mod can retry straight away
  }
  return ok ? { key, uid: me.userId } : { err: `Twitch says ${me.login} isn’t a moderator of this channel.` };
}
app.post('/api/streamers/:streamer/twitch/:action', requireEditor, wrap(async (req, res) => {
  const st = streamerFrom(req, res);
  if (!st) return;
  const a = String(req.params.action);
  if (!canTab(req.who, 'twitch')) return res.status(403).json({ error: 'Twitch Centre is the owner’s. Ask the owner for access.' });
  let actor = null;
  if (req.who.role !== 'owner') {
    const p = twActionPerm(a, req.body || {});
    if (!p || !twPerms(req.who).includes(p)) return res.status(403).json({ error: 'You don’t have permission for that. Ask the owner.' });
    if (TW_MOD.includes(a)) { actor = await modActor(req.who, st); if (actor.err) return res.status(403).json({ error: actor.err }); }
  }
  try {
    const out = await centre.act(st, a, req.body || {}, req.who.name, actor);
    changed(st, 'twitch');
    saveSoon();
    res.json(Object.assign({ ok: true }, out));
  } catch (e) { changed(st, 'twitch'); res.status(e.status === 401 || e.status === 403 ? 403 : 400).json({ error: e.message || 'Twitch said no.' }); }
}));
app.get('/api/twitch/me', requireEditor, (req, res) => {
  const me = req.who.role === 'editor' ? twitch.userOf(`ed:${req.who.person.id}`) : null;
  res.json({ configured: twitch.configured(), perms: twPerms(req.who), linked: !!me, login: me ? me.login : '' });
});
app.post('/api/twitch/link-me', requireEditor, (req, res) => {
  if (req.who.role !== 'editor') return res.status(400).json({ error: 'The owner uses Settings, Twitch instead.' });
  if (!twitch.configured()) return res.status(400).json({ error: 'The owner hasn’t set up Twitch yet.' });
  res.json({ url: twitch.connectUrl(`ed:${req.who.person.id}`, twitchRedirect(req), ED_SCOPES) });
});
app.post('/api/twitch/unlink-me', requireEditor, wrap(async (req, res) => {
  if (req.who.role === 'editor') await twitch.disconnect(`ed:${req.who.person.id}`);
  res.json({ ok: true });
}));
app.get('/api/me', requireEditor, (req, res) => {
  if (req.who.role !== 'editor') return res.json({ owner: true });
  const p = req.who.person;
  const names = new Set([p.username, req.who.name]);
  const mine = visibleStreamers(req.who).flatMap((st) => st.activity.filter((a) => names.has(a.who)).map((a) => Object.assign({ streamer: st.name }, a))).sort((x, y) => (y.at || y.t || 0) - (x.at || x.t || 0)).slice(0, 60);
  const tabsOpen = Array.from(wss.clients).filter((ws) => ws.who && ws.who.person && ws.who.person.id === p.id);
  res.json({ name: p.username, createdAt: p.createdAt, expiresAt: p.expiresAt || 0, tabs: tabsOf(req.who), streamers: visibleStreamers(req.who).map((x) => x.name), twitch: twPerms(req.who),
    devices: p.devices.filter((d) => d.tokenHash).map((d) => ({ name: d.name, lastSeen: d.lastSeen || d.createdAt, me: d.tokenHash === sha(String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')) })),
    browsers: new Set(tabsOpen.map((ws) => ws.install || ws.token)).size, tabsOpen: tabsOpen.length,
    signins: hub.signins.filter((x) => x.username === p.username).slice(-20).reverse(), activity: mine });
});
app.post('/api/me/devices/:i/signout', requireEditor, (req, res) => {
  if (req.who.role !== 'editor') return res.status(400).json({ error: 'The owner manages devices in People.' });
  const p = req.who.person;
  const d = p.devices.filter((x) => x.tokenHash)[Number(req.params.i)];
  if (!d) return res.status(404).json({ error: 'That device isn’t signed in any more.' });
  d.tokenHash = '';
  remember({ username: p.username, device: d.name, ok: true, what: 'Signed out from My account' });
  sessionsChanged();
  saveSoon();
  return res.json({ ok: true });
});
// The address Twitch sends people back to; register exactly this in the Twitch developer console
const twitchRedirect = (req) => process.env.PUBLIC_URL ? `${process.env.PUBLIC_URL.replace(/\/$/, '')}/api/twitch/callback`
  : `${String(req.headers['x-forwarded-proto'] || req.protocol).split(',')[0].trim()}://${req.headers['x-forwarded-host'] || req.get('host')}/api/twitch/callback`;
app.get('/api/twitch/status', requireOwner, (req, res) => {
  const st = streamerFrom(req, res);
  if (!st) return;
  res.json(Object.assign(twitch.status(st.id), { redirect: twitchRedirect(req), feed: (twitchFeed.get(st.id) || []).slice(0, 15) }));
});
app.post('/api/twitch/connect', requireOwner, (req, res) => {
  const st = streamerFrom(req, res);
  if (!st) return;
  if (!twitch.configured()) return res.status(400).json({ error: 'Add TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET in Northflank first (see the steps).' });
  res.json({ url: twitch.connectUrl(st.id, twitchRedirect(req)) });
});
app.get('/api/twitch/callback', wrap(async (req, res) => {
  const page = (title, text) => res.type('html').send(`<!DOCTYPE html><html lang="en-GB"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><body style="font-family:system-ui,sans-serif;background:#0c090b;color:#fff;display:grid;place-items:center;min-height:100vh;margin:0"><div style="max-width:460px;padding:24px;text-align:center"><h1 style="font-size:24px">${title}</h1><p>${text}</p><p><a style="color:#2ee59d" href="/control">Back to the hub</a></p></div><script>setTimeout(()=>{location.href='/control'},4000)</script>`);
  if (req.query.error) return page('Twitch wasn’t connected', 'The sign-in was cancelled on Twitch. Nothing changed.');
  try {
    const r = await twitch.finish(req.query.state, req.query.code);
    const st = byId(r.streamer);
    if (st) logActivity(st, 'Owner', `Connected Twitch as ${r.login}`);
    return page('Twitch connected', `Connected as <b>${String(r.login).replace(/[<&>]/g, '')}</b>. Taking you back to the hub…`);
  } catch (e) { return page('Twitch wasn’t connected', String(e.message).replace(/[<&>]/g, '')); }
}));
app.post('/api/twitch/disconnect', requireOwner, wrap(async (req, res) => {
  const st = streamerFrom(req, res);
  if (!st) return;
  await twitch.disconnect(st.id);
  logActivity(st, req.who.name, 'Disconnected Twitch');
  res.json({ ok: true });
}));
if (process.env.CHAT_TEST === '1') {
  app.post('/api/test/twitch-event', requireOwner, (req, res) => { const st = streamerFrom(req, res); if (!st) return; twitchEvent(st.id, Object.assign({ at: Date.now(), id: rid(8) }, req.body.ev || {})); res.json({ ok: true }); });
}
// Starting a Contexto round: the secret word stays on the server; only the hub that started it is told the word
app.get('/flags/:file', (req, res) => {
  const m = /^([a-z]{2}(?:-[a-z]{3})?)\.svg$/.exec(req.params.file);
  const svg = m && flagSvgs[m[1]];
  if (!svg) return res.status(404).end();
  res.set({ 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=604800' });
  return res.send(svg);
});
app.post('/api/streamers/:streamer/games/contexto', requireEditor, (req, res) => {
  const st = streamerFrom(req, res);
  if (!st) return;
  if (!canTab(req.who, 'games')) return res.status(403).json({ error: 'You don’t have access to Chat Games. Ask the owner.' });
  if (!gameEngine) return res.status(503).json({ error: 'The word list isn’t installed on the server.' });
  const r = gameEngine.contextoStart(memFor(st), String((req.body && req.body.word) || '').trim());
  if (!r.ok) return res.status(400).json({ error: r.error });
  const g = st.modules.games;
  Object.assign(g.contexto, { open: true, round: g.contexto.round + 1, count: 0, guesses: [], last: null, winner: null, revealed: '' });
  logActivity(st, req.who.name, 'Started a Contexto round');
  changed(st, 'games');
  res.json({ ok: true, word: r.word });
});
// Practice: type as a pretend viewer to test the games before going live. Goes to the games only, never to Twitch.
app.post('/api/streamers/:streamer/games/practice', requireEditor, (req, res) => {
  const st = streamerFrom(req, res);
  if (!st) return;
  if (!canTab(req.who, 'games')) return res.status(403).json({ error: 'You don’t have access to Chat Games. Ask the owner.' });
  if (!gameEngine) return res.status(503).json({ error: 'The word list isn’t installed on the server.' });
  const u = String((req.body && req.body.u) || 'Practice').replace(/[^\w .-]/g, '').slice(0, 25) || 'Practice';
  const text = String((req.body && req.body.text) || '').slice(0, 200);
  if (!text.trim()) return res.status(400).json({ error: 'Type a message first.' });
  if (Games.handleChat(st.modules.games, memFor(st), { u, login: `practice:${u.toLowerCase()}`, text, at: Date.now() }, gameEngine)) gamesChanged(st);
  return res.json({ ok: true });
});
// For testing only (switched off unless CHAT_TEST=1): feed a chat message in as if it came from Twitch
if (process.env.CHAT_TEST === '1') {
  app.post('/api/test/chat', requireOwner, (req, res) => {
    const st = streamerFrom(req, res);
    if (!st) return;
    const u = String(req.body.u || 'viewer');
    routeChat(st, { u, login: u.toLowerCase(), text: String(req.body.text || ''), at: Date.now() });
    res.json({ ok: true });
  });
}
function chatCommand(st, m) {
  const cmd = m.text.trim().toLowerCase().split(/\s+/)[0];
  const sb = st.modules.scoreboard;
  const who = `${m.u} (chat)`;
  if (cmd === '!hide') { hideAll(st, who); return; }
  if (cmd === '!show') { sb.onAir = true; logActivity(st, who, 'Put the scoreboard on screen'); changed(st, 'scoreboard'); listChanged(); return; }
  if (cmd === '!goalhome' || cmd === '!goalaway') {
    if (sb.mode === 'live') return; // Live mode follows ESPN; chat can't add goals there
    const t = cmd === '!goalhome' ? 0 : 1;
    sb.score[t] += 1;
    sb.goals.push({ team: t, scorer: '', minute: '', src: 'manual', key: '', at: Date.now(), typed: false, number: '' });
    Match.pushAnim(sb, { kind: 'goal', team: t });
    logActivity(st, who, `Goal for ${Match.nameOf(t === 0 ? sb.home : sb.away)}`);
    changed(st, 'scoreboard');
  }
}
const updateChat = () => chat.setChannels(streamers.map((x) => x.chat.channel));
app.patch('/api/streamers/:streamer/chat', requireOwner, (req, res) => {
  const st = streamerFrom(req, res);
  if (!st) return;
  const b = req.body || {};
  if (b.channel !== undefined) { st.chat.channel = String(b.channel).toLowerCase().replace(/^.*twitch\.tv\//, '').replace(/[^a-z0-9_]/g, '').slice(0, 25); st.chatLog = []; }
  if (typeof b.commands === 'boolean') st.chat.commands = b.commands;
  if (Array.isArray(b.allow)) st.chat.allow = b.allow.map((x) => String(x).toLowerCase().replace(/[^a-z0-9_]/g, '')).filter(Boolean).slice(0, 20);
  updateChat();
  saveSoon();
  wss.clients.forEach((ws) => { if (ws.role === 'control' && ws.streamerId === st.id) hello(ws); });
  res.json({ ok: true, chat: st.chat });
});

/* Football (ESPN) */
app.get('/api/football/competitions', (req, res) => res.json({ competitions: Match.COMPETITIONS.map(({ key, name, logo, accent }) => ({ key, name, logo, accent })) }));
app.get('/api/football/matches', requireEditor, wrap(async (req, res) => {
  const tz = Match.validZone(req.query.tz) ? String(req.query.tz) : DEFAULT_TZ;
  res.json({ matches: await streamers[0].espn.listMatches(String(req.query.comp || ''), String(req.query.date || ''), tz) });
}));
app.post('/api/football/follow', requireEditor, wrap(async (req, res) => {
  const st = streamerFrom(req, res);
  if (!st) return;
  await st.espn.follow(String((req.body && req.body.eventId) || ''), String((req.body && req.body.comp) || ''));
  logActivity(st, req.who.name, `Following ${st.modules.scoreboard.feed.title}`);
  res.json({ ok: true });
}));
app.post('/api/football/unfollow', requireEditor, (req, res) => { const st = streamerFrom(req, res); if (st) { st.espn.unfollow(); logActivity(st, req.who.name, 'Stopped following the match'); res.json({ ok: true }); } });
app.post('/api/football/refresh', requireEditor, (req, res) => { const st = streamerFrom(req, res); if (st) { st.espn.poll(true); res.json({ ok: true }); } });
app.post('/api/football/settings', requireEditor, (req, res) => {
  const st = streamerFrom(req, res);
  if (!st) return;
  const s2 = st.modules.scoreboard;
  const body = req.body || {};
  if (req.who.role === 'owner' && [3, 5, 10, 30].includes(Number(body.pollSeconds))) s2.feed.pollSeconds = Number(body.pollSeconds);
  if (typeof body.kitColours === 'boolean') s2.feed.kitColours = body.kitColours;
  if (req.who.role === 'owner' && typeof body.crests === 'boolean') s2.feed.crests = body.crests;
  st.espn.schedule();
  changed(st, 'scoreboard');
  res.json({ ok: true });
});

/* Crests: anyone can see them; only the owner uploads (it uses storage) */
function sendCrest(res, c) {
  if (!c) return res.status(404).json({ error: 'No crest' });
  res.set({ 'Content-Type': c.type, 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'" });
  return res.send(Buffer.from(c.base64, 'base64'));
}
app.get('/api/crest/:streamer/:side(home|away)', (req, res) => {
  const st = byId(req.params.streamer);
  return sendCrest(res, st && st.crests[req.params.side]);
});
app.get('/api/crest/:side(home|away)', (req, res) => { // overlays from before streamer tabs
  const st = legacyStreamer();
  return sendCrest(res, st && st.crests[req.params.side]);
});
app.post('/api/crest/:streamer/:side(home|away)', requireOwner, (req, res) => {
  const st = streamerFrom(req, res);
  if (!st) return undefined;
  const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+=*)$/.exec(String((req.body && req.body.dataUrl) || ''));
  if (!m) return res.status(400).json({ error: 'Send a PNG, JPEG or WebP image.' });
  if (m[2].length > 1.4e6) return res.status(413).json({ error: 'That crest is too big. Use an image under 1 MB.' });
  if (diskFull(m[2].length)) return res.status(413).json({ error: DISK_FULL });
  const side = req.params.side;
  st.crests[side] = { type: m[1], base64: m[2] };
  const s2 = st.modules.scoreboard;
  s2[side].crestV = Date.now(); // a new number every upload, so browsers never show an old crest
  s2.feed.crests = false;       // a crest chosen by hand stays, even when following a match
  changed(st, 'scoreboard');
  return res.json({ ok: true });
});
app.delete('/api/crest/:streamer/:side(home|away)', requireOwner, (req, res) => {
  const st = streamerFrom(req, res);
  if (!st) return;
  st.crests[req.params.side] = null;
  st.modules.scoreboard[req.params.side].crestV = 0;
  changed(st, 'scoreboard');
  res.json({ ok: true });
});

app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'That was too big to accept.' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'That wasn’t valid JSON.' });
  const status = err.status || (/ESPN/.test(err.message || '') ? 502 : 500);
  if (status === 500) console.error(err);
  return res.status(status).json({ error: status === 500 ? 'Something went wrong on the server.' : err.message });
});

function shutdown() {
  clearTimeout(saveTimer);
  saveNow();
  wss.clients.forEach((ws) => ws.close(1001, 'Server restarting'));
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

setInterval(() => {
  const before = hub.requests.length;
  hub.requests = hub.requests.filter((r) => Date.now() - r.at < REQUEST_TTL_MS);
  const expired = Array.from(wss.clients).some((ws) => ws.role === 'control' && ws.who && ws.who.role === 'editor' && whoIs(ws.token).role !== 'editor');
  if (expired || before !== hub.requests.length) sessionsChanged();
}, 15000).unref();

load();
try { // built-in links: fill in links.json and they're added the first time the Links tab is empty
  const seed = JSON.parse(fs.readFileSync(path.join(__dirname, 'links.json'), 'utf8'));
  if (!hub.links.length && Array.isArray(seed)) hub.links = seed.filter((l) => l && cleanUrl(l.url)).slice(0, 50).map((l) => ({ id: rid(8), name: cleanName(l.name, new URL(cleanUrl(l.url)).hostname), url: cleanUrl(l.url) }));
} catch (e) { /* no built-in links */ }
streamers.forEach((x) => x.espn.start());
setTimeout(updateChat, 1500);
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Overlay hub running on port ${PORT} (build ${BUILD}, ${streamers.length} streamer(s))`);
  console.log(`  Control app: http://localhost:${PORT}/control`);
  Object.values(os.networkInterfaces()).flat().filter((a) => a && a.family === 'IPv4' && !a.internal)
    .forEach((a) => console.log(`  On your network: http://${a.address}:${PORT}/control`));
  if (!CONTROL_KEY) console.warn('CONTROL_KEY is not set, so anyone with the control link can change the overlays.');
});
