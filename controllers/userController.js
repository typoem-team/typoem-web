const bcrypt = require('bcrypt');
const model = require('../models/usersModel');
const badgesModel = require('../models/badgesModel');
const { today } = require('../lib/dates');

async function getMe(req, res) {
    try{
        const user = await model.findById(req.user.id); // provided after checking from middleware
        if(!user) return res.status(404).json({error: "User not found"});
        res.status(200).json({id: user.id, username: user.username, nickname: user.nickname}); // remove hash password
    } catch(err){
        console.error(err);
        res.status(500).json({ error: "Server error" });
    }
}

// 닉네임 바꾸기
// PATCH /api/users/me   body: { nickname }
// Same rules as register: 2-20 characters, no whitespace.
async function updateMe(req, res) {
    try {
        const { nickname } = req.body || {};
        if (typeof nickname !== "string" || !nickname) return res.status(400).json({ error: "nickname required" });
        if (/\s/.test(nickname)) return res.status(400).json({ error: "nickname cannot contain whitespace" });
        if (nickname.length < 2 || nickname.length > 20) return res.status(400).json({ error: "nickname must be 2-20 characters" });

        const updated = await model.updateNickname(req.user.id, nickname);
        if (!updated) return res.status(404).json({ error: "User not found" });
        return res.status(200).json({ id: req.user.id, username: req.user.username, nickname });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Server error" });
    }
}

// 회원 탈퇴
// DELETE /api/users/me   body: { password }
// The password is asked again so a borrowed phone or a stray tap can't delete
// an account. A wrong password answers 403 (not 401: the app treats 401 as
// "logged out" and would kick the user to the login page).
async function deleteMe(req, res) {
    try {
        const { password } = req.body || {};
        if (!password) return res.status(400).json({ error: "password required" });

        const user = await model.findById(req.user.id);
        if (!user) return res.status(404).json({ error: "User not found" });

        const ok = await bcrypt.compare(password, user.password_hash);
        if (!ok) return res.status(403).json({ error: "Wrong password" });

        await model.deleteAccount(user.id);
        return res.status(204).end();
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Server error" });
    }
}

// 배지
// GET /api/users/me/badges
// -> { badges: [{ id, name, description, earned, progress, goal }], earned_count }
// progress is capped at goal, so a bar can be drawn as progress / goal.
async function getMyBadges(req, res) {
    try {
        res.set("Cache-Control", "no-store");
        return res.status(200).json(await badgesModel.listForUser(req.user.id, today()));
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Server error" });
    }
}

module.exports = { getMe, updateMe, deleteMe, getMyBadges };
