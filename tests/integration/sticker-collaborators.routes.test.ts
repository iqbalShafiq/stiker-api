import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { StickerVisibility } from '@prisma/client';
import app from '../../src/app';
import { StickerService } from '../../src/services/sticker.service';

const testPassword = 'TestPass1!';

async function register(prefix: string) {
  const stamp = Date.now() + Math.floor(Math.random() * 1000);
  const email = `${prefix}-${stamp}@example.com`;
  const username = `${prefix}${stamp}`;
  const response = await request(app)
    .post('/api/v1/auth/register')
    .send({ email, username, password: testPassword, displayName: prefix });
  expect(response.status).toBe(201);
  return {
    accessToken: response.body.data.accessToken as string,
    userId: response.body.data.user.id as string,
    username: response.body.data.user.username as string,
  };
}

async function createSticker(ownerId: string, name: string) {
  const stickerService = new StickerService();
  return stickerService.create({
    ownerId,
    name,
    filename: `${name}.png`,
    url: `http://localhost:3000/uploads/${name}.png`,
    visibility: StickerVisibility.PRIVATE,
    width: 512,
    height: 512,
  });
}

describe('Sticker collaborators routes', () => {
  let ownerToken: string;
  let ownerId: string;
  let collaboratorId: string;
  let collaboratorUsername: string;
  let stickerId: string;

  beforeAll(async () => {
    const owner = await register('stickerowner');
    const collaborator = await register('stickercollab');
    ownerToken = owner.accessToken;
    ownerId = owner.userId;
    collaboratorId = collaborator.userId;
    collaboratorUsername = collaborator.username;
    const sticker = await createSticker(ownerId, 'Collab Sticker');
    stickerId = sticker.id;
  });

  it('lists empty collaborators initially', async () => {
    const response = await request(app)
      .get(`/api/v1/stickers/${stickerId}/collaborators`)
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toEqual([]);
  });

  it('rejects sharing with yourself', async () => {
    const response = await request(app)
      .post(`/api/v1/stickers/${stickerId}/share`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ userId: ownerId, permission: 'view' });

    expect(response.status).toBe(400);
  });

  it('shares, lists enriched collaborators, then removes', async () => {
    const shareResponse = await request(app)
      .post(`/api/v1/stickers/${stickerId}/share`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ userId: collaboratorId, permission: 'edit' });

    expect(shareResponse.status).toBe(201);
    expect(shareResponse.body.data.sharedWithId).toBe(collaboratorId);

    const listResponse = await request(app)
      .get(`/api/v1/stickers/${stickerId}/collaborators`)
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(listResponse.status).toBe(200);
    expect(listResponse.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sharedWithId: collaboratorId,
          permission: 'full',
          sharedWith: expect.objectContaining({
            id: collaboratorId,
            username: collaboratorUsername,
          }),
        }),
      ])
    );

    const removeResponse = await request(app)
      .delete(`/api/v1/stickers/${stickerId}/share`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ userId: collaboratorId });

    expect(removeResponse.status).toBe(200);

    const emptyResponse = await request(app)
      .get(`/api/v1/stickers/${stickerId}/collaborators`)
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(emptyResponse.body.data).toEqual([]);
  });
});
