import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../src/app';
import { prisma } from '../../src/prisma/client';

describe('Auth Routes Integration', () => {
  const testEmail = `integration-test-${Date.now()}@example.com`;
  const testUsername = `testuser${Date.now()}`;
  const testPassword = 'StrongPass1!';
  const weakPassword = 'weak';

  let accessToken: string;
  let refreshTokenCookie: string;
  let createdUserId: string;

  beforeAll(async () => {
    // Clean up any existing test data
    await cleanupTestData();
  });

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    // Clean up before each test to ensure isolation
    await cleanupTestData();
  });

  async function cleanupTestData() {
    try {
      // Delete refresh tokens for test users first
      const testUsers = await prisma.user.findMany({
        where: {
          OR: [
            { email: { startsWith: 'integration-test-' } },
            { email: testEmail },
          ],
        },
      });

      for (const user of testUsers) {
        await prisma.refreshToken.deleteMany({
          where: { userId: user.id },
        });
      }

      // Delete test users
      await prisma.user.deleteMany({
        where: {
          OR: [
            { email: { startsWith: 'integration-test-' } },
            { email: testEmail },
          ],
        },
      });
    } catch {
      // Ignore cleanup errors
    }
  }

  describe('POST /api/v1/auth/register', () => {
    it('should register a new user successfully', async () => {
      const uniqueEmail = `integration-test-${Date.now()}@example.com`;
      const uniqueUsername = `testuser${Date.now()}`;

      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({
          email: uniqueEmail,
          username: uniqueUsername,
          password: testPassword,
          displayName: 'Test User',
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.user).toBeDefined();
      expect(response.body.data.user.email).toBe(uniqueEmail);
      expect(response.body.data.user.username).toBe(uniqueUsername);
      expect(response.body.data.accessToken).toBeDefined();
      expect(typeof response.body.data.accessToken).toBe('string');

      // Check refresh cookie is set
      const cookies = response.headers['set-cookie'];
      expect(cookies).toBeDefined();
      expect(cookies.some((cookie: string) => cookie.includes('refresh_token'))).toBe(true);

      createdUserId = response.body.data.user.id;
    });

    it('should return 400 for weak password', async () => {
      const uniqueEmail = `integration-test-${Date.now()}@example.com`;
      const uniqueUsername = `testuser${Date.now()}`;

      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({
          email: uniqueEmail,
          username: uniqueUsername,
          password: weakPassword,
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it('should return 409 for duplicate email', async () => {
      const uniqueEmail = `integration-test-${Date.now()}@example.com`;
      const uniqueUsername = `testuser${Date.now()}`;

      // Register first user
      const firstResponse = await request(app)
        .post('/api/v1/auth/register')
        .send({
          email: uniqueEmail,
          username: uniqueUsername,
          password: testPassword,
        });

      expect(firstResponse.status).toBe(201);

      // Try to register with same email
      const secondResponse = await request(app)
        .post('/api/v1/auth/register')
        .send({
          email: uniqueEmail,
          username: `${uniqueUsername}2`,
          password: testPassword,
        });

      expect(secondResponse.status).toBe(409);
      expect(secondResponse.body.success).toBe(false);
    });
  });

  describe('POST /api/v1/auth/login', () => {
    it('should login successfully with valid credentials', async () => {
      const uniqueEmail = `integration-test-${Date.now()}@example.com`;
      const uniqueUsername = `testuser${Date.now()}`;

      // Register first
      await request(app)
        .post('/api/v1/auth/register')
        .send({
          email: uniqueEmail,
          username: uniqueUsername,
          password: testPassword,
        });

      // Login
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: uniqueEmail,
          password: testPassword,
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.user).toBeDefined();
      expect(response.body.data.user.email).toBe(uniqueEmail);
      expect(response.body.data.accessToken).toBeDefined();
      expect(typeof response.body.data.accessToken).toBe('string');
    });

    it('should return 401 for invalid credentials', async () => {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'nonexistent@example.com',
          password: 'WrongPass1!',
        });

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });

    it('should return 401 for inactive user', async () => {
      const uniqueEmail = `integration-test-${Date.now()}@example.com`;
      const uniqueUsername = `testuser${Date.now()}`;

      // Register user
      const registerResponse = await request(app)
        .post('/api/v1/auth/register')
        .send({
          email: uniqueEmail,
          username: uniqueUsername,
          password: testPassword,
        });

      expect(registerResponse.status).toBe(201);
      const userId = registerResponse.body.data.user.id;

      // Deactivate user
      await prisma.user.update({
        where: { id: userId },
        data: { isActive: false },
      });

      // Try to login
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: uniqueEmail,
          password: testPassword,
        });

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });
  });

  describe('POST /api/v1/auth/logout', () => {
    it('should logout successfully', async () => {
      const uniqueEmail = `integration-test-${Date.now()}@example.com`;
      const uniqueUsername = `testuser${Date.now()}`;

      // Register and get tokens
      const registerResponse = await request(app)
        .post('/api/v1/auth/register')
        .send({
          email: uniqueEmail,
          username: uniqueUsername,
          password: testPassword,
        });

      const token = registerResponse.body.data.accessToken;
      const cookies = registerResponse.headers['set-cookie'] as string[];

      // Logout
      const response = await request(app)
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${token}`)
        .set('Cookie', cookies);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      // Check that refresh cookie is cleared
      const responseCookies = response.headers['set-cookie'];
      expect(responseCookies).toBeDefined();
      expect(responseCookies.some((cookie: string) => cookie.includes('refresh_token='))).toBe(true);
    });

    it('should return 401 without auth', async () => {
      const response = await request(app)
        .post('/api/v1/auth/logout');

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /api/v1/auth/me', () => {
    it('should return current user', async () => {
      const uniqueEmail = `integration-test-${Date.now()}@example.com`;
      const uniqueUsername = `testuser${Date.now()}`;

      // Register and get token
      const registerResponse = await request(app)
        .post('/api/v1/auth/register')
        .send({
          email: uniqueEmail,
          username: uniqueUsername,
          password: testPassword,
        });

      const token = registerResponse.body.data.accessToken;

      // Get me
      const response = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.email).toBe(uniqueEmail);
      expect(response.body.data.username).toBe(uniqueUsername);
    });

    it('should return 401 without auth', async () => {
      const response = await request(app)
        .get('/api/v1/auth/me');

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });
  });

  describe('POST /api/v1/auth/refresh', () => {
    it('should return new accessToken with valid refresh cookie', async () => {
      const uniqueEmail = `integration-test-${Date.now()}@example.com`;
      const uniqueUsername = `testuser${Date.now()}`;

      // Register and get refresh cookie
      const registerResponse = await request(app)
        .post('/api/v1/auth/register')
        .send({
          email: uniqueEmail,
          username: uniqueUsername,
          password: testPassword,
        });

      const cookies = registerResponse.headers['set-cookie'] as string[];

      // Refresh token
      const response = await request(app)
        .post('/api/v1/auth/refresh')
        .set('Cookie', cookies);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.accessToken).toBeDefined();
      expect(typeof response.body.data.accessToken).toBe('string');

      // Check that new refresh cookie is set
      const responseCookies = response.headers['set-cookie'];
      expect(responseCookies).toBeDefined();
      expect(responseCookies.some((cookie: string) => cookie.includes('refresh_token'))).toBe(true);
    });

    it('should return 400 without refresh cookie', async () => {
      const response = await request(app)
        .post('/api/v1/auth/refresh');

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });
  });
});
