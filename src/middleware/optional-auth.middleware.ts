import type { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { prisma } from '../prisma/client';
import type { AuthRequest } from './auth.middleware';

export async function optionalAuthenticateToken(
  req: AuthRequest,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      next();
      return;
    }

    const token = authHeader.substring(7);
    if (!token) {
      next();
      return;
    }

    let decoded: jwt.JwtPayload;
    try {
      decoded = jwt.verify(token, config.jwtSecret) as jwt.JwtPayload;
    } catch {
      next();
      return;
    }

    if (!decoded.sub) {
      next();
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.sub },
      include: { role: true },
    });

    if (!user?.isActive) {
      next();
      return;
    }

    req.user = {
      id: user.id,
      email: user.email,
      role: user.role.name,
    };
    next();
  } catch {
    next();
  }
}
