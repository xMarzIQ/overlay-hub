/*
  Media Centre in the hub: the music player and queue, playlists, soundboard, slideshows, sponsor rotation, GIFs,
  the mixer, the asset library and storage. Everything uses the same uploaded files (never a second copy).
  Uploading, renaming, deleting and storage are owner-only; sounds only play when someone presses them.
*/
(() => {
  'use strict';
  const Hub = window.Hub;
  const X = window.ExtrasModel;
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const PRESETS = [['', 'Move to…'], ['240,150', 'Top left'], ['960,150', 'Top'], ['1680,150', 'Top right'], ['240,540', 'Left'], ['960,540', 'Centre'], ['1680,540', 'Right'], ['240,930', 'Bottom left'], ['960,930', 'Bottom'], ['1680,930', 'Bottom right']];
  const clock = (s) => { s = Math.max(0, Math.floor(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const mb = (b) => `${(b / 1048576).toFixed(b < 10485760 ? 1 : 0)} MB`;
  let live = null;
  let media = [];
  const armed = {};
  const lastPlay = {};
  const cards = document.getElementById('mdCards');
  const openCards = new Set(JSON.parse(localStorage.getItem('md-open') || '["music","sounds"]'));
  // Every dropdown remembers being open, including each slideshow, GIF and playlist inside the sections
  const foldKey = (d) => (d.dataset && (d.dataset.id || d.dataset.key || (d.dataset.pl ? `pl${d.dataset.pl}` : ''))) || '';
  const keepOpen = (k) => { openCards.add(k); localStorage.setItem('md-open', JSON.stringify(Array.from(openCards))); };
  cards.addEventListener('toggle', (e) => { const k = foldKey(e.target); if (!k) return; if (e.target.open) openCards.add(k); else openCards.delete(k); localStorage.setItem('md-open', JSON.stringify(Array.from(openCards))); }, true);
  const lib = { q: '', type: 'all', sort: 'new', cat: '' };

  const ctl = Hub.module('media', {
    patchable: ['mixer', 'music', 'playlists', 'sounds', 'overlap', 'fire', 'stopSeq', 'shows', 'sponsor', 'gifs', 'hist'],
    onState(s) { live = s; paint(); },
    isShowing: (s) => s.music.playing || s.shows.some((x) => x.vis === 'live') || s.gifs.some((x) => x.vis === 'live') || s.sponsor.vis === 'live',
    liveCount: (s) => s.shows.filter((x) => x.vis === 'live').length + s.gifs.filter((x) => x.vis === 'live').length + (s.sponsor.vis === 'live' ? 1 : 0),
    tileSummary(s) {
      const now = s.music.playing ? nameOf(s.music.q[s.music.i]) : '';
      return { text: now ? `Playing: ${now}` : 'Music stopped', small: `${media.length} files, ${s.sounds.length} sounds` };
    },
    onDrag(id, x, y) {
      const [kind, key] = id.split(':');
      const it = kind === 'show' ? live.shows.find((z) => z.id === key) : kind === 'gif' ? live.gifs.find((z) => z.id === key) : kind === 'sponsor' ? live.sponsor : null;
      if (it) { it.x = x; it.y = y; ctl.commit(); }
    },
    visItems: (s) => s.shows.map((x) => [`show:${x.id}`, x]).concat(s.gifs.map((x) => [`gif:${x.id}`, x]), [['sponsor', s.sponsor]]),
  });
  const commit = () => ctl.commit();
  const redraw = () => { cards._html = ''; paint(); };
  const arm = (key) => { if (Date.now() - (armed[key] || 0) < 4000) { delete armed[key]; return true; } armed[key] = Date.now(); redraw(); setTimeout(redraw, 4100); return false; };
  const armedText = (key, text) => (Date.now() - (armed[key] || 0) < 4000 ? 'Tap again' : text);
  const owner = () => Hub.role === 'owner';
  const isGif = (m) => m && m.kind === 'image' && m.ext === 'gif';
  const nameOf = (id) => { const m = media.find((x) => x.id === id); return m ? m.name : '(file gone)'; };
  const btn = (act, label, extra = '', cls = '') => `<button type="button" class="btn btn-small ${cls}" data-md="${act}" ${extra}>${label}</button>`;
  const toggle = (act, on, label) => `<button type="button" class="btn btn-small ch-tog" data-md="${act}" aria-pressed="${!!on}">${label}: ${on ? 'On' : 'Off'}</button>`;
  const pickList = (kind, chosen, act) => {
    const list = media.filter((m) => (kind === 'audio' ? m.kind === 'audio' : kind === 'gif' ? isGif(m) : m.kind === 'image' && !isGif(m)));
    if (!list.length) return `<p class="note">No ${kind === 'audio' ? 'MP3s' : kind === 'gif' ? 'GIFs' : 'pictures'} uploaded yet. ${owner() ? 'Upload them in the Library below.' : 'Ask the owner to upload some.'}</p>`;
    return `<div class="md-pick">${list.map((m) => `<button type="button" class="md-chip${chosen.includes(m.id) ? ' is-on' : ''}" data-md="${act}" data-media="${m.id}" title="${esc(m.name)}">${m.kind === 'image' ? `<img src="/media/${m.id}" alt="">` : '♪'}<span>${esc(m.name)}</span></button>`).join('')}</div>`;
  };
  const look = (key, it) => `<div class="dk-look"><label class="dk-inline dk-size">Size <input type="range" min="20" max="250" step="5" data-md-in="scale" data-key="${key}" value="${Math.round(it.scale * 100)}"${it.lock ? ' disabled' : ''}></label><button type="button" class="btn btn-small lock-btn" data-md="lock" data-key="${key}" aria-pressed="${!!it.lock}">${it.lock ? 'Locked' : 'Lock position'}</button><select class="select preset" data-md-in="preset" data-key="${key}"${it.lock ? ' disabled' : ''}>${PRESETS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></div>`;
  const vis = (key, it) => Hub.visButtons(it.vis, ` data-key="${key}"`);

  // Which overlays, playlists and sounds use each file, so nothing gets deleted by surprise
  function usedIn(id) {
    const out = [];
    const cv = Hub.stateOf && Hub.stateOf('canvas');
    if (cv && cv.items.some((i) => i.src === id)) out.push('Canvas');
    if (live) {
      if (live.music.q.includes(id)) out.push('Music queue');
      live.playlists.forEach((p) => { if (p.ids.includes(id)) out.push(`Playlist “${p.name}”`); });
      live.sounds.forEach((x) => { if (x.media === id) out.push(`Sound “${x.name || nameOf(id)}”`); });
      live.shows.forEach((x) => { if (x.ids.includes(id)) out.push(`Slideshow “${x.name}”`); });
      if (live.sponsor.items.some((x) => x.media === id)) out.push('Sponsors');
      if (live.gifs.some((x) => x.media === id)) out.push('GIFs');
    }
    return out;
  }

  /* ---------- Sections ---------- */
  function musicCard() {
    const mu = live.music;
    const id = mu.q[mu.i];
    const queue = mu.q.map((t, k) => `<div class="ch-row" data-k="${k}"><span class="ch-led${k === mu.i ? ' md-now' : ''}">${k === mu.i ? '▶ ' : ''}${esc(nameOf(t))}</span>${btn('q-play', 'Play')}${btn('q-up', '↑', k ? '' : 'disabled')}${btn('q-down', '↓', k < mu.q.length - 1 ? '' : 'disabled')}${btn('q-del', '×', 'aria-label="Remove from the queue"', 'btn-quiet')}</div>`).join('');
    return `<div class="md-player"><b class="md-title">${id ? esc(nameOf(id)) : 'Nothing queued'}</b><div class="md-progress" data-md="seek" title="Tap to jump"><i id="mdProg"></i></div><small id="mdTime">0:00</small></div>
      <div class="btn-row md-transport">${btn('prev', '⏮ Previous')}${mu.playing ? btn('pause', '⏸ Pause', '', 'btn-primary') : btn('play', '▶ Play', mu.q.length ? '' : 'disabled', 'btn-primary')}${btn('stop', '⏹ Stop')}${btn('next', 'Next ⏭')}</div>
      <div class="btn-row">${toggle('shuffle', mu.shuffle, 'Shuffle')}<div class="seg" role="group">${['off', 'one', 'all'].map((r) => `<button type="button" data-md="repeat" data-val="${r}" aria-pressed="${mu.repeat === r}">${{ off: 'No repeat', one: 'Repeat track', all: 'Repeat queue' }[r]}</button>`).join('')}</div></div>
      ${id ? `<label class="dk-inline">This track's volume <input type="range" min="0" max="100" data-md-in="trackvol" value="${mu.vols[id] ?? 100}"></label>` : ''}
      <h4 class="md-h">Queue</h4><div class="ch-rows">${queue || '<p class="note">Add songs below, or play a playlist.</p>'}</div>
      <details class="md-sub"><summary>Add songs to the queue</summary>${pickList('audio', mu.q, 'q-add')}</details>
      <p class="note">Only use music you have the rights to. In OBS, tick “Control audio via OBS” on the Browser source to hear it.</p>`;
  }
  function playlistsCard() {
    const rows = live.playlists.map((p, k) => `<details class="md-sub" data-k="${k}"${openCards.has(`pl${p.id}`) ? ' open' : ''} data-pl="${p.id}"><summary><b>${esc(p.name)}</b> <small>${p.ids.length} songs</small></summary>
      <div class="btn-row"><input class="input" data-md-in="pl-name" value="${esc(p.name)}" maxlength="40" aria-label="Playlist name">${btn('pl-play', '▶ Play it', p.ids.length ? '' : 'disabled', 'btn-primary')}${btn('pl-dup', 'Duplicate')}${btn('pl-del', armedText(`pl${p.id}`, 'Delete'), '', 'btn-quiet')}</div>
      <div class="ch-rows">${p.ids.map((t, j) => `<div class="ch-row" data-j="${j}"><span class="ch-led">${esc(nameOf(t))}</span>${btn('pl-up', '↑', j ? '' : 'disabled')}${btn('pl-down', '↓', j < p.ids.length - 1 ? '' : 'disabled')}${btn('pl-rm', '×', '', 'btn-quiet')}</div>`).join('')}</div>
      ${pickList('audio', p.ids, 'pl-add')}</details>`).join('');
    return `${rows || '<p class="note">No playlists yet.</p>'}<div class="ch-add"><input class="input" id="mdNewPl" maxlength="40" placeholder="New playlist name"><button type="button" class="btn btn-small btn-primary" data-md="pl-new">Create</button></div>`;
  }
  function soundsCard() {
    const cats = [...new Set(live.sounds.map((x) => x.cat).filter(Boolean))];
    const pads = live.sounds.slice().sort((a, b) => (b.fav - a.fav) || a.cat.localeCompare(b.cat)).map((x) => {
      const k = live.sounds.indexOf(x);
      const wait = x.cool && lastPlay[x.id] ? Math.max(0, Math.ceil(x.cool - (Date.now() - lastPlay[x.id]) / 1000)) : 0;
      return `<div class="md-pad" data-k="${k}"><button type="button" class="md-fire" data-md="fire"${wait ? ' disabled' : ''}>${x.fav ? '★ ' : ''}${esc(x.name || nameOf(x.media))}${wait ? ` (${wait}s)` : ''}</button>
        <div class="md-pad-tools">${btn('preview-sound', 'Preview', 'title="Plays only on this device"')}${btn('fav', x.fav ? '★' : '☆', 'aria-label="Favourite"')}<input class="input md-cat" data-md-in="snd-cat" value="${esc(x.cat)}" maxlength="30" placeholder="Category" aria-label="Category"><label class="dk-inline">Vol <input type="range" min="0" max="100" data-md-in="snd-vol" value="${x.vol}"></label><label class="dk-inline">Cooldown <input class="input ch-num" type="number" min="0" max="600" data-md-in="snd-cool" value="${x.cool}"></label>${btn('snd-del', armedText(`snd${x.id}`, '×'), 'aria-label="Remove"', 'btn-quiet')}</div></div>`;
    }).join('');
    return `<div class="md-pads">${pads || '<p class="note">No sounds yet. Pick an MP3 below to add it.</p>'}</div>
      <div class="btn-row">${btn('stop-sounds', '⏹ Stop all sounds', '', 'btn-quiet')}${toggle('overlap', live.overlap, 'Sounds can overlap')}</div>
      ${cats.length ? `<p class="note">Categories: ${cats.map(esc).join(', ')}</p>` : ''}
      <details class="md-sub"><summary>Add a sound</summary>${pickList('audio', live.sounds.map((x) => x.media), 'snd-add')}</details>
      ${live.hist.length ? `<p class="note">Played: ${live.hist.slice(0, 8).map((h) => esc(h.t)).join(', ')}</p>` : ''}
      <p class="note">Sounds only ever play when someone presses them. Preview plays them on this device only. Alt+1 to Alt+9 play your first nine favourites.</p>`;
  }
  function showsCard() {
    return live.shows.map((x) => { const key = `show:${x.id}`; return `<details class="md-sub" data-key="${key}"${openCards.has(key) ? ' open' : ''}><summary><b>${esc(x.name)}</b> <small>${x.ids.length} pictures${x.vis === 'live' ? ', on screen' : ''}</small></summary>
      ${vis(key, x)}<div class="btn-row"><input class="input" data-md-in="show-name" data-key="${key}" value="${esc(x.name)}" maxlength="40">${btn('show-prev', '⏮', `data-key="${key}"`)}${x.playing ? btn('show-pause', '⏸ Pause', `data-key="${key}"`, 'btn-primary') : btn('show-play', '▶ Rotate', `data-key="${key}" ${x.ids.length ? '' : 'disabled'}`, 'btn-primary')}${btn('show-next', '⏭', `data-key="${key}"`)}</div>
      <div class="btn-row"><label class="dk-inline">Seconds each <input class="input ch-num" type="number" min="2" max="600" data-md-in="show-dur" data-key="${key}" value="${x.dur}"></label>${toggle(`show-shuffle" data-key="${key}`, x.shuffle, 'Shuffle')}${toggle(`show-repeat" data-key="${key}`, x.repeat, 'Repeat')}${btn('show-del', armedText(key, 'Delete'), `data-key="${key}"`, 'btn-quiet')}</div>
      ${pickList('image', x.ids, `show-pick" data-key="${key}`)}${look(key, x)}</details>`; }).join('') + `<div class="ch-add"><input class="input" id="mdNewShow" maxlength="40" placeholder="New slideshow name"><button type="button" class="btn btn-small btn-primary" data-md="show-new">Create</button></div>`;
  }
  function sponsorCard() {
    const sp = live.sponsor;
    const on = sp.items.filter((x) => x.on).length;
    const est = sp.rotating && sp.at && on ? Math.round(((Math.floor((Date.now() - sp.at) / (sp.every * 1000)) + 1) * sp.show) / on / 60) : 0;
    return `${vis('sponsor', sp)}<div class="btn-row">${sp.rotating ? btn('sp-stop', '⏸ Stop rotating', '', 'btn-primary') : btn('sp-start', '▶ Start rotating', on ? '' : 'disabled', 'btn-primary')}${btn('sp-now', 'Show the next one now', on ? '' : 'disabled')}</div>
      <div class="btn-row"><label class="dk-inline">Shows for (s) <input class="input ch-num" type="number" min="3" max="120" data-md-in="sp-show" value="${sp.show}"></label><label class="dk-inline">Every (s) <input class="input ch-num" type="number" min="10" max="3600" data-md-in="sp-every" value="${sp.every}"></label></div>
      <div class="ch-rows">${sp.items.map((x, k) => `<div class="ch-row" data-k="${k}"><span class="ch-led">${esc(x.name || nameOf(x.media))}</span><button type="button" class="btn btn-small ch-tog" data-md="sp-on" aria-pressed="${x.on}">${x.on ? 'In' : 'Out'}</button>${btn('sp-rm', '×', '', 'btn-quiet')}</div>`).join('')}</div>
      ${pickList('image', sp.items.map((x) => x.media), 'sp-add')}${look('sponsor', sp)}
      <p class="note">Sponsors only appear when it's on screen and rotating, or when you press Show the next one now.${sp.rotating ? ` Roughly ${est} min shown each so far (an estimate, not viewer counts).` : ''}</p>`;
  }
  function gifsCard() {
    return live.gifs.map((x) => { const key = `gif:${x.id}`; return `<details class="md-sub" data-key="${key}"${openCards.has(key) ? ' open' : ''}><summary><b>${esc(nameOf(x.media))}</b> <small>${x.loop ? 'loops' : `plays ${x.dur}s`}${x.vis === 'live' ? ', on screen' : ''}</small></summary>
      ${vis(key, x)}<div class="btn-row">${toggle(`gif-loop" data-key="${key}`, x.loop, 'Loop')}<label class="dk-inline">Shows for (s) <input class="input ch-num" type="number" min="1" max="600" data-md-in="gif-dur" data-key="${key}" value="${x.dur}"></label>${btn('gif-once', '▶ Play once now', `data-key="${key}"`, 'btn-primary')}${btn('gif-del', armedText(key, 'Remove'), `data-key="${key}"`, 'btn-quiet')}</div>${look(key, x)}</details>`; }).join('') + `<details class="md-sub"><summary>Add a GIF</summary>${pickList('gif', [], 'gif-add')}</details>`;
  }
  function mixerCard() {
    const mx = live.mixer;
    const slider = (k, label) => `<label class="md-mix"><span>${label}</span><input type="range" min="0" max="100" data-md-in="mix-${k}" value="${mx[k]}"><b>${mx[k]}%</b></label>`;
    return `${slider('master', 'Everything')}${slider('music', 'Music')}${slider('sfx', 'Sounds')}
      <div class="btn-row">${toggle('mute', mx.mute, 'Mute all')}${toggle('duck', mx.duck, 'Music dips under sounds')}${btn('stop-all', '⏹ Stop all audio', '', 'btn-quiet')}</div>
      <p class="note">These only control the hub's own music and sounds, not other OBS sources.</p>`;
  }
  function libraryCard() {
    const cats = [...new Set(media.map((m) => m.cat).filter(Boolean))];
    let list = media.filter((m) => (lib.type === 'all' || (lib.type === 'gif' ? isGif(m) : lib.type === 'image' ? m.kind === 'image' && !isGif(m) : m.kind === lib.type))
      && (!lib.q || m.name.toLowerCase().includes(lib.q.toLowerCase())) && (!lib.cat || m.cat === lib.cat));
    const recent = JSON.parse(localStorage.getItem('md-recent') || '{}');
    list = list.slice().sort((a, b) => (lib.sort === 'name' ? a.name.localeCompare(b.name) : lib.sort === 'size' ? b.size - a.size : lib.sort === 'used' ? (recent[b.id] || 0) - (recent[a.id] || 0) : b.at - a.at));
    if (lib.sort !== 'name') list.sort((a, b) => (b.fav ? 1 : 0) - (a.fav ? 1 : 0));
    const rows = list.map((m) => { const used = usedIn(m.id); return `<div class="md-asset" data-media="${m.id}">${m.kind === 'image' ? `<img src="/media/${m.id}" alt="" loading="lazy">` : '<span class="md-note">♪</span>'}
      <div class="md-asset-info">${owner() ? `<input class="input" data-md-in="rename" value="${esc(m.name)}" maxlength="60" aria-label="Name">` : `<b>${esc(m.name)}</b>`}<small>${isGif(m) ? 'GIF' : m.kind === 'audio' ? 'MP3' : 'Picture'}, ${mb(m.size)}, ${new Date(m.at).toLocaleDateString('en-GB')}${used.length ? `. Used in: ${esc(used.join(', '))}` : '. Not used anywhere'}</small></div>
      ${owner() ? `<button type="button" class="btn btn-small" data-md="lib-fav" aria-label="Favourite">${m.fav ? '★' : '☆'}</button><input class="input md-cat" data-md-in="lib-cat" value="${esc(m.cat || '')}" maxlength="30" placeholder="Category" aria-label="Category"><button type="button" class="btn btn-small btn-quiet" data-md="lib-del">${armedText(`del${m.id}`, used.length ? 'Delete (in use)' : 'Delete')}</button>` : (m.fav ? '<span>★</span>' : '')}</div>`; }).join('');
    return `${owner() ? `<div class="md-upload"><label class="check check-sm"><input type="checkbox" id="mdRights"><span>I have the rights to use these files</span></label><input type="file" id="mdFile" accept="image/png,image/jpeg,image/webp,image/gif,audio/mpeg" multiple><div class="md-bar" hidden id="mdUpBar"><i></i></div><small id="mdUpText"></small></div>` : '<p class="note">Only the owner can upload, rename or delete files.</p>'}
      <div class="md-filters"><input class="input" id="mdSearch" placeholder="Search" value="${esc(lib.q)}" aria-label="Search files"><select class="select" id="mdType">${[['all', 'Everything'], ['image', 'Pictures'], ['gif', 'GIFs'], ['audio', 'MP3s']].map(([v, l]) => `<option value="${v}"${lib.type === v ? ' selected' : ''}>${l}</option>`).join('')}</select><select class="select" id="mdSort">${[['new', 'Newest'], ['name', 'Name'], ['size', 'Biggest'], ['used', 'Recently used']].map(([v, l]) => `<option value="${v}"${lib.sort === v ? ' selected' : ''}>${l}</option>`).join('')}</select>${cats.length ? `<select class="select" id="mdCat"><option value="">All categories</option>${cats.map((c) => `<option${lib.cat === c ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select>` : ''}</div>
      <div class="md-assets">${rows || '<p class="note">No files match.</p>'}</div>`;
  }
  function storageCard() {
    const u = window.__mdUsage;
    if (!owner()) return '<p class="note">Only the owner can see and manage storage.</p>';
    if (!u) return '<p class="note">Loading…</p>';
    const by = (f) => media.filter(f).reduce((a, m) => a + m.size, 0);
    const unused = media.filter((m) => !usedIn(m.id).length);
    const biggest = media.slice().sort((a, b) => b.size - a.size).slice(0, 5);
    return `<p><b>${mb(u.uploads.used)} of ${mb(u.uploads.cap)}</b> used for uploads, ${mb(u.uploads.cap - u.uploads.used)} left. Server storage ${mb(u.disk.used)} of ${mb(u.disk.cap)}. Traffic this month ${(u.traffic.used / 1e9).toFixed(2)} of ${(u.traffic.cap / 1e9).toFixed(0)} GB.</p>
      <p class="note">Pictures ${mb(by((m) => m.kind === 'image' && !isGif(m)))}, GIFs ${mb(by(isGif))}, MP3s ${mb(by((m) => m.kind === 'audio'))}. Duplicate uploads prevented: ${u.dupes || 0}.</p>
      <p class="note">Biggest: ${biggest.map((m) => `${esc(m.name)} (${mb(m.size)})`).join(', ') || 'none'}</p>
      <p class="note">Not used anywhere: ${unused.length ? unused.map((m) => esc(m.name)).join(', ') : 'none'}</p>
      ${unused.length ? btn('unused-del', armedText('unused', `Delete the ${unused.length} unused files`), '', 'btn-quiet') : ''}`;
  }
  const SECTIONS = [['music', '♪', 'Music player', () => (live.music.playing ? `Playing: ${nameOf(live.music.q[live.music.i])}` : `${live.music.q.length} in the queue`), musicCard],
    ['playlists', '☰', 'Playlists', () => `${live.playlists.length} playlists`, playlistsCard],
    ['sounds', '🔊', 'Soundboard', () => `${live.sounds.length} sounds`, soundsCard],
    ['shows', '🖼', 'Slideshows', () => `${live.shows.length} slideshows`, showsCard],
    ['sponsor', '★', 'Sponsor rotation', () => (live.sponsor.rotating ? 'Rotating' : `${live.sponsor.items.length} sponsors, not rotating`), sponsorCard],
    ['gifs', '◎', 'GIFs', () => `${live.gifs.length} GIFs`, gifsCard],
    ['mixer', '🎚', 'Audio mixer', () => (live.mixer.mute ? 'Muted' : `Everything ${live.mixer.master}%`), mixerCard],
    ['library', '▤', 'Library', () => `${media.length} files`, libraryCard],
    ['storage', '◔', 'Storage', () => 'Space, traffic and unused files', storageCard]];
  function paint() {
    if (!live) return;
    const typing = cards.contains(document.activeElement) && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName) && document.activeElement.type !== 'range';
    if (typing) return;
    const html = SECTIONS.map(([k, icon, name, sum, body]) => `<details class="fold dk-card" data-id="${k}"${openCards.has(k) ? ' open' : ''}><summary><span class="fold-icon dk-icon" aria-hidden="true">${icon}</span><span class="fold-text"><b>${name}</b><small>${esc(sum())}</small></span><span class="fold-chev" aria-hidden="true"></span></summary><div class="fold-body">${body()}</div></details>`).join('');
    if (cards._html !== html) { cards._html = html; cards.innerHTML = html; }
  }
  window.addEventListener('hub-media', (e) => { media = e.detail.list; redraw(); });
  // The current track's length and progress, from the file itself
  const probe = new Audio();
  probe.preload = 'metadata';
  setInterval(() => {
    if (!live) return;
    const mu = live.music;
    const id = mu.q[mu.i];
    if (id && !probe.src.endsWith(`/media/${id}`)) probe.src = `/media/${id}`;
    const pos = mu.playing ? (Date.now() - mu.at) / 1000 : mu.pos;
    const dur = probe.duration || 0;
    const bar = document.getElementById('mdProg');
    const t = document.getElementById('mdTime');
    // Never more than the track's length; if the queue can't move on, OBS isn't open to play it
    const shown = dur ? Math.min(pos, dur) : pos;
    if (bar) bar.style.width = `${dur ? Math.min(100, (shown / dur) * 100) : 0}%`;
    if (t) t.textContent = `${clock(shown)}${dur ? ` / ${clock(dur)}` : ''}${mu.playing && dur && pos > dur + 4 ? '. Waiting for OBS: open the overlay link in OBS to play the next track.' : ''}`;
  }, 500);
  const touched = (id) => { const r = JSON.parse(localStorage.getItem('md-recent') || '{}'); r[id] = Date.now(); localStorage.setItem('md-recent', JSON.stringify(r)); };

  /* ---------- Music actions ---------- */
  const mu = () => live.music;
  const posNow = () => (mu().playing ? (Date.now() - mu().at) / 1000 : mu().pos);
  function playIndex(k) { const m = mu(); m.i = k; m.pos = 0; m.at = Date.now(); m.playing = true; m.seq += 1; }
  function step(d) { const m = mu(); if (!m.q.length) return; if (m.shuffle && m.q.length > 1) { let k = m.i; while (k === m.i) k = Math.floor(Math.random() * m.q.length); playIndex(k); } else playIndex((m.i + d + m.q.length) % m.q.length); }
  function fire(k) {
    const x = live.sounds[k];
    if (!x || !x.media) return;
    if (x.cool && lastPlay[x.id] && Date.now() - lastPlay[x.id] < x.cool * 1000) { Hub.toast(`${x.name || 'That sound'} is cooling down.`); return; }
    lastPlay[x.id] = Date.now();
    live.fire = { id: X.newId(), sound: x.id, at: Date.now() };
    live.hist = [{ t: x.name || nameOf(x.media), at: Date.now() }].concat(live.hist).slice(0, 20);
    commit();
    if (x.cool) { redraw(); setTimeout(redraw, x.cool * 1000 + 100); }
  }
  // Alt+1 to Alt+9: the first nine favourite sounds
  document.addEventListener('keydown', (e) => {
    if (!live || !e.altKey || !/^[1-9]$/.test(e.key) || ['INPUT', 'TEXTAREA', 'SELECT'].includes((document.activeElement || {}).tagName)) return;
    const favs = live.sounds.map((x, k) => [x, k]).filter(([x]) => x.fav);
    const hit = favs[Number(e.key) - 1];
    if (hit) { e.preventDefault(); fire(hit[1]); }
  });
  async function upload(files) {
    if (!document.getElementById('mdRights').checked) { Hub.toast('Tick that you have the rights to use these files first.', { tone: 'bad' }); return; }
    const bar = document.getElementById('mdUpBar');
    const text = document.getElementById('mdUpText');
    for (const [n, file] of Array.from(files).entries()) {
      bar.hidden = false;
      await new Promise((done) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `/api/media?streamer=${encodeURIComponent(Hub.streamer.id)}&name=${encodeURIComponent(file.name.replace(/\.\w+$/, ''))}&rights=1`);
        xhr.setRequestHeader('Authorization', `Bearer ${Hub.token}`);
        xhr.upload.onprogress = (e) => { if (e.lengthComputable) { bar.firstChild.style.width = `${(e.loaded / e.total) * 100}%`; text.textContent = `Uploading ${file.name} (${n + 1} of ${files.length}): ${Math.round((e.loaded / e.total) * 100)}%`; } };
        xhr.onload = () => { let r = {}; try { r = JSON.parse(xhr.responseText); } catch (e2) { r = {}; } text.textContent = xhr.status < 300 ? (r.duplicate ? `${file.name} was already uploaded, so it's reused.` : `${file.name} uploaded.`) : (r.error || 'That upload failed. Nothing was saved.'); done(); };
        xhr.onerror = () => { text.textContent = 'The upload failed (connection). Nothing was saved.'; done(); };
        xhr.send(file);
      });
    }
    bar.hidden = true;
  }

  const view = document.getElementById('viewMedia');
  view.addEventListener('click', (e) => {
    if (!live) return;
    const vb = e.target.closest('[data-vis]');
    if (vb && vb.dataset.key) { const it = item(vb.dataset.key); if (it) { it.vis = vb.dataset.vis; commit(); } return; }
    const b = e.target.closest('[data-md]');
    if (!b) return;
    const key = b.dataset.key;
    const row = b.closest('[data-k]');
    const k = row ? Number(row.dataset.k) : -1;
    const m = live.music;
    switch (b.dataset.md) {
      case 'play': if (!m.q.length) return; m.at = Date.now() - m.pos * 1000; m.playing = true; m.seq += 1; break;
      case 'pause': m.pos = posNow(); m.playing = false; m.seq += 1; break;
      case 'stop': m.playing = false; m.pos = 0; m.seq += 1; break;
      case 'next': step(1); break;
      case 'prev': step(-1); break;
      case 'seek': { const r = b.getBoundingClientRect(); const dur = probe.duration || 0; if (!dur) return; const p = ((e.clientX - r.left) / r.width) * dur; if (m.playing) m.at = Date.now() - p * 1000; else m.pos = p; m.seq += 1; break; }
      case 'shuffle': m.shuffle = !m.shuffle; break;
      case 'repeat': m.repeat = b.dataset.val; break;
      case 'q-add': { const id = b.dataset.media; m.q.push(id); touched(id); break; }
      case 'q-play': playIndex(k); break;
      case 'q-up': [m.q[k - 1], m.q[k]] = [m.q[k], m.q[k - 1]]; if (m.i === k) m.i -= 1; else if (m.i === k - 1) m.i += 1; break;
      case 'q-down': [m.q[k + 1], m.q[k]] = [m.q[k], m.q[k + 1]]; if (m.i === k) m.i += 1; else if (m.i === k + 1) m.i -= 1; break;
      case 'q-del': m.q.splice(k, 1); if (m.i >= k && m.i > 0) m.i -= 1; if (!m.q.length) { m.playing = false; m.seq += 1; } break;
      // Playlists
      case 'pl-new': { const name = document.getElementById('mdNewPl').value.trim() || 'Playlist'; const id = X.newId(); live.playlists.push({ id, name, ids: [] }); keepOpen(`pl${id}`); break; }
      case 'pl-add': case 'pl-rm': case 'pl-up': case 'pl-down': case 'pl-play': case 'pl-dup': case 'pl-del': {
        const p = live.playlists.find((x) => x.id === b.closest('[data-pl]').dataset.pl);
        if (!p) return;
        const j = b.closest('[data-j]') ? Number(b.closest('[data-j]').dataset.j) : -1;
        if (b.dataset.md === 'pl-add') { if (!p.ids.includes(b.dataset.media)) p.ids.push(b.dataset.media); touched(b.dataset.media); }
        if (b.dataset.md === 'pl-rm') p.ids.splice(j, 1);
        if (b.dataset.md === 'pl-up') [p.ids[j - 1], p.ids[j]] = [p.ids[j], p.ids[j - 1]];
        if (b.dataset.md === 'pl-down') [p.ids[j + 1], p.ids[j]] = [p.ids[j], p.ids[j + 1]];
        if (b.dataset.md === 'pl-play') { m.q = p.ids.slice(); playIndex(0); Hub.toast(`Playing “${p.name}”.`); }
        if (b.dataset.md === 'pl-dup') live.playlists.push({ id: X.newId(), name: `${p.name} copy`, ids: p.ids.slice() });
        if (b.dataset.md === 'pl-del') { if (!arm(`pl${p.id}`)) return; live.playlists = live.playlists.filter((x) => x !== p); }
        break;
      }
      // Soundboard
      case 'snd-add': { const id = b.dataset.media; live.sounds.push({ id: X.newId(), media: id, name: nameOf(id), cat: '', fav: false, vol: 100, cool: 0 }); touched(id); break; }
      case 'fire': fire(k); return;
      case 'preview-sound': { const x = live.sounds[k]; if (!x) return; const a = new Audio(`/media/${x.media}`); a.volume = x.vol / 100; a.play().catch(() => Hub.toast('This browser blocked the preview. Tap again.')); return; }
      case 'fav': live.sounds[k].fav = !live.sounds[k].fav; break;
      case 'snd-del': { const x = live.sounds[k]; if (!arm(`snd${x.id}`)) return; live.sounds.splice(k, 1); break; }
      case 'stop-sounds': live.stopSeq += 1; break;
      case 'overlap': live.overlap = !live.overlap; break;
      // Slideshows
      case 'show-new': { const name = document.getElementById('mdNewShow').value.trim() || 'Slideshow'; const n = live.shows.length; const x = X.mediaNormalize({ shows: [{ name, x: 1400 - n * 60, y: 320 + n * 60 }] }).shows[0]; live.shows.push(x); keepOpen(`show:${x.id}`); break; }
      case 'show-pick': { const x = item(key); const id = b.dataset.media; x.ids = x.ids.includes(id) ? x.ids.filter((y) => y !== id) : x.ids.concat(id); touched(id); break; }
      case 'show-play': { const x = item(key); x.playing = true; x.at = Date.now(); break; }
      case 'show-pause': { const x = item(key); x.i = x.ids.indexOf(X.slideNow(x)); x.playing = false; break; }
      case 'show-next': case 'show-prev': { const x = item(key); x.i = Math.max(0, x.ids.indexOf(X.slideNow(x))) + (b.dataset.md === 'show-next' ? 1 : -1); x.at = Date.now(); break; }
      case 'show-shuffle': { const x = item(key); x.shuffle = !x.shuffle; break; }
      case 'show-repeat': { const x = item(key); x.repeat = !x.repeat; break; }
      case 'show-del': if (!arm(key)) return; live.shows = live.shows.filter((x) => `show:${x.id}` !== key); break;
      // Sponsors
      case 'sp-add': { const id = b.dataset.media; if (!live.sponsor.items.some((x) => x.media === id)) live.sponsor.items.push({ media: id, name: nameOf(id), on: true }); touched(id); break; }
      case 'sp-on': live.sponsor.items[k].on = !live.sponsor.items[k].on; break;
      case 'sp-rm': live.sponsor.items.splice(k, 1); break;
      case 'sp-start': live.sponsor.rotating = true; live.sponsor.at = Date.now(); break;
      case 'sp-stop': live.sponsor.rotating = false; break;
      case 'sp-now': live.sponsor.trig = Date.now(); break;
      // GIFs
      case 'gif-add': { const id = b.dataset.media; const g = X.mediaNormalize({ gifs: [{ media: id }] }).gifs[0]; live.gifs.push(g); keepOpen(`gif:${g.id}`); touched(id); break; }
      case 'gif-loop': { const x = item(key); x.loop = !x.loop; break; }
      case 'gif-once': { const x = item(key); x.loop = false; x.at = Date.now(); if (x.vis === 'off') Hub.toast('It plays once on screen when it’s set to Show on screen.'); break; }
      case 'gif-del': if (!arm(key)) return; live.gifs = live.gifs.filter((x) => `gif:${x.id}` !== key); break;
      // Mixer
      case 'mute': live.mixer.mute = !live.mixer.mute; break;
      case 'duck': live.mixer.duck = !live.mixer.duck; break;
      case 'stop-all': live.stopSeq += 1; if (m.playing) { m.pos = posNow(); m.playing = false; m.seq += 1; } break;
      case 'lock': { const x = item(key); x.lock = !x.lock; break; }
      // Library (owner)
      case 'lib-fav': { const id = b.closest('[data-media]').dataset.media; const f = media.find((x) => x.id === id); Hub.call('PATCH', `/api/media/${id}`, { fav: !(f && f.fav) }).catch((err) => Hub.toast(err.message, { tone: 'bad' })); return; }
      case 'lib-del': { const id = b.closest('[data-media]').dataset.media; if (!arm(`del${id}`)) return; Hub.call('DELETE', `/api/media/${id}`).then(() => Hub.toast('Deleted.')).catch((err) => Hub.toast(err.message, { tone: 'bad' })); return; }
      case 'unused-del': { if (!arm('unused')) return; const unused = media.filter((x) => !usedIn(x.id).length); Promise.all(unused.map((x) => Hub.call('DELETE', `/api/media/${x.id}`))).then(() => Hub.toast(`Deleted ${unused.length} unused files.`)).catch((err) => Hub.toast(err.message, { tone: 'bad' })); return; }
      default: return;
    }
    commit();
  });
  function item(key) {
    if (!key) return null;
    const [kind, id] = key.split(':');
    return kind === 'show' ? live.shows.find((x) => x.id === id) : kind === 'gif' ? live.gifs.find((x) => x.id === id) : kind === 'sponsor' ? live.sponsor : null;
  }
  view.addEventListener('input', (e) => {
    const t = e.target;
    if (t.id === 'mdSearch') { lib.q = t.value; const box = cards.querySelector('[data-id="library"] .fold-body'); if (box) { const keep = t.selectionStart; cards._html = ''; paint(); const s = document.getElementById('mdSearch'); if (s) { s.focus(); s.setSelectionRange(keep, keep); } } }
  });
  view.addEventListener('change', (e) => {
    if (!live) return;
    const t = e.target;
    if (t.id === 'mdFile') { upload(t.files).then(() => { t.value = ''; }); return; }
    if (t.id === 'mdType') { lib.type = t.value; redraw(); return; }
    if (t.id === 'mdSort') { lib.sort = t.value; redraw(); return; }
    if (t.id === 'mdCat') { lib.cat = t.value; redraw(); return; }
    const path = t.dataset.mdIn;
    if (!path) return;
    const row = t.closest('[data-k]');
    const k = row ? Number(row.dataset.k) : -1;
    const v = Number(t.value);
    const id = t.closest('[data-media]') && t.closest('[data-media]').dataset.media;
    switch (path) {
      case 'rename': Hub.call('PATCH', `/api/media/${id}`, { name: t.value }).catch((err) => Hub.toast(err.message, { tone: 'bad' })); return;
      case 'lib-cat': Hub.call('PATCH', `/api/media/${id}`, { cat: t.value }).catch((err) => Hub.toast(err.message, { tone: 'bad' })); return;
      case 'trackvol': live.music.vols[live.music.q[live.music.i]] = v; break;
      case 'pl-name': { const p = live.playlists.find((x) => x.id === t.closest('[data-pl]').dataset.pl); if (p) p.name = t.value; break; }
      case 'snd-cat': live.sounds[k].cat = t.value; break;
      case 'snd-vol': live.sounds[k].vol = v; break;
      case 'snd-cool': live.sounds[k].cool = Math.max(0, v); break;
      case 'show-name': item(t.dataset.key).name = t.value; break;
      case 'show-dur': item(t.dataset.key).dur = Math.max(2, v); break;
      case 'gif-dur': item(t.dataset.key).dur = Math.max(1, v); break;
      case 'sp-show': live.sponsor.show = Math.max(3, v); break;
      case 'sp-every': live.sponsor.every = Math.max(10, v); break;
      case 'scale': item(t.dataset.key).scale = v / 100; break;
      case 'preset': if (t.value) { const [x, y] = t.value.split(',').map(Number); const it = item(t.dataset.key); it.x = x; it.y = y; } break;
      default: if (path.startsWith('mix-')) live.mixer[path.slice(4)] = v; else return;
    }
    commit();
  });
  // Storage numbers for the owner, refreshed when the Media Centre opens
  window.addEventListener('hashchange', () => { if (location.hash === '#media' && owner()) Hub.call('GET', '/api/usage').then((u) => { window.__mdUsage = u; redraw(); }).catch(() => {}); });
  if (location.hash === '#media') setTimeout(() => { if (owner()) Hub.call('GET', '/api/usage').then((u) => { window.__mdUsage = u; redraw(); }).catch(() => {}); }, 800);
})();
