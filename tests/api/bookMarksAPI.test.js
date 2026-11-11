const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../../app");

// Auto-mock the model layers (same setup as booksAPI.test.js). Nothing here touches the DB.
jest.mock("../../models/bookMarksModel");
jest.mock("../../models/booksModel");
jest.mock("../../models/roomsModel");
jest.mock("../../models/usersModel");
const marksModel = require("../../models/bookMarksModel");
const booksModel = require("../../models/booksModel");
const roomsModel = require("../../models/roomsModel");
const usersModel = require("../../models/usersModel");

// user 1 = alice, user 2 = bob — both members of room 5
const tokenFor = (id, username) => jwt.sign({ id, username }, process.env.JWT_SECRET, { expiresIn: "1h" });
const alice = `Bearer ${tokenFor(1, "alice")}`;
const bob = `Bearer ${tokenFor(2, "bob")}`;

const room = { id: 5, name: "book-club", owner_id: 1 };
const roomBook = {
    room_id: 5, book_id: 1342, set_by: 1, set_at: "2026-11-10 00:00:00",
    title: "Pride and Prejudice", author: "Austen, Jane", author_death_year: 1817,
    total_words: 121581, total_paragraphs: 2061,
};
// chapter 0 = paragraphs 0-1, chapter 1 = paragraphs 2-4
const chapters = [
    { idx: 0, title: "Chapter I.", start_paragraph: 0, paragraph_count: 2, word_count: 30 },
    { idx: 1, title: "Chapter II.", start_paragraph: 2, paragraph_count: 3, word_count: 40 },
];
const CHAPTER_OF = { 0: 0, 1: 0, 2: 1, 3: 1, 4: 1 };

const markRow = (over = {}) => ({
    id: 7, room_id: 5, book_id: 1342, user_id: 1, author_nickname: "Alice",
    kind: "highlight", color: "yellow", chapter_idx: 1, start_para: 2, start_word: 3, end_para: 3, end_word: 0,
    quote: "a truth universally acknowledged", content: null, created_at: "2026-11-11 00:00:00",
    ...over,
});

beforeEach(() => {
    jest.clearAllMocks();
    usersModel.findById.mockImplementation(async (id) => ({ id, username: id === 1 ? "alice" : "bob" }));
    roomsModel.findById.mockResolvedValue(room);
    roomsModel.isMember.mockResolvedValue(true);
    booksModel.getRoomBook.mockResolvedValue(roomBook);
    booksModel.getChapters.mockResolvedValue(chapters);
    marksModel.findParagraphChapters.mockImplementation(async (_bookId, idxs) =>
        idxs.filter((i) => i in CHAPTER_OF).map((i) => ({ idx: i, chapter_idx: CHAPTER_OF[i] })));
    jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
    console.error.mockRestore();
});

