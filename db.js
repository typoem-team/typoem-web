// db.js — libSQL (Turso) adapter
// Keeps the same API the models already use (get / all / run / exec,
// result.lastID / result.changes, err.code === 'SQLITE_CONSTRAINT'),
// so no model file has to change.
//
//   TURSO_DATABASE_URL + TURSO_AUTH_TOKEN set → remote Turso DB (production)
//   otherwise                                → local file at DB_PATH (dev / tests)

const { createClient } = require('@libsql/client');
const path = require('path');
const fs = require('fs');

let client;
let db;

// ---------- helpers ----------

// sqlite-style params: run(sql, [a, b]) | run(sql, a, b) | run(sql, { ... })
function toArgs(params) {
  if (params.length === 0) return [];
  let args = params.length === 1 ? params[0] : params;
  if (args === undefined || args === null) return [];
  if (!Array.isArray(args) && typeof args !== 'object') args = [args];
  if (Array.isArray(args)) return args.map((v) => (v === undefined ? null : v));
  return args;
}

// libSQL Row → plain object (column name → value)
function toObject(rs, row) {
  const obj = {};
  rs.columns.forEach((col, i) => { obj[col] = row[i]; });
  return obj;
}

// libSQL reports SQLITE_CONSTRAINT_UNIQUE etc.; models check 'SQLITE_CONSTRAINT'
function normalizeError(err) {
  if (err && typeof err.code === 'string' && err.code.startsWith('SQLITE_CONSTRAINT')) {
    err.code = 'SQLITE_CONSTRAINT';
  }
  return err;
}

// ---------- transactions ----------
// Models do exec('BEGIN') ... exec('COMMIT' | 'ROLLBACK').
// Map that onto client.transaction(), one transaction at a time.
let tx = null;          // active libSQL transaction
let txRelease = null;   // releases the lock for the next BEGIN
let txQueue = Promise.resolve();

async function begin() {
  const prev = txQueue;
  let release;
  txQueue = new Promise((r) => { release = r; });
  await prev;
  try {
    tx = await client.transaction('write');
    txRelease = release;
  } catch (err) {
    release();
    throw normalizeError(err);
  }
}

async function finish(kind) {
  if (!tx) return; // BEGIN failed earlier → nothing to commit/rollback
  const current = tx;
  const release = txRelease;
  tx = null;
  txRelease = null;
  try {
    if (kind === 'COMMIT') await current.commit();
    else await current.rollback();
  } catch (err) {
    throw normalizeError(err);
  } finally {
    current.close();
    release();
  }
}

// while a transaction is open, statements go through it
function target() {
  return tx || client;
}

async function execute(sql, params) {
  try {
    return await target().execute({ sql, args: toArgs(params) });
  } catch (err) {
    throw normalizeError(err);
  }
}

// ---------- public API (same shape as the `sqlite` package) ----------

function makeDb() {
  return {
    async get(sql, ...params) {
      const rs = await execute(sql, params);
      return rs.rows.length ? toObject(rs, rs.rows[0]) : undefined;
    },
    async all(sql, ...params) {
      const rs = await execute(sql, params);
      return rs.rows.map((row) => toObject(rs, row));
    },
    async run(sql, ...params) {
      const rs = await execute(sql, params);
      return {
        lastID: rs.lastInsertRowid !== undefined ? Number(rs.lastInsertRowid) : undefined,
        changes: rs.rowsAffected,
      };
    },
    async exec(sql) {
      const cmd = sql.trim().replace(/;$/, '').toUpperCase();
      if (cmd === 'BEGIN' || cmd === 'BEGIN TRANSACTION') return begin();
      if (cmd === 'COMMIT' || cmd === 'END') return finish('COMMIT');
      if (cmd === 'ROLLBACK') return finish('ROLLBACK');
      try {
        await target().executeMultiple(sql);
      } catch (err) {
        throw normalizeError(err);
      }
    },
  };
}

async function initDb() {
  if (process.env.TURSO_DATABASE_URL) {
    client = createClient({
      url: process.env.TURSO_DATABASE_URL,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
  } else {
    const file = process.env.DB_PATH || './typoem.db';
    client = createClient({ url: file === ':memory:' ? ':memory:' : `file:${file}` });
  }

  db = makeDb();

  try {
    await db.exec('PRAGMA foreign_keys = ON');
  } catch (err) {
    // some remote connections ignore/refuse this; not fatal
  }

  const schema = fs.readFileSync(path.join(__dirname, 'db/schema.sql'), 'utf8');
  await db.exec(schema);

  return db;
}

function getDb() {
  return db;
}

module.exports = { initDb, getDb };
