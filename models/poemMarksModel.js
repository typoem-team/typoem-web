// Poem marks (v1.1): highlights and notes on a word range of a room's poem.
// Same rules as book_marks: a mark covers (start_line, start_word) .. (end_line, end_word),
// both ends inclusive, where *_line = poem_lines.line_number and *_word = 0-based word
// inside that line (lib/poemWords.js).

const { getDb } = require("../db");

// source_annotation_id is internal (migration bookkeeping) and not returned
const MARK_COLUMNS = `m.id, m.room_id, m.poem_id, m.user_id, u.nickname AS author_nickname,
                m.kind, m.color, m.start_line, m.start_word, m.end_line, m.end_word,
                m.quote, m.content, m.created_at`;

// helper: which of these line numbers exist in the poem (for range validation)
// returns [line_number, ...]
async function findLineNumbers(poem_id, line_numbers) {
    const list = [...new Set(line_numbers)];
    const rows = await getDb().all(
        `SELECT line_number FROM poem_lines
         WHERE poem_id = ? AND line_number IN (${list.map(() => "?").join(", ")})`,
        [poem_id, ...list]
    );
    return rows.map((r) => r.line_number);
}

// every mark on this poem in this room, oldest first, with the author's nickname
async function listForRoomPoem(room_id, poem_id) {
    return await getDb().all(
        `SELECT ${MARK_COLUMNS}
         FROM poem_marks m
         JOIN users u ON u.id = m.user_id
         WHERE m.room_id = ? AND m.poem_id = ?
         ORDER BY m.created_at ASC, m.id ASC`,
        [room_id, poem_id]
    );
}

// one mark by id (ownership checks on PATCH/DELETE; also the create/update response shape)
async function findById(id) {
    return await getDb().get(
        `SELECT ${MARK_COLUMNS}
         FROM poem_marks m
         JOIN users u ON u.id = m.user_id
         WHERE m.id = ?`,
        [id]
    );
}

// create a mark and return the full inserted row
// color: highlight colour, null for a note
async function createMark({ room_id, poem_id, user_id, kind, color, start_line, start_word, end_line, end_word, quote, content }) {
    const result = await getDb().run(
        `INSERT INTO poem_marks
           (room_id, poem_id, user_id, kind, color, start_line, start_word, end_line, end_word, quote, content)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [room_id, poem_id, user_id, kind, color ?? null, start_line, start_word, end_line, end_word, quote, content ?? null]
    );
    return await findById(result.lastID);
}

// update a note's content and return the updated row
async function updateContent(id, content) {
    await getDb().run(`UPDATE poem_marks SET content = ? WHERE id = ?`, [content, id]);
    return await findById(id);
}

async function deleteMark(id) {
    return await getDb().run(`DELETE FROM poem_marks WHERE id = ?`, [id]);
}

// ---------------------------------------------------------------- line_annotations migration

// line_annotations rows that have not been copied into poem_marks yet, with their line
async function listUnmigratedAnnotations() {
    return await getDb().all(
        `SELECT la.id, la.room_id, la.user_id, la.content, la.created_at,
                pl.poem_id, pl.line_number, pl.text
         FROM line_annotations la
         JOIN poem_lines pl ON pl.id = la.line_id
         WHERE NOT EXISTS (SELECT 1 FROM poem_marks pm WHERE pm.source_annotation_id = la.id)
         ORDER BY la.id ASC`
    );
}

// copy one annotation as a note; INSERT OR IGNORE on source_annotation_id (UNIQUE) makes a
// second copy impossible even if two runs overlap. Keeps the original created_at.
// returns true if a row was inserted
async function insertFromAnnotation({ source_annotation_id, room_id, poem_id, user_id, line_number, end_word, quote, content, created_at }) {
    const result = await getDb().run(
        `INSERT OR IGNORE INTO poem_marks
           (room_id, poem_id, user_id, kind, color, start_line, start_word, end_line, end_word,
            quote, content, source_annotation_id, created_at)
         VALUES (?, ?, ?, 'note', NULL, ?, 0, ?, ?, ?, ?, ?, ?)`,
        [room_id, poem_id, user_id, line_number, line_number, end_word, quote, content, source_annotation_id, created_at]
    );
    return result.changes > 0;
}

module.exports = {
    findLineNumbers,
    listForRoomPoem,
    findById,
    createMark,
    updateContent,
    deleteMark,
    listUnmigratedAnnotations,
    insertFromAnnotation,
};
