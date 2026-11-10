// Unit tests for lib/bookFetch.js.
// Pure parsing / copyright helpers, plus the network helpers with global.fetch mocked.
// Nothing here talks to the real Gutendex or gutenberg.org.

const bf = require("../../lib/bookFetch");

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
const person = (death_year) => ({ name: "Someone", death_year });

// n paragraphs of `words` words each, separated by blank lines
function body(n, words = 5, tag = "p") {
    return Array.from({ length: n }, (_, i) =>
        Array.from({ length: words }, (_, w) => `${tag}${i}w${w}`).join(" ")
    ).join("\n\n");
}

function gutenberg(text) {
    return [
        "The Project Gutenberg eBook of Test",
        "This eBook is for the use of anyone anywhere.",
        "",
        "*** START OF THE PROJECT GUTENBERG EBOOK TEST ***",
        text,
        "*** END OF THE PROJECT GUTENBERG EBOOK TEST ***",
        "",
        "Section 1. General Terms of Use and Redistributing Project Gutenberg",
    ].join("\n");
}

// fake fetch Response
function response({ status = 200, json, text, bytes, contentType = "application/json", url = "" } = {}) {
    return {
        ok: status >= 200 && status < 300,
        status,
        url,
        headers: { get: (h) => (h.toLowerCase() === "content-type" ? contentType : null) },
        json: async () => json,
        arrayBuffer: async () => {
            const buf = bytes || Buffer.from(text || "", "utf-8");
            return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
        },
    };
}

