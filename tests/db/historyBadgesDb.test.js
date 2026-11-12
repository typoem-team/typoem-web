// Real-SQL tests: GET /api/streak?month days, room book history, badges.
process.env.DB_PATH = ":memory:";
delete process.env.TURSO_DATABASE_URL;
delete process.env.TURSO_AUTH_TOKEN;

const { initDb, getDb } = require("../../db");
const booksModel = require("../../models/booksModel");
const streakModel = require("../../models/streakModel");
const historyModel = require("../../models/bookHistoryModel");
const badgesModel = require("../../models/badgesModel");
const memosModel = require("../../models/memosModel");

// one chapter of `paragraphs` paragraphs, 4 words each
function book(id, paragraphs, title = `Book ${id}`) {
  return [
    { id, title, authors: [{ name: "Austen, Jane", death_year: 1817 }], translators: [] },
    { chapters: [{ title: null, paragraphs: Array.from({ length: paragraphs }, (_, i) => `p${i} one two three`) }], totalWords: paragraphs * 4 },
  ];
}
const setProgress = (user_id, room_id, book_id, paragraph_idx, updated_at) =>
  getDb().run(
    `INSERT INTO reading_progress (user_id, room_id, book_id, paragraph_idx, updated_at) VALUES (?, ?, ?, ?, ?)`,
    [user_id, room_id, book_id, paragraph_idx, updated_at]
  );

// users 1 alice, 2 bob, 3 carol (left the room) · room 1 (alice, bob), room 2 (alice)
// book 501: 1000 paragraphs = 4000 words (room 1's current book) · book 502: 300 paragraphs
beforeAll(async () => {
  if (process.env.TURSO_DATABASE_URL || process.env.DB_PATH !== ":memory:") {
    throw new Error("historyBadgesDb.test.js must run on an in-memory DB");
  }
  const db = await initDb();
  for (const u of ["alice", "bob", "carol"]) {
    await db.run(`INSERT INTO users (username, nickname, password_hash) VALUES (?, ?, 'x')`, [u, u]);
  }
  await db.run(`INSERT INTO rooms (name, invite_code, owner_id) VALUES ('r1', 'AAAAAA', 1), ('r2', 'BBBBBB', 1)`);
  await db.run(`INSERT INTO room_members (room_id, user_id, role) VALUES (1, 1, 'owner'), (1, 2, 'member'), (2, 1, 'owner')`);
  await booksModel.importBook(...book(501, 1000, "Emma"));
  await booksModel.importBook(...book(502, 300, "Persuasion"));
  await db.run(`INSERT INTO room_books (room_id, book_id, set_by) VALUES (1, 501, 1)`);
  await db.run(`INSERT INTO poems (title, author, linecount) VALUES ('P', 'A', 1)`);
});

describe("streakModel.datesBetween (calendar month)", () => {
  test("only my days inside the range, ascending", async () => {
    for (const d of ["2026-10-31", "2026-11-01", "2026-11-09", "2026-11-30", "2026-12-01"]) await streakModel.checkIn(1, d);
    await streakModel.checkIn(2, "2026-11-05");

    expect(await streakModel.datesBetween(1, "2026-11-01", "2026-11-30"))
      .toEqual(["2026-11-01", "2026-11-09", "2026-11-30"]);
  });
});

describe("bookHistoryModel.listForRoom", () => {
  test("current book with my progress, readers, and an earlier finished book", async () => {
    await setProgress(1, 1, 501, 500, "2026-11-12 10:00:00");   // alice: half of Emma
    await setProgress(2, 1, 501, 950, "2026-11-12 11:00:00");   // bob: last page of Emma
    await setProgress(1, 1, 502, 299, "2026-11-01 09:00:00");   // alice finished Persuasion here
    await setProgress(3, 1, 501, 100, "2026-11-02 09:00:00");   // carol is not a member any more
    await getDb().run(
      `INSERT INTO book_marks (room_id, book_id, user_id, kind, chapter_idx, start_para, start_word, end_para, end_word, quote)
       VALUES (1, 501, 1, 'highlight', 0, 1, 0, 1, 2, 'q'), (1, 501, 1, 'note', 0, 2, 0, 2, 1, 'q'), (1, 501, 2, 'highlight', 0, 3, 0, 3, 1, 'q')`
    );

    const list = await historyModel.listForRoom(1, 1);

    expect(list.map((b) => b.title)).toEqual(["Emma", "Persuasion"]); // current first
    expect(list[0]).toMatchObject({
      book_id: 501, is_current: true, status: "reading", progress: 50,
      last_read_at: "2026-11-12 10:00:00", finished_at: null, my_mark_count: 2,
    });
    expect(list[0].readers).toEqual([
      { id: 2, nickname: "bob", progress: 100, finished: true },
      { id: 1, nickname: "alice", progress: 50, finished: false },
    ]);
    expect(list[1]).toMatchObject({
      book_id: 502, is_current: false, status: "finished", progress: 100,
      finished_at: "2026-11-01 09:00:00", my_mark_count: 0,
    });
  });

  test("a room's current book nobody opened yet still shows, as reading at 0%", async () => {
    await getDb().run(`INSERT INTO room_books (room_id, book_id, set_by) VALUES (2, 502, 1)`);
    const list = await historyModel.listForRoom(2, 1);
    expect(list).toEqual([expect.objectContaining({ book_id: 502, is_current: true, status: "reading", progress: 0, readers: [] })]);
  });

  test("a book I left behind is paused", async () => {
    await getDb().run(`UPDATE room_books SET book_id = 502 WHERE room_id = 1`);
    const emma = (await historyModel.listForRoom(1, 1)).find((b) => b.book_id === 501);
    expect(emma).toMatchObject({ is_current: false, status: "paused", progress: 50 });
    await getDb().run(`UPDATE room_books SET book_id = 501 WHERE room_id = 1`);
  });
});

describe("badgesModel.listForUser", () => {
  test("streak, memo and book badges from stored data", async () => {
    // alice: longest streak 2 (10-31, 11-01), 1 finished book; add 10 memos/notes
    for (let i = 0; i < 9; i++) {
      await memosModel.createMemo({ user_id: 1, room_id: 1, poem_id: 1, content: `memo ${i}` });
    }
    const { badges, earned_count } = await badgesModel.listForUser(1, "2026-11-12");
    const byId = Object.fromEntries(badges.map((b) => [b.id, b]));

    expect(byId.streak_3).toMatchObject({ earned: false, progress: 2, goal: 3 });
    expect(byId.first_book).toMatchObject({ earned: true, progress: 1, goal: 1 });
    expect(byId.first_memo.earned).toBe(true);
    expect(byId.memo_10).toMatchObject({ progress: 10, goal: 10, earned: true }); // 9 memos + 1 book note
    expect(earned_count).toBe(badges.filter((b) => b.earned).length);
  });

  test("a new user has nothing yet", async () => {
    const { badges, earned_count } = await badgesModel.listForUser(3, "2026-11-12");
    expect(earned_count).toBe(0);
    expect(badges.map((b) => b.id)).toEqual(["streak_3", "streak_7", "streak_30", "first_memo", "memo_10", "first_book"]);
  });
});
