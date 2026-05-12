import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { prisma } from '../prisma/client';
import { UnauthorizedError } from '../errors';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: string;
  };
}

export async function authenticateToken(
  req: AuthRequest,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      return next(new UnauthorizedError('Authentication required'));
    }

    const token = authHeader.substring(7);

    if (!token) {
      return next(new UnauthorizedError('Authentication required'));
    }

    let decoded: jwt.JwtPayload;

    try {
      decoded = jwt.verify(token, config.jwtSecret) as jwt.JwtPayload;
    } catch (err) {
      if (err instanceof jwt.TokenExpiredError) {
        return next(new UnauthorizedError('Token has expired'));
      }
      if (err instanceof jwt.JsonWebTokenError) {
        return next(new UnauthorizedError('Invalid token'));
      }
      return next(new UnauthorizedError('Authentication required'));
    }

    if (!decoded.sub) {
      return next(new UnauthorizedError('Invalid token'));
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.sub },
      include: { role: true },
    });

    if (!user) {
      return next(new UnauthorizedError('User not found'));
    }

    if (!user.isActive) {
      return next(new UnauthorizedError('User account is inactive'));
    }

    req.user = {
      id: user.id,
      email: user.email,
      role: user.role.name,
    };

    next();
  } catch (error) {
    next(new UnauthorizedError('Authentication required'));
  }
}
