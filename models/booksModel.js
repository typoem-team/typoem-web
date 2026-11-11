// Books (v1.1): imported Gutenberg novels, the book each room reads, and per-user progress.
//
// Import design (see db/schema.sql "Books (v1.1)"):
//   1. clean up leftovers of an earlier failed import (only while no books row exists)
//   2. book_chapters, then book_paragraphs in batches of PARAGRAPHS_PER_BATCH (INSERT OR IGNORE)
//   3. the books row LAST, only if the stored chapter/paragraph counts match the parse
// A book counts as imported only when its books row exists, so a half-finished import is
// invisible and is simply redone on the next attempt. Never uses exec('BEGIN'): db.js has one
// global transaction for the whole server, so bulk writes go through db.batch() instead.

const { getDb } = require("../db");
const { wordCount } = require("../lib/bookFetch");

const PARAGRAPHS_PER_BATCH = 300;
const ROWS_PER_STATEMENT = 100; // 100 rows x <= 6 params stays well under SQLite's variable limit

class BookInUseError extends Error {
    constructor() {
        super("Book is assigned to a room");
        this.name = "BookInUseError";
    }
}
class IncompleteImportError extends Error {
    constructor() {
        super("Book import did not complete (row counts did not match); retry");
        this.name = "IncompleteImportError";
    }
}

// in-process lock per book id: concurrent imports of the same book in this server run one after another
const locks = new Map();
async function withBookLock(book_id, fn) {
    const prev = locks.get(book_id) || Promise.resolve();
    const run = prev.then(fn);
    const tail = run.catch(() => {});
    locks.set(book_id, tail);
    try {
        return await run;
    } finally {
        if (locks.get(book_id) === tail) locks.delete(book_id);
    }
}

// rows -> one multi-row INSERT OR IGNORE per ROWS_PER_STATEMENT rows
function insertStatements(table, columns, rows) {
    const out = [];
    const tuple = `(${columns.map(() => "?").join(", ")})`;
    for (let i = 0; i < rows.length; i += ROWS_PER_STATEMENT) {
        const chunk = rows.slice(i, i + ROWS_PER_STATEMENT);
        out.push({
            sql: `INSERT OR IGNORE INTO ${table} (${columns.join(", ")}) VALUES ${chunk.map(() => tuple).join(", ")}`,
            args: chunk.flat(),
        });
    }
    return out;
}

const BOOK_COLUMNS = "id, title, author, author_death_year, total_words, total_paragraphs, created_at";

// ---------------------------------------------------------------- finders

async function findById(id) {
    return await getDb().get(`SELECT ${BOOK_COLUMNS} FROM books WHERE id = ?`, [id]);
} // { id, title, author, author_death_year, total_words, total_paragraphs, created_at } | undefined

// books.id IS the Gutenberg ebook number
async function findByGutenbergId(gutenberg_id) {
    return await findById(gutenberg_id);
}

// which of these Gutenberg ids are already imported (for search results)
async function findImportedIds(ids) {
    const list = (ids || []).filter((n) => Number.isInteger(n));
    if (list.length === 0) return [];
    const rows = await getDb().all(
        `SELECT id FROM books WHERE id IN (${list.map(() => "?").join(", ")})`,
        list
    );
    return rows.map((r) => r.id);
} // array of ids

async function listBooks() {
    return await getDb().all(`SELECT ${BOOK_COLUMNS} FROM books ORDER BY created_at DESC, id DESC`);
} // newest first

async function getChapters(book_id) {
    return await getDb().all(
        `SELECT idx, title, start_paragraph, paragraph_count, word_count
         FROM book_chapters WHERE book_id = ? ORDER BY idx ASC`,
        [book_id]
    );
}

async function getChapterParagraphs(book_id, chapter_idx) {
    return await getDb().all(
        `SELECT id, idx, text FROM book_paragraphs
         WHERE book_id = ? AND chapter_idx = ? ORDER BY idx ASC`,
        [book_id, chapter_idx]
    );
} // [{ id, idx, text }]

// ---------------------------------------------------------------- import

