const express = require("express");
const router = express.Router();
const controller = require("../controllers/userController");

const { authenticate } = require("../middleware/authMiddleware"); // for authentication

// add /users(prefix) in app.js
router.get("/me", authenticate, controller.getMe);
router.patch("/me", authenticate, controller.updateMe); // 닉네임 바꾸기
router.delete("/me", authenticate, controller.deleteMe); // 회원 탈퇴 (password required)
router.get("/me/badges", authenticate, controller.getMyBadges); // 배지

module.exports = router;
