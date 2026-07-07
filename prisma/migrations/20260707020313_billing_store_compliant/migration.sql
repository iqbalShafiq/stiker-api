-- CreateEnum
CREATE TYPE "BillingProvider" AS ENUM ('GOOGLE_PLAY', 'APPLE_APP_STORE', 'XENDIT', 'ADMIN', 'PROMO');

-- CreateEnum
CREATE TYPE "PurchaseType" AS ENUM ('CONSUMABLE_TOKEN_PACK', 'SUBSCRIPTION', 'NON_CONSUMABLE');

-- CreateEnum
CREATE TYPE "PurchaseStatus" AS ENUM ('PENDING', 'VERIFIED', 'FULFILLED', 'FAILED', 'REFUNDED', 'REVOKED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'GRACE_PERIOD', 'ON_HOLD', 'PAUSED', 'PAST_DUE', 'CANCELLED', 'EXPIRED', 'REVOKED');

-- CreateTable
CREATE TABLE "BillingProduct" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" "PurchaseType" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "tokenAmount" INTEGER,
    "tierCode" TEXT,
    "dailyPointLimit" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "googlePlayProductId" TEXT,
    "appleProductId" TEXT,
    "xenditProductCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Purchase" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "BillingProvider" NOT NULL,
    "type" "PurchaseType" NOT NULL,
    "status" "PurchaseStatus" NOT NULL DEFAULT 'PENDING',
    "productCode" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "tokenAmount" INTEGER,
    "tierCode" TEXT,
    "dailyPointLimit" INTEGER,
    "providerProductId" TEXT,
    "providerPurchaseToken" TEXT,
    "providerTransactionId" TEXT,
    "providerOriginalTransactionId" TEXT,
    "providerOrderId" TEXT,
    "providerStatus" TEXT,
    "providerPayload" JSONB,
    "verifiedAt" TIMESTAMP(3),
    "fulfilledAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "idempotencyKey" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Purchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserCreditBalance" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserCreditBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TokenLedgerEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "purchaseId" TEXT,
    "delta" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TokenLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "BillingProvider" NOT NULL,
    "productCode" TEXT NOT NULL,
    "tierCode" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "providerSubscriptionId" TEXT,
    "providerOriginalTransactionId" TEXT,
    "providerPurchaseToken" TEXT,
    "currentPeriodStart" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "autoRenewing" BOOLEAN NOT NULL DEFAULT false,
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "lastVerifiedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreNotificationEvent" (
    "id" TEXT NOT NULL,
    "provider" "BillingProvider" NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "purchaseId" TEXT,
    "payload" JSONB NOT NULL,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoreNotificationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BillingProduct_code_key" ON "BillingProduct"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Purchase_idempotencyKey_key" ON "Purchase"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Purchase_userId_status_idx" ON "Purchase"("userId", "status");

-- CreateIndex
CREATE INDEX "Purchase_provider_providerTransactionId_idx" ON "Purchase"("provider", "providerTransactionId");

-- CreateIndex
CREATE INDEX "Purchase_provider_providerPurchaseToken_idx" ON "Purchase"("provider", "providerPurchaseToken");

-- CreateIndex
CREATE INDEX "Purchase_productCode_idx" ON "Purchase"("productCode");

-- CreateIndex
CREATE UNIQUE INDEX "UserCreditBalance_userId_key" ON "UserCreditBalance"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TokenLedgerEntry_idempotencyKey_key" ON "TokenLedgerEntry"("idempotencyKey");

-- CreateIndex
CREATE INDEX "TokenLedgerEntry_userId_createdAt_idx" ON "TokenLedgerEntry"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "TokenLedgerEntry_purchaseId_idx" ON "TokenLedgerEntry"("purchaseId");

-- CreateIndex
CREATE INDEX "UserSubscription_userId_status_idx" ON "UserSubscription"("userId", "status");

-- CreateIndex
CREATE INDEX "UserSubscription_provider_providerSubscriptionId_idx" ON "UserSubscription"("provider", "providerSubscriptionId");

-- CreateIndex
CREATE INDEX "UserSubscription_provider_providerPurchaseToken_idx" ON "UserSubscription"("provider", "providerPurchaseToken");

-- CreateIndex
CREATE UNIQUE INDEX "StoreNotificationEvent_eventId_key" ON "StoreNotificationEvent"("eventId");

-- CreateIndex
CREATE INDEX "StoreNotificationEvent_provider_eventType_createdAt_idx" ON "StoreNotificationEvent"("provider", "eventType", "createdAt");

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserCreditBalance" ADD CONSTRAINT "UserCreditBalance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TokenLedgerEntry" ADD CONSTRAINT "TokenLedgerEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSubscription" ADD CONSTRAINT "UserSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
