/*
  Canvas: everything drawn or placed on the stream by hand. Pen and arrows, pictures, web pages, YouTube videos,
  text, QR codes and a tactics pitch, plus a spotlight, a laser pointer and music.
  The same renderer draws the OBS page and the hub's preview (where music stays silent).
*/
(() => {
  'use strict';
  const X = window.ExtrasModel;
  const SLOT = { tl: [0.06, 0.08, 0, 0], tc: [0.5, 0.08, -0.5, 0], tr: [0.94, 0.08, -1, 0], ml: [0.06, 0.5, 0, -0.5], mc: [0.5, 0.5, -0.5, -0.5], mr: [0.94, 0.5, -1, -0.5], bl: [0.06, 0.92, 0, -1], bc: [0.5, 0.92, -0.5, -1], br: [0.94, 0.92, -1, -1] };
  const WIDTH = { image: [320, 520, 760, 1100], web: [480, 760, 1100, 1600], youtube: [480, 760, 1100, 1600], text: [0, 0, 0, 0], qr: [180, 280, 400, 540], pitch: [560, 820, 1100, 1500] };
  const FONT = [40, 60, 86, 120];
  const IDX = { s: 0, m: 1, l: 2, xl: 3 };
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
    root.innerHTML = `<div class="cv-items"></div>
      <svg class="cv-ink" viewBox="0 0 1920 1080" preserveAspectRatio="none" aria-hidden="true"><defs><marker id="cvArrow${preview ? 'P' : ''}" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="context-stroke"/></marker></defs><g class="cv-strokes"></g><g class="cv-live"></g></svg>
      <div class="cv-spot"></div><div class="cv-laser"></div>`;
    stage.el.appendChild(root);
    const items = root.querySelector('.cv-items');
    const strokesG = root.querySelector('.cv-strokes');
    const liveG = root.querySelector('.cv-live');
    const spot = root.querySelector('.cv-spot');
    const laser = root.querySelector('.cv-laser');
    const audio = preview ? null : new Audio();
    let current = null;
    let musicKey = '';
    const marker = `url(#cvArrow${preview ? 'P' : ''})`;

    const pathOf = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]} ${p[1]}`).join('');
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
        head.setAttribute('fill', st.c);
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
      const i = IDX[it.size];
      const w = WIDTH[it.type][i];
      if (w) d.style.width = `${w}px`;
      if (it.type === 'image') d.innerHTML = it.src ? `<img src="/media/${esc(it.src)}" alt="">` : '';
      else if (it.type === 'web') { const u = safeUrl(it.src); d.innerHTML = u ? `<iframe src="${esc(u)}" title="" loading="lazy" referrerpolicy="no-referrer"></iframe>` : ''; }
      else if (it.type === 'youtube') { const v = ytId(it.src); d.innerHTML = v ? `<iframe src="https://www.youtube.com/embed/${v}?autoplay=1&controls=0&rel=0${preview ? '&mute=1' : ''}" title="" allow="autoplay; encrypted-media" loading="lazy"></iframe>` : ''; }
      else if (it.type === 'text') { d.style.fontSize = `${FONT[i]}px`; d.style.color = it.color; d.textContent = it.text; }
      else if (it.type === 'qr') d.innerHTML = `${qrSvg(it.src)}${it.text ? `<span>${esc(it.text)}</span>` : ''}`;
      else if (it.type === 'pitch') d.innerHTML = PITCH;
      const [fx, fy, ax, ay] = SLOT[it.pos];
      d.style.left = `${fx * 1920}px`;
      d.style.top = `${fy * 1080}px`;
      d.style.transform = `translate(${ax * 100}%, ${ay * 100}%)`;
      d.style.zIndex = String(it.z);
      return d;
    }
    function render(s) {
      current = s;
      root.classList.toggle('is-off', !s.onAir);
      const now = Date.now();
      // Items: rebuilt only when they change, so videos and web pages don't reload on every update
      const key = JSON.stringify(s.items.map((it) => [it.id, it.type, it.pos, it.size, it.z, it.src, it.text, it.color]));
      if (items._key !== key) {
        items._key = key;
        const old = new Map(Array.from(items.children).map((c) => [c.dataset.key, c]));
        const frag = document.createDocumentFragment();
        s.items.forEach((it) => {
          const k = JSON.stringify([it.id, it.type, it.pos, it.size, it.z, it.src, it.text, it.color]);
          const node = old.get(k) || itemEl(it);
          node.dataset.key = k;
          node.dataset.id = it.id;
          frag.appendChild(node);
        });
        items.replaceChildren(frag);
      }
      s.items.forEach((it) => {
        const node = items.querySelector(`[data-id="${it.id}"]`);
        if (node) node.classList.toggle('is-on', it.shown && !(it.until && now > it.until));
      });
      // Pen strokes
      const sk = s.strokes.map((x) => x.id).join(',');
      if (strokesG._key !== sk) { strokesG._key = sk; strokesG.replaceChildren(...s.strokes.map(strokeEl)); }
      // Spotlight
      spot.classList.toggle('is-on', s.spot.on);
      spot.style.setProperty('--x', `${s.spot.x}px`);
      spot.style.setProperty('--y', `${s.spot.y}px`);
      spot.style.setProperty('--r', `${s.spot.r}px`);
      // Music (only on the OBS page)
      if (audio) {
        const mk = `${s.music.id}|${s.music.playing}|${s.music.at}|${s.onAir}`; // hiding the canvas (or Hide everything) stops the music too
        audio.volume = s.music.vol / 100;
        audio.loop = s.music.loop;
        if (mk !== musicKey) {
          musicKey = mk;
          if (s.music.playing && s.music.id && s.onAir) {
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
      if (current) current.items.forEach((it) => { if (it.until) { const n = items.querySelector(`[data-id="${it.id}"]`); if (n) n.classList.toggle('is-on', it.shown && now <= it.until); } });
    }, 250);
    return {
      el: { root },
      render,
      // The stroke being drawn right now, before it's finished (the hub's preview only)
      drawing(st) { liveG.replaceChildren(...(st ? [strokeEl(st)] : [])); },
      laser(on, x, y) { laser.classList.toggle('is-on', !!on); laser.style.transform = `translate(${x}px, ${y}px)`; },
    };
  }
  window.CanvasOverlay = { mount };
})();
