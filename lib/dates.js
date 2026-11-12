// lib/dates.js
// Typoem's "today" is the calendar date in Korea (Asia/Seoul, UTC+9), not UTC.
// With UTC the day rolled over at 09:00 KST, so readers saw yesterday's poem
// between midnight and 9 a.m.
//
// All dates are plain 'YYYY-MM-DD' strings.

const SEOUL = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
});

// Seoul calendar date of a moment (default: now) -> 'YYYY-MM-DD'
function seoulDate(when = new Date()) {
  return SEOUL.format(when);
}

function today() {
  return seoulDate();
}

// 'YYYY-MM-DD' + n days -> 'YYYY-MM-DD' (pure calendar math, no time zone)
function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

// the seven dates (Mon..Sun) of the week that contains `iso`
function weekOf(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const fromMonday = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; // Mon=0..Sun=6
  const monday = addDays(iso, -fromMonday);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

// strict 'YYYY-MM-DD' check (also rejects 2026-02-30)
function isValidDate(iso) {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  return addDays(iso, 0) === iso;
}

// strict 'YYYY-MM' check
function isValidMonth(ym) {
  return typeof ym === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(ym);
}

// first and last 'YYYY-MM-DD' of a 'YYYY-MM' month
function monthRange(ym) {
  const [y, m] = ym.split('-').map(Number);
  const first = `${ym}-01`;
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); // day 0 of next month
  return { first, last };
}

module.exports = { seoulDate, today, addDays, weekOf, isValidDate, isValidMonth, monthRange };
