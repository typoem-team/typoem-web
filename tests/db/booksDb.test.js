// Real-SQL tests for models/booksModel.js and the book cleanup in roomsModel.deleteRoom.
// No mocks: an in-memory libSQL database built from db/schema.sql.
// Jest gives every test file its own module registry, so this file's db.js instance
// (and its in-memory database) is not shared with any other test file.

process.env.DB_PATH = ":memory:";
delete process.env.TURSO_DATABASE_URL;
delete process.env.TURSO_AUTH_TOKEN;

const { initDb, getDb } = require("../../db");
const booksModel = require("../../models/booksModel");
const roomsModel = require("../../models/roomsModel");

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------
function makeMeta(id, title = `Book ${id}`) {
    return { id, title, authors: [{ name: "Austen, Jane", death_year: 1817 }], translators: [] };
}

// chapterSizes: paragraphs per chapter. Paragraph text "<tag> p<n> one two" (4 words)
function makeParsed(chapterSizes, tag = "v1") {
    let n = 0;
    const chapters = chapterSizes.map((size, c) => ({
        title: c === 0 ? null : `CHAPTER ${c + 1}.`,
        paragraphs: Array.from({ length: size }, () => `${tag} p${n++} one two`),
    }));
    return { chapters, totalWords: n * 4 };
}

async function count(sql, args = []) {
    return (await getDb().get(sql, args)).n;
}
const paragraphCount = (id) => count(`SELECT COUNT(*) AS n FROM book_paragraphs WHERE book_id = ?`, [id]);
const chapterCount = (id) => count(`SELECT COUNT(*) AS n FROM book_chapters WHERE book_id = ?`, [id]);
const bookCount = (id) => count(`SELECT COUNT(*) AS n FROM books WHERE id = ?`, [id]);

let db;

beforeAll(async () => {
    db = await initDb();
    for (const name of ["alice", "bob", "carol"]) {
        await db.run(`INSERT INTO users (username, nickname, password_hash) VALUES (?, ?, ?)`, [name, name, "x"]);
    }
    await db.run(`INSERT INTO rooms (name, invite_code, owner_id) VALUES ('r1', 'AAAAAA', 1)`);
    await db.run(`INSERT INTO rooms (name, invite_code, owner_id) VALUES ('r2', 'BBBBBB', 1)`);
    for (const [room, user, role] of [[1, 1, "owner"], [1, 2, "member"], [2, 1, "owner"], [2, 3, "member"]]) {
        await db.run(`INSERT INTO room_members (room_id, user_id, role) VALUES (?, ?, ?)`, [room, user, role]);
    }
});

