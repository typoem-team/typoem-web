// Real-SQL test for roomsModel.listRoomsForUser: what a home room card shows
// (today's poem title, the room's book and my progress in it).
process.env.DB_PATH = ":memory:";
delete process.env.TURSO_DATABASE_URL;
delete process.env.TURSO_AUTH_TOKEN;

const { initDb } = require("../../db");
const roomsModel = require("../../models/roomsModel");

const TODAY = "2026-11-13";
let db;

beforeAll(async () => {
    db = await initDb();
    for (const name of ["alice", "bob"]) {
        await db.run(`INSERT INTO users (username, nickname, password_hash) VALUES (?, ?, ?)`, [name, name, "x"]);
    }
    // room 1: poem today + book; room 2: poem only on another day, no book; room 3: bob only
    for (const [name, code] of [["r1", "AAAAAA"], ["r2", "BBBBBB"], ["r3", "CCCCCC"]]) {
        await db.run(`INSERT INTO rooms (name, invite_code, owner_id) VALUES (?, ?, 1)`, [name, code]);
    }
    for (const [room, user] of [[1, 1], [1, 2], [2, 1], [3, 2]]) {
        await db.run(`INSERT INTO room_members (room_id, user_id) VALUES (?, ?)`, [room, user]);
    }
    await db.run(`INSERT INTO poems (id, title, author, linecount) VALUES (1, 'Lights Out', 'Edward Thomas', 1)`);
    await db.run(`INSERT INTO daily_room_poems (room_id, poem_id, date) VALUES (1, 1, ?)`, [TODAY]);
    await db.run(`INSERT INTO daily_room_poems (room_id, poem_id, date) VALUES (2, 1, '2026-11-12')`);

    // book of 4 paragraphs x 25 words = 100 words
    await db.run(`INSERT INTO books (id, title, author, total_words, total_paragraphs) VALUES (9, 'Emma', 'Jane Austen', 100, 4)`);
    for (let i = 0; i < 4; i++) {
        await db.run(`INSERT INTO book_paragraphs (book_id, idx, chapter_idx, text, word_count) VALUES (9, ?, 0, 'x', 25)`, [i]);
    }
    await db.run(`INSERT INTO room_books (room_id, book_id, set_by) VALUES (1, 9, 1)`);
    // alice is at paragraph 3 (3 paragraphs = 75 words before it); bob has not started
    await db.run(`INSERT INTO reading_progress (user_id, room_id, book_id, paragraph_idx) VALUES (1, 1, 9, 3)`);
});

test("room cards carry today's poem title, the book and my own progress", async () => {
    const rooms = await roomsModel.listRoomsForUser(1, TODAY);
    expect(rooms.map((r) => r.id)).toEqual([2, 1]); // newest first, only my rooms

    const [r2, r1] = rooms;
    expect(r1).toMatchObject({ name: "r1", member_count: 2, today_poem_title: "Lights Out", book_title: "Emma", book_progress: 75 });
    expect(r2).toMatchObject({ today_poem_title: null, book_title: null, book_progress: null }); // yesterday's poem doesn't count
    expect(r1).not.toHaveProperty("book_words_read");
});

test("the room I opened last comes first; rooms never opened keep newest-first after it", async () => {
    await db.run(`INSERT INTO rooms (name, invite_code, owner_id) VALUES ('r4', 'DDDDDD', 1)`);
    await db.run(`INSERT INTO room_members (room_id, user_id) VALUES (4, 1)`);
    expect((await roomsModel.listRoomsForUser(1, TODAY)).map((r) => r.id)).toEqual([4, 2, 1]);

    await roomsModel.markOpened(2, 1);
    await new Promise((r) => setTimeout(r, 5));   // the timestamp has millisecond resolution
    await roomsModel.markOpened(1, 1);
    const rooms = await roomsModel.listRoomsForUser(1, TODAY);
    expect(rooms.map((r) => r.id)).toEqual([1, 2, 4]);
    expect(rooms[0].last_opened_at).toEqual(expect.any(String));
    expect(rooms[2].last_opened_at).toBeNull();

    // only my own membership moves: bob's order is untouched
    expect((await roomsModel.listRoomsForUser(2, TODAY)).map((r) => r.id)).toEqual([3, 1]);
});

test("a member who hasn't opened the book is at 0%", async () => {
    const r1 = (await roomsModel.listRoomsForUser(2, TODAY)).find((r) => r.id === 1);
    expect(r1.book_progress).toBe(0);
});
