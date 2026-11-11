// scripts/word-coverage.js
//
// Measures how many of the words readers can tap in Typoem have a Korean meaning
// (lib/koDict.js), and lists the ones that do not, most frequent first.
//
// It reads the same sources the app does:
//   - poems: every poem in PoetryDB (https://poetrydb.org), the pool the daily poem comes from
//   - books: the Gutenberg books in data/bookShelf.json, downloaded with lib/bookFetch.js
//
// Run it on a computer that can reach those sites (a Claude/AI sandbox usually cannot):
//   node scripts/word-coverage.js                  # poems + books, writes ./word-coverage-out/
//   node scripts/word-coverage.js --poems-only
//   node scripts/word-coverage.js --books-only
//   node scripts/word-coverage.js --offline        # only data/poems.json (the offline fallback), no network
//   node scripts/word-coverage.js --out some/dir --top 2000
//
// Output (in the --out folder):
//   missing_words.json   words without a Korean meaning, most frequent first
//   summary.json         coverage numbers per source
// Give missing_words.json to whoever writes the meanings (see scripts/ko_extra.json).

const fs = require('fs');
const path = require('path');
const koDict = require('../lib/koDict');

const ROOT = path.join(__dirname, '..');
const POETRYDB = 'https://poetrydb.org';
const DELAY_MS = 300;           // be polite to the free APIs
const REQUEST_TIMEOUT = 30000;

// ---------- pure helpers (unit tested) ----------

// Splits text into word tokens. Keeps inner apostrophes ("time's", "gather'd"),
// turns curly quotes into straight ones, and notes whether a word is capitalised
// in the middle of a sentence (a sign of a name: "Athens", "Moore").
function tokenise(text) {
  const t = String(text || '').replace(/[’‘]/g, "'");
  const out = [];
  const re = /[A-Za-z]+(?:'[A-Za-z]+)*/g;
  let m;
  while ((m = re.exec(t))) {
    const raw = m[0];
    if (raw.length === 1 && !/^[aAiI]$/.test(raw)) continue;
    // sentence start = beginning of a line or right after . ! ? " (ignoring spaces)
    const before = t.slice(Math.max(0, m.index - 3), m.index).replace(/[ \t]+$/g, '');
    const sentenceStart = before === '' || /[\n.!?"“]$/.test(before);
    out.push({
      word: raw.toLowerCase(),
      midCap: /^[A-Z]/.test(raw) && !sentenceStart && raw !== 'I',
    });
  }
  return out;
}

// Adds the tokens of `text` to a Map: word -> { count, midCap }.
function countWords(text, map = new Map()) {
  for (const { word, midCap } of tokenise(text)) {
    const e = map.get(word) || { count: 0, midCap: 0 };
    e.count += 1;
    if (midCap) e.midCap += 1;
    map.set(word, e);
  }
  return map;
}

// Coverage of one Map against koDict: unique words and occurrences with / without a meaning.
function coverage(map, lookup = koDict.lookup) {
  let uniq = 0, uniqHit = 0, tok = 0, tokHit = 0;
  const missing = [];
  for (const [word, e] of map) {
    uniq += 1; tok += e.count;
    if (lookup(word)) { uniqHit += 1; tokHit += e.count; }
    else missing.push({ word, count: e.count, likelyName: e.midCap >= 2 && e.midCap >= e.count * 0.6 });
  }
  return { uniq, uniqHit, tok, tokHit, missing };
}

const pct = (a, b) => (b ? (100 * a / b).toFixed(1) + '%' : '-');

// ---------- network ----------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT) });
      if (res.ok) return await res.json();
      if (res.status === 404) return null;
    } catch (err) { /* retry */ }
    await sleep(1000 * attempt);
  }
  return null;
}

