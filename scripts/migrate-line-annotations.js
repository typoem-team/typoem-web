// scripts/migrate-line-annotations.js

// Copy every line annotation (line_annotations) into poem_marks as a note on the whole line:
//   start_line = end_line = the line's line_number, start_word = 0,
//   end_word = the line's last word (lib/poemWords.js, same split as room.js wrapWords),
//   quote = the line's text, content = the annotation, created_at kept.
//
// - Safe to run again: each copy remembers its source (poem_marks.source_annotation_id, UNIQUE),
//   so only annotations not copied yet are added. Annotations written later by older app
//   builds are picked up by the next run.
// - line_annotations is never changed or deleted.
// - Not copied: annotations on a line with no words (e.g. a blank line).
// - Content is copied as-is, even if longer than the 500 characters new notes allow
//   (line annotations allowed 1000). Quotes longer than 1000 characters are cut to 1000.
// - Edits / deletes made to an annotation after it was copied are NOT carried over.
//
// Uses the same DB settings as the server (TURSO_DATABASE_URL / TURSO_AUTH_TOKEN, or DB_PATH).
// Run with:  node scripts/migrate-line-annotations.js
// (.env is loaded only when run directly, never on require: tests require this file with
//  TURSO_* removed and must not be pointed back at the real DB.)

const { initDb } = require("../db");
const poemMarksModel = require("../models/poemMarksModel");
const { wordCount } = require("../lib/poemWords");
const { QUOTE_MAX } = require("../lib/markInput");

// copy what hasn't been copied yet -> { copied, skippedNoWords: [annotation id], alreadyCopied }
async function migrateLineAnnotations() {
    const rows = await poemMarksModel.listUnmigratedAnnotations();
    let copied = 0;
    let alreadyCopied = 0; // lost a race with another run (INSERT OR IGNORE)
    const skippedNoWords = [];

    for (const a of rows) {
        const words = wordCount(a.text);
        if (words === 0) {
            skippedNoWords.push(a.id);
            continue;
        }
        const inserted = await poemMarksModel.insertFromAnnotation({
            source_annotation_id: a.id,
            room_id: a.room_id,
            poem_id: a.poem_id,
            user_id: a.user_id,
            line_number: a.line_number,
            end_word: words - 1,
            quote: a.text.trim().slice(0, QUOTE_MAX),
            content: a.content,
            created_at: a.created_at,
        });
        if (inserted) copied++;
        else alreadyCopied++;
    }
    return { copied, alreadyCopied, skippedNoWords };
}

async function main() {
    try {
        await initDb();
        const r = await migrateLineAnnotations();
        console.log(`Copied ${r.copied} line annotation(s) into poem_marks.`);
        if (r.alreadyCopied) console.log(`${r.alreadyCopied} were copied by another run meanwhile.`);
        if (r.skippedNoWords.length) {
            console.log(`Skipped ${r.skippedNoWords.length} on lines with no words (ids: ${r.skippedNoWords.join(", ")}).`);
        }
    } catch (err) {
        console.error(err);
        process.exitCode = 1;
    }
}

if (require.main === module) {
    require("dotenv").config();
    main();
}

module.exports = { migrateLineAnnotations };
