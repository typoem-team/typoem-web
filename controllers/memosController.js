const { today } = require("../lib/dates"); // Korea (Asia/Seoul) calendar date
const model = require("../models/memosModel");
const roomsModel = require("../models/roomsModel");

// helper: parse ':id' path param and validate (same as roomsController)
function parseId(raw) {
    const id = Number(raw);
    if (!Number.isInteger(id) || id <= 0) return null;
    return id;
}


// create a memo on the room's poem of the day
// [POST] /api/rooms/:id/memos
// create a memo on the room's poem of the day
// [POST] /api/rooms/:id/memos
async function createMemo(req, res) {
    try {
        const room_id = parseId(req.params.id);
        if (!room_id) return res.status(400).json({ error: "invalid room id" });

        // must be a member of the room (check permission before validating input)
        const room = await roomsModel.findById(room_id);
        if (!room) return res.status(404).json({ error: "Room not found" });

        const isMember = await roomsModel.isMember(room_id, req.user.id);
        if (!isMember) return res.status(403).json({ error: "You are not a member of this room" });

        // validate content (trim so whitespace-only memos are rejected)
        const { content } = req.body;
        if (!content || typeof content !== "string") {
            return res.status(400).json({ error: "content required" });
        }
        const trimmed = content.trim();
        if (trimmed.length < 1 || trimmed.length > 1000) {
            return res.status(400).json({ error: "content must be 1-1000 characters" });
        }

        // find the room's poem for today
        const poem_id = await model.findTodayPoemId(room_id, today());
        if (!poem_id) return res.status(404).json({ error: "No poem assigned to this room today" });

        const memo = await model.createMemo({
            user_id: req.user.id,
            room_id,
            poem_id,
            content: trimmed,
        });
        res.status(201).json(memo);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error" });
    }
}

// list memos on the room's poem of the day
// [GET] /api/rooms/:id/memos
async function listMemos(req, res) {
    try {
        const room_id = parseId(req.params.id);
        if (!room_id) return res.status(400).json({ error: "invalid room id" });

        // must be a member of the room
        const room = await roomsModel.findById(room_id);
        if (!room) return res.status(404).json({ error: "Room not found" });

        const isMember = await roomsModel.isMember(room_id, req.user.id);
        if (!isMember) return res.status(403).json({ error: "You are not a member of this room" });

        // find today's poem; if none, there are simply no memos to show
        const poem_id = await model.findTodayPoemId(room_id, today());
        if (!poem_id) return res.status(200).json([]);

        const memos = await model.listForRoomPoem(room_id, poem_id, req.user.id);
        res.status(200).json(memos);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error" });
    }
}

// update a memo's content (author only)
// [PATCH] /api/memos/:id
async function updateMemo(req, res) {
    try {
        const memo_id = parseId(req.params.id);
        if (!memo_id) return res.status(400).json({ error: "invalid memo id" });

        const memo = await model.findById(memo_id, req.user.id);
        if (!memo) return res.status(404).json({ error: "Memo not found" });

        // only the author can edit
        if (memo.user_id !== req.user.id) {
            return res.status(403).json({ error: "You can only edit your own memo" });
        }

        // validate new content
        const { content } = req.body;
        if (!content || typeof content !== "string") {
            return res.status(400).json({ error: "content required" });
        }
        const trimmed = content.trim();
        if (trimmed.length < 1 || trimmed.length > 1000) {
            return res.status(400).json({ error: "content must be 1-1000 characters" });
        }

        const updated = await model.updateMemo(memo_id, trimmed, req.user.id);
        res.status(200).json(updated);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error" });
    }
}

// delete a memo (author only)
// [DELETE] /api/memos/:id
async function deleteMemo(req, res) {
    try {
        const memo_id = parseId(req.params.id);
        if (!memo_id) return res.status(400).json({ error: "invalid memo id" });

        const memo = await model.findById(memo_id, req.user.id);
        if (!memo) return res.status(404).json({ error: "Memo not found" });

        // only the author can delete
        if (memo.user_id !== req.user.id) {
            return res.status(403).json({ error: "You can only delete your own memo" });
        }

        await model.deleteMemo(memo_id);
        res.status(204).end();
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error" });
    }
}

// toggle a like on a memo
// [POST] /api/memos/:id/like
async function toggleLike(req, res) {
    try {
        const memo_id = parseId(req.params.id);
        if (!memo_id) return res.status(400).json({ error: "invalid memo id" });

        const memo = await model.findById(memo_id, req.user.id);
        if (!memo) return res.status(404).json({ error: "Memo not found" });

        // must be a member of the memo's room
        const isMember = await roomsModel.isMember(memo.room_id, req.user.id);
        if (!isMember) return res.status(403).json({ error: "You are not a member of this room" });

        const result = await model.toggleLike(memo_id, req.user.id);
        res.status(200).json(result);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error" });
    }
}

module.exports = { createMemo, listMemos, updateMemo, deleteMemo, toggleLike };