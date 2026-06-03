import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../../src/app';
import { prisma } from '../../src/prisma/client';
import { StickerVisibility } from '@prisma/client';

const TEST_PASSWORD = 'StrongPass1!';

async function registerUser(email: string) {
  const username = `explore${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
  const response = await request(app)
    .post('/api/v1/auth/register')
    .send({ email, username, password: TEST_PASSWORD, displayName: 'Explore User' });
  return {
    token: response.body.data?.accessToken as string,
    userId: response.body.data?.user?.id as string,
  };
}

describe('Explore routes integration', () => {
  let ownerToken: string;
  let ownerId: string;
  let viewerToken: string;
  let packId: string;

  beforeAll(async () => {
    const owner = await registerUser(`explore-owner-${Date.now()}@example.com`);
    ownerToken = owner.token;
    ownerId = owner.userId;

    const viewer = await registerUser(`explore-viewer-${Date.now()}@example.com`);
    viewerToken = viewer.token;

    const pack = await prisma.stickerPack.create({
      data: {
        ownerId,
        name: 'Public Explore Pack',
        visibility: StickerVisibility.PUBLIC,
      },
    });
    packId = pack.id;
  });

  afterAll(async () => {
    await prisma.userNotification.deleteMany({});
    await prisma.featuredStickerPack.deleteMany({});
    await prisma.stickerPack.deleteMany({ where: { ownerId } });
    await prisma.$disconnect();
  });

  test('GET /sticker-packs/public supports q search', async () => {
    const response = await request(app)
      .get('/api/v1/sticker-packs/public')
      .query({ q: 'Explore' });
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.some((p: { id: string }) => p.id === packId)).toBe(true);
  });

  test('GET /sticker-packs/public/:id returns social flags when authenticated', async () => {
    await request(app)
      .post(`/api/v1/sticker-packs/${packId}/save`)
      .set('Authorization', `Bearer ${viewerToken}`);

    const response = await request(app)
      .get(`/api/v1/sticker-packs/public/${packId}`)
      .set('Authorization', `Bearer ${viewerToken}`);
    expect(response.status).toBe(200);
    expect(response.body.data.isSaved).toBe(true);
  });

  test('GET /sticker-packs/saved lists saved packs', async () => {
    const response = await request(app)
      .get('/api/v1/sticker-packs/saved')
      .set('Authorization', `Bearer ${viewerToken}`);
    expect(response.status).toBe(200);
    expect(response.body.data.some((p: { id: string }) => p.id === packId)).toBe(true);
  });

  test('GET /users/:id/public returns profile', async () => {
    const response = await request(app).get(`/api/v1/users/${ownerId}/public`);
    expect(response.status).toBe(200);
    expect(response.body.data.username).toBeDefined();
    expect(response.body.data.publicPackCount).toBeGreaterThanOrEqual(1);
  });
});
