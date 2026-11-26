'use strict';
/*
  Overlay hub server (Node.js, Express and ws).
  - /control is the hub: every overlay is set up, previewed and put on screen from there.
  - /overlay is the one page OBS shows. Every overlay lives on it.
  - Every change goes straight to every open page over a WebSocket (/ws).
  - The live scoreboard follows one football match at a time from ESPN's free public data (espn.js).
  - Changes need the CONTROL_KEY when one is set.
*/
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { WebSocketServer } = require('ws');
const Match = require('./public/match.js');
const createEspn = require('./espn.js');

const PORT = Number(process.env.PORT) || 8080;
const CONTROL_KEY = String(process.env.CONTROL_KEY || '').trim();
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'state.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

/* ---------- Overlays the hub knows about. Each keeps its own state; add new ones here. ---------- */
const modules = {
  scoreboard: {
    state: Match.defaults(),
    normalize: Match.normalize,
    // What the control app may change. ESPN details, crest versions and the competition link are the server's.
    patchable: ['mode', 'onAir', 'scale', 'clockOffset', 'comp', 'compLogo', 'kickoff', 'kickoffAt', 'home', 'away', 'period', 'note', 'clock',
      'added', 'score', 'pens', 'stats', 'statsShown', 'goals', 'reds', 'anims', 'show', 'bug', 'card', 'writer', 'rev'],
    keep(prev, next) {
      next.home.crestV = prev.home.crestV;
      next.away.crestV = prev.away.crestV;
      next.compKey = prev.compKey;
      next.feed = prev.feed;
    },
    after(prev, next, msg) {
      if (Array.isArray(msg.ignore)) espn.ignore(msg.ignore);
      if (next.mode === 'live' && prev.mode === 'live' && next.period !== prev.period) espn.holdPeriod(next.period);
      if (next.mode !== prev.mode) espn.onModeChange();
      else if (next.clockOffset !== prev.clockOffset) espn.resync();
    },
  },
};
const crests = { home: null, away: null }; // the scoreboard's crests: { type, base64 }
const snapshot = () => Object.fromEntries(Object.entries(modules).map(([id, m]) => [id, m.state]));

/* ---------- Saving to disk, so a restart keeps everything ---------- */
function load() {
  try {
    const saved = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    const board = (saved.modules && saved.modules.scoreboard) || saved.state; // older saves kept just the scoreboard
    modules.scoreboard.state = Match.normalize(board);
    ['home', 'away'].forEach((side) => {
      const c = saved.crests && saved.crests[side];
      crests[side] = c && /^image\/(png|jpeg|webp)$/.test(c.type) && typeof c.base64 === 'string' ? c : null;
      if (!crests[side]) modules.scoreboard.state[side].crestV = 0;
    });
    const s = modules.scoreboard.state;
    // A clock left running for hours by hand (an old session) comes back paused instead of showing 400 minutes.
    if (s.clock.running && s.mode !== 'live' && Date.now() - s.clock.at > 6 * 3600 * 1000) s.clock.running = false;
    console.log(`Loaded the saved overlays from ${DATA_FILE}`);
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn(`Could not read the saved overlays, starting fresh: ${err.message}`);
  }
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
    fs.writeFileSync(tmp, JSON.stringify({ modules: snapshot(), crests }));
    fs.renameSync(tmp, DATA_FILE);
  } catch (err) {
    console.warn(`Could not save the overlays: ${err.message}`);
  }
}

/* ---------- Live updates over WebSocket ---------- */
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 512 * 1024 });
const send = (ws, msg) => { if (ws.readyState === 1) ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg)); };
// What's worth saving: everything except timestamps that change on every ESPN check.
const savedShape = () => JSON.stringify(snapshot(), (k, v) => (k === 'ts' || k === 'updatedAt' || k === 'nextAt' ? undefined : v));
let lastSaved = '';
function changed(id) {
  const m = modules[id];
  m.state.ts = Date.now();
  const msg = JSON.stringify({ type: 'state', module: id, state: m.state, now: Date.now() });
  wss.clients.forEach((ws) => send(ws, msg));
  const shape = savedShape();
  if (shape !== lastSaved) {
    lastSaved = shape;
    saveSoon();
  }
}
const keyMatches = (given) => {
  if (!CONTROL_KEY) return true;
  const a = Buffer.from(String(given || ''));
  const b = Buffer.from(CONTROL_KEY);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
wss.on('connection', (ws) => {
  ws.alive = true;
  ws.authed = !CONTROL_KEY;
  ws.on('pong', () => { ws.alive = true; });
  ws.on('error', () => {});
  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(String(data)); } catch (e) { return; }
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'auth') {
      ws.authed = keyMatches(msg.key);
      send(ws, { type: 'auth', ok: ws.authed, locked: !!CONTROL_KEY });
      return;
    }
    if (msg.type === 'patch') {
      const m = modules[msg.module];
      if (!m) { send(ws, { type: 'ack', id: msg.id, ok: false, error: 'There’s no overlay with that name.' }); return; }
      if (!ws.authed) { send(ws, { type: 'ack', id: msg.id, ok: false, error: 'auth' }); return; }
      const prev = m.state;
      const draft = Match.copy(prev);
      Match.applyPatch(draft, msg.patch, m.patchable);
      const next = m.normalize(draft);
      m.keep(prev, next);
      m.state = next;
      m.after(prev, next, msg);
      changed(msg.module);
      send(ws, { type: 'ack', id: msg.id, ok: true });
    }
  });
  send(ws, { type: 'hello', now: Date.now(), locked: !!CONTROL_KEY, modules: snapshot() });
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

