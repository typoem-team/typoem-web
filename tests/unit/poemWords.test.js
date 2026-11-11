// lib/poemWords.js must split a line into the same words public/room.js wrapWords()
// turns into .word spans (poem_marks word indexes depend on it).
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { lineWords, wordCount } = require("../../lib/poemWords");

// Pull wrapWords / wrapInline / wrapWordChunk out of public/room.js (browser code) and run them
// in a sandbox, so the test fails if room.js changes its split rules without lib/poemWords.js.
function loadRoomWrapWords() {
    const src = fs.readFileSync(path.join(__dirname, "../../public/room.js"), "utf8");
    const fnSource = (name) => {
        const start = src.indexOf(`function ${name}(`);
        if (start < 0) throw new Error(`${name} not found in room.js`);
        let depth = 0;
        for (let i = src.indexOf("{", start); i < src.length; i++) {
            if (src[i] === "{") depth++;
            else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
        }
        throw new Error(`unbalanced ${name}`);
    };
    const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
    const sandbox = { esc };
    vm.runInNewContext(["wrapWords", "wrapInline", "wrapWordChunk"].map(fnSource).join("\n")
        + "\nthis.wrapWords = wrapWords;", sandbox);
    return sandbox.wrapWords;
}
// the .word spans' text, in order
function roomWords(wrapWords, text) {
    return [...wrapWords(text).matchAll(/<span class="word" data-word="[^"]*">([^<]*)<\/span>/g)]
        .map((m) => m[1].replace(/&#39;/g, "'"));
}

describe("lineWords", () => {
    const wrapWords = loadRoomWrapWords();

    test("matches room.js on every line of the offline poem pool", () => {
        const pool = require("../../data/poems.json");
        for (const p of pool) {
            for (const line of p.lines) expect([line, lineWords(line)]).toEqual([line, roomWords(wrapWords, line)]);
        }
    });

    test.each([
        ["plain words", "Whose woods these are I think I know.", ["Whose", "woods", "these", "are", "I", "think", "I", "know"]],
        ["punctuation is stripped off the ends", "\"And,\" (she said)", ["And", "she", "said"]],
        ["apostrophes and hyphens stay inside a word", "o'er the well-known ’tis-bound", ["o'er", "the", "well-known", "tis-bound"]],
        ["double hyphen becomes a dash between two words", "here--there", ["here", "there"]],
        ["em dash between words", "here—there — gone", ["here", "there", "gone"]],
        ["a lone dash is not a word", "wait - now", ["wait", "now"]],
        ["paired _italics_ are words", "a _very_ dark night", ["a", "very", "dark", "night"]],
        ["italics glued to text split into separate segments", "foo_bar_baz", ["foo", "bar", "baz"]],
        ["a chunk with an unpaired underscore inside is not a word", "a_b c", ["c"]],
        ["several spaces", "  two   words  ", ["two", "words"]],
        ["digits count as words", "In 1914 we", ["In", "1914", "we"]],
    ])("%s", (_label, text, expected) => {
        expect(lineWords(text)).toEqual(expected);
        expect(roomWords(wrapWords, text)).toEqual(expected); // same as the screen
    });

    test("blank and punctuation-only lines have no words", () => {
        expect(wordCount("")).toBe(0);
        expect(wordCount("   ")).toBe(0);
        expect(wordCount("— ... !")).toBe(0);
        expect(wordCount(null)).toBe(0);
    });
});
