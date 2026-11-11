const bcrypt = require('bcrypt');
const model = require('../models/usersModel');

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

module.exports = { getMe, deleteMe };
