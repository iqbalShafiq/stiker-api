import { describe, expect, it } from 'vitest';
import { importEsm } from '../../../src/ai/esm';

describe('importEsm', () => {
  it('loads a builtin ESM module from CommonJS-compiled code', async () => {
    const os = await importEsm<typeof import('node:os')>('node:os');
    expect(typeof os.platform()).toBe('string');
  });

  it('loads the ESM-only @anvia/core package', async () => {
    const core = await importEsm<typeof import('@anvia/core')>('@anvia/core');
    expect(typeof core.Agent).toBe('function');
    expect(typeof core.createTool).toBe('function');
    expect(typeof core.generateCompletion).toBe('function');
    expect(typeof core.generateImage).toBe('function');
  });
});
