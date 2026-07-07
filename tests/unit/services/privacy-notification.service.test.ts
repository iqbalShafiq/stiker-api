import { afterEach, describe, expect, it, vi } from 'vitest';
import { privacyNotificationService } from '../../../src/services/privacy-notification.service';

describe('PrivacyNotificationService', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.PRIVACY_NOTIFICATION_WEBHOOK_URL;
  });

  it('posts account deletion payload to webhook when configured', async () => {
    process.env.PRIVACY_NOTIFICATION_WEBHOOK_URL = 'https://hooks.example.com/privacy';
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    await privacyNotificationService.notifyAccountDeletionRequest({
      requestId: 'req-123',
      emailDomain: 'example.com',
      hasMatchingUser: true,
      source: 'WEB',
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.type).toBe('account_deletion_request');
    expect(body.requestId).toBe('req-123');
    expect(body.emailDomain).toBe('example.com');
  });

  it('skips webhook when URL is not configured', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await privacyNotificationService.notifyAccountDeletionRequest({
      requestId: 'req-456',
      emailDomain: null,
      hasMatchingUser: false,
      source: 'WEB',
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
