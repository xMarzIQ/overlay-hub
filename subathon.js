/*
  Subathon & Goals on the server. The server is the only place time and totals change:
  - apply(): one contribution (from Twitch or typed in by hand), applied once, with exactly what it changed recorded
    so a correction can undo it precisely.
  - act(): the buttons in the hub (start, pause, add time, manual subs, bonus periods, milestones, spins...).
  - tick(): once a second, handles reaching zero (grace period, minimum length, automatic ending).
  Nothing is ever invented: missed Twitch events are flagged for a manual correction, not estimated.
*/
const SUB_PTS = { 1000: 1, 2000: 2, 3000: 6 };
const SUB_RULES = ['t1', 't2', 't3', 'prime', 'gift', 'resub'];
const rid = () => Math.random().toString(36).slice(2, 10);

function ruleFor(ev) {
  switch (ev.kind) {
    case 'sub': return ev.prime ? 'prime' : String(ev.tier) === '3000' ? 't3' : String(ev.tier) === '2000' ? 't2' : 't1';
    case 'resub': return 'resub';
    case 'gift': return 'gift';
    case 'bits': return 'bits';
    case 'follow': return 'follow';
    case 'donation': return 'donation';
    case 'custom': return 'custom';
    default: return null;
  }
}
// How many of the rule's units this contribution is worth (subs and gifts by count, bits per 100, donations per 1)
function units(ev, rule) {
  if (rule === 'bits') return (ev.amount || 0) / 100;
  if (rule === 'donation') return ev.amount || 0;
  if (rule === 'gift' || rule === 'custom') return ev.amount || 1;
  if (rule === 'follow') return 1;
  return ev.qty || 1;
}
const bonusOn = (s, rule, now) => s.bonus.until > now && (!s.bonus.types.length || s.bonus.types.includes(rule));
const elapsed = (t, now) => (t.start ? (now - t.start) / 1000 : 0);

// Adds (or removes) time to the timer as the current state and limits allow; returns the seconds actually changed
function addTime(s, secs, now, force) {
  const t = s.timer;
  if (!secs) return 0;
  if (!force && s.mode !== 'normal') {
    if (!s.sleep.collect) return 0;
    if (s.sleep.queue && secs > 0) { s.queued += secs; return 0; }
  }
  if (t.state === 'ended') return 0;
  if (t.state === 'idle') { const before = t.first; t.first = Math.max(0, t.first + secs); return t.first - before; }
  const cap = (left) => (t.max ? Math.min(left, Math.max(0, t.max - elapsed(t, now))) : left);
  let before;
  let after;
  if (t.state === 'running') { before = Math.max(0, (t.end - now) / 1000); after = Math.max(0, cap(before + secs)); t.end = now + after * 1000; }
  else if (t.state === 'paused') { before = t.left; after = Math.max(0, cap(t.left + secs)); t.left = after; }
  else { before = 0; after = Math.max(0, cap(secs)); if (after > 0) { t.state = 'running'; t.end = now + after * 1000; t.graceEnd = 0; } }
  const changed = Math.round(after - before);
  t.added += changed;
  return changed;
}
function countsOf(s, src) { return s.counts[src] || 0; }
// Milestones unlock themselves once their source reaches the target (and again each time for repeatable ones)
function checkMilestones(s, now, out) {
  s.milestones.forEach((m) => {
    if (!m.auto || m.s === 'skipped') return;
    const v = countsOf(s, m.src);
    const due = m.rep ? Math.floor(v / m.target) > m.times : m.s === 'locked' && v >= m.target;
    if (!due) return;
    m.times = m.rep ? Math.floor(v / m.target) : m.times + 1;
    m.s = 'unlocked';
    m.at = now;
    if (s.spins.perMilestone) s.spins.owed += 1;
    out.push(m);
  });
}

