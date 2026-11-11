const { getDb } = require('../db');

//// functions are confusing!! I left short notes and explanation in the bottom of this codes...

// today's poem id / null if none assigned yet.
async function getTodayPoemId(room_id, date) {
    const today_poem = await getDb().get(
        `SELECT poem_id FROM daily_room_poems WHERE room_id = ? AND date = ?`,
        [room_id, date]
    );
    return today_poem ? today_poem.poem_id : null;
}

// cache lookup only: is this poem already stored in `poems`? (storage dedup)
// returns null -> not cached yet. The no-repeat rule is roomHasSeenPoem, not this.
async function findPoemByTitleAuthor(title, author) {
    const poem = await getDb().get(
        `SELECT id FROM poems WHERE title = ? AND author = ?`,
        [title, author]
    );
    return poem ? poem.id : null;
}

// no-repeat check (date-independent): has this room ever received this poem?
async function roomHasSeenPoem(room_id, poem_id) {
    const row = await getDb().get(
        `SELECT 1 FROM daily_room_poems WHERE room_id = ? AND poem_id = ? LIMIT 1`,
        [room_id, poem_id]
    );
    return !!row;
}

// cache a new poem and its lines in one transaction; return the new poem id.
// empty lines preserved for poem rendering.
async function createPoemWithLines({ title, author, lines }) {
    const db = getDb();
    const all = Array.isArray(lines) ? lines : [];
    // normalize: blank lines -> '', content lines kept verbatim
    const normalized = all.map((l) => (l && l.trim().length > 0 ? l : ''));
    const linecount = normalized.filter((l) => l !== '').length;

    try {
        await db.exec('BEGIN');
        const result = await db.run(
            `INSERT INTO poems (title, author, linecount) VALUES (?, ?, ?)`,
            [title, author, linecount]
        );
        const poem_id = result.lastID;
        // insert lines in multi-row batches: one DB round trip per 100 lines
        // instead of one per line (matters a lot with a remote DB)
        const BATCH = 100;
        for (let start = 0; start < normalized.length; start += BATCH) {
            const chunk = normalized.slice(start, start + BATCH);
            const placeholders = chunk.map(() => '(?, ?, ?)').join(', ');
            const params = [];
            chunk.forEach((text, j) => params.push(poem_id, start + j + 1, text));
            await db.run(
                `INSERT INTO poem_lines (poem_id, line_number, text) VALUES ${placeholders}`,
                params
            );
        }
        await db.exec('COMMIT');
        return poem_id;
    } catch (err) {
        await db.exec('ROLLBACK');
        throw err;
    }
}

// poem cache get-or-create (NOT date/room-specific): reuse if (title,author)
// already stored, else cache it. Call only on the finally-chosen candidate.
async function findOrCreatePoem({ title, author, lines }) {
    const existing = await findPoemByTitleAuthor(title, author);
    if (existing) return existing;
    return await createPoemWithLines({ title, author, lines });
}

// only one poem should be assigned in one day. UNIQUE(room_id, date)
async function assignPoemToRoom(room_id, poem_id, date) {
    try {
        await getDb().run(
            `INSERT INTO daily_room_poems (room_id, poem_id, date) VALUES (?, ?, ?)`,
            [room_id, poem_id, date]
        );
        return poem_id;
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT' && /UNIQUE/i.test(err.message)) {
            return await getTodayPoemId(room_id, date);
        }
        throw err;
    }
}

// full poem payload for the response: poem meta + its lines (line_number ASC).
async function findPoemWithLines(poem_id) {
    const db = getDb();
    const poem = await db.get(
        `SELECT id, title, author, linecount FROM poems WHERE id = ?`,
        [poem_id]
    );
    if (!poem) return null;
    const lines = await db.all(
        `SELECT id, line_number, text FROM poem_lines WHERE poem_id = ? ORDER BY line_number ASC`,
        [poem_id]
    );
    return { ...poem, lines };
}

// line annotations scoped to today's poem in this room.
// line_annotations has no poem_id, so we join poem_lines to restrict to the poem's lines.
// This is the agreed annotation response shape
// (P9 writes should return the same fields). Top-to-bottom by line, oldest-first within.
async function listAnnotationsForRoomPoem(room_id, poem_id) {
    return await getDb().all(
        `SELECT la.id, la.line_id, pl.line_number, la.room_id, la.user_id,
                la.content, la.created_at, u.nickname AS author_nickname
         FROM line_annotations la
         JOIN poem_lines pl ON pl.id = la.line_id
         JOIN users u       ON u.id  = la.user_id
         WHERE la.room_id = ? AND pl.poem_id = ?
         ORDER BY pl.line_number ASC, la.created_at ASC, la.id ASC`,
        [room_id, poem_id]
    );
}

async function listRoomHistory(room_id) {
    return await getDb().all(
        `SELECT d.date, p.id AS poem_id, p.title, p.author,
                (SELECT COUNT(*) FROM (
                    SELECT m.user_id
                      FROM memos m
                     WHERE m.room_id = d.room_id AND m.poem_id = d.poem_id
                    UNION
                    SELECT la.user_id
                      FROM line_annotations la
                      JOIN poem_lines pl ON pl.id = la.line_id
                     WHERE la.room_id = d.room_id AND pl.poem_id = d.poem_id
                 )) AS contributor_count,
                (SELECT GROUP_CONCAT(nickname) FROM (
                    SELECT DISTINCT u.nickname
                      FROM memos m JOIN users u ON u.id = m.user_id
                     WHERE m.room_id = d.room_id AND m.poem_id = d.poem_id
                    UNION
                    SELECT DISTINCT u.nickname
                      FROM line_annotations la
                      JOIN poem_lines pl ON pl.id = la.line_id
                      JOIN users u ON u.id = la.user_id
                     WHERE la.room_id = d.room_id AND pl.poem_id = d.poem_id
                 )) AS contributors
           FROM daily_room_poems d
           JOIN poems p ON p.id = d.poem_id
          WHERE d.room_id = ?
          ORDER BY d.date DESC`,
        [room_id]
    );
}

module.exports = {
    getTodayPoemId,          // today's assigned poem id for this room, or null
    findPoemByTitleAuthor,   // cache lookup only: returns id if stored, else null (no write)
    roomHasSeenPoem,         // has this room ever received this poem? (no-repeat check)
    createPoemWithLines,     // store a new poem + its lines (keeps blank lines as ''), returns new poem_id
    findOrCreatePoem,        // reuse if cached, else store new (get-or-create)
    assignPoemToRoom,        // assign today's poem to the room; on clash, returns the winning poem_id
    findPoemWithLines,       // load a stored poem + its lines (for the response)
    listAnnotationsForRoomPoem, // get annotations on this poem in this room
    listRoomHistory
};

// Three similarly-named helpers — don't mix them up:
//   findPoemByTitleAuthor : read only  (is this poem in the cache?)
//   createPoemWithLines : write only (store a brand-new poem)
//   !!findOrCreatePoem!! : the two combined (get-or-create) — call THIS from the controller