// Gutendex meta -> books row fields
function bookFields(meta, parsed) {
    const authors = Array.isArray(meta.authors) ? meta.authors : [];
    return {
        id: meta.id,
        title: String(meta.title || "Untitled"),
        author: authors.map((a) => a.name).filter(Boolean).join("; ") || "Unknown",
        author_death_year: authors.length && Number.isInteger(authors[0].death_year) ? authors[0].death_year : null,
        total_words: parsed.totalWords,
        total_paragraphs: parsed.chapters.reduce((n, c) => n + c.paragraphs.length, 0),
    };
}

// the actual import; callers hold the book lock
async function importUnlocked(meta, parsed) {
    const db = getDb();
    const book_id = meta.id;

    const existing = await findById(book_id);
    if (existing) return { book: existing, created: false };

    // 1. leftovers of a failed import (guarded: never touches a completed book)
    await db.batch([
        { sql: `DELETE FROM book_paragraphs WHERE book_id = ? AND NOT EXISTS (SELECT 1 FROM books WHERE id = ?)`, args: [book_id, book_id] },
        { sql: `DELETE FROM book_chapters WHERE book_id = ? AND NOT EXISTS (SELECT 1 FROM books WHERE id = ?)`, args: [book_id, book_id] },
    ]);

    // 2. rows
    const chapterRows = [];
    const paragraphRows = [];
    parsed.chapters.forEach((chapter, chapter_idx) => {
        const start = paragraphRows.length;
        let words = 0;
        for (const text of chapter.paragraphs) {
            const wc = wordCount(text);
            words += wc;
            paragraphRows.push([book_id, paragraphRows.length, chapter_idx, text, wc]);
        }
        chapterRows.push([book_id, chapter_idx, chapter.title ?? null, start, chapter.paragraphs.length, words]);
    });

    await db.batch(insertStatements(
        "book_chapters",
        ["book_id", "idx", "title", "start_paragraph", "paragraph_count", "word_count"],
        chapterRows
    ));
    for (let i = 0; i < paragraphRows.length; i += PARAGRAPHS_PER_BATCH) {
        await db.batch(insertStatements(
            "book_paragraphs",
            ["book_id", "idx", "chapter_idx", "text", "word_count"],
            paragraphRows.slice(i, i + PARAGRAPHS_PER_BATCH)
        ));
    }

    // 3. books row last, only if every chapter and paragraph is really there
    //    (another server process may have cleaned up "leftovers" mid-way). Same batch: clamp any
    //    progress left over from an earlier version of this book to the new last paragraph.
    const b = bookFields(meta, parsed);
    await db.batch([
        {
            sql: `INSERT OR IGNORE INTO books (id, title, author, author_death_year, total_words, total_paragraphs)
                  SELECT ?, ?, ?, ?, ?, ?
                  WHERE (SELECT COUNT(*) FROM book_paragraphs WHERE book_id = ?) = ?
                    AND (SELECT COUNT(*) FROM book_chapters WHERE book_id = ?) = ?`,
            args: [b.id, b.title, b.author, b.author_death_year, b.total_words, b.total_paragraphs,
                book_id, paragraphRows.length, book_id, chapterRows.length],
        },
        {
            sql: `UPDATE reading_progress SET paragraph_idx = ?, updated_at = CURRENT_TIMESTAMP
                  WHERE book_id = ? AND paragraph_idx > ?
                    AND EXISTS (SELECT 1 FROM books WHERE id = ? AND total_paragraphs = ?)`,
            args: [b.total_paragraphs - 1, book_id, b.total_paragraphs - 1, book_id, b.total_paragraphs],
        },
    ]);

    const book = await findById(book_id);
    if (!book) throw new IncompleteImportError();
    return { book, created: true };
}

// import a parsed book (meta = Gutendex book, parsed = bookFetch.parseBook() result).
// Already imported (or imported concurrently) -> the existing book. -> { book, created }
async function importBook(meta, parsed) {
    if (!meta || !Number.isInteger(meta.id) || !parsed || !Array.isArray(parsed.chapters) || parsed.chapters.length === 0) {
        throw new TypeError("importBook needs a Gutendex meta with an integer id and a parsed book");
    }
    return withBookLock(meta.id, () => importUnlocked(meta, parsed));
}

