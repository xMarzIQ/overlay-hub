/*
  The live link to the server: one WebSocket that brings each overlay's state (in full, then just what changed),
  the server's time, and for the hub the list of streamers. It reconnects by itself.
  An overlay page reloads itself when the server has been updated, so OBS never runs old code.
*/
const installId = () => { try { let v = localStorage.getItem('hub-install'); if (!v) { v = Math.random().toString(36).slice(2, 14); localStorage.setItem('hub-install', v); } return v; } catch (e) { return ''; } };
(() => {
  'use strict';
  const M = window.Match;

  function connect(handlers, params) {
    const h = handlers || {};
    const p = params || {};
    let ws = null;
    let timer = 0;
    let attempt = 0;
    let key = null;
    let streamer = p.streamer || '';
    let build = '';
    const states = {}; // the last full state of each overlay, so changes can be applied to it
    const status = (kind) => { if (h.onStatus) h.onStatus(kind); };
    function url() {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const q = p.role === 'control' ? `role=control&s=${encodeURIComponent(streamer)}` : `o=${encodeURIComponent(p.code || '')}`;
      return `${proto}//${location.host}/ws?${q}`;
    }
    function open() {
      clearTimeout(timer);
      ws = new WebSocket(url());
      ws.onopen = () => {
        attempt = 0;
        if (key !== null) raw({ type: 'auth', token: key, install: installId() });
        status('live');
        if (h.onOpen) h.onOpen();
      };
      ws.onmessage = (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch (e) { return; }
        if (msg.now) M.syncTime(msg.now);
        if (msg.build) {
          if (build && build !== msg.build) {
            if (h.onUpdate) h.onUpdate(); else { location.reload(); return; }
          }
          build = msg.build;
        }
        switch (msg.type) {
          case 'hello':
            if (msg.streamer) streamer = msg.streamer.id;
            Object.keys(states).forEach((k) => delete states[k]);
            Object.entries(msg.modules || {}).forEach(([id, st]) => { states[id] = st; });
            if (h.onHello) h.onHello(msg);
            break;
          case 'state':
            states[msg.module] = msg.state;
            if (h.onState) h.onState(msg.module, msg.state);
            break;
          case 'delta':
            if (!states[msg.module]) return;
            states[msg.module] = M.applyPatch(M.copy(states[msg.module]), msg.patch);
            if (h.onState) h.onState(msg.module, states[msg.module]);
            break;
          case 'tick':
            if (states[msg.module] && states[msg.module].feed) {
              states[msg.module].feed.updatedAt = msg.updatedAt;
              states[msg.module].feed.nextAt = msg.nextAt;
            }
            if (h.onTick) h.onTick(msg.module, msg);
            break;
          case 'streamers': if (h.onStreamers) h.onStreamers(msg.list || []); break;
          case 'gone': if (h.onGone) h.onGone(); break;
          case 'auth': if (h.onAuth) h.onAuth(msg); break;
          case 'ack': if (h.onAck) h.onAck(msg); break;
          default: if (h.onMessage) h.onMessage(msg); break;
        }
      };
      ws.onclose = () => {
        status('reconnecting');
        attempt += 1;
        timer = setTimeout(open, Math.min(10000, 400 * 2 ** Math.min(attempt, 5)) * (0.8 + Math.random() * 0.4)); // a little random, so many devices don't all reconnect at once
      };
      ws.onerror = () => { try { ws.close(); } catch (e) { /* already closed */ } };
    }
    function raw(msg) {
      if (ws && ws.readyState === 1) { ws.send(JSON.stringify(msg)); return true; }
      return false;
    }
    status('connecting');
    open();
    return {
      send: raw,
      auth(t) { key = t || ''; raw({ type: 'auth', token: key, install: installId() }); },
      send(m) { raw(m); },
      watch(id) { streamer = id; raw({ type: 'watch', streamer: id }); },
      get streamer() { return streamer; },
      get open() { return !!ws && ws.readyState === 1; },
    };
  }

  window.Live = { connect };
})();
