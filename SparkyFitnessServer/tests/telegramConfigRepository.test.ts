import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSystemClient } from '../db/poolManager.js';
import telegramConfigRepository from '../models/telegramConfigRepository.js';

vi.mock('../db/poolManager.js', () => ({
  getSystemClient: vi.fn(),
}));

describe('telegramConfigRepository', () => {
  const systemClient = { query: vi.fn(), release: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSystemClient).mockResolvedValue(systemClient as never);
  });

  it('reads the singleton credential only through the system client', async () => {
    systemClient.query.mockResolvedValue({ rows: [] });

    await expect(
      telegramConfigRepository.getSettings()
    ).resolves.toBeUndefined();

    expect(getSystemClient).toHaveBeenCalledTimes(1);
    expect(systemClient.query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE id = 1')
    );
    expect(systemClient.release).toHaveBeenCalledTimes(1);
  });

  it('persists encrypted fields without accepting plaintext credentials', async () => {
    systemClient.query.mockResolvedValue({ rowCount: 1 });
    const encrypted = {
      encryptedBotToken: 'encrypted-token',
      botTokenIv: 'token-iv',
      botTokenTag: 'token-tag',
      encryptedWebhookSecret: 'encrypted-secret',
      webhookSecretIv: 'secret-iv',
      webhookSecretTag: 'secret-tag',
    };

    await telegramConfigRepository.saveSettings(encrypted);

    expect(systemClient.query).toHaveBeenCalledWith(
      expect.stringContaining('ON CONFLICT (id) DO UPDATE'),
      Object.values(encrypted)
    );
    expect(systemClient.release).toHaveBeenCalledTimes(1);
  });

  it('clears the stored credential fields but keeps the singleton row', async () => {
    systemClient.query.mockResolvedValue({ rowCount: 1 });

    await expect(telegramConfigRepository.clearSettings()).resolves.toBe(true);

    expect(systemClient.query).toHaveBeenCalledWith(
      expect.stringContaining('SET encrypted_bot_token = NULL')
    );
    expect(systemClient.release).toHaveBeenCalledTimes(1);
  });
});
