import type {
  BillingProvider,
  BillingProduct,
  Purchase,
  PurchaseStatus,
  SubscriptionStatus,
  UserSubscription,
  Prisma,
} from '@prisma/client';
import { prisma } from '../../prisma/client';

export class PurchaseService {
  async findByIdempotencyKey(idempotencyKey: string): Promise<Purchase | null> {
    return prisma.purchase.findUnique({ where: { idempotencyKey } });
  }

  async listForUser(userId: string, limit = 20, offset = 0): Promise<Purchase[]> {
    return prisma.purchase.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });
  }

  async createPending(params: {
    userId: string;
    provider: BillingProvider;
    product: BillingProduct;
    idempotencyKey: string;
    providerProductId?: string;
    providerPurchaseToken?: string;
    providerTransactionId?: string;
    providerOriginalTransactionId?: string;
    providerOrderId?: string;
    providerStatus?: string;
    providerPayload?: Record<string, unknown>;
  }): Promise<Purchase> {
    return prisma.purchase.create({
      data: {
        userId: params.userId,
        provider: params.provider,
        type: params.product.type,
        status: 'PENDING',
        productCode: params.product.code,
        productName: params.product.name,
        tokenAmount: params.product.tokenAmount,
        tierCode: params.product.tierCode,
        dailyPointLimit: params.product.dailyPointLimit,
        providerProductId: params.providerProductId,
        providerPurchaseToken: params.providerPurchaseToken,
        providerTransactionId: params.providerTransactionId,
        providerOriginalTransactionId: params.providerOriginalTransactionId,
        providerOrderId: params.providerOrderId,
        providerStatus: params.providerStatus,
        providerPayload: params.providerPayload as Prisma.InputJsonValue | undefined,
        idempotencyKey: params.idempotencyKey,
      },
    });
  }

  async updateStatus(
    purchaseId: string,
    status: PurchaseStatus,
    extra?: {
      verifiedAt?: Date;
      fulfilledAt?: Date;
      refundedAt?: Date;
      revokedAt?: Date;
      providerStatus?: string;
      providerPayload?: Record<string, unknown>;
    }
  ): Promise<Purchase> {
    return prisma.purchase.update({
      where: { id: purchaseId },
      data: {
        status,
        verifiedAt: extra?.verifiedAt,
        fulfilledAt: extra?.fulfilledAt,
        refundedAt: extra?.refundedAt,
        revokedAt: extra?.revokedAt,
        providerStatus: extra?.providerStatus,
        providerPayload: extra?.providerPayload as Prisma.InputJsonValue | undefined,
      },
    });
  }
}

export class SubscriptionService {
  async getActiveForUser(userId: string): Promise<UserSubscription | null> {
    return prisma.userSubscription.findFirst({
      where: {
        userId,
        status: { in: ['ACTIVE', 'GRACE_PERIOD', 'ON_HOLD', 'PAUSED', 'PAST_DUE'] },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async upsertFromPurchase(params: {
    userId: string;
    provider: BillingProvider;
    productCode: string;
    tierCode: string;
    status: SubscriptionStatus;
    providerSubscriptionId?: string;
    providerOriginalTransactionId?: string;
    providerPurchaseToken?: string;
    currentPeriodStart?: Date;
    currentPeriodEnd?: Date;
    autoRenewing?: boolean;
    cancelAtPeriodEnd?: boolean;
    metadata?: Record<string, unknown>;
  }): Promise<UserSubscription> {
    const existing = await prisma.userSubscription.findFirst({
      where: {
        userId: params.userId,
        provider: params.provider,
        OR: [
          params.providerPurchaseToken
            ? { providerPurchaseToken: params.providerPurchaseToken }
            : { id: 'never' },
          params.providerOriginalTransactionId
            ? { providerOriginalTransactionId: params.providerOriginalTransactionId }
            : { id: 'never' },
        ],
      },
    });

    if (existing) {
      return prisma.userSubscription.update({
        where: { id: existing.id },
        data: {
          productCode: params.productCode,
          tierCode: params.tierCode,
          status: params.status,
          providerSubscriptionId: params.providerSubscriptionId,
          providerOriginalTransactionId: params.providerOriginalTransactionId,
          providerPurchaseToken: params.providerPurchaseToken,
          currentPeriodStart: params.currentPeriodStart,
          currentPeriodEnd: params.currentPeriodEnd,
          autoRenewing: params.autoRenewing ?? existing.autoRenewing,
          cancelAtPeriodEnd: params.cancelAtPeriodEnd ?? existing.cancelAtPeriodEnd,
          lastVerifiedAt: new Date(),
          metadata: params.metadata as Prisma.InputJsonValue | undefined,
        },
      });
    }

    return prisma.userSubscription.create({
      data: {
        userId: params.userId,
        provider: params.provider,
        productCode: params.productCode,
        tierCode: params.tierCode,
        status: params.status,
        providerSubscriptionId: params.providerSubscriptionId,
        providerOriginalTransactionId: params.providerOriginalTransactionId,
        providerPurchaseToken: params.providerPurchaseToken,
        currentPeriodStart: params.currentPeriodStart,
        currentPeriodEnd: params.currentPeriodEnd,
        autoRenewing: params.autoRenewing ?? false,
        cancelAtPeriodEnd: params.cancelAtPeriodEnd ?? false,
        lastVerifiedAt: new Date(),
        metadata: params.metadata as Prisma.InputJsonValue | undefined,
      },
    });
  }

  async downgradeUserTier(userId: string): Promise<void> {
    await prisma.user.update({
      where: { id: userId },
      data: { subscriptionTier: 'free' },
    });
  }

  async upgradeUserTier(userId: string, tierCode: string): Promise<void> {
    await prisma.user.update({
      where: { id: userId },
      data: { subscriptionTier: tierCode },
    });
  }
}

export const purchaseService = new PurchaseService();
export const subscriptionService = new SubscriptionService();
