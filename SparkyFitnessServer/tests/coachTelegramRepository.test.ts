import { beforeEach, describe, expect, it, vi } from 'vitest';
import coachTelegramRepository from '../models/coachTelegramRepository.js';
import { getClient, getSystemClient } from '../db/poolManager.js';

vi.mock('../db/poolManager.js', () => ({
  getClient: vi.fn(),
  getSystemClient: vi.fn(),
}));

describe('coachTelegramRepository', () => {
  const userClient = { query: vi.fn(), release: vi.fn() };
  const systemClient = { query: vi.fn(), release: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getClient).mockResolvedValue(userClient as never);
    vi.mocked(getSystemClient).mockResolvedValue(systemClient as never);
  });

  it('stores only the caller-provided hash and expiry for owner pairing', async () => {
    userClient.query.mockResolvedValue({ rowCount: 1 });
    const expiresAt = new Date('2026-08-18T10:15:00.000Z');

    await coachTelegramRepository.storeLinkToken(
      'user-1',
      'a'.repeat(64),
      expiresAt
    );

    expect(getClient).toHaveBeenCalledWith('user-1', 'user-1');
    expect(userClient.query).toHaveBeenCalledWith(
      expect.stringContaining('link_token_hash'),
      ['user-1', 'a'.repeat(64), expiresAt]
    );
  });

  it('claims a valid one-time token and binds the private chat transactionally', async () => {
    systemClient.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{ user_id: 'user-1' }] })
      .mockResolvedValueOnce({ rowCount: 0 })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({});

    await expect(
      coachTelegramRepository.claimLinkToken({
        tokenHash: 'b'.repeat(64),
        telegramChatId: '12345',
        telegramUserId: '777',
        telegramUsername: 'hendr',
      })
    ).resolves.toBe('user-1');

    expect(systemClient.query.mock.calls[0][0]).toBe('BEGIN');
    expect(systemClient.query.mock.calls[1][0]).toContain(
      'link_token_expires_at > now()'
    );
    expect(systemClient.query.mock.calls[3][0]).toContain(
      'link_token_hash = NULL'
    );
    expect(systemClient.query.mock.calls[4][0]).toBe('COMMIT');
  });

  it('distinguishes a duplicate Telegram update from an unpaired chat', async () => {
    systemClient.query.mockResolvedValue({
      rows: [{ user_id: 'user-1', claimed: false }],
    });

    await expect(
      coachTelegramRepository.claimIncomingUpdate('12345', 42)
    ).resolves.toEqual({ userId: 'user-1', claimed: false });

    expect(systemClient.query).toHaveBeenCalledWith(
      expect.stringContaining('NOT EXISTS (SELECT 1 FROM claimed)'),
      ['12345', 42]
    );
  });
});
