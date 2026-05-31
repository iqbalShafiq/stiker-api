import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../../src/app';

describe('Legal Routes', () => {
  it('GET /api/v1/legal returns summary', async () => {
    const response = await request(app).get('/api/v1/legal');
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.privacyUrl).toBeTruthy();
    expect(response.body.data.termsUrl).toBeTruthy();
  });

  it('GET /api/v1/legal/retention returns retention policy', async () => {
    const response = await request(app).get('/api/v1/legal/retention');
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.processingHistoryDays).toBeGreaterThan(0);
  });
});
