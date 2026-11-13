// Real-SQL test for the two multi-row writes that used to run inside a server-wide
// BEGIN/COMMIT (db.js): they now go through db.batch() and must stay atomic.
process.env.DB_PATH = ":memory:";
delete process.env.TURSO_DATABASE_URL;
delete process.env.TURSO_AUTH_TOKEN;

const { initDb } = require("../../db");
const roomsModel = require("../../models/roomsModel");
const poemsModel = require("../../models/poemsModel");

let db;

beforeAll(async () => {
    db = await initDb();
    await db.run(`INSERT INTO users (username, nickname, password_hash) VALUES ('alice', 'alice', 'x')`);
});

test("createRoom stores the room and its owner membership together", async () => {
    const room = await roomsModel.createRoom({ name: "r", description: undefined, owner_id: 1 });
    const member = await db.get(`SELECT room_id, user_id, role FROM room_members WHERE room_id = ?`, [room.id]);
    expect(member).toEqual({ room_id: room.id, user_id: 1, role: "owner" });
});

test("createRoom leaves nothing behind when the owner row fails", async () => {
    const before = await db.get(`SELECT COUNT(*) AS n FROM rooms`);
    // user 999 does not exist -> the room_members foreign key fails -> the room insert is undone too
    await expect(roomsModel.createRoom({ name: "x", owner_id: 999 })).rejects.toThrow();
    const after = await db.get(`SELECT COUNT(*) AS n FROM rooms`);
    expect(after.n).toBe(before.n);
});

test("createPoemWithLines links every line (over 100, blank lines kept) to the new poem", async () => {
    await poemsModel.createPoemWithLines({ title: "Old", author: "A", lines: ["x", "y", "z", "w"] });
    const lines = Array.from({ length: 150 }, (_, i) => (i === 3 ? "  " : `line ${i + 1}`));
    const id = await poemsModel.createPoemWithLines({ title: "Long", author: "B", lines });

    const poem = await poemsModel.findPoemWithLines(id);
    expect(poem.title).toBe("Long");
    expect(poem.linecount).toBe(149);
    expect(poem.lines).toHaveLength(150);
    expect(poem.lines[3].text).toBe("");
    expect(poem.lines[149]).toMatchObject({ line_number: 150, text: "line 150" });
});
