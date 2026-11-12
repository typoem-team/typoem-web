// CORS for the Capacitor app (https://localhost): the preflight answer is cached.
const request = require("supertest");
const app = require("../../app");

test("app preflight is allowed and cached for 2 hours", async () => {
  const res = await request(app)
    .options("/api/rooms/mine")
    .set("Origin", "https://localhost")
    .set("Access-Control-Request-Method", "GET")
    .set("Access-Control-Request-Headers", "authorization,content-type");

  expect(res.statusCode).toBe(204);
  expect(res.headers["access-control-allow-origin"]).toBe("https://localhost");
  expect(res.headers["access-control-max-age"]).toBe("7200");
});

test("an unknown origin gets no CORS headers", async () => {
  const res = await request(app)
    .options("/api/rooms/mine")
    .set("Origin", "https://evil.example")
    .set("Access-Control-Request-Method", "GET");

  expect(res.headers["access-control-allow-origin"]).toBeUndefined();
});
