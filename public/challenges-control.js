/*
  Challenges in the hub: add any number of challenge pieces (bingo, wheel, tracker, checklist, counters, versus, budget,
  lives, timers, forfeits, mystery, race, milestones, random challenge, teams, leaderboard). Each has Off, Show preview
  and Show on screen, a colour, a size, a lock and Move to; save any of them to the library to reuse later.
*/
(() => {
  'use strict';
  const Hub = window.Hub;
  const X = window.ExtrasModel;
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const COLOURS = ['#ffffff', '#ffd166', '#ff5c6c', '#2ee59d', '#38bdf8', '#111827'];
  const ICON = { bingo: '▦', wheel: '◔', tracker: '✓', checklist: '☑', counter: '#', versus: '⚔', budget: '£', lives: '♥', timer: '⏱', forfeits: '!', mystery: '?', race: '⚑', milestones: '◆', generator: '⚄', teams: '👥', leaderboard: '♛' };
  const PRESETS = [['', 'Move to…'], ['240,150', 'Top left'], ['960,150', 'Top'], ['1680,150', 'Top right'], ['240,540', 'Left'], ['960,540', 'Centre'], ['1680,540', 'Right'], ['240,930', 'Bottom left'], ['960,930', 'Bottom'], ['1680,930', 'Bottom right']];
  const STATES = { open: 'To do', done: 'Done', failed: 'Failed', skipped: 'Skipped', cancelled: 'Cancelled', unlocked: 'Unlocked' };
  let live = null;
  const armed = {}; // second-tap confirmations
  const cards = document.getElementById('chCards');
  const libBox = document.getElementById('chLib');
  const openCards = new Set(JSON.parse(localStorage.getItem('ch-open') || '[]'));
  cards.addEventListener('toggle', (e) => {
    const d = e.target;
    if (!d.dataset || !d.dataset.id) return;
    if (d.open) openCards.add(d.dataset.id); else openCards.delete(d.dataset.id);
    localStorage.setItem('ch-open', JSON.stringify(Array.from(openCards)));
  }, true);

  const ctl = Hub.module('challenges', {
    patchable: ['widgets', 'lib'],
    onState(s) { live = s; paint(); },
    isShowing: (s) => s.widgets.some((w) => w.vis === 'live'),
    liveCount: (s) => s.widgets.filter((w) => w.vis === 'live').length,
    tileSummary(s) {
      const on = s.widgets.filter((w) => w.vis === 'live');
      return { text: on.length ? `${on.length} on screen` : s.widgets.length ? 'Nothing on screen' : 'No challenges yet', small: on.map((w) => w.title || X.CH_NAME[w.kind]).join(', ') };
    },
    onDrag(id, x, y) { const w = live && live.widgets.find((z) => z.id === id); if (w) { w.x = x; w.y = y; ctl.commit(); } },
    visItems: (s) => s.widgets.map((w) => [w.id, w]),
  });
  const commit = () => ctl.commit();
  const redraw = () => { cards._html = ''; paint(); };
  const arm = (key) => { if (Date.now() - (armed[key] || 0) < 4000) { delete armed[key]; return true; } armed[key] = Date.now(); redraw(); setTimeout(redraw, 4100); return false; };
  const armedText = (key, text) => (Date.now() - (armed[key] || 0) < 4000 ? 'Tap again' : text);
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i -= 1) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  /* ---------- Editors ---------- */
  const inp = (path, value, attrs = '') => `<input class="input" data-ch-in="${path}" value="${esc(value)}" ${attrs}>`;
  const num = (path, value, attrs = '') => `<input class="input ch-num" type="number" data-ch-in="${path}" value="${value == null ? '' : value}" ${attrs}>`;
  const sel = (path, value, opts) => `<select class="select" data-ch-in="${path}">${opts.map(([v, l]) => `<option value="${v}"${String(v) === String(value) ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
  const toggle = (act, on, label) => `<button type="button" class="btn btn-small ch-tog" data-ch="${act}" aria-pressed="${!!on}">${label}: ${on ? 'On' : 'Off'}</button>`;
  const btn = (act, label, extra = '', cls = '') => `<button type="button" class="btn btn-small ${cls}" data-ch="${act}" ${extra}>${label}</button>`;
  // A list of items with the columns each kind needs
  function listEditor(w, cols, placeholder) {
    const rows = w.items.map((x, i) => `<div class="ch-row" data-i="${i}">
      ${inp(`items.${i}.t`, x.t, `maxlength="80" placeholder="${placeholder}" aria-label="Name"`)}
      ${cols.includes('who') ? inp(`items.${i}.who`, x.who, 'maxlength="40" placeholder="Who" aria-label="Who" class="input ch-who"') : ''}
      ${cols.includes('state') ? sel(`items.${i}.s`, x.s, (w.kind === 'milestones' ? ['open', 'unlocked', 'done'] : w.kind === 'forfeits' ? ['open', 'done', 'skipped', 'cancelled'] : ['open', 'done', 'failed', 'skipped']).map((k) => [k, w.kind === 'milestones' && k === 'open' ? 'Locked' : STATES[k]])) : ''}
      ${cols.includes('p') ? num(`items.${i}.p`, x.p, 'aria-label="Points" title="Points"') : ''}
      ${cols.includes('d') ? sel(`items.${i}.d`, x.d, [['', 'Any'], ['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard']]) : ''}
      ${cols.includes('cat') ? inp(`items.${i}.cat`, x.cat, 'maxlength="30" placeholder="Category" aria-label="Category" class="input ch-who"') : ''}
      ${cols.includes('w') ? num(`items.${i}.w`, x.w, 'min="0" max="100" aria-label="Weight" title="Weight"') : ''}
      ${cols.includes('tgt') ? num(`items.${i}.tgt`, x.tgt, 'min="0" aria-label="Target" title="Target"') : ''}
      ${cols.includes('n') ? `${btn('n-down', '−')}<b class="ch-val">${x.n}</b>${btn('n-up', '+')}` : ''}
      ${cols.includes('l') ? num(`items.${i}.l`, x.l, 'min="0" aria-label="Losses" title="Losses"') : ''}
      ${cols.includes('on') ? `<button type="button" class="btn btn-small ch-tog" data-ch="item-on" aria-pressed="${x.on}">${x.on ? 'In' : 'Out'}</button>` : ''}
      ${cols.includes('hide') ? `<button type="button" class="btn btn-small ch-tog" data-ch="item-hide" aria-pressed="${x.hide}">${x.hide ? 'Hidden' : 'Shown'}</button>` : ''}
      ${cols.includes('finish') ? (x.at ? `<small class="ch-small">Finished</small>` : btn('finish', 'Finished', w.start ? '' : 'disabled')) : ''}
      ${btn('item-del', '×', 'aria-label="Remove"', 'btn-quiet')}
    </div>`).join('');
    return `<div class="ch-rows">${rows || '<p class="note">Nothing added yet.</p>'}</div>
      <div class="ch-add"><input class="input" data-ch-new maxlength="80" placeholder="Add: ${placeholder}" aria-label="Add a new one"><button type="button" class="btn btn-small btn-primary" data-ch="item-add">Add</button></div>`;
  }
  const statsToggles = (w) => `<div class="btn-row">${toggle('show-list', w.show.list, 'List on stream')}${toggle('show-stats', w.show.stats, 'Totals on stream')}</div>`;

  function editor(w) {
    switch (w.kind) {
      case 'bingo': {
        const cells = w.cells.map((c, i) => `<div class="hn-ed${c.done ? ' is-found' : ''}"><input class="input" data-ch-in="cells.${i}.t" maxlength="60" value="${esc(c.t)}" placeholder="${w.free && i === (w.size * w.size - 1) / 2 ? 'FREE' : `Square ${i + 1}`}" aria-label="Square ${i + 1}"><button type="button" data-ch="cell" data-i="${i}" aria-pressed="${c.done}"${c.t ? '' : ' disabled'}>${c.done ? 'Done ✓' : 'Tick'}</button></div>`).join('');
        return `<div class="gm-ctl-row"><span class="gm-ctl-name">Grid</span><div class="seg" role="group">${[3, 4, 5].map((n) => `<button type="button" data-ch="size" data-val="${n}" aria-pressed="${w.size === n}">${n} × ${n}</button>`).join('')}</div></div>
          <div class="hn-edit" style="--n:${w.size}">${cells}</div>
          <div class="btn-row">${toggle('free', w.free, 'Free middle square')}${btn('shuffle', 'Shuffle squares')}${btn('clear-ticks', armedText(`${w.id}clear`, 'Clear ticks'))}</div>
          <div class="gm-ctl-row"><span class="gm-ctl-name">Win when</span>${sel('rule', w.rule, [['none', 'No winning rule'], ['line', 'A line is done'], ['all', 'Every square is done'], ['count', 'A number of squares']])}${w.rule === 'count' ? num('ruleN', w.ruleN, 'min="1" max="25"') : ''}</div>
          <div class="btn-row">${toggle('show-left', w.show.left, 'Count on stream')}${toggle('show-pct', w.show.pct, 'Percentage on stream')}</div>`;
      }
      case 'wheel': {
        const spinning = w.spin && Date.now() < w.spin.at + w.spin.dur * 1000;
        return `${listEditor(w, ['w', 'on'], 'an option')}
          <div class="btn-row">${toggle('weighted', w.weighted, 'Use weights')}${toggle('remove-win', w.removeWin, 'Remove each winner')}${sel('dur', w.dur, [[3, '3 s spin'], [6, '6 s spin'], [10, '10 s spin'], [15, '15 s spin']])}</div>
          <div class="btn-row">${btn('spin', spinning ? 'Spinning…' : 'Spin', spinning ? 'disabled' : '', 'btn-primary')}${btn('test-spin', 'Test spin (preview only)', spinning ? 'disabled' : '')}${btn('wheel-undo', 'Undo last result', w.hist.length ? '' : 'disabled')}${btn('wheel-restore', 'Put removed options back')}</div>
          ${w.hist.length ? `<p class="note">Results: ${w.hist.slice(0, 8).map((h) => `${esc(h.t)}${h.test ? ' (test)' : ''}`).join(', ')}</p>` : ''}
          <p class="note">The server picks the result, so it's the same for everyone. Test spins only show in the preview and aren't counted.</p>`;
      }
      case 'tracker': case 'checklist':
        return listEditor(w, w.kind === 'checklist' ? ['state', 'p', 'd'] : ['state', 'p'], 'a challenge') + statsToggles(w) + `<div class="btn-row">${btn('reset-states', armedText(`${w.id}reset`, 'Start again'))}</div>`;
      case 'counter':
        return `<div class="ch-counter">${btn('cnt-down', `− ${w.step}`)}<b class="ch-val ch-val-big">${w.value}</b>${btn('cnt-up', `+ ${w.step}`, '', 'btn-primary')}</div>
          <div class="ch-grid4"><label class="field"><span class="field-label">Step</span>${num('step', w.step, 'min="1"')}</label><label class="field"><span class="field-label">Target</span>${num('target', w.target || '', 'min="0" placeholder="None"')}</label><label class="field"><span class="field-label">Lowest</span>${num('min', w.min, 'placeholder="None"')}</label><label class="field"><span class="field-label">Highest</span>${num('max', w.max, 'placeholder="None"')}</label></div>
          <div class="btn-row">${btn('cnt-reset', armedText(`${w.id}cnt`, `Reset to ${w.start}`))}<label class="dk-inline">Starts at ${num('start', w.start)}</label></div>`;
      case 'versus':
        return `${listEditor(w, ['n'], 'a player or team')}
          <div class="ch-grid4"><label class="field"><span class="field-label">Points per tap</span>${num('step', w.step, 'min="1"')}</label><label class="field"><span class="field-label">First to</span>${num('target', w.target || '', 'min="0" placeholder="No target"')}</label></div>
          <div class="btn-row">${toggle('show-winner', w.showWinner, 'Show the winner on stream')}${btn('round', `Next round (now ${w.round})`)}${btn('scores-reset', armedText(`${w.id}vs`, 'Reset scores'))}</div>${statsToggles(w)}`;
      case 'budget':
        return `<div class="ch-grid4"><label class="field"><span class="field-label">Budget</span>${num('start', w.start, 'min="0" step="0.01"')}</label><label class="field"><span class="field-label">Currency</span>${inp('cur', w.cur, 'maxlength="4"')}</label></div>
          <div class="ch-add"><input class="input" id="chSpendT-${w.id}" maxlength="80" placeholder="What was it?"><input class="input ch-num" type="number" step="0.01" id="chSpendN-${w.id}" placeholder="Amount"><select class="select" id="chSpendK-${w.id}"><option value="spend">Spent</option><option value="refund">Refund</option><option value="extra">Money in</option></select><button type="button" class="btn btn-small btn-primary" data-ch="spend">Add</button></div>
          <div class="ch-rows">${w.items.map((x, i) => `<div class="ch-row" data-i="${i}"><span class="ch-led">${esc(x.t)}</span><b class="${x.n < 0 ? 'ch-neg' : 'ch-pos'}">${x.n < 0 ? '−' : '+'}${esc(w.cur)}${Math.abs(x.n).toFixed(2)}</b>${btn('item-del', '×', 'aria-label="Remove"', 'btn-quiet')}</div>`).join('') || '<p class="note">No spending yet.</p>'}</div>
          <div class="btn-row">${toggle('warn', w.warn, 'Show red when over budget')}</div>`;
      case 'lives':
        return `<div class="ch-counter">${btn('life-down', '− Lose a life')}<b class="ch-val ch-val-big">${w.unlimited ? w.left : `${w.left} / ${w.max}`}</b>${btn('life-up', '+ Add a life', '', 'btn-primary')}</div>
          <div class="ch-grid4"><label class="field"><span class="field-label">Most lives</span>${num('max', w.max, 'min="1" max="99"')}</label></div>
          <div class="btn-row">${btn('life-reset', 'Give back every life')}${toggle('unlimited', w.unlimited, 'No maximum')}${toggle('out', w.out, 'Show "Out!" at zero')}</div>`;
      case 'timer': {
        const t = X.timerNow(w, Date.now());
        return `<div class="ch-counter"><b class="ch-val ch-val-big" data-ch-clock="${w.id}">${X.fmt(t)}</b></div>
          <div class="btn-row">${btn('t-run', w.running ? 'Pause' : 'Start', '', 'btn-primary')}${btn('t-adj', '−1 min', 'data-val="-60"')}${btn('t-adj', '−10 s', 'data-val="-10"')}${btn('t-adj', '+10 s', 'data-val="10"')}${btn('t-adj', '+1 min', 'data-val="60"')}${btn('t-lap', 'Lap / finish time')}${btn('t-reset', armedText(`${w.id}t`, 'Reset'))}</div>
          <div class="gm-ctl-row"><span class="gm-ctl-name">Counts</span><div class="seg" role="group"><button type="button" data-ch="t-mode" data-val="up" aria-pressed="${w.mode === 'up'}">Up</button><button type="button" data-ch="t-mode" data-val="down" aria-pressed="${w.mode === 'down'}">Down</button></div>${w.mode === 'down' ? `<label class="dk-inline">From (minutes) ${num('durMin', Math.round(w.dur / 6) / 10, 'min="0.1" step="0.5"')}</label>` : ''}</div>
          ${w.laps.length ? `<p class="note">Times: ${w.laps.map((x) => X.fmt(x)).join(', ')} ${btn('t-laps-clear', 'Clear times', '', 'btn-quiet')}</p>` : ''}`;
      }
      case 'forfeits':
        return `${listEditor(w, ['who', 'state'], 'a forfeit')}<div class="btn-row">${btn('pick', 'Pick a random forfeit', '', 'btn-primary')}${w.pick ? btn('pick-clear', 'Clear the pick') : ''}</div>`;
      case 'mystery':
        return `${listEditor(w, ['hide', 'state'], 'a hidden challenge')}<div class="btn-row">${btn('reveal-next', 'Reveal the next one', '', 'btn-primary')}${btn('reveal-random', 'Reveal a random one')}${btn('hide-all', 'Hide them all again')}</div><p class="note">Hidden challenges only show on stream once you reveal them.</p>`;
      case 'race':
        return `${listEditor(w, ['state', 'finish'], 'a racer')}<div class="btn-row">${btn('race-start', w.start ? 'Restart the clock' : 'Start the race', '', 'btn-primary')}${btn('race-reset', armedText(`${w.id}race`, 'Reset the race'))}</div>${statsToggles(w)}<p class="note">Press Finished as each racer finishes; their time is taken from the start. Set a racer to Skipped if they drop out.</p>`;
      case 'milestones':
        return `${listEditor(w, ['tgt', 'n', 'state'], 'a milestone, like 10 challenges')}<p class="note">Use + to count progress. A milestone unlocks when it reaches its target; mark it Done once its reward has happened.</p>`;
      case 'generator':
        return `${listEditor(w, ['cat', 'd', 'state'], 'a challenge idea')}<div class="btn-row">${btn('pick', w.pick ? 'Reroll' : 'Pick a random challenge', '', 'btn-primary')}${w.pick ? btn('pick-done', 'Mark the pick done') : ''}</div><p class="note">Picks skip anything marked Done.</p>`;
      case 'teams':
        return `<label class="field"><span class="field-label">Players, one per line</span><textarea class="input ch-names" data-ch-names rows="5">${esc(w.items.map((x) => x.t).join('\n'))}</textarea></label>
          <div class="btn-row"><label class="dk-inline">Teams ${num('count', w.count, 'min="2" max="8"')}</label>${btn('teams-make', w.teams.length ? 'Shuffle the teams again' : 'Make random teams', '', 'btn-primary')}</div>
          ${w.teams.map((t, i) => `<div class="ch-row">${inp(`teams.${i}.name`, t.name, `maxlength="30" placeholder="Team ${i + 1}"`)}<small class="ch-small">${t.who.map(esc).join(', ')}</small></div>`).join('')}`;
      case 'leaderboard':
        return listEditor(w, ['p', 'n', 'l'], 'a player') + `<div class="btn-row">${btn('scores-reset', armedText(`${w.id}vs`, 'Reset everyone to zero'))}</div><p class="note">Points, wins (±) and losses for each player; the table sorts itself by points.</p>`;
      default: return '';
    }
  }
  function summary(w) {
    const items = w.items.filter((x) => x.t);
    const done = items.filter((x) => x.s === 'done').length;
    switch (w.kind) {
      case 'bingo': { const got = w.cells.filter((c) => c.t && c.done).length; return `${got} of ${w.cells.filter((c) => c.t).length} done`; }
      case 'wheel': return w.hist.length ? `Last: ${w.hist[0].t}` : `${items.filter((x) => x.on).length} options`;
      case 'counter': return `${w.value}${w.target ? ` of ${w.target}` : ''}`;
      case 'lives': return w.unlimited ? `${w.left} lives` : `${w.left} of ${w.max} lives`;
      case 'timer': return `${X.fmt(X.timerNow(w, Date.now()))}${w.running ? ', running' : ''}`;
      case 'budget': { const n = items.reduce((a, x) => a + x.n, 0); return `${w.cur}${(w.start + n).toFixed(2)} left`; }
      case 'teams': return w.teams.length ? `${w.teams.length} teams` : `${items.length} players`;
      default: return items.length ? `${done} of ${items.length} done` : 'Empty';
    }
  }

  function paint() {
    if (!live) return;
    const typing = cards.contains(document.activeElement) && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);
    if (typing) return;
    const recent = Hub.recentColours().filter((c) => !COLOURS.includes(c));
    const html = live.widgets.map((w) => {
      const pill = w.vis === 'live' ? '<span class="pill is-on">On screen</span>' : w.vis === 'preview' ? '<span class="pill is-pv">Preview</span>' : '<span class="pill">Off</span>';
      return `<details class="fold dk-card" data-id="${w.id}"${openCards.has(w.id) ? ' open' : ''}>
        <summary><span class="fold-icon dk-icon" aria-hidden="true">${ICON[w.kind]}</span><span class="fold-text"><b>${esc(w.title || X.CH_NAME[w.kind])}</b><small>${esc(X.CH_NAME[w.kind])}: ${esc(summary(w))}</small></span>${pill}<span class="fold-chev" aria-hidden="true"></span></summary>
        <div class="fold-body">
          ${Hub.visButtons(w.vis)}
          <label class="field"><span class="field-label">Title on stream</span>${inp('title', w.title, `maxlength="60" placeholder="${esc(X.CH_NAME[w.kind])}"`)}</label>
          ${editor(w)}
          <div class="dk-look">
            <div class="dk-colours"><button type="button" data-ch="colour" data-val="brand" style="background:var(--brand)" aria-label="Brand colour" title="Brand colour"></button>${COLOURS.concat(recent).map((c) => `<button type="button" data-ch="colour" data-val="${c}" style="background:${c}" aria-label="Colour ${c}" aria-pressed="${c === w.color}"${COLOURS.includes(c) ? '' : ' class="recent"'}></button>`).join('')}<input type="color" data-ch-in="colour" value="${w.color}" aria-label="Any colour"></div>
            <label class="dk-inline dk-size">Size <input type="range" min="30" max="250" step="5" data-ch-in="scale" value="${Math.round(w.scale * 100)}"${w.lock ? ' disabled' : ''}></label>
            <button type="button" class="btn btn-small lock-btn" data-ch="lock" aria-pressed="${!!w.lock}">${w.lock ? 'Locked' : 'Lock position'}</button>
            <select class="select preset" data-ch-in="preset" aria-label="Move to"${w.lock ? ' disabled' : ''}>${PRESETS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
          </div>
          <div class="btn-row ch-actions">${btn('duplicate', 'Duplicate')}${btn('save-lib', 'Save to library')}${btn('remove', armedText(`${w.id}del`, 'Remove'), '', 'btn-quiet')}</div>
        </div></details>`;
    }).join('') || '<p class="note ch-none">No challenges yet. Pick one above and press Add.</p>';
    if (cards._html !== html) { cards._html = html; cards.innerHTML = html; }
    // When a wheel finishes spinning, the buttons come back by themselves
    const ends = live.widgets.filter((w) => w.kind === 'wheel' && w.spin).map((w) => w.spin.at + w.spin.dur * 1000 - Date.now()).filter((t) => t > 0);
    clearTimeout(paint._t);
    if (ends.length) paint._t = setTimeout(redraw, Math.min(...ends) + 150);
    const lib = live.lib.map((x) => `<div class="setup-row" data-lib="${x.id}"><b>${esc(x.name)}</b><small>${esc(X.CH_NAME[x.kind])}</small><button class="btn btn-small btn-primary" type="button" data-ch="lib-load">Use</button><button class="btn btn-small btn-quiet" type="button" data-ch="lib-del">${armedText(`lib${x.id}`, 'Delete')}</button></div>`).join('') || '<p class="note">Saved grids, wheels and lists appear here.</p>';
    if (libBox._html !== lib) { libBox._html = lib; libBox.innerHTML = lib; }
  }
  // Running timers tick in the hub too
  setInterval(() => {
    if (!live) return;
    live.widgets.forEach((w) => { if (w.kind === 'timer' && w.running) { const el = document.querySelector(`[data-ch-clock="${w.id}"]`); if (el) el.textContent = X.fmt(X.timerNow(w, Date.now())); } });
  }, 500);

  function addWidget(kind, data) {
    const base = Object.assign({}, data || {}, { kind, id: X.newId(), vis: 'off' });
    if (!data) {
      const n = live.widgets.length % 6;
      Object.assign(base, { x: 480 + (n % 3) * 480, y: 300 + Math.floor(n / 3) * 420 });
      if (kind === 'wheel') base.items = ['Option 1', 'Option 2', 'Option 3', 'Option 4'].map((t) => ({ t }));
      if (kind === 'versus') base.items = [{ t: 'Player 1' }, { t: 'Player 2' }];
    }
    const w = X.chWidget(base);
    live.widgets.push(w);
    openCards.add(w.id);
    localStorage.setItem('ch-open', JSON.stringify(Array.from(openCards)));
    commit();
    return w;
  }
  async function serverSpin(w, test) {
    try { await Hub.call('POST', `/api/streamers/${Hub.streamer.id}/challenges/spin`, { widget: w.id, test }); } catch (err) { Hub.toast(err.message || 'Couldn’t spin.', { tone: 'warn' }); }
  }

  const view = document.getElementById('viewChallenges');
  view.addEventListener('click', (e) => {
    if (!live) return;
    if (e.target.closest('[data-ch="add"]')) { const k = document.getElementById('chKind').value; addWidget(k); Hub.toast(`${X.CH_NAME[k]} added. It starts Off.`); return; }
    const libRow = e.target.closest('[data-lib]');
    if (libRow) {
      const x = live.lib.find((y) => y.id === libRow.dataset.lib);
      if (!x) return;
      if (e.target.closest('[data-ch="lib-load"]')) { const w = addWidget(x.kind, x.data); w.title = x.name; commit(); Hub.toast(`${x.name} added from the library. It starts Off.`); }
      if (e.target.closest('[data-ch="lib-del"]') && arm(`lib${x.id}`)) { live.lib = live.lib.filter((y) => y !== x); commit(); }
      return;
    }
    const card = e.target.closest('[data-id]');
    if (!card) return;
    const w = live.widgets.find((z) => z.id === card.dataset.id);
    if (!w) return;
    const vb = e.target.closest('[data-vis]');
    if (vb) { w.vis = vb.dataset.vis; commit(); return; }
    const b = e.target.closest('[data-ch]');
    if (!b) return;
    const row = b.closest('[data-i]');
    const i = row ? Number(row.dataset.i) : Number(b.dataset.i);
    const it = Number.isFinite(i) ? w.items[i] : null;
    const v = b.dataset.val;
    const open = () => w.items.filter((x) => x.t && x.s === 'open');
    switch (b.dataset.ch) {
      case 'colour': w.color = v === 'brand' ? ((Hub.streamer.look || {}).brand || '#e11d48') : v; break;
      case 'lock': w.lock = !w.lock; break;
      case 'duplicate': addWidget(w.kind, Object.assign(JSON.parse(JSON.stringify(w)), { title: `${w.title || X.CH_NAME[w.kind]} copy` })); return;
      case 'save-lib': {
        const data = JSON.parse(JSON.stringify(w));
        ['id', 'vis', 'spin', 'hist'].forEach((k) => delete data[k]);
        const name = w.title || X.CH_NAME[w.kind];
        const same = live.lib.find((y) => y.name === name && y.kind === w.kind);
        if (same) same.data = data; else live.lib.push({ id: X.newId(), name, kind: w.kind, data });
        Hub.toast(same ? `Updated “${name}” in the library.` : `Saved “${name}” to the library.`, { tone: 'good' });
        break;
      }
      case 'remove': if (!arm(`${w.id}del`)) return; { const done = Hub.remember('challenges', 'Challenge removed.'); live.widgets = live.widgets.filter((z) => z !== w); commit(); done(); } return;
      case 'item-add': {
        const box = card.querySelector('[data-ch-new]');
        const t = box && box.value.trim();
        if (!t) { Hub.toast('Type a name first.'); return; }
        w.items.push(X.chWidget({ kind: w.kind, items: [{ t, hide: w.kind === 'mystery' }] }).items[0]);
        box.value = '';
        break;
      }
      case 'item-del': if (it) { const done = Hub.remember('challenges', 'Removed.'); w.items.splice(i, 1); commit(); done(); } return;
      case 'item-on': if (it) it.on = !it.on; break;
      case 'item-hide': if (it) it.hide = !it.hide; break;
      case 'n-up': if (it) { it.n += w.kind === 'versus' ? w.step : 1; if (w.kind === 'milestones' && it.tgt && it.n >= it.tgt && it.s === 'open') it.s = 'unlocked'; } break;
      case 'n-down': if (it) it.n -= w.kind === 'versus' ? w.step : 1; break;
      case 'show-list': w.show.list = !w.show.list; break;
      case 'show-stats': w.show.stats = !w.show.stats; break;
      case 'show-left': w.show.left = !w.show.left; break;
      case 'show-pct': w.show.pct = !w.show.pct; break;
      // Bingo
      case 'size': w.size = Number(v); w.cells = X.chWidget(w).cells; break;
      case 'cell': { const c = w.cells[i]; c.done = !c.done; c.at = c.done ? Date.now() : 0; break; }
      case 'free': w.free = !w.free; break;
      case 'shuffle': { const done = Hub.remember('challenges', 'Squares shuffled.'); w.cells = shuffle(w.cells.slice()); commit(); done(); } return;
      case 'clear-ticks': if (!arm(`${w.id}clear`)) return; { const done = Hub.remember('challenges', 'Ticks cleared.'); w.cells.forEach((c) => { c.done = false; c.at = 0; }); commit(); done(); } return;
      // Wheel
      case 'weighted': w.weighted = !w.weighted; break;
      case 'remove-win': w.removeWin = !w.removeWin; break;
      case 'spin': serverSpin(w, false); return;
      case 'test-spin': serverSpin(w, true); return;
      case 'wheel-undo': Hub.call('POST', `/api/streamers/${Hub.streamer.id}/challenges/undo-spin`, { widget: w.id }).catch((err) => Hub.toast(err.message, { tone: 'warn' })); return;
      case 'wheel-restore': w.items.forEach((x) => { x.on = true; }); break;
      // Lists
      case 'reset-states': if (!arm(`${w.id}reset`)) return; { const done = Hub.remember('challenges', 'Started again.'); w.items.forEach((x) => { x.s = 'open'; x.at = 0; }); commit(); done(); } return;
      case 'pick': { const pool = open().filter((x) => x.id !== w.pick); if (!pool.length) { Hub.toast('Nothing left to pick.'); return; } w.pick = pool[Math.floor(Math.random() * pool.length)].id; w.hist = [w.pick].concat(w.hist).slice(0, 30); break; }
      case 'pick-clear': w.pick = ''; break;
      case 'pick-done': { const p = w.items.find((x) => x.id === w.pick); if (p) { p.s = 'done'; p.at = Date.now(); } w.pick = ''; break; }
      case 'reveal-next': { const h = w.items.find((x) => x.t && x.hide); if (!h) { Hub.toast('Everything is revealed.'); return; } h.hide = false; break; }
      case 'reveal-random': { const hs = w.items.filter((x) => x.t && x.hide); if (!hs.length) { Hub.toast('Everything is revealed.'); return; } hs[Math.floor(Math.random() * hs.length)].hide = false; break; }
      case 'hide-all': w.items.forEach((x) => { x.hide = true; }); break;
      // Counter and lives
      case 'cnt-up': w.value = w.max != null ? Math.min(w.max, w.value + w.step) : w.value + w.step; break;
      case 'cnt-down': w.value = w.min != null ? Math.max(w.min, w.value - w.step) : w.value - w.step; break;
      case 'cnt-reset': if (!arm(`${w.id}cnt`)) return; { const done = Hub.remember('challenges', 'Counter reset.'); w.value = w.start; commit(); done(); } return;
      case 'life-down': w.left = Math.max(0, w.left - 1); break;
      case 'life-up': w.left = w.unlimited ? w.left + 1 : Math.min(w.max, w.left + 1); break;
      case 'life-reset': w.left = w.max; break;
      case 'unlimited': w.unlimited = !w.unlimited; break;
      case 'out': w.out = !w.out; break;
      // Versus and leaderboard
      case 'show-winner': w.showWinner = !w.showWinner; break;
      case 'round': w.round += 1; break;
      case 'scores-reset': if (!arm(`${w.id}vs`)) return; { const done = Hub.remember('challenges', 'Scores reset.'); w.items.forEach((x) => { x.n = 0; x.p = 0; x.l = 0; }); w.round = 1; commit(); done(); } return;
      // Budget
      case 'spend': {
        const t = card.querySelector(`#chSpendT-${w.id}`).value.trim();
        const amount = Math.abs(Number(card.querySelector(`#chSpendN-${w.id}`).value));
        const kind = card.querySelector(`#chSpendK-${w.id}`).value;
        if (!t || !amount) { Hub.toast('Add what it was and the amount.'); return; }
        w.items.push(X.chWidget({ kind: 'budget', items: [{ t, n: kind === 'spend' ? -amount : amount, cat: kind, at: Date.now() }] }).items[0]);
        break;
      }
      case 'warn': w.warn = !w.warn; break;
      // Timer
      case 't-run': { const now = Date.now(); if (w.running) { w.base = X.timerNow(w, now); w.running = false; } else { w.at = now; w.running = true; } break; }
      case 't-adj': { const now = Date.now(); w.base = Math.max(0, X.timerNow(w, now) + Number(v)); w.at = now; break; }
      case 't-lap': w.laps.push(Math.round(w.mode === 'down' ? w.dur - X.timerNow(w, Date.now()) : X.timerNow(w, Date.now()))); break;
      case 't-laps-clear': w.laps = []; break;
      case 't-reset': if (!arm(`${w.id}t`)) return; w.running = false; w.base = w.mode === 'down' ? w.dur : 0; w.at = Date.now(); break;
      case 't-mode': w.mode = v; w.running = false; w.base = v === 'down' ? w.dur : 0; break;
      // Race
      case 'race-start': w.start = Date.now(); w.items.forEach((x) => { x.at = 0; if (x.s === 'done') x.s = 'open'; }); break;
      case 'race-reset': if (!arm(`${w.id}race`)) return; w.start = 0; w.items.forEach((x) => { x.at = 0; x.s = 'open'; x.pen = 0; }); break;
      case 'finish': if (it && w.start) { it.at = Date.now(); it.s = 'done'; } break;
      // Teams
      case 'teams-make': {
        const names = shuffle(w.items.map((x) => x.t).filter(Boolean));
        if (names.length < 2) { Hub.toast('Add at least two players first.'); return; }
        const n = Math.min(w.count, names.length);
        w.teams = Array.from({ length: n }, (_, k) => ({ name: (w.teams[k] && w.teams[k].name) || `Team ${k + 1}`, who: [] }));
        names.forEach((p, k) => w.teams[k % n].who.push(p));
        break;
      }
      default: return;
    }
    commit();
  });
  view.addEventListener('change', (e) => {
    if (!live) return;
    if (e.target.matches('[data-ch-names]')) {
      const w = live.widgets.find((z) => z.id === e.target.closest('[data-id]').dataset.id);
      if (w) { w.items = e.target.value.split('\n').map((t) => t.trim()).filter(Boolean).slice(0, 40).map((t) => X.chWidget({ kind: 'teams', items: [{ t }] }).items[0]); commit(); }
      return;
    }
    const t = e.target.closest('[data-ch-in]');
    const card = e.target.closest('[data-id]');
    if (!t || !card) return;
    const w = live.widgets.find((z) => z.id === card.dataset.id);
    if (!w) return;
    const path = t.dataset.chIn;
    const val = t.type === 'number' ? (t.value === '' ? null : Number(t.value)) : t.value;
    if (path === 'colour') { w.color = t.value; Hub.useColour(t.value); }
    else if (path === 'scale') w.scale = Number(t.value) / 100;
    else if (path === 'preset') { if (t.value) { const [x, y] = t.value.split(',').map(Number); w.x = x; w.y = y; } }
    else if (path === 'durMin') { w.dur = Math.max(6, Math.round(Number(t.value) * 60)); if (!w.running) w.base = w.dur; }
    else if (w.kind === 'counter' && (path === 'min' || path === 'max')) w[path] = val;
    else if (path === 'dur' || path === 'count' || path === 'ruleN' || path === 'step' || path === 'target' || path === 'max' || path === 'start') { w[path] = Number(t.value) || 0; if (path === 'max' && w.kind === 'lives') w.left = Math.min(w.left, w.max); }
    else {
      const parts = path.split('.');
      let o = w;
      parts.slice(0, -1).forEach((p) => { o = o[p]; });
      o[parts[parts.length - 1]] = t.type === 'number' ? Number(t.value) || 0 : t.value;
    }
    commit();
  });
  view.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('[data-ch-new]')) { e.preventDefault(); e.target.closest('.ch-add').querySelector('[data-ch="item-add"]').click(); } });
})();
