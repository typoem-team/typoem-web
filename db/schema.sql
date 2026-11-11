-- Users
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  nickname TEXT NOT NULL,
  password_hash TEXT NOT NULL
);

-- Rooms
CREATE TABLE IF NOT EXISTS rooms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  invite_code TEXT NOT NULL UNIQUE,
  owner_id INTEGER NOT NULL,
  FOREIGN KEY (owner_id) REFERENCES users(id)
);

-- Room Members
CREATE TABLE IF NOT EXISTS room_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  UNIQUE(room_id, user_id),
  FOREIGN KEY (room_id) REFERENCES rooms(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Poems
CREATE TABLE IF NOT EXISTS poems (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  author TEXT NOT NULL,
  linecount INTEGER NOT NULL
);

-- Poem Lines
CREATE TABLE IF NOT EXISTS poem_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  poem_id INTEGER NOT NULL,
  line_number INTEGER NOT NULL,
  text TEXT NOT NULL,
  FOREIGN KEY (poem_id) REFERENCES poems(id)
);

-- Daily Room Poems
CREATE TABLE IF NOT EXISTS daily_room_poems (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id INTEGER NOT NULL,
  poem_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  UNIQUE(room_id, date),
  FOREIGN KEY (room_id) REFERENCES rooms(id),
  FOREIGN KEY (poem_id) REFERENCES poems(id)
);

-- Memos
CREATE TABLE IF NOT EXISTS memos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  room_id INTEGER NOT NULL,
  poem_id INTEGER NOT NULL,
  content TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (room_id) REFERENCES rooms(id),
  FOREIGN KEY (poem_id) REFERENCES poems(id)
);

-- Line Annotations
CREATE TABLE IF NOT EXISTS line_annotations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  line_id INTEGER NOT NULL,
  room_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  content TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(line_id, room_id, user_id),
  FOREIGN KEY (line_id) REFERENCES poem_lines(id),
  FOREIGN KEY (room_id) REFERENCES rooms(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Word Cache
CREATE TABLE IF NOT EXISTS word_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  word TEXT NOT NULL UNIQUE,
  phonetic TEXT,
  definitions TEXT NOT NULL
);

-- Memo Likes
CREATE TABLE IF NOT EXISTS memo_likes (
  memo_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (memo_id, user_id),
  FOREIGN KEY (memo_id) REFERENCES memos(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Personal Vocabulary
CREATE TABLE IF NOT EXISTS vocab (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  word TEXT NOT NULL,
  phonetic TEXT,
  definition TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, word),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- ===== Books (v1.1) =====
-- A room reads one Project Gutenberg novel; each member keeps their own progress.
-- Import order: book_chapters + book_paragraphs first (many small batches), the books row LAST.
-- A book exists (is "imported") only when its books row exists.

-- Books (id = Project Gutenberg ebook number, not AUTOINCREMENT)
CREATE TABLE IF NOT EXISTS books (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  author TEXT NOT NULL,
  author_death_year INTEGER,
  total_words INTEGER NOT NULL,
  total_paragraphs INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Book Chapters
-- No FOREIGN KEY to books on purpose: these rows are written before the books row.
CREATE TABLE IF NOT EXISTS book_chapters (
  book_id INTEGER NOT NULL,
  idx INTEGER NOT NULL,
  title TEXT,
  start_paragraph INTEGER NOT NULL,
  paragraph_count INTEGER NOT NULL,
  word_count INTEGER NOT NULL,
  PRIMARY KEY (book_id, idx)
);

-- Book Paragraphs (idx is 0-based across the whole book; id is the stable key for later annotations)
-- No FOREIGN KEY to books on purpose: these rows are written before the books row.
CREATE TABLE IF NOT EXISTS book_paragraphs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id INTEGER NOT NULL,
  idx INTEGER NOT NULL,
  chapter_idx INTEGER NOT NULL,
  text TEXT NOT NULL,
  word_count INTEGER NOT NULL,
  UNIQUE(book_id, idx)
);
CREATE INDEX IF NOT EXISTS idx_book_paragraphs_chapter ON book_paragraphs(book_id, chapter_idx);

-- Room Books (one book per room)
CREATE TABLE IF NOT EXISTS room_books (
  room_id INTEGER PRIMARY KEY,
  book_id INTEGER NOT NULL,
  set_by INTEGER NOT NULL,
  set_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (room_id) REFERENCES rooms(id),
  FOREIGN KEY (book_id) REFERENCES books(id),
  FOREIGN KEY (set_by) REFERENCES users(id)
);

-- Reading Progress (per user, per room, per book; kept when the room changes book or the user leaves)
-- No FOREIGN KEY to books: a book may be deleted and re-imported while progress rows remain.
CREATE TABLE IF NOT EXISTS reading_progress (
  user_id INTEGER NOT NULL,
  room_id INTEGER NOT NULL,
  book_id INTEGER NOT NULL,
  paragraph_idx INTEGER NOT NULL DEFAULT 0,
  target_end_date TEXT,
  started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, room_id, book_id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (room_id) REFERENCES rooms(id)
);

-- Book Marks (highlights + notes on the room's book; one table for both kinds)
-- start_para / end_para = book_paragraphs.idx; start_word / end_word = 0-based position of the
-- .word span inside that paragraph (inclusive). Both ends lie in chapter_idx.
-- No UNIQUE: one person may mark the same place more than once.
-- No FOREIGN KEY to books: a book may be deleted and re-imported (same as reading_progress).
-- color: highlight colour (required for a highlight, NULL for a note; enforced by the API).
--   DBs created before color existed get it from db.js migrate() (ALTER TABLE ... ADD COLUMN).
CREATE TABLE IF NOT EXISTS book_marks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id INTEGER NOT NULL,
  book_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('highlight', 'note')),
  color TEXT CHECK (color IS NULL OR color IN ('yellow', 'pink', 'blue', 'green')),
  chapter_idx INTEGER NOT NULL,
  start_para INTEGER NOT NULL,
  start_word INTEGER NOT NULL,
  end_para INTEGER NOT NULL,
  end_word INTEGER NOT NULL,
  quote TEXT NOT NULL,
  content TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (room_id) REFERENCES rooms(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_book_marks_chapter ON book_marks(room_id, book_id, chapter_idx);

-- ===== Poem marks (v1.1) =====
-- Highlights + notes on a word range of a room's poem; same rules as book_marks.
-- start_line / end_line = poem_lines.line_number; start_word / end_word = 0-based word inside
-- that line (inclusive), split the way public/room.js wrapWords() does (see lib/poemWords.js).
-- source_annotation_id: the line_annotations row this note was copied from by
-- scripts/migrate-line-annotations.js (NULL for marks made in the app); UNIQUE keeps reruns idempotent.
-- line_annotations itself is left as it is (older app builds still use it).
CREATE TABLE IF NOT EXISTS poem_marks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id INTEGER NOT NULL,
  poem_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('highlight', 'note')),
  color TEXT CHECK (color IS NULL OR color IN ('yellow', 'pink', 'blue', 'green')),
  start_line INTEGER NOT NULL,
  start_word INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  end_word INTEGER NOT NULL,
  quote TEXT NOT NULL,
  content TEXT,
  source_annotation_id INTEGER UNIQUE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (room_id) REFERENCES rooms(id),
  FOREIGN KEY (poem_id) REFERENCES poems(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_poem_marks_room_poem ON poem_marks(room_id, poem_id);
