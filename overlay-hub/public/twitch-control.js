/*
  Twitch Centre in the hub. Every action goes through the server, which talks to Twitch's official API with the
  streamer's own connection (never sent to this browser). Owner-only actions don't appear for editors.
*/
(() => {
  'use strict';
  const Hub = window.Hub;
  const X = window.ExtrasModel;
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const time = (t) => (t ? new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '');
  const day = (t) => (t ? new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '');
  const ALERT_NAME = { follow: 'Follows', sub: 'New subs', resub: 'Resubs', gift: 'Gifted subs', bits: 'Bits', raid: 'Raids', redeem: 'Channel points' };
  const MARK_CATS = ['Funny moment', 'Highlight', 'Goal', 'Challenge', 'Fail', 'Edit later'];
  let live = null;
  let chat = [];
  let chatPaused = false;
  let chatQ = '';
  const feed = [];
  let feedFilter = '';
  let feedPaused = false;
  let cats = [];
  let chans = [];
  let rewards = null;
  let redeems = { reward: '', list: [] };
  let chatSet = null;
  let clipQ = '';
  const armed = {};
  const cards = document.getElementById('twCards');
  const openCards = new Set(JSON.parse(localStorage.getItem('tw-open') || '["dash","clips"]'));
  cards.addEventListener('toggle', (e) => {
    const k = e.target.dataset && e.target.dataset.id;
    if (!k) return;
    if (e.target.open) { openCards.add(k); if (k === 'chatset' && !chatSet && owner()) load('chat-settings').then((r) => { chatSet = r && r.settings; redraw(); }); if (k === 'points' && !rewards) load('rewards').then((r) => { rewards = r ? r.list : []; redraw(); }); } else openCards.delete(k);
    localStorage.setItem('tw-open', JSON.stringify(Array.from(openCards)));
  }, true);
  const owner = () => Hub.role === 'owner';
  // What this person may do in Twitch Centre (the server checks every action as well)
  let perms = new Set();
  const can = (p) => owner() || perms.has(p);
  const loadPerms = () => Hub.call('GET', '/api/twitch/me').then((r) => { perms = new Set(r.perms || []); redraw(); }).catch(() => {});
  setTimeout(loadPerms, 600);
  window.addEventListener('hashchange', () => { if (location.hash === '#twitch') loadPerms(); });

  const ctl = Hub.module('twitch', {
    patchable: ['titleFav', 'catFav', 'alerts', 'plook', 'timers', 'cmds', 'links'],
    onState(s) { live = s; paint(); },
    isShowing: (s) => s.alerts.vis === 'live' || s.plook.vis === 'live',
    liveCount: (s) => (s.alerts.vis === 'live' ? 1 : 0) + (s.plook.vis === 'live' ? 1 : 0),
    tileSummary: (s) => ({ text: s.dash.at ? (s.dash.live ? `Live, ${s.dash.viewers} watching` : 'Offline') : 'Twitch not checked yet', small: s.dash.title || 'Dashboard, chat, clips, alerts and more' }),
    onDrag(id, x, y) { const it = id === 'alerts' ? live.alerts : live.plook; it.x = x; it.y = y; ctl.commit(); },
    visItems: (s) => [['alerts', s.alerts], ['poll', s.plook]],
  });
  const commit = () => ctl.commit();
  const redraw = () => { cards._html = ''; paint(); };
  const arm = (k) => { if (Date.now() - (armed[k] || 0) < 4000) { delete armed[k]; return true; } armed[k] = Date.now(); redraw(); setTimeout(redraw, 4100); return false; };
  const armedText = (k, t) => (Date.now() - (armed[k] || 0) < 4000 ? 'Tap again' : t);
  const btn = (act, label, extra = '', cls = '') => `<button type="button" class="btn btn-small ${cls}" data-tw="${act}" ${extra}>${label}</button>`;
  const toggle = (act, on, label, extra = '') => `<button type="button" class="btn btn-small ch-tog" data-tw="${act}" ${extra} aria-pressed="${!!on}">${label}: ${on ? 'On' : 'Off'}</button>`;
  async function load(action, body) {
    try { return await Hub.call('POST', `/api/streamers/${Hub.streamer.id}/twitch/${action}`, body || {}); } catch (err) { Hub.toast(err.message || 'Twitch said no.', { tone: 'bad' }); return null; }
  }
  const lookRow = (key, it) => `${Hub.visButtons(it.vis, ` data-key="${key}"`)}<div class="dk-look"><label class="dk-inline dk-size">Size <input type="range" min="40" max="200" step="5" data-tw-in="scale" data-key="${key}" value="${Math.round(it.scale * 100)}"></label><input type="color" data-tw-in="colour" data-key="${key}" value="${it.color}" aria-label="Colour"></div>`;

  /* ---------- Sections ---------- */
  function dashCard() {
    const d = live.dash;
    const up = d.live && d.started ? Math.round((Date.now() - d.started) / 60000) : 0;
    const stat = (v, l) => `<div class="tw-stat"><b>${v}</b><small>${l}</small></div>`;
    return `${d.err ? `<p class="sb-warn">${esc(d.err)}</p>` : ''}<div class="tw-stats">${stat(d.live ? '● Live' : 'Offline', d.at ? `checked ${time(d.at)}` : 'not checked yet')}${stat(d.live ? d.viewers : '–', 'watching now')}${stat(d.live ? `${Math.floor(up / 60)}h ${up % 60}m` : '–', 'uptime')}${stat(d.followers >= 0 ? d.followers : '–', 'followers')}${stat(d.subs >= 0 ? d.subs : '–', 'active subs (Twitch total)')}</div>
      <p class="note"><b>${esc(d.title || 'No title')}</b>${d.cat ? ` in ${esc(d.cat)}` : ''}</p><div class="btn-row">${btn('refresh', 'Check now')}</div>
      <p class="note">Checked once a minute (followers and subs every 10). Active subs is Twitch's total of current subscriptions, which is different from the subs counted during a stream.</p>`;
  }
  function titleCard() {
    const d = live.dash;
    return `<label class="field"><span class="field-label">Stream title</span><textarea class="input" id="twTitle" maxlength="140" rows="2">${esc(d.title)}</textarea></label>
      <div class="btn-row">${can('title') ? `${btn('title', 'Save title', '', 'btn-primary')}${btn('title-fav', '★ Save as a favourite')}` : ''}</div>
      ${live.titleFav.length ? `<p class="note">Favourites:</p><div class="tw-chips">${live.titleFav.map((x, i) => `<button type="button" class="md-chip tw-chip" data-tw="use-title" data-i="${i}">${esc(x.t)}</button>`).join('')}</div>` : ''}
      ${live.titleHist.length ? `<details class="md-sub"><summary>Title history</summary>${live.titleHist.slice(0, 10).map((x) => `<p class="note">${day(x.at)} ${time(x.at)}, ${esc(x.by)}: ${esc(x.t)}${x.ok ? '' : ' <b>(Twitch rejected it)</b>'}</p>`).join('')}</details>` : ''}
      <h4 class="md-h">Category: ${esc(d.cat || 'none')}</h4>
      ${can('category') ? '' : '<p class="note">You can see the category but not change it.</p>'}<div class="ch-add"${can('category') ? '' : ' hidden'}><input class="input" id="twCatQ" placeholder="Search Twitch categories" maxlength="60">${btn('cat-search', 'Search')}</div>
      ${cats.length ? `<div class="tw-chips">${cats.map((c, i) => `<button type="button" class="md-chip tw-chip" data-tw="cat-pick" data-i="${i}">${esc(c.name)}</button>`).join('')}</div>` : ''}
      ${live.catFav.length || live.catHist.length ? `<p class="note">Favourites and recent:</p><div class="tw-chips">${live.catFav.concat(live.catHist.filter((h) => !live.catFav.some((f) => f.id === h.id)).slice(0, 6)).map((c) => `<button type="button" class="md-chip tw-chip" data-tw="cat-use" data-id="${esc(c.id)}" data-name="${esc(c.name)}">${esc(c.name)}</button>`).join('')}</div>` : ''}
      ${d.catId ? btn('cat-fav', '★ Favourite this category') : ''}`;
  }
  function clipsCard() {
    const clips = live.clips.filter((c) => !clipQ || (c.note + c.cat + c.title).toLowerCase().includes(clipQ.toLowerCase()));
    return `<div class="btn-row">${can('clips') ? btn('clip', '🎬 Clip that', '', 'btn-primary') : ''}<select class="select" id="twMarkCat"${can('markers') ? '' : ' hidden'}>${MARK_CATS.map((c) => `<option>${c}</option>`).join('')}</select>${can('markers') ? `<input class="input" id="twMarkDesc" maxlength="140" placeholder="Marker note">${btn('marker', '📍 Add marker')}` : ''}</div>
      <p class="note">Clips and markers only work while live. A clip only shows as made once Twitch confirms it (about 15 seconds).</p>
      <div class="md-filters"><input class="input" id="twClipQ" placeholder="Search clips and notes" value="${esc(clipQ)}"></div>
      <div class="ch-rows">${clips.slice(0, 30).map((c) => `<div class="ch-row tw-clip" data-clip="${esc(c.id)}"><span class="ch-led">${c.fav ? '★ ' : ''}<b>${c.state === 'pending' ? 'Waiting for Twitch…' : c.state === 'failed' ? 'Twitch couldn’t make this clip' : esc(c.title || 'Clip')}</b> <small class="ch-small">${day(c.at)} ${time(c.at)}, ${esc(c.by)}</small></span>${c.state === 'ready' ? `<a class="btn btn-small" href="${esc(c.url)}" target="_blank" rel="noopener">Open</a>${btn('clip-copy', 'Copy link')}` : ''}<input class="input md-cat" data-tw-in="clip-note" value="${esc(c.note)}" placeholder="Private note">${btn('clip-fav', c.fav ? '★' : '☆')}${btn('clip-del', armedText(`c${c.id}`, '×'), '', 'btn-quiet')}</div>`).join('') || '<p class="note">No clips yet.</p>'}</div>
      <h4 class="md-h">Markers</h4><div class="ch-rows">${live.markers.slice(0, 20).map((m) => `<div class="ch-row" data-mark="${esc(m.id)}"><small class="ch-small">${day(m.at)} ${Math.floor(m.pos / 3600)}:${String(Math.floor(m.pos / 60) % 60).padStart(2, '0')}:${String(m.pos % 60).padStart(2, '0')}</small><span class="ch-led">${esc(m.desc || 'Marker')} <small class="ch-small">${esc(m.cat)}</small></span>${can('markers') ? btn('marker-del', '×', '', 'btn-quiet') : ''}</div>`).join('') || '<p class="note">No markers yet.</p>'}</div>
      ${live.markers.length ? btn('markers-csv', 'Download markers for the editor (CSV)') : ''}`;
  }
  function chatCard() {
    const shown = chat.filter((m) => !chatQ || (m.u + m.text).toLowerCase().includes(chatQ.toLowerCase())).slice(-60);
    return `<div class="md-filters"><input class="input" id="twChatQ" placeholder="Search chat" value="${esc(chatQ)}">${toggle('chat-pause', chatPaused, 'Paused')}${btn('chat-clear', 'Clear this screen')}</div>
      <div class="tw-chat" id="twChat">${shown.map((m) => `<div class="tw-msg" data-msg="${esc(m.id || '')}" data-uid="${esc(m.uid || '')}" data-login="${esc(m.login)}">${m.bc ? '<span class="tw-badge">Streamer</span>' : m.mod ? '<span class="tw-badge">Mod</span>' : ''}${m.vip ? '<span class="tw-badge">VIP</span>' : ''}${m.sub ? '<span class="tw-badge is-sub">Sub</span>' : ''}<b style="color:${esc(m.c || '#c4b5fd')}">${esc(m.u)}</b> ${esc(m.text)}${m.uid && !m.bc && (can('delete') || can('timeout') || can('ban')) ? `<span class="tw-mod">${m.id && can('delete') ? btn('mod-delete', 'Delete') : ''}${can('timeout') ? btn('mod-timeout', '10 min timeout') : ''}${can('ban') ? btn('mod-ban', armedText(`b${m.uid}`, 'Ban'), '', 'btn-quiet') : ''}</span>` : ''}</div>`).join('') || '<p class="note">No chat yet. Chat shows here once the channel is set in the Chat settings.</p>'}</div>
      ${can('say') ? `<div class="ch-add"><input class="input" id="twSay" maxlength="450" placeholder="Send a message as ${esc(Hub.streamer.name)}">${btn('chat-send', 'Send', '', 'btn-primary')}</div>` : ''}
      ${live.modHist.length ? `<details class="md-sub"><summary>Moderation history</summary>${live.modHist.slice(0, 12).map((x) => `<p class="note">${time(x.at)} ${esc(x.by)}: ${esc(x.t)}</p>`).join('')}</details>` : ''}`;
  }
  function feedCard() {
    const list = feed.filter((e) => !feedFilter || e.kind === feedFilter).slice(0, 40);
    return `<div class="md-filters"><select class="select" id="twFeedF"><option value="">Everything</option>${Object.entries(ALERT_NAME).map(([k, l]) => `<option value="${k}"${feedFilter === k ? ' selected' : ''}>${l}</option>`).join('')}<option value="online"${feedFilter === 'online' ? ' selected' : ''}>Going live or offline</option></select>${toggle('feed-pause', feedPaused, 'Paused')}</div>
      <div class="ch-rows">${list.map((e) => `<div class="ch-row"><small class="ch-small">${time(e.at)}</small><span class="ch-led"><b>${esc(e.user)}</b> ${esc({ sub: 'subscribed', resub: 'resubscribed', gift: `gifted ${e.amount}`, bits: `cheered ${e.amount} bits`, follow: 'followed', raid: `raided with ${e.amount}`, redeem: `redeemed ${e.reward || ''}`, online: 'went live', offline: 'went offline' }[e.kind] || e.kind)}</span></div>`).join('') || '<p class="note">Events appear here as they happen.</p>'}</div>`;
  }
  function chatSetCard() {
    if (!can('chatset')) return '<p class="note">You don’t have permission to change chat modes.</p>';
    if (!chatSet) return `<p class="note">Loading the current chat modes…</p>${btn('chatset-load', 'Load')}`;
    const s = chatSet;
    return `<div class="btn-row">${toggle('cs-slow', s.slow_mode, `Slow mode${s.slow_mode ? ` (${s.slow_mode_wait_time}s)` : ''}`)}<input class="input ch-num" type="number" id="twSlow" min="3" max="120" value="${s.slow_mode_wait_time || 30}" aria-label="Seconds"></div>
      <div class="btn-row">${toggle('cs-follow', s.follower_mode, `Followers only${s.follower_mode ? ` (${s.follower_mode_duration} min)` : ''}`)}<input class="input ch-num" type="number" id="twFollowMin" min="0" max="129600" value="${s.follower_mode_duration || 10}" aria-label="Minutes"></div>
      <div class="btn-row">${toggle('cs-sub', s.subscriber_mode, 'Subs only')}${toggle('cs-emote', s.emote_mode, 'Emote only')}${toggle('cs-unique', s.unique_chat_mode, 'Unique chat')}</div>
      <p class="note">These show what Twitch has right now, after each change.</p>`;
  }
  function pointsCard() {
    if (!rewards) return `<p class="note">Loading channel point rewards…</p>${btn('rewards-load', 'Load')}`;
    return `<div class="ch-rows">${rewards.map((r) => `<div class="ch-row" data-reward="${esc(r.id)}" data-title="${esc(r.title)}"><span class="ch-led"><b>${esc(r.title)}</b> <small class="ch-small">${r.cost} points${r.ours ? ', made here' : ', made on Twitch (can’t be changed here)'}</small></span>${r.ours && can('points') ? toggle('reward-toggle', r.on, 'On') : ''}${btn('redeem-load', 'Redemptions')}${can('points') ? toggle('link', (live.links.find((l) => l.title === r.title) || {}).on, 'Adds a wheel spin') : ''}</div>`).join('') || '<p class="note">No custom rewards.</p>'}</div>
      ${redeems.reward ? `<h4 class="md-h">Waiting to be done</h4><div class="ch-rows">${redeems.list.map((x) => `<div class="ch-row" data-red="${esc(x.id)}"><span class="ch-led"><b>${esc(x.user)}</b> ${esc(x.text)}</span>${can('points') ? `${btn('redeem-ok', 'Done', '', 'btn-primary')}${btn('redeem-no', 'Cancel (refund)')}` : ''}</div>`).join('') || '<p class="note">Nothing waiting.</p>'}</div>` : ''}
      ${can('points') ? `<div class="ch-add"><input class="input" id="twRwTitle" maxlength="45" placeholder="New reward, like Spin the wheel"><input class="input ch-num" type="number" id="twRwCost" min="1" placeholder="Cost">${btn('reward-create', 'Create', '', 'btn-primary')}</div>` : ''}
      <p class="note">Twitch only lets an app change rewards it made itself. Links like “Adds a wheel spin” start Off.</p>`;
  }
  function pollCard() {
    const p = live.dash.poll;
    const active = p && p.status === 'ACTIVE';
    return `${p ? `<div class="tw-live-poll"><b>${esc(p.title)}</b> <small>${p.status === 'ACTIVE' ? 'running' : 'finished'}</small>${p.choices.map((c) => `<div class="tw-poll-line"><span>${esc(c.t)}</span><b>${c.v}</b></div>`).join('')}</div>` : ''}
      ${can('polls') ? (active ? `<div class="btn-row">${btn('poll-end', 'End now')}${btn('poll-archive', 'End and hide it')}</div>` : `<label class="field"><span class="field-label">Question</span><input class="input" id="twPollQ" maxlength="60"></label><div class="tw-answers">${[1, 2, 3, 4, 5].map((n) => `<input class="input" id="twPollA${n}" maxlength="25" placeholder="Answer ${n}${n > 2 ? ' (optional)' : ''}">`).join('')}</div><div class="btn-row"><label class="dk-inline">Lasts ${'<input class="input ch-num" type="number" id="twPollS" min="15" max="1800" value="60">'} s</label>${btn('poll-create', 'Start the Twitch poll', '', 'btn-primary')}</div>`) : ''}
      <p class="note">This is Twitch's own poll (needs Affiliate or Partner), separate from the chat-word poll in Chat Games.</p>${lookRow('poll', live.plook)}
      ${live.polls.length ? `<details class="md-sub"><summary>Past polls</summary>${live.polls.slice(0, 10).map((x) => `<p class="note">${day(x.at)}: ${esc(x.title)} (${esc(x.res)})</p>`).join('')}</details>` : ''}`;
  }
  function predCard() {
    const p = live.dash.pred;
    const going = p && ['ACTIVE', 'LOCKED'].includes(p.status);
    return `${p ? `<div class="tw-live-poll"><b>${esc(p.title)}</b> <small>${esc(p.status.toLowerCase())}</small>${p.outs.map((o) => `<div class="tw-poll-line"><span>${esc(o.t)}</span><b>${o.pts} pts, ${o.users} people</b>${can('preds') && going ? btn('pred-win', armedText(`w${o.id}`, 'This won'), `data-id="${esc(o.id)}"`) : ''}</div>`).join('')}</div>` : ''}
      ${can('preds') ? (going ? `<div class="btn-row">${p.status === 'ACTIVE' ? btn('pred-lock', 'Lock (no more bets)') : ''}${btn('pred-cancel', armedText('pc', 'Cancel and refund'), '', 'btn-quiet')}</div>` : `<label class="field"><span class="field-label">Prediction</span><input class="input" id="twPredQ" maxlength="45" placeholder="Will we win?"></label><div class="tw-answers"><input class="input" id="twPredA1" maxlength="25" placeholder="Outcome 1"><input class="input" id="twPredA2" maxlength="25" placeholder="Outcome 2"><input class="input" id="twPredA3" maxlength="25" placeholder="Outcome 3 (optional)"></div><div class="btn-row"><label class="dk-inline">Betting open for <input class="input ch-num" type="number" id="twPredS" min="30" max="1800" value="120"> s</label>${btn('pred-create', 'Start the prediction', '', 'btn-primary')}</div>`) : ''}
      <p class="note">Uses Twitch channel points only. Picking a winner pays out straight away, so it asks for a second tap.</p>
      ${live.preds.length ? `<details class="md-sub"><summary>Past predictions</summary>${live.preds.slice(0, 10).map((x) => `<p class="note">${day(x.at)}: ${esc(x.title)} (${esc(x.res)})</p>`).join('')}</details>` : ''}`;
  }
  function alertsCard() {
    const al = live.alerts;
    const audio = (window.__mdList || []).filter((m) => m.kind === 'audio');
    return `<div class="btn-row">${X.TW_ALERTS.map((k) => toggle('alert-on', al.on[k], ALERT_NAME[k], `data-k="${k}"`)).join('')}</div>
      <div class="btn-row"><label class="dk-inline">Shows for ${'<input class="input ch-num" type="number" data-tw-in="al.dur" min="2" max="30" value="' + al.dur + '">'} s</label><label class="dk-inline">Gap between same kind <input class="input ch-num" type="number" data-tw-in="al.cool" min="0" max="600" value="${al.cool}"> s</label><label class="dk-inline">Bits from <input class="input ch-num" type="number" data-tw-in="al.minBits" min="0" value="${al.minBits}"></label></div>
      <div class="btn-row"><select class="select" data-tw-in="al.sound"><option value="">No sound</option>${audio.map((m) => `<option value="${m.id}"${m.id === al.sound ? ' selected' : ''}>${esc(m.name)}</option>`).join('')}</select><label class="dk-inline">Volume <input type="range" min="0" max="100" data-tw-in="al.vol" value="${al.vol}"></label></div>
      <p class="note">Test (shows in your preview only, never on stream):</p><div class="btn-row">${X.TW_ALERTS.map((k) => btn('alert-test', ALERT_NAME[k], `data-k="${k}"`)).join('')}${al.cur ? btn('alert-skip', 'Skip the current alert') : ''}</div>
      ${lookRow('alerts', al)}${al.hist.length ? `<p class="note">Shown: ${al.hist.slice(0, 6).map((h) => esc(h.t)).join(', ')}</p>` : ''}`;
  }
  function timersCard() {
    return `${live.timers.map((x, k) => `<div class="tw-timer" data-k="${k}"><textarea class="input" rows="2" maxlength="400" data-tw-in="tm.text" placeholder="Message">${esc(x.text)}</textarea><div class="btn-row">${toggle('tm-on', x.on, 'On')}<label class="dk-inline">Every <input class="input ch-num" type="number" min="5" max="240" data-tw-in="tm.every" value="${x.every}"> min</label><label class="dk-inline">After <input class="input ch-num" type="number" min="0" max="1000" data-tw-in="tm.minChat" value="${x.minChat}"> chat messages</label>${toggle('tm-live', x.liveOnly, 'Only when live')}${can('timers') ? btn('timer-send', 'Send now') : ''}${btn('tm-del', armedText(`t${x.id}`, '×'), '', 'btn-quiet')}</div></div>`).join('')}
      ${btn('tm-add', '+ Add a timed message', '', 'btn-primary')}<p class="note">Sent as the streamer's account, at least 5 minutes apart, and only after some chat activity so they don't spam an empty chat.</p>
      ${live.chatHist.length ? `<details class="md-sub"><summary>Sent messages</summary>${live.chatHist.slice(0, 12).map((x) => `<p class="note">${time(x.at)} ${esc(x.t)}</p>`).join('')}</details>` : ''}`;
  }
  function cmdsCard() {
    return `${live.cmds.map((c, k) => `<div class="tw-timer" data-k="${k}"><div class="btn-row"><span class="tw-cmd">!</span><input class="input md-cat" data-tw-in="cm.name" value="${esc(c.name)}" maxlength="25" aria-label="Command">${toggle('cm-on', c.on, 'On')}<select class="select" data-tw-in="cm.level">${[['all', 'Everyone'], ['sub', 'Subs, VIPs, mods'], ['mod', 'Mods only'], ['owner', 'Streamer only']].map(([v, l]) => `<option value="${v}"${c.level === v ? ' selected' : ''}>${l}</option>`).join('')}</select><small class="ch-small">used ${c.uses}×</small>${btn('cm-del', armedText(`m${c.id}`, '×'), '', 'btn-quiet')}</div>
      <textarea class="input" rows="2" maxlength="400" data-tw-in="cm.resp" placeholder="Reply (use {user} for their name)">${esc(c.resp)}</textarea><div class="btn-row"><label class="dk-inline">Cooldown <input class="input ch-num" type="number" min="0" max="3600" data-tw-in="cm.cool" value="${c.cool}"> s</label><label class="dk-inline">Per person <input class="input ch-num" type="number" min="0" max="3600" data-tw-in="cm.userCool" value="${c.userCool}"> s</label></div></div>`).join('')}
      <div class="btn-row">${btn('cm-add', '+ Add a command', '', 'btn-primary')}${['socials', 'discord', 'schedule', 'goal', 'wheel'].filter((n) => !live.cmds.some((c) => c.name === n)).map((n) => btn('cm-add', `!${n}`, `data-name="${n}"`)).join('')}</div>
      <p class="note">Commands reply as the streamer's account, and start Off until you switch them on.</p>`;
  }
  function shoutCard() {
    return `${can('shout') ? `<div class="ch-add"><input class="input" id="twShoutQ" maxlength="40" placeholder="Search a channel">${btn('shout-search', 'Search')}</div>
      ${chans.length ? `<div class="ch-rows">${chans.map((c, i) => `<div class="ch-row"><span class="ch-led"><b>${esc(c.name)}</b> ${c.live ? '<span class="tw-badge">Live</span>' : ''}</span>${btn('shoutout', 'Shout out', `data-i="${i}"`, 'btn-primary')}</div>`).join('')}</div>` : ''}` : '<p class="note">Only the owner can send shoutouts.</p>'}
      <p class="note">Twitch allows one shoutout every 2 minutes, and the same channel once an hour.</p>
      ${live.shouts.length ? live.shouts.slice(0, 8).map((x) => `<p class="note">${time(x.at)} ${esc(x.to)}: ${x.ok ? 'sent' : `not sent (${esc(x.msg)})`}</p>`).join('') : ''}`;
  }
  function historyCard() {
    const rows = live.streams.map((x) => { const mins = Math.round(((x.end || Date.now()) - x.start) / 60000); return `<div class="ch-row" data-stream="${esc(x.id)}"><span class="ch-led"><b>${day(x.start)} ${time(x.start)}${x.open ? ' (live now)' : ''}</b> <small class="ch-small">${Math.floor(mins / 60)}h ${mins % 60}m, peak ${x.peak}, average ${x.n ? Math.round(x.sum / x.n) : 0} (sampled each minute), ${x.subs} subs, ${x.follows} follows, ${x.bits} bits, ${x.clips} clips, ${x.markers} markers. ${esc(x.cats.filter(Boolean).join(', '))}</small></span>${owner() && !x.open ? btn('stream-del', armedText(`s${x.id}`, '×'), '', 'btn-quiet') : ''}</div>`; }).join('');
    return `<div class="ch-rows">${rows || '<p class="note">Streams are recorded here from the moment they’re seen going live.</p>'}</div>${live.streams.length ? btn('streams-csv', 'Download stream history (CSV)') : ''}
      <p class="note">Only what was seen while the hub was running is recorded. Gaps when the server was down aren't filled in.</p>`;
  }
  const SECTIONS = [['dash', '◉', 'Dashboard', () => (live.dash.live ? `Live, ${live.dash.viewers} watching` : 'Offline'), dashCard],
    ['title', '✎', 'Title and category', () => live.dash.cat || 'Change the title and category', titleCard],
    ['clips', '🎬', 'Clips and markers', () => `${live.clips.length} clips, ${live.markers.length} markers`, clipsCard],
    ['chat', '💬', 'Live chat', () => `${chat.length} recent messages`, chatCard],
    ['feed', '⚡', 'Activity', () => `${feed.length} events`, feedCard],
    ['chatset', '⚙', 'Chat modes', () => 'Slow, followers, subs, emote and unique', chatSetCard],
    ['points', '◈', 'Channel points', () => 'Rewards and redemptions', pointsCard],
    ['poll', '▤', 'Twitch polls', () => (live.dash.poll && live.dash.poll.status === 'ACTIVE' ? 'Poll running' : 'Official Twitch polls'), pollCard],
    ['pred', '⚖', 'Predictions', () => (live.dash.pred && ['ACTIVE', 'LOCKED'].includes(live.dash.pred.status) ? 'Prediction running' : 'Channel point predictions'), predCard],
    ['alerts', '🔔', 'Alerts', () => `${Object.values(live.alerts.on).filter(Boolean).length} switched on`, alertsCard],
    ['timers', '⏲', 'Timed messages', () => `${live.timers.filter((x) => x.on).length} on`, timersCard],
    ['cmds', '!', 'Chat commands', () => `${live.cmds.filter((x) => x.on).length} on`, cmdsCard],
    ['shout', '📣', 'Shoutouts', () => 'Official Twitch shoutouts', shoutCard],
    ['history', '🗂', 'Streams and statistics', () => `${live.streams.length} streams recorded`, historyCard]];
  function paint() {
    if (!live) return;
    const typing = cards.contains(document.activeElement) && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName) && document.activeElement.type !== 'range';
    if (typing) return;
    const NEED = { dash: ['dash'], title: ['title', 'category'], clips: ['clips', 'markers'], chat: ['chat'], feed: ['feed'], chatset: ['chatset'], points: ['points'], poll: ['polls'], pred: ['preds'], alerts: ['alerts'], timers: ['timers'], cmds: ['cmds'], shout: ['shout'], history: ['history'] };
    const shown = SECTIONS.filter(([k]) => owner() || (NEED[k] || []).some(can));
    const html = (shown.length ? '' : '<p class="note">You haven’t been given anything in Twitch Centre yet. Ask the owner.</p>') + shown.map(([k, icon, name, sum, body]) => `<details class="fold dk-card" data-id="${k}"${openCards.has(k) ? ' open' : ''}><summary><span class="fold-icon dk-icon" aria-hidden="true">${icon}</span><span class="fold-text"><b>${name}</b><small>${esc(sum())}</small></span><span class="fold-chev" aria-hidden="true"></span></summary><div class="fold-body">${body()}</div></details>`).join('');
    if (cards._html !== html) {
      const box = document.getElementById('twChat');
      const atEnd = !box || box.scrollTop + box.clientHeight >= box.scrollHeight - 30;
      cards._html = html;
      cards.innerHTML = html;
      const nb = document.getElementById('twChat');
      if (nb && atEnd && !chatPaused) nb.scrollTop = nb.scrollHeight;
    }
  }
  window.addEventListener('hub-chat', (e) => { if (chatPaused) return; chat = (e.detail.list || []).slice(-80); if (openCards.has('chat')) redraw(); });
  window.addEventListener('hub-twitch', (e) => { if (e.detail.type === 'twitchEvent' && !feedPaused) { feed.unshift(e.detail.ev); feed.splice(80); if (openCards.has('feed')) redraw(); } });
  window.addEventListener('hub-media', (e) => { window.__mdList = e.detail.list; });
  const csv = (name, rows) => { const text = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n'); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' })); a.download = name; a.click(); URL.revokeObjectURL(a.href); };

  const view = document.getElementById('viewTwitch');
  view.addEventListener('click', async (e) => {
    if (!live) return;
    const vb = e.target.closest('[data-vis]');
    if (vb && vb.dataset.key) { (vb.dataset.key === 'alerts' ? live.alerts : live.plook).vis = vb.dataset.vis; commit(); return; }
    const b = e.target.closest('[data-tw]');
    if (!b) return;
    const k = b.closest('[data-k]') ? Number(b.closest('[data-k]').dataset.k) : -1;
    const msg = b.closest('[data-msg]');
    const clip = b.closest('[data-clip]') && b.closest('[data-clip]').dataset.clip;
    const val = (id) => (document.getElementById(id) || {}).value || '';
    const done = (text) => (r) => { if (r && text) Hub.toast(text, { tone: 'goal' }); redraw(); return r; };
    switch (b.dataset.tw) {
      case 'refresh': load('refresh').then(done('Checked.')); return;
      case 'title': load('title', { title: val('twTitle') }).then(done('Title saved on Twitch.')); return;
      case 'title-fav': { const t = val('twTitle').trim(); if (t && !live.titleFav.some((x) => x.t === t)) live.titleFav.unshift({ t }); break; }
      case 'use-title': document.getElementById('twTitle').value = live.titleFav[Number(b.dataset.i)].t; return;
      case 'cat-search': { const r = await load('cat-search', { q: val('twCatQ') }); cats = r ? r.list : []; redraw(); return; }
      case 'cat-pick': { const c = cats[Number(b.dataset.i)]; load('category', { id: c.id, name: c.name }).then(done(`Category set to ${c.name}.`)); return; }
      case 'cat-use': load('category', { id: b.dataset.id, name: b.dataset.name }).then(done(`Category set to ${b.dataset.name}.`)); return;
      case 'cat-fav': if (!live.catFav.some((c) => c.id === live.dash.catId)) live.catFav.unshift({ id: live.dash.catId, name: live.dash.cat }); break;
      case 'clip': load('clip').then(done('Asked Twitch for a clip. It shows here once Twitch confirms it.')); return;
      case 'marker': load('marker', { desc: val('twMarkDesc'), cat: val('twMarkCat') }).then(done('Marker added.')); return;
      case 'clip-copy': { const c = live.clips.find((x) => x.id === clip); navigator.clipboard.writeText(c.url).then(() => Hub.toast('Copied the clip link.')); return; }
      case 'clip-fav': { const c = live.clips.find((x) => x.id === clip); load('clip-edit', { id: clip, fav: !c.fav }); return; }
      case 'clip-del': if (arm(`c${clip}`)) load('clip-del', { id: clip }); return;
      case 'marker-del': load('marker-del', { id: b.closest('[data-mark]').dataset.mark }); return;
      case 'markers-csv': csv('markers.csv', [['Date', 'Stream time (s)', 'Note', 'Category', 'By']].concat(live.markers.map((m) => [new Date(m.at).toISOString(), m.pos, m.desc, m.cat, m.by]))); return;
      case 'chat-pause': chatPaused = !chatPaused; redraw(); return;
      case 'chat-clear': chat = []; redraw(); return;
      case 'chat-send': { const t = val('twSay').trim(); if (!t) return; const r = await load('chat-send', { text: t }); if (r) { document.getElementById('twSay').value = ''; Hub.toast('Sent.'); } return; }
      case 'mod-delete': load('mod-delete', { msg: msg.dataset.msg, login: msg.dataset.login }).then(done('Message deleted.')); return;
      case 'mod-timeout': load('mod-ban', { uid: msg.dataset.uid, login: msg.dataset.login, secs: 600, reason: 'Timed out from Overlay Hub' }).then(done(`${msg.dataset.login} timed out for 10 minutes.`)); return;
      case 'mod-ban': if (arm(`b${msg.dataset.uid}`)) load('mod-ban', { uid: msg.dataset.uid, login: msg.dataset.login, reason: 'Banned from Overlay Hub' }).then(done(`${msg.dataset.login} banned.`)); return;
      case 'feed-pause': feedPaused = !feedPaused; redraw(); return;
      case 'chatset-load': { const r = await load('chat-settings'); chatSet = r && r.settings; redraw(); return; }
      case 'cs-slow': case 'cs-follow': case 'cs-sub': case 'cs-emote': case 'cs-unique': {
        const s = chatSet;
        const set = { 'cs-slow': s.slow_mode ? { slow_mode: false } : { slow_mode: true, slow_mode_wait_time: Number(val('twSlow')) || 30 }, 'cs-follow': s.follower_mode ? { follower_mode: false } : { follower_mode: true, follower_mode_duration: Number(val('twFollowMin')) || 0 }, 'cs-sub': { subscriber_mode: !s.subscriber_mode }, 'cs-emote': { emote_mode: !s.emote_mode }, 'cs-unique': { unique_chat_mode: !s.unique_chat_mode } }[b.dataset.tw];
        const r = await load('chat-settings-set', { set });
        if (r) { chatSet = r.settings; Hub.toast('Chat mode changed on Twitch.'); redraw(); }
        return;
      }
      case 'rewards-load': { const r = await load('rewards'); rewards = r ? r.list : []; redraw(); return; }
      case 'reward-toggle': { const row = b.closest('[data-reward]'); const rw = rewards.find((x) => x.id === row.dataset.reward); if (await load('reward-toggle', { id: rw.id, on: !rw.on })) { rw.on = !rw.on; redraw(); } return; }
      case 'reward-create': { const r = await load('reward-create', { title: val('twRwTitle'), cost: Number(val('twRwCost')) }); if (r) { const l = await load('rewards'); rewards = l ? l.list : rewards; Hub.toast('Reward created on Twitch.'); redraw(); } return; }
      case 'redeem-load': { const id = b.closest('[data-reward]').dataset.reward; const r = await load('redemptions', { reward: id }); redeems = { reward: id, list: r ? r.list : [] }; redraw(); return; }
      case 'redeem-ok': case 'redeem-no': { const id = b.closest('[data-red]').dataset.red; if (await load('redeem-set', { reward: redeems.reward, id, status: b.dataset.tw === 'redeem-ok' ? 'FULFILLED' : 'CANCELED' })) { redeems.list = redeems.list.filter((x) => x.id !== id); redraw(); } return; }
      case 'link': { const title = b.closest('[data-reward]').dataset.title; const l = live.links.find((x) => x.title === title); if (l) l.on = !l.on; else live.links.push({ reward: b.closest('[data-reward]').dataset.reward, title, act: 'spin', on: true }); break; }
      case 'poll-create': load('poll-create', { title: val('twPollQ'), choices: [1, 2, 3, 4, 5].map((n) => val(`twPollA${n}`)), secs: Number(val('twPollS')) }).then(done('Poll started on Twitch.')); return;
      case 'poll-end': case 'poll-archive': load('poll-end', { archive: b.dataset.tw === 'poll-archive' }).then(done('Poll ended.')); return;
      case 'pred-create': load('pred-create', { title: val('twPredQ'), outcomes: [1, 2, 3].map((n) => val(`twPredA${n}`)), secs: Number(val('twPredS')) }).then(done('Prediction started.')); return;
      case 'pred-lock': load('pred-lock').then(done('Locked.')); return;
      case 'pred-win': if (arm(`w${b.dataset.id}`)) load('pred-resolve', { winner: b.dataset.id }).then(done('Paid out.')); return;
      case 'pred-cancel': if (arm('pc')) load('pred-cancel').then(done('Cancelled, points returned.')); return;
      case 'alert-on': live.alerts.on[b.dataset.k] = !live.alerts.on[b.dataset.k]; break;
      case 'alert-test': if (live.alerts.vis === 'off') Hub.toast('Set Alerts to Show preview to see the test.'); load('alert-test', { kind: b.dataset.k }); return;
      case 'alert-skip': load('alert-skip'); return;
      case 'tm-add': live.timers.push({ id: X.newId(), text: '', every: 20, minChat: 5, on: false, liveOnly: true, last: 0 }); break;
      case 'tm-on': live.timers[k].on = !live.timers[k].on; break;
      case 'tm-live': live.timers[k].liveOnly = !live.timers[k].liveOnly; break;
      case 'tm-del': if (!arm(`t${live.timers[k].id}`)) return; live.timers.splice(k, 1); break;
      case 'timer-send': load('timer-send', { id: live.timers[k].id }).then(done('Sent.')); return;
      case 'cm-add': { const n = b.dataset.name || ''; live.cmds.push({ id: X.newId(), name: n || `cmd${live.cmds.length + 1}`, resp: { socials: 'Find me everywhere: (add your links)', discord: 'Join the Discord: (add the invite)', schedule: 'Streams: (add your schedule)', goal: 'Help us hit the goal!', wheel: 'Every 5 subs spins the wheel!' }[n] || '', cool: 10, userCool: 30, level: 'all', on: false, uses: 0 }); break; }
      case 'cm-on': live.cmds[k].on = !live.cmds[k].on; break;
      case 'cm-del': if (!arm(`m${live.cmds[k].id}`)) return; live.cmds.splice(k, 1); break;
      case 'shout-search': { const r = await load('shout-search', { q: val('twShoutQ') }); chans = r ? r.list : []; redraw(); return; }
      case 'shoutout': { const c = chans[Number(b.dataset.i)]; load('shoutout', { id: c.id, name: c.name }).then(done(`Shoutout sent to ${c.name}.`)); return; }
      case 'stream-del': { const id = b.closest('[data-stream]').dataset.stream; if (arm(`s${id}`)) load('stream-del', { id }); return; }
      case 'streams-csv': csv('streams.csv', [['Start', 'End', 'Minutes', 'Peak viewers', 'Average viewers (sampled)', 'Subs', 'Follows', 'Bits', 'Clips', 'Markers', 'Titles', 'Categories']].concat(live.streams.map((x) => [new Date(x.start).toISOString(), x.end ? new Date(x.end).toISOString() : 'live', Math.round(((x.end || Date.now()) - x.start) / 60000), x.peak, x.n ? Math.round(x.sum / x.n) : 0, x.subs, x.follows, x.bits, x.clips, x.markers, x.titles.join(' | '), x.cats.join(' | ')]))); return;
      default: return;
    }
    commit();
  });
  view.addEventListener('input', (e) => {
    const t = e.target;
    const refocus = (id) => { const keep = t.selectionStart; redraw(); const n = document.getElementById(id); if (n) { n.focus(); n.setSelectionRange(keep, keep); } };
    if (t.id === 'twChatQ') { chatQ = t.value; refocus('twChatQ'); }
    if (t.id === 'twClipQ') { clipQ = t.value; refocus('twClipQ'); }
  });
  view.addEventListener('change', (e) => {
    if (!live) return;
    const t = e.target;
    if (t.id === 'twFeedF') { feedFilter = t.value; redraw(); return; }
    const p = t.dataset.twIn;
    if (!p) return;
    const k = t.closest('[data-k]') ? Number(t.closest('[data-k]').dataset.k) : -1;
    const v = Number(t.value);
    if (p === 'clip-note') { load('clip-edit', { id: t.closest('[data-clip]').dataset.clip, note: t.value }); return; }
    if (p === 'scale') (t.dataset.key === 'alerts' ? live.alerts : live.plook).scale = v / 100;
    else if (p === 'colour') (t.dataset.key === 'alerts' ? live.alerts : live.plook).color = t.value;
    else if (p.startsWith('al.')) live.alerts[p.slice(3)] = p === 'al.sound' ? t.value : v;
    else if (p.startsWith('tm.')) live.timers[k][p.slice(3)] = p === 'tm.text' ? t.value : v;
    else if (p.startsWith('cm.')) live.cmds[k][p.slice(3)] = ['cm.name', 'cm.resp', 'cm.level'].includes(p) ? (p === 'cm.name' ? t.value.toLowerCase().replace(/[^a-z0-9_]/g, '') : t.value) : v;
    else return;
    commit();
  });
})();
