/*
  Subathon & Goals in the hub. The server does all the counting and timing; these buttons ask it to.
  Manual changes are always recorded separately from Twitch events, and anything big or destructive asks for a
  second tap.
*/
(() => {
  'use strict';
  const Hub = window.Hub;
  const X = window.ExtrasModel;
  const V = window.SubathonOverlay;
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const PRESETS = [['', 'Move to…'], ['240,150', 'Top left'], ['960,150', 'Top'], ['1680,150', 'Top right'], ['240,540', 'Left'], ['960,540', 'Centre'], ['1680,540', 'Right'], ['240,930', 'Bottom left'], ['960,930', 'Bottom'], ['1680,930', 'Bottom right']];
  const RULE_NAME = { t1: ['Tier 1 sub', 'per sub'], t2: ['Tier 2 sub', 'per sub'], t3: ['Tier 3 sub', 'per sub'], prime: ['Prime sub', 'per sub (Twitch often reports Prime as Tier 1)'], gift: ['Gifted sub', 'per gifted sub'], resub: ['Resub (shared)', 'per resub message'], bits: ['Bits', 'per 100 bits'], follow: ['Follow', 'per follow'], donation: ['Donation (by hand)', 'per £1'], custom: ['Custom', 'per unit'] };
  const SRC_NAME = { subs: 'Subs (incl. gifts and resubs)', points: 'Sub points', gifts: 'Gifted subs', bits: 'Bits', follows: 'Follows', money: 'Donations (by hand)', custom: 'Custom' };
  let live = null;
  let twitchState = '';
  const armed = {};
  const histView = { f: 'all', q: '' };
  const cards = document.getElementById('sbCards');
  const openCards = new Set(JSON.parse(localStorage.getItem('sb-open') || '["timer","manual"]'));
  cards.addEventListener('toggle', (e) => { const k = e.target.dataset && e.target.dataset.id; if (!k) return; if (e.target.open) openCards.add(k); else openCards.delete(k); localStorage.setItem('sb-open', JSON.stringify(Array.from(openCards))); }, true);

  const parts = (s) => [['timer', s.timer], ['milestones', s.mlook], ['spins', s.spins], ['board', s.blook]].concat(s.goals.map((g) => [`goal:${g.id}`, g]));
  const ctl = Hub.module('subathon', {
    patchable: ['timer', 'sleep', 'rules', 'bonus', 'goals', 'milestones', 'mlook', 'spins', 'blook'],
    onState(s) { live = s; paint(); },
    isShowing: (s) => parts(s).some(([, x]) => x.vis === 'live'),
    liveCount: (s) => parts(s).filter(([, x]) => x.vis === 'live').length,
    tileSummary(s) {
      const t = s.timer;
      return { text: t.state === 'running' || t.state === 'paused' ? `${V.hms(X.subLeft(t, Date.now()))} left` : t.state === 'ended' ? 'Subathon ended' : 'No subathon running', small: `${s.counts.subs} subs, ${s.counts.bits} bits this session` };
    },
    onDrag(id, x, y) { const it = item(id); if (it) { it.x = x; it.y = y; ctl.commit(); } },
    visItems: (s) => parts(s),
  });
  const commit = () => ctl.commit();
  const redraw = () => { cards._html = ''; paint(); };
  const arm = (k) => { if (Date.now() - (armed[k] || 0) < 4000) { delete armed[k]; return true; } armed[k] = Date.now(); redraw(); setTimeout(redraw, 4100); return false; };
  const armedText = (k, t) => (Date.now() - (armed[k] || 0) < 4000 ? 'Tap again' : t);
  const item = (key) => (key === 'timer' ? live.timer : key === 'milestones' ? live.mlook : key === 'spins' ? live.spins : key === 'board' ? live.blook : key && key.startsWith('goal:') ? live.goals.find((g) => `goal:${g.id}` === key) : null);
  const btn = (act, label, extra = '', cls = '') => `<button type="button" class="btn btn-small ${cls}" data-sb="${act}" ${extra}>${label}</button>`;
  const toggle = (act, on, label) => `<button type="button" class="btn btn-small ch-tog" data-sb="${act}" aria-pressed="${!!on}">${label}: ${on ? 'On' : 'Off'}</button>`;
  const numIn = (path, v, attrs = '') => `<input class="input ch-num" type="number" data-sb-in="${path}" value="${v}" ${attrs}>`;
  const look = (key) => { const it = item(key); return `${Hub.visButtons(it.vis, ` data-key="${key}"`)}<div class="dk-look"><label class="dk-inline dk-size">Size <input type="range" min="30" max="250" step="5" data-sb-in="scale" data-key="${key}" value="${Math.round(it.scale * 100)}"${it.lock ? ' disabled' : ''}></label><button type="button" class="btn btn-small lock-btn" data-sb="lock" data-key="${key}" aria-pressed="${!!it.lock}">${it.lock ? 'Locked' : 'Lock position'}</button><select class="select preset" data-sb-in="preset" data-key="${key}"${it.lock ? ' disabled' : ''}>${PRESETS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select><input type="color" data-sb-in="colour" data-key="${key}" value="${it.color}" aria-label="Colour"></div>`; };
  async function act(action, extra) {
    try { await Hub.call('POST', `/api/streamers/${Hub.streamer.id}/subathon`, Object.assign({ action }, extra || {})); return true; } catch (err) { Hub.toast(err.message || 'That didn’t work.', { tone: 'bad' }); return false; }
  }

  /* ---------- Sections ---------- */
  function timerCard() {
    const t = live.timer;
    const going = t.state === 'running' || t.state === 'paused' || t.state === 'grace';
    const state = { idle: 'Not started', running: 'Running', paused: 'Paused', grace: 'Grace period: any contribution restarts it', ended: 'Ended' }[t.state];
    return `<div class="sb-readout"><b data-sb-left>${V.hms(X.subLeft(t, Date.now()))}</b><small>${state}${t.added ? `. ${Math.round(t.added / 60)} min added so far` : ''}${live.bonus.until > Date.now() ? `. Bonus ×${live.bonus.mult} running` : ''}</small></div>
      ${going ? `<div class="btn-row">${t.state === 'running' ? btn('pause', '⏸ Pause', '', 'btn-primary') : t.state === 'paused' ? btn('resume', '▶ Resume', '', 'btn-primary') : ''}${btn('end', armedText('end', 'End the subathon'), '', 'btn-quiet')}</div>
        <div class="btn-row">${[1, 5, 10, 30].map((m) => btn('time', `+${m} min`, `data-val="${m * 60}"`)).join('')}${[-1, -5].map((m) => btn('time', `${m} min`, `data-val="${m * 60}"`)).join('')}<input class="input ch-num" type="number" id="sbCustomMin" placeholder="min" aria-label="Minutes">${btn('time-custom', 'Add or remove')}</div>`
      : `<div class="btn-row"><label class="dk-inline">Start with ${numIn('h', Math.floor(t.first / 3600) || 1, 'id="sbH" min="0" max="999"')} h ${numIn('m', Math.floor((t.first % 3600) / 60), 'id="sbM" min="0" max="59"')} min</label>${btn('start', '▶ Start the subathon', '', 'btn-primary')}</div>`}
      ${t.state !== 'idle' ? `<div class="btn-row">${btn('reset', armedText('reset', 'Reset everything'), '', 'btn-quiet')}</div>` : ''}
      <div class="ch-grid4"><label class="field"><span class="field-label">Title</span><input class="input" data-sb-in="timer.title" value="${esc(t.title)}" maxlength="40"></label><label class="field"><span class="field-label">Longest (hours, 0 = none)</span>${numIn('timer.maxH', Math.round(t.max / 360) / 10, 'min="0" step="0.5"')}</label><label class="field"><span class="field-label">Shortest (hours)</span>${numIn('timer.minH', Math.round(t.min / 360) / 10, 'min="0" step="0.5"')}</label><label class="field"><span class="field-label">Grace at zero (s)</span>${numIn('timer.grace', t.grace, 'min="0" max="3600"')}</label></div>
      <div class="btn-row">${toggle('auto-end', t.autoEnd, 'End by itself at zero')}</div>${look('timer')}`;
  }
  function modeCard() {
    const sl = live.sleep;
    return `<div class="seg" role="group">${['normal', 'sleep', 'break'].map((m) => `<button type="button" data-sb="mode" data-val="${m}" aria-pressed="${live.mode === m}">${{ normal: 'Normal', sleep: 'Sleep', break: 'Break' }[m]}</button>`).join('')}</div>
      <p class="note">Now: <b>${{ normal: 'Normal', sleep: 'Sleep mode', break: 'Break mode' }[live.mode]}</b>${live.queued ? `. ${Math.round(live.queued / 60)} min queued for when you’re back` : ''}.</p>
      <p class="note">During sleep or break:</p><div class="btn-row">${toggle('sl-pause', sl.pause, 'Pause the countdown')}${toggle('sl-collect', sl.collect, 'Contributions still add time')}${toggle('sl-queue', sl.queue, 'Queue the time until back')}</div>
      <label class="dk-inline">Time multiplier ${numIn('sleep.mult', sl.mult, 'min="0" max="10" step="0.25"')}</label>`;
  }
  function rulesCard() {
    return `<div class="sb-rules">${X.SB_RULES.map((k) => { const r = live.rules[k]; return `<div class="sb-rule"><b>${RULE_NAME[k][0]}</b><small>${RULE_NAME[k][1]}</small>
      <button type="button" class="btn btn-small ch-tog" data-sb="rule-on" data-val="${k}" aria-pressed="${r.on}">${r.on ? 'On' : 'Off'}</button>
      <label>Minutes ${numIn(`rules.${k}.min`, Math.round(r.secs / 6) / 10, 'min="0" step="0.5"')}</label><label>Progress ${numIn(`rules.${k}.prog`, r.prog, 'min="0" step="0.5"')}</label>
      <label>Most per go (min) ${numIn(`rules.${k}.maxMin`, Math.round(r.max / 6) / 10, 'min="0" step="1"')}</label><label>× ${numIn(`rules.${k}.mult`, r.mult, 'min="0" max="100" step="0.25"')}</label></div>`; }).join('')}</div>
      <p class="note">Each contribution is counted once. Twitch doesn't report every renewal, and often reports Prime as Tier 1, so use Add by hand for anything it misses.</p>`;
  }
  function manualCard() {
    return `<div class="btn-row"><select class="select" id="sbTier"><option value="1000">Tier 1</option><option value="2000">Tier 2</option><option value="3000">Tier 3</option><option value="prime">Prime</option></select>${[1, 5, 10, 50].map((n) => btn('add-subs', `+${n} sub${n > 1 ? 's' : ''}`, `data-val="${n}"`, n === 1 ? 'btn-primary' : '')).join('')}<input class="input ch-num" type="number" id="sbSubN" min="1" placeholder="Any">${btn('add-subs-n', 'Add')}</div>
      <div class="ch-add"><input class="input" id="sbWho" maxlength="40" placeholder="Name (optional)"><input class="input ch-num" type="number" id="sbAmt" min="0" step="0.01" placeholder="Amount"><select class="select" id="sbKind"><option value="gift">Gifted subs</option><option value="bits">Bits</option><option value="donation">Donation (£)</option><option value="follow">Follows</option><option value="custom">Custom</option></select>${btn('add-other', 'Add', '', 'btn-primary')}</div>
      <p class="note">Everything added here is marked as added by hand in the history, and can be undone there.</p>`;
  }
  function goalsCard() {
    return live.goals.map((g) => { const key = `goal:${g.id}`; const p = Math.round((g.cur / g.target) * 100); return `<details class="md-sub" data-id="${key}"${openCards.has(key) ? ' open' : ''}><summary><b>${esc(g.name)}</b> <small>${Math.round(g.cur * 100) / 100} of ${g.target} (${p}%)</small></summary>
      <div class="ch-grid4"><label class="field"><span class="field-label">Name</span><input class="input" data-sb-in="g.name" data-key="${key}" value="${esc(g.name)}" maxlength="40"></label><label class="field"><span class="field-label">Counts</span><select class="select" data-sb-in="g.src" data-key="${key}">${X.SB_SOURCES.map((x) => `<option value="${x}"${x === g.src ? ' selected' : ''}>${SRC_NAME[x]}</option>`).join('')}</select></label><label class="field"><span class="field-label">Target</span>${numIn('g.target', g.target, `data-key="${key}" min="1"`)}</label><label class="field"><span class="field-label">Starts at</span>${numIn('g.start', g.start, `data-key="${key}"`)}</label></div>
      <div class="btn-row"><label class="dk-inline">Correct the total ${numIn('g.cur', Math.round(g.cur * 100) / 100, `data-key="${key}" id="sbFix-${g.id}"`)}</label>${btn('goal-fix', 'Save correction', `data-key="${key}"`)}${btn('goal-reset', armedText(`gr${g.id}`, 'Reset'), `data-key="${key}"`)}${btn('goal-del', armedText(`gd${g.id}`, 'Delete'), `data-key="${key}"`, 'btn-quiet')}</div>${look(key)}</details>`; }).join('')
      + `<div class="ch-add"><input class="input" id="sbGoalName" maxlength="40" placeholder="New goal, like 100 subs"><select class="select" id="sbGoalSrc">${X.SB_SOURCES.map((x) => `<option value="${x}">${SRC_NAME[x]}</option>`).join('')}</select><input class="input ch-num" type="number" id="sbGoalTarget" min="1" placeholder="Target">${btn('goal-add', 'Add goal', '', 'btn-primary')}</div>`;
  }
  function milestonesCard() {
    return `<div class="ch-rows">${live.milestones.map((m, k) => `<div class="ch-row" data-k="${k}"><span class="ch-led"><b>${esc(m.name)}</b> <small class="ch-small">${m.target} ${SRC_NAME[m.src].toLowerCase()}${m.reward ? `: ${esc(m.reward)}` : ''}${m.rep ? ', repeats' : ''}${m.auto ? '' : ', unlocked by hand'}</small></span><span class="pill">${{ locked: 'Locked', unlocked: 'Unlocked', done: 'Done', skipped: 'Skipped' }[m.s]}</span>${m.s === 'locked' ? btn('ms', 'Unlock', 'data-val="unlocked"') : ''}${m.s === 'unlocked' ? btn('ms', 'Done', 'data-val="done"', 'btn-primary') : ''}${m.s !== 'skipped' && m.s !== 'done' ? btn('ms', 'Skip', 'data-val="skipped"') : btn('ms', 'Lock again', 'data-val="locked"')}${btn('ms-del', '×', '', 'btn-quiet')}</div>`).join('') || '<p class="note">No milestones yet.</p>'}</div>
      <div class="ch-add"><input class="input" id="sbMsName" maxlength="60" placeholder="Name, like 50 subs"><input class="input ch-num" type="number" id="sbMsTarget" min="1" placeholder="Target"><select class="select" id="sbMsSrc">${X.SB_SOURCES.map((x) => `<option value="${x}">${SRC_NAME[x]}</option>`).join('')}</select><input class="input" id="sbMsReward" maxlength="80" placeholder="Reward, like dye my hair"><label class="check check-sm"><input type="checkbox" id="sbMsRep"><span>Repeats</span></label>${btn('ms-add', 'Add', '', 'btn-primary')}</div>
      <p class="note">Milestones unlock by themselves when they're reached, and never twice unless set to repeat.</p>${look('milestones')}`;
  }
  function spinsCard() {
    const sp = live.spins;
    const ch = Hub.stateOf && Hub.stateOf('challenges');
    const wheels = ch ? ch.widgets.filter((w) => w.kind === 'wheel') : [];
    return `<div class="sb-readout"><b>${sp.owed}</b><small>spins owed, ${sp.done} done</small></div>
      <div class="btn-row">${btn('spin-one', 'Spin one now', sp.owed && sp.wheel ? '' : 'disabled', 'btn-primary')}${btn('spin-add', '+1', 'data-val="1"')}${btn('spin-add', '−1', 'data-val="-1"')}</div>
      <label class="field"><span class="field-label">Wheel to spin (from Challenges)</span><select class="select" data-sb-in="spins.wheel"><option value="">Choose a wheel</option>${wheels.map((w) => `<option value="${w.id}"${w.id === sp.wheel ? ' selected' : ''}>${esc(w.title || 'Random wheel')}</option>`).join('')}</select></label>
      <div class="btn-row"><label class="dk-inline">A spin every ${numIn('spins.perSubs', sp.perSubs, 'min="0"')} subs</label><label class="dk-inline">every ${numIn('spins.perBits', sp.perBits, 'min="0"')} bits</label>${toggle('per-ms', sp.perMilestone, 'One per milestone')}</div>
      ${sp.hist.length ? `<p class="note">Done: ${sp.hist.slice(0, 6).map((h) => esc(h.t)).join(', ')}</p>` : ''}
      <p class="note">Spins are only earned here; the wheel never spins by itself. Put the wheel on screen in Challenges so viewers see it.</p>${look('spins')}`;
  }
  function bonusCard() {
    const b = live.bonus;
    const on = b.until > Date.now();
    return `<p class="note">${on ? `<b>Bonus running</b> until ${new Date(b.until).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}.` : 'No bonus running.'}</p>
      <div class="btn-row"><label class="dk-inline">Time × ${numIn('bonus.mult', b.mult, 'min="1" max="10" step="0.5"')}</label><label class="dk-inline">Progress × ${numIn('bonus.prog', b.prog, 'min="1" max="10" step="0.5"')}</label><label class="dk-inline">for ${numIn('bonus.mins', b.mins, 'min="1" max="1440"')} min</label></div>
      <div class="sb-types">${X.SB_RULES.map((k) => `<label class="check check-sm"><input type="checkbox" data-sb-in="bonus.type" value="${k}"${b.types.includes(k) ? ' checked' : ''}><span>${RULE_NAME[k][0]}</span></label>`).join('')}</div><p class="note">Nothing ticked means it applies to everything.</p>
      <div class="btn-row">${on ? btn('bonus-end', 'End the bonus', '', 'btn-primary') : btn('bonus-start', 'Start the bonus', '', 'btn-primary')}</div>`;
  }
  function historyCard() {
    const rows = live.hist.filter((h) => (histView.f === 'all' || (histView.f === 'notes' ? h.src === 'note' : h.src === histView.f)) && (!histView.q || (h.user + h.note + h.kind).toLowerCase().includes(histView.q.toLowerCase()))).slice(0, 60);
    const label = (h) => (h.src === 'note' ? esc(h.note) : `${esc(h.user || 'Someone')}: ${h.kind === 'time' ? 'time' : `${h.qty} ${esc({ t1: 'Tier 1 sub', t2: 'Tier 2 sub', t3: 'Tier 3 sub', prime: 'Prime sub', gift: 'gifted sub', resub: 'resub', bits: 'bits', follow: 'follow', donation: '£ donation', custom: 'custom' }[h.kind] || h.kind)}${h.qty > 1 && ['gift', 'resub', 'follow', 't1', 't2', 't3', 'prime'].includes(h.kind) ? 's' : ''}`}${h.secs ? `, ${h.secs > 0 ? '+' : ''}${Math.round(h.secs / 6) / 10} min` : ''}${h.note && h.src !== 'note' ? ` (${esc(h.note)})` : ''}`);
    return `${live.warn ? `<p class="sb-warn">Twitch has been disconnected since ${new Date(live.warn.since).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}. Contributions during this time may be missing: add any you saw by hand. ${btn('clear-warn', 'OK')}</p>` : ''}
      <div class="md-filters"><div class="seg" role="group">${[['all', 'Everything'], ['auto', 'From Twitch'], ['manual', 'By hand'], ['notes', 'Notes']].map(([v, l]) => `<button type="button" data-sb="hist-f" data-val="${v}" aria-pressed="${histView.f === v}">${l}</button>`).join('')}</div><input class="input" id="sbHistQ" placeholder="Search names" value="${esc(histView.q)}"></div>
      <div class="ch-rows">${rows.map((h) => `<div class="ch-row sb-h${h.fixed ? ' is-fixed' : ''}${h.kind === 'gap' ? ' is-gap' : ''}" data-id="${esc(h.id)}"><small class="ch-small">${new Date(h.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</small><span class="ch-led">${label(h)}</span>${h.src === 'manual' ? '<span class="pill">By hand</span>' : ''}${!h.fixed && h.src !== 'note' && h.kind !== 'time' ? btn('undo', armedText(`u${h.id}`, 'Undo')) : ''}</div>`).join('') || '<p class="note">Nothing yet.</p>'}</div>`;
  }
  function boardCard() {
    const l = V.leaders(live);
    const money = new Map();
    live.hist.forEach((h) => { if (!h.fixed && h.kind === 'donation' && h.user) money.set(h.user, (money.get(h.user) || 0) + h.qty); });
    const list = (rows, unit) => rows.map(([u, v], i) => `${i + 1}. ${esc(u)} (${v}${unit})`).join(', ') || 'nobody yet';
    return `<p class="note"><b>Gifted subs:</b> ${list(l.gifts, '')}</p><p class="note"><b>Bits:</b> ${list(l.bits, '')}</p><p class="note"><b>Donations:</b> ${list(Array.from(money.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3), '')}</p><p class="note">From what's been recorded this session. Anonymous gifts aren't ranked.</p>${look('board')}`;
  }
  function sessionsCard() {
    const dur = (x) => { const m = Math.round((x.end - x.start) / 60000); return `${Math.floor(m / 60)}h ${m % 60}m`; };
    return `${live.sessions.map((x) => `<div class="ch-row" data-sess="${x.id}"><span class="ch-led"><b>${new Date(x.start).toLocaleDateString('en-GB')}</b> <small class="ch-small">${dur(x)}, ${x.subs} subs (${x.gifts} gifted), ${x.bits} bits, ${Math.round(x.added / 60)} min added, ${x.milestones} milestones, ${x.spins} spins</small></span>${Hub.role === 'owner' ? btn('sess-del', armedText(`s${x.id}`, 'Delete'), '', 'btn-quiet') : ''}</div>`).join('') || '<p class="note">Finished subathons appear here.</p>'}
      <div class="btn-row">${btn('export', 'Download everything (JSON)')}</div>`;
  }
  const SECTIONS = [['timer', '⏱', 'Timer', () => (live.timer.state === 'idle' ? 'Not started' : `${V.hms(X.subLeft(live.timer, Date.now()))} left, ${live.timer.state}`), timerCard],
    ['mode', '☾', 'Sleep and break', () => ({ normal: 'Normal', sleep: 'Sleep mode', break: 'Break mode' }[live.mode]), modeCard],
    ['rules', '⚙', 'Contribution rules', () => `Tier 1 adds ${Math.round(live.rules.t1.secs / 60)} min`, rulesCard],
    ['manual', '+', 'Add by hand', () => 'Subs, gifts, bits, donations and follows', manualCard],
    ['goals', '◎', 'Goals', () => `${live.goals.length} goals`, goalsCard],
    ['milestones', '◆', 'Milestones', () => `${live.milestones.filter((m) => m.s !== 'locked').length} of ${live.milestones.length} unlocked`, milestonesCard],
    ['spins', '◔', 'Wheel spins', () => `${live.spins.owed} owed`, spinsCard],
    ['bonus', '×2', 'Bonus periods', () => (live.bonus.until > Date.now() ? 'Bonus running' : 'No bonus running'), bonusCard],
    ['history', '☰', 'History', () => `${live.hist.length} entries${live.warn ? ', Twitch disconnected' : ''}`, historyCard],
    ['board', '♛', 'Leaderboards', () => 'Top gifters, bits and donations', boardCard],
    ['sessions', '🗂', 'Past subathons', () => `${live.sessions.length} saved`, sessionsCard]];
  function paint() {
    if (!live) return;
    const typing = cards.contains(document.activeElement) && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName) && document.activeElement.type !== 'range' && document.activeElement.type !== 'checkbox';
    if (typing) return;
    const top = `<div class="sb-status">${twitchState === 'connected' ? '<span class="tw-dot" data-state="connected"></span>Twitch connected: subs, gifts, bits and follows count by themselves.' : 'Twitch isn’t connected, so contributions are added by hand. The owner can connect it in Settings, Twitch.'}${live.counts.subs || live.counts.bits ? ` This session: <b>${live.counts.subs}</b> subs (${live.counts.gifts} gifted), <b>${live.counts.bits}</b> bits, <b>${live.counts.follows}</b> follows.` : ''}</div>`;
    const html = top + SECTIONS.map(([k, icon, name, sum, body]) => `<details class="fold dk-card" data-id="${k}"${openCards.has(k) ? ' open' : ''}><summary><span class="fold-icon dk-icon" aria-hidden="true">${icon}</span><span class="fold-text"><b>${name}</b><small>${esc(sum())}</small></span><span class="fold-chev" aria-hidden="true"></span></summary><div class="fold-body">${body()}</div></details>`).join('');
    if (cards._html !== html) { cards._html = html; cards.innerHTML = html; }
  }
  setInterval(() => { if (!live) return; const el = cards.querySelector('[data-sb-left]'); if (el) el.textContent = V.hms(X.subLeft(live.timer, Date.now())); }, 500);
  window.addEventListener('hub-twitch', (e) => { if (e.detail && e.detail.status) { twitchState = e.detail.status.connected ? e.detail.status.events : ''; redraw(); } });

  const view = document.getElementById('viewSubathon');
  view.addEventListener('click', async (e) => {
    if (!live) return;
    const vb = e.target.closest('[data-vis]');
    if (vb && vb.dataset.key) { const it = item(vb.dataset.key); if (it) { it.vis = vb.dataset.vis; commit(); } return; }
    const b = e.target.closest('[data-sb]');
    if (!b) return;
    const v = b.dataset.val;
    const key = b.dataset.key;
    const row = b.closest('[data-k]');
    const k = row ? Number(row.dataset.k) : -1;
    const tierSel = () => { const t = document.getElementById('sbTier').value; return t === 'prime' ? { tier: '1000', prime: true } : { tier: t }; };
    switch (b.dataset.sb) {
      case 'start': { const h = Number(document.getElementById('sbH').value) || 0; const m = Number(document.getElementById('sbM').value) || 0; act('start', { secs: h * 3600 + m * 60 }); return; }
      case 'pause': case 'resume': act(b.dataset.sb); return;
      case 'end': if (arm('end')) act('end'); return;
      case 'reset': if (arm('reset')) act('reset'); return;
      case 'time': act('time', { secs: Number(v) }); return;
      case 'time-custom': { const m = Number(document.getElementById('sbCustomMin').value); if (!m) { Hub.toast('Type the minutes (minus to remove).'); return; } if (Math.abs(m) >= 120 && !arm('bigtime')) { Hub.toast('That’s a big change. Tap again to confirm.'); return; } act('time', { secs: m * 60 }); return; }
      case 'add-subs': act('manual', Object.assign({ kind: 'sub', qty: Number(v) }, tierSel())); return;
      case 'add-subs-n': { const n = Number(document.getElementById('sbSubN').value); if (!n) { Hub.toast('Type how many.'); return; } if (n >= 50 && !arm('bigsubs')) { Hub.toast('That’s a lot. Tap again to confirm.'); return; } act('manual', Object.assign({ kind: 'sub', qty: n }, tierSel())); return; }
      case 'add-other': {
        const kind = document.getElementById('sbKind').value;
        const amt = Number(document.getElementById('sbAmt').value) || (kind === 'follow' ? 1 : 0);
        if (!amt) { Hub.toast('Type the amount.'); return; }
        act('manual', { kind, qty: kind === 'follow' || kind === 'gift' || kind === 'custom' ? amt : 1, amount: amt, user: document.getElementById('sbWho').value });
        return;
      }
      case 'mode': act('mode', { mode: v }); return;
      case 'bonus-start': act('bonus-start', { mins: live.bonus.mins }); return;
      case 'bonus-end': act('bonus-end'); return;
      case 'ms': act('ms', { id: live.milestones[k].id, s: v }); return;
      case 'spin-add': act('spin-add', { n: Number(v) }); return;
      case 'spin-one': {
        try {
          const r = await Hub.call('POST', `/api/streamers/${Hub.streamer.id}/challenges/spin`, { widget: live.spins.wheel, test: false });
          act('spin-done', { result: r.result });
          Hub.toast(`Spun: ${r.result}`, { tone: 'goal' });
        } catch (err) { Hub.toast(err.message || 'Couldn’t spin.', { tone: 'bad' }); }
        return;
      }
      case 'undo': { const id = b.closest('[data-id]').dataset.id; if (arm(`u${id}`)) act('undo-entry', { id }); return; }
      case 'clear-warn': act('clear-warn'); return;
      case 'hist-f': histView.f = v; redraw(); return;
      case 'goal-fix': { const g = item(key); act('goal-set', { id: g.id, cur: Number(document.getElementById(`sbFix-${g.id}`).value) }); return; }
      case 'goal-reset': { const g = item(key); if (arm(`gr${g.id}`)) act('goal-reset', { id: g.id }); return; }
      case 'sess-del': { const id = b.closest('[data-sess]').dataset.sess; if (arm(`s${id}`)) act('session-del', { id }); return; }
      case 'export': {
        const blob = new Blob([JSON.stringify({ exported: new Date().toISOString(), streamer: Hub.streamer.name, sessions: live.sessions, current: { counts: live.counts, history: live.hist } }, null, 2)], { type: 'application/json' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `subathon-${new Date().toISOString().slice(0, 10)}.json`; a.click(); URL.revokeObjectURL(a.href);
        return;
      }
      // Settings saved straight to the shared state
      case 'auto-end': live.timer.autoEnd = !live.timer.autoEnd; break;
      case 'sl-pause': live.sleep.pause = !live.sleep.pause; break;
      case 'sl-collect': live.sleep.collect = !live.sleep.collect; break;
      case 'sl-queue': live.sleep.queue = !live.sleep.queue; break;
      case 'rule-on': live.rules[v].on = !live.rules[v].on; break;
      case 'per-ms': live.spins.perMilestone = !live.spins.perMilestone; break;
      case 'lock': { const it = item(key); it.lock = !it.lock; break; }
      case 'goal-add': {
        const name = document.getElementById('sbGoalName').value.trim();
        const target = Number(document.getElementById('sbGoalTarget').value);
        if (!name || !target) { Hub.toast('Give the goal a name and a target.'); return; }
        const n = live.goals.length;
        live.goals.push(X.subathonNormalize({ goals: [{ name, src: document.getElementById('sbGoalSrc').value, target, x: 960, y: 120 + n * 110 }] }).goals[0]);
        break;
      }
      case 'goal-del': { const g = item(key); if (!arm(`gd${g.id}`)) return; live.goals = live.goals.filter((x) => x !== g); break; }
      case 'ms-add': {
        const name = document.getElementById('sbMsName').value.trim();
        const target = Number(document.getElementById('sbMsTarget').value);
        if (!name || !target) { Hub.toast('Give the milestone a name and a target.'); return; }
        live.milestones.push(X.subathonNormalize({ milestones: [{ name, target, src: document.getElementById('sbMsSrc').value, reward: document.getElementById('sbMsReward').value, rep: document.getElementById('sbMsRep').checked }] }).milestones[0]);
        break;
      }
      case 'ms-del': live.milestones.splice(k, 1); break;
      default: return;
    }
    commit();
  });
  view.addEventListener('input', (e) => { if (e.target.id === 'sbHistQ') { histView.q = e.target.value; const keep = e.target.selectionStart; redraw(); const q = document.getElementById('sbHistQ'); if (q) { q.focus(); q.setSelectionRange(keep, keep); } } });
  view.addEventListener('change', (e) => {
    if (!live) return;
    const t = e.target;
    const path = t.dataset.sbIn;
    if (!path || ['h', 'm'].includes(path)) return;
    const v = Number(t.value);
    const key = t.dataset.key;
    const g = key && key.startsWith('goal:') ? item(key) : null;
    if (path === 'scale') item(key).scale = v / 100;
    else if (path === 'colour') item(key).color = t.value;
    else if (path === 'preset') { if (!t.value) return; const [x, y] = t.value.split(',').map(Number); const it = item(key); it.x = x; it.y = y; }
    else if (path === 'timer.title') live.timer.title = t.value;
    else if (path === 'timer.maxH') live.timer.max = Math.round(v * 3600);
    else if (path === 'timer.minH') live.timer.min = Math.round(v * 3600);
    else if (path === 'timer.grace') live.timer.grace = Math.max(0, v);
    else if (path === 'sleep.mult') live.sleep.mult = v;
    else if (path.startsWith('rules.')) { const [, r, f] = path.split('.'); if (f === 'min') live.rules[r].secs = Math.round(v * 60); else if (f === 'maxMin') live.rules[r].max = Math.round(v * 60); else live.rules[r][f] = v; }
    else if (path === 'bonus.type') { const types = new Set(live.bonus.types); if (t.checked) types.add(t.value); else types.delete(t.value); live.bonus.types = Array.from(types); }
    else if (path.startsWith('bonus.')) live.bonus[path.slice(6)] = v;
    else if (path.startsWith('spins.')) live.spins[path.slice(6)] = path === 'spins.wheel' ? t.value : v;
    else if (g && path === 'g.name') g.name = t.value;
    else if (g && path === 'g.src') g.src = t.value;
    else if (g && path === 'g.target') g.target = Math.max(1, v);
    else if (g && path === 'g.start') g.start = v;
    else return;
    commit();
  });
})();
