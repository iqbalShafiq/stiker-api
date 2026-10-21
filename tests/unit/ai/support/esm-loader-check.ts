/**
 * Loads the ESM-only packages through the real Node loader.
 *
 * This runs as a child process on purpose. Inside Vitest, `import()` is served by Vitest's own
 * module runner, whose dynamic-import callback is not available to a `new Function` body - so the
 * check either fails outright ("A dynamic import callback was not specified") or silently tests
 * Vitest's loader instead of the one production uses. A child process is the only way to assert
 * the real resolution behaviour, and it behaves the same on every supported Node version.
 */
import { importEsm } from '../../../../src/ai/esm';

async function main(): Promise<void> {
  const os = await importEsm<typeof import('node:os')>('node:os');
  if (typeof os.platform() !== 'string') {
    throw new Error('node:os did not load through importEsm');
  }

  const core = await importEsm<typeof import('@anvia/core')>('@anvia/core');
  const required = ['Agent', 'createTool', 'generateCompletion', 'generateImage'];
  for (const name of required) {
    if (typeof (core as unknown as Record<string, unknown>)[name] !== 'function') {
      throw new Error(`@anvia/core is missing expected export: ${name}`);
    }
  }

  console.log('ESM_OK');
}

main().catch((error: unknown) => {
  console.error('ESM_FAILED', error);
  process.exit(1);
});
