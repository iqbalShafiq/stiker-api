import { afterEach, describe, expect, it, vi } from 'vitest';

const warnMock = vi.hoisted(() => vi.fn());

vi.mock('../../../src/ai/esm', () => ({
  importEsm: vi.fn(async (specifier: string) => {
    if (specifier === '@anvia/langfuse') {
      throw new Error('langfuse import failed');
    }
    throw new Error(`unexpected import: ${specifier}`);
  }),
}));

vi.mock('../../../src/utils/logger', () => ({
  default: {
    warn: warnMock,
    info: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('AI tracing when Langfuse initialization fails', () => {
  afterEach(() => {
    delete process.env.LANGFUSE_PUBLIC_KEY;
    delete process.env.LANGFUSE_SECRET_KEY;
    vi.resetModules();
  });

  it('degrades to a null observer and no-op flush/close instead of caching a rejection', async () => {
    process.env.LANGFUSE_PUBLIC_KEY = 'pk-test';
    process.env.LANGFUSE_SECRET_KEY = 'sk-test';
    vi.resetModules();

    const tracing = await import('../../../src/ai/tracing');

    await expect(tracing.getLangfuseObserver()).resolves.toBeNull();
    await expect(tracing.flushAiTracing()).resolves.toBeUndefined();
    await expect(tracing.closeAiTracing()).resolves.toBeUndefined();
    expect(warnMock).toHaveBeenCalled();
  });
});
