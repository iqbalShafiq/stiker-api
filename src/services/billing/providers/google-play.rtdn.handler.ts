import { prisma } from '../../../prisma/client';
import { billingVerifyService } from '../billing-verify.service';
import { entitlementService } from '../entitlement.service';
import { googlePlayVerifier } from './google-play.verifier';
import { config } from '../../../config';
import { logger } from '../../../utils/logger';

interface RtdnMessage {
  message?: {
    messageId?: string;
    data?: string;
    attributes?: Record<string, string>;
  };
  subscription?: string;
}

interface DecodedRtdnData {
  version?: string;
  packageName?: string;
  eventTimeMillis?: string;
  oneTimeProductNotification?: {
    version?: string;
    notificationType?: number;
    purchaseToken?: string;
    sku?: string;
  };
  subscriptionNotification?: {
    version?: string;
    notificationType?: number;
    purchaseToken?: string;
    subscriptionId?: string;
  };
  voidedPurchaseNotification?: {
    purchaseToken?: string;
    orderId?: string;
    productType?: number;
    refundType?: number;
  };
}

export class GooglePlayRtdnHandler {
  async handlePubSubBody(body: RtdnMessage): Promise<void> {
    const messageId = body.message?.messageId;
    if (!messageId) {
      return;
    }

    const existing = await prisma.storeNotificationEvent.findUnique({
      where: { eventId: messageId },
    });
    if (existing?.processedAt) {
      return;
    }

    await prisma.storeNotificationEvent.upsert({
      where: { eventId: messageId },
      create: {
        provider: 'GOOGLE_PLAY',
        eventId: messageId,
        eventType: 'rtdn',
        payload: body as object,
      },
      update: {},
    });

    const dataB64 = body.message?.data;
    if (!dataB64) {
      await this.markProcessed(messageId);
      return;
    }

    const decoded = JSON.parse(Buffer.from(dataB64, 'base64').toString('utf8')) as DecodedRtdnData;
    const packageName = decoded.packageName ?? config.billing.googlePlay.packageName;

    try {
      if (decoded.voidedPurchaseNotification?.purchaseToken) {
        await this.handleVoided(decoded.voidedPurchaseNotification.purchaseToken);
      } else if (decoded.oneTimeProductNotification?.purchaseToken) {
        await this.handleOneTimeNotification(decoded.oneTimeProductNotification, packageName);
      } else if (decoded.subscriptionNotification?.purchaseToken) {
        await this.handleSubscriptionNotification(decoded.subscriptionNotification, packageName);
      }
    } catch (error) {
      logger.error({ err: error, messageId }, 'RTDN processing failed');
    }

    await this.markProcessed(messageId);
  }

  private async markProcessed(eventId: string): Promise<void> {
    await prisma.storeNotificationEvent.update({
      where: { eventId },
      data: { processedAt: new Date() },
    });
  }

  private async handleVoided(purchaseToken: string): Promise<void> {
    const purchase = await prisma.purchase.findFirst({
      where: { providerPurchaseToken: purchaseToken, provider: 'GOOGLE_PLAY' },
    });
    if (!purchase) return;

    if (purchase.type === 'CONSUMABLE_TOKEN_PACK') {
      await entitlementService.handleTokenPackRefund({
        userId: purchase.userId,
        purchase,
        source: 'google_play_rtdn_voided',
      });
    } else if (purchase.type === 'SUBSCRIPTION') {
      await entitlementService.revokeSubscription(purchase.userId, purchase.id);
      await prisma.userSubscription.updateMany({
        where: { userId: purchase.userId, providerPurchaseToken: purchaseToken },
        data: { status: 'REVOKED' },
      });
    }
  }

  private async handleOneTimeNotification(
    notification: NonNullable<DecodedRtdnData['oneTimeProductNotification']>,
    packageName: string
  ): Promise<void> {
    if (!notification.purchaseToken || !notification.sku) return;
    // Type 1 = ONE_TIME_PRODUCT_PURCHASED — re-verify if purchase record exists without user context
    const purchase = await prisma.purchase.findFirst({
      where: { providerPurchaseToken: notification.purchaseToken },
    });
    if (purchase && purchase.status !== 'FULFILLED') {
      await billingVerifyService.verifyGooglePlayPurchase(purchase.userId, {
        productCode: purchase.productCode,
        productId: notification.sku,
        purchaseToken: notification.purchaseToken,
        packageName,
      });
    }
  }

  private async handleSubscriptionNotification(
    notification: NonNullable<DecodedRtdnData['subscriptionNotification']>,
    packageName: string
  ): Promise<void> {
    if (!notification.purchaseToken) return;

    const verified = await googlePlayVerifier.verifySubscription(packageName, notification.purchaseToken);
    const purchase = await prisma.purchase.findFirst({
      where: { providerPurchaseToken: notification.purchaseToken },
    });

    // notificationType 3 = canceled, 13 = expired, 12 = revoked
    const downgradeTypes = [3, 12, 13];
    if (notification.notificationType && downgradeTypes.includes(notification.notificationType)) {
      if (purchase) {
        await entitlementService.revokeSubscription(purchase.userId, purchase.id);
        await prisma.userSubscription.updateMany({
          where: { userId: purchase.userId, providerPurchaseToken: notification.purchaseToken },
          data: {
            status: notification.notificationType === 13 ? 'EXPIRED' : 'CANCELLED',
            cancelAtPeriodEnd: notification.notificationType === 3,
          },
        });
      }
      return;
    }

    if (purchase && ['SUBSCRIPTION_STATE_ACTIVE', 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD'].includes(verified.subscriptionState)) {
      await billingVerifyService.verifyGooglePlayPurchase(purchase.userId, {
        productCode: purchase.productCode,
        productId: notification.subscriptionId ?? purchase.providerProductId ?? '',
        purchaseToken: notification.purchaseToken,
        packageName,
      });
    }
  }
}

export const googlePlayRtdnHandler = new GooglePlayRtdnHandler();
