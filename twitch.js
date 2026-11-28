/*
  The shared Twitch connection (free): each streamer connects their own Twitch account with Twitch's sign-in (OAuth).
  - Tokens stay on the server only, encrypted with a key made from CONTROL_KEY, in their own file on the volume
    (twitch-tokens.json): never in backups, logs, OBS pages or editor browsers.
  - Tokens are refreshed before they expire; revoked access shows as "Reconnect needed".
  - Live events (subs, gifts, resubs, bits, follows, raids, channel points, going live/offline) arrive over Twitch's
    EventSub WebSocket, so nothing is polled.
  Setup: register a free app at dev.twitch.tv/console, then set TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET.
*/
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const WebSocket = require('ws');

// Everything the Twitch Centre and Subathon features need, asked for once so nobody has to reconnect later
const SCOPES = ['channel:read:subscriptions', 'bits:read', 'moderator:read:followers', 'channel:read:redemptions', 'channel:manage:redemptions',
  'channel:manage:broadcast', 'clips:edit', 'channel:manage:polls', 'channel:manage:predictions', 'moderator:manage:banned_users',
  'moderator:manage:chat_messages', 'moderator:manage:chat_settings', 'moderator:manage:shoutouts', 'moderator:manage:announcements', 'user:write:chat', 'user:read:chat'];
// EventSub subscriptions: [type, version, scope it needs, condition builder]
const SUBS = [
  ['channel.subscribe', '1', 'channel:read:subscriptions', (u) => ({ broadcaster_user_id: u })],
  ['channel.subscription.gift', '1', 'channel:read:subscriptions', (u) => ({ broadcaster_user_id: u })],
  ['channel.subscription.message', '1', 'channel:read:subscriptions', (u) => ({ broadcaster_user_id: u })],
  ['channel.cheer', '1', 'bits:read', (u) => ({ broadcaster_user_id: u })],
  ['channel.follow', '2', 'moderator:read:followers', (u) => ({ broadcaster_user_id: u, moderator_user_id: u })],
  ['channel.raid', '1', '', (u) => ({ to_broadcaster_user_id: u })],
  ['channel.channel_points_custom_reward_redemption.add', '1', 'channel:read:redemptions', (u) => ({ broadcaster_user_id: u })],
  ['stream.online', '1', '', (u) => ({ broadcaster_user_id: u })],
  ['stream.offline', '1', '', (u) => ({ broadcaster_user_id: u })],
];
// One simple shape for every event, used by Subathon & Goals, alerts and the activity feed
function normalise(type, e) {
  const user = e.user_name || e.from_broadcaster_user_name || e.user_login || 'Anonymous';
  switch (type) {
    case 'channel.subscribe': return e.is_gift ? null : { kind: 'sub', user, tier: e.tier || '1000', amount: 1 };
    case 'channel.subscription.message': return { kind: 'resub', user, tier: e.tier || '1000', amount: 1, months: e.cumulative_months || 0, message: (e.message && e.message.text) || '' };
    case 'channel.subscription.gift': return { kind: 'gift', user: e.is_anonymous ? 'Anonymous' : user, tier: e.tier || '1000', amount: e.total || 1 };
    case 'channel.cheer': return { kind: 'bits', user: e.is_anonymous ? 'Anonymous' : user, amount: e.bits || 0, message: e.message || '' };
    case 'channel.follow': return { kind: 'follow', user, amount: 1 };
    case 'channel.raid': return { kind: 'raid', user, amount: e.viewers || 0 };
    case 'channel.channel_points_custom_reward_redemption.add': return { kind: 'redeem', user, amount: (e.reward && e.reward.cost) || 0, reward: (e.reward && e.reward.title) || '', message: e.user_input || '' };
    case 'stream.online': return { kind: 'online', user: e.broadcaster_user_name || '', amount: 0 };
    case 'stream.offline': return { kind: 'offline', user: e.broadcaster_user_name || '', amount: 0 };
    default: return null;
  }
}

