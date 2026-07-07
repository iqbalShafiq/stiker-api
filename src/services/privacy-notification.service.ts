import { config } from '../config';
import { logger } from '../utils/logger';

export interface AccountDeletionRequestNotification {
  requestId: string;
  emailDomain: string | null;
  hasMatchingUser: boolean;
  source: 'WEB';
}

export class PrivacyNotificationService {
  async notifyAccountDeletionRequest(payload: AccountDeletionRequestNotification): Promise<void> {
    const privacyEmail = config.legal.privacyEmail;

    logger.info(
      {
        event: 'account_deletion_request',
        requestId: payload.requestId,
        emailDomain: payload.emailDomain,
        hasMatchingUser: payload.hasMatchingUser,
        notifyEmail: privacyEmail,
      },
      'Account deletion request received — notify privacy team',
    );

    const webhookUrl = process.env.PRIVACY_NOTIFICATION_WEBHOOK_URL?.trim();
    if (!webhookUrl) {
      return;
    }

    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'account_deletion_request',
          requestId: payload.requestId,
          emailDomain: payload.emailDomain,
          hasMatchingUser: payload.hasMatchingUser,
          source: payload.source,
          privacyEmail,
          appName: config.legal.appName,
        }),
      });

      if (!response.ok) {
        logger.warn(
          { status: response.status, requestId: payload.requestId },
          'Privacy notification webhook returned non-success status',
        );
      }
    } catch (error) {
      logger.warn(
        { err: error, requestId: payload.requestId },
        'Failed to deliver privacy notification webhook',
      );
    }
  }
}

export const privacyNotificationService = new PrivacyNotificationService();
