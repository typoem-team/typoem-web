// Book marks (v1.1): highlights and notes on the room's book, one table for both kinds.
// A mark covers (start_para, start_word) .. (end_para, end_word), both ends inclusive,
// where *_para = book_paragraphs.idx and *_word = 0-based .word span inside that paragraph.

const { getDb } = require("../db");

const MARK_COLUMNS = `m.id, m.room_id, m.book_id, m.user_id, u.nickname AS author_nickname,
                m.kind, m.chapter_idx, m.start_para, m.start_word, m.end_para, m.end_word,
                m.quote, m.content, m.created_at`;

// helper: which chapter each of these paragraph idxs is in (for range validation)
// returns [{ idx, chapter_idx }] — idxs that don't exist in the book are simply missing
async function findParagraphChapters(book_id, idxs) {
    const list = [...new Set(idxs)];
    return await getDb().all(
        `SELECT idx, chapter_idx FROM book_paragraphs
         WHERE book_id = ? AND idx IN (${list.map(() => "?").join(", ")})`,
        [book_id, ...list]
    );
}

// every mark in one chapter of the room's book, oldest first, with the author's nickname
async function listForChapter(room_id, book_id, chapter_idx) {
    return await getDb().all(
        `SELECT ${MARK_COLUMNS}
         FROM book_marks m
         JOIN users u ON u.id = m.user_id
         WHERE m.room_id = ? AND m.book_id = ? AND m.chapter_idx = ?
         ORDER BY m.created_at ASC, m.id ASC`,
        [room_id, book_id, chapter_idx]
    );
}

// one mark by id (ownership checks on PATCH/DELETE; also the create/update response shape)
async function findById(id) {
    return await getDb().get(
        `SELECT ${MARK_COLUMNS}
         FROM book_marks m
         JOIN users u ON u.id = m.user_id
         WHERE m.id = ?`,
        [id]
    );
}

// create a mark and return the full inserted row
async function createMark({ room_id, book_id, user_id, kind, chapter_idx, start_para, start_word, end_para, end_word, quote, content }) {
    const result = await getDb().run(
        `INSERT INTO book_marks
           (room_id, book_id, user_id, kind, chapter_idx, start_para, start_word, end_para, end_word, quote, content)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [room_id, book_id, user_id, kind, chapter_idx, start_para, start_word, end_para, end_word, quote, content ?? null]
    );
    return await findById(result.lastID);
}

// update a note's content and return the updated row
async function updateContent(id, content) {
    await getDb().run(`UPDATE book_marks SET content = ? WHERE id = ?`, [content, id]);
    return await findById(id);
}

async function deleteMark(id) {
    return await getDb().run(`DELETE FROM book_marks WHERE id = ?`, [id]);
}

module.exports = {
    findParagraphChapters,
    listForChapter,
    findById,
    createMark,
    updateContent,
    deleteMark,
};
