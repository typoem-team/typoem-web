// scripts/rechapter-books.js

// Re-split books imported before a chapter-detection fix in lib/bookFetch.js (story sections in
// Sherlock Holmes, two-line headings, unnumbered ALL-CAPS titles). New imports get it automatically.
//
// For each imported book: download the text again, parse it with the current parser, and line the
// new paragraphs up with the stored ones by exact text. The new parse may only DROP stored
// paragraphs (headings and front matter that used to be body text), never add or change one;
// otherwise the book is skipped. Then, in one db.batch() per book (all or nothing):
//   - book_chapters is rebuilt, book_paragraphs keep their id and get the new idx / chapter_idx,
//     dropped paragraphs are deleted
//   - reading_progress.paragraph_idx and book_marks (start_para, end_para, chapter_idx) move with
//     their paragraph; a position on a dropped paragraph moves to the next kept one
//   - books.total_paragraphs / total_words are updated
// Books whose chapters and paragraphs come out the same are left alone, so it is safe to run again.
//
// Dry run by default (prints what would change). Writes only with --apply.
//   node scripts/rechapter-books.js                              (local DB, dry run)
//   node --env-file=.env.prod scripts/rechapter-books.js --apply (production)
//   ... --book 1661                                              (one book only)

const { initDb, getDb } = require("../db");
const bookFetch = require("../lib/bookFetch");

// stored [{ id, idx, text }] (idx order) + new parse chapters -> { map: old idx -> new idx, kept, dropped }
// map[oldIdx] for a dropped paragraph = the next kept paragraph (or the last one). null if they don't line up.
function alignParagraphs(stored, chapters) {
    const fresh = [];
    chapters.forEach((c, ci) => c.paragraphs.forEach((text) => fresh.push({ text, chapter_idx: ci })));
    const kept = [];   // [{ id, idx: new idx, chapter_idx, oldIdx }]
    const dropped = [];
    let j = 0;
    for (const p of fresh) {
        while (j < stored.length && stored[j].text !== p.text) dropped.push(stored[j++]);
        if (j === stored.length) return null;
        kept.push({ id: stored[j].id, idx: kept.length, chapter_idx: p.chapter_idx, oldIdx: stored[j].idx });
        j++;
    }
    while (j < stored.length) dropped.push(stored[j++]);
    const map = new Array(stored.length);
    let next = kept.length - 1;
    for (let k = kept.length - 1, i = stored.length - 1; i >= 0; i--) {
        if (k >= 0 && kept[k].oldIdx === stored[i].idx) next = kept[k--].idx;
        map[stored[i].idx] = next;
    }
    return { map, kept, dropped };
}

async function planBook(db, book) {
    const stored = await db.all(`SELECT id, idx, text, word_count FROM book_paragraphs WHERE book_id = ? ORDER BY idx`, [book.id]);
    const oldChapters = await db.all(`SELECT idx, title, paragraph_count FROM book_chapters WHERE book_id = ? ORDER BY idx`, [book.id]);
    const meta = await bookFetch.getBookMeta(book.id);
    if (!meta.ok) return { skip: `metadata ${meta.error}` };
    const text = await bookFetch.fetchBookText(meta.meta);
    if (!text.ok) return { skip: `text ${text.error}` };
    const parsed = bookFetch.parseBook(text.text);
    if (!parsed.ok) return { skip: `parse ${parsed.error}` };

    const same = parsed.chapters.length === oldChapters.length
        && parsed.chapters.every((c, i) => c.title === oldChapters[i].title && c.paragraphs.length === oldChapters[i].paragraph_count)
        && parsed.totalParagraphs === stored.length;
    if (same) return { same: true };

    const a = alignParagraphs(stored, parsed.chapters);
    if (!a) return { skip: "new paragraphs don't match the stored ones (text changed upstream?)" };

    const wc = new Map(stored.map((p) => [p.id, p.word_count]));
    const chapters = parsed.chapters.map((c, i) => {
        const rows = a.kept.filter((k) => k.chapter_idx === i);
        return { idx: i, title: c.title ?? null, start: rows[0].idx, count: rows.length, words: rows.reduce((n, k) => n + wc.get(k.id), 0) };
    });
    const chapterOf = (newIdx) => a.kept[newIdx].chapter_idx;
    const progress = await db.all(`SELECT user_id, room_id, paragraph_idx FROM reading_progress WHERE book_id = ?`, [book.id]);
    const marks = await db.all(`SELECT id, chapter_idx, start_para, end_para, quote FROM book_marks WHERE book_id = ?`, [book.id]);
    const at = (idx) => a.map[Math.min(Math.max(idx, 0), stored.length - 1)];
    return {
        oldChapters, chapters, kept: a.kept, dropped: a.dropped,
        totalWords: chapters.reduce((n, c) => n + c.words, 0),
        progress: progress.map((p) => ({ ...p, to: at(p.paragraph_idx) })),
        marks: marks.map((m) => ({
            ...m, start: at(m.start_para), end: at(m.end_para), chapter: chapterOf(at(m.start_para)),
            onDropped: a.dropped.some((d) => d.idx === m.start_para || d.idx === m.end_para),
        })),
    };
}

