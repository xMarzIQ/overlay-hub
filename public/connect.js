/*
  The live link to the server: one WebSocket that brings every overlay's state and the server's time,
  reconnects by itself, and carries changes from the hub.
*/
(() => {
  'use strict';
  const M = window.Match;

  function connect(handlers) {
    const h = handlers || {};
    let ws = null;
    let timer = 0;
    let attempt = 0;
    let key = null;
    const status = (kind) => { if (h.onStatus) h.onStatus(kind); };
    function open() {
      clearTimeout(timer);
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(`${proto}//${location.host}/ws`);
      ws.onopen = () => {
        attempt = 0;
        if (key !== null) raw({ type: 'auth', key });
        status('live');
        if (h.onOpen) h.onOpen();
      };
      ws.onmessage = (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch (e) { return; }
        if (msg.now) M.syncTime(msg.now);
        if (msg.type === 'hello' && h.onHello) h.onHello(msg);
        else if (msg.type === 'state' && h.onState) h.onState(msg.module, msg.state);
        else if (msg.type === 'auth' && h.onAuth) h.onAuth(msg);
        else if (msg.type === 'ack' && h.onAck) h.onAck(msg);
      };
      ws.onclose = () => {
        status('reconnecting');
        attempt += 1;
        timer = setTimeout(open, Math.min(10000, 400 * 2 ** Math.min(attempt, 5)));
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
      auth(k) { key = k; raw({ type: 'auth', key: k }); },
      get open() { return !!ws && ws.readyState === 1; },
    };
  }

  window.Live = { connect };
})();
