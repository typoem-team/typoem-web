// GET /api/streak?month, GET /api/rooms/:id/books/history, GET /api/users/me/badges
const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../../app");

jest.mock("../../models/streakModel");
jest.mock("../../models/bookHistoryModel");
jest.mock("../../models/badgesModel");
jest.mock("../../models/roomsModel");
jest.mock("../../models/usersModel");
const streakModel = require("../../models/streakModel");
const historyModel = require("../../models/bookHistoryModel");
const badgesModel = require("../../models/badgesModel");
const roomsModel = require("../../models/roomsModel");
const usersModel = require("../../models/usersModel");
const { today } = require("../../lib/dates");

const token = jwt.sign({ id: 1, username: "alice" }, process.env.JWT_SECRET, { expiresIn: "1h" });
const auth = { Authorization: `Bearer ${token}` };
const summary = { current: 2, longest: 5, checkedInToday: true, week: ["2026-11-11"] };

beforeEach(() => {
  jest.clearAllMocks();
  usersModel.findById.mockResolvedValue({ id: 1, username: "alice", nickname: "Alice" });
  streakModel.getSummary.mockResolvedValue(summary);
  roomsModel.findById.mockResolvedValue({ id: 5, name: "r" });
  roomsModel.isMember.mockResolvedValue(true);
});

describe("GET /api/streak?month=YYYY-MM", () => {
  test("adds the month and the days I read in it", async () => {
    streakModel.datesBetween.mockResolvedValue(["2026-11-01", "2026-11-11"]);
    const res = await request(app).get("/api/streak?month=2026-11").set(auth);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ...summary, month: "2026-11", days: ["2026-11-01", "2026-11-11"] });
    expect(streakModel.datesBetween).toHaveBeenCalledWith(1, "2026-11-01", "2026-11-30");
  });

  test("February of a leap year ends on the 29th", async () => {
    streakModel.datesBetween.mockResolvedValue([]);
    await request(app).get("/api/streak?month=2028-02").set(auth);
    expect(streakModel.datesBetween).toHaveBeenCalledWith(1, "2028-02-01", "2028-02-29");
  });

  test.each(["2026-13", "2026-1", "11-2026", "nov"])("400 for month=%p", async (m) => {
    const res = await request(app).get(`/api/streak?month=${m}`).set(auth);
    expect(res.statusCode).toBe(400);
  });

  test("without month the response is unchanged", async () => {
    const res = await request(app).get("/api/streak").set(auth);
    expect(res.body).toEqual(summary);
    expect(streakModel.datesBetween).not.toHaveBeenCalled();
  });
});

describe("GET /api/rooms/:id/books/history", () => {
  test("401 without a token", async () => {
    expect((await request(app).get("/api/rooms/5/books/history")).statusCode).toBe(401);
  });

  test("400 / 404 / 403", async () => {
    expect((await request(app).get("/api/rooms/x/books/history").set(auth)).statusCode).toBe(400);
    roomsModel.findById.mockResolvedValueOnce(undefined);
    expect((await request(app).get("/api/rooms/5/books/history").set(auth)).statusCode).toBe(404);
    roomsModel.isMember.mockResolvedValueOnce(false);
    expect((await request(app).get("/api/rooms/5/books/history").set(auth)).statusCode).toBe(403);
    expect(historyModel.listForRoom).not.toHaveBeenCalled();
  });

  test("200 with the room's books for me", async () => {
    const list = [{ book_id: 501, title: "Emma", status: "reading", progress: 50, readers: [] }];
    historyModel.listForRoom.mockResolvedValue(list);
    const res = await request(app).get("/api/rooms/5/books/history").set(auth);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(list);
    expect(historyModel.listForRoom).toHaveBeenCalledWith(5, 1);
  });
});

describe("GET /api/users/me/badges", () => {
  test("401 without a token", async () => {
    expect((await request(app).get("/api/users/me/badges")).statusCode).toBe(401);
  });

  test("200 with my badges, for today's Seoul date", async () => {
    const body = { badges: [{ id: "first_memo", earned: true, progress: 1, goal: 1 }], earned_count: 1 };
    badgesModel.listForUser.mockResolvedValue(body);
    const res = await request(app).get("/api/users/me/badges").set(auth);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(body);
    expect(badgesModel.listForUser).toHaveBeenCalledWith(1, today());
  });
});
