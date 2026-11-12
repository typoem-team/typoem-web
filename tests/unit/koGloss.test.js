const { tidyGloss, tidyEntries } = require('../../lib/koGloss');
const { lookup } = require('../../lib/koDict');

describe('tidyGloss', () => {
  test.each([
    ['(식사 등을) 하다, 들다;(음식물을) 먹다 (★ 진행형·수동형 가능)', '(식사 등을) 하다, 들다, (음식물을) 먹다'],
    ['(물적 소유[소지]의 뜻으로) 가지고 있다', '(물적 소유의 뜻으로) 가지고 있다'],
    ['거류지, 조차지(租借地), 조계(租界)', '거류지, 조차지, 조계'],
    ['(배[船]의) 측면.', '(배의) 측면.'],
    ['보통주 주권(普通株 株券)', '보통주 주권'],
    ['절친한 [믿을 만한] 친구', '절친한 친구'],
    ['따르다, 준수하다 «with»', '따르다, 준수하다'],
    ['법령, 율령(律令), 포고 〔An edict or law.〕', '법령, 율령, 포고'],
    ['(어떤 행사에) 오다[가다], (come to do, come do(미국, 비격식), come and do) (~하러) 오다', '(어떤 행사에) 오다, (~하러) 오다'],
    ['U (법) 형평법', '(법) 형평법'],
    ['가산 (법원의) 결정, 판결', '(법원의) 결정, 판결'],
    ['[보통 pl.] (그리스도교) 세정식', '(그리스도교) 세정식'],
    ['고장, [컴퓨터] 기능 불량', '고장, (컴퓨터) 기능 불량'],
    ['(격식) 반환할(환불받을) 수 있는', '(격식) 반환할(환불받을) 수 있는'],   // Korean hints stay
    ['광산 / 탄광(炭鑛)', '광산 / 탄광'],
    ['sth | ~ sth (액체에) 살짝 담그다[적시다]', '(액체에) 살짝 담그다'],
    ['sb (구식) 견습생[도제]으로 삼다', '(구식) 견습생으로 삼다'],
    ['(英) 진행자', '(영국) 진행자'],
    ['(특히 美) 만나다', '(특히 미국) 만나다'],
    ['미술(美術)', '미술'],
  ])('%s', (before, after) => {
    expect(tidyGloss(before)).toBe(after);
  });

  test('is idempotent', () => {
    for (const s of ['(배[船]의) 측면.', '오다[가다]; 와서', 'U (법) 형평법 «with»']) {
      expect(tidyGloss(tidyGloss(s))).toBe(tidyGloss(s));
    }
  });
});

describe('tidyEntries', () => {
  test('tidies Wiktionary meanings, leaves team-written ones, drops entries left empty', () => {
    const out = tidyEntries([
      { pos: '명사', ko: ['조계(租界)', '〔An edict.〕'] },
      { pos: '고어', ko: ['너[당신]'], own: true },
      { pos: '동사', ko: ['«with»'] },
    ]);
    expect(out).toEqual([
      { pos: '명사', ko: ['조계'] },
      { pos: '고어', ko: ['너[당신]'], own: true },
    ]);
  });

  test('passes through what is not a list', () => {
    expect(tidyEntries(null)).toBeNull();
  });
});

test('the dictionary serves tidied meanings ("have")', () => {
  const senses = lookup('have').entries.flatMap((e) => e.ko).join(' | ');
  expect(senses).toContain('(물적 소유의 뜻으로) 가지고 있다');
  expect(senses).not.toMatch(/★|\[소지\]/);
});
