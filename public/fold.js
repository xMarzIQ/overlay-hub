/*
  Calmer pages: every page of the hub is grouped into labelled dropdowns. Only the everyday ones start open,
  and each device remembers which ones you opened. Nothing is removed; the controls just move into groups.
*/
(() => {
  'use strict';
  const q = (sel, root) => (root || document).querySelector(sel);
  const itemWith = (key) => { const b = q(`#viewScoreboard [data-act="show"][data-key="${key}"]`); return b && b.closest('.item'); };
  const groupWith = (sel) => { const n = q(`#viewScoreboard ${sel}`); return n && n.closest('.ex-group'); };
  const rowWith = (key) => { const b = q(`#viewScoreboard [data-act="show"][data-key="${key}"]`); return b && b.closest('.item-row'); };
  const allOpen = localStorage.getItem('hub-folds-all') === '1';

  function fold(id, title, hint, open, nodes, icon) {
    const d = document.createElement('details');
    d.className = 'fold';
    d.dataset.fold = id;
    const saved = localStorage.getItem(`fold-${id}`);
    d.open = allOpen || (saved === null ? open : saved === '1');
    d.innerHTML = `<summary><span class="fold-icon" aria-hidden="true">${icon || ''}</span><span class="fold-text"><b>${title}</b><small>${hint}</small></span><span class="fold-chev" aria-hidden="true"></span></summary><div class="fold-body"></div>`;
    const body = d.querySelector('.fold-body');
    nodes.filter(Boolean).forEach((n) => body.appendChild(n));
    if (nodes.filter(Boolean).some((n) => n.classList && n.classList.contains('owner-only')) && nodes.filter(Boolean).every((n) => n.classList && n.classList.contains('owner-only'))) d.classList.add('owner-only');
    d.addEventListener('toggle', () => localStorage.setItem(`fold-${id}`, d.open ? '1' : '0'));
    return d;
  }
  const I = {
    ball: '<svg viewBox="0 0 24 24" width="22" height="22"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.9"/><path d="M12 8l3.3 2.4-1.3 3.9h-4l-1.3-3.9z" fill="currentColor"/></svg>',
    search: '<svg viewBox="0 0 24 24" width="22" height="22"><circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M16 16l4.5 4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    shirt: '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M8 4l-4 3 2 3 2-1v10h8V9l2 1 2-3-4-3-2 1.5h-4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
    bars: '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M5 19V11M12 19V5M19 19v-6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
    eye: '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" fill="none" stroke="currentColor" stroke-width="1.9"/><circle cx="12" cy="12" r="2.8" fill="currentColor"/></svg>',
    spark: '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M12 3.5l2.3 5.2 5.6.5-4.2 3.7 1.3 5.5L12 15.6l-5 2.8 1.3-5.5-4.2-3.7 5.6-.5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
    brush: '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M4 20l3.5-.8L19 7.7a2 2 0 0 0 0-2.8l-.9-.9a2 2 0 0 0-2.8 0L3.8 15.5 3 19z" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/></svg>',
    card: '<svg viewBox="0 0 24 24" width="22" height="22"><rect x="3.5" y="5" width="17" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.9"/><path d="M3.5 10h17" stroke="currentColor" stroke-width="1.9"/></svg>',
    target: '<svg viewBox="0 0 24 24" width="22" height="22"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.9"/><circle cx="12" cy="12" r="3.5" fill="currentColor"/></svg>',
    robot: '<svg viewBox="0 0 24 24" width="22" height="22"><rect x="5" y="8" width="14" height="11" rx="3" fill="none" stroke="currentColor" stroke-width="1.9"/><path d="M12 4v4M9 13h.01M15 13h.01" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
    heart: '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/></svg>',
    play: '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M8 5.5v13l10-6.5z" fill="currentColor"/></svg>',
    reset: '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M5 12a7 7 0 1 0 2.1-5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><path d="M5 4v4h4" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>',
    plus: '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
    image: '<svg viewBox="0 0 24 24" width="22" height="22"><rect x="3.5" y="5" width="17" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.9"/><path d="M6 17l4.5-5 3.5 3.5 2-2 2.5 3.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
    save: '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M6 4h10l4 4v12H6z" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/><path d="M9 4v5h6V4M9 20v-6h6v6" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
    link: '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>',
  };

  /* ---------- The scoreboard page: five groups and More, instead of five tabs ---------- */
  const sb = q('#viewScoreboard');
  if (sb) {
    const wrap = document.createElement('div');
    wrap.className = 'folds';
    const scale = q('#inScale') && q('#inScale').parentElement;
    // One switch for every pop-up instead of five
    const pop = document.createElement('div');
    pop.className = 'item-row wrap';
    // Every flash and pop-up has its own switch, plus All on and All off. They all start Off.
    pop.className = 'flash-list';
    pop.innerHTML = '<div class="item-row wrap"><div class="item-name static"><span>Flashes and pop-ups<small>Each one only plays while the scoreboard is on screen</small></span></div><div class="btn-row"><button class="btn btn-small" type="button" data-act="popups" data-val="1">All on</button><button class="btn btn-small" type="button" data-act="popups" data-val="0">All off</button></div></div>'
      + [['goalFlash', 'Goal flash'], ['redFlash', 'Red card flash'], ['varFlash', 'VAR: goal ruled out'], ['addedBoard', 'Added-time board'], ['banners', 'Kick-off, half-time and full-time banners'], ['spotlight', 'Scorer spotlight'], ['splash', 'Full-time splash'], ['subs', 'Substitutions']].map(([k, n]) => `<div class="item-row wrap flash-row"><div class="item-name static"><span>${n}</span></div><div class="seg seg-sm" role="group" aria-label="${n}"><button type="button" data-act="flash" data-key="${k}" data-val="1">On</button><button type="button" data-act="flash" data-key="${k}" data-val="0">Off</button></div></div>`).join('');
    // Scorers and the stats card: just On or Off
    const scorers = itemWith('scorers');
    if (scorers) {
      const g = scorers.querySelector('[data-val="goals"]'); if (g) g.hidden = true;
      const al = scorers.querySelector('[data-val="always"]'); if (al) al.textContent = 'On';
    }
    const card = itemWith('card');
    if (card) {
      const sh = card.querySelector('[data-key="card"][data-val="show"]'); if (sh) sh.hidden = true;
      const au = card.querySelector('[data-key="card"][data-val="auto"]'); if (au) au.textContent = 'On';
      const nm = card.querySelector('.item-name span'); if (nm && nm.firstChild) nm.firstChild.textContent = 'Stats card at half-time and full-time';
    }
    // Rows the single Pop-ups switch now covers, and the yellow cards (always on the timeline)
    const hidden = document.createElement('div');
    hidden.hidden = true;
    [itemWith('banners'), itemWith('spotlight'), itemWith('splash'), itemWith('yellows'), rowWith('subs')].filter(Boolean).forEach((n) => hidden.appendChild(n));
    sb.appendChild(hidden);
    // Look: style, team names and the accent colour; the sheen and goal celebration stay on
    const look = q('#viewScoreboard .look');
    if (look) look.querySelectorAll('[data-act="look"]').forEach((b) => { const r = b.closest('.look-row'); if (r) r.hidden = true; });
    // Big cards: the five cards, and the stats card whenever you want it
    const cards = groupWith('[data-act="board"]');
    if (cards) { const row = cards.querySelector('.ex-cards'); if (row) row.insertAdjacentHTML('beforeend', '<button class="btn" type="button" data-act="card-now">Stats card</button>'); }
    // More: everything you hardly ever need, each with its own small heading
    const titled = (title, node) => { if (!node) return []; const h = document.createElement('h4'); h.className = 'more-h'; h.textContent = title; return [h, node]; };
    const more = [].concat(
      titled('Teams and colours', q('#viewScoreboard .teams-panel')), titled('Which stats show', q('#viewScoreboard .stats-panel')),
      titled('Autopilot', groupWith('[data-act="auto"]')), titled('Scenes', groupWith('#sceneList')),
      titled('Practice', q('#sampleTools')), titled('', groupWith('[data-act="practice"]')), titled('Start a new match', q('#viewScoreboard .layout-foot')),
    ).filter((n) => !(n.tagName === 'H4' && !n.textContent));
    const groups = [
      fold('sb-score', 'Score and clock', 'Goals, cards, the clock and stream delay', true, [q('#viewScoreboard .deck')], I.ball),
      fold('sb-match', 'Find a match', 'Follow a live game and it runs itself', true, [q('#viewScoreboard .feed-panel')].concat(titled('Follow my team', groupWith('#followTeam'))), I.search),
      fold('sb-pens', 'Penalty shoot-out', 'Kick by kick, under the scoreboard', true, [groupWith('[data-act="kick"]')], I.target),
      fold('sb-show', 'On screen', 'What shows: scoreboard, stats, scorers, pop-ups and more', false, [scale, itemWith('bug'), itemWith('drawer'), scorers, card, itemWith('timeline'), rowWith('ticker'), pop], I.eye),
      fold('sb-cards', 'Big cards', 'Line-ups, match info, form, head-to-head, table and stats', false, [cards], I.card),
      fold('sb-look', 'Look', 'Style, team names and colour', false, [itemWith('style'), itemWith('names'), look], I.brush),
      fold('sb-more', 'More', 'Teams, stats, autopilot, scenes, practice and new match', false, more, I.plus),
    ];
    groups.forEach((g) => wrap.appendChild(g));
    const tabs = q('#viewScoreboard .tabs');
    (tabs || q('#viewScoreboard .module-bar')).insertAdjacentElement('afterend', wrap);
    if (tabs) tabs.hidden = true;
    sb.querySelectorAll('.tab-panel').forEach((p) => { p.hidden = true; p.classList.add('is-emptied'); });
    if (q('#sampleTools')) q('#sampleTools').hidden = false;
    q('[data-fold="sb-pens"]').hidden = true; // only during penalties
  }

  /* ---------- Canvas and Stream Desk ---------- */
  const cv = q('#viewCanvas');
  if (cv) {
    const panels = cv.querySelectorAll('.cv-panel');
    const wrap = document.createElement('div');
    wrap.className = 'folds';
    const meta = [['cv-draw', 'Draw', 'Pen, arrows, laser and spotlight, straight onto the practice view', true, I.brush], ['cv-add', 'Add to the screen', 'Text, web pages, YouTube, QR codes and the tactics pitch', false, I.plus], ['cv-lib', 'Pictures and music', 'Your library and the music player', false, I.image], ['cv-boards', 'Saved boards', 'Save a drawing and bring it back later', false, I.save]];
    panels.forEach((p, i) => { if (meta[i]) wrap.appendChild(fold(meta[i][0], meta[i][1], meta[i][2], meta[i][3], [p], meta[i][4])); });
    q('#viewCanvas .module-bar').insertAdjacentElement('afterend', wrap);
  }
  const dk = q('#viewDesk');
  if (dk) {
    const add = q('#viewDesk .dk-panel');
    if (add) q('#viewDesk .module-bar').insertAdjacentElement('afterend', fold('dk-add', 'Add a widget', 'Timers, countdowns, counters, text, lists and your own match', true, [add], I.plus));
  }

  /* ---------- Under the practice view: links, activity and chat in one dropdown ---------- */
  const box = q('#box');
  if (box) {
    const f = fold('box', 'OBS link, links, activity and chat', 'The link to paste into OBS, and the owner’s extras', false, [], I.link);
    f.classList.add('owner-only'); // editors never see this dropdown, not even its title
    box.insertAdjacentElement('beforebegin', f);
    f.querySelector('.fold-body').appendChild(box);
  }
})();
