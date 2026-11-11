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

describe('koDict.candidates', () => {
  test('lists the word itself first', () => {
    expect(candidates('running')[0]).toBe('running');
    expect(candidates('running')).toContain('run');
    expect(candidates('cities')).toContain('city');
  });
});
