import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { StickerVisibility, SubscriptionStatus } from '@prisma/client';
import { config } from '../config';
import { prisma } from '../prisma/client';
import { hashPassword, comparePassword } from '../utils/password';
import { accountPurgeService } from './account-purge.service';
import { verifyGoogleIdToken } from './google-token.verifier';
import {
  AppError,
  ValidationError,
  InvalidCredentialsError,
  AccountInactiveError,
  RefreshTokenInvalidError,
  RefreshTokenNotFoundError,
  RefreshTokenExpiredError,
  CurrentPasswordIncorrectError,
  EmailAlreadyInUseError,
  UsernameAlreadyInUseError,
  UnauthorizedError,
  AccountExistsPasswordError,
  GoogleAlreadyLinkedError,
  UseGoogleSignInError,
  NoPasswordSetError,
  CannotUnlinkSoleAuthError,
  ConflictError,
} from '../errors';

export const AUTH_PROVIDER_GOOGLE = 'GOOGLE';

export interface RegisterInput {
  email: string;
  username: string;
  password: string;
  displayName?: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface TokenPayload {
  sub: string;
  email: string;
  role: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

type UserWithRole = {
  id: string;
  email: string;
  username: string;
  displayName: string | null;
  passwordHash: string | null;
  role: { name: string };
  isActive: boolean;
  emailVerified: boolean;
  subscriptionTier: string;
  followerCount: number;
  followingCount: number;
  createdAt: Date;
};

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function validatePassword(password: string): void {
  if (password.length < 8) {
    throw new ValidationError('Password must be at least 8 characters long');
  }
  if (!/[A-Z]/.test(password)) {
    throw new ValidationError('Password must contain at least one uppercase letter');
  }
  if (!/[a-z]/.test(password)) {
    throw new ValidationError('Password must contain at least one lowercase letter');
  }
  if (!/[0-9]/.test(password)) {
    throw new ValidationError('Password must contain at least one number');
  }
  if (!/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password)) {
    throw new ValidationError('Password must contain at least one special character');
  }
}

function validateUsername(username: string): void {
  if (username.length < 3 || username.length > 30) {
    throw new ValidationError('Username must be between 3 and 30 characters');
  }
  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    throw new ValidationError('Username may only contain letters, numbers, and underscores');
  }
}

function generateTokens(payload: TokenPayload): AuthTokens {
  const accessToken = jwt.sign(payload, config.jwtSecret, {
    expiresIn: config.jwtAccessExpiration as jwt.SignOptions['expiresIn'],
    jwtid: crypto.randomUUID(),
  });

  const refreshToken = jwt.sign(payload, config.jwtRefreshSecret, {
    expiresIn: config.jwtRefreshExpiration as jwt.SignOptions['expiresIn'],
    jwtid: crypto.randomUUID(),
  });

  return { accessToken, refreshToken };
}

function parseExpirationToMs(expiration: string): number {
  const match = expiration.match(/^(\d+)([smhd])$/);
  if (!match) {
    return 7 * 24 * 60 * 60 * 1000;
  }

  const value = parseInt(match[1], 10);
  const unit = match[2];

  switch (unit) {
    case 's':
      return value * 1000;
    case 'm':
      return value * 60 * 1000;
    case 'h':
      return value * 60 * 60 * 1000;
    case 'd':
      return value * 24 * 60 * 60 * 1000;
    default:
      return 7 * 24 * 60 * 60 * 1000;
  }
}

function sanitizeUsernameBase(email: string): string {
  const local = email.split('@')[0] ?? 'user';
  let base = local.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_');
  base = base.replace(/^_+|_+$/g, '');
  if (base.length < 3) {
    base = `user_${base}`.replace(/_+/g, '_');
  }
  return base.slice(0, 24);
}

export class AuthService {
  async register(input: RegisterInput): Promise<{ user: unknown; tokens: AuthTokens }> {
    validatePassword(input.password);
    validateUsername(input.username.trim());

    const email = normalizeEmail(input.email);

    const existingEmail = await prisma.user.findUnique({
      where: { email },
      include: { authIdentities: true },
    });
    if (existingEmail) {
      const isGoogleOnly =
        !existingEmail.passwordHash &&
        existingEmail.authIdentities.some((i) => i.provider === AUTH_PROVIDER_GOOGLE);
      throw new EmailAlreadyInUseError(
        isGoogleOnly
          ? 'Email already in use. Sign in with Google instead.'
          : 'Email already in use'
      );
    }

    const username = input.username.trim();
    const existingUsername = await prisma.user.findUnique({
      where: { username },
    });
    if (existingUsername) {
      throw new UsernameAlreadyInUseError();
    }

    const userRole = await prisma.role.findUnique({
      where: { name: 'user' },
    });
    if (!userRole) {
      throw new AppError('Default role not found', 500, 'INTERNAL_ERROR');
    }

    const passwordHash = await hashPassword(input.password);

    const user = await prisma.user.create({
      data: {
        email,
        username,
        passwordHash,
        displayName: input.displayName,
        roleId: userRole.id,
      },
      include: { role: true, authIdentities: true },
    });

    const tokens = await this.issueTokensForUser(user);

    return {
      user: this.toAuthUser(user),
      tokens,
    };
  }

