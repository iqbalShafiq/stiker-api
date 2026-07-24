export type BillingProviderSlug =
  | 'google_play'
  | 'apple_app_store'
  | 'xendit'
  | 'admin'
  | 'promo';

export type PurchaseTypeSlug =
  | 'consumable_token_pack'
  | 'subscription'
  | 'non_consumable';

export type EntitlementSource =
  | 'google_play_purchase'
  | 'apple_iap_transaction'
  | 'xendit_payment'
  | 'admin_adjustment'
  | 'promo'
  | 'free_daily_quota';

export type QuotaSource = 'daily_allowance' | 'purchased_tokens';

export interface BillingProductDto {
  code: string;
  type: PurchaseTypeSlug;
  name: string;
  description: string | null;
  tokenAmount: number | null;
  tierCode: string | null;
  dailyPointLimit: number | null;
  googlePlayProductId: string | null;
  appleProductId: string | null;
  sortOrder: number;
}

export interface GooglePlayVerifyRequest {
  productCode: string;
  productId: string;
  purchaseToken: string;
  packageName: string;
}

export interface AppleVerifyRequest {
  productCode: string;
  productId: string;
  transactionId: string;
  originalTransactionId?: string;
  signedTransactionInfo: string;
}

export interface PurchaseVerifyResult {
  purchaseId: string;
  status: string;
  productCode: string;
  type: PurchaseTypeSlug;
  tokenAmountCredited?: number;
  purchasedTokenBalance: number;
  subscriptionTier: string;
  effectiveDailyLimit: number;
  shouldConsume: boolean;
  shouldAcknowledge: boolean;
}

export interface SubscriptionSnapshot {
  active: boolean;
  productCode: string | null;
  tierCode: string;
  status: string | null;
  currentPeriodEnd: string | null;
  autoRenewing: boolean;
  cancelAtPeriodEnd: boolean;
}

export interface RestorePurchasesRequest {
  googlePlay?: Array<{
    productCode: string;
    productId: string;
    purchaseToken: string;
    packageName: string;
  }>;
  apple?: Array<{
    productCode: string;
    productId: string;
    transactionId: string;
    originalTransactionId?: string;
    signedTransactionInfo: string;
  }>;
}
