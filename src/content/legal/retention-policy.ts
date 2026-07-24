import type { RetentionPolicyDocument } from './types';
import { getLegalMeta } from './legal-meta';

export function buildRetentionPolicy(): RetentionPolicyDocument {
  const meta = getLegalMeta();
  const { historyExpirationDays, deletedAccountGraceDays } = meta;

  return {
    processingHistoryDays: historyExpirationDays,
    deletedAccountGraceDays,
    aiInputHandling:
      'Images and prompts sent to AI features are processed to generate stickers. ' +
      `Processing outputs and metadata are retained for up to ${historyExpirationDays} days, then automatically deleted.`,
    description: `Processing outputs expire after ${historyExpirationDays} days.`,
    sections: [
      {
        id: 'ai-history',
        title: 'AI processing history',
        body:
          `Stored for ${historyExpirationDays} days, then automatically removed by our cleanup job. ` +
          'You can also clear history from the app when available.',
      },
      {
        id: 'account-deletion',
        title: 'Deleted accounts',
        body:
          `After account deletion, personal data is removed or anonymized within ${deletedAccountGraceDays} days. ` +
          'Physical file purge from storage may complete shortly after database deletion.',
      },
      {
        id: 'billing',
        title: 'Billing records',
        body:
          'Purchase verification data may be retained in anonymized form for legal, tax, and fraud-prevention obligations.',
      },
    ],
  };
}
