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
        <div class="tab tab-comp"><img class="comp-logo" data-ref="compLogo" alt="" hidden><span data-ref="comp"></span></div>
        <div class="tab tab-added" data-ref="addedTab"><b data-ref="addedNum"></b><span>min</span></div>
        <div class="tab tab-reds home" data-ref="redsHome" aria-hidden="true"></div>
        <div class="tab tab-reds away" data-ref="redsAway" aria-hidden="true"></div>
      </div>
      <div class="bug-main">
        <div class="cell clock" data-ref="clockCell" style="--i:0">
          <div class="clock-row"><span class="dot" data-ref="dot"></span><span class="time" data-ref="time"></span></div>
          <div class="period" data-ref="period"></div>
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
          <div class="goal-shine" data-ref="goalShine"></div>
        </div>
      </div>
      <div class="drawer" data-ref="drawer">
        <div class="drawer-head">
          <span class="dh h"><i class="sw home"></i><span data-ref="dhHome"></span></span>
          <span class="dh-t">Match stats</span>
          <span class="dh a"><span data-ref="dhAway"></span><i class="sw away"></i></span>
        </div>
        <div class="rows" data-ref="bugRows"></div>
      </div>
    </div>
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

  /* A crest image when there is one, otherwise the team's first letter in its colour. */
  function paintBadge(node, team, side) {
    const src = team.crestV ? `/api/crest/${side}?v=${team.crestV}` : '';
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
      const team = M.nameOf(current[side]);
      el.goal.dataset.kind = a.kind;
      if (a.kind === 'red') {
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
        }
      }
      el.goal.style.visibility = 'visible';
      const move = 'cubic-bezier(.77,0,.175,1)';
      const settle = 'cubic-bezier(.23,1,.32,1)';
      const enter = el.goal.animate([{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)' }], { duration: 520, easing: move, fill: 'forwards' });
      el.goalIcon.animate([{ opacity: 0, transform: 'scale(.6) rotate(-30deg)' }, { opacity: 1, transform: 'scale(1) rotate(0)' }], { duration: 560, delay: 200, easing: settle, fill: 'both' });
      el.goalWord.animate([{ opacity: 0, transform: 'translateX(-40px) skewX(-9deg)' }, { opacity: 1, transform: 'translateX(0) skewX(-9deg)' }], { duration: 560, delay: 220, easing: settle, fill: 'both' });
      el.goalMeta.animate([{ opacity: 0, transform: 'translateX(24px)' }, { opacity: 1, transform: 'translateX(0)' }], { duration: 520, delay: 340, easing: settle, fill: 'both' });
      el.goalShine.animate([{ transform: 'translateX(-200px) skewX(-18deg)' }, { transform: 'translateX(900px) skewX(-18deg)' }], { duration: 1000, delay: 480, easing: 'cubic-bezier(.65,0,.35,1)', fill: 'both' });
      await Promise.race([enter.finished, cut]);
      await Promise.race([wait(a.kind === 'scorer' ? 3400 : 2600), cut]);
      const leave = el.goal.animate([{ clipPath: 'inset(0 0 0 0%)' }, { clipPath: 'inset(0 0 0 100%)' }], { duration: 460, easing: move, fill: 'forwards' });
      await leave.finished;
      el.goal.style.visibility = 'hidden';
      [el.goal, el.goalIcon, el.goalWord, el.goalMeta, el.goalShine].forEach((n) => n.getAnimations().forEach((x) => x.cancel()));
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
    function ensureRows(s) {
      const key = s.statsShown.join(',');
      if (key === rowsKey) return;
      rowsKey = key;
      rowsBug = buildRows(el.bugRows, s.statsShown);
      rowsCard = buildRows(el.cardRows, s.statsShown);
    }
    function paintRows(container, map, s, neutral) {
      container.classList.toggle('is-neutral', neutral);
      s.statsShown.forEach((key) => {
        const def = M.STAT[key];
        const r = map[key];
        if (!def || !r) return;
        let [h, a] = s.stats[key];
        if (def.kind === 'pct') { h = M.clamp(h, 0, 100); a = 100 - h; }
        const total = h + a;
        const p = neutral || total === 0 ? 50 : (h / total) * 100;
        setText(r.h, neutral ? '–' : M.formatStat(def, h));
        setText(r.a, neutral ? '–' : M.formatStat(def, a));
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
      const comp = M.str(s.comp).trim() || 'Live match';
      setText(el.comp, comp);
      if (el.compLogo._src !== s.compLogo) {
        el.compLogo._src = s.compLogo;
        el.compLogo.hidden = !s.compLogo;
        if (s.compLogo) el.compLogo.src = s.compLogo;
        else el.compLogo.removeAttribute('src');
      }
      setText(el.cardComp, comp);
      setText(el.homeCode, M.codeOf(s.home));
      setText(el.awayCode, M.codeOf(s.away));
      setText(el.dhHome, M.codeOf(s.home));
      setText(el.dhAway, M.codeOf(s.away));
      setText(el.ctHomeName, M.nameOf(s.home));
      setText(el.ctAwayName, M.nameOf(s.away));
      setText(el.ctHomeScorers, M.scorers(s, 0));
      setText(el.ctAwayScorers, M.scorers(s, 1));
      paintReds(el.ctHomeReds, M.redsOf(s, 0));
      paintReds(el.ctAwayReds, M.redsOf(s, 1));
      paintBadge(el.homeBadge, s.home, 'home');
      paintBadge(el.ctHomeBadge, s.home, 'home');
      paintBadge(el.awayBadge, s.away, 'away');
      paintBadge(el.ctAwayBadge, s.away, 'away');
      paintReds(el.redsHome, M.redsOf(s, 0));
      paintReds(el.redsAway, M.redsOf(s, 1));
      setText(el.addedNum, `+${s.added}`);

      const pre = s.period === 'pre';
      el.scoreCell.classList.toggle('is-pre', pre);
      el.ctScore.classList.toggle('is-pre', pre);

      // An animation undone in the control app is dropped if it hasn't played yet, and cut short if it's playing.
      const ids = new Set(s.anims.map((a) => a.id));
      for (let i = queue.length - 1; i >= 0; i -= 1) if (!ids.has(queue[i].id)) queue.splice(i, 1);
      if (nowPlaying && !ids.has(nowPlaying.id) && cutShort) cutShort();
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

      ensureRows(s);
      paintRows(el.bugRows, rowsBug, s, pre);
      paintRows(el.cardRows, rowsCard, s, pre);
      const hasStats = s.statsShown.length > 0;
      el.cardStats.classList.toggle('is-empty', !hasStats);

      const cardOn = M.cardVisible(s);
      el.root.classList.toggle('is-off-air', !s.onAir);
      el.bugInner.classList.toggle('is-hidden', !s.show.bug);
      el.bug.classList.toggle('is-off', !s.show.bug);
      el.drawer.classList.toggle('is-on', introDone && s.show.bug && s.show.drawer && hasStats && !cardOn);
      el.card.classList.toggle('is-on', introDone && cardOn);
      el.card.classList.toggle('is-off', !cardOn);
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

    return { el, render, bounds };
  }

  window.Scoreboard = { mount, paintBadge, W, H };
})();