afterEach(() => {
    jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// db.batch
// ---------------------------------------------------------------------------
describe("db.batch", () => {
    test("runs statements atomically and normalises constraint errors", async () => {
        await db.run(`CREATE TABLE t_batch (id INTEGER PRIMARY KEY, v TEXT UNIQUE)`);
        const res = await db.batch([
            { sql: `INSERT INTO t_batch (v) VALUES (?)`, args: ["a"] },
            { sql: `SELECT v FROM t_batch` },
        ]);
        expect(res[0].changes).toBe(1);
        expect(res[1].rows).toEqual([{ v: "a" }]);

        // second statement violates UNIQUE -> whole batch rolled back
        await expect(db.batch([
            { sql: `INSERT INTO t_batch (v) VALUES (?)`, args: ["b"] },
            { sql: `INSERT INTO t_batch (v) VALUES (?)`, args: ["a"] },
        ])).rejects.toMatchObject({ code: "SQLITE_CONSTRAINT" });
        expect(await count(`SELECT COUNT(*) AS n FROM t_batch`)).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// importBook
// ---------------------------------------------------------------------------
describe("importBook", () => {
    test("inserts the book, its chapters and its paragraphs", async () => {
        const parsed = makeParsed([3, 4, 2]);
        const { book, created } = await booksModel.importBook(makeMeta(1342, "Pride and Prejudice"), parsed);

        expect(created).toBe(true);
        expect(book).toMatchObject({
            id: 1342, title: "Pride and Prejudice", author: "Austen, Jane",
            author_death_year: 1817, total_words: 36, total_paragraphs: 9,
        });

        expect(await booksModel.getChapters(1342)).toEqual([
            { idx: 0, title: null, start_paragraph: 0, paragraph_count: 3, word_count: 12 },
            { idx: 1, title: "CHAPTER 2.", start_paragraph: 3, paragraph_count: 4, word_count: 16 },
            { idx: 2, title: "CHAPTER 3.", start_paragraph: 7, paragraph_count: 2, word_count: 8 },
        ]);

        const ch1 = await booksModel.getChapterParagraphs(1342, 1);
        expect(ch1.map((p) => p.idx)).toEqual([3, 4, 5, 6]);
        expect(ch1.map((p) => p.text)).toEqual(parsed.chapters[1].paragraphs);
        expect(ch1.every((p) => Number.isInteger(p.id))).toBe(true);

        expect(await booksModel.findByGutenbergId(1342)).toMatchObject({ id: 1342 });
        expect(await booksModel.getChapterParagraphs(1342, 99)).toEqual([]);
    });

    test("importing the same book again returns the existing one without new rows", async () => {
        const before = await paragraphCount(1342);
        const ids = (await booksModel.getChapterParagraphs(1342, 0)).map((p) => p.id);

        const { book, created } = await booksModel.importBook(makeMeta(1342, "Other title"), makeParsed([60]));
        expect(created).toBe(false);
        expect(book.title).toBe("Pride and Prejudice");
        expect(await paragraphCount(1342)).toBe(before);
        expect(await chapterCount(1342)).toBe(3);
        expect((await booksModel.getChapterParagraphs(1342, 0)).map((p) => p.id)).toEqual(ids);
    });

    test("250+ paragraphs: every batch and multi-row INSERT boundary lines up", async () => {
        // 701 paragraphs -> paragraph batches of 300/300/101, statements of 100 rows
        const sizes = [99, 2, 150, 250, 200]; // chapter edges straddle the 100/300 boundaries
        const parsed = makeParsed(sizes);
        const spy = jest.spyOn(db, "batch");
        await booksModel.importBook(makeMeta(84), parsed);

        const rows = await db.all(`SELECT idx, chapter_idx, text, word_count FROM book_paragraphs WHERE book_id = 84 ORDER BY idx`);
        expect(rows).toHaveLength(701);
        const expected = parsed.chapters.flatMap((c, ci) => c.paragraphs.map((text) => ({ chapter_idx: ci, text })));
        rows.forEach((r, i) => {
            expect(r.idx).toBe(i);
            expect(r.chapter_idx).toBe(expected[i].chapter_idx);
            expect(r.text).toBe(expected[i].text);
            expect(r.word_count).toBe(4);
        });

        // cleanup, chapters, 3 paragraph batches, final books row
        const paragraphBatches = spy.mock.calls.filter(([stmts]) => /INTO book_paragraphs/.test(stmts[0].sql));
        expect(paragraphBatches.map(([stmts]) => stmts.length)).toEqual([3, 3, 2]);
        expect(paragraphBatches.map(([stmts]) => stmts.reduce((n, s) => n + s.args.length / 5, 0))).toEqual([300, 300, 101]);
        expect(spy).toHaveBeenCalledTimes(6);

        const chapters = await booksModel.getChapters(84);
        expect(chapters.map((c) => [c.start_paragraph, c.paragraph_count])).toEqual([[0, 99], [99, 2], [101, 150], [251, 250], [501, 200]]);
    });

    test("a failure mid-import leaves no visible book, and a retry finishes it cleanly", async () => {
        const parsed = makeParsed([200, 200, 301]); // 701 paragraphs
        const realBatch = db.batch;
        let calls = 0;
        jest.spyOn(db, "batch").mockImplementation(function (stmts) {
            calls++;
            // 1 cleanup, 2 chapters, 3 paragraphs 0-299, 4 -> fail
            if (calls === 4) return Promise.reject(new Error("network dropped"));
            return realBatch.call(this, stmts);
        });

        await expect(booksModel.importBook(makeMeta(11), parsed)).rejects.toThrow("network dropped");
        expect(await booksModel.findById(11)).toBeUndefined();
        expect(await bookCount(11)).toBe(0);
        expect(await paragraphCount(11)).toBe(300); // leftovers, invisible without a books row
        expect(await chapterCount(11)).toBe(3);

        jest.restoreAllMocks();

        const { book, created } = await booksModel.importBook(makeMeta(11), parsed);
        expect(created).toBe(true);
        expect(book.total_paragraphs).toBe(701);
        expect(await paragraphCount(11)).toBe(701);
        expect(await count(`SELECT COUNT(DISTINCT idx) AS n FROM book_paragraphs WHERE book_id = 11`)).toBe(701);
        expect(await chapterCount(11)).toBe(3);
    });

    test("two concurrent imports of the same book produce one book and no duplicate rows", async () => {
        const parsed = makeParsed([120, 250]);
        const [a, b] = await Promise.all([
            booksModel.importBook(makeMeta(98), parsed),
            booksModel.importBook(makeMeta(98), parsed),
        ]);
        expect([a.created, b.created].sort()).toEqual([false, true]);
        expect(a.book).toEqual(b.book);
        expect(await bookCount(98)).toBe(1);
        expect(await paragraphCount(98)).toBe(370);
        expect(await chapterCount(98)).toBe(2);
    });

    test("the books row is not written if rows went missing mid-import (other process cleaned up)", async () => {
        const parsed = makeParsed([60]);
        const realBatch = db.batch;
        jest.spyOn(db, "batch").mockImplementation(async function (stmts) {
            if (/INTO books/.test(stmts[0].sql)) {
                await db.run(`DELETE FROM book_paragraphs WHERE book_id = 1661 AND idx = 0`);
            }
            return realBatch.call(this, stmts);
        });

        await expect(booksModel.importBook(makeMeta(1661), parsed)).rejects.toBeInstanceOf(booksModel.IncompleteImportError);
        expect(await bookCount(1661)).toBe(0);

        jest.restoreAllMocks();
        const { created } = await booksModel.importBook(makeMeta(1661), parsed);
        expect(created).toBe(true);
        expect(await paragraphCount(1661)).toBe(60);
    });

    test("rejects malformed input", async () => {
        await expect(booksModel.importBook({ id: "x" }, makeParsed([1]))).rejects.toThrow(TypeError);
        await expect(booksModel.importBook(makeMeta(5), { chapters: [] })).rejects.toThrow(TypeError);
    });
});

// ---------------------------------------------------------------------------
// listing
// ---------------------------------------------------------------------------
describe("listBooks / findImportedIds", () => {
    test("lists imported books only, newest first", async () => {
        const list = await booksModel.listBooks();
        const ids = list.map((b) => b.id);
        expect(ids.sort()).toEqual([11, 1342, 1661, 84, 98].sort());
        // created_at has 1-second resolution; ties fall back to id DESC
        for (let i = 1; i < list.length; i++) {
            const prev = list[i - 1], cur = list[i];
            expect(prev.created_at > cur.created_at || (prev.created_at === cur.created_at && prev.id > cur.id)).toBe(true);
        }
    });

    test("findImportedIds", async () => {
        expect((await booksModel.findImportedIds([1342, 2, 84, 999])).sort((a, b) => a - b)).toEqual([84, 1342]);
        expect(await booksModel.findImportedIds([])).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// room book + progress
// ---------------------------------------------------------------------------
describe("room book and progress", () => {
    test("setRoomBook upserts, getRoomBook joins the book, clearRoomBook removes", async () => {
        expect(await booksModel.getRoomBook(1)).toBeUndefined();

        await booksModel.setRoomBook(1, 1342, 1);
        const rb = await booksModel.setRoomBook(1, 84, 1);
        expect(rb).toMatchObject({ room_id: 1, book_id: 84, set_by: 1, total_paragraphs: 701 });
        expect(await count(`SELECT COUNT(*) AS n FROM room_books WHERE room_id = 1`)).toBe(1);

        await booksModel.clearRoomBook(1);
        expect(await booksModel.getRoomBook(1)).toBeUndefined();
    });

    test("upsertProgress inserts, updates, keeps or clears the target date", async () => {
        expect(await booksModel.getProgress(2, 1, 84)).toBeUndefined();

        let p = await booksModel.upsertProgress({ user_id: 2, room_id: 1, book_id: 84, paragraph_idx: 5, target_end_date: "2026-12-01" });
        expect(p).toMatchObject({ paragraph_idx: 5, target_end_date: "2026-12-01" });
        expect(p.started_at).toBeTruthy();
        expect(p.updated_at).toBeTruthy();

        p = await booksModel.upsertProgress({ user_id: 2, room_id: 1, book_id: 84, paragraph_idx: 9 });
        expect(p).toMatchObject({ paragraph_idx: 9, target_end_date: "2026-12-01" });

        p = await booksModel.upsertProgress({ user_id: 2, room_id: 1, book_id: 84, paragraph_idx: 10, target_end_date: null });
        expect(p).toMatchObject({ paragraph_idx: 10, target_end_date: null });

        expect(await count(`SELECT COUNT(*) AS n FROM reading_progress WHERE user_id = 2 AND room_id = 1 AND book_id = 84`)).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// reimportBook
// ---------------------------------------------------------------------------
describe("reimportBook", () => {
    test("refuses while a room uses the book and leaves it untouched", async () => {
        await booksModel.setRoomBook(2, 98, 1);
        const before = await db.all(`SELECT id FROM book_paragraphs WHERE book_id = 98 ORDER BY idx`);

        await expect(booksModel.reimportBook(makeMeta(98), makeParsed([80], "v2"))).rejects.toBeInstanceOf(booksModel.BookInUseError);
        expect(await db.all(`SELECT id FROM book_paragraphs WHERE book_id = 98 ORDER BY idx`)).toEqual(before);
        expect(await bookCount(98)).toBe(1);

        await booksModel.clearRoomBook(2);
    });

    test("replaces an unused book and clamps progress past the new end", async () => {
        await booksModel.upsertProgress({ user_id: 3, room_id: 2, book_id: 98, paragraph_idx: 300 }); // beyond new end
        await booksModel.upsertProgress({ user_id: 1, room_id: 2, book_id: 98, paragraph_idx: 10 });  // still valid

        const { book, created } = await booksModel.reimportBook(makeMeta(98, "Fixed"), makeParsed([30, 50], "v2"));
        expect(created).toBe(true);
        expect(book).toMatchObject({ id: 98, title: "Fixed", total_paragraphs: 80 });
        expect(await paragraphCount(98)).toBe(80);
        expect(await chapterCount(98)).toBe(2);
        expect((await booksModel.getChapterParagraphs(98, 0))[0].text).toBe("v2 p0 one two");

        expect((await booksModel.getProgress(3, 2, 98)).paragraph_idx).toBe(79);
        expect((await booksModel.getProgress(1, 2, 98)).paragraph_idx).toBe(10);
    });

    test("reimporting a book that was never imported just imports it", async () => {
        const { created } = await booksModel.reimportBook(makeMeta(2701), makeParsed([55]));
        expect(created).toBe(true);
        expect(await paragraphCount(2701)).toBe(55);
    });
});

// ---------------------------------------------------------------------------
// roomsModel.deleteRoom cleanup
// ---------------------------------------------------------------------------
describe("roomsModel.deleteRoom", () => {
    test("removes the room's book assignment and reading progress, nothing else", async () => {
        await booksModel.setRoomBook(1, 1342, 1);
        await booksModel.setRoomBook(2, 84, 1);
        await booksModel.upsertProgress({ user_id: 1, room_id: 1, book_id: 1342, paragraph_idx: 3 });
        await booksModel.upsertProgress({ user_id: 2, room_id: 1, book_id: 84, paragraph_idx: 4 }); // old book of room 1
        await booksModel.upsertProgress({ user_id: 3, room_id: 2, book_id: 84, paragraph_idx: 7 });
        const otherRoomProgress = await count(`SELECT COUNT(*) AS n FROM reading_progress WHERE room_id = 2`);

        await roomsModel.deleteRoom(1);

        expect(await count(`SELECT COUNT(*) AS n FROM room_books WHERE room_id = 1`)).toBe(0);
        expect(await count(`SELECT COUNT(*) AS n FROM reading_progress WHERE room_id = 1`)).toBe(0);
        expect(await roomsModel.findById(1)).toBeUndefined();

        // other room and the books themselves are untouched
        expect(await count(`SELECT COUNT(*) AS n FROM room_books WHERE room_id = 2`)).toBe(1);
        expect(await count(`SELECT COUNT(*) AS n FROM reading_progress WHERE room_id = 2`)).toBe(otherRoomProgress);
        expect(await bookCount(1342)).toBe(1);
        expect(await paragraphCount(1342)).toBe(9);
    });
});
