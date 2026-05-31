import type { Request, Response, NextFunction } from 'express';
import { AuthService } from '../services/auth.service';
import type { AuthRequest } from '../middleware/auth.middleware';
import { buildSuccessResponse } from '../utils/response-builder';
import { config } from '../config';
import { RefreshTokenMissingError, ValidationError } from '../errors';

function parseExpirationToSeconds(expiration: string): number {
  const match = expiration.match(/^(\d+)([smhd])$/);
  if (!match) {
    return 900;
  }
  const value = parseInt(match[1], 10);
  const unit = match[2];
  switch (unit) {
    case 's':
      return value;
    case 'm':
      return value * 60;
    case 'h':
      return value * 60 * 60;
    case 'd':
      return value * 24 * 60 * 60;
    default:
      return 900;
  }
}

export class AuthController {
  private authService: AuthService;

  constructor() {
    this.authService = new AuthService();
  }

  private accessTokenPayload(accessToken: string): { accessToken: string; expiresIn: number } {
    return {
      accessToken,
      expiresIn: parseExpirationToSeconds(config.jwtAccessExpiration),
    };
  }

  private setRefreshTokenCookie(res: Response, token: string): void {
    res.cookie('refresh_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
  }

  private clearRefreshTokenCookie(res: Response): void {
    res.clearCookie('refresh_token', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
    });
  }

  async register(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email, username, password, displayName } = req.body as Record<string, unknown>;

      if (!email || !username || !password) {
        throw new ValidationError('Email, username, and password are required');
      }

      const result = await this.authService.register({
        email: String(email),
        username: String(username),
        password: String(password),
        displayName: displayName ? String(displayName) : undefined,
      });

      this.setRefreshTokenCookie(res, result.tokens.refreshToken);

      res.status(201).json(
        buildSuccessResponse({
          user: result.user,
          ...this.accessTokenPayload(result.tokens.accessToken),
        })
      );
    } catch (error) {
      next(error);
    }
  }

  async login(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email, password } = req.body as Record<string, unknown>;

      if (!email || !password) {
        throw new ValidationError('Email and password are required');
      }

      const result = await this.authService.login({
        email: String(email),
        password: String(password),
      });

      this.setRefreshTokenCookie(res, result.tokens.refreshToken);

      res.status(200).json(
        buildSuccessResponse({
          user: result.user,
          ...this.accessTokenPayload(result.tokens.accessToken),
        })
      );
    } catch (error) {
      next(error);
    }
  }

  async logout(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const refreshToken: unknown = req.cookies?.refresh_token;

      if (typeof refreshToken === 'string' && refreshToken) {
        await this.authService.logout(refreshToken);
      }

      this.clearRefreshTokenCookie(res);

      res.status(200).json(buildSuccessResponse({ message: 'Logged out successfully' }));
    } catch (error) {
      next(error);
    }
  }

  async refresh(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = req.body as Record<string, unknown> | undefined;
      const bodyToken = typeof body?.refreshToken === 'string' ? body.refreshToken : undefined;
      const cookies = req.cookies as { refresh_token?: unknown } | undefined;
      const cookieToken = cookies?.refresh_token;
      const refreshToken =
        bodyToken ?? (typeof cookieToken === 'string' ? cookieToken : undefined);

      if (!refreshToken) {
        throw new RefreshTokenMissingError();
      }

      const tokens = await this.authService.refreshAccessToken(refreshToken);

      this.setRefreshTokenCookie(res, tokens.refreshToken);

      res.status(200).json(buildSuccessResponse(this.accessTokenPayload(tokens.accessToken)));
    } catch (error) {
      next(error);
    }
  }

  async getMe(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user?.id) {
        throw new ValidationError('User not authenticated');
      }

      const user = await this.authService.getCurrentUser(req.user.id);

      res.status(200).json(buildSuccessResponse(user));
    } catch (error) {
      next(error);
    }
  }

  updateMe(_req: AuthRequest, res: Response, next: NextFunction): void {
    try {
      res.status(200).json(buildSuccessResponse({ message: 'Update profile endpoint - placeholder' }));
    } catch (error) {
      next(error);
    }
  }

  async deleteMe(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user?.id) {
        throw new ValidationError('User not authenticated');
      }

      const { currentPassword } = req.body as Record<string, unknown>;
      if (!currentPassword) {
        throw new ValidationError('Current password is required');
      }

      await this.authService.deleteAccount(req.user.id, String(currentPassword));
      this.clearRefreshTokenCookie(res);

      res.status(200).json(buildSuccessResponse({ message: 'Account deleted successfully' }));
    } catch (error) {
      next(error);
    }
  }

  async changePassword(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user?.id) {
        throw new ValidationError('User not authenticated');
      }

      const { currentPassword, newPassword } = req.body as Record<string, unknown>;

      if (!currentPassword || !newPassword) {
        throw new ValidationError('Current password and new password are required');
      }

      await this.authService.changePassword(
        req.user.id,
        String(currentPassword),
        String(newPassword)
      );

      this.clearRefreshTokenCookie(res);

      res.status(200).json(buildSuccessResponse({ message: 'Password changed successfully' }));
    } catch (error) {
      next(error);
    }
  }
}
