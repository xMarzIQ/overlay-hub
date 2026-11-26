'use strict';
/*
  Live football data from ESPN's free public JSON (no key, no account).
  - Lists matches for the competitions in match.js on a chosen day.
  - Follows ONE match at a time: score and scorers, red cards, stats, period and clock, kit colours and crests.
  - Checks constantly: a small single-match request every 3 seconds by default (score, clock, goals, cards,
    main stats). ESPN refreshes that data every second, so a goal reaches the overlay seconds after ESPN has it.
  - The big match summary (kit colours, exact half start times, every stat) is read in the background every
    30 seconds and straight away at kick-off, half-time and the second half, so it never holds up a goal.
  - Works alongside the operator: a goal or red card pressed by hand stays while ESPN catches up,
    then ESPN fills in who it was. Manual mode stops all of this.
  ESPN's data is unofficial and undocumented, so field names are read defensively.
*/
const Match = require('./public/match.js');

const BASE = String(process.env.ESPN_BASE || 'https://site.api.espn.com/apis/site/v2/sports/soccer').replace(/\/+$/, '');
const TIMEZONE = process.env.MATCH_TIMEZONE || 'Europe/London';
const GRACE_MS = 5 * 60 * 1000; // how long something pressed by hand waits for ESPN to agree
const SUMMARY_LIVE_MS = 30 * 1000;
const FINAL_CHECKS = 18;         // after full-time: 3 more minutes of checks for late corrections, then stop

const httpError = (status, message) => Object.assign(new Error(message), { status });
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const hex = (v) => (/^[0-9a-f]{6}$/i.test(String(v || '').replace('#', '')) ? `#${String(v).replace('#', '').toLowerCase()}` : '');
const kickoffLabel = (iso) => {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(t));
  } catch (e) {
    return new Date(t).toISOString().slice(11, 16);
  }
};
// "63'" or "45'+2'" -> { minute: 63, extra: 0 } / { minute: 45, extra: 2 }
function parseDisplayClock(v) {
  const m = /(\d+)'?\s*(?:\+\s*(\d+))?/.exec(String(v || ''));
  return m ? { minute: num(m[1]), extra: num(m[2]) } : null;
}
const minuteMark = (v) => { const c = parseDisplayClock(v); return c && c.minute ? `${c.minute}${c.extra ? `+${c.extra}` : ''}’` : ''; };

