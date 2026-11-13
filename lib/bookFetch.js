// Shared Gutendex / Project Gutenberg helpers for the book feature (v1.1).
// Same role as lib/poemFetch.js: network calls + pure parsing, no DB access.
//
// Book metadata (getBookMeta) comes from Project Gutenberg's own RDF catalog file
// first (https://www.gutenberg.org/cache/epub/{id}/pg{id}.rdf), with Gutendex only as
// a fallback, because the public Gutendex instance often hangs. Search still needs
// Gutendex (a purely numeric query is looked up by id instead).
// Both sources are returned in the same Gutendex-style shape:
//   { id, title, authors: [{ name, birth_year, death_year }], translators: [...],
//     languages: ['en'], formats: { mime: url }, copyright }
//
// Network helpers never throw. They resolve to
//   { ok: true, ... }                         on success
//   { ok: false, error, status? }             on failure, where error is one of
//     'timeout' | 'network' | 'http' | 'bad_response'  -> upstream problem (502)
//     'no_text'                                         -> book has no plain text (422)
//
// Parsing helpers are pure functions (exported for unit tests).

const { cleanBookTitle } = require("./bookTitle");
const FETCH_TIMEOUT = 30000; // ms, per request (search, book text download)
const META_TIMEOUT = 15000;  // ms, book metadata (RDF and Gutendex, run in parallel; the caller retries once)
const USER_AGENT = "Typoem/1.0 (+https://typoem-app.onrender.com)";

const MAX_WORDS = 200000;       // longer books are rejected
const MIN_PARAGRAPHS = 50;      // shorter "books" are rejected
const PSEUDO_CHAPTER_SIZE = 150; // paragraphs per chapter for books without headings
const KOREA_PD_CUTOFF = 1962;   // died <= 1962 -> public domain in Korea

function gutendexBase() {
    return (process.env.GUTENDEX_URL || "https://gutendex.com").replace(/\/+$/, "");
}

// GUTENBERG_RDF is a URL template with {id}; empty -> gutenberg.org's catalog file
const DEFAULT_RDF_URL = "https://www.gutenberg.org/cache/epub/{id}/pg{id}.rdf";
function rdfUrlFor(id) {
    const tpl = process.env.GUTENBERG_RDF && process.env.GUTENBERG_RDF.includes("{id}")
        ? process.env.GUTENBERG_RDF
        : DEFAULT_RDF_URL;
    return tpl.replace(/\{id\}/g, encodeURIComponent(String(id)));
}

////////////////////////////////////////// network //////////////////////////////////////////

// fetch with a timeout (default 30s) and our User-Agent. Returns { ok, res } or { ok: false, error, status }.
// outerSignal (optional) lets the caller cancel the request early.
async function request(url, accept, timeoutMs = FETCH_TIMEOUT, outerSignal) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    if (outerSignal) {
        if (outerSignal.aborted) controller.abort();
        else outerSignal.addEventListener("abort", () => controller.abort(), { once: true });
    }
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

async function getJson(url, timeoutMs, signal) {
    const r = await request(url, "application/json", timeoutMs, signal);
    if (!r.ok) return r;
    try {
        return { ok: true, data: await readBody(r, "json") };
    } catch (err) {
        return { ok: false, error: err && err.name === "AbortError" ? "timeout" : "bad_response" };
    }
}

// After the id lookup of a numeric query finishes, how long the title search may still take
// before we answer with the id result alone.
const NUMERIC_SEARCH_GRACE = 3000; // ms

// Gutendex GET /books/?search=q  -> { ok, results: [raw Gutendex book], count }
async function searchGutendex(q, signal) {
    const params = new URLSearchParams({
        search: q,
        languages: "en",
        copyright: "false",
        mime_type: "text/plain",
    });
    const r = await getJson(`${gutendexBase()}/books/?${params}`, FETCH_TIMEOUT, signal);
    if (!r.ok) return r;
    if (!r.data || !Array.isArray(r.data.results)) return { ok: false, error: "bad_response" };
    return { ok: true, results: r.data.results, count: r.data.count };
}

// a numeric query as a Gutenberg id -> { ok, results: [] | [meta] } (404 = no results)
// Applies the same filters as the Gutendex search: English, plain text, US public domain.
async function lookupById(id) {
    const r = await getBookMeta(id);
    if (!r.ok) return r.error === "http" && r.status === 404 ? { ok: true, results: [] } : r;
    const m = r.meta;
    const en = Array.isArray(m.languages) && m.languages.includes("en");
    const hasText = !!pickTextFormat(m.formats);
    return { ok: true, results: en && hasText && m.copyright !== true ? [m] : [] };
}

