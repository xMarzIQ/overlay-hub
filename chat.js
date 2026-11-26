/*
  Reads Twitch chat for the streamers' channels, anonymously and read-only (no Twitch account or key needed).
  One connection joins every channel the hub needs. It reconnects by itself, waiting longer each time, up to a minute.
  Twitch could change or stop anonymous reading at any time; the rest of the hub carries on without it.
*/
const WebSocket = require('ws');

function createChat({ onMessage, onStatus }) {
  let ws = null;
  let joined = new Set();
  let wanted = new Set();
  let backoff = 1000;
  let timer = null;
  let status = 'off';
  const setStatus = (s) => { if (s !== status) { status = s; onStatus(s); } };

  function connect() {
    clearTimeout(timer);
    if (!wanted.size) { setStatus('off'); return; }
    setStatus('connecting');
    ws = new WebSocket('wss://irc-ws.chat.twitch.tv:443');
    ws.on('open', () => {
      ws.send('CAP REQ :twitch.tv/tags');
      ws.send('PASS SCHMOOPIIE');
      ws.send(`NICK justinfan${Math.floor(10000 + Math.random() * 80000)}`);
      joined = new Set();
      syncJoins();
      setStatus('on');
      backoff = 1000;
    });
    ws.on('message', (data) => String(data).split('\r\n').forEach(handle));
    ws.on('close', () => {
      ws = null;
      if (!wanted.size) { setStatus('off'); return; }
      setStatus('reconnecting');
      timer = setTimeout(connect, backoff);
      backoff = Math.min(60000, backoff * 2);
    });
    ws.on('error', () => { /* the close handler reconnects */ });
  }
  function handle(line) {
    if (!line) return;
    if (line.startsWith('PING')) { if (ws && ws.readyState === 1) ws.send('PONG :tmi.twitch.tv'); return; }
    const m = /^(?:@(\S+) )?:(\w+)!\S+ PRIVMSG #(\w+) :(.*)$/.exec(line);
    if (!m) return;
    const tags = {};
    (m[1] || '').split(';').forEach((kv) => { const i = kv.indexOf('='); if (i > 0) tags[kv.slice(0, i)] = kv.slice(i + 1); });
    onMessage(m[3].toLowerCase(), {
      u: (tags['display-name'] || m[2]).slice(0, 30),
      login: m[2].toLowerCase(),
      c: /^#[0-9a-f]{6}$/i.test(tags.color || '') ? tags.color : '',
      text: m[4].slice(0, 300),
      t: Date.now(),
    });
  }
  function syncJoins() {
    if (!ws || ws.readyState !== 1) return;
    wanted.forEach((ch) => { if (!joined.has(ch)) { ws.send(`JOIN #${ch}`); joined.add(ch); } });
    Array.from(joined).forEach((ch) => { if (!wanted.has(ch)) { ws.send(`PART #${ch}`); joined.delete(ch); } });
  }
  function setChannels(list) {
    wanted = new Set(list.map((c) => String(c || '').toLowerCase().replace(/[^a-z0-9_]/g, '')).filter(Boolean));
    if (!wanted.size) { if (ws) ws.close(); setStatus('off'); return; }
    if (!ws) connect(); else syncJoins();
  }
  return { setChannels, get status() { return status; } };
}

module.exports = createChat;
