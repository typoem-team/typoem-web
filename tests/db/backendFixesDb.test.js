// Real-SQL tests (in-memory libSQL, foreign keys ON):
//   - deleting a liked memo (used to fail the FK check -> 500)
//   - deleting a room whose memos have likes
//   - streak check-ins (idempotent) and the friends view
//   - long poems are stored in batches with lines in order

process.env.DB_PATH = ":memory:";
delete process.env.TURSO_DATABASE_URL;
delete process.env.TURSO_AUTH_TOKEN;

const { initDb, getDb } = require("../../db");
const memosModel = require("../../models/memosModel");
const roomsModel = require("../../models/roomsModel");
const poemsModel = require("../../models/poemsModel");
const streakModel = require("../../models/streakModel");

async function count(sql, args = []) {
  return (await getDb().get(sql, args)).n;
}

beforeAll(async () => {
  if (process.env.TURSO_DATABASE_URL || process.env.DB_PATH !== ":memory:") {
    throw new Error("backendFixesDb.test.js must run on an in-memory DB");
  }
  const db = await initDb();
  for (const name of ["alice", "bob", "carol"]) {
    await db.run(`INSERT INTO users (username, nickname, password_hash) VALUES (?, ?, 'x')`, [name, name]);
  }
  // room 1: alice + bob, room 2: alice only
  await db.run(`INSERT INTO rooms (name, invite_code, owner_id) VALUES ('r1', 'AAAAAA', 1)`);
  await db.run(`INSERT INTO rooms (name, invite_code, owner_id) VALUES ('r2', 'BBBBBB', 1)`);
  await db.run(`INSERT INTO room_members (room_id, user_id, role) VALUES (1, 1, 'owner'), (1, 2, 'member'), (2, 1, 'owner')`);
  await db.run(`INSERT INTO poems (title, author, linecount) VALUES ('P', 'A', 1)`);
});

describe("memosModel.deleteMemo", () => {
  test("foreign keys are enforced in this DB (so the test is meaningful)", async () => {
    await expect(
      getDb().run(`INSERT INTO memo_likes (memo_id, user_id) VALUES (999, 1)`)
    ).rejects.toThrow();
  });

  test("deletes a memo that has likes, and its likes", async () => {
    const memo = await memosModel.createMemo({ user_id: 1, room_id: 1, poem_id: 1, content: "hi" });
    await memosModel.toggleLike(memo.id, 2);
    expect(await count(`SELECT COUNT(*) AS n FROM memo_likes WHERE memo_id = ?`, [memo.id])).toBe(1);

    const result = await memosModel.deleteMemo(memo.id);

    expect(result.changes).toBe(1);
    expect(await count(`SELECT COUNT(*) AS n FROM memos WHERE id = ?`, [memo.id])).toBe(0);
    expect(await count(`SELECT COUNT(*) AS n FROM memo_likes WHERE memo_id = ?`, [memo.id])).toBe(0);
  });

  test("leaves other memos' likes alone", async () => {
    const keep = await memosModel.createMemo({ user_id: 1, room_id: 1, poem_id: 1, content: "keep" });
    const drop = await memosModel.createMemo({ user_id: 1, room_id: 1, poem_id: 1, content: "drop" });
    await memosModel.toggleLike(keep.id, 2);
    await memosModel.toggleLike(drop.id, 2);

    await memosModel.deleteMemo(drop.id);

    expect(await count(`SELECT COUNT(*) AS n FROM memo_likes WHERE memo_id = ?`, [keep.id])).toBe(1);
  });
});

describe("memosModel.createMemo (double submit)", () => {
  test("the same memo sent twice in a row is saved once, both calls get the same row", async () => {
    const first = await memosModel.createMemo({ user_id: 2, room_id: 1, poem_id: 1, content: "double tap" });
    const second = await memosModel.createMemo({ user_id: 2, room_id: 1, poem_id: 1, content: "double tap" });

    expect(second.id).toBe(first.id);
    expect(await count(`SELECT COUNT(*) AS n FROM memos WHERE content = 'double tap'`)).toBe(1);
  });

  test("two requests at the same moment still save one memo", async () => {
    const [a, b] = await Promise.all([
      memosModel.createMemo({ user_id: 2, room_id: 1, poem_id: 1, content: "same moment" }),
      memosModel.createMemo({ user_id: 2, room_id: 1, poem_id: 1, content: "same moment" }),
    ]);

    expect(a.id).toBe(b.id);
    expect(await count(`SELECT COUNT(*) AS n FROM memos WHERE content = 'same moment'`)).toBe(1);
  });

  test("different content, user or room is a new memo", async () => {
    await memosModel.createMemo({ user_id: 2, room_id: 1, poem_id: 1, content: "base" });
    await memosModel.createMemo({ user_id: 2, room_id: 1, poem_id: 1, content: "base!" });
    await memosModel.createMemo({ user_id: 1, room_id: 1, poem_id: 1, content: "base" });
    await memosModel.createMemo({ user_id: 2, room_id: 2, poem_id: 1, content: "base" });

    expect(await count(`SELECT COUNT(*) AS n FROM memos WHERE content IN ('base', 'base!')`)).toBe(4);
  });

  test("the same text again after the 10-second window is a new memo", async () => {
    const old = await memosModel.createMemo({ user_id: 2, room_id: 1, poem_id: 1, content: "later again" });
    await getDb().run(`UPDATE memos SET created_at = datetime('now', '-1 minute') WHERE id = ?`, [old.id]);

    const again = await memosModel.createMemo({ user_id: 2, room_id: 1, poem_id: 1, content: "later again" });

    expect(again.id).not.toBe(old.id);
    expect(await count(`SELECT COUNT(*) AS n FROM memos WHERE content = 'later again'`)).toBe(2);
  });
});

