// Poem marks (v1.1): highlights and notes on a word range of a room's poem.
//
// GET    /api/rooms/:id/poems/:poemId/marks   every mark on that poem in this room (oldest first);
//                                             any poem the room has been given (any date)
// POST   /api/rooms/:id/poems/:poemId/marks   create a highlight or a note; today's poem only
// PATCH  /api/poem-marks/:id                  edit my note's content
// DELETE /api/poem-marks/:id                  delete my mark
//
// Same body rules and response shape as book marks (lib/markInput.js).
// The older line_annotations API is kept unchanged alongside this one.

const { today } = require("../lib/dates"); // Korea (Asia/Seoul) calendar date
const model = require("../models/poemMarksModel");
const poemsModel = require("../models/poemsModel");
const roomsModel = require("../models/roomsModel");
const { checkMarkBody, noteContent } = require("../lib/markInput");
const { parseId } = require("../lib/parseId");

// helper: parse a path param and validate it as a positive integer


// helper: valid ids + room exists + caller is a member (same order/messages as annotationsController)
// returns { room_id, poem_id }, or null after sending the error response
async function loadRoomPoem(req, res) {
    const room_id = parseId(req.params.id);
    if (!room_id) {
        res.status(400).json({ error: "invalid room id" });
        return null;
    }
    const poem_id = parseId(req.params.poemId);
    if (!poem_id) {
        res.status(400).json({ error: "invalid poem id" });
        return null;
    }
    // both reads at once: one DB round trip instead of two (same answers and order)
    const [room, isMember] = await Promise.all([
        roomsModel.findById(room_id),
        roomsModel.isMember(room_id, req.user.id),
    ]);
    if (!room) {
        res.status(404).json({ error: "Room not found" });
        return null;
    }
    if (!isMember) {
        res.status(403).json({ error: "You are not a member of this room" });
        return null;
    }
    return { room_id, poem_id };
}

// [GET] /api/rooms/:id/poems/:poemId/marks
async function listMarks(req, res) {
    try {
        const ctx = await loadRoomPoem(req, res);
        if (!ctx) return;

        // any poem this room has been given, on any date
        const seen = await poemsModel.roomHasSeenPoem(ctx.room_id, ctx.poem_id);
        if (!seen) return res.status(404).json({ error: "Poem not found in this room" });

        const marks = await model.listForRoomPoem(ctx.room_id, ctx.poem_id);
        res.set("Cache-Control", "no-store");
        res.status(200).json(marks);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error" });
    }
}

// [POST] /api/rooms/:id/poems/:poemId/marks
// body { kind, color?, startLine, startWord, endLine, endWord, quote, content? }
// highlight: color required, content ignored; note: content required, color ignored
async function createMark(req, res) {
    try {
        const ctx = await loadRoomPoem(req, res);
        if (!ctx) return;

        // only today's poem can be marked (same "today" as line annotations)
        const todayPoemId = await poemsModel.getTodayPoemId(ctx.room_id, today());
        if (todayPoemId !== ctx.poem_id) {
            return res.status(404).json({ error: "Poem is not this room's poem today" });
        }

        const body = req.body || {};
        const { startLine, startWord, endLine, endWord } = body;

        const checked = checkMarkBody(body, {
            intFields: ["startLine", "startWord", "endLine", "endWord"],
            start: ["startLine", "startWord"],
            end: ["endLine", "endWord"],
        });
        if (checked.error) return res.status(400).json({ error: checked.error });
        const { kind, color, quote, content } = checked;

        // both ends must be lines of this poem
        const found = await model.findLineNumbers(ctx.poem_id, [startLine, endLine]);
        if (!found.includes(startLine) || !found.includes(endLine)) {
            return res.status(400).json({ error: "startLine and endLine must be lines of this poem" });
        }

        const mark = await model.createMark({
            room_id: ctx.room_id,
            poem_id: ctx.poem_id,
            user_id: req.user.id,
            kind,
            color,
            start_line: startLine,
            start_word: startWord,
            end_line: endLine,
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
// [PATCH] /api/poem-marks/:id   body { content }
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

        const content = noteContent((req.body || {}).content);
        if (content === null) return res.status(400).json({ error: "content must be 1-500 characters" });

        const updated = await model.updateContent(mark_id, content);
        res.status(200).json(updated);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error" });
    }
}

// delete a mark (author only)
// [DELETE] /api/poem-marks/:id
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
