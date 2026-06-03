import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { prisma } from '../prisma/client';
import { hashPassword, comparePassword } from '../utils/password';
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
} from '../errors';

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

export class AuthService {
  async register(input: RegisterInput): Promise<{ user: unknown; tokens: AuthTokens }> {
    validatePassword(input.password);

    const existingEmail = await prisma.user.findUnique({
      where: { email: input.email },
    });
    if (existingEmail) {
      throw new EmailAlreadyInUseError();
    }

    const existingUsername = await prisma.user.findUnique({
      where: { username: input.username },
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
        email: input.email,
        username: input.username,
        passwordHash,
        displayName: input.displayName,
        roleId: userRole.id,
      },
      include: { role: true },
    });

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

    return {
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        displayName: user.displayName,
        role: user.role.name,
      },
      tokens,
    };
  }

  async login(input: LoginInput): Promise<{ user: unknown; tokens: AuthTokens }> {
    const user = await prisma.user.findUnique({
      where: { email: input.email },
      include: { role: true },
    });

    if (!user) {
      throw new InvalidCredentialsError();
    }

    if (!user.isActive) {
      throw new AccountInactiveError();
    }

    const isValid = await comparePassword(input.password, user.passwordHash);
    if (!isValid) {
      throw new InvalidCredentialsError();
    }

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

    return {
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        displayName: user.displayName,
        role: user.role.name,
      },
      tokens,
    };
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
      include: { role: true },
    });

    if (!user) {
      throw new UnauthorizedError('User not found');
    }

    return {
      id: user.id,
      email: user.email,
      username: user.username,
      displayName: user.displayName,
      role: user.role.name,
      isActive: user.isActive,
      emailVerified: user.emailVerified,
      subscriptionTier: user.subscriptionTier,
      followerCount: user.followerCount,
      followingCount: user.followingCount,
      createdAt: user.createdAt,
    };
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

  async deleteAccount(userId: string, currentPassword: string): Promise<void> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new UnauthorizedError('User not found', 'UNAUTHORIZED');
    }

    const isValid = await comparePassword(currentPassword, user.passwordHash);
    if (!isValid) {
      throw new CurrentPasswordIncorrectError();
    }

    const deletedAt = new Date();
    const anonymizedEmail = `deleted_${userId}@deleted.local`;
    const anonymizedUsername = `deleted_${userId.replace(/-/g, '')}`;

    const newPasswordHash = await hashPassword(crypto.randomUUID());

    await prisma.$transaction(async (tx) => {
      await tx.refreshToken.deleteMany({ where: { userId } });
      await tx.sticker.updateMany({
        where: { ownerId: userId, deletedAt: null },
        data: { deletedAt },
      });
      await tx.stickerPack.updateMany({
        where: { ownerId: userId, deletedAt: null },
        data: { deletedAt },
      });
      await tx.user.update({
        where: { id: userId },
        data: {
          isActive: false,
          email: anonymizedEmail,
          username: anonymizedUsername,
          displayName: 'Deleted User',
          passwordHash: newPasswordHash,
        },
      });
    });
  }
}
