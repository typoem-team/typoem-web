const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../../app");

// Auto-mock the model layers and the Gutendex helper. jest.mock is hoisted above
// the app require, so the controllers load the mocks. Nothing here touches the network.
jest.mock("../../models/booksModel");
jest.mock("../../models/roomsModel");
jest.mock("../../models/usersModel");
jest.mock("../../lib/bookFetch");
const booksModel = require("../../models/booksModel");
const roomsModel = require("../../models/roomsModel");
const usersModel = require("../../models/usersModel");
const bookFetch = require("../../lib/bookFetch");

// user 1 = alice (room owner), user 2 = bob (member)
const tokenFor = (id, username) => jwt.sign({ id, username }, process.env.JWT_SECRET, { expiresIn: "1h" });
const owner = `Bearer ${tokenFor(1, "alice")}`;
const member = `Bearer ${tokenFor(2, "bob")}`;

const room = { id: 5, name: "book-club", owner_id: 1 };
const bookRow = {
    id: 1342, title: "Pride and Prejudice", author: "Austen, Jane", author_death_year: 1817,
    total_words: 121581, total_paragraphs: 2061, created_at: "2026-11-10 00:00:00",
};
const bookJson = {
    id: 1342, gutenbergId: 1342, title: "Pride and Prejudice", author: "Austen, Jane",
    authorDeathYear: 1817, totalWords: 121581, totalParagraphs: 2061,
};
const roomBook = {
    room_id: 5, book_id: 1342, set_by: 1, set_at: "2026-11-10 00:00:00",
    title: "Pride and Prejudice", author: "Austen, Jane", author_death_year: 1817,
    total_words: 121581, total_paragraphs: 2061,
};
const meta = { id: 1342, title: "Pride and Prejudice", authors: [{ name: "Austen, Jane", death_year: 1817 }], languages: ["en"], formats: {} };
const parsed = { ok: true, chapters: [{ title: "Chapter I.", paragraphs: ["a"] }], totalWords: 1, totalParagraphs: 1 };

beforeEach(() => {
    jest.clearAllMocks();
    usersModel.findById.mockImplementation(async (id) => ({ id, username: id === 1 ? "alice" : "bob" }));
    roomsModel.findById.mockResolvedValue(room);
    roomsModel.isMember.mockResolvedValue(true);
    booksModel.getReaders.mockResolvedValue([]);
    jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
    console.error.mockRestore();
});

// -----------------------------------------------------------------------------
// GET /api/books
// -----------------------------------------------------------------------------
describe("GET /api/books", () => {
    test("401 without a token", async () => {
        const res = await request(app).get("/api/books");
        expect(res.statusCode).toBe(401);
        expect(booksModel.listBooks).not.toHaveBeenCalled();
    });

    test("200 lists imported books", async () => {
        booksModel.listBooks.mockResolvedValue([bookRow]);
        const res = await request(app).get("/api/books").set("Authorization", member);
        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual([{ id: 1342, gutenbergId: 1342, title: "Pride and Prejudice", author: "Austen, Jane", totalWords: 121581 }]);
    });

    test("500 on a model error", async () => {
        booksModel.listBooks.mockRejectedValue(new Error("db down"));
        const res = await request(app).get("/api/books").set("Authorization", member);
        expect(res.statusCode).toBe(500);
        expect(res.body).toEqual({ error: "Server error" });
    });
});

