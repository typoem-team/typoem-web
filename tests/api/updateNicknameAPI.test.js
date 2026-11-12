// PATCH /api/users/me — 닉네임 바꾸기
const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../../app");

jest.mock("../../models/usersModel");
const usersModel = require("../../models/usersModel");

const token = jwt.sign({ id: 1, username: "alice" }, process.env.JWT_SECRET, { expiresIn: "1h" });
const auth = { Authorization: `Bearer ${token}` };

beforeEach(() => {
  jest.clearAllMocks();
  usersModel.findById.mockResolvedValue({ id: 1, username: "alice", nickname: "Alice" });   // authenticate looks me up
  usersModel.updateNickname.mockResolvedValue(true);
});

test("401 without a token", async () => {
  const res = await request(app).patch("/api/users/me").send({ nickname: "앨리스" });
  expect(res.statusCode).toBe(401);
  expect(usersModel.updateNickname).not.toHaveBeenCalled();
});

test.each([
  ["missing", {}],
  ["empty", { nickname: "" }],
  ["not a string", { nickname: 12345 }],
  ["with a space", { nickname: "앨 리스" }],
  ["too short", { nickname: "a" }],
  ["too long", { nickname: "a".repeat(21) }],
])("400 when the nickname is %s, nothing changed", async (_, body) => {
  const res = await request(app).patch("/api/users/me").set(auth).send(body);
  expect(res.statusCode).toBe(400);
  expect(usersModel.updateNickname).not.toHaveBeenCalled();
});

test("200 changes my nickname and returns my profile", async () => {
  const res = await request(app).patch("/api/users/me").set(auth).send({ nickname: "앨리스" });
  expect(res.statusCode).toBe(200);
  expect(res.body).toEqual({ id: 1, username: "alice", nickname: "앨리스" });
  expect(usersModel.updateNickname).toHaveBeenCalledWith(1, "앨리스");
});

test("200 at the length limits (2 and 20 characters)", async () => {
  for (const nickname of ["ab", "a".repeat(20)]) {
    const res = await request(app).patch("/api/users/me").set(auth).send({ nickname });
    expect(res.statusCode).toBe(200);
  }
});

test("404 when my account is gone", async () => {
  usersModel.updateNickname.mockResolvedValue(false);
  const res = await request(app).patch("/api/users/me").set(auth).send({ nickname: "앨리스" });
  expect(res.statusCode).toBe(404);
});

test("500 when the update fails", async () => {
  jest.spyOn(console, "error").mockImplementation(() => {});
  usersModel.updateNickname.mockRejectedValue(new Error("db down"));
  const res = await request(app).patch("/api/users/me").set(auth).send({ nickname: "앨리스" });
  expect(res.statusCode).toBe(500);
  console.error.mockRestore();
});
