// lib/koDict.js
// English → Korean word meanings, read from data/ko_dict.jsonl.
//
// The data comes from the Korean edition of Wiktionary (via kaikki.org), so
// the entries are licensed CC BY-SA — see the credit in README.md and privacy.html.
// Rebuild the files with scripts/build_ko_dict.py.
//
// The file is small (~1.6 MB), so it is loaded into memory on the first lookup:
// no database table and no extra deploy step. If the file is missing, lookups
// just return null and the dictionary keeps working without Korean meanings.

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');

let dict = null;        // Map: word -> [{ pos, ko: [string] }]
let irregular = null;   // Object: "was" -> "be"

const POS_FIX = { article: '관사', unknown: '' };

function load() {
  if (dict) return;
  dict = new Map();
  irregular = {};
  try {
    const text = fs.readFileSync(path.join(DATA_DIR, 'ko_dict.jsonl'), 'utf8');
    for (const line of text.split('\n')) {
      if (!line) continue;
      const row = JSON.parse(line);
      const entries = row.ko.map((e) => {
        let pos = e.pos in POS_FIX ? POS_FIX[e.pos] : e.pos;
        if (pos && !/[가-힣]/.test(pos)) pos = '';   // keep only Korean labels
        return { pos, ko: e.ko };
      });
      dict.set(row.word, entries);
    }
    irregular = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'ko_irregular.json'), 'utf8'));
  } catch (err) {
    console.error('Korean dictionary data not loaded:', err.message);
  }
}

// Possible base forms of an inflected word, most likely first.
// Rules: irregular table, possessive 's, poetic 'd (gather'd), -eth/-est verbs,
// plural/past/-ing, comparatives, and a few suffixes (-ful, -less, -ness).
//
// Short consonant-vowel-consonant stems (fad, hop, cop, pal) are NOT taken from a
// plain suffix strip: "faded" is "fade" and "hopes" is "hope", never "fad"/"hop".
// If the real base word is missing from the dictionary we would rather show
// nothing than the meaning of a different word.
const risky = (stem) => stem.length <= 3 && /^[^aeiou][aeiou][^aeiou]$/.test(stem);

function candidates(word) {
  const c = [word];
  const add = (...xs) => { for (const x of xs) if (x && x.length >= 2) c.push(x); };
  const addStem = (x) => { if (!risky(x)) add(x); };   // bare stem after stripping a suffix

  const stem = (w) => {                      // plural / past / -ing / -er / -ly rules
    if (irregular[w]) add(irregular[w]);
    if (w.endsWith('ies')) {
      if (w.length <= 4) add(w.slice(0, -1));          // ties -> tie
      add(w.slice(0, -3) + 'y');
    }
    if (w.endsWith('ves')) add(w.slice(0, -3) + 'f', w.slice(0, -3) + 'fe');
    if (w.endsWith('s')) add(w.slice(0, -1));          // notes -> note, roses -> rose
    if (w.endsWith('es') && /(s|x|z|ch|sh|o)es$/.test(w)) addStem(w.slice(0, -2));   // boxes -> box
    if (w.endsWith('ed')) {
      add(w.slice(0, -1));                             // faded -> fade
      addStem(w.slice(0, -2));                         // looked -> look
      if (w.length > 4 && w[w.length - 3] === w[w.length - 4]) add(w.slice(0, -3));   // stopped -> stop
    }
    if (w.endsWith('ied')) add(w.slice(0, -3) + 'y');  // carried -> carry (after "tied" -> "tie")
    if (w.endsWith('ing')) {
      add(w.slice(0, -3) + 'e');                       // hoping -> hope
      addStem(w.slice(0, -3));                         // looking -> look
      if (w.length > 5 && w[w.length - 4] === w[w.length - 5]) add(w.slice(0, -4));   // running -> run
    }
    if (w.endsWith('ier') && w.length > 5) add(w.slice(0, -3) + 'y');
    if (w.endsWith('iest') && w.length > 6) add(w.slice(0, -4) + 'y');
    if (w.endsWith('est')) { add(w.slice(0, -2)); addStem(w.slice(0, -3)); }   // fairest -> fair
    if (w.endsWith('er')) { add(w.slice(0, -1)); addStem(w.slice(0, -2)); }    // paler -> pale
    if (w.endsWith('ly')) addStem(w.slice(0, -2));
  };

  // possessive: time's -> time, friends' -> friends
  let w = word;
  if (w.endsWith("'s")) { w = w.slice(0, -2); add(w); }
  else if (w.endsWith("s'")) { w = w.slice(0, -1); add(w); }

  // poetic elision: gather'd -> gathered, defac'd -> defaced (not i'd / you'd)
  if (w.endsWith("'d") && w.length >= 6) { w = w.slice(0, -2) + 'ed'; add(w); }

  // archaic verb endings: abideth -> abide, lovest -> love
  if (w.endsWith('eth') && w.length > 5) add(w.slice(0, -2), w.slice(0, -3));
  if (w.endsWith('est') && w.length > 5) add(w.slice(0, -2), w.slice(0, -3));

  stem(w);

  // word-building suffixes
  if (w.endsWith('ful') || w.endsWith('less')) add(w.slice(0, w.endsWith('ful') ? -3 : -4));
  if (w.endsWith('ness')) {
    add(w.slice(0, -4));
    if (w.endsWith('iness')) add(w.slice(0, -5) + 'y');
  }
  return [...new Set(c)];
}

// Returns { word, entries } for the word itself or its base form, or null.
// `word` in the result is the word that was actually found (e.g. "be" for "was").
// A base form is matched only against normal dictionary entries: the hand-written
// archaic ones (own) belong to the exact spelling ("wast" is not "wasted").
function lookup(rawWord) {
  load();
  const word = String(rawWord || '').toLowerCase().trim();
  if (!word) return null;
  for (const cand of candidates(word)) {
    let entries = dict.get(cand);
    if (entries && cand !== word) entries = entries.filter((e) => !e.own);
    if (entries && entries.length) return { word: cand, entries };
  }
  return null;
}

module.exports = { lookup, candidates };