describe("roomsModel.deleteRoom", () => {
  test("deletes a room whose memos have likes", async () => {
    const db = getDb();
    await db.run(`INSERT INTO rooms (name, invite_code, owner_id) VALUES ('r3', 'CCCCCC', 1)`);
    const room_id = (await db.get(`SELECT id FROM rooms WHERE invite_code = 'CCCCCC'`)).id;
    await db.run(`INSERT INTO room_members (room_id, user_id, role) VALUES (?, 1, 'owner')`, [room_id]);
    const memo = await memosModel.createMemo({ user_id: 1, room_id, poem_id: 1, content: "x" });
    await memosModel.toggleLike(memo.id, 1);

    const result = await roomsModel.deleteRoom(room_id);

    expect(result.changes).toBe(1);
    expect(await count(`SELECT COUNT(*) AS n FROM rooms WHERE id = ?`, [room_id])).toBe(0);
    expect(await count(`SELECT COUNT(*) AS n FROM memos WHERE room_id = ?`, [room_id])).toBe(0);
    expect(await count(`SELECT COUNT(*) AS n FROM memo_likes WHERE memo_id = ?`, [memo.id])).toBe(0);
    expect(await count(`SELECT COUNT(*) AS n FROM room_members WHERE room_id = ?`, [room_id])).toBe(0);
  });
});

describe("streakModel", () => {
  test("checking in twice on the same day counts once", async () => {
    await streakModel.checkIn(1, "2026-11-10");
    await streakModel.checkIn(1, "2026-11-11");
    await streakModel.checkIn(1, "2026-11-11");

    expect(await count(`SELECT COUNT(*) AS n FROM reading_checkins WHERE user_id = 1`)).toBe(2);
    expect(await streakModel.getSummary(1, "2026-11-11")).toEqual({
      current: 2, longest: 2, checkedInToday: true, week: ["2026-11-10", "2026-11-11"],
    });
  });

  test("a user with no check-ins gets zeros", async () => {
    expect(await streakModel.getSummary(3, "2026-11-11")).toEqual({
      current: 0, longest: 0, checkedInToday: false, week: [],
    });
  });

  test("listForRoom returns every member in join order with their streak", async () => {
    await streakModel.checkIn(2, "2026-11-10");
    const members = await streakModel.listForRoom(1, "2026-11-11");

    expect(members.map((m) => m.username)).toEqual(["alice", "bob"]);
    expect(members[0]).toMatchObject({ id: 1, current: 2, checkedInToday: true });
    expect(members[1]).toMatchObject({ id: 2, current: 1, checkedInToday: false });
  });

  test("listForRoom ignores check-ins of people outside the room", async () => {
    await streakModel.checkIn(3, "2026-11-11");   // carol is not in room 1
    const members = await streakModel.listForRoom(1, "2026-11-11");

    expect(members.map((m) => m.id)).toEqual([1, 2]);
    expect(members[0]).toMatchObject({ id: 1, current: 2, checkedInToday: true });
    expect(members[1]).toMatchObject({ id: 2, current: 1, checkedInToday: false });
  });
});

describe("poemsModel.findOrCreatePoem (batched line inserts)", () => {
  test("stores a 250-line poem with every line in order", async () => {
    const lines = Array.from({ length: 250 }, (_, i) => (i % 10 === 9 ? "" : `line ${i + 1}`));
    const poem_id = await poemsModel.findOrCreatePoem({ title: "Long", author: "Someone", lines });

    const poem = await poemsModel.findPoemWithLines(poem_id);
    expect(poem.lines).toHaveLength(250);
    expect(poem.lines.map((l) => l.line_number)).toEqual(lines.map((_, i) => i + 1));
    expect(poem.lines.map((l) => l.text)).toEqual(lines);
    expect(poem.linecount).toBe(225); // blank lines kept but not counted
  });
});
