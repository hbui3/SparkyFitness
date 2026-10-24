import { vi, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error TS7016 supertest typing
import request from 'supertest';
import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import errorHandler from '../middleware/errorHandler.js';
import mindfulnessRoutes from '../routes/v2/mindfulnessRoutes.js';
import * as mindfulnessRepo from '../models/mindfulnessRepository.js';

vi.mock('../models/mindfulnessRepository.js', () => ({
  createMindfulnessSession: vi.fn(),
  getMindfulnessSessionsByDate: vi.fn(),
  getMindfulnessSessionsRange: vi.fn(),
  getMindfulnessSessionById: vi.fn(),
  updateMindfulnessSession: vi.fn(),
  deleteMindfulnessSession: vi.fn(),
  getMindfulnessDaySummary: vi.fn(),
}));

vi.mock('../middleware/authMiddleware.js', () => ({
  authenticate: (
    req: express.Request,
    _res: express.Response,
    next: express.NextFunction
  ) => {
    req.userId = 'test-user-id';
    req.authenticatedUserId = 'test-user-id';
    next();
  },
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

const app = express();
app.use(express.json());
app.use('/api/v2/mindfulness', mindfulnessRoutes);
app.use(errorHandler);

const VALID_ID = uuidv4();

describe('Mindfulness Routes (v2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/v2/mindfulness/day-summary', () => {
    it('returns 400 when date is invalid or missing', async () => {
      const res = await request(app).get(
        '/api/v2/mindfulness/day-summary?date=invalid'
      );
      expect(res.statusCode).toBe(400);
    });

    it('returns day summary for valid date', async () => {
      const mockSummary = {
        entry_date: '2026-10-05',
        total_duration_seconds: 900,
        total_mindful_minutes: 15,
        session_count: 1,
        sessions: [],
      };
      vi.mocked(mindfulnessRepo.getMindfulnessDaySummary).mockResolvedValue(
        mockSummary
      );

      const res = await request(app).get(
        '/api/v2/mindfulness/day-summary?date=2026-10-05'
      );
      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual(mockSummary);
      expect(mindfulnessRepo.getMindfulnessDaySummary).toHaveBeenCalledWith(
        'test-user-id',
        '2026-10-05',
        'test-user-id'
      );
    });
  });

  describe('GET /api/v2/mindfulness/entries', () => {
    it('returns entries by single date', async () => {
      const mockEntries = [
        {
          id: VALID_ID,
          user_id: 'test-user-id',
          entry_date: '2026-10-05',
          start_time: '2026-10-05T08:00:00.000Z',
          end_time: '2026-10-05T08:15:00.000Z',
          duration_seconds: 900,
          session_type: 'meditation',
          provider: 'manual',
          external_id: null,
          heart_rate_avg: 65,
          heart_rate_start: 72,
          heart_rate_end: 60,
          hrv_rmssd: 55,
          stress_level_start: 50,
          stress_level_end: 25,
          mood_entry_id: null,
          notes: 'Peaceful morning session',
          created_at: '2026-10-05T08:15:00.000Z',
          updated_at: '2026-10-05T08:15:00.000Z',
        },
      ];
      vi.mocked(mindfulnessRepo.getMindfulnessSessionsByDate).mockResolvedValue(
        mockEntries
      );

      const res = await request(app).get(
        '/api/v2/mindfulness/entries?date=2026-10-05'
      );
      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual(mockEntries);
    });

    it('returns entries by date range', async () => {
      vi.mocked(mindfulnessRepo.getMindfulnessSessionsRange).mockResolvedValue(
        []
      );

      const res = await request(app).get(
        '/api/v2/mindfulness/entries?startDate=2026-10-01&endDate=2026-10-05'
      );
      expect(res.statusCode).toBe(200);
      expect(mindfulnessRepo.getMindfulnessSessionsRange).toHaveBeenCalledWith(
        'test-user-id',
        '2026-10-01',
        '2026-10-05',
        'test-user-id'
      );
    });

    it('returns 400 when no parameters are provided', async () => {
      const res = await request(app).get('/api/v2/mindfulness/entries');
      expect(res.statusCode).toBe(400);
    });
  });

  describe('GET /api/v2/mindfulness/entries/:id', () => {
    it('returns 404 when session not found', async () => {
      vi.mocked(mindfulnessRepo.getMindfulnessSessionById).mockResolvedValue(
        null
      );

      const res = await request(app).get(
        `/api/v2/mindfulness/entries/${VALID_ID}`
      );
      expect(res.statusCode).toBe(404);
    });

    it('returns session when found', async () => {
      const mockSession = {
        id: VALID_ID,
        user_id: 'test-user-id',
        entry_date: '2026-10-05',
        start_time: null,
        end_time: null,
        duration_seconds: 300,
        session_type: 'breathwork',
        provider: 'manual',
        external_id: null,
        heart_rate_avg: null,
        heart_rate_start: null,
        heart_rate_end: null,
        hrv_rmssd: null,
        stress_level_start: null,
        stress_level_end: null,
        mood_entry_id: null,
        notes: null,
        created_at: null,
        updated_at: null,
      };
      vi.mocked(mindfulnessRepo.getMindfulnessSessionById).mockResolvedValue(
        mockSession
      );

      const res = await request(app).get(
        `/api/v2/mindfulness/entries/${VALID_ID}`
      );
      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual(mockSession);
    });
  });

  describe('POST /api/v2/mindfulness/entries', () => {
    it('returns 400 on invalid payload', async () => {
      const res = await request(app)
        .post('/api/v2/mindfulness/entries')
        .send({ duration_seconds: -10 }); // negative duration
      expect(res.statusCode).toBe(400);
    });

    it('creates session and returns 201', async () => {
      const payload = {
        entry_date: '2026-10-05',
        duration_seconds: 600,
        session_type: 'meditation',
        heart_rate_avg: 64,
        heart_rate_start: 70,
        heart_rate_end: 58,
        hrv_rmssd: 48.5,
      };
      const createdSession = {
        id: VALID_ID,
        user_id: 'test-user-id',
        provider: 'manual',
        external_id: null,
        start_time: null,
        end_time: null,
        stress_level_start: null,
        stress_level_end: null,
        mood_entry_id: null,
        notes: null,
        created_at: '2026-10-05T12:00:00Z',
        updated_at: '2026-10-05T12:00:00Z',
        ...payload,
      };
      vi.mocked(mindfulnessRepo.createMindfulnessSession).mockResolvedValue(
        createdSession
      );

      const res = await request(app)
        .post('/api/v2/mindfulness/entries')
        .send(payload);

      expect(res.statusCode).toBe(201);
      expect(res.body.id).toBe(VALID_ID);
      expect(mindfulnessRepo.createMindfulnessSession).toHaveBeenCalledWith(
        'test-user-id',
        expect.objectContaining({
          entry_date: '2026-10-05',
          duration_seconds: 600,
        }),
        'test-user-id'
      );
    });
  });

  describe('PUT /api/v2/mindfulness/entries/:id', () => {
    it('updates session and returns 200', async () => {
      const updated = {
        id: VALID_ID,
        user_id: 'test-user-id',
        entry_date: '2026-10-05',
        start_time: null,
        end_time: null,
        duration_seconds: 900,
        session_type: 'meditation',
        provider: 'manual',
        external_id: null,
        heart_rate_avg: null,
        heart_rate_start: null,
        heart_rate_end: null,
        hrv_rmssd: null,
        stress_level_start: null,
        stress_level_end: null,
        mood_entry_id: null,
        notes: 'Updated notes',
        created_at: null,
        updated_at: null,
      };
      vi.mocked(mindfulnessRepo.updateMindfulnessSession).mockResolvedValue(
        updated
      );

      const res = await request(app)
        .put(`/api/v2/mindfulness/entries/${VALID_ID}`)
        .send({ duration_seconds: 900, notes: 'Updated notes' });

      expect(res.statusCode).toBe(200);
      expect(res.body.duration_seconds).toBe(900);
    });
  });

  describe('DELETE /api/v2/mindfulness/entries/:id', () => {
    it('returns 404 when session does not exist', async () => {
      vi.mocked(mindfulnessRepo.deleteMindfulnessSession).mockResolvedValue(
        false
      );

      const res = await request(app).delete(
        `/api/v2/mindfulness/entries/${VALID_ID}`
      );
      expect(res.statusCode).toBe(404);
    });

    it('returns success on delete', async () => {
      vi.mocked(mindfulnessRepo.deleteMindfulnessSession).mockResolvedValue(
        true
      );

      const res = await request(app).delete(
        `/api/v2/mindfulness/entries/${VALID_ID}`
      );
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });
});
