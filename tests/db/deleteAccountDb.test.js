// usersModel.deleteAccount on a real in-memory libSQL DB (foreign keys ON)
process.env.DB_PATH = ":memory:";
delete process.env.TURSO_DATABASE_URL;
delete process.env.TURSO_AUTH_TOKEN;

const { initDb, getDb } = require("../../db");
const usersModel = require("../../models/usersModel");
const memosModel = require("../../models/memosModel");
const streakModel = require("../../models/streakModel");

const n = async (sql, args = []) => (await getDb().get(sql, args)).n;

// users: 1 alice (leaves), 2 bob, 3 carol
// room 1 "shared": owner alice, members bob (joined first), carol
// room 2 "solo":   owner alice only
// room 3 "bobs":   owner bob, member alice
beforeAll(async () => {
  if (process.env.TURSO_DATABASE_URL || process.env.DB_PATH !== ":memory:") {
    throw new Error("deleteAccountDb.test.js must run on an in-memory DB");
  }
  const db = await initDb();
  for (const u of ["alice", "bob", "carol"]) {
    await db.run(`INSERT INTO users (username, nickname, password_hash) VALUES (?, ?, 'x')`, [u, u]);
  }
  await db.run(`INSERT INTO rooms (name, invite_code, owner_id) VALUES ('shared', 'AAAAAA', 1), ('solo', 'BBBBBB', 1), ('bobs', 'CCCCCC', 2)`);
  await db.run(`INSERT INTO room_members (room_id, user_id, role) VALUES
    (1, 1, 'owner'), (1, 2, 'member'), (1, 3, 'member'),
    (2, 1, 'owner'),
    (3, 2, 'owner'), (3, 1, 'member')`);
  await db.run(`INSERT INTO poems (title, author, linecount) VALUES ('P', 'A', 1)`);
  await db.run(`INSERT INTO daily_room_poems (room_id, poem_id, date) VALUES (1, 1, '2026-11-11'), (2, 1, '2026-11-11')`);

  // alice's memo in the shared room, liked by bob; bob's memo liked by alice
  const aliceMemo = await memosModel.createMemo({ user_id: 1, room_id: 1, poem_id: 1, content: "alice says" });
  const bobMemo = await memosModel.createMemo({ user_id: 2, room_id: 1, poem_id: 1, content: "bob says" });
  await memosModel.toggleLike(aliceMemo.id, 2);
  await memosModel.toggleLike(bobMemo.id, 1);
  await memosModel.createMemo({ user_id: 1, room_id: 2, poem_id: 1, content: "alone" });

  await db.run(`INSERT INTO vocab (user_id, word, definition) VALUES (1, 'bard', 'poet'), (2, 'dew', 'drops')`);
  await streakModel.checkIn(1, "2026-11-11");
  await streakModel.checkIn(2, "2026-11-11");
});

test("deletes alice and everything of hers, hands over or removes her rooms", async () => {
  const result = await usersModel.deleteAccount(1);
  expect(result).toEqual({ roomsDeleted: 1, roomsHandedOver: 1 });

  // alice is gone with her data
  expect(await n(`SELECT COUNT(*) AS n FROM users WHERE id = 1`)).toBe(0);
  expect(await n(`SELECT COUNT(*) AS n FROM memos WHERE user_id = 1`)).toBe(0);
  expect(await n(`SELECT COUNT(*) AS n FROM memo_likes WHERE user_id = 1`)).toBe(0);
  expect(await n(`SELECT COUNT(*) AS n FROM vocab WHERE user_id = 1`)).toBe(0);
  expect(await n(`SELECT COUNT(*) AS n FROM reading_checkins WHERE user_id = 1`)).toBe(0);
  expect(await n(`SELECT COUNT(*) AS n FROM room_members WHERE user_id = 1`)).toBe(0);

  // shared room survives with bob (earliest other member) as owner
  expect(await getDb().get(`SELECT owner_id FROM rooms WHERE id = 1`)).toEqual({ owner_id: 2 });
  expect(await getDb().get(`SELECT role FROM room_members WHERE room_id = 1 AND user_id = 2`)).toEqual({ role: "owner" });
  expect(await n(`SELECT COUNT(*) AS n FROM room_members WHERE room_id = 1`)).toBe(2);

  // solo room is deleted with its contents
  expect(await n(`SELECT COUNT(*) AS n FROM rooms WHERE id = 2`)).toBe(0);
  expect(await n(`SELECT COUNT(*) AS n FROM daily_room_poems WHERE room_id = 2`)).toBe(0);

  // other people's data is untouched (bob's memo stays, minus alice's like)
  expect(await n(`SELECT COUNT(*) AS n FROM memos WHERE user_id = 2`)).toBe(1);
  expect(await n(`SELECT COUNT(*) AS n FROM vocab WHERE user_id = 2`)).toBe(1);
  expect(await n(`SELECT COUNT(*) AS n FROM reading_checkins WHERE user_id = 2`)).toBe(1);
  expect(await n(`SELECT COUNT(*) AS n FROM rooms WHERE id = 3`)).toBe(1);
  expect(await n(`SELECT COUNT(*) AS n FROM room_members WHERE room_id = 3`)).toBe(1);
});

test("deleting a user who doesn't exist returns null", async () => {
  expect(await usersModel.deleteAccount(999)).toBeNull();
});

test("the same username can sign up again afterwards", async () => {
  await expect(usersModel.create({ username: "alice", nickname: "alice2", password_hash: "y" })).resolves.toBeTruthy();
});
