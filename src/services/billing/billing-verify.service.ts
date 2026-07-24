import type { BillingProduct } from '@prisma/client';
import { ValidationError, AppError } from '../../errors';
import { config } from '../../config';
import { billingCatalogService } from './billing-catalog.service';
import { entitlementService } from './entitlement.service';
import { purchaseService } from './purchase.service';
import { googlePlayVerifier } from './providers/google-play.verifier';
import { appleVerifier } from './providers/apple.verifier';
import type {
  AppleVerifyRequest,
  GooglePlayVerifyRequest,
  PurchaseVerifyResult,
  RestorePurchasesRequest,
} from '../../types/billing';
import { tokenLedgerService } from './token-ledger.service';

export class BillingVerifyService {
  async verifyGooglePlayPurchase(
    userId: string,
    body: GooglePlayVerifyRequest
  ): Promise<PurchaseVerifyResult> {
    const { productCode, productId, purchaseToken, packageName } = body;
    if (!productCode || !productId || !purchaseToken || !packageName) {
      throw new ValidationError('productCode, productId, purchaseToken, and packageName are required');
    }
    if (packageName !== config.billing.googlePlay.packageName) {
      throw new ValidationError('Invalid package name');
    }

    const product = await this.resolveProduct(productCode, productId, 'google');
    const idempotencyKey = `google_play:purchase_token:${purchaseToken}`;

    const existing = await purchaseService.findByIdempotencyKey(idempotencyKey);
    if (existing?.status === 'FULFILLED') {
      return this.buildVerifyResult(userId, existing, product, false, false);
    }

    if (product.type === 'SUBSCRIPTION') {
      return this.verifyGooglePlaySubscription(userId, product, purchaseToken, packageName, idempotencyKey);
    }

    const verified = await googlePlayVerifier.verifyProductPurchase(packageName, productId, purchaseToken);
    if (verified.purchaseState === 'PENDING') {
      throw new AppError('Purchase is pending', 409, 'CONFLICT', 'PURCHASE_PENDING');
    }
    if (verified.purchaseState !== 'PURCHASED') {
      throw new ValidationError('Purchase is not in PURCHASED state');
    }

    const purchase =
      existing ??
      (await purchaseService.createPending({
        userId,
        provider: 'GOOGLE_PLAY',
        product,
        idempotencyKey,
        providerProductId: productId,
        providerPurchaseToken: purchaseToken,
        providerOrderId: verified.orderId,
        providerStatus: verified.purchaseState,
        providerPayload: verified.raw,
      }));

    if (purchase.status !== 'FULFILLED') {
      await purchaseService.updateStatus(purchase.id, 'VERIFIED', {
        verifiedAt: new Date(),
        providerStatus: verified.purchaseState,
        providerPayload: verified.raw,
      });
      await entitlementService.fulfillConsumableTokenPack({
        userId,
        purchase,
        product,
        source: 'google_play_purchase',
      });
    }

    const shouldConsume = verified.consumptionState === 0;
    return this.buildVerifyResult(userId, purchase, product, shouldConsume, false);
  }