// Search -> { ok, results: [raw Gutendex-shaped book], count }
// Only English, US-public-domain books with a plain-text format. Korea PD filtering is the caller's job.
// A purely numeric query ("11", "1984") runs two searches at once: an id lookup (RDF first,
// so it works while Gutendex is down) and the normal Gutendex title search. The id match comes
// first, then title matches. Once the id lookup is done the title search gets at most
// NUMERIC_SEARCH_GRACE more; if it is still running it is cancelled and the id result is returned.
async function searchBooks(q) {
    const query = String(q).trim();
    if (!/^\d{1,7}$/.test(query)) return searchGutendex(query);

    const cancel = new AbortController();
    const titleSearch = searchGutendex(query, cancel.signal);
    const byId = await lookupById(Number(query));

    let timer;
    const grace = new Promise((resolve) => { timer = setTimeout(() => resolve(null), NUMERIC_SEARCH_GRACE); });
    const byTitle = await Promise.race([titleSearch, grace]);
    clearTimeout(timer);
    if (!byTitle) cancel.abort();

    if (!byId.ok && !(byTitle && byTitle.ok)) return byId; // both failed -> report the id lookup error
    const idResults = byId.ok ? byId.results : [];
    const seen = new Set(idResults.map((b) => b.id));
    const titleResults = byTitle && byTitle.ok ? byTitle.results.filter((b) => !seen.has(b.id)) : [];
    const results = [...idResults, ...titleResults];
    return { ok: true, results, count: results.length };
}

// Gutendex GET /books/{id}  -> { ok, meta: raw Gutendex book }   (15s timeout)
async function getBookMetaFromGutendex(gutenbergId, signal) {
    const r = await getJson(`${gutendexBase()}/books/${encodeURIComponent(gutenbergId)}`, META_TIMEOUT, signal);
    if (!r.ok) return r;
    if (!r.data || typeof r.data.id !== "number" || !r.data.formats) return { ok: false, error: "bad_response" };
    return { ok: true, meta: r.data };
}

// Project Gutenberg RDF catalog file -> { ok, meta } in the Gutendex shape   (15s timeout)
async function getBookMetaFromRdf(gutenbergId, signal) {
    const r = await request(rdfUrlFor(gutenbergId), "application/rdf+xml", META_TIMEOUT, signal);
    if (!r.ok) return r;
    let xml;
    try {
        xml = (await readBody(r, "buffer")).toString("utf-8");
    } catch (err) {
        return { ok: false, error: err && err.name === "AbortError" ? "timeout" : "network" };
    }
    const meta = parseRdf(xml);
    if (!meta || meta.id !== Number(gutenbergId)) return { ok: false, error: "bad_response" };
    return { ok: true, meta };
}

// Book metadata by Gutenberg id. Asks the RDF file and Gutendex at the same time and
// prefers the RDF answer; Gutendex is only used when the RDF lookup fails.
// A 404 from the RDF file means the book doesn't exist (Gutendex is not waited for).
// Worst case is one META_TIMEOUT (both time out together).
async function getBookMeta(gutenbergId) {
    const cancel = new AbortController();
    const gutendex = getBookMetaFromGutendex(gutenbergId, cancel.signal);
    const rdf = await getBookMetaFromRdf(gutenbergId);
    if (rdf.ok || (rdf.error === "http" && rdf.status === 404)) {
        cancel.abort();
        gutendex.catch(() => {});
        return rdf;
    }
    const g = await gutendex;
    if (g.ok || (g.error === "http" && g.status === 404)) return g;
    return rdf;
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

////////////////////////////////////////// RDF //////////////////////////////////////////

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
function decodeEntities(s) {
    return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
        if (e[0] === "#") {
            const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
            return Number.isFinite(n) ? String.fromCodePoint(n) : m;
        }
        return Object.prototype.hasOwnProperty.call(ENTITIES, e.toLowerCase()) ? ENTITIES[e.toLowerCase()] : m;
    });
}

