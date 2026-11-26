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
  const PATCHABLE = ['mode', 'onAir', 'scale', 'clockOffset', 'comp', 'compLogo', 'kickoff', 'kickoffAt', 'home', 'away', 'period', 'note', 'clock',
    'added', 'score', 'pens', 'stats', 'statsShown', 'goals', 'reds', 'anims', 'show', 'bug', 'card', 'writer', 'rev'];
  const TABS = ['match', 'stats', 'teams', 'layout'];

  const el = {};
  [
    'chips', 'controls', 'resetBtn', 'sourceLine', 'sourceText',
    'tally', 'readTime', 'readState', 'advanceBtn', 'clockBtn', 'clockBtnText', 'inClock', 'clockHint', 'addedOut', 'offsetNote', 'periodMore',
    'deckHomeBadge', 'deckAwayBadge', 'scHomeCode', 'scAwayCode', 'scHomeName', 'scAwayName', 'scHome', 'scAway', 'sideRedsHome', 'sideRedsAway',
    'goalHome', 'goalAway', 'inScorer', 'replayBtn',
    'compChips', 'daySeg', 'dayInput', 'fxSearch', 'fixtures', 'linkedBox', 'linkedTitle', 'linkedStatus', 'linkedMeta', 'refreshBtn', 'unlinkBtn',
    'pollSeg', 'kitToggle', 'crestToggle', 'feedError',
    'statChips', 'statsHeadNote', 'possBox', 'possHome', 'possAway', 'inPoss', 'statCtl', 'statsFeedNote',
    'inScale', 'scaleOut', 'inBugSize', 'bugSizeOut', 'inCardSize', 'cardSizeOut',
    'teamsNote', 'inHomeName', 'inHomeCode', 'inHomeColor', 'inHomeCrest', 'prevHome', 'clearHome', 'crestErrHome',
    'inAwayName', 'inAwayCode', 'inAwayColor', 'inAwayCrest', 'prevAway', 'clearAway', 'crestErrAway',
    'inComp', 'inKickoff', 'compList',
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
      if (first) { loadFixtures(false); }
      else if (before && before !== s) announce(before, s);
      if (previewKey) {
        const keep = previewState ? previewState.clock : null;
        previewState = M.withSample(live, previewKey);
        if (keep) previewState.clock = keep;
      }
      syncControls();
    },
    onCommit(opts) { if (previewKey && !opts.keepPreview) stopPreview(); },
    previewState: () => (previewKey ? previewState : null),
    sampleLabel: () => (previewKey ? M.SAMPLES[previewKey].label : ''),
    tileSummary,
    keepOnUndo: (cur) => ({ feed: cur.feed, compKey: cur.compKey }),
    onKey,
    onShow() { loadFixtures(false); paintTabs(); },
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
    const text = `${M.codeOf(s.home)} ${s.score[0]}–${s.score[1]} ${M.codeOf(s.away)}`;
    let small;
    if (M.inPlay(s)) small = M.minuteMark(s) || 'Live';
    else if (s.period === 'pre') small = s.kickoff ? `KO ${s.kickoff}` : 'Pre-match';
    else small = { ht: 'HT', brk: 'Break', pens: 'Pens', ft: 'FT' }[s.period] || '';
    return { text, small };
  }

  /* ---------- Toasts for goals and cards that came from ESPN or another device ---------- */
  function announce(before, s) {
    const seen = new Set(before.anims.map((a) => a.id));
    s.anims.filter((a) => !seen.has(a.id) && !own.has(a.id)).forEach((a) => {
      const team = M.nameOf(a.team === 0 ? s.home : s.away);
      const who = [a.name, a.minute].filter(Boolean).join(' ');
      if (a.kind === 'goal') Hub.toast(`Goal for ${team}${who ? `: ${who}` : ''}`, { tone: 'goal' });
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
      text = 'Manual: the scoreboard only changes when you change it.';
      tone = 'idle';
    } else if (!f.fixtureId) {
      text = 'ESPN live is on. Pick a match below and the scoreboard follows it.';
      tone = 'wait';
    } else if (f.error) {
      text = `Following ${f.title}, but the last update failed: ${f.error}`;
      tone = 'bad';
    } else {
      const when = f.updatedAt ? `updated ${ago(M.now() - f.updatedAt)} ago` : 'waiting for the first update';
      text = `Following ${f.title} from ESPN, ${when}.`;
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
        else parts.push(`Checking ESPN every ${f.pollSeconds} s.`);
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
    const list = live.reds.map((r, i) => ({ r, i })).filter((x) => x.r.team === team);
    const key = list.map((x) => `${x.i}:${x.r.player}:${x.r.minute}`).join('|');
    if (node._key === key) return;
    node._key = key;
    node.replaceChildren();
    list.forEach(({ r, i }) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'red-chip';
      b.dataset.act = 'red-remove';
      b.dataset.index = String(i);
      const who = [r.player, r.minute].filter(Boolean).join(' ');
      b.title = `Take off this red card${who ? ` (${who})` : ''}`;
      b.setAttribute('aria-label', b.title);
      node.appendChild(b);
    });
  }
  function syncControls() {
    if (!live) return;
    el.chips.querySelectorAll('[data-sample]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.sample === previewKey)));
    document.querySelectorAll('[data-act="air"]').forEach((b) => b.setAttribute('aria-pressed', String((b.dataset.val === '1') === live.onAir)));
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
    el.offsetNote.hidden = !following() || !live.clockOffset;
    setText(el.offsetNote, `Live clock moved ${live.clockOffset > 0 ? '+' : '−'}${Math.abs(live.clockOffset)} s to match the TV. The nudge buttons change this.`);
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
      const val = key === 'card' ? b.dataset.val : b.dataset.val === '1';
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
    setValue(el.inAwayCode, live.away.code);
    setValue(el.inAwayColor, live.away.color);
    setValue(el.inComp, live.comp);
    setValue(el.inKickoff, live.kickoff);
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
    setText(el.teamsNote, f.fixtureId ? 'Filled in from ESPN. Your changes here stay.' : 'Following a match fills these in');
    paintFixtures();
  }
  async function loadFixtures(force, quiet) {
    if (!live || blocked()) return;
    const key = `${feedComp || 'pl'}|${feedDay}`;
    if (!force && key === fixturesKey && (fixtures || fixturesError || loading)) return;
    if (loading && quiet) return;
    fixturesKey = key;
    if (!quiet) { fixtures = null; fixturesError = ''; }
    loading = !quiet;
    paintFixtures();
    try {
      const data = await Hub.call('GET', `/api/football/matches?comp=${encodeURIComponent(feedComp || 'pl')}&date=${encodeURIComponent(feedDay)}`);
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
      await Hub.call('POST', '/api/football/follow', { eventId: id, comp: feedComp || 'pl' });
      Hub.toast('Following the match. The scoreboard updates by itself now.', { tone: 'good' });
      fixturesKey = '';
      loadFixtures(true, true);
    } catch (e) {
      localFeedError(e.message);
      if (btn) { btn.disabled = false; btn.textContent = 'Follow'; }
    }
  }
  async function feedSettings(body) {
    try { await Hub.call('POST', '/api/football/settings', body); } catch (e) { localFeedError(e.message); }
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
      live.clockOffset = 0;
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
      if (following()) live.clockOffset = M.clamp(Math.round(live.clockOffset + (v - M.elapsed(live))), -600, 600);
      M.setClock(live, v, live.clock.running);
      el.inClock.value = '';
      commit();
    });
  }
  function nudge(d) {
    M.setClock(live, M.elapsed(live) + d, live.clock.running);
    if (following()) live.clockOffset = M.clamp(live.clockOffset + d, -600, 600);
    commit();
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
  function goal(team) {
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
    if (k === ' ') { toggleClock(); return true; }
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
      await Hub.call('POST', `/api/crest/${side}`, { dataUrl });
    } catch (e) {
      setText(err, e && e.message === 'unreadable' ? 'That image couldn’t be read. Try saving it as a PNG first.' : e.message);
    }
    label.classList.remove('is-busy');
  }
  async function removeCrest(side) {
    const err = side === 'home' ? el.crestErrHome : el.crestErrAway;
    try { await Hub.call('DELETE', `/api/crest/${side}`); setText(err, ''); } catch (e) { setText(err, e.message); }
  }

  /* ---------- Events ---------- */
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    const act = b.dataset.act;
    if (act === 'sample') { startPreview(b.dataset.sample); return; }
    if (act === 'sample-off') { stopPreview(); return; }
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
        Hub.toast(live.mode === 'live' ? 'ESPN live: the scoreboard follows the match by itself.' : 'Manual: nothing changes unless you change it.');
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
      case 'show':
        if (b.dataset.key === 'card') live.show.card = b.dataset.val;
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
      case 'comp': feedComp = b.dataset.comp; Hub.store.set('sb-comp', feedComp); syncFeed(); loadFixtures(false); break;
      case 'day': feedDay = shiftDay(Number(b.dataset.shift)); syncFeed(); loadFixtures(false); break;
      case 'feed-link': linkFixture(b.dataset.id, b); break;
      case 'feed-unlink':
        Hub.call('POST', '/api/football/unfollow')
          .then(() => { Hub.toast('Stopped following. The scoreboard is in Manual now.'); fixturesKey = ''; loadFixtures(true, true); })
          .catch((err) => localFeedError(err.message));
        break;
      case 'feed-refresh': Hub.call('POST', '/api/football/refresh').catch((err) => localFeedError(err.message)); break;
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
