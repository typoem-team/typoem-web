// models/badgesModel.js
// Badges are computed from what is already stored — nothing new is saved.
// Rules (team decision 11/12, poems and books both count):
//   streak_3 / streak_7 / streak_30  longest reading streak reached 3 / 7 / 30 days
//   first_memo / memo_10            wrote 1 / 10 memos or notes
//                                   (poem memos + note marks on poems and books)
//   first_book                      finished a book

const { getDb } = require("../db");
const streakModel = require("./streakModel");
const bookHistoryModel = require("./bookHistoryModel");

const BADGES = [
    { id: "streak_3", name: "3일 연속", description: "3일 연속으로 읽었어요", kind: "streak", goal: 3 },
    { id: "streak_7", name: "7일 연속", description: "7일 연속으로 읽었어요", kind: "streak", goal: 7 },
    { id: "streak_30", name: "30일 연속", description: "30일 연속으로 읽었어요", kind: "streak", goal: 30 },
    { id: "first_memo", name: "첫 메모", description: "처음으로 메모를 남겼어요", kind: "memo", goal: 1 },
    { id: "memo_10", name: "메모 10개", description: "메모를 10개 남겼어요", kind: "memo", goal: 10 },
    { id: "first_book", name: "첫 완독", description: "책 한 권을 끝까지 읽었어요", kind: "book", goal: 1 },
];

async function countMemos(user_id) {
    const row = await getDb().get(
        `SELECT
            (SELECT COUNT(*) FROM memos WHERE user_id = ?)
          + (SELECT COUNT(*) FROM poem_marks WHERE user_id = ? AND kind = 'note')
          + (SELECT COUNT(*) FROM book_marks WHERE user_id = ? AND kind = 'note') AS n`,
        [user_id, user_id, user_id]
    );
    return row.n;
}

// -> { badges: [{ id, name, description, earned, progress, goal }], earned_count }
async function listForUser(user_id, today) {
    const [streak, memos, books] = await Promise.all([
        streakModel.getSummary(user_id, today),
        countMemos(user_id),
        bookHistoryModel.countFinishedBooks(user_id),
    ]);
    const value = { streak: streak.longest, memo: memos, book: books };

    const badges = BADGES.map(({ kind, goal, ...b }) => ({
        ...b,
        earned: value[kind] >= goal,
        progress: Math.min(value[kind], goal),
        goal,
    }));
    return { badges, earned_count: badges.filter((b) => b.earned).length };
}

module.exports = { listForUser, BADGES };
