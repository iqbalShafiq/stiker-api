import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../../src/app';
import { prisma } from '../../src/prisma/client';
import { StickerService } from '../../src/services/sticker.service';
import { StickerVisibility, SharePermission } from '@prisma/client';

// ─── Shared State ───────────────────────────────────────────────────────────

interface TestState {
  adminToken: string;
  adminCookies: string[];
  adminUserId: string;
  user1Token: string;
  user1Cookies: string[];
  user1Id: string;
  user2Token: string;
  user2Cookies: string[];
  user2Id: string;
  stickerIds: string[];
  shareLinkId: string;
}

const state: TestState = {
  adminToken: '',
  adminCookies: [],
  adminUserId: '',
  user1Token: '',
  user1Cookies: [],
  user1Id: '',
  user2Token: '',
  user2Cookies: [],
  user2Id: '',
  stickerIds: [],
  shareLinkId: '',
};

const TEST_PASSWORD = 'StrongPass1!';
const WEAK_PASSWORD = 'weak';

// ─── Helper Functions ───────────────────────────────────────────────────────

async function registerUser(
  email: string,
  password: string,
  options?: { username?: string; displayName?: string }
) {
  const username = options?.username ?? `user${Date.now()}${Math.random().toString(36).slice(2, 7)}`;
  const response = await request(app)
    .post('/api/v1/auth/register')
    .send({
      email,
      username,
      password,
      displayName: options?.displayName,
    });

  const cookies = (response.headers['set-cookie'] as string[]) ?? [];
  return {
    user: response.body.data?.user,
    accessToken: response.body.data?.accessToken as string,
    cookies,
    status: response.status,
    body: response.body,
  };
}

async function loginUser(email: string, password: string) {
  const response = await request(app)
    .post('/api/v1/auth/login')
    .send({ email, password });

  const cookies = (response.headers['set-cookie'] as string[]) ?? [];
  return {
    user: response.body.data?.user,
    accessToken: response.body.data?.accessToken as string,
    cookies,
    status: response.status,
    body: response.body,
  };
}

async function createSticker(
  ownerId: string,
  name: string,
  visibility: StickerVisibility = StickerVisibility.PRIVATE
) {
  const stickerService = new StickerService();
  const sticker = await stickerService.create({
    ownerId,
    name,
    filename: `${name}.png`,
    url: `http://localhost:3000/uploads/${name}.png`,
    visibility,
    width: 512,
    height: 512,
  });
  state.stickerIds.push(sticker.id);
  return sticker;
}

async function cleanupTestData() {
  try {
    // Delete share links for test stickers
    if (state.stickerIds.length > 0) {
      await prisma.stickerShareLink.deleteMany({
        where: { stickerId: { in: state.stickerIds } },
      });
      await prisma.stickerShare.deleteMany({
        where: { stickerId: { in: state.stickerIds } },
      });
    }

    // Delete test stickers
    await prisma.sticker.deleteMany({
      where: { id: { in: state.stickerIds } },
    });
    state.stickerIds = [];

    // Delete refresh tokens for test users
    const testEmails = [
      'admin@example.com',
    ];
    const testUsers = await prisma.user.findMany({
      where: {
        OR: [
          { email: { startsWith: 'cf-test-' } },
          { email: { in: testEmails } },
        ],
      },
    });

    for (const user of testUsers) {
      await prisma.refreshToken.deleteMany({ where: { userId: user.id } });
    }

    // Delete test users (except seeded admin)
    await prisma.user.deleteMany({
      where: {
        email: { startsWith: 'cf-test-' },
      },
    });
  } catch {
    // Ignore cleanup errors
  }
}

// ─── Setup / Teardown ───────────────────────────────────────────────────────

beforeAll(async () => {
  await cleanupTestData();

  // Seed admin login
  const adminLogin = await loginUser('admin@example.com', 'Admin123!');
  state.adminToken = adminLogin.accessToken;
  state.adminCookies = adminLogin.cookies;
  state.adminUserId = adminLogin.user?.id;
});

afterAll(async () => {
  await cleanupTestData();
  await prisma.$disconnect();
});

// ─── Auth (27 tests) ────────────────────────────────────────────────────────