function statements(bookId, plan) {
    const s = [
        // move every idx out of the way first: UNIQUE(book_id, idx) is checked row by row
        { sql: `UPDATE book_paragraphs SET idx = -1 - idx WHERE book_id = ?`, args: [bookId] },
        ...plan.dropped.map((d) => ({ sql: `DELETE FROM book_paragraphs WHERE id = ?`, args: [d.id] })),
        ...plan.kept.map((k) => ({ sql: `UPDATE book_paragraphs SET idx = ?, chapter_idx = ? WHERE id = ?`, args: [k.idx, k.chapter_idx, k.id] })),
        { sql: `DELETE FROM book_chapters WHERE book_id = ?`, args: [bookId] },
        ...plan.chapters.map((c) => ({
            sql: `INSERT INTO book_chapters (book_id, idx, title, start_paragraph, paragraph_count, word_count) VALUES (?, ?, ?, ?, ?, ?)`,
            args: [bookId, c.idx, c.title, c.start, c.count, c.words],
        })),
        ...plan.progress.map((p) => ({
            sql: `UPDATE reading_progress SET paragraph_idx = ? WHERE book_id = ? AND user_id = ? AND room_id = ?`,
            args: [p.to, bookId, p.user_id, p.room_id],
        })),
        ...plan.marks.map((m) => ({
            sql: `UPDATE book_marks SET start_para = ?, end_para = ?, chapter_idx = ? WHERE id = ?`,
            args: [m.start, m.end, m.chapter, m.id],
        })),
        { sql: `UPDATE books SET total_paragraphs = ?, total_words = ? WHERE id = ?`, args: [plan.kept.length, plan.totalWords, bookId] },
    ];
    return s;
}

async function main() {
    const apply = process.argv.includes("--apply");
    const only = process.argv.includes("--book") ? Number(process.argv[process.argv.indexOf("--book") + 1]) : null;
    try {
        await initDb();
        const db = getDb();
        const books = await db.all(`SELECT id, title FROM books ORDER BY id`);
        for (const book of books) {
            if (only && book.id !== only) continue;
            const plan = await planBook(db, book);
            if (plan.same) { console.log(`[${book.id}] ${book.title}: no change`); continue; }
            if (plan.skip) { console.log(`[${book.id}] ${book.title}: SKIPPED (${plan.skip})`); continue; }
            console.log(`[${book.id}] ${book.title}: ${plan.oldChapters.length} -> ${plan.chapters.length} chapters, `
                + `${plan.kept.length + plan.dropped.length} -> ${plan.kept.length} paragraphs`);
            console.log(`   chapters: ${plan.chapters.map((c) => c.title).join(" | ")}`);
            for (const d of plan.dropped.slice(0, 40)) console.log(`   drop #${d.idx}: ${d.text.slice(0, 70)}`);
            for (const p of plan.progress) console.log(`   progress user ${p.user_id} room ${p.room_id}: ${p.paragraph_idx} -> ${p.to}`);
            for (const m of plan.marks) {
                console.log(`   mark ${m.id}: para ${m.start_para}-${m.end_para} ch ${m.chapter_idx} -> ${m.start}-${m.end} ch ${m.chapter}`
                    + `${m.onDropped ? "  (ON A DROPPED PARAGRAPH)" : ""}  "${m.quote.slice(0, 40)}"`);
            }
            if (plan.marks.some((m) => m.onDropped)) { console.log("   SKIPPED: a mark sits on a dropped paragraph"); continue; }
            if (apply) {
                await db.batch(statements(book.id, plan));
                console.log("   applied");
            }
        }
        if (!apply) console.log("Dry run. Add --apply to write.");
    } catch (err) {
        console.error(err);
        process.exitCode = 1;
    }
}

if (require.main === module) {
    require("dotenv").config({ quiet: true });
    main();
}

module.exports = { alignParagraphs };
