const express = require("express");
const router = express.Router();
const controller = require("../controllers/streakController");
const { authenticate } = require("../middleware/authMiddleware");

// mounted at /api/streak in app.js
router.use(authenticate);
router.get("/", controller.getMyStreak);
router.post("/checkin", controller.checkIn);

module.exports = router;
