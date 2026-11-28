/*
  Stream tools on the server, all owner-run by default:
  - one typed action engine shared by quick action buttons and automations (no code, no outside requests);
  - automations: Twitch or internal event -> conditions -> ordered actions; every rule starts Off, counts each event once,
    has cooldowns and daily limits, can't trigger itself, and switches itself off after repeated failures;
  - test mode: pretend events run against a throwaway copy, so live totals, Twitch and the OBS page are never touched;
  - the Stream Desk running order's timing (kept here, from saved times, so refreshes and restarts don't lose it);
  - locks (stop editors and automations changing a tab; Hide everything always still works);
  - presets, profiles and version history (configuration only: live values, scores and timers are never rewound,
    nothing is put on screen and no command or timed message is switched on by loading or restoring).
*/
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const rid = () => crypto.randomBytes(5).toString('hex');
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const clone = (o) => JSON.parse(JSON.stringify(o));
const str = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
const TRIGGERS = ['sub', 'resub', 'gift', 'bits', 'follow', 'raid', 'redeem', 'online', 'offline', 'goal', 'milestone', 'segment', 'manual'];
const CONDS = ['subathon-running', 'subathon-stopped', 'mode', 'live', 'not-hidden'];
const VERSIONED = ['desk', 'challenges', 'canvas', 'media', 'subathon', 'twitch'];
// Live values and histories never travel in presets, profiles or versions
const RUNTIME = { subathon: ['hist', 'sessions', 'counts', 'warn', 'queued', 'mode'], twitch: ['dash', 'titleHist', 'catHist', 'chatHist', 'modHist', 'polls', 'preds', 'shouts', 'streams', 'clips', 'markers'], media: ['fire', 'stopSeq', 'hist', 'music'] };
const KEEP_ITEM = ['vis', 'on', 'value', 'cur', 'running', 'start', 'at', 'pos', 'i', 'playing', 'owed', 'done', 'uses', 'last', 'state', 'end', 'left', 'laps', 'results', 'entries', 'times', 's', 'result', 'hist', 'log', 'cells', 'spins'];
const LOOK = ['x', 'y', 'scale', 'color', 'lock', 'title', 'name', 'max', 'min', 'grace', 'autoEnd', 'show', 'every', 'dur', 'mult', 'prog', 'types', 'mins', 'perSubs', 'perBits', 'perMilestone', 'wheel', 'loop', 'ids', 'items', 'shuffle', 'repeat'];

function normOps(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const step = (s) => ({ action: str(s && s.action, 30), secs: num(s && s.secs), n: num(s && s.n, 1), qty: num(s && s.qty, 1), tier: str(s && s.tier, 4) || '1000', mins: num(s && s.mins), text: str(s && s.text, 200),
    widget: str(s && s.widget, 20), target: str(s && s.target, 60), vis: ['off', 'preview', 'live'].includes(s && s.vis) ? s.vis : 'live', sound: str(s && s.sound, 16), setup: str(s && s.setup, 20), rule: str(s && s.rule, 12) });
  return {
    buttons: (Array.isArray(r.buttons) ? r.buttons : []).slice(0, 30).map((b) => ({ id: str(b.id, 12) || rid(), name: str(b.name, 30) || 'Button', color: /^#[0-9a-f]{6}$/i.test(b.color) ? b.color : '#f2a65a',
      steps: (Array.isArray(b.steps) ? b.steps : []).slice(0, 8).map(step), confirm: b.confirm === true, key: /^[a-z]$/i.test(b.key || '') ? b.key.toLowerCase() : '', fav: b.fav === true })),
    rules: (Array.isArray(r.rules) ? r.rules : []).slice(0, 40).map((x) => ({ id: str(x.id, 12) || rid(), name: str(x.name, 50) || 'Automation', desc: str(x.desc, 200), on: x.on === true,
      trigger: { type: TRIGGERS.includes(x.trigger && x.trigger.type) ? x.trigger.type : 'gift', min: num(x.trigger && x.trigger.min), tier: str(x.trigger && x.trigger.tier, 4), reward: str(x.trigger && x.trigger.reward, 45), name: str(x.trigger && x.trigger.name, 60) },
      conds: (Array.isArray(x.conds) ? x.conds : []).slice(0, 6).filter((c) => c && CONDS.includes(c.type)).map((c) => ({ type: c.type, value: str(c.value, 20) })), any: x.any === true,
      steps: (Array.isArray(x.steps) ? x.steps : []).slice(0, 8).map(step), cool: Math.max(0, num(x.cool)), max: Math.max(0, num(x.max)), once: x.once === true, from: /^\d\d:\d\d$/.test(x.from) ? x.from : '', to: /^\d\d:\d\d$/.test(x.to) ? x.to : '',
      runs: num(x.runs), day: str(x.day, 10), last: num(x.last), errors: num(x.errors), ver: Math.max(1, num(x.ver, 1)) })),
    locks: (Array.isArray(r.locks) ? r.locks : []).slice(0, 20).map((l) => ({ id: str(l.id, 12) || rid(), mod: str(l.mod, 20), kind: l.kind === 'layout' ? 'layout' : 'all', reason: str(l.reason, 80), by: str(l.by, 40), at: num(l.at), until: num(l.until), auto: l.auto === true })),
    seen: (Array.isArray(r.seen) ? r.seen : []).slice(-2000).map(String),
    runs: (Array.isArray(r.runs) ? r.runs : []).slice(0, 100),
  };
}

