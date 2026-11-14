// scripts/warm-dict.js

// Fills word_cache ahead of time so the first tap on a word doesn't wait on the free dictionary API.
// Words come from every poem the review account's (까망) rooms have had, plus the chapter
// 까망 is reading in each room's book.
// Words already cached are skipped, so it is safe to run again.
//
//   node scripts/warm-dict.js                                  (local DB)
//   node --env-file=.env.prod scripts/warm-dict.js             (production)

const { initDb, getDb } = require("../db");
const { lineWords } = require("../lib/poemWords");
const wordCache = require("../models/wordCacheModel");
const { slimify } = require("../controllers/dictionaryController");

const OWNER = process.env.WARM_USER || "kkamang";
const CONCURRENCY = 2;

async function collectTexts(db) {
    const poems = await db.all(
        `SELECT pl.text FROM poem_lines pl
         WHERE pl.poem_id IN (SELECT d.poem_id FROM daily_room_poems d JOIN rooms r ON r.id = d.room_id
                              JOIN users u ON u.id = r.owner_id WHERE u.username = ?)`, [OWNER]);
    // the chapter 까망 is on (chapter 0 if no progress)
    const paras = await db.all(
        `SELECT bp.text FROM room_books rb
         JOIN rooms r ON r.id = rb.room_id JOIN users u ON u.id = r.owner_id
         LEFT JOIN reading_progress rp ON rp.room_id = rb.room_id AND rp.book_id = rb.book_id AND rp.user_id = u.id
         LEFT JOIN book_paragraphs cur ON cur.book_id = rb.book_id AND cur.idx = COALESCE(rp.paragraph_idx, 0)
         JOIN book_paragraphs bp ON bp.book_id = rb.book_id
              AND bp.chapter_idx = COALESCE(cur.chapter_idx, 0)
         WHERE u.username = ?`, [OWNER]);
    return [...poems, ...paras].map((r) => r.text);
}

// same normalisation and check as the dictionary route
function wordsOf(texts) {
    const set = new Set();
    for (const t of texts) for (const w of lineWords(t)) {
        const word = w.toLowerCase();
        if (/^[a-z'-]+$/.test(word)) set.add(word);
    }
    return set;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function warm(word) {
    try {
        let r;
        // the free API allows ~450 requests per few minutes per IP and answers 429 past that
        for (let attempt = 0; attempt < 30; attempt++) {
            r = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`,
                { signal: AbortSignal.timeout(20000) });
            if (r.status !== 429) break;
            await wait(Math.max(Number(r.headers.get("retry-after")) || 0, 10) * 1000);
        }
        if (!r.ok) return r.status === 404 ? "missing" : "failed";
        const slim = slimify(await r.json());
        if (!slim.definitions.length) return "missing";
        await wordCache.upsert(word, slim.phonetic, slim.definitions);
        return "cached";
    } catch {
        return "failed";
    }
}

async function main() {
    await initDb();
    const db = getDb();
    const all = wordsOf(await collectTexts(db));
    const have = new Set((await db.all("SELECT word FROM word_cache")).map((r) => r.word));
    const todo = [...all].filter((w) => !have.has(w));
    console.log(`${all.size} words, ${all.size - todo.length} already cached, fetching ${todo.length}`);

    const counts = { cached: 0, missing: 0, failed: 0 };
    const failed = [];
    let next = 0;
    await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
        while (next < todo.length) {
            const word = todo[next++];
            const result = await warm(word);
            counts[result]++;
            if (result === "failed") failed.push(word);
            if ((counts.cached + counts.missing + counts.failed) % 50 === 0) console.log(" ", counts);
        }
    }));
    console.log("done", counts);
    if (failed.length) console.log("failed (run again to retry):", failed.join(" "));
}

if (require.main === module) main().catch((err) => { console.error(err); process.exit(1); });
