/*
  The settings behind the cog in the top bar.
  - Personal (everyone): theme, big buttons, vibrate on goals, tips. These only change this device.
  - Owner only: tile order and names, the overlay look for the current streamer, People (approve, set access time
    and streamers, remove, sign-in history), passwords, backup and restore, and whether it's safe to update now.
*/
(() => {
  'use strict';
  const Hub = window.Hub;
  const dialog = document.getElementById('settingsDialog');
  const nav = document.getElementById('settingsNav');
  const body = document.getElementById('settingsBody');
  let section = 'personal';
  let people = null;
  const confirming = new Map();

  const SECTIONS = [
    { id: 'personal', name: 'Personal' },
    { id: 'tiles', name: 'Tiles', owner: true },
    { id: 'look', name: 'Overlay look', owner: true },
    { id: 'people', name: 'People', owner: true },
    { id: 'twitch', name: 'Twitch', owner: true },
    { id: 'passwords', name: 'Passwords', owner: true },
    { id: 'backup', name: 'Backup', owner: true },
    { id: 'storage', name: 'Storage and traffic', owner: true },
    { id: 'system', name: 'System status', owner: true },
    { id: 'updating', name: 'Updating', owner: true },
  ];
  const THEMES = [
    { id: 'cosy', name: 'Cosy', sw: ['#1d1612', '#2f241e', '#f2a65a'] },
    { id: 'crimson', name: 'Crimson', sw: ['#0c090b', '#1c151a', '#e11d48'] },
    { id: 'midnight', name: 'Midnight', sw: ['#070b14', '#141b2c', '#3b82f6'] },
    { id: 'pitch', name: 'Pitch', sw: ['#06100b', '#12221a', '#22c55e'] },
    { id: 'ultraviolet', name: 'Ultraviolet', sw: ['#0b0814', '#1b152d', '#a855f7'] },
    { id: 'daylight', name: 'Daylight', sw: ['#eef0f4', '#ffffff', '#d4123d'] },
  ];
  const ACCESS = [['1h', '1 hour'], ['24h', '24 hours'], ['7d', '7 days'], ['30d', '30 days'], ['never', 'Never expires']];
  const isOwner = () => Hub.role === 'owner';
  const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content; };
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const when = (t) => (t ? new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'never');
  const left = (t) => {
    if (!t) return 'Never expires';
    const s = Math.round((t - Date.now()) / 1000);
    if (s <= 0) return 'Access ended';
    if (s < 3600) return `${Math.ceil(s / 60)} min left`;
    if (s < 86400) return `${Math.round(s / 3600)} h left`;
    return `${Math.round(s / 86400)} days left`;
  };
  const seg = (act, value, options, extra) => `<div class="seg seg-sm" role="group">${options.map(([v, label]) => `<button type="button" data-set="${act}" data-val="${v}" aria-pressed="${String(v === value)}"${extra || ''}>${label}</button>`).join('')}</div>`;

  function open(which) {
    if (which) section = which;
    if (!isOwner() && SECTIONS.find((x) => x.id === section).owner) section = 'personal';
    if (!dialog.open && dialog.showModal) dialog.showModal();
    if (section === 'people') loadPeople();
    if (section === 'storage') loadUsage();
    if (section === 'twitch') loadTwitch();
    if (section === 'personal') loadMe();
    if (section === 'system') loadSystem();
    paint();
  }
  // Twitch: the connection for the streamer you're on
  let tw = null;
  let twArmed = 0;
  async function loadTwitch() {
    try { tw = await Hub.call('GET', `/api/twitch/status?streamer=${encodeURIComponent(Hub.streamer.id)}`); } catch (e) { tw = { failed: e.message }; }
    if (section === 'twitch' && dialog.open) paint();
  }
  window.addEventListener('hub-twitch', () => { if (dialog.open && section === 'twitch') loadTwitch(); });
  let usage = null;
  async function loadUsage() {
    try { usage = await Hub.call('GET', '/api/usage'); } catch (e) { usage = null; }
    if (section === 'storage') paint();
  }
  function refresh(which) {
    if (!dialog.open) return;
    if (which === 'people' && section === 'people') { loadPeople(); return; }
    paint();
  }
  async function loadPeople() {
    try { people = await Hub.call('GET', '/api/people'); } catch (e) { people = null; }
    if (section === 'people') paint();
  }

  function paint() {
    const waiting = Number(document.getElementById('cogBadge').textContent) || 0;
    nav.innerHTML = '<h2>Settings</h2>' + SECTIONS.filter((x) => !x.owner || isOwner())
      .map((x) => `<button type="button" data-section="${x.id}" aria-current="${String(x.id === section)}"><span>${x.name}</span>${x.id === 'people' && waiting ? `<span class="badge-n">${waiting}</span>` : ''}</button>`).join('');
    const node = RENDER[section]();
    if (section === 'personal' && Hub.role === 'editor' && node) node.appendChild(h(myAccount()));
    body.replaceChildren(h(`<button class="btn btn-quiet btn-small settings-close" type="button" data-set="close">Done</button>`), node);
  }

  const twEvent = (e) => `${esc(e.user)} ${({ sub: 'subscribed', resub: `resubscribed${e.months ? ` (${e.months} months)` : ''}`, gift: `gifted ${e.amount} sub${e.amount === 1 ? '' : 's'}`, bits: `cheered ${e.amount} bits`, follow: 'followed', raid: `raided with ${e.amount}`, redeem: `redeemed ${esc(e.reward)}`, online: 'went live', offline: 'went offline' })[e.kind] || e.kind}`;
  // Live editor activity: which tabs they have open and when they last changed something (never keystrokes or screens)
  const VIEW_NAMES = { home: 'Home', scoreboard: 'Live scoreboard', canvas: 'Canvas', desk: 'Stream Desk', games: 'Chat Games', challenges: 'Challenges', media: 'Media Centre', subathon: 'Subathon & Goals', twitch: 'Twitch Centre' };
  const presence = (p) => {
    const mins = p.lastAct ? Math.round((Date.now() - p.lastAct) / 60000) : -1;
    return `${(p.views || []).length ? `On ${p.views.map((v) => VIEW_NAMES[v] || v).join(', ')}. ` : ''}${mins < 0 ? 'Hasn’t changed anything since connecting.' : mins < 2 ? 'Active now.' : `Last change ${mins} min ago${mins >= 15 ? ' (idle)' : ''}.`}`;
  };
  // System status (owner): plain-English health with measured values marked as measured
  let sys = null;
  let sysTimer = 0;
  async function loadSystem() {
    try { sys = await Hub.call('GET', '/api/system'); } catch (e) { sys = { failed: e.message }; }
    if (section === 'system' && dialog.open) paint();
    clearTimeout(sysTimer);
    sysTimer = setTimeout(() => { if (section === 'system' && dialog.open) loadSystem(); }, 10000);
  }
  const mbs = (b) => `${Math.round(b / 1048576)} MB`;
  const ago = (t) => { if (!t) return 'not yet'; const s2 = Math.round((Date.now() - t) / 1000); return s2 < 90 ? `${s2} s ago` : s2 < 5400 ? `${Math.round(s2 / 60)} min ago` : `${Math.round(s2 / 3600)} h ago`; };
  const bar = (used, cap) => { const pc = Math.min(100, Math.round((used / cap) * 100)); return `<div class="sys-bar"><i style="width:${pc}%" data-level="${pc > 85 ? 'bad' : pc > 70 ? 'warn' : 'ok'}"></i></div>`; };
  function systemHtml() {
    if (!sys) return '<p class="lead">Checking…</p>';
    if (sys.failed) return `<p class="lead">${esc(sys.failed)}</p>`;
    const m = sys.memory;
    const lim = m.limit || m.plan;
    const worst = sys.warnings.some((w) => w.level === 'bad') ? 'bad' : sys.warnings.length ? 'warn' : 'ok';
    return `<p class="sys-health" data-level="${worst}">${worst === 'ok' ? 'Everything looks healthy.' : worst === 'warn' ? 'Mostly fine, with something to keep an eye on.' : 'Something needs attention.'}</p>
      ${sys.warnings.length ? `<div class="set-group"><h4>Warnings</h4>${sys.warnings.map((w) => `<p class="note" data-level="${w.level}">${esc(w.text)}${w.id ? ` <button class="btn btn-small" type="button" data-set="sys-ack" data-id="${w.id}" data-streamer="${w.streamer}">OK</button>` : ''}</p>`).join('')}</div>` : ''}
      <div class="set-group"><h4>Server</h4><p class="note">Version ${esc(sys.version)}, running for ${Math.floor(sys.uptime / 3600)} h ${Math.floor(sys.uptime / 60) % 60} min (since ${new Date(sys.started).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}).</p>
        <p class="note">Memory: ${mbs(m.rss)} of ${mbs(lim)} ${m.limitMeasured ? '(measured limit)' : '(the plan’s 256 MB, as the server can’t read its own limit here)'}.</p>${bar(m.rss, lim)}
        <p class="note">Response delay: ${sys.loop.lagMs} ms now, worst lately ${sys.loop.worstMs} ms ${sys.loop.worstMs > 500 ? '(slow at times)' : '(fine)'}.</p></div>
      <div class="set-group"><h4>Saving</h4><p class="note">Last saved ${ago(sys.data.lastSave)}${sys.data.fails ? `, ${sys.data.fails} failed saves` : ', no failures'}. Setup file ${Math.round(sys.data.stateBytes / 1024)} KB, presets and versions ${Math.round(sys.data.toolsBytes / 1024)} KB.${sys.data.startedEmpty ? ' The server started with nothing saved: attach the Volume so restarts keep everything.' : ''}</p></div>
      <div class="set-group"><h4>Storage and traffic</h4><p class="note">Uploads ${mbs(sys.storage.uploads)} of ${mbs(sys.storage.uploadCap)}</p>${bar(sys.storage.uploads, sys.storage.uploadCap)}<p class="note">Everything stored ${mbs(sys.storage.disk)} of ${mbs(sys.storage.diskCap)}</p>${bar(sys.storage.disk, sys.storage.diskCap)}<p class="note">Traffic this month ${(sys.storage.traffic / 1e9).toFixed(2)} of ${(sys.storage.trafficCap / 1e9).toFixed(0)} GB</p>${bar(sys.storage.traffic, sys.storage.trafficCap)}</div>
      <div class="set-group"><h4>Connections</h4><p class="note">${sys.presence.browsers} browser${sys.presence.browsers === 1 ? '' : 's'} with ${sys.presence.hubTabs} hub tab${sys.presence.hubTabs === 1 ? '' : 's'} open, ${sys.presence.overlays} OBS link${sys.presence.overlays === 1 ? '' : 's'} open. Twitch chat reader: ${esc(sys.chat || 'off')}.</p>
        ${sys.streamers.map((x) => `<p class="note"><b>${esc(x.name)}</b>: OBS ${x.obs.open ? `open (${x.obs.open}), last heartbeat ${ago(x.obs.lastBeat)}, last change shown ${ago(x.obs.lastApplied)}` : 'not open'}${x.obs.connects > 1 ? `, ${x.obs.connects - 1} reconnects since the server started` : ''}. Twitch ${!x.twitch.configured ? 'not set up' : !x.twitch.connected ? (x.twitch.revoked ? 'needs reconnecting' : 'not connected') : `connected, events ${esc(x.twitch.events)}${x.twitch.lastEvent ? `, last event ${ago(x.twitch.lastEvent)}` : ''}${x.twitch.missingScopes ? `, ${x.twitch.missingScopes} permissions missing` : ''}`}. Tools: ${x.tools.buttons} buttons, ${x.tools.rules} automations on, ${x.tools.locks} locks.</p>`).join('')}
        <p class="note">An open OBS link means the page is loaded somewhere, not that it’s live on stream.</p></div>
      <div class="set-group"><h4>Fix things</h4><div class="btn-row"><button class="btn btn-small" type="button" data-set="sys-refresh">Check again</button><button class="btn btn-small" type="button" data-set="sys-twitch">Reconnect Twitch</button><button class="btn btn-small" type="button" data-set="sys-resync">Re-send everything to OBS</button><button class="btn btn-small" type="button" data-set="sys-verify">Check the saved file</button></div>
        <div class="btn-row"><button class="btn btn-small" type="button" data-set="sys-export">Download status (no private details)</button><button class="btn btn-small" type="button" data-set="sys-activity">Download Activity (this streamer)</button><button class="btn btn-small ch-tog" type="button" data-set="sys-beep" aria-pressed="${localStorage.getItem('hub-beep') === '1'}">Beep for warnings: ${localStorage.getItem('hub-beep') === '1' ? 'On' : 'Off'}</button></div>
        <p class="note">Nothing here restarts the server or deletes anything.</p></div>`;
  }
  // A short beep for new warnings, if switched on (this device only)
  window.addEventListener('hub-notice', () => {
    if (localStorage.getItem('hub-beep') !== '1') return;
    try { const a = new (window.AudioContext || window.webkitAudioContext)(); const o = a.createOscillator(); const g = a.createGain(); o.frequency.value = 880; g.gain.value = 0.08; o.connect(g); g.connect(a.destination); o.start(); setTimeout(() => { o.frequency.value = 660; }, 160); setTimeout(() => { o.stop(); a.close(); }, 380); } catch (e) { /* no audio here */ }
  });
  const downloadFile = (url, name) => fetch(url, { headers: { Authorization: `Bearer ${Hub.token}` } }).then((r) => r.blob()).then((blob) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); URL.revokeObjectURL(a.href); }).catch(() => Hub.toast('The download didn’t work.', { tone: 'bad' }));
  const TW_PERM_NAMES = [['dash', 'Dashboard and stats'], ['feed', 'Subscriber names and activity'], ['chat', 'Read chat'], ['say', 'Send chat messages'], ['clips', 'Clips'], ['markers', 'Markers'], ['title', 'Change title'], ['category', 'Change category'],
    ['delete', 'Delete messages'], ['timeout', 'Time people out'], ['ban', 'Ban'], ['unban', 'Unban'], ['chatset', 'Chat modes'], ['polls', 'Twitch polls'], ['preds', 'Predictions'], ['points', 'Channel points'], ['timers', 'Timed messages'], ['cmds', 'Commands'], ['shout', 'Shoutouts'], ['alerts', 'Alerts'], ['history', 'Stream history']];
  // The Twitch Centre box stays open while the owner changes it
  const twOpen = new Set();
  document.getElementById('settingsBody').addEventListener('toggle', (e) => { const d = e.target; if (d.dataset && d.dataset.twopen) { if (d.open) twOpen.add(d.dataset.twopen); else twOpen.delete(d.dataset.twopen); } }, true);
  const twBox = (p) => {
    const tw = p.tw || { preset: 'none', perms: [] };
    const hasTab = (p.tabs || []).includes('twitch');
    return `<details class="tw-access" data-twopen="${p.id}"${twOpen.has(p.id) ? ' open' : ''}><summary><small class="note">Twitch Centre: <b>${{ none: 'No access', content: 'Content editor', manager: 'Stream manager', moderator: 'Moderator', custom: `Custom (${tw.perms.length})` }[tw.preset] || 'No access'}</b>${hasTab ? '' : ' (tick the Twitch Centre tab too)'}</small></summary>
      <select class="select" name="twp-${p.id}" aria-label="Twitch Centre access">${[['none', 'No access'], ['content', 'Content editor: clips and markers'], ['manager', 'Stream manager: stats, clips, markers, title, category'], ['moderator', 'Moderator: chat, timeouts, bans, chat modes'], ['custom', 'Custom']].map(([v, l]) => `<option value="${v}"${tw.preset === v ? ' selected' : ''}>${l}</option>`).join('')}</select>
      <div class="checks tw-perms">${TW_PERM_NAMES.map(([v, l]) => `<label><input type="checkbox" name="twc-${p.id}" value="${v}"${tw.perms.includes(v) ? ' checked' : ''}> ${l}</label>`).join('')}</div>
      <small class="note">Moderation also needs them to link their own Twitch (in their Personal settings), and Twitch must confirm they're a mod there. They never use the streamer's account to moderate.</small></details>`;
  };
  // My account (editors): their own access, devices, sign-ins and activity, and linking their own Twitch for moderation
  let me = null;
  async function loadMe() {
    if (Hub.role !== 'editor') return;
    try { me = await Hub.call('GET', '/api/me'); me.tw = await Hub.call('GET', '/api/twitch/me'); } catch (e) { me = { failed: e.message }; }
    if (section === 'personal' && dialog.open) paint();
  }
  const myAccount = () => {
    if (!me) return '<div class="set-group"><h4>My account</h4><p class="note">Loading…</p></div>';
    if (me.failed) return `<div class="set-group"><h4>My account</h4><p class="note">${esc(me.failed)}</p></div>`;
    const modPerms = ['delete', 'timeout', 'ban', 'unban', 'chatset'].filter((x) => (me.twitch || []).includes(x));
    return `<div class="set-group"><h4>My account: ${esc(me.name)}</h4>
      <p class="note">Access ${me.expiresAt ? `until ${new Date(me.expiresAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : 'with no end date'}. Streamers: ${esc(me.streamers.join(', ') || 'none')}. Open now: ${me.browsers} browser${me.browsers === 1 ? '' : 's'}, ${me.tabsOpen} tab${me.tabsOpen === 1 ? '' : 's'}.</p>
      <p class="note">Twitch Centre: ${me.twitch.length ? esc(me.twitch.map((x) => (TW_PERM_NAMES.find((n) => n[0] === x) || [x, x])[1]).join(', ')) : 'no access'}.</p>
      ${modPerms.length ? `<p class="note">${me.tw.linked ? `Moderating as <b>${esc(me.tw.login)}</b> (your own Twitch).` : 'To moderate, link your own Twitch account. Twitch checks you’re a mod of the channel.'}</p><div class="btn-row">${me.tw.linked ? '<button class="btn btn-small" type="button" data-set="tw-unlink">Unlink my Twitch</button>' : '<button class="btn btn-small btn-primary" type="button" data-set="tw-link">Link my Twitch</button>'}</div>` : ''}
      <h4>My devices</h4>${me.devices.map((d, i) => `<span class="device-chip">${esc(d.name)}${d.me ? ' (this one)' : ''}${d.me ? '' : `<button class="btn btn-quiet btn-small" type="button" data-set="me-out" data-i="${i}">Sign out</button>`}</span>`).join(' ') || '<p class="note">None</p>'}
      <h4>My sign-ins</h4><ul class="tw-feed">${me.signins.slice(0, 8).map((x) => `<li><time>${new Date(x.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</time>${esc(x.device || '')}: ${esc(x.what)}</li>`).join('') || '<li>Nothing yet</li>'}</ul>
      <h4>What I've done</h4><ul class="tw-feed">${me.activity.slice(0, 15).map((a) => `<li><time>${new Date(a.at || a.t).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</time>${esc(a.streamer)}: ${esc(a.text || a.what || '')}</li>`).join('') || '<li>Nothing yet</li>'}</ul></div>`;
  };
  const RENDER = {
    system() { return h(`<div><h3>System status</h3><p class="lead">How the server, saving, OBS and Twitch are doing, in plain words.</p>${systemHtml()}</div>`); },
    twitch() {
      const name = esc(Hub.streamer.name);
      if (!tw) return h('<div><h3>Twitch</h3><p class="lead">Loading…</p></div>');
      if (tw.failed) return h(`<div><h3>Twitch</h3><p class="lead">${esc(tw.failed)}</p></div>`);
      const steps = `<div class="set-group"><h4>Set up once (free)</h4><ol class="tw-steps">
          <li>Go to <b>dev.twitch.tv/console</b>, sign in, and press <b>Register Your Application</b>.</li>
          <li>Name it anything (like Overlay Hub). For <b>OAuth Redirect URLs</b> add exactly:<div class="tw-copy"><code>${esc(tw.redirect)}</code><button class="btn btn-small" type="button" data-set="tw-copy">Copy</button></div></li>
          <li>Category: <b>Broadcaster Suite</b>. Client Type: <b>Confidential</b>. Press <b>Create</b>, then <b>Manage</b>.</li>
          <li>Copy the <b>Client ID</b>, and press <b>New Secret</b> to get the <b>Client Secret</b>.</li>
          <li>In Northflank, open overlay-hub, then <b>Environment</b>, and add <code>TWITCH_CLIENT_ID</code> and <code>TWITCH_CLIENT_SECRET</code> (mark the secret as secret). Save; it restarts by itself.</li>
        </ol></div>`;
      if (!tw.configured) return h(`<div><h3>Twitch</h3><p class="lead">Connect each streamer’s Twitch so subs, bits, follows and raids can drive the Subathon timer, goals and alerts. It’s free.</p>${steps}</div>`);
      const ev = (tw.feed || []).slice(0, 10).map((e) => `<li><time>${new Date(e.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</time> ${twEvent(e)}</li>`).join('');
      const state = { connected: 'Receiving live events', connecting: 'Connecting to Twitch…', reconnecting: 'Reconnecting to Twitch…', off: 'Not listening' }[tw.events] || tw.events;
      return h(`<div><h3>Twitch</h3><p class="lead">The Twitch account for <b>${name}</b>. Only you can connect or disconnect it. Its keys stay on the server and are never shown to editors or OBS.</p>
        ${tw.connected ? `<div class="set-group"><h4>Connected as ${esc(tw.login)}</h4><p class="note"><span class="tw-dot" data-state="${tw.events}"></span>${state}</p>
          ${tw.missingScopes.length ? `<p class="note">Some permissions are missing (${tw.missingScopes.length}). Press Reconnect to grant them.</p>` : ''}
          ${tw.missingEvents.length ? `<p class="note">Not receiving: ${tw.missingEvents.map(esc).join(', ')}.</p>` : ''}
          <div class="btn-row"><button class="btn" type="button" data-set="tw-connect">Reconnect</button><button class="btn btn-quiet" type="button" data-set="tw-disconnect">${Date.now() - twArmed < 4000 ? 'Tap again to disconnect' : 'Disconnect'}</button></div></div>
          <div class="set-group"><h4>Latest Twitch events</h4>${ev ? `<ul class="tw-feed">${ev}</ul>` : '<p class="note">Nothing yet. Subs, bits, follows and raids appear here as they happen.</p>'}</div>`
        : `<div class="set-group">${tw.revoked ? '<p class="note">Twitch access was removed or expired. Connect again to restore it.</p>' : ''}<button class="btn btn-primary" type="button" data-set="tw-connect">Connect ${name}’s Twitch</button><p class="note">You’ll sign in on Twitch and come straight back here.</p></div>`}
        <details class="set-group"><summary>Setup steps</summary>${steps}</details></div>`);
    },
    personal() {
      const p = Hub.personal;
      return h(`<div>
        <h3>Personal</h3><p class="lead">These only change this device.</p>
        <div class="set-group"><h4>Theme</h4><div class="themes">${THEMES.map((t) => `<button class="theme" type="button" data-set="theme" data-val="${t.id}" aria-pressed="${String(p.theme === t.id)}"><i>${t.sw.map((c) => `<b style="background:${c}"></b>`).join('')}</i>${t.name}</button>`).join('')}</div></div>
        <div class="set-group">
          <div class="set-row"><span class="set-name">Big buttons<small>Larger buttons and text, for running a match one-handed</small></span>${seg('big', p.big ? '1' : '0', [['1', 'On'], ['0', 'Off']])}</div>
          <div class="set-row"><span class="set-name">Vibrate on goals<small>Your phone buzzes when a goal comes in from Live or someone else. Works on most Android phones.</small></span>${seg('vibrate', p.vibrate ? '1' : '0', [['1', 'On'], ['0', 'Off']])}</div>
          <div class="set-row"><span class="set-name">Tips<small>The short tips at the top of each page</small></span><button class="btn btn-small" type="button" data-set="tips">Show them again</button></div>
          <div class="set-row"><span class="set-name">Signed in as ${esc(Hub.role === 'owner' ? 'the owner' : 'an editor')}<small>Signing out means signing in again on this device</small></span><button class="btn btn-small" type="button" data-set="signout">Sign out</button></div>
        </div></div>`);
    },
    tiles() {
      const t = Hub.hubSettings.tiles;
      const order = Hub.tiles.slice().sort((a, b) => { const ia = t.order.indexOf(a.id); const ib = t.order.indexOf(b.id); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib); });
      return h(`<div>
        <h3>Tiles</h3><p class="lead">How the overlays are ordered on the hub page, and what they’re called. Everyone sees the same.</p>
        <div class="set-group"><div class="set-row"><span class="set-name">Order<small>Auto puts what’s on screen first, then overlays you can preview, then ones still to come</small></span>${seg('tile-mode', t.mode, [['auto', 'Auto'], ['custom', 'Custom']])}</div></div>
        <div class="set-group"><h4>${t.mode === 'custom' ? 'Your order and names' : 'Names'}</h4><div class="order-list">${order.map((x, i) => `
          <div class="order-item" data-id="${x.id}"><input class="input" type="text" maxlength="32" value="${esc(x.label)}" data-set="tile-name" aria-label="Name for ${esc(x.name)}" placeholder="${esc(x.name)}">
          ${t.mode === 'custom' ? `<span class="order-btns"><button class="btn" type="button" data-set="tile-move" data-d="-1" aria-label="Move up"${i === 0 ? ' disabled' : ''}>↑</button><button class="btn" type="button" data-set="tile-move" data-d="1" aria-label="Move down"${i === order.length - 1 ? ' disabled' : ''}>↓</button></span>` : ''}</div>`).join('')}</div></div></div>`);
    },
    look() {
      const st = Hub.streamer;
      const l = st.look || {};
      const stack = (st.stack || ['scoreboard']).map((id) => Hub.tiles.find((x) => x.id === id)).filter(Boolean);
      return h(`<div>
        <h3>Overlay look for ${esc(st.name)}</h3><p class="lead">One look for all of this streamer’s overlays, so they match each other. Each streamer has their own.</p>
        <div class="set-group">
          <div class="set-row"><span class="set-name">Font</span>${seg('look-font', l.font || 'barlow', [['barlow', 'Barlow'], ['oswald', 'Oswald'], ['saira', 'Saira']])}</div>
          <div class="set-row"><span class="set-name">Corners</span>${seg('look-corners', l.corners || 'rounded', [['rounded', 'Rounded'], ['sharp', 'Sharp']])}</div>
          <div class="set-row"><span class="set-name">On and off<small>How overlays come on screen and go off</small></span>${seg('look-anim', l.anim || 'slide', [['slide', 'Slide'], ['fade', 'Fade'], ['wipe', 'Wipe']])}</div>
          <div class="set-row"><span class="set-name">Brand colour<small>One colour for every overlay: the scoreboard's accent when set to Brand, and the first swatch in Canvas and Stream Desk</small></span><input type="color" data-set="brand" value="${esc(l.brand || '#e11d48')}" aria-label="Brand colour" class="brand-pick"></div>
        </div>
        <div class="set-group"><h4>Stacking order</h4><p class="note">When overlays overlap, the one at the top of this list sits in front. More overlays join this list as they’re added.</p>
          <div class="order-list">${stack.map((x, i) => `<div class="order-item" data-id="${x.id}"><span class="set-name">${esc(x.label)}</span><span class="order-btns"><button class="btn" type="button" data-set="stack-move" data-d="-1"${i === 0 ? ' disabled' : ''} aria-label="Move up">↑</button><button class="btn" type="button" data-set="stack-move" data-d="1"${i === stack.length - 1 ? ' disabled' : ''} aria-label="Move down">↓</button></span></div>`).join('')}</div></div></div>`);
    },
    people() {
      if (!people) return h('<div><h3>People</h3><p class="lead">Loading…</p></div>');
      const streamers = Hub.streamers;
      const TAB_NAMES = [['scoreboard', 'Live scoreboard'], ['canvas', 'Canvas'], ['desk', 'Stream Desk'], ['games', 'Chat Games'], ['challenges', 'Challenges'], ['media', 'Media Centre'], ['subathon', 'Subathon & Goals'], ['twitch', 'Twitch Centre']];
      const tabChecks = (name, chosen) => `<div class="checks">${TAB_NAMES.map(([v, l]) => `<label><input type="checkbox" name="${name}" value="${v}"${chosen.includes(v) ? ' checked' : ''}>${l}</label>`).join('')}</div>`;
      const checks = (name, chosen) => `<div class="checks">${streamers.map((x) => `<label><input type="checkbox" name="${name}" value="${x.id}"${chosen.includes(x.id) ? ' checked' : ''}>${esc(x.name)}</label>`).join('')}</div>`;
      const access = (name, val) => `<select class="select" name="${name}" aria-label="How long their access lasts">${ACCESS.map(([v, label]) => `<option value="${v}"${v === val ? ' selected' : ''}>${label}</option>`).join('')}</select>`;
      const reqs = people.requests.map((r) => `<div class="person" data-req="${r.id}"><div class="person-top"><b>${esc(r.username)}</b><small>${esc(r.device)}, asked ${when(r.at)}</small></div>
        <small class="note">Streamers they can run:</small>${checks(`rs-${r.id}`, streamers[0] ? [streamers[0].id] : [])}
        <small class="note">Tabs they can use:</small>${tabChecks(`rt-${r.id}`, TAB_NAMES.map((t) => t[0]).filter((t) => t !== 'twitch'))}
        <div class="person-actions">${access(`ra-${r.id}`, '24h')}<button class="btn btn-primary btn-small" type="button" data-set="req-accept">Accept</button><button class="btn btn-quiet btn-small" type="button" data-set="req-decline">Decline</button></div></div>`).join('');
      const list = people.people.map((p) => `<div class="person" data-person="${p.id}"><div class="person-top"><b>${esc(p.username)}</b><span class="pill${p.online ? ' is-on' : ''}">${p.online ? `Online: ${p.browsers} browser${p.browsers === 1 ? '' : 's'}, ${p.tabsOpen} tab${p.tabsOpen === 1 ? '' : 's'}` : `Last seen ${when(p.lastSeen)}`}</span><span class="pill">${left(p.expiresAt)}</span><span class="grow"></span>
        <button class="btn btn-quiet btn-small${confirming.get(`del|${p.id}`) ? ' is-confirming' : ''}" type="button" data-set="person-del">${confirming.get(`del|${p.id}`) ? 'Tap again' : 'Remove'}</button></div>
        <small class="note">Streamers they can run:</small>${checks(`ps-${p.id}`, p.streamers)}
        <small class="note">Tabs they can use:</small>${tabChecks(`pt-${p.id}`, p.tabs || ['scoreboard', 'canvas', 'desk', 'games'])}
        ${twBox(p)}
        ${p.online ? `<small class="note">${presence(p)}</small>` : ''}
        <div class="person-actions"><span class="note">Access:</span>${access(`pa-${p.id}`, '')}<button class="btn btn-small" type="button" data-set="person-access">Set</button>
        <span class="note">${p.devices.length ? '' : 'No devices signed in'}</span></div>
        ${p.devices.length ? `<div class="person-devices">${p.devices.map((d, i) => `<span class="device-chip">${esc(d.name)}<button class="btn btn-quiet btn-small" type="button" data-set="device-out" data-i="${i}">Sign out</button></span>`).join('')}</div>` : ''}</div>`).join('');
      const hist = people.signins.map((x) => `<li><time>${when(x.at)}</time><span${x.ok ? '' : ' class="bad"'}><b>${esc(x.username)}</b>${x.device ? `, ${esc(x.device)}` : ''}: ${esc(x.what)}</span></li>`).join('');
      return h(`<div>
        <h3>People</h3><p class="lead">Editors sign in with their name and the editor password, then wait for you. You choose how long their access lasts and which streamers they can run. Editors can only use the tabs you tick for them, and never see the OBS link, Links, Activity, Chat, People, settings or uploads.</p>
        ${people.editorPassSet ? '' : '<p class="tip" style="display:block">Set an editor password in Passwords first, so editors can ask for access.</p>'}
        <div class="set-group"><h4>Waiting for you${people.requests.length ? ` (${people.requests.length})` : ''}</h4>${reqs || '<p class="note">Nobody’s waiting. Requests not answered in 24 hours are declined by themselves.</p>'}</div>
        <div class="set-group"><h4>Editors</h4><div class="people-list">${list || '<p class="note">No editors yet.</p>'}</div></div>
        <div class="set-group"><h4>Sign-in history, last 30 days</h4><ol class="history">${hist || '<li>Nothing yet.</li>'}</ol></div></div>`);
    },
    passwords() {
      return h(`<div>
        <h3>Passwords</h3><p class="lead">The editor password is what editors type to ask for access; you still approve every new person and device. Your owner password signs you in here; the CONTROL_KEY set on Northflank always works too, so you can’t lock yourself out.</p>
        <form class="set-group" data-form="editor"><h4>Editor password</h4><div class="link-add"><input class="input" type="password" name="pass" minlength="6" autocomplete="new-password" placeholder="New editor password" aria-label="New editor password"><label class="check check-sm"><input type="checkbox" name="out"><span>Sign out all editors</span></label><button class="btn" type="submit">Save</button></div></form>
        <form class="set-group" data-form="owner"><h4>Owner password</h4><div class="link-add"><input class="input" type="password" name="pass" minlength="8" autocomplete="new-password" placeholder="New owner password" aria-label="New owner password"><span></span><button class="btn" type="submit">Save</button></div></form>
        <p class="field-error" data-msg role="status"></p></div>`);
    },
    backup() {
      const copy = (() => { try { return JSON.parse(localStorage.getItem('hub-backup') || '{}'); } catch (e) { return {}; } })();
      return h(`<div>
        <h3>Backup</h3><p class="lead">A backup holds overlays, teams, crests, looks, OBS links, tile names and links. People and passwords are never in a backup.</p>
        <div class="set-group"><h4>Download</h4><div class="person-actions"><button class="btn" type="button" data-set="backup-one">${esc(Hub.streamer.name)} only</button><button class="btn" type="button" data-set="backup-all">Everything</button></div></div>
        <div class="set-group"><h4>Restore from a file</h4><p class="note">Restoring one streamer keeps their name and OBS link. Restoring everything replaces every streamer.</p>
          <div class="person-actions"><label class="btn file-btn"><input class="sr-only" type="file" accept="application/json,.json" data-set="restore-file">Choose a backup file</label>
          ${seg('restore-scope', 'one', [['one', `Into ${esc(Hub.streamer.name)}`], ['all', 'Everything']])}</div></div>
        <div class="set-group"><h4>This device’s copy</h4><p class="note">The hub saves a copy of everything on this device every 10 minutes while you’re signed in as the owner. ${copy.at ? `Last saved ${when(copy.at)}.` : 'Nothing saved yet.'}</p>
          <div class="person-actions"><button class="btn" type="button" data-set="copy-now">Save a copy now</button>${copy.at ? '<button class="btn btn-quiet" type="button" data-set="copy-restore">Restore from it</button>' : ''}</div></div>
        <p class="field-error" data-msg role="status"></p></div>`);
    },
    storage() {
      if (!usage) return h('<div><h3>Storage and traffic</h3><p class="lead">Loading…</p></div>');
      const mb = (b) => `${(b / 1048576).toFixed(b < 10485760 ? 1 : 0)} MB`;
      const gb = (b) => `${(b / 1e9).toFixed(2)} GB`;
      const bar = (used, cap) => { const p = Math.min(100, (used / cap) * 100); return `<div class="meter${p >= 90 ? ' is-red' : p >= 70 ? ' is-amber' : ''}"><i style="width:${p}%"></i></div>`; };
      const tp = (usage.traffic.used / usage.traffic.cap) * 100;
      return h(`<div>
        <h3>Storage and traffic</h3><p class="lead">The hub keeps itself inside Northflank’s free plan: uploads stop at 700 MB, leaving the rest of the 1 GB volume free, and big files pause if a month’s traffic reaches 8 GB.</p>
        ${usage.disk ? `<div class="set-group"><h4>Server storage: ${mb(usage.disk.used)} of ${mb(usage.disk.cap)}</h4>${bar(usage.disk.used, usage.disk.cap)}<p class="note">Everything the hub keeps (uploads, crests and your setup) never goes over 900 MB.</p></div>` : ''}
        <div class="set-group"><h4>Uploads: ${mb(usage.uploads.used)} of ${mb(usage.uploads.cap)}</h4>${bar(usage.uploads.used, usage.uploads.cap)}
          <p class="note">Each streamer’s share is ${mb(usage.uploads.share)}.</p>
          ${usage.streamers.map((x) => `<div class="set-row"><span class="set-name">${esc(x.name)}<small>${x.files} file${x.files === 1 ? '' : 's'}</small></span><span>${mb(x.used)}</span></div>`).join('')}</div>
        <div class="set-group"><h4>Traffic in ${esc(usage.traffic.month)}: ${gb(usage.traffic.used)} of ${gb(usage.traffic.cap)}</h4>${bar(usage.traffic.used, usage.traffic.cap)}
          <p class="note">${tp >= 100 ? 'The budget is used up: big files are paused until the 1st of next month.' : tp >= 90 ? 'Over 90%: big files pause at 100% until the 1st.' : tp >= 70 ? 'Over 70% of this month’s budget.' : 'Plenty left this month. Scoreboard updates are tiny; pictures and music count most.'}</p></div>
        <div class="set-group"><h4>Limits</h4><div class="set-row"><span class="set-name">Devices connected now</span><span>${usage.limits.open} of ${usage.limits.connections}</span></div><div class="set-row"><span class="set-name">Streamers</span><span>up to ${usage.limits.streamers}</span></div></div>
        <button class="btn btn-small" type="button" data-set="usage-refresh">Refresh</button></div>`);
    },
    updating() {
      const live = Hub.streamers.filter((x) => x.live);
      return h(`<div>
        <h3>Updating</h3><p class="lead">Uploading a new version to GitHub makes Northflank restart the server for about a minute, and every streamer’s overlays drop out until it’s back. Update when nobody’s live.</p>
        <div class="safe-update${live.length ? ' is-live' : ''}"><i aria-hidden="true"></i><span>${live.length ? `Wait before updating: ${live.map((x) => esc(x.name)).join(', ')} ${live.length === 1 ? 'has' : 'have'} something on screen.` : 'Safe to update: nobody has anything on screen.'}</span></div>
        <p class="note" style="margin-top:12px">After an update, OBS overlays reload themselves. Hubs that are open show a Reload button.</p></div>`);
    },
  };

  /* ---------- Actions ---------- */
  const msg = (text, bad) => { const p = body.querySelector('[data-msg]'); if (p) { p.textContent = text; p.style.color = bad ? '' : 'var(--signal)'; } };
  async function act(fn, okText) {
    try { await fn(); if (okText) Hub.toast(okText, { tone: 'good' }); } catch (e) { msg(e.message, true); Hub.toast(e.message, { tone: 'bad' }); }
  }
  function patchTiles(tiles) { return act(() => Hub.call('PATCH', '/api/hub', { tiles })); }
  function patchStreamer(fields) { return act(() => Hub.call('PATCH', `/api/streamers/${Hub.streamer.id}`, fields)); }
  async function download(scope) {
    const url = scope === 'all' ? '/api/backup' : `/api/backup?streamer=${encodeURIComponent(Hub.streamer.id)}`;
    const data = await Hub.call('GET', url);
    const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `overlay-hub-${scope === 'all' ? 'everything' : Hub.streamer.name.replace(/[^\w-]+/g, '-')}-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  let restoreScope = 'one';

  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) { dialog.close(); return; }
    const navBtn = e.target.closest('[data-section]');
    if (navBtn) { open(navBtn.dataset.section); return; }
    const b = e.target.closest('[data-set]');
    if (!b || b.disabled || b.tagName === 'INPUT') return;
    const v = b.dataset.val;
    switch (b.dataset.set) {
      case 'close': dialog.close(); break;
      case 'theme': Hub.personal.set('theme', v); paint(); break;
      case 'big': Hub.personal.set('big', v === '1'); paint(); break;
      case 'vibrate': Hub.personal.set('vibrate', v === '1'); if (v === '1' && navigator.vibrate) navigator.vibrate(60); paint(); break;
      case 'tips': Object.keys(localStorage).filter((k) => k.startsWith('hub-tip-')).forEach((k) => localStorage.removeItem(k)); Hub.route(); Hub.toast('Tips are back on every page.'); break;
      case 'signout':
        fetch('/api/logout', { method: 'POST', headers: { Authorization: `Bearer ${Hub.token}` } }).finally(() => { localStorage.removeItem('hub-token'); location.reload(); });
        break;
      case 'tile-mode': patchTiles({ mode: v, order: Hub.hubSettings.tiles.order.length ? Hub.hubSettings.tiles.order : Hub.tiles.map((x) => x.id) }); break;
      case 'tile-move': {
        const ids = Array.from(body.querySelectorAll('.order-item')).map((x) => x.dataset.id);
        const i = ids.indexOf(b.closest('[data-id]').dataset.id);
        const j = i + Number(b.dataset.d);
        if (j < 0 || j >= ids.length) break;
        [ids[i], ids[j]] = [ids[j], ids[i]];
        patchTiles({ order: ids });
        break;
      }
      case 'look-font': patchStreamer({ look: { font: v } }); break;
      case 'look-corners': patchStreamer({ look: { corners: v } }); break;
      case 'look-anim': patchStreamer({ look: { anim: v } }); break;
      case 'stack-move': {
        const ids = (Hub.streamer.stack || []).slice();
        const i = ids.indexOf(b.closest('[data-id]').dataset.id);
        const j = i + Number(b.dataset.d);
        if (i < 0 || j < 0 || j >= ids.length) break;
        [ids[i], ids[j]] = [ids[j], ids[i]];
        patchStreamer({ stack: ids });
        break;
      }
      case 'req-accept': {
        const card = b.closest('[data-req]');
        const id = card.dataset.req;
        const streamers = Array.from(card.querySelectorAll(`input[name="rs-${id}"]:checked`)).map((x) => x.value);
        if (!streamers.length) { Hub.toast('Tick at least one streamer they can run.', { tone: 'bad' }); break; }
        const tabs = Array.from(card.querySelectorAll(`input[name="rt-${id}"]:checked`)).map((x) => x.value);
        if (!tabs.length) { Hub.toast('Tick at least one tab they can use.', { tone: 'bad' }); break; }
        const expires = card.querySelector(`select[name="ra-${id}"]`).value;
        act(() => Hub.call('POST', `/api/people/requests/${id}/accept`, { streamers, tabs, expires }), 'Approved. They’re in.').then(loadPeople);
        break;
      }
      case 'sys-refresh': loadSystem(); break;
      case 'sys-twitch': Hub.call('POST', '/api/system/retry-twitch').then((r) => { Hub.toast(r.note); setTimeout(loadSystem, 2500); }).catch((err) => Hub.toast(err.message, { tone: 'bad' })); break;
      case 'sys-resync': Hub.call('POST', '/api/system/resync').then((r) => Hub.toast(r.note)).catch((err) => Hub.toast(err.message, { tone: 'bad' })); break;
      case 'sys-verify': Hub.call('POST', '/api/system/verify').then((r) => Hub.toast(r.note, { tone: r.ok ? 'goal' : 'bad', ms: 9000 })).catch((err) => Hub.toast(err.message, { tone: 'bad' })); break;
      case 'sys-export': fetch('/api/system/export', { method: 'POST', headers: { Authorization: `Bearer ${Hub.token}` } }).then((r) => r.blob()).then((blob) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'overlay-hub-status.json'; a.click(); URL.revokeObjectURL(a.href); }); break;
      case 'sys-activity': downloadFile(`/api/streamers/${encodeURIComponent(Hub.streamer.id)}/activity.csv`, 'activity.csv'); break;
      case 'sys-beep': localStorage.setItem('hub-beep', localStorage.getItem('hub-beep') === '1' ? '0' : '1'); paint(); break;
      case 'sys-ack': Hub.call('POST', `/api/streamers/${encodeURIComponent(b.dataset.streamer)}/ops/notice-ack`, { id: b.dataset.id }).then(loadSystem).catch(() => {}); break;
      case 'tw-link': Hub.call('POST', '/api/twitch/link-me').then((r) => { location.href = r.url; }).catch((err) => Hub.toast(err.message, { tone: 'bad' })); break;
      case 'tw-unlink': Hub.call('POST', '/api/twitch/unlink-me').then(() => { Hub.toast('Unlinked your Twitch.'); loadMe(); }).catch((err) => Hub.toast(err.message, { tone: 'bad' })); break;
      case 'me-out': Hub.call('POST', `/api/me/devices/${b.dataset.i}/signout`).then(() => { Hub.toast('That device is signed out.'); loadMe(); }).catch((err) => Hub.toast(err.message, { tone: 'bad' })); break;
      case 'tw-copy': navigator.clipboard.writeText(tw.redirect).then(() => Hub.toast('Copied the redirect address.')).catch(() => Hub.toast(tw.redirect, { ms: 9000 })); break;
      case 'tw-connect': Hub.call('POST', '/api/twitch/connect', { streamer: Hub.streamer.id }).then((r) => { location.href = r.url; }).catch((err) => Hub.toast(err.message, { tone: 'bad' })); break;
      case 'tw-disconnect':
        if (Date.now() - twArmed > 4000) { twArmed = Date.now(); paint(); setTimeout(() => { if (section === 'twitch') paint(); }, 4100); break; }
        twArmed = 0;
        Hub.call('POST', '/api/twitch/disconnect', { streamer: Hub.streamer.id }).then(() => { Hub.toast('Twitch disconnected.'); loadTwitch(); }).catch((err) => Hub.toast(err.message, { tone: 'bad' }));
        break;
      case 'device-out': {
        const card = b.closest('[data-person]');
        act(() => Hub.call('POST', `/api/people/${card.dataset.person}/devices/${b.dataset.i}/signout`), 'That device is signed out.').then(loadPeople);
        break;
      }
      case 'req-decline': act(() => Hub.call('POST', `/api/people/requests/${b.closest('[data-req]').dataset.req}/decline`), 'Declined').then(loadPeople); break;
      case 'person-access': {
        const card = b.closest('[data-person]');
        const expires = card.querySelector(`select[name="pa-${card.dataset.person}"]`).value;
        act(() => Hub.call('PATCH', `/api/people/${card.dataset.person}`, { expires }), 'Access updated').then(loadPeople);
        break;
      }
      case 'person-del': {
        const id = b.closest('[data-person]').dataset.person;
        if (!confirming.get(`del|${id}`)) { confirming.set(`del|${id}`, true); setTimeout(() => { confirming.delete(`del|${id}`); paint(); }, 3200); paint(); break; }
        confirming.delete(`del|${id}`);
        act(() => Hub.call('DELETE', `/api/people/${id}`), 'Removed. They’re locked out now.').then(loadPeople);
        break;
      }
      case 'usage-refresh': loadUsage(); break;
      case 'backup-one': act(() => download('one')); break;
      case 'backup-all': act(() => download('all')); break;
      case 'restore-scope': restoreScope = v; body.querySelectorAll('[data-set="restore-scope"]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); break;
      case 'copy-now': act(() => Hub.saveDeviceCopy(), 'Copy saved on this device').then(paint); break;
      case 'copy-restore': {
        if (!confirming.get('copy-restore')) { confirming.set('copy-restore', true); b.textContent = 'Tap again to replace everything'; setTimeout(() => confirming.delete('copy-restore'), 3200); break; }
        confirming.delete('copy-restore');
        act(() => Hub.call('POST', '/api/restore', { backup: JSON.parse(localStorage.getItem('hub-backup') || '{}') }), 'Everything restored from this device’s copy');
        break;
      }
      default: break;
    }
  });
  // Streamer ticks and tile names save as soon as they change
  dialog.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.set === 'brand') { patchStreamer({ look: { brand: t.value } }); return; }
    if (t.dataset.set === 'tile-name') {
      const names = Object.assign({}, Hub.hubSettings.tiles.names);
      names[t.closest('[data-id]').dataset.id] = t.value;
      patchTiles({ names });
    } else if (t.name && t.name.startsWith('ps-')) {
      const card = t.closest('[data-person]');
      const streamers = Array.from(card.querySelectorAll(`input[name="${t.name}"]:checked`)).map((x) => x.value);
      act(() => Hub.call('PATCH', `/api/people/${card.dataset.person}`, { streamers }), 'Streamers updated').then(loadPeople);
    } else if (t.name && (t.name.startsWith('twp-') || t.name.startsWith('twc-'))) {
      const card = t.closest('[data-person]');
      const body = t.name.startsWith('twp-') ? { tw: { preset: t.value } } : { tw: { preset: 'custom', perms: Array.from(card.querySelectorAll(`input[name="${t.name}"]:checked`)).map((x) => x.value) } };
      act(() => Hub.call('PATCH', `/api/people/${card.dataset.person}`, body), 'Twitch Centre access updated. It changes on their screen straight away.').then(loadPeople);
    } else if (t.name && t.name.startsWith('pt-')) {
      const card = t.closest('[data-person]');
      const tabs = Array.from(card.querySelectorAll(`input[name="${t.name}"]:checked`)).map((x) => x.value);
      if (!tabs.length) { t.checked = true; Hub.toast('Leave at least one tab ticked. To stop someone completely, use Remove.', { tone: 'bad' }); return; }
      act(() => Hub.call('PATCH', `/api/people/${card.dataset.person}`, { tabs }), 'Tabs updated. It changes on their screen straight away.').then(loadPeople);
    } else if (t.dataset.set === 'restore-file' && t.files && t.files[0]) {
      const file = t.files[0];
      t.value = '';
      file.text().then((text) => {
        let backup;
        try { backup = JSON.parse(text); } catch (err) { msg('That file isn’t a backup.', true); return; }
        act(() => Hub.call('POST', '/api/restore', restoreScope === 'all' ? { backup } : { backup, streamer: Hub.streamer.id }), restoreScope === 'all' ? 'Everything restored' : `${Hub.streamer.name} restored`);
      });
    }
  });
  dialog.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    const pass = f.querySelector('[name="pass"]').value;
    const payload = f.dataset.form === 'editor' ? { editor: pass, signOutEditors: !!(f.querySelector('[name="out"]') || {}).checked } : { owner: pass };
    act(() => Hub.call('POST', '/api/passwords', payload).then(() => f.reset()), f.dataset.form === 'editor' ? 'Editor password saved' : 'Owner password saved');
  });

  window.Settings = { open, refresh };
})();
