/*
  The chat games on the server: Contexto, the flag game, the poll and the giveaway.
  - Contexto ranks every guess against a secret word using a small word-meaning file (20,000 common words, about 1 MB),
    so it's free and needs no outside service. #1 is the word itself.
  - The flag game shows a flag; the first person in chat to name the country wins the point.
  - The poll counts one vote per person (they can change it); the giveaway collects one entry per person.
  The secret Contexto word and the giveaway entrants stay in the server's memory, never in what pages are sent.
*/
const fs = require('fs');
const path = require('path');

// Everyday words that make good secrets (any that aren't in the word list are skipped)
const SECRETS = ('beach music coffee dream garden winter summer river mountain island forest city train ocean window kitchen doctor school ' +
  'teacher guitar camera candle bridge castle planet rocket dragon pirate jungle desert volcano rainbow thunder pizza bread cheese chocolate ' +
  'apple orange banana sugar honey butter market money wallet ticket airport hotel holiday birthday wedding party dance movie theatre ' +
  'stadium football trophy goal referee captain coach player league champion medal winner tiger lion horse rabbit monkey eagle shark whale ' +
  'snake spider garden flower tree grass cloud storm snow fire smoke light shadow mirror clock phone laptop keyboard robot engine bicycle ' +
  'motorbike truck boat ship anchor island bottle glass plate spoon knife fork pillow blanket shoes jacket hat crown king queen prince ' +
  'princess knight sword shield magic ghost zombie vampire wizard treasure diamond gold silver coin bank prison police hospital church ' +
  'library museum painting artist poet song singer drummer piano violin festival concert radio television newspaper letter stamp map').split(' ');

function normText(s) {
  return String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim().replace(/^the /, '');
}

function createEngine(dir) {
  const words = fs.readFileSync(path.join(dir, 'contexto.txt'), 'utf8').split('\n');
  const raw = fs.readFileSync(path.join(dir, 'contexto.bin'));
  const vec = new Int8Array(raw.buffer, raw.byteOffset, raw.length);
  const D = vec.length / words.length;
  const index = new Map(words.map((w, i) => [w, i]));
  const secrets = Array.from(new Set(SECRETS)).filter((w) => index.has(w));
  const countries = JSON.parse(fs.readFileSync(path.join(dir, 'countries.json'), 'utf8'));
  const codes = Object.keys(countries);

  // The word list entry for a guess, allowing simple plurals ("goals" counts as "goal")
  function find(word) {
    const w = normText(word).replace(/ /g, '');
    if (index.has(w)) return index.get(w);
    for (const cut of ['es', 's']) if (w.endsWith(cut) && index.has(w.slice(0, -cut.length))) return index.get(w.slice(0, -cut.length));
    return -1;
  }
  // Every word's position against the secret: 1 is the secret itself
  function ranksFor(si) {
    const n = words.length;
    const sims = new Float64Array(n);
    for (let i = 0; i < n; i += 1) {
      let d = 0;
      for (let k = 0; k < D; k += 1) d += vec[i * D + k] * vec[si * D + k];
      sims[i] = d;
    }
    const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => sims[b] - sims[a]);
    const at = order.indexOf(si);
    if (at > 0) { order.splice(at, 1); order.unshift(si); }
    const rank = new Int32Array(n);
    order.forEach((idx, pos) => { rank[idx] = pos + 1; });
    return { rank, order };
  }

  return {
    wordCount: words.length,
    secrets,
    // Starts a Contexto round with a word the host typed, or a random one
    contextoStart(mem, word) {
      const si = word ? find(word) : index.get(secrets[Math.floor(Math.random() * secrets.length)]);
      if (si === undefined || si < 0) return { ok: false, error: 'That word isn’t in the word list. Try a more common word, or tap Random.' };
      const r = ranksFor(si);
      Object.assign(mem, { secret: si, rank: r.rank, order: r.order, guessed: new Set() });
      return { ok: true, word: words[si] };
    },
    contextoGuess(mem, text) {
      if (!mem.rank) return null;
      // A plural of the secret word counts as the word itself
      const plain = normText(text).replace(/ /g, '');
      const sec = words[mem.secret];
      if (plain === `${sec}s` || plain === `${sec}es`) return { w: sec, r: 1 };
      const i = find(text);
      if (i < 0) return null;
      return { w: words[i], r: mem.rank[i] };
    },
    // A hint: a word about halfway between the best guess so far and the secret, not guessed yet
    contextoHint(mem, best) {
      if (!mem.order) return null;
      let target = Math.max(2, Math.floor((best || 3000) / 2));
      while (target > 1 && mem.guessed.has(words[mem.order[target - 1]])) target -= 1;
      if (target < 2) return null;
      return { w: words[mem.order[target - 1]], r: target };
    },
    secretWord(mem) { return mem.secret >= 0 && mem.rank ? words[mem.secret] : ''; },
    flagPick(prev) {
      let code = prev;
      while (code === prev) code = codes[Math.floor(Math.random() * codes.length)];
      return code;
    },
    countryName(code) { return (countries[code] || [''])[0]; },
    flagMatch(code, text) { const t = normText(text); return !!t && (countries[code] || []).slice(1).includes(t); },
  };
}

