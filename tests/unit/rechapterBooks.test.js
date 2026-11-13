const { alignParagraphs } = require("../../scripts/rechapter-books");

const S = (...texts) => texts.map((text, idx) => ({ id: 100 + idx, idx, text }));

describe("alignParagraphs", () => {
    test("same paragraphs, new chapters: idx unchanged, chapter_idx follows the new split", () => {
        const a = alignParagraphs(S("a", "b", "c"), [{ paragraphs: ["a", "b"] }, { paragraphs: ["c"] }]);
        expect(a.kept).toEqual([
            { id: 100, idx: 0, chapter_idx: 0, oldIdx: 0 },
            { id: 101, idx: 1, chapter_idx: 0, oldIdx: 1 },
            { id: 102, idx: 2, chapter_idx: 1, oldIdx: 2 },
        ]);
        expect(a.dropped).toEqual([]);
        expect(a.map).toEqual([0, 1, 2]);
    });

    test("dropped paragraphs shift later idx down; a position on one moves to the next kept", () => {
        const a = alignParagraphs(S("Contents", "I. Intro", "a", "II. Next", "b"), [{ paragraphs: ["a"] }, { paragraphs: ["b"] }]);
        expect(a.dropped.map((d) => d.text)).toEqual(["Contents", "I. Intro", "II. Next"]);
        expect(a.map).toEqual([0, 0, 0, 1, 1]);
        expect(a.kept.map((k) => [k.id, k.idx, k.chapter_idx])).toEqual([[102, 0, 0], [104, 1, 1]]);
    });

    test("dropped tail maps to the last kept paragraph", () => {
        expect(alignParagraphs(S("a", "b", "end"), [{ paragraphs: ["a", "b"] }]).map).toEqual([0, 1, 1]);
    });

    test("a new paragraph that isn't stored -> null", () => {
        expect(alignParagraphs(S("a", "b"), [{ paragraphs: ["a", "x"] }])).toBeNull();
    });
});
