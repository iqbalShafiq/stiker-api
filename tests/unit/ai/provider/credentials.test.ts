import { describe, expect, it, vi } from 'vitest';

describe('requireAgentCredentials', () => {
  it('throws AiNotConfiguredError when AGENT_API_KEY is missing', async () => {
    const previous = process.env.AGENT_API_KEY;
    process.env.AGENT_API_KEY = '';
    vi.resetModules();

    try {
      const { requireAgentCredentials } = await import('../../../../src/ai/provider/client');

      try {
        requireAgentCredentials();
        expect.unreachable('expected requireAgentCredentials to throw');
      } catch (error) {
        expect(error).toMatchObject({ code: 'AI_NOT_CONFIGURED', statusCode: 500 });
      }
    } finally {
      process.env.AGENT_API_KEY = previous;
    }
  });

  it('returns the configured key and base url', async () => {
    process.env.AGENT_API_KEY = 'test-api-key';
    vi.resetModules();

    const { requireAgentCredentials } = await import('../../../../src/ai/provider/client');

    expect(requireAgentCredentials()).toEqual({
      apiKey: 'test-api-key',
      baseUrl: 'https://openrouter.example/api/v1',
    });
  });
});