function apply(s, ev, src, now) {
  const rule = ruleFor(ev);
  if (!rule) return null;
  const R = s.rules[rule];
  const u = units(ev, rule);
  let secs = R.on ? R.secs * u * R.mult : 0;
  let prog = R.on ? R.prog * u * R.mult : 0;
  if (R.on && bonusOn(s, rule, now)) { secs *= s.bonus.mult; prog *= s.bonus.prog; }
  if (s.mode !== 'normal') secs *= s.sleep.mult;
  if (R.max) secs = Math.min(secs, R.max);
  const qty = rule === 'gift' || rule === 'custom' ? (ev.amount || 1) : (ev.qty || 1);
  const pts = (SUB_PTS[String(ev.tier || '1000')] || 1) * qty;
  const cd = {};
  const bump = (k, v) => { if (!v) return; s.counts[k] += v; cd[k] = (cd[k] || 0) + v; };
  const subsBefore = s.counts.subs;
  const bitsBefore = s.counts.bits;
  if (SUB_RULES.includes(rule)) { bump('subs', qty); bump('points', pts); }
  if (rule === 'resub') bump('resubs', qty);
  if (rule === 'gift') bump('gifts', qty);
  if (rule === 'bits') bump('bits', ev.amount || 0);
  if (rule === 'follow') bump('follows', 1);
  if (rule === 'donation') bump('money', ev.amount || 0);
  if (rule === 'custom') bump('custom', qty);
  const added = addTime(s, Math.round(secs), now);
  // Goals only move from their own source, so one goal never changes another unless they share a source
  const gd = [];
  s.goals.forEach((g) => {
    const d = g.src === 'subs' ? (SUB_RULES.includes(rule) ? prog : 0) : g.src === 'points' ? (cd.points || 0) : g.src === 'gifts' ? (cd.gifts || 0)
      : g.src === 'bits' ? (cd.bits || 0) : g.src === 'follows' ? (cd.follows || 0) : g.src === 'money' ? (cd.money || 0) : g.src === 'custom' ? (rule === 'custom' ? prog : 0) : 0;
    if (d) { g.cur += d; gd.push([g.id, d]); }
  });
  // Wheel spins earned from subs or bits (never spun by themselves)
  if (s.spins.perSubs) s.spins.owed += Math.floor(s.counts.subs / s.spins.perSubs) - Math.floor(subsBefore / s.spins.perSubs);
  if (s.spins.perBits) s.spins.owed += Math.floor(s.counts.bits / s.spins.perBits) - Math.floor(bitsBefore / s.spins.perBits);
  const unlocked = [];
  checkMilestones(s, now, unlocked);
  const entry = { id: String(ev.id || rid()), kind: rule, user: ev.user || '', tier: String(ev.tier || ''), qty: rule === 'bits' || rule === 'donation' ? (ev.amount || 0) : qty, secs: added, prog: Math.round(prog * 100) / 100, at: now, src, fixed: false, note: ev.note || '', gd, cd };
  s.hist.unshift(entry);
  unlocked.forEach((m) => s.hist.unshift({ id: rid(), kind: 'milestone', user: '', tier: '', qty: 0, secs: 0, prog: 0, at: now, src: 'note', fixed: false, note: `Milestone unlocked: ${m.name}${m.reward ? ` (${m.reward})` : ''}`, gd: [], cd: {} }));
  s.hist = s.hist.slice(0, 400);
  return entry;
}
const note = (s, now, text, kind = 'note') => { s.hist.unshift({ id: rid(), kind, user: '', tier: '', qty: 0, secs: 0, prog: 0, at: now, src: 'note', fixed: false, note: text, gd: [], cd: {} }); s.hist = s.hist.slice(0, 400); };
function endSession(s, now) {
  const t = s.timer;
  s.sessions.unshift({ id: rid(), start: t.start, end: now, subs: s.counts.subs, gifts: s.counts.gifts, bits: s.counts.bits, added: t.added, milestones: s.milestones.filter((m) => m.s !== 'locked').length, spins: s.spins.done, peak: Math.round(Math.max(...s.goals.map((g) => g.cur), s.counts.subs)) });
  s.sessions = s.sessions.slice(0, 20);
  t.state = 'ended';
  t.left = 0;
}

