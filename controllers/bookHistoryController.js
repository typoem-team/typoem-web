// controllers/bookHistoryController.js
// GET /api/rooms/:id/books/history — the books this room has read (History · 소설 탭).
//
// Response: [{
//   book_id, title, author,
//   is_current,                          // the room's book right now
//   status: "reading" | "finished" | "paused",   // mine
//   progress,                            // my %, 0-100
//   last_read_at, finished_at,           // my last save; finished_at = that save if finished
//   my_mark_count,                       // my highlights + notes in this book, this room
//   readers: [{ id, nickname, progress, finished }]   // members who opened it, most read first
// }]
// Current book first, then the one I read most recently. Members only.

const model = require("../models/bookHistoryModel");
const roomsModel = require("../models/roomsModel");

function parseId(raw) {
    const n = Number(raw);
    return Number.isInteger(n) && n > 0 ? n : null;
}

async function getRoomBookHistory(req, res) {
    try {
        const room_id = parseId(req.params.id);
        if (!room_id) return res.status(400).json({ error: "invalid room id" });

        // both reads at once: one DB round trip instead of two (404 is still checked before 403)
        const [room, isMember] = await Promise.all([
            roomsModel.findById(room_id),
            roomsModel.isMember(room_id, req.user.id),
        ]);
        if (!room) return res.status(404).json({ error: "Room not found" });
        if (!isMember) return res.status(403).json({ error: "You are not a member of this room" });

        res.set("Cache-Control", "no-store");
        return res.status(200).json(await model.listForRoom(room_id, req.user.id));
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Server error" });
    }
}

module.exports = { getRoomBookHistory };
