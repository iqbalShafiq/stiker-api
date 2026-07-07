import fs from 'fs';
import { google } from 'googleapis';
import { config } from '../../../config';
import { AppError } from '../../../errors';
import { logger } from '../../../utils/logger';

export type GooglePlayPurchaseState = 'PURCHASED' | 'PENDING' | 'CANCELED';

export interface GooglePlayProductVerification {
  packageName: string;
  productId: string;
  purchaseToken: string;
  orderId: string;
  purchaseState: GooglePlayPurchaseState;
  consumptionState: number;
  acknowledgementState: number;
  raw: Record<string, unknown>;
}

export interface GooglePlaySubscriptionVerification {
  packageName: string;
  purchaseToken: string;
  subscriptionState: string;
  productId?: string;
  expiryTime?: Date;
  autoRenewing: boolean;
  acknowledgementState: number;
  raw: Record<string, unknown>;
}

export interface GooglePlayVerifier {
  verifyProductPurchase(
    packageName: string,
    productId: string,
    purchaseToken: string
  ): Promise<GooglePlayProductVerification>;
  verifySubscription(
    packageName: string,
    purchaseToken: string
  ): Promise<GooglePlaySubscriptionVerification>;
  consumeProduct(packageName: string, productId: string, purchaseToken: string): Promise<void>;
  acknowledgeSubscription(
    packageName: string,
    subscriptionId: string,
    purchaseToken: string
  ): Promise<void>;
}

function mapPurchaseState(value: number | undefined): GooglePlayPurchaseState {
  if (value === 0) return 'PURCHASED';
  if (value === 2) return 'PENDING';
  return 'CANCELED';
}

class GooglePlayVerifierImpl implements GooglePlayVerifier {
  private androidPublisher: ReturnType<typeof google.androidpublisher> | null = null;

  private getClient(): ReturnType<typeof google.androidpublisher> {
    if (this.androidPublisher) {
      return this.androidPublisher;
    }
    const jsonPath = config.billing.googlePlay.serviceAccountJsonPath;
    if (!jsonPath || !fs.existsSync(jsonPath)) {
      throw new AppError('Google Play service account is not configured', 503, 'SERVICE_UNAVAILABLE');
    }
    const auth = new google.auth.GoogleAuth({
      keyFile: jsonPath,
      scopes: ['https://www.googleapis.com/auth/androidpublisher'],
    });
    this.androidPublisher = google.androidpublisher({ version: 'v3', auth });
    return this.androidPublisher;
  }

  async verifyProductPurchase(
    packageName: string,
    productId: string,
    purchaseToken: string
  ): Promise<GooglePlayProductVerification> {
    const client = this.getClient();
    const res = await client.purchases.products.get({
      packageName,
      productId,
      token: purchaseToken,
    });
    const data = res.data;
    return {
      packageName,
      productId,
      purchaseToken,
      orderId: data.orderId ?? '',
      purchaseState: mapPurchaseState(data.purchaseState ?? undefined),
      consumptionState: data.consumptionState ?? 0,
      acknowledgementState: data.acknowledgementState ?? 0,
      raw: data as Record<string, unknown>,
    };
  }

  async verifySubscription(
    packageName: string,
    purchaseToken: string
  ): Promise<GooglePlaySubscriptionVerification> {
    const client = this.getClient();
    const res = await client.purchases.subscriptionsv2.get({
      packageName,
      token: purchaseToken,
    });
    const data = res.data;
    const lineItem = data.lineItems?.[0];
    const expiry = lineItem?.expiryTime ? new Date(lineItem.expiryTime) : undefined;
    return {
      packageName,
      purchaseToken,
      subscriptionState: data.subscriptionState ?? 'SUBSCRIPTION_STATE_UNSPECIFIED',
      productId: lineItem?.productId ?? undefined,
      expiryTime: expiry,
      autoRenewing: lineItem?.autoRenewingPlan?.autoRenewEnabled ?? false,
      acknowledgementState: Number(data.acknowledgementState ?? 0),
      raw: data as Record<string, unknown>,
    };
  }

  async consumeProduct(packageName: string, productId: string, purchaseToken: string): Promise<void> {
    const client = this.getClient();
    await client.purchases.products.consume({ packageName, productId, token: purchaseToken });
  }

  async acknowledgeSubscription(
    packageName: string,
    subscriptionId: string,
    purchaseToken: string
  ): Promise<void> {
    const client = this.getClient();
    await client.purchases.subscriptions.acknowledge({
      packageName,
      subscriptionId,
      token: purchaseToken,
    });
  }
}

/** In-memory verifier for tests and local dev without Play credentials. */
class MockGooglePlayVerifier implements GooglePlayVerifier {
  private readonly purchases = new Map<string, GooglePlayProductVerification>();
  private readonly subscriptions = new Map<string, GooglePlaySubscriptionVerification>();

  seedProductPurchase(verification: GooglePlayProductVerification): void {
    this.purchases.set(verification.purchaseToken, verification);
  }

  seedSubscription(verification: GooglePlaySubscriptionVerification): void {
    this.subscriptions.set(verification.purchaseToken, verification);
  }

  async verifyProductPurchase(
    packageName: string,
    productId: string,
    purchaseToken: string
  ): Promise<GooglePlayProductVerification> {
    const hit = this.purchases.get(purchaseToken);
    if (!hit) {
      return Promise.reject(
        new AppError('Invalid Google Play purchase token', 400, 'VALIDATION_ERROR', 'INVALID_PURCHASE')
      );
    }
    if (hit.packageName !== packageName || hit.productId !== productId) {
      return Promise.reject(
        new AppError('Google Play product mismatch', 400, 'VALIDATION_ERROR', 'PRODUCT_MISMATCH')
      );
    }
    return Promise.resolve(hit);
  }

  async verifySubscription(
    packageName: string,
    purchaseToken: string
  ): Promise<GooglePlaySubscriptionVerification> {
    const hit = this.subscriptions.get(purchaseToken);
    if (!hit || hit.packageName !== packageName) {
      return Promise.reject(
        new AppError('Invalid Google Play subscription token', 400, 'VALIDATION_ERROR', 'INVALID_PURCHASE')
      );
    }
    return Promise.resolve(hit);
  }

  consumeProduct(): Promise<void> {
    return Promise.resolve();
  }

  acknowledgeSubscription(): Promise<void> {
    return Promise.resolve();
  }
}

export const mockGooglePlayVerifier = new MockGooglePlayVerifier();

export function createGooglePlayVerifier(): GooglePlayVerifier {
  if (config.billing.googlePlay.mockMode) {
    logger.info('Using mock Google Play verifier');
    return mockGooglePlayVerifier;
  }
  return new GooglePlayVerifierImpl();
}

export const googlePlayVerifier = createGooglePlayVerifier();
