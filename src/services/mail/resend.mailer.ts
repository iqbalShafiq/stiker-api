import { Resend } from 'resend';
import { config } from '../../config';
import { logger } from '../../utils/logger';

export interface PasswordResetEmailParams {
  to: string;
  rawToken: string;
  isFirstTimeSet: boolean;
}

function buildResetLinks(rawToken: string): { deepLink: string; webLink: string } {
  const encoded = encodeURIComponent(rawToken);
  const deepLink = `${config.appDeepLinkScheme}://auth/reset-password?token=${encoded}`;
  const base = config.passwordReset.urlBase.replace(/\/$/, '');
  const webLink = `${base}?token=${encoded}`;
  return { deepLink, webLink };
}

function buildPasswordResetHtml(params: PasswordResetEmailParams): string {
  const { deepLink, webLink } = buildResetLinks(params.rawToken);
  const title = params.isFirstTimeSet ? 'Set your password' : 'Reset your password';
  const cta = params.isFirstTimeSet ? 'Set password' : 'Reset password';
  const intro = params.isFirstTimeSet
    ? 'You asked to create a password for your Setiker account (for example to sign in on another device).'
    : 'You asked to reset the password for your Setiker account.';

  return `<!DOCTYPE html>
<html>
<body style="font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif; line-height: 1.5; color: #111;">
  <h1 style="font-size: 20px;">${title}</h1>
  <p>${intro}</p>
  <p><a href="${deepLink}" style="display:inline-block;padding:12px 20px;background:#111;color:#fff;text-decoration:none;border-radius:8px;">${cta}</a></p>
  <p>If the button does not open the app, use this link:<br/><a href="${webLink}">${webLink}</a></p>
  <p style="color:#666;font-size:13px;">This link expires in ${config.passwordReset.tokenTtlMinutes} minutes. If you did not request this, you can ignore this email.</p>
</body>
</html>`;
}

export async function sendPasswordResetEmail(params: PasswordResetEmailParams): Promise<void> {
  const subject = params.isFirstTimeSet
    ? 'Set your Setiker password'
    : 'Reset your Setiker password';
  const html = buildPasswordResetHtml(params);
  const { deepLink, webLink } = buildResetLinks(params.rawToken);

  if (!config.resend.apiKey) {
    logger.info(
      {
        to: params.to,
        deepLink,
        webLink,
        isFirstTimeSet: params.isFirstTimeSet,
      },
      'Resend API key not configured; password reset email logged only'
    );
    return;
  }

  const resend = new Resend(config.resend.apiKey);
  const result = await resend.emails.send({
    from: config.resend.from,
    to: params.to,
    subject,
    html,
  });

  if (result.error) {
    logger.error({ err: result.error, to: params.to }, 'Failed to send password reset email');
    throw new Error(result.error.message || 'Failed to send password reset email');
  }
}
