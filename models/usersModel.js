const { getDb } = require('../db');

// helper: thrown when a duplicate username is inserted
class UsernameTakenError extends Error {
    constructor(username) {
        super(`Username "${username}" is already taken`);
        this.name = "UsernameTakenError";
    }
}

// finders
async function findById(id) { return await getDb().get(`SELECT * FROM users WHERE id = ?`, [id]); } // for '/me' endpoint
async function findByUsername(username) { return await getDb().get(`SELECT * FROM users WHERE username = ?`, [username]); } // for login

// create new user
async function create({ username, nickname, password_hash }) { // password comes in hashed from controllers
    try {
        // created_at: set here (the column was added by ALTER TABLE, which can't give it a default)
        return await getDb().run( `INSERT INTO users (username, nickname, password_hash, created_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)`, [username, nickname, password_hash] );
    } catch (err) {
        if (err.code === "SQLITE_CONSTRAINT" && /UNIQUE/i.test(err.message)) {
            throw new UsernameTakenError(username);
        }
        throw err;
    }
}

// change my nickname; false if the user doesn't exist
async function updateNickname(id, nickname) {
    const result = await getDb().run(`UPDATE users SET nickname = ? WHERE id = ?`, [nickname, id]);
    return result.changes > 0;
}

// statements that remove a room and everything in it (same order as roomsModel.deleteRoom)
function roomDeleteStatements(room_id) {
    return [
        `DELETE FROM memo_likes WHERE memo_id IN (SELECT id FROM memos WHERE room_id = ?)`,
        `DELETE FROM line_annotations WHERE room_id = ?`,
        `DELETE FROM memos WHERE room_id = ?`,
        `DELETE FROM daily_room_poems WHERE room_id = ?`,
        `DELETE FROM poem_marks WHERE room_id = ?`,
        `DELETE FROM book_marks WHERE room_id = ?`,
        `DELETE FROM reading_progress WHERE room_id = ?`,
        `DELETE FROM room_books WHERE room_id = ?`,
        `DELETE FROM room_members WHERE room_id = ?`,
        `DELETE FROM rooms WHERE id = ?`,
    ].map((sql) => ({ sql, args: [room_id] }));
}

// Delete an account and everything that belongs to it (회원 탈퇴).
// Rooms the user owns:
//   - other members left -> the member who joined earliest becomes the owner
//   - nobody else        -> the room is deleted
// Then the user's own memos (and the likes on them), notes, marks, vocab,
// reading progress, streak and memberships go, and finally the user.
// Everything runs as one batch: all of it happens, or none of it.
// Returns { roomsDeleted, roomsHandedOver } or null if the user doesn't exist.
async function deleteAccount(user_id) {
    const db = getDb();
    const user = await findById(user_id);
    if (!user) return null;

    const owned = await db.all(`SELECT id FROM rooms WHERE owner_id = ?`, [user_id]);
    const stmts = [];
    let roomsDeleted = 0;
    let roomsHandedOver = 0;

    for (const { id: room_id } of owned) {
        const next = await db.get(
            `SELECT user_id FROM room_members WHERE room_id = ? AND user_id != ? ORDER BY id ASC LIMIT 1`,
            [room_id, user_id]
        );
        if (next) {
            stmts.push(
                { sql: `UPDATE rooms SET owner_id = ? WHERE id = ?`, args: [next.user_id, room_id] },
                { sql: `UPDATE room_members SET role = 'owner' WHERE room_id = ? AND user_id = ?`, args: [room_id, next.user_id] }
            );
            roomsHandedOver += 1;
        } else {
            stmts.push(...roomDeleteStatements(room_id));
            roomsDeleted += 1;
        }
    }

    const u = [user_id];
    stmts.push(
        // books this user set for a room now count as set by the room's owner
        { sql: `UPDATE room_books SET set_by = (SELECT owner_id FROM rooms WHERE rooms.id = room_books.room_id) WHERE set_by = ?`, args: u },
        { sql: `DELETE FROM memo_likes WHERE user_id = ?`, args: u },
        { sql: `DELETE FROM memo_likes WHERE memo_id IN (SELECT id FROM memos WHERE user_id = ?)`, args: u },
        { sql: `DELETE FROM memos WHERE user_id = ?`, args: u },
        { sql: `DELETE FROM line_annotations WHERE user_id = ?`, args: u },
        { sql: `DELETE FROM poem_marks WHERE user_id = ?`, args: u },
        { sql: `DELETE FROM book_marks WHERE user_id = ?`, args: u },
        { sql: `DELETE FROM reading_progress WHERE user_id = ?`, args: u },
        { sql: `DELETE FROM vocab WHERE user_id = ?`, args: u },
        { sql: `DELETE FROM reading_checkins WHERE user_id = ?`, args: u },
        { sql: `DELETE FROM room_members WHERE user_id = ?`, args: u },
        { sql: `DELETE FROM users WHERE id = ?`, args: u }
    );

    await db.batch(stmts);
    return { roomsDeleted, roomsHandedOver };
}

module.exports = { findById, findByUsername, create, updateNickname, deleteAccount, UsernameTakenError };
