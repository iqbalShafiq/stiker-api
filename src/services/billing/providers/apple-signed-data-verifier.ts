import {
  Environment,
  SignedDataVerifier,
  type ResponseBodyV2DecodedPayload,
  type JWSTransactionDecodedPayload,
} from '@apple/app-store-server-library';
import { config } from '../../../config';
import { AppError } from '../../../errors';
import { getAppleRootCertificates } from './apple-root-certificates';

let verifierPromise: Promise<SignedDataVerifier> | null = null;

function mapEnvironment(): Environment {
  return config.billing.apple.environment === 'Production'
    ? Environment.PRODUCTION
    : Environment.SANDBOX;
}

async function getVerifier(): Promise<SignedDataVerifier> {
  if (!verifierPromise) {
    verifierPromise = (async (): Promise<SignedDataVerifier> => {
      const rootCertificates = await getAppleRootCertificates();
      const appAppleId = config.billing.apple.appAppleId
        ? Number(config.billing.apple.appAppleId)
        : undefined;
      return new SignedDataVerifier(
        rootCertificates,
        true,
        mapEnvironment(),
        config.billing.apple.bundleId,
        appAppleId
      );
    })();
  }
  return verifierPromise;
}

export async function verifyAppleSignedTransaction(
  signedTransactionInfo: string
): Promise<JWSTransactionDecodedPayload> {
  try {
    const verifier = await getVerifier();
    return await verifier.verifyAndDecodeTransaction(signedTransactionInfo);
  } catch (error) {
    throw new AppError('Invalid Apple transaction', 400, 'VALIDATION_ERROR', 'INVALID_PURCHASE', {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function verifyAppleSignedNotification(
  signedPayload: string
): Promise<ResponseBodyV2DecodedPayload> {
  try {
    const verifier = await getVerifier();
    return await verifier.verifyAndDecodeNotification(signedPayload);
  } catch (error) {
    throw new AppError('Invalid Apple notification', 400, 'VALIDATION_ERROR', 'INVALID_NOTIFICATION', {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}
