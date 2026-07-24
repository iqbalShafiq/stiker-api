import { OAuth2Client } from 'google-auth-library';
import { config } from '../config';
import { InvalidGoogleTokenError, EmailNotVerifiedError, ValidationError } from '../errors';

export interface VerifiedGoogleIdentity {
  sub: string;
  email: string;
  emailVerified: boolean;
  name?: string;
}

const oauthClient = new OAuth2Client();

export async function verifyGoogleIdToken(idToken: string): Promise<VerifiedGoogleIdentity> {
  if (!idToken || typeof idToken !== 'string' || idToken.trim().length === 0) {
    throw new ValidationError('Google ID token is required');
  }

  if (config.googleClientIds.length === 0) {
    throw new ValidationError('Google Sign-In is not configured on the server');
  }

  try {
    const ticket = await oauthClient.verifyIdToken({
      idToken: idToken.trim(),
      audience: config.googleClientIds,
    });
    const payload = ticket.getPayload();
    if (!payload?.sub) {
      throw new InvalidGoogleTokenError();
    }

    const email = payload.email?.trim().toLowerCase();
    if (!email) {
      throw new InvalidGoogleTokenError('Google ID token is missing email');
    }

    const emailVerified = payload.email_verified === true;
    if (!emailVerified) {
      throw new EmailNotVerifiedError();
    }

    return {
      sub: payload.sub,
      email,
      emailVerified,
      name: typeof payload.name === 'string' ? payload.name : undefined,
    };
  } catch (error) {
    if (
      error instanceof InvalidGoogleTokenError ||
      error instanceof EmailNotVerifiedError ||
      error instanceof ValidationError
    ) {
      throw error;
    }
    throw new InvalidGoogleTokenError();
  }
}
