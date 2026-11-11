// Words of a poem line, split exactly the way public/room.js wrapWords() splits a line
// into .word spans, so that poem_marks.start_word / end_word (0-based, inclusive) mean the
// same thing on the server as on the screen. Keep in sync with room.js:
//   wrapWords()      -- 2+ hyphens -> em dash; paired _..._ is its own segment
//   wrapInline()     split on ' ', then around '—'
//   wrapWordChunk()  a chunk is a word if it matches the "pre core post" pattern with a core
//
// Used by scripts/migrate-line-annotations.js to find a line's last word.

const CHUNK = /^([^A-Za-z0-9]*)([A-Za-z0-9][A-Za-z0-9'’-]*)?([^A-Za-z0-9]*)$/;

// words of one segment (no underscores pairs left), in order
function inlineWords(segment, out) {
    if (segment === "") return;
    for (const spaceTok of segment.split(" ")) {
        if (spaceTok === "") continue;
        for (const p of spaceTok.split(/(—)/)) {
            if (p === "" || p === "—") continue;
            const m = p.match(CHUNK);
            if (m && m[2]) out.push(m[2]);
        }
    }
}

// line text -> [word, ...] (the .word spans' text, in order)
function lineWords(text) {
    const t = String(text == null ? "" : text).replace(/-{2,}/g, "—");
    const out = [];
    let last = 0;
    const re = /_([^_]+)_/g;
    let m;
    while ((m = re.exec(t)) !== null) {
        inlineWords(t.slice(last, m.index), out);
        inlineWords(m[1], out);
        last = re.lastIndex;
    }
    inlineWords(t.slice(last), out);
    return out;
}

function wordCount(text) {
    return lineWords(text).length;
}

module.exports = { lineWords, wordCount };