// Replace a book with a fresh parse (e.g. after a parser fix). Only while no room uses it;
// otherwise BookInUseError. Paragraph ids change. Progress beyond the new end is clamped.
async function reimportBook(meta, parsed) {
    if (!meta || !Number.isInteger(meta.id)) throw new TypeError("reimportBook needs a Gutendex meta with an integer id");
    return withBookLock(meta.id, async () => {
        const db = getDb();
        const book_id = meta.id;
        // delete the books row first (guarded by "no room uses it"); the dependent deletes only
        // run once the books row is gone, so a book in use is left untouched
        const [del] = await db.batch([
            { sql: `DELETE FROM books WHERE id = ? AND NOT EXISTS (SELECT 1 FROM room_books WHERE book_id = ?)`, args: [book_id, book_id] },
            { sql: `DELETE FROM book_paragraphs WHERE book_id = ? AND NOT EXISTS (SELECT 1 FROM books WHERE id = ?)`, args: [book_id, book_id] },
            { sql: `DELETE FROM book_chapters WHERE book_id = ? AND NOT EXISTS (SELECT 1 FROM books WHERE id = ?)`, args: [book_id, book_id] },
        ]);
        if (del.changes === 0 && (await findById(book_id))) throw new BookInUseError();
        return importUnlocked(meta, parsed);
    });
}

// ---------------------------------------------------------------- room book

async function getRoomBook(room_id) {
    return await getDb().get(
        `SELECT rb.room_id, rb.book_id, rb.set_by, rb.set_at,
                b.title, b.author, b.author_death_year, b.total_words, b.total_paragraphs
         FROM room_books rb JOIN books b ON b.id = rb.book_id
         WHERE rb.room_id = ?`,
        [room_id]
    );
} // undefined when the room has no book

async function setRoomBook(room_id, book_id, user_id) {
    await getDb().run(
        `INSERT INTO room_books (room_id, book_id, set_by) VALUES (?, ?, ?)
         ON CONFLICT(room_id) DO UPDATE SET
           book_id = excluded.book_id, set_by = excluded.set_by, set_at = CURRENT_TIMESTAMP`,
        [room_id, book_id, user_id]
    );
    return await getRoomBook(room_id);
}

async function clearRoomBook(room_id) {
    return await getDb().run(`DELETE FROM room_books WHERE room_id = ?`, [room_id]);
}

// ---------------------------------------------------------------- progress

async function getProgress(user_id, room_id, book_id) {
    return await getDb().get(
        `SELECT user_id, room_id, book_id, paragraph_idx, target_end_date, started_at, updated_at
         FROM reading_progress WHERE user_id = ? AND room_id = ? AND book_id = ?`,
        [user_id, room_id, book_id]
    );
} // undefined when the user hasn't started this book in this room

// target_end_date: 'YYYY-MM-DD' or null sets it; undefined keeps the stored value
async function upsertProgress({ user_id, room_id, book_id, paragraph_idx, target_end_date }) {
    const keep = target_end_date === undefined ? 1 : 0;
    await getDb().run(
        `INSERT INTO reading_progress (user_id, room_id, book_id, paragraph_idx, target_end_date)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(user_id, room_id, book_id) DO UPDATE SET
           paragraph_idx = excluded.paragraph_idx,
           target_end_date = CASE WHEN ? THEN reading_progress.target_end_date ELSE excluded.target_end_date END,
           updated_at = CURRENT_TIMESTAMP`,
        [user_id, room_id, book_id, paragraph_idx, keep ? null : target_end_date, keep]
    );
    return await getProgress(user_id, room_id, book_id);
}

// everyone who is a member of the room now and has progress on this book in this room
// (people who left the room keep their progress row but are not listed)
async function getReaders(room_id, book_id) {
    return await getDb().all(
        `SELECT rp.user_id, u.nickname, rp.paragraph_idx
         FROM reading_progress rp
         JOIN room_members rm ON rm.room_id = rp.room_id AND rm.user_id = rp.user_id
         JOIN users u ON u.id = rp.user_id
         WHERE rp.room_id = ? AND rp.book_id = ?
         ORDER BY rm.id ASC`,
        [room_id, book_id]
    );
} // [{ user_id, nickname, paragraph_idx }]

module.exports = {
    findById,
    findByGutenbergId,
    findImportedIds,
    listBooks,
    getChapters,
    getChapterParagraphs,
    importBook,
    reimportBook,
    getRoomBook,
    setRoomBook,
    clearRoomBook,
    getProgress,
    upsertProgress,
    getReaders,
    BookInUseError,
    IncompleteImportError,
    PARAGRAPHS_PER_BATCH,
    ROWS_PER_STATEMENT,
};