function createOps(ctx) {
  const { Extras, Sub, MODULES, streamers, changed, saveSoon, logActivity, hideAll, applySetupById, canTab, DATA_DIR, notify, testAlert } = ctx;
  const FILE = path.join(DATA_DIR, 'configs.json'); // presets, profiles and versions live here, not in backups
  let store = {};
  try { store = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { store = {}; }
  let saveT = 0;
  const saveStore = () => { clearTimeout(saveT); saveT = setTimeout(() => { try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(`${FILE}.tmp`, JSON.stringify(store)); fs.renameSync(`${FILE}.tmp`, FILE); } catch (e) { console.warn(`Couldn't save presets and versions: ${e.message}`); } }, 800); };
  const bag = (st) => { if (!store[st.id]) store[st.id] = { versions: [], configs: [] }; return store[st.id]; };
  const ops = (st) => { if (!st.ops) st.ops = normOps({}); return st.ops; };
  const tests = new Map(); // test reports, memory only

  /* ---------- What can be shown or hidden ---------- */
  function targets(st) {
    const m = st.modules, out = [];
    const add = (key, name, mod, o) => { if (o && typeof o.vis === 'string') out.push({ key, name, mod, obj: o }); };
    if (m.desk) { m.desk.widgets.forEach((w) => add(`desk:${w.id}`, `Stream Desk: ${w.label || w.id}`, 'desk', w)); add('desk:rundown', 'Stream Desk: running order', 'desk', m.desk.rundown.look); }
    if (m.challenges) m.challenges.widgets.forEach((w) => add(`challenges:${w.id}`, `Challenges: ${w.title || w.kind}`, 'challenges', w));
    if (m.games) ['poll', 'contexto', 'flags', 'give', 'board'].forEach((k) => add(`games:${k}`, `Chat Games: ${k}`, 'games', m.games[k]));
    if (m.media) { add('media:sponsor', 'Media Centre: sponsors', 'media', m.media.sponsor); m.media.shows.forEach((x) => add(`media:show:${x.id}`, `Slideshow: ${x.name}`, 'media', x)); m.media.gifs.forEach((x) => add(`media:gif:${x.id}`, 'Media Centre: GIF', 'media', x)); }
    if (m.subathon) { add('subathon:timer', 'Subathon timer', 'subathon', m.subathon.timer); m.subathon.goals.forEach((g) => add(`subathon:goal:${g.id}`, `Goal: ${g.name}`, 'subathon', g)); add('subathon:milestones', 'Subathon milestones', 'subathon', m.subathon.mlook); add('subathon:spins', 'Spins owed', 'subathon', m.subathon.spins); add('subathon:board', 'Top supporters', 'subathon', m.subathon.blook); }
    if (m.twitch) { add('twitch:alerts', 'Twitch alerts', 'twitch', m.twitch.alerts); add('twitch:poll', 'Twitch poll box', 'twitch', m.twitch.plook); }
    if (m.canvas) m.canvas.items.forEach((i, k) => add(`canvas:${i.id}`, `Canvas item ${k + 1}`, 'canvas', i));
    return out;
  }

  /* ---------- The action engine (typed; shared by buttons and automations) ---------- */
  const now = () => Date.now();
  const A = {
    'subathon.time': { name: 'Subathon: add or remove time', mod: 'subathon', run: (st, p, who) => Sub.act(st.modules.subathon, 'time', { secs: num(p.secs) }, now(), who) },
    'subathon.sub': { name: 'Subathon: add subs by hand', mod: 'subathon', run: (st, p, who) => Sub.act(st.modules.subathon, 'manual', { kind: 'sub', qty: Math.max(1, num(p.qty, 1)), tier: p.tier }, now(), who) },
    'subathon.spin': { name: 'Subathon: add wheel spins owed', mod: 'subathon', run: (st, p, who) => Sub.act(st.modules.subathon, 'spin-add', { n: num(p.n, 1) }, now(), who) },
    'subathon.pause': { name: 'Subathon: pause or resume the timer', mod: 'subathon', run: (st, p, who) => Sub.act(st.modules.subathon, st.modules.subathon.timer.state === 'running' ? 'pause' : 'resume', {}, now(), who) },
    'subathon.bonus': { name: 'Subathon: start a bonus period', mod: 'subathon', run: (st, p, who) => Sub.act(st.modules.subathon, 'bonus-start', { mins: num(p.mins) || undefined }, now(), who) },
    'desk.counter': { name: 'Stream Desk: counter up or down', mod: 'desk', run: (st, p) => { const w = st.modules.desk.widgets.find((x) => x.type === 'counter'); if (!w) return 'There’s no Stream Desk counter.'; w.value += num(p.n, 1) * (w.step || 1); return ''; } },
    'desk.text': { name: 'Stream Desk: change the text', mod: 'desk', run: (st, p) => { const w = st.modules.desk.widgets.find((x) => x.type === 'text'); if (!w) return 'There’s no Stream Desk text.'; w.text = str(p.text, 300); return ''; } },
    'challenge.counter': { name: 'Challenges: counter up or down', mod: 'challenges', run: (st, p) => {
      const w = st.modules.challenges.widgets.find((x) => x.id === p.widget && x.kind === 'counter');
      if (!w) return 'Pick a Challenges counter.';
      let v = w.value + num(p.n, 1) * (w.step || 1);
      if (w.min !== null) v = Math.max(w.min, v);
      if (w.max !== null) v = Math.min(w.max, v);
      w.value = v;
      return '';
    } },
    show: { name: 'Show or hide an overlay piece', publish: true, modOf: (st, p) => (targets(st).find((x) => x.key === p.target) || {}).mod, run: (st, p) => { const t = targets(st).find((x) => x.key === p.target); if (!t) return 'That overlay piece has gone.'; t.obj.vis = p.vis; return ''; } },
    sound: { name: 'Play a sound', mod: 'media', audio: true, run: (st, p) => { const md = st.modules.media; const s = md.sounds.find((x) => x.id === p.sound); if (!s) return 'Pick a sound from the soundboard.'; md.fire = { id: rid(), sound: s.id, at: now() }; md.hist = [{ t: s.name || 'Sound', at: now() }].concat(md.hist).slice(0, 20); return ''; } },
    setup: { name: 'Load a saved setup', publish: true, run: (st, p) => applySetupById(st, p.setup) },
    hide: { name: 'Hide everything', emergency: true, run: (st, p, who) => { hideAll(st, who); return ''; } },
    'rundown.start': { name: 'Running order: start', mod: 'desk', run: (st, p, who, depth) => roAct(st, 'start', {}, who, depth) },
    'rundown.next': { name: 'Running order: next segment', mod: 'desk', run: (st, p, who, depth) => roAct(st, 'next', {}, who, depth) },
    'rundown.pause': { name: 'Running order: pause or resume', mod: 'desk', run: (st, p, who, depth) => roAct(st, st.modules.desk.rundown.session.paused ? 'resume' : 'pause', {}, who, depth) },
    rule: { name: 'Run an automation', run: (st, p, who, depth) => { const r = ops(st).rules.find((x) => x.id === p.rule); if (!r) return 'That automation has gone.'; if (!r.on) return 'That automation is switched off.'; const out = runRule(st, r, { kind: 'manual', id: `manual-${rid()}`, user: who }, depth + 1, false); return out.ok ? '' : `It didn’t run: ${out.note || 'see its history'}.`; } },
  };
  const ACTION_LIST = Object.entries(A).map(([id, a]) => ({ id, name: a.name, publish: !!a.publish, audio: !!a.audio }));

  // One step, checked when it runs: permission, emergency hiding and locks
  function runStep(st, s, actor, o) {
    const a = A[s.action];
    if (!a) return { ok: false, msg: 'Unknown action' };
    const mod = a.modOf ? a.modOf(st, s) : a.mod;
    if (actor.role !== 'owner' && mod && !canTab(actor, mod)) return { ok: false, msg: `${a.name}: no access to that tab` };
    if (st.restore && (a.publish || a.audio)) return { ok: false, skipped: true, msg: `${a.name}: skipped, everything is hidden right now` };
    const lk = mod ? lockOf(st, mod) : null;
    if (lk && (o.automation ? !lk.auto : actor.role !== 'owner')) return { ok: false, msg: `${a.name}: locked (${lk.reason || 'by the owner'})` };
    if (o.dry) return { ok: true, dry: true, msg: `Would: ${a.name}` };
    const err = a.run(st, s, actor.name, o.depth || 0);
    if (typeof err === 'string' && err) return { ok: false, msg: `${a.name}: ${err}` };
    if (mod) changed(st, mod);
    return { ok: true, msg: a.name };
  }

  /* ---------- Quick action buttons ---------- */
  const recent = new Map(); // a double tap or a retry with the same id runs once
  function runButton(st, id, actor, nonce, confirmed) {
    const b = ops(st).buttons.find((x) => x.id === id);
    if (!b) return { ok: false, steps: [], note: 'That button has gone.' };
    if (b.confirm && !confirmed) return { ok: false, steps: [], confirm: true, note: 'This button needs a second tap.' };
    const k = `${st.id}:${nonce}`;
    if (nonce && recent.has(k)) return Object.assign({ repeat: true }, recent.get(k));
    const steps = [];
    for (const s of b.steps) { const r = runStep(st, s, actor, { depth: 0 }); steps.push(r); if (!r.ok && !r.skipped) break; } // stop on the first failure
    const res = { ok: steps.every((x) => x.ok || x.skipped), steps };
    if (nonce) { recent.set(k, res); setTimeout(() => recent.delete(k), 120000); }
    logActivity(st, actor.name, `Quick action “${b.name}”${res.ok ? '' : ' stopped part way'}`);
    saveSoon();
    return res;
  }

  /* ---------- Automations ---------- */
  const londonHM = () => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
  function matches(r, ev) {
    const t = r.trigger;
    if (t.type !== ev.kind) return false;
    if (t.min && num(ev.amount) < t.min) return false;
    if (t.tier && ev.tier && String(ev.tier) !== t.tier) return false;
    if (t.reward && ev.reward !== t.reward) return false;
    if (t.name && ev.name && ev.name !== t.name) return false;
    return true;
  }
  function condOk(st, c) {
    const s = st.modules.subathon;
    const going = !!s && ['running', 'paused', 'grace'].includes(s.timer.state);
    switch (c.type) {
      case 'subathon-running': return going;
      case 'subathon-stopped': return !going;
      case 'mode': return !!s && s.mode === c.value;
      case 'live': return !!(st.modules.twitch && st.modules.twitch.dash.live);
      case 'not-hidden': return !st.restore;
      default: return true;
    }
  }
  function record(st, r, ev, steps, note, dry) {
    const out = { ok: !note && steps.every((x) => x.ok || x.skipped), note, steps };
    if (dry) return out;
    const o = ops(st);
    o.runs.unshift({ id: rid(), at: now(), rule: r.id, name: r.name, ver: r.ver, trigger: `${ev.kind}${ev.amount ? ` ${ev.amount}` : ''}${ev.user ? ` from ${ev.user}` : ''}`, note, steps: steps.map((x) => ({ ok: !!x.ok, skipped: !!x.skipped, msg: str(x.msg, 120) })) });
    o.runs = o.runs.slice(0, 100);
    return out;
  }
  function runRule(st, r, ev, depth, dry) {
    const o = ops(st);
    if (!dry) {
      const key = `${r.id}:${ev.id}`;
      if (o.seen.includes(key)) return { ok: false, note: 'already ran for this event', steps: [] };
      o.seen.push(key);
      if (o.seen.length > 2000) o.seen.splice(0, o.seen.length - 2000);
    }
    const checks = r.conds.map((c) => condOk(st, c));
    if (r.conds.length && !(r.any ? checks.some(Boolean) : checks.every(Boolean))) return record(st, r, ev, [], 'its conditions weren’t met', dry);
    if (r.from && r.to) { const hm = londonHM(); const inside = r.from <= r.to ? hm >= r.from && hm < r.to : hm >= r.from || hm < r.to; if (!inside) return record(st, r, ev, [], `outside its ${r.from} to ${r.to} window`, dry); }
    if (!dry && r.cool && now() - r.last < r.cool * 1000) return record(st, r, ev, [], 'cooling down', dry);
    const today = new Date().toISOString().slice(0, 10);
    if (!dry && r.day !== today) { r.day = today; r.runs = 0; }
    if (!dry && r.max && r.runs >= r.max) return record(st, r, ev, [], 'it reached its limit for today', dry);
    const steps = r.steps.map((s) => runStep(st, s, { role: 'owner', name: `Automation “${r.name}”` }, { automation: true, dry, depth }));
    if (!dry) {
      r.runs += 1;
      r.last = now();
      if (r.once) r.on = false;
      if (steps.some((x) => !x.ok && !x.skipped)) { r.errors += 1; if (r.errors >= 5) { r.on = false; notify(st, `Automation “${r.name}” switched itself off after 5 failures in a row.`); } } else r.errors = 0;
    }
    return record(st, r, ev, steps, '', dry);
  }
  // An event from Twitch or the hub. Actions run by automations never trigger more automations (no loops)
  function onEvent(st, ev, depth = 0) {
    if (depth > 0 || !st.ops) return;
    const o = ops(st);
    o.rate = (o.rate || []).filter((t) => now() - t < 60000);
    let any = false;
    for (const r of o.rules) {
      if (!r.on || !matches(r, ev)) continue;
      if (o.rate.length >= 30) { r.on = false; notify(st, `Automation “${r.name}” was switched off: more than 30 automations ran in a minute.`); continue; }
      o.rate.push(now());
      runRule(st, r, ev, depth + 1, false);
      any = true;
    }
    if (any) { saveSoon(); changedOps(st); }
  }
  const changedOps = (st) => { if (ctx.opsChanged) ctx.opsChanged(st); };

  /* ---------- Test mode: pretend events, nothing real changes ---------- */
  function simulate(st, raw, actor) {
    const kind = TRIGGERS.includes(raw.kind) ? raw.kind : 'sub';
    const ev = { kind, id: `test-${rid()}`, user: str(raw.user, 30) || 'Test viewer', tier: ['1000', '2000', '3000'].includes(String(raw.tier)) ? String(raw.tier) : '1000', prime: raw.prime === true,
      amount: Math.max(0, num(raw.amount, kind === 'gift' ? 5 : kind === 'bits' ? 500 : kind === 'raid' ? 25 : 1)), qty: 1, reward: str(raw.reward, 45), name: str(raw.name, 60), test: true };
    const report = { event: ev, subathon: null, alert: null, automations: [], note: 'Nothing real changed: live totals, Twitch and the OBS page were not touched.' };
    const s0 = st.modules.subathon;
    if (s0 && ['sub', 'resub', 'gift', 'bits', 'follow'].includes(kind)) {
      const copy = clone(s0);
      const t = now();
      const e = Sub.apply(copy, ev, 'auto', t);
      report.subathon = { running: ['running', 'paused', 'grace'].includes(s0.timer.state), added: e ? e.secs : 0, before: Math.round(Extras.subLeft(s0.timer, t)), after: Math.round(Extras.subLeft(copy.timer, t)),
        goals: copy.goals.map((g, i) => ({ name: g.name, before: s0.goals[i].cur, after: g.cur, target: g.target })).filter((g) => g.before !== g.after),
        milestones: copy.milestones.filter((m, i) => m.s !== s0.milestones[i].s).map((m) => m.name), spins: copy.spins.owed - s0.spins.owed };
    }
    const al = st.modules.twitch && st.modules.twitch.alerts;
    if (al && Extras.TW_ALERTS.includes(kind)) {
      report.alert = !al.on[kind] ? 'Alerts for this are switched off.' : kind === 'bits' && ev.amount < al.minBits ? `Below the ${al.minBits} bits minimum, so no alert.` : al.vis === 'off' ? 'It would queue, but Alerts are set to Off.' : 'It would show (a test copy is in your preview only).';
      if (al.on[kind] && testAlert) testAlert(st, ev);
    }
    report.automations = ops(st).rules.filter((r) => matches(r, ev)).map((r) => Object.assign({ name: r.name, on: r.on }, runRule(st, r, ev, 1, true)));
    const list = (tests.get(st.id) || []);
    list.unshift({ at: now(), kind, by: actor.name });
    tests.set(st.id, list.slice(0, 20));
    logActivity(st, actor.name, `Test mode: a pretend ${kind}`);
    return report;
  }

  /* ---------- Stream Desk running order: the timing lives here ---------- */
  function pubOf(rd) {
    const s = rd.session;
    const list = s.on ? rd.lists.find((l) => l.id === s.list) : null;
    const seg = list && list.segs[s.i];
    if (!seg) return { on: false, now: '', next: '', mins: 0, segStart: 0, paused: 0, pausedMs: 0 };
    const nx = list.segs[s.i + 1];
    return { on: true, now: seg.title, next: nx ? nx.title : '', mins: seg.mins, segStart: s.segStart, paused: s.paused, pausedMs: s.pausedMs };
  }
  function roAct(st, a, b, who, depth = 0) {
    const rd = st.modules.desk.rundown;
    const t = now();
    const s = rd.session;
    const listOf = (id) => rd.lists.find((l) => l.id === id);
    const L = listOf(s.on ? s.list : (b.list || rd.cur));
    const segAt = (id) => (L ? L.segs.findIndex((x) => x.id === id) : -1);
    const logCur = (extra) => { const seg = L && L.segs[s.i]; if (seg) s.log.push(Object.assign({ title: seg.title, planned: seg.mins, start: s.segStart, end: t, skipped: false }, extra)); };
    const startSeg = (i) => { s.i = i; s.segStart = t; s.paused = 0; s.pausedMs = 0; const seg = L.segs[i]; if (seg) setImmediate(() => onEvent(st, { kind: 'segment', name: seg.title, id: `seg:${s.start}:${i}:${seg.id}` }, depth)); };
    const finish = () => { rd.past.unshift({ name: L ? L.name : 'Running order', start: s.start, end: t, log: s.log.slice(0, 80) }); rd.past = rd.past.slice(0, 20); rd.session = { on: false }; logActivity(st, who, 'Running order finished'); };
    const live = s.on && L && s.list === L.id;
    switch (a) {
      case 'new-list': { const l = { id: rid(), name: str(b.name, 50) || 'Running order', segs: [] }; rd.lists.push(l); rd.cur = l.id; break; }
      case 'pick': if (s.on) return 'Finish the running order first.'; if (!listOf(b.id)) return 'That running order has gone.'; rd.cur = b.id; break;
      case 'rename-list': if (!L) return 'Pick a running order.'; L.name = str(b.name, 50) || L.name; break;
      case 'dup-list': { if (!L) return 'Pick a running order.'; const c = clone(L); c.id = rid(); c.name = `${L.name} copy`.slice(0, 50); c.segs.forEach((x) => { x.id = rid(); x.checks.forEach((k) => { k.done = false; }); }); rd.lists.push(c); rd.cur = c.id; break; }
      case 'del-list': if (!L) return 'Pick a running order.'; if (live) return 'You can’t delete the running order that’s live.'; rd.lists = rd.lists.filter((l) => l !== L); rd.cur = rd.lists[0] ? rd.lists[0].id : ''; break;
      case 'add-seg': {
        if (!L) return 'Make a running order first.';
        if (L.segs.length >= 40) return 'A running order can have 40 segments.';
        const seg = Extras.rundownNormalize({ lists: [{ segs: [{ title: b.title, mins: b.mins, kind: b.kind, at: b.at }] }] }).lists[0].segs[0];
        const at = live ? Math.max(s.i + 1, Math.min(L.segs.length, num(b.pos, L.segs.length))) : Math.min(L.segs.length, num(b.pos, L.segs.length));
        L.segs.splice(at, 0, seg);
        break;
      }
      case 'edit-seg': {
        const i = segAt(b.id); if (i < 0) return 'That segment has gone.';
        const seg = L.segs[i];
        ['title', 'desc', 'note', 'who'].forEach((k) => { if (k in b) seg[k] = str(b[k], k === 'note' ? 400 : k === 'desc' ? 200 : 60); });
        if ('mins' in b) seg.mins = Math.max(0, Math.min(1440, num(b.mins)));
        if ('at' in b) seg.at = /^\d\d:\d\d$/.test(b.at) ? b.at : '';
        if ('kind' in b) seg.kind = b.kind === 'break' ? 'break' : 'seg';
        if ('check' in b) { const k = seg.checks[num(b.check)]; if (k) k.done = !k.done; }
        if ('addCheck' in b && seg.checks.length < 12) seg.checks.push({ t: str(b.addCheck, 80), done: false });
        break;
      }
      case 'move-seg': {
        const i = segAt(b.id); const j = i + (b.dir === 'up' ? -1 : 1);
        if (i < 0 || j < 0 || j >= L.segs.length) return '';
        if (live && (i <= s.i || j <= s.i)) return 'Only upcoming segments can move while it’s live.';
        [L.segs[i], L.segs[j]] = [L.segs[j], L.segs[i]];
        break;
      }
      case 'del-seg': { const i = segAt(b.id); if (i < 0) return ''; if (live && i <= s.i) return 'Only upcoming segments can be removed while it’s live.'; L.segs.splice(i, 1); break; }
      case 'start':
        if (s.on) return 'It’s already running.';
        if (!L || !L.segs.length) return 'Add some segments first.';
        rd.session = { on: true, list: L.id, i: 0, start: t, segStart: t, paused: 0, pausedMs: 0, log: [] };
        rd.pub = pubOf(rd);
        logActivity(st, who, `Running order “${L.name}” started`);
        setImmediate(() => onEvent(st, { kind: 'segment', name: L.segs[0].title, id: `seg:${t}:0:${L.segs[0].id}` }, depth));
        return '';
      case 'pause': if (!s.on || s.paused) return ''; s.paused = t; break;
      case 'resume': if (!s.on || !s.paused) return ''; s.pausedMs += t - s.paused; s.paused = 0; break;
      case 'next': case 'skip':
        if (!s.on) return 'Start the running order first.';
        if (s.paused) { s.pausedMs += t - s.paused; s.paused = 0; }
        logCur(a === 'skip' ? { skipped: true } : {});
        if (s.i + 1 >= L.segs.length) finish(); else startSeg(s.i + 1);
        break;
      case 'back': if (!s.on || s.i === 0) return ''; logCur(); startSeg(s.i - 1); break;
      case 'break': {
        if (!s.on) return 'Start the running order first.';
        logCur();
        L.segs.splice(s.i + 1, 0, Extras.rundownNormalize({ lists: [{ segs: [{ title: 'Break', mins: Math.max(1, num(b.mins, 5)), kind: 'break' }] }] }).lists[0].segs[0]);
        startSeg(s.i + 1);
        break;
      }
      case 'end': if (!s.on) return ''; logCur(); finish(); break;
      case 'look': ['x', 'y', 'scale'].forEach((k) => { if (k in b) rd.look[k] = num(b[k], rd.look[k]); }); if ('color' in b && /^#[0-9a-f]{6}$/i.test(b.color)) rd.look.color = b.color; if (['off', 'preview', 'live'].includes(b.vis)) rd.look.vis = b.vis; break;
      default: return 'Unknown running order action.';
    }
    rd.pub = pubOf(rd);
    return '';
  }

  /* ---------- Locks ---------- */
  function lockOf(st, mod) {
    const o = ops(st);
    const t = now();
    const before = o.locks.length;
    o.locks = o.locks.filter((l) => !l.until || l.until > t);
    if (o.locks.length !== before) saveSoon();
    return o.locks.find((l) => l.mod === mod || l.mod === 'all') || null;
  }

  /* ---------- Presets, profiles and version history (configuration only) ---------- */
  function strip(id, m) {
    const c = clone(m);
    ['v', 'onAir', 'rev', 'writer'].forEach((k) => delete c[k]);
    (RUNTIME[id] || []).forEach((k) => delete c[k]);
    if (id === 'twitch' && c.alerts) ['cur', 'queue', 'hist'].forEach((k) => delete c.alerts[k]);
    if (id === 'desk' && c.rundown) ['session', 'past', 'pub'].forEach((k) => delete c.rundown[k]);
    return c;
  }
  function mergeInto(prev, snap, mode, rep) {
    Object.keys(snap).forEach((k) => {
      const pv = prev[k], sv = snap[k];
      if (Array.isArray(sv) && sv.length && sv.every((x) => x && typeof x === 'object' && x.id)) {
        const out = [];
        sv.forEach((item) => {
          const old = Array.isArray(pv) ? pv.find((x) => x && x.id === item.id) : null;
          if (old) { const m = Object.assign({}, old, clone(item)); KEEP_ITEM.forEach((f) => { if (f in old) m[f] = old[f]; }); out.push(m); rep.changed += JSON.stringify(old) === JSON.stringify(m) ? 0 : 1; }
          else { const m = clone(item); if ('vis' in m) m.vis = 'off'; if (typeof m.on === 'boolean') m.on = false; out.push(m); rep.added += 1; }
        });
        (Array.isArray(pv) ? pv : []).forEach((old) => {
          if (!old || !old.id || sv.some((x) => x.id === old.id)) return;
          if (mode === 'replace' && old.vis !== 'live') { rep.removed += 1; return; }
          if (mode === 'replace') rep.kept += 1;
          out.push(old);
        });
        prev[k] = out;
      } else if (sv && typeof sv === 'object' && !Array.isArray(sv) && 'vis' in sv) {
        const before = JSON.stringify(pv);
        prev[k] = Object.assign({}, pv || {});
        LOOK.forEach((f) => { if (f in sv) prev[k][f] = clone(sv[f]); });
        if (before !== JSON.stringify(prev[k])) rep.changed += 1;
      } else if (sv && typeof sv === 'object' && !Array.isArray(sv) && pv && typeof pv === 'object' && !Array.isArray(pv)) {
        mergeInto(pv, sv, mode, rep);
      } else if (JSON.stringify(pv) !== JSON.stringify(sv)) {
        prev[k] = clone(sv);
        rep.changed += 1;
      }
    });
    return prev;
  }
  // Works out (and optionally applies) one tab's configuration, keeping live values and what's on screen as they are
  function applyModule(st, id, snap, mode, commit) {
    const def = MODULES[id];
    const rep = { mod: id, added: 0, removed: 0, changed: 0, kept: 0 };
    if (!def || !st.modules[id] || !VERSIONED.includes(id)) return rep;
    const prev = st.modules[id];
    const next = def.normalize(mergeInto(clone(prev), clone(snap), mode, rep));
    def.keep(prev, next);
    if (id === 'media') { next.music = prev.music; next.fire = prev.fire; next.stopSeq = prev.stopSeq; next.hist = prev.hist; }
    if (id === 'desk') { next.rundown.session = prev.rundown.session; next.rundown.past = prev.rundown.past; next.rundown.pub = prev.rundown.pub; }
    if (commit) { next.rev = prev.rev + 1; st.modules[id] = next; changed(st, id); }
    return rep;
  }
  const versionTimers = new Map();
  // A meaningful change: saved as a version at most once every 15 seconds per tab (drags and sliders become one version)
  function noteChange(st, id, who) {
    if (!VERSIONED.includes(id)) return;
    const k = `${st.id}:${id}`;
    clearTimeout(versionTimers.get(k));
    versionTimers.set(k, setTimeout(() => { versionTimers.delete(k); addVersion(st, id, who, ''); }, 15000));
  }
  function addVersion(st, id, who, name) {
    const b = bag(st);
    const mods = id === '*' ? VERSIONED.filter((m) => st.modules[m]) : [id];
    const data = {};
    mods.forEach((m) => { data[m] = strip(m, st.modules[m]); });
    const text = JSON.stringify(data);
    if (text.length > 250000) return null; // too big to keep a copy of
    const last = b.versions.find((v) => v.mod === id && !v.name);
    if (!name && last && JSON.stringify(last.data) === text) return null; // nothing actually changed
    const v = { id: rid(), at: now(), by: str(who, 40), mod: id, name: str(name, 50), data };
    b.versions.unshift(v);
    // Bounded: the newest 40 automatic versions and up to 15 named checkpoints per streamer
    let autos = 0, named = 0;
    b.versions = b.versions.filter((x) => (x.name ? (named += 1) <= 15 : (autos += 1) <= 40));
    saveStore();
    return v;
  }
  function restoreVersion(st, id, who, commit) {
    const v = bag(st).versions.find((x) => x.id === id);
    if (!v) return { error: 'That version has gone.' };
    const reps = Object.entries(v.data).map(([m, snap]) => applyModule(st, m, snap, 'replace', commit));
    if (commit) { Object.keys(v.data).forEach((m) => addVersion(st, m, who, `Restored from ${new Date(v.at).toISOString().slice(0, 16).replace('T', ' ')}`)); logActivity(st, who, `Restored settings from a saved version (${Object.keys(v.data).join(', ')})`); }
    return { reps };
  }
  function saveConfig(st, b, who) {
    const bg = bag(st);
    if (bg.configs.length >= 20) return { error: 'You can keep 20 presets and profiles. Delete one first.' };
    const kind = b.kind === 'profile' ? 'profile' : 'preset';
    const mods = kind === 'profile' ? VERSIONED.filter((m) => st.modules[m]) : (Array.isArray(b.mods) ? b.mods : []).filter((m) => VERSIONED.includes(m) && st.modules[m]);
    if (!mods.length) return { error: 'Choose at least one tab.' };
    const data = {};
    mods.forEach((m) => { data[m] = strip(m, st.modules[m]); });
    const c = { id: rid(), name: str(b.name, 50) || (kind === 'profile' ? 'Stream profile' : 'Overlay preset'), desc: str(b.desc, 200), kind, fav: false, at: now(), by: str(who, 40), data,
      ops: kind === 'profile' ? { buttons: clone(ops(st).buttons), rules: clone(ops(st).rules).map((r) => Object.assign(r, { on: false, runs: 0, errors: 0 })) } : null };
    bg.configs.unshift(c);
    saveStore();
    logActivity(st, who, `Saved the ${kind} “${c.name}”`);
    return { config: c };
  }
  function applyConfig(st, id, mode, who, commit) {
    const c = bag(st).configs.find((x) => x.id === id);
    if (!c) return { error: 'That preset or profile has gone.' };
    if (commit) addVersion(st, '*', who, `Before loading “${c.name}”`);
    const reps = Object.entries(c.data).map(([m, snap]) => applyModule(st, m, snap, mode === 'replace' ? 'replace' : 'merge', commit));
    let rules = 0;
    if (c.ops) {
      const o = ops(st);
      c.ops.buttons.forEach((b) => { if (!o.buttons.some((x) => x.id === b.id) && o.buttons.length < 30) { if (commit) o.buttons.push(clone(b)); rules += 0; } });
      c.ops.rules.forEach((r) => { if (!o.rules.some((x) => x.id === r.id) && o.rules.length < 40) { if (commit) o.rules.push(Object.assign(clone(r), { on: false })); rules += 1; } });
    }
    if (commit) { saveSoon(); changedOps(st); logActivity(st, who, `Loaded the ${c.kind} “${c.name}” (${mode === 'replace' ? 'replace' : 'merge'})`); }
    return { reps, rules };
  }
  // Export: settings only, no keys, links, passwords or live values; import: checked, and every automation arrives Off
  function exportConfig(st, id) {
    const c = bag(st).configs.find((x) => x.id === id);
    return c ? { overlayHub: 1, kind: c.kind, name: c.name, desc: c.desc, data: c.data, ops: c.ops } : null;
  }
  function importConfig(st, raw, who) {
    if (!raw || raw.overlayHub !== 1 || typeof raw.data !== 'object') return { error: 'That isn’t an Overlay Hub preset or profile file.' };
    const data = {};
    Object.entries(raw.data).forEach(([m, snap]) => { if (VERSIONED.includes(m) && snap && typeof snap === 'object') data[m] = strip(m, MODULES[m].normalize(snap)); });
    const media = new Set((st.media || []).map((f) => f.id));
    const missing = new Set();
    JSON.stringify(data).replace(/"(?:src|media|sound|ids)":\s*(\[[^\]]*\]|"[a-z0-9_-]{6,16}")/gi, (m0, v) => { (v.match(/[a-z0-9_-]{6,16}/gi) || []).forEach((x) => { if (!media.has(x)) missing.add(x); }); return m0; });
    const bg = bag(st);
    if (bg.configs.length >= 20) return { error: 'You can keep 20 presets and profiles. Delete one first.' };
    const o = raw.ops && typeof raw.ops === 'object' ? normOps(raw.ops) : null;
    if (o) o.rules.forEach((r) => { r.on = false; r.runs = 0; r.errors = 0; });
    const c = { id: rid(), name: str(raw.name, 50) || 'Imported', desc: str(raw.desc, 200), kind: raw.kind === 'profile' ? 'profile' : 'preset', fav: false, at: now(), by: str(who, 40), data, ops: o ? { buttons: o.buttons, rules: o.rules } : null };
    bg.configs.unshift(c);
    saveStore();
    return { config: c, missing: missing.size };
  }

  return {
    normOps, ops, targets, ACTION_LIST, runButton, runStep, onEvent, runRule, simulate, roAct, pubOf, lockOf, noteChange, addVersion, restoreVersion, saveConfig, applyConfig, exportConfig, importConfig,
    bag, saveStore, tests, VERSIONED, size: () => { try { return fs.statSync(FILE).size; } catch (e) { return 0; } },
  };
}
module.exports = { createOps, normOps, TRIGGERS, CONDS };