// -----------------------------------------------------------------------------
// GET /api/books/search
// -----------------------------------------------------------------------------
describe("GET /api/books/shelf", () => {
    const SHELF_IDS = [11, 43, 35, 64317, 16, 1661, 84, 174, 1342, 345];

    test("401 without a token", async () => {
        const res = await request(app).get("/api/books/shelf");
        expect(res.statusCode).toBe(401);
        expect(booksModel.findImportedIds).not.toHaveBeenCalled();
    });

    test("200 returns the 10 shelf books in order with imported flags", async () => {
        booksModel.findImportedIds.mockResolvedValue([84, 1342]);

        const res = await request(app).get("/api/books/shelf").set("Authorization", member);

        expect(res.statusCode).toBe(200);
        expect(booksModel.findImportedIds).toHaveBeenCalledWith(SHELF_IDS);
        expect(res.body.map((b) => b.gutenbergId)).toEqual(SHELF_IDS);
        for (const b of res.body) {
            expect(Object.keys(b).sort()).toEqual(["author", "gutenbergId", "imported", "title"]);
            expect(typeof b.title).toBe("string");
            expect(typeof b.author).toBe("string");
            expect(b.imported).toBe(b.gutenbergId === 84 || b.gutenbergId === 1342);
        }
        expect(res.body.find((b) => b.gutenbergId === 1342)).toEqual({
            gutenbergId: 1342, title: "Pride and Prejudice", author: "Jane Austen", imported: true,
        });
    });

    test("never calls Gutendex / Project Gutenberg", async () => {
        booksModel.findImportedIds.mockResolvedValue([]);
        const res = await request(app).get("/api/books/shelf").set("Authorization", owner);
        expect(res.statusCode).toBe(200);
        expect(res.body.every((b) => b.imported === false)).toBe(true);
        for (const fn of ["searchBooks", "getBookMeta", "fetchBookText"]) {
            expect(bookFetch[fn]).not.toHaveBeenCalled();
        }
    });

    test("500 on a DB error", async () => {
        booksModel.findImportedIds.mockRejectedValue(new Error("db down"));
        const res = await request(app).get("/api/books/shelf").set("Authorization", member);
        expect(res.statusCode).toBe(500);
        expect(res.body).toEqual({ error: "Server error" });
    });
});

// -----------------------------------------------------------------------------
// GET /api/books/search
// -----------------------------------------------------------------------------
describe("GET /api/books/search", () => {
    test("401 without a token", async () => {
        const res = await request(app).get("/api/books/search?q=pride");
        expect(res.statusCode).toBe(401);
    });

    test.each([
        ["missing", ""],
        ["blank", "?q=%20%20"],
        ["too long", `?q=${"a".repeat(101)}`],
    ])("400 when q is %s", async (_label, qs) => {
        const res = await request(app).get(`/api/books/search${qs}`).set("Authorization", member);
        expect(res.statusCode).toBe(400);
        expect(res.body).toEqual({ error: "q must be 1-100 characters" });
        expect(bookFetch.searchBooks).not.toHaveBeenCalled();
    });

    test("502 when Gutendex fails", async () => {
        bookFetch.searchBooks.mockResolvedValue({ ok: false, error: "timeout" });
        const res = await request(app).get("/api/books/search?q=pride").set("Authorization", member);
        expect(res.statusCode).toBe(502);
        expect(res.body.error).toBeDefined();
    });

    test("200 returns only Korea-PD books and flags already-imported ones", async () => {
        const results = [
            { id: 1342, title: "Pride and Prejudice", authors: [{ name: "Austen, Jane", death_year: 1817 }] },
            { id: 9999, title: "Too Recent", authors: [{ name: "Someone", death_year: 1970 }] },
            { id: 84, title: "Frankenstein", authors: [{ name: "Shelley, Mary", death_year: 1851 }] },
        ];
        bookFetch.searchBooks.mockResolvedValue({ ok: true, results, count: 3 });
        bookFetch.isKoreaPublicDomain.mockImplementation((b) => b.authors[0].death_year <= 1962);
        booksModel.findImportedIds.mockResolvedValue([84]);

        const res = await request(app).get("/api/books/search?q=%20classics%20").set("Authorization", member);

        expect(res.statusCode).toBe(200);
        expect(bookFetch.searchBooks).toHaveBeenCalledWith("classics");
        expect(booksModel.findImportedIds).toHaveBeenCalledWith([1342, 84]);
        expect(res.body).toEqual([
            { gutenbergId: 1342, title: "Pride and Prejudice", authors: [{ name: "Austen, Jane", deathYear: 1817 }], alreadyImported: false },
            { gutenbergId: 84, title: "Frankenstein", authors: [{ name: "Shelley, Mary", deathYear: 1851 }], alreadyImported: true },
        ]);
    });
});

