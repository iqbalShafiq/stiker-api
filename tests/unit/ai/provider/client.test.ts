import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const importEsmMock = vi.hoisted(() => vi.fn());
const clientInstances = vi.hoisted(() => [] as Array<Record<string, unknown>>);
const completionModelCalls = vi.hoisted(() => [] as Array<Record<string, unknown>>);

vi.mock('../../../../src/ai/esm', () => ({ importEsm: importEsmMock }));

function makeFakeModule() {
  return {
    OpenAIClient: class {
      constructor(options: Record<string, unknown>) {
        clientInstances.push(options);
      }
      completionModel(options: Record<string, unknown>) {
        completionModelCalls.push(options);
        return { provider: 'test', modelId: 'x' };
      }
    },
  };
}

async function loadClient() {
  vi.resetModules();
  return import('../../../../src/ai/provider/client');
}

describe('provider client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clientInstances.length = 0;
    completionModelCalls.length = 0;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('retries client construction after a transient module load failure', async () => {
    importEsmMock
      .mockRejectedValueOnce(new Error('module load failed'))
      .mockResolvedValueOnce(makeFakeModule());

    const { getCompletionModel } = await loadClient();

    await expect(getCompletionModel('model-a')).rejects.toThrow('module load failed');

    const model = await getCompletionModel('model-a');
    expect(model).toMatchObject({ provider: 'test' });
  });

  it('builds chat models with gateway headers and forwards controls', async () => {
    importEsmMock.mockResolvedValue(makeFakeModule());

    const { getCompletionModel } = await loadClient();
    await getCompletionModel('model-b', {
      controls: { reasoningEffort: { type: 'select', options: ['low', 'high'] } },
    });

    expect(clientInstances[0]).toMatchObject({
      baseUrl: 'https://openrouter.example/api/v1',
      apiKey: 'test-api-key',
      headers: { 'HTTP-Referer': 'http://localhost:3000', 'X-Title': 'Setiker' },
    });
    expect(completionModelCalls[0]).toMatchObject({
      modelId: 'model-b',
      api: 'chat',
      controls: { reasoningEffort: { type: 'select', options: ['low', 'high'] } },
    });
  });

  it('caches one client per module instance across calls', async () => {
    importEsmMock.mockResolvedValue(makeFakeModule());

    const { getCompletionModel } = await loadClient();
    await getCompletionModel('model-c');
    await getCompletionModel('model-c');

    expect(clientInstances).toHaveLength(1);
  });
});
