import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import app from '../../src/app';

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

describe('Blocked users moderation routes', () => {
  let blockerToken: string;
  let blockedId: string;
  let blockedUsername: string;

  beforeAll(async () => {
    const blocker = await register('blocker');
    const blocked = await register('blocked');
    blockerToken = blocker.accessToken;
    blockedId = blocked.userId;
    blockedUsername = blocked.username;
  });

  it('lists empty blocked users initially', async () => {
    const response = await request(app)
      .get('/api/v1/users/blocked')
      .set('Authorization', `Bearer ${blockerToken}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.users).toEqual([]);
    expect(response.body.data.blockedUserIds).toEqual([]);
  });

  it('blocks a user and returns enriched list', async () => {
    const blockResponse = await request(app)
      .post(`/api/v1/users/${blockedId}/block`)
      .set('Authorization', `Bearer ${blockerToken}`);
    expect(blockResponse.status).toBe(200);

    const listResponse = await request(app)
      .get('/api/v1/users/blocked')
      .set('Authorization', `Bearer ${blockerToken}`);

    expect(listResponse.status).toBe(200);
    expect(listResponse.body.data.blockedUserIds).toContain(blockedId);
    expect(listResponse.body.data.users).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: blockedId,
          username: blockedUsername,
        }),
      ])
    );
  });

  it('unblocks a user', async () => {
    const unblockResponse = await request(app)
      .delete(`/api/v1/users/${blockedId}/block`)
      .set('Authorization', `Bearer ${blockerToken}`);
    expect(unblockResponse.status).toBe(200);

    const listResponse = await request(app)
      .get('/api/v1/users/blocked')
      .set('Authorization', `Bearer ${blockerToken}`);

    expect(listResponse.body.data.users).toEqual([]);
    expect(listResponse.body.data.blockedUserIds).toEqual([]);
  });
});
