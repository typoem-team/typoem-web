// scripts/clean-book-text.js

// Apply lib/bookFetch.js cleanMarkup() (go--or -> go—or, /* NIND ... */, ------ dividers, C{2}, ...)
// to book paragraphs that were imported before that cleanup existed. New imports get it automatically.
//
// - Edits text in place: paragraph ids, idx and count never change, so reading_progress and
//   book_marks (which point at paragraph idx) stay valid, and books in use by a room are fine.
// - A paragraph that would become empty is left as it is (deleting it would shift every idx after it).
// - Word counts are recomputed (paragraph, chapter, book).
// - Safe to run again: cleanMarkup is idempotent, so a second run finds nothing to change.
//
// Dry run by default (prints what would change). Writes only with --apply.
// Uses the same DB settings as the server (TURSO_DATABASE_URL / TURSO_AUTH_TOKEN, or DB_PATH):
//   node scripts/clean-book-text.js                              (local DB, dry run)
//   node --env-file=.env.prod scripts/clean-book-text.js --apply (production)
// (.env is loaded only when run directly, never on require, like migrate-line-annotations.js.)

const { initDb, getDb } = require("../db");
const { cleanMarkup, wordCount } = require("../lib/bookFetch");
const { PARAGRAPHS_PER_BATCH } = require("../models/booksModel");

// -> { changes: [{ id, book_id, idx, before, text, word_count }], skippedEmpty: [paragraph id] }
async function cleanBookText({ apply = false } = {}) {
    const db = getDb();
    const rows = await db.all(`SELECT id, book_id, idx, text FROM book_paragraphs ORDER BY book_id, idx`);
    const changes = [];
    const skippedEmpty = [];
    for (const p of rows) {
        const text = cleanMarkup(p.text);
        if (text === p.text) continue;
        if (!text) { skippedEmpty.push(p.id); continue; }
        changes.push({ id: p.id, book_id: p.book_id, idx: p.idx, before: p.text, text, word_count: wordCount(text) });
    }
    if (!apply || changes.length === 0) return { changes, skippedEmpty };

    for (let i = 0; i < changes.length; i += PARAGRAPHS_PER_BATCH) {
        await db.batch(changes.slice(i, i + PARAGRAPHS_PER_BATCH).map((c) => ({
            sql: `UPDATE book_paragraphs SET text = ?, word_count = ? WHERE id = ?`,
            args: [c.text, c.word_count, c.id],
        })));
    }
    const totals = [];
    for (const b of new Set(changes.map((c) => c.book_id))) {
        totals.push(
            {
                sql: `UPDATE book_chapters SET word_count = (SELECT COALESCE(SUM(bp.word_count), 0) FROM book_paragraphs bp
                        WHERE bp.book_id = book_chapters.book_id AND bp.chapter_idx = book_chapters.idx)
                      WHERE book_id = ?`,
                args: [b],
            },
            {
                sql: `UPDATE books SET total_words = (SELECT COALESCE(SUM(word_count), 0) FROM book_paragraphs WHERE book_id = ?)
                      WHERE id = ?`,
                args: [b, b],
            }
        );
    }
    await db.batch(totals);
    return { changes, skippedEmpty };
}

async function main() {
    const apply = process.argv.includes("--apply");
    try {
        await initDb();
        const { changes, skippedEmpty } = await cleanBookText({ apply });
        const perBook = {};
        for (const c of changes) perBook[c.book_id] = (perBook[c.book_id] || 0) + 1;
        console.log(`${apply ? "Updated" : "Would update"} ${changes.length} paragraph(s):`, perBook);
        for (const c of changes.slice(0, 10)) {
            console.log(`  [${c.book_id}#${c.idx}] ${c.before.slice(0, 80)}\n      -> ${c.text.slice(0, 80)}`);
        }
        if (skippedEmpty.length) console.log(`Left ${skippedEmpty.length} that would become empty (ids: ${skippedEmpty.join(", ")}).`);
        if (!apply && changes.length) console.log("Dry run. Add --apply to write.");
    } catch (err) {
        console.error(err);
        process.exitCode = 1;
    }
}

if (require.main === module) {
    require("dotenv").config({ quiet: true });
    main();
}

module.exports = { cleanBookText };
