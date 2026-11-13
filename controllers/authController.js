const bcrypt = require("bcrypt");
const model = require("../models/usersModel");

const jwt = require("jsonwebtoken");

// register
// [POST] /api/auth/register
async function register(req, res) {
    try {
        const { username, nickname, password } = req.body;

        // constraints
        // exists
        if (!username || !nickname || !password) return res.status(400).json({ error: "username, nickname and password required" });
        // no whitespace
        if (/\s/.test(username) || /\s/.test(nickname) || /\s/.test(password)) return res.status(400).json({ error: "username, nickname and password cannot contain whitespace" });
        // length
        if (username.length < 3 || username.length > 20) return res.status(400).json({error: "username must be 3-20 characters"});
        if (nickname.length < 2 || nickname.length > 20) return res.status(400).json({error: "nickname must be 2-20 characters"});
        if (password.length < 8 || password.length > 100) return res.status(400).json({error: "password must be 8-100 characters"});
        // username format
        if (!/^[a-zA-Z0-9_]+$/.test(username)) return res.status(400).json({ error: "username must contain only letters, numbers, and underscores" });

        // password hashing
        const password_hash = await bcrypt.hash(password, 10);
        const result = await model.create({username, nickname, password_hash});
        res.status(201).json({ id: result.lastID, username, nickname });
    } catch (err) {
        if (err instanceof model.UsernameTakenError) {
            return res.status(409).json({error: "username already exists"});
        }
        console.error(err);
        res.status(500).json({error: "Server error"});
    }
}

// login
// POST /api/auth/login
async function login(req, res) {
    try {
        const { username, password } = req.body;
        if (!username || !password) return res.status(400).json({ error: "username and password required" });

        const user = await model.findByUsername(username); // find user
        if (!user) return res.status(401).json({error: "Invalid credentials"});

        const ok = await bcrypt.compare(password, user.password_hash); // Check password
        if(!ok) return res.status(401).json({error: "Invalid credentials"});

        // if success; provide tokens
        const token = jwt.sign( // sign a JWT containing the user's id and username
            {id: user.id, username: user.username },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN }
        );

        // created_at: the client shows first-run coach marks to new accounts (public/tour.js)
        res.status(200).json({ token, user: { id: user.id, username: user.username, nickname: user.nickname, created_at: user.created_at } });
    } catch (err) {
        console.error(err);
        res.status(500).json({error:"Server error"});
    }
}

module.exports = { register, login };
