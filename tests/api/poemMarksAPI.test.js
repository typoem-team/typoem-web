const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../../app");

// Auto-mock the model layers (same setup as bookMarksAPI.test.js). Nothing here touches the DB.
jest.mock("../../models/poemMarksModel");
jest.mock("../../models/poemsModel");
jest.mock("../../models/memosModel");
jest.mock("../../models/roomsModel");
jest.mock("../../models/usersModel");
jest.mock("../../models/streakModel"); // /today records a streak check-in
const marksModel = require("../../models/poemMarksModel");
const poemsModel = require("../../models/poemsModel");
const memosModel = require("../../models/memosModel");
const roomsModel = require("../../models/roomsModel");
const usersModel = require("../../models/usersModel");

// user 1 = alice, user 2 = bob — both members of room 5. Today's poem is 30; 20 was an earlier day's.
const tokenFor = (id, username) => jwt.sign({ id, username }, process.env.JWT_SECRET, { expiresIn: "1h" });
const alice = `Bearer ${tokenFor(1, "alice")}`;
const bob = `Bearer ${tokenFor(2, "bob")}`;

const room = { id: 5, name: "poem-club", owner_id: 1 };
const TODAY_POEM = 30;
const OLD_POEM = 20;
const LINES = [1, 2, 3, 4, 5]; // line_numbers of each poem

const markRow = (over = {}) => ({
    id: 9, room_id: 5, poem_id: TODAY_POEM, user_id: 1, author_nickname: "Alice",
    kind: "highlight", color: "blue", start_line: 2, start_word: 1, end_line: 3, end_word: 0,
    quote: "the woods are lovely", content: null, created_at: "2026-11-11 00:00:00",
    ...over,
});

beforeEach(() => {
    jest.clearAllMocks();
    usersModel.findById.mockImplementation(async (id) => ({ id, username: id === 1 ? "alice" : "bob" }));
    roomsModel.findById.mockResolvedValue(room);
    roomsModel.isMember.mockResolvedValue(true);
    poemsModel.getTodayPoemId.mockResolvedValue(TODAY_POEM);
    poemsModel.roomHasSeenPoem.mockImplementation(async (_roomId, poemId) => poemId === TODAY_POEM || poemId === OLD_POEM);
    marksModel.findLineNumbers.mockImplementation(async (_poemId, nums) => nums.filter((n) => LINES.includes(n)));
    jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
    console.error.mockRestore();
});

// -----------------------------------------------------------------------------
// GET /api/rooms/:id/poems/:poemId/marks
// -----------------------------------------------------------------------------
describe("GET /api/rooms/:id/poems/:poemId/marks", () => {
    const get = (auth, poemId = TODAY_POEM, id = 5) => {
        const r = request(app).get(`/api/rooms/${id}/poems/${poemId}/marks`);
        return auth ? r.set("Authorization", auth) : r;
    };

    test("401 without a token", async () => {
        const res = await get(null);
        expect(res.statusCode).toBe(401);
    });

    test("400 on an invalid room id", async () => {
        const res = await get(alice, TODAY_POEM, "abc");
        expect(res.statusCode).toBe(400);
        expect(res.body).toEqual({ error: "invalid room id" });
    });

    test("400 on an invalid poem id", async () => {
        const res = await get(alice, 0);
        expect(res.statusCode).toBe(400);
        expect(res.body).toEqual({ error: "invalid poem id" });
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
        expect(marksModel.listForRoomPoem).not.toHaveBeenCalled();
    });

    test("404 for a poem this room was never given", async () => {
        const res = await get(alice, 99);
        expect(res.statusCode).toBe(404);
        expect(res.body).toEqual({ error: "Poem not found in this room" });
        expect(poemsModel.roomHasSeenPoem).toHaveBeenCalledWith(5, 99);
        expect(marksModel.listForRoomPoem).not.toHaveBeenCalled();
    });

    test.each([["today's", TODAY_POEM], ["an earlier day's", OLD_POEM]])("200 lists marks on %s poem, no-store", async (_label, poemId) => {
        const rows = [markRow({ poem_id: poemId }), markRow({ id: 10, poem_id: poemId, user_id: 2, author_nickname: "Bob", kind: "note", color: null, content: "hm" })];
        marksModel.listForRoomPoem.mockResolvedValue(rows);

        const res = await get(bob, poemId);

        expect(res.statusCode).toBe(200);
        expect(res.headers["cache-control"]).toBe("no-store");
        expect(res.body).toEqual(rows);
        expect(marksModel.listForRoomPoem).toHaveBeenCalledWith(5, poemId);
    });

    test("500 on a model error", async () => {
        marksModel.listForRoomPoem.mockRejectedValue(new Error("db down"));
        const res = await get(alice);
        expect(res.statusCode).toBe(500);
        expect(res.body).toEqual({ error: "Server error" });
    });
});

