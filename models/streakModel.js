// models/streakModel.js
// Reading streak = consecutive Korea-calendar days with a check-in
// ("다 읽었어요" on the day's poem). One row per (user, date).

const { getDb } = require("../db");
const { addDays, weekOf } = require("../lib/dates");

// mark `date` as read for the user (idempotent)
async function checkIn(user_id, date) {
    await getDb().run(
        `INSERT OR IGNORE INTO reading_checkins (user_id, date) VALUES (?, ?)`,
        [user_id, date]
    );
}

// all check-in dates for these users -> Map(user_id -> Set of 'YYYY-MM-DD')
async function datesForUsers(user_ids) {
    const map = new Map(user_ids.map((id) => [id, new Set()]));
    if (user_ids.length === 0) return map;
    const rows = await getDb().all(
        `SELECT user_id, date FROM reading_checkins
         WHERE user_id IN (${user_ids.map(() => "?").join(", ")})`,
        user_ids
    );
    for (const r of rows) map.get(r.user_id)?.add(r.date);
    return map;
}

// pure: summary from a Set of dates, as of `today`
//   current        days in a row ending today, or ending yesterday if today
//                  isn't checked yet (the streak is still alive until tonight)
//   longest        best run ever
//   checkedInToday today is in the set
//   week           checked dates in today's Mon..Sun week, ascending
function summarize(dates, today) {
    const checkedInToday = dates.has(today);

    let current = 0;
    let day = checkedInToday ? today : addDays(today, -1);
    while (dates.has(day)) {
        current += 1;
        day = addDays(day, -1);
    }

    let longest = 0;
    for (const d of dates) {
        if (dates.has(addDays(d, -1))) continue; // not the start of a run
        let run = 1;
        while (dates.has(addDays(d, run))) run += 1;
        if (run > longest) longest = run;
    }

    const week = weekOf(today).filter((d) => dates.has(d));
    return { current, longest, checkedInToday, week };
}

async function getSummary(user_id, today) {
    const map = await datesForUsers([user_id]);
    return summarize(map.get(user_id), today);
}

// streaks of every member of a room (join order), for the friends view.
// Members and their check-ins are both found by room id, so the two queries run at once.
async function listForRoom(room_id, today) {
    const db = getDb();
    const [members, rows] = await Promise.all([
        db.all(
            `SELECT u.id, u.username, u.nickname
             FROM room_members rm JOIN users u ON u.id = rm.user_id
             WHERE rm.room_id = ?
             ORDER BY rm.id ASC`,
            [room_id]
        ),
        db.all(
            `SELECT rc.user_id, rc.date
             FROM reading_checkins rc JOIN room_members rm ON rm.user_id = rc.user_id
             WHERE rm.room_id = ?`,
            [room_id]
        ),
    ]);
    const map = new Map(members.map((m) => [m.id, new Set()]));
    for (const r of rows) map.get(r.user_id)?.add(r.date);
    return members.map((m) => {
        const s = summarize(map.get(m.id), today);
        return { ...m, current: s.current, longest: s.longest, checkedInToday: s.checkedInToday };
    });
}

// my check-in dates between two 'YYYY-MM-DD' dates (inclusive), ascending
async function datesBetween(user_id, from, to) {
    const rows = await getDb().all(
        `SELECT date FROM reading_checkins WHERE user_id = ? AND date BETWEEN ? AND ? ORDER BY date ASC`,
        [user_id, from, to]
    );
    return rows.map((r) => r.date);
}

module.exports = { checkIn, getSummary, listForRoom, summarize, datesBetween };
