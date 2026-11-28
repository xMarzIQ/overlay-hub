/*
  Canvas: everything drawn or placed on the stream by hand. Pen and arrows, pictures, web pages, YouTube videos,
  text, QR codes and a tactics pitch, plus a spotlight, a laser pointer and music.
  The same renderer draws the OBS page and the hub's preview (where music stays silent).
*/
(() => {
  'use strict';
  const X = window.ExtrasModel;
  // Width of each kind of item at size 1; the size slider scales it
  const WIDTH = { image: 520, web: 760, youtube: 760, text: 0, qr: 260, pitch: 820 };
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ytId = (u) => { const m = /(?:youtu\.be\/|v=|embed\/|shorts\/)([\w-]{11})/.exec(String(u)); return m ? m[1] : ''; };
  const safeUrl = (u) => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : ''; } catch (e) { return ''; } };
  const PITCH = '<svg viewBox="0 0 105 68" xmlns="http://www.w3.org/2000/svg"><defs><pattern id="mow" width="10.5" height="68" patternUnits="userSpaceOnUse"><rect width="5.25" height="68" fill="#2f8f46"/><rect x="5.25" width="5.25" height="68" fill="#2a8540"/></pattern></defs><rect width="105" height="68" rx="1.5" fill="url(#mow)"/><g fill="none" stroke="#e9f5ec" stroke-width=".45" opacity=".9"><rect x="2" y="2" width="101" height="64"/><path d="M52.5 2v64"/><circle cx="52.5" cy="34" r="9.15"/><rect x="2" y="13.84" width="16.5" height="40.32"/><rect x="86.5" y="13.84" width="16.5" height="40.32"/><rect x="2" y="24.84" width="5.5" height="18.32"/><rect x="97.5" y="24.84" width="5.5" height="18.32"/><path d="M18.5 26.7a9.15 9.15 0 0 1 0 14.6M86.5 26.7a9.15 9.15 0 0 0 0 14.6"/></g><g fill="#e9f5ec"><circle cx="52.5" cy="34" r=".6"/><circle cx="13" cy="34" r=".5"/><circle cx="92" cy="34" r=".5"/></g></svg>';

  function qrSvg(text) {
    if (!window.qrcode || !text) return '';
    const q = window.qrcode(0, 'M');
    q.addData(String(text).slice(0, 300));
    q.make();
    return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  }

  function mount(stage, opts = {}) {
    const preview = !!opts.preview;
    const root = document.createElement('div');
    root.className = 'cv';
    root.classList.toggle('is-hub', !!(opts && opts.preview));
    root.innerHTML = `<div class="cv-items"></div>
      <svg class="cv-ink" viewBox="0 0 1920 1080" preserveAspectRatio="none" aria-hidden="true"><defs><marker id="cvArrow${preview ? 'P' : ''}" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="context-stroke"/></marker></defs><g class="cv-strokes"></g><g class="cv-live"></g></svg>
      <div class="cv-spot"></div><div class="cv-laser"></div>`;
    stage.el.appendChild(root);
    const items = root.querySelector('.cv-items');
    const strokesG = root.querySelector('.cv-strokes');
    const liveG = root.querySelector('.cv-live');
    const spot = root.querySelector('.cv-spot');
    const laser = root.querySelector('.cv-laser');
    const trail = Array.from({ length: 9 }, () => { const t = document.createElement('i'); t.className = 'cv-trail'; root.appendChild(t); return t; });
    let trailPts = [];
    let trailT = 0;
    // The tactics pitch with its player counters (draggable in the hub's preview)
    function paintPitch(d, it) {
      const key = JSON.stringify(it.men);
      if (d._men === key && d.firstChild) return;
      d._men = key;
      const men = it.men.map((m, i) => `<g class="cv-man t${m.t}" data-i="${i}" transform="translate(${m.x} ${m.y})"><circle r="2.6"></circle><text y="0.95" text-anchor="middle">${String(m.n).replace(/[<&]/g, '')}</text></g>`).join('');
      d.innerHTML = PITCH.replace('</svg>', `${men}</svg>`);
    }
    if (preview && opts.onDrag) {
      root.addEventListener('pointerdown', (e) => {
        const man = e.target.closest && e.target.closest('.cv-man');
        if (!man) return;
        e.stopPropagation(); e.preventDefault();
        const item = man.closest('.cv-item');
        const svg = man.ownerSVGElement;
        const i = Number(man.dataset.i);
        const at = (ev) => { const r = svg.getBoundingClientRect(); return [Math.max(0, Math.min(105, ((ev.clientX - r.left) / r.width) * 105)), Math.max(0, Math.min(68, ((ev.clientY - r.top) / r.height) * 68))]; };
        let pos = null;
        const move = (ev) => { pos = at(ev); man.setAttribute('transform', `translate(${pos[0]} ${pos[1]})`); };
        const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); if (pos) opts.onDrag(`man:${item.dataset.id}:${i}`, Math.round(pos[0] * 10) / 10, Math.round(pos[1] * 10) / 10); };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
      }, true);
    }
    const audio = preview ? null : new Audio();
    let current = null;
    let musicKey = '';
    const marker = `url(#cvArrow${preview ? 'P' : ''})`;

    const pathOf = (pts) => {
      if (pts.length < 3) return pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]} ${p[1]}`).join('');
      let d = `M${pts[0][0]} ${pts[0][1]}`;
      for (let i = 1; i < pts.length - 1; i += 1) d += `Q${pts[i][0]} ${pts[i][1]} ${(pts[i][0] + pts[i + 1][0]) / 2} ${(pts[i][1] + pts[i + 1][1]) / 2}`;
      const l = pts[pts.length - 1];
      return `${d}L${l[0]} ${l[1]}`;
    };
    const NS = 'http://www.w3.org/2000/svg';
    function strokeEl(st) {
      const g = document.createElementNS(NS, 'g');
      const p = document.createElementNS(NS, 'path');
      const pts = st.arrow && st.pts.length > 1 ? [st.pts[0], st.pts[st.pts.length - 1]] : st.pts;
      p.setAttribute('d', pts.length === 1 ? `M${pts[0][0]} ${pts[0][1]}l0.1 0` : pathOf(pts));
      p.setAttribute('stroke', st.c);
      p.setAttribute('stroke-width', String(st.w));
      g.appendChild(p);
      // An arrow gets its own solid head at the end, sized to the line
      if (st.arrow && pts.length > 1) {
        const [a, b] = [pts[0], pts[1]];
        const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
        const len = Math.max(22, st.w * 3.2);
        const head = document.createElementNS(NS, 'path');
        const pt = (r, t) => [b[0] + r * Math.cos(ang + t), b[1] + r * Math.sin(ang + t)];
        const l = pt(len, Math.PI - 0.45);
        const r = pt(len, Math.PI + 0.45);
        head.setAttribute('d', `M${b[0] + Math.cos(ang) * st.w * 0.6} ${b[1] + Math.sin(ang) * st.w * 0.6}L${l[0]} ${l[1]}L${r[0]} ${r[1]}Z`);
        head.setAttribute('class', 'head');
        head.style.fill = st.c;
        head.setAttribute('stroke', st.c);
        head.setAttribute('stroke-width', String(Math.max(2, st.w / 3)));
        g.appendChild(head);
      }
      g.dataset.id = st.id;
      if (st.fade) { g.dataset.fade = '1'; g.dataset.t = String(st.t); }
      return g;
    }
    function itemEl(it) {
      const d = document.createElement('div');
      d.className = `cv-item cv-${it.type}`;
      const w = WIDTH[it.type];
      if (w) d.style.width = `${w}px`;
      if (it.type === 'image') d.innerHTML = it.src ? `<img src="/media/${esc(it.src)}" alt="">` : '';
      else if (it.type === 'web') { const u = safeUrl(it.src); d.innerHTML = u ? `<iframe src="${esc(u)}" title="" loading="lazy" referrerpolicy="no-referrer"></iframe>` : ''; }
      else if (it.type === 'youtube') { const v = ytId(it.src); d.innerHTML = v ? `<iframe src="https://www.youtube.com/embed/${v}?autoplay=1&controls=0&rel=0${preview ? '&mute=1' : ''}" title="" allow="autoplay; encrypted-media" loading="lazy"></iframe>` : ''; }
      else if (it.type === 'text') { d.style.color = it.color; d.textContent = it.text; }
      else if (it.type === 'qr') d.innerHTML = `${qrSvg(it.src)}${it.text ? `<span>${esc(it.text)}</span>` : ''}`;
      else if (it.type === 'pitch') paintPitch(d, it);
      return d;
    }
    // Where an item sits: x and y are its centre in the 1920×1080 stream
    function placeEl(d, it) {
      d.style.left = `${it.x}px`;
      d.style.top = `${it.y}px`;
      d.style.transform = `translate(-50%, -50%) scale(${it.scale})`;
      d.style.zIndex = String(it.z);
      d.dataset.lock = it.lock ? '1' : '';
    }
    // In the hub, anything can be dragged around the preview
    function draggable(node, idOf) {
      if (!preview || !opts.onDrag) return;
      node.addEventListener('pointerdown', (e) => {
        if (document.querySelector('.draw-layer:not([hidden])')) return; // a drawing tool is in use
        if (node.dataset.lock === '1') return; // locked: stays where it is
        e.preventDefault();
        node.setPointerCapture(e.pointerId);
        const box = root.getBoundingClientRect();
        const k = 1920 / box.width;
        const start = [e.clientX, e.clientY];
        const from = [parseFloat(node.style.left), parseFloat(node.style.top)];
        let to = from;
        node.classList.add('is-dragging');
        const move = (ev) => { to = [Math.round(from[0] + (ev.clientX - start[0]) * k), Math.round(from[1] + (ev.clientY - start[1]) * k)]; if (Math.abs(to[0] - 960) < 16) to[0] = 960; if (Math.abs(to[1] - 540) < 16) to[1] = 540; root.classList.toggle('guide-x', to[0] === 960); root.classList.toggle('guide-y', to[1] === 540); node.style.left = `${to[0]}px`; node.style.top = `${to[1]}px`; };
        const up = () => { node.removeEventListener('pointermove', move); root.classList.remove('guide-x', 'guide-y'); node.classList.remove('is-dragging'); if (to !== from) opts.onDrag(idOf(), Math.max(0, Math.min(1920, to[0])), Math.max(0, Math.min(1080, to[1]))); };
        node.addEventListener('pointermove', move);
        node.addEventListener('pointerup', up, { once: true });
        node.addEventListener('pointercancel', up, { once: true });
      });
    }
    function render(s) {
      current = s;
      const now = Date.now();
      // Items: rebuilt only when what's inside them changes, so videos and web pages don't reload on every update
      const key = JSON.stringify(s.items.map((it) => [it.id, it.type, it.src, it.text, it.color, it.type === 'pitch' ? it.men : 0]));
      if (items._key !== key) {
        items._key = key;
        const old = new Map(Array.from(items.children).map((c) => [c.dataset.key, c]));
        const frag = document.createDocumentFragment();
        s.items.forEach((it) => {
          const k = JSON.stringify([it.id, it.type, it.src, it.text, it.color, it.type === 'pitch' ? it.men : 0]);
          let node = old.get(k);
          if (!node) { node = itemEl(it); draggable(node, () => node.dataset.id); }
          node.dataset.key = k;
          node.dataset.id = it.id;
          frag.appendChild(node);
        });
        items.replaceChildren(frag);
      }
      s.items.forEach((it) => {
        const node = items.querySelector(`[data-id="${it.id}"]`);
        if (!node) return;
        if (!node.classList.contains('is-dragging')) placeEl(node, it);
        const on = X.shows(it.vis, preview) && !(it.until && now > it.until);
        node.classList.toggle('is-on', on);
        node.classList.toggle('is-pv', preview && it.vis === 'preview'); // dashed outline: not on stream yet
      });
      // Pen strokes: the drawing as a whole is off, in preview, or live
      const sk = s.strokes.map((x) => x.id).join(',');
      if (strokesG._key !== sk) { strokesG._key = sk; strokesG.replaceChildren(...s.strokes.map(strokeEl)); }
      strokesG.style.display = X.shows(s.ink, preview) ? '' : 'none';
      strokesG.classList.toggle('is-pv', preview && s.ink === 'preview');
      // Spotlight
      spot.classList.toggle('is-on', s.spot.on);
      spot.style.setProperty('--x', `${s.spot.x}px`);
      spot.style.setProperty('--y', `${s.spot.y}px`);
      spot.style.setProperty('--r', `${s.spot.r}px`);
      // Music (only on the OBS page)
      if (audio) {
        const mk = `${s.music.id}|${s.music.playing}|${s.music.at}`;
        audio.volume = s.music.vol / 100;
        audio.loop = s.music.loop;
        if (mk !== musicKey) {
          musicKey = mk;
          if (s.music.playing && s.music.id) {
            if (!audio.src.endsWith(`/media/${s.music.id}`)) audio.src = `/media/${s.music.id}`;
            const go = () => { const off = Math.max(0, (Date.now() - s.music.at) / 1000); audio.currentTime = audio.duration && s.music.loop ? off % audio.duration : Math.min(off, audio.duration || off); audio.play().catch(() => {}); };
            if (audio.readyState >= 1) go(); else audio.addEventListener('loadedmetadata', go, { once: true });
          } else audio.pause();
        }
      }
    }
    // Fading ink fades out over 8 seconds; timed items hide on time
    setInterval(() => {
      const now = Date.now();
      strokesG.querySelectorAll('[data-fade]').forEach((p) => { const age = (now - Number(p.dataset.t)) / 1000; p.style.opacity = String(Math.max(0, 1 - Math.max(0, age - 3) / 5)); });
      if (current) current.items.forEach((it) => { if (it.until) { const n = items.querySelector(`[data-id="${it.id}"]`); if (n) n.classList.toggle('is-on', X.shows(it.vis, preview) && now <= it.until); } });
    }, 250);
    return {
      el: { root },
      render,
      // The stroke being drawn right now, before it's finished (the hub's preview only)
      drawing(st) { liveG.replaceChildren(...(st ? [strokeEl(st)] : [])); },
      laser(on, x, y) {
        laser.classList.toggle('is-on', !!on);
        laser.style.transform = `translate(${x}px, ${y}px)`;
        if (!on) { trailPts = []; trail.forEach((t) => { t.style.opacity = '0'; }); return; }
        trailPts.unshift([x, y]);
        trailPts = trailPts.slice(0, trail.length);
        trail.forEach((t, i) => { const p = trailPts[i]; if (!p) { t.style.opacity = '0'; return; } const k = 1 - i / trail.length; t.style.transform = `translate(${p[0]}px, ${p[1]}px) scale(${0.35 + 0.65 * k})`; t.style.opacity = String(0.6 * k); });
        clearTimeout(trailT);
        trailT = setTimeout(() => { trailPts = []; trail.forEach((t) => { t.style.opacity = '0'; }); }, 260);
      },
    };
  }
  window.CanvasOverlay = { mount };
})();
