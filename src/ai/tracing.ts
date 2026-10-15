import type { AgentOptions } from '@anvia/core';
import { config } from '../config';
import logger from '../utils/logger';
import { importEsm } from './esm';

type AnviaLangfuseModule = typeof import('@anvia/langfuse');
type LangfuseClientHandle = InstanceType<AnviaLangfuseModule['LangfuseClient']>;

/**
 * The langfuse package types its observer against the `@anvia/core/observability`
 * subpath, which classic (node) module resolution cannot see; that signature
 * degrades to `any`. Recover a concrete structural type from the root export so
 * the observer stays type-checked where it is wired into an agent.
 */
type AgentObservability = NonNullable<AgentOptions['observability']>;
type AgentObserverHandle = AgentObservability['observers'][string];

function tracingEnabled(): boolean {
  return config.langfuse.publicKey.length > 0 && config.langfuse.secretKey.length > 0;
}

let clientPromise: Promise<LangfuseClientHandle | null> | undefined;

function getClient(): Promise<LangfuseClientHandle | null> {
  if (!tracingEnabled()) {
    return Promise.resolve(null);
  }
  clientPromise ??= importEsm<AnviaLangfuseModule>('@anvia/langfuse')
    .then(
      ({ LangfuseClient }) =>
        new LangfuseClient({
          publicKey: config.langfuse.publicKey,
          secretKey: config.langfuse.secretKey,
          ...(config.langfuse.baseUrl.length > 0 ? { baseUrl: config.langfuse.baseUrl } : {}),
          environment: config.nodeEnv,
        })
    )
    .catch((error: unknown) => {
      // Tracing is optional: a broken integration must never fail agent runs.
      // Drop the cache so a transient failure does not disable tracing for the
      // process lifetime — the next agent run retries.
      clientPromise = undefined;
      logger.warn({ error }, 'Langfuse tracing initialization failed; continuing without tracing');
      return null;
    });
  return clientPromise;
}

let observerPromise: Promise<AgentObserverHandle | null> | undefined;

/** Langfuse AgentObserver, or null when credentials are not configured. */
export function getLangfuseObserver(): Promise<AgentObserverHandle | null> {
  observerPromise ??= getClient()
    .then((client) =>
      client
        ? (client.observer({ captureMode: 'safe' }) as AgentObserverHandle)
        : null
    )
    .then((observer) => {
      if (observer === null) {
        // Never cache a null observer: tracing may be unconfigured now or the
        // initialization may have failed transiently; each run re-evaluates.
        observerPromise = undefined;
      }
      return observer;
    });
  return observerPromise;
}

/** Flushes queued traces; safe to call when tracing is disabled. */
export async function flushAiTracing(): Promise<void> {
  const client = await (clientPromise ?? Promise.resolve(null));
  if (client) {
    await client.flush();
  }
}

let closePromise: Promise<void> | null = null;

/** Flushes and closes the tracing client once; safe when tracing is disabled. */
export function closeAiTracing(): Promise<void> {
  closePromise ??= (async (): Promise<void> => {
    const client = await (clientPromise ?? Promise.resolve(null));
    if (client) {
      await client.close();
    }
  })();
  return closePromise;
}
