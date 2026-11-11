const { getDb } = require('../db');

// helper: find the poem assigned to a room "today" (YYYY-MM-DD).
// returns the poem_id, or null if the room has no poem for that date.
async function findTodayPoemId(room_id, date) {
    const row = await getDb().get(
        `SELECT poem_id FROM daily_room_poems WHERE room_id = ? AND date = ?`,
        [room_id, date]
    );
    return row ? row.poem_id : null;
}

// list memos for a room scoped to one poem, newest first.
// joined with the author's nickname so the frontend can show who wrote it.
// viewer_id is the current user, used to compute liked_by_me.
async function listForRoomPoem(room_id, poem_id, viewer_id) {
    return await getDb().all(
        `SELECT m.id, m.user_id, m.room_id, m.poem_id, m.content, m.created_at,
                u.nickname AS author_nickname,
                (SELECT COUNT(*) FROM memo_likes ml WHERE ml.memo_id = m.id) AS like_count,
                EXISTS(SELECT 1 FROM memo_likes ml
                       WHERE ml.memo_id = m.id AND ml.user_id = ?) AS liked_by_me
         FROM memos m
         JOIN users u ON u.id = m.user_id
         WHERE m.room_id = ? AND m.poem_id = ?
         ORDER BY m.created_at DESC, m.id DESC`,
        [viewer_id, room_id, poem_id]
    );
}

// find one memo by id, joined with author nickname.
// used for ownership checks on PATCH/DELETE, and as the response shape
// for create/update so it matches listForRoomPoem.
// viewer_id is used to compute liked_by_me.
async function findById(id, viewer_id) {
    return await getDb().get(
        `SELECT m.id, m.user_id, m.room_id, m.poem_id, m.content, m.created_at,
                u.nickname AS author_nickname,
                (SELECT COUNT(*) FROM memo_likes ml WHERE ml.memo_id = m.id) AS like_count,
                EXISTS(SELECT 1 FROM memo_likes ml
                       WHERE ml.memo_id = m.id AND ml.user_id = ?) AS liked_by_me
         FROM memos m
         JOIN users u ON u.id = m.user_id
         WHERE m.id = ?`,
        [viewer_id, id]
    );
}

// create a memo and return the full inserted row.
async function createMemo({ user_id, room_id, poem_id, content }) {
    const result = await getDb().run(
        `INSERT INTO memos (user_id, room_id, poem_id, content) VALUES (?, ?, ?, ?)`,
        [user_id, room_id, poem_id, content]
    );
    return await findById(result.lastID, user_id);
}

// update a memo's content and return the updated row.
async function updateMemo(id, content, viewer_id) {
    await getDb().run(`UPDATE memos SET content = ? WHERE id = ?`, [content, id]);
    return await findById(id, viewer_id);
}

// delete a memo together with its likes.
// memo_likes references memos without ON DELETE CASCADE, so deleting a memo that
// has likes failed the foreign key check (500). One batch = one atomic round trip.
async function deleteMemo(id) {
    const [, del] = await getDb().batch([
        { sql: `DELETE FROM memo_likes WHERE memo_id = ?`, args: [id] },
        { sql: `DELETE FROM memos WHERE id = ?`, args: [id] },
    ]);
    return del;
}

// toggle a like on a memo for a user.
// if the like exists, remove it; otherwise add it.
// returns the new state: { liked, like_count }
async function toggleLike(memo_id, user_id) {
    const existing = await getDb().get(
        `SELECT 1 FROM memo_likes WHERE memo_id = ? AND user_id = ?`,
        [memo_id, user_id]
    );
    if (existing) {
        await getDb().run(
            `DELETE FROM memo_likes WHERE memo_id = ? AND user_id = ?`,
            [memo_id, user_id]
        );
    } else {
        await getDb().run(
            `INSERT INTO memo_likes (memo_id, user_id) VALUES (?, ?)`,
            [memo_id, user_id]
        );
    }
    const row = await getDb().get(
        `SELECT COUNT(*) AS like_count FROM memo_likes WHERE memo_id = ?`,
        [memo_id]
    );
    return { liked: !existing, like_count: row.like_count };
}

module.exports = {
    findTodayPoemId,
    listForRoomPoem,
    findById,
    createMemo,
    updateMemo,
    deleteMemo,
    toggleLike,
};