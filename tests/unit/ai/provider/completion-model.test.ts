import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCompletionModelForRole } from '../../../../src/ai/provider/completion-model';

const loadAiModelMock = vi.hoisted(() => vi.fn());
const getCompletionModelMock = vi.hoisted(() => vi.fn(async () => ({ provider: 'test' })));

vi.mock('../../../../src/ai/models/catalog', () => ({ loadAiModel: loadAiModelMock }));
vi.mock('../../../../src/ai/provider/client', () => ({ getCompletionModel: getCompletionModelMock }));

describe('getCompletionModelForRole', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('binds model, default effort and decoding settings from the catalog row', async () => {
    loadAiModelMock.mockResolvedValueOnce({
      role: 'agent',
      modelId: 'meta/muse-spark-1.3-contributor',
      reasoningEfforts: ['low', 'high'],
      defaultReasoningEffort: 'high',
      temperature: 0.2,
      maxTokens: 4000,
    });

    const binding = await getCompletionModelForRole('agent');

    expect(binding.modelId).toBe('meta/muse-spark-1.3-contributor');
    expect(binding.reasoningEffort).toBe('high');
    expect(binding.temperature).toBe(0.2);
    expect(binding.maxTokens).toBe(4000);
    expect(getCompletionModelMock).toHaveBeenCalledWith(
      'meta/muse-spark-1.3-contributor',
      expect.objectContaining({ controls: expect.anything() })
    );
  });

  it('declares no controls when the model exposes no reasoning efforts', async () => {
    loadAiModelMock.mockResolvedValueOnce({
      role: 'image',
      modelId: 'bytedance-seed/seedream-5-0-flash',
      reasoningEfforts: [],
      defaultReasoningEffort: null,
      temperature: null,
      maxTokens: null,
    });

    const binding = await getCompletionModelForRole('image');

    expect(binding.reasoningEffort).toBeNull();
    expect(getCompletionModelMock).toHaveBeenCalledWith('bytedance-seed/seedream-5-0-flash', {});
  });

  it('drops a rejected binding so a later call can retry', async () => {
    loadAiModelMock.mockRejectedValueOnce(new Error('db down')).mockResolvedValueOnce({
      role: 'vision',
      modelId: 'meta/muse-spark-1.3-contributor',
      reasoningEfforts: ['low'],
      defaultReasoningEffort: 'low',
      temperature: null,
      maxTokens: null,
    });

    await expect(getCompletionModelForRole('vision')).rejects.toThrow('db down');

    const binding = await getCompletionModelForRole('vision');
    expect(binding.modelId).toBe('meta/muse-spark-1.3-contributor');
  });
});
