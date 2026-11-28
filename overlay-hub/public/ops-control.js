/*
  Stream tools in the hub (owner): quick action buttons on Home, and "Stream tools" with Test mode, Quick actions,
  Automations, Presets and profiles, Version history and Locks. Plus the Stream Desk running order panel (owner and
  editors with Stream Desk), and Shift+1 to 8 for saved setups. The server checks everything again.
*/
(() => {
  'use strict';
  const Hub = window.Hub;
  const X = window.ExtrasModel;
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const owner = () => Hub.role === 'owner';
  const hm = (t) => (t ? new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '');
  const dm = (t) => (t ? new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
  const mmss = (sec) => { const neg = sec < 0; sec = Math.abs(Math.round(sec)); const h = Math.floor(sec / 3600); const m = Math.floor(sec / 60) % 60; const x = sec % 60; return `${neg ? '+' : ''}${h ? `${h}:${String(m).padStart(2, '0')}` : m}:${String(x).padStart(2, '0')}`; };
  const TAB_NAMES = { desk: 'Stream Desk', challenges: 'Challenges', canvas: 'Canvas', media: 'Media Centre', subathon: 'Subathon & Goals', twitch: 'Twitch Centre', scoreboard: 'Live scoreboard', games: 'Chat Games', all: 'Every tab' };
  const TRIG = [['sub', 'New sub'], ['resub', 'Resub (shared)'], ['gift', 'Gifted subs (a batch)'], ['bits', 'Bits'], ['follow', 'Follow'], ['raid', 'Raid'], ['redeem', 'Channel points'], ['online', 'Going live'], ['offline', 'Going offline'], ['goal', 'A subathon goal is reached'], ['milestone', 'A milestone unlocks'], ['segment', 'A running order segment starts'], ['manual', 'Only from a quick action']];
  const COND = [['subathon-running', 'The subathon is running'], ['subathon-stopped', 'No subathon is running'], ['live', 'The stream is live'], ['not-hidden', 'Nothing is hidden (Hide everything isn’t on)'], ['mode', 'Subathon mode is…']];
  let O = null;
  let edit = null; // the button or automation being edited
  let report = null;
  let check = null; // a "what would change" result waiting for confirmation
  const armed = {};
  const open = new Set(JSON.parse(localStorage.getItem('tools-open') || '[]'));
  const arm = (k, redraw) => { if (Date.now() - (armed[k] || 0) < 4000) { delete armed[k]; return true; } armed[k] = Date.now(); redraw(); setTimeout(redraw, 4100); return false; };
  const armedText = (k, t) => (Date.now() - (armed[k] || 0) < 4000 ? 'Tap again' : t);
  const btn = (op, label, extra = '', cls = '') => `<button type="button" class="btn btn-small ${cls}" data-op="${op}" ${extra}>${label}</button>`;
  const call = (action, body) => Hub.call('POST', `/api/streamers/${Hub.streamer.id}/ops/${action}`, body || {});
  async function act(action, body, ok) { try { const r = await call(action, body); if (ok) Hub.toast(ok); return r; } catch (e) { Hub.toast(e.message || 'That didn’t work.', { tone: 'bad' }); return null; } }
  window.addEventListener('hub-ops', (e) => { O = e.detail; paintBar(); paintTools(); });

  /* ---------- Steps (shared by quick actions and automations) ---------- */
  function stepFields(s, i) {
    const n = (f, label, v, extra = '') => `<label class="dk-inline">${label} <input class="input ch-num" type="number" data-sf="${f}" data-i="${i}" value="${esc(v)}" ${extra}></label>`;
    const sel = (f, label, list, v) => `<label class="dk-inline">${label} <select class="select" data-sf="${f}" data-i="${i}"><option value="">Choose…</option>${list.map((o) => `<option value="${esc(o.id || o.key)}"${(o.id || o.key) === v ? ' selected' : ''}>${esc(o.name)}</option>`).join('')}</select></label>`;
    switch (s.action) {
      case 'subathon.time': return n('mins', 'Minutes (minus removes)', Math.round(s.secs / 60), 'step="1"');
      case 'subathon.sub': return `${n('qty', 'How many', s.qty, 'min="1"')}<label class="dk-inline">Tier <select class="select" data-sf="tier" data-i="${i}">${['1000', '2000', '3000'].map((t) => `<option value="${t}"${s.tier === t ? ' selected' : ''}>Tier ${t[0]}</option>`).join('')}</select></label>`;
      case 'subathon.spin': return n('n', 'Spins', s.n);
      case 'subathon.bonus': return n('mins', 'Minutes', s.mins, 'min="1"');
      case 'desk.counter': return n('n', 'Add (minus takes away)', s.n);
      case 'desk.text': return `<label class="dk-inline">Text <input class="input" data-sf="text" data-i="${i}" value="${esc(s.text)}" maxlength="200"></label>`;
      case 'challenge.counter': return `${sel('widget', 'Counter', O.counters, s.widget)}${n('n', 'Add', s.n)}`;
      case 'show': return `${sel('target', 'Piece', O.targets, s.target)}<label class="dk-inline">Make it <select class="select" data-sf="vis" data-i="${i}">${[['live', 'On screen'], ['preview', 'Preview only'], ['off', 'Off']].map(([v, l]) => `<option value="${v}"${s.vis === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>`;
      case 'sound': return sel('sound', 'Sound', O.sounds, s.sound);
      case 'setup': return sel('setup', 'Saved setup', O.setups, s.setup);
      case 'rule': return sel('rule', 'Automation', O.rules.filter((r) => !edit || r.id !== edit.obj.id), s.rule);
      default: return '';
    }
  }
  const stepsEditor = (steps, forRule) => `<ol class="op-steps">${steps.map((s, i) => `<li><select class="select" data-sf="action" data-i="${i}">${O.actions.filter((a) => !(forRule && a.id === 'rule')).map((a) => `<option value="${a.id}"${a.id === s.action ? ' selected' : ''}>${esc(a.name)}${a.publish ? ' (puts things on screen)' : a.audio ? ' (plays sound)' : ''}</option>`).join('')}</select>${stepFields(s, i)}${btn('step-del', '×', `data-i="${i}" aria-label="Remove this step"`, 'btn-quiet')}</li>`).join('')}</ol>${steps.length < 8 ? btn('step-add', '+ Add a step') : ''}`;
  const blankStep = () => ({ action: 'desk.counter', secs: 300, n: 1, qty: 1, tier: '1000', mins: 30, text: '', widget: '', target: '', vis: 'live', sound: '', setup: '', rule: '' });

  /* ---------- Quick action bar (Home) ---------- */
  const bar = document.getElementById('qaBar');
  const pending = new Set();
  function paintBar() {
    if (!bar) return;
    const list = O && owner() ? O.buttons.slice().sort((a, b) => (b.fav ? 1 : 0) - (a.fav ? 1 : 0)) : [];
    bar.hidden = !list.length;
    bar.innerHTML = list.length ? `<span class="qa-label">Quick actions</span>${list.map((b) => `<button type="button" class="qa-btn${pending.has(b.id) ? ' is-busy' : ''}" data-qa="${b.id}" style="--qa:${b.color}" title="${esc(b.steps.length)} step${b.steps.length === 1 ? '' : 's'}${b.key ? `, Shift+${b.key.toUpperCase()}` : ''}"${pending.has(b.id) ? ' disabled' : ''}>${pending.has(b.id) ? 'Working…' : esc(armedText(`qa${b.id}`, b.name))}</button>`).join('')}` : '';
  }
  async function runButton(id) {
    const b = O && O.buttons.find((x) => x.id === id);
    if (!b || pending.has(id)) return; // a second tap while it's running does nothing
    const confirmed = b.confirm ? arm(`qa${id}`, paintBar) : false;
    if (b.confirm && !confirmed) return;
    pending.add(id);
    paintBar();
    const r = await act('button-run', { id, nonce: `${id}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, confirmed });
    pending.delete(id);
    paintBar();
    if (!r) return;
    const bad = r.steps.filter((x) => !x.ok && !x.skipped);
    const skipped = r.steps.filter((x) => x.skipped);
    Hub.toast(bad.length ? `“${b.name}” stopped: ${bad[0].msg}` : skipped.length ? `“${b.name}” done, but ${skipped.length} step${skipped.length === 1 ? ' was' : 's were'} skipped (everything is hidden).` : `“${b.name}” done.`, { tone: bad.length ? 'bad' : 'goal' });
  }
  if (bar) bar.addEventListener('click', (e) => { const b = e.target.closest('[data-qa]'); if (b) runButton(b.dataset.qa); });
  // Shift+letter: quick actions; Shift+1 to 8: saved setups. Never while typing, and holding a key down doesn't repeat it
  document.addEventListener('keydown', (e) => {
    if (!e.shiftKey || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = (document.activeElement || {}).tagName;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || (document.activeElement && document.activeElement.isContentEditable)) return;
    const digit = /^Digit([1-8])$/.exec(e.code);
    if (digit) {
      const s = (Hub.setups || [])[Number(digit[1]) - 1];
      if (!s) return;
      e.preventDefault();
      Hub.call('POST', `/api/streamers/${Hub.streamer.id}/setups/${s.id}/apply`).then(() => Hub.toast(`Saved setup “${s.name}” is on screen.`, { tone: 'goal' })).catch((err) => Hub.toast(err.message, { tone: 'bad' }));
      return;
    }
    const k = /^Key([A-Z])$/.exec(e.code);
    if (k && O && owner()) { const b = O.buttons.find((x) => x.key === k[1].toLowerCase()); if (b) { e.preventDefault(); runButton(b.id); } }
  });

  /* ---------- Stream tools (Home, owner) ---------- */
  const box = document.getElementById('toolsBox');
  const sub = (id, title, small, body) => `<details class="md-sub op-sub" data-sub="${id}"${open.has(id) ? ' open' : ''}><summary><b>${title}</b> <small>${esc(small)}</small></summary><div class="op-body">${body()}</div></details>`;
  function testCard() {
    const r = report;
    const sb = r && r.subathon;
    return `<p class="note op-test-flag">Private: pretend events run on a throwaway copy. Live totals, Twitch and the OBS page are never touched.</p>
      <div class="ch-add"><select class="select" id="tmKind">${TRIG.filter(([k]) => k !== 'manual').map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select><select class="select" id="tmTier"><option value="1000">Tier 1</option><option value="2000">Tier 2</option><option value="3000">Tier 3</option></select><input class="input ch-num" type="number" id="tmAmount" min="0" placeholder="Amount"><input class="input" id="tmName" maxlength="45" placeholder="Reward, goal or segment name"></div>
      <div class="btn-row">${btn('test-run', 'Run the test', '', 'btn-primary')}</div>
      ${r ? `<div class="op-report"><b>Pretend ${esc(r.event.kind)}${r.event.amount > 1 ? ` (${r.event.amount})` : ''}</b>
        ${sb ? `<p>Subathon: ${sb.running ? `${sb.added ? `adds ${mmss(sb.added)}` : 'adds no time'}, timer ${mmss(sb.before)} to ${mmss(sb.after)}` : 'not running, so only totals would change'}${sb.goals.length ? `. Goals: ${sb.goals.map((g) => `${esc(g.name)} ${g.before} to ${g.after} of ${g.target}`).join(', ')}` : ''}${sb.milestones.length ? `. Unlocks: ${sb.milestones.map(esc).join(', ')}` : ''}${sb.spins ? `. +${sb.spins} spin${sb.spins === 1 ? '' : 's'} owed` : ''}.</p>` : ''}
        ${r.alert ? `<p>Alert: ${esc(r.alert)}</p>` : ''}
        ${r.automations.length ? r.automations.map((a) => `<p>Automation “${esc(a.name)}”${a.on ? '' : ' (switched off)'}: ${a.note ? esc(a.note) : a.steps.map((x) => esc(x.msg)).join('; ')}</p>`).join('') : '<p>No automation would react.</p>'}
        <p class="note">${esc(r.note)}</p></div>` : ''}`;
  }
  function buttonsCard() {
    if (edit && edit.type === 'button') {
      const b = edit.obj;
      const clash = b.key && O.buttons.some((x) => x.id !== b.id && x.key === b.key);
      return `<div class="op-edit"><div class="ch-grid4"><label class="field"><span class="field-label">Name</span><input class="input" data-ef="name" value="${esc(b.name)}" maxlength="30"></label><label class="field"><span class="field-label">Colour</span><input type="color" data-ef="color" value="${b.color}"></label><label class="field"><span class="field-label">Shortcut (Shift + a letter)</span><input class="input" data-ef="key" value="${esc(b.key)}" maxlength="1" placeholder="none"></label></div>
        ${clash ? '<p class="sb-warn">Another button already uses that letter.</p>' : ''}${['h', 'a', 'o', 'p', 'u'].includes(b.key) ? '<p class="note">Fine: the scoreboard uses that letter without Shift.</p>' : ''}
        <div class="btn-row"><button type="button" class="btn btn-small ch-tog" data-op="ef-confirm" aria-pressed="${b.confirm}">Needs a second tap: ${b.confirm ? 'On' : 'Off'}</button><button type="button" class="btn btn-small ch-tog" data-op="ef-fav" aria-pressed="${b.fav}">Favourite: ${b.fav ? 'On' : 'Off'}</button></div>
        <h4 class="md-h">Steps (run in order, stopping at the first problem)</h4>${stepsEditor(b.steps, false)}
        <div class="btn-row">${btn('edit-save', 'Save button', '', 'btn-primary')}${btn('edit-cancel', 'Cancel')}</div></div>`;
    }
    return `${O.buttons.map((b, i) => `<div class="ch-row" data-id="${b.id}"><span class="ch-led"><i class="op-swatch" style="background:${b.color}"></i><b>${esc(b.name)}</b> <small class="ch-small">${b.steps.length} step${b.steps.length === 1 ? '' : 's'}${b.key ? `, Shift+${b.key.toUpperCase()}` : ''}${b.confirm ? ', second tap' : ''}</small></span>${btn('b-up', '↑', i ? '' : 'disabled')}${btn('b-edit', 'Edit')}${btn('b-del', armedText(`bd${b.id}`, '×'), 'aria-label="Delete"', 'btn-quiet')}</div>`).join('') || '<p class="note">No buttons yet. Make one for anything you do over and over, like “+1 death” or “Goal and spin the wheel”.</p>'}
      ${btn('b-new', '+ New button', '', 'btn-primary')}`;
  }
  function rulesCard() {
    if (edit && edit.type === 'rule') {
      const r = edit.obj;
      const doubles = ['sub', 'resub', 'gift', 'bits', 'follow'].includes(r.trigger.type) && r.steps.some((s) => s.action === 'subathon.time' || s.action === 'subathon.sub');
      return `<div class="op-edit"><div class="ch-grid4"><label class="field"><span class="field-label">Name</span><input class="input" data-ef="name" value="${esc(r.name)}" maxlength="50"></label><label class="field"><span class="field-label">Note (optional)</span><input class="input" data-ef="desc" value="${esc(r.desc)}" maxlength="200"></label></div>
        <h4 class="md-h">When</h4><div class="ch-add"><select class="select" data-tf="type">${TRIG.map(([k, l]) => `<option value="${k}"${r.trigger.type === k ? ' selected' : ''}>${l}</option>`).join('')}</select><label class="dk-inline">At least <input class="input ch-num" type="number" data-tf="min" value="${r.trigger.min || ''}" min="0" placeholder="any"></label>${['sub', 'resub', 'gift'].includes(r.trigger.type) ? `<select class="select" data-tf="tier"><option value="">Any tier</option>${['1000', '2000', '3000'].map((t) => `<option value="${t}"${r.trigger.tier === t ? ' selected' : ''}>Tier ${t[0]}</option>`).join('')}</select>` : ''}${['redeem'].includes(r.trigger.type) ? `<input class="input" data-tf="reward" value="${esc(r.trigger.reward)}" maxlength="45" placeholder="Reward title (exactly)">` : ''}${['goal', 'milestone', 'segment'].includes(r.trigger.type) ? `<input class="input" data-tf="name" value="${esc(r.trigger.name)}" maxlength="60" placeholder="Which one (blank = any)">` : ''}</div>
        <h4 class="md-h">Only if</h4><div class="op-conds">${COND.map(([k, l]) => `<label class="check check-sm"><input type="checkbox" data-cond="${k}"${r.conds.some((c) => c.type === k) ? ' checked' : ''}><span>${l}</span></label>${k === 'mode' && r.conds.some((c) => c.type === 'mode') ? `<select class="select" data-cond-v="mode">${['normal', 'sleep', 'break'].map((m) => `<option${(r.conds.find((c) => c.type === 'mode') || {}).value === m ? ' selected' : ''}>${m}</option>`).join('')}</select>` : ''}`).join('')}</div>
        ${r.conds.length > 1 ? `<div class="seg" role="group"><button type="button" data-op="ef-any" data-val="0" aria-pressed="${!r.any}">All of these</button><button type="button" data-op="ef-any" data-val="1" aria-pressed="${r.any}">Any of these</button></div>` : ''}
        <h4 class="md-h">Do</h4>${stepsEditor(r.steps, true)}
        ${doubles ? '<p class="sb-warn">Subathon already adds time for these through its own contribution rules. This adds more on top, so only keep it if that’s what you want.</p>' : ''}
        <h4 class="md-h">Limits</h4><div class="btn-row"><label class="dk-inline">Wait between runs <input class="input ch-num" type="number" data-ef="cool" value="${r.cool}" min="0"> s</label><label class="dk-inline">Most runs a day <input class="input ch-num" type="number" data-ef="max" value="${r.max}" min="0" placeholder="no limit"></label><button type="button" class="btn btn-small ch-tog" data-op="ef-once" aria-pressed="${r.once}">Only once: ${r.once ? 'On' : 'Off'}</button><label class="dk-inline">Between <input class="input" type="time" data-ef="from" value="${r.from}"> and <input class="input" type="time" data-ef="to" value="${r.to}"> (UK time)</label></div>
        <div class="btn-row">${btn('edit-save', 'Save automation', '', 'btn-primary')}${btn('edit-cancel', 'Cancel')}</div><p class="note">Saving switches it off; switch it on when you’re happy (a summary shows first).</p></div>`;
    }
    const runs = (O.runs || []).slice(0, 12);
    return `${O.rules.length ? `<div class="btn-row">${btn('rules-stop', armedText('stopall', 'Stop every automation'), '', 'btn-quiet')}</div>` : ''}
      ${O.rules.map((r) => `<div class="ch-row" data-id="${r.id}"><span class="ch-led"><b>${esc(r.name)}</b> <small class="ch-small">${esc((TRIG.find((t) => t[0] === r.trigger.type) || [0, r.trigger.type])[1])}${r.trigger.min ? ` of ${r.trigger.min}+` : ''}, ${r.steps.length} step${r.steps.length === 1 ? '' : 's'}${r.runs ? `, ran ${r.runs} today` : ''}${r.errors ? `, ${r.errors} failures` : ''}</small></span>
        <button type="button" class="btn btn-small ch-tog" data-op="r-on" aria-pressed="${r.on}">${r.on ? 'On' : armedText(`ron${r.id}`, 'Off')}</button>${btn('r-test', 'Dry run')}${btn('r-edit', 'Edit')}${btn('r-del', armedText(`rd${r.id}`, '×'), 'aria-label="Delete"', 'btn-quiet')}</div>`).join('') || '<p class="note">No automations yet. Example: “10 or more gifted subs: add a wheel spin and play a sound”.</p>'}
      ${btn('r-new', '+ New automation', '', 'btn-primary')}
      ${check && check.kind === 'rule' ? `<div class="op-report"><b>Dry run</b>${check.result.note ? `<p>${esc(check.result.note)}</p>` : check.result.steps.map((x) => `<p>${esc(x.msg)}</p>`).join('')}</div>` : ''}
      ${runs.length ? `<h4 class="md-h">Latest runs</h4><div class="ch-rows">${runs.map((x) => `<div class="ch-row"><small class="ch-small">${hm(x.at)}</small><span class="ch-led"><b>${esc(x.name)}</b> <small class="ch-small">${esc(x.trigger)}: ${x.note ? esc(x.note) : x.steps.map((y) => `${y.ok ? '✓' : y.skipped ? 'skipped' : '✗'} ${esc(y.msg)}`).join('; ')}</small></span></div>`).join('')}</div>` : ''}
      <p class="note">Automations never trigger other automations, never run twice for the same Twitch event, and switch themselves off after 5 failures in a row.</p>`;
  }
  function configsCard() {
    const tabs = ['desk', 'challenges', 'canvas', 'media', 'subathon', 'twitch'];
    const list = O.configs.slice().sort((a, b) => (b.fav ? 1 : 0) - (a.fav ? 1 : 0));
    return `<p class="note">A <b>preset</b> saves how chosen tabs look and are set up. A <b>profile</b> saves every tab, plus your quick actions and automations (which arrive switched off). Loading never resets live numbers or timers and never puts anything on screen.</p>
      <div class="ch-add"><input class="input" id="cfgName" maxlength="50" placeholder="Name, like Football watchalong"><select class="select" id="cfgKind"><option value="preset">Preset (chosen tabs)</option><option value="profile">Profile (everything)</option></select></div>
      <div class="op-conds">${tabs.map((t) => `<label class="check check-sm"><input type="checkbox" data-cfg-tab="${t}" checked><span>${TAB_NAMES[t]}</span></label>`).join('')}</div>
      <div class="btn-row">${btn('cfg-save', 'Save', '', 'btn-primary')}<label class="btn btn-small op-file">Import a file<input type="file" id="cfgImport" accept="application/json,.json" hidden></label></div>
      <div class="ch-rows">${list.map((c) => `<div class="ch-row" data-id="${c.id}"><span class="ch-led">${c.fav ? '★ ' : ''}<b>${esc(c.name)}</b> <small class="ch-small">${c.kind}, ${c.mods.map((m) => TAB_NAMES[m]).join(', ')}${c.rules ? `, ${c.rules} automations` : ''}, ${dm(c.at)}</small></span>${btn('cfg-fav', c.fav ? '★' : '☆', 'aria-label="Favourite"')}${btn('cfg-check', 'Load…')}${btn('cfg-export', 'Download')}${btn('cfg-del', armedText(`cd${c.id}`, '×'), 'aria-label="Delete"', 'btn-quiet')}</div>`).join('') || '<p class="note">Nothing saved yet.</p>'}</div>
      ${check && check.kind === 'config' ? confirmBox('config', check) : ''}`;
  }
  function confirmBox(kind, c) {
    const total = c.reps.reduce((a, r) => a + r.added + r.removed + r.changed, 0);
    return `<div class="op-report"><b>${esc(c.title)}</b>${c.reps.map((r) => `<p>${TAB_NAMES[r.mod]}: ${r.changed} changed, ${r.added} added (Off)${r.removed ? `, ${r.removed} removed` : ''}${r.kept ? `, ${r.kept} kept because they’re on screen` : ''}</p>`).join('')}${c.rules ? `<p>${c.rules} automations would be added, switched off.</p>` : ''}
      ${total || c.rules ? `${kind === 'config' ? `<div class="seg" role="group"><button type="button" data-op="mode" data-val="merge" aria-pressed="${c.mode !== 'replace'}">Merge (keep extra pieces)</button><button type="button" data-op="mode" data-val="replace" aria-pressed="${c.mode === 'replace'}">Replace</button></div>` : ''}<div class="btn-row">${btn(`${kind}-apply`, armedText(`apply${c.id}`, kind === 'config' ? 'Load it' : 'Restore it'), '', 'btn-primary')}${btn('check-cancel', 'Cancel')}</div><p class="note">A version is saved first, so you can go back. Twitch changes already made can’t be undone.</p>` : `<p>Nothing would change.</p>${btn('check-cancel', 'OK')}`}</div>`;
  }
  function versionsCard() {
    return `<div class="ch-add"><input class="input" id="cpName" maxlength="50" placeholder="Checkpoint name, like Before the final">${btn('cp-save', 'Save a checkpoint', '', 'btn-primary')}</div>
      <div class="ch-rows">${(O.versions || []).slice(0, 30).map((v) => `<div class="ch-row" data-id="${v.id}"><small class="ch-small">${dm(v.at)}</small><span class="ch-led">${v.name ? `<b>${esc(v.name)}</b> ` : ''}<small class="ch-small">${v.mod === '*' ? 'Every tab' : TAB_NAMES[v.mod] || v.mod}${v.by ? `, ${esc(v.by)}` : ''}</small></span>${btn('v-check', 'Go back to this…')}</div>`).join('') || '<p class="note">Versions appear as you change things (at most one every 15 seconds per tab).</p>'}</div>
      ${check && check.kind === 'version' ? confirmBox('version', check) : ''}
      <p class="note">Keeps the newest 40 versions and 15 checkpoints. Going back changes settings and layout only: scores, timers, totals and histories stay as they are, and nothing goes on screen by itself.</p>`;
  }
  function locksCard() {
    const now = Date.now();
    return `<div class="ch-add"><select class="select" id="lkMod">${Object.entries(TAB_NAMES).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select><select class="select" id="lkKind"><option value="all">No changes</option><option value="layout">Layout only (no moving or resizing)</option></select><input class="input ch-num" type="number" id="lkMins" min="0" placeholder="Minutes (0 = until removed)"><input class="input" id="lkReason" maxlength="80" placeholder="Reason, like Live match"></div>
      <div class="btn-row"><label class="check check-sm"><input type="checkbox" id="lkAuto"><span>Automations may still change it</span></label>${btn('lk-add', 'Lock', '', 'btn-primary')}</div>
      <div class="ch-rows">${(O.locks || []).map((l) => `<div class="ch-row" data-id="${l.id}"><span class="ch-led"><b>${TAB_NAMES[l.mod] || l.mod}</b> <small class="ch-small">${l.kind === 'layout' ? 'layout only' : 'no changes'}${l.reason ? `: ${esc(l.reason)}` : ''}${l.until ? `, until ${hm(l.until)} (${Math.max(1, Math.round((l.until - now) / 60000))} min)` : ''}${l.auto ? ', automations allowed' : ''}</small></span>${btn('lk-del', 'Remove')}</div>`).join('') || '<p class="note">No locks. Locks stop editors (and automations, unless allowed) changing a tab, say during a live match. You can still change it, and Hide everything always works.</p>'}</div>`;
  }
  function paintTools() {
    if (!box) return;
    if (!O || !owner()) { box.innerHTML = ''; return; }
    if (box.contains(document.activeElement) && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName) && document.activeElement.type !== 'checkbox') return;
    const html = `<details class="fold dk-card op-tools"${open.has('tools') ? ' open' : ''} data-sub="tools"><summary><span class="fold-icon dk-icon" aria-hidden="true">⚙</span><span class="fold-text"><b>Stream tools</b><small>Test mode, quick actions, automations, presets, versions and locks</small></span><span class="fold-chev" aria-hidden="true"></span></summary><div class="fold-body">
      ${(O.notices || []).length ? `<div class="sb-warn">${O.notices.map((n) => `<p>${esc(n.text)} ${btn('notice-ok', 'OK', `data-id="${n.id}"`)}</p>`).join('')}</div>` : ''}
      ${sub('test', 'Test mode (private)', 'Pretend events, nothing real changes', testCard)}
      ${sub('buttons', 'Quick actions', `${O.buttons.length} buttons`, buttonsCard)}
      ${sub('rules', 'Automations', `${O.rules.filter((r) => r.on).length} of ${O.rules.length} on`, rulesCard)}
      ${sub('configs', 'Presets and profiles', `${O.configs.length} saved`, configsCard)}
      ${sub('versions', 'Version history', `${(O.versions || []).length} versions`, versionsCard)}
      ${sub('locks', 'Locks', `${(O.locks || []).length} active`, locksCard)}</div></details>`;
    if (box._html !== html) { box._html = html; box.innerHTML = html; }
  }
  const redraw = () => { if (box) box._html = ''; paintTools(); };
  if (box) {
    box.addEventListener('toggle', (e) => { const k = e.target.dataset && e.target.dataset.sub; if (!k) return; if (e.target.open) open.add(k); else open.delete(k); localStorage.setItem('tools-open', JSON.stringify(Array.from(open))); }, true);
    box.addEventListener('input', (e) => {
      if (!edit) return;
      const t = e.target;
      if (t.dataset.ef && t.type !== 'checkbox') edit.obj[t.dataset.ef] = ['cool', 'max'].includes(t.dataset.ef) ? Number(t.value) || 0 : t.dataset.ef === 'key' ? t.value.toLowerCase().replace(/[^a-z]/g, '') : t.value;
      if (t.dataset.sf && t.tagName === 'INPUT') { const s = edit.obj.steps[Number(t.dataset.i)]; if (t.dataset.sf === 'mins' && s.action === 'subathon.time') s.secs = Number(t.value) * 60; else s[t.dataset.sf] = t.type === 'number' ? Number(t.value) : t.value; }
      if (t.dataset.tf && t.tagName === 'INPUT') edit.obj.trigger[t.dataset.tf] = t.type === 'number' ? Number(t.value) || 0 : t.value;
    });
    box.addEventListener('change', async (e) => {
      const t = e.target;
      if (t.id === 'cfgImport' && t.files[0]) { try { const file = JSON.parse(await t.files[0].text()); const r = await act('config-import', { file }); if (r) Hub.toast(r.missing ? `Imported. ${r.missing} referenced file${r.missing === 1 ? ' isn’t' : 's aren’t'} on this server.` : 'Imported.'); } catch (err) { Hub.toast('That file couldn’t be read.', { tone: 'bad' }); } t.value = ''; return; }
      if (!edit) return;
      if (t.dataset.sf && t.tagName === 'SELECT') { const s = edit.obj.steps[Number(t.dataset.i)]; s[t.dataset.sf] = t.value; redraw(); }
      if (t.dataset.tf && t.tagName === 'SELECT') { edit.obj.trigger[t.dataset.tf] = t.value; redraw(); }
      if (t.dataset.cond) { edit.obj.conds = t.checked ? edit.obj.conds.concat({ type: t.dataset.cond, value: t.dataset.cond === 'mode' ? 'sleep' : '' }) : edit.obj.conds.filter((c) => c.type !== t.dataset.cond); redraw(); }
      if (t.dataset.condV) { const c = edit.obj.conds.find((x) => x.type === t.dataset.condV); if (c) c.value = t.value; }
    });
    box.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-op]');
      if (!b || !O) return;
      const row = b.closest('[data-id]');
      const id = row ? row.dataset.id : b.dataset.id;
      const v = (x) => (document.getElementById(x) || {}).value || '';
      switch (b.dataset.op) {
        case 'test-run': { const r = await act('test', { ev: { kind: v('tmKind'), tier: v('tmTier'), amount: Number(v('tmAmount')) || undefined, reward: v('tmName'), name: v('tmName') } }); if (r) { report = r.report; redraw(); } return; }
        case 'b-new': edit = { type: 'button', obj: { id: '', name: 'New button', color: '#f2a65a', steps: [blankStep()], confirm: false, key: '', fav: false } }; break;
        case 'b-edit': edit = { type: 'button', obj: JSON.parse(JSON.stringify(O.buttons.find((x) => x.id === id))) }; break;
        case 'b-del': if (!arm(`bd${id}`, redraw)) return; act('button-del', { id }, 'Button deleted.'); return;
        case 'b-up': act('button-move', { id, dir: 'up' }); return;
        case 'r-new': edit = { type: 'rule', obj: { id: '', name: 'New automation', desc: '', on: false, trigger: { type: 'gift', min: 0, tier: '', reward: '', name: '' }, conds: [], any: false, steps: [Object.assign(blankStep(), { action: 'subathon.spin' })], cool: 0, max: 0, once: false, from: '', to: '' } }; break;
        case 'r-edit': edit = { type: 'rule', obj: JSON.parse(JSON.stringify(O.rules.find((x) => x.id === id))) }; break;
        case 'r-del': if (!arm(`rd${id}`, redraw)) return; act('rule-del', { id }, 'Automation deleted.'); return;
        case 'r-on': {
          const r = O.rules.find((x) => x.id === id);
          if (r.on) { act('rule-on', { id, on: false }, `“${r.name}” switched off.`); return; }
          // Switching on shows what it will do first
          if (!arm(`ron${id}`, redraw)) { Hub.toast(`“${r.name}” will: ${r.steps.map((s) => (O.actions.find((a) => a.id === s.action) || {}).name).join(', ')}. Tap On again to switch it on.`, { ms: 8000 }); return; }
          act('rule-on', { id, on: true }, `“${r.name}” is on.`);
          return;
        }
        case 'r-test': { const r = await act('rule-test', { id }); if (r) { check = { kind: 'rule', result: r.result }; redraw(); } return; }
        case 'rules-stop': if (!arm('stopall', redraw)) return; act('rules-stop', {}, 'Every automation is off.'); return;
        case 'step-add': edit.obj.steps.push(blankStep()); break;
        case 'step-del': edit.obj.steps.splice(Number(b.dataset.i), 1); break;
        case 'ef-confirm': edit.obj.confirm = !edit.obj.confirm; break;
        case 'ef-fav': edit.obj.fav = !edit.obj.fav; break;
        case 'ef-once': edit.obj.once = !edit.obj.once; break;
        case 'ef-any': edit.obj.any = b.dataset.val === '1'; break;
        case 'edit-cancel': edit = null; break;
        case 'edit-save': {
          const r = await act(edit.type === 'button' ? 'button-save' : 'rule-save', edit.type === 'button' ? { button: edit.obj } : { rule: edit.obj }, edit.type === 'button' ? 'Button saved.' : 'Automation saved (switched off).');
          if (r) edit = null;
          break;
        }
        case 'cfg-save': { const mods = Array.from(box.querySelectorAll('[data-cfg-tab]:checked')).map((x) => x.dataset.cfgTab); act('config-save', { name: v('cfgName'), kind: v('cfgKind'), mods }, 'Saved.'); return; }
        case 'cfg-fav': act('config-fav', { id }); return;
        case 'cfg-del': if (!arm(`cd${id}`, redraw)) return; act('config-del', { id }, 'Deleted.'); return;
        case 'cfg-export': { const r = await act('config-export', { id }); if (r) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(r.file, null, 2)], { type: 'application/json' })); a.download = `${r.file.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.json`; a.click(); URL.revokeObjectURL(a.href); } return; }
        case 'cfg-check': { const r = await act('config-check', { id, mode: 'merge' }); if (r) { const c = O.configs.find((x) => x.id === id); check = { kind: 'config', id, mode: 'merge', title: `Load “${c.name}”`, reps: r.reps, rules: r.rules }; redraw(); } return; }
        case 'mode': { const r = await act('config-check', { id: check.id, mode: b.dataset.val }); if (r) { check.mode = b.dataset.val; check.reps = r.reps; redraw(); } return; }
        case 'config-apply': if (!arm(`apply${check.id}`, redraw)) return; if (await act('config-apply', { id: check.id, mode: check.mode }, 'Loaded. Check the preview, then press Show for anything you want on screen.')) check = null; break;
        case 'v-check': { const r = await act('version-check', { id }); if (r) { const vv = O.versions.find((x) => x.id === id); check = { kind: 'version', id, title: `Go back to ${vv.name || dm(vv.at)}`, reps: r.reps }; redraw(); } return; }
        case 'version-apply': if (!arm(`apply${check.id}`, redraw)) return; if (await act('version-restore', { id: check.id }, 'Restored as a new version.')) check = null; break;
        case 'check-cancel': check = null; break;
        case 'cp-save': act('checkpoint', { name: v('cpName') || 'Checkpoint' }, 'Checkpoint saved.'); return;
        case 'lk-add': act('lock', { mod: v('lkMod'), kind: v('lkKind'), mins: Number(v('lkMins')) || 0, reason: v('lkReason'), auto: document.getElementById('lkAuto').checked }, 'Locked.'); return;
        case 'lk-del': act('unlock', { id }, 'Lock removed.'); return;
        case 'notice-ok': act('notice-ack', { id: b.dataset.id }); return;
        default: return;
      }
      redraw();
    });
  }

  /* ---------- Stream Desk running order ---------- */
  const ro = document.getElementById('roCards');
  const roOpen = new Set(JSON.parse(localStorage.getItem('ro-open') || '["ro"]'));
  const said = new Set();
  const roCall = (a, body) => Hub.call('POST', `/api/streamers/${Hub.streamer.id}/rundown`, Object.assign({ a }, body || {})).catch((e) => Hub.toast(e.message || 'That didn’t work.', { tone: 'bad' }));
  const PRE = [['', 'Move to…'], ['240,150', 'Top left'], ['960,150', 'Top'], ['1680,150', 'Top right'], ['240,930', 'Bottom left'], ['960,930', 'Bottom'], ['1640,980', 'Bottom right']];
  function paintRo() {
    if (!ro) return;
    const d = Hub.stateOf && Hub.stateOf('desk');
    if (!d || !d.rundown) { ro.innerHTML = ''; return; }
    if (ro.contains(document.activeElement) && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName) && !['range', 'checkbox', 'color'].includes(document.activeElement.type)) return;
    const rd = d.rundown;
    const s = rd.session;
    const L = rd.lists.find((l) => l.id === (s.on ? s.list : rd.cur)) || rd.lists[0];
    const now = Date.now();
    const p = rd.pub;
    const el = p.on ? X.roElapsed(p, now) : 0;
    const left = p.mins * 60 - el;
    // Private reminders: an overrun, and a planned start coming up (each said once)
    if (s.on && p.mins && left < 0 && !said.has(`over${s.start}${s.i}`)) { said.add(`over${s.start}${s.i}`); Hub.toast(`“${p.now}” has run over its ${p.mins} minutes.`, { ms: 7000 }); }
    if (L && s.on) { const nx = L.segs[s.i + 1]; if (nx && nx.at) { const [h, m] = nx.at.split(':').map(Number); const at = new Date(); at.setHours(h, m, 0, 0); const mins = (at - now) / 60000; if (mins > 0 && mins <= (rd.remind || 2) && !said.has(`soon${s.start}${s.i}`)) { said.add(`soon${s.start}${s.i}`); Hub.toast(`“${nx.title}” is planned for ${nx.at}.`, { ms: 7000 }); } } }
    const finish = L && s.on ? now + Math.max(0, left) * 1000 + L.segs.slice(s.i + 1).reduce((a, x) => a + x.mins * 60000, 0) : 0;
    const segRow = (g, i) => {
      const state = s.on && L && s.list === L.id ? (i < s.i ? 'is-done' : i === s.i ? 'is-now' : '') : '';
      const fixed = s.on && i <= s.i;
      return `<div class="ro-seg ${state}" data-seg="${g.id}"><div class="ro-seg-top"><span class="ro-n">${i + 1}</span><input class="input" data-rf="title" value="${esc(g.title)}" maxlength="60" aria-label="Segment title"><label class="dk-inline">Min <input class="input ch-num" type="number" data-rf="mins" value="${g.mins}" min="0" max="1440"></label><label class="dk-inline">At <input class="input" type="time" data-rf="at" value="${g.at}"></label><select class="select" data-rf="kind"><option value="seg"${g.kind === 'seg' ? ' selected' : ''}>Segment</option><option value="break"${g.kind === 'break' ? ' selected' : ''}>Break</option></select>
        ${fixed ? '' : `${btn('rs-up', '↑', i ? '' : 'disabled')}${btn('rs-down', '↓', i < L.segs.length - 1 ? '' : 'disabled')}${btn('rs-del', armedText(`rs${g.id}`, '×'), 'aria-label="Remove"', 'btn-quiet')}`}</div>
        <div class="ro-seg-more"><input class="input" data-rf="who" value="${esc(g.who)}" maxlength="40" placeholder="Who’s on it">${owner() ? `<input class="input" data-rf="note" value="${esc(g.note)}" maxlength="400" placeholder="Private note (never on stream)">` : ''}
        <span class="ro-checks">${g.checks.map((c, k) => `<label class="check check-sm"><input type="checkbox" data-check="${k}"${c.done ? ' checked' : ''}><span>${esc(c.t)}</span></label>`).join('')}<input class="input ro-addcheck" data-addcheck="1" maxlength="80" placeholder="+ checklist item"></span></div></div>`;
    };
    const live = s.on ? `<div class="ro-live"><div class="ro-now"><small>Now${s.paused ? ' (paused)' : ''}</small><b>${esc(p.now)}</b><span class="${left < 0 ? 'is-over' : ''}">${p.mins ? (left >= 0 ? `${mmss(left)} left` : `${mmss(-left)} over`) : mmss(el)}</span></div><div class="ro-next"><small>Next</small><b>${esc(p.next || 'The end')}</b>${finish ? `<span>Finish about ${hm(finish)} (estimate)</span>` : ''}</div></div>
      <div class="btn-row">${s.paused ? btn('ro', '▶ Resume', 'data-a="resume"', 'btn-primary') : btn('ro', '⏸ Pause', 'data-a="pause"')}${btn('ro', 'Next ⏭', 'data-a="next"', 'btn-primary')}${btn('ro', 'Skip', 'data-a="skip"')}${btn('ro', '⏮ Back', 'data-a="back"')}${btn('ro', '+ Break (5 min)', 'data-a="break"')}${btn('ro-end', armedText('roend', 'End'), '', 'btn-quiet')}</div>` : `${L && L.segs.length ? `<div class="btn-row">${btn('ro', '▶ Start the running order', 'data-a="start"', 'btn-primary')}</div>` : ''}`;
    const look = rd.look;
    const html = `<details class="fold dk-card ro-card" data-ro="ro"${roOpen.has('ro') ? ' open' : ''}><summary><span class="fold-icon dk-icon" aria-hidden="true">☰</span><span class="fold-text"><b>Running order</b><small>${s.on ? `Now: ${esc(p.now)}` : L ? `${esc(L.name)}, ${L.segs.length} segments` : 'Plan the stream segment by segment'}</small></span>${s.on ? '<span class="pill is-on">Live</span>' : ''}<span class="fold-chev" aria-hidden="true"></span></summary><div class="fold-body">
      <div class="ch-add">${rd.lists.length ? `<select class="select" id="roPick"${s.on ? ' disabled' : ''}>${rd.lists.map((l) => `<option value="${l.id}"${L && l.id === L.id ? ' selected' : ''}>${esc(l.name)}</option>`).join('')}</select>` : ''}<input class="input" id="roNew" maxlength="50" placeholder="New running order name">${btn('ro-new', 'Create')}${L ? `${btn('ro-dup', 'Duplicate')}${owner() && !s.on ? btn('ro-delist', armedText('rodel', 'Delete'), '', 'btn-quiet') : ''}` : ''}</div>
      ${live}
      ${L ? `<div class="ro-segs">${L.segs.map(segRow).join('') || '<p class="note">No segments yet.</p>'}</div>
        <div class="ch-add"><input class="input" id="roSegTitle" maxlength="60" placeholder="Segment, like Pre-match build-up"><input class="input ch-num" type="number" id="roSegMins" min="0" placeholder="Min">${btn('ro-add', 'Add', '', 'btn-primary')}</div>` : '<p class="note">Make a running order for intro, build-up, match, half-time, reaction and so on. Nothing on stream changes by itself.</p>'}
      ${owner() ? `<h4 class="md-h">On stream: Now and Next</h4>${Hub.visButtons(look.vis, ' data-rovis="1"')}<div class="dk-look"><label class="dk-inline dk-size">Size <input type="range" min="40" max="200" step="5" data-rolook="scale" value="${Math.round(look.scale * 100)}"></label><select class="select preset" data-rolook="preset">${PRE.map(([pv, l]) => `<option value="${pv}">${l}</option>`).join('')}</select><input type="color" data-rolook="color" value="${look.color}" aria-label="Colour"></div><p class="note">Only the current and next titles and the time ever reach OBS. Notes and plans stay private.</p>` : ''}
      ${rd.past.length ? `<h4 class="md-h">Past runs</h4>${rd.past.slice(0, 5).map((x, k) => `<p class="note"><b>${esc(x.name)}</b> ${dm(x.start)}: ${x.log.length} segments, ${Math.round((x.end - x.start) / 60000)} min (planned ${x.log.reduce((a, e) => a + e.planned, 0)})${x.log.some((e) => e.skipped) ? `, ${x.log.filter((e) => e.skipped).length} skipped` : ''} ${btn('ro-csv', 'Download', `data-k="${k}"`)}</p>`).join('')}` : ''}</div></details>`;
    if (ro._html !== html) { ro._html = html; ro.innerHTML = html; }
  }
  if (ro) {
    setInterval(paintRo, 1000);
    ro.addEventListener('toggle', (e) => { if (e.target.dataset && e.target.dataset.ro) { if (e.target.open) roOpen.add('ro'); else roOpen.delete('ro'); localStorage.setItem('ro-open', JSON.stringify(Array.from(roOpen))); } }, true);
    ro.addEventListener('click', (e) => {
      const vb = e.target.closest('[data-vis]');
      if (vb && vb.dataset.rovis) { roCall('look', { vis: vb.dataset.vis }); return; }
      const b = e.target.closest('[data-op]');
      if (!b) return;
      const seg = b.closest('[data-seg]');
      const v = (x) => (document.getElementById(x) || {}).value || '';
      const again = () => { ro._html = ''; paintRo(); };
      switch (b.dataset.op) {
        case 'ro': roCall(b.dataset.a); break;
        case 'ro-end': if (arm('roend', again)) roCall('end'); break;
        case 'ro-new': roCall('new-list', { name: v('roNew') }); break;
        case 'ro-dup': roCall('dup-list', {}); break;
        case 'ro-delist': if (arm('rodel', again)) roCall('del-list', {}); break;
        case 'ro-add': roCall('add-seg', { title: v('roSegTitle') || 'Segment', mins: Number(v('roSegMins')) || 10 }); break;
        case 'rs-up': case 'rs-down': roCall('move-seg', { id: seg.dataset.seg, dir: b.dataset.op === 'rs-up' ? 'up' : 'down' }); break;
        case 'rs-del': if (arm(`rs${seg.dataset.seg}`, again)) roCall('del-seg', { id: seg.dataset.seg }); break;
        case 'ro-csv': {
          const x = (Hub.stateOf('desk').rundown.past || [])[Number(b.dataset.k)];
          if (!x) return;
          const q = (t) => `"${String(t).replace(/"/g, '""')}"`;
          const rows = [['Segment', 'Planned (min)', 'Started', 'Ended', 'Actual (min)', 'Skipped']].concat(x.log.map((e) => [q(e.title), e.planned, new Date(e.start).toISOString(), new Date(e.end).toISOString(), Math.round((e.end - e.start) / 6000) / 10, e.skipped ? 'yes' : '']));
          const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([rows.map((r) => r.join(',')).join('\n')], { type: 'text/csv' })); a.download = `running-order-${new Date(x.start).toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(a.href);
          break;
        }
        default: break;
      }
    });
    ro.addEventListener('change', (e) => {
      const t = e.target;
      const seg = t.closest('[data-seg]');
      if (t.id === 'roPick') { roCall('pick', { id: t.value }); return; }
      if (t.dataset.rolook) { if (t.dataset.rolook === 'preset') { if (!t.value) return; const [x, y] = t.value.split(',').map(Number); roCall('look', { x, y }); } else roCall('look', t.dataset.rolook === 'scale' ? { scale: Number(t.value) / 100 } : { color: t.value }); return; }
      if (!seg) return;
      if (t.dataset.check) { roCall('edit-seg', { id: seg.dataset.seg, check: Number(t.dataset.check) }); return; }
      if (t.dataset.addcheck && t.value.trim()) { roCall('edit-seg', { id: seg.dataset.seg, addCheck: t.value.trim() }); return; }
      if (t.dataset.rf) roCall('edit-seg', { id: seg.dataset.seg, [t.dataset.rf]: t.type === 'number' ? Number(t.value) : t.value });
    });
  }
})();