// text of the first <tag ...>...</tag> inside xml (whitespace collapsed, entities decoded) or null
function tagText(xml, tag) {
    const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`).exec(xml);
    if (!m) return null;
    const t = decodeEntities(m[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    return t || null;
}

function intOrNull(s) {
    const n = s == null ? NaN : parseInt(s, 10);
    return Number.isInteger(n) ? n : null;
}

// Project Gutenberg RDF/XML -> Gutendex-shaped meta, or null if it isn't a book record.
// Authors = dcterms:creator / marcrel:aut, translators = marcrel:trl.
// A person referenced by rdf:resource that isn't defined in the file gets death_year null,
// so the Korean PD check fails safe.
function parseRdf(xml) {
    const s = String(xml || "");
    const idm = /<pgterms:ebook\s+rdf:about="ebooks\/(\d+)"/.exec(s);
    if (!idm) return null;

    const agents = new Map();
    for (const m of s.matchAll(/<pgterms:agent\s+rdf:about="([^"]+)"\s*>([\s\S]*?)<\/pgterms:agent>/g)) {
        agents.set(m[1], {
            name: tagText(m[2], "pgterms:name"),
            birth_year: intOrNull(tagText(m[2], "pgterms:birthdate")),
            death_year: intOrNull(tagText(m[2], "pgterms:deathdate")),
        });
    }
    const unknown = (name = null) => ({ name, birth_year: null, death_year: null });

    const authors = [];
    const translators = [];
    const roleRe = /<(dcterms:creator|marcrel:aut|marcrel:trl)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/g;
    for (const m of s.matchAll(roleRe)) {
        const [, role, attrs, inner] = m;
        let person;
        const ref = /rdf:resource="([^"]+)"/.exec(attrs || "");
        const about = inner && /<pgterms:agent\s+rdf:about="([^"]+)"/.exec(inner);
        if (ref) person = agents.get(ref[1]) || unknown();
        else if (about) person = agents.get(about[1]) || unknown();
        else person = unknown(inner ? tagText(`<x>${inner}</x>`, "x") : null);
        (role === "marcrel:trl" ? translators : authors).push(person);
    }

    const languages = [];
    for (const m of s.matchAll(/<dcterms:language>([\s\S]*?)<\/dcterms:language>/g)) {
        const v = tagText(m[1], "rdf:value");
        if (v && !languages.includes(v)) languages.push(v);
    }

    const formats = {};
    for (const m of s.matchAll(/<pgterms:file\s+rdf:about="([^"]+)"\s*>([\s\S]*?)<\/pgterms:file>/g)) {
        const mime = tagText(m[2], "rdf:value");
        if (mime && !(mime in formats)) formats[mime] = decodeEntities(m[1]);
    }

    const rights = tagText(s, "dcterms:rights");
    return {
        id: Number(idm[1]),
        title: cleanBookTitle(tagText(s, "dcterms:title")),
        authors,
        translators,
        languages,
        formats,
        copyright: rights ? !/^public domain in the usa/i.test(rights) : null,
    };
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
    return cleanMarkup(b
        .replace(/\s*\n\s*/g, " ")
        .replace(/_/g, "")
        .replace(/\s+/g, " ")
        .trim());
}

const LIGATURES = { ae: "æ", AE: "Æ", oe: "œ", OE: "Œ" };
const SUBSCRIPT = "₀₁₂₃₄₅₆₇₈₉";

// Gutenberg plain-text conventions -> the typography they stand for. One line in, one line out;
// idempotent, so scripts/clean-book-text.js can apply it to paragraphs already in the DB.
function cleanMarkup(s) {
    if (/^(?:-\s*){3,}$/.test(s)) return "* * *"; // ------ divider line -> scene break
    return s
        .replace(/^\/\*\s*(?:(?:NIND|IND|RIGHT|CENTER|CENTRE)\b\s*)?/, "") // /* NIND ... */ layout block
        .replace(/\s*\*\/$/, "")
        .replace(/-{2,}/g, "—")                                       // go--or, D---- -> em dash
        .replace(/\{(ae|AE|oe|OE)\}/g, (_, l) => LIGATURES[l])         // qu{ae} -> quæ
        .replace(/\{(\d+)\}/g, (_, d) => [...d].map((c) => SUBSCRIPT[c]).join("")) // C{2} -> C₂
        .replace(/^\* (?=[^*\s])/, "• ")                               // "* item" bullet, not "* * *"
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
    let list = Array.isArray(paras) ? paras : [];
    // Story collections: "I. A SCANDAL IN BOHEMIA" then "I." / "II." / "III." inside that story.
    // Once a numbered title has appeared, bare numerals are its sections, not chapters: drop them
    // (not kept as text, so paragraph numbering matches what the old parser stored).
    const titled = list.findIndex((p) => p.heading && /^[IVXLCDM]+\.\s/.test(p.text));
    if (titled >= 0) {
        list = list.filter((p, i) => !(i > titled && p.heading && /^[IVXLCDM]+\.?$/.test(p.text)));
    }
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
    getBookMetaFromRdf,
    getBookMetaFromGutendex,
    fetchBookText,
    parseRdf,
    // copyright
    isKoreaPublicDomain,
    // parsing
    stripGutenberg,
    toParagraphs,
    cleanMarkup,
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
    NUMERIC_SEARCH_GRACE,
    META_TIMEOUT,
};
