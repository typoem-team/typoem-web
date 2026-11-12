// Opening today's poem (GET /api/rooms/:id/today) records today as read for the streak.
const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../../app");

jest.mock("../../models/poemsModel");
jest.mock("../../models/memosModel");
jest.mock("../../models/poemMarksModel");
jest.mock("../../models/roomsModel");
jest.mock("../../models/usersModel");
jest.mock("../../models/streakModel");
const poemsModel = require("../../models/poemsModel");
const memosModel = require("../../models/memosModel");
const poemMarksModel = require("../../models/poemMarksModel");
const roomsModel = require("../../models/roomsModel");
const usersModel = require("../../models/usersModel");
const streakModel = require("../../models/streakModel");
const { today } = require("../../lib/dates");

const token = jwt.sign({ id: 1, username: "alice" }, process.env.JWT_SECRET, { expiresIn: "1h" });
const auth = { Authorization: `Bearer ${token}` };
const poem = { id: 3, title: "Woods", author: "Frost", lines: [] };

beforeEach(() => {
  jest.clearAllMocks();
  usersModel.findById.mockResolvedValue({ id: 1, username: "alice", nickname: "Alice" });
  roomsModel.findById.mockResolvedValue({ id: 5, name: "r" });
  roomsModel.isMember.mockResolvedValue(true);
  poemsModel.getTodayPoemId.mockResolvedValue(3);
  poemsModel.findPoemWithLines.mockResolvedValue(poem);
  memosModel.listForRoomPoem.mockResolvedValue([]);
  poemsModel.listAnnotationsForRoomPoem.mockResolvedValue([]);
  poemMarksModel.listForRoomPoem.mockResolvedValue([]);
});

test("opening today's poem checks me in for today (Korea date)", async () => {
  streakModel.checkIn.mockResolvedValue();
  const res = await request(app).get("/api/rooms/5/today").set(auth);

  expect(res.statusCode).toBe(200);
  expect(streakModel.checkIn).toHaveBeenCalledWith(1, today());
});

test("a failed check-in still returns the poem", async () => {
  jest.spyOn(console, "error").mockImplementation(() => {});
  streakModel.checkIn.mockRejectedValue(new Error("db hiccup"));
  const res = await request(app).get("/api/rooms/5/today").set(auth);

  expect(res.statusCode).toBe(200);
  expect(res.body.poem).toEqual(poem);
});

test("?checkin=0 (the home cover) returns the poem without checking in", async () => {
  const res = await request(app).get("/api/rooms/5/today?checkin=0").set(auth);

  expect(res.statusCode).toBe(200);
  expect(res.body.poem).toEqual(poem);
  expect(streakModel.checkIn).not.toHaveBeenCalled();
});

test("non-members are not checked in", async () => {
  roomsModel.isMember.mockResolvedValue(false);
  const res = await request(app).get("/api/rooms/5/today").set(auth);

  expect(res.statusCode).toBe(403);
  expect(streakModel.checkIn).not.toHaveBeenCalled();
});
