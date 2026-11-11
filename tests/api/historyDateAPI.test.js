// GET /api/rooms/:id/history/:date — one past day's poem, read-only
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
const { today, addDays } = require("../../lib/dates");

const token = jwt.sign({ id: 1, username: "alice" }, process.env.JWT_SECRET, { expiresIn: "1h" });
const auth = { Authorization: `Bearer ${token}` };
const room = { id: 5, name: "English Lit Study", owner_id: 1 };
const DATE = "2026-11-02";

beforeEach(() => {
  jest.clearAllMocks();
  usersModel.findById.mockResolvedValue({ id: 1, username: "alice", nickname: "Alice" });
  roomsModel.findById.mockResolvedValue(room);
  roomsModel.isMember.mockResolvedValue(true);
});

test("401 without a token", async () => {
  const res = await request(app).get(`/api/rooms/5/history/${DATE}`);
  expect(res.statusCode).toBe(401);
});

test.each(["2026-11-2", "2026-02-30", "yesterday"])("400 for a bad date %p", async (d) => {
  const res = await request(app).get(`/api/rooms/5/history/${d}`).set(auth);
  expect(res.statusCode).toBe(400);
  expect(poemsModel.getTodayPoemId).not.toHaveBeenCalled();
});

test("400 for a future date", async () => {
  const res = await request(app).get(`/api/rooms/5/history/${addDays(today(), 1)}`).set(auth);
  expect(res.statusCode).toBe(400);
});

test("404 when the room does not exist", async () => {
  roomsModel.findById.mockResolvedValue(undefined);
  const res = await request(app).get(`/api/rooms/5/history/${DATE}`).set(auth);
  expect(res.statusCode).toBe(404);
});

test("403 for non-members", async () => {
  roomsModel.isMember.mockResolvedValue(false);
  const res = await request(app).get(`/api/rooms/5/history/${DATE}`).set(auth);
  expect(res.statusCode).toBe(403);
  expect(poemsModel.getTodayPoemId).not.toHaveBeenCalled();
});

test("404 when the room had no poem that day — and never assigns one", async () => {
  poemsModel.getTodayPoemId.mockResolvedValue(null);
  const res = await request(app).get(`/api/rooms/5/history/${DATE}`).set(auth);

  expect(res.statusCode).toBe(404);
  expect(poemsModel.assignPoemToRoom).not.toHaveBeenCalled();
  expect(poemsModel.findOrCreatePoem).not.toHaveBeenCalled();
});

test("200 with the same shape as /today plus readOnly", async () => {
  const poem = { id: 3, title: "Woods", author: "Frost", lines: [] };
  poemsModel.getTodayPoemId.mockResolvedValue(3);
  poemsModel.findPoemWithLines.mockResolvedValue(poem);
  memosModel.listForRoomPoem.mockResolvedValue([{ id: 1 }]);
  poemsModel.listAnnotationsForRoomPoem.mockResolvedValue([]);
  poemMarksModel.listForRoomPoem.mockResolvedValue([]);

  const res = await request(app).get(`/api/rooms/5/history/${DATE}`).set(auth);

  expect(res.statusCode).toBe(200);
  expect(res.body).toEqual({
    room: { id: 5, name: "English Lit Study" },
    date: DATE,
    readOnly: true,
    poem,
    memos: [{ id: 1 }],
    annotations: [],
    poem_marks: [],
  });
  expect(poemsModel.getTodayPoemId).toHaveBeenCalledWith(5, DATE);
  expect(memosModel.listForRoomPoem).toHaveBeenCalledWith(5, 3, 1);
  // reading an old poem is not reading today's poem
  expect(streakModel.checkIn).not.toHaveBeenCalled();
});
