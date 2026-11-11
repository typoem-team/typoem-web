const { tokenise, countWords, coverage } = require('../../scripts/word-coverage');

describe('word-coverage tokenise', () => {
  test("lowercases and keeps inner apostrophes", () => {
    expect(tokenise("Time's gather'd ’twas").map((t) => t.word)).toEqual(["time's", "gather'd", 'twas']);
  });

  test('curly apostrophes are treated as straight ones', () => {
    expect(tokenise('don’t').map((t) => t.word)).toEqual(["don't"]);
  });

  test('drops one-letter words except a and I', () => {
    expect(tokenise('a b I c').map((t) => t.word)).toEqual(['a', 'i']);
  });

  test('flags capitalised words in the middle of a sentence', () => {
    const t = tokenise('Farewell to Athens.\nThe sea.');
    const by = Object.fromEntries(t.map((x) => [x.word, x.midCap]));
    expect(by.farewell).toBe(false);   // start of a line
    expect(by.athens).toBe(true);      // mid-sentence capital
    expect(by.the).toBe(false);
  });
});

describe('word-coverage counting', () => {
  test('countWords counts occurrences and mid-sentence capitals', () => {
    const m = countWords('Moore met Moore. Then Moore left.');
    expect(m.get('moore').count).toBe(3);
    expect(m.get('moore').midCap).toBe(2);
  });

  test('coverage splits words with and without a Korean meaning', () => {
    const m = countWords('poem poem xqzvtyw');
    const c = coverage(m, (w) => (w === 'poem' ? { word: 'poem' } : null));
    expect(c).toMatchObject({ uniq: 2, uniqHit: 1, tok: 3, tokHit: 2 });
    expect(c.missing).toEqual([{ word: 'xqzvtyw', count: 1, likelyName: false }]);
  });

  test('names that are always capitalised mid-sentence are flagged', () => {
    const m = countWords('See Dante. Ask Dante. Hear Dante.');
    const c = coverage(m, () => null);
    expect(c.missing.find((x) => x.word === 'dante').likelyName).toBe(true);
  });
});
