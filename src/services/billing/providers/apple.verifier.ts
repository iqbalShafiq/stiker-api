import { config } from '../../../config';
import { AppError } from '../../../errors';
import { logger } from '../../../utils/logger';
import { verifyAppleSignedTransaction } from './apple-signed-data-verifier';

export interface AppleTransactionVerification {
  transactionId: string;
  originalTransactionId: string;
  productId: string;
  bundleId: string;
  purchaseDate: Date;
  expiresDate?: Date;
  revocationDate?: Date;
  type: string;
  raw: Record<string, unknown>;
}

export interface AppleVerifier {
  verifySignedTransaction(signedTransactionInfo: string): Promise<AppleTransactionVerification>;
}

function decodeMockPayload(signedTransactionInfo: string): AppleTransactionVerification {
  const json = signedTransactionInfo.startsWith('mock:')
    ? signedTransactionInfo.slice(5)
    : Buffer.from(signedTransactionInfo, 'base64url').toString('utf8');
  const data = JSON.parse(json) as Record<string, unknown>;
  return {
    transactionId: String(data.transactionId ?? ''),
    originalTransactionId: String(data.originalTransactionId ?? data.transactionId ?? ''),
    productId: String(data.productId ?? ''),
    bundleId: String(data.bundleId ?? config.billing.apple.bundleId),
    purchaseDate: new Date(String(data.purchaseDate ?? Date.now())),
    expiresDate: data.expiresDate ? new Date(String(data.expiresDate)) : undefined,
    revocationDate: data.revocationDate ? new Date(String(data.revocationDate)) : undefined,
    type: String(data.type ?? 'Consumable'),
    raw: data,
  };
}

function mapDecodedTransaction(
  decoded: Awaited<ReturnType<typeof verifyAppleSignedTransaction>>
): AppleTransactionVerification {
  return {
    transactionId: decoded.transactionId ?? '',
    originalTransactionId: decoded.originalTransactionId ?? decoded.transactionId ?? '',
    productId: decoded.productId ?? '',
    bundleId: decoded.bundleId ?? config.billing.apple.bundleId,
    purchaseDate: decoded.purchaseDate ? new Date(decoded.purchaseDate) : new Date(),
    expiresDate: decoded.expiresDate ? new Date(decoded.expiresDate) : undefined,
    revocationDate: decoded.revocationDate ? new Date(decoded.revocationDate) : undefined,
    type: decoded.type ?? 'Consumable',
    raw: decoded as unknown as Record<string, unknown>,
  };
}

class AppleVerifierImpl implements AppleVerifier {
  async verifySignedTransaction(signedTransactionInfo: string): Promise<AppleTransactionVerification> {
    if (!config.billing.apple.issuerId || !config.billing.apple.keyId) {
      throw new AppError('Apple App Store credentials are not configured', 503, 'SERVICE_UNAVAILABLE');
    }
    const decoded = await verifyAppleSignedTransaction(signedTransactionInfo);
    const verified = mapDecodedTransaction(decoded);
    if (!verified.transactionId || !verified.productId) {
      throw new AppError('Invalid Apple transaction', 400, 'VALIDATION_ERROR', 'INVALID_PURCHASE');
    }
    if (verified.revocationDate) {
      throw new AppError('Apple transaction revoked', 400, 'VALIDATION_ERROR', 'PURCHASE_REVOKED');
    }
    return verified;
  }
}

class MockAppleVerifier implements AppleVerifier {
  private readonly transactions = new Map<string, AppleTransactionVerification>();

  seedTransaction(signedPayload: string, verification: AppleTransactionVerification): void {
    this.transactions.set(signedPayload, verification);
  }

  verifySignedTransaction(signedTransactionInfo: string): Promise<AppleTransactionVerification> {
    const hit = this.transactions.get(signedTransactionInfo);
    if (hit) {
      if (hit.revocationDate) {
        return Promise.reject(
          new AppError('Apple transaction revoked', 400, 'VALIDATION_ERROR', 'PURCHASE_REVOKED')
        );
      }
      return Promise.resolve(hit);
    }
    if (signedTransactionInfo.startsWith('mock:')) {
      const verified = decodeMockPayload(signedTransactionInfo);
      if (!verified.transactionId) {
        return Promise.reject(
          new AppError('Invalid Apple transaction', 400, 'VALIDATION_ERROR', 'INVALID_PURCHASE')
        );
      }
      return Promise.resolve(verified);
    }
    return Promise.reject(
      new AppError('Invalid Apple transaction', 400, 'VALIDATION_ERROR', 'INVALID_PURCHASE')
    );
  }
}

export const mockAppleVerifier = new MockAppleVerifier();

export function createAppleVerifier(): AppleVerifier {
  if (config.billing.apple.mockMode) {
    logger.info('Using mock Apple verifier');
    return mockAppleVerifier;
  }
  return new AppleVerifierImpl();
}

export const appleVerifier = createAppleVerifier();
