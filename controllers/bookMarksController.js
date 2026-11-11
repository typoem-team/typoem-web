// Book marks (v1.1): highlights and notes on the room's current book.
//
// GET    /api/rooms/:id/book/marks?chapter=N   every mark in chapter N (oldest first)
// POST   /api/rooms/:id/book/marks             create a highlight or a note
// PATCH  /api/book-marks/:id                   edit my note's content
// DELETE /api/book-marks/:id                   delete my mark
//
// Marks always belong to the room's book at the time they were made; listing and creating
// use the room's current book, so marks on an earlier book stay in the DB but are not shown.

const model = require("../models/bookMarksModel");
const booksModel = require("../models/booksModel");
const roomsModel = require("../models/roomsModel");

const KINDS = ["highlight", "note"];

// helper: parse ':id' path param and validate (same as roomsController)
function parseId(raw) {
    const id = Number(raw);
    if (!Number.isInteger(id) || id <= 0) return null;
    return id;
}

// helper: non-negative integer from a query string ("0", "12"), else null
function parseIndex(raw) {
    if (typeof raw !== "string" || !/^\d+$/.test(raw)) return null;
    const n = Number(raw);
    return Number.isSafeInteger(n) ? n : null;
}

// helper: non-negative integer in a JSON body
function isIndex(n) {
    return Number.isSafeInteger(n) && n >= 0;
}

// helper: trimmed string of min..max characters, else null
function textOf(raw, min, max) {
    if (typeof raw !== "string") return null;
    const t = raw.trim();
    return t.length >= min && t.length <= max ? t : null;
}

// helper: room exists + caller is a member + room has a book (same messages as booksController)
// returns { room, rb }, or null after sending the error response
async function loadRoomBook(req, res) {
    const room_id = parseId(req.params.id);
    if (!room_id) {
        res.status(400).json({ error: "invalid room id" });
        return null;
    }
    const room = await roomsModel.findById(room_id);
    if (!room) {
        res.status(404).json({ error: "Room not found" });
        return null;
    }
    const isMember = await roomsModel.isMember(room_id, req.user.id);
    if (!isMember) {
        res.status(403).json({ error: "You are not a member of this room" });
        return null;
    }
    const rb = await booksModel.getRoomBook(room_id);
    if (!rb) {
        res.status(404).json({ error: "No book assigned to this room" });
        return null;
    }
    return { room, rb };
}

// [GET] /api/rooms/:id/book/marks?chapter=N
async function listMarks(req, res) {
    try {
        const ctx = await loadRoomBook(req, res);
        if (!ctx) return;

        const chapterIdx = parseIndex(req.query.chapter);
        if (chapterIdx === null) return res.status(400).json({ error: "chapter must be a non-negative integer" });

        const chapters = await booksModel.getChapters(ctx.rb.book_id);
        if (!chapters.some((c) => c.idx === chapterIdx)) return res.status(404).json({ error: "Chapter not found" });

        const marks = await model.listForChapter(ctx.room.id, ctx.rb.book_id, chapterIdx);
        res.set("Cache-Control", "no-store");
        res.status(200).json(marks);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error" });
    }
}

// [POST] /api/rooms/:id/book/marks
// body { kind, chapterIdx, startPara, startWord, endPara, endWord, quote, content? }
async function createMark(req, res) {
    try {
        const ctx = await loadRoomBook(req, res);
        if (!ctx) return;

        const body = req.body || {};
        const { kind, chapterIdx, startPara, startWord, endPara, endWord } = body;

        if (!KINDS.includes(kind)) return res.status(400).json({ error: "kind must be 'highlight' or 'note'" });
        if (![chapterIdx, startPara, startWord, endPara, endWord].every(isIndex)) {
            return res.status(400).json({ error: "chapterIdx, startPara, startWord, endPara, endWord must be non-negative integers" });
        }
        if (startPara > endPara || (startPara === endPara && startWord > endWord)) {
            return res.status(400).json({ error: "start must not be after end" });
        }
        const quote = textOf(body.quote, 1, 1000);
        if (quote === null) return res.status(400).json({ error: "quote must be 1-1000 characters" });

        // a note needs content; a highlight never stores any
        let content = null;
        if (kind === "note") {
            content = textOf(body.content, 1, 500);
            if (content === null) return res.status(400).json({ error: "content must be 1-500 characters" });
        }

        // both ends must be paragraphs of chapter chapterIdx in the room's book
        const found = await model.findParagraphChapters(ctx.rb.book_id, [startPara, endPara]);
        const inChapter = (idx) => found.some((p) => p.idx === idx && p.chapter_idx === chapterIdx);
        if (!inChapter(startPara) || !inChapter(endPara)) {
            return res.status(400).json({ error: "startPara and endPara must be paragraphs of chapter chapterIdx" });
        }

        const mark = await model.createMark({
            room_id: ctx.room.id,
            book_id: ctx.rb.book_id,
            user_id: req.user.id,
            kind,
            chapter_idx: chapterIdx,
            start_para: startPara,
            start_word: startWord,
            end_para: endPara,
            end_word: endWord,
            quote,
            content,
        });
        res.status(201).json(mark);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error" });
    }
}

// edit a note's content (author only; highlights have no content)
// [PATCH] /api/book-marks/:id   body { content }
async function updateMark(req, res) {
    try {
        const mark_id = parseId(req.params.id);
        if (!mark_id) return res.status(400).json({ error: "invalid mark id" });

        const mark = await model.findById(mark_id);
        if (!mark) return res.status(404).json({ error: "Mark not found" });

        if (mark.user_id !== req.user.id) {
            return res.status(403).json({ error: "You can only edit your own mark" });
        }
        if (mark.kind !== "note") {
            return res.status(400).json({ error: "Only notes can be edited" });
        }

        const content = textOf((req.body || {}).content, 1, 500);
        if (content === null) return res.status(400).json({ error: "content must be 1-500 characters" });

        const updated = await model.updateContent(mark_id, content);
        res.status(200).json(updated);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error" });
    }
}

// delete a mark (author only)
// [DELETE] /api/book-marks/:id
async function deleteMark(req, res) {
    try {
        const mark_id = parseId(req.params.id);
        if (!mark_id) return res.status(400).json({ error: "invalid mark id" });

        const mark = await model.findById(mark_id);
        if (!mark) return res.status(404).json({ error: "Mark not found" });

        if (mark.user_id !== req.user.id) {
            return res.status(403).json({ error: "You can only delete your own mark" });
        }

        await model.deleteMark(mark_id);
        res.status(204).end();
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error" });
    }
}

module.exports = { listMarks, createMark, updateMark, deleteMark };
