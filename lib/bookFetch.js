// Shared Gutendex / Project Gutenberg helpers for the book feature (v1.1).
// Same role as lib/poemFetch.js: network calls + pure parsing, no DB access.
//
// Network helpers never throw. They resolve to
//   { ok: true, ... }                         on success
//   { ok: false, error, status? }             on failure, where error is one of
//     'timeout' | 'network' | 'http' | 'bad_response'  -> upstream problem (502)
//     'no_text'                                         -> book has no plain text (422)
//
// Parsing helpers are pure functions (exported for unit tests).

const FETCH_TIMEOUT = 30000; // ms, per request (search, book text download)
const META_TIMEOUT = 15000;  // ms, Gutendex /books/{id} (the caller retries it once)
const USER_AGENT = "Typoem/1.0 (+https://typoem-app.onrender.com)";

const MAX_WORDS = 200000;       // longer books are rejected
const MIN_PARAGRAPHS = 50;      // shorter "books" are rejected
const PSEUDO_CHAPTER_SIZE = 150; // paragraphs per chapter for books without headings
const KOREA_PD_CUTOFF = 1962;   // died <= 1962 -> public domain in Korea

function gutendexBase() {
    return (process.env.GUTENDEX_URL || "https://gutendex.com").replace(/\/+$/, "");
}

////////////////////////////////////////// network //////////////////////////////////////////

// fetch with a timeout (default 30s) and our User-Agent. Returns { ok, res } or { ok: false, error, status }.
async function request(url, accept, timeoutMs = FETCH_TIMEOUT) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, {
            headers: { Accept: accept, "User-Agent": USER_AGENT },
            signal: controller.signal,
            redirect: "follow",
        });
        if (!res.ok) {
            clearTimeout(timer);
            return { ok: false, error: "http", status: res.status };
        }
        return { ok: true, res, controller, timer };
    } catch (err) {
        clearTimeout(timer);
        return { ok: false, error: err && err.name === "AbortError" ? "timeout" : "network" };
    }
}

// read the body while the timeout is still armed, then disarm it
async function readBody(r, kind) {
    try {
        return kind === "json" ? await r.res.json() : Buffer.from(await r.res.arrayBuffer());
    } finally {
        clearTimeout(r.timer);
    }
}

async function getJson(url, timeoutMs) {
    const r = await request(url, "application/json", timeoutMs);
    if (!r.ok) return r;
    try {
        return { ok: true, data: await readBody(r, "json") };
    } catch (err) {
        return { ok: false, error: err && err.name === "AbortError" ? "timeout" : "bad_response" };
    }
}

// GET /books/?search=q  -> { ok, results: [raw Gutendex book], count }
// Only English, US-public-domain books with a plain-text format. Korea PD filtering is the caller's job.
async function searchBooks(q) {
    const params = new URLSearchParams({
        search: q,
        languages: "en",
        copyright: "false",
        mime_type: "text/plain",
    });
    const r = await getJson(`${gutendexBase()}/books/?${params}`);
    if (!r.ok) return r;
    if (!r.data || !Array.isArray(r.data.results)) return { ok: false, error: "bad_response" };
    return { ok: true, results: r.data.results, count: r.data.count };
}

// GET /books/{id}  -> { ok, meta: raw Gutendex book }   (15s timeout)
async function getBookMeta(gutenbergId) {
    const r = await getJson(`${gutendexBase()}/books/${encodeURIComponent(gutenbergId)}`, META_TIMEOUT);
    if (!r.ok) return r;
    if (!r.data || typeof r.data.id !== "number" || !r.data.formats) return { ok: false, error: "bad_response" };
    return { ok: true, meta: r.data };
}

