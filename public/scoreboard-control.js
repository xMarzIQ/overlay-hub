/*
  The live scoreboard's page in the hub: the deck (clock, goals, period), following a match from ESPN,
  stats, teams and layout, in four tabs. Changes go through the hub, which keeps every page and OBS in step.
*/
(() => {
  'use strict';
  const M = window.Match;
  const SB = window.Scoreboard;
  const Hub = window.Hub;
  const $ = (id) => document.getElementById(id);
  const setText = (node, text) => { if (node && node.textContent !== text) node.textContent = text; };
  const ACTIONS = {
    pre: 'Kick off', '1h': 'End 1st half', ht: 'Start 2nd half', '2h': 'End match',
    brk: 'Start extra time', et1: 'End ET 1st half', et2: 'End match', pens: 'End match', ft: 'New match',
  };
  const PERIOD_NAMES = { pre: 'Pre-match', '1h': '1st half', ht: 'Half-time', '2h': '2nd half', brk: 'Break', et1: 'Extra time, 1st half', et2: 'Extra time, 2nd half', pens: 'Penalties', ft: 'Full-time' };
  const PATCHABLE = ['mode', 'onAir', 'scale', 'delay', 'tz', 'look', 'comp', 'compLogo', 'kickoff', 'kickoffAt', 'home', 'away', 'period', 'note', 'clock',
    'added', 'score', 'pens', 'stats', 'statsShown', 'goals', 'reds', 'yellows', 'anims', 'show', 'bug', 'card', 'writer', 'rev', 'shoot', 'board', 'follow', 'auto', 'scenes', 'preview'];
  const TABS = ['match', 'stats', 'teams', 'layout'];

  const el = {};
  [
    'chips', 'controls', 'resetBtn', 'sourceLine', 'sourceText',
    'tally', 'readTime', 'readState', 'advanceBtn', 'clockBtn', 'clockBtnText', 'inClock', 'clockHint', 'addedOut', 'delayOut', 'delayReset', 'periodMore',
    'deckHomeBadge', 'deckAwayBadge', 'scHomeCode', 'scAwayCode', 'scHomeName', 'scAwayName', 'scHome', 'scAway', 'sideRedsHome', 'sideRedsAway',
    'goalHome', 'goalAway', 'inScorer', 'replayBtn',
    'compChips', 'daySeg', 'dayInput', 'fxSearch', 'fixtures', 'linkedBox', 'linkedTitle', 'linkedStatus', 'linkedMeta', 'refreshBtn', 'unlinkBtn',
    'pollSeg', 'kitToggle', 'crestToggle', 'feedError',
    'statChips', 'statsHeadNote', 'possBox', 'possHome', 'possAway', 'inPoss', 'statCtl', 'statsFeedNote',
    'inScale', 'scaleOut', 'inBugSize', 'bugSizeOut', 'inCardSize', 'cardSizeOut',
    'teamsNote', 'inHomeName', 'inHomeCode', 'inHomeColor', 'inHomeCrest', 'prevHome', 'clearHome', 'crestErrHome',
    'inAwayName', 'inAwayCode', 'inAwayColor', 'inAwayCrest', 'prevAway', 'clearAway', 'crestErrAway', 'inHomeFull', 'inAwayFull',
    'inComp', 'inKickoff', 'compList', 'inTz', 'swHome', 'swAway', 'inBrand',
  ].forEach((id) => { el[id] = $(id); });

  let live = null;          // the match as this page shows it (the hub's copy)
  let previewKey = null;    // a sample state shown only in this preview
  let previewState = null;
  let isBlocked = false;
  let tab = TABS.includes(Hub.store.get('sb-tab', '')) ? Hub.store.get('sb-tab', '') : 'match';
  const own = new Set();    // animations this page started, so only other people's and ESPN's get a toast

  const ctl = Hub.module('scoreboard', {
    patchable: PATCHABLE,
    onDrag,
    onState(s, before, first) {
      live = s;
      if (first) { loadFixtures(false); clearIfOld(); }
      else if (before && before !== s) announce(before, s);
      if (previewKey && previewKey !== 'test' && previewKey !== 'practice') {
        const keep = previewState ? { clock: previewState.clock, kickoffAt: previewState.kickoffAt } : null;
        previewState = M.withSample(live, previewKey);
        if (keep) Object.assign(previewState, keep);
      }
      syncControls();
    },
    onCommit(opts) { if (previewKey && !opts.keepPreview) stopPreview(); },
    previewState: () => (previewKey ? previewState : null),
    sampleLabel: () => (previewKey === 'test' ? 'Test animations' : previewKey === 'practice' ? 'Practice match' : previewKey ? M.SAMPLES[previewKey].label : ''),
    tileSummary,
    keepOnUndo: (cur) => ({ feed: cur.feed, compKey: cur.compKey }),
    onKey,
    onShow() { loadFixtures(false); paintTabs(); },
    onStreamer() {
      previewKey = null;
      previewState = null;
      own.clear();
      fixturesKey = '';
      localFeedError('');
    },
    onLock(b) {
      isBlocked = b;
      el.controls.inert = b;
      el.controls.classList.toggle('is-locked', b);
      if (!b) loadFixtures(false);
    },
  });

  const following = () => !!(live && live.mode === 'live' && live.feed.fixtureId);
  const blocked = () => isBlocked || Hub.blocked();
  const teamName = (t) => M.nameOf(t === 0 ? live.home : live.away);
  function commit(opts) { ctl.commit(opts); }

  /* ---------- The hub tile ---------- */
  function tileSummary(s) {
    if (s.home.name === 'Home' && s.away.name === 'Away' && !s.feed.fixtureId) return { text: 'No match yet', small: '' };
    const text = `${M.codeOf(s.home)} ${s.score[0]}–${s.score[1]} ${M.codeOf(s.away)}`;
    let small;
    if (M.inPlay(s)) small = M.minuteMark(s) || 'Live';
    else if (s.period === 'pre') small = s.kickoff ? `KO ${koLabel(s)}` : 'Pre-match';
    else small = { ht: 'HT', brk: 'Break', pens: 'Pens', ft: 'FT' }[s.period] || '';
    return { text, small };
  }

  /* ---------- Toasts for goals and cards that came from ESPN or another device ---------- */
  function announce(before, s) {
    const seen = new Set(before.anims.map((a) => a.id));
    s.anims.filter((a) => !seen.has(a.id) && !own.has(a.id)).forEach((a) => {
      const team = M.nameOf(a.team === 0 ? s.home : s.away);
      const who = [a.name, a.minute].filter(Boolean).join(' ');
      if (a.kind === 'goal') {
        Hub.toast(`Goal for ${team}${who ? `: ${who}` : ''}`, { tone: 'goal' });
        if (Hub.personal.vibrate && navigator.vibrate) navigator.vibrate([90, 50, 90]);
      }
      else if (a.kind === 'scorer') Hub.toast(`${a.name} scored for ${team}`, { tone: 'goal' });
      else if (a.kind === 'red') Hub.toast(`Red card, ${team}${who ? `: ${who}` : ''}`, { tone: 'bad' });
    });
  }
  function anim(anim) {
    M.pushAnim(live, anim);
    own.add(live.anims[live.anims.length - 1].id);
  }

  /* ---------- Sample states, in this preview only ---------- */
  function startPreview(key) {
    if (!live || !M.SAMPLES[key]) return;
    previewKey = key;
    previewState = M.withSample(live, key);
    syncControls();
    Hub.paintMonitor();
  }
  function stopPreview() {
    previewKey = null;
    previewState = null;
    syncControls();
    Hub.paintMonitor();
  }

  // Plays a goal, a scorer and a red card in this preview only, to check them before a stream.
  function testAnimations() {
    if (!live) return;
    const base = M.copy(live);
    base.onAir = true;
    base.show = Object.assign({}, base.show, { bug: true });
    const t = M.now();
    const mk = (kind, team, name, minute) => ({ id: `test${M.newId()}`, kind, team, name, minute, t });
    base.anims = live.anims.concat([mk('goal', 0, 'Test Player', '23’'), mk('banner', 0, 'HALF-TIME', ''), mk('added', 0, '+4', ''), mk('nogoal', 1, 'Second Player', '41’'), mk('red', 1, 'Third Player', '67’')]);
    previewKey = 'test';
    previewState = base;
    syncControls();
    Hub.paintMonitor();
    setTimeout(() => { if (previewKey === 'test') stopPreview(); }, 20000);
  }
  // A tidy text summary for Discord or X: score, status, scorers, red cards and the stats on show.
  function copyResult() {
    const s = live;
    const status = s.period === 'ft' ? (s.note === 'pens' && s.pens ? `full-time, ${s.pens[0]}–${s.pens[1]} on pens` : s.note === 'aet' ? 'after extra time' : 'full-time')
      : s.period === 'pre' ? 'before kick-off' : s.period === 'ht' ? 'half-time' : M.inPlay(s) ? `live, ${M.minuteMark(s)}` : 'live';
    const lines = [];
    if (M.str(s.comp).trim()) lines.push(M.str(s.comp).trim());
    lines.push(`${M.fullOf(s.home)} ${s.score[0]}–${s.score[1]} ${M.fullOf(s.away)} (${status})`);
    [0, 1].forEach((t) => {
      const g = M.scorers(s, t);
      if (g) lines.push(`${M.nameOf(t === 0 ? s.home : s.away)} goals: ${g}`);
    });
    const reds = [0, 1].map((t) => M.redList(s, t).map((r) => `${[r.name, r.minute].filter(Boolean).join(' ') || 'red card'} (${M.codeOf(t === 0 ? s.home : s.away)})`)).flat();
    if (reds.length) lines.push(`Red cards: ${reds.join(', ')}`);
    s.statsShown.forEach((k) => {
      const def = M.STAT[k];
      if (def && s.period !== 'pre') lines.push(`${def.label}: ${M.formatStat(def, s.stats[k][0])}–${M.formatStat(def, s.stats[k][1])}`);
    });
    const text = lines.join('\n');
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject(new Error('no clipboard')))
      .then(() => Hub.toast('Result copied. Paste it into Discord or X.', { tone: 'good' }))
      .catch(() => Hub.toast(text, { ms: 12000 }));
  }

  /* ---------- Extras: centre cards, shoot-out, autopilot, scenes, follow my team ---------- */
  let lastKickTeam = -1;
  const SNAP_KEYS = ['onAir', 'board', 'show', 'bug', 'card', 'scale'];
  function extras(act, b) {
    const v = b.dataset.val;
    if (act === 'board') { live.board = live.board === v ? 'none' : v; commit({ keepPreview: true }); return; }
    if (act === 'kick') {
      const t = Number(b.dataset.team);
      live.shoot[t] = live.shoot[t].concat(v === '1' ? 1 : 0);
      lastKickTeam = t;
      commit({ keepPreview: true });
      return;
    }
    if (act === 'kick-undo') {
      const t = lastKickTeam >= 0 && live.shoot[lastKickTeam].length ? lastKickTeam : live.shoot[1].length >= live.shoot[0].length ? 1 : 0;
      live.shoot[t] = live.shoot[t].slice(0, -1);
      lastKickTeam = -1;
      commit({ keepPreview: true });
      return;
    }
    if (act === 'kick-clear') { live.shoot = [[], []]; commit({ keepPreview: true }); return; }
    if (act === 'auto') {
      const k = b.dataset.key;
      live.auto[k] = k === 'on' ? v === '1' : k === 'ftOff' ? Number(v) : v;
      commit({ keepPreview: true });
      return;
    }
    if (act === 'scene-apply') {
      const sc = live.scenes.find((x) => x.id === b.closest('[data-id]').dataset.id);
      if (!sc) return;
      SNAP_KEYS.forEach((k) => { if (sc.snap[k] !== undefined) live[k] = k === 'show' ? Object.assign({}, live.show, sc.snap.show) : M.copy(sc.snap[k]); });
      commit({ keepPreview: true });
      Hub.toast(`Scene: ${sc.name}`);
      return;
    }
    if (act === 'scene-del') { live.scenes = live.scenes.filter((x) => x.id !== b.closest('[data-id]').dataset.id); commit({ keepPreview: true }); return; }
    if (act === 'follow-save' || act === 'follow-clear') {
      const team = act === 'follow-clear' ? '' : document.getElementById('followTeam').value.trim();
      const comps = Array.from(document.querySelectorAll('#followComps input:checked')).map((x) => x.value);
      live.follow = { team, comps };
      commit({ keepPreview: true });
      Hub.toast(team ? `Following ${team}: the hub picks up their next match by itself.` : 'Follow my team is off.');
    }
  }
  document.getElementById('sceneForm').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!live) return;
    if (live.scenes.length >= 8) { Hub.toast('That’s 8 scenes, the most there can be. Delete one first.', { tone: 'bad' }); return; }
    const name = document.getElementById('sceneName').value.trim() || `Scene ${live.scenes.length + 1}`;
    const snap = {};
    SNAP_KEYS.forEach((k) => { snap[k] = M.copy(live[k]); });
    live.scenes = live.scenes.concat({ id: M.newId(), name, snap });
    document.getElementById('sceneName').value = '';
    commit({ keepPreview: true });
  });
  function syncExtras() {
    const FLASHES = ['goalFlash', 'redFlash', 'varFlash', 'addedBoard', 'banners', 'spotlight', 'splash', 'subs'];
    document.querySelectorAll('[data-act="flash"]').forEach((x) => x.setAttribute('aria-pressed', String((x.dataset.val === '1') === !!live.show[x.dataset.key])));
    const allOn = FLASHES.every((k) => live.show[k]);
    const allOff = FLASHES.every((k) => !live.show[k]);
    document.querySelectorAll('[data-act="popups"]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.val === '1' ? allOn : allOff)));
    document.querySelectorAll('[data-act="card-now"]').forEach((x) => x.setAttribute('aria-pressed', String(live.show.card === 'show')));
    const pens = document.querySelector('[data-fold="sb-pens"]');
    if (pens) pens.hidden = !(live.period === 'pens' || (live.period === 'ft' && live.note === 'pens'));
    document.querySelectorAll('[data-act="board"]').forEach((x) => x.setAttribute('aria-pressed', String(live.board === x.dataset.val)));
    document.querySelectorAll('[data-act="auto"]').forEach((x) => {
      const k = x.dataset.key;
      const cur = k === 'on' ? (live.auto.on ? '1' : '0') : String(live.auto[k]);
      x.setAttribute('aria-pressed', String(cur === x.dataset.val));
    });
    const dots = (list) => list.map((k) => `<i class="${k ? 'yes' : 'no'}"></i>`).join('') || '<small class="note">No kicks yet</small>';
    document.getElementById('kickHome').innerHTML = dots(live.shoot[0]);
    document.getElementById('kickAway').innerHTML = dots(live.shoot[1]);
    document.getElementById('kickHomeName').textContent = M.codeOf(live.home);
    document.getElementById('kickAwayName').textContent = M.codeOf(live.away);
    const list = document.getElementById('sceneList');
    const key = JSON.stringify(live.scenes.map((x) => [x.id, x.name]));
    if (list._key !== key) {
      list._key = key;
      list.innerHTML = live.scenes.map((x) => `<div class="scene" data-id="${x.id}"><span></span><button class="btn btn-small" type="button" data-act="scene-apply">Use</button><button class="btn btn-quiet btn-small" type="button" data-act="scene-del" aria-label="Delete scene">×</button></div>`).join('') || '<p class="note">No scenes yet.</p>';
      list.querySelectorAll('.scene').forEach((row, i) => { row.firstChild.textContent = live.scenes[i].name; });
    }
    const team = document.getElementById('followTeam');
    if (document.activeElement !== team) team.value = live.follow.team;
    const comps = document.getElementById('followComps');
    if (!comps.children.length) comps.innerHTML = M.COMPETITIONS.map((c) => `<label><input type="checkbox" value="${c.key}">${c.name}</label>`).join('');
    comps.querySelectorAll('input').forEach((x) => { if (document.activeElement !== x) x.checked = live.follow.comps.includes(x.value); });
  }
  // A pretend match in the preview, about a minute long, so anyone can see how a match day runs.
  function practice() {
    if (!live) return;
    const base = M.copy(live);
    Object.assign(base, { onAir: true, mode: 'manual', period: 'pre', score: [0, 0], goals: [], reds: [], yellows: [], anims: [], added: 0, board: 'info', kickoffAt: M.now() + 7000 });
    base.show = Object.assign({}, base.show, { bug: true });
    const steps = [
      [0, (s) => s],
      [7000, (s) => Object.assign(s, { board: 'none', period: '1h', clock: { base: 0, running: true, at: M.now() } })],
      [16000, (s) => { s.score = [1, 0]; s.goals = [{ team: 0, scorer: 'Practice Player', minute: '12’', src: 'manual', key: '', at: M.now(), typed: true }]; s.anims = [{ id: `p${M.newId()}`, kind: 'goal', team: 0, name: 'Practice Player', minute: '12’', t: M.now() }]; return s; }],
      [27000, (s) => { s.reds = [{ team: 1, player: 'Another Player', minute: '31’', src: 'manual', key: '', at: M.now() }]; s.anims = s.anims.concat({ id: `p${M.newId()}`, kind: 'red', team: 1, name: 'Another Player', minute: '31’', t: M.now() }); return s; }],
      [35000, (s) => Object.assign(s, { period: 'ht', clock: { base: 2700, running: false, at: M.now() } })],
      [45000, (s) => Object.assign(s, { period: '2h', clock: { base: 2700, running: true, at: M.now() } })],
      [52000, (s) => { s.score = [1, 1]; s.goals = s.goals.concat({ team: 1, scorer: 'Late Equaliser', minute: '88’', src: 'manual', key: '', at: M.now(), typed: true }); s.anims = s.anims.concat({ id: `p${M.newId()}`, kind: 'goal', team: 1, name: 'Late Equaliser', minute: '88’', t: M.now() }); s.added = 4; return s; }],
      [62000, (s) => Object.assign(s, { period: 'ft', clock: { base: 5400, running: false, at: M.now() } })],
    ];
    let state = base;
    previewKey = 'practice';
    steps.forEach(([at, fn]) => setTimeout(() => {
      if (previewKey !== 'practice') return;
      state = fn(M.copy(state));
      previewState = state;
      syncControls();
      Hub.paintMonitor();
    }, at));
    setTimeout(() => { if (previewKey === 'practice') stopPreview(); }, 76000);
  }

  /* ---------- Tabs ---------- */
  function setTab(next) {
    if (!TABS.includes(next)) return;
    tab = next;
    Hub.store.set('sb-tab', tab);
    paintTabs();
    if (tab === 'match') loadFixtures(false);
  }
  function paintTabs() {
    document.querySelectorAll('[data-act="tab"]').forEach((b) => {
      const on = b.dataset.tab === tab;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    document.querySelectorAll('.tab-panel').forEach((p) => { p.hidden = p.dataset.tab !== tab; });
  }

  /* ---------- Big clock in the deck ---------- */
  let shownTime = '';
  function paintDigits(node, text) {
    if (text === shownTime) return;
    shownTime = text;
    const frag = document.createDocumentFragment();
    for (const ch of text) {
      const span = document.createElement('span');
      span.className = /\d/.test(ch) ? 'ch' : ch === ':' ? 'ch ch-colon' : ch === '+' ? 'ch ch-plus' : 'ch ch-alpha';
      span.textContent = ch;
      frag.appendChild(span);
    }
    node.replaceChildren(frag);
    node.setAttribute('aria-label', text);
  }
  const ago = (ms) => {
    const s = Math.max(0, Math.round(ms / 1000));
    if (s < 60) return `${s} s`;
    if (s < 3600) return `${Math.round(s / 60)} min`;
    return `${Math.round(s / 3600)} h`;
  };
  function tickReadout() {
    if (!live) return;
    const v = M.clockView(live);
    paintDigits(el.readTime, v.text);
    setText(el.readState, v.label);
    const play = M.inPlay(live);
    el.tally.hidden = !play && live.period !== 'pens';
    if (!el.tally.hidden) {
      const tone = live.clock.running || live.period === 'pens' ? 'live' : 'paused';
      el.tally.dataset.tone = tone;
      setText(el.tally, tone === 'live' ? 'Live' : 'Paused');
    }
    paintSource();
    paintLinked();
  }

  /* ---------- Where the match data comes from ---------- */
  function paintSource() {
    const f = live.feed;
    let text;
    let tone;
    if (live.mode === 'manual') {
      text = 'By hand: nothing changes unless you press something.';
      tone = 'idle';
    } else if (!f.fixtureId) {
      text = 'Auto is on. Open Find a match, pick a game, and it runs itself.';
      tone = 'wait';
    } else if (f.error) {
      text = `Following ${f.title}, but the last update failed: ${f.error}`;
      tone = 'bad';
    } else {
      const when = f.updatedAt ? `updated ${ago(M.now() - f.updatedAt)} ago` : 'waiting for the first update';
      text = `Following ${f.title}, ${when}.${live.delay ? ` Showing ${live.delay} s behind for your stream delay.` : ''}`;
      tone = 'live';
    }
    setText(el.sourceText, text);
    el.sourceLine.dataset.tone = tone;
  }
  function statusText(f) {
    if (f.statusShort === 'pre') return 'Not started';
    if (f.statusShort === 'post') return { FT: 'Full-time', AET: 'After extra time', 'FT-Pens': 'After penalties' }[f.status] || f.status || 'Full-time';
    if (f.statusShort === 'in') return { HT: 'Half-time' }[f.status] || String(f.status || 'Live').replace(/'/g, '’');
    return f.status || '';
  }
  function paintLinked() {
    const f = live.feed;
    const linked = !!f.fixtureId;
    el.linkedBox.classList.toggle('is-linked', linked);
    setText(el.linkedTitle, linked ? f.title : 'No match yet');
    setText(el.linkedStatus, linked ? statusText(f) : '');
    let meta = 'Pick one from the list below.';
    if (linked) {
      const parts = [];
      if (live.mode !== 'live') parts.push('Paused while you’re in Manual.');
      else if (f.done) parts.push('Match over, checks have stopped. Update now still works.');
      else {
        const gap = f.nextAt && f.updatedAt ? (f.nextAt - f.updatedAt) / 1000 : 0;
        if (gap > f.pollSeconds + 1) parts.push(`Next check in ${ago(Math.max(0, f.nextAt - M.now()))}.`);
        else parts.push(`Checking every ${f.pollSeconds} s.`);
        if (f.updatedAt) parts.push(`Last update ${ago(M.now() - f.updatedAt)} ago.`);
      }
      meta = parts.join(' ');
    }
    setText(el.linkedMeta, meta);
    el.refreshBtn.disabled = !linked || live.mode !== 'live';
    el.unlinkBtn.disabled = !linked;
  }

  /* ---------- Controls reflect the live match ---------- */
  function setValue(input, v) {
    if (document.activeElement !== input && input.value !== v) input.value = v;
  }
  function rangePct(input) {
    const min = +input.min || 0;
    const max = +input.max || 100;
    return `${(((+input.value - min) / (max - min)) * 100).toFixed(1)}%`;
  }
  function paintSideReds(node, team) {
    const all = live.reds.map((r, i) => ({ r, i })).filter((x) => x.r.team === team);
    const key = all.map((x) => `${x.i}:${x.r.player}:${x.r.minute}`).join('|');
    if (node._key === key) return;
    node._key = key;
    node.replaceChildren();
    node.classList.toggle('has-reds', all.length > 0);
    // Past three cards, one card with a count; tapping it takes off the latest.
    const list = all.length > 3 ? [all[all.length - 1]] : all;
    list.forEach(({ r, i }) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'red-chip';
      b.dataset.act = 'red-remove';
      b.dataset.index = String(i);
      const who = [r.player, r.minute].filter(Boolean).join(' ');
      b.title = all.length > 3 ? `${all.length} red cards. Tap to take off the latest${who ? ` (${who})` : ''}` : `Take off this red card${who ? ` (${who})` : ''}`;
      b.setAttribute('aria-label', b.title);
      if (all.length > 3) { b.classList.add('has-count'); b.textContent = `×${all.length}`; }
      node.appendChild(b);
    });
  }

  /* ---------- Team colours: ESPN's swatches, then any colour ---------- */
  const SWATCH_LABEL = { kit: 'Kit this match', club: 'Club colour', alt: 'Second colour', trim: 'Kit trim' };
  function paintSwatches(node, side) {
    const team = live[side];
    const key = JSON.stringify([team.swatches, team.color]);
    if (node._key === key) return;
    node._key = key;
    node.replaceChildren();
    team.swatches.forEach((w) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch';
      b.dataset.act = 'swatch';
      b.dataset.side = side;
      b.dataset.c = w.c;
      b.dataset.l = w.l;
      b.style.setProperty('--c', w.c);
      b.setAttribute('aria-pressed', String(w.c === team.color));
      const dot = document.createElement('i');
      const name = document.createElement('span');
      name.textContent = SWATCH_LABEL[w.l];
      b.append(dot, name);
      node.appendChild(b);
    });
    node.hidden = !team.swatches.length;
  }
  function pickSwatch(side, colour, label) {
    live[side].color = colour;
    commit({ keepPreview: true });
    // The kit swatch hands the colour back to Live; any other choice stays put.
    if (live.feed.fixtureId) feedSettings({ kitColours: label === 'kit' });
  }

  /* ---------- Time zone for kick-off times ---------- */
  const deviceZone = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { return ''; } })();
  function paintZones() {
    const zones = [live.tz].concat(deviceZone && M.validZone(deviceZone) ? [deviceZone] : [], M.TIMEZONES).filter((z, i, a) => z && a.indexOf(z) === i);
    const key = zones.join(',');
    if (el.inTz._key !== key) {
      el.inTz._key = key;
      el.inTz.replaceChildren(...zones.map((z) => {
        const o = document.createElement('option');
        o.value = z;
        o.textContent = z === deviceZone ? `${z.replace(/_/g, ' ')} (this device)` : z.replace(/_/g, ' ');
        return o;
      }));
    }
    setValue(el.inTz, live.tz);
  }
  function syncControls() {
    if (live) syncExtras();
    if (!live) return;
    el.chips.querySelectorAll('[data-sample]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.sample === previewKey)));
    // Off, Show preview, then Show on screen
    const sbVis = document.getElementById('sbVis');
    const v = live.onAir ? 'live' : live.preview ? 'preview' : 'off';
    if (sbVis._v !== v) { sbVis._v = v; sbVis.innerHTML = Hub.visButtons(v); }
    document.querySelectorAll('[data-act="mode"]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.val === live.mode)));
    document.querySelectorAll('[data-act="period"]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.period === live.period)));
    el.periodMore.value = '';
    el.periodMore.classList.toggle('is-active', ['brk', 'et1', 'et2', 'pens'].includes(live.period));
    if (pending !== el.advanceBtn) setText(el.advanceBtn, ACTIONS[live.period]);
    const play = M.inPlay(live);
    const running = play && live.clock.running;
    el.clockBtn.disabled = !play;
    el.clockBtn.dataset.running = String(running);
    setText(el.clockBtnText, running ? 'Pause' : 'Start');
    el.clockBtn.setAttribute('aria-label', running ? 'Pause the clock' : 'Start the clock');
    document.querySelectorAll('[data-act="nudge"], [data-act="set-clock"], [data-act="added"]').forEach((b) => { b.disabled = !play; });
    el.inClock.disabled = !play;
    setText(el.addedOut, `+${live.added}`);
    // In Live, the match runs itself: the manual controls step aside and the stream delay takes their place.
    el.controls.classList.toggle('is-live-mode', live.mode === 'live');
    setText(el.delayOut, live.delay ? `${live.delay} s` : 'None');
    el.delayReset.disabled = !live.delay;
    tickReadout();

    setText(el.scHomeName, M.nameOf(live.home));
    setText(el.scAwayName, M.nameOf(live.away));
    setText(el.scHomeCode, M.codeOf(live.home));
    setText(el.scAwayCode, M.codeOf(live.away));
    setText(el.scHome, String(live.score[0]));
    setText(el.scAway, String(live.score[1]));
    el.goalHome.setAttribute('aria-label', `Goal for ${M.nameOf(live.home)}`);
    el.goalAway.setAttribute('aria-label', `Goal for ${M.nameOf(live.away)}`);
    document.querySelectorAll('[data-act="score"]').forEach((b) => {
      b.setAttribute('aria-label', `${+b.dataset.d > 0 ? 'Add a goal to' : 'Take a goal off'} ${teamName(+b.dataset.team)} without the animation`);
    });
    document.querySelectorAll('[data-act="red"]').forEach((b) => b.setAttribute('aria-label', `Red card for ${teamName(+b.dataset.team)}`));
    paintSideReds(el.sideRedsHome, 0);
    paintSideReds(el.sideRedsAway, 1);
    el.sideRedsHome.closest('.score-band').classList.toggle('any-reds', live.reds.length > 0);
    el.replayBtn.disabled = !live.goals.length;
    SB.paintBadge(el.deckHomeBadge, live.home, 'home');
    SB.paintBadge(el.deckAwayBadge, live.away, 'away');

    syncFeed();
    syncStats();

    setValue(el.inScale, String(Math.round(live.scale * 100)));
    el.inScale.style.setProperty('--p', rangePct(el.inScale));
    setText(el.scaleOut, `${Math.round(live.scale * 100)}%`);
    document.querySelectorAll('[data-act="show"]').forEach((b) => {
      const key = b.dataset.key;
      const val = ['card', 'scorers', 'names', 'style'].includes(key) ? b.dataset.val : b.dataset.val === '1';
      b.setAttribute('aria-pressed', String(live.show[key] === val));
    });
    setValue(el.inBugSize, String(Math.round(live.bug.s * 100)));
    el.inBugSize.style.setProperty('--p', rangePct(el.inBugSize));
    setText(el.bugSizeOut, `${Math.round(live.bug.s * 100)}%`);
    setValue(el.inCardSize, String(Math.round(live.card.s * 100)));
    el.inCardSize.style.setProperty('--p', rangePct(el.inCardSize));
    setText(el.cardSizeOut, `${Math.round(live.card.s * 100)}%`);

    setValue(el.inHomeName, live.home.name);
    setValue(el.inHomeCode, live.home.code);
    setValue(el.inHomeColor, live.home.color);
    setValue(el.inAwayName, live.away.name);
    setValue(el.inHomeFull, live.home.full);
    setValue(el.inAwayFull, live.away.full);
    setValue(el.inAwayCode, live.away.code);
    setValue(el.inAwayColor, live.away.color);
    setValue(el.inComp, live.comp);
    setValue(el.inKickoff, live.kickoff);
    paintZones();
    paintSwatches(el.swHome, 'home');
    paintSwatches(el.swAway, 'away');
    document.querySelectorAll('[data-act="accent"]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.val === live.look.accent)));
    setValue(el.inBrand, live.look.brand);
    document.querySelectorAll('[data-act="look"]').forEach((b) => b.setAttribute('aria-pressed', String((b.dataset.val === '1') === !!live.look[b.dataset.key])));
    SB.paintBadge(el.prevHome, live.home, 'home');
    SB.paintBadge(el.prevAway, live.away, 'away');
    el.clearHome.disabled = !live.home.crestV;
    el.clearAway.disabled = !live.away.crestV;
  }

  /* ---------- Following a match from ESPN ---------- */
  const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const shiftDay = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return isoDay(d); };
  let feedComp = M.COMPETITIONS.some((c) => c.key === Hub.store.get('sb-comp', '')) ? Hub.store.get('sb-comp', '') : '';
  let feedDay = shiftDay(0);
  let fixtures = null;
  let fixturesError = '';
  let fixturesKey = '';
  let loading = false;

  function buildCompChips() {
    M.COMPETITIONS.forEach((c) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.dataset.act = 'comp';
      b.dataset.comp = c.key;
      const img = document.createElement('img');
      img.src = c.logo;
      img.alt = '';
      img.loading = 'lazy';
      img.addEventListener('error', () => img.remove());
      const span = document.createElement('span');
      span.textContent = c.name;
      b.append(img, span);
      el.compChips.appendChild(b);
      const opt = document.createElement('option');
      opt.value = c.name;
      el.compList.appendChild(opt);
    });
  }
  function syncFeed() {
    const f = live.feed;
    if (!feedComp) feedComp = f.compKey || live.compKey || 'pl';
    el.compChips.querySelectorAll('[data-comp]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.comp === feedComp)));
    el.daySeg.querySelectorAll('[data-shift]').forEach((b) => b.setAttribute('aria-pressed', String(shiftDay(+b.dataset.shift) === feedDay)));
    setValue(el.dayInput, feedDay);
    el.pollSeg.querySelectorAll('[data-secs]').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.secs === f.pollSeconds)));
    el.kitToggle.checked = f.kitColours;
    el.crestToggle.checked = f.crests;
    setText(el.feedError, following() && f.error ? f.error : el.feedError.dataset.local || '');
    setText(el.teamsNote, f.fixtureId ? 'Filled in by Live. Your changes here stay.' : 'Following a match fills these in');
    paintFixtures();
  }
  async function loadFixtures(force, quiet) {
    if (!live || blocked()) return;
    const key = `${feedComp || 'pl'}|${feedDay}|${live.tz}`;
    if (!force && key === fixturesKey && (fixtures || fixturesError || loading)) return;
    if (loading && quiet) return;
    fixturesKey = key;
    if (!quiet) { fixtures = null; fixturesError = ''; }
    loading = !quiet;
    paintFixtures();
    try {
      const data = await Hub.call('GET', `/api/football/matches?comp=${encodeURIComponent(feedComp || 'pl')}&date=${encodeURIComponent(feedDay)}&tz=${encodeURIComponent(live.tz)}`);
      if (fixturesKey === key) { fixtures = data.matches || []; fixturesError = ''; }
    } catch (e) {
      if (fixturesKey === key && !quiet) fixturesError = e.message;
    }
    loading = false;
    paintFixtures();
  }
  function fixtureStatus(fx) {
    const name = String(fx.status || '');
    if (fx.state === 'in') {
      if (/HALFTIME/.test(name)) return { text: 'HT', tone: 'live' };
      return { text: String(fx.clock || 'Live').replace(/'/g, '’'), tone: 'live' };
    }
    if (fx.state === 'post') {
      if (/POSTPONED|CANCEL|ABANDON/.test(name)) return { text: fx.detail || 'Off', tone: 'off' };
      return { text: /PEN/.test(name) ? 'Pens' : /AET/.test(name) ? 'AET' : 'FT', tone: 'done' };
    }
    if (/POSTPONED|CANCEL|DELAY|SUSPEND/.test(name)) return { text: fx.detail || 'Off', tone: 'off' };
    return { text: fx.kickoff || 'TBC', tone: 'soon' };
  }
  function teamLine(t, showScore) {
    const line = document.createElement('span');
    line.className = 'fx-team';
    if (t.logo) {
      const img = document.createElement('img');
      img.src = t.logo;
      img.alt = '';
      img.loading = 'lazy';
      img.addEventListener('error', () => { const dot = document.createElement('i'); dot.className = 'fx-dot'; img.replaceWith(dot); });
      line.appendChild(img);
    } else {
      const dot = document.createElement('i');
      dot.className = 'fx-dot';
      line.appendChild(dot);
    }
    const name = document.createElement('b');
    name.textContent = t.name;
    line.appendChild(name);
    if (showScore) {
      const sc = document.createElement('span');
      sc.className = 'fx-score';
      sc.textContent = t.score == null ? '' : String(t.score);
      line.appendChild(sc);
    }
    return line;
  }
  function paintFixtures() {
    const box = el.fixtures;
    const linkedId = live ? String(live.feed.fixtureId || '') : '';
    const compName = (M.COMPETITIONS.find((c) => c.key === (feedComp || 'pl')) || {}).name || '';
    const q = el.fxSearch.value.trim().toLowerCase();
    const sig = JSON.stringify([fixtures, fixturesError, loading, linkedId, q]);
    if (box._sig === sig) return;
    box._sig = sig;
    box.replaceChildren();
    const note = (text, cls) => { const p = document.createElement('p'); p.className = cls || 'fx-empty'; p.textContent = text; box.appendChild(p); };
    if (loading && !fixtures) { note('Loading matches…'); return; }
    if (fixturesError) { note(fixturesError, 'fx-empty is-error'); return; }
    if (!fixtures) return;
    if (!fixtures.length) { note(`No ${compName} matches on this day. Try another day.`); return; }
    const list = q ? fixtures.filter((fx) => `${fx.home.name} ${fx.away.name} ${fx.home.code} ${fx.away.code}`.toLowerCase().includes(q)) : fixtures;
    if (!list.length) { note(`No team matching “${el.fxSearch.value.trim()}” plays in ${compName} on this day.`); return; }
    list.forEach((fx) => {
      const row = document.createElement('div');
      row.className = 'fx';
      if (fx.id === linkedId) row.classList.add('is-linked');
      const st = fixtureStatus(fx);
      const time = document.createElement('span');
      time.className = `fx-time is-${st.tone}`;
      time.textContent = st.text;
      const teams = document.createElement('span');
      teams.className = 'fx-teams';
      const started = fx.state !== 'pre';
      teams.append(teamLine(fx.home, started), teamLine(fx.away, started));
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-small';
      btn.dataset.act = 'feed-link';
      btn.dataset.id = fx.id;
      btn.textContent = fx.id === linkedId ? 'Following' : 'Follow';
      btn.disabled = fx.id === linkedId;
      btn.setAttribute('aria-label', `Follow ${fx.home.name} v ${fx.away.name}`);
      row.append(time, teams, btn);
      box.appendChild(row);
    });
  }
  function localFeedError(text) {
    el.feedError.dataset.local = text || '';
    setText(el.feedError, text || '');
  }
  async function linkFixture(id, btn) {
    localFeedError('');
    if (btn) { btn.disabled = true; btn.textContent = 'Loading…'; }
    try {
      await Hub.call('POST', '/api/football/follow', { streamer: Hub.streamer.id, eventId: id, comp: feedComp || 'pl' });
      Hub.toast('Following the match. The scoreboard updates by itself now.', { tone: 'good' });
      fixturesKey = '';
      loadFixtures(true, true);
    } catch (e) {
      localFeedError(e.message);
      if (btn) { btn.disabled = false; btn.textContent = 'Follow'; }
    }
  }
  async function feedSettings(body) {
    try { await Hub.call('POST', '/api/football/settings', Object.assign({ streamer: Hub.streamer.id }, body)); } catch (e) { localFeedError(e.message); }
  }
  // While the Match tab is open, the list keeps itself up to date.
  setInterval(() => {
    if (Hub.view === 'scoreboard' && tab === 'match' && !document.hidden) loadFixtures(true, true);
  }, 15 * 1000);

  /* ---------- Stats tab ---------- */
  function buildStatChips() {
    M.STATS.forEach((s) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.dataset.act = 'stat-toggle';
      b.dataset.key = s.key;
      b.textContent = s.label;
      el.statChips.appendChild(b);
    });
  }
  let stripsKey = '';
  function syncStats() {
    const shown = live.statsShown;
    el.statChips.querySelectorAll('[data-key]').forEach((b) => {
      const on = shown.includes(b.dataset.key);
      b.setAttribute('aria-pressed', String(on));
      b.disabled = !on && shown.length >= M.MAX_SHOWN;
    });
    setText(el.statsHeadNote, shown.length ? `${shown.length} of ${M.MAX_SHOWN} showing under the scoreboard and on the big card` : 'None showing. Pick some to show under the scoreboard and on the big card.');
    const fedKeys = following() ? live.feed.statsKeys : [];
    el.possBox.hidden = !shown.includes('poss');
    const ph = M.clamp(live.stats.poss[0], 0, 100);
    setValue(el.inPoss, String(ph));
    el.inPoss.style.setProperty('--p', `${ph}%`);
    el.inPoss.disabled = fedKeys.includes('poss');
    setText(el.possHome, `${ph}%`);
    setText(el.possAway, `${100 - ph}%`);
    const keys = shown.filter((k) => k !== 'poss');
    const sig = keys.join(',');
    if (sig !== stripsKey) {
      stripsKey = sig;
      el.statCtl.replaceChildren();
      keys.forEach((key) => {
        const def = M.STAT[key];
        const row = document.createElement('div');
        row.className = 'strip';
        row.dataset.strip = key;
        const side = (t, who) => `<div class="stepper ${t === 0 ? 'h' : 'a'}"><button class="btn btn-sq" type="button" data-act="stat" data-key="${key}" data-team="${t}" data-d="-1" aria-label="${def.label}, ${who} team: less">−</button><output data-out="${key}-${t}"></output><button class="btn btn-sq" type="button" data-act="stat" data-key="${key}" data-team="${t}" data-d="1" aria-label="${def.label}, ${who} team: more">+</button></div>`;
        row.innerHTML = `<div class="strip-name"></div>${side(0, 'home')}${side(1, 'away')}<div class="mini" aria-hidden="true"><i class="mh"></i><i class="ma"></i></div>`;
        row.querySelector('.strip-name').textContent = def.label;
        el.statCtl.appendChild(row);
      });
    }
    el.statCtl.querySelectorAll('[data-strip]').forEach((strip) => {
      const key = strip.dataset.strip;
      const def = M.STAT[key];
      const [h, a] = live.stats[key];
      strip.querySelectorAll('output').forEach((o) => setText(o, M.formatStat(def, +o.dataset.out.split('-')[1] === 0 ? h : a)));
      const p = h + a ? (h / (h + a)) * 100 : 50;
      strip.querySelector('.mh').style.width = `calc(${p.toFixed(1)}% - 1.5px)`;
      strip.querySelector('.ma').style.width = `calc(${(100 - p).toFixed(1)}% - 1.5px)`;
      const fed = fedKeys.includes(key);
      strip.classList.toggle('is-fed', fed);
      strip.querySelectorAll('button').forEach((b) => { b.disabled = fed; });
    });
    el.statsFeedNote.hidden = !fedKeys.length;
  }

  /* Destructive buttons ask for a second tap instead of a pop-up */
  let pending = null;
  let pendingTimer = 0;
  function clearPending() {
    if (!pending) return;
    const b = pending;
    pending = null;
    clearTimeout(pendingTimer);
    b.classList.remove('is-confirming');
    setText(b, b.dataset.label || '');
    syncControls();
  }
  function confirmTwice(btn, fn) {
    if (pending === btn) { clearPending(); fn(); return; }
    clearPending();
    pending = btn;
    btn.dataset.label = btn.textContent;
    btn.classList.add('is-confirming');
    setText(btn, 'Tap again to reset');
    pendingTimer = setTimeout(clearPending, 3200);
  }

  /* ---------- Match actions (the big ones can be undone) ---------- */
  function undoable(label, fn) {
    const done = Hub.remember('scoreboard', label);
    fn();
    done();
  }
  // A match that kicked off more than 12 hours ago and isn't on screen is cleared when the hub opens
  // (with Undo), so yesterday's game isn't waiting there. Follow my team loads the next match by itself instead.
  // The kick-off with its day when it isn't today, so an old or future match is obvious ("KO Thu 20:00", "KO 2 Dec 20:00")
  function koLabel(s) {
    if (!s.kickoffAt) return s.kickoff;
    const d = new Date(s.kickoffAt);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) return s.kickoff;
    return Math.abs(d - now) < 6 * 86400000 ? `${d.toLocaleDateString('en-GB', { weekday: 'short' })} ${s.kickoff}` : `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ${s.kickoff}`;
  }
  function clearIfOld(force) {
    if (!live) return;
    if (force && live.onAir) { Hub.toast('Take the scoreboard off screen first, then clear the match.', { tone: 'bad' }); return; }
    if (!force && (live.onAir || !live.kickoffAt || Date.now() - live.kickoffAt < 12 * 3600 * 1000)) return;
    if (!force && live.follow && live.follow.team) return;
    const was = `${M.nameOf(live.home)} v ${M.nameOf(live.away)}`;
    undoable(force ? `${was} cleared. Pick a match in Find a match when you need one.` : `${was} was an old match, so the scoreboard was cleared. Pick today’s match in Find a match.`, () => {
      const d = M.defaults();
      ['home', 'away', 'comp', 'compLogo', 'kickoff', 'kickoffAt', 'period', 'note', 'added', 'score', 'pens', 'stats', 'goals', 'reds', 'anims', 'shoot'].forEach((k) => { if (k in d) live[k] = M.copy(d[k]); });
      M.setClock(live, 0, false);
      live.feed = Object.assign({}, live.feed, { fixtureId: 0, compKey: '', title: '', status: '', statusShort: '', done: false });
      commit();
    });
  }
  function newMatch() {
    undoable('New match started.', () => {
      M.setClock(live, 0, false);
      live.period = 'pre';
      live.note = '';
      live.added = 0;
      live.score = [0, 0];
      live.pens = null;
      live.stats = M.zeroStats();
      live.goals = [];
      live.reds = [];
      live.anims = [];

      commit();
    });
  }
  function advance() {
    const p = live.period;
    if (p === 'ft') { confirmTwice(el.advanceBtn, newMatch); return; }
    const label = `${ACTIONS[p]}.`;
    undoable(label, () => {
      if (p === 'pre') { live.period = '1h'; M.setClock(live, 0, true); }
      else if (p === '1h') { live.period = 'ht'; M.setClock(live, M.elapsed(live), false); }
      else if (p === 'ht') { live.period = '2h'; M.setClock(live, M.START['2h'], true); }
      else if (p === 'brk') {
        const second = M.elapsed(live) >= M.END.et1;
        live.period = second ? 'et2' : 'et1';
        M.setClock(live, second ? M.START.et2 : M.START.et1, true);
      } else if (p === 'et1') { live.period = 'brk'; M.setClock(live, Math.max(M.elapsed(live), M.END.et1), false); }
      else { live.period = 'ft'; M.setClock(live, M.elapsed(live), false); }
      live.added = 0;
      commit();
    });
  }
  function jumpPeriod(p) {
    if (!p || p === live.period) return;
    undoable(`Period set to ${PERIOD_NAMES[p]}.`, () => {
      const start = { pre: 0, '1h': 0, '2h': M.START['2h'], et1: M.START.et1, et2: M.START.et2 }[p];
      live.period = p;
      live.added = 0;
      if (p !== 'ft') live.note = '';
      M.setClock(live, start !== undefined ? start : M.elapsed(live), false);
      commit();
    });
  }
  function setClockFromInput() {
    const v = M.parseClock(el.inClock.value);
    if (v == null) {
      el.inClock.setAttribute('aria-invalid', 'true');
      setText(el.clockHint, 'Type the time as minutes and seconds, like 63:20, or added time, like 45+2.');
      return;
    }
    el.inClock.removeAttribute('aria-invalid');
    setText(el.clockHint, '');
    undoable('Clock set.', () => {
      M.setClock(live, v, live.clock.running);
      el.inClock.value = '';
      commit();
    });
  }
  function nudge(d) {
    M.setClock(live, M.elapsed(live) + d, live.clock.running);
    commit();
  }
  function setDelay(v) {
    live.delay = M.clamp(Math.round(v), 0, 300);
    commit({ keepPreview: true });
  }
  function toggleClock() {
    if (!M.inPlay(live)) return;
    M.setClock(live, M.elapsed(live), !live.clock.running);
    commit();
  }
  const minuteNow = () => (M.inPlay(live) ? M.minuteMark(live) : '');
  function takePlayer() {
    const name = el.inScorer.value.trim().slice(0, 30);
    el.inScorer.value = '';
    return name;
  }
  function goal(team, sure) {
    const recent = live.goals.filter((g) => g.team === team && M.now() - (g.at || 0) < 10000);
    if (recent.length && !sure) {
      const ago = Math.max(1, Math.round((M.now() - recent[recent.length - 1].at) / 1000));
      Hub.toast(`A goal for ${teamName(team)} went in ${ago} s ago. Add another?`, { action: { label: 'Add goal', fn: () => goal(team, true) }, ms: 8000 });
      return;
    }
    document.querySelectorAll(`[data-act="goal"][data-team="${team}"]`).forEach((btn) => {
      btn.classList.remove('is-fired');
      void btn.offsetWidth;
      btn.classList.add('is-fired');
      setTimeout(() => btn.classList.remove('is-fired'), 650);
    });
    const scorer = takePlayer();
    const minute = minuteNow();
    undoable(`Goal for ${teamName(team)}${scorer ? ` (${scorer})` : ''}.`, () => {
      live.score[team] = M.clamp(live.score[team] + 1, 0, 99);
      live.goals.push({ team, scorer, minute, src: 'manual', key: '', at: M.now(), typed: !!scorer });
      anim({ kind: 'goal', team, name: scorer, minute });
      commit();
    });
  }
  function adjustScore(team, d) {
    undoable(`${d > 0 ? 'Added a goal to' : 'Took a goal off'} ${teamName(team)}.`, () => {
      if (d > 0) {
        live.score[team] = M.clamp(live.score[team] + 1, 0, 99);
        live.goals.push({ team, scorer: '', minute: minuteNow(), src: 'manual', key: '', at: M.now(), typed: false });
      } else {
        live.score[team] = M.clamp(live.score[team] - 1, 0, 99);
        for (let i = live.goals.length - 1; i >= 0; i -= 1) {
          if (live.goals[i].team === team) {
            const [gone] = live.goals.splice(i, 1);
            if (gone.src === 'feed' && gone.key) ctl.ignore(gone.key);
            break;
          }
        }
      }
      commit();
    });
  }
  function redCard(team) {
    const player = takePlayer();
    const minute = minuteNow();
    undoable(`Red card for ${teamName(team)}${player ? ` (${player})` : ''}.`, () => {
      live.reds.push({ team, player, minute, src: 'manual', key: '', at: M.now() });
      anim({ kind: 'red', team, name: player, minute });
      commit();
    });
  }
  function removeRed(index) {
    const r = live.reds[index];
    if (!r) return;
    undoable(`Red card taken off ${teamName(r.team)}.`, () => {
      live.reds.splice(index, 1);
      if (r.src === 'feed' && r.key) ctl.ignore(r.key);
      commit();
    });
  }
  function replayGoal() {
    if (!live.goals.length) return;
    const last = live.goals.reduce((a, b) => ((b.at || 0) >= (a.at || 0) ? b : a));
    anim({ kind: 'goal', team: last.team, name: last.scorer, minute: last.minute });
    commit({ keepPreview: true });
  }
  function keepInside(kind) {
    const node = kind === 'bug' ? ctl.view.el.bug : ctl.view.el.card;
    const p = live[kind];
    const k = p.s * live.scale;
    const w = node.offsetWidth * k;
    const h = node.offsetHeight * k;
    if (kind === 'bug') {
      p.x = Math.round(M.clamp(p.x, 0, Math.max(0, SB.W - w)));
      p.y = Math.round(M.clamp(p.y, 0, Math.max(0, SB.H - h)));
    } else {
      p.x = Math.round(M.clamp(p.x, w / 2, Math.max(w / 2, SB.W - w / 2)));
      p.y = Math.round(M.clamp(p.y, h, SB.H));
    }
  }
  function bugPosition(where) {
    const w = ctl.view.el.bug.offsetWidth * live.bug.s * live.scale;
    live.bug.x = Math.round(where === 'left' ? 64 : where === 'right' ? SB.W - 64 - w : (SB.W - w) / 2);
    live.bug.y = 44;
    commit({ keepPreview: true });
  }
  function onDrag(kind, x, y) {
    if (!live || blocked()) return;
    live[kind].x = x;
    live[kind].y = y;
    commit({ keepPreview: true });
  }
  function toggleStat(key) {
    const on = live.statsShown.includes(key);
    if (!on && live.statsShown.length >= M.MAX_SHOWN) return;
    const next = on ? live.statsShown.filter((k) => k !== key) : live.statsShown.concat(key);
    live.statsShown = M.STATS.map((s) => s.key).filter((k) => next.includes(k));
    commit({ keepPreview: true });
  }
  function stepStat(key, team, d) {
    const def = M.STAT[key];
    if (!def) return;
    const step = def.kind === 'dec' ? 0.1 : 1;
    live.stats[key][team] = M.statClean(def, live.stats[key][team] + d * step);
    commit();
  }

  /* ---------- Keyboard (only on this page, and never while typing) ---------- */
  function onKey(k) {
    if (!live) return false;
    if (k === ' ') { if (live.mode === 'manual') toggleClock(); return true; } // in Live the match runs the clock
    if (k === 'h' || k === 'H') { goal(0); return true; }
    if (k === 'a' || k === 'A') { goal(1); return true; }
    if (k === 'o' || k === 'O') { Hub.setOnAir('scoreboard', !live.onAir); return true; }
    if (/^[1-4]$/.test(k)) { setTab(TABS[+k - 1]); return true; }
    return false;
  }

  /* Crest images are shrunk to a 192px PNG on this device, then stored by the server */
  function toPng(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const size = 192;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const iw = img.naturalWidth || size;
        const ih = img.naturalHeight || size;
        const k = Math.min(size / iw, size / ih);
        canvas.getContext('2d').drawImage(img, (size - iw * k) / 2, (size - ih * k) / 2, iw * k, ih * k);
        URL.revokeObjectURL(url);
        try { resolve(canvas.toDataURL('image/png')); } catch (e) { reject(e); }
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('unreadable')); };
      img.src = url;
    });
  }
  async function uploadCrest(file, side, label) {
    const err = side === 'home' ? el.crestErrHome : el.crestErrAway;
    if (!/^image\//.test(file.type)) { setText(err, 'That file isn’t an image. Choose a PNG, JPG, SVG or WebP.'); return; }
    setText(err, '');
    label.classList.add('is-busy');
    try {
      const dataUrl = await toPng(file);
      await Hub.call('POST', `/api/crest/${Hub.streamer.id}/${side}`, { dataUrl });
    } catch (e) {
      setText(err, e && e.message === 'unreadable' ? 'That image couldn’t be read. Try saving it as a PNG first.' : e.message);
    }
    label.classList.remove('is-busy');
  }
  async function removeCrest(side) {
    const err = side === 'home' ? el.crestErrHome : el.crestErrAway;
    try { await Hub.call('DELETE', `/api/crest/${Hub.streamer.id}/${side}`); setText(err, ''); } catch (e) { setText(err, e.message); }
  }

  /* ---------- Events ---------- */
  document.addEventListener('click', (e) => {
    const vb = e.target.closest('#sbVis [data-vis]');
    if (vb && live) {
      const to = vb.dataset.vis;
      live.onAir = to === 'live';
      live.preview = to !== 'off';
      commit({ keepPreview: true });
      Hub.toast(to === 'live' ? 'Scoreboard is on screen' : to === 'preview' ? 'Scoreboard in preview: only you can see it' : 'Scoreboard is off', { tone: to === 'live' ? 'goal' : 'info' });
      return;
    }
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    const act = b.dataset.act;
    if (act === 'sample') { startPreview(b.dataset.sample); return; }
    if (act === 'sample-off') { stopPreview(); return; }
    if (act === 'test-anims') { testAnimations(); return; }
    if (act === 'practice') { practice(); return; }
    if (['board', 'kick', 'kick-undo', 'kick-clear', 'auto', 'scene-apply', 'scene-del', 'follow-save', 'follow-clear'].includes(act) && live) { extras(act, b); return; }
    if (act === 'popups' && live) { ['goalFlash', 'redFlash', 'varFlash', 'addedBoard', 'banners', 'spotlight', 'splash', 'subs'].forEach((k) => { live.show[k] = b.dataset.val === '1'; }); commit({ keepPreview: true }); return; }
    if (act === 'flash' && live) { live.show[b.dataset.key] = b.dataset.val === '1'; commit({ keepPreview: true }); return; }
    if (act === 'card-now' && live) { live.show.card = live.show.card === 'show' ? 'auto' : 'show'; live.board = 'none'; commit({ keepPreview: true }); return; }
    if (act === 'copy-result') { if (live) copyResult(); return; }
    if (act === 'tab') { setTab(b.dataset.tab); return; }
    if (!live || blocked()) return;
    const team = Number(b.dataset.team);
    const d = Number(b.dataset.d);
    switch (act) {
      case 'air': Hub.setOnAir('scoreboard', b.dataset.val === '1'); break;
      case 'mode':
        if (live.mode === b.dataset.val) break;
        live.mode = b.dataset.val === 'live' ? 'live' : 'manual';
        commit({ keepPreview: true });
        Hub.toast(live.mode === 'live' ? 'Auto: the scoreboard follows the match by itself.' : 'By hand: nothing changes unless you press something.');
        break;
      case 'period': jumpPeriod(b.dataset.period); break;
      case 'advance': advance(); break;
      case 'clock': toggleClock(); break;
      case 'nudge': nudge(d); break;
      case 'set-clock': setClockFromInput(); break;
      case 'added': live.added = M.clamp(live.added + d, 0, 30); commit(); break;
      case 'goal': goal(team); break;
      case 'score': adjustScore(team, d); break;
      case 'red': redCard(team); break;
      case 'red-remove': removeRed(Number(b.dataset.index)); break;
      case 'replay': replayGoal(); break;
      case 'stat': stepStat(b.dataset.key, team, d); break;
      case 'stat-toggle': toggleStat(b.dataset.key); break;
      case 'delay': setDelay(live.delay + d); break;
      case 'delay-reset': setDelay(0); break;
      case 'swatch': pickSwatch(b.dataset.side, b.dataset.c, b.dataset.l); break;
      case 'accent': live.look.accent = b.dataset.val === 'brand' ? 'brand' : 'comp'; commit({ keepPreview: true }); break;
      case 'look': live.look[b.dataset.key] = b.dataset.val === '1'; commit({ keepPreview: true }); break;
      case 'show':
        if (['card', 'scorers', 'names', 'style'].includes(b.dataset.key)) live.show[b.dataset.key] = b.dataset.val;
        else live.show[b.dataset.key] = b.dataset.val === '1';
        commit({ keepPreview: true });
        break;
      case 'expand': {
        const item = b.closest('.item');
        const open = !item.classList.contains('is-open');
        item.classList.toggle('is-open', open);
        b.setAttribute('aria-expanded', String(open));
        break;
      }
      case 'bug-pos': bugPosition(b.dataset.pos); break;
      case 'card-home': live.card.x = SB.W / 2; live.card.y = SB.H - 64; keepInside('card'); commit({ keepPreview: true }); break;
      case 'crest-clear': removeCrest(team === 0 ? 'home' : 'away'); break;
      case 'reset': confirmTwice(b, newMatch); break;
      case 'clear-match': confirmTwice(b, () => clearIfOld(true)); break;
      case 'comp': feedComp = b.dataset.comp; Hub.store.set('sb-comp', feedComp); syncFeed(); loadFixtures(false); break;
      case 'day': feedDay = shiftDay(Number(b.dataset.shift)); syncFeed(); loadFixtures(false); break;
      case 'feed-link': linkFixture(b.dataset.id, b); break;
      case 'feed-unlink':
        Hub.call('POST', '/api/football/unfollow', { streamer: Hub.streamer.id })
          .then(() => { Hub.toast('Stopped following. The scoreboard is in Manual now.'); fixturesKey = ''; loadFixtures(true, true); })
          .catch((err) => localFeedError(err.message));
        break;
      case 'feed-refresh': Hub.call('POST', '/api/football/refresh', { streamer: Hub.streamer.id }).catch((err) => localFeedError(err.message)); break;
      case 'poll': feedSettings({ pollSeconds: Number(b.dataset.secs) }); break;
      default: break;
    }
  });
  // Arrow keys move between the tabs, as tab lists do.
  document.querySelector('.tabs').addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const i = TABS.indexOf(tab);
    setTab(TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length]);
    const btn = document.querySelector(`[data-act="tab"][data-tab="${tab}"]`);
    if (btn) btn.focus();
  });

  const onInput = (input, fn, opts) => input.addEventListener('input', () => {
    if (!live || blocked()) return;
    fn(input.value);
    commit(opts);
  });
  const look = { keepPreview: true };
  onInput(el.inHomeName, (v) => { live.home.name = v.slice(0, 40); }, look);
  onInput(el.inAwayName, (v) => { live.away.name = v.slice(0, 40); }, look);
  onInput(el.inHomeFull, (v) => { live.home.full = v.slice(0, 48); }, look);
  onInput(el.inAwayFull, (v) => { live.away.full = v.slice(0, 48); }, look);
  onInput(el.inHomeCode, (v) => { live.home.code = v.replace(/[^\p{L}\p{N}]/gu, '').toUpperCase().slice(0, 4); }, look);
  onInput(el.inAwayCode, (v) => { live.away.code = v.replace(/[^\p{L}\p{N}]/gu, '').toUpperCase().slice(0, 4); }, look);
  const colourInput = (side) => (v) => {
    if (!M.isHex(v)) return;
    live[side].color = v.toLowerCase();
    if (live.feed.kitColours && live.feed.fixtureId) feedSettings({ kitColours: false }); // a colour picked by hand stays
  };
  onInput(el.inHomeColor, colourInput('home'), look);
  onInput(el.inAwayColor, colourInput('away'), look);
  onInput(el.inComp, (v) => {
    live.comp = v.slice(0, 40);
    const known = M.COMPETITIONS.find((c) => c.name.toLowerCase() === live.comp.trim().toLowerCase());
    live.compLogo = known ? known.logo : '';
  }, look);
  onInput(el.inKickoff, (v) => { live.kickoff = v.trim().slice(0, 5); live.kickoffAt = M.kickoffAtFor(live.kickoff); }, look);
  onInput(el.inPoss, (v) => { const h = M.clamp(Math.round(+v) || 0, 0, 100); live.stats.poss = [h, 100 - h]; });
  onInput(el.inScale, (v) => { live.scale = M.clamp(+v / 100, 0.5, 1.6); keepInside('bug'); keepInside('card'); }, look);
  onInput(el.inBugSize, (v) => { live.bug.s = M.clamp(+v / 100, 0.6, 1.5); keepInside('bug'); }, look);
  onInput(el.inCardSize, (v) => { live.card.s = M.clamp(+v / 100, 0.6, 1.3); keepInside('card'); }, look);
  el.inTz.addEventListener('change', () => {
    if (!live || blocked() || !M.validZone(el.inTz.value)) return;
    live.tz = el.inTz.value;
    commit({ keepPreview: true });
    fixturesKey = '';
    loadFixtures(true);
  });
  onInput(el.inBrand, (v) => { if (M.isHex(v)) { live.look.brand = v.toLowerCase(); live.look.accent = 'brand'; } }, look);
  el.periodMore.addEventListener('change', () => {
    const v = el.periodMore.value;
    el.periodMore.value = '';
    if (v && live && !blocked()) jumpPeriod(v);
  });
  el.dayInput.addEventListener('change', () => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(el.dayInput.value)) { feedDay = el.dayInput.value; syncFeed(); loadFixtures(false); }
  });
  el.fxSearch.addEventListener('input', paintFixtures);
  el.kitToggle.addEventListener('change', () => feedSettings({ kitColours: el.kitToggle.checked }));
  el.crestToggle.addEventListener('change', () => feedSettings({ crests: el.crestToggle.checked }));
  [['home', el.inHomeCrest], ['away', el.inAwayCrest]].forEach(([side, input]) => {
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      input.value = '';
      if (file) uploadCrest(file, side, input.closest('label'));
    });
  });
  el.inClock.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); setClockFromInput(); } });

  /* ---------- Start ---------- */
  buildCompChips();
  buildStatChips();
  paintTabs();
  setInterval(tickReadout, 250);
})();
