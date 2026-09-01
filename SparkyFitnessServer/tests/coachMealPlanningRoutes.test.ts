import express, {
  type NextFunction,
  type Request,
  type Response,
} from 'express';
// @ts-expect-error TS(7016): supertest has no declaration in this workspace.
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const serviceMocks = vi.hoisted(() => ({
  getDashboard: vi.fn(),
  createPantryItem: vi.fn(),
  updatePantryItem: vi.fn(),
  removePantryItem: vi.fn(),
  createShoppingItem: vi.fn(),
  updateShoppingItem: vi.fn(),
  removeShoppingItem: vi.fn(),
  confirmShoppingPurchase: vi.fn(),
  generateMealPlan: vi.fn(),
  applyMealPlanAction: vi.fn(),
  replaceMealPlanEntry: vi.fn(),
}));

vi.mock('../middleware/authMiddleware.js', () => ({
  authenticate: (req: Request, _res: Response, next: NextFunction) => {
    req.userId = 'delegated-user';
    req.authenticatedUserId = 'owner-user';
    next();
  },
}));

vi.mock('../services/coachMealPlanningService.js', () => ({
  CoachMealPlanningNotFoundError: class CoachMealPlanningNotFoundError extends Error {},
  default: serviceMocks,
}));

vi.mock('../models/coachMealPlanningRepository.js', () => ({
  CoachMealPlanningConflictError: class CoachMealPlanningConflictError extends Error {
    readonly details: Record<string, unknown> | null;

    constructor(
      message: string,
      details: Record<string, unknown> | null = null
    ) {
      super(message);
      this.details = details;
    }
  },
}));

import { CoachMealPlanningConflictError } from '../models/coachMealPlanningRepository.js';
import coachMealPlanningRoutes from '../routes/coachMealPlanningRoutes.js';
import coachMealPlanningService, {
  CoachMealPlanningNotFoundError,
} from '../services/coachMealPlanningService.js';

const ITEM_ID = '11111111-1111-4111-8111-111111111111';
const OPERATION_ID = '22222222-2222-4222-8222-222222222222';
const PLAN_ID = '33333333-3333-4333-8333-333333333333';

const app = express();
app.use(express.json());
app.use('/api/coach-meal-planning', coachMealPlanningRoutes);
app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
  res.status(500).json({ error: error.message });
});

