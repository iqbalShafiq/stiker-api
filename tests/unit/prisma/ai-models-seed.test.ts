import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
const { AI_MODEL_SEED } = require_('../../../prisma/ai-models.seed.js') as {
  AI_MODEL_SEED: Array<{
    role: string;
    modelId: string;
    reasoningEfforts: string[];
    defaultReasoningEffort: string | null;
  }>;
};

const MUSE = 'meta/muse-spark-1.3-contributor';
const SEEDREAM = 'bytedance-seed/seedream-5-0-flash';

describe('AI model seed data', () => {
  it('registers exactly the approved catalog', () => {
    expect(AI_MODEL_SEED.map((model) => model.role).sort()).toEqual([
      'agent',
      'image',
      'improvement',
      'vision',
    ]);
    for (const model of AI_MODEL_SEED) {
      expect([MUSE, SEEDREAM]).toContain(model.modelId);
    }
  });

  it('uses muse spark for every completion role with a valid default effort', () => {
    for (const model of AI_MODEL_SEED) {
      if (model.role === 'image') continue;
      expect(model.modelId).toBe(MUSE);
      expect(model.reasoningEfforts.length).toBeGreaterThan(0);
      expect(model.defaultReasoningEffort).not.toBeNull();
      expect(model.reasoningEfforts).toContain(model.defaultReasoningEffort as string);
    }
  });

  it('registers seedream only for the image role without reasoning efforts', () => {
    const image = AI_MODEL_SEED.find((model) => model.role === 'image');
    expect(image?.modelId).toBe(SEEDREAM);
    expect(image?.reasoningEfforts).toEqual([]);
  });
});