// One chat message against one streamer's games. Returns true if anything changed.
function handleChat(s, mem, m, engine) {
  const text = String(m.text || '').trim();
  const lower = text.toLowerCase();
  let changed = false;
  if (!mem.voters) Object.assign(mem, { voters: new Map(), entrants: new Map() });
  // Poll: type 1, 2, 3 or 4; one vote each, and you can change it
  const vote = /^!?(?:vote\s*)?([1-4])$/.exec(lower);
  if (s.poll.open && vote && s.poll.opts[Number(vote[1]) - 1]) {
    mem.voters.set(m.login, Number(vote[1]) - 1);
    const v = [0, 0, 0, 0];
    mem.voters.forEach((x) => { v[x] += 1; });
    s.poll.votes = v;
    return true;
  }
  // Giveaway: one entry each
  if (s.give.open && lower === (s.give.word || '!join').toLowerCase()) {
    if (!mem.entrants.has(m.login)) { mem.entrants.set(m.login, m.u); s.give.entries = mem.entrants.size; changed = true; }
    return changed;
  }
  // Word games: any single word counts, or only "!g word" if the host switched that on
  const bang = /^!g(?:uess)?\s+(.+)$/i.exec(text);
  const guess = bang ? bang[1] : s.mode !== 'bang' && /^[\p{L}' .-]{2,40}$/u.test(text) ? text : '';
  if (!guess) return false;
  if (s.contexto.open && /^[\p{L}]+$/u.test(guess.trim())) {
    const g = engine.contextoGuess(mem, guess);
    if (g && !mem.guessed.has(g.w)) {
      mem.guessed.add(g.w);
      s.contexto.count += 1;
      s.contexto.last = { w: g.w, r: g.r, u: m.u };
      s.contexto.guesses = s.contexto.guesses.concat({ w: g.w, r: g.r, u: m.u }).sort((a, b) => a.r - b.r).slice(0, 10);
      if (g.r === 1) { s.contexto.winner = { u: m.u, w: g.w }; s.contexto.open = false; }
      changed = true;
    }
  }
  if (s.flags.open && s.flags.code && engine.flagMatch(s.flags.code, guess)) {
    s.flags.winner = { u: m.u, name: engine.countryName(s.flags.code) };
    s.flags.open = false;
    const board = s.flags.board.slice();
    const e = board.find((x) => x.u === m.u);
    if (e) e.pts += 1; else board.push({ u: m.u, pts: 1 });
    s.flags.board = board.sort((a, b) => b.pts - a.pts).slice(0, 10);
    changed = true;
  }
  return changed;
}

module.exports = { createEngine, handleChat, normText };
