import { config } from '../../config';

export interface LegalMeta {
  appName: string;
  developerName: string;
  supportEmail: string;
  privacyEmail: string;
  historyExpirationDays: number;
  deletedAccountGraceDays: number;
}

export function getLegalMeta(): LegalMeta {
  return {
    appName: config.legal.appName,
    developerName: config.legal.developerName,
    supportEmail: config.legal.supportEmail,
    privacyEmail: config.legal.privacyEmail,
    historyExpirationDays: config.historyExpirationDays,
    deletedAccountGraceDays: config.legal.deletedAccountGraceDays,
  };
}
