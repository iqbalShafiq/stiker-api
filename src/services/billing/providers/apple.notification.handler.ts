import { NotificationTypeV2 } from '@apple/app-store-server-library';
import type { ResponseBodyV2DecodedPayload } from '@apple/app-store-server-library';
import { prisma } from '../../../prisma/client';
import { config } from '../../../config';
import { entitlementService } from '../entitlement.service';
import { billingVerifyService } from '../billing-verify.service';
import { billingCatalogService } from '../billing-catalog.service';
import { logger } from '../../../utils/logger';
import { verifyAppleSignedNotification, verifyAppleSignedTransaction } from './apple-signed-data-verifier';

interface AppleNotificationBody {
  signedPayload?: string;
}

export class AppleNotificationHandler {
  async handleNotification(body: AppleNotificationBody): Promise<void> {
    if (!body.signedPayload) {
      return;
    }

    let eventId = `apple:${Date.now()}`;
    let notificationType = 'UNKNOWN';
    let payload: Record<string, unknown> = { raw: body.signedPayload };
    let decoded: ResponseBodyV2DecodedPayload | null = null;

    if (config.billing.apple.mockMode && body.signedPayload.startsWith('mock:')) {
      const parsed = JSON.parse(body.signedPayload.slice(5)) as {
        notificationUUID?: string;
        notificationType?: string;
        data?: Record<string, unknown>;
      };
      eventId = parsed.notificationUUID ?? eventId;
      notificationType = parsed.notificationType ?? notificationType;
      payload = parsed as Record<string, unknown>;
    } else {
      decoded = await verifyAppleSignedNotification(body.signedPayload);
      eventId = decoded.notificationUUID ?? eventId;
      notificationType = decoded.notificationType ?? notificationType;
      payload = decoded as unknown as Record<string, unknown>;
    }

    const existing = await prisma.storeNotificationEvent.findUnique({ where: { eventId } });
    if (existing?.processedAt) {
      return;
    }

    await prisma.storeNotificationEvent.upsert({
      where: { eventId },
      create: {
        provider: 'APPLE_APP_STORE',
        eventId,
        eventType: notificationType,
        payload: payload as object,
      },
      update: {},
    });

    try {
      if (decoded) {
        await this.processDecodedNotification(decoded);
      } else {
        await this.processMockNotification(payload);
      }
    } catch (error) {
      logger.error({ err: error, eventId }, 'Apple notification processing failed');
    }

    await prisma.storeNotificationEvent.update({
      where: { eventId },
      data: { processedAt: new Date() },
    });
  }

  private async processDecodedNotification(decoded: ResponseBodyV2DecodedPayload): Promise<void> {
    const signedTransactionInfo = decoded.data?.signedTransactionInfo;
    if (!signedTransactionInfo) {
      return;
    }

    const transaction = await verifyAppleSignedTransaction(signedTransactionInfo);
    const purchase = await prisma.purchase.findFirst({
      where: {
        provider: 'APPLE_APP_STORE',
        OR: [
          { providerTransactionId: transaction.transactionId ?? undefined },
          { providerOriginalTransactionId: transaction.originalTransactionId ?? undefined },
        ],
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!purchase) {
      logger.warn(
        { transactionId: transaction.transactionId },
        'Apple notification received for unknown purchase'
      );
      return;
    }

    const notificationType = decoded.notificationType;
    const refundTypes = new Set<string>([
      NotificationTypeV2.REFUND,
      NotificationTypeV2.REVOKE,
    ]);
    const renewTypes = new Set<string>([
      NotificationTypeV2.DID_RENEW,
      NotificationTypeV2.SUBSCRIBED,
      NotificationTypeV2.DID_CHANGE_RENEWAL_STATUS,
    ]);

    if (notificationType && refundTypes.has(String(notificationType))) {
      if (purchase.type === 'CONSUMABLE_TOKEN_PACK') {
        await entitlementService.handleTokenPackRefund({
          userId: purchase.userId,
          purchase,
          source: 'apple_notification_refund',
        });
      } else {
        await entitlementService.revokeSubscription(purchase.userId, purchase.id);
      }
      return;
    }

    if (notificationType && renewTypes.has(String(notificationType))) {
      const product = await billingCatalogService.getByCode(purchase.productCode);
      if (!product?.appleProductId) {
        return;
      }
      await billingVerifyService.verifyApplePurchase(purchase.userId, {
        productCode: purchase.productCode,
        productId: product.appleProductId,
        signedTransactionInfo,
        transactionId: transaction.transactionId ?? '',
        originalTransactionId: transaction.originalTransactionId,
      });
    }
  }

  private async processMockNotification(payload: Record<string, unknown>): Promise<void> {
    const data = payload.data as Record<string, unknown> | undefined;
    if (!data) return;

    const userId = data.userId as string | undefined;
    const productCode = data.productCode as string | undefined;
    const productId = data.productId as string | undefined;
    const signedTransactionInfo = data.signedTransactionInfo as string | undefined;
    const transactionId = data.transactionId as string | undefined;
    const action = data.action as string | undefined;

    if (action === 'revoke' && userId) {
      const purchase = await prisma.purchase.findFirst({
        where: { userId, provider: 'APPLE_APP_STORE' },
        orderBy: { createdAt: 'desc' },
      });
      if (purchase) {
        if (purchase.type === 'CONSUMABLE_TOKEN_PACK') {
          await entitlementService.handleTokenPackRefund({
            userId,
            purchase,
            source: 'apple_notification_refund',
          });
        } else {
          await entitlementService.revokeSubscription(userId, purchase.id);
        }
      }
      return;
    }

    if (userId && productCode && productId && signedTransactionInfo) {
      await billingVerifyService.verifyApplePurchase(userId, {
        productCode,
        productId,
        signedTransactionInfo,
        transactionId: transactionId ?? 'mock-txn',
      });
    }
  }
}

export const appleNotificationHandler = new AppleNotificationHandler();