// -----------------------------------------------------------------------------
// PUT /api/rooms/:id/book
// -----------------------------------------------------------------------------
describe("PUT /api/rooms/:id/book", () => {
    const put = (auth, body = { gutenbergId: 1342 }, id = 5) => {
        const r = request(app).put(`/api/rooms/${id}/book`).send(body);
        return auth ? r.set("Authorization", auth) : r;
    };

    // new book: meta ok, Korea PD, text ok, parse ok, import ok
    function newBookFlow() {
        booksModel.findById.mockResolvedValue(undefined);
        bookFetch.getBookMeta.mockResolvedValue({ ok: true, meta });
        bookFetch.isKoreaPublicDomain.mockReturnValue(true);
        bookFetch.fetchBookText.mockResolvedValue({ ok: true, text: "raw", url: "u" });
        bookFetch.parseBook.mockReturnValue(parsed);
        booksModel.importBook.mockResolvedValue({ book: bookRow, created: true });
        booksModel.setRoomBook.mockResolvedValue(roomBook);
    }

    test("401 without a token", async () => {
        const res = await put(null);
        expect(res.statusCode).toBe(401);
    });

    test("400 on an invalid room id", async () => {
        const res = await put(owner, { gutenbergId: 1342 }, "abc");
        expect(res.statusCode).toBe(400);
        expect(res.body).toEqual({ error: "invalid room id" });
    });

    test("404 when the room does not exist", async () => {
        roomsModel.findById.mockResolvedValue(undefined);
        const res = await put(owner);
        expect(res.statusCode).toBe(404);
        expect(res.body).toEqual({ error: "Room not found" });
    });

    test("403 when not a member", async () => {
        roomsModel.isMember.mockResolvedValue(false);
        const res = await put(member);
        expect(res.statusCode).toBe(403);
        expect(res.body).toEqual({ error: "You are not a member of this room" });
    });

    test("403 when a member but not the owner", async () => {
        const res = await put(member);
        expect(res.statusCode).toBe(403);
        expect(res.body).toEqual({ error: "Only the room owner can change the book" });
        expect(booksModel.setRoomBook).not.toHaveBeenCalled();
        expect(bookFetch.getBookMeta).not.toHaveBeenCalled();
    });

    test.each([
        ["missing", {}],
        ["a string", { gutenbergId: "1342" }],
        ["zero", { gutenbergId: 0 }],
        ["a float", { gutenbergId: 1.5 }],
    ])("400 when gutenbergId is %s", async (_label, body) => {
        const res = await put(owner, body);
        expect(res.statusCode).toBe(400);
        expect(res.body).toEqual({ error: "gutenbergId must be a positive integer" });
    });

    test("200 for an already imported book, without calling Gutendex", async () => {
        booksModel.findById.mockResolvedValue(bookRow);
        booksModel.setRoomBook.mockResolvedValue(roomBook);

        const res = await put(owner);

        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual(bookJson);
        expect(bookFetch.getBookMeta).not.toHaveBeenCalled();
        expect(booksModel.importBook).not.toHaveBeenCalled();
        expect(booksModel.setRoomBook).toHaveBeenCalledWith(5, 1342, 1);
    });

    test("200 when the owner switches the room to another shelf book (책 바꾸기)", async () => {
        const frank = { ...bookRow, id: 84, title: "Frankenstein", author: "Shelley, Mary Wollstonecraft", author_death_year: 1851 };
        booksModel.getRoomBook.mockResolvedValue(roomBook);   // the room already reads 1342
        booksModel.findById.mockResolvedValue(frank);
        booksModel.setRoomBook.mockResolvedValue({ ...roomBook, book_id: 84 });

        const res = await put(owner, { gutenbergId: 84 });

        expect(res.statusCode).toBe(200);
        expect(res.body.gutenbergId).toBe(84);
        expect(booksModel.findById).toHaveBeenCalledWith(84);
        expect(bookFetch.getBookMeta).not.toHaveBeenCalled();
        expect(booksModel.setRoomBook).toHaveBeenCalledWith(5, 84, 1);
    });

    test("200 for a new book: imports it, then assigns it", async () => {
        newBookFlow();
        const res = await put(owner);

        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual(bookJson);
        expect(bookFetch.getBookMeta).toHaveBeenCalledWith(1342);
        expect(bookFetch.parseBook).toHaveBeenCalledWith("raw");
        expect(booksModel.importBook).toHaveBeenCalledWith(meta, parsed);
        expect(booksModel.setRoomBook).toHaveBeenCalledWith(5, 1342, 1);
    });

    test("retries the meta lookup once after a timeout", async () => {
        newBookFlow();
        bookFetch.getBookMeta
            .mockResolvedValueOnce({ ok: false, error: "timeout" })
            .mockResolvedValueOnce({ ok: true, meta });

        const res = await put(owner);
        expect(res.statusCode).toBe(200);
        expect(bookFetch.getBookMeta).toHaveBeenCalledTimes(2);
    });

    test("502 when the meta lookup fails twice", async () => {
        newBookFlow();
        bookFetch.getBookMeta.mockResolvedValue({ ok: false, error: "network" });

        const res = await put(owner);
        expect(res.statusCode).toBe(502);
        expect(bookFetch.getBookMeta).toHaveBeenCalledTimes(2);
        expect(booksModel.setRoomBook).not.toHaveBeenCalled();
    });

    test("502 without a retry on an upstream HTTP error", async () => {
        newBookFlow();
        bookFetch.getBookMeta.mockResolvedValue({ ok: false, error: "http", status: 500 });

        const res = await put(owner);
        expect(res.statusCode).toBe(502);
        expect(bookFetch.getBookMeta).toHaveBeenCalledTimes(1);
    });

    test("404 when Gutenberg has no such book", async () => {
        newBookFlow();
        bookFetch.getBookMeta.mockResolvedValue({ ok: false, error: "http", status: 404 });

        const res = await put(owner, { gutenbergId: 99999999 });
        expect(res.statusCode).toBe(404);
        expect(res.body).toEqual({ error: "Book not found on Project Gutenberg" });
    });

    test.each([
        ["French only", ["fr"]],
        ["empty", []],
        ["missing", undefined],
    ])("422 when languages is %s", async (_label, languages) => {
        newBookFlow();
        bookFetch.getBookMeta.mockResolvedValue({ ok: true, meta: { ...meta, languages } });

        const res = await put(owner);
        expect(res.statusCode).toBe(422);
        expect(res.body).toEqual({ error: "Only English books are supported" });
        expect(bookFetch.fetchBookText).not.toHaveBeenCalled();
        expect(booksModel.importBook).not.toHaveBeenCalled();
        expect(booksModel.setRoomBook).not.toHaveBeenCalled();
    });

    test("200 for a multi-language book that includes English", async () => {
        newBookFlow();
        bookFetch.getBookMeta.mockResolvedValue({ ok: true, meta: { ...meta, languages: ["fr", "en"] } });
        const res = await put(owner);
        expect(res.statusCode).toBe(200);
    });

    test("422 when the book is not public domain in Korea", async () => {
        newBookFlow();
        bookFetch.isKoreaPublicDomain.mockReturnValue(false);

        const res = await put(owner);
        expect(res.statusCode).toBe(422);
        expect(bookFetch.fetchBookText).not.toHaveBeenCalled();
        expect(booksModel.importBook).not.toHaveBeenCalled();
    });

    test("422 when there is no plain-text edition", async () => {
        newBookFlow();
        bookFetch.fetchBookText.mockResolvedValue({ ok: false, error: "no_text" });
        const res = await put(owner);
        expect(res.statusCode).toBe(422);
    });

    test("502 when downloading the text times out", async () => {
        newBookFlow();
        bookFetch.fetchBookText.mockResolvedValue({ ok: false, error: "timeout" });
        const res = await put(owner);
        expect(res.statusCode).toBe(502);
        expect(booksModel.importBook).not.toHaveBeenCalled();
    });

    test.each([["too_long"], ["too_short"]])("422 when parsing fails (%s)", async (error) => {
        newBookFlow();
        bookFetch.parseBook.mockReturnValue({ ok: false, error, totalWords: 0, totalParagraphs: 0 });
        const res = await put(owner);
        expect(res.statusCode).toBe(422);
        expect(booksModel.importBook).not.toHaveBeenCalled();
    });

    test("503 when the import could not complete", async () => {
        newBookFlow();
        const err = new Error("incomplete");
        err.name = "IncompleteImportError";
        booksModel.importBook.mockRejectedValue(err);

        const res = await put(owner);
        expect(res.statusCode).toBe(503);
        expect(booksModel.setRoomBook).not.toHaveBeenCalled();
    });

    test("500 on an unexpected error", async () => {
        newBookFlow();
        booksModel.setRoomBook.mockRejectedValue(new Error("db down"));
        const res = await put(owner);
        expect(res.statusCode).toBe(500);
        expect(res.body).toEqual({ error: "Server error" });
    });
});

