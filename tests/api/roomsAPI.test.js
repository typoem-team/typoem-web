const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../../app");

// Replace the rooms model with auto-mocks. jest.mock is hoisted to the top of
// the file, so it runs before app.js finishes loading the controllers.
jest.mock("../../models/roomsModel");
const roomsModel = require("../../models/roomsModel");
// authMiddleware now looks up the token's user in the DB (#41),
// so the users model must be mocked here too.
jest.mock("../../models/usersModel");
const usersModel = require("../../models/usersModel");

// Sign a valid token once. JWT_SECRET is set by tests/setup.js before this
// file loads, so we can sign tokens directly without going through login.
const token = jwt.sign(
  { id: 1, username: "alice" },
  process.env.JWT_SECRET,
  { expiresIn: "1h" }
);

// Reset mock state between tests so calls/return values don't leak.
beforeEach(() => {
  jest.clearAllMocks();
  usersModel.findById.mockResolvedValue({ id: 1, username: "alice", nickname: "Alice" });
  roomsModel.countOwnedRooms.mockResolvedValue(0);
  roomsModel.countMemberships.mockResolvedValue(0);
});

// -----------------------------------------------------------------------------
// POST /api/rooms — create a room
// -----------------------------------------------------------------------------
describe("POST /api/rooms", () => {
  test("returns 401 when no Authorization header is sent", async () => {
    // Act
    const res = await request(app).post("/api/rooms").send({ name: "My Room" });

    // Assert
    expect(res.statusCode).toBe(401);
    // Middleware rejects first — the model is never touched.
    expect(roomsModel.createRoom).not.toHaveBeenCalled();
  });

  test("returns 400 when name is missing", async () => {
    // Act
    const res = await request(app)
      .post("/api/rooms")
      .set("Authorization", `Bearer ${token}`)
      .send({});

    // Assert
    expect(res.statusCode).toBe(400);
    expect(roomsModel.createRoom).not.toHaveBeenCalled();
  });

  test("returns 201 with the created room when token and body are valid", async () => {
    // Arrange: model returns the new room
    const created = {
      id: 10,
      name: "My Room",
      description: null,
      invite_code: "ABC123",
      owner_id: 1,
    };
    roomsModel.createRoom.mockResolvedValue(created);

    // Act
    const res = await request(app)
      .post("/api/rooms")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "My Room" });

    // Assert
    expect(res.statusCode).toBe(201);
    expect(res.body).toEqual(created);
    expect(roomsModel.createRoom).toHaveBeenCalledWith({
      name: "My Room",
      description: null,
      owner_id: 1,
    });
  });

  test("returns 403 when the user already owns the max number of rooms", async () => {
    // Arrange: user is at the owner limit
    roomsModel.countOwnedRooms.mockResolvedValue(3);

    // Act
    const res = await request(app)
      .post("/api/rooms")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "My Room" });

    // Assert
    expect(res.statusCode).toBe(403);
    expect(roomsModel.createRoom).not.toHaveBeenCalled();
  });

  test("returns 403 when the user is already in the max number of rooms", async () => {
    // Arrange: owner limit ok, but membership limit reached
    roomsModel.countOwnedRooms.mockResolvedValue(1);
    roomsModel.countMemberships.mockResolvedValue(5);

    // Act
    const res = await request(app)
      .post("/api/rooms")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "My Room" });

    // Assert
    expect(res.statusCode).toBe(403);
    expect(roomsModel.createRoom).not.toHaveBeenCalled();
  });

});

