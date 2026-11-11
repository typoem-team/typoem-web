// db.js migrate(): a DB whose book_marks table was created before the color column existed
// gets the column on the next initDb() (CREATE TABLE IF NOT EXISTS alone would not add it).
// Uses a temporary file DB so the "old" table survives between two connections.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { createClient } = require("@libsql/client");

const file = path.join(os.tmpdir(), `typoem-colmig-${process.pid}-${Date.now()}.db`);

process.env.DB_PATH = file;
delete process.env.TURSO_DATABASE_URL;
delete process.env.TURSO_AUTH_TOKEN;

const { initDb } = require("../../db");

afterAll(() => {
    for (const f of [file, `${file}-wal`, `${file}-shm`, `${file}-journal`]) {
        try { fs.unlinkSync(f); } catch (e) { /* not there */ }
    }
});

test("adds book_marks.color to an existing table, backfills highlights, and is a no-op the second time", async () => {
    // the stage-1 shape of book_marks (no color), with one highlight and one note
    const old = createClient({ url: `file:${file}` });
    await old.executeMultiple(`
        CREATE TABLE book_marks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          room_id INTEGER NOT NULL, book_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
          kind TEXT NOT NULL CHECK (kind IN ('highlight', 'note')),
          chapter_idx INTEGER NOT NULL, start_para INTEGER NOT NULL, start_word INTEGER NOT NULL,
          end_para INTEGER NOT NULL, end_word INTEGER NOT NULL,
          quote TEXT NOT NULL, content TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        INSERT INTO book_marks (room_id, book_id, user_id, kind, chapter_idx, start_para, start_word, end_para, end_word, quote)
          VALUES (1, 1, 1, 'highlight', 0, 0, 0, 0, 1, 'q');
        INSERT INTO book_marks (room_id, book_id, user_id, kind, chapter_idx, start_para, start_word, end_para, end_word, quote, content)
          VALUES (1, 1, 1, 'note', 0, 0, 0, 0, 1, 'q', 'n');
    `);
    old.close();

    let db = await initDb();
    const cols = await db.all(`PRAGMA table_info(book_marks)`);
    expect(cols.map((c) => c.name)).toContain("color");
    expect(await db.all(`SELECT kind, color FROM book_marks ORDER BY id`)).toEqual([
        { kind: "highlight", color: "yellow" },
        { kind: "note", color: null },
    ]);

    // the CHECK on the added column works
    await expect(db.run(`UPDATE book_marks SET color = 'red' WHERE id = 1`)).rejects.toMatchObject({ code: "SQLITE_CONSTRAINT" });

    // the new tables exist too, and a second init changes nothing
    db = await initDb();
    expect((await db.all(`PRAGMA table_info(book_marks)`)).filter((c) => c.name === "color")).toHaveLength(1);
    expect(await db.get(`SELECT COUNT(*) AS n FROM poem_marks`)).toEqual({ n: 0 });
});
