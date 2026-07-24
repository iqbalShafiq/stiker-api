import { config } from '../config';
import {
  LEGAL_VERSION,
  buildAccountDeletionDocument,
  buildPrivacyPolicy,
  buildRetentionPolicy,
  buildTermsOfService,
  type LegalDocument,
  type RetentionPolicyDocument,
} from '../content/legal';

export class LegalContentService {
  webBase(): string {
    return config.publicWebBaseUrl.replace(/\/$/, '');
  }

  getSummary(): {
    privacyUrl: string;
    termsUrl: string;
    retentionUrl: string;
    accountDeletionUrl: string;
    version: string;
    effectiveDate: string;
  } {

    const base = this.webBase();
    return {
      privacyUrl: `${base}/privacy`,
      termsUrl: `${base}/terms`,
      retentionUrl: `${base}/retention`,
      accountDeletionUrl: `${base}/account-deletion`,
      version: LEGAL_VERSION,
      effectiveDate: LEGAL_VERSION,
    };
  }

  getPrivacy(): LegalDocument & { url: string } {
    const doc = buildPrivacyPolicy();
    return { ...doc, url: `${this.webBase()}/privacy` };
  }

  getTerms(): LegalDocument & { url: string } {
    const doc = buildTermsOfService();
    return { ...doc, url: `${this.webBase()}/terms` };
  }

  getAccountDeletion(): LegalDocument & { url: string } {
    const doc = buildAccountDeletionDocument();
    return { ...doc, url: `${this.webBase()}/account-deletion` };
  }

  getRetention(): RetentionPolicyDocument & { url: string } {
    const doc = buildRetentionPolicy();
    return { ...doc, url: `${this.webBase()}/retention` };
  }
}

export const legalContentService = new LegalContentService();
