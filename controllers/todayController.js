// GET /api/rooms/:id/today - Assigns TODAY'S POEM
// 1. Returns today's poem + its full-poem memos + its line annotations + its poem marks for an authenticated room member.
// 1b. Opening today's poem records today as read for the reading streak.
// 2. If the room has no poem for today, fetches a fresh (room-unseen) poem live from PoetryDB, caches it, assigns it to the room for today, and returns it.

// Source order: live PoetryDB -> data/poems.json fallback pool -> 503 (never a duplicate).
// Never assigns a poem this room has already seen (any date); on exhaustion -> 503.

const { today, isValidDate } = require("../lib/dates"); // Korea (Asia/Seoul) calendar date
const poemsModel = require("../models/poemsModel");
const roomsModel = require("../models/roomsModel");
const memosModel = require("../models/memosModel");
const poemMarksModel = require("../models/poemMarksModel");
const streakModel = require("../models/streakModel");
const { parseId } = require("../lib/parseId");


const LIVE_RETRIES = 5;
const MIN_LINES = 4;
const MAX_LINES = 30;

///////////////////////////////////////////helpers/////////////////////////////////////////////

// acceptable poem = an array of lines with 4-30 non-empty lines.
function isAcceptablePoem(poem) {
    if (!poem || !Array.isArray(poem.lines)) return false;
    const count = poem.lines.filter((l) => l && l.trim().length > 0).length;
    return count >= MIN_LINES && count <= MAX_LINES;
}

// CASE1: fetching from poetryDB
// fetch one random poem from PoetryDB. Returns a poem object {title, author, lines}
// null; any type of failure (non-ok, timeout, network error, or PoetryDB error shape).

// moved to lib/poemFetch
const { fetchRandomFromApi } = require("../lib/poemFetch");

// CASE2: fallback; fetching from backup json file
// pick a random acceptable, room-unseen poem from the offline fallback pool.
// returns a poem object or null if the pool all used for this room.
function pickFromFallbackPool(roomSeen) {
    const pool = require("../data/poems.json");
    const candidates = pool.filter((p) => isAcceptablePoem(p) && !roomSeen(p));
    if (candidates.length === 0) return null;
    return candidates[Math.floor(Math.random() * candidates.length)];
}

// Final function: CASE1 + CASE2
// get a fresh poem: try live first (re-roll on wrong length / already-seen),
// then fall back to the offline pool. roomSeen(poem) -> boolean.
// returns a poem object, or null if both sources are exhausted for this room.
async function getCandidatePoem(roomSeen) {
    for (let i = 0; i < LIVE_RETRIES; i++) {
        const poem = await fetchRandomFromApi();
        if (!poem) break;                    // cannot get from live -> go straight to fallback
        if (!isAcceptablePoem(poem)) continue; // wrong length -> re-roll
        if (roomSeen(poem)) continue;          // room already saw it -> re-roll
        return poem;                           // fresh + acceptable
    }
    return pickFromFallbackPool(roomSeen); // all fails; go to fallback
}

////////////////////////////////////////////////////////////////////////////////////////////////////////////