// -----------------------------------------------------------------------------
// POST /api/rooms/join — join a room by invite code
// -----------------------------------------------------------------------------
describe("POST /api/rooms/join", () => {
  test("returns 401 when no Authorization header is sent", async () => {
    // Act
    const res = await request(app)
      .post("/api/rooms/join")
      .send({ invite_code: "ABC123" });

    // Assert
    expect(res.statusCode).toBe(401);
    expect(roomsModel.findByInviteCode).not.toHaveBeenCalled();
  });

  test("returns 404 when the invite code matches no room", async () => {
    // Arrange: no room found for that code
    roomsModel.findByInviteCode.mockResolvedValue(undefined);

    // Act
    const res = await request(app)
      .post("/api/rooms/join")
      .set("Authorization", `Bearer ${token}`)
      .send({ invite_code: "NOPE99" });

    // Assert
    expect(res.statusCode).toBe(404);
    // We never try to add a member if the room wasn't found.
    expect(roomsModel.addMember).not.toHaveBeenCalled();
  });

  test("returns 201 when the user joins successfully", async () => {
    // Arrange: room exists, addMember succeeds
    const room = {
      id: 5,
      name: "Poetry Room",
      description: "daily poems",
      invite_code: "ABC123",
      owner_id: 2,
    };
    roomsModel.findByInviteCode.mockResolvedValue(room);
    roomsModel.addMember.mockResolvedValue({ lastID: 99 });

    // Act
    const res = await request(app)
      .post("/api/rooms/join")
      .set("Authorization", `Bearer ${token}`)
      .send({ invite_code: "ABC123" });

    // Assert
    expect(res.statusCode).toBe(201);
    expect(res.body).toMatchObject({ id: 5, name: "Poetry Room" });
    expect(roomsModel.addMember).toHaveBeenCalledWith({
      room_id: 5,
      user_id: 1,
      role: "member",
    });
  });

  test("returns 409 when the user is already a member", async () => {
    // Arrange: room exists, but addMember throws AlreadyMemberError
    const room = { id: 5, name: "Poetry Room", invite_code: "ABC123", owner_id: 2 };
    roomsModel.findByInviteCode.mockResolvedValue(room);
    roomsModel.addMember.mockImplementation(() => {
      throw new roomsModel.AlreadyMemberError();
    });

    // Act
    const res = await request(app)
      .post("/api/rooms/join")
      .set("Authorization", `Bearer ${token}`)
      .send({ invite_code: "ABC123" });

    // Assert
    expect(res.statusCode).toBe(409);
  });

  test("returns 403 when the user is already in the max number of rooms", async () => {
    // Arrange: room exists, but user is at the membership limit
    roomsModel.findByInviteCode.mockResolvedValue({
      id: 7, name: "Full", description: null, invite_code: "ABC123", owner_id: 2,
    });
    roomsModel.countMemberships.mockResolvedValue(5);

    // Act
    const res = await request(app)
      .post("/api/rooms/join")
      .set("Authorization", `Bearer ${token}`)
      .send({ invite_code: "ABC123" });

    // Assert
    expect(res.statusCode).toBe(403);
    expect(roomsModel.addMember).not.toHaveBeenCalled();
  });

});

// -----------------------------------------------------------------------------
// DELETE /api/rooms/:id/leave — leave a room
// -----------------------------------------------------------------------------
describe("DELETE /api/rooms/:id/leave", () => {
  test("returns 401 when no Authorization header is sent", async () => {
    // Act
    const res = await request(app).delete("/api/rooms/5/leave");

    // Assert
    expect(res.statusCode).toBe(401);
    expect(roomsModel.removeMember).not.toHaveBeenCalled();
  });

  test("returns 404 when the room does not exist", async () => {
    // Arrange: no room with that id
    roomsModel.findById.mockResolvedValue(undefined);

    // Act
    const res = await request(app)
      .delete("/api/rooms/999/leave")
      .set("Authorization", `Bearer ${token}`);

    // Assert
    expect(res.statusCode).toBe(404);
    expect(roomsModel.removeMember).not.toHaveBeenCalled();
  });

  test("returns 400 when the owner tries to leave", async () => {
    // Arrange: room exists and the current user (id 1) is the owner
    roomsModel.findById.mockResolvedValue({ id: 5, name: "Room", owner_id: 1 });

    // Act
    const res = await request(app)
      .delete("/api/rooms/5/leave")
      .set("Authorization", `Bearer ${token}`);

    // Assert
    expect(res.statusCode).toBe(400);
    expect(roomsModel.removeMember).not.toHaveBeenCalled();
  });

  test("returns 403 when the user is not a member of the room", async () => {
    // Arrange: room exists, owner is someone else, but the user is NOT a member
    roomsModel.findById.mockResolvedValue({ id: 5, name: "Room", owner_id: 2 });
    roomsModel.isMember.mockResolvedValue(false);

    // Act
    const res = await request(app)
      .delete("/api/rooms/5/leave")
      .set("Authorization", `Bearer ${token}`);

    // Assert
    expect(res.statusCode).toBe(403);
    // Not a member → we never remove anyone.
    expect(roomsModel.removeMember).not.toHaveBeenCalled();
  });
  
  test("returns 204 when a member leaves successfully", async () => {
    // Arrange: room exists, owner is someone else, current user is a member
    roomsModel.findById.mockResolvedValue({ id: 5, name: "Room", owner_id: 2 });
    roomsModel.isMember.mockResolvedValue(true);
    roomsModel.removeMember.mockResolvedValue({ changes: 1 });

    // Act
    const res = await request(app)
      .delete("/api/rooms/5/leave")
      .set("Authorization", `Bearer ${token}`);

    // Assert
    expect(res.statusCode).toBe(204);
    expect(res.body).toEqual({});
    expect(roomsModel.removeMember).toHaveBeenCalledWith(5, 1);
  });
});

