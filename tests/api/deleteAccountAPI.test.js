// DELETE /api/users/me — 회원 탈퇴
const request = require("supertest");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const app = require("../../app");

jest.mock("../../models/usersModel");
const usersModel = require("../../models/usersModel");

const token = jwt.sign({ id: 1, username: "alice" }, process.env.JWT_SECRET, { expiresIn: "1h" });
const auth = { Authorization: `Bearer ${token}` };
let user;

beforeAll(async () => {
  user = { id: 1, username: "alice", nickname: "Alice", password_hash: await bcrypt.hash("correct-pass", 4) };
});

beforeEach(() => {
  jest.clearAllMocks();
  usersModel.findById.mockResolvedValue(user);
  usersModel.deleteAccount.mockResolvedValue({ roomsDeleted: 0, roomsHandedOver: 0 });
});

test("401 without a token", async () => {
  const res = await request(app).delete("/api/users/me").send({ password: "correct-pass" });
  expect(res.statusCode).toBe(401);
  expect(usersModel.deleteAccount).not.toHaveBeenCalled();
});

test("400 without a password", async () => {
  const res = await request(app).delete("/api/users/me").set(auth).send({});
  expect(res.statusCode).toBe(400);
  expect(usersModel.deleteAccount).not.toHaveBeenCalled();
});

test("403 (not 401) with a wrong password, nothing deleted", async () => {
  const res = await request(app).delete("/api/users/me").set(auth).send({ password: "nope" });
  expect(res.statusCode).toBe(403);
  expect(usersModel.deleteAccount).not.toHaveBeenCalled();
});

test("204 with the right password, deletes my account", async () => {
  const res = await request(app).delete("/api/users/me").set(auth).send({ password: "correct-pass" });
  expect(res.statusCode).toBe(204);
  expect(usersModel.deleteAccount).toHaveBeenCalledWith(1);
});

test("500 when deletion fails", async () => {
  jest.spyOn(console, "error").mockImplementation(() => {});
  usersModel.deleteAccount.mockRejectedValue(new Error("db down"));
  const res = await request(app).delete("/api/users/me").set(auth).send({ password: "correct-pass" });
  expect(res.statusCode).toBe(500);
});
