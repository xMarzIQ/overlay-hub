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
    patchable: ['onAir', 'items', 'strokes', 'spot', 'music', 'boards', 'writer', 'rev'],
    keep() {},
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
      'shoot', 'board', 'follow', 'auto', 'scenes'],
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
const cleanName = (v, fallback) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, 32) || fallback;
// One look for all of a streamer's overlays: the font, the corners, and how overlays come on and go off.
const cleanLook = (l) => ({
  font: ['barlow', 'oswald', 'saira'].includes(l && l.font) ? l.font : 'barlow',
  corners: (l && l.corners) === 'sharp' ? 'sharp' : 'rounded',
  anim: ['slide', 'fade', 'wipe'].includes(l && l.anim) ? l.anim : 'slide',
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
      saved.streamers.slice(0, MAX_STREAMERS).forEach((x) => streamers.push(makeStreamer(x)));
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
  } catch (err) {
    console.warn(`Could not save the overlays: ${err.message}`);
  }
}
const streamerData = (x) => ({ id: x.id, name: x.name, code: x.code, legacy: x.legacy, modules: x.modules, crests: x.crests, look: x.look, stack: x.stack, activity: x.activity, media: x.media, playlistMB: x.playlistMB, chat: x.chat });
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

/* ---------- Activity: what happened on each streamer, newest last ---------- */
function logActivity(st, who, text) {
  if (!text) return;
  const entry = { t: Date.now(), who: who || 'Owner', text: String(text).slice(0, 160) };
  st.activity.push(entry);
  if (st.activity.length > MAX_ACTIVITY) st.activity.splice(0, st.activity.length - MAX_ACTIVITY);
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
    || !!(m.canvas && m.canvas.onAir && (m.canvas.items.some((i) => i.shown) || m.canvas.strokes.length || m.canvas.spot.on || m.canvas.music.playing))
    || !!(m.desk && m.desk.onAir && m.desk.widgets.some((w) => w.shown));
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
  if (!seeIt) return;
  send(ws, {
    type: 'hello', now: Date.now(), build: BUILD, locked: !!CONTROL_KEY,
    streamer: Object.assign({ id: st.id, name: st.name, look: st.look, stack: st.stack }, ws.role === 'control' ? { code: st.code, legacy: st.legacy, hideCode: owner ? st.code : undefined } : {}),
    modules: st.modules,
  });
  if (ws.role === 'control') {
    send(ws, { type: 'streamers', list: streamerList(ws.who) });
    send(ws, { type: 'hub', tiles: hub.tiles, links: owner ? hub.links : undefined, people: owner ? peopleSummary() : undefined });
    if (owner) send(ws, { type: 'activityAll', streamer: st.id, list: st.activity.slice(-200) });
    send(ws, { type: 'media', streamer: st.id, list: st.media, playlistMB: st.playlistMB || Math.floor(shareOf() / 1048576) });
    if (owner) send(ws, { type: 'chatAll', streamer: st.id, chat: st.chat, list: st.chatLog, state: chat.status });
  }
}
const peopleSummary = () => ({ requests: hub.requests.length });
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
  wss.clients.forEach((ws) => { if (ws.streamerId === st.id) send(ws, msg); });
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
      send(ws, { type: 'session', role: ws.who.role, reason: ws.who.reason || '' });
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
  ws.on('pong', () => { ws.alive = true; });
  ws.on('error', () => {});
  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(String(data)); } catch (e) { return; }
    if (!msg || typeof msg !== 'object' || ws.role !== 'control') return;
    if (msg.type === 'auth') {
      // A session token from signing in; the CONTROL_KEY itself still works for the owner.
      ws.token = msg.token ? String(msg.token) : '';
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
      touch(ws.who);
      const prev = st.modules[msg.module];
      const draft = Match.copy(prev);
      const allowed = ws.who.role === 'owner' ? def.patchable : def.patchable.filter((k) => !EDITOR_BLOCKED.includes(k));
      Match.applyPatch(draft, msg.patch, allowed);
      const next = def.normalize(draft);
      def.keep(prev, next);
      st.modules[msg.module] = next;
      def.after(st, prev, next, msg);
      if (msg.module === 'scoreboard') describe(prev, next).forEach((line) => logActivity(st, ws.who.name, line));
      changed(st, msg.module);
      send(ws, { type: 'ack', id: msg.id, ok: true });
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
  id: p.id, username: p.username, streamers: p.streamers, expiresAt: p.expiresAt || 0, createdAt: p.createdAt, lastSeen: p.lastSeen || 0,
  online: Array.from(wss.clients).some((ws) => ws.who && ws.who.person && ws.who.person.id === p.id),
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
  p.expiresAt = expiryFrom(b.expires || '24h');
  p.devices = p.devices.filter((d) => d.device !== r.device).concat({ tokenHash: r.tokenHash, device: r.device, name: r.name, createdAt: Date.now(), lastSeen: Date.now() }).slice(-6);
  remember({ username: p.username, device: r.name, ok: true, what: 'Approved by the owner' });
  sessionsChanged();
  return res.json({ ok: true, person: personView(p) });
});
app.patch('/api/people/:id', requireOwner, (req, res) => {
  const p = hub.people.find((x) => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'That person isn’t on the list any more.' });
  const b = req.body || {};
  if (b.expires) p.expiresAt = expiryFrom(b.expires);
  if (Array.isArray(b.streamers)) p.streamers = b.streamers.filter((id) => byId(id));
  sessionsChanged();
  return res.json({ ok: true, person: personView(p) });
});
app.delete('/api/people/:id', requireOwner, (req, res) => {
  const p = hub.people.find((x) => x.id === req.params.id);
  hub.people = hub.people.filter((x) => x.id !== req.params.id);
  if (p) remember({ username: p.username, device: '', ok: false, what: 'Removed by the owner' });
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
  streamers.push(st);
  logActivity(st, req.who.name, `Added ${st.name}`);
  listChanged();
  return res.json({ streamer: { id: st.id, name: st.name, code: st.code } });
});
app.patch('/api/streamers/:streamer', requireOwner, (req, res) => {
  const st = streamerFrom(req, res);
  if (!st) return undefined;
  const b = req.body || {};
  if (b.name !== undefined) st.name = cleanName(b.name, st.name);
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
  Object.keys(st.modules).forEach((m) => { if (st.modules[m].onAir) { st.modules[m].onAir = false; changed(st, m); } });
  logActivity(st, who, 'Hid everything');
  listChanged();
}
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
  wss.clients.forEach((ws) => { if (ws.role === 'control' && ws.streamerId === st.id && ws.who && canSee(ws.who, st)) send(ws, { type: 'media', streamer: st.id, list: st.media, playlistMB: st.playlistMB || Math.floor(shareOf() / 1048576) }); });
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
  await fs.promises.mkdir(MEDIA_DIR, { recursive: true });
  const f = { id: rid(16), name: cleanName(req.query.name, what.kind === 'audio' ? 'Song' : 'Picture'), kind: what.kind, size: buf.length, at: Date.now(), pinned: false, ext: what.ext, type: what.type };
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
      wss.clients.forEach((ws) => { if (ws.role === 'control' && ws.streamerId === st.id && ws.who && ws.who.role === 'owner') send(ws, { type: 'chat', streamer: st.id, msg: m }); });
      if (st.chat.commands && m.text.startsWith('!') && st.chat.allow.includes(m.login)) chatCommand(st, m);
    });
  },
  onStatus(state) { wss.clients.forEach((ws) => { if (ws.role === 'control' && ws.who && ws.who.role === 'owner') send(ws, { type: 'chatStatus', state }); }); },
});
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
