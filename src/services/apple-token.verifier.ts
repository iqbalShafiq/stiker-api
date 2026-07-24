import { createRemoteJWKSet, jwtVerify } from 'jose';
import { config } from '../config';
import {
  InvalidAppleTokenError,
  EmailNotVerifiedError,
  ValidationError,
} from '../errors';

export interface VerifiedAppleIdentity {
  sub: string;
  email: string;
  emailVerified: boolean;
  isPrivateEmail: boolean;
}

const APPLE_ISSUER = 'https://appleid.apple.com';
const appleJwks = createRemoteJWKSet(new URL(`${APPLE_ISSUER}/auth/keys`));

export async function verifyAppleIdToken(idToken: string): Promise<VerifiedAppleIdentity> {
  if (!idToken || typeof idToken !== 'string' || idToken.trim().length === 0) {
    throw new ValidationError('Apple identity token is required');
  }

  if (config.appleClientIds.length === 0) {
    throw new ValidationError('Apple Sign-In is not configured on the server');
  }

  try {
    const { payload } = await jwtVerify(idToken.trim(), appleJwks, {
      issuer: APPLE_ISSUER,
      audience: config.appleClientIds,
    });

    const sub = typeof payload.sub === 'string' ? payload.sub : null;
    if (!sub) {
      throw new InvalidAppleTokenError();
    }

    const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : null;
    if (!email) {
      throw new InvalidAppleTokenError('Apple identity token is missing email');
    }

    const emailVerifiedClaim = payload.email_verified;
    const emailVerified =
      emailVerifiedClaim === true ||
      emailVerifiedClaim === 'true' ||
      email.endsWith('@privaterelay.appleid.com');

    if (!emailVerified) {
      throw new EmailNotVerifiedError('Apple email is not verified');
    }

    const isPrivateEmail =
      payload.is_private_email === true ||
      payload.is_private_email === 'true' ||
      email.endsWith('@privaterelay.appleid.com');

    return {
      sub,
      email,
      emailVerified: true,
      isPrivateEmail,
    };
  } catch (error) {
    if (
      error instanceof InvalidAppleTokenError ||
      error instanceof EmailNotVerifiedError ||
      error instanceof ValidationError
    ) {
      throw error;
    }
    throw new InvalidAppleTokenError();
  }
}
