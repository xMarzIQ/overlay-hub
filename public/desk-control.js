/*
  The Stream Desk page in the hub: add timers, a matchday countdown, counters, text, lists and your own match
  scoreboard, then run each one from its own card. Editors can use all of it.
*/
(() => {
  'use strict';
  const Hub = window.Hub;
  const X = window.ExtrasModel;
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const POS_NAMES = { tl: 'Top left', tc: 'Top middle', tr: 'Top right', ml: 'Middle left', mc: 'Middle', mr: 'Middle right', bl: 'Bottom left', bc: 'Bottom middle', br: 'Bottom right' };
  const KIND_NAMES = { todo: 'To-do list', shopping: 'Shopping list', top: 'Top list', tier: 'Tier list' };
  let live = null;
  const cards = document.getElementById('dkCards');

  const ctl = Hub.module('desk', {
    patchable: ['onAir', 'widgets'],
    onState(s) { live = s; paint(); },
    isShowing: (s) => s.onAir && s.widgets.some((w) => w.shown),
    tileSummary(s) {
      const shown = s.widgets.filter((w) => w.shown);
      const t = shown.find((w) => w.type === 'timer');
      return { text: shown.length ? `${shown.length} widget${shown.length === 1 ? '' : 's'} showing` : 'No widgets showing', small: t ? X.fmt(X.timerNow(t)) : '' };
    },
  });
  const commit = () => ctl.commit();
  const find = (node) => live.widgets.find((w) => w.id === node.closest('[data-id]').dataset.id);

  function add(type) {
    const base = { id: X.newId(), pos: 'tr', size: 'm', shown: false };
    const make = {
      timer: { type: 'timer', title: 'Starting soon', mode: 'down', base: 300, end: 'Starting now' },
      countdown: { type: 'timer', title: 'Matchday', mode: 'to', target: Date.now() + 3 * 864e5, end: 'It’s matchday' },
      counter: { type: 'counter', title: 'Counter', value: 0, step: 1 },
      text: { type: 'text', title: '', text: 'Your text here', style: 'headline', pos: 'bc' },
      todo: { type: 'list', kind: 'todo', title: 'To-do' },
      shopping: { type: 'list', kind: 'shopping', title: 'Shopping list', budget: 10 },
      top: { type: 'list', kind: 'top', title: 'Top 5' },
      tier: { type: 'list', kind: 'tier', title: 'Tier list' },
      match: { type: 'match', title: 'My match', a: 'Us', b: 'Them', pos: 'tl' },
    }[type];
    live.widgets = live.widgets.concat(X.widget(Object.assign(base, make)));
    commit();
  }

  function controls(w) {
    if (w.type === 'timer') {
      if (w.mode === 'to') {
        const local = new Date(w.target - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
        return `<div class="dk-row"><span class="dk-big">${X.fmt(X.timerNow(w))}</span></div><div class="dk-row"><label class="field"><span class="field-label">Counting down to</span><input class="input" type="datetime-local" data-dk="target" value="${local}"></label></div>
          <div class="dk-row"><input class="input" data-dk="end" maxlength="40" value="${esc(w.end)}" placeholder="Text when it reaches zero" aria-label="Text at zero"></div>`;
      }
      return `<div class="dk-row"><span class="dk-big" data-live-timer="${w.id}">${X.fmt(X.timerNow(w))}</span>
        <button class="btn btn-primary btn-small" type="button" data-dk="t-run">${w.running ? 'Pause' : 'Start'}</button><button class="btn btn-small" type="button" data-dk="t-reset">Reset</button></div>
        <div class="dk-row"><div class="seg seg-sm"><button type="button" data-dk="t-mode" data-val="down" aria-pressed="${w.mode === 'down'}">Count down</button><button type="button" data-dk="t-mode" data-val="up" aria-pressed="${w.mode === 'up'}">Count up</button></div>
        <input class="input" style="width:110px" type="number" min="0" data-dk="t-min" value="${Math.round((w.dur || w.base) / 60)}" aria-label="Minutes"><span class="note">min</span></div>
        <div class="dk-row"><input class="input" data-dk="end" maxlength="40" value="${esc(w.end)}" placeholder="Text when it reaches zero" aria-label="Text at zero"></div>`;
    }
    if (w.type === 'counter') {
      return `<div class="dk-row"><button class="btn" type="button" data-dk="c-step" data-val="-1">−</button><span class="dk-big">${w.value}</span><button class="btn btn-primary" type="button" data-dk="c-step" data-val="1">+</button><button class="btn btn-quiet btn-small" type="button" data-dk="c-reset">Reset</button></div>
        <div class="dk-row"><label class="field"><span class="field-label">Goal (0 for none)</span><input class="input" type="number" min="0" data-dk="c-goal" value="${w.goal}"></label><label class="field"><span class="field-label">Step</span><input class="input" type="number" min="1" data-dk="c-stepsize" value="${w.step}"></label></div>`;
    }
    if (w.type === 'text') {
      return `<div class="dk-row" style="width:100%"><textarea class="input" data-dk="text" rows="2" maxlength="300" aria-label="Text" style="width:100%">${esc(w.text)}</textarea></div>
        <div class="seg seg-sm"><button type="button" data-dk="x-style" data-val="headline" aria-pressed="${w.style === 'headline'}">Headline</button><button type="button" data-dk="x-style" data-val="ticker" aria-pressed="${w.style === 'ticker'}">Scrolling</button></div>`;
    }
    if (w.type === 'match') {
      return `<div class="dk-row"><input class="input" style="width:140px" data-dk="m-a" maxlength="24" value="${esc(w.a)}" aria-label="Your team"><button class="btn btn-small" type="button" data-dk="m-goal" data-val="a">+1</button>
        <span class="dk-big">${w.sa}–${w.sb}</span><button class="btn btn-small" type="button" data-dk="m-goal" data-val="b">+1</button><input class="input" style="width:140px" data-dk="m-b" maxlength="24" value="${esc(w.b)}" aria-label="Their team"></div>
        <div class="dk-row"><button class="btn btn-quiet btn-small" type="button" data-dk="m-undo">Undo goal</button><span class="note">Session: W ${w.w}, D ${w.d}, L ${w.l}</span>
        <button class="btn btn-small" type="button" data-dk="m-end">Full time: add to the tally</button><button class="btn btn-quiet btn-small" type="button" data-dk="m-tally0">Reset tally</button></div>
        <div class="dk-row" style="width:100%"><input class="input" data-dk="m-squad" value="${esc(w.squad.join(', '))}" placeholder="Squad list, separated by commas" aria-label="Squad"><button class="btn btn-small" type="button" data-dk="m-pick">Pick two teams</button></div>`;
    }
    if (w.type === 'list') {
      const rows = w.items.map((x, i) => `<div class="dk-item" data-i="${i}">
        ${w.kind === 'tier' ? `<select class="select" data-dk="l-tier" aria-label="Tier">${['S', 'A', 'B', 'C', 'D'].map((t) => `<option${t === x.tier ? ' selected' : ''}>${t}</option>`).join('')}</select>` : w.kind === 'top' ? `<span class="note">${i + 1}</span>` : `<input type="checkbox" data-dk="l-done"${x.done ? ' checked' : ''} aria-label="Done">`}
        <input class="input" data-dk="l-text" maxlength="60" value="${esc(x.t)}" aria-label="Item">
        ${w.kind === 'shopping' ? `<input class="input" style="width:90px" type="number" min="0" step="0.01" data-dk="l-price" value="${x.price || ''}" placeholder="£" aria-label="Price">` : '<span></span>'}
        <button class="btn btn-quiet btn-small" type="button" data-dk="l-del" aria-label="Remove">×</button></div>`).join('');
      return `<div class="dk-items">${rows}</div><div class="dk-row"><button class="btn btn-small" type="button" data-dk="l-add">Add item</button>${w.kind === 'shopping' ? `<label class="field"><span class="field-label">Budget, £</span><input class="input" type="number" min="0" step="0.5" data-dk="l-budget" value="${w.budget}"></label>` : ''}</div>`;
    }
    return '';
  }

  function paint() {
    if (!live) return;
    document.querySelectorAll('[data-dk="air"]').forEach((b) => b.setAttribute('aria-pressed', String((b.dataset.val === '1') === live.onAir)));
    if (cards.contains(document.activeElement) && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return; // don't repaint under someone typing
    const html = live.widgets.map((w) => `<article class="dk-card" data-id="${w.id}">
      <div class="dk-card-top"><input class="input" data-dk="title" maxlength="40" value="${esc(w.title)}" placeholder="${w.type === 'list' ? KIND_NAMES[w.kind] : 'Title (optional)'}" aria-label="Title">
        <div class="seg seg-sm"><button type="button" data-dk="show" data-val="1" aria-pressed="${w.shown}">Show</button><button type="button" data-dk="show" data-val="0" aria-pressed="${!w.shown}">Off</button></div></div>
      ${controls(w)}
      <div class="dk-row"><select class="select" data-dk="pos" aria-label="Place">${Object.entries(POS_NAMES).map(([k, v]) => `<option value="${k}"${k === w.pos ? ' selected' : ''}>${v}</option>`).join('')}</select>
        <select class="select" data-dk="size" aria-label="Size">${['s', 'm', 'l', 'xl'].map((k) => `<option value="${k}"${k === w.size ? ' selected' : ''}>${k.toUpperCase()}</option>`).join('')}</select>
        <button class="btn btn-quiet btn-small" type="button" data-dk="del">Remove</button></div></article>`).join('');
    if (cards._html !== html) { cards._html = html; cards.innerHTML = html || '<p class="note">No widgets yet. Add one above.</p>'; }
  }
  setInterval(() => {
    if (!live) return;
    live.widgets.filter((w) => w.type === 'timer').forEach((w) => { const n = cards.querySelector(`[data-id="${w.id}"] .dk-big`); if (n) n.textContent = X.fmt(X.timerNow(w)); });
  }, 500);

  document.getElementById('viewDesk').addEventListener('click', (e) => {
    const b = e.target.closest('[data-dk]');
    if (!b || !live || ['INPUT', 'TEXTAREA', 'SELECT'].includes(b.tagName)) return;
    const act = b.dataset.dk;
    const v = b.dataset.val;
    if (act === 'air') { live.onAir = v === '1'; commit(); return; }
    if (act === 'add') { add(b.dataset.type); return; }
    const w = find(b);
    if (!w) return;
    const now = Date.now();
    switch (act) {
      case 'show': w.shown = v === '1'; break;
      case 'del': live.widgets = live.widgets.filter((x) => x !== w); break;
      case 't-run': if (w.running) { w.base = X.timerNow(w, now); w.running = false; } else { w.running = true; w.at = now; } break;
      case 't-reset': w.running = false; w.base = w.mode === 'up' ? 0 : w.dur; break;
      case 't-mode': w.mode = v; w.running = false; w.base = v === 'up' ? 0 : w.dur || 300; break;
      case 'c-step': w.value += Number(v) * w.step; break;
      case 'c-reset': w.value = 0; break;
      case 'x-style': w.style = v; break;
      case 'm-goal': if (v === 'a') w.sa += 1; else w.sb += 1; w.lastGoal = v; break;
      case 'm-undo': if (w.sa || w.sb) { if (w.lastGoal === 'b' && w.sb) w.sb -= 1; else if (w.sa) w.sa -= 1; else w.sb -= 1; } break;
      case 'm-end': if (w.sa > w.sb) w.w += 1; else if (w.sa < w.sb) w.l += 1; else w.d += 1; w.sa = 0; w.sb = 0; break;
      case 'm-tally0': w.w = 0; w.d = 0; w.l = 0; break;
      case 'm-pick': {
        const sq = w.squad.slice().sort(() => Math.random() - 0.5);
        const half = Math.ceil(sq.length / 2);
        if (sq.length < 2) { Hub.toast('Add at least two names to the squad first.', { tone: 'bad' }); return; }
        Hub.toast(`Team 1: ${sq.slice(0, half).join(', ')}. Team 2: ${sq.slice(half).join(', ')}.`, { ms: 12000 });
        return;
      }
      case 'l-add': w.items = w.items.concat({ t: '', done: false, price: 0, tier: 'B' }); break;
      case 'l-del': w.items.splice(Number(b.closest('[data-i]').dataset.i), 1); break;
      default: return;
    }
    commit();
  });
  document.getElementById('viewDesk').addEventListener('change', (e) => {
    const t = e.target;
    if (!live || !t.dataset.dk) return;
    const w = find(t);
    if (!w) return;
    const i = t.closest('[data-i]') ? Number(t.closest('[data-i]').dataset.i) : -1;
    switch (t.dataset.dk) {
      case 'title': w.title = t.value; break;
      case 'pos': w.pos = t.value; break;
      case 'size': w.size = t.value; break;
      case 'end': w.end = t.value; break;
      case 'target': w.target = new Date(t.value).getTime() || w.target; break;
      case 't-min': w.dur = Math.max(0, Number(t.value) || 0) * 60; w.base = w.mode === 'up' ? 0 : w.dur; w.running = false; break;
      case 'c-goal': w.goal = Math.max(0, Number(t.value) || 0); break;
      case 'c-stepsize': w.step = Math.max(1, Number(t.value) || 1); break;
      case 'text': w.text = t.value; break;
      case 'm-a': w.a = t.value; break;
      case 'm-b': w.b = t.value; break;
      case 'm-squad': w.squad = t.value.split(',').map((x) => x.trim()).filter(Boolean); break;
      case 'l-text': w.items[i].t = t.value; break;
      case 'l-done': w.items[i].done = t.checked; break;
      case 'l-price': w.items[i].price = Number(t.value) || 0; break;
      case 'l-tier': w.items[i].tier = t.value; break;
      case 'l-budget': w.budget = Number(t.value) || 0; break;
      default: return;
    }
    commit();
    setTimeout(paint, 0);
  });
})();
