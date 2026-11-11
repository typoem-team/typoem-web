const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../../app");

jest.mock("../../models/vocabModel");
jest.mock("../../models/usersModel");
const vocabModel = require("../../models/vocabModel");
const usersModel = require("../../models/usersModel");

const token = jwt.sign(
  { id: 1, username: "alice" },
  process.env.JWT_SECRET,
  { expiresIn: "1h" }
);

beforeEach(() => {
  jest.clearAllMocks();
  usersModel.findById.mockResolvedValue({ id: 1, username: "alice", nickname: "Alice" });
});

describe("GET /api/vocab", () => {
  test("returns 401 when no Authorization header is sent", async () => {
    const res = await request(app).get("/api/vocab");

    expect(res.statusCode).toBe(401);
    expect(vocabModel.listForUser).not.toHaveBeenCalled();
  });

  test("returns 200 with the current user's saved words", async () => {
    const words = [
      { id: 2, word: "clever", phonetic: "/ˈklɛvə/", definition: "quick to learn", created_at: "2026-06-08 09:00:00" },
      { id: 1, word: "brook", phonetic: null, definition: "a small stream", created_at: "2026-06-07 09:00:00" },
    ];
    vocabModel.listForUser.mockResolvedValue(words);

    const res = await request(app)
      .get("/api/vocab")
      .set("Authorization", `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(words);
    expect(vocabModel.listForUser).toHaveBeenCalledWith(1);
  });
});

describe("GET /api/vocab (Korean meanings)", () => {
  test("turns the stored JSON text into a ko array", async () => {
    vocabModel.listForUser.mockResolvedValue([
      { id: 3, word: "clever", phonetic: null, definition: "quick", definition_ko: JSON.stringify([{ pos: "형용사", ko: ["영리한"], own: false }]), created_at: "2026-06-08 09:00:00" },
      { id: 2, word: "brook", phonetic: null, definition: "a stream", definition_ko: null, created_at: "2026-06-07 09:00:00" },
      { id: 1, word: "oak", phonetic: null, definition: "a tree", definition_ko: "{broken", created_at: "2026-06-06 09:00:00" },
    ]);

    const res = await request(app).get("/api/vocab").set("Authorization", `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
    expect(res.body[0].ko).toEqual([{ pos: "형용사", ko: ["영리한"], own: false }]);
    expect(res.body[0]).not.toHaveProperty("definition_ko");
    expect(res.body[1].ko).toBeNull();
    expect(res.body[2].ko).toBeNull();   // broken JSON never breaks the list
  });
});

describe("POST /api/vocab", () => {
  const validBody = {
    word: "clever",
    phonetic: "/ˈklɛvə/",
    definition: "Quick to understand, learn, and devise or apply ideas.",
  };

  test("returns 401 when no Authorization header is sent", async () => {
    const res = await request(app).post("/api/vocab").send(validBody);

    expect(res.statusCode).toBe(401);
    expect(vocabModel.add).not.toHaveBeenCalled();
  });

  test("returns 400 when the word is missing", async () => {
    const res = await request(app)
      .post("/api/vocab")
      .set("Authorization", `Bearer ${token}`)
      .send({ definition: "some definition" });

    expect(res.statusCode).toBe(400);
    expect(vocabModel.add).not.toHaveBeenCalled();
  });

  test("returns 400 when the word contains invalid characters", async () => {
    const res = await request(app)
      .post("/api/vocab")
      .set("Authorization", `Bearer ${token}`)
      .send({ word: "clever123", definition: "quick to learn" });

    expect(res.statusCode).toBe(400);
    expect(vocabModel.add).not.toHaveBeenCalled();
  });

  test("returns 400 when the definition is missing", async () => {
    const res = await request(app)
      .post("/api/vocab")
      .set("Authorization", `Bearer ${token}`)
      .send({ word: "clever" });

    expect(res.statusCode).toBe(400);
    expect(vocabModel.add).not.toHaveBeenCalled();
  });

  test("returns 201 and saves the word for a valid body", async () => {
    vocabModel.add.mockResolvedValue({ lastID: 5, changes: 1 });

    const res = await request(app)
      .post("/api/vocab")
      .set("Authorization", `Bearer ${token}`)
      .send(validBody);

    expect(res.statusCode).toBe(201);
    expect(res.body).toEqual({
      word: "clever",
      phonetic: "/ˈklɛvə/",
      definition: "Quick to understand, learn, and devise or apply ideas.",
      definition_pos: null,
      ko: null,
    });
    expect(vocabModel.add).toHaveBeenCalledWith(
      1,
      "clever",
      "/ˈklɛvə/",
      "Quick to understand, learn, and devise or apply ideas.",
      null,
      null
    );
  });

  test("saves the part of speech of the English definition", async () => {
    vocabModel.add.mockResolvedValue({ lastID: 8, changes: 1 });

    const res = await request(app)
      .post("/api/vocab")
      .set("Authorization", `Bearer ${token}`)
      .send({ ...validBody, definition_pos: "  adjective  " });

    expect(res.statusCode).toBe(201);
    expect(res.body.definition_pos).toBe("adjective");
    expect(vocabModel.add).toHaveBeenCalledWith(
      1, "clever", "/ˈklɛvə/", validBody.definition, null, "adjective"
    );
  });

  test("drops the part of speech when there is no English definition", async () => {
    vocabModel.add.mockResolvedValue({ lastID: 9, changes: 1 });

    const res = await request(app)
      .post("/api/vocab")
      .set("Authorization", `Bearer ${token}`)
      .send({ word: "thee", definition_pos: "pronoun", ko: [{ pos: "고어", ko: ["너를"], own: true }] });

    expect(res.statusCode).toBe(201);
    expect(res.body.definition_pos).toBeNull();
    expect(vocabModel.add.mock.calls[0][5]).toBeNull();
  });

  test("saves Korean meanings (cleaned) next to the English definition", async () => {
    vocabModel.add.mockResolvedValue({ lastID: 6, changes: 1 });
    const ko = [
      { pos: "형용사", ko: ["영리한, 똑똑한."], own: true, extra: "dropped" },
      { pos: "명사", ko: ["", "  "] },            // no usable meaning: skipped
      "not an object",
    ];

    const res = await request(app)
      .post("/api/vocab")
      .set("Authorization", `Bearer ${token}`)
      .send({ ...validBody, ko });

    expect(res.statusCode).toBe(201);
    expect(res.body.ko).toEqual([{ pos: "형용사", ko: ["영리한, 똑똑한."], own: true }]);
    expect(vocabModel.add).toHaveBeenCalledWith(
      1, "clever", "/ˈklɛvə/", validBody.definition,
      JSON.stringify([{ pos: "형용사", ko: ["영리한, 똑똑한."], own: true }]),
      null
    );
  });

  test("accepts Korean meanings without an English definition", async () => {
    vocabModel.add.mockResolvedValue({ lastID: 7, changes: 1 });

    const res = await request(app)
      .post("/api/vocab")
      .set("Authorization", `Bearer ${token}`)
      .send({ word: "thee", ko: [{ pos: "고어", ko: ["너를, 너에게"], own: true }] });

    expect(res.statusCode).toBe(201);
    expect(vocabModel.add.mock.calls[0][3]).toBe("");
  });

  test("returns 400 when there is neither a definition nor usable Korean meanings", async () => {
    const res = await request(app)
      .post("/api/vocab")
      .set("Authorization", `Bearer ${token}`)
      .send({ word: "clever", ko: [{ pos: "명사", ko: [] }] });

    expect(res.statusCode).toBe(400);
    expect(vocabModel.add).not.toHaveBeenCalled();
  });

  test("ignores a duplicate word without error", async () => {
    vocabModel.add.mockResolvedValue({ lastID: 0, changes: 0 });

    const res = await request(app)
      .post("/api/vocab")
      .set("Authorization", `Bearer ${token}`)
      .send(validBody);

    expect(res.statusCode).toBe(201);
    expect(vocabModel.add).toHaveBeenCalledTimes(1);
  });
});

describe("DELETE /api/vocab/:id", () => {
  test("returns 401 when no Authorization header is sent", async () => {
    const res = await request(app).delete("/api/vocab/1");

    expect(res.statusCode).toBe(401);
    expect(vocabModel.remove).not.toHaveBeenCalled();
  });

  test("returns 400 when the id is not a positive integer", async () => {
    const res = await request(app)
      .delete("/api/vocab/abc")
      .set("Authorization", `Bearer ${token}`);

    expect(res.statusCode).toBe(400);
    expect(vocabModel.remove).not.toHaveBeenCalled();
  });

  test("returns 204 with an empty body when the word is deleted", async () => {
    vocabModel.remove.mockResolvedValue({ changes: 1 });

    const res = await request(app)
      .delete("/api/vocab/1")
      .set("Authorization", `Bearer ${token}`);

    expect(res.statusCode).toBe(204);
    expect(res.body).toEqual({});
    expect(vocabModel.remove).toHaveBeenCalledWith(1, 1);
  });
});