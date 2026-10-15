/**
 * Smoke test for the compiled CommonJS build: the ESM shim must actually be
 * able to load the ESM-only @anvia packages from dist. The vitest suite runs
 * through its own ESM transform, so this is the only check that mirrors
 * production resolution.
 */
const { importEsm } = require('../dist/ai/esm');

const REQUIRED_EXPORTS = ['Agent', 'createTool', 'generateCompletion', 'generateImage'];

importEsm('@anvia/core')
  .then((core) => {
    for (const name of REQUIRED_EXPORTS) {
      if (typeof core[name] !== 'function') {
        throw new Error(`@anvia/core is missing expected export: ${name}`);
      }
    }
    console.log('dist ESM shim OK:', REQUIRED_EXPORTS.join(', '));
  })
  .catch((error) => {
    console.error('dist ESM shim FAILED:', error);
    process.exit(1);
  });
