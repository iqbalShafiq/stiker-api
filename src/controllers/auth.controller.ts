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

  async loginWithGoogle(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { idToken } = req.body as Record<string, unknown>;
      if (!idToken) {
        throw new ValidationError('idToken is required');
      }

      const result = await this.authService.loginWithGoogle(String(idToken));
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

  async linkGoogleWithPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { idToken, email, password } = req.body as Record<string, unknown>;
      if (!idToken || !email || !password) {
        throw new ValidationError('idToken, email, and password are required');
      }

      const result = await this.authService.linkGoogleWithPassword(
        String(idToken),
        String(email),
        String(password)
      );
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

  async linkGoogle(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user?.id) {
        throw new ValidationError('User not authenticated');
      }
      const { idToken } = req.body as Record<string, unknown>;
      if (!idToken) {
        throw new ValidationError('idToken is required');
      }

      const user = await this.authService.linkGoogle(req.user.id, String(idToken));
      res.status(200).json(buildSuccessResponse(user));
    } catch (error) {
      next(error);
    }
  }

  async unlinkGoogle(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user?.id) {
        throw new ValidationError('User not authenticated');
      }
      const user = await this.authService.unlinkGoogle(req.user.id);
      res.status(200).json(buildSuccessResponse(user));
    } catch (error) {
      next(error);
    }
  }

  async setPassword(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user?.id) {
        throw new ValidationError('User not authenticated');
      }
      const { newPassword } = req.body as Record<string, unknown>;
      if (!newPassword) {
        throw new ValidationError('newPassword is required');
      }

      await this.authService.setPassword(req.user.id, String(newPassword));
      res.status(200).json(buildSuccessResponse({ message: 'Password set successfully' }));
    } catch (error) {
      next(error);
    }
  }

  async logout(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = req.body as Record<string, unknown> | undefined;
      const bodyToken = typeof body?.refreshToken === 'string' ? body.refreshToken : undefined;
      const cookieToken: unknown = req.cookies?.refresh_token;
      const refreshToken =
        bodyToken ?? (typeof cookieToken === 'string' ? cookieToken : undefined);

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

  async updateMe(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user?.id) {
        throw new ValidationError('User not authenticated');
      }

      const body = req.body as Record<string, unknown>;
      const input: { displayName?: string | null; username?: string } = {};

      if (Object.prototype.hasOwnProperty.call(body, 'displayName')) {
        input.displayName = body.displayName == null ? null : String(body.displayName);
      }
      if (Object.prototype.hasOwnProperty.call(body, 'username')) {
        if (body.username == null || String(body.username).trim().length === 0) {
          throw new ValidationError('Username is required');
        }
        input.username = String(body.username);
      }

      if (input.displayName === undefined && input.username === undefined) {
        throw new ValidationError('Provide displayName and/or username to update');
      }

      const user = await this.authService.updateProfile(req.user.id, input);
      res.status(200).json(buildSuccessResponse(user));
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
      await this.authService.deleteAccount(
        req.user.id,
        currentPassword == null ? undefined : String(currentPassword)
      );
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

  async forgotPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email } = req.body as Record<string, unknown>;
      if (!email) {
        throw new ValidationError('Email is required');
      }

      await this.authService.requestPasswordReset(String(email));
      res.status(200).json(
        buildSuccessResponse({
          message: 'If an account exists for that email, a reset link has been sent.',
        })
      );
    } catch (error) {
      next(error);
    }
  }

  async resetPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { token, newPassword } = req.body as Record<string, unknown>;
      if (!token || !newPassword) {
        throw new ValidationError('token and newPassword are required');
      }

      await this.authService.resetPasswordWithToken(String(token), String(newPassword));
      res.status(200).json(buildSuccessResponse({ message: 'Password updated successfully' }));
    } catch (error) {
      next(error);
    }
  }

  async loginWithApple(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { idToken } = req.body as Record<string, unknown>;
      if (!idToken) {
        throw new ValidationError('idToken is required');
      }

      const result = await this.authService.loginWithApple(String(idToken));
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

  async linkAppleWithPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { idToken, email, password } = req.body as Record<string, unknown>;
      if (!idToken || !email || !password) {
        throw new ValidationError('idToken, email, and password are required');
      }

      const result = await this.authService.linkAppleWithPassword(
        String(idToken),
        String(email),
        String(password)
      );
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

  async linkApple(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user?.id) {
        throw new ValidationError('User not authenticated');
      }
      const { idToken } = req.body as Record<string, unknown>;
      if (!idToken) {
        throw new ValidationError('idToken is required');
      }

      const user = await this.authService.linkApple(req.user.id, String(idToken));
      res.status(200).json(buildSuccessResponse(user));
    } catch (error) {
      next(error);
    }
  }

  async unlinkApple(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user?.id) {
        throw new ValidationError('User not authenticated');
      }
      const user = await this.authService.unlinkApple(req.user.id);
      res.status(200).json(buildSuccessResponse(user));
    } catch (error) {
      next(error);
    }
  }
}