function createTwitch({ dataDir, clientId, clientSecret, secretKey, onEvent, onStatus, log }) {
  const AUTH = process.env.TWITCH_AUTH_BASE || 'https://id.twitch.tv';
  const API = process.env.TWITCH_API_BASE || 'https://api.twitch.tv/helix';
  const WS_URL = process.env.TWITCH_EVENTSUB_URL || 'wss://eventsub.wss.twitch.tv/ws';
  const FILE = path.join(dataDir, 'twitch-tokens.json');
  const key = crypto.createHash('sha256').update(`overlay-hub-twitch:${secretKey || 'no-key'}`).digest();
  const enc = (obj) => { const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', key, iv); const data = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]); return [iv, c.getAuthTag(), data].map((b) => b.toString('base64')).join('.'); };
  const dec = (s) => { const [iv, tag, data] = String(s).split('.').map((b) => Buffer.from(b, 'base64')); const d = crypto.createDecipheriv('aes-256-gcm', key, iv); d.setAuthTag(tag); return JSON.parse(Buffer.concat([d.update(data), d.final()]).toString('utf8')); };
  let store = {};
  try { const raw = JSON.parse(fs.readFileSync(FILE, 'utf8')); Object.entries(raw).forEach(([sid, v]) => { try { store[sid] = dec(v); } catch (e) { log('A saved Twitch connection could not be read (the owner password may have changed). Reconnect needed.'); } }); } catch (e) { store = {}; }
  const save = () => { try { fs.mkdirSync(dataDir, { recursive: true }); const out = {}; Object.entries(store).forEach(([sid, v]) => { out[sid] = enc(v); }); fs.writeFileSync(`${FILE}.tmp`, JSON.stringify(out), { mode: 0o600 }); fs.renameSync(`${FILE}.tmp`, FILE); } catch (e) { log(`Couldn't save the Twitch connection: ${e.message}`); } };
  const pending = new Map(); // sign-in state -> { streamer, redirect, at }
  const sockets = new Map(); // streamer -> { ws, state, session, keepalive, timer, tries }
  const configured = () => !!(clientId && clientSecret);

  async function form(url, params) {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params) });
    const body = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, body };
  }
  function connectUrl(streamerId, redirect, scopes) {
    const state = crypto.randomBytes(18).toString('hex');
    pending.set(state, { streamer: streamerId, redirect, at: Date.now() });
    for (const [s, v] of pending) if (Date.now() - v.at > 600000) pending.delete(s);
    const q = new URLSearchParams({ client_id: clientId, redirect_uri: redirect, response_type: 'code', scope: (scopes || SCOPES).join(' '), state, force_verify: 'true' });
    return `${AUTH}/oauth2/authorize?${q}`;
  }
  // Twitch sends the user back here with a one-time code; the state proves it's the sign-in we started
  async function finish(state, code) {
    const p = pending.get(String(state || ''));
    pending.delete(String(state || ''));
    if (!p || Date.now() - p.at > 600000) throw new Error('That Twitch sign-in expired or wasn’t started here. Try Connect again.');
    const t = await form(`${AUTH}/oauth2/token`, { client_id: clientId, client_secret: clientSecret, code: String(code || ''), grant_type: 'authorization_code', redirect_uri: p.redirect });
    if (!t.ok) throw new Error('Twitch didn’t accept the sign-in. Check the Client ID, secret and redirect URL.');
    const v = await fetch(`${AUTH}/oauth2/validate`, { headers: { Authorization: `OAuth ${t.body.access_token}` } }).then((r) => r.json());
    if (!v.user_id) throw new Error('Twitch couldn’t confirm which account signed in.');
    store[p.streamer] = { userId: v.user_id, login: v.login, scopes: v.scopes || [], access: t.body.access_token, refresh: t.body.refresh_token, expiresAt: Date.now() + (t.body.expires_in || 3600) * 1000, at: Date.now(), revoked: false };
    save();
    listen(p.streamer);
    onStatus(p.streamer);
    return { streamer: p.streamer, login: v.login };
  }
  async function refresh(sid) {
    const s = store[sid];
    if (!s) return false;
    const t = await form(`${AUTH}/oauth2/token`, { client_id: clientId, client_secret: clientSecret, grant_type: 'refresh_token', refresh_token: s.refresh });
    if (!t.ok) { s.revoked = true; save(); onStatus(sid); stop(sid); return false; }
    Object.assign(s, { access: t.body.access_token, refresh: t.body.refresh_token || s.refresh, expiresAt: Date.now() + (t.body.expires_in || 3600) * 1000, revoked: false });
    save();
    return true;
  }
  // Twitch API calls for a streamer, refreshing the token first when it's about to run out
  async function helix(sid, method, p, body) {
    const s = store[sid];
    if (!s || s.revoked) throw new Error('Twitch isn’t connected for this streamer.');
    if (Date.now() > s.expiresAt - 120000) await refresh(sid);
    const go = () => fetch(`${API}${p}`, { method, headers: { Authorization: `Bearer ${store[sid].access}`, 'Client-Id': clientId, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    let res = await go();
    if (res.status === 401 && await refresh(sid)) res = await go();
    const data = res.status === 204 ? {} : await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(data.message || `Twitch said no (${res.status}).`); e.status = res.status; throw e; }
    return data;
  }
  // The live event connection (EventSub WebSocket), one per connected streamer, with automatic reconnects
  function listen(sid, url) {
    const s = store[sid];
    if (!s || s.revoked || !configured() || String(sid).startsWith('ed:')) return; // an editor's own link is only for moderation, not events
    const old = sockets.get(sid);
    if (old && old.ws && !url) { try { old.ws.terminate(); } catch (e) { /* gone */ } }
    const sock = { ws: null, state: 'connecting', session: '', keepalive: 30, timer: 0, tries: (old && old.tries) || 0 };
    sockets.set(sid, sock);
    onStatus(sid);
    const ws = new WebSocket(url || WS_URL);
    sock.ws = ws;
    const alive = () => { clearTimeout(sock.timer); sock.timer = setTimeout(() => { try { ws.terminate(); } catch (e) { /* gone */ } }, (sock.keepalive + 10) * 1000); };
    ws.on('message', async (raw) => {
      let m;
      try { m = JSON.parse(String(raw)); } catch (e) { return; }
      const type = m.metadata && m.metadata.message_type;
      alive();
      if (type === 'session_welcome') {
        sock.session = m.payload.session.id;
        sock.keepalive = m.payload.session.keepalive_timeout_seconds || 30;
        sock.tries = 0;
        if (!url) {
          const missing = [];
          for (const [t, v, scope, cond] of SUBS) {
            if (scope && !(store[sid].scopes || []).includes(scope)) { missing.push(t); continue; }
            try { await helix(sid, 'POST', '/eventsub/subscriptions', { type: t, version: v, condition: cond(store[sid].userId), transport: { method: 'websocket', session_id: sock.session } }); } catch (e) { missing.push(t); log(`Twitch event ${t}: ${e.message}`); }
          }
          sock.missing = missing;
        }
        sock.state = 'connected';
        onStatus(sid);
      } else if (type === 'session_reconnect') {
        listen(sid, m.payload.session.reconnect_url);
      } else if (type === 'notification') {
        const ev = normalise(m.payload.subscription.type, m.payload.event || {});
        if (ev) onEvent(sid, Object.assign(ev, { at: Date.now(), id: (m.metadata && m.metadata.message_id) || crypto.randomBytes(6).toString('hex') }));
      } else if (type === 'revocation') {
        log(`Twitch stopped sending ${m.payload.subscription.type} (${m.payload.subscription.status}).`);
      }
    });
    ws.on('close', () => {
      clearTimeout(sock.timer);
      if (sockets.get(sid) !== sock) return; // replaced by a reconnect
      sock.state = 'reconnecting';
      onStatus(sid);
      if (!store[sid] || store[sid].revoked) return;
      sock.tries += 1;
      setTimeout(() => { if (sockets.get(sid) === sock) listen(sid); }, Math.min(60000, 2000 * 2 ** Math.min(sock.tries, 5)));
    });
    ws.on('error', () => { /* close follows */ });
  }
  function stop(sid) {
    const sock = sockets.get(sid);
    sockets.delete(sid);
    if (sock) { clearTimeout(sock.timer); try { sock.ws.terminate(); } catch (e) { /* gone */ } }
  }
  async function disconnect(sid) {
    const s = store[sid];
    stop(sid);
    delete store[sid];
    save();
    if (s && configured()) await form(`${AUTH}/oauth2/revoke`, { client_id: clientId, token: s.access }).catch(() => {});
    onStatus(sid);
  }
  function status(sid) {
    const s = store[sid];
    const sock = sockets.get(sid);
    return { configured: configured(), connected: !!s && !s.revoked, revoked: !!(s && s.revoked), login: s ? s.login : '', scopes: s ? s.scopes : [],
      missingScopes: s && !String(sid).startsWith('ed:') ? SCOPES.filter((x) => !(s.scopes || []).includes(x)) : [], events: sock ? sock.state : 'off', missingEvents: (sock && sock.missing) || [] };
  }
  // Start listening for every saved connection when the server starts
  setTimeout(() => Object.keys(store).forEach((sid) => listen(sid)), 1500);
  return { configured, connectUrl, finish, disconnect, status, helix, listen, stop, userOf: (sid) => (store[sid] && !store[sid].revoked ? store[sid] : null), forget: (sid) => { stop(sid); delete store[sid]; save(); } };
}

module.exports = { createTwitch, SCOPES, normalise };