// choose the plain-text format: utf-8 first, then any text/plain. Returns { key, url } or null.
function pickTextFormat(formats) {
    if (!formats || typeof formats !== "object") return null;
    const keys = Object.keys(formats).filter((k) => k.toLowerCase().startsWith("text/plain"));
    const key = keys.find((k) => /charset=utf-8/i.test(k)) || keys[0];
    if (!key) return null;
    const url = formats[key];
    // Gutendex occasionally lists zipped text under text/plain; we can't read those
    if (typeof url !== "string" || /\.zip$/i.test(url)) return null;
    return { key, url };
}

// GUTENBERG_MIRROR is a URL template with {id}, e.g. https://mirror.example.org/cache/epub/{id}/pg{id}.txt
// Empty -> use the URL Gutendex gave us (gutenberg.org).
function textUrlFor(meta, format) {
    const mirror = process.env.GUTENBERG_MIRROR;
    if (mirror && mirror.includes("{id}")) return mirror.replace(/\{id\}/g, String(meta.id));
    return format.url;
}

// "text/plain; charset=iso-8859-1" -> "iso-8859-1"
function charsetOf(contentType) {
    const m = /charset\s*=\s*"?([^";\s]+)/i.exec(contentType || "");
    return m ? m[1].toLowerCase() : null;
}

// decode bytes using the server's charset, else the format key's charset, else utf-8
function decodeText(buf, contentType, formatKey) {
    const charset = charsetOf(contentType) || charsetOf(formatKey) || "utf-8";
    let decoder;
    try {
        decoder = new TextDecoder(charset);
    } catch (err) {
        decoder = new TextDecoder("utf-8"); // unknown label
    }
    return decoder.decode(buf);
}

// download the plain text of a book (redirects followed) -> { ok, text, url }
async function fetchBookText(meta) {
    const format = pickTextFormat(meta && meta.formats);
    if (!format) return { ok: false, error: "no_text" };
    const url = textUrlFor(meta, format);
    const r = await request(url, "text/plain");
    if (!r.ok) return r;
    try {
        const buf = await readBody(r, "buffer");
        return { ok: true, text: decodeText(buf, r.res.headers.get("content-type"), format.key), url: r.res.url || url };
    } catch (err) {
        return { ok: false, error: err && err.name === "AbortError" ? "timeout" : "network" };
    }
}

////////////////////////////////////////// copyright //////////////////////////////////////////

// Korean copyright: life + 70 years, but the 2013-07-01 amendment is not retroactive,
// so works of people who died in 1962 or earlier are public domain in Korea
// (died 1963 -> protected until 2033). Translations carry their own copyright,
// so every author AND translator must qualify. Unknown death year -> not PD.
function isKoreaPublicDomain(meta) {
    if (!meta) return false;
    const authors = Array.isArray(meta.authors) ? meta.authors : [];
    const translators = Array.isArray(meta.translators) ? meta.translators : [];
    if (authors.length === 0) return false;
    return [...authors, ...translators].every(
        (p) => p && Number.isInteger(p.death_year) && p.death_year <= KOREA_PD_CUTOFF
    );
}

////////////////////////////////////////// parsing //////////////////////////////////////////

// keep only the book body between the Gutenberg START / END markers
function stripGutenberg(raw) {
    let t = String(raw || "").replace(/^﻿/, "").replace(/\r\n?/g, "\n");
    const start = t.search(/\*\*\*\s*START OF (THE|THIS) PROJECT GUTENBERG[^\n]*/i);
    if (start >= 0) {
        const eol = t.indexOf("\n", start);
        t = eol >= 0 ? t.slice(eol + 1) : "";
    }
    const end = t.search(/\*\*\*\s*END OF (THE|THIS) PROJECT GUTENBERG/i);
    if (end >= 0) t = t.slice(0, end);
    // older files repeat it as a plain line just before the marker
    t = t.replace(/\n[^\n]*End of (the )?Project Gutenberg[^\n]*\s*$/i, "\n");
    return t;
}

