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