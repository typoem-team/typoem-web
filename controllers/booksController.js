// Books (v1.1): search Gutenberg, assign a book to a room, read it, save reading progress.
//
// GET  /api/books                     imported books
// GET  /api/books/shelf               the fixed 10-book shelf + imported flags (no upstream calls)
// GET  /api/books/search?q=           Gutendex search (Korea public domain only)
// PUT  /api/rooms/:id/book            owner sets the room's book (imports it if needed)
// GET  /api/rooms/:id/book[?chapter=] book overview + my progress + where members are, or one chapter's paragraphs
// PUT  /api/rooms/:id/book/progress   save my progress
//
// Dates / remaining days are computed on the client (device time); the server only
// validates and stores targetEndDate strings.

const booksModel = require("../models/booksModel");
const roomsModel = require("../models/roomsModel");
const streakModel = require("../models/streakModel");
const { today } = require("../lib/dates");
const bookFetch = require("../lib/bookFetch");
const BOOK_SHELF = require("../data/bookShelf.json");

// helper: parse ':id' path param and validate (same as roomsController)
function parseId(raw) {
    const id = Number(raw);
    if (!Number.isInteger(id) || id <= 0) return null;
    return id;
}

// helper: non-negative integer from a query string ("0", "12"), else null
function parseIndex(raw) {
    if (typeof raw !== "string" || !/^\d+$/.test(raw)) return null;
    const n = Number(raw);
    return Number.isSafeInteger(n) ? n : null;
}

