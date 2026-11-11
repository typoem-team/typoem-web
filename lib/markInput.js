// Shared body checks for highlights / notes (book_marks and poem_marks).
//
// A mark covers (startPos, startWord) .. (endPos, endWord), both ends inclusive, where the
// position is a paragraph (books) or a line (poems). Rules:
//   kind     'highlight' | 'note'
//   color    highlight: one of COLORS (required); note: ignored -> null
//   quote    1-1000 characters (trimmed)
//   content  note: 1-500 characters (trimmed, required); highlight: ignored -> null

const KINDS = ["highlight", "note"];
const COLORS = ["yellow", "pink", "blue", "green"];
const QUOTE_MAX = 1000;
const CONTENT_MAX = 500;

// helper: non-negative integer in a JSON body
function isIndex(n) {
    return Number.isSafeInteger(n) && n >= 0;
}

// helper: trimmed string of min..max characters, else null
function textOf(raw, min, max) {
    if (typeof raw !== "string") return null;
    const t = raw.trim();
    return t.length >= min && t.length <= max ? t : null;
}

// a note's content (also used by PATCH), else null
function noteContent(raw) {
    return textOf(raw, 1, CONTENT_MAX);
}

// Check a create body.
//   intFields: body keys that must be non-negative integers, e.g.
//              ["chapterIdx", "startPara", "startWord", "endPara", "endWord"]
//   start / end: [positionKey, wordKey] for the range order check
// -> { error } or { kind, color, quote, content }
function checkMarkBody(body, { intFields, start, end }) {
    const b = body || {};
    if (!KINDS.includes(b.kind)) return { error: "kind must be 'highlight' or 'note'" };
    if (!intFields.every((k) => isIndex(b[k]))) {
        return { error: `${intFields.join(", ")} must be non-negative integers` };
    }
    const [sp, sw] = [b[start[0]], b[start[1]]];
    const [ep, ew] = [b[end[0]], b[end[1]]];
    if (sp > ep || (sp === ep && sw > ew)) return { error: "start must not be after end" };

    let color = null;
    if (b.kind === "highlight") {
        if (!COLORS.includes(b.color)) return { error: `color must be one of ${COLORS.join(", ")}` };
        color = b.color;
    }

    const quote = textOf(b.quote, 1, QUOTE_MAX);
    if (quote === null) return { error: `quote must be 1-${QUOTE_MAX} characters` };

    let content = null;
    if (b.kind === "note") {
        content = noteContent(b.content);
        if (content === null) return { error: `content must be 1-${CONTENT_MAX} characters` };
    }
    return { kind: b.kind, color, quote, content };
}

module.exports = { KINDS, COLORS, QUOTE_MAX, CONTENT_MAX, isIndex, textOf, noteContent, checkMarkBody };