// The hub's buttons. Returns an error message, or '' when it worked.
function act(s, a, b, now, who) {
  const t = s.timer;
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  switch (a) {
    case 'start':
      if (t.state === 'running' || t.state === 'paused') return 'The subathon is already going.';
      Object.assign(t, { state: 'running', start: now, first: Math.max(60, n(b.secs) || t.first || 3600), added: 0, graceEnd: 0 });
      t.end = now + t.first * 1000;
      Object.keys(s.counts).forEach((k) => { s.counts[k] = 0; });
      s.goals.forEach((g) => { g.cur = g.start; });
      s.milestones.forEach((m) => { m.s = 'locked'; m.times = 0; m.at = 0; });
      s.hist = [];
      note(s, now, `Subathon started by ${who}`);
      return '';
    case 'pause': if (t.state !== 'running') return 'It isn’t running.'; t.left = Math.max(0, (t.end - now) / 1000); t.state = 'paused'; note(s, now, `Paused by ${who}`); return '';
    case 'resume': if (t.state !== 'paused') return 'It isn’t paused.'; t.end = now + t.left * 1000; t.state = 'running'; note(s, now, `Resumed by ${who}`); return '';
    case 'end': if (t.state === 'idle' || t.state === 'ended') return 'There’s no subathon running.'; endSession(s, now); note(s, now, `Ended by ${who}`); return '';
    case 'reset': Object.assign(t, { state: 'idle', end: 0, left: 0, start: 0, added: 0, graceEnd: 0 }); Object.keys(s.counts).forEach((k) => { s.counts[k] = 0; }); s.hist = []; s.queued = 0; return '';
    case 'first': if (t.state !== 'idle' && t.state !== 'ended') return 'Use add or remove time while it’s running.'; t.state = 'idle'; t.first = Math.max(0, n(b.secs)); return '';
    case 'time': {
      const secs = Math.round(n(b.secs));
      if (!secs) return 'Choose how much time.';
      const done = addTime(s, secs, now, true);
      s.hist.unshift({ id: rid(), kind: 'time', user: who, tier: '', qty: 0, secs: done, prog: 0, at: now, src: 'manual', fixed: false, note: `${secs > 0 ? 'Added' : 'Removed'} time by hand`, gd: [], cd: {} });
      return '';
    }
    case 'manual': {
      const kind = ['sub', 'gift', 'bits', 'follow', 'donation', 'custom', 'resub'].includes(b.kind) ? b.kind : 'sub';
      const qty = Math.max(1, Math.round(n(b.qty) || 1));
      const amount = Math.max(0, n(b.amount));
      if ((kind === 'bits' || kind === 'donation') && !amount) return 'Type the amount.';
      apply(s, { kind, tier: ['1000', '2000', '3000'].includes(String(b.tier)) ? String(b.tier) : '1000', prime: b.prime === true, qty, amount: kind === 'gift' || kind === 'custom' ? qty : amount, user: String(b.user || '').slice(0, 40), note: `Added by ${who}` }, 'manual', now);
      return '';
    }
    case 'undo-entry': {
      const e = s.hist.find((x) => x.id === String(b.id));
      if (!e || e.fixed || e.src === 'note') return 'That can’t be undone.';
      if (e.secs) addTime(s, -e.secs, now, true);
      Object.entries(e.cd || {}).forEach(([k, v]) => { s.counts[k] = Math.max(0, s.counts[k] - v); });
      (e.gd || []).forEach(([gid, d]) => { const g = s.goals.find((x) => x.id === gid); if (g) g.cur -= d; });
      e.fixed = true;
      e.note = `Removed by ${who}`;
      return '';
    }
    case 'mode': {
      const mode = ['normal', 'sleep', 'break'].includes(b.mode) ? b.mode : 'normal';
      if (mode === s.mode) return '';
      if (mode !== 'normal' && s.sleep.pause && t.state === 'running') { t.left = Math.max(0, (t.end - now) / 1000); t.state = 'paused'; t.sleepPaused = true; }
      if (mode === 'normal' && t.sleepPaused && t.state === 'paused') { t.end = now + t.left * 1000; t.state = 'running'; }
      if (mode === 'normal') t.sleepPaused = false;
      s.mode = mode;
      if (mode === 'normal' && s.queued) { const q = s.queued; s.queued = 0; const done = addTime(s, q, now, true); note(s, now, `Added ${Math.round(done / 60)} min of queued time`); }
      note(s, now, mode === 'normal' ? `Back to normal (${who})` : `${mode === 'sleep' ? 'Sleep' : 'Break'} mode on (${who})`);
      return '';
    }
    case 'bonus-start':
      if (s.bonus.until > now) return 'A bonus is already running. End it first, so bonuses never stack.';
      s.bonus.from = now;
      s.bonus.until = now + Math.max(1, n(b.mins) || s.bonus.mins) * 60000;
      note(s, now, `Bonus on: ×${s.bonus.mult} time${s.bonus.prog > 1 ? `, ×${s.bonus.prog} progress` : ''} for ${Math.round((s.bonus.until - now) / 60000)} min (${who})`);
      return '';
    case 'bonus-end': if (s.bonus.until <= now) return 'No bonus is running.'; s.bonus.until = now; note(s, now, `Bonus ended (${who})`); return '';
    case 'goal-set': { const g = s.goals.find((x) => x.id === b.id); if (!g) return 'That goal has gone.'; const was = g.cur; g.cur = n(b.cur); note(s, now, `${g.name}: corrected from ${was} to ${g.cur} by ${who}`, 'fix'); return ''; }
    case 'goal-reset': { const g = s.goals.find((x) => x.id === b.id); if (!g) return 'That goal has gone.'; g.cur = g.start; note(s, now, `${g.name}: reset by ${who}`, 'fix'); return ''; }
    case 'ms': { const m = s.milestones.find((x) => x.id === b.id); if (!m) return 'That milestone has gone.'; const to = ['locked', 'unlocked', 'done', 'skipped'].includes(b.s) ? b.s : 'unlocked'; if (to === 'unlocked' && m.s === 'locked' && s.spins.perMilestone) s.spins.owed += 1; m.s = to; m.at = now; note(s, now, `Milestone “${m.name}”: ${to} (${who})`); return ''; }
    case 'spin-add': s.spins.owed = Math.max(0, s.spins.owed + Math.round(n(b.n))); return '';
    case 'spin-done': if (s.spins.owed < 1) return 'No spins are owed.'; s.spins.owed -= 1; s.spins.done += 1; s.spins.hist.unshift({ t: String(b.result || 'Spin done').slice(0, 80), at: now }); s.spins.hist = s.spins.hist.slice(0, 30); return '';
    case 'session-del': s.sessions = s.sessions.filter((x) => x.id !== b.id); return '';
    case 'clear-warn': s.warn = null; return '';
    default: return 'Unknown action.';
  }
}
// Once a second: reaching zero, the grace period, the minimum length and automatic ending
function tick(s, now) {
  const t = s.timer;
  if (t.state === 'running' && t.end <= now) {
    if (t.min && elapsed(t, now) < t.min) { t.end = t.start + t.min * 1000; return true; }
    if (t.grace) { t.state = 'grace'; t.graceEnd = now + t.grace * 1000; note(s, now, 'Timer reached zero: grace period started'); return true; }
    if (t.autoEnd) { endSession(s, now); note(s, now, 'Timer reached zero: subathon ended'); return true; }
    return false;
  }
  if (t.state === 'grace' && t.graceEnd <= now) { if (t.autoEnd) { endSession(s, now); note(s, now, 'Grace period over: subathon ended'); } else { t.state = 'running'; t.end = now; t.graceEnd = 0; } return true; }
  return false;
}
// The Twitch connection dropped or came back: flag a possible gap in tracking (never guess what was missed)
function gap(s, connected, now) {
  if (s.timer.state !== 'running' && s.timer.state !== 'paused') return false;
  if (!connected && !(s.warn && s.warn.gap)) { s.warn = { gap: true, since: now }; note(s, now, 'Twitch connection lost: events may be missed until it reconnects', 'gap'); return true; }
  if (connected && s.warn && s.warn.gap) { const mins = Math.max(1, Math.round((now - s.warn.since) / 60000)); s.warn = null; note(s, now, `Twitch reconnected after about ${mins} min. Add anything you saw during the gap by hand.`, 'gap'); return true; }
  return false;
}
module.exports = { apply, act, tick, gap, ruleFor };
