const model = require("../models/roomsModel");
const { today } = require("../lib/dates"); // Korea (Asia/Seoul) calendar date

// per-user room limits (fixed server policy)
const MAX_OWNED_ROOMS = 3;
const MAX_JOINED_ROOMS = 5;

// helper: parse ':id' path param and validate
function parseId(raw) {
    const id = Number(raw);
    if (!Number.isInteger(id) || id <= 0) return null;
    return id;
}

// create a room
// [POST] /api/rooms
async function createRoom(req, res) {
    try {
        const { name, description } = req.body;

        // constraints
        if (!name) return res.status(400).json({ error: "name required" }); // exists
        if (typeof name !== "string" || name.length < 1 || name.length > 50) return res.status(400).json({ error: "name must be 1-50 characters" });
        if (description !== undefined && description !== null) {
            if (typeof description !== "string" || description.length > 200) return res.status(400).json({ error: "description must be 0-200 characters" });
        }

        // enforce per-user room limits
        const owned = await model.countOwnedRooms(req.user.id);
        if (owned >= MAX_OWNED_ROOMS) return res.status(403).json({ error: `You can own at most ${MAX_OWNED_ROOMS} rooms` });

        const joined = await model.countMemberships(req.user.id);
        if (joined >= MAX_JOINED_ROOMS) return res.status(403).json({ error: `You can be in at most ${MAX_JOINED_ROOMS} rooms` });

        const room = await model.createRoom({
            name,
            description: description ?? null, // handle ull, undefined etc. as 'null'
            owner_id: req.user.id
        });
        res.status(201).json(room);
    } catch (err) {
        if (err instanceof model.InviteCodeGenerationError) {
            return res.status(500).json({ error: "Could not generate a unique invite code, please try again" });
        }
        console.error(err);
        res.status(500).json({ error: "Server error" });
    }
}

// list rooms the current user belongs to
// [GET] /api/rooms/mine
async function listMyRooms(req, res) {
    try {
        const rooms = await model.listRoomsForUser(req.user.id, today());
        res.status(200).json(rooms);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error" });
    }
}

// join a room by invite code
// [POST] /api/rooms/join
async function joinRoom(req, res) {
    try {
        const { invite_code } = req.body;
        if (!invite_code) return res.status(400).json({ error: "invite_code required" });
        if (typeof invite_code !== "string") return res.status(400).json({ error: "invite_code must be a string" });

        const room = await model.findByInviteCode(invite_code);

        // enforce membership limit (owned rooms count toward this)
        const joined = await model.countMemberships(req.user.id);
        if (joined >= MAX_JOINED_ROOMS) return res.status(403).json({ error: `You can be in at most ${MAX_JOINED_ROOMS} rooms` });

        if (!room) return res.status(404).json({ error: "Room not found" });

        await model.addMember({ room_id: room.id, user_id: req.user.id, role: "member" });
        res.status(201).json({
            id: room.id,
            name: room.name,
            description: room.description,
            invite_code: room.invite_code,
            owner_id: room.owner_id
        });
    } catch (err) {
        if (err instanceof model.AlreadyMemberError) {
            return res.status(409).json({ error: "You are already a member of this room" });
        }
        console.error(err);
        res.status(500).json({ error: "Server error" });
    }
}

// list members of a room
// [GET] /api/rooms/:id/members
async function getMembers(req, res) {
    try {
        const room_id = parseId(req.params.id);
        if (!room_id) return res.status(400).json({ error: "invalid room id" });

        const room = await model.findById(room_id);
        if (!room) return res.status(404).json({ error: "Room not found" });

        const isMember = await model.isMember(room_id, req.user.id);
        if (!isMember) return res.status(403).json({ error: "You are not a member of this room" });

        const members = await model.listMembers(room_id);
        res.status(200).json(members);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error" });
    }
}

// delete a room (owner only)
// [DELETE] /api/rooms/:id
async function deleteRoom(req, res) {
    try {
        const room_id = parseId(req.params.id);
        if (!room_id) return res.status(400).json({ error: "invalid room id" });

        const room = await model.findById(room_id);
        if (!room) return res.status(404).json({ error: "Room not found" });
        if (room.owner_id !== req.user.id) return res.status(403).json({ error: "Only the owner can delete this room" });

        await model.deleteRoom(room_id);
        res.status(204).end();
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error" });
    }
}

// leave a room (non-owner members)
// [DELETE] /api/rooms/:id/leave
async function leaveRoom(req, res) {
    try {
        const room_id = parseId(req.params.id);
        if (!room_id) return res.status(400).json({ error: "invalid room id" });

        const room = await model.findById(room_id);
        if (!room) return res.status(404).json({ error: "Room not found" });

        if (room.owner_id === req.user.id) return res.status(400).json({ error: "Owner cannot leave the room; delete it instead" });

        const isMember = await model.isMember(room_id, req.user.id);
        if (!isMember) return res.status(403).json({ error: "You are not a member of this room" });

        await model.removeMember(room_id, req.user.id);
        res.status(204).end();
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error" });
    }
}

// pick a room for the home screen (Rooms tab -> tap a room)
// [POST] /api/rooms/:id/open -> 204
// Records the room as the one I opened last, so the home shows it (on any device).
async function openRoom(req, res) {
    try {
        const room_id = parseId(req.params.id);
        if (!room_id) return res.status(400).json({ error: "invalid room id" });

        const [room, isMember] = await Promise.all([
            model.findById(room_id),
            model.isMember(room_id, req.user.id),
        ]);
        if (!room) return res.status(404).json({ error: "Room not found" });
        if (!isMember) return res.status(403).json({ error: "You are not a member of this room" });

        await model.markOpened(room_id, req.user.id);
        return res.status(204).end();
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Server error" });
    }
}

module.exports = { createRoom, listMyRooms, joinRoom, getMembers, deleteRoom, leaveRoom, openRoom };