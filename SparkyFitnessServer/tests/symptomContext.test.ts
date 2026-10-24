import { vi, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error supertest has no bundled types in this project
import request from 'supertest';
import express from 'express';

vi.mock('../db/poolManager.js', () => ({ getClient: vi.fn() }));

vi.mock('../models/symptomContextRepository.js', () => ({
  default: {
    getEntryAnchors: vi.fn(),
    getFoodNames: vi.fn(),
    getSteps: vi.fn(),
    getWorkoutNames: vi.fn(),
    getPreviousSleep: vi.fn(),
    getDoses: vi.fn(),
  },
}));

vi.mock('../models/measurementRepository.js', () => ({
  default: { getWaterIntakesByDates: vi.fn() },
}));

vi.mock('../services/cycleService.js', () => ({
  default: { getOverview: vi.fn() },
}));

vi.mock('../utils/timezoneLoader.js', () => ({
  loadUserTimezone: vi.fn().mockResolvedValue('UTC'),
}));

vi.mock('../middleware/checkPermissionMiddleware.js', () => ({
  default: vi.fn(
    () =>
      (
        _req: express.Request,
        _res: express.Response,
        next: express.NextFunction
      ) =>
        next()
  ),
}));

vi.mock('../middleware/onBehalfOfMiddleware.js', () => ({
  default: (
    _req: express.Request,
    _res: express.Response,
    next: express.NextFunction
  ) => next(),
}));

import symptomContextRepository from '../models/symptomContextRepository.js';
import measurementRepository from '../models/measurementRepository.js';
import cycleService from '../services/cycleService.js';
import symptomContextService from '../services/symptomContextService.js';
import symptomRoutes from '../routes/v2/symptomRoutes.js';
import errorHandler from '../middleware/errorHandler.js';

const repo = vi.mocked(symptomContextRepository);
const water = vi.mocked(measurementRepository.getWaterIntakesByDates);
const overview = vi.mocked(cycleService.getOverview);

const A = '550e8400-e29b-41d4-a716-446655440000';
const B = '660e8400-e29b-41d4-a716-446655440001';

const anchor = (
  id: string,
  entry_date: string,
  at: string,
  ended_at: string | null = null,
  started_at: string | null = at
) => ({
  id,
  entry_date,
  at: new Date(at),
  started_at: started_at ? new Date(started_at) : null,
  ended_at: ended_at ? new Date(ended_at) : null,
});

beforeEach(() => {
  vi.clearAllMocks();
  repo.getEntryAnchors.mockResolvedValue([]);
  repo.getFoodNames.mockResolvedValue([]);
  repo.getSteps.mockResolvedValue([]);
  repo.getWorkoutNames.mockResolvedValue([]);
  repo.getPreviousSleep.mockResolvedValue([]);
  repo.getDoses.mockResolvedValue([]);
  water.mockResolvedValue([]);
  overview.mockResolvedValue({
    settings: { enabled: false },
    phase: 'unknown',
    cycleDay: null,
  } as never);
});

describe('getEpisodeContext', () => {
  it('returns nothing, and reads nothing else, when no entry matches', async () => {
    expect(
      await symptomContextService.getEpisodeContext('u', [A], { isOwner: true })
    ).toEqual([]);
    expect(repo.getFoodNames).not.toHaveBeenCalled();
    expect(water).not.toHaveBeenCalled();
  });

  it('reports the day before and the day of, with names only and nulls where nothing was logged', async () => {
    repo.getEntryAnchors.mockResolvedValue([
      anchor(A, '2026-09-29', '2026-09-29T09:00:00Z'),
    ]);
    repo.getFoodNames.mockResolvedValue([
      { entry_date: '2026-09-28', food_name: 'Porridge' },
      { entry_date: '2026-09-28', food_name: 'Red wine' },
      { entry_date: '2026-09-29', food_name: 'Toast' },
    ]);
    water.mockResolvedValue([{ entry_date: '2026-09-28', water_ml: '1200' }]);
    repo.getSteps.mockResolvedValue([
      { entry_date: '2026-09-29', steps: 6300 },
    ]);
    repo.getWorkoutNames.mockResolvedValue([
      { entry_date: '2026-09-28', exercise_name: 'Run' },
      { entry_date: '2026-09-28', exercise_name: 'Run' },
    ]);

    const [context] = await symptomContextService.getEpisodeContext('u', [A], {
      isOwner: false,
    });
    expect(context?.days).toEqual([
      {
        date: '2026-09-28',
        label: 'day_before',
        foods: ['Porridge', 'Red wine'],
        water_ml: 1200,
        steps: null,
        workouts: ['Run'],
      },
      {
        date: '2026-09-29',
        label: 'day_of',
        foods: ['Toast'],
        water_ml: null,
        steps: 6300,
        workouts: [],
      },
    ]);
  });

  it('reads each domain once for any number of entries', async () => {
    repo.getEntryAnchors.mockResolvedValue([
      anchor(A, '2026-09-29', '2026-09-29T09:00:00Z'),
      anchor(B, '2026-09-17', '2026-09-17T14:00:00Z'),
    ]);
    await symptomContextService.getEpisodeContext('u', [A, B], {
      isOwner: false,
    });
    expect(repo.getFoodNames).toHaveBeenCalledTimes(1);
    expect(repo.getFoodNames).toHaveBeenCalledWith(
      'u',
      '2026-09-16',
      '2026-09-29'
    );
    expect(water).toHaveBeenCalledTimes(1);
    expect(water.mock.calls[0]?.[1]).toEqual([
      '2026-09-16',
      '2026-09-17',
      '2026-09-28',
      '2026-09-29',
    ]);
    expect(repo.getPreviousSleep).toHaveBeenCalledTimes(1);
    expect(repo.getDoses).toHaveBeenCalledTimes(1);
  });

  it('crosses a month boundary when finding the day before', async () => {
    repo.getEntryAnchors.mockResolvedValue([
      anchor(A, '2026-10-01', '2026-10-01T09:00:00Z'),
    ]);
    const [context] = await symptomContextService.getEpisodeContext('u', [A], {
      isOwner: false,
    });
    expect(context?.days.map((d) => d.date)).toEqual([
      '2026-09-30',
      '2026-10-01',
    ]);
  });

  it('reports the sleep that ended before the entry, in whole minutes', async () => {
    repo.getEntryAnchors.mockResolvedValue([
      anchor(A, '2026-09-29', '2026-09-29T09:00:00Z'),
    ]);
    repo.getPreviousSleep.mockResolvedValue([
      {
        entry_id: A,
        bedtime: new Date('2026-09-28T23:30:00Z'),
        wake_time: new Date('2026-09-29T04:40:00Z'),
        asleep_seconds: 18570,
      },
    ]);
    const [context] = await symptomContextService.getEpisodeContext('u', [A], {
      isOwner: false,
    });
    expect(context?.sleep).toEqual({
      minutes: 310,
      bedtime: '2026-09-28T23:30:00.000Z',
      wake_time: '2026-09-29T04:40:00.000Z',
    });
  });

  it('has no sleep when none ended before the entry', async () => {
    repo.getEntryAnchors.mockResolvedValue([
      anchor(A, '2026-09-29', '2026-09-29T09:00:00Z'),
    ]);
    const [context] = await symptomContextService.getEpisodeContext('u', [A], {
      isOwner: false,
    });
    expect(context?.sleep).toBeNull();
  });

  it('lists doses only for the entry they fall inside, with their dose', async () => {
    repo.getEntryAnchors.mockResolvedValue([
      anchor(A, '2026-09-29', '2026-09-29T09:00:00Z'),
      anchor(B, '2026-09-17', '2026-09-17T14:00:00Z'),
    ]);
    repo.getDoses.mockResolvedValue([
      {
        entry_id: A,
        med_name_snapshot: 'Sumatriptan',
        dose_amount_snapshot: 50,
        dose_unit_snapshot: 'mg',
        taken_at: new Date('2026-09-29T09:50:00Z'),
      },
      {
        entry_id: A,
        med_name_snapshot: 'Water tablet',
        dose_amount_snapshot: null,
        dose_unit_snapshot: null,
        taken_at: new Date('2026-09-29T10:00:00Z'),
      },
      {
        entry_id: A,
        med_name_snapshot: null,
        dose_amount_snapshot: 1,
        dose_unit_snapshot: 'pill',
        taken_at: new Date('2026-09-29T10:05:00Z'),
      },
    ]);
    const contexts = await symptomContextService.getEpisodeContext(
      'u',
      [A, B],
      { isOwner: false }
    );
    expect(contexts[0]?.medications).toEqual([
      {
        name: 'Sumatriptan',
        dose: '50 mg',
        taken_at: '2026-09-29T09:50:00.000Z',
      },
      {
        name: 'Water tablet',
        dose: null,
        taken_at: '2026-09-29T10:00:00.000Z',
      },
    ]);
    expect(contexts[1]?.medications).toEqual([]);
  });

  it('runs an ended episode’s dose window to its end and an ongoing one to now', async () => {
    repo.getEntryAnchors.mockResolvedValue([
      anchor(A, '2026-09-29', '2026-09-29T09:00:00Z', '2026-09-29T11:00:00Z'),
      anchor(B, '2026-09-29', '2026-09-29T09:00:00Z'),
    ]);
    const before = Date.now();
    await symptomContextService.getEpisodeContext('u', [A, B], {
      isOwner: false,
    });
    const [, windows] = repo.getDoses.mock.calls[0] as [
      string,
      Array<{ id: string; from: Date; to: Date }>,
    ];
    expect(windows[0]?.to.toISOString()).toBe('2026-09-29T11:00:00.000Z');
    expect(windows[1]?.to.getTime()).toBeGreaterThanOrEqual(before);
  });

  it('does not query medication dose windows for quick logs with no started_at', async () => {
    repo.getEntryAnchors.mockResolvedValue([
      anchor(A, '2026-09-29', '2026-09-29T09:00:00Z', null, null),
    ]);
    await symptomContextService.getEpisodeContext('u', [A], {
      isOwner: false,
    });
    expect(repo.getDoses).toHaveBeenCalledWith('u', []);
  });

  it('keeps a long day’s food list to a readable length', async () => {
    repo.getEntryAnchors.mockResolvedValue([
      anchor(A, '2026-09-29', '2026-09-29T09:00:00Z'),
    ]);
    repo.getFoodNames.mockResolvedValue(
      Array.from({ length: 45 }, (_, i) => ({
        entry_date: '2026-09-29',
        food_name: `Food ${i}`,
      }))
    );
    const [context] = await symptomContextService.getEpisodeContext('u', [A], {
      isOwner: false,
    });
    expect(context?.days[1]?.foods).toHaveLength(30);
    expect(context?.days[1]?.foods[0]).toBe('Food 0');
  });
});

describe('cycle context', () => {
  const owner = { isOwner: true };

  beforeEach(() => {
    repo.getEntryAnchors.mockResolvedValue([
      anchor(A, '2026-09-29', '2026-09-29T09:00:00Z'),
    ]);
  });

  it('is never looked up for anyone but the owner', async () => {
    overview.mockResolvedValue({
      settings: { enabled: true },
      phase: 'luteal',
      cycleDay: 22,
    } as never);
    const [context] = await symptomContextService.getEpisodeContext('u', [A], {
      isOwner: false,
    });
    expect(overview).not.toHaveBeenCalled();
    expect(context?.cycle).toBeNull();
  });

  it('reports the phase and day for the owner when tracking is on', async () => {
    overview.mockResolvedValue({
      settings: { enabled: true },
      phase: 'luteal',
      cycleDay: 22,
    } as never);
    const [context] = await symptomContextService.getEpisodeContext(
      'u',
      [A],
      owner
    );
    expect(context?.cycle).toEqual({ phase: 'luteal', cycle_day: 22 });
    expect(overview).toHaveBeenCalledWith(
      'u',
      expect.any(String),
      '2026-09-29'
    );
  });

  it('stays out of it when cycle tracking is off or the phase is unknown', async () => {
    overview.mockResolvedValue({
      settings: { enabled: false },
      phase: 'luteal',
      cycleDay: 22,
    } as never);
    expect(
      (await symptomContextService.getEpisodeContext('u', [A], owner))[0]?.cycle
    ).toBeNull();
    overview.mockResolvedValue({
      settings: { enabled: true },
      phase: 'unknown',
      cycleDay: null,
    } as never);
    expect(
      (await symptomContextService.getEpisodeContext('u', [A], owner))[0]?.cycle
    ).toBeNull();
  });

  it('asks once per distinct day', async () => {
    repo.getEntryAnchors.mockResolvedValue([
      anchor(A, '2026-09-29', '2026-09-29T09:00:00Z'),
      anchor(B, '2026-09-29', '2026-09-29T18:00:00Z'),
    ]);
    await symptomContextService.getEpisodeContext('u', [A, B], owner);
    expect(overview).toHaveBeenCalledTimes(1);
  });

  it('does not let a failed cycle lookup sink the rest of the context', async () => {
    overview.mockRejectedValue(new Error('boom'));
    repo.getFoodNames.mockResolvedValue([
      { entry_date: '2026-09-29', food_name: 'Toast' },
    ]);
    const [context] = await symptomContextService.getEpisodeContext(
      'u',
      [A],
      owner
    );
    expect(context?.cycle).toBeNull();
    expect(context?.days[1]?.foods).toEqual(['Toast']);
  });
});

describe('GET /api/v2/symptoms/entries/context', () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.userId = 'owner-1';
    const actor = req.headers['x-actor'];
    if (typeof actor === 'string') req.originalUserId = actor;
    next();
  });
  app.use('/api/v2/symptoms', symptomRoutes);
  app.use(errorHandler);

  const call = (query: string, actor?: string) => {
    const req = request(app).get(`/api/v2/symptoms/entries/context${query}`);
    return actor ? req.set('x-actor', actor) : req;
  };

  it('is not mistaken for an entry id', async () => {
    const spy = vi
      .spyOn(symptomContextService, 'getEpisodeContext')
      .mockResolvedValue([]);
    const res = await call(`?ids=${A}`);
    expect(res.statusCode).toBe(200);
    expect(spy).toHaveBeenCalledWith('owner-1', [A], { isOwner: true });
    spy.mockRestore();
  });

  it('parses several ids and trims blanks', async () => {
    const spy = vi
      .spyOn(symptomContextService, 'getEpisodeContext')
      .mockResolvedValue([]);
    await call(`?ids=${A}, ${B},`);
    expect(spy.mock.calls[0]?.[1]).toEqual([A, B]);
    spy.mockRestore();
  });

  it('treats a delegate as not the owner, so cycle data stays out', async () => {
    const spy = vi
      .spyOn(symptomContextService, 'getEpisodeContext')
      .mockResolvedValue([]);
    await call(`?ids=${A}`, 'delegate-1');
    expect(spy).toHaveBeenCalledWith('owner-1', [A], { isOwner: false });
    spy.mockRestore();
  });

  it('treats the owner acting as themselves as the owner', async () => {
    const spy = vi
      .spyOn(symptomContextService, 'getEpisodeContext')
      .mockResolvedValue([]);
    await call(`?ids=${A}`, 'owner-1');
    expect(spy).toHaveBeenCalledWith('owner-1', [A], { isOwner: true });
    spy.mockRestore();
  });

  it.each([
    ['no ids', ''],
    ['an empty list', '?ids='],
    ['a malformed id', '?ids=not-a-uuid'],
    ['one bad id among good ones', `?ids=${A},nope`],
  ])('rejects %s', async (_name, query) => {
    const res = await call(query);
    expect(res.statusCode).toBe(400);
  });

  it('rejects more than 50 ids', async () => {
    const ids = Array.from(
      { length: 51 },
      (_, i) => `550e8400-e29b-41d4-a716-${String(i).padStart(12, '0')}`
    ).join(',');
    const res = await call(`?ids=${ids}`);
    expect(res.statusCode).toBe(400);
  });

  it('accepts exactly 50', async () => {
    const spy = vi
      .spyOn(symptomContextService, 'getEpisodeContext')
      .mockResolvedValue([]);
    const ids = Array.from(
      { length: 50 },
      (_, i) => `550e8400-e29b-41d4-a716-${String(i).padStart(12, '0')}`
    ).join(',');
    const res = await call(`?ids=${ids}`);
    expect(res.statusCode).toBe(200);
    spy.mockRestore();
  });
});
