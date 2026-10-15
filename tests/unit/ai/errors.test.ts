import { describe, expect, it } from 'vitest';
import { AIGenerationError, ProviderError, TimeoutError } from '../../../src/errors';
import { extractProviderErrorMessage, isProviderError, toAiError } from '../../../src/ai/errors';

describe('ai error mapping', () => {
  it('maps an aborted signal to TimeoutError', () => {
    const controller = new AbortController();
    controller.abort();
    expect(toAiError(new Error('aborted'), { abortSignal: controller.signal })).toBeInstanceOf(
      TimeoutError
    );
  });

  it('maps an AbortError by name to TimeoutError', () => {
    const error = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
    expect(toAiError(error)).toBeInstanceOf(TimeoutError);
  });

  it('maps provider error messages to ProviderError', () => {
    expect(toAiError(new Error('Provider returned error'))).toBeInstanceOf(ProviderError);
    expect(toAiError(new Error('Upstream 502 bad gateway'))).toBeInstanceOf(ProviderError);
    expect(isProviderError(new Error('Upstream 502 bad gateway'))).toBe(true);
  });

  it('passes through AppError instances untouched', () => {
    const original = new AIGenerationError('already mapped');
    expect(toAiError(original)).toBe(original);
  });

  it('falls back to AIGenerationError', () => {
    expect(toAiError(new Error('boom'))).toBeInstanceOf(AIGenerationError);
    expect(extractProviderErrorMessage(new Error('boom'))).toBe('boom');
  });
});
