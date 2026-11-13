const jwt = require("jsonwebtoken"); //jwt
const usersModel = require("../models/usersModel"); // to verify the token's user still exists

// "Does this user still exist?" is asked on every API call. The answer barely changes
// (only when an account is deleted), so it is remembered for a short while: that saves
// one DB round trip per request. Deleting an account forgets it at once (forgetUser).
// Tests turn the cache off so each test sees its own mocked user.
const USER_TTL_MS = 60 * 1000;
const USER_CACHE_MAX = 1000;
const userCache = new Map(); // id -> { user: { id, username }, until }
const cacheOn = () => process.env.NODE_ENV !== "test";

function rememberUser(user) {
    if (!cacheOn()) return;
    if (userCache.size >= USER_CACHE_MAX) userCache.delete(userCache.keys().next().value); // oldest first
    userCache.set(user.id, { user: { id: user.id, username: user.username }, until: Date.now() + USER_TTL_MS });
}

function cachedUser(id) {
    if (!cacheOn()) return null;
    const hit = userCache.get(id);
    if (!hit) return null;
    if (hit.until < Date.now()) { userCache.delete(id); return null; }
    return hit.user;
}

// call after deleting an account, so its old token stops working right away
function forgetUser(id) {
    userCache.delete(id);
}

// authentication
async function authenticate(req, res, next) {
    // check header and extract tokens
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) return res.status(401).json({error: "missing token"});
    const token = header.slice(7);

    // verify token signature / expiry
    let payload;
    try {
        payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
        return res.status(401).json({error: "invalid or expired token"});
    }

    // ensure the token's user still exists in the DB.
    // Render's free tier wipes SQLite and recycles AUTOINCREMENT ids on redeploy,
    // so an old JWT (same secret) could otherwise point to a different/new user.
    const hit = cachedUser(payload.id);
    if (hit) {
        req.user = { ...hit };
        return next();
    }
    try {
        const user = await usersModel.findById(payload.id);
        if (!user) return res.status(401).json({error: "account no longer exists"});
        rememberUser(user);
        req.user = { id: user.id, username: user.username };
        next();
    } catch (err) {
        console.error(err);
        return res.status(500).json({error: "Server error"});
    }
}

module.exports = { authenticate, forgetUser };
