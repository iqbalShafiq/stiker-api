import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const FIXTURE = path.resolve(process.cwd(), 'tests/unit/ai/support/esm-loader-check.ts');

describe('importEsm', () => {
  it('loads builtin and ESM-only packages with the real Node loader', () => {
    // A child process, not an in-process import: inside Vitest the dynamic import is served by
    // Vitest's own module runner, which cannot be reached from the `new Function` body that keeps
    // the native ESM loader alive. On Node 20 that made this test fail with "A dynamic import
    // callback was not specified", even though production was fine.
    const output = execFileSync(process.execPath, ['--import', 'tsx', FIXTURE], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    expect(output).toContain('ESM_OK');
  }, 60_000);
});
