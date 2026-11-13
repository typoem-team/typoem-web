const { findWords, quoteOf, ROOMS, POEMS } = require("../../scripts/seed-demo");

describe("seed-demo", () => {
    test("findWords: word positions the way the screen numbers them", () => {
        expect(findWords("Afterwards -- day!", "day!")).toEqual([1, 1]);
        expect(findWords("Then there 's a pair of us -- don't tell!", "don't tell")).toEqual([7, 8]); // "'s" counts as the word "s"
        expect(findWords("A word is dead", "is alive")).toBeNull();
    });

    test("quoteOf: punctuation outside the words dropped, -- shown as an em dash", () => {
        expect(quoteOf("Afterwards -- day!")).toBe("Afterwards — day");
        expect(quoteOf("“There is no frigate like a book,”")).toBe("There is no frigate like a book");
    });

    test("every poem fits one screen and every poem mark is on its line", () => {
        for (const p of Object.values(POEMS)) expect(p.lines.length).toBeLessThanOrEqual(10);
        for (const room of ROOMS) for (const d of room.days) for (const a of d.acts) {
            const m = a.hl || a.note;
            if (m) expect(findWords(POEMS[d.poem].lines[m.line - 1], m.phrase)).not.toBeNull();
        }
    });
});
