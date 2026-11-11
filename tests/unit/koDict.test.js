const { lookup, candidates } = require('../../lib/koDict');

describe('koDict.lookup', () => {
  test('finds a word that is in the dictionary', () => {
    const r = lookup('poem');
    expect(r.word).toBe('poem');
    expect(r.entries.length).toBeGreaterThan(0);
    expect(r.entries[0].ko[0]).toMatch(/[가-힣]/);
  });

  test('is case-insensitive and trims', () => {
    expect(lookup('  Poem ').word).toBe('poem');
  });

  test('falls back to the base form of an irregular word', () => {
    const r = lookup('was');
    expect(r).not.toBeNull();
    expect(r.word).toBe('be');
  });

  test('falls back to the base form of a regular plural', () => {
    expect(lookup('poems').word).toBe('poem');
  });

  test('returns null for an unknown word or empty input', () => {
    expect(lookup('xqzvtyw')).toBeNull();
    expect(lookup('')).toBeNull();
    expect(lookup(undefined)).toBeNull();
  });

  test('pos labels are Korean or empty', () => {
    const r = lookup('a');
    for (const e of r.entries) expect(e.pos === '' || /[가-힣]/.test(e.pos)).toBe(true);
  });
});

describe('koDict data quality', () => {
  test('archaic words have Korean meanings and a 고어/시어 label', () => {
    for (const w of ['thee', 'thy', 'thou', 'hast', "o'er"]) {
      const r = lookup(w);
      expect(r).not.toBeNull();
      expect(r.entries[0].ko[0]).toMatch(/[가-힣]/);
      expect(r.entries.some((e) => ['고어', '시어'].includes(e.pos))).toBe(true);
    }
  });

  test('English definitions that were mixed into the Korean text are removed', () => {
    const text = JSON.stringify(lookup('from').entries);
    expect(text).not.toMatch(/provenance|starting point/);
    expect(JSON.stringify(lookup('one').entries)).not.toMatch(/impersonal pronoun\) One thing/);
  });

  test('a modern word keeps its normal meaning before the archaic one', () => {
    const r = lookup('art');
    expect(r.entries[0].pos).not.toBe('고어');
    expect(r.entries[r.entries.length - 1].pos).toBe('고어');
  });
});

describe('koDict source flag', () => {
  test('hand-written archaic entries are marked own, Wiktionary ones are not', () => {
    expect(lookup('thee').entries.every((e) => e.own === true)).toBe(true);
    expect(lookup('poem').entries.some((e) => e.own)).toBe(false);
    const art = lookup('art').entries;
    expect(art[0].own).toBeUndefined();
    expect(art[art.length - 1].own).toBe(true);
  });
});

describe('koDict.candidates', () => {
  test('lists the word itself first', () => {
    expect(candidates('running')[0]).toBe('running');
    expect(candidates('running')).toContain('run');
    expect(candidates('cities')).toContain('city');
  });
});

describe('koDict lemma rules (poems)', () => {
  const base = (w) => { const r = lookup(w); return r && r.word; };

  test('possessive, poetic elision, archaic endings', () => {
    expect(base("time's")).toBe('time');
    expect(base("gather'd")).toBe('gather');
    expect(base('abideth')).toBe('abide');
  });

  test('more irregular verbs and plurals', () => {
    expect(base('fled')).toBe('flee');
    expect(base('torn')).toBe('tear');
    expect(base('leaves')).toBe('leaf');
  });

  test('word-building suffixes', () => {
    expect(base('goodness')).toBe('good');
    expect(base('fruitless')).toBe('fruit');
  });

  test('short stems are not taken from a plain suffix strip', () => {
    // "hopes" is "hope", never "hop"; "notes" is "note", never "not"
    expect(base('hopes')).toBe('hope');
    expect(base('notes')).toBe('note');
    expect(candidates('hopes')).not.toContain('hop');
    expect(candidates('faded')).not.toContain('fad');
    expect(candidates('tied')).toContain('tie');
  });

  test('"-y" words are not stripped to a different word', () => {
    // "policy" is not "police", "weary" is not "wear" (they have their own entries now)
    expect(candidates('policy')).not.toContain('police');
    expect(candidates('weary')).not.toContain('wear');
    expect(base('policy')).toBe('policy');
    expect(base('weary')).toBe('weary');
  });

  test('a base form never matches a hand-written archaic entry', () => {
    // "wasted" must not turn into the archaic "wast"
    expect(base('wasted')).not.toBe('wast');
  });
});

