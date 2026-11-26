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
    { id: 'passwords', name: 'Passwords', owner: true },
    { id: 'backup', name: 'Backup', owner: true },
    { id: 'storage', name: 'Storage and traffic', owner: true },
    { id: 'updating', name: 'Updating', owner: true },
  ];
  const THEMES = [
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
  const when = (t) => (t ? new Date(t).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'never');
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
    paint();
  }
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
    body.replaceChildren(h(`<button class="btn btn-quiet btn-small settings-close" type="button" data-set="close">Done</button>`), ...[RENDER[section]()]);
  }

  const RENDER = {
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
        </div>
        <div class="set-group"><h4>Stacking order</h4><p class="note">When overlays overlap, the one at the top of this list sits in front. More overlays join this list as they’re added.</p>
          <div class="order-list">${stack.map((x, i) => `<div class="order-item" data-id="${x.id}"><span class="set-name">${esc(x.label)}</span><span class="order-btns"><button class="btn" type="button" data-set="stack-move" data-d="-1"${i === 0 ? ' disabled' : ''} aria-label="Move up">↑</button><button class="btn" type="button" data-set="stack-move" data-d="1"${i === stack.length - 1 ? ' disabled' : ''} aria-label="Move down">↓</button></span></div>`).join('')}</div></div></div>`);
    },
    people() {
      if (!people) return h('<div><h3>People</h3><p class="lead">Loading…</p></div>');
      const streamers = Hub.streamers;
      const checks = (name, chosen) => `<div class="checks">${streamers.map((x) => `<label><input type="checkbox" name="${name}" value="${x.id}"${chosen.includes(x.id) ? ' checked' : ''}>${esc(x.name)}</label>`).join('')}</div>`;
      const access = (name, val) => `<select class="select" name="${name}" aria-label="How long their access lasts">${ACCESS.map(([v, label]) => `<option value="${v}"${v === val ? ' selected' : ''}>${label}</option>`).join('')}</select>`;
      const reqs = people.requests.map((r) => `<div class="person" data-req="${r.id}"><div class="person-top"><b>${esc(r.username)}</b><small>${esc(r.device)}, asked ${when(r.at)}</small></div>
        ${checks(`rs-${r.id}`, streamers[0] ? [streamers[0].id] : [])}
        <div class="person-actions">${access(`ra-${r.id}`, '24h')}<button class="btn btn-primary btn-small" type="button" data-set="req-accept">Accept</button><button class="btn btn-quiet btn-small" type="button" data-set="req-decline">Decline</button></div></div>`).join('');
      const list = people.people.map((p) => `<div class="person" data-person="${p.id}"><div class="person-top"><b>${esc(p.username)}</b><span class="pill${p.online ? ' is-on' : ''}">${p.online ? 'Online now' : `Last seen ${when(p.lastSeen)}`}</span><span class="pill">${left(p.expiresAt)}</span><span class="grow"></span>
        <button class="btn btn-quiet btn-small${confirming.get(`del|${p.id}`) ? ' is-confirming' : ''}" type="button" data-set="person-del">${confirming.get(`del|${p.id}`) ? 'Tap again' : 'Remove'}</button></div>
        <small class="note">Streamers they can run:</small>${checks(`ps-${p.id}`, p.streamers)}
        <div class="person-actions"><span class="note">Access:</span>${access(`pa-${p.id}`, '')}<button class="btn btn-small" type="button" data-set="person-access">Set</button>
        <span class="note">${p.devices.map((d) => esc(d.name)).join(', ') || 'No devices signed in'}</span></div></div>`).join('');
      const hist = people.signins.map((x) => `<li><time>${when(x.at)}</time><span${x.ok ? '' : ' class="bad"'}><b>${esc(x.username)}</b>${x.device ? `, ${esc(x.device)}` : ''}: ${esc(x.what)}</span></li>`).join('');
      return h(`<div>
        <h3>People</h3><p class="lead">Editors sign in with their name and the editor password, then wait for you. You choose how long their access lasts and which streamers they can run. Editors can run overlays, but not Links, Activity, People, settings or uploads.</p>
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
        const expires = card.querySelector(`select[name="ra-${id}"]`).value;
        act(() => Hub.call('POST', `/api/people/requests/${id}/accept`, { streamers, expires }), 'Approved. They’re in.').then(loadPeople);
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
    if (t.dataset.set === 'tile-name') {
      const names = Object.assign({}, Hub.hubSettings.tiles.names);
      names[t.closest('[data-id]').dataset.id] = t.value;
      patchTiles({ names });
    } else if (t.name && t.name.startsWith('ps-')) {
      const card = t.closest('[data-person]');
      const streamers = Array.from(card.querySelectorAll(`input[name="${t.name}"]:checked`)).map((x) => x.value);
      act(() => Hub.call('PATCH', `/api/people/${card.dataset.person}`, { streamers }), 'Streamers updated');
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
