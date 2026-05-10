import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'fs/promises';
import path from 'path';
import app from '../../../src/app';

describe('Integration Tests', () => {
  const testUploadDir = 'uploads';

  beforeAll(async () => {
    try {
      await fs.mkdir(testUploadDir, { recursive: true });
    } catch {
      // Directory may already exist
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
        .send();

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it('should return 415 for invalid file type', async () => {
      const response = await request(app)
        .post('/api/v1/background/remove')
        .attach('image', Buffer.from('not an image'), 'test.txt');

      expect(response.status).toBe(415);
      expect(response.body.success).toBe(false);
    });

    it(
      'processes animated GIF (contoh_gif.gif)',
      async () => {
        const gifPath = path.join(process.cwd(), 'contoh_gif.gif');
        await fs.access(gifPath);
        const response = await request(app)
          .post('/api/v1/background/remove')
          .attach('image', await fs.readFile(gifPath), 'contoh_gif.gif');

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.data?.metadata?.outputFormat).toBe('gif');
        expect(response.body.data?.metadata?.frameCount).toBe(11);
        expect(response.body.data?.image?.url).toContain('background-removed.gif');
      },
      180000
    );
  });

  describe('POST /api/v1/grid/split', () => {
    it('should return 400 when no image is provided', async () => {
      const response = await request(app)
        .post('/api/v1/grid/split')
        .send();

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });
  });

  describe('POST /api/v1/generate', () => {
    it('should return 400 when text is missing', async () => {
      const response = await request(app)
        .post('/api/v1/generate')
        .send();

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it('should return 400 when grid is true but layout and rows/cols are missing', async () => {
      const response = await request(app)
        .post('/api/v1/generate')
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
