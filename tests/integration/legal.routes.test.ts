import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../../src/app';

describe('Legal Routes', () => {
  it('GET /api/v1/legal returns summary with accountDeletionUrl', async () => {
    const response = await request(app).get('/api/v1/legal');
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.privacyUrl).toBeTruthy();
    expect(response.body.data.termsUrl).toBeTruthy();
    expect(response.body.data.accountDeletionUrl).toContain('/account-deletion');
  });

  it('GET /api/v1/legal/privacy returns sections', async () => {
    const response = await request(app).get('/api/v1/legal/privacy');
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(Array.isArray(response.body.data.sections)).toBe(true);
    expect(response.body.data.sections.length).toBeGreaterThan(0);
    const bodyText = JSON.stringify(response.body.data);
    expect(bodyText).toMatch(/AI/i);
    expect(bodyText).toMatch(/delet/i);
  });

  it('GET /api/v1/legal/terms returns prohibited content sections', async () => {
    const response = await request(app).get('/api/v1/legal/terms');
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.sections.some((s: { id: string }) => s.id === 'prohibited-content')).toBe(true);
  });

  it('GET /api/v1/legal/retention returns retention policy', async () => {
    const response = await request(app).get('/api/v1/legal/retention');
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.processingHistoryDays).toBeGreaterThan(0);
  });

  it('GET /privacy returns HTML', async () => {
    const response = await request(app).get('/privacy');
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/html/);
    expect(response.text).toContain('Privacy Policy');
  });

  it('GET /account-deletion returns HTML form', async () => {
    const response = await request(app).get('/account-deletion');
    expect(response.status).toBe(200);
    expect(response.text).toContain('deletion-form');
    expect(response.text).toContain('account-deletion/request');
  });

  it('POST /api/v1/legal/account-deletion/request validates email', async () => {
    const response = await request(app)
      .post('/api/v1/legal/account-deletion/request')
      .send({ email: 'not-an-email', confirmed: true });
    expect(response.status).toBe(400);
  });

  it('POST /api/v1/legal/account-deletion/request accepts valid request', async () => {
    const response = await request(app)
      .post('/api/v1/legal/account-deletion/request')
      .send({ email: `delete-test-${Date.now()}@example.com`, confirmed: true, reason: 'test' });
    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.data.requestId).toBeTruthy();
  });
});
