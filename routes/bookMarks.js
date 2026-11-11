const express = require("express");
const controller = require("../controllers/bookMarksController");
const { authenticate } = require("../middleware/authMiddleware");

// Router mounted at /api/rooms — marks on the room's current book.
// authenticate is attached per route (same reason as routes/books.js).
// GET /api/rooms/:id/book/marks?chapter=N   POST /api/rooms/:id/book/marks
const roomBookMarksRouter = express.Router();
roomBookMarksRouter.get("/:id/book/marks", authenticate, controller.listMarks);
roomBookMarksRouter.post("/:id/book/marks", authenticate, controller.createMark);

// Router mounted at /api/book-marks — a mark by its own id.
// PATCH /api/book-marks/:id   DELETE /api/book-marks/:id
const bookMarksRouter = express.Router();
bookMarksRouter.use(authenticate);
bookMarksRouter.patch("/:id", controller.updateMark);
bookMarksRouter.delete("/:id", controller.deleteMark);

module.exports = { roomBookMarksRouter, bookMarksRouter };
