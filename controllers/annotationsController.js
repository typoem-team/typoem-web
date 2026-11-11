const { today } = require("../lib/dates"); // Korea (Asia/Seoul) calendar date
const model = require("../models/annotationsModel");
const roomsModel = require("../models/roomsModel");

// helper: parse a path param and validate it as a positive integer
function parseId(raw) {
    const id = Number(raw);
    if (!Number.isInteger(id) || id <= 0) return null;
    return id;
}


// create an annotation on a specific line of the room's poem of the day
// [POST] /api/rooms/:roomId/lines/:lineId/annotations
async function createAnnotation(req, res) {
    try {
        const room_id = parseId(req.params.roomId);
        if (!room_id) return res.status(400).json({ error: "invalid room id" });

        const line_id = parseId(req.params.lineId);
        if (!line_id) return res.status(400).json({ error: "invalid line id" });

        // must be a member of the room (check permission before validating input)
        const room = await roomsModel.findById(room_id);
        if (!room) return res.status(404).json({ error: "Room not found" });

        const isMember = await roomsModel.isMember(room_id, req.user.id);
        if (!isMember) return res.status(403).json({ error: "You are not a member of this room" });

        // validate content (trim so whitespace-only annotations are rejected)
        const { content } = req.body;
        if (!content || typeof content !== "string") {
            return res.status(400).json({ error: "content required" });
        }
        const trimmed = content.trim();
        if (trimmed.length < 1 || trimmed.length > 1000) {
            return res.status(400).json({ error: "content must be 1-1000 characters" });
        }

        // the line must belong to the room's poem of the day
        const line = await model.findLineForRoomDate(line_id, room_id, today());
        if (!line) return res.status(404).json({ error: "Line not found in this room's poem today" });

        // one annotation per user per line (UNIQUE constraint)
        const existing = await model.findByUserLine(line_id, room_id, req.user.id);
        if (existing) {
            return res.status(409).json({ error: "You already annotated this line" });
        }

        const annotation = await model.createAnnotation({
            line_id,
            room_id,
            user_id: req.user.id,
            content: trimmed,
        });
        res.status(201).json(annotation);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error" });
    }
}

// list annotations on a specific line within a room
// [GET] /api/rooms/:roomId/lines/:lineId/annotations
async function listAnnotations(req, res) {
    try {
        const room_id = parseId(req.params.roomId);
        if (!room_id) return res.status(400).json({ error: "invalid room id" });

        const line_id = parseId(req.params.lineId);
        if (!line_id) return res.status(400).json({ error: "invalid line id" });

        // must be a member of the room
        const room = await roomsModel.findById(room_id);
        if (!room) return res.status(404).json({ error: "Room not found" });

        const isMember = await roomsModel.isMember(room_id, req.user.id);
        if (!isMember) return res.status(403).json({ error: "You are not a member of this room" });

        const annotations = await model.listForLine(room_id, line_id);
        res.status(200).json(annotations);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error" });
    }
}

// update an annotation's content (author only)
// [PATCH] /api/annotations/:id
async function updateAnnotation(req, res) {
    try {
        const annotation_id = parseId(req.params.id);
        if (!annotation_id) return res.status(400).json({ error: "invalid annotation id" });

        const annotation = await model.findById(annotation_id);
        if (!annotation) return res.status(404).json({ error: "Annotation not found" });

        // only the author can edit
        if (annotation.user_id !== req.user.id) {
            return res.status(403).json({ error: "You can only edit your own annotation" });
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

        const updated = await model.updateAnnotation(annotation_id, trimmed);
        res.status(200).json(updated);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error" });
    }
}

// delete an annotation (author only)
// [DELETE] /api/annotations/:id
async function deleteAnnotation(req, res) {
    try {
        const annotation_id = parseId(req.params.id);
        if (!annotation_id) return res.status(400).json({ error: "invalid annotation id" });

        const annotation = await model.findById(annotation_id);
        if (!annotation) return res.status(404).json({ error: "Annotation not found" });

        // only the author can delete
        if (annotation.user_id !== req.user.id) {
            return res.status(403).json({ error: "You can only delete your own annotation" });
        }

        await model.deleteAnnotation(annotation_id);
        res.status(204).end();
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error" });
    }
}

module.exports = { createAnnotation, listAnnotations, updateAnnotation, deleteAnnotation };