// Real-SQL tests for models/poemMarksModel.js and the
// poem_marks cleanup in roomsModel.deleteRoom. No mocks: an in-memory libSQL database.

process.env.DB_PATH = ":memory:";
delete process.env.TURSO_DATABASE_URL;
delete process.env.TURSO_AUTH_TOKEN;

const { initDb, getDb } = require("../../db");
const marksModel = require("../../models/poemMarksModel");
const roomsModel = require("../../models/roomsModel");

async function count(sql, args = []) {
    return (await getDb().get(sql, args)).n;
}

// poem 1 lines: 1 "Whose woods these are I think I know." / 2 "" / 3 "His house is in the _village_ though;"
const LINES = ["Whose woods these are I think I know.", "", "His house is in the _village_ though;"];
let lineIds = [];

beforeAll(async () => {
    // never run these writes against a real DB (e.g. if something loaded .env again)
    if (process.env.TURSO_DATABASE_URL || process.env.DB_PATH !== ":memory:") {
        throw new Error("poemMarksDb.test.js must run on an in-memory DB");
    }
    const db = await initDb();
    for (const name of ["alice", "bob"]) {
        await db.run(`INSERT INTO users (username, nickname, password_hash) VALUES (?, ?, ?)`, [name, name, "x"]);
    }
    await db.run(`INSERT INTO rooms (name, invite_code, owner_id) VALUES ('r1', 'AAAAAA', 1)`);
    await db.run(`INSERT INTO rooms (name, invite_code, owner_id) VALUES ('r2', 'BBBBBB', 1)`);
    await db.run(`INSERT INTO poems (title, author, linecount) VALUES ('Woods', 'Frost', 2)`);
    for (let i = 0; i < LINES.length; i++) {
        const r = await db.run(`INSERT INTO poem_lines (poem_id, line_number, text) VALUES (1, ?, ?)`, [i + 1, LINES[i]]);
        lineIds.push(r.lastID);
    }
    await db.run(`INSERT INTO daily_room_poems (room_id, poem_id, date) VALUES (1, 1, '2026-11-11')`);
});

const base = { room_id: 1, poem_id: 1, start_line: 1, start_word: 0, end_line: 3, end_word: 2, quote: "q" };

describe("poemMarksModel", () => {
    test("findLineNumbers returns only lines of that poem", async () => {
        expect((await marksModel.findLineNumbers(1, [0, 1, 3, 3, 4])).sort()).toEqual([1, 3]);
        expect(await marksModel.findLineNumbers(2, [1])).toEqual([]);
    });

    test("create / list / update / delete; response shape matches book marks", async () => {
        const a = await marksModel.createMark({ ...base, user_id: 1, kind: "highlight", color: "pink" });
        const b = await marksModel.createMark({ ...base, user_id: 2, kind: "note", content: "hi" });
        await marksModel.createMark({ ...base, room_id: 2, user_id: 1, kind: "highlight", color: "blue" });

        expect(Object.keys(a).sort()).toEqual([
            "author_nickname", "color", "content", "created_at", "end_line", "end_word", "id", "kind",
            "poem_id", "quote", "room_id", "start_line", "start_word", "user_id",
        ]);
        expect(a).toMatchObject({ ...base, user_id: 1, kind: "highlight", color: "pink", content: null, author_nickname: "alice" });
        expect(b).toMatchObject({ kind: "note", color: null, content: "hi", author_nickname: "bob" });

        expect((await marksModel.listForRoomPoem(1, 1)).map((m) => m.id)).toEqual([a.id, b.id]);
        expect(await marksModel.updateContent(b.id, "edited")).toMatchObject({ id: b.id, content: "edited" });
        await marksModel.deleteMark(a.id);
        expect(await marksModel.findById(a.id)).toBeUndefined();
        await marksModel.deleteMark(b.id);
    });

    test("kind and color are limited by the schema", async () => {
        await expect(marksModel.createMark({ ...base, user_id: 1, kind: "underline" })).rejects.toMatchObject({ code: "SQLITE_CONSTRAINT" });
        await expect(marksModel.createMark({ ...base, user_id: 1, kind: "highlight", color: "red" })).rejects.toMatchObject({ code: "SQLITE_CONSTRAINT" });
    });
});

describe("poemsModel.listRoomHistory", () => {
    test("people who only highlighted or left a passage note count as contributors", async () => {
        const db = getDb();
        await db.run(`INSERT INTO rooms (name, invite_code, owner_id) VALUES ('r3', 'CCCCCC', 1)`);
        const room = (await db.get(`SELECT id FROM rooms WHERE invite_code = 'CCCCCC'`)).id;
        await db.run(`INSERT INTO daily_room_poems (room_id, poem_id, date) VALUES (?, 1, '2026-11-12')`, [room]);
        await marksModel.createMark({ ...base, room_id: room, user_id: 1, kind: "highlight", color: "yellow" });
        await marksModel.createMark({ ...base, room_id: room, user_id: 2, kind: "note", content: "좋다" });
        await marksModel.createMark({ ...base, room_id: room, user_id: 2, kind: "highlight", color: "blue" });

        const [day] = await require("../../models/poemsModel").listRoomHistory(room);
        expect(day.contributor_count).toBe(2);
        expect(day.contributors.split(",").sort()).toEqual(["alice", "bob"]);
    });
});

describe("roomsModel.deleteRoom", () => {
    test("also removes the room's poem marks", async () => {
        await marksModel.createMark({ ...base, room_id: 2, user_id: 1, kind: "highlight", color: "green" });
        await marksModel.createMark({ ...base, room_id: 1, user_id: 1, kind: "highlight", color: "green" });
        const before = await count(`SELECT COUNT(*) AS n FROM poem_marks WHERE room_id = 1`);
        expect(before).toBeGreaterThan(0);

        await getDb().run(`DELETE FROM line_annotations WHERE room_id = 2`);
        await roomsModel.deleteRoom(2);

        expect(await count(`SELECT COUNT(*) AS n FROM poem_marks WHERE room_id = 2`)).toBe(0);
        expect(await count(`SELECT COUNT(*) AS n FROM poem_marks WHERE room_id = 1`)).toBe(before);
    });
});