describe('koDict hand-written poem words (ko_extra.json)', () => {
  const fs = require('fs');
  const path = require('path');
  const extra = JSON.parse(fs.readFileSync(path.join(__dirname, '../../scripts/ko_extra.json'), 'utf8'));

  test('every entry has a part of speech and a Korean meaning', () => {
    for (const [word, entries] of Object.entries(extra)) {
      expect(entries.length).toBeGreaterThan(0);
      for (const e of entries) {
        expect(e.pos).toMatch(/[가-힣]/);
        expect(e.ko.length).toBeGreaterThan(0);
        for (const k of e.ko) expect(k).toMatch(/[가-힣]/);
      }
    }
  });

  test('base words found, with no Wiktionary credit (own)', () => {
    for (const w of ['lyre', 'woe', 'farewell', 'no', 'much']) {
      const r = lookup(w);
      expect(r).not.toBeNull();
      expect(r.word).toBe(w);
      expect(r.entries.some((e) => e.own)).toBe(true);
    }
  });

  test('inflected forms find these base words', () => {
    expect(lookup('deeds').word).toBe('deed');
    expect(lookup('woes').word).toBe('woe');
    expect(lookup('wrinkles').word).toBe('wrinkle');
    expect(lookup('wearied').word).toBe('weary');
    expect(lookup('shone').word).toBe('shine');
    expect(lookup("tyranny's").word).toBe('tyranny');
  });
});

describe('top missing poem words (hand-written)', () => {
  const koDict = require('../../lib/koDict');
  test.each(['colour', 'coloured', 'glanced', 'appearances', 'mrs', "heav'nly", 'thro', 'quoth', "i've"])(
    '%s has a Korean meaning',
    (w) => {
      const r = koDict.lookup(w);
      expect(r).toBeTruthy();
      expect(r.entries.length).toBeGreaterThan(0);
    }
  );
});

describe('more frequent poem and book words (hand-written)', () => {
  const koDict = require('../../lib/koDict');
  test.each(['frantic', 'clasped', 'flickering', 'shrinking', 'reproach', 'tidings', 'jolly', 'churchyard',
    'thereon', 'methought', 'withdrew', 'stuck', 'overcame', 'enabled', 'hurriedly', 'tresses'])(
    '%s has a Korean meaning',
    (w) => {
      const r = koDict.lookup(w);
      expect(r).toBeTruthy();
      expect(r.entries.length).toBeGreaterThan(0);
    }
  );
});

describe('most common sense comes first (ko_first.json)', () => {
  const koDict = require('../../lib/koDict');
  const first = (w) => koDict.lookup(w).entries[0];
  test.each([
    ['are', 'be'], ['felt', 'feel'], ['fell', 'fall'], ['drew', 'draw'], ['led', 'lead'],
  ])('%s starts with the verb form of %s', (w, base) => {
    expect(first(w).pos).toBe('동사');
    expect(first(w).ko[0]).toContain(base);
  });
  test.each([['old', '형용사'], ['green', '형용사'], ['love', '명사'], ['face', '명사'], ['even', '부사']])(
    '%s starts with %s', (w, pos) => {
      expect(first(w).pos).toBe(pos);
    }
  );
  test('names and abbreviations are dropped when asked', () => {
    const joined = JSON.stringify(koDict.lookup('drew').entries) + JSON.stringify(koDict.lookup('led').entries);
    expect(joined).not.toContain('남자 이름');
    expect(joined).not.toContain('발광다이오드');
  });
  test('the old Wiktionary senses are still kept after the first ones', () => {
    expect(koDict.lookup('old').entries.length).toBeGreaterThan(1);
  });
});