// -----------------------------------------------------------------------------
// POST /api/rooms/:id/poems/:poemId/marks
// -----------------------------------------------------------------------------
describe("POST /api/rooms/:id/poems/:poemId/marks", () => {
    const highlight = {
        kind: "highlight", color: "green", startLine: 2, startWord: 1, endLine: 3, endWord: 0,
        quote: "  the woods are lovely  ",
    };
    const note = { ...highlight, kind: "note", content: "  dark and deep  " };
    const post = (auth, body = highlight, poemId = TODAY_POEM, id = 5) => {
        const r = request(app).post(`/api/rooms/${id}/poems/${poemId}/marks`).send(body);
        return auth ? r.set("Authorization", auth) : r;
    };

    beforeEach(() => {
        marksModel.createMark.mockImplementation(async (m) => markRow({ ...m, id: 9, author_nickname: "Alice" }));
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

    test("404 on an earlier day's poem (only today's poem can be marked)", async () => {
        const res = await post(alice, highlight, OLD_POEM);
        expect(res.statusCode).toBe(404);
        expect(res.body).toEqual({ error: "Poem is not this room's poem today" });
        expect(marksModel.createMark).not.toHaveBeenCalled();
    });

    test("404 when the room has no poem today yet", async () => {
        poemsModel.getTodayPoemId.mockResolvedValue(null);
        const res = await post(alice);
        expect(res.statusCode).toBe(404);
        expect(marksModel.createMark).not.toHaveBeenCalled();
    });

    test("uses today's date (UTC, same as line annotations)", async () => {
        await post(alice);
        expect(poemsModel.getTodayPoemId).toHaveBeenCalledWith(5, require("../../lib/dates").today());
    });

    test("201 highlight: quote trimmed, content ignored -> null", async () => {
        const res = await post(alice, { ...highlight, content: "dropped" });

        expect(res.statusCode).toBe(201);
        expect(marksModel.createMark).toHaveBeenCalledWith({
            room_id: 5, poem_id: TODAY_POEM, user_id: 1, kind: "highlight", color: "green",
            start_line: 2, start_word: 1, end_line: 3, end_word: 0,
            quote: "the woods are lovely", content: null,
        });
        expect(marksModel.findLineNumbers).toHaveBeenCalledWith(TODAY_POEM, [2, 3]);
        expect(res.body).toMatchObject({
            id: 9, poem_id: TODAY_POEM, user_id: 1, author_nickname: "Alice",
            kind: "highlight", color: "green", content: null, created_at: "2026-11-11 00:00:00",
        });
    });

    test("201 note: content trimmed, color ignored -> null", async () => {
        const res = await post(bob, note);
        expect(res.statusCode).toBe(201);
        expect(marksModel.createMark).toHaveBeenCalledWith(expect.objectContaining({
            user_id: 2, kind: "note", color: null, content: "dark and deep",
        }));
    });

    test("201 single word on one line, and the same place again", async () => {
        const one = { ...highlight, startLine: 4, startWord: 2, endLine: 4, endWord: 2 };
        expect((await post(alice, one)).statusCode).toBe(201);
        expect((await post(alice, one)).statusCode).toBe(201);
        expect(marksModel.createMark).toHaveBeenCalledTimes(2);
    });

    test.each([
        ["missing kind", { ...highlight, kind: undefined }, "kind must be 'highlight' or 'note'"],
        ["unknown kind", { ...highlight, kind: "underline" }, "kind must be 'highlight' or 'note'"],
        ["highlight without color", { ...highlight, color: undefined }, "color must be one of yellow, pink, blue, green"],
        ["highlight with an unknown color", { ...highlight, color: "orange" }, "color must be one of yellow, pink, blue, green"],
        ["missing startLine", { ...highlight, startLine: undefined }, "startLine, startWord, endLine, endWord must be non-negative integers"],
        ["negative endWord", { ...highlight, endWord: -1 }, "startLine, startWord, endLine, endWord must be non-negative integers"],
        ["string startWord", { ...highlight, startWord: "1" }, "startLine, startWord, endLine, endWord must be non-negative integers"],
        ["start line after end", { ...highlight, startLine: 4, endLine: 3 }, "start must not be after end"],
        ["start word after end on one line", { ...highlight, startLine: 3, startWord: 4, endLine: 3, endWord: 2 }, "start must not be after end"],
        ["blank quote", { ...highlight, quote: " " }, "quote must be 1-1000 characters"],
        ["quote too long", { ...highlight, quote: "a".repeat(1001) }, "quote must be 1-1000 characters"],
        ["note without content", { ...note, content: undefined }, "content must be 1-500 characters"],
        ["note content too long", { ...note, content: "a".repeat(501) }, "content must be 1-500 characters"],
        ["line 0 (line numbers start at 1)", { ...highlight, startLine: 0 }, "startLine and endLine must be lines of this poem"],
        ["end line past the poem", { ...highlight, endLine: 6 }, "startLine and endLine must be lines of this poem"],
    ])("400 on %s", async (_label, body, message) => {
        const res = await post(alice, body);
        expect(res.statusCode).toBe(400);
        expect(res.body).toEqual({ error: message });
        expect(marksModel.createMark).not.toHaveBeenCalled();
    });

    test("500 on a model error", async () => {
        marksModel.createMark.mockRejectedValue(new Error("db down"));
        const res = await post(alice);
        expect(res.statusCode).toBe(500);
        expect(res.body).toEqual({ error: "Server error" });
    });
});

// -----------------------------------------------------------------------------
// PATCH /api/poem-marks/:id
// -----------------------------------------------------------------------------
describe("PATCH /api/poem-marks/:id", () => {
    const patch = (auth, body = { content: "  edited  " }, id = 9) => {
        const r = request(app).patch(`/api/poem-marks/${id}`).send(body);
        return auth ? r.set("Authorization", auth) : r;
    };

    beforeEach(() => {
        marksModel.findById.mockResolvedValue(markRow({ kind: "note", color: null, content: "old" }));
        marksModel.updateContent.mockImplementation(async (id, content) => markRow({ id, kind: "note", color: null, content }));
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
        expect(res.body).toEqual({ error: "You can only edit your own mark" });
        expect(marksModel.updateContent).not.toHaveBeenCalled();
    });

    test("400 on a highlight (only notes have content)", async () => {
        marksModel.findById.mockResolvedValue(markRow());
        const res = await patch(alice);
        expect(res.statusCode).toBe(400);
        expect(res.body).toEqual({ error: "Only notes can be edited" });
    });

    test.each([["missing", {}], ["blank", { content: "  " }], ["too long", { content: "a".repeat(501) }]])(
        "400 when content is %s", async (_label, body) => {
            const res = await patch(alice, body);
            expect(res.statusCode).toBe(400);
            expect(res.body).toEqual({ error: "content must be 1-500 characters" });
        });

    test("200 updates my note (trimmed)", async () => {
        const res = await patch(alice);
        expect(res.statusCode).toBe(200);
        expect(marksModel.updateContent).toHaveBeenCalledWith(9, "edited");
        expect(res.body).toMatchObject({ id: 9, kind: "note", content: "edited" });
    });
});

// -----------------------------------------------------------------------------
// DELETE /api/poem-marks/:id
// -----------------------------------------------------------------------------
describe("DELETE /api/poem-marks/:id", () => {
    const del = (auth, id = 9) => {
        const r = request(app).delete(`/api/poem-marks/${id}`);
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
        marksModel.findById.mockResolvedValue(markRow({ kind }));
        const res = await del(alice);
        expect(res.statusCode).toBe(204);
        expect(marksModel.deleteMark).toHaveBeenCalledWith(9);
    });
});

// -----------------------------------------------------------------------------
// GET /api/rooms/:id/today — poem_marks next to the existing fields
// -----------------------------------------------------------------------------
describe("GET /api/rooms/:id/today poem_marks", () => {
    test("200 keeps poem / memos / annotations and adds poem_marks", async () => {
        const poem = { id: TODAY_POEM, title: "Stopping by Woods", author: "Frost", linecount: 5, lines: [] };
        const memos = [{ id: 1, content: "memo" }];
        const annotations = [{ id: 2, line_id: 11, line_number: 1, content: "old note" }];
        const marks = [markRow(), markRow({ id: 10, kind: "note", color: null, content: "n" })];
        poemsModel.findPoemWithLines.mockResolvedValue(poem);
        memosModel.listForRoomPoem.mockResolvedValue(memos);
        poemsModel.listAnnotationsForRoomPoem.mockResolvedValue(annotations);
        marksModel.listForRoomPoem.mockResolvedValue(marks);

        const res = await request(app).get("/api/rooms/5/today").set("Authorization", alice);

        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual({
            room: { id: 5, name: "poem-club" },
            date: require("../../lib/dates").today(),
            poem,
            memos,
            annotations,
            poem_marks: marks,
        });
        expect(marksModel.listForRoomPoem).toHaveBeenCalledWith(5, TODAY_POEM);
    });
});
