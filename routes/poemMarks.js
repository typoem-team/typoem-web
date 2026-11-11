const express = require("express");
const controller = require("../controllers/poemMarksController");
const { authenticate } = require("../middleware/authMiddleware");

// Router mounted at /api/rooms — marks on a poem of the room.
// authenticate is attached per route (same reason as routes/books.js).
// GET /api/rooms/:id/poems/:poemId/marks   POST /api/rooms/:id/poems/:poemId/marks
const roomPoemMarksRouter = express.Router();
roomPoemMarksRouter.get("/:id/poems/:poemId/marks", authenticate, controller.listMarks);
roomPoemMarksRouter.post("/:id/poems/:poemId/marks", authenticate, controller.createMark);

// Router mounted at /api/poem-marks — a mark by its own id.
// PATCH /api/poem-marks/:id   DELETE /api/poem-marks/:id
const poemMarksRouter = express.Router();
poemMarksRouter.use(authenticate);
poemMarksRouter.patch("/:id", controller.updateMark);
poemMarksRouter.delete("/:id", controller.deleteMark);

module.exports = { roomPoemMarksRouter, poemMarksRouter };
