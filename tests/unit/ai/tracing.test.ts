import { describe, expect, it } from 'vitest';
import { closeAiTracing, flushAiTracing, getLangfuseObserver } from '../../../src/ai/tracing';

describe('AI tracing without Langfuse credentials', () => {
  it('returns a null observer and resolves flush/close as no-ops', async () => {
    expect(await getLangfuseObserver()).toBeNull();
    await expect(flushAiTracing()).resolves.toBeUndefined();
    await expect(closeAiTracing()).resolves.toBeUndefined();
  });
});
