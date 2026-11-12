const express = require("express");
const controller = require("../controllers/booksController");
const historyController = require("../controllers/bookHistoryController");
const { authenticate } = require("../middleware/authMiddleware");

// Router mounted at /api/books — the shared book catalogue.
// GET /api/books   GET /api/books/shelf   GET /api/books/search?q=
const booksRouter = express.Router();
booksRouter.use(authenticate);
booksRouter.get("/", controller.listBooks);
booksRouter.get("/shelf", controller.getShelf);
booksRouter.get("/search", controller.searchBooks);

// Router mounted at /api/rooms — the book a room is reading.
// authenticate is attached per route (not router.use) so other /api/rooms/* requests
// passing through this router don't run an extra auth lookup.
// GET /api/rooms/:id/book   PUT /api/rooms/:id/book   PUT /api/rooms/:id/book/progress
// GET /api/rooms/:id/books/history
const roomBooksRouter = express.Router();
roomBooksRouter.get("/:id/book", authenticate, controller.getRoomBook);
roomBooksRouter.put("/:id/book", authenticate, controller.setRoomBook);
roomBooksRouter.put("/:id/book/progress", authenticate, controller.updateProgress);
roomBooksRouter.get("/:id/books/history", authenticate, historyController.getRoomBookHistory); // History · 소설 탭

module.exports = { booksRouter, roomBooksRouter };