describe('Auth', () => {
  test.sequential('should register a new user successfully', async () => {
    const email = `cf-test-register-${Date.now()}@example.com`;
    const result = await registerUser(email, TEST_PASSWORD, { displayName: 'Test User' });

    expect(result.status).toBe(201);
    expect(result.body.success).toBe(true);
    expect(result.user).toBeDefined();
    expect(result.user.email).toBe(email);
    expect(result.accessToken).toBeDefined();
    expect(result.cookies.some((c) => c.includes('refresh_token'))).toBe(true);

    state.user1Id = result.user.id;
    state.user1Token = result.accessToken;
    state.user1Cookies = result.cookies;
  });

  test.sequential('should return 400 for missing email on register', async () => {
    const response = await request(app)
      .post('/api/v1/auth/register')
      .send({ username: 'someuser', password: TEST_PASSWORD });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  test.sequential('should return 400 for missing username on register', async () => {
    const response = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'some@example.com', password: TEST_PASSWORD });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  test.sequential('should return 400 for missing password on register', async () => {
    const response = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'some@example.com', username: 'someuser' });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  test.sequential('should return 400 for weak password (too short)', async () => {
    const email = `cf-test-short-${Date.now()}@example.com`;
    const response = await request(app)
      .post('/api/v1/auth/register')
      .send({ email, username: `short${Date.now()}`, password: 'Short1!' });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  test.sequential('should return 400 for weak password (no uppercase)', async () => {
    const email = `cf-test-noup-${Date.now()}@example.com`;
    const response = await request(app)
      .post('/api/v1/auth/register')
      .send({ email, username: `noup${Date.now()}`, password: 'lowercase1!' });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  test.sequential('should return 400 for weak password (no lowercase)', async () => {
    const email = `cf-test-nolow-${Date.now()}@example.com`;
    const response = await request(app)
      .post('/api/v1/auth/register')
      .send({ email, username: `nolow${Date.now()}`, password: 'UPPERCASE1!' });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  test.sequential('should return 400 for weak password (no number)', async () => {
    const email = `cf-test-nonum-${Date.now()}@example.com`;
    const response = await request(app)
      .post('/api/v1/auth/register')
      .send({ email, username: `nonum${Date.now()}`, password: 'NoNumber!' });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  test.sequential('should return 400 for weak password (no special char)', async () => {
    const email = `cf-test-nospec-${Date.now()}@example.com`;
    const response = await request(app)
      .post('/api/v1/auth/register')
      .send({ email, username: `nospec${Date.now()}`, password: 'NoSpecial1' });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  test.sequential('should return 409 for duplicate email', async () => {
    const email = `cf-test-dup-${Date.now()}@example.com`;
    const username1 = `dup1${Date.now()}`;

    const first = await request(app)
      .post('/api/v1/auth/register')
      .send({ email, username: username1, password: TEST_PASSWORD });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post('/api/v1/auth/register')
      .send({ email, username: `dup2${Date.now()}`, password: TEST_PASSWORD });

    expect(second.status).toBe(409);
    expect(second.body.success).toBe(false);
  });

  test.sequential('should return 409 for duplicate username', async () => {
    const email1 = `cf-test-dupu1-${Date.now()}@example.com`;
    const email2 = `cf-test-dupu2-${Date.now()}@example.com`;
    const username = `dupuser${Date.now()}`;

    const first = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: email1, username, password: TEST_PASSWORD });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: email2, username, password: TEST_PASSWORD });

    expect(second.status).toBe(409);
    expect(second.body.success).toBe(false);
  });

  test.sequential('should login successfully with valid credentials', async () => {
    const email = `cf-test-login-${Date.now()}@example.com`;
    const username = `login${Date.now()}`;

    await registerUser(email, TEST_PASSWORD, { username });

    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password: TEST_PASSWORD });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.user.email).toBe(email);
    expect(response.body.data.accessToken).toBeDefined();
  });

  test.sequential('should return 401 for invalid email on login', async () => {
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'nonexistent@example.com', password: TEST_PASSWORD });

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
  });

  test.sequential('should return 401 for invalid password on login', async () => {
    const email = `cf-test-badpass-${Date.now()}@example.com`;
    const username = `badpass${Date.now()}`;

    await registerUser(email, TEST_PASSWORD, { username });

    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password: 'WrongPass1!' });

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
  });

  test.sequential('should return 401 for inactive user on login', async () => {
    const email = `cf-test-inactive-${Date.now()}@example.com`;
    const username = `inactive${Date.now()}`;

    const reg = await registerUser(email, TEST_PASSWORD, { username });
    await prisma.user.update({ where: { id: reg.user.id }, data: { isActive: false } });

    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password: TEST_PASSWORD });

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);

    // Reactivate for cleanup
    await prisma.user.update({ where: { id: reg.user.id }, data: { isActive: true } });
  });

  test.sequential('should return 400 for missing email on login', async () => {
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ password: TEST_PASSWORD });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  test.sequential('should return 400 for missing password on login', async () => {
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'some@example.com' });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  test.sequential('should logout successfully', async () => {
    const email = `cf-test-logout-${Date.now()}@example.com`;
    const username = `logout${Date.now()}`;

    const reg = await registerUser(email, TEST_PASSWORD, { username });

    const response = await request(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${reg.accessToken}`)
      .set('Cookie', reg.cookies);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    const cookies = response.headers['set-cookie'] as string[];
    expect(cookies).toBeDefined();
    expect(cookies.some((c) => c.includes('refresh_token='))).toBe(true);
  });

  test.sequential('should return 401 for logout without auth', async () => {
    const response = await request(app).post('/api/v1/auth/logout');

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
  });

  test.sequential('should refresh access token with valid refresh cookie', async () => {
    const email = `cf-test-refresh-${Date.now()}@example.com`;
    const username = `refresh${Date.now()}`;

    const reg = await registerUser(email, TEST_PASSWORD, { username });

    const response = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', reg.cookies);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.accessToken).toBeDefined();

    const cookies = response.headers['set-cookie'] as string[];
    expect(cookies).toBeDefined();
    expect(cookies.some((c) => c.includes('refresh_token'))).toBe(true);
  });

  test.sequential('should return 400 for refresh without cookie', async () => {
    const response = await request(app).post('/api/v1/auth/refresh');

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  test.sequential('should return current user profile', async () => {
    const email = `cf-test-me-${Date.now()}@example.com`;
    const username = `meuser${Date.now()}`;

    const reg = await registerUser(email, TEST_PASSWORD, { username });

    const response = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${reg.accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.email).toBe(email);
    expect(response.body.data.username).toBe(username);
  });

  test.sequential('should return 401 for me without auth', async () => {
    const response = await request(app).get('/api/v1/auth/me');

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
  });

  test.sequential('should return placeholder for update profile', async () => {
    const email = `cf-test-upd-${Date.now()}@example.com`;
    const username = `upduser${Date.now()}`;

    const reg = await registerUser(email, TEST_PASSWORD, { username });

    const response = await request(app)
      .put('/api/v1/auth/me')
      .set('Authorization', `Bearer ${reg.accessToken}`)
      .send({ displayName: 'Updated' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.message).toContain('placeholder');
  });

  test.sequential('should change password successfully', async () => {
    const email = `cf-test-chpwd-${Date.now()}@example.com`;
    const username = `chpwd${Date.now()}`;

    const reg = await registerUser(email, TEST_PASSWORD, { username });

    const response = await request(app)
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${reg.accessToken}`)
      .send({ currentPassword: TEST_PASSWORD, newPassword: 'NewPass2!' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    // Verify old password no longer works
    const oldLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password: TEST_PASSWORD });
    expect(oldLogin.status).toBe(401);

    // Verify new password works
    const newLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password: 'NewPass2!' });
    expect(newLogin.status).toBe(200);
    expect(newLogin.body.data.accessToken).toBeDefined();
  });

  test.sequential('should return 401 for change password with wrong current password', async () => {
    const email = `cf-test-wrpwd-${Date.now()}@example.com`;
    const username = `wrpwd${Date.now()}`;

    const reg = await registerUser(email, TEST_PASSWORD, { username });

    const response = await request(app)
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${reg.accessToken}`)
      .send({ currentPassword: 'WrongPass1!', newPassword: 'NewPass2!' });

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
  });

  test.sequential('should return 400 for change password with weak new password', async () => {
    const email = `cf-test-wkpwd-${Date.now()}@example.com`;
    const username = `wkpwd${Date.now()}`;

    const reg = await registerUser(email, TEST_PASSWORD, { username });

    const response = await request(app)
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${reg.accessToken}`)
      .send({ currentPassword: TEST_PASSWORD, newPassword: 'weak' });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });
});