  private async verifyGooglePlaySubscription(
    userId: string,
    product: BillingProduct,
    purchaseToken: string,
    packageName: string,
    idempotencyKey: string
  ): Promise<PurchaseVerifyResult> {
    const verified = await googlePlayVerifier.verifySubscription(packageName, purchaseToken);
    const activeStates = ['SUBSCRIPTION_STATE_ACTIVE', 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD'];
    if (!activeStates.includes(verified.subscriptionState)) {
      throw new ValidationError(`Subscription state is ${verified.subscriptionState}`);
    }
    if (verified.productId && verified.productId !== product.googlePlayProductId) {
      throw new ValidationError('Subscription product mismatch');
    }

    const existing = await purchaseService.findByIdempotencyKey(idempotencyKey);
    const purchase =
      existing ??
      (await purchaseService.createPending({
        userId,
        provider: 'GOOGLE_PLAY',
        product,
        idempotencyKey,
        providerProductId: product.googlePlayProductId ?? undefined,
        providerPurchaseToken: purchaseToken,
        providerStatus: verified.subscriptionState,
        providerPayload: verified.raw,
      }));

    if (purchase.status !== 'FULFILLED') {
      await purchaseService.updateStatus(purchase.id, 'VERIFIED', {
        verifiedAt: new Date(),
        providerStatus: verified.subscriptionState,
        providerPayload: verified.raw,
      });
      await entitlementService.fulfillSubscription({
        userId,
        purchase,
        product,
        provider: 'GOOGLE_PLAY',
        providerPurchaseToken: purchaseToken,
        providerSubscriptionId: verified.productId,
        currentPeriodEnd: verified.expiryTime,
        autoRenewing: verified.autoRenewing,
        source: 'google_play_purchase',
      });
    }

    const shouldAcknowledge = verified.acknowledgementState === 0;
    if (shouldAcknowledge && product.googlePlayProductId) {
      try {
        await googlePlayVerifier.acknowledgeSubscription(
          packageName,
          product.googlePlayProductId,
          purchaseToken
        );
      } catch {
        // Client may acknowledge; server attempt is best-effort
      }
    }

    return this.buildVerifyResult(userId, purchase, product, false, shouldAcknowledge);
  }

  async verifyApplePurchase(userId: string, body: AppleVerifyRequest): Promise<PurchaseVerifyResult> {
    const { productCode, productId, signedTransactionInfo, transactionId, originalTransactionId } = body;
    if (!productCode || !productId || !signedTransactionInfo) {
      throw new ValidationError('productCode, productId, and signedTransactionInfo are required');
    }

    const product = await this.resolveProduct(productCode, productId, 'apple');
    const verified = await appleVerifier.verifySignedTransaction(signedTransactionInfo);
    if (verified.bundleId !== config.billing.apple.bundleId) {
      throw new ValidationError('Invalid bundle ID');
    }
    if (verified.productId !== productId) {
      throw new ValidationError('Product ID mismatch');
    }

    const idempotencyKey = `apple:transaction:${verified.transactionId}`;
    const existing = await purchaseService.findByIdempotencyKey(idempotencyKey);

    const purchase =
      existing ??
      (await purchaseService.createPending({
        userId,
        provider: 'APPLE_APP_STORE',
        product,
        idempotencyKey,
        providerProductId: productId,
        providerTransactionId: transactionId ?? verified.transactionId,
        providerOriginalTransactionId: originalTransactionId ?? verified.originalTransactionId,
        providerStatus: verified.type,
        providerPayload: verified.raw as unknown as Record<string, unknown>,
      }));

    if (purchase.status === 'FULFILLED') {
      return this.buildVerifyResult(userId, purchase, product, false, false);
    }

    await purchaseService.updateStatus(purchase.id, 'VERIFIED', {
      verifiedAt: new Date(),
      providerStatus: verified.type,
    });

    if (product.type === 'SUBSCRIPTION') {
      await entitlementService.fulfillSubscription({
        userId,
        purchase,
        product,
        provider: 'APPLE_APP_STORE',
        providerOriginalTransactionId: verified.originalTransactionId,
        currentPeriodStart: verified.purchaseDate,
        currentPeriodEnd: verified.expiresDate,
        source: 'apple_iap_transaction',
      });
    } else {
      await entitlementService.fulfillConsumableTokenPack({
        userId,
        purchase,
        product,
        source: 'apple_iap_transaction',
      });
    }

    return this.buildVerifyResult(userId, purchase, product, product.type === 'CONSUMABLE_TOKEN_PACK', false);
  }

  async restorePurchases(userId: string, body: RestorePurchasesRequest): Promise<{ restored: number }> {
    let restored = 0;
    if (body.googlePlay) {
      for (const item of body.googlePlay) {
        try {
          await this.verifyGooglePlayPurchase(userId, item);
          restored += 1;
        } catch {
          // skip invalid restore entries
        }
      }
    }
    if (body.apple) {
      for (const item of body.apple) {
        try {
          await this.verifyApplePurchase(userId, item);
          restored += 1;
        } catch {
          // skip invalid restore entries
        }
      }
    }
    return { restored };
  }

  private async resolveProduct(
    productCode: string,
    storeProductId: string,
    store: 'google' | 'apple'
  ): Promise<BillingProduct> {
    const byCode = await billingCatalogService.getByCode(productCode);
    if (!byCode) {
      throw new ValidationError('Unknown product code');
    }
    const expectedId =
      store === 'google' ? byCode.googlePlayProductId : byCode.appleProductId;
    if (expectedId && expectedId !== storeProductId) {
      throw new ValidationError('Store product ID does not match catalog');
    }
    return byCode;
  }

  private async buildVerifyResult(
    userId: string,
    purchase: { id: string; status: string; productCode: string },
    product: BillingProduct,
    shouldConsume: boolean,
    shouldAcknowledge: boolean
  ): Promise<PurchaseVerifyResult> {
    const [balance, tier, dailyLimit] = await Promise.all([
      tokenLedgerService.getBalance(userId),
      entitlementService.getSubscriptionTier(userId),
      entitlementService.getEffectiveDailyLimit(userId),
    ]);

    return {
      purchaseId: purchase.id,
      status: purchase.status === 'FULFILLED' ? 'FULFILLED' : purchase.status,
      productCode: purchase.productCode,
      type:
        product.type === 'CONSUMABLE_TOKEN_PACK'
          ? 'consumable_token_pack'
          : product.type === 'SUBSCRIPTION'
            ? 'subscription'
            : 'non_consumable',
      tokenAmountCredited: product.tokenAmount ?? undefined,
      purchasedTokenBalance: balance,
      subscriptionTier: tier,
      effectiveDailyLimit: dailyLimit,
      shouldConsume,
      shouldAcknowledge,
    };
  }
}

export const billingVerifyService = new BillingVerifyService();
