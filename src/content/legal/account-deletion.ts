import type { LegalDocument } from './types';
import { getLegalMeta } from './legal-meta';
import { LEGAL_VERSION } from './version';

export function buildAccountDeletionDocument(): LegalDocument {
  const meta = getLegalMeta();
  const { appName, developerName, supportEmail, privacyEmail, deletedAccountGraceDays } = meta;

  return {
    title: 'Account Deletion',
    version: LEGAL_VERSION,
    effectiveDate: LEGAL_VERSION,
    summary:
      `Request deletion of your ${appName} account and associated cloud data. ` +
      'You do not need to reinstall the app to submit a web request.',
    sections: [
      {
        id: 'overview',
        title: 'Overview',
        body:
          `${developerName} operates ${appName}. You can delete your account in the app or submit a request on this page.`,
      },
      {
        id: 'in-app',
        title: 'Delete in the app',
        body:
          'Open Setiker → Profile → Settings → Delete account. Enter your password and type "Delete Account" to confirm. ' +
          'You will be signed out and returned to the login screen.',
      },
      {
        id: 'data-deleted',
        title: 'Data that is deleted or anonymized',
        body:
          '• Account profile (email, username, display name)\n' +
          '• Authentication tokens and sessions\n' +
          '• Cloud sticker packs and stickers you own\n' +
          '• AI processing history\n' +
          '• Social data (likes, saves, follows) tied to your account\n' +
          '• Public packs you published (hidden and soft-deleted)',
      },
      {
        id: 'data-retained',
        title: 'Data that may be retained',
        body:
          '• Anonymized billing and purchase records (fraud prevention, legal compliance)\n' +
          '• Moderation reports you filed (reporter identity anonymized)\n' +
          '• Server logs for a limited security period\n\n' +
          'Retention reasons are described in our Privacy Policy.',
      },
      {
        id: 'timeline',
        title: 'Processing time',
        body:
          `In-app deletion is processed immediately. Web requests are typically completed within ` +
          `${deletedAccountGraceDays} days after verification. You will receive confirmation at the email on file when processed.`,
      },
      {
        id: 'contact',
        title: 'Contact',
        body:
          `Privacy / deletion requests: ${privacyEmail}\n` +
          `Support: ${supportEmail}`,
      },
    ],
  };
}
