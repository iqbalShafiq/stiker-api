import { AIGenerationError, AppError, ProviderError, TimeoutError } from '../errors';

interface ProviderErrorResponse {
  status?: number;
  error?: {
    metadata?: {
      raw?: string;
    };
  };
}

export function isProviderError(error: unknown): boolean {
  if (error instanceof ProviderError) {
    return true;
  }
  if (error instanceof AppError) {
    return false;
  }
  if (error instanceof Error) {
    const providerError = error as ProviderErrorResponse;
    return (
      error.message.includes('Provider returned error') ||
      error.message.includes('502') ||
      providerError.status === 502
    );
  }
  return false;
}

export function extractProviderErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const providerError = error as ProviderErrorResponse;
    if (providerError.error?.metadata?.raw) {
      return `${error.message}: ${providerError.error.metadata.raw}`;
    }
    return error.message;
  }
  return 'Provider error';
}

/** Maps a provider/runtime failure to the application's AI error taxonomy. */
export function toAiError(error: unknown, context: { abortSignal?: AbortSignal } = {}): AppError {
  if (error instanceof AppError) {
    return error;
  }
  if (
    context.abortSignal?.aborted === true ||
    (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError'))
  ) {
    return new TimeoutError();
  }
  if (isProviderError(error)) {
    return new ProviderError(extractProviderErrorMessage(error));
  }
  const message =
    error instanceof Error && error.message.trim().length > 0 ? error.message : 'AI request failed';
  return new AIGenerationError(message);
}
