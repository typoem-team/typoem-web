// GET /api/rooms/:id/today - Assigns TODAY'S POEM
// 1. Returns today's poem + its full-poem memos + its line annotations + its poem marks for an authenticated room member.
// 2. If the room has no poem for today, fetches a fresh (room-unseen) poem live from PoetryDB, caches it, assigns it to the room for today, and returns it.

// Source order: live PoetryDB -> data/poems.json fallback pool -> 503 (never a duplicate).
// Never assigns a poem this room has already seen (any date); on exhaustion -> 503.

const poemsModel = require("../models/poemsModel");
const roomsModel = require("../models/roomsModel");
const memosModel = require("../models/memosModel");
const poemMarksModel = require("../models/poemMarksModel");

// helpers copied from memosController/roomsController (for consistency)
function parseId(raw) {
    const id = Number(raw);
    if (!Number.isInteger(id) || id <= 0) return null;
    return id;
}
// today's date as YYYY-MM-DD (UTC).
// Should be same with memosController.today()
function today() {
    return new Date().toISOString().slice(0, 10);
}

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
async function pickFromFallbackPool(roomSeen) {
    const pool = require("../data/poems.json");
    const candidates = [];
    for (const p of pool) {
        if (!isAcceptablePoem(p)) continue;
        if (await roomSeen(p)) continue;
        candidates.push(p);
    }
    if (candidates.length === 0) return null;
    return candidates[Math.floor(Math.random() * candidates.length)];
}

// Final function: CASE1 + CASE2
// get a fresh poem: try live first (re-roll on wrong length / already-seen),
// then fall back to the offline pool. roomSeen(poem) is an async predicate.
// returns a poem object, or null if both sources are exhausted for this room.
async function getCandidatePoem(roomSeen) {
    for (let i = 0; i < LIVE_RETRIES; i++) {
        const poem = await fetchRandomFromApi();
        if (!poem) break;                    // cannot get from live -> go straight to fallback
        if (!isAcceptablePoem(poem)) continue; // wrong length -> re-roll
        if (await roomSeen(poem)) continue;    // room already saw it -> re-roll
        return poem;                           // fresh + acceptable
    }
    return await pickFromFallbackPool(roomSeen); // all fails; go to fallback
}

////////////////////////////////////////////////////////////////////////////////////////////////////////////



// GET /api/rooms/:id/today
async function getToday(req, res) {
    try {
        const room_id = parseId(req.params.id);
        if (!room_id) return res.status(400).json({ error: "invalid room id" });

        // permission checks (same order/messages as memosController)
        const room = await roomsModel.findById(room_id);
        if (!room) return res.status(404).json({ error: "Room not found" });

        const isMember = await roomsModel.isMember(room_id, req.user.id);
        if (!isMember) return res.status(403).json({ error: "You are not a member of this room" });

        const date = today();

        // assign today's poem if the room doesn't have one yet
        let poem_id = await poemsModel.getTodayPoemId(room_id, date);
        if (!poem_id) {

            const roomSeen = async ({ title, author }) => {
                const id = await poemsModel.findPoemByTitleAuthor(title, author);
                return id ? await poemsModel.roomHasSeenPoem(room_id, id) : false;
            };

            const candidate = await getCandidatePoem(roomSeen);
            if (!candidate) {
                return res.status(503).json({ error: "Couldn't get a fresh poem right now, please try again" });
            }
            poem_id = await poemsModel.findOrCreatePoem(candidate);        // cache only the chosen poem
            poem_id = await poemsModel.assignPoemToRoom(room_id, poem_id, date); // race-safe; returns winner on clash
        }

        const poem = await poemsModel.findPoemWithLines(poem_id);
        const memos = await memosModel.listForRoomPoem(room_id, poem_id, req.user.id);
        const annotations = await poemsModel.listAnnotationsForRoomPoem(room_id, poem_id);
        const poem_marks = await poemMarksModel.listForRoomPoem(room_id, poem_id);

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

        const room = await roomsModel.findById(room_id);
        if (!room) return res.status(404).json({ error: "Room not found" });

        const isMember = await roomsModel.isMember(room_id, req.user.id);
        if (!isMember) return res.status(403).json({ error: "You are not a member of this room" });

        const history = await poemsModel.listRoomHistory(room_id);
        return res.status(200).json({ room: { id: room.id, name: room.name }, history });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Server error" });
    }
}

module.exports = { getToday, getHistory };