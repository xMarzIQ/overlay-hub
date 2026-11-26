/*
  The overlay hub. Everything shared by every overlay lives here:
  - the control key and the live WebSocket link to the server,
  - keeping each overlay's state in sync (changes go up as small patches; the newest change wins),
  - the 1920×1080 preview monitor (Live output, Preview, background, safe area),
  - the hub page of tiles, the back arrow and each overlay's page,
  - toasts, undo and keyboard shortcuts.
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
  const KEY_STORE = 'scoreboard-control-key';
  const clientId = Math.random().toString(36).slice(2, 10);

  // The hub page. Overlays that aren't built yet show as "coming soon" tiles.
  const TILES = [
    { id: 'scoreboard', name: 'Live scoreboard', desc: 'Score, clock, stats and goals, live from ESPN or by hand', icon: '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><rect x="2.5" y="6" width="19" height="12" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 6v12M6.5 10.5v3M17.5 10.5v3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>' },
    { id: 'lower-third', soon: true, name: 'Lower third', desc: 'Name and title bar', icon: '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><rect x="3" y="14" width="14" height="5" rx="1.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3 10h9" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>' },
    { id: 'countdown', soon: true, name: 'Countdown', desc: 'Starting soon timer', icon: '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><circle cx="12" cy="13" r="7.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 9v4l2.5 2M9.5 3h5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' },
    { id: 'alerts', soon: true, name: 'Alerts', desc: 'Follow and sub pop-ups', icon: '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15L6 16z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M10 20.5h4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>' },
  ];
  const CONN_TEXT = { connecting: 'Connecting…', live: 'Connected', reconnecting: 'Reconnecting…', error: 'Last change wasn’t saved' };

  let view = 'home'; // 'home' or the overlay whose page is open

  const el = {};
  ['viewport', 'monitorTag', 'monitorText', 'modeSeg', 'bgSeg', 'safeToggle', 'sampleTools', 'overlayUrl', 'copyBtn', 'conn', 'connText',
    'openNotice', 'unlock', 'keyInput', 'keyError', 'backBtn', 'pageTitle', 'pageSub', 'tiles', 'hub', 'toasts', 'keysDialog']
    .forEach((id) => { el[id] = $(id); });
  el.overlayUrl.value = `${location.origin}/overlay`;

  /* ---------- Control key ---------- */
  let controlKey = store.get(KEY_STORE, '');
  let locked = false; // the server has a CONTROL_KEY
  let authed = true;  // this device has the right key
  const blocked = () => locked && !authed;
  async function checkSession(key) {
    const res = await fetch('/api/session', { headers: { 'X-Control-Key': key }, cache: 'no-store' });
    if (!res.ok) throw new Error('session');
    return res.json();
  }
  function applyLock() {
    el.openNotice.hidden = locked;
    el.unlock.hidden = !blocked();
    Object.values(modules).forEach((m) => m.hooks.onLock && m.hooks.onLock(blocked()));
    document.querySelectorAll('.tile [data-act="tile-air"]').forEach((b) => { b.disabled = blocked(); });
    if (!blocked()) Object.values(modules).forEach(flush);
  }
  async function initAuth() {
    try {
      const s = await checkSession(controlKey);
      locked = !!s.locked;
      authed = !!s.ok;
    } catch (e) { /* the connection pill already says the server can't be reached */ }
    applyLock();
  }
  async function unlock() {
    const key = el.keyInput.value.trim();
    if (!key) { setText(el.keyError, 'Enter the control key first.'); return; }
    try {
      const s = await checkSession(key);
      if (!s.ok) { setText(el.keyError, 'That key doesn’t match the one set on the server.'); return; }
      controlKey = key;
      store.set(KEY_STORE, key);
      link.auth(key);
      locked = !!s.locked;
      authed = true;
      el.keyInput.value = '';
      setText(el.keyError, '');
      applyLock();
    } catch (e) {
      setText(el.keyError, 'Can’t reach the server. Check the connection and try again.');
    }
  }
  function handleUnauthorised() {
    authed = false;
    locked = true;
    controlKey = '';
    store.del(KEY_STORE);
    setText(el.keyError, 'The control key has changed. Enter the new one to keep making changes.');
    applyLock();
  }
  async function call(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Control-Key': controlKey },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    if (res.status === 401) { handleUnauthorised(); throw new Error('Unlock the hub first.'); }
    if (!res.ok) throw new Error((data && data.error) || `Something went wrong (${res.status}).`);
    return data;
  }

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
    link.send({ type: 'patch', module: m.id, id, patch, ignore });
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
    if (!quiet) toast(monitorMode === 'preview' ? 'Preview: shows overlays as if they were on screen.' : 'Live output: exactly what viewers see.');
  }
  function paintMonitor() {
    Object.values(modules).forEach((m) => {
      if (!m.live) return;
      const sample = m.hooks.previewState && m.hooks.previewState();
      const s = sample || (monitorMode === 'preview' ? Object.assign({}, m.live, { onAir: true }) : m.live);
      m.view.render(s);
    });
    el.modeSeg.querySelectorAll('[data-val]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.val === monitorMode)));
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
    else if (monitorMode === 'preview') { text = 'Preview, not what viewers see'; mode = 'pv'; }
    else {
      const list = active ? [active] : Object.values(modules);
      const on = list.filter((m) => m.live && m.live.onAir).length;
      if (active) { text = on ? 'Live output: on stream' : 'Live output: off screen'; }
      else { text = on ? `Live output: ${on === 1 ? '1 overlay' : `${on} overlays`} on screen` : 'Live output: nothing on screen'; }
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
      Object.entries(msg.modules || {}).forEach(([id, state]) => { latest[id] = state; if (modules[id]) receive(modules[id], state); });
      Object.values(modules).forEach(flush);
    },
    onState: (id, state) => { latest[id] = state; if (modules[id]) receive(modules[id], state); },
    onAuth: (msg) => { if (!msg.ok && msg.locked && controlKey) handleUnauthorised(); },
    onAck: (msg) => settle(msg.id, msg),
  });
  if (controlKey) link.auth(controlKey);
  else link.auth('');

  /* ---------- Pages: the hub and each overlay ---------- */
  function route() {
    const id = location.hash.replace(/^#\/?/, '');
    const next = modules[id] ? id : 'home';
    const changed = next !== view;
    if (modules[view] && modules[view].hooks.onHide && changed) modules[view].hooks.onHide();
    view = next;
    el.hub.dataset.view = view;
    document.querySelectorAll('.view').forEach((v) => { v.hidden = v.id !== (view === 'home' ? 'viewHome' : `view${view[0].toUpperCase()}${view.slice(1)}`); });
    el.backBtn.hidden = view === 'home';
    const tile = TILES.find((t) => t.id === view);
    const mark = document.querySelector('.brand-mark');
    if (!mark._hub) mark._hub = mark.innerHTML;
    mark.innerHTML = tile ? tile.icon : mark._hub;
    setText(el.pageTitle, tile ? tile.name : 'Overlay hub');
    setText(el.pageSub, tile ? 'Preview it, then put it on screen' : 'Every overlay on one OBS link');
    document.title = tile ? `${tile.name} · Overlay hub` : 'Overlay hub';
    el.sampleTools.hidden = view !== 'scoreboard';
    if (modules[view]) {
      const m = modules[view];
      // Opening an overlay that's off screen shows it in Preview, so it can be set up before it goes live.
      if (changed && m.live && !m.live.onAir && monitorMode !== 'preview') setMonitor('preview', true);
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
  function buildTiles() {
    const frag = document.createDocumentFragment();
    TILES.forEach((t) => {
      const art = document.createElement('article');
      art.className = `tile${t.soon ? ' is-soon' : ''}`;
      art.dataset.tile = t.id;
      if (t.soon) {
        art.innerHTML = `<div class="tile-open" aria-disabled="true"><span class="tile-icon">${t.icon}</span><span><span class="tile-name"></span><span class="tile-desc"></span></span></div><div class="tile-skeleton" aria-hidden="true"><i></i><i></i></div><span class="soon-pill">Coming soon</span>`;
      } else {
        art.innerHTML = `<button class="tile-open" type="button" data-act="open" data-id="${t.id}"><span class="tile-icon">${t.icon}</span><span><span class="tile-name"></span><span class="tile-desc"></span></span><svg class="chev-r" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
          <div class="tile-live"><span data-tile-text>Loading…</span><small data-tile-small></small></div>
          <div class="tile-foot"><span class="tile-state" data-tile-state>Off screen</span>
            <div class="seg seg-sm" role="group" aria-label="${t.name} on stream"><button class="on" type="button" data-act="tile-air" data-id="${t.id}" data-val="1">Show</button><button type="button" data-act="tile-air" data-id="${t.id}" data-val="0">Off</button></div></div>`;
      }
      art.querySelector('.tile-name').textContent = t.name;
      art.querySelector('.tile-desc').textContent = t.desc;
      frag.appendChild(art);
    });
    el.tiles.replaceChildren(frag);
  }
  function paintTiles() {
    Object.values(modules).forEach((m) => {
      const art = el.tiles.querySelector(`[data-tile="${m.id}"]`);
      if (!art || !m.live) return;
      const sum = m.hooks.tileSummary ? m.hooks.tileSummary(m.live) : { text: '', small: '' };
      setText(art.querySelector('[data-tile-text]'), sum.text);
      setText(art.querySelector('[data-tile-small]'), sum.small || '');
      art.classList.toggle('is-on', !!m.live.onAir);
      setText(art.querySelector('[data-tile-state]'), m.live.onAir ? 'On screen' : 'Off screen');
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
    commit(m, { keepPreview: true });
    // Once it's on screen, the monitor shows what viewers see.
    if (on && monitorMode === 'preview') setMonitor('output', true);
    const name = (TILES.find((t) => t.id === id) || {}).name || 'Overlay';
    toast(on ? `${name} is on screen` : `${name} is off screen`, { tone: on ? 'goal' : 'info' });
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
      case 'unlock': unlock(); break;
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
      default: break;
    }
  });
  el.safeToggle.addEventListener('change', () => {
    store.set('hub-safe', el.safeToggle.checked ? '1' : '0');
    stage.setSafeArea(el.safeToggle.checked);
  });
  el.keyInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); unlock(); } });
  el.keysDialog.addEventListener('click', (e) => { if (e.target === el.keysDialog) el.keysDialog.close(); });

  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (el.keysDialog.open) return;
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

  window.Hub = {
    module, call, toast, remember, undo, route, setOnAir,
    blocked, get monitorMode() { return monitorMode; }, setMonitor, paintMonitor, paintTag,
    store, get view() { return view; },
  };
  buildTiles();
  initAuth();
  // Each overlay's controls load in their own script; the page is drawn once they all have.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', route);
  else setTimeout(route, 0);
})();
