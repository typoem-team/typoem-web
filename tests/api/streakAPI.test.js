// /api/streak (my streak + check-in) and /api/rooms/:id/streaks (friends)
const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../../app");

jest.mock("../../models/streakModel");
jest.mock("../../models/roomsModel");
jest.mock("../../models/usersModel");
const streakModel = require("../../models/streakModel");
const roomsModel = require("../../models/roomsModel");
const usersModel = require("../../models/usersModel");
const { today } = require("../../lib/dates");

const token = jwt.sign({ id: 1, username: "alice" }, process.env.JWT_SECRET, { expiresIn: "1h" });
const auth = { Authorization: `Bearer ${token}` };
const summary = { current: 3, longest: 5, checkedInToday: true, week: ["2026-11-09", "2026-11-10", "2026-11-11"] };

beforeEach(() => {
  jest.clearAllMocks();
  usersModel.findById.mockResolvedValue({ id: 1, username: "alice", nickname: "Alice" });
});

describe("GET /api/streak", () => {
  test("401 without a token", async () => {
    const res = await request(app).get("/api/streak");
    expect(res.statusCode).toBe(401);
    expect(streakModel.getSummary).not.toHaveBeenCalled();
  });

  test("200 with the shape public/streak.js expects, for the Seoul date", async () => {
    streakModel.getSummary.mockResolvedValue(summary);
    const res = await request(app).get("/api/streak").set(auth);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(summary);
    expect(streakModel.getSummary).toHaveBeenCalledWith(1, today());
  });

  test("500 when the model fails", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    streakModel.getSummary.mockRejectedValue(new Error("db down"));
    const res = await request(app).get("/api/streak").set(auth);
    expect(res.statusCode).toBe(500);
  });
});

describe("POST /api/streak/checkin", () => {
  test("401 without a token", async () => {
    const res = await request(app).post("/api/streak/checkin");
    expect(res.statusCode).toBe(401);
    expect(streakModel.checkIn).not.toHaveBeenCalled();
  });

  test("marks today (Seoul) for me and returns the new streak", async () => {
    streakModel.checkIn.mockResolvedValue();
    streakModel.getSummary.mockResolvedValue(summary);
    const res = await request(app).post("/api/streak/checkin").set(auth);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(summary);
    expect(streakModel.checkIn).toHaveBeenCalledWith(1, today());
  });
});

describe("GET /api/rooms/:id/streaks", () => {
  test("400 for a bad room id", async () => {
    const res = await request(app).get("/api/rooms/abc/streaks").set(auth);
    expect(res.statusCode).toBe(400);
  });

  test("404 when the room does not exist", async () => {
    roomsModel.findById.mockResolvedValue(undefined);
    const res = await request(app).get("/api/rooms/5/streaks").set(auth);
    expect(res.statusCode).toBe(404);
    expect(streakModel.listForRoom).not.toHaveBeenCalled();
  });

  test("404 (not 403) when the room is missing and I'm not a member — both are read at once", async () => {
    roomsModel.findById.mockResolvedValue(undefined);
    roomsModel.isMember.mockResolvedValue(false);
    const res = await request(app).get("/api/rooms/5/streaks").set(auth);
    expect(res.statusCode).toBe(404);
    expect(streakModel.listForRoom).not.toHaveBeenCalled();
  });

  test("403 for non-members", async () => {
    roomsModel.findById.mockResolvedValue({ id: 5, name: "r" });
    roomsModel.isMember.mockResolvedValue(false);
    const res = await request(app).get("/api/rooms/5/streaks").set(auth);
    expect(res.statusCode).toBe(403);
    expect(streakModel.listForRoom).not.toHaveBeenCalled();
  });

  test("200 with every member's streak", async () => {
    roomsModel.findById.mockResolvedValue({ id: 5, name: "r" });
    roomsModel.isMember.mockResolvedValue(true);
    const members = [
      { id: 1, username: "alice", nickname: "Alice", current: 3, longest: 5, checkedInToday: true },
      { id: 2, username: "bob", nickname: "Bob", current: 0, longest: 2, checkedInToday: false },
    ];
    streakModel.listForRoom.mockResolvedValue(members);
    const res = await request(app).get("/api/rooms/5/streaks").set(auth);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ date: today(), members });
    expect(streakModel.listForRoom).toHaveBeenCalledWith(5, today());
  });
});
