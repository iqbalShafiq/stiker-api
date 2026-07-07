import type { LegalDocument } from './types';
import { getLegalMeta } from './legal-meta';
import { LEGAL_VERSION } from './version';

export function buildPrivacyPolicy(): LegalDocument {
  const meta = getLegalMeta();
  const { appName, developerName, supportEmail, privacyEmail, historyExpirationDays, deletedAccountGraceDays } =
    meta;

  return {
    title: 'Privacy Policy',
    version: LEGAL_VERSION,
    effectiveDate: LEGAL_VERSION,
    summary:
      `${appName} processes images and videos you upload to create stickers, runs AI features on our servers, ` +
      'syncs your packs to the cloud when you sign in, and may process billing data for premium features.',
    sections: [
      {
        id: 'introduction',
        title: 'Introduction',
        body:
          `This Privacy Policy describes how ${developerName} ("we", "us") collects, uses, and protects ` +
          `information when you use the ${appName} mobile application and related services (the "Service"). ` +
          'By using the Service, you agree to this policy.',
      },
      {
        id: 'account-data',
        title: 'Account information',
        body:
          'When you register, we collect your email address, username, and optional display name. ' +
          'We store a hashed password and issue authentication tokens (access and refresh tokens) to keep you signed in. ' +
          'Account data is required to use cloud sync, Explore, billing, and moderation features tied to your identity.',
      },
      {
        id: 'user-content',
        title: 'Images, videos, and sticker packs',
        body:
          'You may upload images and videos from your device using the system photo/video picker. ' +
          'We only receive files you explicitly select; we do not request broad gallery access. ' +
          'Uploaded content and sticker packs you create are stored on your device and, when you are signed in, ' +
          'may be synced to our servers. Public packs you publish include pack name, description, sticker images, ' +
          'and publisher metadata visible to other users.',
      },
      {
        id: 'ai-processing',
        title: 'AI processing',
        body:
          'AI features (sticker generation, background removal, grid split, video sticker packs, improvements) ' +
          'send your selected images, videos, and prompts to our servers for processing. ' +
          'Outputs are returned to your device and may be stored in processing history for up to ' +
          `${historyExpirationDays} days. We use third-party AI providers (such as cloud model APIs) ` +
          'to perform these operations. Inputs and outputs are used only to provide the Service and safety moderation.',
      },
      {
        id: 'cloud-sync',
        title: 'Cloud sync',
        body:
          'When signed in, your sticker packs, visibility settings, likes, saves, and social actions may be ' +
          'synchronized between your devices and our servers. Sync requires an internet connection.',
      },
      {
        id: 'billing',
        title: 'Billing and purchases',
        body:
          'If you purchase premium features through Google Play, we receive purchase tokens, product identifiers, ' +
          'subscription status, and entitlement metadata from Google to verify your access. ' +
          'We do not receive your full payment card details. Billing records may be retained for fraud prevention ' +
          'and legal compliance after account deletion in anonymized form.',
      },
      {
        id: 'permissions',
        title: 'Device permissions',
        body:
          'Notifications: used to show progress when AI jobs run in the background. Requested only when you start ' +
          'a background AI job or enable notifications.\n\n' +
          'Foreground service: keeps long-running AI processing alive and shows a progress notification.\n\n' +
          'Photo/video picker: uses the system picker so you choose specific files; we do not scan your entire library.',
      },
      {
        id: 'reports-moderation',
        title: 'Reports and moderation',
        body:
          'If you report content or AI output, we store your report reason, optional details, and account identifier ' +
          'to investigate and take action. Reports may be retained after resolution for audit and safety purposes.',
      },
      {
        id: 'retention',
        title: 'Data retention',
        body:
          `AI processing history expires after ${historyExpirationDays} days. ` +
          `When you delete your account, most personal data is removed or anonymized within ${deletedAccountGraceDays} days. ` +
          'Some billing and fraud-prevention records may be kept longer where required by law.',
      },
      {
        id: 'deletion',
        title: 'Account and data deletion',
        body:
          'You can delete your account in the app: Settings → Delete account (password and confirmation required). ' +
          'You can also request deletion without reinstalling the app via our web form at the account deletion page. ' +
          'Deletion removes or anonymizes your profile, cloud packs, stickers, processing history, and tokens. ' +
          'Local packs on your device are not removed automatically.',
      },
      {
        id: 'security',
        title: 'Security',
        body:
          'Data in transit is encrypted using TLS (HTTPS). Passwords are stored using one-way hashing. ' +
          'Access tokens are short-lived. We apply industry-standard measures to protect stored data.',
      },
      {
        id: 'contact',
        title: 'Contact',
        body:
          `Privacy questions: ${privacyEmail}\n` +
          `General support: ${supportEmail}`,
      },
    ],
  };
}
