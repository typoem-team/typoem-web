const request = require('supertest');
const path = require('path');

process.env.JWT_SECRET = 'test-secret';
process.env.JWT_EXPIRES_IN = '1h';

// Mock the users model with a tiny in-memory store so the tests never touch
// SQLite. It mimics the real model (auto-increment id + unique username), so
// the register -> login -> /me flow below works exactly as before.
jest.mock('../../models/usersModel', () => {
  class UsernameTakenError extends Error {
    constructor(username) {
      super(`Username "${username}" is already taken`);
      this.name = 'UsernameTakenError';
    }
  }
  const users = [];
  return {
    UsernameTakenError,
    create: jest.fn(async ({ username, nickname, password_hash }) => {
      if (users.some((u) => u.username === username)) {
        throw new UsernameTakenError(username);
      }
      const user = { id: users.length + 1, username, nickname, password_hash, created_at: '2026-11-02 10:15:00' };
      users.push(user);
      return { lastID: user.id };
    }),
    findByUsername: jest.fn(async (username) =>
      users.find((u) => u.username === username)
    ),
    findById: jest.fn(async (id) => users.find((u) => u.id === id)),
  };
});

// app must be required AFTER the mock is registered
const app = require('../../app');

// POST /api/auth/register
describe('POST /api/auth/register', () => {
  test('201 — creates a new user and returns id/username/nickname', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'alice', nickname: 'Alice', password: 'password123' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ username: 'alice', nickname: 'Alice' });
    expect(res.body).toHaveProperty('id');
    // password must NOT be returned
    expect(res.body).not.toHaveProperty('password');
    expect(res.body).not.toHaveProperty('password_hash');
  });

  test('400 — missing required field (no password)', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'bob', nickname: 'Bob' });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  test('201 — a 2-character nickname is allowed', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'dana', nickname: '지섭', password: 'password123' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ username: 'dana', nickname: '지섭' });
  });

  test('400 — a 1-character nickname is too short', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'erin', nickname: 'E', password: 'password123' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/2-20/);
  });

  test('400 — username too short', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'ab', nickname: 'Bob', password: 'password123' });

    expect(res.status).toBe(400);
  });

  test('400 — invalid characters in username', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'ali$ce', nickname: 'Alice', password: 'password123' });

    expect(res.status).toBe(400);
  });

  test('409 — duplicate username', async () => {
    // alice was already registered in the first test of this block
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'alice', nickname: 'Another', password: 'password456' });

    expect(res.status).toBe(409);
    expect(res.body).toHaveProperty('error');
  });
});

// POST /api/auth/login
describe('POST /api/auth/login', () => {
  beforeAll(async () => {
    // make sure 'carol' exists for login tests
    await request(app)
      .post('/api/auth/register')
      .send({ username: 'carol', nickname: 'Carol', password: 'mypassword1' });
  });

  test('200 — returns JWT token and user info on valid credentials', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'carol', password: 'mypassword1' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
    expect(res.body.user).toMatchObject({ username: 'carol', nickname: 'Carol' });
  });

  test('400 — missing password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'carol' });

    expect(res.status).toBe(400);
  });

  test('401 — user does not exist', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'nobody', password: 'password123' });

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  test('401 — wrong password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'carol', password: 'wrongpassword' });

    expect(res.status).toBe(401);
  });
});

// GET /api/users/me
describe('GET /api/users/me', () => {
  let token;

  beforeAll(async () => {
    // register + login to get a real token
    await request(app)
      .post('/api/auth/register')
      .send({ username: 'dave', nickname: 'Dave', password: 'davepass1' });

    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ username: 'dave', password: 'davepass1' });

    token = loginRes.body.token;
  });

  test('200 — returns current user profile with valid token', async () => {
    const res = await request(app)
      .get('/api/users/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ username: 'dave', nickname: 'Dave' });
    expect(res.body).not.toHaveProperty('password_hash');
  });

  test('200 — includes created_at (sign-up time) for 함께한 날', async () => {
    const res = await request(app)
      .get('/api/users/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.created_at).toBe('2026-11-02 10:15:00');
  });

  test('200 — created_at is null when the user has none', async () => {
    // the auth middleware reads the user too, so swap the lookup for this request only
    const usersModel = require('../../models/usersModel');
    const original = usersModel.findById.getMockImplementation();
    usersModel.findById.mockImplementation(async (id) => {
      const u = await original(id);
      return u && { ...u, created_at: undefined };
    });

    let res;
    try {
      res = await request(app)
        .get('/api/users/me')
        .set('Authorization', `Bearer ${token}`);
    } finally {
      usersModel.findById.mockImplementation(original);
    }

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('created_at', null);
  });

  test('401 — no Authorization header', async () => {
    const res = await request(app).get('/api/users/me');

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  test('401 — malformed / invalid token', async () => {
    const res = await request(app)
      .get('/api/users/me')
      .set('Authorization', 'Bearer this.is.garbage');

    expect(res.status).toBe(401);
  });
});