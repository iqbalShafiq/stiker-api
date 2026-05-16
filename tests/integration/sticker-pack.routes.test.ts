import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../src/app';
import { prisma } from '../../src/prisma/client';
import { StickerVisibility } from '@prisma/client';
import path from 'path';

const TEST_PASSWORD = 'StrongPass1!';
const TEST_IMAGE_BUFFER = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64'
);

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

  return {
    user: response.body.data?.user,
    token: response.body.data?.accessToken,
    cookies: response.headers['set-cookie'] as string[],
  };
}

async function cleanupTestData() {
  try {
    // Delete in order to respect foreign keys
    await prisma.processingHistory.deleteMany({});
    await prisma.stickerPackSticker.deleteMany({});
    await prisma.stickerPackShareLink.deleteMany({});
    await prisma.stickerPackShare.deleteMany({});
    await prisma.stickerPack.deleteMany({});
    await prisma.stickerShareLink.deleteMany({});
    await prisma.stickerShare.deleteMany({});
    await prisma.sticker.deleteMany({});
    
    // Delete all non-admin test users
    const testUsers = await prisma.user.findMany({
      where: {
        NOT: {
          email: 'admin@example.com',
        },
      },
    });

    for (const user of testUsers) {
      await prisma.refreshToken.deleteMany({ where: { userId: user.id } });
      await prisma.stickerPackShare.deleteMany({ where: { grantedBy: user.id } });
      await prisma.stickerPackShare.deleteMany({ where: { sharedWithId: user.id } });
      await prisma.stickerShare.deleteMany({ where: { grantedBy: user.id } });
      await prisma.stickerShare.deleteMany({ where: { sharedWithId: user.id } });
    }

    await prisma.user.deleteMany({
      where: {
        NOT: {
          email: 'admin@example.com',
        },
      },
    });
  } catch {
    // Ignore cleanup errors
  }
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Sticker Pack Routes Integration', () => {
  let user1Token: string;
  let user1Id: string;
  let user2Token: string;
  let user2Id: string;
  let packId: string;

  beforeAll(async () => {
    await cleanupTestData();
    
    const user1 = await registerUser(
      `stickerpack-test-user1-${Date.now()}@example.com`,
      TEST_PASSWORD,
      { username: `packuser1${Date.now()}`, displayName: 'User One' }
    );
    user1Token = user1.token;
    user1Id = user1.user.id;

    const user2 = await registerUser(
      `stickerpack-test-user2-${Date.now()}@example.com`,
      TEST_PASSWORD,
      { username: `packuser2${Date.now()}`, displayName: 'User Two' }
    );
    user2Token = user2.token;
    user2Id = user2.user.id;
  });

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    // Clean sticker packs before each test
    await prisma.stickerPackSticker.deleteMany({});
    await prisma.stickerPackShare.deleteMany({});
    await prisma.stickerPackShareLink.deleteMany({});
    await prisma.stickerPack.deleteMany({});
    packId = '';
  });

  describe('POST /api/v1/sticker-packs', () => {
    test('should create sticker pack without stickers', async () => {
      const response = await request(app)
        .post('/api/v1/sticker-packs')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({
          name: 'Test Pack',
          description: 'A test sticker pack',
          visibility: 'private',
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.name).toBe('Test Pack');
      expect(response.body.data.ownerId).toBe(user1Id);
      expect(response.body.data.visibility).toBe('PRIVATE');
      expect(response.body.data.stickers).toHaveLength(0);
    });

    test('should create sticker pack with stickers', async () => {
      const response = await request(app)
        .post('/api/v1/sticker-packs')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({
          name: 'Pack With Stickers',
          visibility: 'private',
          stickers: [
            {
              name: 'Sticker 1',
              filename: 'sticker1.png',
              url: 'http://localhost:3000/uploads/sticker1.png',
            },
          ],
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.stickers).toHaveLength(1);
    });

    test('should return 401 without auth', async () => {
      const response = await request(app)
        .post('/api/v1/sticker-packs')
        .send({
          name: 'Test Pack',
        });

      expect(response.status).toBe(401);
    });

    test('should return 400 without name', async () => {
      const response = await request(app)
        .post('/api/v1/sticker-packs')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({
          description: 'Missing name',
        });

      expect(response.status).toBe(400);
    });
  });

  describe('GET /api/v1/sticker-packs', () => {
    test('should return my sticker packs', async () => {
      // Create a pack first
      await request(app)
        .post('/api/v1/sticker-packs')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({
          name: 'My Pack',
          visibility: 'private',
        });

      const response = await request(app)
        .get('/api/v1/sticker-packs')
        .set('Authorization', `Bearer ${user1Token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.length).toBeGreaterThan(0);
    });
  });

  describe('GET /api/v1/sticker-packs/public', () => {
    test('should return public sticker packs', async () => {
      // Create a public pack
      await request(app)
        .post('/api/v1/sticker-packs')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({
          name: 'Public Pack',
          visibility: 'public',
        });

      const response = await request(app)
        .get('/api/v1/sticker-packs/public');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.length).toBeGreaterThan(0);
      expect(response.body.data[0].visibility).toBe('PUBLIC');
    });
  });

  describe('GET /api/v1/sticker-packs/:id', () => {
    test('should get sticker pack by id', async () => {
      const createResponse = await request(app)
        .post('/api/v1/sticker-packs')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({
          name: 'Get Test Pack',
          visibility: 'private',
        });

      packId = createResponse.body.data.id;

      const response = await request(app)
        .get(`/api/v1/sticker-packs/${packId}`)
        .set('Authorization', `Bearer ${user1Token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.id).toBe(packId);
      expect(response.body.data.name).toBe('Get Test Pack');
    });

    test('should return 404 for non-existent pack', async () => {
      const response = await request(app)
        .get('/api/v1/sticker-packs/non-existent-id')
        .set('Authorization', `Bearer ${user1Token}`);

      expect(response.status).toBe(404);
    });
  });

  describe('PUT /api/v1/sticker-packs/:id', () => {
    test('should update sticker pack', async () => {
      const createResponse = await request(app)
        .post('/api/v1/sticker-packs')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({
          name: 'Update Test Pack',
          visibility: 'private',
        });

      packId = createResponse.body.data.id;

      const response = await request(app)
        .put(`/api/v1/sticker-packs/${packId}`)
        .set('Authorization', `Bearer ${user1Token}`)
        .send({
          name: 'Updated Name',
          description: 'Updated description',
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.name).toBe('Updated Name');
      expect(response.body.data.description).toBe('Updated description');
    });

    test('should return 403 for non-owner', async () => {
      const createResponse = await request(app)
        .post('/api/v1/sticker-packs')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({
          name: 'Owner Pack',
          visibility: 'private',
        });

      packId = createResponse.body.data.id;

      const response = await request(app)
        .put(`/api/v1/sticker-packs/${packId}`)
        .set('Authorization', `Bearer ${user2Token}`)
        .send({
          name: 'Hacked Name',
        });

      expect(response.status).toBe(403);
    });
  });

  describe('DELETE /api/v1/sticker-packs/:id', () => {
    test('should soft delete sticker pack', async () => {
      const createResponse = await request(app)
        .post('/api/v1/sticker-packs')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({
          name: 'Delete Test Pack',
          visibility: 'private',
        });

      packId = createResponse.body.data.id;

      const response = await request(app)
        .delete(`/api/v1/sticker-packs/${packId}`)
        .set('Authorization', `Bearer ${user1Token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      // Verify it's soft deleted
      const getResponse = await request(app)
        .get(`/api/v1/sticker-packs/${packId}`)
        .set('Authorization', `Bearer ${user1Token}`);

      expect(getResponse.status).toBe(404);
    });
  });

  describe('POST /api/v1/sticker-packs/:id/share', () => {
    test('should share sticker pack with another user', async () => {
      const createResponse = await request(app)
        .post('/api/v1/sticker-packs')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({
          name: 'Share Test Pack',
          visibility: 'private',
        });

      packId = createResponse.body.data.id;

      const response = await request(app)
        .post(`/api/v1/sticker-packs/${packId}/share`)
        .set('Authorization', `Bearer ${user1Token}`)
        .send({
          userId: user2Id,
          permission: 'view',
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.sharedWithId).toBe(user2Id);
    });

    test('should not share with self', async () => {
      const createResponse = await request(app)
        .post('/api/v1/sticker-packs')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({
          name: 'Self Share Test',
          visibility: 'private',
        });

      packId = createResponse.body.data.id;

      const response = await request(app)
        .post(`/api/v1/sticker-packs/${packId}/share`)
        .set('Authorization', `Bearer ${user1Token}`)
        .send({
          userId: user1Id,
          permission: 'view',
        });

      expect(response.status).toBe(400);
    });
  });

  describe('POST /api/v1/sticker-packs/:id/link', () => {
    test('should create share link', async () => {
      const createResponse = await request(app)
        .post('/api/v1/sticker-packs')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({
          name: 'Link Test Pack',
          visibility: 'private',
        });

      packId = createResponse.body.data.id;

      const response = await request(app)
        .post(`/api/v1/sticker-packs/${packId}/link`)
        .set('Authorization', `Bearer ${user1Token}`)
        .send({
          permission: 'view',
          maxUses: 10,
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.token).toBeDefined();
      expect(response.body.data.maxUses).toBe(10);
    });
  });

  describe('POST /api/v1/sticker-packs/:id/stickers', () => {
    test('should add sticker to pack', async () => {
      const createResponse = await request(app)
        .post('/api/v1/sticker-packs')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({
          name: 'Add Sticker Pack',
          visibility: 'private',
        });

      packId = createResponse.body.data.id;

      const response = await request(app)
        .post(`/api/v1/sticker-packs/${packId}/stickers`)
        .set('Authorization', `Bearer ${user1Token}`)
        .send({
          name: 'New Sticker',
          filename: 'new-sticker.png',
          url: 'http://localhost:3000/uploads/new-sticker.png',
          width: 512,
          height: 512,
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.sticker).toBeDefined();
      expect(response.body.data.sticker.name).toBe('New Sticker');
    });
  });

  describe('PUT /api/v1/sticker-packs/:id/reorder', () => {
    test('should reorder stickers in pack', async () => {
      const createResponse = await request(app)
        .post('/api/v1/sticker-packs')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({
          name: 'Reorder Pack',
          visibility: 'private',
          stickers: [
            { name: 'S1', filename: 's1.png', url: 'http://localhost:3000/uploads/s1.png' },
            { name: 'S2', filename: 's2.png', url: 'http://localhost:3000/uploads/s2.png' },
          ],
        });

      packId = createResponse.body.data.id;
      const stickers = createResponse.body.data.stickers;

      const response = await request(app)
        .put(`/api/v1/sticker-packs/${packId}/reorder`)
        .set('Authorization', `Bearer ${user1Token}`)
        .send({
          stickerOrders: [
            { stickerId: stickers[0].stickerId, order: 1 },
            { stickerId: stickers[1].stickerId, order: 0 },
          ],
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });
});

// ─── Upload Route Tests ─────────────────────────────────────────────────────

describe('Upload Route Integration', () => {
  let user1Token: string;
  let user1Id: string;

  beforeAll(async () => {
    await cleanupTestData();
    
    const user1 = await registerUser(
      `stickerpack-test-upload-${Date.now()}@example.com`,
      TEST_PASSWORD,
      { username: `uploaduser${Date.now()}`, displayName: 'Upload User' }
    );
    user1Token = user1.token;
    user1Id = user1.user.id;
  });

  afterAll(async () => {
    await cleanupTestData();
  });

  beforeEach(async () => {
    await prisma.stickerPackSticker.deleteMany({});
    await prisma.stickerPack.deleteMany({});
    await prisma.sticker.deleteMany({});
  });

  test('should upload stickers to new pack', async () => {
    const response = await request(app)
      .post('/api/v1/upload')
      .set('Authorization', `Bearer ${user1Token}`)
      .field('stickerPackName', 'Uploaded Pack')
      .field('stickerPackDescription', 'Pack from upload')
      .field('visibility', 'private')
      .attach('images', TEST_IMAGE_BUFFER, 'test-sticker.png');

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.data.stickerPackId).toBeDefined();
    expect(response.body.data.stickers).toHaveLength(1);
    expect(response.body.data.stickers[0].ownerId).toBe(user1Id);
  });

  test('should upload stickers to existing pack', async () => {
    // Create pack first
    const packResponse = await request(app)
      .post('/api/v1/sticker-packs')
      .set('Authorization', `Bearer ${user1Token}`)
      .send({
        name: 'Existing Pack',
        visibility: 'private',
      });

    const existingPackId = packResponse.body.data.id;

    const response = await request(app)
      .post('/api/v1/upload')
      .set('Authorization', `Bearer ${user1Token}`)
      .field('stickerPackId', existingPackId)
      .field('visibility', 'private')
      .attach('images', TEST_IMAGE_BUFFER, 'test-sticker.png');

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.data.stickerPackId).toBe(existingPackId);
  });

  test('should return 400 without files', async () => {
    const response = await request(app)
      .post('/api/v1/upload')
      .set('Authorization', `Bearer ${user1Token}`)
      .field('stickerPackName', 'Empty Pack');

    expect(response.status).toBe(400);
  });

  test('should delete sticker via upload action delete', async () => {
    const createPackResponse = await request(app)
      .post('/api/v1/sticker-packs')
      .set('Authorization', `Bearer ${user1Token}`)
      .send({
        name: 'Delete Sticker Pack',
        visibility: 'private',
        stickers: [
          {
            name: 'Delete Me',
            filename: 'delete-me.webp',
            url: '/uploads/delete-me.webp',
          },
        ],
      });

    expect(createPackResponse.status).toBe(201);
    const createdPackId = createPackResponse.body.data.id as string;
    const createdStickerId = createPackResponse.body.data.stickers[0].sticker.id as string;

    const response = await request(app)
      .post('/api/v1/upload')
      .set('Authorization', `Bearer ${user1Token}`)
      .field('action', 'delete')
      .field('stickerPackId', createdPackId)
      .field('stickerId', createdStickerId);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.action).toBe('deleteSticker');
    expect(response.body.data.stickerPackId).toBe(createdPackId);
    expect(response.body.data.stickerId).toBe(createdStickerId);

    const deletedSticker = await prisma.sticker.findUnique({ where: { id: createdStickerId } });
    expect(deletedSticker?.deletedAt).not.toBeNull();

    const packRelation = await prisma.stickerPackSticker.findFirst({
      where: {
        stickerPackId: createdPackId,
        stickerId: createdStickerId,
      },
    });
    expect(packRelation).toBeNull();
  });

  test('should delete sticker pack via upload action delete', async () => {
    const createPackResponse = await request(app)
      .post('/api/v1/sticker-packs')
      .set('Authorization', `Bearer ${user1Token}`)
      .send({
        name: 'Delete Pack',
        visibility: 'private',
      });

    expect(createPackResponse.status).toBe(201);
    const createdPackId = createPackResponse.body.data.id as string;

    const response = await request(app)
      .post('/api/v1/upload')
      .set('Authorization', `Bearer ${user1Token}`)
      .field('action', 'delete')
      .field('stickerPackId', createdPackId);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.action).toBe('deleteStickerPack');
    expect(response.body.data.stickerPackId).toBe(createdPackId);

    const deletedPack = await prisma.stickerPack.findUnique({ where: { id: createdPackId } });
    expect(deletedPack?.deletedAt).not.toBeNull();
  });

  test('should return 400 for delete action without stickerPackId', async () => {
    const response = await request(app)
      .post('/api/v1/upload')
      .set('Authorization', `Bearer ${user1Token}`)
      .field('action', 'delete')
      .field('stickerId', 'sticker-only');

    expect(response.status).toBe(400);
  });
});

// ─── Sync Route Tests ───────────────────────────────────────────────────────

describe('Sync Route Integration', () => {
  let user1Token: string;
  let user1Id: string;

  beforeAll(async () => {
    await cleanupTestData();
    
    const user1 = await registerUser(
      `stickerpack-test-sync-${Date.now()}@example.com`,
      TEST_PASSWORD,
      { username: `syncuser${Date.now()}`, displayName: 'Sync User' }
    );
    user1Token = user1.token;
    user1Id = user1.user.id;
  });

  afterAll(async () => {
    await cleanupTestData();
  });

  beforeEach(async () => {
    await prisma.stickerPackSticker.deleteMany({});
    await prisma.stickerPack.deleteMany({});
    await prisma.sticker.deleteMany({});
  });

  test('should sync all data for first sync', async () => {
    // Create a pack
    await request(app)
      .post('/api/v1/sticker-packs')
      .set('Authorization', `Bearer ${user1Token}`)
      .send({
        name: 'Sync Test Pack',
        visibility: 'private',
      });

    const response = await request(app)
      .get('/api/v1/sync')
      .set('Authorization', `Bearer ${user1Token}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.stickerPacks.created).toBeDefined();
    expect(response.body.data.stickerPacks.updated).toBeDefined();
    expect(response.body.data.stickerPacks.deleted).toBeDefined();
    expect(response.body.data.stickers.created).toBeDefined();
    expect(response.body.data.stickers.updated).toBeDefined();
    expect(response.body.data.stickers.deleted).toBeDefined();
    expect(response.body.data.syncToken).toBeDefined();
    expect(response.body.data.stickerPacks.created.length).toBeGreaterThan(0);
  });

  test('should sync incremental changes', async () => {
    // First sync
    const firstSync = await request(app)
      .get('/api/v1/sync')
      .set('Authorization', `Bearer ${user1Token}`);

    const syncToken = firstSync.body.data.syncToken;

    // Create a pack after first sync
    await request(app)
      .post('/api/v1/sticker-packs')
      .set('Authorization', `Bearer ${user1Token}`)
      .send({
        name: 'Incremental Pack',
        visibility: 'private',
      });

    // Incremental sync
    const response = await request(app)
      .get('/api/v1/sync')
      .set('Authorization', `Bearer ${user1Token}`)
      .query({ lastSyncAt: new Date().toISOString() });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });

  test('should return 401 without auth', async () => {
    const response = await request(app)
      .get('/api/v1/sync');

    expect(response.status).toBe(401);
  });

  test('should expose sticker pack deletion from upload API in sync deleted list', async () => {
    const packResponse = await request(app)
      .post('/api/v1/sticker-packs')
      .set('Authorization', `Bearer ${user1Token}`)
      .send({
        name: 'Sync Delete Pack',
        visibility: 'private',
      });

    expect(packResponse.status).toBe(201);
    const packId = packResponse.body.data.id as string;
    const lastSyncAt = new Date(Date.now() - 1000).toISOString();

    const deleteResponse = await request(app)
      .post('/api/v1/upload')
      .set('Authorization', `Bearer ${user1Token}`)
      .field('action', 'delete')
      .field('stickerPackId', packId);

    expect(deleteResponse.status).toBe(200);

    const syncResponse = await request(app)
      .get('/api/v1/sync')
      .set('Authorization', `Bearer ${user1Token}`)
      .query({ lastSyncAt });

    expect(syncResponse.status).toBe(200);
    expect(syncResponse.body.data.stickerPacks.deleted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: packId }),
      ])
    );
  });

  test('should expose sticker deletion from upload API in sync deleted list', async () => {
    const packResponse = await request(app)
      .post('/api/v1/sticker-packs')
      .set('Authorization', `Bearer ${user1Token}`)
      .send({
        name: 'Sync Delete Sticker',
        visibility: 'private',
        stickers: [
          {
            name: 'Will Be Deleted',
            filename: 'will-be-deleted.webp',
            url: '/uploads/will-be-deleted.webp',
          },
        ],
      });

    expect(packResponse.status).toBe(201);
    const packId = packResponse.body.data.id as string;
    const stickerId = packResponse.body.data.stickers[0].sticker.id as string;
    const lastSyncAt = new Date(Date.now() - 1000).toISOString();

    const deleteResponse = await request(app)
      .post('/api/v1/upload')
      .set('Authorization', `Bearer ${user1Token}`)
      .field('action', 'delete')
      .field('stickerPackId', packId)
      .field('stickerId', stickerId);

    expect(deleteResponse.status).toBe(200);

    const syncResponse = await request(app)
      .get('/api/v1/sync')
      .set('Authorization', `Bearer ${user1Token}`)
      .query({ lastSyncAt });

    expect(syncResponse.status).toBe(200);
    expect(syncResponse.body.data.stickers.deleted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: stickerId }),
      ])
    );
  });
});

// ─── Generate/Grid/Background History Tests ─────────────────────────────────

describe('Processing History Integration', () => {
  let user1Token: string;

  beforeAll(async () => {
    await cleanupTestData();
    
    const user1 = await registerUser(
      `stickerpack-test-history-${Date.now()}@example.com`,
      TEST_PASSWORD,
      { username: `historyuser${Date.now()}`, displayName: 'History User' }
    );
    user1Token = user1.token;
  });

  afterAll(async () => {
    await cleanupTestData();
  });

  test.skip('generate should create processing history (requires valid AI API key)', async () => {
    const testImagePath = path.join(process.cwd(), 'contoh_naruto.webp');
    
    const response = await request(app)
      .post('/api/v1/generate')
      .set('Authorization', `Bearer ${user1Token}`)
      .attach('image', testImagePath)
      .field('text', 'cute cat sticker');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.images).toBeDefined();
    expect(response.body.data.metadata).toBeDefined();

    // Verify no sticker was created in database
    const stickers = await prisma.sticker.findMany({
      where: { ownerId: response.body.data.user?.id },
    });
    
    // The response should have images but they should be in history, not stickers table
    expect(response.body.data.images.length).toBeGreaterThan(0);
  });
});