// -----------------------------------------------------------------------------
// GET /api/rooms/:id/book
// -----------------------------------------------------------------------------
describe("GET /api/rooms/:id/book", () => {
    const chapters = [
        { idx: 0, title: "Chapter I.", start_paragraph: 0, paragraph_count: 2, word_count: 30 },
        { idx: 1, title: null, start_paragraph: 2, paragraph_count: 1, word_count: 9 },
    ];

    test("401 without a token", async () => {
        const res = await request(app).get("/api/rooms/5/book");
        expect(res.statusCode).toBe(401);
    });

    test("400 on an invalid room id", async () => {
        const res = await request(app).get("/api/rooms/0/book").set("Authorization", member);
        expect(res.statusCode).toBe(400);
    });

    test("404 when the room does not exist", async () => {
        roomsModel.findById.mockResolvedValue(undefined);
        const res = await request(app).get("/api/rooms/5/book").set("Authorization", member);
        expect(res.statusCode).toBe(404);
        expect(res.body).toEqual({ error: "Room not found" });
    });

    test("403 when not a member", async () => {
        roomsModel.isMember.mockResolvedValue(false);
        const res = await request(app).get("/api/rooms/5/book").set("Authorization", member);
        expect(res.statusCode).toBe(403);
        expect(booksModel.getRoomBook).not.toHaveBeenCalled();
    });

    test("404 when the room has no book", async () => {
        booksModel.getRoomBook.mockResolvedValue(undefined);
        const res = await request(app).get("/api/rooms/5/book").set("Authorization", member);
        expect(res.statusCode).toBe(404);
        expect(res.body).toEqual({ error: "No book assigned to this room" });
    });

    test("200 overview with default progress (no row created), no-store", async () => {
        booksModel.getRoomBook.mockResolvedValue(roomBook);
        booksModel.getChapters.mockResolvedValue(chapters);
        booksModel.getProgress.mockResolvedValue(undefined);

        const res = await request(app).get("/api/rooms/5/book").set("Authorization", member);

        expect(res.statusCode).toBe(200);
        expect(res.headers["cache-control"]).toBe("no-store");
        expect(res.body).toEqual({
            room: { id: 5, name: "book-club" },
            book: bookJson,
            chapters: [
                { idx: 0, title: "Chapter I.", startParagraph: 0, paragraphCount: 2, wordCount: 30 },
                { idx: 1, title: null, startParagraph: 2, paragraphCount: 1, wordCount: 9 },
            ],
            progress: { paragraphIdx: 0, targetEndDate: null, startedAt: null, updatedAt: null },
            readers: [],
        });
        expect(booksModel.getProgress).toHaveBeenCalledWith(2, 5, 1342);
        expect(booksModel.upsertProgress).not.toHaveBeenCalled();
    });

    test("200 overview with saved progress", async () => {
        booksModel.getRoomBook.mockResolvedValue(roomBook);
        booksModel.getChapters.mockResolvedValue(chapters);
        booksModel.getProgress.mockResolvedValue({
            paragraph_idx: 2, target_end_date: "2026-12-31", started_at: "s", updated_at: "u",
        });
        const res = await request(app).get("/api/rooms/5/book").set("Authorization", member);
        expect(res.body.progress).toEqual({ paragraphIdx: 2, targetEndDate: "2026-12-31", startedAt: "s", updatedAt: "u" });
    });

    test("200 readers: chapter from each reader's paragraph, isMe flags the caller", async () => {
        const three = [
            { idx: 0, title: "Chapter I.", start_paragraph: 0, paragraph_count: 2, word_count: 30 },
            { idx: 1, title: "Chapter II.", start_paragraph: 2, paragraph_count: 3, word_count: 40 },
            { idx: 2, title: "Chapter III.", start_paragraph: 5, paragraph_count: 2, word_count: 20 },
        ];
        booksModel.getRoomBook.mockResolvedValue(roomBook);
        booksModel.getChapters.mockResolvedValue(three);
        booksModel.getProgress.mockResolvedValue(undefined);
        booksModel.getReaders.mockResolvedValue([
            { user_id: 1, nickname: "Alice", paragraph_idx: 0 },   // first paragraph -> ch 0
            { user_id: 2, nickname: "Bob", paragraph_idx: 4 },     // last paragraph of ch 1
            { user_id: 3, nickname: "Cara", paragraph_idx: 5 },    // first paragraph of ch 2
            { user_id: 4, nickname: "Dan", paragraph_idx: 999 },   // past the end -> last chapter
        ]);

        const res = await request(app).get("/api/rooms/5/book").set("Authorization", member);

        expect(res.statusCode).toBe(200);
        expect(booksModel.getReaders).toHaveBeenCalledWith(5, 1342);
        expect(res.body.readers).toEqual([
            { userId: 1, nickname: "Alice", chapterIdx: 0, isMe: false },
            { userId: 2, nickname: "Bob", chapterIdx: 1, isMe: true },
            { userId: 3, nickname: "Cara", chapterIdx: 2, isMe: false },
            { userId: 4, nickname: "Dan", chapterIdx: 2, isMe: false },
        ]);
    });

    test("readers are not looked up for a single chapter", async () => {
        booksModel.getRoomBook.mockResolvedValue(roomBook);
        booksModel.getChapters.mockResolvedValue(chapters);
        booksModel.getChapterParagraphs.mockResolvedValue([]);
        const res = await request(app).get("/api/rooms/5/book?chapter=1").set("Authorization", member);
        expect(res.statusCode).toBe(200);
        expect(res.body.readers).toBeUndefined();
        expect(booksModel.getReaders).not.toHaveBeenCalled();
    });

    test("500 when the readers lookup fails", async () => {
        booksModel.getRoomBook.mockResolvedValue(roomBook);
        booksModel.getChapters.mockResolvedValue(chapters);
        booksModel.getProgress.mockResolvedValue(undefined);
        booksModel.getReaders.mockRejectedValue(new Error("db down"));
        const res = await request(app).get("/api/rooms/5/book").set("Authorization", member);
        expect(res.statusCode).toBe(500);
        expect(res.body).toEqual({ error: "Server error" });
    });

    test("200 one chapter's paragraphs", async () => {
        booksModel.getRoomBook.mockResolvedValue(roomBook);
        booksModel.getChapters.mockResolvedValue(chapters);
        booksModel.getChapterParagraphs.mockResolvedValue([
            { id: 11, idx: 0, text: "It is a truth." },
            { id: 12, idx: 1, text: "However little known." },
        ]);

        const res = await request(app).get("/api/rooms/5/book?chapter=0").set("Authorization", member);

        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual({
            chapter: { idx: 0, title: "Chapter I." },
            paragraphs: [
                { id: 11, idx: 0, text: "It is a truth." },
                { id: 12, idx: 1, text: "However little known." },
            ],
        });
        expect(booksModel.getChapterParagraphs).toHaveBeenCalledWith(1342, 0);
        expect(booksModel.getProgress).not.toHaveBeenCalled();
    });

    test("404 when the chapter is out of range", async () => {
        booksModel.getRoomBook.mockResolvedValue(roomBook);
        booksModel.getChapters.mockResolvedValue(chapters);
        const res = await request(app).get("/api/rooms/5/book?chapter=2").set("Authorization", member);
        expect(res.statusCode).toBe(404);
        expect(res.body).toEqual({ error: "Chapter not found" });
    });

    test.each(["-1", "1.5", "abc", ""])("400 when chapter is %p", async (c) => {
        const res = await request(app).get(`/api/rooms/5/book?chapter=${c}`).set("Authorization", member);
        expect(res.statusCode).toBe(400);
        expect(res.body).toEqual({ error: "chapter must be a non-negative integer" });
    });
});