function createEspn(ctx) {
  const mem = {
    animated: new Set(), // goals and cards already shown with an animation
    ignored: new Set(),  // ESPN goals and cards the operator took off by hand
    lastEvent: null,     // used to re-line-up the clock without a request
    starts: {},          // real-world start time of each half, from the summary
    summaryAt: 0,
    finalPolls: 0,
    hold: null,          // a period set by hand that ESPN hasn't reached yet
    timer: null,
    busy: false,
    summaryBusy: false,
    startedAt: 0,        // when the last check began, so checks run on a steady beat
    fails: 0,            // failed checks in a row, for a short back-off
    slowUntil: 0,        // ESPN asked for fewer requests
    phase: '',
    lists: new Map(),
  };

  async function get(path, timeoutMs) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs || 12000);
    let res;
    try {
      res = await fetch(`${BASE}${path}`, { headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (overlay hub)' }, signal: ctrl.signal });
    } catch (e) {
      throw new Error('Couldn’t reach ESPN. Check the server’s internet connection.');
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 404) throw httpError(404, 'ESPN doesn’t have that match.');
    if (res.status === 429 || res.status === 403) throw httpError(res.status, 'ESPN asked for fewer requests, so checks are slower for a minute.');
    if (!res.ok) throw new Error(`ESPN answered with an error (${res.status}). It usually clears up on its own.`);
    try { return await res.json(); } catch (e) { throw new Error('ESPN sent something unreadable.'); }
  }
  const compOf = (key) => Match.COMPETITIONS.find((c) => c.key === key);

  /* ---------- Choosing a match ---------- */
  function summariseEvent(e) {
    const comp = (e.competitions && e.competitions[0]) || {};
    const st = e.status || comp.status || {};
    const type = st.type || {};
    const side = (homeAway) => {
      const c = (comp.competitors || []).find((x) => x.homeAway === homeAway) || {};
      const t = c.team || {};
      return { name: t.shortDisplayName || t.displayName || t.name || '', code: t.abbreviation || '', logo: t.logo || '', score: c.score == null ? null : num(c.score) };
    };
    return {
      id: String(e.id),
      ts: Date.parse(e.date) || 0,
      kickoff: kickoffLabel(e.date),
      state: type.state || 'pre',
      status: type.name || '',
      detail: type.shortDetail || type.detail || '',
      clock: st.displayClock || '',
      home: side('home'),
      away: side('away'),
    };
  }
  async function listMatches(compKey, date) {
    const comp = compOf(compKey);
    if (!comp) throw httpError(400, 'Pick a competition first.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) throw httpError(400, 'Pick a day.');
    const cacheKey = `${compKey}|${date}`;
    const hit = mem.lists.get(cacheKey);
    if (hit && Date.now() - hit.at < 10 * 1000) return hit.list;
    const data = await get(`/${comp.slug}/scoreboard?dates=${date.replace(/-/g, '')}`);
    const order = { in: 0, pre: 1, post: 2 };
    const list = (Array.isArray(data.events) ? data.events : []).map(summariseEvent)
      .sort((a, b) => (order[a.state] - order[b.state]) || (a.ts - b.ts));
    mem.lists.set(cacheKey, { at: Date.now(), list });
    return list;
  }

  /* ---------- Crests ---------- */
  async function fetchImage(url) {
    if (!/^https?:\/\//.test(String(url || ''))) return null;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) return null;
      const type = String(res.headers.get('content-type') || '').split(';')[0].trim();
      if (!/^image\/(png|jpeg|webp)$/.test(type)) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      return buf.length && buf.length < 900000 ? { type, base64: buf.toString('base64') } : null;
    } catch (e) {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /* ---------- Following one match ---------- */
  const sides = (event) => {
    const comp = (event.competitions && event.competitions[0]) || {};
    const list = comp.competitors || [];
    return { comp, home: list.find((c) => c.homeAway === 'home') || {}, away: list.find((c) => c.homeAway === 'away') || {} };
  };

  async function follow(eventId, compKey) {
    const comp = compOf(compKey);
    if (!comp) throw httpError(400, 'Pick a competition first.');
    if (!/^\d+$/.test(String(eventId))) throw httpError(400, 'Pick a match first.');
    const event = await get(`/${comp.slug}/scoreboard/${eventId}`, 8000);
    if (!event || !event.competitions) throw httpError(404, 'ESPN doesn’t have that match.');
    const { home, away } = sides(event);
    const wantCrests = ctx.get().feed.crests;
    const [crestH, crestA, sum] = await Promise.all([
      wantCrests ? fetchImage(home.team && home.team.logo) : null,
      wantCrests ? fetchImage(away.team && away.team.logo) : null,
      get(`/${comp.slug}/summary?event=${event.id}`).catch(() => null), // not essential to start following
    ]);
    // Everything is in, so the state changes in one go.
    const s = ctx.get();
    mem.animated.clear();
    mem.ignored.clear();
    mem.starts = {};
    mem.summaryAt = 0;
    mem.finalPolls = 0;
    mem.fails = 0;
    mem.slowUntil = 0;
    mem.hold = null;
    mem.kickoff = undefined;
    const st = event.status || {};
    mem.phase = `${st.type && st.type.state}|${st.period}|${st.type && st.type.name}`;
    // A new match: clear the old one, keep the look and the layout.
    Object.assign(s, { score: [0, 0], goals: [], reds: [], anims: [], pens: null, note: '', added: 0, clockOffset: 0, period: 'pre' });
    s.stats = Match.zeroStats();
    Match.setClock(s, 0, false);
    s.comp = comp.name;
    s.compKey = comp.key;
    s.compLogo = comp.logo;
    ['home', 'away'].forEach((side) => {
      const t = (side === 'home' ? home : away).team || {};
      s[side].name = String(t.shortDisplayName || t.displayName || t.name || (side === 'home' ? 'Home' : 'Away')).slice(0, 40);
      s[side].code = String(t.abbreviation || '').toUpperCase().slice(0, 4) || Match.codeOf({ name: s[side].name });
      if (s.feed.kitColours && hex(t.color)) s[side].color = hex(t.color);
    });
    s.kickoff = kickoffLabel(event.date) || s.kickoff;
    s.kickoffAt = Date.parse(event.date) || 0;
    Object.assign(s.feed, { fixtureId: Number(event.id), compKey: comp.key, title: `${s.home.name} v ${s.away.name}`, error: '', done: false, statsKeys: [] });
    s.mode = 'live';
    if (crestH) ctx.setCrest('home', crestH);
    if (crestA) ctx.setCrest('away', crestA);
    if (sum) { applySummary(s, sum); mem.summaryAt = Date.now(); }
    applyEvent(s, event, true); // the match so far goes in without replaying animations
    s.feed.updatedAt = Date.now();
    mem.startedAt = Date.now();
    schedule();
    ctx.changed();
  }

  function unfollow() {
    clearTimeout(mem.timer);
    mem.timer = null;
    mem.lastEvent = null;
    const s = ctx.get();
    Object.assign(s.feed, { fixtureId: 0, compKey: '', title: '', status: '', statusShort: '', error: '', done: false, nextAt: 0, statsKeys: [] });
    s.mode = 'manual';
    ctx.changed();
  }

  // The fast check. It never waits for the big summary, so a goal goes out the moment ESPN has it.
  async function poll() {
    clearTimeout(mem.timer);
    mem.timer = null;
    const s = ctx.get();
    if (s.mode !== 'live' || !s.feed.fixtureId || mem.busy) return;
    const comp = compOf(s.feed.compKey);
    if (!comp) return;
    mem.busy = true;
    mem.startedAt = Date.now();
    const id = s.feed.fixtureId;
    try {
      const event = await get(`/${comp.slug}/scoreboard/${id}`, 6000);
      const cur = ctx.get(); // the operator may have changed things while we waited
      if (cur.mode === 'live' && cur.feed.fixtureId === id) {
        applyEvent(cur, event, false);
        cur.feed.error = '';
        cur.feed.updatedAt = Date.now();
        mem.fails = 0;
        summaryIfDue(comp, id, event);
      }
    } catch (err) {
      mem.fails += 1;
      if (err.status === 429 || err.status === 403) mem.slowUntil = Date.now() + 60 * 1000;
      ctx.get().feed.error = err.message;
    }
    mem.busy = false;
    schedule();
    ctx.changed();
  }

  function schedule() {
    clearTimeout(mem.timer);
    mem.timer = null;
    const s = ctx.get();
    if (s.mode !== 'live' || !s.feed.fixtureId || s.feed.done) { s.feed.nextAt = 0; return; }
    const fast = s.feed.pollSeconds;
    const state = s.feed.statusShort;
    let wait;
    if (mem.slowUntil > Date.now()) wait = 30;
    else if (s.feed.error) wait = Math.min(30, fast * 2 ** Math.min(mem.fails - 1, 4)); // a quick retry, then backing off
    else if (state === 'pre') {
      const toKickoff = s.kickoffAt - Date.now();
      wait = toKickoff > 3 * 3600 * 1000 ? 120 : toKickoff > 30 * 60 * 1000 ? 30 : fast; // flat out from half an hour before
    } else if (state === 'post') wait = 10;
    else wait = fast; // in play, half-time and breaks: as fast as it's set
    // Checks start on a steady beat, so a slow answer from ESPN doesn't push the next one back.
    const sinceStart = (Date.now() - mem.startedAt) / 1000;
    const delay = Math.max(0.25, wait - (sinceStart < wait ? sinceStart : 0));
    s.feed.nextAt = Date.now() + delay * 1000;
    mem.timer = setTimeout(poll, delay * 1000);
  }

  // The big summary, in the background: every 30 seconds in play, and at once when the match moves on.
  function summaryIfDue(comp, id, event) {
    if (mem.summaryBusy) return;
    const st = event.status || {};
    const state = (st.type && st.type.state) || '';
    const phase = `${state}|${st.period}|${st.type && st.type.name}`;
    const every = state === 'in' ? SUMMARY_LIVE_MS : state === 'post' ? 0 : 5 * 60 * 1000;
    const due = !mem.summaryAt || phase !== mem.phase || (every && Date.now() - mem.summaryAt > every) || (state === 'post' && mem.finalPolls <= 1);
    if (!due) return;
    mem.phase = phase;
    mem.summaryBusy = true;
    get(`/${comp.slug}/summary?event=${id}`)
      .then((sum) => {
        const cur = ctx.get();
        if (cur.mode !== 'live' || cur.feed.fixtureId !== id) return;
        mem.summaryAt = Date.now();
        applySummary(cur, sum);
        if (mem.lastEvent) applyPeriod(cur, mem.lastEvent.status || {}); // exact half start times line the clock up
        ctx.changed();
      })
      .catch(() => { /* the fast checks carry on; the next summary tries again */ })
      .finally(() => { mem.summaryBusy = false; });
  }

  /* The full summary: kit colours, exact half start times, every stat, penalty shoot-out. */
  function applySummary(s, sum) {
    const header = (sum.header && sum.header.competitions && sum.header.competitions[0]) || {};
    const ids = {};
    (header.competitors || []).forEach((c) => { if (c.team) ids[c.team.id] = c.homeAway === 'away' ? 1 : 0; });
    // Kit colours actually worn in this match
    if (s.feed.kitColours) {
      (sum.rosters || []).forEach((r) => {
        const side = r.homeAway === 'away' ? 'away' : r.homeAway === 'home' ? 'home' : null;
        const colour = hex(r.uniform && r.uniform.color);
        if (side && colour) s[side].color = colour;
      });
      avoidClash(s, sum);
    }
    // When each half really started, for an accurate clock
    const startTypes = { kickoff: '1h', 'start-2nd-half': '2h', 'start-extra-time': 'et1', 'start-2nd-half-extra-time': 'et2' };
    (sum.keyEvents || []).forEach((k) => {
      const p = startTypes[k.type && k.type.type];
      const t = Date.parse(k.wallclock);
      if (p && Number.isFinite(t)) mem.starts[p] = t;
    });
    // Every stat ESPN has
    const box = (sum.boxscore && sum.boxscore.teams) || [];
    const provided = new Set(s.feed.statsKeys);
    box.forEach((b) => {
      const side = b.team && ids[b.team.id];
      if (side !== 0 && side !== 1) return;
      readStats(s, side, b.statistics, provided);
    });
    s.feed.statsKeys = Array.from(provided);
    // Penalty shoot-out score
    const pens = (header.competitors || []).map((c) => c.shootoutScore);
    if (pens.length === 2 && pens.every((p) => p != null)) {
      const order = (header.competitors || []).map((c) => (c.homeAway === 'away' ? 1 : 0));
      const out = [0, 0];
      pens.forEach((p, i) => { out[order[i]] = num(p); });
      s.pens = out;
    }
  }

  // Two teams in near-identical kits: the away side switches to its other colour.
  function avoidClash(s, sum) {
    const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const a = rgb(s.home.color);
    const b = rgb(s.away.color);
    const distance = Math.sqrt(a.reduce((acc, v, i) => acc + (v - b[i]) ** 2, 0));
    if (distance > 90) return;
    const away = (sum.rosters || []).find((r) => r.homeAway === 'away');
    const header = (sum.header && sum.header.competitions && sum.header.competitions[0]) || {};
    const team = ((header.competitors || []).find((c) => c.homeAway === 'away') || {}).team || {};
    const alt = hex(away && away.uniform && away.uniform.alternateColor) || hex(team.alternateColor);
    if (alt) s.away.color = alt;
  }

  function readStats(s, side, list, provided) {
    const values = {};
    (Array.isArray(list) ? list : []).forEach((st) => { if (st && st.name) values[st.name] = st.displayValue != null ? st.displayValue : st.value; });
    Match.STATS.forEach((def) => {
      let v = null;
      if (def.key === 'passPct') {
        const acc = parseFloat(values.accuratePasses);
        const tot = parseFloat(values.totalPasses);
        if (Number.isFinite(acc) && Number.isFinite(tot) && tot > 0) v = (acc / tot) * 100;
      } else if (def.espn && values[def.espn] != null && values[def.espn] !== '') {
        v = parseFloat(String(values[def.espn]).replace('%', ''));
      }
      if (v === null || !Number.isFinite(v)) return;
      s.stats[def.key][side] = Match.statClean(def, v);
      provided.add(def.key);
    });
    if (provided.has('poss') && side === 1) s.stats.poss[1] = 100 - s.stats.poss[0];
  }

  /* The small, fast update: status, clock, score, goals, red cards and the main stats. */
  function applyEvent(s, event, quiet) {
    mem.lastEvent = event;
    const { comp, home, away } = sides(event);
    // ESPN moves kick-off times when a match is rescheduled; the countdown and the check speed follow it.
    const ko = Date.parse(event.date);
    if (Number.isFinite(ko) && ko !== mem.kickoff) {
      if (mem.kickoff !== undefined) s.kickoff = kickoffLabel(event.date) || s.kickoff;
      mem.kickoff = ko;
      s.kickoffAt = ko;
    }
    const status = event.status || comp.status || {};
    const type = status.type || {};
    s.feed.status = String(type.shortDetail || type.detail || type.description || '').slice(0, 60);
    s.feed.statusShort = String(type.state || '').slice(0, 8);
    applyPeriod(s, status);

    const teamSide = {};
    if (home.team) teamSide[home.team.id] = 0;
    if (away.team) teamSide[away.team.id] = 1;
    const sideOf = (team) => (team && teamSide[team.id] !== undefined ? teamSide[team.id] : -1);
    const details = Array.isArray(comp.details) ? comp.details : [];
    const official = [num(home.score), num(away.score)];

    const feedGoals = goalsFrom(details, sideOf, official).filter((g) => !mem.ignored.has(g.key));
    reconcile(s, 'goals', feedGoals, quiet);
    s.score = [0, 1].map((t) => s.goals.filter((g) => g.team === t).length);

    const feedReds = details
      .filter((d) => d.redCard && !d.shootout && sideOf(d.team) >= 0)
      .map((d) => ({ team: sideOf(d.team), player: playerName(d), minute: minuteMark(d.clock && d.clock.displayValue), key: detailKey(d) }))
      .filter((r) => !mem.ignored.has(r.key));
    reconcile(s, 'reds', feedReds, quiet);

    const provided = new Set(s.feed.statsKeys);
    readStats(s, 0, home.statistics, provided);
    readStats(s, 1, away.statistics, provided);
    s.feed.statsKeys = Array.from(provided);
    if (home.shootoutScore != null && away.shootoutScore != null) s.pens = [num(home.shootoutScore), num(away.shootoutScore)];

    if (type.state === 'post') {
      mem.finalPolls += 1;
      if (mem.finalPolls >= FINAL_CHECKS) s.feed.done = true;
    } else {
      mem.finalPolls = 0;
    }
  }

  const playerName = (d) => {
    const a = (d.athletesInvolved || [])[0] || {};
    return String(a.displayName || a.shortName || a.fullName || '').trim();
  };
  const detailKey = (d) => [d.type && d.type.id, d.clock && d.clock.value, d.team && d.team.id, ((d.athletesInvolved || [])[0] || {}).id || ''].join('|');

  // Goals from the match events, with own goals sorted out, kept to the official score.
  function goalsFrom(details, sideOf, official) {
    const scoring = details.filter((d) => d.scoringPlay && !d.shootout && sideOf(d.team) >= 0);
    const build = (ownGoalToOtherSide) => scoring.map((d) => {
      const side = sideOf(d.team);
      const note = d.ownGoal ? ' (og)' : d.penaltyKick ? ' (pen)' : '';
      const name = playerName(d);
      return { team: d.ownGoal && ownGoalToOtherSide ? 1 - side : side, scorer: name ? `${name}${note}` : '', minute: minuteMark(d.clock && d.clock.displayValue), key: detailKey(d) };
    });
    const count = (list) => [0, 1].map((t) => list.filter((g) => g.team === t).length);
    let goals = build(false);
    const c = count(goals);
    if (c[0] !== official[0] || c[1] !== official[1]) {
      const alt = build(true);
      const c2 = count(alt);
      if (c2[0] === official[0] && c2[1] === official[1]) goals = alt;
    }
    const result = [];
    [0, 1].forEach((t) => {
      const mine = goals.filter((g) => g.team === t).slice(0, official[t]);
      for (let i = mine.length; i < official[t]; i += 1) mine.push({ team: t, scorer: '', minute: '', key: `pending|${t}|${i}` });
      mine.forEach((g) => result.push(g));
    });
    return result;
  }

  // Lines up what is on screen with what ESPN says, team by team, in order.
  function reconcile(s, field, feedList, quiet) {
    const kind = field === 'goals' ? 'goal' : 'red';
    const nameField = field === 'goals' ? 'scorer' : 'player';
    const nowMs = Date.now();
    const next = [];
    [0, 1].forEach((t) => {
      const local = s[field].filter((x) => x.team === t);
      const fed = feedList.filter((x) => x.team === t);
      const n = Math.max(local.length, fed.length);
      for (let i = 0; i < n; i += 1) {
        const L = local[i];
        const F = fed[i];
        if (L && F) {
          const name = F[nameField];
          const nameless = !L[nameField] || (L.src === 'manual' && !L.typed);
          next.push(Object.assign({}, L, { src: 'feed', key: F.key, minute: F.minute || L.minute, [nameField]: name || L[nameField] }));
          // ESPN has just said who scored a goal that was already on screen.
          if (kind === 'goal' && name && nameless && !quiet && !mem.animated.has(`scorer|${F.key}`)) {
            Match.pushAnim(s, { kind: 'scorer', team: t, name, minute: F.minute });
          }
          mem.animated.add(`${kind}|${F.key}`);
          if (name) mem.animated.add(`scorer|${F.key}`);
        } else if (F) {
          next.push({ team: t, [nameField]: F[nameField], minute: F.minute, src: 'feed', key: F.key, at: nowMs, typed: false });
          if (!quiet && !mem.animated.has(`${kind}|${F.key}`)) Match.pushAnim(s, { kind, team: t, name: F[nameField], minute: F.minute });
          mem.animated.add(`${kind}|${F.key}`);
          if (F[nameField]) mem.animated.add(`scorer|${F.key}`);
        } else if (L && L.src === 'manual' && nowMs - (L.at || 0) < GRACE_MS) {
          next.push(L); // pressed by hand and not on ESPN yet, so it stays for now
        }
      }
    });
    s[field] = next;
  }

  // Period and clock from ESPN's status. Uses the real start time of each half when the summary has it.
  function periodFrom(status) {
    const type = status.type || {};
    const name = String(type.name || '').toUpperCase();
    const p = num(status.period);
    if (type.state === 'pre') return 'pre';
    if (type.state === 'post' || /FINAL|FULL_TIME/.test(name)) return 'ft';
    if (/SHOOTOUT|PENALT/.test(name) || p >= 5) return 'pens';
    if (/HALFTIME|HALF_TIME/.test(name)) return p >= 3 || /ET|EXTRA|OVERTIME/.test(name) ? 'brk' : 'ht';
    if (/END_OF_REGULATION|END_REGULATION|END_OF_EXTRA|END_EXTRA|END_PERIOD/.test(name)) return 'brk';
    return { 1: '1h', 2: '2h', 3: 'et1', 4: 'et2' }[p] || null;
  }
  function applyPeriod(s, status) {
    const type = status.type || {};
    const name = String(type.name || '').toUpperCase();
    const period = periodFrom(status) || s.period;
    s.note = /PEN/.test(name) && type.state === 'post' ? 'pens' : /AET|EXTRA_TIME/.test(name) && type.state === 'post' ? 'aet' : '';
    if (mem.hold) {
      if (period === mem.hold.period || Date.now() > mem.hold.until) mem.hold = null; // ESPN caught up, or gave it long enough
      else return;                                                                 // the operator is ahead of ESPN
    }
    const changed = period !== s.period;
    s.period = period;
    if (!Match.PLAY.includes(period)) {
      if (changed || s.clock.running) Match.setClock(s, Match.elapsed(s), false);
      return;
    }
    if (/SUSPENDED|DELAYED|INTERRUPTED/.test(name)) { Match.setClock(s, Match.elapsed(s), false); return; }
    const start = Match.START[period];
    const end = Match.END[period];
    const began = mem.starts[period];
    let target = null;
    let tolerance = 3;
    if (began && Date.now() >= began && Date.now() - began < 3 * 3600 * 1000) {
      target = start + (Date.now() - began) / 1000;
    } else {
      const shown = parseDisplayClock(status.displayClock);
      const secs = num(status.clock);
      if (shown && shown.extra) target = end + (shown.extra - 1) * 60 + 30;
      else if (secs > start && secs < end) target = secs;
      else if (shown && shown.minute) target = Math.max(start, (shown.minute - 1) * 60 + 30);
      tolerance = 75;
    }
    if (target === null || !Number.isFinite(target)) {
      if (!s.clock.running) Match.setClock(s, Math.max(Match.elapsed(s), start), true);
      return;
    }
    target = Math.max(start, target) + s.clockOffset;
    if (changed || !s.clock.running || Math.abs(Match.elapsed(s) - target) > tolerance) Match.setClock(s, Math.max(0, target), true);
  }

  /* ---------- Things the server calls ---------- */
  function onModeChange() {
    const s = ctx.get();
    if (s.mode === 'live' && s.feed.fixtureId) {
      s.feed.done = false;
      mem.finalPolls = 0;
      setTimeout(poll, 0);
    } else {
      clearTimeout(mem.timer);
      mem.timer = null;
      s.feed.nextAt = 0;
    }
  }
  function resync() {
    const s = ctx.get();
    if (s.mode === 'live' && mem.lastEvent) applyPeriod(s, mem.lastEvent.status || {});
  }
  function holdPeriod(period) { mem.hold = { period, until: Date.now() + 3 * 60 * 1000 }; }
  function ignore(keys) {
    (Array.isArray(keys) ? keys : []).forEach((k) => { if (typeof k === 'string' && k) mem.ignored.add(k.slice(0, 120)); });
  }
  function start() {
    const s = ctx.get();
    s.feed.available = true;
    if (s.mode === 'live' && s.feed.fixtureId) setTimeout(poll, 500);
  }

  return { listMatches, follow, unfollow, poll, schedule, onModeChange, resync, holdPeriod, ignore, start };
}

module.exports = createEspn;
