/*
  Twitch Centre on the server, using the shared Twitch connection (free, official API only).
  - Dashboard: checked once a minute per connected streamer (followers and subs every 10 minutes), cached and shared.
  - Stream history and viewer statistics are sampled from those checks, so they're labelled as samples.
  - Alerts are queued and shown one at a time; timed messages and commands send through Twitch's chat API with a
    gap between messages so chat never gets spammed.
  Every write action is the owner's (moderation and chat settings always), and nothing automatic starts On.
*/
const rid = () => Math.random().toString(36).slice(2, 10);

function createCentre({ twitch, streamers, changed, saveSoon, logActivity, onSpin }) {
  const T = (st) => st.modules.twitch;
  const me = (st) => twitch.userOf(st.id);
  const lines = new Map();      // chat lines since each timed message, per streamer
  const lastBot = new Map();    // last message we sent, per streamer (keeps a gap between messages)
  const cmdUse = new Map();     // command cooldowns
  const cool = new Map();       // alert cooldowns per kind
  let ticks = 0;
  const q = (o) => new URLSearchParams(o).toString();

  /* ---------- Dashboard, stream history and statistics ---------- */
  async function refresh(st, full) {
    const u = me(st);
    if (!u) return;
    const d = T(st).dash;
    try {
      const [live, ch] = await Promise.all([twitch.helix(st.id, 'GET', `/streams?${q({ user_id: u.userId })}`), twitch.helix(st.id, 'GET', `/channels?${q({ broadcaster_id: u.userId })}`)]);
      const s = (live.data || [])[0];
      const c = (ch.data || [])[0] || {};
      const was = d.live;
      Object.assign(d, { live: !!s, viewers: s ? s.viewer_count : 0, started: s ? Date.parse(s.started_at) : 0, title: c.title || (s && s.title) || '', cat: c.game_name || '', catId: c.game_id || '', at: Date.now(), err: '' });
      if (full) {
        const [f, sb] = await Promise.all([twitch.helix(st.id, 'GET', `/channels/followers?${q({ broadcaster_id: u.userId, first: 1 })}`).catch(() => null), twitch.helix(st.id, 'GET', `/subscriptions?${q({ broadcaster_id: u.userId, first: 1 })}`).catch(() => null)]);
        if (f) d.followers = f.total || 0;
        if (sb) d.subs = sb.total || 0;
      }
      session(st, d.live, was);
    } catch (e) { d.err = e.message; }
    changed(st, 'twitch');
  }
  // Opens a stream session when it goes live and closes it when it goes offline; samples viewers each minute
  function session(st, live, was) {
    const t = T(st);
    let open = t.streams.find((x) => x.open);
    if (live && !open) { open = { id: rid(), start: t.dash.started || Date.now(), end: 0, titles: [t.dash.title], cats: [t.dash.cat], subs: 0, follows: 0, bits: 0, clips: 0, markers: 0, peak: 0, sum: 0, n: 0, open: true }; t.streams.unshift(open); t.streams = t.streams.slice(0, 60); }
    if (open && live) {
      open.peak = Math.max(open.peak, t.dash.viewers); open.sum += t.dash.viewers; open.n += 1;
      if (t.dash.title && open.titles[open.titles.length - 1] !== t.dash.title) open.titles.push(t.dash.title);
      if (t.dash.cat && open.cats[open.cats.length - 1] !== t.dash.cat) open.cats.push(t.dash.cat);
    }
    if (open && !live && was !== undefined) { open.open = false; open.end = Date.now(); saveSoon(); }
  }
  // Official polls and predictions: live results every 5 s, only while one is running
  async function results(st) {
    const u = me(st);
    const d = T(st).dash;
    if (!u) return;
    try {
      if (d.poll && d.poll.status === 'ACTIVE') {
        const p = ((await twitch.helix(st.id, 'GET', `/polls?${q({ broadcaster_id: u.userId, id: d.poll.id })}`)).data || [])[0];
        if (p) { d.poll = pollOf(p); if (p.status !== 'ACTIVE') T(st).polls.unshift({ title: p.title, res: p.choices.map((c) => `${c.title} ${c.votes}`).join(', '), at: Date.now() }); changed(st, 'twitch'); }
      }
      if (d.pred && ['ACTIVE', 'LOCKED'].includes(d.pred.status)) {
        const p = ((await twitch.helix(st.id, 'GET', `/predictions?${q({ broadcaster_id: u.userId, id: d.pred.id })}`)).data || [])[0];
        if (p) { d.pred = predOf(p); changed(st, 'twitch'); }
      }
    } catch (e) { /* tried again in 5 s */ }
  }
  const pollOf = (p) => ({ id: p.id, title: p.title, status: p.status, ends: Date.parse(p.started_at) + p.duration * 1000, choices: p.choices.map((c) => ({ id: c.id, t: c.title, v: c.votes || 0 })) });
  const predOf = (p) => ({ id: p.id, title: p.title, status: p.status, ends: Date.parse(p.created_at) + p.prediction_window * 1000, outs: p.outcomes.map((o) => ({ id: o.id, t: o.title, users: o.users || 0, pts: o.channel_points || 0 })) });

  /* ---------- Events: alerts, stream history, channel point links ---------- */
  function onEvent(st, ev) {
    const t = T(st);
    const open = t.streams.find((x) => x.open);
    if (open) { if (['sub', 'resub', 'gift'].includes(ev.kind)) open.subs += ev.amount || 1; if (ev.kind === 'follow') open.follows += 1; if (ev.kind === 'bits') open.bits += ev.amount || 0; }
    if (ev.kind === 'online' || ev.kind === 'offline') setTimeout(() => refresh(st, false), 3000);
    if (ev.kind === 'redeem') t.links.filter((l) => l.on && l.title === ev.reward).forEach((l) => { if (l.act === 'spin' && onSpin) onSpin(st, `${ev.user}: ${ev.reward}`); });
    const al = t.alerts;
    if (al.on[ev.kind] && !(ev.kind === 'bits' && ev.amount < al.minBits) && !(al.cool && Date.now() - (cool.get(`${st.id}${ev.kind}`) || 0) < al.cool * 1000)) {
      cool.set(`${st.id}${ev.kind}`, Date.now());
      al.queue.push({ id: rid(), kind: ev.kind, user: ev.user, amount: ev.amount || 0, extra: ev.reward || ev.message || '', test: false });
      al.queue = al.queue.slice(-30);
      advance(st);
    }
    changed(st, 'twitch');
  }
  // One alert at a time: the next one starts when the last has finished
  function advance(st) {
    const al = T(st).alerts;
    if (al.cur && Date.now() - al.cur.at < al.dur * 1000 + 600) return false;
    const next = al.queue.shift();
    al.cur = next ? Object.assign(next, { at: Date.now() }) : null;
    if (next && !next.test) al.hist.unshift({ t: `${next.user} ${next.kind}${next.amount ? ` ${next.amount}` : ''}`, at: Date.now() });
    al.hist = al.hist.slice(0, 30);
    return true;
  }

  /* ---------- Chat: commands and timed messages ---------- */
  async function say(st, text, why) {
    const u = me(st);
    if (!u) throw new Error('Twitch isn’t connected.');
    const gap = Date.now() - (lastBot.get(st.id) || 0);
    if (gap < 2000) await new Promise((r) => setTimeout(r, 2000 - gap));
    lastBot.set(st.id, Date.now());
    const r = await twitch.helix(st.id, 'POST', '/chat/messages', { broadcaster_id: u.userId, sender_id: u.userId, message: String(text).slice(0, 450) });
    const ok = !!(r.data && r.data[0] && r.data[0].is_sent);
    T(st).chatHist.unshift({ t: `${why}: ${String(text).slice(0, 120)}${ok ? '' : ' (Twitch dropped it)'}`, at: Date.now(), ok });
    T(st).chatHist = T(st).chatHist.slice(0, 40);
    changed(st, 'twitch');
    return ok;
  }
  function onChat(st, m) {
    lines.set(st.id, (lines.get(st.id) || 0) + 1);
    if (!m.text.startsWith('!') || !me(st)) return;
    const name = m.text.slice(1).split(/\s+/)[0].toLowerCase();
    const c = T(st).cmds.find((x) => x.on && x.name === name);
    if (!c) return;
    const allowed = c.level === 'all' || (c.level === 'sub' && (m.sub || m.mod || m.vip)) || (c.level === 'mod' && m.mod) || (c.level === 'owner' && m.bc);
    if (!allowed) return;
    const now = Date.now();
    if (now - (cmdUse.get(`${st.id}:${c.id}`) || 0) < c.cool * 1000 || now - (cmdUse.get(`${st.id}:${c.id}:${m.login}`) || 0) < c.userCool * 1000) return;
    cmdUse.set(`${st.id}:${c.id}`, now);
    cmdUse.set(`${st.id}:${c.id}:${m.login}`, now);
    c.uses += 1;
    say(st, c.resp.replace(/\{user\}/gi, m.u), `!${c.name}`).catch(() => {});
  }
  function timedMessages(st) {
    const t = T(st);
    if (!me(st)) return;
    t.timers.filter((x) => x.on && x.text).forEach((x) => {
      if (x.liveOnly && !t.dash.live) return;
      if (Date.now() - x.last < x.every * 60000) return;
      if ((lines.get(st.id) || 0) < x.minChat) return;
      x.last = Date.now();
      lines.set(st.id, 0);
      say(st, x.text, 'Timed message').catch(() => {});
    });
  }

  /* ---------- The hub's buttons ---------- */
  async function act(st, a, b, who, actor) {
    const u = me(st);
    if (!u && !['alert-test', 'alert-skip', 'stream-del', 'clip-edit', 'clip-del', 'marker-edit', 'marker-del'].includes(a)) throw new Error('Connect Twitch first (Settings, Twitch).');
    const t = T(st);
    const bid = u && u.userId;
    // An editor moderates with their own linked Twitch account (actor); the owner with the streamer's
    const hk = actor ? actor.key : st.id;
    const mod = { broadcaster_id: bid, moderator_id: actor ? actor.uid : bid };
    switch (a) {
      case 'refresh': await refresh(st, true); return {};
      case 'title': {
        const title = String(b.title || '').trim().slice(0, 140);
        if (!title) throw new Error('Type a title.');
        try { await twitch.helix(st.id, 'PATCH', `/channels?${q({ broadcaster_id: bid })}`, { title }); } catch (e) { t.titleHist.unshift({ t: title, by: who, at: Date.now(), ok: false }); changed(st, 'twitch'); throw new Error(`Twitch rejected the title: ${e.message}`); }
        t.dash.title = title; t.titleHist.unshift({ t: title, by: who, at: Date.now(), ok: true }); t.titleHist = t.titleHist.slice(0, 30);
        logActivity(st, who, `Changed the Twitch title to “${title}”`);
        return {};
      }
      case 'cat-search': return { list: ((await twitch.helix(st.id, 'GET', `/search/categories?${q({ query: String(b.q || '').slice(0, 60), first: 10 })}`)).data || []).map((c) => ({ id: c.id, name: c.name })) };
      case 'category': {
        await twitch.helix(st.id, 'PATCH', `/channels?${q({ broadcaster_id: bid })}`, { game_id: String(b.id) });
        Object.assign(t.dash, { cat: String(b.name || ''), catId: String(b.id) });
        t.catHist.unshift({ id: String(b.id), name: String(b.name || ''), by: who, at: Date.now() }); t.catHist = t.catHist.slice(0, 30);
        logActivity(st, who, `Changed the Twitch category to ${b.name}`);
        return {};
      }
      case 'clip': {
        const r = await twitch.helix(st.id, 'POST', `/clips?${q({ broadcaster_id: bid })}`);
        const c = (r.data || [])[0];
        if (!c) throw new Error('Twitch didn’t make a clip.');
        const clip = { id: c.id, url: `https://clips.twitch.tv/${c.id}`, at: Date.now(), by: who, title: '', note: String(b.note || '').slice(0, 200), cat: String(b.cat || '').slice(0, 30), fav: false, state: 'pending' };
        t.clips.unshift(clip);
        const open = t.streams.find((x) => x.open);
        if (open) open.clips += 1;
        // Only say it's made once Twitch confirms it (Twitch takes a few seconds; no clip after 15 s means it failed)
        setTimeout(async () => {
          try { const g = ((await twitch.helix(st.id, 'GET', `/clips?${q({ id: c.id })}`)).data || [])[0]; const x = t.clips.find((y) => y.id === c.id); if (x) { x.state = g ? 'ready' : 'failed'; if (g) { x.url = g.url || x.url; x.title = g.title || ''; } } } catch (e) { const x = t.clips.find((y) => y.id === c.id); if (x) x.state = 'failed'; }
          changed(st, 'twitch'); saveSoon();
        }, Number(process.env.CLIP_CHECK_MS) || 15000);
        return { id: c.id };
      }
      case 'marker': {
        const r = await twitch.helix(st.id, 'POST', '/streams/markers', { user_id: bid, description: String(b.desc || '').slice(0, 140) });
        const m = (r.data || [])[0] || {};
        const open = t.streams.find((x) => x.open);
        t.markers.unshift({ id: m.id || rid(), desc: String(b.desc || '').slice(0, 140), cat: String(b.cat || '').slice(0, 30), pos: m.position_seconds || 0, at: Date.now(), by: who, stream: open ? open.id : '' });
        if (open) open.markers += 1;
        return {};
      }
      case 'chat-send': { const ok = await say(st, String(b.text || '').trim(), who); if (!ok) throw new Error('Twitch didn’t send it (it may break a chat rule).'); return {}; }
      case 'mod-delete': await twitch.helix(hk, 'DELETE', `/moderation/chat?${q(Object.assign({ message_id: String(b.msg) }, mod))}`); modLog(st, who, `Deleted a message from ${b.login}`); return {};
      case 'mod-ban': {
        const secs = Math.round(Number(b.secs) || 0);
        await twitch.helix(hk, 'POST', `/moderation/bans?${q(mod)}`, { data: Object.assign({ user_id: String(b.uid), reason: String(b.reason || '').slice(0, 500) }, secs ? { duration: Math.min(1209600, Math.max(1, secs)) } : {}) });
        modLog(st, who, secs ? `Timed out ${b.login} for ${secs}s` : `Banned ${b.login}`);
        return {};
      }
      case 'mod-unban': await twitch.helix(hk, 'DELETE', `/moderation/bans?${q(Object.assign({ user_id: String(b.uid) }, mod))}`); modLog(st, who, `Unbanned ${b.login}`); return {};
      case 'chat-settings': return { settings: ((await twitch.helix(st.id, 'GET', `/chat/settings?${q(mod)}`)).data || [])[0] || {} };
      case 'chat-settings-set': {
        const allow = ['slow_mode', 'slow_mode_wait_time', 'follower_mode', 'follower_mode_duration', 'subscriber_mode', 'emote_mode', 'unique_chat_mode'];
        const body = {};
        Object.entries(b.set || {}).forEach(([k, v]) => { if (allow.includes(k)) body[k] = v; });
        const r = ((await twitch.helix(hk, 'PATCH', `/chat/settings?${q(mod)}`, body)).data || [])[0] || {};
        modLog(st, who, `Changed chat settings (${Object.keys(body).join(', ')})`);
        return { settings: r };
      }
      case 'rewards': {
        const [all, mine] = await Promise.all([twitch.helix(st.id, 'GET', `/channel_points/custom_rewards?${q({ broadcaster_id: bid })}`), twitch.helix(st.id, 'GET', `/channel_points/custom_rewards?${q({ broadcaster_id: bid, only_manageable_rewards: true })}`).catch(() => ({ data: [] }))]);
        const ours = new Set((mine.data || []).map((x) => x.id));
        return { list: (all.data || []).map((x) => ({ id: x.id, title: x.title, cost: x.cost, on: x.is_enabled, ours: ours.has(x.id) })) };
      }
      case 'reward-create': { const r = await twitch.helix(st.id, 'POST', `/channel_points/custom_rewards?${q({ broadcaster_id: bid })}`, { title: String(b.title || '').slice(0, 45), cost: Math.max(1, Number(b.cost) || 100), prompt: String(b.prompt || '').slice(0, 200), is_enabled: true }); return { id: ((r.data || [])[0] || {}).id }; }
      case 'reward-toggle': await twitch.helix(st.id, 'PATCH', `/channel_points/custom_rewards?${q({ broadcaster_id: bid, id: String(b.id) })}`, { is_enabled: !!b.on }); return {};
      case 'redemptions': return { list: ((await twitch.helix(st.id, 'GET', `/channel_points/custom_rewards/redemptions?${q({ broadcaster_id: bid, reward_id: String(b.reward), status: 'UNFULFILLED', first: 20 })}`)).data || []).map((x) => ({ id: x.id, user: x.user_name, text: x.user_input || '', at: Date.parse(x.redeemed_at) })) };
      case 'redeem-set': await twitch.helix(st.id, 'PATCH', `/channel_points/custom_rewards/redemptions?${q({ broadcaster_id: bid, reward_id: String(b.reward), id: String(b.id) })}`, { status: b.status === 'CANCELED' ? 'CANCELED' : 'FULFILLED' }); return {};
      case 'poll-create': {
        const choices = (b.choices || []).map((c) => String(c).trim().slice(0, 25)).filter(Boolean).slice(0, 5);
        if (!String(b.title || '').trim() || choices.length < 2) throw new Error('A poll needs a question and at least 2 answers.');
        const p = ((await twitch.helix(st.id, 'POST', '/polls', { broadcaster_id: bid, title: String(b.title).slice(0, 60), choices: choices.map((title) => ({ title })), duration: Math.min(1800, Math.max(15, Number(b.secs) || 60)) })).data || [])[0];
        if (p) t.dash.poll = pollOf(p);
        return {};
      }
      case 'poll-end': { if (!t.dash.poll) throw new Error('No poll is running.'); const p = ((await twitch.helix(st.id, 'PATCH', '/polls', { broadcaster_id: bid, id: t.dash.poll.id, status: b.archive ? 'ARCHIVED' : 'TERMINATED' })).data || [])[0]; if (p) { t.dash.poll = pollOf(p); t.polls.unshift({ title: p.title, res: p.choices.map((c) => `${c.title} ${c.votes || 0}`).join(', '), at: Date.now() }); } return {}; }
      case 'pred-create': {
        const outs = (b.outcomes || []).map((c) => String(c).trim().slice(0, 25)).filter(Boolean).slice(0, 10);
        if (!String(b.title || '').trim() || outs.length < 2) throw new Error('A prediction needs a question and at least 2 outcomes.');
        const p = ((await twitch.helix(st.id, 'POST', '/predictions', { broadcaster_id: bid, title: String(b.title).slice(0, 45), outcomes: outs.map((title) => ({ title })), prediction_window: Math.min(1800, Math.max(30, Number(b.secs) || 120)) })).data || [])[0];
        if (p) t.dash.pred = predOf(p);
        return {};
      }
      case 'pred-lock': case 'pred-resolve': case 'pred-cancel': {
        if (!t.dash.pred) throw new Error('No prediction is running.');
        const status = { 'pred-lock': 'LOCKED', 'pred-resolve': 'RESOLVED', 'pred-cancel': 'CANCELED' }[a];
        const p = ((await twitch.helix(st.id, 'PATCH', '/predictions', Object.assign({ broadcaster_id: bid, id: t.dash.pred.id, status }, status === 'RESOLVED' ? { winning_outcome_id: String(b.winner) } : {}))).data || [])[0];
        if (p) { t.dash.pred = predOf(p); if (status !== 'LOCKED') t.preds.unshift({ title: p.title, res: status === 'CANCELED' ? 'Cancelled, points returned' : `Winner: ${(p.outcomes.find((o) => o.id === p.winning_outcome_id) || {}).title || ''}`, at: Date.now() }); }
        logActivity(st, who, `Prediction ${status.toLowerCase()}`);
        return {};
      }
      case 'shout-search': return { list: ((await twitch.helix(st.id, 'GET', `/search/channels?${q({ query: String(b.q || '').slice(0, 40), first: 8 })}`)).data || []).map((c) => ({ id: c.id, login: c.broadcaster_login, name: c.display_name, live: c.is_live })) };
      case 'shoutout': {
        try { await twitch.helix(st.id, 'POST', `/chat/shoutouts?${q({ from_broadcaster_id: bid, to_broadcaster_id: String(b.id), moderator_id: bid })}`); t.shouts.unshift({ to: String(b.name || ''), ok: true, msg: '', at: Date.now() }); }
        catch (e) { t.shouts.unshift({ to: String(b.name || ''), ok: false, msg: e.status === 429 ? 'Twitch cooldown: 2 min between shoutouts, 1 hour for the same channel' : e.message, at: Date.now() }); changed(st, 'twitch'); throw new Error(t.shouts[0].msg); }
        return {};
      }
      case 'alert-test': { t.alerts.queue.push({ id: rid(), kind: String(b.kind || 'follow'), user: 'Test viewer', amount: b.kind === 'bits' ? 500 : b.kind === 'gift' ? 5 : b.kind === 'raid' ? 42 : 1, extra: '', test: true }); advance(st); return {}; }
      case 'alert-skip': t.alerts.cur = null; advance(st); return {};
      case 'timer-send': { const x = t.timers.find((y) => y.id === b.id); if (!x || !x.text) throw new Error('That message is empty.'); x.last = Date.now(); await say(st, x.text, 'Sent by hand'); return {}; }
      case 'stream-del': t.streams = t.streams.filter((x) => x.id !== b.id); return {};
      case 'clip-edit': { const x = t.clips.find((y) => y.id === b.id); if (!x) throw new Error('That clip has gone.'); if ('note' in b) x.note = String(b.note).slice(0, 200); if ('cat' in b) x.cat = String(b.cat).slice(0, 30); if ('fav' in b) x.fav = !!b.fav; return {}; }
      case 'clip-del': t.clips = t.clips.filter((x) => x.id !== b.id); return {};
      case 'marker-edit': { const x = t.markers.find((y) => y.id === b.id); if (!x) throw new Error('That marker has gone.'); if ('cat' in b) x.cat = String(b.cat).slice(0, 30); if ('desc' in b) x.desc = String(b.desc).slice(0, 140); return {}; }
      case 'marker-del': t.markers = t.markers.filter((x) => x.id !== b.id); return {};
      default: throw new Error('Unknown action.');
    }
  }
  function modLog(st, who, text) { T(st).modHist.unshift({ t: text, by: who, at: Date.now() }); T(st).modHist = T(st).modHist.slice(0, 40); logActivity(st, who, text); }

  // The loops: alerts twice a second, results every 5 s, timed messages every 30 s, the dashboard every minute
  setInterval(() => streamers.forEach((st) => { if (T(st) && (T(st).alerts.cur || T(st).alerts.queue.length) && advance(st)) changed(st, 'twitch'); }), 500);
  setInterval(() => streamers.forEach((st) => { const d = T(st) && T(st).dash; if (d && ((d.poll && d.poll.status === 'ACTIVE') || (d.pred && ['ACTIVE', 'LOCKED'].includes(d.pred.status)))) results(st); }), 5000);
  setInterval(() => streamers.forEach((st) => { if (T(st)) timedMessages(st); }), 30000);
  const dashLoop = () => { ticks += 1; streamers.forEach((st) => { if (T(st) && me(st)) refresh(st, ticks % 10 === 1); }); };
  setTimeout(dashLoop, 5000);
  setInterval(dashLoop, Number(process.env.DASH_MS) || 60000);
  return { act, onEvent, onChat, refresh };
}
module.exports = { createCentre };
