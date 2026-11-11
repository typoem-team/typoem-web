// models/streakModel.summarize — pure streak math
const { summarize } = require("../../models/streakModel");

const TODAY = "2026-11-11"; // Wednesday
const set = (...d) => new Set(d);

test("no check-ins -> all zero", () => {
  expect(summarize(set(), TODAY)).toEqual({ current: 0, longest: 0, checkedInToday: false, week: [] });
});

test("checked in today and the two days before -> 3", () => {
  const s = summarize(set("2026-11-09", "2026-11-10", "2026-11-11"), TODAY);
  expect(s.current).toBe(3);
  expect(s.checkedInToday).toBe(true);
});

test("not yet today but yesterday was read -> streak still alive", () => {
  const s = summarize(set("2026-11-09", "2026-11-10"), TODAY);
  expect(s.current).toBe(2);
  expect(s.checkedInToday).toBe(false);
});

test("missed yesterday and not read today -> streak is 0", () => {
  expect(summarize(set("2026-11-08", "2026-11-09"), TODAY).current).toBe(0);
});

test("longest keeps the best run even after a break", () => {
  const s = summarize(set("2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-11-11"), TODAY);
  expect(s.current).toBe(1);
  expect(s.longest).toBe(4);
});

test("a run across a month boundary counts as one run", () => {
  const s = summarize(set("2026-10-30", "2026-10-31", "2026-11-01"), "2026-11-01");
  expect(s.current).toBe(3);
});

test("week lists only this Mon..Sun week, ascending", () => {
  const s = summarize(set("2026-11-08", "2026-11-11", "2026-11-09"), TODAY);
  expect(s.week).toEqual(["2026-11-09", "2026-11-11"]); // 11-08 is last week's Sunday
});