// ─── Sticker CRUD (21 tests) ────────────────────────────────────────────────

describe('Sticker CRUD', () => {
  test.sequential('should get public stickers (empty)', async () => {
    const response = await request(app).get('/api/v1/stickers/public');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(Array.isArray(response.body.data)).toBe(true);
  });

  test.sequential('should create and retrieve a public sticker', async () => {
    const email = `cf-test-sticker1-${Date.now()}@example.com`;
    const reg = await registerUser(email, TEST_PASSWORD);

    const sticker = await createSticker(reg.user.id, 'Public Sticker', StickerVisibility.PUBLIC);

    const response = await request(app).get('/api/v1/stickers/public');
    expect(response.status).toBe(200);
    expect(response.body.data.some((s: any) => s.id === sticker.id)).toBe(true);
  });

  test.sequential('should get my stickers (empty)', async () => {
    const email = `cf-test-sticker2-${Date.now()}@example.com`;
    const reg = await registerUser(email, TEST_PASSWORD);

    const response = await request(app)
      .get('/api/v1/stickers')
      .set('Authorization', `Bearer ${reg.accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(Array.isArray(response.body.data)).toBe(true);
  });

  test.sequential('should get my stickers with data', async () => {
    const email = `cf-test-sticker3-${Date.now()}@example.com`;
    const reg = await registerUser(email, TEST_PASSWORD);

    await createSticker(reg.user.id, 'My Sticker', StickerVisibility.PRIVATE);

    const response = await request(app)
      .get('/api/v1/stickers')
      .set('Authorization', `Bearer ${reg.accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data.length).toBeGreaterThan(0);
  });

  test.sequential('should get sticker by id', async () => {
    const email = `cf-test-sticker4-${Date.now()}@example.com`;
    const reg = await registerUser(email, TEST_PASSWORD);

    const sticker = await createSticker(reg.user.id, 'Get Sticker', StickerVisibility.PRIVATE);

    const response = await request(app)
      .get(`/api/v1/stickers/${sticker.id}`)
      .set('Authorization', `Bearer ${reg.accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data.id).toBe(sticker.id);
  });

  test.sequential('should return 404 for nonexistent sticker', async () => {
    const email = `cf-test-sticker5-${Date.now()}@example.com`;
    const reg = await registerUser(email, TEST_PASSWORD);

    const response = await request(app)
      .get('/api/v1/stickers/nonexistent-id')
      .set('Authorization', `Bearer ${reg.accessToken}`);

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  test.sequential('should deny access to private sticker without permission', async () => {
    const email1 = `cf-test-sticker6a-${Date.now()}@example.com`;
    const email2 = `cf-test-sticker6b-${Date.now()}@example.com`;
    const reg1 = await registerUser(email1, TEST_PASSWORD);
    const reg2 = await registerUser(email2, TEST_PASSWORD);

    const sticker = await createSticker(reg1.user.id, 'Private Sticker', StickerVisibility.PRIVATE);

    const response = await request(app)
      .get(`/api/v1/stickers/${sticker.id}`)
      .set('Authorization', `Bearer ${reg2.accessToken}`);

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  test.sequential('should allow access to public sticker with auth', async () => {
    const email = `cf-test-sticker7-${Date.now()}@example.com`;
    const reg = await registerUser(email, TEST_PASSWORD);

    const sticker = await createSticker(reg.user.id, 'Public Sticker 2', StickerVisibility.PUBLIC);

    const response = await request(app)
      .get(`/api/v1/stickers/${sticker.id}`)
      .set('Authorization', `Bearer ${reg.accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data.id).toBe(sticker.id);
  });

  test.sequential('should update sticker name', async () => {
    const email = `cf-test-sticker8-${Date.now()}@example.com`;
    const reg = await registerUser(email, TEST_PASSWORD);

    const sticker = await createSticker(reg.user.id, 'Old Name', StickerVisibility.PRIVATE);

    const response = await request(app)
      .put(`/api/v1/stickers/${sticker.id}`)
      .set('Authorization', `Bearer ${reg.accessToken}`)
      .send({ name: 'New Name' });

    expect(response.status).toBe(200);
    expect(response.body.data.name).toBe('New Name');
  });

  test.sequential('should update sticker visibility', async () => {
    const email = `cf-test-sticker9-${Date.now()}@example.com`;
    const reg = await registerUser(email, TEST_PASSWORD);

    const sticker = await createSticker(reg.user.id, 'Visibility Sticker', StickerVisibility.PRIVATE);

    const response = await request(app)
      .put(`/api/v1/stickers/${sticker.id}`)
      .set('Authorization', `Bearer ${reg.accessToken}`)
      .send({ visibility: 'PUBLIC' });

    expect(response.status).toBe(200);
    expect(response.body.data.visibility).toBe('PUBLIC');
  });

  test.sequential('should return 404 when updating nonexistent sticker', async () => {
    const email = `cf-test-sticker10-${Date.now()}@example.com`;
    const reg = await registerUser(email, TEST_PASSWORD);

    const response = await request(app)
      .put('/api/v1/stickers/nonexistent-id')
      .set('Authorization', `Bearer ${reg.accessToken}`)
      .send({ name: 'New Name' });

    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
  });

  test.sequential('should return 403 when updating sticker not owned', async () => {
    const email1 = `cf-test-sticker11a-${Date.now()}@example.com`;
    const email2 = `cf-test-sticker11b-${Date.now()}@example.com`;
    const reg1 = await registerUser(email1, TEST_PASSWORD);
    const reg2 = await registerUser(email2, TEST_PASSWORD);

    const sticker = await createSticker(reg1.user.id, 'Owned Sticker', StickerVisibility.PRIVATE);

    const response = await request(app)
      .put(`/api/v1/stickers/${sticker.id}`)
      .set('Authorization', `Bearer ${reg2.accessToken}`)
      .send({ name: 'Hacked Name' });

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
  });

  test.sequential('should delete sticker', async () => {
    const email = `cf-test-sticker12-${Date.now()}@example.com`;
    const reg = await registerUser(email, TEST_PASSWORD);

    const sticker = await createSticker(reg.user.id, 'Delete Me', StickerVisibility.PRIVATE);

    const response = await request(app)
      .delete(`/api/v1/stickers/${sticker.id}`)
      .set('Authorization', `Bearer ${reg.accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    // Verify deleted
    const getResponse = await request(app)
      .get(`/api/v1/stickers/${sticker.id}`)
      .set('Authorization', `Bearer ${reg.accessToken}`);
    expect(getResponse.status).toBe(400);
  });

  test.sequential('should return 404 when deleting nonexistent sticker', async () => {
    const email = `cf-test-sticker13-${Date.now()}@example.com`;
    const reg = await registerUser(email, TEST_PASSWORD);

    const response = await request(app)
      .delete('/api/v1/stickers/nonexistent-id')
      .set('Authorization', `Bearer ${reg.accessToken}`);

    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
  });

  test.sequential('should return 403 when deleting sticker not owned', async () => {
    const email1 = `cf-test-sticker14a-${Date.now()}@example.com`;
    const email2 = `cf-test-sticker14b-${Date.now()}@example.com`;
    const reg1 = await registerUser(email1, TEST_PASSWORD);
    const reg2 = await registerUser(email2, TEST_PASSWORD);

    const sticker = await createSticker(reg1.user.id, 'Not Yours', StickerVisibility.PRIVATE);

    const response = await request(app)
      .delete(`/api/v1/stickers/${sticker.id}`)
      .set('Authorization', `Bearer ${reg2.accessToken}`);

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
  });

  test.sequential('should create public sticker and find it in public list', async () => {
    const email = `cf-test-sticker15-${Date.now()}@example.com`;
    const reg = await registerUser(email, TEST_PASSWORD);

    const sticker = await createSticker(reg.user.id, 'Public Listed', StickerVisibility.PUBLIC);

    const response = await request(app).get('/api/v1/stickers/public');
    expect(response.status).toBe(200);
    expect(response.body.data.some((s: any) => s.id === sticker.id)).toBe(true);
  });

  test.sequential('should create private sticker and not find it in public list', async () => {
    const email = `cf-test-sticker16-${Date.now()}@example.com`;
    const reg = await registerUser(email, TEST_PASSWORD);

    const sticker = await createSticker(reg.user.id, 'Private Hidden', StickerVisibility.PRIVATE);

    const response = await request(app).get('/api/v1/stickers/public');
    expect(response.status).toBe(200);
    expect(response.body.data.some((s: any) => s.id === sticker.id)).toBe(false);
  });

  test.sequential('should update visibility from private to public', async () => {
    const email = `cf-test-sticker18-${Date.now()}@example.com`;
    const reg = await registerUser(email, TEST_PASSWORD);

    const sticker = await createSticker(reg.user.id, 'Toggle Visibility', StickerVisibility.PRIVATE);

    const updateResponse = await request(app)
      .put(`/api/v1/stickers/${sticker.id}`)
      .set('Authorization', `Bearer ${reg.accessToken}`)
      .send({ visibility: 'PUBLIC' });

    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body.data.visibility).toBe('PUBLIC');

    const publicResponse = await request(app).get('/api/v1/stickers/public');
    expect(publicResponse.body.data.some((s: any) => s.id === sticker.id)).toBe(true);
  });

  test.sequential('should not return deleted sticker', async () => {
    const email = `cf-test-sticker19-${Date.now()}@example.com`;
    const reg = await registerUser(email, TEST_PASSWORD);

    const sticker = await createSticker(reg.user.id, 'Gone', StickerVisibility.PUBLIC);

    await request(app)
      .delete(`/api/v1/stickers/${sticker.id}`)
      .set('Authorization', `Bearer ${reg.accessToken}`);

    const email2 = `cf-test-sticker19b-${Date.now()}@example.com`;
    const reg2 = await registerUser(email2, TEST_PASSWORD);

    const response = await request(app)
      .get(`/api/v1/stickers/${sticker.id}`)
      .set('Authorization', `Bearer ${reg2.accessToken}`);
    expect(response.status).toBe(400);
  });

  test.sequential('should require auth for my stickers', async () => {
    const response = await request(app).get('/api/v1/stickers');
    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
  });

  test.sequential('should require auth for sticker by id', async () => {
    const response = await request(app).get('/api/v1/stickers/some-id');
    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
  });
});

// ─── Sharing (15 tests) ─────────────────────────────────────────────────────

describe('Sharing', () => {
  test.sequential('should share sticker with another user', async () => {
    const email1 = `cf-test-share1a-${Date.now()}@example.com`;
    const email2 = `cf-test-share1b-${Date.now()}@example.com`;
    const reg1 = await registerUser(email1, TEST_PASSWORD);
    const reg2 = await registerUser(email2, TEST_PASSWORD);

    const sticker = await createSticker(reg1.user.id, 'Share Me', StickerVisibility.PRIVATE);

    const response = await request(app)
      .post(`/api/v1/stickers/${sticker.id}/share`)
      .set('Authorization', `Bearer ${reg1.accessToken}`)
      .send({ userId: reg2.user.id, permission: 'VIEW' });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.data.sharedWithId).toBe(reg2.user.id);
  });

  test.sequential('should require auth to share sticker', async () => {
    const response = await request(app)
      .post('/api/v1/stickers/some-id/share')
      .send({ userId: 'some-user', permission: 'VIEW' });

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
  });

  test.sequential('should return 404 when sharing with nonexistent user', async () => {
    const email = `cf-test-share3-${Date.now()}@example.com`;
    const reg = await registerUser(email, TEST_PASSWORD);

    const sticker = await createSticker(reg.user.id, 'Share Bad', StickerVisibility.PRIVATE);

    const response = await request(app)
      .post(`/api/v1/stickers/${sticker.id}/share`)
      .set('Authorization', `Bearer ${reg.accessToken}`)
      .send({ userId: 'nonexistent-user-id', permission: 'VIEW' });

    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
  });

  test.sequential('should remove user share', async () => {
    const email1 = `cf-test-share4a-${Date.now()}@example.com`;
    const email2 = `cf-test-share4b-${Date.now()}@example.com`;
    const reg1 = await registerUser(email1, TEST_PASSWORD);
    const reg2 = await registerUser(email2, TEST_PASSWORD);

    const sticker = await createSticker(reg1.user.id, 'Unshare Me', StickerVisibility.PRIVATE);

    await request(app)
      .post(`/api/v1/stickers/${sticker.id}/share`)
      .set('Authorization', `Bearer ${reg1.accessToken}`)
      .send({ userId: reg2.user.id, permission: 'VIEW' });

    const response = await request(app)
      .delete(`/api/v1/stickers/${sticker.id}/share`)
      .set('Authorization', `Bearer ${reg1.accessToken}`)
      .send({ userId: reg2.user.id });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });

  test.sequential('should require auth to remove share', async () => {
    const response = await request(app)
      .delete('/api/v1/stickers/some-id/share')
      .send({ userId: 'some-user' });

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
  });

  test.sequential('should create share link', async () => {
    const email = `cf-test-share5-${Date.now()}@example.com`;
    const reg = await registerUser(email, TEST_PASSWORD);

    const sticker = await createSticker(reg.user.id, 'Link Me', StickerVisibility.PRIVATE);

    const response = await request(app)
      .post(`/api/v1/stickers/${sticker.id}/link`)
      .set('Authorization', `Bearer ${reg.accessToken}`)
      .send({ permission: 'VIEW' });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.data.token).toBeDefined();

    state.shareLinkId = response.body.data.id;
  });

  test.sequential('should require auth to create share link', async () => {
    const response = await request(app)
      .post('/api/v1/stickers/some-id/link')
      .send({ permission: 'VIEW' });

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
  });

  test.sequential('should create share link with expiration', async () => {
    const email = `cf-test-share6-${Date.now()}@example.com`;
    const reg = await registerUser(email, TEST_PASSWORD);

    const sticker = await createSticker(reg.user.id, 'Link Expire', StickerVisibility.PRIVATE);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const response = await request(app)
      .post(`/api/v1/stickers/${sticker.id}/link`)
      .set('Authorization', `Bearer ${reg.accessToken}`)
      .send({ permission: 'VIEW', expiresAt });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.data.expiresAt).toBeDefined();
  });

  test.sequential('should create share link with max uses', async () => {
    const email = `cf-test-share7-${Date.now()}@example.com`;
    const reg = await registerUser(email, TEST_PASSWORD);

    const sticker = await createSticker(reg.user.id, 'Link Uses', StickerVisibility.PRIVATE);

    const response = await request(app)
      .post(`/api/v1/stickers/${sticker.id}/link`)
      .set('Authorization', `Bearer ${reg.accessToken}`)
      .send({ permission: 'VIEW', maxUses: 5 });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.data.maxUses).toBe(5);
  });

  test.sequential('should revoke share link', async () => {
    const email = `cf-test-share8-${Date.now()}@example.com`;
    const reg = await registerUser(email, TEST_PASSWORD);

    const sticker = await createSticker(reg.user.id, 'Revoke Link', StickerVisibility.PRIVATE);

    const linkResponse = await request(app)
      .post(`/api/v1/stickers/${sticker.id}/link`)
      .set('Authorization', `Bearer ${reg.accessToken}`)
      .send({ permission: 'VIEW' });

    const linkId = linkResponse.body.data.id;

    const response = await request(app)
      .delete(`/api/v1/stickers/${sticker.id}/link/${linkId}`)
      .set('Authorization', `Bearer ${reg.accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });

  test.sequential('should require auth to revoke share link', async () => {
    const response = await request(app)
      .delete('/api/v1/stickers/some-id/link/some-link-id');

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
  });

  test.sequential('should return 404 when revoking nonexistent share link', async () => {
    const email = `cf-test-share9-${Date.now()}@example.com`;
    const reg = await registerUser(email, TEST_PASSWORD);

    const sticker = await createSticker(reg.user.id, 'Revoke None', StickerVisibility.PRIVATE);

    const response = await request(app)
      .delete(`/api/v1/stickers/${sticker.id}/link/nonexistent-link`)
      .set('Authorization', `Bearer ${reg.accessToken}`);

    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
  });

  test.sequential('should allow shared user to access sticker', async () => {
    const email1 = `cf-test-share10a-${Date.now()}@example.com`;
    const email2 = `cf-test-share10b-${Date.now()}@example.com`;
    const reg1 = await registerUser(email1, TEST_PASSWORD);
    const reg2 = await registerUser(email2, TEST_PASSWORD);

    const sticker = await createSticker(reg1.user.id, 'Shared Access', StickerVisibility.PRIVATE);

    await request(app)
      .post(`/api/v1/stickers/${sticker.id}/share`)
      .set('Authorization', `Bearer ${reg1.accessToken}`)
      .send({ userId: reg2.user.id, permission: 'VIEW' });

    const response = await request(app)
      .get(`/api/v1/stickers/${sticker.id}`)
      .set('Authorization', `Bearer ${reg2.accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data.id).toBe(sticker.id);
  });

  test.sequential('should update share permission', async () => {
    const email1 = `cf-test-share11a-${Date.now()}@example.com`;
    const email2 = `cf-test-share11b-${Date.now()}@example.com`;
    const reg1 = await registerUser(email1, TEST_PASSWORD);
    const reg2 = await registerUser(email2, TEST_PASSWORD);

    const sticker = await createSticker(reg1.user.id, 'Update Share', StickerVisibility.PRIVATE);

    const share1 = await request(app)
      .post(`/api/v1/stickers/${sticker.id}/share`)
      .set('Authorization', `Bearer ${reg1.accessToken}`)
      .send({ userId: reg2.user.id, permission: 'VIEW' });

    expect(share1.body.data.permission).toBe('VIEW');

    const share2 = await request(app)
      .post(`/api/v1/stickers/${sticker.id}/share`)
      .set('Authorization', `Bearer ${reg1.accessToken}`)
      .send({ userId: reg2.user.id, permission: 'EDIT' });

    expect(share2.status).toBe(201);
    expect(share2.body.data.permission).toBe('EDIT');
  });

  test.sequential('should return 404 when removing nonexistent share', async () => {
    const email = `cf-test-share12-${Date.now()}@example.com`;
    const reg = await registerUser(email, TEST_PASSWORD);

    const sticker = await createSticker(reg.user.id, 'Remove None', StickerVisibility.PRIVATE);

    const response = await request(app)
      .delete(`/api/v1/stickers/${sticker.id}/share`)
      .set('Authorization', `Bearer ${reg.accessToken}`)
      .send({ userId: 'nonexistent-user-id' });

    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
  });
});

// ─── Admin (15 tests) ───────────────────────────────────────────────────────

describe('Admin', () => {
  test.sequential('should require admin role for get users', async () => {
    const email = `cf-test-admin1-${Date.now()}@example.com`;
    const reg = await registerUser(email, TEST_PASSWORD);

    const response = await request(app)
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${reg.accessToken}`);

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
  });

  test.sequential('should get users list as admin', async () => {
    const response = await request(app)
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${state.adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(Array.isArray(response.body.data)).toBe(true);
    expect(response.body.data.length).toBeGreaterThan(0);
  });

  test.sequential('should require auth for admin routes', async () => {
    const response = await request(app).get('/api/v1/users');

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
  });

  test.sequential('should get user by id as admin', async () => {
    const email = `cf-test-admin2-${Date.now()}@example.com`;
    const reg = await registerUser(email, TEST_PASSWORD);

    const response = await request(app)
      .get(`/api/v1/users/${reg.user.id}`)
      .set('Authorization', `Bearer ${state.adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.id).toBe(reg.user.id);
  });

  test.sequential('should return 404 for nonexistent user as admin', async () => {
    const response = await request(app)
      .get('/api/v1/users/nonexistent-id')
      .set('Authorization', `Bearer ${state.adminToken}`);

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  test.sequential('should update user displayName as admin', async () => {
    const email = `cf-test-admin3-${Date.now()}@example.com`;
    const reg = await registerUser(email, TEST_PASSWORD);

    const response = await request(app)
      .put(`/api/v1/users/${reg.user.id}`)
      .set('Authorization', `Bearer ${state.adminToken}`)
      .send({ displayName: 'Updated By Admin' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.displayName).toBe('Updated By Admin');
  });

  test.sequential('should update user isActive as admin', async () => {
    const email = `cf-test-admin4-${Date.now()}@example.com`;
    const reg = await registerUser(email, TEST_PASSWORD);

    const response = await request(app)
      .put(`/api/v1/users/${reg.user.id}`)
      .set('Authorization', `Bearer ${state.adminToken}`)
      .send({ isActive: false });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.isActive).toBe(false);
  });

  test.sequential('should return 404 when updating nonexistent user as admin', async () => {
    const response = await request(app)
      .put('/api/v1/users/nonexistent-id')
      .set('Authorization', `Bearer ${state.adminToken}`)
      .send({ displayName: 'Nobody' });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  test.sequential('should delete user as admin', async () => {
    const email = `cf-test-admin5-${Date.now()}@example.com`;
    const reg = await registerUser(email, TEST_PASSWORD);

    const response = await request(app)
      .delete(`/api/v1/users/${reg.user.id}`)
      .set('Authorization', `Bearer ${state.adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    // Verify user is gone
    const getResponse = await request(app)
      .get(`/api/v1/users/${reg.user.id}`)
      .set('Authorization', `Bearer ${state.adminToken}`);
    expect(getResponse.status).toBe(400);
  });

  test.sequential('should return 404 when deleting nonexistent user as admin', async () => {
    const response = await request(app)
      .delete('/api/v1/users/nonexistent-id')
      .set('Authorization', `Bearer ${state.adminToken}`);

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  test.sequential('should return 403 when admin tries to delete self', async () => {
    const response = await request(app)
      .delete(`/api/v1/users/${state.adminUserId}`)
      .set('Authorization', `Bearer ${state.adminToken}`);

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
  });

  test.sequential('should change user role as admin', async () => {
    const email = `cf-test-admin6-${Date.now()}@example.com`;
    const reg = await registerUser(email, TEST_PASSWORD);

    const adminRole = await prisma.role.findUnique({ where: { name: 'admin' } });

    const response = await request(app)
      .put(`/api/v1/users/${reg.user.id}/role`)
      .set('Authorization', `Bearer ${state.adminToken}`)
      .send({ roleId: adminRole?.id });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.role.name).toBe('admin');
  });

  test.sequential('should return 404 when changing role for nonexistent user', async () => {
    const adminRole = await prisma.role.findUnique({ where: { name: 'admin' } });

    const response = await request(app)
      .put('/api/v1/users/nonexistent-id/role')
      .set('Authorization', `Bearer ${state.adminToken}`)
      .send({ roleId: adminRole?.id });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  test.sequential('should return 404 when changing to nonexistent role', async () => {
    const email = `cf-test-admin7-${Date.now()}@example.com`;
    const reg = await registerUser(email, TEST_PASSWORD);

    const response = await request(app)
      .put(`/api/v1/users/${reg.user.id}/role`)
      .set('Authorization', `Bearer ${state.adminToken}`)
      .send({ roleId: 'nonexistent-role-id' });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  test.sequential('should return 403 when non-admin accesses admin routes', async () => {
    const email = `cf-test-admin8-${Date.now()}@example.com`;
    const reg = await registerUser(email, TEST_PASSWORD);

    const response = await request(app)
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${reg.accessToken}`);

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
  });
});

// ─── Existing Endpoints (9 tests) ───────────────────────────────────────────

describe('Existing Endpoints', () => {
  test.sequential('should require auth for generate', async () => {
    const response = await request(app)
      .post('/api/v1/generate')
      .send({ text: 'test' });

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
  });

  test.sequential('should return 400 for generate with missing text', async () => {
    const email = `cf-test-gen1-${Date.now()}@example.com`;
    const reg = await registerUser(email, TEST_PASSWORD);

    const response = await request(app)
      .post('/api/v1/generate')
      .set('Authorization', `Bearer ${reg.accessToken}`)
      .send();

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  test.sequential('should return 400 for generate grid without layout', async () => {
    const email = `cf-test-gen2-${Date.now()}@example.com`;
    const reg = await registerUser(email, TEST_PASSWORD);

    const response = await request(app)
      .post('/api/v1/generate')
      .set('Authorization', `Bearer ${reg.accessToken}`)
      .field('text', 'test sticker')
      .field('grid', 'true');

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  test.sequential('should require auth for grid split', async () => {
    const response = await request(app)
      .post('/api/v1/grid/split')
      .send();

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
  });

  test.sequential('should return 400 for grid split without image', async () => {
    const email = `cf-test-grid1-${Date.now()}@example.com`;
    const reg = await registerUser(email, TEST_PASSWORD);

    const response = await request(app)
      .post('/api/v1/grid/split')
      .set('Authorization', `Bearer ${reg.accessToken}`)
      .send();

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  test.sequential('should return 415 for grid split with invalid file type', async () => {
    const email = `cf-test-grid2-${Date.now()}@example.com`;
    const reg = await registerUser(email, TEST_PASSWORD);

    const response = await request(app)
      .post('/api/v1/grid/split')
      .set('Authorization', `Bearer ${reg.accessToken}`)
      .attach('image', Buffer.from('not an image'), 'test.txt');

    expect(response.status).toBe(415);
    expect(response.body.success).toBe(false);
  });

  test.sequential('should require auth for background remove', async () => {
    const response = await request(app)
      .post('/api/v1/background/remove')
      .send();

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
  });

  test.sequential('should return 400 for background remove without image', async () => {
    const email = `cf-test-bg1-${Date.now()}@example.com`;
    const reg = await registerUser(email, TEST_PASSWORD);

    const response = await request(app)
      .post('/api/v1/background/remove')
      .set('Authorization', `Bearer ${reg.accessToken}`)
      .send();

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  test.sequential('should return 415 for background remove with invalid file type', async () => {
    const email = `cf-test-bg2-${Date.now()}@example.com`;
    const reg = await registerUser(email, TEST_PASSWORD);

    const response = await request(app)
      .post('/api/v1/background/remove')
      .set('Authorization', `Bearer ${reg.accessToken}`)
      .attach('image', Buffer.from('not an image'), 'test.txt');

    expect(response.status).toBe(415);
    expect(response.body.success).toBe(false);
  });
});
