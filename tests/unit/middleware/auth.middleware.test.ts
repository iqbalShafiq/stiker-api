import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { authenticateToken, AuthRequest } from '../../../src/middleware/auth.middleware';
import { prisma } from '../../../src/prisma/client';
import { UnauthorizedError } from '../../../src/errors';

const mockedPrisma = vi.mocked(prisma);
const mockedJwtVerify = vi.mocked(jwt.verify);

vi.mock('../../../src/prisma/client', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock('jsonwebtoken', () => ({
  default: {
    verify: vi.fn(),
    TokenExpiredError: class TokenExpiredError extends Error {
      name = 'TokenExpiredError';
    },
    JsonWebTokenError: class JsonWebTokenError extends Error {
      name = 'JsonWebTokenError';
    },
  },
  verify: vi.fn(),
  TokenExpiredError: class TokenExpiredError extends Error {
    name = 'TokenExpiredError';
  },
  JsonWebTokenError: class JsonWebTokenError extends Error {
    name = 'JsonWebTokenError';
  },
}));

describe('authenticateToken', () => {
  let req: AuthRequest;
  let res: Response;
  let next: NextFunction;

  beforeEach(() => {
    req = {
      headers: {},
    } as AuthRequest;
    res = {} as Response;
    next = vi.fn();
    vi.clearAllMocks();
  });

  it('should attach user to request for valid token', async () => {
    req.headers.authorization = 'Bearer valid-token';

    const decoded = { sub: 'user-1', email: 'test@example.com', role: 'user' };
    vi.mocked(mockedJwtVerify).mockReturnValue(decoded as any);

    const user = {
      id: 'user-1',
      email: 'test@example.com',
      username: 'testuser',
      displayName: 'Test User',
      role: { name: 'user' },
      isActive: true,
    };
    vi.mocked(mockedPrisma.user.findUnique).mockResolvedValue(user as any);

    await authenticateToken(req, res, next);

    expect(req.user).toEqual({
      id: 'user-1',
      email: 'test@example.com',
      role: 'user',
    });
    expect(next).toHaveBeenCalledWith();
  });

  it('should throw UnauthorizedError when token is missing', async () => {
    await authenticateToken(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError));
    expect((next as any).mock.calls[0][0].message).toBe('Authentication required');
  });

  it('should throw UnauthorizedError when authorization header does not start with Bearer', async () => {
    req.headers.authorization = 'Basic dXNlcjpwYXNz';

    await authenticateToken(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError));
    expect((next as any).mock.calls[0][0].message).toBe('Authentication required');
  });

  it('should throw UnauthorizedError for invalid token', async () => {
    req.headers.authorization = 'Bearer invalid-token';

    vi.mocked(mockedJwtVerify).mockImplementation(() => {
      throw new jwt.JsonWebTokenError('invalid token');
    });

    await authenticateToken(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError));
    expect((next as any).mock.calls[0][0].message).toBe('Invalid token');
  });

  it('should throw UnauthorizedError for expired token', async () => {
    req.headers.authorization = 'Bearer expired-token';

    vi.mocked(mockedJwtVerify).mockImplementation(() => {
      throw new jwt.TokenExpiredError('jwt expired', new Date());
    });

    await authenticateToken(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError));
    expect((next as any).mock.calls[0][0].message).toBe('Token has expired');
  });

  it('should throw UnauthorizedError for inactive user', async () => {
    req.headers.authorization = 'Bearer valid-token';

    const decoded = { sub: 'user-1', email: 'test@example.com', role: 'user' };
    vi.mocked(mockedJwtVerify).mockReturnValue(decoded as any);

    const user = {
      id: 'user-1',
      email: 'test@example.com',
      username: 'testuser',
      displayName: 'Test User',
      role: { name: 'user' },
      isActive: false,
    };
    vi.mocked(mockedPrisma.user.findUnique).mockResolvedValue(user as any);

    await authenticateToken(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError));
    expect((next as any).mock.calls[0][0].message).toBe('User account is inactive');
  });
});
