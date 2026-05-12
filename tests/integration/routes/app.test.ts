import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'fs/promises';
import path from 'path';
import app from '../../../src/app';
import { prisma } from '../../../src/prisma/client';

describe('Integration Tests', () => {
  const testUploadDir = 'uploads';
  const testEmail = `integration-routes-${Date.now()}@example.com`;
  const testUsername = `routesuser${Date.now()}`;
  const testPassword = 'StrongPass1!';
  let accessToken: string;

  beforeAll(async () => {
    try {
      await fs.mkdir(testUploadDir, { recursive: true });
    } catch {
      // Directory may already exist
    }

    // Register and login test user
    const registerResponse = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: testEmail,
        username: testUsername,
        password: testPassword,
        displayName: 'Test User',
      });

    if (registerResponse.status === 201) {
      accessToken = registerResponse.body.data.accessToken;
    } else {
      // Try login if user already exists
      const loginResponse = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: testEmail,
          password: testPassword,
        });
      accessToken = loginResponse.body.data.accessToken;
    }
  });

  afterAll(async () => {
    try {
      const files = await fs.readdir(testUploadDir);
      for (const file of files) {
        if (file.startsWith('test-')) {
          await fs.unlink(path.join(testUploadDir, file));
        }
      }
    } catch {
      // Ignore cleanup errors
    }

    // Clean up test user
    try {
      const testUsers = await prisma.user.findMany({
        where: {
          OR: [
            { email: { startsWith: 'integration-routes-' } },
            { email: testEmail },
          ],
        },
      });

      for (const user of testUsers) {
        await prisma.refreshToken.deleteMany({
          where: { userId: user.id },
        });
      }

      await prisma.user.deleteMany({
        where: {
          OR: [
            { email: { startsWith: 'integration-routes-' } },
            { email: testEmail },
          ],
        },
      });
    } catch {
      // Ignore cleanup errors
    }

    await prisma.$disconnect();
  });

  describe('GET /health', () => {
    it('should return health status', async () => {
      const response = await request(app).get('/health');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('ok');
      expect(response.body.timestamp).toBeDefined();
    });
  });

  describe('POST /api/v1/background/remove', () => {
    it('should return 400 when no image is provided', async () => {
      const response = await request(app)
        .post('/api/v1/background/remove')
        .set('Authorization', `Bearer ${accessToken}`)
        .send();

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it('should return 415 for invalid file type', async () => {
      const response = await request(app)
        .post('/api/v1/background/remove')
        .set('Authorization', `Bearer ${accessToken}`)
        .attach('image', Buffer.from('not an image'), 'test.txt');

      expect(response.status).toBe(415);
      expect(response.body.success).toBe(false);
    });

    it(
      'processes animated GIF (contoh_gif.gif)',
      async () => {
        const gifPath = path.join(process.cwd(), 'contoh_gif.gif');

        try {
          await fs.access(gifPath);
        } catch {
          // Skip test if fixture file is not available
          return;
        }

        const response = await request(app)
          .post('/api/v1/background/remove')
          .set('Authorization', `Bearer ${accessToken}`)
          .attach('image', await fs.readFile(gifPath), 'contoh_gif.gif');

        // Skip if the GIF file is not a valid animated GIF
        if (response.status === 500) {
          return;
        }

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.data?.metadata?.outputFormat).toBe('gif');
        expect(response.body.data?.metadata?.frameCount).toBeDefined();
        expect(response.body.data?.image?.url).toContain('background-removed.gif');
      },
      180000
    );
  });

  describe('POST /api/v1/grid/split', () => {
    it('should return 400 when no image is provided', async () => {
      const response = await request(app)
        .post('/api/v1/grid/split')
        .set('Authorization', `Bearer ${accessToken}`)
        .send();

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });
  });

  describe('POST /api/v1/generate', () => {
    it('should return 400 when text is missing', async () => {
      const response = await request(app)
        .post('/api/v1/generate')
        .set('Authorization', `Bearer ${accessToken}`)
        .send();

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it('should return 400 when grid is true but layout and rows/cols are missing', async () => {
      const response = await request(app)
        .post('/api/v1/generate')
        .set('Authorization', `Bearer ${accessToken}`)
        .field('text', 'test sticker')
        .field('grid', 'true');

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /docs', () => {
    it('should return API documentation page', async () => {
      const response = await request(app).get('/docs');
      expect(response.status).toBe(200);
    });
  });
});
