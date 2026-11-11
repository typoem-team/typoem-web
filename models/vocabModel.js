const { getDb } = require("../db");

// List all saved words for a user (DESC)
async function listForUser(user_id) {
  return getDb().all(
    `SELECT id, word, phonetic, definition, definition_ko, created_at
       FROM vocab WHERE user_id = ? ORDER BY created_at DESC`,
    [user_id]
  );
}

// Save a word. Saving the same word again fills in what is new (e.g. the Korean
// meanings of a word that was saved before they existed) and keeps what was already there.
async function add(user_id, word, phonetic, definition, definition_ko = null) {
  return getDb().run(
    `INSERT INTO vocab (user_id, word, phonetic, definition, definition_ko)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id, word) DO UPDATE SET
       phonetic = COALESCE(excluded.phonetic, vocab.phonetic),
       definition = CASE WHEN excluded.definition <> '' THEN excluded.definition ELSE vocab.definition END,
       definition_ko = COALESCE(excluded.definition_ko, vocab.definition_ko)`,
    [user_id, word, phonetic, definition, definition_ko]
  );
}

// Delete words
async function remove(id, user_id) {
  return getDb().run(
    `DELETE FROM vocab WHERE id = ? AND user_id = ?`,
    [id, user_id]
  );
}

module.exports = { listForUser, add, remove };