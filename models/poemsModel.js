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

// every poem this room has ever received, as [{ title, author }]: one query, so picking
// a fresh poem checks candidates in memory instead of asking the DB once per candidate.
async function listSeenPoems(room_id) {
    return await getDb().all(
        `SELECT DISTINCT p.title, p.author FROM daily_room_poems d JOIN poems p ON p.id = d.poem_id WHERE d.room_id = ?`,
        [room_id]
    );
}

// cache a new poem and its lines atomically, in one DB round trip; return the new poem id.
// empty lines preserved for poem rendering.
async function createPoemWithLines({ title, author, lines }) {
    const all = Array.isArray(lines) ? lines : [];
    // normalize: blank lines -> '', content lines kept verbatim
    const normalized = all.map((l) => (l && l.trim().length > 0 ? l : ''));
    const linecount = normalized.filter((l) => l !== '').length;

    // A batch is one write transaction, so MAX(id) is the poem inserted just before.
    // Lines go 100 per INSERT to stay well under SQLite's bound-parameter limit.
    const statements = [{
        sql: `INSERT INTO poems (title, author, linecount) VALUES (?, ?, ?)`,
        args: [title, author, linecount],
    }];
    const CHUNK = 100;
    for (let start = 0; start < normalized.length; start += CHUNK) {
        const chunk = normalized.slice(start, start + CHUNK);
        const args = [];
        chunk.forEach((text, j) => args.push(start + j + 1, text));
        statements.push({
            sql: `INSERT INTO poem_lines (poem_id, line_number, text) VALUES ` +
                chunk.map(() => '((SELECT MAX(id) FROM poems), ?, ?)').join(', '),
            args,
        });
    }
    const [poem] = await getDb().batch(statements);
    return poem.lastID;
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
    listSeenPoems,           // every { title, author } this room has received (no-repeat check, one query)
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