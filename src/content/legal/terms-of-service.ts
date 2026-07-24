import type { LegalDocument } from './types';
import { getLegalMeta } from './legal-meta';
import { LEGAL_VERSION } from './version';

export function buildTermsOfService(): LegalDocument {
  const meta = getLegalMeta();
  const { appName, developerName, supportEmail } = meta;

  return {
    title: 'Terms of Service',
    version: LEGAL_VERSION,
    effectiveDate: LEGAL_VERSION,
    summary:
      `By using ${appName}, you agree to use AI and sharing features responsibly and to comply with applicable laws ` +
      'when creating, publishing, and interacting with sticker content.',
    sections: [
      {
        id: 'acceptance',
        title: 'Acceptance',
        body:
          `These Terms of Service ("Terms") govern your use of ${appName} operated by ${developerName}. ` +
          'If you do not agree, do not use the Service.',
      },
      {
        id: 'your-content',
        title: 'Your content',
        body:
          'You retain ownership of content you upload and create. By publishing a pack to Explore (public), ' +
          'you grant us a non-exclusive license to host, display, and distribute that pack to other users ' +
          'as part of the Service. You are solely responsible for content you create, publish, or share.',
      },
      {
        id: 'prohibited-content',
        title: 'Prohibited content',
        body:
          'You must not create, upload, generate, publish, or share content that:\n\n' +
          '• Is illegal or promotes illegal activity\n' +
          '• Depicts or facilitates child sexual abuse or exploitation (CSAM)\n' +
          '• Is sexually explicit or non-consensual intimate imagery (including deepfakes)\n' +
          '• Promotes extreme violence or glorifies harm\n' +
          '• Constitutes fraud, scams, or deceptive impersonation\n' +
          '• Harasses, bullies, or threatens others, or promotes hate against protected groups\n' +
          '• Infringes intellectual property, trademark, or privacy rights of others\n' +
          '• Contains spam or malicious material',
      },
      {
        id: 'ai-use',
        title: 'AI features',
        body:
          'AI-generated outputs may be inaccurate or inappropriate. You are responsible for reviewing outputs ' +
          'before publishing or sharing. Do not use AI features to create prohibited content. ' +
          'We may block, remove, or restrict outputs that violate these Terms or our safety policies.',
      },
      {
        id: 'public-packs',
        title: 'Public packs and Explore',
        body:
          'Public packs are visible to other users. We may remove, hide, or restrict packs that violate these Terms. ' +
          'Other users may report your public packs. Repeated violations may result in account suspension or termination.',
      },
      {
        id: 'reporting-moderation',
        title: 'Reporting and moderation',
        body:
          'Users can report public packs and AI outputs they believe violate these Terms. ' +
          'We review reports and may remove content, hide packs, block accounts, or take other action. ' +
          'You can also block creators to stop seeing their public content in Explore.',
      },
      {
        id: 'account-termination',
        title: 'Account termination',
        body:
          'You may delete your account at any time through in-app settings or our web deletion request form. ' +
          'We may suspend or terminate accounts that violate these Terms or pose safety or legal risk.',
      },
      {
        id: 'disclaimer',
        title: 'Disclaimer',
        body:
          'The Service is provided "as is" without warranties. We are not liable for indirect or consequential damages ' +
          'to the extent permitted by law.',
      },
      {
        id: 'contact',
        title: 'Contact',
        body: `Questions about these Terms: ${supportEmail}`,
      },
    ],
  };
}
