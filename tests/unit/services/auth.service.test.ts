import { describe, it, expect, beforeEach, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { AuthService } from '../../../src/services/auth.service';
import { prisma } from '../../../src/prisma/client';
import { hashPassword, comparePassword } from '../../../src/utils/password';
import {
  ValidationError,
  UnauthorizedError,
  ConflictError,
  AppError,
} from '../../../src/errors';

const mockedPrisma = vi.mocked(prisma);
const mockedHashPassword = vi.mocked(hashPassword);
const mockedComparePassword = vi.mocked(comparePassword);
const mockedJwtSign = vi.mocked(jwt.sign);
const mockedJwtVerify = vi.mocked(jwt.verify);

vi.mock('../../../src/prisma/client', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    role: {
      findUnique: vi.fn(),
    },
    refreshToken: {
      findUnique: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

vi.mock('../../../src/utils/password', () => ({
  hashPassword: vi.fn(),
  comparePassword: vi.fn(),
}));

vi.mock('jsonwebtoken', () => ({
  default: {
    sign: vi.fn(),
    verify: vi.fn(),
    TokenExpiredError: class TokenExpiredError extends Error {
      name = 'TokenExpiredError';
    },
    JsonWebTokenError: class JsonWebTokenError extends Error {
      name = 'JsonWebTokenError';
    },
  },
  sign: vi.fn(),
  verify: vi.fn(),
  TokenExpiredError: class TokenExpiredError extends Error {
    name = 'TokenExpiredError';
  },
  JsonWebTokenError: class JsonWebTokenError extends Error {
    name = 'JsonWebTokenError';
  },
}));

describe('AuthService', () => {
  const service = new AuthService();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('register', () => {
    it('should register a new user successfully', async () => {
      const role = { id: 'role-1', name: 'user' };
      const user = {
        id: 'user-1',
        email: 'test@example.com',
        username: 'testuser',
        passwordHash: 'hashed',
        displayName: 'Test User',
        role,
        isActive: true,
        emailVerified: false,
        createdAt: new Date(),
      };

      vi.mocked(mockedPrisma.role.findUnique).mockResolvedValue(role as any);
      vi.mocked(mockedPrisma.user.findUnique).mockResolvedValue(null);
      vi.mocked(mockedPrisma.user.create).mockResolvedValue(user as any);
      vi.mocked(mockedHashPassword).mockResolvedValue('hashed');
      vi.mocked(mockedJwtSign).mockReturnValue('mock-token' as any);
      vi.mocked(mockedPrisma.refreshToken.create).mockResolvedValue({} as any);

      const result = await service.register({
        email: 'test@example.com',
        username: 'testuser',
        password: 'StrongPass1!',
        displayName: 'Test User',
      });

      expect(result.user).toEqual({
        id: 'user-1',
        email: 'test@example.com',
        username: 'testuser',
        displayName: 'Test User',
        role: 'user',
      });
      expect(result.tokens).toEqual({
        accessToken: 'mock-token',
        refreshToken: 'mock-token',
      });
      expect(mockedPrisma.user.create).toHaveBeenCalled();
    });

    it('should throw ValidationError for weak password', async () => {
      await expect(
        service.register({
          email: 'test@example.com',
          username: 'testuser',
          password: 'weak',
        })
      ).rejects.toThrow(ValidationError);
    });

    it('should throw ConflictError for duplicate email', async () => {
      vi.mocked(mockedPrisma.user.findUnique).mockResolvedValue({ id: 'existing' } as any);

      await expect(
        service.register({
          email: 'test@example.com',
          username: 'testuser',
          password: 'StrongPass1!',
        })
      ).rejects.toThrow(ConflictError);
    });
  });

  describe('login', () => {
    it('should login successfully with valid credentials', async () => {
      const user = {
        id: 'user-1',
        email: 'test@example.com',
        username: 'testuser',
        passwordHash: 'hashed',
        displayName: 'Test User',
        role: { name: 'user' },
        isActive: true,
      };

      vi.mocked(mockedPrisma.user.findUnique).mockResolvedValue(user as any);
      vi.mocked(mockedComparePassword).mockResolvedValue(true);
      vi.mocked(mockedJwtSign).mockReturnValue('mock-token' as any);
      vi.mocked(mockedPrisma.refreshToken.create).mockResolvedValue({} as any);

      const result = await service.login({
        email: 'test@example.com',
        password: 'StrongPass1!',
      });

      expect(result.user).toEqual({
        id: 'user-1',
        email: 'test@example.com',
        username: 'testuser',
        displayName: 'Test User',
        role: 'user',
      });
      expect(result.tokens).toEqual({
        accessToken: 'mock-token',
        refreshToken: 'mock-token',
      });
    });

    it('should throw UnauthorizedError for invalid credentials (user not found)', async () => {
      vi.mocked(mockedPrisma.user.findUnique).mockResolvedValue(null);

      await expect(
        service.login({
          email: 'test@example.com',
          password: 'StrongPass1!',
        })
      ).rejects.toThrow(UnauthorizedError);
    });

    it('should throw UnauthorizedError for invalid credentials (wrong password)', async () => {
      const user = {
        id: 'user-1',
        email: 'test@example.com',
        username: 'testuser',
        passwordHash: 'hashed',
        displayName: 'Test User',
        role: { name: 'user' },
        isActive: true,
      };

      vi.mocked(mockedPrisma.user.findUnique).mockResolvedValue(user as any);
      vi.mocked(mockedComparePassword).mockResolvedValue(false);

      await expect(
        service.login({
          email: 'test@example.com',
          password: 'WrongPass1!',
        })
      ).rejects.toThrow(UnauthorizedError);
    });

    it('should throw UnauthorizedError for inactive user', async () => {
      const user = {
        id: 'user-1',
        email: 'test@example.com',
        username: 'testuser',
        passwordHash: 'hashed',
        displayName: 'Test User',
        role: { name: 'user' },
        isActive: false,
      };

      vi.mocked(mockedPrisma.user.findUnique).mockResolvedValue(user as any);

      await expect(
        service.login({
          email: 'test@example.com',
          password: 'StrongPass1!',
        })
      ).rejects.toThrow(UnauthorizedError);
    });
  });

  describe('logout', () => {
    it('should logout successfully', async () => {
      vi.mocked(mockedPrisma.refreshToken.deleteMany).mockResolvedValue({ count: 1 } as any);

      await service.logout('refresh-token');

      expect(mockedPrisma.refreshToken.deleteMany).toHaveBeenCalledWith({
        where: { token: 'refresh-token' },
      });
    });
  });

  describe('refreshAccessToken', () => {
    it('should refresh tokens successfully', async () => {
      const storedToken = {
        id: 'rt-1',
        token: 'old-refresh-token',
        userId: 'user-1',
        expiresAt: new Date(Date.now() + 86400000),
        user: {
          id: 'user-1',
          email: 'test@example.com',
          role: { name: 'user' },
        },
      };

      vi.mocked(mockedJwtVerify).mockReturnValue({ sub: 'user-1' } as any);
      vi.mocked(mockedPrisma.refreshToken.findUnique).mockResolvedValue(storedToken as any);
      vi.mocked(mockedJwtSign).mockReturnValue('new-mock-token' as any);
      vi.mocked(mockedPrisma.refreshToken.create).mockResolvedValue({} as any);
      vi.mocked(mockedPrisma.refreshToken.deleteMany).mockResolvedValue({ count: 1 } as any);

      const result = await service.refreshAccessToken('old-refresh-token');

      expect(result).toEqual({
        accessToken: 'new-mock-token',
        refreshToken: 'new-mock-token',
      });
    });

    it('should throw UnauthorizedError for invalid token', async () => {
      vi.mocked(mockedJwtVerify).mockImplementation(() => {
        throw new jwt.JsonWebTokenError('invalid token');
      });

      await expect(service.refreshAccessToken('invalid-token')).rejects.toThrow(UnauthorizedError);
    });

    it('should throw UnauthorizedError for expired token', async () => {
      const storedToken = {
        id: 'rt-1',
        token: 'old-refresh-token',
        userId: 'user-1',
        expiresAt: new Date(Date.now() - 86400000),
        user: {
          id: 'user-1',
          email: 'test@example.com',
          role: { name: 'user' },
        },
      };

      vi.mocked(mockedJwtVerify).mockReturnValue({ sub: 'user-1' } as any);
      vi.mocked(mockedPrisma.refreshToken.findUnique).mockResolvedValue(storedToken as any);
      vi.mocked(mockedPrisma.refreshToken.deleteMany).mockResolvedValue({ count: 1 } as any);

      await expect(service.refreshAccessToken('old-refresh-token')).rejects.toThrow(
        UnauthorizedError
      );
      expect(mockedPrisma.refreshToken.deleteMany).toHaveBeenCalledWith({
        where: { token: 'old-refresh-token' },
      });
    });
  });

  describe('getCurrentUser', () => {
    it('should return current user successfully', async () => {
      const user = {
        id: 'user-1',
        email: 'test@example.com',
        username: 'testuser',
        displayName: 'Test User',
        role: { name: 'user' },
        isActive: true,
        emailVerified: false,
        createdAt: new Date('2024-01-01'),
      };

      vi.mocked(mockedPrisma.user.findUnique).mockResolvedValue(user as any);

      const result = await service.getCurrentUser('user-1');

      expect(result).toEqual({
        id: 'user-1',
        email: 'test@example.com',
        username: 'testuser',
        displayName: 'Test User',
        role: 'user',
        isActive: true,
        emailVerified: false,
        createdAt: new Date('2024-01-01'),
      });
    });

    it('should throw UnauthorizedError when user not found', async () => {
      vi.mocked(mockedPrisma.user.findUnique).mockResolvedValue(null);

      await expect(service.getCurrentUser('nonexistent')).rejects.toThrow(UnauthorizedError);
    });
  });

  describe('changePassword', () => {
    it('should change password successfully', async () => {
      const user = {
        id: 'user-1',
        email: 'test@example.com',
        passwordHash: 'old-hashed',
      };

      vi.mocked(mockedPrisma.user.findUnique).mockResolvedValue(user as any);
      vi.mocked(mockedComparePassword).mockResolvedValue(true);
      vi.mocked(mockedHashPassword).mockResolvedValue('new-hashed');
      vi.mocked(mockedPrisma.user.update).mockResolvedValue({} as any);
      vi.mocked(mockedPrisma.refreshToken.deleteMany).mockResolvedValue({ count: 1 } as any);

      await service.changePassword('user-1', 'OldPass1!', 'NewPass1!');

      expect(mockedPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { passwordHash: 'new-hashed' },
      });
      expect(mockedPrisma.refreshToken.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
      });
    });

    it('should throw UnauthorizedError for wrong current password', async () => {
      const user = {
        id: 'user-1',
        email: 'test@example.com',
        passwordHash: 'old-hashed',
      };

      vi.mocked(mockedPrisma.user.findUnique).mockResolvedValue(user as any);
      vi.mocked(mockedComparePassword).mockResolvedValue(false);

      await expect(
        service.changePassword('user-1', 'WrongPass1!', 'NewPass1!')
      ).rejects.toThrow(UnauthorizedError);
    });
  });
});
