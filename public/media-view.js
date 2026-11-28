/*
  Media Centre on stream: music (the queue plays from a saved start time so every OBS page agrees), sound effects
  (only when someone presses one), slideshows, sponsor rotation and GIFs. The hub's preview shows the pictures
  but never plays audio. OBS needs "Control audio via OBS" ticked on the Browser source to hear anything.
*/
(() => {
  'use strict';
  const X = window.ExtrasModel;
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function mount(stage, opts = {}) {
    const preview = !!opts.preview;
    const root = document.createElement('div');
    root.className = 'dk md';
    root.classList.toggle('is-hub', preview);
    stage.el.appendChild(root);
    const nodes = new Map();
    let current = null;

    /* ---------- Audio (OBS page only) ---------- */
    const music = preview ? null : new Audio();
    if (music) music.preload = 'auto';
    const sfx = new Set();
    let musicKey = '';
    let lastFire = null;
    let lastStop = null;
    const level = (s, v) => (s.mixer.mute ? 0 : (s.mixer.master / 100) * (v / 100));
    function musicVolume(s) {
      const id = s.music.q[s.music.i];
      const v = level(s, s.mixer.music) * ((s.music.vols[id] ?? 100) / 100);
      return Math.max(0, Math.min(1, v * (s.mixer.duck && sfx.size ? 0.3 : 1)));
    }
    function syncMusic(s) {
      if (!music) return;
      const mu = s.music;
      const id = mu.q[mu.i];
      music.volume = musicVolume(s);
      const key = JSON.stringify([id, mu.seq, mu.at, mu.playing, mu.pos]);
      if (key === musicKey) return;
      musicKey = key;
      if (!id) { music.pause(); return; }
      if (!music.src.endsWith(`/media/${id}`)) music.src = `/media/${id}`;
      const go = () => {
        if (mu.playing) { music.currentTime = Math.max(0, (Date.now() - mu.at) / 1000); music.play().catch(() => {}); } else { music.pause(); music.currentTime = mu.pos; }
      };
      if (music.readyState >= 1) go(); else music.addEventListener('loadedmetadata', go, { once: true });
    }
    // At the end of a track, the server picks what plays next (repeat, shuffle), so every OBS page stays in step
    if (music) music.addEventListener('ended', () => { if (current && current.music.playing && opts.send) opts.send({ type: 'mediaEnded', seq: current.music.seq, i: current.music.i }); });
    function syncSounds(s) {
      if (preview) return;
      if (lastStop !== null && s.stopSeq !== lastStop) { sfx.forEach((a) => a.pause()); sfx.clear(); }
      lastStop = s.stopSeq;
      const f = s.fire;
      if (!f || f.id === lastFire) return;
      const fresh = Date.now() - f.at < 5000; // a sound pressed before this page opened isn't replayed
      lastFire = f.id;
      if (!fresh) return;
      const snd = s.sounds.find((x) => x.id === f.sound);
      if (!snd || !snd.media) return;
      if (!s.overlap) { sfx.forEach((a) => a.pause()); sfx.clear(); }
      const a = new Audio(`/media/${snd.media}`);
      a.volume = Math.max(0, Math.min(1, level(s, s.mixer.sfx) * (snd.vol / 100)));
      sfx.add(a);
      const done = () => { sfx.delete(a); if (music && current) music.volume = musicVolume(current); };
      a.addEventListener('ended', done);
      a.addEventListener('error', done);
      a.play().catch(done);
      if (music) music.volume = musicVolume(s);
    }

    /* ---------- Pictures: slideshows, sponsors, GIFs ---------- */
    function drag(node) {
      if (!preview || !opts.onDrag) return;
      node.addEventListener('pointerdown', (e) => {
        if (node.dataset.lock === '1') return;
        e.preventDefault();
        node.setPointerCapture(e.pointerId);
        const k = 1920 / root.getBoundingClientRect().width;
        const start = [e.clientX, e.clientY];
        const from = [parseFloat(node.style.left), parseFloat(node.style.top)];
        let to = from;
        node.classList.add('is-dragging');
        const move = (ev) => { to = [Math.round(from[0] + (ev.clientX - start[0]) * k), Math.round(from[1] + (ev.clientY - start[1]) * k)]; if (Math.abs(to[0] - 960) < 16) to[0] = 960; if (Math.abs(to[1] - 540) < 16) to[1] = 540; node.style.left = `${to[0]}px`; node.style.top = `${to[1]}px`; };
        const up = () => { node.removeEventListener('pointermove', move); node.classList.remove('is-dragging'); if (to !== from) opts.onDrag(node.dataset.id, Math.max(0, Math.min(1920, to[0])), Math.max(0, Math.min(1080, to[1]))); };
        node.addEventListener('pointermove', move);
        node.addEventListener('pointerup', up, { once: true });
      });
    }
    function place(key, item, kind, src, show) {
      let node = nodes.get(key);
      if (!node) { node = document.createElement('div'); node.dataset.id = key; node.innerHTML = '<img alt="">'; root.appendChild(node); nodes.set(key, node); drag(node); }
      const img = node.firstChild;
      if (src && img.dataset.src !== src) { img.dataset.src = src; img.src = `/media/${src}`; }
      img.hidden = !src; // nothing chosen yet: no empty picture
      const on = X.shows(item.vis, preview) && !!src && show;
      node.className = `dk-w md-w md-${kind}${on ? ' is-on' : ''}${preview && item.vis === 'preview' ? ' is-pv' : ''}${node.classList.contains('is-dragging') ? ' is-dragging' : ''}`;
      if (!node.classList.contains('is-dragging')) { node.style.left = `${item.x}px`; node.style.top = `${item.y}px`; }
      node.dataset.lock = item.lock ? '1' : '';
      node.style.transform = `translate(-50%, -50%) scale(${item.scale})`;
      return node;
    }
    function paintPictures(s) {
      const now = Date.now();
      const seen = new Set();
      s.shows.forEach((x) => { const k = `show:${x.id}`; seen.add(k); place(k, x, 'show', X.slideNow(x, now), true); });
      const sp = X.sponsorNow(s.sponsor, now);
      seen.add('sponsor');
      place('sponsor', s.sponsor, 'sponsor', sp ? sp.media : '', !!sp);
      s.gifs.forEach((x) => { const k = `gif:${x.id}`; seen.add(k); place(k, x, 'gif', x.media, x.loop || (x.at && now - x.at < x.dur * 1000)); });
      nodes.forEach((n, k) => { if (!seen.has(k)) { n.remove(); nodes.delete(k); } });
    }
    function render(s) {
      current = s;
      paintPictures(s);
      syncMusic(s);
      syncSounds(s);
    }
    setInterval(() => { if (current) paintPictures(current); }, 500);
    return { el: { root }, render };
  }
  window.MediaOverlay = { mount, esc };
})();
