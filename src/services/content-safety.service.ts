import { config } from '../config';
import { ValidationError } from '../errors';

const BLOCKLIST_KEYWORDS = [
  'child porn',
  'cp ',
  'csam',
  'nazi',
  'kill yourself',
  'kys',
];

export interface ContentSafetyInput {
  name?: string;
  description?: string;
  prompt?: string;
}

export class ContentSafetyService {
  isEnabled(): boolean {
    return config.legal.contentSafetyEnabled;
  }

  assertPublishable(input: ContentSafetyInput): void {
    if (!this.isEnabled()) return;

    const combined = [input.name, input.description, input.prompt]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    if (!combined.trim()) return;

    for (const keyword of BLOCKLIST_KEYWORDS) {
      if (combined.includes(keyword)) {
        throw new ValidationError(
          'This content may violate our community guidelines and cannot be published.'
        );
      }
    }
  }

  scanText(text: string): { flagged: boolean; reason?: string } {
    if (!this.isEnabled()) return { flagged: false };
    const lower = text.toLowerCase();
    for (const keyword of BLOCKLIST_KEYWORDS) {
      if (lower.includes(keyword)) {
        return { flagged: true, reason: `Matched safety keyword: ${keyword}` };
      }
    }
    return { flagged: false };
  }
}

export const contentSafetyService = new ContentSafetyService();
