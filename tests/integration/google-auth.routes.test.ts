import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import app from '../../src/app';
import { prisma } from '../../src/prisma/client';
import { hashPassword } from '../../src/utils/password';

vi.mock('../../src/services/google-token.verifier', () => ({
  verifyGoogleIdToken: vi.fn(),
}));

import { verifyGoogleIdToken } from '../../src/services/google-token.verifier';

const mockedVerify = vi.mocked(verifyGoogleIdToken);

describe('Google Auth Routes Integration', () => {
  const password = 'StrongPass1!';

  beforeAll(async () => {
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await cleanup();
    vi.clearAllMocks();
  });

  async function cleanup() {
    const users = await prisma.user.findMany({
      where: { email: { startsWith: 'google-oauth-' } },
      select: { id: true },
    });
    for (const user of users) {
      await prisma.refreshToken.deleteMany({ where: { userId: user.id } });
      await prisma.authIdentity.deleteMany({ where: { userId: user.id } });
    }
    await prisma.user.deleteMany({
      where: { email: { startsWith: 'google-oauth-' } },
    });
  }

  it('POST /auth/google creates a Google-only account', async () => {
    const email = `google-oauth-new-${Date.now()}@example.com`;
    mockedVerify.mockResolvedValue({
      sub: `sub-new-${Date.now()}`,
      email,
      emailVerified: true,
      name: 'Google User',
    });

    const response = await request(app)
      .post('/api/v1/auth/google')
      .send({ idToken: 'fake-token' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.user.email).toBe(email);
    expect(response.body.data.user.hasPassword).toBe(false);
    expect(response.body.data.user.authProviders).toContain('GOOGLE');
    expect(response.body.data.accessToken).toBeDefined();
  });

  it('POST /auth/google returns ACCOUNT_EXISTS_PASSWORD for password accounts', async () => {
    const email = `google-oauth-pass-${Date.now()}@example.com`;
    const role = await prisma.role.findUnique({ where: { name: 'user' } });
    expect(role).toBeTruthy();

    await prisma.user.create({
      data: {
        email,
        username: `gopass${Date.now()}`,
        passwordHash: await hashPassword(password),
        roleId: role!.id,
      },
    });

    mockedVerify.mockResolvedValue({
      sub: `sub-pass-${Date.now()}`,
      email,
      emailVerified: true,
    });

    const response = await request(app)
      .post('/api/v1/auth/google')
      .send({ idToken: 'fake-token' });

    expect(response.status).toBe(409);
    expect(response.body.error?.subcode ?? response.body.subcode).toBeDefined();
    const body = JSON.stringify(response.body);
    expect(body).toContain('ACCOUNT_EXISTS_PASSWORD');
  });

  it('POST /auth/google/link-with-password links and logs in', async () => {
    const email = `google-oauth-link-${Date.now()}@example.com`;
    const role = await prisma.role.findUnique({ where: { name: 'user' } });
    await prisma.user.create({
      data: {
        email,
        username: `golink${Date.now()}`,
        passwordHash: await hashPassword(password),
        roleId: role!.id,
      },
    });

    const sub = `sub-link-${Date.now()}`;
    mockedVerify.mockResolvedValue({
      sub,
      email,
      emailVerified: true,
    });

    const response = await request(app)
      .post('/api/v1/auth/google/link-with-password')
      .send({ idToken: 'fake-token', email, password });

    expect(response.status).toBe(200);
    expect(response.body.data.user.authProviders).toEqual(
      expect.arrayContaining(['PASSWORD', 'GOOGLE'])
    );

    const identity = await prisma.authIdentity.findUnique({
      where: {
        provider_providerUserId: { provider: 'GOOGLE', providerUserId: sub },
      },
    });
    expect(identity).toBeTruthy();
  });

  it('POST /auth/login returns USE_OAUTH_OR_SET_PASSWORD for Google-only users', async () => {
    const email = `google-oauth-only-${Date.now()}@example.com`;
    const role = await prisma.role.findUnique({ where: { name: 'user' } });
    const user = await prisma.user.create({
      data: {
        email,
        username: `goonly${Date.now()}`,
        passwordHash: null,
        emailVerified: true,
        roleId: role!.id,
        authIdentities: {
          create: {
            provider: 'GOOGLE',
            providerUserId: `sub-only-${Date.now()}`,
          },
        },
      },
    });
    expect(user.passwordHash).toBeNull();

    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password });

    expect(response.status).toBe(401);
    expect(JSON.stringify(response.body)).toContain('USE_OAUTH_OR_SET_PASSWORD');
  });

  it('DELETE /auth/me works without password for Google-only users', async () => {
    const email = `google-oauth-del-${Date.now()}@example.com`;
    mockedVerify.mockResolvedValue({
      sub: `sub-del-${Date.now()}`,
      email,
      emailVerified: true,
      name: 'Del User',
    });

    const login = await request(app)
      .post('/api/v1/auth/google')
      .send({ idToken: 'fake-token' });
    expect(login.status).toBe(200);
    const token = login.body.data.accessToken as string;

    const response = await request(app)
      .delete('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(response.status).toBe(200);

    const user = await prisma.user.findFirst({
      where: { email: { startsWith: 'deleted_' } },
      orderBy: { updatedAt: 'desc' },
    });
    expect(user?.isActive).toBe(false);
  });
});
