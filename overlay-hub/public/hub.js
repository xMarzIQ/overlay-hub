/*
  The overlay hub. Everything shared by every overlay lives here:
  - the control key and the live WebSocket link to the server,
  - keeping each overlay's state in sync (changes go up as small patches; the newest change wins),
  - the 1920×1080 preview monitor (Live output, Preview, background, safe area),
  - the hub page of tiles, the back arrow and each overlay's page,
  - toasts, undo and keyboard shortcuts,
  - streamers: the switcher in the top-left, each streamer's own overlay link, and Manage streamers.
  Each overlay adds its own controls with Hub.module() (see scoreboard-control.js).
*/
(() => {
  'use strict';
  const M = window.Match;
  const $ = (id) => document.getElementById(id);
  const setText = (node, text) => { if (node && node.textContent !== text) node.textContent = text; };
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* this visit only */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
  };
  const TOKEN_STORE = 'hub-token';
  // This device's own id, so a device the owner approved once doesn't need approving again.
  const deviceId = store.get('hub-device', '') || (() => { const v = `d${Math.random().toString(36).slice(2, 12)}`; store.set('hub-device', v); return v; })();
  // Personal settings only change this device: theme, big buttons, vibrate on goals, tips.
  const personal = {
    get theme() { return store.get('hub-theme', 'crimson'); },
    get big() { return store.get('hub-big', '0') === '1'; },
    get vibrate() { return store.get('hub-vibrate', '1') === '1'; },
    set(k, v) { store.set(`hub-${k}`, typeof v === 'boolean' ? (v ? '1' : '0') : String(v)); applyPersonal(); },
  };
  function applyPersonal() {
    document.documentElement.dataset.theme = personal.theme;
    document.documentElement.dataset.big = personal.big ? '1' : '0';
  }
  applyPersonal();
  const clientId = Math.random().toString(36).slice(2, 10);

  // The hub page. Overlays that aren't built yet show as "coming soon" tiles.
  const TILES = [
    { id: 'scoreboard', name: 'Live scoreboard', desc: 'Score, clock, stats and goals, live or by hand', icon: '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><rect x="2.5" y="6" width="19" height="12" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 6v12M6.5 10.5v3M17.5 10.5v3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>' },
    { id: 'canvas', name: 'Canvas', desc: 'Draw, pictures, web pages, YouTube, QR codes, music and a tactics board', icon: '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M4 20l3.5-.8L19 7.7a2 2 0 0 0 0-2.8l-.9-.9a2 2 0 0 0-2.8 0L3.8 15.5 3 19z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M14 5.5l4.5 4.5" stroke="currentColor" stroke-width="2"/></svg>' },
    { id: 'desk', name: 'Stream Desk', desc: 'Timer, countdown, counter, text, lists and a clock', icon: '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><circle cx="12" cy="13" r="7.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 9v4l2.5 2M9.5 3h5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' },
    { id: 'games', name: 'Chat Games', desc: 'Polls, Contexto, the flag game, giveaways and a scavenger hunt', icon: '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M7 8h10a4 4 0 0 1 4 4v1.5a3.5 3.5 0 0 1-6.2 2.2L14 14.5h-4l-.8 1.2A3.5 3.5 0 0 1 3 13.5V12a4 4 0 0 1 4-4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M8 11v3M6.5 12.5h3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="16" cy="11.5" r="1.1" fill="currentColor"/><circle cx="17.8" cy="13.4" r="1.1" fill="currentColor"/></svg>' },
  ];
  const CONN_TEXT = { connecting: 'Connecting…', live: 'Connected', reconnecting: 'Reconnecting…', error: 'Last change wasn’t saved' };

  let view = 'home'; // 'home' or the overlay whose page is open
  // The streamer whose overlays this page shows and changes. The server confirms it in every hello.
  let current = { id: store.get('hub-streamer', ''), name: '', code: '', legacy: false };
  let streamerList = [];
  let hubSettings = { tiles: { mode: 'auto', order: [], names: {} }, links: [] };
  let activity = [];
  let requestsWaiting = 0;

  const el = {};
  ['viewport', 'monitorTag', 'monitorText', 'modeSeg', 'bgSeg', 'safeToggle', 'sampleTools', 'overlayUrl', 'copyBtn', 'conn', 'connText',
    'openNotice', 'signin', 'signinForms', 'signinWait', 'signinEnded', 'signinEndedText', 'signinError', 'editorForm', 'ownerForm', 'suName', 'suPass', 'ownPass',
    'restoreBanner', 'restoreText', 'miniScore', 'miniText', 'miniSmall', 'cogBadge', 'linksList', 'linkAdd', 'linkName', 'linkUrl', 'linkError', 'activityList', 'qbAir',
    'backBtn', 'pageTitle', 'pageSub', 'tiles', 'hub', 'toasts', 'keysDialog',
    'switcherBtn', 'switcherMenu', 'switcherList', 'streamerName', 'liveSummary', 'legacyNote', 'openOverlay', 'overlayUrlLabel',
    'streamersDialog', 'streamerRows', 'streamerAddForm', 'streamerAddName', 'streamersError']
    .forEach((id) => { el[id] = $(id); });

  /* ---------- Signing in: the owner, or an editor the owner has approved ---------- */
  let token = store.get(TOKEN_STORE, '');
  let locked = false;   // the server has a CONTROL_KEY, so people have to sign in
  let role = 'none';    // 'owner', 'editor', 'pending' or 'none'
  // The tabs this person can use: everything for the owner; for an editor, what the owner ticked in People
  const ALL_TABS = ['scoreboard', 'canvas', 'desk', 'games'];
  let tabs = ALL_TABS.slice();
  const allowedTab = (id) => role !== 'editor' || !ALL_TABS.includes(id) || tabs.includes(id);
  let session = {};
  let waitTimer = 0;
  const blocked = () => locked && role !== 'owner' && role !== 'editor';
  async function checkSession() {
    try {
      const res = await fetch('/api/session', { headers: token ? { Authorization: `Bearer ${token}` } : {}, cache: 'no-store' });
      session = await res.json();
    } catch (e) { return; } // the connection pill already says the server can't be reached
    locked = !!session.locked;
    role = session.role || 'none';
    tabs = Array.isArray(session.tabs) ? session.tabs : ALL_TABS.slice();
    applyRole();
    if (el.tiles) { paintTiles(); route(true); }
  }
  function applyRole() {
    document.documentElement.dataset.role = role;
    el.openNotice.hidden = locked;
    const out = locked && role !== 'owner' && role !== 'editor';
    el.signin.hidden = !out;
    el.hub.hidden = out;
    el.signinForms.hidden = role === 'pending' || session.reason === 'expired';
    el.signinWait.hidden = role !== 'pending';
    el.signinEnded.hidden = !(role === 'none' && session.reason === 'expired');
    clearTimeout(waitTimer);
    if (role === 'pending') waitTimer = setTimeout(checkSession, 4000);
    Object.values(modules).forEach((m) => m.hooks.onLock && m.hooks.onLock(blocked()));
    document.querySelectorAll('.tile [data-act="tile-air"]').forEach((b) => { b.disabled = blocked(); });
    if (!blocked()) Object.values(modules).forEach(flush);
    el.restoreBanner.hidden = !(role === 'owner' && session.fresh && store.get('hub-backup', ''));
    if (!el.restoreBanner.hidden) {
      const copy = JSON.parse(store.get('hub-backup', '{}'));
      setText(el.restoreText, `The server started empty. This device has a copy of your setup from ${new Date(copy.at || 0).toLocaleString()}.`);
    }
    if (window.Settings) window.Settings.refresh();
    paintStreamer();
  }
  function useToken(t) {
    token = t || '';
    if (token) store.set(TOKEN_STORE, token); else store.del(TOKEN_STORE);
    link.auth(token);
    checkSession();
  }
  async function signin(path, body) {
    setText(el.signinError, '');
    try {
      const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ device: deviceId }, body)) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'That didn’t work. Try again.');
      useToken(data.token);
    } catch (e) { setText(el.signinError, e.message); }
  }
  function handleUnauthorised() { checkSession(); }
  async function call(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: `Bearer ${token}` } : {}),
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    if (res.status === 401) { handleUnauthorised(); throw new Error('Sign in first.'); }
    if (!res.ok) throw new Error((data && data.error) || `Something went wrong (${res.status}).`);
    return data;
  }
  // The owner's device keeps a copy of everything, so a server that comes back empty can be filled again.
  async function saveDeviceCopy() {
    if (role !== 'owner' || !locked && false) return;
    try {
      const backup = await call('GET', '/api/backup');
      const text = JSON.stringify(backup);
      if (text.length < 4.5e6) store.set('hub-backup', text);
    } catch (e) { /* next time */ }
  }
  setInterval(saveDeviceCopy, 10 * 60 * 1000);
  setTimeout(saveDeviceCopy, 20 * 1000);

  /* ---------- Keeping each overlay in sync ---------- */
  const modules = {};
  const latest = {}; // states that arrive before an overlay's controls have loaded
  const acks = new Map();
  let ackSeq = 0;
  function module(id, hooks) {
    const reg = window.OverlayRegistry[id];
    const m = {
      id, hooks, reg, live: null, base: null, rev: 0, dirty: false, inFlight: false, ignore: [],
      view: reg.mount(stage, { preview: true, onDrag: hooks.onDrag }),
    };
    modules[id] = m;
    // A state that came in before these controls loaded is used once they've finished setting up.
    setTimeout(() => { if (latest[id] && !m.live) receive(m, latest[id]); }, 0);
    return {
      get live() { return m.live; },
      commit: (opts) => commit(m, opts),
      ignore: (key) => { if (key) m.ignore.push(key); },
      paint: () => paintMonitor(),
      view: m.view,
    };
  }
  function receive(m, raw) {
    const s = m.reg.normalize(raw);
    const local = m.live && m.base ? M.diff(m.base, m.live).filter(([p]) => m.hooks.patchable.includes(p[0])) : [];
    const first = !m.live;
    const before = m.live;
    m.base = s;
    // Changes this page hasn't had confirmed yet (still sending, or made while the connection was down)
    // stay on top of whatever the server sends, until the server has them.
    const unconfirmed = m.dirty || m.inFlight || (s.writer === clientId && s.rev < m.rev);
    if (m.live && unconfirmed && local.length) {
      m.live = m.reg.normalize(M.applyPatch(M.copy(s), local));
    } else {
      m.live = M.copy(s);
    }
    if (m.hooks.onState) m.hooks.onState(m.live, before, first);
    paintMonitor();
    paintTiles();
  }
  function commit(m, opts) {
    if (!m.live || blocked()) return;
    m.rev += 1;
    m.live.writer = clientId;
    m.live.rev = m.rev;
    if (m.hooks.onCommit) m.hooks.onCommit(opts || {});
    if (m.hooks.onState) m.hooks.onState(m.live, m.live, false);
    paintMonitor();
    paintTiles();
    m.dirty = true;
    flush(m);
  }
  function flush(m) {
    if (!m.dirty || m.inFlight || !m.live || !m.base || blocked() || !link.open) return;
    m.dirty = false;
    m.inFlight = true;
    const id = `${clientId}-${(ackSeq += 1)}`;
    const ignore = m.ignore.slice();
    const patch = M.diff(m.base, m.live).filter(([p]) => m.hooks.patchable.includes(p[0]));
    const timer = setTimeout(() => settle(id, { ok: false, error: 'timeout' }), 6000);
    acks.set(id, { m, ignore, timer });
    link.send({ type: 'patch', streamer: current.id, module: m.id, id, patch, ignore });
  }
  function settle(id, msg) {
    const a = acks.get(id);
    if (!a) return;
    acks.delete(id);
    clearTimeout(a.timer);
    const { m } = a;
    m.inFlight = false;
    if (msg.ok) {
      m.ignore = m.ignore.filter((k) => !a.ignore.includes(k));
      if (connKind === 'error') setConn('live');
      el.conn.classList.add('is-saved');
      clearTimeout(el.conn._t);
      el.conn._t = setTimeout(() => el.conn.classList.remove('is-saved'), 1200);
    } else if (msg.error === 'auth') {
      m.dirty = true;
      handleUnauthorised();
      return;
    } else {
      m.dirty = true;
      if (msg.error !== 'timeout') setConn('error');
    }
    if (m.dirty) setTimeout(() => flush(m), msg.ok ? 0 : 1500);
  }

  /* ---------- The preview monitor ---------- */
  const stage = Stage.create(el.viewport, { preview: true });
  let monitorMode = store.get('hub-monitor', 'output') === 'preview' ? 'preview' : 'output';
  let backdrop = ['checker', 'dark', 'light'].includes(store.get('hub-bg', '')) ? store.get('hub-bg', '') : 'checker';
  const safeOn = store.get('hub-safe', '0') === '1';
  stage.setBackdrop(backdrop);
  stage.setSafeArea(safeOn);
  el.safeToggle.checked = safeOn;
  function setMonitor(mode, quiet) {
    monitorMode = mode === 'preview' ? 'preview' : 'output';
    store.set('hub-monitor', monitorMode);
    paintMonitor();
    if (!quiet) toast(monitorMode === 'preview' ? 'Practice view: only you can see this. Try things here first.' : 'What viewers see: exactly what’s on the stream right now.');
  }
  function paintMonitor() {
    Object.values(modules).forEach((m) => {
      if (!m.live) return;
      const sample = m.hooks.previewState && m.hooks.previewState();
      let s = sample || (m.live.preview && !m.live.onAir ? Object.assign({}, m.live, { onAir: true, _pv: true }) : m.live);
      if (m.id === 'scoreboard' && current.look && current.look.brand) s = Object.assign({}, s, { look: Object.assign({}, s.look, { brand: current.look.brand }) });
      m.view.render(s);
    });

    el.bgSeg.querySelectorAll('[data-val]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.val === backdrop)));
    paintTag();
  }
  const TAG = { connecting: ['Connecting…', 'wait'], reconnecting: ['Reconnecting…', 'wait'], error: ['Last change wasn’t saved', 'bad'] };
  function paintTag() {
    const active = modules[view];
    const sample = active && active.hooks.previewState && active.hooks.previewState();
    let text;
    let mode;
    if (TAG[connKind]) [text, mode] = TAG[connKind];
    else if (sample) { text = `Preview only: ${active.hooks.sampleLabel()}`; mode = 'preview'; }
    else {
      const on = onScreenCount();
      text = `${on ? `${on === 1 ? '1 overlay' : `${on} overlays`} on screen` : 'Nothing on screen'}. Dashed outline = preview only`;
      mode = on ? 'live' : 'off';
    }
    setText(el.monitorText, text);
    el.monitorTag.dataset.mode = mode;
  }

  /* ---------- Connection ---------- */
  let connKind = 'connecting';
  function setConn(kind) {
    connKind = kind;
    el.conn.dataset.state = kind === 'reconnecting' ? 'offline' : kind;
    setText(el.connText, CONN_TEXT[kind] || '');
    paintTag();
  }
  const link = Live.connect({
    onStatus: (kind) => { if (kind !== 'live' || connKind !== 'error') setConn(kind); },
    onOpen: () => { acks.forEach((a, id) => settle(id, { ok: false, error: 'timeout' })); },
    onHello: (msg) => {
      const st = msg.streamer || {};
      if (st.id && st.id !== current.id) resetSync(); // another streamer: nothing of the last one carries over
      current = { id: st.id || '', name: st.name || '', code: st.code || '', legacy: !!st.legacy, look: st.look || {}, stack: st.stack || [] };
      store.set('hub-streamer', current.id);
      Scoreboard.setCrestBase(`/api/crest/${current.id}`);
      // The streamer's brand colour, for swatches and the scoreboard's accent
      document.documentElement.style.setProperty('--brand', current.look.brand || '#e11d48');
      // The preview shows this streamer's overlay look too
      stage.el.dataset.font = current.look.font || 'barlow';
      stage.el.dataset.corners = current.look.corners || 'rounded';
      stage.el.dataset.anim = current.look.anim || 'slide';
      paintStreamer();
      Object.keys(latest).forEach((k) => delete latest[k]);
      Object.entries(msg.modules || {}).forEach(([id, state]) => { latest[id] = state; if (modules[id]) receive(modules[id], state); });
      Object.values(modules).forEach(flush);
    },
    onState: (id, state) => { latest[id] = state; if (modules[id]) receive(modules[id], state); },
    onTick: (id, msg) => {
      const m = modules[id];
      [m && m.live, m && m.base].forEach((x) => { if (x && x.feed) { x.feed.updatedAt = msg.updatedAt; x.feed.nextAt = msg.nextAt; } });
    },
    onStreamers: (list) => { streamerList = list; paintStreamer(); paintManage(); if (window.Settings) window.Settings.refresh(); },
    onMessage: (msg) => {
      if (msg.type === 'hub') {
        if (msg.tiles) hubSettings.tiles = msg.tiles;
        if (msg.links) hubSettings.links = msg.links;
        requestsWaiting = msg.people ? msg.people.requests : 0;
        el.cogBadge.hidden = !requestsWaiting;
        setText(el.cogBadge, String(requestsWaiting));
        buildTiles();
        paintTiles();
        paintLinks();
        route(true);
        if (window.Settings) window.Settings.refresh();
      } else if (msg.type === 'activityAll' && msg.streamer === current.id) {
        activity = msg.list || [];
        paintActivity();
      } else if (msg.type === 'activity' && msg.streamer === current.id) {
        activity.push(msg.entry);
        if (activity.length > 300) activity.shift();
        paintActivity();
        if (window.Settings) window.Settings.refresh('people');
      } else if (msg.type === 'session') {
        checkSession();
      } else if (msg.type === 'obs' && msg.streamer === current.id) {
        // The "OBS connected" light: green once this streamer's overlay link is open in OBS
        const pill = document.getElementById('obsPill');
        pill.dataset.state = msg.count ? 'on' : 'off';
        document.getElementById('obsText').textContent = msg.count ? (msg.count > 1 ? `OBS connected (${msg.count})` : 'OBS connected') : 'OBS not connected';
      } else if (msg.type === 'media' && msg.streamer === current.id) {
        window.dispatchEvent(new CustomEvent('hub-media', { detail: { list: msg.list || [], playlistMB: msg.playlistMB || 0 } }));
      } else if (msg.type === 'chatAll' && msg.streamer === current.id) {
        chatLog = msg.list || [];
        chatSettings = msg.chat || chatSettings;
        paintChat(msg.state);
      } else if (msg.type === 'chat' && msg.streamer === current.id) {
        chatLog.push(msg.msg);
        if (chatLog.length > 80) chatLog.shift();
        paintChat();
      } else if (msg.type === 'chatStatus') {
        paintChat(msg.state);
      }
    },
    onUpdate: () => toast('The hub has been updated. Reload to get the new version.', { action: { label: 'Reload', fn: () => location.reload() }, ms: 60000 }),
    onAuth: () => checkSession(),
    onAck: (msg) => settle(msg.id, msg),
  }, { role: 'control', streamer: current.id });
  link.auth(token);

  /* ---------- Streamers ---------- */
  function resetSync() {
    acks.forEach((a) => clearTimeout(a.timer));
    acks.clear();
    Object.values(modules).forEach((m) => {
      Object.assign(m, { live: null, base: null, rev: 0, dirty: false, inFlight: false, ignore: [] });
      if (m.hooks.onStreamer) m.hooks.onStreamer();
    });
    lastUndo = null;
  }
  function switchTo(id) {
    closeMenu();
    if (!id || id === current.id) return;
    link.watch(id);
  }
  function overlayLink(st) { return st && st.code ? `${location.origin}/overlay/${st.code}` : ''; }
  function paintStreamer() {
    // Signed out, the top bar just says what this is; the streamers' names stay private.
    setText(el.streamerName, locked && role !== 'owner' && role !== 'editor' ? 'Overlay hub' : current.name || 'My stream');
    const url = overlayLink(current);
    el.overlayUrl.value = url || 'Unlock the hub to see this streamer’s link';
    // Editors never see the OBS link, so it can't be copied or passed on
    const linkRow = el.overlayUrl.parentElement;
    if (!el.obsOwnerNote) { el.obsOwnerNote = document.createElement('p'); el.obsOwnerNote.className = 'note obs-owner-note'; el.obsOwnerNote.textContent = 'Only the owner can see the OBS link.'; linkRow.after(el.obsOwnerNote); }
    linkRow.hidden = role === 'editor';
    el.obsOwnerNote.hidden = role !== 'editor';
    el.openOverlay.href = url || '#';
    el.openOverlay.classList.toggle('is-disabled', !url);
    el.legacyNote.hidden = !current.legacy;
    const live = onScreenCount();
    setText(el.liveSummary, live ? `${live === 1 ? '1 overlay' : `${live} overlays`} on stream` : 'Nothing on stream');
    el.liveSummary.classList.toggle('is-live', live > 0);
    el.switcherBtn.classList.toggle('has-many', streamerList.length > 1);
    // The list in the switcher
    const frag = document.createDocumentFragment();
    streamerList.forEach((x) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'sm-item';
      b.setAttribute('role', 'menuitemradio');
      b.setAttribute('aria-checked', String(x.id === current.id));
      b.dataset.act = 'streamer-pick';
      b.dataset.id = x.id;
      const dot = document.createElement('i');
      dot.className = `sm-dot${x.live ? ' is-live' : ''}`;
      dot.title = x.live ? 'Something is on stream' : 'Nothing on stream';
      const name = document.createElement('span');
      name.textContent = x.name;
      b.append(dot, name);
      frag.appendChild(b);
    });
    el.switcherList.replaceChildren(frag);
  }
  function openMenu() {
    el.switcherMenu.hidden = false;
    el.switcherBtn.setAttribute('aria-expanded', 'true');
    const first = el.switcherMenu.querySelector('[aria-checked="true"]') || el.switcherMenu.querySelector('button');
    if (first) first.focus();
  }
  function closeMenu() {
    if (el.switcherMenu.hidden) return;
    el.switcherMenu.hidden = true;
    el.switcherBtn.setAttribute('aria-expanded', 'false');
  }
  // Manage streamers: rename, copy or reset each link, remove, add.
  const confirming = new Map();
  function paintManage() {
    if (!el.streamersDialog.open) return;
    const frag = document.createDocumentFragment();
    streamerList.forEach((x) => {
      const row = document.createElement('div');
      row.className = 'st-row';
      row.innerHTML = `<i class="sm-dot${x.live ? ' is-live' : ''}" aria-hidden="true"></i>
        <input class="input st-name" type="text" maxlength="32" aria-label="Streamer name">
        <div class="st-actions">
          <button class="btn btn-small" type="button" data-act="streamer-copy">Copy link</button>
          <button class="btn btn-small" type="button" data-act="streamer-hide-link" title="A one-button page for the streamer to hide their overlays">Hide link</button>
          <button class="btn btn-small" type="button" data-act="streamer-reset">Reset link</button>
          <button class="btn btn-small btn-quiet" type="button" data-act="streamer-delete">Remove</button>
        </div>`;
      row.dataset.id = x.id;
      const input = row.querySelector('.st-name');
      input.value = x.name;
      input.addEventListener('change', () => renameStreamer(x.id, input.value));
      const del = row.querySelector('[data-act="streamer-delete"]');
      del.disabled = streamerList.length < 2;
      ['streamer-reset', 'streamer-delete'].forEach((act) => {
        const btn = row.querySelector(`[data-act="${act}"]`);
        if (confirming.get(`${act}|${x.id}`)) { btn.textContent = 'Tap again'; btn.classList.add('is-confirming'); }
      });
      frag.appendChild(row);
    });
    el.streamerRows.replaceChildren(frag);
  }
  function confirmOnce(act, id) {
    const key = `${act}|${id}`;
    if (confirming.get(key)) { confirming.delete(key); return true; }
    confirming.set(key, true);
    setTimeout(() => { confirming.delete(key); paintManage(); }, 3200);
    paintManage();
    return false;
  }
  async function renameStreamer(id, name) {
    try { await call('PATCH', `/api/streamers/${id}`, { name }); setText(el.streamersError, ''); } catch (e) { setText(el.streamersError, e.message); }
  }
  async function streamerAction(act, id) {
    const x = streamerList.find((y) => y.id === id);
    if (!x) return;
    try {
      if (act === 'streamer-copy') {
        try { await navigator.clipboard.writeText(overlayLink(x)); toast(`Copied ${x.name}’s overlay link`); } catch (e) { toast(overlayLink(x), { ms: 8000 }); }
      } else if (act === 'streamer-reset') {
        if (!confirmOnce(act, id)) return;
        await call('POST', `/api/streamers/${id}/link`);
        toast(`${x.name} has a new overlay link. Paste it into their OBS; the old one has stopped working.`, { ms: 7000 });
      } else if (act === 'streamer-delete') {
        if (!confirmOnce(act, id)) return;
        await call('DELETE', `/api/streamers/${id}`);
        toast(`${x.name} was removed`);
      }
      setText(el.streamersError, '');
    } catch (e) { setText(el.streamersError, e.message); }
  }
  async function addStreamer(name) {
    try {
      const res = await call('POST', '/api/streamers', { name });
      el.streamerAddName.value = '';
      setText(el.streamersError, '');
      toast(`${res.streamer.name} added. Their overlays start hidden.`);
      link.watch(res.streamer.id);
    } catch (e) { setText(el.streamersError, e.message); }
  }

  /* ---------- The box under the preview: OBS link, Links, Activity ---------- */
  function setBox(tab) {
    document.querySelectorAll('[data-act="box"]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    document.querySelectorAll('.box-panel').forEach((p) => { p.hidden = p.dataset.panel !== tab; });
    store.set('hub-box', tab);
  }
  function paintLinks() {
    if (role !== 'owner') return;
    const frag = document.createDocumentFragment();
    hubSettings.links.forEach((l, i) => {
      const row = document.createElement('div');
      row.className = 'lk-row';
      const a = document.createElement('a');
      a.className = 'link-btn';
      a.href = l.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      const icon = document.createElement('img');
      icon.alt = '';
      icon.loading = 'lazy';
      try { icon.src = `${new URL(l.url).origin}/favicon.ico`; } catch (e) { /* no icon */ }
      icon.addEventListener('error', () => icon.remove());
      const name = document.createElement('span');
      name.textContent = l.name;
      a.append(icon, name);
      const edit = document.createElement('div');
      edit.className = 'link-edit';
      edit.innerHTML = `<button class="btn btn-quiet" type="button" data-act="link-move" data-d="-1" aria-label="Move up"${i === 0 ? ' disabled' : ''}>↑</button><button class="btn btn-quiet" type="button" data-act="link-del" aria-label="Remove link">×</button>`;
      edit.dataset.id = l.id;
      row.append(a, edit);
      frag.appendChild(row);
    });
    if (!hubSettings.links.length) { const p = document.createElement('p'); p.className = 'note'; p.textContent = 'Add the links you need for streaming: your dashboard, chat pop-out, Northflank and so on. Only you see them.'; frag.appendChild(p); }
    el.linksList.replaceChildren(frag);
  }
  let chatLog = [];
  let chatSettings = { channel: '', commands: false, allow: [] };
  let chatState = 'off';
  function paintChat(state) {
    if (state) chatState = state;
    const words = { off: 'Off', connecting: 'Connecting…', on: 'Reading', reconnecting: 'Reconnecting…' };
    const pill = document.getElementById('chatState');
    pill.textContent = chatSettings.channel ? words[chatState] || chatState : 'Off';
    pill.classList.toggle('is-on', chatState === 'on' && !!chatSettings.channel);
    const ch = document.getElementById('chatChannel');
    if (document.activeElement !== ch) ch.value = chatSettings.channel || '';
    const al = document.getElementById('chatAllow');
    if (document.activeElement !== al) al.value = (chatSettings.allow || []).join(', ');
    document.querySelectorAll('[data-act="chat-cmd"]').forEach((b) => b.setAttribute('aria-pressed', String((b.dataset.val === '1') === !!chatSettings.commands)));
    const list = document.getElementById('chatList');
    const atBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 30;
    list.replaceChildren(...chatLog.map((m) => {
      const li = document.createElement('li');
      const b = document.createElement('b');
      b.textContent = m.u;
      if (m.c) b.style.color = m.c;
      li.append(b, `: ${m.text}`);
      return li;
    }));
    if (!chatLog.length) { const li = document.createElement('li'); li.textContent = chatSettings.channel ? 'Waiting for messages…' : 'Type the streamer’s Twitch channel and press Read chat.'; list.appendChild(li); }
    if (atBottom) list.scrollTop = list.scrollHeight;
  }
  const saveChat = (body) => call('PATCH', `/api/streamers/${current.id}/chat`, body).then((r) => { chatSettings = r.chat; paintChat(); }).catch((err) => toast(err.message, { tone: 'bad' }));
  function paintActivity() {
    const list = activity.slice(-200).reverse();
    const frag = document.createDocumentFragment();
    list.forEach((a) => {
      const li = document.createElement('li');
      const t = document.createElement('time');
      t.textContent = new Date(a.t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
      const p = document.createElement('span');
      const who = document.createElement('b');
      who.textContent = a.who;
      if (a.who === 'Live') who.className = 'live-who';
      p.append(who, `: ${a.text}`);
      li.append(t, p);
      frag.appendChild(li);
    });
    if (!list.length) { const li = document.createElement('li'); li.textContent = 'Nothing yet. Goals, cards, changes and who made them show here.'; frag.appendChild(li); }
    el.activityList.replaceChildren(frag);
  }

  /* ---------- Pages: the hub and each overlay ---------- */
  function route(quiet) {
    if (quiet === true && !el.tiles) return;
    const id = location.hash.replace(/^#\/?/, '');
    const next = modules[id] && allowedTab(id) ? id : 'home';
    if (modules[id] && !allowedTab(id) && quiet !== true) toast('You don’t have access to that tab. Ask the owner.');
    const changed = next !== view;
    if (modules[view] && modules[view].hooks.onHide && changed) modules[view].hooks.onHide();
    view = next;
    el.hub.dataset.view = view;
    document.documentElement.dataset.view = view;
    document.querySelectorAll('.view').forEach((v) => { v.hidden = v.id !== (view === 'home' ? 'viewHome' : `view${view[0].toUpperCase()}${view.slice(1)}`); });
    el.backBtn.hidden = view === 'home';
    const tile = TILES.find((t) => t.id === view);
    const mark = document.querySelector('.brand-mark');
    if (!mark._hub) mark._hub = mark.innerHTML;
    mark.innerHTML = tile ? tile.icon : mark._hub;
    setText(el.pageTitle, tile ? tileName(tile) : 'Overlay hub');
    document.title = tile ? `${tileName(tile)}, Overlay hub` : 'Overlay hub';
    document.querySelectorAll('.tip[data-tip]').forEach((t) => { t.hidden = store.get(`hub-tip-${t.dataset.tip}`, '') === 'done'; });
    el.sampleTools.hidden = view !== 'scoreboard';
    if (modules[view]) {
      const m = modules[view];
      // Opening an overlay that's off screen shows it in Preview, so it can be set up before it goes live.

      if (m.hooks.onShow) m.hooks.onShow();
    }
    if (changed) window.scrollTo(0, 0);
    paintMonitor();
  }
  window.addEventListener('hashchange', route);
  function goHome() {
    if (view === 'home') return;
    history.pushState(null, '', location.pathname + location.search);
    route();
  }

  /* ---------- Tiles ---------- */
  const tileName = (t) => (hubSettings.tiles.names && hubSettings.tiles.names[t.id]) || t.name;
  // Auto: on screen first, then overlays you can preview, then ones still to come. Custom: the owner's order.
  function orderedTiles() {
    const list = TILES.filter((t) => allowedTab(t.id));
    if (hubSettings.tiles.mode === 'custom' && hubSettings.tiles.order.length) {
      const pos = (t) => { const i = hubSettings.tiles.order.indexOf(t.id); return i < 0 ? 99 : i; };
      return list.sort((a, b) => pos(a) - pos(b));
    }
    const showing = (m) => !!(m && m.live && (m.hooks.isShowing ? m.hooks.isShowing(m.live) : m.live.onAir));
    const rank = (t) => (t.soon ? 2 : showing(modules[t.id]) ? 0 : 1);
    return list.map((t, i) => ({ t, i })).sort((a, b) => (rank(a.t) - rank(b.t)) || (a.i - b.i)).map((x) => x.t);
  }
  let tileKey = '';
  function buildTiles() {
    const order = orderedTiles();
    const key = JSON.stringify([order.map((t) => t.id), hubSettings.tiles.names]);
    if (key === tileKey) return;
    tileKey = key;
    const frag = document.createDocumentFragment();
    order.forEach((t) => {
      const art = document.createElement('article');
      art.className = `tile${t.soon ? ' is-soon' : ''}`;
      art.dataset.tile = t.id;
      if (t.soon) {
        art.innerHTML = `<div class="tile-open" aria-disabled="true"><span class="tile-icon">${t.icon}</span><span><span class="tile-name"></span><span class="tile-desc"></span></span></div><div class="tile-skeleton" aria-hidden="true"><i></i><i></i></div><span class="soon-pill">Coming soon</span>`;
      } else {
        art.innerHTML = `<button class="tile-open" type="button" data-act="open" data-id="${t.id}"><span class="tile-icon">${t.icon}</span><span><span class="tile-name"></span><span class="tile-desc"></span></span><svg class="chev-r" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
          <div class="tile-preview" data-tile-preview aria-hidden="true"></div>
          <div class="tile-live"><span data-tile-text>Loading…</span><small data-tile-small></small></div>
          <div class="tile-foot"><span class="tile-state" data-tile-state>Hidden</span>
            <div class="seg seg-sm" role="group" aria-label="${t.name} on stream"><button class="on" type="button" data-act="tile-air" data-id="${t.id}" data-val="1">Show</button><button type="button" data-act="tile-air" data-id="${t.id}" data-val="0">Off</button></div></div>`;
      }
      art.querySelector('.tile-name').textContent = tileName(t);
      art.querySelector('.tile-desc').textContent = t.desc;
      frag.appendChild(art);
    });
    el.tiles.replaceChildren(frag);
    // Each working tile shows its overlay live, small, on a see-through background.
    previews = {};
    el.tiles.querySelectorAll('[data-tile-preview]').forEach((box) => {
      const id = box.closest('[data-tile]').dataset.tile;
      const reg = window.OverlayRegistry[id];
      if (!reg) return;
      const stg = Stage.create(box);
      previews[id] = reg.mount(stg);
    });
  }
  let previews = {};
  function paintTiles() {
    if (current.id) paintStreamer();
    if (hubSettings.tiles.mode !== 'custom') { const before = tileKey; buildTiles(); if (before !== tileKey) paintTiles(); }
    // The mini score in the top bar, on every page
    const sb = modules.scoreboard;
    if (sb && sb.live && sb.hooks.tileSummary) {
      const sum = sb.hooks.tileSummary(sb.live);
      el.miniScore.hidden = !(sb.live.onAir || sb.live.mode === 'live');
      setText(el.miniText, sum.text);
      setText(el.miniSmall, sum.small || '');
      el.miniScore.querySelector('i').classList.toggle('is-off', !sb.live.onAir);
      setText(el.qbAir, sb.live.onAir ? 'Hide' : 'Show');
    }
    Object.values(modules).forEach((m) => {
      const art = el.tiles.querySelector(`[data-tile="${m.id}"]`);
      if (!art || !m.live) return;
      const sum = m.hooks.tileSummary ? m.hooks.tileSummary(m.live) : { text: '', small: '' };
      setText(art.querySelector('[data-tile-text]'), sum.text);
      if (previews[m.id]) previews[m.id].render(Object.assign({}, m.live, { onAir: true, anims: [] }));
      setText(art.querySelector('[data-tile-small]'), sum.small || '');
      art.classList.toggle('is-on', !!m.live.onAir);
      setText(art.querySelector('[data-tile-state]'), (m.hooks.isShowing ? m.hooks.isShowing(m.live) : m.live.onAir) ? 'On stream' : 'Hidden');
      art.querySelectorAll('[data-act="tile-air"]').forEach((b) => {
        b.setAttribute('aria-pressed', String((b.dataset.val === '1') === !!m.live.onAir));
        b.disabled = blocked();
      });
    });
  }
  function setOnAir(id, on) {
    const m = modules[id];
    if (!m || !m.live || blocked() || !!m.live.onAir === on) return;
    m.live.onAir = on;
    if (!on && 'preview' in m.live) m.live.preview = false;
    commit(m, { keepPreview: true });
    const name = (TILES.find((t) => t.id === id) || {}).name || 'Overlay';
    toast(on ? `${name} is on stream` : `${name} is hidden`, { tone: on ? 'goal' : 'info' });
  }

  /* ---------- Toasts and undo ---------- */
  function toast(text, opts = {}) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.dataset.tone = opts.tone || 'info';
    t.setAttribute('role', 'status');
    const span = document.createElement('span');
    span.textContent = text;
    t.appendChild(span);
    let timer = 0;
    const close = () => {
      clearTimeout(timer);
      t.classList.add('is-leaving');
      setTimeout(() => t.remove(), 180);
    };
    if (opts.action) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn btn-small';
      b.textContent = opts.action.label;
      b.addEventListener('click', () => { close(); opts.action.fn(); });
      t.appendChild(b);
    }
    el.toasts.appendChild(t);
    while (el.toasts.children.length > 3) el.toasts.firstElementChild.remove();
    timer = setTimeout(close, opts.ms || (opts.action ? 7000 : 3200));
    return close;
  }
  let lastUndo = null;
  let closeUndoToast = null;
  // Call before a change: keeps the state from just before it, then offers to put it back.
  function remember(id, label) {
    const m = modules[id];
    if (!m || !m.live) return () => {};
    const before = M.copy(m.live);
    return () => {
      lastUndo = { id, before, label };
      if (closeUndoToast) closeUndoToast();
      closeUndoToast = toast(label, { tone: /goal/i.test(label) ? 'goal' : 'info', action: { label: 'Undo', fn: undo } });
    };
  }
  function undo() {
    if (!lastUndo) { toast('Nothing to undo'); return; }
    const { id, before, label } = lastUndo;
    lastUndo = null;
    if (closeUndoToast) { closeUndoToast(); closeUndoToast = null; }
    const m = modules[id];
    if (!m || !m.live || blocked()) return;
    const keep = m.hooks.keepOnUndo ? m.hooks.keepOnUndo(m.live) : {};
    m.live = Object.assign(m.reg.normalize(M.copy(before)), keep);
    commit(m, { keepPreview: true });
    toast(`Undone: ${label.replace(/\.$/, '')}`);
  }

  /* ---------- Clicks, keys and the rest of the page ---------- */
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(el.overlayUrl.value);
      setText(el.copyBtn, 'Copied');
    } catch (e) {
      el.overlayUrl.select();
      setText(el.copyBtn, 'Selected');
    }
    setTimeout(() => setText(el.copyBtn, 'Copy'), 1600);
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    switch (b.dataset.act) {
      case 'signin-as': {
        const owner = b.dataset.val === 'owner';
        document.querySelectorAll('[data-act="signin-as"]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        el.editorForm.hidden = owner;
        el.ownerForm.hidden = !owner;
        break;
      }
      case 'signin-cancel': fetch('/api/logout', { method: 'POST', headers: { Authorization: `Bearer ${token}` } }).finally(() => useToken('')); break;
      case 'signin-again': session.reason = ''; useToken(''); break;
      case 'restore-device': {
        try {
          const backup = JSON.parse(store.get('hub-backup', '{}'));
          call('POST', '/api/restore', { backup }).then(() => { toast('Your setup is back from this device’s copy.', { tone: 'good' }); session.fresh = false; applyRole(); }).catch((err) => toast(err.message, { tone: 'bad' }));
        } catch (e) { toast('This device’s copy couldn’t be read.', { tone: 'bad' }); }
        break;
      }
      case 'restore-dismiss': el.restoreBanner.hidden = true; break;
      case 'settings': if (window.Settings) window.Settings.open(); break;
      case 'box': setBox(b.dataset.tab); break;
      case 'link-del': call('DELETE', `/api/links/${b.closest('[data-id]').dataset.id}`).catch((err) => setText(el.linkError, err.message)); break;
      case 'link-move': call('PATCH', `/api/links/${b.closest('[data-id]').dataset.id}`, { move: Number(b.dataset.d) }).catch((err) => setText(el.linkError, err.message)); break;
      case 'hide-all':
        call('POST', `/api/streamers/${current.id}/hide`).then(() => toast('Everything is hidden for this streamer.', { tone: 'info' })).catch((err) => toast(err.message, { tone: 'bad' }));
        break;
      case 'chat-cmd': saveChat({ commands: b.dataset.val === '1' }); break;
      case 'qb-air': if (modules.scoreboard && modules.scoreboard.live) setOnAir('scoreboard', !modules.scoreboard.live.onAir); break;
      case 'tip-done': store.set(`hub-tip-${b.dataset.tip}`, 'done'); document.querySelectorAll(`.tip[data-tip="${b.dataset.tip}"]`).forEach((t) => { t.hidden = true; }); break;
      case 'streamer-hide-link': {
        const x = streamerList.find((y) => y.id === b.closest('[data-id]').dataset.id);
        if (x) navigator.clipboard.writeText(`${location.origin}/hide/${x.code}`).then(() => toast(`Copied ${x.name}’s hide link. It takes their overlays off screen with one tap.`)).catch(() => toast(`${location.origin}/hide/${x.code}`, { ms: 9000 }));
        break;
      }
      case 'copy-link': copyLink(); break;
      case 'home': goHome(); break;
      case 'open': location.hash = b.dataset.id; break;
      case 'tile-air': setOnAir(b.dataset.id, b.dataset.val === '1'); break;
      case 'monitor': setMonitor(b.dataset.val, true); break;
      case 'bg':
        backdrop = b.dataset.val;
        store.set('hub-bg', backdrop);
        stage.setBackdrop(backdrop);
        paintMonitor();
        break;
      case 'keys': if (el.keysDialog.showModal) el.keysDialog.showModal(); break;
      case 'keys-close': el.keysDialog.close(); break;
      case 'switcher': if (el.switcherMenu.hidden) openMenu(); else closeMenu(); break;
      case 'streamer-pick': switchTo(b.dataset.id); break;
      case 'streamer-add': closeMenu(); if (el.streamersDialog.showModal) { el.streamersDialog.showModal(); paintManage(); el.streamerAddName.focus(); } break;
      case 'streamers-manage': closeMenu(); if (el.streamersDialog.showModal) { el.streamersDialog.showModal(); paintManage(); } break;
      case 'streamers-close': el.streamersDialog.close(); break;
      case 'streamer-copy': case 'streamer-reset': case 'streamer-delete': streamerAction(b.dataset.act, b.closest('[data-id]').dataset.id); break;
      default: break;
    }
  });
  el.safeToggle.addEventListener('change', () => {
    store.set('hub-safe', el.safeToggle.checked ? '1' : '0');
    stage.setSafeArea(el.safeToggle.checked);
  });
  el.editorForm.addEventListener('submit', (e) => { e.preventDefault(); signin('/api/signin', { username: el.suName.value, password: el.suPass.value }); el.suPass.value = ''; });
  el.ownerForm.addEventListener('submit', (e) => { e.preventDefault(); signin('/api/login', { password: el.ownPass.value }); el.ownPass.value = ''; });
  document.getElementById('chatForm').addEventListener('submit', (e) => { e.preventDefault(); saveChat({ channel: document.getElementById('chatChannel').value }); });
  document.getElementById('chatAllowForm').addEventListener('submit', (e) => { e.preventDefault(); saveChat({ allow: document.getElementById('chatAllow').value.split(',').map((x) => x.trim()).filter(Boolean) }).then(() => toast('Command list saved')); });
  el.linkAdd.addEventListener('submit', (e) => {
    e.preventDefault();
    call('POST', '/api/links', { name: el.linkName.value, url: el.linkUrl.value })
      .then(() => { el.linkName.value = ''; el.linkUrl.value = ''; setText(el.linkError, ''); })
      .catch((err) => setText(el.linkError, err.message));
  });
  el.keysDialog.addEventListener('click', (e) => { if (e.target === el.keysDialog) el.keysDialog.close(); });
  el.streamersDialog.addEventListener('click', (e) => { if (e.target === el.streamersDialog) el.streamersDialog.close(); });
  el.streamerAddForm.addEventListener('submit', (e) => { e.preventDefault(); addStreamer(el.streamerAddName.value); });
  document.addEventListener('click', (e) => { if (!el.switcherMenu.hidden && !e.target.closest('#switcherMenu, #switcherBtn')) closeMenu(); });
  el.switcherMenu.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); closeMenu(); el.switcherBtn.focus(); return; }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = Array.from(el.switcherMenu.querySelectorAll('button'));
    const i = items.indexOf(document.activeElement);
    const next = items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length];
    if (next) next.focus();
  });

  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (el.keysDialog.open || el.streamersDialog.open || !el.switcherMenu.hidden) return;
    const k = e.key;
    if (k === 'Escape' && view !== 'home') { e.preventDefault(); goHome(); return; }
    if (k === '?') { e.preventDefault(); if (el.keysDialog.showModal) el.keysDialog.showModal(); return; }
    if (blocked()) return;
    if (k === 'p' || k === 'P') { e.preventDefault(); setMonitor(monitorMode === 'preview' ? 'output' : 'preview'); return; }
    if (k === 'u' || k === 'U') { e.preventDefault(); undo(); return; }
    const m = modules[view];
    if (m && m.hooks.onKey && m.hooks.onKey(k, e)) e.preventDefault();
  });

  // Phones: the tabs stick just under the preview, so keep its height in a CSS variable.
  const shell = el.viewport.parentElement;
  const measure = () => document.documentElement.style.setProperty('--monitor-h', `${Math.round(shell.getBoundingClientRect().height)}px`);
  if ('ResizeObserver' in window) new ResizeObserver(measure).observe(shell);
  window.addEventListener('resize', measure);
  measure();

  // Every single thing on screen counts: the scoreboard, each Canvas item and the drawing, each Stream Desk widget
  function onScreenCount() {
    return Object.values(modules).reduce((n, m) => n + (!m.live ? 0 : m.hooks.liveCount ? m.hooks.liveCount(m.live) : m.live.onAir ? 1 : 0), 0);
  }
  function visButtons(v, extra) {
    const a = extra || '';
    if (v === 'live') return `<div class="vis is-live"><span class="vis-state"><i></i>On screen</span><button class="btn btn-small" type="button" data-vis="preview"${a}>Back to preview</button><button class="btn btn-small vis-off" type="button" data-vis="off"${a}>Off</button></div>`;
    if (v === 'preview') return `<div class="vis is-preview"><button class="btn btn-small" type="button" data-vis="off"${a}>Off</button><span class="vis-state">Preview</span><button class="btn vis-go" type="button" data-vis="live"${a}>Show on screen</button></div>`;
    return `<div class="vis is-off"><button class="btn btn-small vis-pv" type="button" data-vis="preview"${a}>Show preview</button><span class="vis-state is-quiet">Off</span></div>`;
  }
  window.Hub = {
    visButtons,
    module, call, toast, remember, undo, route, setOnAir,
    get streamer() { return current; },
    get streamers() { return streamerList; },
    get role() { return role; },
    get hubSettings() { return hubSettings; },
    get tiles() { return TILES.map((t) => Object.assign({}, t, { label: tileName(t) })); },
    personal, applyPersonal, saveDeviceCopy, deviceId,
    get token() { return token; },
    raw: (m) => link.send(m),
    blocked, get monitorMode() { return monitorMode; }, setMonitor, paintMonitor, paintTag,
    store, get view() { return view; },
  };
  buildTiles();
  setBox(['obs', 'links', 'activity', 'chat'].includes(store.get('hub-box', '')) ? store.get('hub-box', '') : 'obs');
  checkSession();
  // Each overlay's controls load in their own script; the page is drawn once they all have.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', route);
  else setTimeout(route, 0);
})();