// -----------------------------------------------------------------------------
// GET /api/rooms/:id/book/marks?chapter=N
// -----------------------------------------------------------------------------
describe("GET /api/rooms/:id/book/marks", () => {
    const get = (auth, qs = "?chapter=1", id = 5) => {
        const r = request(app).get(`/api/rooms/${id}/book/marks${qs}`);
        return auth ? r.set("Authorization", auth) : r;
    };

    test("401 without a token", async () => {
        const res = await get(null);
        expect(res.statusCode).toBe(401);
    });

    test("400 on an invalid room id", async () => {
        const res = await get(alice, "?chapter=1", "abc");
        expect(res.statusCode).toBe(400);
        expect(res.body).toEqual({ error: "invalid room id" });
    });

    test("404 when the room does not exist", async () => {
        roomsModel.findById.mockResolvedValue(undefined);
        const res = await get(alice);
        expect(res.statusCode).toBe(404);
        expect(res.body).toEqual({ error: "Room not found" });
    });

    test("403 when not a member", async () => {
        roomsModel.isMember.mockResolvedValue(false);
        const res = await get(alice);
        expect(res.statusCode).toBe(403);
        expect(marksModel.listForChapter).not.toHaveBeenCalled();
    });

    test("404 when the room has no book", async () => {
        booksModel.getRoomBook.mockResolvedValue(undefined);
        const res = await get(alice);
        expect(res.statusCode).toBe(404);
        expect(res.body).toEqual({ error: "No book assigned to this room" });
    });

    test.each([
        ["missing", ""],
        ["negative", "?chapter=-1"],
        ["not a number", "?chapter=one"],
        ["fractional", "?chapter=1.5"],
    ])("400 when chapter is %s", async (_label, qs) => {
        const res = await get(alice, qs);
        expect(res.statusCode).toBe(400);
        expect(res.body).toEqual({ error: "chapter must be a non-negative integer" });
    });

    test("404 when the chapter does not exist", async () => {
        const res = await get(alice, "?chapter=9");
        expect(res.statusCode).toBe(404);
        expect(res.body).toEqual({ error: "Chapter not found" });
        expect(marksModel.listForChapter).not.toHaveBeenCalled();
    });

    test("200 lists the chapter's marks for the room's current book, no-store", async () => {
        const rows = [markRow(), markRow({ id: 8, user_id: 2, author_nickname: "Bob", kind: "note", content: "nice" })];
        marksModel.listForChapter.mockResolvedValue(rows);

        const res = await get(bob);

        expect(res.statusCode).toBe(200);
        expect(res.headers["cache-control"]).toBe("no-store");
        expect(res.body).toEqual(rows);
        expect(marksModel.listForChapter).toHaveBeenCalledWith(5, 1342, 1);
    });

    test("500 on a model error", async () => {
        marksModel.listForChapter.mockRejectedValue(new Error("db down"));
        const res = await get(alice);
        expect(res.statusCode).toBe(500);
        expect(res.body).toEqual({ error: "Server error" });
    });
});