const NUMBER_WORDS = [
    "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
    "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen",
    "eighteen", "nineteen", "twenty", "thirty", "forty", "fifty", "sixty", "seventy",
    "eighty", "ninety", "hundred",
    "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth",
    "tenth", "eleventh", "twelfth", "last", "final",
];
const NUM_WORD = `(?:${NUMBER_WORDS.join("|")})(?:-(?:${NUMBER_WORDS.join("|")}))?`;
const ROMAN = "[IVXLCDM]+";
// "CHAPTER I.", "Chapter 1", "CHAPTER I. Down the Rabbit-Hole", "Book the First--Recalled to Life",
// "STAVE ONE", "Letter 4". Keyword must be capitalised so prose like "part one of it" can't match;
// the number part is case-insensitive.
const KEYWORD = /^(?:CHAPTER|Chapter|BOOK|Book|PART|Part|STAVE|Stave|LETTER|Letter)\s+/;
const KEYWORD_HEADING = new RegExp(
    `^\\w+\\s+(?:the\\s+)?(${ROMAN}|\\d+|${NUM_WORD})(?![\\w’'])(?:[\\s.:,;—–-].*)?$`,
    "i"
);
const STRICT_ROMAN = /^M{0,3}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/;

function isRoman(s) {
    return s.length > 0 && STRICT_ROMAN.test(s);
}

// is this paragraph a chapter heading?
function isHeading(s) {
    if (!s || s.length >= 80) return false;
    const kw = KEYWORD.test(s) && KEYWORD_HEADING.exec(s);
    if (kw) {
        const num = kw[1];
        // a roman-looking token after the keyword must be uppercase and valid ("Part I", not "Part mid")
        if (/^[ivxlcdm]+$/i.test(num) && !NUMBER_WORDS.includes(num.toLowerCase())) {
            return num === num.toUpperCase() && isRoman(num);
        }
        return true;
    }
    // bare roman numeral: "IV" / "IV."
    let m = /^([IVXLCDM]+)\.?$/.exec(s);
    if (m) return isRoman(m[1]);
    // roman numeral + ALL-CAPS title: "I. A SCANDAL IN BOHEMIA"
    m = /^([IVXLCDM]+)\.\s+([^a-z]*[A-Z][^a-z]*)$/.exec(s);
    if (m) return isRoman(m[1]);
    return false;
}

