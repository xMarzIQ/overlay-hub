/*
  The live scoreboard overlay: the bar, red cards, the stats under it, the big stats card and the
  goal, scorer and red card animations. It draws into a 1920×1080 stage (stage.js), on the OBS page
  and in the hub's preview.
*/
(() => {
  'use strict';
  const M = window.Match;
  const W = 1920;
  const H = 1080;

  let ballN = 0;
  const BALL = () => {
    ballN += 1;
    const id = `ballclip${ballN}`;
    return `<svg viewBox="0 0 48 48" aria-hidden="true"><defs><clipPath id="${id}"><circle cx="24" cy="24" r="21"/></clipPath></defs>`
      + '<circle cx="24" cy="24" r="21" fill="#fff"/>'
      + `<g clip-path="url(#${id})" fill="#16090e"><path d="M24 15l8.56 6.22-3.27 10.06H18.71l-3.27-10.06z"/>`
      + '<path d="M24 11l-6.66-4.84 2.54-7.82h8.24l2.54 7.82z"/><path d="M36.36 19.98l2.55-7.82h8.22l2.55 7.82-6.66 4.84z"/>'
      + '<path d="M31.65 34.52h8.22l2.55 7.82-6.66 4.84-6.66-4.84z"/><path d="M16.35 34.52l2.55 7.82-6.66 4.84-6.66-4.84 2.55-7.82z"/>'
      + '<path d="M11.64 19.98l-6.66 4.84-6.66-4.84 2.55-7.82h8.22z"/></g>'
      + '<path d="M24 15v-4M32.56 21.22l3.8-1.24M29.29 31.28l2.36 3.24M18.71 31.28l-2.36 3.24M15.44 21.22l-3.8-1.24" stroke="#16090e" stroke-width="1.6"/>'
      + '<circle cx="24" cy="24" r="21" fill="none" stroke="rgba(0,0,0,.2)" stroke-width="1.4"/></svg>';
  };
  const CARD = '<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="12" y="5" width="26" height="38" rx="4" transform="rotate(-8 25 24)" fill="#ff2d3f" stroke="#fff" stroke-width="2.5"/></svg>';

  const template = (preview) => `
<div class="sb" data-ref="root" style="visibility:hidden">
  <div class="bug${preview ? ' drag' : ''}" data-ref="bug">
    <div class="bug-inner" data-ref="bugInner">
      <div class="bug-tabs">
        <div class="tab tab-comp" data-ref="compTab"><img class="comp-logo" data-ref="compLogo" alt="" hidden><span data-ref="comp"></span></div>
        <div class="tab tab-added" data-ref="addedTab"><b data-ref="addedNum"></b><span>min</span></div>
        <div class="tab tab-reds home" data-ref="redsHome" aria-hidden="true"></div>
        <div class="tab tab-reds away" data-ref="redsAway" aria-hidden="true"></div>
      </div>
      <div class="bug-main">
        <div class="cell clock" data-ref="clockCell" style="--i:0">
          <div class="clock-row"><span class="dot" data-ref="dot"></span><span class="time" data-ref="time"></span></div>
          <div class="period" data-ref="period"></div>
          <div class="prog" data-ref="prog"><i data-ref="progFill"></i></div>
        </div>
        <div class="cell team home" data-ref="homeCell" style="--i:1">
          <div class="badge home" data-ref="homeBadge"></div>
          <div class="code" data-ref="homeCode"></div>
        </div>
        <div class="cell score" data-ref="scoreCell" style="--i:2">
          <div class="num" data-ref="homeNum"></div>
          <div class="sep"></div>
          <div class="num" data-ref="awayNum"></div>
          <div class="vs">vs</div>
        </div>
        <div class="cell team away" data-ref="awayCell" style="--i:3">
          <div class="badge away" data-ref="awayBadge"></div>
          <div class="code" data-ref="awayCode"></div>
        </div>
        <div class="goal" data-ref="goal" data-kind="goal" aria-hidden="true">
          <div class="goal-icon" data-ref="goalIcon"></div>
          <div class="goal-word" data-ref="goalWord">GOAL</div>
          <div class="goal-meta" data-ref="goalMeta"><div class="goal-team" data-ref="goalTeam"></div><div class="goal-detail" data-ref="goalDetail"></div></div>
          <div class="goal-score" data-ref="goalScore"></div>
          <div class="goal-shine" data-ref="goalShine"></div>
        </div>
      </div>
      <div class="scorers" data-ref="scorers">
        <div class="sc-side home" data-ref="scHome"></div>
        <div class="sc-side away" data-ref="scAway"></div>
      </div>
      <div class="drawer" data-ref="drawer">
        <div class="drawer-head">
          <span class="dh h"><i class="sw home"></i><span data-ref="dhHome"></span></span>
          <span class="dh-t">Match stats</span>
          <span class="dh a"><span data-ref="dhAway"></span><i class="sw away"></i></span>
        </div>
        <div class="rows" data-ref="bugRows"></div>
        <div class="tl" data-ref="tl" aria-hidden="true"><div class="tl-track"><i class="tl-ht"></i><i class="tl-now" data-ref="tlNow"></i></div><div class="tl-marks" data-ref="tlMarks"></div><div class="tl-ends"><span>0’</span><span>45’</span><span data-ref="tlEnd">90’</span></div></div>
      </div>
    </div>
  </div>
  <div class="board" data-ref="board" aria-hidden="true"><div class="board-head"><span class="board-title" data-ref="boardTitle"></span><span class="board-sub" data-ref="boardSub"></span></div><div class="board-body" data-ref="boardBody"></div></div>
  <div class="ticker" data-ref="ticker" aria-hidden="true"><span class="ticker-tag">Other scores</span><div class="ticker-win"><div class="ticker-run" data-ref="tickerRun"></div></div></div>
  <div class="spot" data-ref="spot" aria-hidden="true"><div class="badge" data-ref="spotBadge"></div><div class="spot-text"><div class="spot-name" data-ref="spotName"></div><div class="spot-detail" data-ref="spotDetail"></div></div></div>
  <div class="splash" data-ref="splash" aria-hidden="true">
    <div class="splash-word">Full time</div>
    <div class="splash-row"><div class="badge home" data-ref="splHomeBadge"></div><div class="splash-name is-home" data-ref="splHomeName"></div><div class="splash-score" data-ref="splScore"></div><div class="splash-name" data-ref="splAwayName"></div><div class="badge away" data-ref="splAwayBadge"></div></div>
    <div class="splash-scorers"><span data-ref="splHomeScorers"></span><span data-ref="splAwayScorers"></span></div>
  </div>
  <div class="card${preview ? ' drag' : ''} is-off" data-ref="card">
    <div class="card-inner">
      <div class="card-head"><span data-ref="cardComp"></span><span class="card-status"><i class="cdot" data-ref="cardDot"></i><span data-ref="cardStatus"></span></span></div>
      <div class="card-teams">
        <div class="ct home" data-ref="ctHome">
          <div class="badge home" data-ref="ctHomeBadge"></div>
          <div class="ct-text"><div class="ct-name" data-ref="ctHomeName"></div><div class="ct-scorers" data-ref="ctHomeScorers"></div><div class="ct-reds" data-ref="ctHomeReds"></div></div>
        </div>
        <div class="ct-score" data-ref="ctScore">
          <div class="num" data-ref="ctHomeNum"></div>
          <div class="sep"></div>
          <div class="num" data-ref="ctAwayNum"></div>
          <div class="vs">vs</div>
        </div>
        <div class="ct away" data-ref="ctAway">
          <div class="badge away" data-ref="ctAwayBadge"></div>
          <div class="ct-text"><div class="ct-name" data-ref="ctAwayName"></div><div class="ct-scorers" data-ref="ctAwayScorers"></div><div class="ct-reds" data-ref="ctAwayReds"></div></div>
        </div>
      </div>
      <div class="card-stats" data-ref="cardStats"><div class="rows" data-ref="cardRows"></div></div>
    </div>
  </div>
</div>`;

  const setText = (node, text) => { if (node && node.textContent !== text) node.textContent = text; };
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /* Team colours become CSS variables. Very dark kits are lifted so they still show on the dark bar. */
  function hexRgb(hex) {
    const n = parseInt(M.str(hex).replace('#', ''), 16) || 0;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function lum(rgb) {
    const [r, g, b] = rgb.map((c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  const mix = (a, b, t) => a.map((c, i) => Math.round(c + (b[i] - c) * t));
  let colourKey = '';
  function applyColours(s) {
    const key = `${s.home.color}|${s.away.color}`;
    if (key === colourKey) return;
    colourKey = key;
    const root = document.documentElement.style;
    ['home', 'away'].forEach((side) => {
      let rgb = hexRgb(s[side].color);
      if (lum(rgb) < 0.045) rgb = mix(rgb, [255, 255, 255], 0.3);
      const deep = mix(rgb, [10, 5, 8], 0.5);
      root.setProperty(`--${side}`, `rgb(${rgb.join(',')})`);
      root.setProperty(`--${side}-rgb`, rgb.join(','));
      root.setProperty(`--${side}-ink`, lum(rgb) > 0.3 ? '#16090e' : '#ffffff');
      root.setProperty(`--${side}-deep`, `rgb(${deep.join(',')})`);
      root.setProperty(`--${side}-flash-ink`, lum(deep) > 0.18 ? '#16090e' : '#ffffff');
    });
  }

  // The accent (competition or brand colour) with a darker shade and a readable text colour.
  function applyAccent(root, s) {
    const hex = M.accentOf(s);
    if (root._acc === hex) return;
    root._acc = hex;
    const rgb = hexRgb(hex);
    const deep = mix(rgb, [8, 10, 20], 0.42);
    root.style.setProperty('--acc', hex);
    root.style.setProperty('--acc-rgb', rgb.join(','));
    root.style.setProperty('--acc-deep', `rgb(${deep.join(',')})`);
    root.style.setProperty('--acc-ink', lum(rgb) > 0.42 ? '#0f1422' : '#ffffff');
  }

  /* A crest image when there is one, otherwise the team's first letter in its colour. */
  let crestBase = '/api/crest';
  const setCrestBase = (base) => { crestBase = base; };
  function paintBadge(node, team, side) {
    const src = team.crestV ? `${crestBase}/${side}?v=${team.crestV}` : '';
    const key = src || `txt:${M.initialOf(team)}`;
    if (node._key === key) return;
    node._key = key;
    node.replaceChildren();
    node.classList.toggle('has-img', !!src);
    if (src) {
      const img = new Image();
      img.alt = '';
      img.decoding = 'async';
      img.src = src;
      node.appendChild(img);
    } else {
      node.textContent = M.initialOf(team);
    }
  }

  function mount(stage, opts = {}) {
    const preview = !!opts.preview;
    stage.el.insertAdjacentHTML('beforeend', template(preview));
    const root = stage.el.lastElementChild;
    const el = { root, guide: stage.guide };
    root.querySelectorAll('[data-ref]').forEach((n) => { el[n.dataset.ref] = n; });
    const reduceQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    // The overlay always animates for viewers; the preview follows the operator's reduced-motion setting.
    const motionOK = () => !preview || !(reduceQuery && reduceQuery.matches);

    let current = null;
    let started = false;
    let introDone = false;
    let shownTime = '';
    const seen = new Set();

    /* Score digits roll up or down when they change */
    const roller = (node) => ({ node, value: null });
    const rollers = [roller(el.homeNum), roller(el.awayNum), roller(el.ctHomeNum), roller(el.ctAwayNum)];
    function roll(r, value, animate) {
      if (r.value === value) return;
      const prev = r.node.lastElementChild;
      const next = document.createElement('span');
      next.textContent = String(value);
      r.node.appendChild(next);
      if (animate && prev && r.value !== null && motionOK()) {
        const d = value > r.value ? 1 : -1;
        const out = prev.animate(
          [{ transform: 'translateY(0)', opacity: 1 }, { transform: `translateY(${-70 * d}%)`, opacity: 0 }],
          { duration: 320, easing: 'cubic-bezier(.65,0,.35,1)', fill: 'forwards' }
        );
        out.onfinish = () => prev.remove();
        next.animate(
          [{ transform: `translateY(${70 * d}%)`, opacity: 0 }, { transform: 'translateY(0)', opacity: 1 }],
          { duration: 520, delay: 80, easing: 'cubic-bezier(.23,1,.32,1)', fill: 'backwards' }
        );
      } else {
        Array.from(r.node.children).forEach((c) => { if (c !== next) c.remove(); });
      }
      r.value = value;
    }

    /* Animations: a goal floods the bar with the scorer's colour, the scorer's name follows when the feed
       knows it, and a red card flashes red. They play one after another. */
    const queue = [];
    let playing = false;
    let holdScores = false;
    let lastGoalAt = 0;    // when the last goal or scorer animation started, for "after goals" scorer strips
    let lastPeriod = null; // for kick-off and half-time banners
    let lastAdded = null;  // for the added time board
    let lastMatchKey = '';
    let nowPlaying = null; // the animation on screen right now
    let cutShort = null;   // ends it early, if it's undone in the control app
    function paintScores(animate) {
      if (holdScores || !current) return;
      roll(rollers[0], current.score[0], animate);
      roll(rollers[1], current.score[1], animate);
      roll(rollers[2], current.score[0], animate);
      roll(rollers[3], current.score[1], animate);
    }
    function enqueue(a) {
      queue.push(a);
      if (a.kind === 'goal') holdScores = true; // the new score rolls in as the goal flash leaves
      if (!playing) runQueue();
    }
    async function runQueue() {
      playing = true;
      while (queue.length) {
        const a = queue.shift();
        try { await playFlash(a); } catch (e) { /* keep going */ }
        holdScores = queue.some((q) => q.kind === 'goal');
        paintScores(true);
        if (a.kind === 'goal') pulseTeam(a.team);
        if (queue.length) await wait(600);
      }
      playing = false;
      holdScores = false;
      paintScores(true);
    }
    async function playFlash(a) {
      if (!current || !current.show.bug || !current.onAir || !motionOK()) return;
      nowPlaying = a;
      const cut = new Promise((resolve) => { cutShort = resolve; });
      try { await showFlash(a, cut); } finally { nowPlaying = null; cutShort = null; }
    }
    async function showFlash(a, cut) {
      const side = a.team === 0 ? 'home' : 'away';
      const team = M.titleOf(current, current[side]);
      el.goal.dataset.kind = a.kind;
      const codes = () => `${M.codeOf(current.home)} ${current.score[0]}–${current.score[1]} ${M.codeOf(current.away)}`;
      if (a.kind === 'nogoal') {
        el.goal.style.setProperty('--g-1', '#1e2433');
        el.goal.style.setProperty('--g-2', '#3a4256');
        el.goal.style.setProperty('--g-ink', '#ffffff');
        el.goalIcon.innerHTML = '';
        setText(el.goalWord, 'NO GOAL');
        setText(el.goalTeam, team);
        setText(el.goalDetail, ['Ruled out', [a.name, a.minute].filter(Boolean).join(' ')].filter(Boolean).join(': '));
      } else if (a.kind === 'sub') {
        el.goal.style.setProperty('--g-1', `var(--${a.team === 0 ? 'home' : 'away'}-deep)`);
        el.goal.style.setProperty('--g-2', `var(--${a.team === 0 ? 'home' : 'away'})`);
        el.goal.style.setProperty('--g-ink', `var(--${a.team === 0 ? 'home' : 'away'}-ink)`);
        el.goalIcon.innerHTML = '';
        setText(el.goalWord, 'SUB');
        setText(el.goalTeam, team);
        setText(el.goalDetail, `On: ${a.name}${a.off ? `   Off: ${a.off}` : ''}${a.minute ? `   ${a.minute}` : ''}`);
      } else if (a.kind === 'banner' || a.kind === 'added') {
        el.goal.style.setProperty('--g-1', 'var(--acc-deep)');
        el.goal.style.setProperty('--g-2', 'var(--acc)');
        el.goal.style.setProperty('--g-ink', 'var(--acc-ink)');
        el.goalIcon.innerHTML = '';
        setText(el.goalWord, a.name);
        setText(el.goalTeam, a.kind === 'added' ? 'Minutes added' : M.str(current.comp).trim() || 'Live');
        setText(el.goalDetail, a.kind === 'added' ? '' : codes());
      } else if (a.kind === 'red') {
        el.goal.style.setProperty('--g-1', '#4a0710');
        el.goal.style.setProperty('--g-2', '#d0142a');
        el.goal.style.setProperty('--g-ink', '#ffffff');
        el.goalIcon.innerHTML = CARD;
        setText(el.goalWord, 'RED CARD');
        setText(el.goalTeam, a.name || team);
        setText(el.goalDetail, [a.name ? team : '', a.minute].filter(Boolean).join(' '));
      } else {
        el.goal.style.setProperty('--g-1', `var(--${side}-deep)`);
        el.goal.style.setProperty('--g-2', `var(--${side})`);
        el.goal.style.setProperty('--g-ink', `var(--${side}-flash-ink)`);
        if (a.kind === 'scorer') {
          el.goalIcon.innerHTML = BALL();
          setText(el.goalWord, '');
          setText(el.goalTeam, a.name);
          setText(el.goalDetail, [`${team} goal`, a.minute].filter(Boolean).join(' '));
        } else {
          el.goalIcon.innerHTML = '';
          setText(el.goalWord, 'GOAL');
          setText(el.goalTeam, team);
          setText(el.goalDetail, [a.name, a.minute].filter(Boolean).join(' '));
          // The new score, with the scoring side's number picked out
          const [h, w] = current.score;
          el.goalScore.innerHTML = '';
          const code = (t) => { const n = document.createElement('span'); n.textContent = M.codeOf(t); return n; };
          const nums = document.createElement('b');
          const hn = document.createElement(a.team === 0 ? 'em' : 'span');
          hn.textContent = String(h);
          const an = document.createElement(a.team === 1 ? 'em' : 'span');
          an.textContent = String(w);
          nums.append(hn, '–', an);
          el.goalScore.append(code(current.home), nums, code(current.away));
        }
      }
      if (a.kind === 'goal' || a.kind === 'scorer') lastGoalAt = M.now();
      if (a.kind === 'banner' || a.kind === 'added') lastGoalAt = lastGoalAt; // banners don't bring the scorers out
      el.goal.style.visibility = 'visible';
      const move = 'cubic-bezier(.77,0,.175,1)';
      const settle = 'cubic-bezier(.23,1,.32,1)';
      const enter = el.goal.animate([{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)' }], { duration: 520, easing: move, fill: 'forwards' });
      el.goalIcon.animate([{ opacity: 0, transform: 'scale(.6) rotate(-30deg)' }, { opacity: 1, transform: 'scale(1) rotate(0)' }], { duration: 560, delay: 200, easing: settle, fill: 'both' });
      el.goalWord.animate([{ opacity: 0, transform: 'translateX(-40px) skewX(-9deg)' }, { opacity: 1, transform: 'translateX(0) skewX(-9deg)' }], { duration: 560, delay: 220, easing: settle, fill: 'both' });
      el.goalMeta.animate([{ opacity: 0, transform: 'translateX(24px)' }, { opacity: 1, transform: 'translateX(0)' }], { duration: 520, delay: 340, easing: settle, fill: 'both' });
      el.goalShine.animate([{ transform: 'translateX(-200px) skewX(-18deg)' }, { transform: 'translateX(900px) skewX(-18deg)' }], { duration: 1000, delay: 480, easing: 'cubic-bezier(.65,0,.35,1)', fill: 'both' });
      if (a.kind === 'goal') el.goalScore.animate([{ opacity: 0, transform: 'translateX(26px)' }, { opacity: 1, transform: 'none' }], { duration: 460, delay: 1150, easing: settle, fill: 'both' });
      await Promise.race([enter.finished, cut]);
      await Promise.race([wait(a.kind === 'scorer' ? 3400 : ['banner', 'added', 'sub'].includes(a.kind) ? 2200 : 2600), cut]);
      const leave = el.goal.animate([{ clipPath: 'inset(0 0 0 0%)' }, { clipPath: 'inset(0 0 0 100%)' }], { duration: 460, easing: move, fill: 'forwards' });
      await leave.finished;
      el.goal.style.visibility = 'hidden';
      [el.goal, el.goalIcon, el.goalWord, el.goalMeta, el.goalShine, el.goalScore].forEach((n) => n.getAnimations().forEach((x) => x.cancel()));
      if (a.kind === 'goal') celebrate(a.team);
      // A named scorer gets the spotlight at the bottom of the screen after the flash.
      if ((a.kind === 'goal' || a.kind === 'scorer') && a.name) spotlight(a);
    }
    // Lower third: the scorer's name, shirt number and team, for a few seconds.
    let spotTimer = 0;
    function spotlight(a) {
      if (!current || !current.show.spotlight || !current.onAir) return;
      const side = a.team === 0 ? 'home' : 'away';
      const t = current[side];
      const g = current.goals.slice().reverse().find((x) => x.team === a.team && x.scorer === a.name);
      paintBadge(el.spotBadge, t, side);
      el.spotBadge.className = `badge ${side}${t.crestV ? ' has-img' : ''}`;
      el.spot.style.setProperty('--s-c', `var(--${side})`);
      setText(el.spotName, String(a.name).replace(/\s*\((pen|og)\)/i, ''));
      setText(el.spotDetail, [g && g.number ? `No. ${g.number}` : '', M.titleOf(current, t), a.minute].filter(Boolean).join(', '));
      el.spot.classList.add('is-on');
      clearTimeout(spotTimer);
      spotTimer = setTimeout(() => el.spot.classList.remove('is-on'), 6500);
    }
    // Full time: a big moment with both teams, the score and the scorers, before the stats card.
    let splashUntil = 0;
    function fullTime() {
      if (!current || !current.show.splash || !current.onAir) return;
      paintBadge(el.splHomeBadge, current.home, 'home');
      paintBadge(el.splAwayBadge, current.away, 'away');
      setText(el.splHomeName, M.titleOf(current, current.home));
      setText(el.splAwayName, M.titleOf(current, current.away));
      setText(el.splScore, `${current.score[0]}–${current.score[1]}`);
      setText(el.splHomeScorers, M.scorers(current, 0));
      setText(el.splAwayScorers, M.scorers(current, 1));
      splashUntil = Date.now() + 7000;
      el.splash.classList.add('is-on');
      setTimeout(() => { el.splash.classList.remove('is-on'); splashUntil = 0; if (current) render(current); }, 7000);
    }
    // After a goal: the scoring side glows in its colour for about 10 seconds and its crest pops.
    let celebrateTimer = 0;
    function celebrate(team) {
      if (!current || !current.look.celebrate || !motionOK()) return;
      const cell = team === 0 ? el.homeCell : el.awayCell;
      [el.homeCell, el.awayCell].forEach((c) => c.classList.remove('is-celebrate'));
      void cell.offsetWidth; // restart the animation if it's still running
      cell.classList.add('is-celebrate');
      clearTimeout(celebrateTimer);
      celebrateTimer = setTimeout(() => cell.classList.remove('is-celebrate'), 9800);
    }
    function pulseTeam(team) {
      if (!motionOK()) return;
      const node = team === 0 ? el.homeCell : el.awayCell;
      node.animate([{ filter: 'brightness(1.7)' }, { filter: 'brightness(1)' }], { duration: 1200, easing: 'cubic-bezier(.23,1,.32,1)' });
    }

    /* Stats rows for the stats chosen in the control app, under the bar and on the big card */
    let rowsKey = null;
    let rowsBug = {};
    let rowsCard = {};
    function buildRows(container, keys) {
      const map = {};
      container.replaceChildren();
      keys.forEach((key) => {
        const def = M.STAT[key];
        const row = document.createElement('div');
        row.className = 'srow';
        row.innerHTML = '<div class="sval h"></div><div class="smid"><div class="slabel"></div><div class="sbar"><i class="bh"></i><i class="ba"></i></div></div><div class="sval a"></div>';
        row.querySelector('.slabel').textContent = def.label;
        container.appendChild(row);
        map[key] = { h: row.querySelector('.sval.h'), a: row.querySelector('.sval.a'), bh: row.querySelector('.bh'), ba: row.querySelector('.ba') };
      });
      return map;
    }
    // Stats ESPN doesn't send for this match are left out once it's under way, instead of sitting at 0 all game.
    function visibleStats(s) {
      const keys = s.feed.statsKeys;
      if (s.mode !== 'live' || !s.feed.fixtureId || s.period === 'pre' || !keys.length) return s.statsShown;
      return s.statsShown.filter((k) => keys.includes(k));
    }
    function ensureRows(keys) {
      const key = keys.join(',');
      if (key === rowsKey) return;
      rowsKey = key;
      rowsBug = buildRows(el.bugRows, keys);
      rowsCard = buildRows(el.cardRows, keys);
    }
    function paintRows(container, map, s, neutral, keys) {
      container.classList.toggle('is-neutral', neutral);
      keys.forEach((key) => {
        const def = M.STAT[key];
        const r = map[key];
        if (!def || !r) return;
        let [h, a] = s.stats[key];
        if (def.kind === 'pct') { h = M.clamp(h, 0, 100); a = 100 - h; }
        const total = h + a;
        const p = neutral || total === 0 ? 50 : (h / total) * 100;
        setText(r.h, M.formatStat(def, h));
        setText(r.a, M.formatStat(def, a));
        r.bh.style.width = `calc(${p.toFixed(2)}% - var(--gap) / 2)`;
        r.ba.style.width = `calc(${(100 - p).toFixed(2)}% - var(--gap) / 2)`;
        const lead = neutral ? 'none' : h > a ? 'h' : a > h ? 'a' : 'tie';
        r.h.classList.toggle('lead', lead === 'h' || lead === 'tie');
        r.a.classList.toggle('lead', lead === 'a' || lead === 'tie');
        r.bh.classList.toggle('trail', lead === 'a');
        r.ba.classList.toggle('trail', lead === 'h');
      });
    }
    function paintReds(node, n) {
      if (node._n === n) return;
      node._n = n;
      node.replaceChildren();
      for (let i = 0; i < Math.min(n, 4); i += 1) node.appendChild(document.createElement('i'));
      node.classList.toggle('is-on', n > 0);
    }
    // The big card lists each red card with who got it and when, under the scorers.
    function paintCardReds(node, list) {
      const key = JSON.stringify(list);
      if (node._key === key) return;
      node._key = key;
      node.replaceChildren();
      list.forEach((r) => {
        const item = document.createElement('span');
        item.className = 'rc';
        item.appendChild(document.createElement('i'));
        const who = [r.name, r.minute].filter(Boolean).join(' ');
        if (who) { const t = document.createElement('span'); t.textContent = who; item.appendChild(t); }
        node.appendChild(item);
      });
    }
    // The tab above each team: a card for each red card, with the player's surname and minute when known.
    function paintRedTab(node, list, yellows) {
      yellows = yellows || 0;
      const key = JSON.stringify([list, yellows]);
      if (node._key === key) return;
      node._key = key;
      node.replaceChildren();
      if (yellows) {
        const y = document.createElement('span');
        y.className = 'yc';
        for (let i = 0; i < Math.min(yellows, 3); i += 1) y.appendChild(document.createElement('i'));
        if (yellows > 3) { const n = document.createElement('b'); n.textContent = `×${yellows}`; y.appendChild(n); }
        node.appendChild(y);
      }
      list.slice(0, 3).forEach((r) => {
        const item = document.createElement('span');
        item.className = 'rc';
        item.appendChild(document.createElement('i'));
        const who = [r.name, r.minute].filter(Boolean).join(' ');
        if (who) { const t = document.createElement('span'); t.textContent = who; item.appendChild(t); }
        node.appendChild(item);
      });
      if (list.length > 3) { const more = document.createElement('b'); more.textContent = `+${list.length - 3}`; node.appendChild(more); }
      node.classList.toggle('is-on', list.length > 0 || yellows > 0);
      placeRedTabs();
    }
    // A 0 to 90 line in the stats: goals and cards where they happened, and how far the match has got.
    function paintTimeline(s) {
      const on = s.show.timeline && s.period !== 'pre';
      el.tl.classList.toggle('is-on', on);
      if (!on) return;
      const extra = ['et1', 'et2', 'pens'].includes(s.period) || (s.period === 'ft' && s.note);
      const end = extra ? 120 : 90;
      setText(el.tlEnd, `${end}’`);
      el.tl.style.setProperty('--ht', `${(45 / end) * 100}%`);
      const items = [];
      s.goals.forEach((g) => items.push({ k: 'g', t: g.team, m: M.minuteNum(g.minute) }));
      s.reds.forEach((r) => items.push({ k: 'r', t: r.team, m: M.minuteNum(r.minute) }));
      if (s.show.yellows) s.yellows.forEach((r) => items.push({ k: 'y', t: r.team, m: M.minuteNum(r.minute) }));
      const key = JSON.stringify([items, end]);
      if (el.tlMarks._key !== key) {
        el.tlMarks._key = key;
        el.tlMarks.replaceChildren();
        items.filter((x) => x.m != null).forEach((x) => {
          const i = document.createElement('i');
          i.className = `tl-${x.k} ${x.t === 0 ? 'home' : 'away'}`;
          i.style.left = `${Math.min(100, (x.m / end) * 100)}%`;
          el.tlMarks.appendChild(i);
        });
      }
      const now = M.inPlay(s) ? Math.min(end, M.elapsed(s) / 60) : s.period === 'ft' ? end : s.period === 'ht' ? 45 : s.period === 'brk' ? 90 : 0;
      el.tlNow.style.left = `${(now / end) * 100}%`;
    }
    // Each red card tab sits over its own team, and never over the competition tab.
    function placeRedTabs() {
      const tabsLeft = el.compTab.offsetLeft + el.compTab.offsetWidth + (el.addedTab.classList.contains('is-on') ? el.addedTab.offsetWidth + 6 : 0) + 8;
      const homeRight = el.homeCell.offsetLeft + el.homeCell.offsetWidth - 10;
      const homeLeft = Math.max(tabsLeft, homeRight - el.redsHome.offsetWidth);
      el.redsHome.style.left = `${homeLeft}px`;
      el.redsHome.style.right = 'auto';
      const awayLeft = Math.max(homeLeft + el.redsHome.offsetWidth + 8, el.awayCell.offsetLeft + 10);
      el.redsAway.style.left = `${awayLeft}px`;
      el.redsAway.style.right = 'auto';
    }

    function paintScorerSide(node, list) {
      const key = JSON.stringify(list);
      if (node._key === key) return;
      node._key = key;
      node.replaceChildren();
      list.forEach((e) => {
        const item = document.createElement('span');
        item.className = 'sc';
        const b = document.createElement('b');
        b.textContent = e.name;
        item.appendChild(b);
        e.mins.forEach((x) => {
          const m = document.createElement('span');
          m.textContent = x.m;
          item.appendChild(m);
          if (x.tag) { const t = document.createElement('small'); t.textContent = x.tag; item.appendChild(t); }
        });
        node.appendChild(item);
      });
      node.classList.toggle('has-goals', list.length > 0);
    }
    // Penalty shoot-out: one dot per kick, filled for scored, crossed for missed, with the empty ones still to come
    function paintKicks(node, kicks) {
      const key = `k${JSON.stringify(kicks)}`;
      if (node._key === key) return;
      node._key = key;
      node.replaceChildren();
      const total = Math.max(5, kicks.length);
      for (let i = 0; i < total; i += 1) {
        const d = document.createElement('i');
        d.className = `kick ${i < kicks.length ? (kicks[i] ? 'yes' : 'no') : 'todo'}`;
        node.appendChild(d);
      }
      node.classList.add('has-goals');
    }
    const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    // The card in the middle of the screen: line-ups, match info, form, head-to-head or the table
    function paintBoard(s) {
      const kind = s.board;
      const on = kind !== 'none' && s.onAir;
      el.board.classList.toggle('is-on', on && introDone);
      if (kind === 'none') return;
      el.board.style.transform = `translate(${s.card.x}px, ${s.card.y}px) translate(-50%, -100%) scale(${s.card.s * s.scale})`;
      const H = s.home;
      const A = s.away;
      const name = (t) => esc(M.titleOf(s, t));
      const badge = (t, side) => `<span class="mini-badge ${side}" style="background:var(--${side})">${esc(M.initialOf(t))}</span>`;
      let title = '';
      let sub = '';
      let body = '';
      if (kind === 'lineups') {
        title = 'Line-ups';
        sub = M.str(s.comp).trim();
        const col = (l, t, side) => `<div class="lu ${side}"><div class="lu-head">${badge(t, side)}<b>${name(t)}</b><span>${esc((l && l.f) || '')}</span></div><ol>${((l && l.xi) || []).map((p) => `<li><i>${esc(p.n)}</i><span>${esc(p.name)}</span><small>${esc(p.pos)}</small></li>`).join('') || '<li class="empty">Not out yet</li>'}</ol></div>`;
        body = `<div class="lu-grid">${col(s.lineups[0], H, 'home')}${col(s.lineups[1], A, 'away')}</div>`;
      } else if (kind === 'info') {
        title = 'Match info';
        sub = M.str(s.comp).trim();
        const ko = s.kickoffAt ? new Date(s.kickoffAt).toLocaleString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: s.tz || 'Europe/London' }) : '';
        body = `<div class="info-teams">${badge(H, 'home')}<b>${name(H)}</b><span class="info-v">v</span><b>${name(A)}</b>${badge(A, 'away')}</div>
          <dl class="info-list">${ko ? `<div><dt>Kick-off</dt><dd>${esc(ko)}</dd></div>` : ''}${s.info.venue ? `<div><dt>Ground</dt><dd>${esc(s.info.venue)}${s.info.city ? `, ${esc(s.info.city)}` : ''}</dd></div>` : ''}${s.info.ref ? `<div><dt>Referee</dt><dd>${esc(s.info.ref)}</dd></div>` : ''}</dl>`;
      } else if (kind === 'form') {
        title = 'Form';
        sub = 'Last five games, most recent on the right';
        const row = (t, side, f) => `<div class="form-row">${badge(t, side)}<b>${name(t)}</b><span class="pills">${(f || '').split('').map((r) => `<i class="r-${r}">${r}</i>`).join('') || '<em>No games yet</em>'}</span></div>`;
        body = row(H, 'home', s.form[0]) + row(A, 'away', s.form[1]);
      } else if (kind === 'h2h') {
        title = 'Head-to-head';
        sub = s.h2h.text;
        body = `<ol class="h2h">${s.h2h.games.map((g) => `<li><time>${esc(g.d ? new Date(g.d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '')}</time><b>${esc(g.h)}</b><span class="h2h-score">${g.hs}–${g.as}</span><b>${esc(g.a)}</b></li>`).join('') || '<li class="empty">No recent meetings</li>'}</ol>`;
      } else if (kind === 'table') {
        title = 'Table';
        sub = M.str(s.comp).trim();
        const rows = s.table;
        let view = rows;
        if (rows.length > 10) {
          const marked = rows.map((r, i) => (r.t >= 0 ? i : -1)).filter((i) => i >= 0);
          const lo = Math.max(0, Math.min(...(marked.length ? marked : [0])) - 2);
          const hi = Math.max(...(marked.length ? marked : [0])) + 3;
          view = hi - lo <= 10 ? rows.slice(Math.max(0, Math.min(lo, rows.length - 10)), Math.max(0, Math.min(lo, rows.length - 10)) + 10) : rows.filter((r, i) => i < 4 || r.t >= 0);
        }
        body = `<table class="tbl"><thead><tr><th></th><th>Team</th><th>P</th><th>GD</th><th>Pts</th></tr></thead><tbody>${view.map((r) => `<tr class="${r.t === 0 ? 'is-home' : r.t === 1 ? 'is-away' : ''}"><td>${r.p}</td><td>${esc(r.n)}</td><td>${r.g}</td><td>${esc(r.gd)}</td><td><b>${r.pts}</b></td></tr>`).join('') || '<tr><td colspan="5">The table isn’t out yet</td></tr>'}</tbody></table>`;
      }
      const key = JSON.stringify([kind, title, sub, body]);
      if (el.board._key === key) return;
      el.board._key = key;
      el.board.dataset.kind = kind;
      setText(el.boardTitle, title);
      setText(el.boardSub, sub);
      el.boardBody.innerHTML = body;
    }
    // Other scores along the bottom of the screen, scrolling
    function paintTicker(s) {
      const on = s.show.ticker && s.onAir && s.others.length > 0;
      el.ticker.classList.toggle('is-on', on && introDone);
      const key = JSON.stringify(s.others);
      if (el.tickerRun._key === key) return;
      el.tickerRun._key = key;
      const items = s.others.map((o) => `<span class="tk"><b>${esc(o.h)}</b> ${o.hs !== '' ? `<em>${esc(o.hs)}–${esc(o.as)}</em>` : '<em class="v">v</em>'} <b>${esc(o.a)}</b> <small>${esc(o.st)}</small></span>`).join('');
      el.tickerRun.innerHTML = items + items; // twice, so the loop is seamless
      el.tickerRun.style.animationDuration = `${Math.max(18, s.others.length * 5)}s`;
    }
    function scorersVisible(s) {
      if (s.period === 'pens' || el.root.classList.contains('is-shootout')) return s.show.bug;
      const mode = s.show.scorers;
      if (mode === 'off' || !s.show.bug) return false;
      const any = el.scHome.classList.contains('has-goals') || el.scAway.classList.contains('has-goals');
      if (!any) return false;
      return mode === 'always' || (nowPlaying && nowPlaying.kind !== 'red') || M.now() - lastGoalAt < 15000;
    }

    function cardStatus(s) {
      switch (s.period) {
        case 'pre': return M.str(s.kickoff).trim() ? `Kick-off ${M.str(s.kickoff).trim()}` : 'Pre-match';
        case 'ht': return 'Half-time';
        case 'brk': return 'Break before extra time';
        case 'pens': return s.pens ? `Penalties ${s.pens[0]}–${s.pens[1]}` : 'Penalties';
        case 'ft':
          if (s.note === 'pens' && s.pens) return `Full-time, ${s.pens[0]}–${s.pens[1]} on pens`;
          return s.note === 'aet' ? 'After extra time' : 'Full-time';
        default: return `Live ${M.minuteMark(s)}`;
      }
    }
    function paintTime(text) {
      if (text === shownTime) return;
      shownTime = text;
      const frag = document.createDocumentFragment();
      for (const ch of text) {
        const span = document.createElement('span');
        span.className = /\d/.test(ch) ? 'ch' : ch === ':' ? 'ch ch-colon' : ch === '+' ? 'ch ch-plus' : 'ch ch-alpha';
        span.textContent = ch;
        frag.appendChild(span);
      }
      el.time.replaceChildren(frag);
    }
    function tick() {
      if (!current) return;
      const s = current;
      const v = M.clockView(s);
      paintTime(v.text);
      setText(el.period, v.label);
      const dotClass = `dot ${v.dot}`;
      if (el.dot.className !== dotClass) el.dot.className = dotClass;
      el.clockCell.classList.toggle('is-added', v.added);
      const play = M.inPlay(s);
      el.prog.classList.toggle('is-on', play);
      el.progFill.style.transform = `scaleX(${M.progressOf(s).toFixed(4)})`;
      el.scorers.classList.toggle('is-on', scorersVisible(s));
      if (s.show.timeline && M.inPlay(s)) paintTimeline(s);
      el.addedTab.classList.toggle('is-on', M.inPlay(s) && s.added > 0);
      setText(el.cardStatus, cardStatus(s));
      const cdot = (M.inPlay(s) && s.clock.running) || s.period === 'pens' ? 'cdot is-live' : 'cdot';
      if (el.cardDot.className !== cdot) el.cardDot.className = cdot;
    }

    function place(s) {
      el.bug.style.transform = `translate(${s.bug.x}px, ${s.bug.y}px) scale(${s.bug.s * s.scale})`;
      el.card.style.transform = `translate(${s.card.x}px, ${s.card.y}px) translate(-50%, -100%) scale(${s.card.s * s.scale})`;
    }

    function render(s) {
      if (!s) return;
      // A different match (a new one followed, or another streamer in the hub) starts fresh: no banners for that.
      const matchKey = `${s.home.name}|${s.away.name}|${s.feed && s.feed.fixtureId}`;
      if (current && matchKey !== lastMatchKey) { lastPeriod = null; lastAdded = null; }
      lastMatchKey = matchKey;
      current = s;
      if (!started) {
        // First state: no replaying old animations, and one entrance for the whole scoreboard.
        started = true;
        s.anims.forEach((a) => seen.add(a.id));
        el.root.style.visibility = '';
        el.root.classList.add('is-intro');
        setTimeout(() => { introDone = true; if (current) render(current); }, 650);
        setTimeout(() => el.root.classList.remove('is-intro'), 1700);
      }
      applyColours(s);
      applyAccent(el.root, s);
      el.root.classList.toggle('has-sheen', !!s.look.sheen);
      const pens = s.period === 'pens' || (s.period === 'ft' && s.note === 'pens' && (s.shoot[0].length || s.shoot[1].length));
      el.root.classList.toggle('is-shootout', !!pens);
      if (pens) { paintKicks(el.scHome, s.shoot[0]); paintKicks(el.scAway, s.shoot[1]); } else {
        paintScorerSide(el.scHome, M.scorerList(s, 0));
        paintScorerSide(el.scAway, M.scorerList(s, 1));
      }
      el.root.dataset.style = s.show.style;
      paintBoard(s);
      paintTicker(s);
      const comp = M.str(s.comp).trim() || 'Live match';
      setText(el.comp, comp);
      if (el.compLogo._src !== s.compLogo) {
        el.compLogo._src = s.compLogo;
        el.compLogo.hidden = !s.compLogo;
        if (s.compLogo) el.compLogo.src = s.compLogo;
        else el.compLogo.removeAttribute('src');
      }
      setText(el.cardComp, comp);
      setText(el.homeCode, M.labelOf(s, s.home));
      setText(el.awayCode, M.labelOf(s, s.away));
      const long = s.show.names !== 'code';
      el.homeCell.classList.toggle('is-name', long);
      el.awayCell.classList.toggle('is-name', long);
      setText(el.dhHome, M.codeOf(s.home));
      setText(el.dhAway, M.codeOf(s.away));
      setText(el.ctHomeName, M.titleOf(s, s.home));
      setText(el.ctAwayName, M.titleOf(s, s.away));
      setText(el.ctHomeScorers, M.scorers(s, 0));
      setText(el.ctAwayScorers, M.scorers(s, 1));
      paintCardReds(el.ctHomeReds, M.redList(s, 0));
      paintCardReds(el.ctAwayReds, M.redList(s, 1));
      paintBadge(el.homeBadge, s.home, 'home');
      paintBadge(el.ctHomeBadge, s.home, 'home');
      paintBadge(el.awayBadge, s.away, 'away');
      paintBadge(el.ctAwayBadge, s.away, 'away');
      // Yellow cards only go on the timeline, not on the tabs above the scoreboard.
      paintRedTab(el.redsHome, M.redList(s, 0));
      paintRedTab(el.redsAway, M.redList(s, 1));
      placeRedTabs();
      setText(el.addedNum, `+${s.added}`);

      const pre = s.period === 'pre';
      el.scoreCell.classList.toggle('is-pre', pre);
      el.ctScore.classList.toggle('is-pre', pre);

      // Kick-off, half-time, the second half, extra time and penalties each get a banner; added time gets its board.
      if (lastPeriod !== null && s.period !== lastPeriod && s.show.banners && started) {
        const words = { '1h': 'KICK-OFF', ht: 'HALF-TIME', '2h': 'SECOND HALF', et1: 'EXTRA TIME', et2: 'EXTRA TIME', pens: 'PENALTIES' };
        if (words[s.period]) enqueue({ id: `b${Date.now()}`, kind: 'banner', team: 0, name: words[s.period], local: true });
      }
      if (lastPeriod !== null && s.period === 'ft' && lastPeriod !== 'ft' && started) fullTime();
      if (lastAdded !== null && s.added > lastAdded && M.inPlay(s) && s.show.banners && started) enqueue({ id: `a${Date.now()}`, kind: 'added', team: 0, name: `+${s.added}`, local: true });
      lastPeriod = s.period;
      lastAdded = s.added;
      // An animation undone in the control app is dropped if it hasn't played yet, and cut short if it's playing.
      const ids = new Set(s.anims.map((a) => a.id));
      // (Banners and the added time board are made here, not sent by the hub, so they always stay.)
      for (let i = queue.length - 1; i >= 0; i -= 1) if (!queue[i].local && !ids.has(queue[i].id)) queue.splice(i, 1);
      if (nowPlaying && !nowPlaying.local && !ids.has(nowPlaying.id) && cutShort) cutShort();
      s.anims.forEach((a) => {
        if (seen.has(a.id)) return;
        seen.add(a.id);
        if (Math.abs(M.now() - a.t) < 20000) enqueue(a);
      });
      paintScores(true);

      const ft = s.period === 'ft';
      const [h, a] = s.score;
      const homeLost = ft && (h < a || (h === a && s.pens && s.pens[0] < s.pens[1]));
      const awayLost = ft && (a < h || (h === a && s.pens && s.pens[1] < s.pens[0]));
      el.homeCell.classList.toggle('is-dim', !!homeLost);
      el.awayCell.classList.toggle('is-dim', !!awayLost);
      el.ctHome.classList.toggle('is-dim', !!homeLost);
      el.ctAway.classList.toggle('is-dim', !!awayLost);

      const keys = visibleStats(s);
      ensureRows(keys);
      paintRows(el.bugRows, rowsBug, s, pre, keys);
      paintRows(el.cardRows, rowsCard, s, pre, keys);
      const hasStats = keys.length > 0;
      el.cardStats.classList.toggle('is-empty', !hasStats);

      const cardOn = M.cardVisible(s);
      el.root.classList.toggle('is-off-air', !s.onAir);
      el.bugInner.classList.toggle('is-hidden', !s.show.bug);
      el.bug.classList.toggle('is-off', !s.show.bug);
      el.drawer.classList.toggle('is-on', introDone && s.show.bug && s.show.drawer && hasStats && !cardOn);
      const showCard = cardOn && !(splashUntil && Date.now() < splashUntil) && s.board === 'none'; // the full-time splash and centre cards go first
      el.card.classList.toggle('is-on', introDone && showCard);
      el.card.classList.toggle('is-off', !showCard);
      paintTimeline(s);
      place(s);
      tick();
    }

    /* Limits that keep the bar and the card on screen. The card is placed by its bottom centre. */
    function bounds(kind, s) {
      if (kind === 'bug') {
        const k = s.bug.s * s.scale;
        const w = el.bug.offsetWidth * k;
        const h = el.bug.offsetHeight * k;
        return { minX: 0, maxX: Math.max(0, W - w), minY: 0, maxY: Math.max(0, H - h), w };
      }
      const k = s.card.s * s.scale;
      const w = el.card.offsetWidth * k;
      const h = el.card.offsetHeight * k;
      return { minX: w / 2, maxX: Math.max(w / 2, W - w / 2), minY: h, maxY: H, w };
    }

    /* Dragging in the preview, with a snap to the centre line */
    function makeDraggable(node, kind) {
      let start = null;
      node.addEventListener('pointerdown', (e) => {
        if (!current || (e.pointerType === 'mouse' && e.button !== 0)) return;
        start = { px: e.clientX, py: e.clientY, x: current[kind].x, y: current[kind].y, id: e.pointerId };
        try { node.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        node.classList.add('is-dragging');
        e.preventDefault();
      });
      node.addEventListener('pointermove', (e) => {
        if (!start || e.pointerId !== start.id || !current) return;
        const b = bounds(kind, current);
        let x = M.clamp(start.x + (e.clientX - start.px) / stage.scale, b.minX, b.maxX);
        const y = M.clamp(start.y + (e.clientY - start.py) / stage.scale, b.minY, b.maxY);
        const centre = kind === 'bug' ? x + b.w / 2 : x;
        const snap = Math.abs(centre - W / 2) < 16;
        if (snap) x = kind === 'bug' ? W / 2 - b.w / 2 : W / 2;
        if (el.guide) el.guide.classList.toggle('is-on', snap);
        opts.onDrag(kind, Math.round(x), Math.round(y), false);
      });
      const end = () => {
        if (!start) return;
        start = null;
        node.classList.remove('is-dragging');
        if (el.guide) el.guide.classList.remove('is-on');
        if (current) opts.onDrag(kind, current[kind].x, current[kind].y, true);
      };
      node.addEventListener('pointerup', end);
      node.addEventListener('pointercancel', end);
      node.addEventListener('lostpointercapture', end);
    }
    if (preview && typeof opts.onDrag === 'function') {
      makeDraggable(el.bug, 'bug');
      makeDraggable(el.card, 'card');
    }

    setInterval(tick, 250);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { shownTime = ''; tick(); });

    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (current) placeRedTabs(); });
    return { el, render, bounds };
  }

  window.Scoreboard = { mount, paintBadge, setCrestBase, W, H };
})();