describe('coach meal-planning routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(coachMealPlanningService.getDashboard).mockResolvedValue({
      startDate: '2026-09-01',
      days: 3,
      pantry: [],
      shoppingList: null,
      planEntries: [],
      mealCatalog: [],
      warnings: [],
      lastUpdatedAt: '2026-09-01T12:00:00.000Z',
    });
    vi.mocked(coachMealPlanningService.createPantryItem).mockResolvedValue(
      ITEM_ID
    );
    vi.mocked(coachMealPlanningService.createShoppingItem).mockResolvedValue(
      ITEM_ID
    );
    vi.mocked(coachMealPlanningService.generateMealPlan).mockResolvedValue({
      planId: PLAN_ID,
      addedEntries: 3,
      warnings: [],
    });
    vi.mocked(coachMealPlanningService.replaceMealPlanEntry).mockResolvedValue(
      ITEM_ID
    );
  });

  it('uses the authenticated owner for every API suffix', async () => {
    const responses = await Promise.all([
      request(app).get(
        '/api/coach-meal-planning/dashboard?startDate=2026-09-01&days=3'
      ),
      request(app).post('/api/coach-meal-planning/pantry').send({
        name: 'Reis',
        quantity: 500,
        minimumQuantity: 100,
        unit: 'g',
        category: 'pantry',
      }),
      request(app).patch(`/api/coach-meal-planning/pantry/${ITEM_ID}`).send({
        quantity: 450,
      }),
      request(app).delete(`/api/coach-meal-planning/pantry/${ITEM_ID}`),
      request(app).post('/api/coach-meal-planning/shopping/items').send({
        name: 'Brokkoli',
        requiredQuantity: 750,
        unit: 'g',
        category: 'frozen',
      }),
      request(app)
        .patch(`/api/coach-meal-planning/shopping/items/${ITEM_ID}`)
        .send({ requiredQuantity: 500 }),
      request(app).delete(`/api/coach-meal-planning/shopping/items/${ITEM_ID}`),
      request(app)
        .post('/api/coach-meal-planning/shopping/purchase')
        .send({
          operationId: OPERATION_ID,
          purchases: [{ itemId: ITEM_ID, quantity: 250 }],
        }),
      request(app).post('/api/coach-meal-planning/plan/generate').send({
        operationId: OPERATION_ID,
        startDate: '2026-09-01',
        days: 3,
        replaceExisting: false,
      }),
      request(app)
        .post(`/api/coach-meal-planning/plan/${ITEM_ID}/action`)
        .send({
          operationId: OPERATION_ID,
          action: 'eaten_out',
          notes: 'Restaurant',
        }),
      request(app)
        .post(`/api/coach-meal-planning/plan/${ITEM_ID}/replace`)
        .send({ operationId: OPERATION_ID, recipeKey: 'tofu-rice-bowl' }),
    ]);

    expect(
      responses.map(({ statusCode }: { statusCode: number }) => statusCode)
    ).toEqual([200, 201, 204, 204, 201, 204, 204, 204, 200, 204, 200]);
    expect(coachMealPlanningService.getDashboard).toHaveBeenCalledWith(
      'owner-user',
      '2026-09-01',
      3
    );
    expect(coachMealPlanningService.createPantryItem).toHaveBeenCalledWith(
      'owner-user',
      expect.objectContaining({ name: 'Reis', quantity: 500 })
    );
    expect(coachMealPlanningService.updatePantryItem).toHaveBeenCalledWith(
      'owner-user',
      ITEM_ID,
      { quantity: 450 }
    );
    expect(coachMealPlanningService.removePantryItem).toHaveBeenCalledWith(
      'owner-user',
      ITEM_ID
    );
    expect(coachMealPlanningService.createShoppingItem).toHaveBeenCalledWith(
      'owner-user',
      expect.objectContaining({ name: 'Brokkoli', requiredQuantity: 750 })
    );
    expect(coachMealPlanningService.updateShoppingItem).toHaveBeenCalledWith(
      'owner-user',
      ITEM_ID,
      { requiredQuantity: 500 }
    );
    expect(coachMealPlanningService.removeShoppingItem).toHaveBeenCalledWith(
      'owner-user',
      ITEM_ID
    );
    expect(
      coachMealPlanningService.confirmShoppingPurchase
    ).toHaveBeenCalledWith('owner-user', {
      operationId: OPERATION_ID,
      purchases: [{ itemId: ITEM_ID, quantity: 250 }],
    });
    expect(coachMealPlanningService.generateMealPlan).toHaveBeenCalledWith(
      'owner-user',
      {
        operationId: OPERATION_ID,
        startDate: '2026-09-01',
        days: 3,
        replaceExisting: false,
      }
    );
    expect(coachMealPlanningService.applyMealPlanAction).toHaveBeenCalledWith(
      'owner-user',
      ITEM_ID,
      {
        operationId: OPERATION_ID,
        action: 'eaten_out',
        notes: 'Restaurant',
      }
    );
    expect(coachMealPlanningService.replaceMealPlanEntry).toHaveBeenCalledWith(
      'owner-user',
      ITEM_ID,
      { operationId: OPERATION_ID, recipeKey: 'tofu-rice-bowl' }
    );
  });

  it.each([
    {
      name: 'dashboard query',
      method: 'get' as const,
      path: '/api/coach-meal-planning/dashboard?startDate=01.09.2026&days=8',
      body: undefined,
      service: serviceMocks.getDashboard,
    },
    {
      name: 'pantry body',
      method: 'post' as const,
      path: '/api/coach-meal-planning/pantry',
      body: { name: 'Reis', quantity: -1, unit: 'g', category: 'pantry' },
      service: serviceMocks.createPantryItem,
    },
    {
      name: 'empty pantry patch',
      method: 'patch' as const,
      path: `/api/coach-meal-planning/pantry/${ITEM_ID}`,
      body: {},
      service: serviceMocks.updatePantryItem,
    },
    {
      name: 'shopping purchase',
      method: 'post' as const,
      path: '/api/coach-meal-planning/shopping/purchase',
      body: { operationId: OPERATION_ID, purchases: [] },
      service: serviceMocks.confirmShoppingPurchase,
    },
    {
      name: 'plan generation',
      method: 'post' as const,
      path: '/api/coach-meal-planning/plan/generate',
      body: {
        operationId: OPERATION_ID,
        startDate: '2026-09-01',
        days: 0,
        replaceExisting: false,
      },
      service: serviceMocks.generateMealPlan,
    },
    {
      name: 'plan action',
      method: 'post' as const,
      path: `/api/coach-meal-planning/plan/${ITEM_ID}/action`,
      body: { operationId: OPERATION_ID, action: 'ordered' },
      service: serviceMocks.applyMealPlanAction,
    },
    {
      name: 'replacement',
      method: 'post' as const,
      path: `/api/coach-meal-planning/plan/${ITEM_ID}/replace`,
      body: { operationId: OPERATION_ID, recipeKey: '' },
      service: serviceMocks.replaceMealPlanEntry,
    },
  ])(
    'rejects an invalid $name before calling the service',
    async (testCase) => {
      const pending = request(app)[testCase.method](testCase.path);
      const response =
        testCase.body === undefined
          ? await pending
          : await pending.send(testCase.body);

      expect(response.statusCode).toBe(400);
      expect(testCase.service).not.toHaveBeenCalled();
    }
  );

  it('rejects malformed path ids before calling the service', async () => {
    const responses = await Promise.all([
      request(app)
        .patch('/api/coach-meal-planning/shopping/items/not-a-uuid')
        .send({ requiredQuantity: 200 }),
      request(app).delete('/api/coach-meal-planning/pantry/not-a-uuid'),
      request(app)
        .post('/api/coach-meal-planning/plan/not-a-uuid/action')
        .send({ operationId: OPERATION_ID, action: 'prepared' }),
    ]);

    expect(
      responses.every(
        ({ statusCode }: { statusCode: number }) => statusCode === 400
      )
    ).toBe(true);
    expect(coachMealPlanningService.updateShoppingItem).not.toHaveBeenCalled();
    expect(coachMealPlanningService.removePantryItem).not.toHaveBeenCalled();
    expect(coachMealPlanningService.applyMealPlanAction).not.toHaveBeenCalled();
  });

  it('maps missing owner data to 404', async () => {
    vi.mocked(coachMealPlanningService.updatePantryItem).mockRejectedValue(
      new CoachMealPlanningNotFoundError('Pantry item not found.')
    );

    const response = await request(app)
      .patch(`/api/coach-meal-planning/pantry/${ITEM_ID}`)
      .send({ quantity: 10 });

    expect(response.statusCode).toBe(404);
    expect(response.body).toEqual({ message: 'Pantry item not found.' });
  });

  it('maps stock and product conflicts to 409 with safe details', async () => {
    vi.mocked(coachMealPlanningService.applyMealPlanAction).mockRejectedValue(
      new CoachMealPlanningConflictError('Not enough stock.', {
        shortages: [{ ingredientKey: 'reis', missingQuantity: 80 }],
      })
    );

    const response = await request(app)
      .post(`/api/coach-meal-planning/plan/${ITEM_ID}/action`)
      .send({ operationId: OPERATION_ID, action: 'prepared' });

    expect(response.statusCode).toBe(409);
    expect(response.body).toEqual({
      message: 'Not enough stock.',
      details: {
        shortages: [{ ingredientKey: 'reis', missingQuantity: 80 }],
      },
    });
  });
});
