const express = require("express");
const controller = require("../controllers/booksController");
const { authenticate } = require("../middleware/authMiddleware");

// Router mounted at /api/books — the shared book catalogue.
// GET /api/books   GET /api/books/search?q=
const booksRouter = express.Router();
booksRouter.use(authenticate);
booksRouter.get("/", controller.listBooks);
booksRouter.get("/search", controller.searchBooks);

// Router mounted at /api/rooms — the book a room is reading.
// authenticate is attached per route (not router.use) so other /api/rooms/* requests
// passing through this router don't run an extra auth lookup.
// GET /api/rooms/:id/book   PUT /api/rooms/:id/book   PUT /api/rooms/:id/book/progress
const roomBooksRouter = express.Router();
roomBooksRouter.get("/:id/book", authenticate, controller.getRoomBook);
roomBooksRouter.put("/:id/book", authenticate, controller.setRoomBook);
roomBooksRouter.put("/:id/book/progress", authenticate, controller.updateProgress);

module.exports = { booksRouter, roomBooksRouter };
