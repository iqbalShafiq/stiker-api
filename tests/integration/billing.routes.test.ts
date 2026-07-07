import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../src/app';
import { prisma } from '../../src/prisma/client';
import { mockGooglePlayVerifier } from '../../src/services/billing/providers/google-play.verifier';
import { config } from '../../src/config';

describe('Billing Google Play Integration', () => {
  let accessToken: string;
  let userId: string;
  const purchaseToken = `test-token-${Date.now()}`;

  beforeAll(async () => {
    await prisma.billingProduct.upsert({
      where: { code: 'token_pack_m' },
      update: {},
      create: {
        code: 'token_pack_m',
        type: 'CONSUMABLE_TOKEN_PACK',
        name: 'Token Pack M',
        tokenAmount: 300,
        googlePlayProductId: 'token_pack_m',
        appleProductId: 'token_pack_m',
        sortOrder: 2,
      },
    });
  });

  beforeEach(async () => {
    const email = `billing-${Date.now()}@example.com`;
    const reg = await request(app).post('/api/v1/auth/register').send({
      email,
      username: `bill${Date.now()}`,
      password: 'StrongPass1!',
    });
    accessToken = reg.body.data.accessToken as string;
    userId = reg.body.data.user.id as string;

    mockGooglePlayVerifier.seedProductPurchase({
      packageName: config.billing.googlePlay.packageName,
      productId: 'token_pack_m',
      purchaseToken,
      orderId: `order-${Date.now()}`,
      purchaseState: 'PURCHASED',
      consumptionState: 0,
      acknowledgementState: 0,
      raw: {},
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('verifies consumable purchase and credits tokens once', async () => {
    const body = {
      productCode: 'token_pack_m',
      productId: 'token_pack_m',
      purchaseToken,
      packageName: config.billing.googlePlay.packageName,
    };

    const first = await request(app)
      .post('/api/v1/billing/google-play/verify')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(body);

    expect(first.status).toBe(200);
    expect(first.body.data.purchasedTokenBalance).toBe(300);
    expect(first.body.data.shouldConsume).toBe(true);

    const second = await request(app)
      .post('/api/v1/billing/google-play/verify')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(body);

    expect(second.status).toBe(200);
    expect(second.body.data.purchasedTokenBalance).toBe(300);

    const usage = await request(app)
      .get('/api/v1/ai/usage')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(usage.status).toBe(200);
    expect(usage.body.data.purchasedTokenBalance).toBe(300);
    expect(usage.body.data.subscriptionTier).toBe('free');
    expect(usage.body.data.resetTimezone).toBe('Asia/Jakarta');

    const purchases = await prisma.purchase.count({ where: { userId } });
    expect(purchases).toBe(1);
  });

  it('rejects invalid package name', async () => {
    const response = await request(app)
      .post('/api/v1/billing/google-play/verify')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        productCode: 'token_pack_m',
        productId: 'token_pack_m',
        purchaseToken,
        packageName: 'com.wrong.app',
      });

    expect(response.status).toBe(400);
  });

  it('lists billing products', async () => {
    const response = await request(app).get('/api/v1/billing/products');
    expect(response.status).toBe(200);
    expect(response.body.data.products.length).toBeGreaterThan(0);
  });
});
