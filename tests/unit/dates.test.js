// lib/dates.js — Typoem's "today" is the Korea (Asia/Seoul) calendar date.
const { seoulDate, addDays, weekOf, isValidDate } = require("../../lib/dates");

describe("seoulDate", () => {
  test("before 15:00 UTC it is the same calendar day in Seoul", () => {
    expect(seoulDate(new Date("2026-11-11T14:59:59Z"))).toBe("2026-11-11");
  });

  test("from 15:00 UTC (= midnight KST) it is already the next day in Seoul", () => {
    expect(seoulDate(new Date("2026-11-11T15:00:00Z"))).toBe("2026-11-12");
  });

  test("01:00 KST is still 'today' in Seoul while UTC says yesterday", () => {
    // 2026-11-12 01:00 KST == 2026-11-11 16:00 UTC (the old UTC bug showed 11-11)
    expect(seoulDate(new Date("2026-11-11T16:00:00Z"))).toBe("2026-11-12");
  });
});

describe("addDays", () => {
  test("crosses month and year boundaries", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("weekOf", () => {
  test("returns Monday..Sunday of the week", () => {
    // 2026-11-11 is a Wednesday
    expect(weekOf("2026-11-11")).toEqual([
      "2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12",
      "2026-11-13", "2026-11-14", "2026-11-15",
    ]);
  });

  test("a Sunday belongs to the week that started the Monday before", () => {
    expect(weekOf("2026-11-15")[0]).toBe("2026-11-09");
  });
});

describe("isValidDate", () => {
  test.each(["2026-11-11", "2028-02-29"])("accepts %s", (d) => {
    expect(isValidDate(d)).toBe(true);
  });

  test.each(["2026-02-30", "2026-13-01", "26-11-11", "2026-11-1", "today", "", null])(
    "rejects %p", (d) => {
      expect(isValidDate(d)).toBe(false);
    }
  );
});
