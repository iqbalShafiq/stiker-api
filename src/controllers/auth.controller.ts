import type { Request, Response, NextFunction } from 'express';
import { AuthService } from '../services/auth.service';
import type { AuthRequest } from '../middleware/auth.middleware';
import { buildSuccessResponse } from '../utils/response-builder';
import { ValidationError } from '../errors';

export class AuthController {
  private authService: AuthService;

  constructor() {
    this.authService = new AuthService();
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
          accessToken: result.tokens.accessToken,
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
          accessToken: result.tokens.accessToken,
        })
      );
    } catch (error) {
      next(error);
    }
  }

  async logout(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const refreshToken = req.cookies?.refresh_token;

      if (refreshToken) {
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
      const refreshToken = req.cookies?.refresh_token;

      if (!refreshToken) {
        throw new ValidationError('Refresh token is required');
      }

      const tokens = await this.authService.refreshAccessToken(refreshToken);

      this.setRefreshTokenCookie(res, tokens.refreshToken);

      res.status(200).json(
        buildSuccessResponse({
          accessToken: tokens.accessToken,
        })
      );
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

  async updateMe(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      res.status(200).json(buildSuccessResponse({ message: 'Update profile endpoint - placeholder' }));
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
