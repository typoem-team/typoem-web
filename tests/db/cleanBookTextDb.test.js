// Real-SQL test for scripts/clean-book-text.js on an in-memory libSQL database.

process.env.DB_PATH = ":memory:";
delete process.env.TURSO_DATABASE_URL;
delete process.env.TURSO_AUTH_TOKEN;

const { initDb, getDb } = require("../../db");
const booksModel = require("../../models/booksModel");
const { cleanBookText } = require("../../scripts/clean-book-text");

const meta = { id: 345, title: "Dracula", authors: [{ name: "Stoker, Bram", death_year: 1912 }], translators: [] };
// paragraphs as an older parser stored them
const OLD = ["the frontier--for the Pass", "/* NIND “My dear friend, */", "-------------", "/*", "plain text here"];

beforeAll(async () => {
    await initDb();
    await booksModel.importBook(meta, {
        chapters: [{ title: "CHAPTER I.", paragraphs: OLD.slice(0, 3) }, { title: "CHAPTER II.", paragraphs: OLD.slice(3) }],
        totalWords: 14,
    });
});

const texts = async () => (await getDb().all(`SELECT idx, text FROM book_paragraphs WHERE book_id = 345 ORDER BY idx`));

test("dry run changes nothing", async () => {
    const { changes } = await cleanBookText();
    expect(changes.map((c) => c.idx)).toEqual([0, 1, 2]);
    expect((await texts()).map((r) => r.text)).toEqual(OLD);
});

test("--apply cleans text in place, keeps idx and count, leaves would-be-empty paragraphs, fixes word counts", async () => {
    const { changes, skippedEmpty } = await cleanBookText({ apply: true });
    expect(changes).toHaveLength(3);
    expect(skippedEmpty).toHaveLength(1);
    expect(await texts()).toEqual([
        { idx: 0, text: "the frontier—for the Pass" },
        { idx: 1, text: "“My dear friend," },
        { idx: 2, text: "* * *" },
        { idx: 3, text: "/*" },
        { idx: 4, text: "plain text here" },
    ]);
    const db = getDb();
    // 4 + 3 + 3 + 1 + 3
    expect((await db.get(`SELECT total_words AS n FROM books WHERE id = 345`)).n).toBe(14);
    expect((await db.all(`SELECT word_count AS n FROM book_chapters WHERE book_id = 345 ORDER BY idx`)).map((r) => r.n)).toEqual([10, 4]);
});

test("a second run finds nothing to change", async () => {
    expect((await cleanBookText({ apply: true })).changes).toHaveLength(0);
});
