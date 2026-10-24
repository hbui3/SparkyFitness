import { beforeEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error TS(7016): no types for supertest
import request from 'supertest';
import express from 'express';

// The scope is chosen when the key is created (#2678).
const { mockCreateApiKey } = vi.hoisted(() => ({
  mockCreateApiKey: vi.fn(),
}));

vi.mock('../auth.js', () => ({
  auth: { api: { createApiKey: mockCreateApiKey } },
}));
vi.mock('../middleware/authMiddleware.js', () => ({
  authenticate: (
    req: { authenticatedUserId?: string; userId?: string },
    _res: unknown,
    next: () => void
  ) => {
    req.authenticatedUserId = 'u1';
    req.userId = 'u1';
    next();
  },
}));
vi.mock('../middleware/demoGuardMiddleware.js', () => ({
  demoGuard: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import apiKeyRoutes from '../routes/auth/apiKeyRoutes.js';

const app = express();
app.use(express.json());
app.use('/identity', apiKeyRoutes);

describe('POST /identity/user/generate-api-key scope (#2678)', () => {
  beforeEach(() => {
    mockCreateApiKey.mockReset();
    mockCreateApiKey.mockResolvedValue({
      id: 'key-1',
      key: 'secret',
      name: 'n',
      createdAt: '2026-10-07',
    });
  });

  it('creates a read-only key', async () => {
    const res = await request(app)
      .post('/identity/user/generate-api-key')
      .send({ name: 'Claude', scope: 'read' });
    expect(res.status).toBe(201);
    expect(res.body.apiKey.scope).toBe('read');
    expect(mockCreateApiKey).toHaveBeenCalledWith({
      body: expect.objectContaining({
        userId: 'u1',
        name: 'Claude',
        permissions: { sparky: ['read'] },
      }),
    });
  });

  it('defaults to full access and a one-year expiry', async () => {
    const res = await request(app)
      .post('/identity/user/generate-api-key')
      .send({ name: 'Shortcut' });
    expect(res.status).toBe(201);
    expect(res.body.apiKey.scope).toBe('full');
    expect(mockCreateApiKey.mock.calls[0][0].body).toMatchObject({
      permissions: { sparky: ['read', 'write'] },
      expiresIn: 31536000,
    });
  });

  it('passes a null expiry through as never expiring', async () => {
    await request(app)
      .post('/identity/user/generate-api-key')
      .send({ name: 'Shortcut', expiresIn: null });
    expect(mockCreateApiKey.mock.calls[0][0].body.expiresIn).toBeNull();
  });

  it.each([
    [{}],
    [{ name: '' }],
    [{ name: 'x', scope: 'admin' }],
    [{ name: 'x', expiresIn: -5 }],
  ])('rejects an invalid body %j with 400', async (body) => {
    const res = await request(app)
      .post('/identity/user/generate-api-key')
      .send(body);
    expect(res.status).toBe(400);
    expect(mockCreateApiKey).not.toHaveBeenCalled();
  });
});