// collapse a block into one line of clean text
function cleanBlock(b) {
    return b
        .replace(/\s*\n\s*/g, " ")
        .replace(/_/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

// net "[" minus "]" in a string
function bracketDelta(s) {
    let d = 0;
    for (const ch of s) {
        if (ch === "[") d++;
        else if (ch === "]") d--;
    }
    return d;
}

const ILLUSTRATION_START = /^\[\s*(illustration|transcriber[’']?s?\s+note)/i;
const TRANSCRIBER_NOTE = /^transcriber[’']?s?\s+note/i;
const INLINE_ILLUSTRATION = /\[\s*illustration[^\[\]]*(\[[^\]]*\][^\[\]]*)*\]/gi;

// text -> [{ text, heading }]
// Blank lines separate paragraphs; line breaks inside a paragraph become spaces.
// [Illustration ...] / [Transcriber's note ...] blocks are dropped even when they span
// several blank-line-separated blocks; a chapter heading hidden inside one
// (e.g. "[Illustration: ... \n\n Chapter I.]") is kept as a heading.
function toParagraphs(text) {
    const blocks = String(text || "").split(/\n[ \t]*\n+/);
    const paras = [];
    let depth = 0; // >0 while inside a multi-block [Illustration ...]

    for (const block of blocks) {
        let s = cleanBlock(block);
        if (!s) continue;

        if (depth > 0 || ILLUSTRATION_START.test(s)) {
            depth += bracketDelta(s);
            if (depth < 0) depth = 0;
            // look for a heading inside the bracketed block
            const inner = s.replace(/^\[\s*illustration\s*:?\s*/i, "").replace(/\]+$/, "").trim();
            if (isHeading(inner)) paras.push({ text: inner, heading: true });
            continue;
        }
        if (TRANSCRIBER_NOTE.test(s)) continue;

        s = s.replace(INLINE_ILLUSTRATION, " ").replace(/\s+/g, " ").trim();
        if (!s) continue;
        paras.push({ text: s, heading: isHeading(s) });
    }
    return paras;
}

function wordCount(s) {
    const m = String(s || "").match(/\S+/g);
    return m ? m.length : 0;
}

function normHeading(s) {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// [{ text, heading }] -> { chapters: [{ title, paragraphs: [text] }], totalWords }
// - table of contents: if the first heading appears again later, the body starts there
//   (only when the skipped part is small, so a real Book I with restarting chapter
//   numbers is never mistaken for a table of contents)
// - anything before the first heading (title page, preface, contents) is dropped
// - headings with no paragraphs are merged into the next title ("BOOK I — CHAPTER I")
// - no headings at all -> pseudo-chapters of PSEUDO_CHAPTER_SIZE paragraphs, title null
// - totalWords counts body paragraphs only (headings excluded)
function splitChapters(paras) {
    const list = Array.isArray(paras) ? paras : [];
    const allWords = list.reduce((n, p) => n + (p.heading ? 0 : wordCount(p.text)), 0);

    let start = list.findIndex((p) => p.heading);
    if (start < 0) {
        const chapters = [];
        for (let i = 0; i < list.length; i += PSEUDO_CHAPTER_SIZE) {
            chapters.push({ title: null, paragraphs: list.slice(i, i + PSEUDO_CHAPTER_SIZE).map((p) => p.text) });
        }
        return { chapters, totalWords: allWords };
    }

    const firstKey = normHeading(list[start].text);
    const again = list.findIndex((p, i) => i > start && p.heading && normHeading(p.text) === firstKey);
    if (again > 0) {
        const skipped = list.slice(start, again).reduce((n, p) => n + (p.heading ? 0 : wordCount(p.text)), 0);
        if (skipped < allWords * 0.05) start = again;
    }

    const raw = [];
    for (const p of list.slice(start)) {
        if (p.heading) raw.push({ title: p.text, paragraphs: [] });
        else raw[raw.length - 1].paragraphs.push(p.text);
    }

    const chapters = [];
    let carry = [];
    for (const c of raw) {
        if (c.paragraphs.length === 0) {
            carry.push(c.title);
            continue;
        }
        chapters.push({ title: [...carry, c.title].join(" — "), paragraphs: c.paragraphs });
        carry = [];
    }

    const totalWords = chapters.reduce(
        (n, c) => n + c.paragraphs.reduce((m, t) => m + wordCount(t), 0),
        0
    );
    return { chapters, totalWords };
}

// raw Gutenberg text -> { ok: true, chapters, totalWords, totalParagraphs }
//                     | { ok: false, error: 'too_long' | 'too_short', totalWords, totalParagraphs }
function parseBook(raw) {
    const { chapters, totalWords } = splitChapters(toParagraphs(stripGutenberg(raw)));
    const totalParagraphs = chapters.reduce((n, c) => n + c.paragraphs.length, 0);
    if (totalWords > MAX_WORDS) return { ok: false, error: "too_long", totalWords, totalParagraphs };
    if (totalParagraphs < MIN_PARAGRAPHS) return { ok: false, error: "too_short", totalWords, totalParagraphs };
    return { ok: true, chapters, totalWords, totalParagraphs };
}

module.exports = {
    // network
    searchBooks,
    getBookMeta,
    fetchBookText,
    // copyright
    isKoreaPublicDomain,
    // parsing
    stripGutenberg,
    toParagraphs,
    splitChapters,
    parseBook,
    isHeading,
    wordCount,
    pickTextFormat,
    decodeText,
    // limits (for callers / tests)
    MAX_WORDS,
    MIN_PARAGRAPHS,
    PSEUDO_CHAPTER_SIZE,
    FETCH_TIMEOUT,
    META_TIMEOUT,
};