  async login(input: LoginInput): Promise<{ user: unknown; tokens: AuthTokens }> {
    const email = normalizeEmail(input.email);
    const user = await prisma.user.findUnique({
      where: { email },
      include: { role: true, authIdentities: true },
    });

    if (!user) {
      throw new InvalidCredentialsError();
    }

    if (!user.isActive) {
      throw new AccountInactiveError();
    }

    if (!user.passwordHash) {
      throw new UseGoogleSignInError();
    }

    const isValid = await comparePassword(input.password, user.passwordHash);
    if (!isValid) {
      throw new InvalidCredentialsError();
    }

    const tokens = await this.issueTokensForUser(user);

    return {
      user: this.toAuthUser(user),
      tokens,
    };
  }

  async loginWithGoogle(idToken: string): Promise<{ user: unknown; tokens: AuthTokens }> {
    const identity = await verifyGoogleIdToken(idToken);

    const existingIdentity = await prisma.authIdentity.findUnique({
      where: {
        provider_providerUserId: {
          provider: AUTH_PROVIDER_GOOGLE,
          providerUserId: identity.sub,
        },
      },
      include: { user: { include: { role: true, authIdentities: true } } },
    });

    if (existingIdentity) {
      if (!existingIdentity.user.isActive) {
        throw new AccountInactiveError();
      }
      const tokens = await this.issueTokensForUser(existingIdentity.user);
      return { user: this.toAuthUser(existingIdentity.user), tokens };
    }

    const existingEmailUser = await prisma.user.findUnique({
      where: { email: identity.email },
      include: { role: true, authIdentities: true },
    });

    if (existingEmailUser) {
      if (!existingEmailUser.isActive) {
        throw new AccountInactiveError();
      }

      const hasGoogle = existingEmailUser.authIdentities.some(
        (i) => i.provider === AUTH_PROVIDER_GOOGLE
      );
      if (hasGoogle) {
        throw new ConflictError(
          'This email is already linked to a different Google account',
          'GOOGLE_EMAIL_CONFLICT'
        );
      }

      if (existingEmailUser.passwordHash) {
        throw new AccountExistsPasswordError(undefined, { email: identity.email });
      }

      throw new ConflictError(
        'An account with this email already exists',
        'EMAIL_ALREADY_IN_USE'
      );
    }

    const user = await this.createGoogleUserWithSub(identity.email, identity.sub, identity.name);
    const tokens = await this.issueTokensForUser(user);
    return { user: this.toAuthUser(user), tokens };
  }

