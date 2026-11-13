const bcrypt = require('bcrypt');

// mock usersModel before requiring the controller
jest.mock('../../models/usersModel', () => {
  class UsernameTakenError extends Error {}
  return {
    UsernameTakenError,
    create: jest.fn(),
    findByUsername: jest.fn(),
  };
});

const model = require('../../models/usersModel');
const { register, login } = require('../../controllers/authController');

// helpers
function makeReq(body = {}) {
  return { body };
}

function makeRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

beforeAll(() => {
  process.env.JWT_SECRET = 'test-secret';
  process.env.JWT_EXPIRES_IN = '1h';
});

afterEach(() => {
  jest.clearAllMocks();
});

// register 
describe('register controller', () => {
  test('201 on valid input', async () => {
    model.create.mockResolvedValue({ lastID: 42 });
    const req = makeReq({ username: 'alice', nickname: 'Alice', password: 'password123' });
    const res = makeRes();

    await register(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ id: 42, username: 'alice', nickname: 'Alice' })
    );
  });

  test('400 when username is missing', async () => {
    const req = makeReq({ nickname: 'Alice', password: 'password123' });
    const res = makeRes();

    await register(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(model.create).not.toHaveBeenCalled();
  });

  test('400 when password is missing', async () => {
    const req = makeReq({ username: 'alice', nickname: 'Alice' });
    const res = makeRes();

    await register(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('400 when username contains whitespace', async () => {
    const req = makeReq({ username: 'ali ce', nickname: 'Alice', password: 'password123' });
    const res = makeRes();

    await register(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('400 when username is too short (< 3 chars)', async () => {
    const req = makeReq({ username: 'ab', nickname: 'Alice', password: 'password123' });
    const res = makeRes();

    await register(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('400 when password is too short (< 8 chars)', async () => {
    const req = makeReq({ username: 'alice', nickname: 'Alice', password: 'short' });
    const res = makeRes();

    await register(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('400 when username has invalid characters', async () => {
    const req = makeReq({ username: 'ali$ce', nickname: 'Alice', password: 'password123' });
    const res = makeRes();

    await register(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('409 when username is already taken', async () => {
    model.create.mockRejectedValue(new model.UsernameTakenError('taken'));
    const req = makeReq({ username: 'alice', nickname: 'Alice', password: 'password123' });
    const res = makeRes();

    await register(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
  });

  test('hashes the password before storing', async () => {
    model.create.mockResolvedValue({ lastID: 1 });
    const req = makeReq({ username: 'alice', nickname: 'Alice', password: 'password123' });
    const res = makeRes();

    await register(req, res);

    const storedHash = model.create.mock.calls[0][0].password_hash;
    const matches = await bcrypt.compare('password123', storedHash);
    expect(matches).toBe(true);
    // must NOT store plain text
    expect(storedHash).not.toBe('password123');
  });
});

// login
describe('login controller', () => {
  test('200 with token on valid credentials', async () => {
    const hash = await bcrypt.hash('password123', 1);
    model.findByUsername.mockResolvedValue({
      id: 1, username: 'alice', nickname: 'Alice', password_hash: hash, created_at: '2026-11-13 01:02:03',
    });
    const req = makeReq({ username: 'alice', password: 'password123' });
    const res = makeRes();

    await login(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body).toHaveProperty('token');
    expect(body.user).toMatchObject({ id: 1, username: 'alice', nickname: 'Alice', created_at: '2026-11-13 01:02:03' });
    expect(body.user).not.toHaveProperty('password_hash');
  });

  test('400 when username or password is missing', async () => {
    const req = makeReq({ username: 'alice' });
    const res = makeRes();

    await login(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(model.findByUsername).not.toHaveBeenCalled();
  });

  test('401 when user does not exist', async () => {
    model.findByUsername.mockResolvedValue(null);
    const req = makeReq({ username: 'ghost', password: 'password123' });
    const res = makeRes();

    await login(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('401 when password is wrong', async () => {
    const hash = await bcrypt.hash('correctpassword', 1);
    model.findByUsername.mockResolvedValue({
      id: 1, username: 'alice', nickname: 'Alice', password_hash: hash,
    });
    const req = makeReq({ username: 'alice', password: 'wrongpassword' });
    const res = makeRes();

    await login(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
  });
});