// ---------------------------------------------------------------------------
// isKoreaPublicDomain
// ---------------------------------------------------------------------------
describe("isKoreaPublicDomain", () => {
    test("author died 1817 -> true", () => {
        expect(bf.isKoreaPublicDomain({ authors: [person(1817)] })).toBe(true);
    });

    test("author died 1962 -> true (boundary)", () => {
        expect(bf.isKoreaPublicDomain({ authors: [person(1962)] })).toBe(true);
    });

    test("author died 1963 -> false (protected until 2033)", () => {
        expect(bf.isKoreaPublicDomain({ authors: [person(1963)] })).toBe(false);
    });

    test("old author but translator died 1970 -> false", () => {
        expect(bf.isKoreaPublicDomain({ authors: [person(1821)], translators: [person(1970)] })).toBe(false);
    });

    test("old author and old translator -> true", () => {
        expect(bf.isKoreaPublicDomain({ authors: [person(1821)], translators: [person(1900)] })).toBe(true);
    });

    test("unknown death year -> false", () => {
        expect(bf.isKoreaPublicDomain({ authors: [person(null)] })).toBe(false);
        expect(bf.isKoreaPublicDomain({ authors: [person(1800), person(null)] })).toBe(false);
        expect(bf.isKoreaPublicDomain({ authors: [person(1800)], translators: [person(null)] })).toBe(false);
    });

    test("no authors -> false", () => {
        expect(bf.isKoreaPublicDomain({ authors: [] })).toBe(false);
        expect(bf.isKoreaPublicDomain({})).toBe(false);
        expect(bf.isKoreaPublicDomain(null)).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// stripGutenberg
// ---------------------------------------------------------------------------
describe("stripGutenberg", () => {
    test("removes the header and the license", () => {
        const out = bf.stripGutenberg(gutenberg("Hello body."));
        expect(out).toContain("Hello body.");
        expect(out).not.toMatch(/Project Gutenberg/i);
        expect(out).not.toMatch(/General Terms/);
        expect(out).not.toContain("***");
    });

    test("handles BOM and CRLF line endings", () => {
        const raw = "﻿" + gutenberg("Line one\nline two\n\nNext.").replace(/\n/g, "\r\n");
        const out = bf.stripGutenberg(raw);
        expect(out.startsWith("﻿")).toBe(false);
        expect(out).not.toContain("\r");
        expect(out).toContain("Line one\nline two\n\nNext.");
    });

    test("accepts the older 'THIS PROJECT GUTENBERG' markers", () => {
        const raw = "head\n*** START OF THIS PROJECT GUTENBERG EBOOK X ***\nBody.\n*** END OF THIS PROJECT GUTENBERG EBOOK X ***\nlicense";
        expect(bf.stripGutenberg(raw).trim()).toBe("Body.");
    });

    test("text without markers is returned as-is (normalised)", () => {
        expect(bf.stripGutenberg("a\r\nb")).toBe("a\nb");
    });
});

// ---------------------------------------------------------------------------
// isHeading
// ---------------------------------------------------------------------------
describe("isHeading", () => {
    test.each([
        "CHAPTER I.",
        "Chapter 1",
        "CHAPTER XIII",
        "CHAPTER I. Down the Rabbit-Hole",
        "Book the First--Recalled to Life",
        "STAVE ONE",
        "Letter 4",
        "PART TWENTY-ONE",
        "IV",
        "XII.",
        "I. A SCANDAL IN BOHEMIA",
    ])("heading: %s", (s) => {
        expect(bf.isHeading(s)).toBe(true);
    });

    test.each([
        "Part of it was gone.",
        "part one of the plan",              // keyword not capitalised
        "Letter from Jane arrived today.",
        "Vivid.",                            // only roman letters, not a numeral
        "Mild.",
        "IIII",                              // invalid roman numeral
        "I. Then she said hello",            // roman + mixed-case prose
        "CHAPTER I. " + "x".repeat(80),      // too long
        "",
    ])("not a heading: %s", (s) => {
        expect(bf.isHeading(s)).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// toParagraphs
// ---------------------------------------------------------------------------
describe("toParagraphs", () => {
    test("joins wrapped lines, collapses spaces and removes _emphasis_", () => {
        const paras = bf.toParagraphs("It was  the _best_\nof times.\n\n\n  Second   one.  ");
        expect(paras).toEqual([
            { text: "It was the best of times.", heading: false },
            { text: "Second one.", heading: false },
        ]);
    });

    test("marks chapter headings", () => {
        const paras = bf.toParagraphs("CHAPTER I.\n\nText.");
        expect(paras[0]).toEqual({ text: "CHAPTER I.", heading: true });
        expect(paras[1].heading).toBe(false);
    });

    test("drops single-block, multi-block and nested [Illustration] blocks", () => {
        const text = [
            "Before.",
            "[Illustration]",
            "[Illustration: “Without once opening his lips”]",
            "[Illustration:\n\n     “A note for Miss Bennet”\n\n[_Copyright 1894 by George Allen._]]",
            "After.",
        ].join("\n\n");
        expect(bf.toParagraphs(text).map((p) => p.text)).toEqual(["Before.", "After."]);
    });

    test("keeps a chapter heading hidden inside an illustration (1342 style)", () => {
        const text = "[Illustration: ·PRIDE AND PREJUDICE·\n\n\n\n\nChapter I.]\n\n\nIt is a truth.";
        expect(bf.toParagraphs(text)).toEqual([
            { text: "Chapter I.", heading: true },
            { text: "It is a truth.", heading: false },
        ]);
    });

    test("removes inline illustrations but keeps the paragraph", () => {
        const paras = bf.toParagraphs("He smiled. [Illustration: A smile] Then left.");
        expect(paras).toEqual([{ text: "He smiled. Then left.", heading: false }]);
    });

    test("drops transcriber's notes", () => {
        const text = "Body.\n\n[Transcriber’s Note: fixed typos.\n\nMore of the note.]\n\nTranscriber's note: another.\n\nEnd.";
        expect(bf.toParagraphs(text).map((p) => p.text)).toEqual(["Body.", "End."]);
    });

    test("ordinary prose mentioning an illustration is kept", () => {
        const paras = bf.toParagraphs("“Merely to the illustration of your character,” said she.");
        expect(paras).toHaveLength(1);
    });
});

// ---------------------------------------------------------------------------
// splitChapters
// ---------------------------------------------------------------------------
describe("splitChapters", () => {
    const P = (text) => ({ text, heading: false });
    const H = (text) => ({ text, heading: true });

    test("drops front matter before the first heading and strips headings from the body", () => {
        const { chapters, totalWords } = bf.splitChapters([
            P("Title page"), P("Preface words here"),
            H("CHAPTER I."), P("one two"), P("three"),
            H("CHAPTER II."), P("four five six"),
        ]);
        expect(chapters).toEqual([
            { title: "CHAPTER I.", paragraphs: ["one two", "three"] },
            { title: "CHAPTER II.", paragraphs: ["four five six"] },
        ]);
        expect(totalWords).toBe(6);
    });

    test("skips a table of contents when the first heading appears again", () => {
        const long = body(40, 10);
        const paras = bf.toParagraphs(
            ["Contents", "CHAPTER I", "CHAPTER II", "CHAPTER I.", long, "CHAPTER II.", long].join("\n\n")
        );
        const { chapters } = bf.splitChapters(paras);
        expect(chapters.map((c) => c.title)).toEqual(["CHAPTER I.", "CHAPTER II."]);
        expect(chapters[0].paragraphs).toHaveLength(40);
    });

    test("does not treat a big first part as a table of contents (chapter numbers restart)", () => {
        const long = body(30, 10);
        const paras = bf.toParagraphs(
            ["CHAPTER I.", long, "CHAPTER II.", long, "CHAPTER I.", long].join("\n\n")
        );
        const { chapters } = bf.splitChapters(paras);
        expect(chapters).toHaveLength(3);
    });

    test("merges empty headings into the next title (BOOK I — CHAPTER I)", () => {
        const { chapters } = bf.splitChapters([
            H("BOOK I"), H("CHAPTER I."), P("a"),
            H("CHAPTER II."), P("b"),
            H("CHAPTER III."), // trailing heading with no text is dropped
        ]);
        expect(chapters.map((c) => c.title)).toEqual(["BOOK I — CHAPTER I.", "CHAPTER II."]);
    });

    test("a book without headings becomes pseudo-chapters with null titles", () => {
        const n = bf.PSEUDO_CHAPTER_SIZE * 2 + 10;
        const paras = Array.from({ length: n }, (_, i) => P(`para ${i}`));
        const { chapters, totalWords } = bf.splitChapters(paras);
        expect(chapters.map((c) => c.paragraphs.length)).toEqual([bf.PSEUDO_CHAPTER_SIZE, bf.PSEUDO_CHAPTER_SIZE, 10]);
        expect(chapters.every((c) => c.title === null)).toBe(true);
        expect(totalWords).toBe(n * 2);
    });

    test("totalWords equals the sum of body paragraph words (headings excluded)", () => {
        const text = ["Front matter is ignored here.", "CHAPTER I.", body(20, 7), "CHAPTER II.", body(15, 3)].join("\n\n");
        const { chapters, totalWords } = bf.splitChapters(bf.toParagraphs(text));
        const sum = chapters.flatMap((c) => c.paragraphs).reduce((n, t) => n + bf.wordCount(t), 0);
        expect(totalWords).toBe(sum);
        expect(totalWords).toBe(20 * 7 + 15 * 3);
    });
});

// ---------------------------------------------------------------------------
// parseBook
// ---------------------------------------------------------------------------
describe("parseBook", () => {
    test("parses a full Gutenberg file", () => {
        const text = ["CHAPTER I.", body(30), "[Illustration]", "CHAPTER II.", body(30)].join("\n\n");
        const r = bf.parseBook(gutenberg(text));
        expect(r.ok).toBe(true);
        expect(r.chapters).toHaveLength(2);
        expect(r.totalParagraphs).toBe(60);
        expect(r.totalWords).toBe(300);
    });

    test("rejects fewer than 50 paragraphs", () => {
        const r = bf.parseBook(gutenberg(["CHAPTER I.", body(49)].join("\n\n")));
        expect(r).toMatchObject({ ok: false, error: "too_short", totalParagraphs: 49 });
    });

    test("rejects more than 200,000 words", () => {
        const r = bf.parseBook(gutenberg(["CHAPTER I.", body(100, 2001)].join("\n\n")));
        expect(r).toMatchObject({ ok: false, error: "too_long" });
        expect(r.totalWords).toBeGreaterThan(bf.MAX_WORDS);
    });
});

// ---------------------------------------------------------------------------
// formats / decoding
// ---------------------------------------------------------------------------
describe("pickTextFormat / decodeText", () => {
    test("prefers utf-8 plain text", () => {
        const f = bf.pickTextFormat({
            "text/html": "h",
            "text/plain; charset=us-ascii": "a",
            "text/plain; charset=utf-8": "u",
        });
        expect(f).toEqual({ key: "text/plain; charset=utf-8", url: "u" });
    });

    test("falls back to any text/plain, ignores zips, null when none", () => {
        expect(bf.pickTextFormat({ "text/plain; charset=us-ascii": "a" }).url).toBe("a");
        expect(bf.pickTextFormat({ "text/plain": "x.zip" })).toBeNull();
        expect(bf.pickTextFormat({ "text/html": "h" })).toBeNull();
        expect(bf.pickTextFormat(undefined)).toBeNull();
    });

    test("decodes using the declared charset", () => {
        const latin1 = Buffer.from([0x63, 0x61, 0x66, 0xe9]); // "café" in ISO-8859-1
        expect(bf.decodeText(latin1, "text/plain; charset=iso-8859-1")).toBe("café");
        expect(bf.decodeText(latin1, null, "text/plain; charset=iso-8859-1")).toBe("café");
        expect(bf.decodeText(Buffer.from("café", "utf-8"), "text/plain")).toBe("café");
        expect(bf.decodeText(Buffer.from("ok"), "text/plain; charset=bogus-charset")).toBe("ok");
    });
});

// ---------------------------------------------------------------------------
// network helpers (global.fetch mocked)
// ---------------------------------------------------------------------------
describe("network helpers", () => {
    let fetchSpy;
    const ENV = { ...process.env };

    beforeEach(() => {
        fetchSpy = jest.spyOn(global, "fetch");
        delete process.env.GUTENDEX_URL;
        delete process.env.GUTENBERG_MIRROR;
    });

    afterEach(() => {
        fetchSpy.mockRestore();
        process.env = { ...ENV };
    });

    test("searchBooks calls Gutendex with the right filters and a User-Agent", async () => {
        fetchSpy.mockResolvedValue(response({ json: { count: 1, results: [{ id: 1342 }] } }));
        const r = await bf.searchBooks("pride & prejudice");
        expect(r).toEqual({ ok: true, results: [{ id: 1342 }], count: 1 });

        const [url, opts] = fetchSpy.mock.calls[0];
        const u = new URL(url);
        expect(u.origin + u.pathname).toBe("https://gutendex.com/books/");
        expect(u.searchParams.get("search")).toBe("pride & prejudice");
        expect(u.searchParams.get("languages")).toBe("en");
        expect(u.searchParams.get("copyright")).toBe("false");
        expect(u.searchParams.get("mime_type")).toBe("text/plain");
        expect(opts.headers["User-Agent"]).toMatch(/Typoem/);
        expect(opts.signal).toBeDefined();
    });

    test("GUTENDEX_URL overrides the base URL", async () => {
        process.env.GUTENDEX_URL = "http://localhost:9999/";
        fetchSpy.mockResolvedValue(response({ json: { id: 84, formats: {} } }));
        await bf.getBookMeta(84);
        expect(fetchSpy.mock.calls[0][0]).toBe("http://localhost:9999/books/84");
    });

    test("HTTP errors are reported, not thrown", async () => {
        fetchSpy.mockResolvedValue(response({ status: 404, json: { detail: "Not found." } }));
        await expect(bf.getBookMeta(999999)).resolves.toEqual({ ok: false, error: "http", status: 404 });
    });

    test("timeouts and network errors are reported, not thrown", async () => {
        fetchSpy.mockRejectedValueOnce(Object.assign(new Error("aborted"), { name: "AbortError" }));
        await expect(bf.searchBooks("x")).resolves.toEqual({ ok: false, error: "timeout" });

        fetchSpy.mockRejectedValueOnce(new TypeError("fetch failed"));
        await expect(bf.searchBooks("x")).resolves.toEqual({ ok: false, error: "network" });
    });

    test("unexpected JSON shape -> bad_response", async () => {
        fetchSpy.mockResolvedValue(response({ json: { nope: true } }));
        await expect(bf.searchBooks("x")).resolves.toEqual({ ok: false, error: "bad_response" });
        await expect(bf.getBookMeta(1)).resolves.toEqual({ ok: false, error: "bad_response" });
    });

    test("fetchBookText picks utf-8, follows the final URL and decodes", async () => {
        fetchSpy.mockResolvedValue(response({
            text: "café",
            contentType: "text/plain; charset=utf-8",
            url: "https://www.gutenberg.org/cache/epub/1342/pg1342.txt",
        }));
        const meta = {
            id: 1342,
            formats: {
                "text/plain; charset=us-ascii": "https://x/ascii.txt",
                "text/plain; charset=utf-8": "https://www.gutenberg.org/ebooks/1342.txt.utf-8",
            },
        };
        const r = await bf.fetchBookText(meta);
        expect(r).toEqual({ ok: true, text: "café", url: "https://www.gutenberg.org/cache/epub/1342/pg1342.txt" });
        expect(fetchSpy.mock.calls[0][0]).toBe("https://www.gutenberg.org/ebooks/1342.txt.utf-8");
    });

    test("fetchBookText uses GUTENBERG_MIRROR when set", async () => {
        process.env.GUTENBERG_MIRROR = "https://mirror.example/cache/epub/{id}/pg{id}.txt";
        fetchSpy.mockResolvedValue(response({ text: "x", contentType: "text/plain" }));
        await bf.fetchBookText({ id: 84, formats: { "text/plain": "https://www.gutenberg.org/ebooks/84.txt" } });
        expect(fetchSpy.mock.calls[0][0]).toBe("https://mirror.example/cache/epub/84/pg84.txt");
    });

    test("fetchBookText without a plain-text format -> no_text (no request made)", async () => {
        await expect(bf.fetchBookText({ id: 1, formats: { "text/html": "h" } })).resolves.toEqual({ ok: false, error: "no_text" });
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    test("fetchBookText reports HTTP and network failures", async () => {
        const meta = { id: 1, formats: { "text/plain": "https://x/1.txt" } };
        fetchSpy.mockResolvedValueOnce(response({ status: 503 }));
        await expect(bf.fetchBookText(meta)).resolves.toEqual({ ok: false, error: "http", status: 503 });
        fetchSpy.mockRejectedValueOnce(new TypeError("fetch failed"));
        await expect(bf.fetchBookText(meta)).resolves.toEqual({ ok: false, error: "network" });
    });

    describe("timeouts", () => {
        // fetch that hangs until its signal aborts, then rejects like the real one
        const hangingFetch = (url, { signal }) => new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
        });

        beforeEach(() => jest.useFakeTimers());
        afterEach(() => jest.useRealTimers());

        test("getBookMeta gives up after 15s", async () => {
            fetchSpy.mockImplementation(hangingFetch);
            let result;
            bf.getBookMeta(1342).then((r) => { result = r; });

            await jest.advanceTimersByTimeAsync(bf.META_TIMEOUT - 1);
            expect(result).toBeUndefined();
            await jest.advanceTimersByTimeAsync(1);
            expect(result).toEqual({ ok: false, error: "timeout" });
            expect(bf.META_TIMEOUT).toBe(15000);
        });

        test("fetchBookText keeps the 30s timeout", async () => {
            fetchSpy.mockImplementation(hangingFetch);
            let result;
            bf.fetchBookText({ id: 1, formats: { "text/plain": "https://x/1.txt" } }).then((r) => { result = r; });

            await jest.advanceTimersByTimeAsync(bf.META_TIMEOUT);
            expect(result).toBeUndefined();
            await jest.advanceTimersByTimeAsync(bf.FETCH_TIMEOUT - bf.META_TIMEOUT);
            expect(result).toEqual({ ok: false, error: "timeout" });
            expect(bf.FETCH_TIMEOUT).toBe(30000);
        });
    });
});