  async linkGoogleWithPassword(
    idToken: string,
    email: string,
    password: string
  ): Promise<{ user: unknown; tokens: AuthTokens }> {
    const identity = await verifyGoogleIdToken(idToken);
    const normalizedEmail = normalizeEmail(email);

    if (identity.email !== normalizedEmail) {
      throw new ValidationError('Email does not match the Google account');
    }

    const existingIdentity = await prisma.authIdentity.findUnique({
      where: {
        provider_providerUserId: {
          provider: AUTH_PROVIDER_GOOGLE,
          providerUserId: identity.sub,
        },
      },
    });
    if (existingIdentity) {
      throw new GoogleAlreadyLinkedError();
    }

    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      include: { role: true, authIdentities: true },
    });

    if (!user || !user.isActive) {
      throw new InvalidCredentialsError();
    }

    if (!user.passwordHash) {
      throw new UseGoogleSignInError();
    }

    const isValid = await comparePassword(password, user.passwordHash);
    if (!isValid) {
      throw new InvalidCredentialsError();
    }

    if (user.authIdentities.some((i) => i.provider === AUTH_PROVIDER_GOOGLE)) {
      throw new GoogleAlreadyLinkedError('Google is already linked to this account');
    }

    await prisma.authIdentity.create({
      data: {
        userId: user.id,
        provider: AUTH_PROVIDER_GOOGLE,
        providerUserId: identity.sub,
      },
    });

    if (!user.emailVerified) {
      await prisma.user.update({
        where: { id: user.id },
        data: { emailVerified: true },
      });
      user.emailVerified = true;
    }

    const refreshed = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      include: { role: true, authIdentities: true },
    });

    const tokens = await this.issueTokensForUser(refreshed);
    return { user: this.toAuthUser(refreshed), tokens };
  }

  async linkGoogle(userId: string, idToken: string): Promise<unknown> {
    const identity = await verifyGoogleIdToken(idToken);

    const existingIdentity = await prisma.authIdentity.findUnique({
      where: {
        provider_providerUserId: {
          provider: AUTH_PROVIDER_GOOGLE,
          providerUserId: identity.sub,
        },
      },
    });
    if (existingIdentity) {
      if (existingIdentity.userId !== userId) {
        throw new GoogleAlreadyLinkedError();
      }
      return this.getCurrentUser(userId);
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { role: true, authIdentities: true },
    });
    if (!user || !user.isActive) {
      throw new UnauthorizedError('User not found');
    }

    if (user.authIdentities.some((i) => i.provider === AUTH_PROVIDER_GOOGLE)) {
      throw new GoogleAlreadyLinkedError('Google is already linked to this account');
    }

    if (normalizeEmail(user.email) !== identity.email) {
      throw new ValidationError(
        'Google account email must match your Setiker account email'
      );
    }

    await prisma.authIdentity.create({
      data: {
        userId: user.id,
        provider: AUTH_PROVIDER_GOOGLE,
        providerUserId: identity.sub,
      },
    });

    if (!user.emailVerified) {
      await prisma.user.update({
        where: { id: user.id },
        data: { emailVerified: true },
      });
    }

    return this.getCurrentUser(userId);
  }

  async unlinkGoogle(userId: string): Promise<unknown> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { authIdentities: true },
    });
    if (!user) {
      throw new UnauthorizedError('User not found');
    }

    const googleIdentity = user.authIdentities.find((i) => i.provider === AUTH_PROVIDER_GOOGLE);
    if (!googleIdentity) {
      throw new ValidationError('Google is not linked to this account');
    }

    if (!user.passwordHash) {
      throw new CannotUnlinkSoleAuthError();
    }

    await prisma.authIdentity.delete({
      where: { id: googleIdentity.id },
    });

    return this.getCurrentUser(userId);
  }

  async setPassword(userId: string, newPassword: string): Promise<void> {
    validatePassword(newPassword);

    const user = await prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) {
      throw new UnauthorizedError('User not found');
    }

    if (user.passwordHash) {
      throw new ValidationError(
        'Password already set. Use change-password instead.',
        { subcode: 'PASSWORD_ALREADY_SET' }
      );
    }

    const passwordHash = await hashPassword(newPassword);
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });
  }

  async logout(refreshToken: string): Promise<void> {
    await prisma.refreshToken.deleteMany({
      where: { token: refreshToken },
    });
  }

  async refreshAccessToken(refreshToken: string): Promise<AuthTokens> {
    try {
      jwt.verify(refreshToken, config.jwtRefreshSecret);
    } catch {
      throw new RefreshTokenInvalidError();
    }

    const storedToken = await prisma.refreshToken.findUnique({
      where: { token: refreshToken },
      include: { user: { include: { role: true } } },
    });

    if (!storedToken) {
      throw new RefreshTokenNotFoundError();
    }

    if (storedToken.expiresAt < new Date()) {
      await prisma.refreshToken.deleteMany({
        where: { token: refreshToken },
      });
      throw new RefreshTokenExpiredError();
    }

    await prisma.refreshToken.deleteMany({
      where: { token: refreshToken },
    });

    const newPayload: TokenPayload = {
      sub: storedToken.user.id,
      email: storedToken.user.email,
      role: storedToken.user.role.name,
    };

    const tokens = generateTokens(newPayload);

    const refreshExpiresIn = parseExpirationToMs(config.jwtRefreshExpiration);
    await prisma.refreshToken.create({
      data: {
        userId: storedToken.user.id,
        token: tokens.refreshToken,
        expiresAt: new Date(Date.now() + refreshExpiresIn),
      },
    });

    return tokens;
  }

  async getCurrentUser(userId: string): Promise<unknown> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { role: true, authIdentities: true },
    });

    if (!user) {
      throw new UnauthorizedError('User not found');
    }

    const downloadsAggregate = await prisma.stickerPack.aggregate({
      where: { ownerId: userId, deletedAt: null },
      _sum: { downloadCount: true },
    });

    return this.toPublicUser(user, downloadsAggregate._sum.downloadCount ?? 0);
  }

  async updateProfile(
    userId: string,
    input: { displayName?: string | null; username?: string }
  ): Promise<unknown> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { role: true, authIdentities: true },
    });

    if (!user) {
      throw new UnauthorizedError('User not found');
    }

    const data: { displayName?: string | null; username?: string } = {};

    if (input.username !== undefined) {
      const username = input.username.trim();
      validateUsername(username);
      if (username !== user.username) {
        const existingUsername = await prisma.user.findUnique({
          where: { username },
        });
        if (existingUsername) {
          throw new UsernameAlreadyInUseError();
        }
        data.username = username;
      }
    }

    if (input.displayName !== undefined) {
      if (input.displayName === null) {
        data.displayName = null;
      } else {
        const trimmed = String(input.displayName).trim();
        data.displayName = trimmed.length === 0 ? null : trimmed;
      }
    }

    if (Object.keys(data).length === 0) {
      const downloadsAggregate = await prisma.stickerPack.aggregate({
        where: { ownerId: userId, deletedAt: null },
        _sum: { downloadCount: true },
      });
      return this.toPublicUser(user, downloadsAggregate._sum.downloadCount ?? 0);
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data,
      include: { role: true, authIdentities: true },
    });

    const downloadsAggregate = await prisma.stickerPack.aggregate({
      where: { ownerId: userId, deletedAt: null },
      _sum: { downloadCount: true },
    });

    return this.toPublicUser(updated, downloadsAggregate._sum.downloadCount ?? 0);
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string
  ): Promise<void> {
    validatePassword(newPassword);

    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new UnauthorizedError('User not found');
    }

    if (!user.passwordHash) {
      throw new NoPasswordSetError();
    }

    const isValid = await comparePassword(currentPassword, user.passwordHash);
    if (!isValid) {
      throw new CurrentPasswordIncorrectError();
    }

    const newPasswordHash = await hashPassword(newPassword);

    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash: newPasswordHash },
    });

    await prisma.refreshToken.deleteMany({
      where: { userId },
    });
  }

  async deleteAccount(userId: string, currentPassword?: string | null): Promise<void> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new UnauthorizedError('User not found', 'UNAUTHORIZED');
    }

    if (user.passwordHash) {
      if (!currentPassword) {
        throw new ValidationError('Current password is required');
      }
      const isValid = await comparePassword(currentPassword, user.passwordHash);
      if (!isValid) {
        throw new CurrentPasswordIncorrectError();
      }
    }

    await this.performAccountDeletionInternal(userId);
  }

  /** Admin/web deletion fulfillment — skips password check. */
  async performAccountDeletionInternal(userId: string): Promise<void> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user?.isActive) {
      return;
    }

    const deletedAt = new Date();
    const anonymizedEmail = `deleted_${userId}@deleted.local`;
    const anonymizedUsername = `deleted_${userId.replace(/-/g, '')}`;
    const newPasswordHash = await hashPassword(crypto.randomUUID());
    const storagePaths: string[] = [];

    const stickers = await prisma.sticker.findMany({
      where: { ownerId: userId, deletedAt: null },
      select: { filename: true },
    });
    for (const sticker of stickers) {
      if (sticker.filename) storagePaths.push(sticker.filename);
    }

    const historyRecords = await prisma.processingHistory.findMany({
      where: { userId },
      select: { outputFiles: true },
    });
    for (const record of historyRecords) {
      storagePaths.push(...extractOutputFilePaths(record.outputFiles));
    }

    await prisma.$transaction(async (tx) => {
      await tx.refreshToken.deleteMany({ where: { userId } });
      await tx.authIdentity.deleteMany({ where: { userId } });

      await tx.stickerPack.updateMany({
        where: { ownerId: userId, deletedAt: null },
        data: { deletedAt, visibility: StickerVisibility.PRIVATE },
      });

      await tx.sticker.updateMany({
        where: { ownerId: userId, deletedAt: null },
        data: { deletedAt },
      });

      await tx.processingHistory.deleteMany({ where: { userId } });

      await tx.stickerPackLike.deleteMany({ where: { userId } });
      await tx.stickerPackSave.deleteMany({ where: { userId } });
      await tx.stickerPackDownload.deleteMany({ where: { userId } });
      await tx.userFollow.deleteMany({
        where: { OR: [{ followerId: userId }, { followingId: userId }] },
      });
      await tx.stickerPackShare.deleteMany({
        where: { OR: [{ sharedWithId: userId }, { grantedBy: userId }] },
      });
      await tx.stickerPackShareLink.deleteMany({ where: { createdBy: userId } });
      await tx.userBlock.deleteMany({
        where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
      });

      await tx.userSubscription.updateMany({
        where: {
          userId,
          status: {
            in: [
              SubscriptionStatus.ACTIVE,
              SubscriptionStatus.GRACE_PERIOD,
              SubscriptionStatus.ON_HOLD,
              SubscriptionStatus.PAUSED,
              SubscriptionStatus.PAST_DUE,
            ],
          },
        },
        data: {
          status: SubscriptionStatus.CANCELLED,
          autoRenewing: false,
          cancelAtPeriodEnd: true,
        },
      });

      await tx.user.update({
        where: { id: userId },
        data: {
          isActive: false,
          email: anonymizedEmail,
          username: anonymizedUsername,
          displayName: 'Deleted User',
          passwordHash: newPasswordHash,
          followerCount: 0,
          followingCount: 0,
        },
      });
    });

    await accountPurgeService.enqueuePaths(storagePaths);
  }

  private async createGoogleUserWithSub(
    email: string,
    googleSub: string,
    displayName?: string
  ): Promise<UserWithRole & { authIdentities: { provider: string; providerUserId: string }[] }> {
    const userRole = await prisma.role.findUnique({
      where: { name: 'user' },
    });
    if (!userRole) {
      throw new AppError('Default role not found', 500, 'INTERNAL_ERROR');
    }

    const username = await this.allocateUsername(email);

    return prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email,
          username,
          passwordHash: null,
          displayName: displayName ?? null,
          roleId: userRole.id,
          emailVerified: true,
          authIdentities: {
            create: {
              provider: AUTH_PROVIDER_GOOGLE,
              providerUserId: googleSub,
            },
          },
        },
        include: { role: true, authIdentities: true },
      });
      return created;
    });
  }

  private async allocateUsername(email: string): Promise<string> {
    const base = sanitizeUsernameBase(email);
    for (let attempt = 0; attempt < 12; attempt++) {
      const suffix = attempt === 0 ? '' : `_${crypto.randomBytes(2).toString('hex')}`;
      const candidate = `${base}${suffix}`.slice(0, 30);
      if (candidate.length < 3) continue;
      const existing = await prisma.user.findUnique({ where: { username: candidate } });
      if (!existing) return candidate;
    }
    return `user_${crypto.randomBytes(4).toString('hex')}`;
  }

  private async issueTokensForUser(user: {
    id: string;
    email: string;
    role: { name: string };
  }): Promise<AuthTokens> {
    const payload: TokenPayload = {
      sub: user.id,
      email: user.email,
      role: user.role.name,
    };

    const tokens = generateTokens(payload);

    const refreshExpiresIn = parseExpirationToMs(config.jwtRefreshExpiration);
    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        token: tokens.refreshToken,
        expiresAt: new Date(Date.now() + refreshExpiresIn),
      },
    });

    return tokens;
  }

  private toAuthUser(
    user: UserWithRole & { authIdentities?: { provider: string }[] }
  ): unknown {
    const providers = (user.authIdentities ?? []).map((i) => i.provider);
    if (user.passwordHash) {
      providers.unshift('PASSWORD');
    }
    return {
      id: user.id,
      email: user.email,
      username: user.username,
      displayName: user.displayName,
      role: user.role.name,
      hasPassword: Boolean(user.passwordHash),
      authProviders: [...new Set(providers)],
      emailVerified: user.emailVerified,
    };
  }

  private toPublicUser(
    user: UserWithRole & { authIdentities?: { provider: string }[] },
    totalPackDownloads: number
  ): unknown {
    const providers = (user.authIdentities ?? []).map((i) => i.provider);
    if (user.passwordHash) {
      providers.unshift('PASSWORD');
    }
    return {
      id: user.id,
      email: user.email,
      username: user.username,
      displayName: user.displayName,
      role: user.role.name,
      isActive: user.isActive,
      emailVerified: user.emailVerified,
      hasPassword: Boolean(user.passwordHash),
      authProviders: [...new Set(providers)],
      subscriptionTier: user.subscriptionTier,
      followerCount: user.followerCount,
      followingCount: user.followingCount,
      totalPackDownloads,
      createdAt: user.createdAt,
    };
  }
}

function extractOutputFilePaths(outputFiles: unknown): string[] {
  if (!Array.isArray(outputFiles)) return [];
  const paths: string[] = [];
  for (const item of outputFiles) {
    if (item && typeof item === 'object' && 'path' in item) {
      const filePath = (item as { path?: string }).path;
      if (filePath) paths.push(filePath);
    }
  }
  return paths;
}
