// Real-SQL tests for models/vocabModel.js and the vocab.definition_ko migration in db.js.
// No mocks: a local libSQL database file. Jest gives every test file its own module
// registry, so this file's db.js instance is not shared with other test files.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { createClient } = require("@libsql/client");

const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "typoem-vocab-")), "old.db");
process.env.DB_PATH = file;
delete process.env.TURSO_DATABASE_URL;
delete process.env.TURSO_AUTH_TOKEN;

let db;
let vocabModel;

beforeAll(async () => {
  // An "old" database: the vocab table as it was before definition_ko existed.
  const old = createClient({ url: `file:${file}` });
  await old.executeMultiple(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL);
    CREATE TABLE vocab (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, word TEXT NOT NULL,
      phonetic TEXT, definition TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, word), FOREIGN KEY (user_id) REFERENCES users(id));
    INSERT INTO users (id, username, password_hash) VALUES (1, 'alice', 'x');
    INSERT INTO vocab (user_id, word, definition) VALUES (1, 'brook', 'a small stream');
  `);
  old.close();

  const { initDb, getDb } = require("../../db");
  await initDb();
  db = getDb();
  vocabModel = require("../../models/vocabModel");
});

const KO = JSON.stringify([{ pos: "형용사", ko: ["영리한"], own: true }]);

test("start-up adds definition_ko and definition_pos to an existing vocab table and keeps its rows", async () => {
  const cols = (await db.all("PRAGMA table_info(vocab)")).map((c) => c.name);
  expect(cols).toContain("definition_ko");
  expect(cols).toContain("definition_pos");
  const rows = await vocabModel.listForUser(1);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ word: "brook", definition: "a small stream", definition_ko: null });
});

test("start-up can run again on a database that already has the column", async () => {
  const { initDb } = require("../../db");
  await expect(initDb()).resolves.toBeDefined();
});

test("a word saved without Korean gets it when it is saved again", async () => {
  await vocabModel.add(1, "brook", null, "a small stream", KO);
  const rows = await vocabModel.listForUser(1);
  expect(rows).toHaveLength(1);                        // still one row, not a duplicate
  expect(rows[0].definition_ko).toBe(KO);
  expect(rows[0].definition).toBe("a small stream");
});

test("saving again without Korean or an English definition keeps what is stored", async () => {
  await vocabModel.add(1, "brook", null, "", null);
  const [row] = await vocabModel.listForUser(1);
  expect(row.definition).toBe("a small stream");
  expect(row.definition_ko).toBe(KO);
});

test("a new word can be saved with Korean meanings only", async () => {
  await vocabModel.add(1, "thee", null, "", KO);
  const row = (await vocabModel.listForUser(1)).find((r) => r.word === "thee");
  expect(row).toMatchObject({ definition: "", definition_ko: KO });
});

test("the part of speech is saved, filled in on a second save, and kept when it is missing", async () => {
  await vocabModel.add(1, "oak", null, "A tree.", null, null);
  let row = (await vocabModel.listForUser(1)).find((r) => r.word === "oak");
  expect(row.definition_pos).toBeNull();

  await vocabModel.add(1, "oak", null, "A tree.", null, "noun");
  row = (await vocabModel.listForUser(1)).find((r) => r.word === "oak");
  expect(row.definition_pos).toBe("noun");

  await vocabModel.add(1, "oak", null, "", null, null);
  row = (await vocabModel.listForUser(1)).find((r) => r.word === "oak");
  expect(row).toMatchObject({ definition: "A tree.", definition_pos: "noun" });
});
