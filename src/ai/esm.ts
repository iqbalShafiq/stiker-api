/**
 * Native dynamic import that survives TypeScript's CommonJS emit.
 *
 * `tsc` lowers `import()` to `require()` under `module: commonjs`, but the
 * `@anvia/*` packages are ESM-only and their `exports` maps declare no
 * `require` condition, so `require()` fails with ERR_PACKAGE_PATH_NOT_EXPORTED.
 * The Function constructor keeps the runtime's native ESM loader in play.
 */
// eslint-disable-next-line no-new-func, @typescript-eslint/no-implied-eval -- required to keep a native ESM import in CJS emit
const nativeImport = new Function('specifier', 'return import(specifier)') as (
  specifier: string
) => Promise<unknown>;

export function importEsm<T>(specifier: string): Promise<T> {
  return nativeImport(specifier) as Promise<T>;
}
