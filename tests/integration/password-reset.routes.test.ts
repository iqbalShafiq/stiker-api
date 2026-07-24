import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import app from '../../src/app';
import { prisma } from '../../src/prisma/client';
import { hashPassword } from '../../src/utils/password';

vi.mock('../../src/services/mail/resend.mailer', () => ({
  sendPasswordResetEmail: vi.fn().mockResolvedValue(undefined),
}));

import { sendPasswordResetEmail } from '../../src/services/mail/resend.mailer';

const mockedSend = vi.mocked(sendPasswordResetEmail);

describe('Password reset routes', () => {
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
      where: { email: { startsWith: 'pwreset-' } },
      select: { id: true },
    });
    for (const user of users) {
      await prisma.passwordResetToken.deleteMany({ where: { userId: user.id } });
      await prisma.refreshToken.deleteMany({ where: { userId: user.id } });
      await prisma.authIdentity.deleteMany({ where: { userId: user.id } });
    }
    await prisma.user.deleteMany({ where: { email: { startsWith: 'pwreset-' } } });
  }

  it('POST /auth/forgot-password always returns 200 and emails when user exists', async () => {
    const email = `pwreset-user-${Date.now()}@example.com`;
    const role = await prisma.role.findUnique({ where: { name: 'user' } });
    await prisma.user.create({
      data: {
        email,
        username: `pwreset${Date.now()}`,
        passwordHash: await hashPassword('StrongPass1!'),
        roleId: role!.id,
      },
    });

    const response = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email });

    expect(response.status).toBe(200);
    expect(mockedSend).toHaveBeenCalledTimes(1);
    expect(mockedSend.mock.calls[0][0].to).toBe(email);
    expect(mockedSend.mock.calls[0][0].isFirstTimeSet).toBe(false);

    const tokens = await prisma.passwordResetToken.findMany({
      where: { user: { email } },
    });
    expect(tokens).toHaveLength(1);
  });

  it('POST /auth/forgot-password works for OAuth-only users (first-time set)', async () => {
    const email = `pwreset-oauth-${Date.now()}@example.com`;
    const role = await prisma.role.findUnique({ where: { name: 'user' } });
    await prisma.user.create({
      data: {
        email,
        username: `pwreseto${Date.now()}`,
        passwordHash: null,
        emailVerified: true,
        roleId: role!.id,
        authIdentities: {
          create: { provider: 'APPLE', providerUserId: `apple-${Date.now()}` },
        },
      },
    });

    const response = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email });

    expect(response.status).toBe(200);
    expect(mockedSend).toHaveBeenCalledTimes(1);
    expect(mockedSend.mock.calls[0][0].isFirstTimeSet).toBe(true);
  });

  it('POST /auth/forgot-password returns 200 for unknown email without sending', async () => {
    const response = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: `pwreset-missing-${Date.now()}@example.com` });

    expect(response.status).toBe(200);
    expect(mockedSend).not.toHaveBeenCalled();
  });

  it('POST /auth/reset-password sets password and invalidates token', async () => {
    const email = `pwreset-set-${Date.now()}@example.com`;
    const role = await prisma.role.findUnique({ where: { name: 'user' } });
    const user = await prisma.user.create({
      data: {
        email,
        username: `pwresets${Date.now()}`,
        passwordHash: null,
        roleId: role!.id,
        authIdentities: {
          create: { provider: 'GOOGLE', providerUserId: `g-${Date.now()}` },
        },
      },
    });

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    const response = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token: rawToken, newPassword: 'NewStrong1!' });

    expect(response.status).toBe(200);

    const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(updated.passwordHash).toBeTruthy();

    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password: 'NewStrong1!' });
    expect(login.status).toBe(200);

    const reuse = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token: rawToken, newPassword: 'Another1!' });
    expect(reuse.status).toBe(400);
  });
});