// GET /api/rooms/:id/today[?checkin=0]
// ?checkin=0: just the poem, no streak check-in. The home screen uses it to draw
// the cover; only opening the reading screen counts as reading today's poem.
async function getToday(req, res) {
    try {
        const room_id = parseId(req.params.id);
        if (!room_id) return res.status(400).json({ error: "invalid room id" });

        // permission checks (same order/messages as memosController) and today's poem id,
        // all reads, at once: one DB round trip instead of three
        const date = today();
        const [room, isMember, todayPoemId] = await Promise.all([
            roomsModel.findById(room_id),
            roomsModel.isMember(room_id, req.user.id),
            poemsModel.getTodayPoemId(room_id, date),
        ]);
        if (!room) return res.status(404).json({ error: "Room not found" });
        if (!isMember) return res.status(403).json({ error: "You are not a member of this room" });

        // assign today's poem if the room doesn't have one yet
        let poem_id = todayPoemId;
        if (!poem_id) {

            const key = ({ title, author }) => JSON.stringify([title, author]);
            const seen = new Set((await poemsModel.listSeenPoems(room_id)).map(key));
            const roomSeen = (poem) => seen.has(key(poem));

            const candidate = await getCandidatePoem(roomSeen);
            if (!candidate) {
                return res.status(503).json({ error: "Couldn't get a fresh poem right now, please try again" });
            }
            poem_id = await poemsModel.findOrCreatePoem(candidate);        // cache only the chosen poem
            poem_id = await poemsModel.assignPoemToRoom(room_id, poem_id, date); // race-safe; returns winner on clash
        }

        // independent reads -> run in parallel (saves DB round trips).
        // Opening today's poem also counts as reading it today (streak check-in),
        // unless the caller only wants to show it (?checkin=0, the home cover).
        // A failed check-in must never break the poem itself, so it only logs.
        const checkIn = req.query.checkin !== "0";
        const [poem, memos, annotations, poem_marks] = await Promise.all([
            poemsModel.findPoemWithLines(poem_id),
            memosModel.listForRoomPoem(room_id, poem_id, req.user.id),
            poemsModel.listAnnotationsForRoomPoem(room_id, poem_id),
            poemMarksModel.listForRoomPoem(room_id, poem_id),
            Promise.resolve()
                .then(() => (checkIn ? streakModel.checkIn(req.user.id, date) : null))
                .catch((err) => console.error("Streak check-in failed:", err)),
            Promise.resolve()
                .then(() => (checkIn ? roomsModel.markOpened(room_id, req.user.id) : null))   // room order
                .catch((err) => console.error("Marking the room opened failed:", err)),
        ]);

        res.set("Cache-Control", "no-store"); // GET has side effects + data changes; don't cache
        return res.status(200).json({
            room: { id: room.id, name: room.name },
            date,
            poem,
            memos,
            annotations,      // line_annotations (older app builds)
            poem_marks,       // word-range highlights + notes (v1.1)
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Server error" });
    }
}

async function getHistory(req, res) {
    try {
        const room_id = parseId(req.params.id);
        if (!room_id) return res.status(400).json({ error: "invalid room id" });

        // both permission checks at once (one DB round trip); the heavy list only after them
        const [room, isMember] = await Promise.all([
            roomsModel.findById(room_id),
            roomsModel.isMember(room_id, req.user.id),
        ]);
        if (!room) return res.status(404).json({ error: "Room not found" });
        if (!isMember) return res.status(403).json({ error: "You are not a member of this room" });

        const history = await poemsModel.listRoomHistory(room_id);
        return res.status(200).json({ room: { id: room.id, name: room.name }, history });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Server error" });
    }
}

// GET /api/rooms/:id/history/:date  - one past day's poem, READ-ONLY.
// Same shape as /today, but never assigns a poem: 404 if the room had none that day.
// Writing (memos, annotations, marks) stays limited to today's poem elsewhere.
async function getPoemOnDate(req, res) {
    try {
        const room_id = parseId(req.params.id);
        if (!room_id) return res.status(400).json({ error: "invalid room id" });

        const date = req.params.date;
        if (!isValidDate(date)) return res.status(400).json({ error: "date must be YYYY-MM-DD" });
        if (date > today()) return res.status(400).json({ error: "date is in the future" });

        const [room, isMember] = await Promise.all([
            roomsModel.findById(room_id),
            roomsModel.isMember(room_id, req.user.id),
        ]);
        if (!room) return res.status(404).json({ error: "Room not found" });
        if (!isMember) return res.status(403).json({ error: "You are not a member of this room" });

        const poem_id = await poemsModel.getTodayPoemId(room_id, date); // poem assigned on `date`
        if (!poem_id) return res.status(404).json({ error: "No poem for this room on that date" });

        const [poem, memos, annotations, poem_marks] = await Promise.all([
            poemsModel.findPoemWithLines(poem_id),
            memosModel.listForRoomPoem(room_id, poem_id, req.user.id),
            poemsModel.listAnnotationsForRoomPoem(room_id, poem_id),
            poemMarksModel.listForRoomPoem(room_id, poem_id),
        ]);

        res.set("Cache-Control", "no-store");
        return res.status(200).json({
            room: { id: room.id, name: room.name },
            date,
            readOnly: true,
            poem,
            memos,
            annotations,
            poem_marks,
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Server error" });
    }
}

module.exports = { getToday, getHistory, getPoemOnDate };