async function loadPoems() {
  const list = await getJson(`${POETRYDB}/author`);
  if (!list || !Array.isArray(list.authors)) throw new Error('PoetryDB author list could not be loaded');
  const poems = [];
  let i = 0;
  for (const name of list.authors) {
    i += 1;
    const data = await getJson(`${POETRYDB}/author/${encodeURIComponent(name)}:abs/title,lines`);
    if (Array.isArray(data)) poems.push(...data);
    else console.warn(`  skipped author: ${name}`);
    if (i % 20 === 0) console.log(`  poems: ${i}/${list.authors.length} authors, ${poems.length} poems`);
    await sleep(DELAY_MS);
  }
  return poems;
}

function loadOfflinePoems() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'poems.json'), 'utf8'));
}

async function loadBooks() {
  const bookFetch = require('../lib/bookFetch');
  const shelf = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'bookShelf.json'), 'utf8'));
  const books = [];
  for (const b of shelf) {
    let text = null;
    for (let attempt = 1; attempt <= 2 && !text; attempt++) {
      const meta = await bookFetch.getBookMeta(b.gutenbergId);
      if (meta.ok) {
        const t = await bookFetch.fetchBookText(meta.meta);
        if (t.ok) text = bookFetch.stripGutenberg(t.text);
      }
      if (!text) await sleep(2000);
    }
    if (text) { books.push({ id: b.gutenbergId, title: b.title, text }); console.log(`  book ok: ${b.title}`); }
    else console.warn(`  book FAILED: ${b.title} (${b.gutenbergId})`);
    await sleep(DELAY_MS);
  }
  return books;
}

// ---------- main ----------

async function main() {
  const args = process.argv.slice(2);
  const flag = (n) => args.includes(n);
  const val = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
  const out = path.resolve(val('--out', 'word-coverage-out'));
  const top = parseInt(val('--top', '1500'), 10);
  const offline = flag('--offline');
  const doPoems = !flag('--books-only');
  const doBooks = !flag('--poems-only') && !offline;

  const sources = {};   // name -> Map
  if (doPoems) {
    console.log(offline ? 'Reading data/poems.json (offline)...' : 'Downloading poems from PoetryDB...');
    const poems = offline ? loadOfflinePoems() : await loadPoems();
    const map = new Map();
    for (const p of poems) countWords([p.title, ...(p.lines || [])].join('\n'), map);
    sources.poems = map;
    console.log(`  ${poems.length} poems`);
  }
  if (doBooks) {
    console.log('Downloading books from Project Gutenberg...');
    for (const b of await loadBooks()) sources[`book:${b.id} ${b.title}`] = countWords(b.text);
  }

  // all sources together
  const all = new Map();
  for (const m of Object.values(sources)) {
    for (const [w, e] of m) {
      const a = all.get(w) || { count: 0, midCap: 0, by: {} };
      a.count += e.count; a.midCap += e.midCap;
      all.set(w, a);
    }
  }
  for (const [name, m] of Object.entries(sources)) {
    for (const [w, e] of m) all.get(w).by[name] = e.count;
  }

  const summary = {};
  for (const [name, m] of [...Object.entries(sources), ['ALL', all]]) {
    const c = coverage(m);
    summary[name] = {
      uniqueWords: c.uniq, withKorean: c.uniqHit, uniqueCoverage: pct(c.uniqHit, c.uniq),
      occurrences: c.tok, occurrenceCoverage: pct(c.tokHit, c.tok),
    };
  }
  const missing = coverage(all).missing
    .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word))
    .slice(0, top)
    .map((m) => ({ ...m, by: all.get(m.word).by }));

  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(out, 'missing_words.json'), JSON.stringify(missing, null, 1));

  console.log('\nCoverage (words with a Korean meaning):');
  for (const [name, s] of Object.entries(summary)) {
    console.log(`  ${name}: ${s.uniqueCoverage} of ${s.uniqueWords} unique words, ${s.occurrenceCoverage} of ${s.occurrences} occurrences`);
  }
  const names = missing.filter((m) => m.likelyName).length;
  console.log(`\nWrote ${missing.length} missing words (${names} look like names) to ${out}`);
  console.log('Most frequent:', missing.slice(0, 25).map((m) => `${m.word}:${m.count}`).join(' '));
}

module.exports = { tokenise, countWords, coverage };

if (require.main === module) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