// -----------------------------------------------------------------------------
// POST /api/rooms/:id/book/marks
// -----------------------------------------------------------------------------
describe("POST /api/rooms/:id/book/marks", () => {
    const highlight = {
        kind: "highlight", color: "pink", chapterIdx: 1, startPara: 2, startWord: 3, endPara: 3, endWord: 0,
        quote: "  a truth universally acknowledged  ",
    };
    const note = { ...highlight, kind: "note", content: "  so ironic  " };
    const post = (auth, body = highlight, id = 5) => {
        const r = request(app).post(`/api/rooms/${id}/book/marks`).send(body);
        return auth ? r.set("Authorization", auth) : r;
    };

    beforeEach(() => {
        marksModel.createMark.mockImplementation(async (m) => markRow({ ...m, id: 7, author_nickname: "Alice" }));
    });

    test("401 without a token", async () => {
        const res = await post(null);
        expect(res.statusCode).toBe(401);
    });

    test("403 when not a member (checked before the body)", async () => {
        roomsModel.isMember.mockResolvedValue(false);
        const res = await post(alice, {});
        expect(res.statusCode).toBe(403);
        expect(marksModel.createMark).not.toHaveBeenCalled();
    });

    test("404 when the room has no book", async () => {
        booksModel.getRoomBook.mockResolvedValue(undefined);
        const res = await post(alice);
        expect(res.statusCode).toBe(404);
        expect(marksModel.createMark).not.toHaveBeenCalled();
    });

    test("201 highlight: stored on the room's book, quote trimmed, content ignored -> null", async () => {
        const res = await post(alice, { ...highlight, content: "should be dropped" });

        expect(res.statusCode).toBe(201);
        expect(marksModel.createMark).toHaveBeenCalledWith({
            room_id: 5, book_id: 1342, user_id: 1, kind: "highlight", color: "pink", chapter_idx: 1,
            start_para: 2, start_word: 3, end_para: 3, end_word: 0,
            quote: "a truth universally acknowledged", content: null,
        });
        expect(marksModel.findParagraphChapters).toHaveBeenCalledWith(1342, [2, 3]);
        expect(res.body).toMatchObject({ id: 7, kind: "highlight", color: "pink", content: null, author_nickname: "Alice" });
    });

    test("201 note: content trimmed and stored, color ignored -> null", async () => {
        const res = await post(alice, note); // note still carries color: "pink" from the highlight fixture
        expect(res.statusCode).toBe(201);
        expect(marksModel.createMark).toHaveBeenCalledWith(expect.objectContaining({ kind: "note", color: null, content: "so ironic" }));
        expect(res.body).toMatchObject({ kind: "note", color: null });
    });

    test.each(["yellow", "pink", "blue", "green"])("201 highlight in %s", async (color) => {
        const res = await post(alice, { ...highlight, color });
        expect(res.statusCode).toBe(201);
        expect(marksModel.createMark).toHaveBeenCalledWith(expect.objectContaining({ color }));
    });

    test("201 single word (start == end)", async () => {
        const res = await post(alice, { ...highlight, startPara: 2, startWord: 4, endPara: 2, endWord: 4 });
        expect(res.statusCode).toBe(201);
    });

    test("201 the same place can be marked again (no uniqueness)", async () => {
        expect((await post(alice)).statusCode).toBe(201);
        expect((await post(alice)).statusCode).toBe(201);
        expect(marksModel.createMark).toHaveBeenCalledTimes(2);
    });

    test.each([
        ["missing kind", { ...highlight, kind: undefined }, "kind must be 'highlight' or 'note'"],
        ["unknown kind", { ...highlight, kind: "underline" }, "kind must be 'highlight' or 'note'"],
        ["missing chapterIdx", { ...highlight, chapterIdx: undefined }, null],
        ["negative startWord", { ...highlight, startWord: -1 }, null],
        ["fractional endPara", { ...highlight, endPara: 2.5 }, null],
        ["string startPara", { ...highlight, startPara: "2" }, null],
        ["start paragraph after end", { ...highlight, startPara: 3, endPara: 2 }, "start must not be after end"],
        ["start word after end in one paragraph", { ...highlight, startPara: 2, startWord: 5, endPara: 2, endWord: 4 }, "start must not be after end"],
        ["missing quote", { ...highlight, quote: undefined }, "quote must be 1-1000 characters"],
        ["blank quote", { ...highlight, quote: "   " }, "quote must be 1-1000 characters"],
        ["quote too long", { ...highlight, quote: "a".repeat(1001) }, "quote must be 1-1000 characters"],
        ["highlight without color", { ...highlight, color: undefined }, "color must be one of yellow, pink, blue, green"],
        ["highlight with null color", { ...highlight, color: null }, "color must be one of yellow, pink, blue, green"],
        ["highlight with an unknown color", { ...highlight, color: "red" }, "color must be one of yellow, pink, blue, green"],
        ["highlight with a capitalised color", { ...highlight, color: "Yellow" }, "color must be one of yellow, pink, blue, green"],
        ["note without content", { ...note, content: undefined }, "content must be 1-500 characters"],
        ["note with blank content", { ...note, content: "  " }, "content must be 1-500 characters"],
        ["note content too long", { ...note, content: "a".repeat(501) }, "content must be 1-500 characters"],
        ["start outside the chapter", { ...highlight, startPara: 1 }, "startPara and endPara must be paragraphs of chapter chapterIdx"],
        ["end outside the chapter", { ...highlight, chapterIdx: 0, startPara: 0, endPara: 2 }, "startPara and endPara must be paragraphs of chapter chapterIdx"],
        ["paragraph not in the book", { ...highlight, endPara: 99 }, "startPara and endPara must be paragraphs of chapter chapterIdx"],
        ["chapter that does not exist", { ...highlight, chapterIdx: 9 }, "startPara and endPara must be paragraphs of chapter chapterIdx"],
    ])("400 on %s", async (_label, body, message) => {
        const res = await post(alice, body);
        expect(res.statusCode).toBe(400);
        if (message) expect(res.body).toEqual({ error: message });
        else expect(res.body.error).toMatch(/non-negative integers/);
        expect(marksModel.createMark).not.toHaveBeenCalled();
    });

    test("quote of exactly 1000 and note content of exactly 500 characters are accepted", async () => {
        const res = await post(alice, { ...note, quote: "q".repeat(1000), content: "c".repeat(500) });
        expect(res.statusCode).toBe(201);
    });

    test("500 on a model error", async () => {
        marksModel.createMark.mockRejectedValue(new Error("db down"));
        const res = await post(alice);
        expect(res.statusCode).toBe(500);
        expect(res.body).toEqual({ error: "Server error" });
    });
});

