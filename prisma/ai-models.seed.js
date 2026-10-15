/** Canonical AI model catalog. Kept in CJS so the production image (no tsx) can seed it. */
const AI_MODEL_SEED = [
  {
    role: 'agent',
    modelId: 'meta/muse-spark-1.3-contributor',
    reasoningEfforts: ['low', 'medium', 'high', 'max'],
    defaultReasoningEffort: 'high',
    temperature: 0.2,
    maxTokens: 4000,
    label: 'Meta Muse Spark 1.3 (contributor)',
  },
  {
    role: 'vision',
    modelId: 'meta/muse-spark-1.3-contributor',
    reasoningEfforts: ['low', 'medium', 'high', 'max'],
    defaultReasoningEffort: 'medium',
    temperature: null,
    maxTokens: null,
    label: 'Meta Muse Spark 1.3 (contributor)',
  },
  {
    role: 'improvement',
    modelId: 'meta/muse-spark-1.3-contributor',
    reasoningEfforts: ['low', 'medium', 'high', 'max'],
    defaultReasoningEffort: 'medium',
    temperature: null,
    maxTokens: null,
    label: 'Meta Muse Spark 1.3 (contributor)',
  },
  {
    role: 'image',
    modelId: 'bytedance-seed/seedream-5-0-flash',
    reasoningEfforts: [],
    defaultReasoningEffort: null,
    temperature: null,
    maxTokens: null,
    label: 'ByteDance Seedream 5.0 Flash',
  },
];

module.exports = { AI_MODEL_SEED };
