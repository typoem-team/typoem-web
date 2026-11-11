const express = require("express");
const router = express.Router();
const controller = require("../controllers/roomsController");
const todayController = require("../controllers/todayController");
const streakController = require("../controllers/streakController");

const { authenticate } = require("../middleware/authMiddleware"); // for authentication

// add /rooms(prefix) in app.js
// all rooms routes require authentication
router.use(authenticate);

router.post("/", controller.createRoom);
router.get("/mine", controller.listMyRooms);
router.post("/join", controller.joinRoom);
router.get("/:id/members", controller.getMembers);
router.get("/:id/today", todayController.getToday); // today's poem + memos + annotations
router.get("/:id/history", todayController.getHistory); // past daily poems + contributors
router.get("/:id/history/:date", todayController.getPoemOnDate); // one past day, read-only
router.get("/:id/streaks", streakController.getRoomStreaks); // members' reading streaks
router.delete("/:id/leave", controller.leaveRoom); // must be above '/:id'
router.delete("/:id", controller.deleteRoom);

module.exports = router;