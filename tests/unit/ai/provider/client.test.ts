import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCompletionModel } from '../../../../src/ai/provider/client';

const importEsmMock = vi.hoisted(() => vi.fn());

vi.mock('../../../../src/ai/esm', () => ({ importEsm: importEsmMock }));

const fakeOpenAIModule = {
  OpenAIClient: class {
    completionModel() {
      return { provider: 'test', modelId: 'x' };
    }
  },
};

describe('provider client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retries client construction after a transient module load failure', async () => {
    importEsmMock.mockRejectedValueOnce(new Error('module load failed')).mockResolvedValueOnce(fakeOpenAIModule);

    await expect(getCompletionModel('model-a')).rejects.toThrow('module load failed');

    const model = await getCompletionModel('model-a');
    expect(model).toMatchObject({ provider: 'test' });
  });
});
