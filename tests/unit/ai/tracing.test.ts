import { afterEach, describe, expect, it, vi } from 'vitest';

const importEsmMock = vi.hoisted(() => vi.fn());

vi.mock('../../../src/ai/esm', () => ({ importEsm: importEsmMock }));

const fakeLangfuseModule = {
  LangfuseClient: class {
    observer() {
      return { id: 'fake-observer' };
    }
    async flush() {}
    async close() {}
  },
};

async function loadTracing() {
  vi.resetModules();
  return import('../../../src/ai/tracing');
}

describe('AI tracing', () => {
  afterEach(() => {
    process.env.LANGFUSE_PUBLIC_KEY = '';
    process.env.LANGFUSE_SECRET_KEY = '';
    vi.clearAllMocks();
  });

  it('returns a null observer and resolves flush/close as no-ops without credentials', async () => {
    process.env.LANGFUSE_PUBLIC_KEY = '';
    process.env.LANGFUSE_SECRET_KEY = '';
    const { closeAiTracing, flushAiTracing, getLangfuseObserver } = await loadTracing();

    expect(await getLangfuseObserver()).toBeNull();
    await expect(flushAiTracing()).resolves.toBeUndefined();
    await expect(closeAiTracing()).resolves.toBeUndefined();
    expect(importEsmMock).not.toHaveBeenCalled();
  });

  it('retries initialization after a transient failure instead of disabling tracing forever', async () => {
    process.env.LANGFUSE_PUBLIC_KEY = 'pk';
    process.env.LANGFUSE_SECRET_KEY = 'sk';
    importEsmMock
      .mockRejectedValueOnce(new Error('transient import failure'))
      .mockResolvedValueOnce(fakeLangfuseModule);

    const { getLangfuseObserver } = await loadTracing();

    expect(await getLangfuseObserver()).toBeNull();
    expect(importEsmMock).toHaveBeenCalledTimes(1);

    const observer = await getLangfuseObserver();
    expect(observer).not.toBeNull();
    expect(importEsmMock).toHaveBeenCalledTimes(2);
  });

  it('reuses the initialized client for subsequent runs', async () => {
    process.env.LANGFUSE_PUBLIC_KEY = 'pk';
    process.env.LANGFUSE_SECRET_KEY = 'sk';
    importEsmMock.mockResolvedValue(fakeLangfuseModule);

    const { getLangfuseObserver } = await loadTracing();

    const first = await getLangfuseObserver();
    const second = await getLangfuseObserver();
    expect(first).not.toBeNull();
    expect(second).toBe(first);
    expect(importEsmMock).toHaveBeenCalledTimes(1);
  });
});