// helper: 'YYYY-MM-DD' that is a real calendar date
function isValidDate(s) {
    if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const [y, m, d] = s.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

// helper: room exists + caller is a member (same order/messages as memosController)
// returns the room, or null after sending the error response
async function loadRoomForMember(req, res) {
    const room_id = parseId(req.params.id);
    if (!room_id) {
        res.status(400).json({ error: "invalid room id" });
        return null;
    }
    const room = await roomsModel.findById(room_id);
    if (!room) {
        res.status(404).json({ error: "Room not found" });
        return null;
    }
    const isMember = await roomsModel.isMember(room_id, req.user.id);
    if (!isMember) {
        res.status(403).json({ error: "You are not a member of this room" });
        return null;
    }
    return room;
}

function bookDto(b) {
    return {
        id: b.id,
        gutenbergId: b.id,
        title: b.title,
        author: b.author,
        authorDeathYear: b.author_death_year ?? null,
        totalWords: b.total_words,
        totalParagraphs: b.total_paragraphs,
    };
}

function progressDto(p) {
    if (!p) return { paragraphIdx: 0, targetEndDate: null, startedAt: null, updatedAt: null };
    return {
        paragraphIdx: p.paragraph_idx,
        targetEndDate: p.target_end_date ?? null,
        startedAt: p.started_at ?? null,
        updatedAt: p.updated_at ?? null,
    };
}

// chapter idx that a book-wide paragraph idx falls in: the last chapter starting at or
// before it, so an idx past the end lands in the last chapter. null when there are no chapters.
// chapters = getChapters() rows, ordered by idx (= by start_paragraph)
function chapterOfParagraph(chapters, paragraph_idx) {
    let found = chapters.length ? chapters[0].idx : null;
    for (const c of chapters) {
        if (c.start_paragraph <= paragraph_idx) found = c.idx;
        else break;
    }
    return found;
}

const UPSTREAM_ERROR ={ error: "Book service unavailable, please try again" };

// Gutendex meta lookup; timeouts / network errors are retried once
async function getMetaWithRetry(gutenbergId) {
    let r = await bookFetch.getBookMeta(gutenbergId);
    if (!r.ok && (r.error === "timeout" || r.error === "network")) {
        r = await bookFetch.getBookMeta(gutenbergId);
    }
    return r;
}

// [GET] /api/books
async function listBooks(req, res) {
    try {
        const books = await booksModel.listBooks();
        res.status(200).json(books.map((b) => ({
            id: b.id,
            gutenbergId: b.id,
            title: b.title,
            author: b.author,
            totalWords: b.total_words,
        })));
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error" });
    }
}

// [GET] /api/books/shelf
// The fixed shelf of 10 books (data/bookShelf.json) + whether each is already stored.
// Never calls Gutendex / Project Gutenberg.
async function getShelf(req, res) {
    try {
        const imported = new Set(await booksModel.findImportedIds(BOOK_SHELF.map((b) => b.gutenbergId)));
        res.status(200).json(BOOK_SHELF.map((b) => ({
            gutenbergId: b.gutenbergId,
            title: b.title,
            author: b.author,
            imported: imported.has(b.gutenbergId),
        })));
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error" });
    }
}

// [GET] /api/books/search?q=
async function searchBooks(req, res) {
    try {
        const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
        if (q.length < 1 || q.length > 100) return res.status(400).json({ error: "q must be 1-100 characters" });

        const r = await bookFetch.searchBooks(q);
        if (!r.ok) return res.status(502).json(UPSTREAM_ERROR);

        const pd = r.results.filter((b) => bookFetch.isKoreaPublicDomain(b));
        const imported = new Set(await booksModel.findImportedIds(pd.map((b) => b.id)));

        res.status(200).json(pd.map((b) => ({
            gutenbergId: b.id,
            title: b.title,
            authors: (b.authors || []).map((a) => ({ name: a.name, deathYear: a.death_year ?? null })),
            alreadyImported: imported.has(b.id),
        })));
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error" });
    }
}

// [PUT] /api/rooms/:id/book   body { gutenbergId }
async function setRoomBook(req, res) {
    try {
        const room = await loadRoomForMember(req, res);
        if (!room) return;
        if (room.owner_id !== req.user.id) {
            return res.status(403).json({ error: "Only the room owner can change the book" });
        }

        const gutenbergId = req.body ? req.body.gutenbergId : undefined;
        if (!Number.isInteger(gutenbergId) || gutenbergId <= 0) {
            return res.status(400).json({ error: "gutenbergId must be a positive integer" });
        }

        let book = await booksModel.findById(gutenbergId);
        if (!book) {
            const meta = await getMetaWithRetry(gutenbergId);
            if (!meta.ok) {
                if (meta.error === "http" && meta.status === 404) {
                    return res.status(404).json({ error: "Book not found on Project Gutenberg" });
                }
                return res.status(502).json(UPSTREAM_ERROR);
            }
            const languages = Array.isArray(meta.meta.languages) ? meta.meta.languages : [];
            if (!languages.includes("en")) {
                return res.status(422).json({ error: "Only English books are supported" });
            }
            if (!bookFetch.isKoreaPublicDomain(meta.meta)) {
                return res.status(422).json({ error: "This book is not in the public domain in Korea" });
            }

            const text = await bookFetch.fetchBookText(meta.meta);
            if (!text.ok) {
                if (text.error === "no_text") return res.status(422).json({ error: "No plain-text edition of this book is available" });
                return res.status(502).json(UPSTREAM_ERROR);
            }

            const parsed = bookFetch.parseBook(text.text);
            if (!parsed.ok) {
                const error = parsed.error === "too_long"
                    ? "This book is too long (max 200,000 words)"
                    : "This book could not be split into enough paragraphs (min 50)";
                return res.status(422).json({ error });
            }

            try {
                ({ book } = await booksModel.importBook(meta.meta, parsed));
            } catch (err) {
                if (err && err.name === "IncompleteImportError") {
                    return res.status(503).json({ error: "Book import did not complete, please try again" });
                }
                throw err;
            }
        }

        await booksModel.setRoomBook(room.id, book.id, req.user.id);
        res.status(200).json(bookDto(book));
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error" });
    }
}

// [GET] /api/rooms/:id/book[?checkin=0] -> { room, book, chapters, progress, readers }
//   Opening the book also checks me in for the streak (not with ?checkin=0 or ?chapter=N).
// [GET] /api/rooms/:id/book?chapter=N  -> { chapter: { idx, title }, paragraphs }
async function getRoomBook(req, res) {
    try {
        const room = await loadRoomForMember(req, res);
        if (!room) return;
        // opening the book puts the room first in my room list; never break the book over it
        await Promise.resolve()
            .then(() => roomsModel.markOpened(room.id, req.user.id))
            .catch((err) => console.error("Marking the room opened failed:", err));

        let chapterIdx = null;
        if (req.query.chapter !== undefined) {
            chapterIdx = parseIndex(req.query.chapter);
            if (chapterIdx === null) return res.status(400).json({ error: "chapter must be a non-negative integer" });
        }

        const rb = await booksModel.getRoomBook(room.id);
        if (!rb) return res.status(404).json({ error: "No book assigned to this room" });

        const chapters = await booksModel.getChapters(rb.book_id);

        if (chapterIdx !== null) {
            const chapter = chapters.find((c) => c.idx === chapterIdx);
            if (!chapter) return res.status(404).json({ error: "Chapter not found" });
            const paragraphs = await booksModel.getChapterParagraphs(rb.book_id, chapterIdx);
            return res.status(200).json({
                chapter: { idx: chapter.idx, title: chapter.title ?? null },
                paragraphs: paragraphs.map((p) => ({ id: p.id, idx: p.idx, text: p.text })),
            });
        }

        // Opening the book counts as reading today (streak), like opening today's poem.
        // ?checkin=0 opts out. A failed check-in must never break the book, so it only logs.
        if (req.query.checkin !== "0") {
            await Promise.resolve()
                .then(() => streakModel.checkIn(req.user.id, today()))
                .catch((err) => console.error("Streak check-in failed:", err));
        }

        const progress = await booksModel.getProgress(req.user.id, room.id, rb.book_id); // no row is created here
        const readers = await booksModel.getReaders(room.id, rb.book_id);
        res.set("Cache-Control", "no-store");
        res.status(200).json({
            room: { id: room.id, name: room.name },
            book: bookDto({ ...rb, id: rb.book_id }),
            chapters: chapters.map((c) => ({
                idx: c.idx,
                title: c.title ?? null,
                startParagraph: c.start_paragraph,
                paragraphCount: c.paragraph_count,
                wordCount: c.word_count,
            })),
            progress: progressDto(progress),
            readers: readers.map((r) => ({
                userId: r.user_id,
                nickname: r.nickname,
                chapterIdx: chapterOfParagraph(chapters, r.paragraph_idx),
                isMe: r.user_id === req.user.id,
            })),
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error" });
    }
}

// [PUT] /api/rooms/:id/book/progress   body { paragraphIdx, targetEndDate? }
async function updateProgress(req, res) {
    try {
        const room = await loadRoomForMember(req, res);
        if (!room) return;

        const rb = await booksModel.getRoomBook(room.id);
        if (!rb) return res.status(404).json({ error: "No book assigned to this room" });

        const body = req.body || {};
        const { paragraphIdx, targetEndDate } = body;
        if (!Number.isInteger(paragraphIdx) || paragraphIdx < 0 || paragraphIdx >= rb.total_paragraphs) {
            return res.status(400).json({ error: `paragraphIdx must be an integer from 0 to ${rb.total_paragraphs - 1}` });
        }
        if (targetEndDate !== undefined && targetEndDate !== null && !isValidDate(targetEndDate)) {
            return res.status(400).json({ error: "targetEndDate must be a valid YYYY-MM-DD date or null" });
        }

        const saved = await booksModel.upsertProgress({
            user_id: req.user.id,
            room_id: room.id,
            book_id: rb.book_id,
            paragraph_idx: paragraphIdx,
            target_end_date: targetEndDate, // undefined -> keep stored value
        });
        res.set("Cache-Control", "no-store");
        res.status(200).json(progressDto(saved));
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error" });
    }
}

module.exports = { listBooks, getShelf, searchBooks, setRoomBook, getRoomBook, updateProgress, isValidDate };
