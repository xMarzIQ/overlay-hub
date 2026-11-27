/*
  Chat Games in the hub: Poll, Contexto, Flag game, Giveaway and Scavenger hunt, each in its own dropdown.
  Each has Off, Show preview and Show on screen, a colour and a size; drag them around the preview to move them.
  Votes, guesses, answers and entries come from Twitch chat (the streamer's chat channel in the Chat tab).
*/
(() => {
  'use strict';
  const Hub = window.Hub;
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const COLOURS = ['#ffffff', '#ffd166', '#ff5c6c', '#2ee59d', '#38bdf8', '#111827'];
  const GAMES = [['poll', 'Poll', '▤'], ['contexto', 'Contexto', '≈'], ['flags', 'Flag game', '⚑'], ['give', 'Giveaway', '★'], ['hunt', 'Scavenger hunt', '▦']];
  const nameOf = (k) => GAMES.find((g) => g[0] === k)[1];
  let live = null;
  let secret = '';
  let showSecret = false;
  let resetArmed = 0;
  const cards = document.getElementById('gmCards');
  const openCards = new Set(JSON.parse(localStorage.getItem('gm-open') || '["poll"]'));
  cards.addEventListener('toggle', (e) => {
    const d = e.target;
    if (!d.dataset || !d.dataset.id) return;
    if (d.open) openCards.add(d.dataset.id); else openCards.delete(d.dataset.id);
    localStorage.setItem('gm-open', JSON.stringify(Array.from(openCards)));
  }, true);

  const ctl = Hub.module('games', {
    patchable: ['mode', 'poll', 'contexto', 'flags', 'give', 'hunt'],
    onState(s) { live = s; paint(); },
    isShowing: (s) => GAMES.some(([k]) => s[k].vis === 'live'),
    liveCount: (s) => GAMES.filter(([k]) => s[k].vis === 'live').length,
    tileSummary(s) {
      const on = GAMES.filter(([k]) => s[k].vis === 'live');
      return { text: on.length ? `${on.length} on screen` : 'Nothing on screen', small: on.map((g) => g[1]).join(', ') };
    },
    onDrag(k, x, y) { if (live && live[k]) { live[k].x = x; live[k].y = y; ctl.commit(); } },
  });
  const commit = () => ctl.commit();
  const redraw = () => { cards._html = ''; paint(); };

  function summary(k, g) {
    const votes = g.votes ? g.votes.reduce((a, b) => a + b, 0) : 0;
    if (k === 'poll') return g.open ? `Voting open, ${votes} vote${votes === 1 ? '' : 's'}` : g.q ? `${votes} vote${votes === 1 ? '' : 's'}, voting closed` : 'No question yet';
    if (k === 'contexto') return g.winner ? `${g.winner.u} got it: ${g.winner.w}` : g.open ? `${g.count} guesses, closest ${g.guesses[0] ? g.guesses[0].r : 'none yet'}` : 'No round running';
    if (k === 'flags') return g.winner ? `${g.winner.u} got ${g.winner.name}` : g.open ? 'Flag up, waiting for an answer' : 'Not started';
    if (k === 'give') return g.winner ? `Winner: ${g.winner}` : `${g.entries} entered${g.open ? '' : ', entries closed'}`;
    const filled = g.cells.filter((c) => c.t);
    return `${filled.filter((c) => c.found).length} of ${filled.length} found`;
  }
  const seg = (act, cur, opts) => `<div class="seg" role="group">${opts.map(([v, l]) => `<button type="button" data-gm="${act}" data-val="${v}" aria-pressed="${String(cur) === String(v)}">${l}</button>`).join('')}</div>`;
  const row = (name, inner) => `<div class="gm-ctl-row"><span class="gm-ctl-name">${name}</span>${inner}</div>`;

  function controls(k, g) {
    const guesses = row('Guesses', seg('mode', live.mode, [['word', 'Any single word'], ['bang', 'Only !g word']]));
    if (k === 'poll') {
      return `<label class="field"><span class="field-label">Question</span><input class="input" data-gm-in="poll.q" maxlength="120" value="${esc(g.q)}" placeholder="Who wins tonight?"></label>
        <div class="gm-opts">${g.opts.map((t, i) => `<label class="field"><span class="field-label">Answer ${i + 1}${i > 1 ? ' (optional)' : ''}</span><input class="input" data-gm-in="poll.opts.${i}" maxlength="40" value="${esc(t)}"></label>`).join('')}</div>
        <div class="btn-row"><button type="button" class="btn${g.open ? '' : ' btn-primary'}" data-gm="poll-open">${g.open ? 'Close voting' : 'Open voting'}</button><button type="button" class="btn" data-gm="poll-reset">Reset votes</button></div>
        <p class="note">Chat votes by typing the answer’s number. One vote each, and they can change it.</p>`;
    }
    if (k === 'contexto') {
      return `<label class="field"><span class="field-label">Secret word</span><input class="input" id="gmSecret" maxlength="20" autocomplete="off" placeholder="Type a word, or tap Random word"></label>
        <div class="btn-row"><button type="button" class="btn btn-primary" data-gm="cx-start">Start with my word</button><button type="button" class="btn" data-gm="cx-random">Random word</button></div>
        ${g.open ? '<div class="btn-row"><button type="button" class="btn" data-gm="cx-hint">Give a hint</button><button type="button" class="btn" data-gm="cx-end">End round</button></div>' : ''}
        ${secret ? `<p class="note">This round’s word: <button type="button" class="link-btn" data-gm="cx-show">${showSecret ? esc(secret) : 'Tap to show'}</button></p>` : ''}
        ${guesses}
        <p class="note">Every guess gets a number for how close it is: 1 is the secret word. The first person in chat to get it wins.</p>`;
    }
    if (k === 'flags') {
      return `<div class="btn-row"><button type="button" class="btn btn-primary" data-gm="fl-next">${g.code ? 'Next flag' : 'Start'}</button><button type="button" class="btn" data-gm="fl-reset">Reset scores</button></div>
        ${row('Next flag by itself', seg('fl-auto', g.auto ? 1 : 0, [[1, 'On'], [0, 'Off']]))}
        ${guesses}
        ${g.board.length ? `<p class="note">Top scores: ${g.board.slice(0, 5).map((x) => `${esc(x.u)} ${x.pts}`).join(', ')}</p>` : ''}
        <p class="note">The first person in chat to name the country wins the point. 190 flags, including England, Scotland, Wales and Northern Ireland.</p>`;
    }
    if (k === 'give') {
      return `<div class="gm-opts"><label class="field"><span class="field-label">Title</span><input class="input" data-gm-in="give.title" maxlength="40" value="${esc(g.title)}"></label><label class="field"><span class="field-label">Word to enter</span><input class="input" data-gm-in="give.word" maxlength="20" value="${esc(g.word)}"></label></div>
        <div class="btn-row"><button type="button" class="btn${g.open ? '' : ' btn-primary'}" data-gm="gv-open">${g.open ? 'Close entries' : 'Open entries'}</button><button type="button" class="btn btn-primary" data-gm="gv-draw"${g.entries ? '' : ' disabled'}>Draw a winner</button><button type="button" class="btn" data-gm="gv-reset">${Date.now() - resetArmed < 4000 ? 'Tap again to start again' : 'Start again'}</button></div>
        <p class="note">${g.entries} entered. One entry each; the winner is picked at random.</p>`;
    }
    return `<label class="field"><span class="field-label">Title</span><input class="input" data-gm-in="hunt.title" maxlength="40" value="${esc(g.title)}"></label>
      ${row('Grid', seg('hn-size', g.size, [[3, '3 × 3'], [4, '4 × 4'], [5, '5 × 5']]))}
      <div class="hn-edit" style="--n:${g.size}">${g.cells.map((c, i) => `<div class="hn-ed${c.found ? ' is-found' : ''}"><input class="input" data-gm-in="hunt.cells.${i}.t" maxlength="40" value="${esc(c.t)}" placeholder="Item ${i + 1}" aria-label="Item ${i + 1}"><button type="button" data-gm="hn-tick" data-i="${i}" aria-pressed="${c.found}"${c.t ? '' : ' disabled'}>${c.found ? 'Found ✓' : 'Tick'}</button></div>`).join('')}</div>
      <div class="btn-row"><button type="button" class="btn" data-gm="hn-clear">Clear ticks</button></div>`;
  }

  function paint() {
    if (!live) return;
    const typing = cards.contains(document.activeElement) && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);
    if (typing) return; // never repaint under someone typing
    const html = GAMES.map(([k, name, icon]) => {
      const g = live[k];
      const pill = g.vis === 'live' ? '<span class="pill is-on">On screen</span>' : g.vis === 'preview' ? '<span class="pill is-pv">Preview</span>' : '<span class="pill">Off</span>';
      return `<details class="fold dk-card" data-id="${k}"${openCards.has(k) ? ' open' : ''}>
        <summary><span class="fold-icon dk-icon" aria-hidden="true">${icon}</span><span class="fold-text"><b>${name}</b><small>${esc(summary(k, g))}</small></span>${pill}<span class="fold-chev" aria-hidden="true"></span></summary>
        <div class="fold-body">
          ${Hub.visButtons(g.vis)}
          ${controls(k, g)}
          <div class="dk-look">
            <div class="dk-colours"><button type="button" data-gm="colour" data-val="brand" style="background:var(--brand)" aria-label="Brand colour" title="Brand colour"></button>${COLOURS.map((c) => `<button type="button" data-gm="colour" data-val="${c}" style="background:${c}" aria-label="Colour ${c}" aria-pressed="${c === g.color}"></button>`).join('')}<input type="color" data-gm-in="colour" value="${g.color}" aria-label="Any colour"></div>
            <label class="dk-inline dk-size">Size <input type="range" min="40" max="250" step="5" data-gm-in="scale" value="${Math.round(g.scale * 100)}"></label>
          </div>
        </div></details>`;
    }).join('');
    if (cards._html !== html) { cards._html = html; cards.innerHTML = html; }
  }

  async function startContexto(word) {
    try {
      const r = await Hub.call('POST', `/api/streamers/${Hub.streamer.id}/games/contexto`, { word });
      secret = r.word; showSecret = false;
      const box = document.getElementById('gmSecret'); if (box) box.value = '';
      Hub.toast('Contexto round started. Chat can start guessing.', { tone: 'goal' });
      redraw();
    } catch (err) { Hub.toast(err.message || 'Couldn’t start the round.', { tone: 'warn' }); }
  }

  const view = document.getElementById('viewGames');
  view.addEventListener('click', (e) => {
    const card = e.target.closest('[data-id]');
    if (!live || !card) return;
    const k = card.dataset.id;
    const g = live[k];
    const vb = e.target.closest('[data-vis]');
    if (vb) {
      g.vis = vb.dataset.vis;
      commit();
      Hub.toast(g.vis === 'live' ? `${nameOf(k)} is on screen` : g.vis === 'preview' ? 'In preview: only you can see it' : 'Off', { tone: g.vis === 'live' ? 'goal' : 'info' });
      return;
    }
    const b = e.target.closest('[data-gm]');
    if (!b || b.tagName === 'INPUT') return;
    const v = b.dataset.val;
    switch (b.dataset.gm) {
      case 'mode': live.mode = v; break;
      case 'colour': g.color = v === 'brand' ? ((Hub.streamer.look || {}).brand || '#e11d48') : v; break;
      case 'poll-open': g.open = !g.open; break;
      case 'poll-reset': { const done = Hub.remember('games', 'Votes reset.'); g.reset += 1; commit(); done(); return; }
      case 'cx-start': { const word = (document.getElementById('gmSecret') || {}).value || ''; if (!word.trim()) { Hub.toast('Type a secret word first, or tap Random word.'); return; } startContexto(word.trim()); return; }
      case 'cx-random': startContexto(''); return;
      case 'cx-hint': g.hint += 1; break;
      case 'cx-end': g.open = false; break;
      case 'cx-show': showSecret = !showSecret; redraw(); return;
      case 'fl-next': g.round += 1; break;
      case 'fl-auto': g.auto = v === '1'; break;
      case 'fl-reset': { const done = Hub.remember('games', 'Flag scores reset.'); g.boardReset += 1; commit(); done(); return; }
      case 'gv-open': g.open = !g.open; break;
      case 'gv-draw': g.draw += 1; break;
      case 'gv-reset':
        // Entries can't come back once cleared, so this asks for a second tap instead of offering undo
        if (Date.now() - resetArmed > 4000) { resetArmed = Date.now(); redraw(); setTimeout(redraw, 4100); return; }
        resetArmed = 0; g.reset += 1; break;
      case 'hn-size': g.size = Number(v); break;
      case 'hn-tick': { const c = g.cells[Number(b.dataset.i)]; c.found = !c.found; break; }
      case 'hn-clear': { const done = Hub.remember('games', 'Ticks cleared.'); g.cells.forEach((c) => { c.found = false; }); commit(); done(); return; }
      default: return;
    }
    commit();
  });
  // Typed text, colours and sizes save when you finish with each box
  view.addEventListener('change', (e) => {
    const t = e.target.closest('[data-gm-in]');
    const card = e.target.closest('[data-id]');
    if (!t || !card || !live) return;
    const g = live[card.dataset.id];
    const path = t.dataset.gmIn;
    if (path === 'colour') g.color = t.value;
    else if (path === 'scale') g.scale = Number(t.value) / 100;
    else {
      const parts = path.split('.').slice(1);
      let obj = g;
      parts.slice(0, -1).forEach((p) => { obj = obj[p]; });
      obj[parts[parts.length - 1]] = t.value;
    }
    commit();
  });
})();