/* ---------- ESPN live data for the scoreboard ---------- */
const espn = createEspn({
  get: () => modules.scoreboard.state,
  changed: () => changed('scoreboard'),
  setCrest(side, crest) {
    crests[side] = crest;
    modules.scoreboard.state[side].crestV = Date.now();
  },
});

/* ---------- HTTP routes ---------- */
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
const requireKey = (req, res, next) => (keyMatches(req.get('x-control-key')) ? next() : res.status(401).json({ error: 'Wrong or missing control key.' }));
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

app.get('/healthz', (req, res) => res.type('text').send('ok'));
app.get('/', (req, res) => res.redirect(302, '/control'));
app.get('/control', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'control.html')));
app.get('/overlay', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'overlay.html')));
app.use(express.static(PUBLIC_DIR, { index: false, setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache') }));

app.get('/api/session', (req, res) => res.json({ locked: !!CONTROL_KEY, ok: keyMatches(req.get('x-control-key')) }));
app.get('/api/state', (req, res) => res.json({ modules: snapshot(), now: Date.now() }));

app.get('/api/football/competitions', (req, res) => res.json({ competitions: Match.COMPETITIONS.map(({ key, name, logo }) => ({ key, name, logo })) }));
app.get('/api/football/matches', requireKey, wrap(async (req, res) => {
  res.json({ matches: await espn.listMatches(String(req.query.comp || ''), String(req.query.date || '')) });
}));
app.post('/api/football/follow', requireKey, wrap(async (req, res) => {
  await espn.follow(String((req.body && req.body.eventId) || ''), String((req.body && req.body.comp) || ''));
  res.json({ ok: true });
}));
app.post('/api/football/unfollow', requireKey, (req, res) => { espn.unfollow(); res.json({ ok: true }); });
app.post('/api/football/refresh', requireKey, (req, res) => { espn.poll(); res.json({ ok: true }); });
app.post('/api/football/settings', requireKey, (req, res) => {
  const s = modules.scoreboard.state;
  const body = req.body || {};
  if ([3, 5, 10, 30].includes(Number(body.pollSeconds))) s.feed.pollSeconds = Number(body.pollSeconds);
  if (typeof body.kitColours === 'boolean') s.feed.kitColours = body.kitColours;
  if (typeof body.crests === 'boolean') s.feed.crests = body.crests;
  espn.schedule();
  changed('scoreboard');
  res.json({ ok: true });
});

app.get('/api/crest/:side(home|away)', (req, res) => {
  const c = crests[req.params.side];
  if (!c) return res.status(404).json({ error: 'No crest' });
  res.set({ 'Content-Type': c.type, 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'" });
  return res.send(Buffer.from(c.base64, 'base64'));
});
app.post('/api/crest/:side(home|away)', requireKey, (req, res) => {
  const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+=*)$/.exec(String((req.body && req.body.dataUrl) || ''));
  if (!m) return res.status(400).json({ error: 'Send a PNG, JPEG or WebP image.' });
  const side = req.params.side;
  crests[side] = { type: m[1], base64: m[2] };
  const s = modules.scoreboard.state;
  s[side].crestV = Date.now(); // a new number every upload, so browsers never show an old crest
  s.feed.crests = false;       // a crest chosen by hand stays, even when following a match
  changed('scoreboard');
  return res.json({ ok: true });
});
app.delete('/api/crest/:side(home|away)', requireKey, (req, res) => {
  const side = req.params.side;
  crests[side] = null;
  modules.scoreboard.state[side].crestV = 0;
  changed('scoreboard');
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

load();
espn.start();
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Overlay hub running on port ${PORT}`);
  console.log(`  Control app: http://localhost:${PORT}/control`);
  console.log(`  Overlay:     http://localhost:${PORT}/overlay`);
  if (!CONTROL_KEY) console.warn('CONTROL_KEY is not set, so anyone with the control link can change the overlays.');
});
