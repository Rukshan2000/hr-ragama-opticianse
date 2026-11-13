import { describe, expect, it } from 'vitest';
import { API, setupTestApp } from '../helpers/test-app';

const app = setupTestApp();

describe('health & API conventions', () => {
  it('liveness and readiness', async () => {
    expect((await app().inject(`${API}/health`)).json()).toMatchObject({
      success: true,
      data: { status: 'ok' },
    });
    const ready = await app().inject(`${API}/health/ready`);
    expect(ready.statusCode).toBe(200);
    expect(ready.json().data).toEqual({ status: 'ready', database: 'up' });
  });

  it('echoes a valid x-request-id and generates one otherwise', async () => {
    const own = await app().inject({
      url: `${API}/health`,
      headers: { 'x-request-id': 'abc-123' },
    });
    expect(own.headers['x-request-id']).toBe('abc-123');
    const bad = await app().inject({
      url: `${API}/health`,
      headers: { 'x-request-id': '<script>' },
    });
    expect(bad.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('returns the standard error envelope for unknown routes', async () => {
    const res = await app().inject(`${API}/nope`);
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({
      success: false,
      errors: [],
      meta: { requestId: expect.any(String) },
    });
  });

  it('rejects malformed JSON with 400, not 500', async () => {
    const res = await app().inject({
      method: 'POST',
      url: `${API}/auth/login`,
      headers: { 'content-type': 'application/json' },
      payload: '{bad',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().success).toBe(false);
  });

  it('sets security headers', async () => {
    const res = await app().inject(`${API}/health`);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBeDefined();
  });

  it('serves the OpenAPI document', async () => {
    const res = await app().inject('/docs/json');
    expect(res.statusCode).toBe(200);
    expect(Object.keys(res.json().paths)).toContain(`${API}/auth/login`);
  });
});
