import { beforeEach, describe, expect, it, vi } from 'vitest';
import coachProfileRepository from '../models/coachProfileRepository.js';
import { getClient, getSystemClient } from '../db/poolManager.js';

vi.mock('../db/poolManager.js', () => ({
  getClient: vi.fn(),
  getSystemClient: vi.fn(),
}));

describe('coachProfileRepository proactive messages', () => {
  const userClient = {
    query: vi.fn(),
    release: vi.fn(),
  };
  const systemClient = {
    query: vi.fn(),
    release: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getClient).mockResolvedValue(userClient as never);
    vi.mocked(getSystemClient).mockResolvedValue(systemClient as never);
  });

  it('maps local schedules and delivery markers for cheap due filtering', async () => {
    systemClient.query.mockResolvedValue({
      rows: [
        {
          user_id: 'user-1',
          timezone: 'Europe/Berlin',
          language: 'de',
          adaptive_check_ins_enabled: true,
          adaptive_last_sent_slot: '2026-08-17T19:00',
          adaptive_start_time: '07:00:00',
          adaptive_end_time: '20:00:00',
          adaptive_interval_minutes: 120,
          proactive_categories: ['nutrition', 'hydration'],
          adaptive_last_signature: 'last-state',
          adaptive_cooldown_last_message_at: new Date(
            '2026-08-17T17:00:00.000Z'
          ),
          last_user_message_at: null,
          coaching_notes: 'Be direct',
          routines: ['Train after work'],
          memory_enabled: true,
          daily_check_in_enabled: true,
          daily_check_in_time: '20:00:00',
          daily_last_sent_on: '2026-08-17',
          restock_last_sent_on: '2026-08-17',
          weekly_review_enabled: true,
          weekly_review_day: 0,
          weekly_review_time: '18:00:00',
          weekly_last_sent_on: null,
        },
      ],
    });

    await expect(
      coachProfileRepository.listProactiveCoachCandidates()
    ).resolves.toEqual([
      {
        userId: 'user-1',
        timezone: 'Europe/Berlin',
        language: 'de',
        adaptiveCheckInsEnabled: true,
        adaptiveLastObservedSlot: '2026-08-17T19:00',
        adaptiveStartTime: '07:00',
        adaptiveEndTime: '20:00',
        adaptiveIntervalMinutes: 120,
        proactiveCategories: ['nutrition', 'hydration'],
        adaptiveLastSignature: 'last-state',
        adaptiveCooldownLastMessageAt: '2026-08-17T17:00:00.000Z',
        lastUserMessageAt: null,
        coachingNotes: 'Be direct',
        routines: ['Train after work'],
        memoryEnabled: true,
        dailyCheckInEnabled: true,
        dailyCheckInTime: '20:00',
        dailyLastSentOn: '2026-08-17',
        restockLastSentOn: '2026-08-17',
        weeklyReviewEnabled: true,
        weeklyReviewDay: 0,
        weeklyReviewTime: '18:00',
        weeklyLastSentOn: null,
      },
    ]);
    expect(systemClient.query).toHaveBeenCalledWith(
      expect.stringContaining("history.metadata->>'kind' = ANY($1::text[])"),
      [['adaptive', 'restock']]
    );
  });

  it('returns recent adaptive and restock messages for cooldown and repetition control', async () => {
    userClient.query.mockResolvedValue({
      rows: [
        {
          content: 'Reis und Brokkoli fehlen noch.',
          topic: 'nutrition',
          state_signature: 'reis-brokkoli',
          created_at: new Date('2026-08-24T15:30:00.000Z'),
        },
        {
          content: 'Heute ist dein Training der Hebel.',
          topic: 'training',
          state_signature: 'state-1',
          created_at: new Date('2026-08-24T15:00:00.000Z'),
        },
      ],
    });

    await expect(
      coachProfileRepository.listRecentProactiveMessages('user-1')
    ).resolves.toEqual([
      {
        content: 'Reis und Brokkoli fehlen noch.',
        topic: 'nutrition',
        stateSignature: 'reis-brokkoli',
        createdAt: '2026-08-24T15:30:00.000Z',
      },
      {
        content: 'Heute ist dein Training der Hebel.',
        topic: 'training',
        stateSignature: 'state-1',
        createdAt: '2026-08-24T15:00:00.000Z',
      },
    ]);
    expect(userClient.query).toHaveBeenCalledWith(
      expect.stringContaining("metadata->>'kind' = ANY($3::text[])"),
      ['user-1', 8, ['adaptive', 'restock']]
    );
  });

  it('deduplicates a restock delivery transactionally by owner and delivery key', async () => {
    userClient.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        rows: [{ enabled: true, already_delivered: false }],
      })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({});

    await expect(
      coachProfileRepository.saveProactiveMessageIfDue(
        'user-1',
        'restock',
        '2026-08-18',
        'Reis und Brokkoli fehlen noch.',
        'reis-brokkoli',
        { topic: 'nutrition', score: 96, tone: 'push' }
      )
    ).resolves.toBe(true);

    expect(userClient.query.mock.calls[0][0]).toBe('BEGIN');
    expect(userClient.query.mock.calls[1]).toEqual([
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      ['proactive-restock:user-1:2026-08-18'],
    ]);
    expect(userClient.query.mock.calls[2][0]).toContain(
      "history.metadata->>'source' = 'proactive_coach'"
    );
    expect(userClient.query.mock.calls[2][0]).toContain(
      "history.metadata->>'kind' = 'restock'"
    );
    expect(userClient.query.mock.calls[2][0]).toContain(
      "history.metadata->>'deliveryKey' = $2"
    );
    expect(userClient.query.mock.calls[2][1]).toEqual(['user-1', '2026-08-18']);
    expect(userClient.query.mock.calls[3][0]).toContain(
      'INSERT INTO sparky_chat_history'
    );
    expect(
      JSON.parse(userClient.query.mock.calls[3][1][2] as string)
    ).toMatchObject({
      source: 'proactive_coach',
      kind: 'restock',
      localDate: '2026-08-18',
      deliveryKey: '2026-08-18',
      stateSignature: 'reis-brokkoli',
      topic: 'nutrition',
    });
    expect(userClient.query.mock.calls[4][0]).toContain(
      'INSERT INTO coach_delivery_outbox'
    );
    expect(userClient.query.mock.calls[5][0]).toBe('COMMIT');
  });

  it('rolls back a restock delivery already present in chat history', async () => {
    userClient.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        rows: [{ enabled: true, already_delivered: true }],
      })
      .mockResolvedValueOnce({});

    await expect(
      coachProfileRepository.saveProactiveMessageIfDue(
        'user-1',
        'restock',
        '2026-08-18',
        'Reis fehlt.'
      )
    ).resolves.toBe(false);

    expect(userClient.query).toHaveBeenCalledTimes(4);
    expect(userClient.query.mock.calls[3][0]).toBe('ROLLBACK');
  });

  it('claims and inserts an assistant message in one transaction', async () => {
    userClient.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'profile-1' }] })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({});

    await expect(
      coachProfileRepository.saveProactiveMessageIfDue(
        'user-1',
        'daily',
        '2026-08-18',
        'Daily summary'
      )
    ).resolves.toBe(true);

    expect(userClient.query.mock.calls[0][0]).toBe('BEGIN');
    expect(userClient.query.mock.calls[1][0]).toContain('daily_last_sent_on');
    expect(userClient.query.mock.calls[2][0]).toContain(
      'INSERT INTO sparky_chat_history'
    );
    expect(userClient.query.mock.calls[3][0]).toContain(
      'INSERT INTO coach_delivery_outbox'
    );
    expect(userClient.query.mock.calls[4][0]).toBe('COMMIT');
  });

  it('rolls back without inserting when the period was already delivered', async () => {
    userClient.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({});

    await expect(
      coachProfileRepository.saveProactiveMessageIfDue(
        'user-1',
        'weekly',
        '2026-08-23',
        'Weekly summary'
      )
    ).resolves.toBe(false);

    expect(userClient.query).toHaveBeenCalledTimes(3);
    expect(userClient.query.mock.calls[2][0]).toBe('ROLLBACK');
  });
});
