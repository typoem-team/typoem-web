// lib/koDict.js
// English → Korean word meanings, read from data/ko_dict.jsonl.
//
// The data comes from the Korean edition of Wiktionary (via kaikki.org), so
// the entries are licensed CC BY-SA — see the credit in README.md and privacy.html.
// Entries with own:true are the archaic/poetic words the team wrote by hand
// (scripts/ko_archaic.json); they are NOT from Wiktionary and the popup credits
// them separately. Rebuild the files with scripts/build_ko_dict.py.
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
        return e.own ? { pos, ko: e.ko, own: true } : { pos, ko: e.ko };
      });
      dict.set(row.word, entries);
    }
    irregular = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'ko_irregular.json'), 'utf8'));
  } catch (err) {
    console.error('Korean dictionary data not loaded:', err.message);
  }
}

// Possible base forms of an inflected word, most likely first.
function candidates(word) {
  const c = [word];
  if (irregular[word]) c.push(irregular[word]);
  if (word.endsWith('ies')) c.push(word.slice(0, -3) + 'y');
  if (word.endsWith('es')) c.push(word.slice(0, -2));
  if (word.endsWith('s')) c.push(word.slice(0, -1));
  if (word.endsWith('ed')) {
    c.push(word.slice(0, -2), word.slice(0, -1));
    if (word.length > 4 && word[word.length - 3] === word[word.length - 4]) c.push(word.slice(0, -3));
  }
  if (word.endsWith('ing')) {
    c.push(word.slice(0, -3), word.slice(0, -3) + 'e');
    if (word.length > 5 && word[word.length - 4] === word[word.length - 5]) c.push(word.slice(0, -4));
  }
  if (word.endsWith('er')) c.push(word.slice(0, -2), word.slice(0, -1));
  if (word.endsWith('ly')) c.push(word.slice(0, -2));
  return c;
}

// Returns { word, entries } for the word itself or its base form, or null.
// `word` in the result is the word that was actually found (e.g. "be" for "was").
function lookup(rawWord) {
  load();
  const word = String(rawWord || '').toLowerCase().trim();
  if (!word) return null;
  for (const cand of candidates(word)) {
    const entries = dict.get(cand);
    if (entries && entries.length) return { word: cand, entries };
  }
  return null;
}

module.exports = { lookup, candidates };
