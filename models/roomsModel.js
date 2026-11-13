// helper: Generate Invite code
const crypto = require('crypto');
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 6 chars, uppercase + digits, omitting confusable characters (0/O, 1/I/L)
function generateInviteCode(length = 6) { // Just random. Duplicate checks are handled afterwards
    let code = '';
    for (let i = 0; i < length; i++) {
        code += ALPHABET[crypto.randomInt(ALPHABET.length)];
    }
    return code;
}

// helper: throw SQL errors
class InviteCodeGenerationError extends Error {
    constructor() {
        super("Failed to generate a unique invite code");
        this.name = "InviteCodeGenerationError";
    }
}
class AlreadyMemberError extends Error {
    constructor() {
        super("User is already a member of this room");
        this.name = "AlreadyMemberError";
    }
}

const { getDb } = require('../db');
const { cleanBookTitle } = require('../lib/bookTitle');


// finders

async function findById(id) { return await getDb().get(`SELECT * FROM rooms WHERE id = ?`, [id]); }
// return object about one room { id, name, description, invite_code, owner_id } 

async function findByInviteCode(invite_code) { return await getDb().get(`SELECT * FROM rooms WHERE invite_code = ?`, [invite_code]); }
//return object about one room { id, name, description, invite_code, owner_id } 

async function isMember(room_id, user_id) {
    const row = await getDb().get(`SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?`, [room_id, user_id]);
    return !!row;
} // return boolean

async function countOwnedRooms(user_id) {
    const row = await getDb().get(`SELECT COUNT(*) AS n FROM rooms WHERE owner_id = ?`, [user_id]);
    return row.n;
} // return number of rooms this user owns

async function countMemberships(user_id) {
    const row = await getDb().get(`SELECT COUNT(*) AS n FROM room_members WHERE user_id = ?`, [user_id]);
    return row.n;
} // return number of rooms this user belongs to (owned rooms included)


// rooms user belongs to — the one I opened last first (last_opened_at, any device), then newest —
// with what a home room card shows:
// today_poem_title (null until someone opens today's poem — listing never assigns one),
// book_title, book_progress (my % of the room's book by words read; 0 before I start, null without a book).
async function listRoomsForUser(user_id, date) {
    const rows = await getDb().all(
        `SELECT r.id, r.name, r.description, r.invite_code, r.owner_id, rm.last_opened_at,
                (SELECT COUNT(*) FROM room_members WHERE room_id = r.id) AS member_count,
                (SELECT p.title FROM daily_room_poems d JOIN poems p ON p.id = d.poem_id
                  WHERE d.room_id = r.id AND d.date = ?) AS today_poem_title,
                b.title AS book_title,
                b.total_words AS book_total_words,
                (SELECT COALESCE(SUM(bp.word_count), 0) FROM book_paragraphs bp
                  WHERE bp.book_id = rb.book_id
                    AND bp.idx < (SELECT rp.paragraph_idx FROM reading_progress rp
                                   WHERE rp.user_id = rm.user_id AND rp.room_id = r.id AND rp.book_id = rb.book_id)
                ) AS book_words_read
         FROM rooms r
         JOIN room_members rm ON rm.room_id = r.id
         LEFT JOIN room_books rb ON rb.room_id = r.id
         LEFT JOIN books b ON b.id = rb.book_id
         WHERE rm.user_id = ?
         ORDER BY rm.last_opened_at IS NULL, rm.last_opened_at DESC, r.id DESC`,
        [date, user_id]
    );
    return rows.map(({ book_total_words, book_words_read, ...room }) => ({
        ...room,
        today_poem_title: room.today_poem_title ?? null,
        book_title: room.book_title == null ? null : cleanBookTitle(room.book_title),
        book_progress: room.book_title == null ? null
            : book_total_words > 0 ? Math.min(100, Math.floor((book_words_read * 100) / book_total_words)) : 0,
    }));
} // return array of rooms

async function listMembers(room_id) { // list members of a room, joined with user info
    return await getDb().all(
        `SELECT u.id, u.username, u.nickname, rm.role
         FROM room_members rm
         JOIN users u ON u.id = rm.user_id
         WHERE rm.room_id = ?
         ORDER BY rm.id ASC`,
        [room_id]
    );
} // return array of members

// create a room; owner is auto-added as a member with role='owner'.
// retries on invite_code UNIQUE collisions.
const MAX_INVITE_CODE_RETRIES = 50;
async function createRoom({ name, description, owner_id }) {
    for (let attempt = 0; attempt < MAX_INVITE_CODE_RETRIES; attempt++) {
        const invite_code = generateInviteCode();
        try {
            // one batch = one transaction: the room and its owner row land together or not at all
            const [room] = await getDb().batch([
                {
                    sql: `INSERT INTO rooms (name, description, invite_code, owner_id) VALUES (?, ?, ?, ?)`,
                    args: [name, description, invite_code, owner_id],
                },
                {
                    sql: `INSERT INTO room_members (room_id, user_id, role)
                          VALUES ((SELECT id FROM rooms WHERE invite_code = ?), ?, 'owner')`,
                    args: [invite_code, owner_id],
                },
            ]);
            return { id: room.lastID, name, description, invite_code, owner_id };
        } catch (err) {
            // retry only on invite_code UNIQUE collision
            if (err.code === "SQLITE_CONSTRAINT" && /UNIQUE/i.test(err.message) && /invite_code/i.test(err.message)) {
                continue;
            }
            throw err;
        }
    }
    throw new InviteCodeGenerationError();
}

// add a member to a room
async function addMember({ room_id, user_id, role = "member" }) {
    try {
        return await getDb().run(
            `INSERT INTO room_members (room_id, user_id, role) VALUES (?, ?, ?)`,
            [room_id, user_id, role]
        );
    } catch (err) {
        if (err.code === "SQLITE_CONSTRAINT" && /UNIQUE/i.test(err.message)) {
            throw new AlreadyMemberError();
        }
        throw err;
    }
}

// remove a member from a room (used by leave)
async function removeMember(room_id, user_id) {
    return await getDb().run(`DELETE FROM room_members WHERE room_id = ? AND user_id = ?`, [room_id, user_id]);
}

// delete a room and all dependent rows (no ON DELETE CASCADE in schema).
// One batch: atomic and a single DB round trip. memo_likes must go before memos,
// otherwise a room with liked memos fails the foreign key check.
async function deleteRoom(room_id) {
    const stmts = [
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
    const results = await getDb().batch(stmts);
    return results[results.length - 1];
}

// I opened this room's poem or book: it goes first in my room list (any device).
async function markOpened(room_id, user_id) {
    await getDb().run(
        `UPDATE room_members SET last_opened_at = strftime('%Y-%m-%d %H:%M:%f', 'now') WHERE room_id = ? AND user_id = ?`,
        [room_id, user_id]
    );
}

module.exports = { findById, markOpened, findByInviteCode, isMember, listRoomsForUser, listMembers, createRoom, addMember, removeMember, deleteRoom, countOwnedRooms, countMemberships, InviteCodeGenerationError, AlreadyMemberError };