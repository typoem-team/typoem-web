// models/bookHistoryModel.js
// Reading history of books: what a room has read, and whether someone finished a book.
//
// Progress is saved as the first paragraph of the page the reader is on
// (reading_progress.paragraph_idx), so "words read" = words in the paragraphs
// before it — the same rule as the room cards (roomsModel.listRoomsForUser).
// On the last page that anchor is a few paragraphs before the end, so a book
// counts as FINISHED when the reader is on the last paragraph or what is left
// is at most a page or so: max(500 words, 1% of the book).

const { getDb } = require("../db");
const { cleanBookTitle } = require("../lib/bookTitle");

const FINISH_SLACK_WORDS = 500;

function isFinished(row) {
    if (row.paragraph_idx >= row.total_paragraphs - 1) return true;
    const left = row.total_words - row.words_read;
    return left <= Math.max(FINISH_SLACK_WORDS, row.total_words / 100);
}

function percent(row) {
    if (isFinished(row)) return 100;
    if (!(row.total_words > 0)) return 0;
    return Math.min(99, Math.floor((row.words_read * 100) / row.total_words));
}

// reading_progress rows with book info and words read. `where` is a SQL condition on rp.
async function progressRows(where, args) {
    return await getDb().all(
        `SELECT rp.user_id, rp.room_id, rp.book_id, rp.paragraph_idx, rp.started_at, rp.updated_at,
                b.title, b.author, b.total_words, b.total_paragraphs,
                (SELECT COALESCE(SUM(bp.word_count), 0) FROM book_paragraphs bp
                  WHERE bp.book_id = rp.book_id AND bp.idx < rp.paragraph_idx) AS words_read
         FROM reading_progress rp
         JOIN books b ON b.id = rp.book_id
         WHERE ${where}`,
        args
    );
}

// Books this room has read: the current book plus any book a member has progress on.
// For each: my status/progress and everyone in the room who read it.
//   status: finished (I finished it) | reading (the room's current book) | paused
// Current book first, then the one I read most recently.
async function listForRoom(room_id, user_id) {
    const db = getDb();
    // none of these needs another's answer -> one round trip. The current book comes with its
    // title, so a current book nobody has opened yet needs no extra lookup afterwards.
    const [current, rows, members, marks] = await Promise.all([
        db.get(
            `SELECT rb.book_id, b.title, b.author
             FROM room_books rb JOIN books b ON b.id = rb.book_id
             WHERE rb.room_id = ?`,
            [room_id]
        ),
        progressRows(`rp.room_id = ?`, [room_id]),
        db.all(
            `SELECT u.id, u.nickname FROM room_members rm JOIN users u ON u.id = rm.user_id WHERE rm.room_id = ?`,
            [room_id]
        ),
        db.all(
            `SELECT book_id, COUNT(*) AS n FROM book_marks WHERE room_id = ? AND user_id = ? GROUP BY book_id`,
            [room_id, user_id]
        ),
    ]);
    const nicknames = new Map(members.map((u) => [u.id, u.nickname]));
    const markCounts = new Map(marks.map((r) => [r.book_id, r.n]));

    const books = new Map(); // book_id -> entry
    const entry = (book_id, title, author) => {
        if (!books.has(book_id)) {
            books.set(book_id, {
                book_id, title: cleanBookTitle(title), author,
                is_current: current?.book_id === book_id,
                status: null, progress: 0, last_read_at: null, finished_at: null,
                my_mark_count: markCounts.get(book_id) || 0,
                readers: [],
            });
        }
        return books.get(book_id);
    };

    for (const r of rows) {
        const e = entry(r.book_id, r.title, r.author);
        const done = isFinished(r);
        // members who left keep their progress rows; only show people still in the room
        if (nicknames.has(r.user_id)) {
            e.readers.push({ id: r.user_id, nickname: nicknames.get(r.user_id), progress: percent(r), finished: done });
        }
        if (r.user_id === user_id) {
            e.progress = percent(r);
            e.last_read_at = r.updated_at;
            if (done) { e.status = "finished"; e.finished_at = r.updated_at; }
        }
    }

    if (current && !books.has(current.book_id)) entry(current.book_id, current.title, current.author);

    const list = [...books.values()].map((e) => ({
        ...e,
        status: e.status ?? (e.is_current ? "reading" : "paused"),
        readers: e.readers.sort((a, b) => b.progress - a.progress),
    }));
    return list.sort((a, b) =>
        (b.is_current - a.is_current) || String(b.last_read_at ?? "").localeCompare(String(a.last_read_at ?? ""))
    );
}

// how many different books this user finished (any room) — for badges
async function countFinishedBooks(user_id) {
    const rows = await progressRows(`rp.user_id = ?`, [user_id]);
    return new Set(rows.filter(isFinished).map((r) => r.book_id)).size;
}

module.exports = { listForRoom, countFinishedBooks, isFinished, percent };
