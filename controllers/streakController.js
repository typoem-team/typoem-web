// controllers/streakController.js
// Reading streak ("다 읽었어요"). Dates are Korea calendar days (lib/dates.js).
//
//   GET  /api/streak               my streak
//   GET  /api/streak?month=YYYY-MM my streak + the days I read in that month (calendar)
//   POST /api/streak/checkin       mark today as read, then my streak
//   GET  /api/rooms/:id/streaks    every member's streak (friends view)
//
// Response for /api/streak and /checkin (matches public/streak.js):
//   { current, longest, checkedInToday, week: ["2026-11-09", ...] }
// With ?month=2026-11 it also has
//   month: "2026-11", days: ["2026-11-01", "2026-11-09", ...]   (ascending)

const model = require("../models/streakModel");
const roomsModel = require("../models/roomsModel");
const { today, isValidMonth, monthRange } = require("../lib/dates");

function parseId(raw) {
    const n = Number(raw);
    return Number.isInteger(n) && n > 0 ? n : null;
}

// GET /api/streak[?month=YYYY-MM]
async function getMyStreak(req, res) {
    try {
        const { month } = req.query;
        if (month !== undefined && !isValidMonth(month)) {
            return res.status(400).json({ error: "month must be YYYY-MM" });
        }
        const summary = await model.getSummary(req.user.id, today());
        res.set("Cache-Control", "no-store");
        if (month === undefined) return res.status(200).json(summary);

        const { first, last } = monthRange(month);
        const days = await model.datesBetween(req.user.id, first, last);
        return res.status(200).json({ ...summary, month, days });
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

        // both reads at once: one DB round trip instead of two (404 is still checked before 403)
        const [room, isMember] = await Promise.all([
            roomsModel.findById(room_id),
            roomsModel.isMember(room_id, req.user.id),
        ]);
        if (!room) return res.status(404).json({ error: "Room not found" });
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