// -----------------------------------------------------------------------------
// GET /api/rooms/:id/members — list members (membership required)
// -----------------------------------------------------------------------------
describe("GET /api/rooms/:id/members", () => {
  test("returns 401 when no Authorization header is sent", async () => {
    // Act
    const res = await request(app).get("/api/rooms/5/members");

    // Assert
    expect(res.statusCode).toBe(401);
    expect(roomsModel.listMembers).not.toHaveBeenCalled();
  });

  test("returns 404 when the room does not exist", async () => {
    // Arrange
    roomsModel.findById.mockResolvedValue(undefined);

    // Act
    const res = await request(app)
      .get("/api/rooms/999/members")
      .set("Authorization", `Bearer ${token}`);

    // Assert
    expect(res.statusCode).toBe(404);
    expect(roomsModel.listMembers).not.toHaveBeenCalled();
  });

  test("returns 403 when the user is not a member of the room", async () => {
    // Arrange: room exists, but the current user is NOT a member
    roomsModel.findById.mockResolvedValue({ id: 5, name: "Room", owner_id: 2 });
    roomsModel.isMember.mockResolvedValue(false);

    // Act
    const res = await request(app)
      .get("/api/rooms/5/members")
      .set("Authorization", `Bearer ${token}`);

    // Assert
    expect(res.statusCode).toBe(403);
    // Not a member → we never list the members.
    expect(roomsModel.listMembers).not.toHaveBeenCalled();
  });

  test("returns 200 with the member list when the user is a member", async () => {
    // Arrange: room exists and the user is a member
    roomsModel.findById.mockResolvedValue({ id: 5, name: "Room", owner_id: 2 });
    roomsModel.isMember.mockResolvedValue(true);
    const members = [
      { id: 1, username: "alice", nickname: "Alice", role: "member" },
      { id: 2, username: "bob", nickname: "Bob", role: "owner" },
    ];
    roomsModel.listMembers.mockResolvedValue(members);

    // Act
    const res = await request(app)
      .get("/api/rooms/5/members")
      .set("Authorization", `Bearer ${token}`);

    // Assert
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(members);
    expect(roomsModel.listMembers).toHaveBeenCalledWith(5);
  });
});
// -----------------------------------------------------------------------------
// POST /api/rooms/:id/open  (Rooms tab -> the home shows this room)
// -----------------------------------------------------------------------------
describe("POST /api/rooms/:id/open", () => {
  test("204 and records the room as opened last", async () => {
    roomsModel.findById.mockResolvedValue({ id: 5, name: "r", owner_id: 2 });
    roomsModel.isMember.mockResolvedValue(true);
    const res = await request(app).post("/api/rooms/5/open").set("Authorization", `Bearer ${token}`);
    expect(res.statusCode).toBe(204);
    expect(roomsModel.markOpened).toHaveBeenCalledWith(5, 1);
  });

  test("400 on an invalid id", async () => {
    const res = await request(app).post("/api/rooms/abc/open").set("Authorization", `Bearer ${token}`);
    expect(res.statusCode).toBe(400);
  });

  test("404 when the room does not exist", async () => {
    roomsModel.findById.mockResolvedValue(undefined);
    roomsModel.isMember.mockResolvedValue(false);
    const res = await request(app).post("/api/rooms/5/open").set("Authorization", `Bearer ${token}`);
    expect(res.statusCode).toBe(404);
    expect(roomsModel.markOpened).not.toHaveBeenCalled();
  });

  test("403 when not a member", async () => {
    roomsModel.findById.mockResolvedValue({ id: 5, name: "r", owner_id: 2 });
    roomsModel.isMember.mockResolvedValue(false);
    const res = await request(app).post("/api/rooms/5/open").set("Authorization", `Bearer ${token}`);
    expect(res.statusCode).toBe(403);
    expect(roomsModel.markOpened).not.toHaveBeenCalled();
  });
});
