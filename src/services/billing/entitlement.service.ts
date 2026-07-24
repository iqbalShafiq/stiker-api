import { config } from '../../config';
import { subscriptionService } from './purchase.service';
import { tokenLedgerService } from './token-ledger.service';
import type { BillingProduct } from '@prisma/client';
import type { Purchase } from '@prisma/client';
import { purchaseService } from './purchase.service';

export class EntitlementService {
  async getSubscriptionTier(userId: string): Promise<string> {
    const active = await subscriptionService.getActiveForUser(userId);
    if (active && ['ACTIVE', 'GRACE_PERIOD'].includes(active.status)) {
      return active.tierCode;
    }
    return 'free';
  }

  async getEffectiveDailyLimit(userId: string): Promise<number> {
    const tier = await this.getSubscriptionTier(userId);
    if (tier === 'premium') {
      return config.billing.premiumDailyPointLimit;
    }
    return config.billing.freeDailyPointLimit;
  }

  async getPurchasedTokenBalance(userId: string): Promise<number> {
    return tokenLedgerService.getBalance(userId);
  }

  async fulfillConsumableTokenPack(params: {
    userId: string;
    purchase: Purchase;
    product: BillingProduct;
    source: string;
  }): Promise<{ balanceAfter: number; alreadyFulfilled: boolean }> {
    const tokenAmount = params.product.tokenAmount ?? params.purchase.tokenAmount ?? 0;
    if (tokenAmount <= 0) {
      return { balanceAfter: await tokenLedgerService.getBalance(params.userId), alreadyFulfilled: false };
    }

    const idempotencyKey = `fulfill:purchase:${params.purchase.id}`;

    const credit = await tokenLedgerService.credit({
      userId: params.userId,
      amount: tokenAmount,
      reason: 'token_pack_purchase',
      source: params.source,
      idempotencyKey,
      purchaseId: params.purchase.id,
      metadata: { productCode: params.product.code },
    });

    await purchaseService.updateStatus(params.purchase.id, 'FULFILLED', {
      fulfilledAt: new Date(),
    });

    return { balanceAfter: credit.balanceAfter, alreadyFulfilled: credit.alreadyApplied };
  }

  async fulfillSubscription(params: {
    userId: string;
    purchase: Purchase;
    product: BillingProduct;
    provider: 'GOOGLE_PLAY' | 'APPLE_APP_STORE' | 'XENDIT';
    providerPurchaseToken?: string;
    providerOriginalTransactionId?: string;
    providerSubscriptionId?: string;
    currentPeriodStart?: Date;
    currentPeriodEnd?: Date;
    autoRenewing?: boolean;
    cancelAtPeriodEnd?: boolean;
    source: string;
  }): Promise<void> {
    const tierCode = params.product.tierCode ?? 'premium';

    await subscriptionService.upsertFromPurchase({
      userId: params.userId,
      provider: params.provider,
      productCode: params.product.code,
      tierCode,
      status: 'ACTIVE',
      providerSubscriptionId: params.providerSubscriptionId,
      providerOriginalTransactionId: params.providerOriginalTransactionId,
      providerPurchaseToken: params.providerPurchaseToken,
      currentPeriodStart: params.currentPeriodStart,
      currentPeriodEnd: params.currentPeriodEnd,
      autoRenewing: params.autoRenewing,
      cancelAtPeriodEnd: params.cancelAtPeriodEnd,
      metadata: { source: params.source },
    });

    await subscriptionService.upgradeUserTier(params.userId, tierCode);
    await purchaseService.updateStatus(params.purchase.id, 'FULFILLED', {
      fulfilledAt: new Date(),
    });
  }

  async revokeSubscription(userId: string, purchaseId?: string): Promise<void> {
    await subscriptionService.downgradeUserTier(userId);
    if (purchaseId) {
      await purchaseService.updateStatus(purchaseId, 'REVOKED', { revokedAt: new Date() });
    }
  }

  async handleTokenPackRefund(params: {
    userId: string;
    purchase: Purchase;
    source: string;
  }): Promise<void> {
    const tokenAmount = params.purchase.tokenAmount ?? 0;
    if (tokenAmount > 0) {
      await tokenLedgerService.reverseCredit({
        userId: params.userId,
        amount: tokenAmount,
        reason: 'token_pack_refund',
        source: params.source,
        idempotencyKey: `refund:purchase:${params.purchase.id}`,
        purchaseId: params.purchase.id,
      });
    }
    await purchaseService.updateStatus(params.purchase.id, 'REFUNDED', { refundedAt: new Date() });
  }
}

export const entitlementService = new EntitlementService();
