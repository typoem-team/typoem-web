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


async function listRoomsForUser(user_id) { // rooms user belong to
    return await getDb().all(
        `SELECT r.id, r.name, r.description, r.invite_code, r.owner_id,
                (SELECT COUNT(*) FROM room_members WHERE room_id = r.id) AS member_count
         FROM rooms r
         JOIN room_members rm ON rm.room_id = r.id
         WHERE rm.user_id = ?
         ORDER BY r.id DESC`,
        [user_id]
    );
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
    const db = getDb();
    for (let attempt = 0; attempt < MAX_INVITE_CODE_RETRIES; attempt++) {
        const invite_code = generateInviteCode();
        try {
            await db.exec("BEGIN");
            const result = await db.run(
                `INSERT INTO rooms (name, description, invite_code, owner_id) VALUES (?, ?, ?, ?)`,
                [name, description, invite_code, owner_id]
            );
            await db.run(
                `INSERT INTO room_members (room_id, user_id, role) VALUES (?, ?, ?)`,
                [result.lastID, owner_id, "owner"]
            );
            await db.exec("COMMIT");
            return { id: result.lastID, name, description, invite_code, owner_id };
        } catch (err) {
            await db.exec("ROLLBACK");
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
async function deleteRoom(room_id) {
    const db = getDb();
    try {
        await db.exec("BEGIN");
        await db.run(`DELETE FROM line_annotations WHERE room_id = ?`, [room_id]);
        await db.run(`DELETE FROM memos WHERE room_id = ?`, [room_id]);
        await db.run(`DELETE FROM daily_room_poems WHERE room_id = ?`, [room_id]);
        await db.run(`DELETE FROM book_marks WHERE room_id = ?`, [room_id]);
        await db.run(`DELETE FROM reading_progress WHERE room_id = ?`, [room_id]);
        await db.run(`DELETE FROM room_books WHERE room_id = ?`, [room_id]);
        await db.run(`DELETE FROM room_members WHERE room_id = ?`, [room_id]);
        const result = await db.run(`DELETE FROM rooms WHERE id = ?`, [room_id]);
        await db.exec("COMMIT");
        return result;
    } catch (err) {
        await db.exec("ROLLBACK");
        throw err;
    }
}

module.exports = { findById, findByInviteCode, isMember, listRoomsForUser, listMembers, createRoom, addMember, removeMember, deleteRoom, countOwnedRooms, countMemberships, InviteCodeGenerationError, AlreadyMemberError };