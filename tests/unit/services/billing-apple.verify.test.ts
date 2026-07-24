import { describe, it, expect } from 'vitest';
import { billingVerifyService } from '../../../src/services/billing/billing-verify.service';
import { prisma } from '../../../src/prisma/client';

describe('Billing Apple verify', () => {
  it('verifies mock apple transaction and credits tokens', async () => {
    const userRole = await prisma.role.findUniqueOrThrow({ where: { name: 'user' } });
    const user = await prisma.user.create({
      data: {
        email: `apple-${Date.now()}@example.com`,
        username: `apple${Date.now()}`,
        passwordHash: 'hash',
        roleId: userRole.id,
      },
    });

    await prisma.billingProduct.upsert({
      where: { code: 'token_pack_s' },
      update: {},
      create: {
        code: 'token_pack_s',
        type: 'CONSUMABLE_TOKEN_PACK',
        name: 'Token Pack S',
        tokenAmount: 100,
        googlePlayProductId: 'token_pack_s',
        appleProductId: 'token_pack_s',
        sortOrder: 1,
      },
    });

    const signed = `mock:${JSON.stringify({
      transactionId: `txn-${Date.now()}`,
      originalTransactionId: `orig-${Date.now()}`,
      productId: 'token_pack_s',
      bundleId: 'com.setiker.app',
      type: 'Consumable',
    })}`;

    const result = await billingVerifyService.verifyApplePurchase(user.id, {
      productCode: 'token_pack_s',
      productId: 'token_pack_s',
      signedTransactionInfo: signed,
      transactionId: `txn-${Date.now()}`,
    });

    expect(result.purchasedTokenBalance).toBe(100);
    expect(result.subscriptionTier).toBe('free');
  });
});