// -----------------------------------------------------------------------------
// PUT /api/rooms/:id/book/progress
// -----------------------------------------------------------------------------
describe("PUT /api/rooms/:id/book/progress", () => {
    const put = (auth, body) => {
        const r = request(app).put("/api/rooms/5/book/progress").send(body);
        return auth ? r.set("Authorization", auth) : r;
    };
    const saved = { paragraph_idx: 120, target_end_date: "2026-12-31", started_at: "s", updated_at: "u" };

    beforeEach(() => {
        booksModel.getRoomBook.mockResolvedValue(roomBook);
        booksModel.upsertProgress.mockResolvedValue(saved);
    });

    test("401 without a token", async () => {
        const res = await put(null, { paragraphIdx: 1 });
        expect(res.statusCode).toBe(401);
    });

    test("404 when the room does not exist", async () => {
        roomsModel.findById.mockResolvedValue(undefined);
        const res = await put(member, { paragraphIdx: 1 });
        expect(res.statusCode).toBe(404);
    });

    test("403 when not a member", async () => {
        roomsModel.isMember.mockResolvedValue(false);
        const res = await put(member, { paragraphIdx: 1 });
        expect(res.statusCode).toBe(403);
        expect(booksModel.upsertProgress).not.toHaveBeenCalled();
    });

    test("404 when the room has no book", async () => {
        booksModel.getRoomBook.mockResolvedValue(undefined);
        const res = await put(member, { paragraphIdx: 1 });
        expect(res.statusCode).toBe(404);
        expect(res.body).toEqual({ error: "No book assigned to this room" });
    });

    test.each([
        ["missing", {}],
        ["negative", { paragraphIdx: -1 }],
        ["a float", { paragraphIdx: 1.5 }],
        ["a string", { paragraphIdx: "3" }],
        ["past the end", { paragraphIdx: 2061 }],
    ])("400 when paragraphIdx is %s", async (_label, body) => {
        const res = await put(member, body);
        expect(res.statusCode).toBe(400);
        expect(res.body).toEqual({ error: "paragraphIdx must be an integer from 0 to 2060" });
    });

    test.each([
        ["bad format", "2026/12/31"],
        ["impossible date", "2026-02-30"],
        ["month 13", "2026-13-01"],
        ["a number", 20261231],
    ])("400 when targetEndDate is %s", async (_label, targetEndDate) => {
        const res = await put(member, { paragraphIdx: 1, targetEndDate });
        expect(res.statusCode).toBe(400);
        expect(res.body).toEqual({ error: "targetEndDate must be a valid YYYY-MM-DD date or null" });
    });

    test("200 saves progress and a target date, no-store", async () => {
        const res = await put(member, { paragraphIdx: 2060, targetEndDate: "2028-02-29" });
        expect(res.statusCode).toBe(200);
        expect(res.headers["cache-control"]).toBe("no-store");
        expect(res.body).toEqual({ paragraphIdx: 120, targetEndDate: "2026-12-31", startedAt: "s", updatedAt: "u" });
        expect(booksModel.upsertProgress).toHaveBeenCalledWith({
            user_id: 2, room_id: 5, book_id: 1342, paragraph_idx: 2060, target_end_date: "2028-02-29",
        });
    });

    test("omitted targetEndDate is passed as undefined (keep), null as null (clear)", async () => {
        await put(member, { paragraphIdx: 0 });
        expect(booksModel.upsertProgress.mock.calls[0][0].target_end_date).toBeUndefined();

        await put(member, { paragraphIdx: 0, targetEndDate: null });
        expect(booksModel.upsertProgress.mock.calls[1][0].target_end_date).toBeNull();
    });

    test("500 on a model error", async () => {
        booksModel.upsertProgress.mockRejectedValue(new Error("db down"));
        const res = await put(member, { paragraphIdx: 1 });
        expect(res.statusCode).toBe(500);
        expect(res.body).toEqual({ error: "Server error" });
    });
});
