/*
  The Canvas page in the hub. Draw straight onto the preview (pen, arrows, eraser, laser, spotlight), add pictures,
  web pages, YouTube, text, QR codes and a tactics pitch, play music, and save boards to bring back later.
  Editors can use everything already in the library; only the owner uploads or deletes files.
*/
(() => {
  'use strict';
  const Hub = window.Hub;
  const X = window.ExtrasModel;
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const COLOURS = ['#ff3b5c', '#ffd166', '#2ee59d', '#38bdf8', '#ffffff', '#111827'];
  const NAMES = { image: 'Picture', web: 'Web page', youtube: 'YouTube', text: 'Text', qr: 'QR code', pitch: 'Tactics pitch' };
  const POS_NAMES = { tl: 'Top left', tc: 'Top middle', tr: 'Top right', ml: 'Middle left', mc: 'Middle', mr: 'Middle right', bl: 'Bottom left', bc: 'Bottom middle', br: 'Bottom right' };
  let live = null;
  let tool = '';
  let colour = COLOURS[0];
  let fade = false;
  let media = [];
  let playlistMB = 0;

  const ctl = Hub.module('canvas', {
    patchable: ['items', 'strokes', 'ink', 'spot', 'music', 'boards'],
    onState(s) { live = s; sync(); },
    isShowing: (s) => s.items.some((i) => i.vis === 'live') || (s.ink === 'live' && s.strokes.length > 0) || s.spot.on || s.music.playing,
    liveCount: (s) => s.items.filter((i) => i.vis === 'live').length + (s.ink === 'live' && s.strokes.length ? 1 : 0),
    tileSummary(s) {
      const on = s.items.filter((i) => i.vis === 'live').length;
      return { text: on ? `${on} on screen` : 'Nothing on screen', small: s.music.playing ? 'Music playing' : s.ink === 'live' && s.strokes.length ? 'Drawing on screen' : '' };
    },
    onDrag(id, x, y) { const it = live && live.items.find((i) => i.id === id); if (it) { it.x = x; it.y = y; commit(); } },
  });
  const commit = () => ctl.commit();

  /* ---------- Drawing on the preview ---------- */
  const viewport = $('viewport');
  const layer = document.createElement('div');
  layer.className = 'draw-layer';
  layer.hidden = true;
  viewport.appendChild(layer);
  const toStage = (e) => {
    const r = ctl.view.el.root.getBoundingClientRect();
    return [Math.round(((e.clientX - r.left) / r.width) * 1920), Math.round(((e.clientY - r.top) / r.height) * 1080)];
  };
  let drawing = null;
  let lastLaser = 0;
  const sendLaser = (on, p) => {
    const now = Date.now();
    if (on && now - lastLaser < 45) return;
    lastLaser = now;
    Hub.raw({ type: 'laser', streamer: Hub.streamer.id, on, x: p ? p[0] : 0, y: p ? p[1] : 0 });
    ctl.view.laser(on, p ? p[0] : 0, p ? p[1] : 0);
  };
  layer.addEventListener('pointerdown', (e) => {
    if (!live) return;
    layer.setPointerCapture(e.pointerId);
    const p = toStage(e);
    if (tool === 'pen' || tool === 'arrow') { drawing = { id: X.newId(), c: colour, w: Number($('cvWidth').value), pts: [p], arrow: tool === 'arrow', fade, t: Date.now() }; ctl.view.drawing(drawing); }
    else if (tool === 'eraser') eraseAt(p);
    else if (tool === 'laser') sendLaser(true, p);
    else if (tool === 'spot') { live.spot = { on: true, x: p[0], y: p[1], r: live.spot.r }; commit(); }
  });
  layer.addEventListener('pointermove', (e) => {
    const p = toStage(e);
    if (drawing) {
      const last = drawing.pts[drawing.pts.length - 1];
      if (Math.hypot(p[0] - last[0], p[1] - last[1]) > 4 && drawing.pts.length < 400) { drawing.pts.push(p); ctl.view.drawing(drawing); }
    } else if (tool === 'laser' && e.buttons) sendLaser(true, p);
    else if (tool === 'eraser' && e.buttons) eraseAt(p);
  });
  const finish = () => {
    if (drawing) {
      if (drawing.pts.length) { drawing.t = Date.now(); live.strokes = live.strokes.concat(drawing).slice(-200); commit(); }
      drawing = null;
      ctl.view.drawing(null);
    }
    if (tool === 'laser') sendLaser(false);
  };
  layer.addEventListener('pointerup', finish);
  layer.addEventListener('pointercancel', finish);
  function eraseAt(p) {
    const hit = live.strokes.find((st) => st.pts.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < Math.max(18, st.w * 1.5)));
    if (hit) { live.strokes = live.strokes.filter((x) => x !== hit); commit(); }
  }
  const setTool = (t) => {
    tool = tool === t ? '' : t;
    layer.hidden = !tool || !document.getElementById('viewCanvas') || document.getElementById('viewCanvas').hidden;
    document.querySelectorAll('[data-cv="tool"]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.val === tool)));
  };
  window.addEventListener('hashchange', () => { if (location.hash !== '#canvas') { tool = ''; layer.hidden = true; document.querySelectorAll('[data-cv="tool"]').forEach((b) => b.setAttribute('aria-pressed', 'false')); } });

  /* ---------- Adding things ---------- */
  function add(type) {
    const text = $('cvText').value.trim();
    if (['web', 'youtube', 'qr'].includes(type) && !text) { Hub.toast('Paste the link into the box first.', { tone: 'bad' }); return; }
    if (type === 'text' && !text) { Hub.toast('Type the text first.', { tone: 'bad' }); return; }
    const url = /^https?:\/\//i.test(text) ? text : `https://${text}`;
    // New things start hidden: place them in the preview first, then press Show
    const it = X.canvasItem({ type, vis: 'preview', x: type === 'qr' ? 1700 : 960, y: type === 'qr' ? 880 : 540, scale: 1, z: live.items.length + 1, src: type === 'text' ? '' : type === 'qr' ? text : url, text: type === 'text' ? text : '' });
    live.items = live.items.concat(it);
    $('cvText').value = '';
    commit();
  }
  function addImage(id) {
    live.items = live.items.concat(X.canvasItem({ type: 'image', vis: 'preview', src: id, x: 960, y: 540, scale: 1, z: live.items.length + 1 }));
    commit();
  }

  /* ---------- Painting the page ---------- */
  function sync() {
    if (!live) return;
    const ink = document.getElementById('cvInk');
    if (ink._v !== live.ink) { ink._v = live.ink; ink.innerHTML = `<span class="cv-ink-name">Your drawing</span>${Hub.visButtons(live.ink)}`; }
    document.querySelector('[data-cv="fade"]').setAttribute('aria-pressed', String(fade));
    document.querySelector('[data-cv="music"][data-val="loop"]').setAttribute('aria-pressed', String(live.music.loop));
    if (document.activeElement !== $('cvVol')) $('cvVol').value = String(live.music.vol);
    const rows = live.items.map((it) => {
      const label = it.type === 'image' ? ((media.find((m) => m.id === it.src) || {}).name || 'Picture') : it.type === 'text' ? it.text : it.type === 'pitch' ? '' : it.src;
      const left = it.until ? Math.max(0, Math.round((it.until - Date.now()) / 1000)) : 0;
      return `<div class="cv-row is-item" data-id="${it.id}"><span class="cv-name">${NAMES[it.type]}<small>${esc(label)}${left ? `, turns off in ${left} s` : ''}</small></span>
        ${Hub.visButtons(it.vis)}
        <span class="cv-ctl">${it.type === 'text' ? `<label class="dk-inline">Colour <input type="color" data-cv="item-color" value="${it.color}" aria-label="Text colour"></label>` : ''}<label class="dk-inline dk-size">Size <input type="range" min="20" max="300" step="5" data-cv="item-scale" value="${Math.round(it.scale * 100)}"></label>
        <select class="select" data-cv="item-timer" aria-label="Turn off after"><option value="0">No timer</option><option value="10">Off after 10 s</option><option value="30">Off after 30 s</option><option value="60">Off after 1 min</option><option value="300">Off after 5 min</option></select>
        <button class="btn btn-quiet btn-small" type="button" data-cv="item-up" aria-label="Bring to the front">↑</button>
        <button class="btn btn-quiet btn-small" type="button" data-cv="item-del" aria-label="Remove">×</button></span></div>`;
    }).join('');
    const box = $('cvItems');
    if (box._html !== rows) { box._html = rows; box.innerHTML = rows || '<p class="note">Nothing added yet.</p>'; }
    const boards = live.boards.map((b) => `<div class="scene" data-id="${b.id}"><span>${esc(b.name)}</span><button class="btn btn-small" type="button" data-cv="board-load">Load</button><button class="btn btn-quiet btn-small" type="button" data-cv="board-del" aria-label="Delete board">×</button></div>`).join('');
    if ($('cvBoards')._html !== boards) { $('cvBoards')._html = boards; $('cvBoards').innerHTML = boards || '<p class="note">No saved boards yet.</p>'; }
    paintLibrary();
  }
  function paintLibrary() {
    const owner = Hub.role === 'owner';
    const mb = (b) => `${(b / 1048576).toFixed(1)} MB`;
    const songs = media.filter((m) => m.kind === 'audio');
    const used = songs.reduce((n, m) => n + m.size, 0);
    $('cvLibNote').textContent = owner ? `Pictures up to 8 MB, MP3s up to 30 MB. Songs use ${mb(used)} of the ${playlistMB} MB playlist.` : 'You can use anything in the library. Only the owner can add or remove files.';
    const html = media.map((m) => `<div class="cv-row" data-id="${m.id}"><span class="cv-name">${esc(m.name)}<small>${m.kind === 'audio' ? 'Song' : 'Picture'}, ${mb(m.size)}${m.pinned ? ', pinned' : ''}${owner ? '' : ' <span class="lock">(locked)</span>'}</small></span><span class="cv-ctl">
      ${m.kind === 'audio' ? `<button class="btn btn-small" type="button" data-cv="lib-play">${live && live.music.playing && live.music.id === m.id ? 'Playing' : 'Play'}</button>` : '<button class="btn btn-small" type="button" data-cv="lib-add">Add</button>'}
      ${owner ? `<button class="btn btn-quiet btn-small" type="button" data-cv="lib-pin">${m.pinned ? 'Unpin' : 'Pin'}</button><button class="btn btn-quiet btn-small" type="button" data-cv="lib-del" aria-label="Delete file">×</button>` : ''}</span></div>`).join('');
    if ($('cvLib')._html !== html) { $('cvLib')._html = html; $('cvLib').innerHTML = html || '<p class="note">The library is empty.</p>'; }
    if (document.activeElement !== $('cvLimit')) $('cvLimit').value = String(playlistMB || '');
  }
  window.addEventListener('hub-media', (e) => { media = e.detail.list; playlistMB = e.detail.playlistMB; paintLibrary(); });
  $('cvColours').innerHTML = '<button type="button" data-cv="colour" data-val="brand" style="background:var(--brand)" aria-label="Brand colour" title="Brand colour"></button>' + COLOURS.map((c) => `<button type="button" data-cv="colour" data-val="${c}" style="background:${c}" aria-label="Colour ${c}" aria-pressed="${c === colour}"></button>`).join('')
    + '<input type="color" id="cvCustom" value="#ff3b5c" aria-label="Any colour">';
  // Any colour for the pen
  $('cvCustom').addEventListener('input', (e) => { colour = e.target.value; document.querySelectorAll('[data-cv="colour"]').forEach((x) => x.setAttribute('aria-pressed', 'false')); });

  /* ---------- Clicks and changes ---------- */
  document.getElementById('viewCanvas').addEventListener('click', (e) => {
    const vb = e.target.closest('[data-vis]');
    if (vb && live) {
      const row = vb.closest('[data-id]');
      if (vb.closest('#cvInk')) live.ink = vb.dataset.vis;
      else if (row) { const it = live.items.find((x) => x.id === row.dataset.id); if (it) { it.vis = vb.dataset.vis; if (it.vis !== 'off' && it.until && it.until < Date.now()) it.until = 0; } }
      commit();
      return;
    }
    const b = e.target.closest('[data-cv]');
    if (!b || !live || b.tagName === 'SELECT') return;
    const v = b.dataset.val;
    const row = b.closest('[data-id]');
    const item = row && live.items.find((x) => x.id === row.dataset.id);
    switch (b.dataset.cv) {
      case 'tool': setTool(v); break;
      case 'colour': colour = v === 'brand' ? ((Hub.streamer.look || {}).brand || '#e11d48') : v; document.querySelectorAll('[data-cv="colour"]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.val === v))); break;
      case 'fade': fade = !fade; sync(); break;
      case 'undo': live.strokes = live.strokes.slice(0, -1); commit(); break;
      case 'clear': { const done = Hub.remember('canvas', 'Drawing cleared.'); live.strokes = []; commit(); done(); break; }
      case 'spot-off': live.spot = Object.assign({}, live.spot, { on: false }); commit(); break;
      case 'add': add(b.dataset.type); break;
      case 'item-up': if (item) { item.z = Math.max(...live.items.map((x) => x.z)) + 1; commit(); } break;
      case 'item-del': if (item) { const done = Hub.remember('canvas', `${NAMES[item.type]} removed.`); live.items = live.items.filter((x) => x !== item); commit(); done(); } break;
      case 'board-load': { const bd = live.boards.find((x) => x.id === row.dataset.id); if (bd) { live.items = bd.items.map((x) => Object.assign({}, x)); live.strokes = bd.strokes.map((x) => Object.assign({}, x)); commit(); Hub.toast(`Loaded ${bd.name}`); } break; }
      case 'board-del': { const done = Hub.remember('canvas', 'Board deleted.'); live.boards = live.boards.filter((x) => x.id !== row.dataset.id); commit(); done(); break; }
      case 'lib-add': addImage(row.dataset.id); break;
      case 'lib-play': live.music = Object.assign({}, live.music, { id: row.dataset.id, playing: true, at: Date.now() }); commit(); break;
      case 'lib-pin': { const m = media.find((x) => x.id === row.dataset.id); if (m) Hub.call('PATCH', `/api/media/${m.id}`, { pinned: !m.pinned }).catch((err) => Hub.toast(err.message, { tone: 'bad' })); break; }
      case 'lib-del':
        if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = 'Sure?'; setTimeout(() => { b.dataset.sure = ''; b.textContent = '×'; }, 3000); break; }
        Hub.call('DELETE', `/api/media/${row.dataset.id}`).then(() => { if (live.music.id === row.dataset.id) { live.music = Object.assign({}, live.music, { playing: false }); commit(); } }).catch((err) => Hub.toast(err.message, { tone: 'bad' }));
        break;
      case 'music': {
        const songs = media.filter((m) => m.kind === 'audio');
        if (v === 'play') { const id = live.music.id || (songs[0] && songs[0].id); if (!id) { Hub.toast('Add an MP3 to the library first.', { tone: 'bad' }); break; } live.music = Object.assign({}, live.music, { id, playing: true, at: Date.now() }); }
        if (v === 'pause') live.music = Object.assign({}, live.music, { playing: false });
        if (v === 'next' && songs.length) { const i = songs.findIndex((m) => m.id === live.music.id); live.music = Object.assign({}, live.music, { id: songs[(i + 1) % songs.length].id, playing: true, at: Date.now() }); }
        if (v === 'loop') live.music = Object.assign({}, live.music, { loop: !live.music.loop });
        commit();
        break;
      }
      default: break;
    }
  });
  document.getElementById('viewCanvas').addEventListener('change', (e) => {
    const t = e.target;
    if (!live) return;
    const row = t.closest('[data-id]');
    const item = row && live.items.find((x) => x.id === row.dataset.id);
    if (t.dataset.cv === 'item-scale' && item) { item.scale = Number(t.value) / 100; commit(); }
    if (t.dataset.cv === 'item-color' && item) { item.color = t.value; commit(); }
    if (t.dataset.cv === 'item-timer' && item) { item.until = Number(t.value) ? Date.now() + Number(t.value) * 1000 : 0; commit(); }
    if (t.id === 'cvVol') { live.music = Object.assign({}, live.music, { vol: Number(t.value) }); commit(); }
    if (t.id === 'cvLimit') Hub.call('POST', `/api/streamers/${Hub.streamer.id}/playlist`, { mb: Number(t.value) }).catch((err) => Hub.toast(err.message, { tone: 'bad' }));
    if (t.id === 'cvFile' && t.files && t.files[0]) upload(t.files[0]).finally(() => { t.value = ''; });
  });
  async function upload(file) {
    const msg = $('cvUploadMsg');
    if (!$('cvRights').checked) { msg.textContent = 'Tick that you have the right to use this first. Music and pictures can be copyrighted on stream.'; return; }
    msg.textContent = `Uploading ${file.name}…`;
    try {
      const res = await fetch(`/api/media?streamer=${encodeURIComponent(Hub.streamer.id)}&name=${encodeURIComponent(file.name.replace(/\.\w+$/, ''))}&rights=1`, { method: 'POST', headers: { Authorization: `Bearer ${Hub.token}`, 'Content-Type': 'application/octet-stream' }, body: file });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'That upload didn’t work.');
      msg.textContent = '';
      Hub.toast(`Added ${data.media.name} to the library`, { tone: 'good' });
    } catch (err) { msg.textContent = err.message; }
  }
  $('cvBoardForm').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!live) return;
    if (live.boards.length >= 10) { Hub.toast('That’s 10 boards, the most there can be. Delete one first.', { tone: 'bad' }); return; }
    live.boards = live.boards.concat({ id: X.newId(), name: $('cvBoardName').value.trim() || `Board ${live.boards.length + 1}`, items: live.items, strokes: live.strokes });
    $('cvBoardName').value = '';
    commit();
  });
  setInterval(() => { if (live && live.items.some((i) => i.until)) sync(); }, 1000);
})();