// -----------------------------------------------------------------------------
// PATCH /api/book-marks/:id
// -----------------------------------------------------------------------------
describe("PATCH /api/book-marks/:id", () => {
    const patch = (auth, body = { content: "  edited  " }, id = 7) => {
        const r = request(app).patch(`/api/book-marks/${id}`).send(body);
        return auth ? r.set("Authorization", auth) : r;
    };

    beforeEach(() => {
        marksModel.findById.mockResolvedValue(markRow({ kind: "note", content: "old" }));
        marksModel.updateContent.mockImplementation(async (id, content) => markRow({ id, kind: "note", content }));
    });

    test("401 without a token", async () => {
        const res = await patch(null);
        expect(res.statusCode).toBe(401);
    });

    test("400 on an invalid id", async () => {
        const res = await patch(alice, { content: "x" }, "abc");
        expect(res.statusCode).toBe(400);
        expect(res.body).toEqual({ error: "invalid mark id" });
    });

    test("404 when the mark does not exist", async () => {
        marksModel.findById.mockResolvedValue(undefined);
        const res = await patch(alice);
        expect(res.statusCode).toBe(404);
        expect(res.body).toEqual({ error: "Mark not found" });
    });

    test("403 on someone else's note", async () => {
        const res = await patch(bob);
        expect(res.statusCode).toBe(403);
        expect(marksModel.updateContent).not.toHaveBeenCalled();
    });

    test("400 on a highlight (only notes have content)", async () => {
        marksModel.findById.mockResolvedValue(markRow());
        const res = await patch(alice);
        expect(res.statusCode).toBe(400);
        expect(res.body).toEqual({ error: "Only notes can be edited" });
        expect(marksModel.updateContent).not.toHaveBeenCalled();
    });

    test.each([
        ["missing", {}],
        ["blank", { content: "   " }],
        ["too long", { content: "a".repeat(501) }],
        ["not a string", { content: 5 }],
    ])("400 when content is %s", async (_label, body) => {
        const res = await patch(alice, body);
        expect(res.statusCode).toBe(400);
        expect(res.body).toEqual({ error: "content must be 1-500 characters" });
    });

    test("200 updates my note (trimmed)", async () => {
        const res = await patch(alice);
        expect(res.statusCode).toBe(200);
        expect(marksModel.updateContent).toHaveBeenCalledWith(7, "edited");
        expect(res.body).toMatchObject({ id: 7, kind: "note", content: "edited" });
    });
});

// -----------------------------------------------------------------------------
// DELETE /api/book-marks/:id
// -----------------------------------------------------------------------------
describe("DELETE /api/book-marks/:id", () => {
    const del = (auth, id = 7) => {
        const r = request(app).delete(`/api/book-marks/${id}`);
        return auth ? r.set("Authorization", auth) : r;
    };

    beforeEach(() => {
        marksModel.findById.mockResolvedValue(markRow());
    });

    test("401 without a token", async () => {
        const res = await del(null);
        expect(res.statusCode).toBe(401);
    });

    test("400 on an invalid id", async () => {
        const res = await del(alice, 0);
        expect(res.statusCode).toBe(400);
    });

    test("404 when the mark does not exist", async () => {
        marksModel.findById.mockResolvedValue(undefined);
        const res = await del(alice);
        expect(res.statusCode).toBe(404);
        expect(marksModel.deleteMark).not.toHaveBeenCalled();
    });

    test("403 on someone else's mark", async () => {
        const res = await del(bob);
        expect(res.statusCode).toBe(403);
        expect(res.body).toEqual({ error: "You can only delete your own mark" });
        expect(marksModel.deleteMark).not.toHaveBeenCalled();
    });

    test.each(["highlight", "note"])("204 deletes my %s", async (kind) => {
        marksModel.findById.mockResolvedValue(markRow({ kind, content: kind === "note" ? "n" : null }));
        const res = await del(alice);
        expect(res.statusCode).toBe(204);
        expect(marksModel.deleteMark).toHaveBeenCalledWith(7);
    });
});
