import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  loadAiModel,
  MissingAiModelError,
  resetAiModelCache,
} from '../../../../src/ai/models/catalog';
import { AppError } from '../../../../src/errors';

const findUniqueMock = vi.hoisted(() => vi.fn());

vi.mock('../../../../src/prisma/client', () => ({
  prisma: { aiModel: { findUnique: findUniqueMock } },
}));

describe('loadAiModel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAiModelCache();
  });

  it('returns the row and caches it per process', async () => {
    findUniqueMock.mockResolvedValueOnce({
      role: 'agent',
      modelId: 'meta/muse-spark-1.3-contributor',
      reasoningEfforts: ['low', 'high'],
      defaultReasoningEffort: 'high',
      temperature: 0.2,
      maxTokens: 4000,
    });

    const first = await loadAiModel('agent');
    const second = await loadAiModel('agent');

    expect(first.modelId).toBe('meta/muse-spark-1.3-contributor');
    expect(second).toBe(first);
    expect(findUniqueMock).toHaveBeenCalledTimes(1);
  });

  it('fails fast with a seed hint when the row is missing', async () => {
    findUniqueMock.mockResolvedValueOnce(null);

    await expect(loadAiModel('vision')).rejects.toBeInstanceOf(MissingAiModelError);
    expect(findUniqueMock).toHaveBeenCalledTimes(1);
    await expect(loadAiModel('vision')).rejects.toThrow(/prisma db seed/);
  });

  it('surfaces as an AppError so the seed hint reaches HTTP responses (not a generic 500)', () => {
    const error = new MissingAiModelError('vision');
    expect(error).toBeInstanceOf(AppError);
    expect(error.statusCode).toBe(500);
    expect(error.code).toBe('AI_MODEL_NOT_CONFIGURED');
    expect(error.message).toContain('prisma db seed');
  });
});
