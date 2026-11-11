// controllers/streakController.js
// Reading streak ("다 읽었어요"). Dates are Korea calendar days (lib/dates.js).
//
//   GET  /api/streak               my streak
//   POST /api/streak/checkin       mark today as read, then my streak
//   GET  /api/rooms/:id/streaks    every member's streak (friends view)
//
// Response for /api/streak and /checkin (matches public/streak.js):
//   { current, longest, checkedInToday, week: ["2026-11-09", ...] }

const model = require("../models/streakModel");
const roomsModel = require("../models/roomsModel");
const { today } = require("../lib/dates");

function parseId(raw) {
    const n = Number(raw);
    return Number.isInteger(n) && n > 0 ? n : null;
}

// GET /api/streak
async function getMyStreak(req, res) {
    try {
        res.set("Cache-Control", "no-store");
        return res.status(200).json(await model.getSummary(req.user.id, today()));
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Server error" });
    }
}

// POST /api/streak/checkin  (idempotent: a second check-in today changes nothing)
async function checkIn(req, res) {
    try {
        const date = today();
        await model.checkIn(req.user.id, date);
        res.set("Cache-Control", "no-store");
        return res.status(200).json(await model.getSummary(req.user.id, date));
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Server error" });
    }
}

// GET /api/rooms/:id/streaks  (members only)
async function getRoomStreaks(req, res) {
    try {
        const room_id = parseId(req.params.id);
        if (!room_id) return res.status(400).json({ error: "invalid room id" });

        const room = await roomsModel.findById(room_id);
        if (!room) return res.status(404).json({ error: "Room not found" });

        const isMember = await roomsModel.isMember(room_id, req.user.id);
        if (!isMember) return res.status(403).json({ error: "You are not a member of this room" });

        const date = today();
        const members = await model.listForRoom(room_id, date);
        res.set("Cache-Control", "no-store");
        return res.status(200).json({ date, members });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Server error" });
    }
}

module.exports = { getMyStreak, checkIn, getRoomStreaks };
