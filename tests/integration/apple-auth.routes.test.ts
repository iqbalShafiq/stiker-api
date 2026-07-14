import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import app from '../../src/app';
import { prisma } from '../../src/prisma/client';
import { hashPassword } from '../../src/utils/password';

vi.mock('../../src/services/apple-token.verifier', () => ({
  verifyAppleIdToken: vi.fn(),
}));

vi.mock('../../src/services/google-token.verifier', () => ({
  verifyGoogleIdToken: vi.fn(),
}));

import { verifyAppleIdToken } from '../../src/services/apple-token.verifier';
import { verifyGoogleIdToken } from '../../src/services/google-token.verifier';

const mockedApple = vi.mocked(verifyAppleIdToken);
const mockedGoogle = vi.mocked(verifyGoogleIdToken);

describe('Apple Auth + OAuth continuity', () => {
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
      where: {
        OR: [
          { email: { startsWith: 'apple-oauth-' } },
          { email: { startsWith: 'cont-oauth-' } },
        ],
      },
      select: { id: true },
    });
    for (const user of users) {
      await prisma.passwordResetToken.deleteMany({ where: { userId: user.id } });
      await prisma.refreshToken.deleteMany({ where: { userId: user.id } });
      await prisma.authIdentity.deleteMany({ where: { userId: user.id } });
    }
    await prisma.user.deleteMany({
      where: {
        OR: [
          { email: { startsWith: 'apple-oauth-' } },
          { email: { startsWith: 'cont-oauth-' } },
        ],
      },
    });
  }

  it('POST /auth/apple creates an Apple-only account', async () => {
    const email = `apple-oauth-new-${Date.now()}@example.com`;
    mockedApple.mockResolvedValue({
      sub: `apple-sub-${Date.now()}`,
      email,
      emailVerified: true,
      isPrivateEmail: false,
    });

    const response = await request(app)
      .post('/api/v1/auth/apple')
      .send({ idToken: 'fake-apple' });

    expect(response.status).toBe(200);
    expect(response.body.data.user.hasPassword).toBe(false);
    expect(response.body.data.user.authProviders).toContain('APPLE');
  });

  it('POST /auth/login returns USE_OAUTH_OR_SET_PASSWORD for Apple-only users', async () => {
    const email = `apple-oauth-only-${Date.now()}@example.com`;
    const role = await prisma.role.findUnique({ where: { name: 'user' } });
    await prisma.user.create({
      data: {
        email,
        username: `appleo${Date.now()}`,
        passwordHash: null,
        emailVerified: true,
        roleId: role!.id,
        authIdentities: {
          create: { provider: 'APPLE', providerUserId: `a-${Date.now()}` },
        },
      },
    });

    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password });

    expect(response.status).toBe(401);
    expect(JSON.stringify(response.body)).toContain('USE_OAUTH_OR_SET_PASSWORD');
    expect(JSON.stringify(response.body)).toContain('APPLE');
  });

  it('POST /auth/google returns ACCOUNT_EXISTS_OTHER_PROVIDER for Apple-only email', async () => {
    const email = `cont-oauth-apple-${Date.now()}@example.com`;
    const role = await prisma.role.findUnique({ where: { name: 'user' } });
    await prisma.user.create({
      data: {
        email,
        username: `contap${Date.now()}`,
        passwordHash: null,
        emailVerified: true,
        roleId: role!.id,
        authIdentities: {
          create: { provider: 'APPLE', providerUserId: `ap-${Date.now()}` },
        },
      },
    });

    mockedGoogle.mockResolvedValue({
      sub: `g-${Date.now()}`,
      email,
      emailVerified: true,
    });

    const response = await request(app)
      .post('/api/v1/auth/google')
      .send({ idToken: 'fake-google' });

    expect(response.status).toBe(409);
    expect(JSON.stringify(response.body)).toContain('ACCOUNT_EXISTS_OTHER_PROVIDER');
    expect(JSON.stringify(response.body)).toContain('APPLE');
  });

  it('POST /auth/apple/link-with-password links Apple to password account', async () => {
    const email = `apple-oauth-link-${Date.now()}@example.com`;
    const role = await prisma.role.findUnique({ where: { name: 'user' } });
    await prisma.user.create({
      data: {
        email,
        username: `applink${Date.now()}`,
        passwordHash: await hashPassword(password),
        roleId: role!.id,
      },
    });

    const sub = `apple-link-${Date.now()}`;
    mockedApple.mockResolvedValue({
      sub,
      email,
      emailVerified: true,
      isPrivateEmail: false,
    });

    const response = await request(app)
      .post('/api/v1/auth/apple/link-with-password')
      .send({ idToken: 'fake', email, password });

    expect(response.status).toBe(200);
    expect(response.body.data.user.authProviders).toEqual(
      expect.arrayContaining(['PASSWORD', 'APPLE'])
    );
  });
});
