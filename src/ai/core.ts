import { importEsm } from './esm';

export type AnviaCoreModule = typeof import('@anvia/core');

let corePromise: Promise<AnviaCoreModule> | undefined;

/** Lazy, process-wide loader for the ESM-only @anvia/core package. */
export function anviaCore(): Promise<AnviaCoreModule> {
  corePromise ??= importEsm<AnviaCoreModule>('@anvia/core');
  return corePromise;
}
