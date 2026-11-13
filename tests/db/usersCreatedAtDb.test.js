// db.js migrate(): users.created_at (설정 프로필의 '함께한 날').
// A DB from before the column gets it on the next initDb(), with old users backfilled from
// their earliest activity (or the migration time when they have none). New users get it
// from usersModel.create. Uses a temporary file DB so the "old" tables survive between connections.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { createClient } = require("@libsql/client");

const file = path.join(os.tmpdir(), `typoem-usercreated-${process.pid}-${Date.now()}.db`);

process.env.DB_PATH = file;
delete process.env.TURSO_DATABASE_URL;
delete process.env.TURSO_AUTH_TOKEN;

const { initDb } = require("../../db");
const usersModel = require("../../models/usersModel");

const TS = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

afterAll(() => {
    for (const f of [file, `${file}-wal`, `${file}-shm`, `${file}-journal`]) {
        try { fs.unlinkSync(f); } catch (e) { /* not there */ }
    }
});

test("adds users.created_at, backfills old users, sets it for new users, and is a no-op the second time", async () => {
    // the pre-column shape: users without created_at, plus some activity
    const old = createClient({ url: `file:${file}` });
    await old.executeMultiple(`
        CREATE TABLE users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT NOT NULL UNIQUE,
          nickname TEXT NOT NULL,
          password_hash TEXT NOT NULL
        );
        CREATE TABLE memos (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL, room_id INTEGER NOT NULL, poem_id INTEGER NOT NULL,
          content TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE reading_checkins (
          user_id INTEGER NOT NULL, date TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (user_id, date)
        );
        INSERT INTO users (username, nickname, password_hash) VALUES ('ann', 'Ann', 'x'), ('bo', 'Bo', 'x'), ('cy', 'Cy', 'x');
        -- ann: a memo, then an earlier check-in -> the check-in wins
        INSERT INTO memos (user_id, room_id, poem_id, content, created_at) VALUES (1, 1, 1, 'hi', '2026-11-05 03:00:00');
        INSERT INTO reading_checkins (user_id, date, created_at) VALUES (1, '2026-11-02', '2026-11-01 16:30:00');
        -- bo: one memo
        INSERT INTO memos (user_id, room_id, poem_id, content, created_at) VALUES (2, 1, 1, 'yo', '2026-11-09 12:00:00');
        -- cy: nothing at all
    `);
    old.close();

    let db = await initDb();
    expect((await db.all(`PRAGMA table_info(users)`)).map((c) => c.name)).toContain("created_at");

    const rows = await db.all(`SELECT username, created_at FROM users ORDER BY id`);
    expect(rows[0]).toEqual({ username: "ann", created_at: "2026-11-01 16:30:00" });
    expect(rows[1]).toEqual({ username: "bo", created_at: "2026-11-09 12:00:00" });
    expect(rows[2].created_at).toMatch(TS);   // no activity: the migration time

    // a new account gets its sign-up time
    const { lastID } = await usersModel.create({ username: "dee", nickname: "Dee", password_hash: "x" });
    expect((await usersModel.findById(lastID)).created_at).toMatch(TS);

    // a second init changes nothing
    db = await initDb();
    expect((await db.all(`PRAGMA table_info(users)`)).filter((c) => c.name === "created_at")).toHaveLength(1);
    expect(await db.get(`SELECT created_at FROM users WHERE username = 'ann'`)).toEqual({ created_at: "2026-11-01 16:30:00" });
});

test("a brand-new database has users.created_at too", async () => {
    process.env.DB_PATH = ":memory:";
    const db = await initDb();
    expect((await db.all(`PRAGMA table_info(users)`)).map((c) => c.name)).toContain("created_at");
    process.env.DB_PATH = file;
});
