import { subscriptionService } from './purchase.service';
import type { SubscriptionSnapshot } from '../../types/billing';

export class BillingRestoreService {
  async getSubscriptionSnapshot(userId: string): Promise<SubscriptionSnapshot> {
    const sub = await subscriptionService.getActiveForUser(userId);
    if (!sub) {
      return {
        active: false,
        productCode: null,
        tierCode: 'free',
        status: null,
        currentPeriodEnd: null,
        autoRenewing: false,
        cancelAtPeriodEnd: false,
      };
    }

    return {
      active: ['ACTIVE', 'GRACE_PERIOD'].includes(sub.status),
      productCode: sub.productCode,
      tierCode: sub.tierCode,
      status: sub.status,
      currentPeriodEnd: sub.currentPeriodEnd?.toISOString() ?? null,
      autoRenewing: sub.autoRenewing,
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
    };
  }
}

export const billingRestoreService = new BillingRestoreService();
