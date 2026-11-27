/*
  Stream Desk in the hub: a fixed set of everyday widgets, each in its own dropdown.
  Each one has Off and Show preview, then Show on screen; a colour, a size and a label; and its own controls.
  Drag widgets around the preview to move them.
*/
(() => {
  'use strict';
  const Hub = window.Hub;
  const X = window.ExtrasModel;
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const COLOURS = ['#ffffff', '#ffd166', '#ff5c6c', '#2ee59d', '#38bdf8', '#111827'];
  const ZONES = [['Europe/London', 'UK'], ['Europe/Madrid', 'Spain and central Europe'], ['America/New_York', 'Miami and New York'], ['America/Los_Angeles', 'Los Angeles'], ['Asia/Dubai', 'Dubai'], ['Asia/Tokyo', 'Tokyo'], ['Australia/Sydney', 'Sydney']];
  const ICON = { timer: '⏱', countdown: '⌛', counter: '#', text: 'T', checklist: '✓', budget: '£', clock: '◷' };
  let live = null;
  const cards = document.getElementById('dkCards');
  const openCards = new Set(JSON.parse(localStorage.getItem('dk-open') || '["timer"]'));
  cards.addEventListener('toggle', (e) => {
    const d = e.target;
    if (!d.dataset || !d.dataset.id) return;
    if (d.open) openCards.add(d.dataset.id); else openCards.delete(d.dataset.id);
    localStorage.setItem('dk-open', JSON.stringify(Array.from(openCards)));
  }, true);

  const ctl = Hub.module('desk', {
    patchable: ['widgets'],
    onState(s) { live = s; paint(); },
    isShowing: (s) => s.widgets.some((w) => w.vis === 'live'),
    liveCount: (s) => s.widgets.filter((w) => w.vis === 'live').length,
    tileSummary(s) {
      const on = s.widgets.filter((w) => w.vis === 'live');
      return { text: on.length ? `${on.length} on screen` : 'Nothing on screen', small: on.map((w) => X.DESK.find((d) => d.id === w.id).name).slice(0, 3).join(', ') };
    },
    onDrag(id, x, y) { const w = live && live.widgets.find((v) => v.id === id); if (w) { w.x = x; w.y = y; ctl.commit(); } },
  });
  const commit = () => ctl.commit();
  const byId = (id) => live.widgets.find((w) => w.id === id);

  function summary(w) {
    if (w.type === 'timer' || w.type === 'countdown') return X.fmt(X.timerNow(w));
    if (w.type === 'counter') return `${w.value}${w.goal ? ` / ${w.goal}` : ''}`;
    if (w.type === 'text') return w.text || 'No text yet';
    if (w.type === 'checklist') return `${w.items.filter((x) => x.done).length} of ${w.items.length} done`;
    if (w.type === 'budget') { const spent = w.items.filter((x) => x.done).reduce((n, x) => n + x.price, 0); return `£${(w.budget - spent).toFixed(2)} left`; }
    if (w.type === 'clock') return (ZONES.find((z) => z[0] === w.tz) || [w.tz, w.tz])[1];
    return '';
  }
  function controls(w) {
    if (w.type === 'timer') {
      return `<div class="dk-row"><span class="dk-read" data-live="${w.id}">${X.fmt(X.timerNow(w))}</span>
        <button class="btn btn-primary" type="button" data-dk="t-run">${w.running ? 'Pause' : 'Start'}</button><button class="btn" type="button" data-dk="t-reset">Reset</button></div>
        <div class="dk-row"><div class="seg seg-sm"><button type="button" data-dk="t-mode" data-val="down" aria-pressed="${w.mode === 'down'}">Count down</button><button type="button" data-dk="t-mode" data-val="up" aria-pressed="${w.mode === 'up'}">Count up</button></div>
        ${w.mode === 'down' ? `<label class="dk-inline">Minutes <input class="input" type="number" min="0" step="1" data-dk="t-min" value="${Math.round(w.dur / 60)}"></label>` : ''}</div>`;
    }
    if (w.type === 'countdown') {
      const local = w.target ? new Date(w.target - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
      return `<div class="dk-row"><span class="dk-read" data-live="${w.id}">${X.fmt(X.timerNow(w))}</span></div>
        <label class="field"><span class="field-label">Counting down to</span><input class="input" type="datetime-local" data-dk="target" value="${local}"></label>
        <label class="field"><span class="field-label">Text when it reaches zero (optional)</span><input class="input" data-dk="end" maxlength="40" value="${esc(w.end)}" placeholder="Like Starting now"></label>`;
    }
    if (w.type === 'counter') {
      return `<div class="dk-row"><button class="btn dk-step" type="button" data-dk="c-step" data-val="-1" aria-label="Minus">−</button><span class="dk-read">${w.value}</span><button class="btn btn-primary dk-step" type="button" data-dk="c-step" data-val="1" aria-label="Plus">+</button><button class="btn btn-quiet btn-small" type="button" data-dk="c-reset">Reset</button></div>
        <div class="dk-row"><label class="dk-inline">Goal <input class="input" type="number" min="0" data-dk="c-goal" value="${w.goal || ''}" placeholder="None"></label><label class="dk-inline">Each press <input class="input" type="number" min="1" data-dk="c-stepsize" value="${w.step}"></label></div>`;
    }
    if (w.type === 'text') {
      return `<textarea class="input" data-dk="text" rows="2" maxlength="300" aria-label="Text">${esc(w.text)}</textarea>
        <div class="seg seg-sm"><button type="button" data-dk="x-scroll" data-val="0" aria-pressed="${!w.scroll}">Still</button><button type="button" data-dk="x-scroll" data-val="1" aria-pressed="${w.scroll}">Scrolling</button></div>`;
    }
    if (w.type === 'checklist' || w.type === 'budget') {
      const rows = w.items.map((x, i) => `<div class="dk-item" data-i="${i}"><input type="checkbox" data-dk="l-done"${x.done ? ' checked' : ''} aria-label="${w.type === 'budget' ? 'Bought' : 'Done'}">
        <input class="input" data-dk="l-text" maxlength="60" value="${esc(x.t)}" placeholder="${w.type === 'budget' ? 'Item' : 'Thing to do'}" aria-label="Item">
        ${w.type === 'budget' ? `<input class="input dk-price" type="number" min="0" step="0.01" data-dk="l-price" value="${x.price || ''}" placeholder="£" aria-label="Price">` : ''}
        <button class="btn btn-quiet btn-small" type="button" data-dk="l-del" aria-label="Remove">×</button></div>`).join('');
      return `<div class="dk-items">${rows}</div><div class="dk-row"><button class="btn btn-small" type="button" data-dk="l-add">Add a line</button>${w.type === 'budget' ? `<label class="dk-inline">Budget £ <input class="input" type="number" min="0" step="0.5" data-dk="l-budget" value="${w.budget}"></label>` : ''}</div>`;
    }
    if (w.type === 'clock') {
      return `<label class="field"><span class="field-label">Time zone</span><select class="select" data-dk="tz">${ZONES.map(([z, n]) => `<option value="${z}"${z === w.tz ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
        <div class="seg seg-sm"><button type="button" data-dk="secs" data-val="1" aria-pressed="${w.seconds}">With seconds</button><button type="button" data-dk="secs" data-val="0" aria-pressed="${!w.seconds}">No seconds</button></div>`;
    }
    return '';
  }
  function paint() {
    if (!live) return;
    const typing = cards.contains(document.activeElement) && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);
    if (typing) return; // never repaint under someone typing
    const html = live.widgets.map((w) => {
      const def = X.DESK.find((d) => d.id === w.id);
      const pill = w.vis === 'live' ? '<span class="pill is-on">On screen</span>' : w.vis === 'preview' ? '<span class="pill is-pv">Preview</span>' : '<span class="pill">Off</span>';
      return `<details class="fold dk-card" data-id="${w.id}"${openCards.has(w.id) ? ' open' : ''}>
        <summary><span class="fold-icon dk-icon" aria-hidden="true">${ICON[w.type]}</span><span class="fold-text"><b>${def.name}</b><small>${esc(summary(w))}</small></span>${pill}<span class="fold-chev" aria-hidden="true"></span></summary>
        <div class="fold-body">
          ${Hub.visButtons(w.vis)}
          ${controls(w)}
          <div class="dk-look">
            <label class="dk-inline">Label <input class="input" data-dk="label" maxlength="40" value="${esc(w.label)}" placeholder="Optional, shows above"></label>
            <div class="dk-colours"><button type="button" data-dk="colour" data-val="brand" style="background:var(--brand)" aria-label="Brand colour" title="Brand colour"></button>${COLOURS.map((c) => `<button type="button" data-dk="colour" data-val="${c}" style="background:${c}" aria-label="Colour ${c}" aria-pressed="${c === w.color}"></button>`).join('')}<input type="color" data-dk="colour-pick" value="${w.color}" aria-label="Any colour"></div>
            <label class="dk-inline dk-size">Size <input type="range" min="40" max="250" step="5" data-dk="scale" value="${Math.round(w.scale * 100)}"></label>
          </div>
        </div></details>`;
    }).join('');
    if (cards._html !== html) { cards._html = html; cards.innerHTML = html; }
  }
  setInterval(() => {
    if (!live) return;
    live.widgets.forEach((w) => { const n = cards.querySelector(`[data-live="${w.id}"]`); if (n) n.textContent = X.fmt(X.timerNow(w)); });
  }, 500);

  document.getElementById('viewDesk').addEventListener('click', (e) => {
    const card = e.target.closest('[data-id]');
    if (!live || !card) return;
    const w = byId(card.dataset.id);
    const vb = e.target.closest('[data-vis]');
    if (vb && w) {
      w.vis = vb.dataset.vis;
      commit();
      Hub.toast(w.vis === 'live' ? `${X.DESK.find((d) => d.id === w.id).name} is on screen` : w.vis === 'preview' ? 'In preview: only you can see it' : 'Off', { tone: w.vis === 'live' ? 'goal' : 'info' });
      return;
    }
    const b = e.target.closest('[data-dk]');
    if (!b || !w || ['INPUT', 'TEXTAREA', 'SELECT'].includes(b.tagName)) return;
    const v = b.dataset.val;
    const now = Date.now();
    switch (b.dataset.dk) {
      case 't-run': if (w.running) { w.base = X.timerNow(w, now); w.running = false; } else { w.running = true; w.at = now; } break;
      case 't-reset': { const done = Hub.remember('desk', 'Timer reset.'); w.running = false; w.base = w.mode === 'up' ? 0 : w.dur; commit(); done(); return; }
      case 't-mode': w.mode = v; w.running = false; w.base = v === 'up' ? 0 : w.dur; break;
      case 'c-step': w.value += Number(v) * w.step; break;
      case 'c-reset': { const done = Hub.remember('desk', 'Counter reset.'); w.value = 0; commit(); done(); return; }
      case 'x-scroll': w.scroll = v === '1'; break;
      case 'l-add': w.items = w.items.concat({ t: '', done: false, price: 0 }); break;
      case 'l-del': { const done = Hub.remember('desk', 'Line removed.'); w.items.splice(Number(b.closest('[data-i]').dataset.i), 1); commit(); done(); return; }
      case 'secs': w.seconds = v === '1'; break;
      case 'colour': w.color = v === 'brand' ? ((Hub.streamer.look || {}).brand || '#e11d48') : v; break;
      default: return;
    }
    commit();
  });
  document.getElementById('viewDesk').addEventListener('change', (e) => {
    const t = e.target;
    if (!live || !t.dataset.dk) return;
    const w = byId(t.closest('[data-id]').dataset.id);
    if (!w) return;
    const i = t.closest('[data-i]') ? Number(t.closest('[data-i]').dataset.i) : -1;
    switch (t.dataset.dk) {
      case 'label': w.label = t.value; break;
      case 'colour-pick': w.color = t.value; break;
      case 'scale': w.scale = Number(t.value) / 100; break;
      case 't-min': w.dur = Math.max(0, Number(t.value) || 0) * 60; if (w.mode === 'down') { w.base = w.dur; w.running = false; } break;
      case 'target': w.target = new Date(t.value).getTime() || w.target; break;
      case 'end': w.end = t.value; break;
      case 'c-goal': w.goal = Math.max(0, Number(t.value) || 0); break;
      case 'c-stepsize': w.step = Math.max(1, Number(t.value) || 1); break;
      case 'text': w.text = t.value; break;
      case 'l-text': w.items[i].t = t.value; break;
      case 'l-done': w.items[i].done = t.checked; break;
      case 'l-price': w.items[i].price = Number(t.value) || 0; break;
      case 'l-budget': w.budget = Number(t.value) || 0; break;
      case 'tz': w.tz = t.value; break;
      default: return;
    }
    commit();
    setTimeout(() => { if (!cards.contains(document.activeElement) || !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) paint(); }, 0);
  });
  // The size slider moves the widget as you drag it, not just when you let go
  document.getElementById('viewDesk').addEventListener('input', (e) => {
    const t = e.target;
    if (!live || t.dataset.dk !== 'scale') return;
    const w = byId(t.closest('[data-id]').dataset.id);
    if (w) { w.scale = Number(t.value) / 100; ctl.paint(); }
  });
  cards.addEventListener('focusout', () => setTimeout(paint, 0));
})();
