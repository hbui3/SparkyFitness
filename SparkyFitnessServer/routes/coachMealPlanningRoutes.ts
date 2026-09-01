import express, { type NextFunction, type Response } from 'express';
import { z } from 'zod';
import {
  coachMealPlanningDashboardQuerySchema,
  coachMealPlanActionRequestSchema,
  confirmCoachShoppingPurchaseRequestSchema,
  createCoachPantryItemRequestSchema,
  createCoachShoppingItemRequestSchema,
  generateCoachMealPlanRequestSchema,
  patchCoachPantryItemRequestSchema,
  patchCoachShoppingItemRequestSchema,
  replaceCoachMealPlanEntryRequestSchema,
} from '@workspace/shared';
import { authenticate } from '../middleware/authMiddleware.js';
import { CoachMealPlanningConflictError } from '../models/coachMealPlanningRepository.js';
import coachMealPlanningService, {
  CoachMealPlanningNotFoundError,
} from '../services/coachMealPlanningService.js';

const router = express.Router();
const uuidSchema = z.string().uuid();

router.use(authenticate);

/**
 * @swagger
 * tags:
 *   name: Coach Meal Planning
 *   description: Private pantry, shopping list, and dated meal-plan state for the authenticated owner.
 */

function invalidRequest(res: Response, errors: unknown): void {
  res.status(400).json({ message: 'Invalid meal-planning request.', errors });
}

function handleDomainError(
  error: unknown,
  res: Response,
  next: NextFunction
): void {
  if (error instanceof CoachMealPlanningNotFoundError) {
    res.status(404).json({ message: error.message });
    return;
  }
  if (error instanceof CoachMealPlanningConflictError) {
    res.status(409).json({
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
    });
    return;
  }
  next(error);
}

router.get('/dashboard', async (req, res, next) => {
  try {
    const parsed = coachMealPlanningDashboardQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      invalidRequest(res, parsed.error.flatten());
      return;
    }
    res.json(
      await coachMealPlanningService.getDashboard(
        req.authenticatedUserId,
        parsed.data.startDate,
        parsed.data.days
      )
    );
  } catch (error) {
    handleDomainError(error, res, next);
  }
});

router.post('/pantry', async (req, res, next) => {
  try {
    const parsed = createCoachPantryItemRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      invalidRequest(res, parsed.error.flatten());
      return;
    }
    const id = await coachMealPlanningService.createPantryItem(
      req.authenticatedUserId,
      parsed.data
    );
    res.status(201).json({ id });
  } catch (error) {
    handleDomainError(error, res, next);
  }
});

router.patch('/pantry/:id', async (req, res, next) => {
  try {
    const id = uuidSchema.safeParse(req.params.id);
    const body = patchCoachPantryItemRequestSchema.safeParse(req.body);
    if (!id.success || !body.success) {
      invalidRequest(res, {
        id: id.success ? undefined : id.error.flatten(),
        body: body.success ? undefined : body.error.flatten(),
      });
      return;
    }
    await coachMealPlanningService.updatePantryItem(
      req.authenticatedUserId,
      id.data,
      body.data
    );
    res.status(204).send();
  } catch (error) {
    handleDomainError(error, res, next);
  }
});

router.delete('/pantry/:id', async (req, res, next) => {
  try {
    const id = uuidSchema.safeParse(req.params.id);
    if (!id.success) {
      invalidRequest(res, id.error.flatten());
      return;
    }
    await coachMealPlanningService.removePantryItem(
      req.authenticatedUserId,
      id.data
    );
    res.status(204).send();
  } catch (error) {
    handleDomainError(error, res, next);
  }
});

router.post('/shopping/items', async (req, res, next) => {
  try {
    const parsed = createCoachShoppingItemRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      invalidRequest(res, parsed.error.flatten());
      return;
    }
    const id = await coachMealPlanningService.createShoppingItem(
      req.authenticatedUserId,
      parsed.data
    );
    res.status(201).json({ id });
  } catch (error) {
    handleDomainError(error, res, next);
  }
});

router.patch('/shopping/items/:id', async (req, res, next) => {
  try {
    const id = uuidSchema.safeParse(req.params.id);
    const body = patchCoachShoppingItemRequestSchema.safeParse(req.body);
    if (!id.success || !body.success) {
      invalidRequest(res, {
        id: id.success ? undefined : id.error.flatten(),
        body: body.success ? undefined : body.error.flatten(),
      });
      return;
    }
    await coachMealPlanningService.updateShoppingItem(
      req.authenticatedUserId,
      id.data,
      body.data
    );
    res.status(204).send();
  } catch (error) {
    handleDomainError(error, res, next);
  }
});

router.delete('/shopping/items/:id', async (req, res, next) => {
  try {
    const id = uuidSchema.safeParse(req.params.id);
    if (!id.success) {
      invalidRequest(res, id.error.flatten());
      return;
    }
    await coachMealPlanningService.removeShoppingItem(
      req.authenticatedUserId,
      id.data
    );
    res.status(204).send();
  } catch (error) {
    handleDomainError(error, res, next);
  }
});

router.post('/shopping/purchase', async (req, res, next) => {
  try {
    const parsed = confirmCoachShoppingPurchaseRequestSchema.safeParse(
      req.body
    );
    if (!parsed.success) {
      invalidRequest(res, parsed.error.flatten());
      return;
    }
    await coachMealPlanningService.confirmShoppingPurchase(
      req.authenticatedUserId,
      parsed.data
    );
    res.status(204).send();
  } catch (error) {
    handleDomainError(error, res, next);
  }
});

router.post('/plan/generate', async (req, res, next) => {
  try {
    const parsed = generateCoachMealPlanRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      invalidRequest(res, parsed.error.flatten());
      return;
    }
    res.json(
      await coachMealPlanningService.generateMealPlan(
        req.authenticatedUserId,
        parsed.data
      )
    );
  } catch (error) {
    handleDomainError(error, res, next);
  }
});

router.post('/plan/:id/action', async (req, res, next) => {
  try {
    const id = uuidSchema.safeParse(req.params.id);
    const body = coachMealPlanActionRequestSchema.safeParse(req.body);
    if (!id.success || !body.success) {
      invalidRequest(res, {
        id: id.success ? undefined : id.error.flatten(),
        body: body.success ? undefined : body.error.flatten(),
      });
      return;
    }
    await coachMealPlanningService.applyMealPlanAction(
      req.authenticatedUserId,
      id.data,
      body.data
    );
    res.status(204).send();
  } catch (error) {
    handleDomainError(error, res, next);
  }
});

router.post('/plan/:id/replace', async (req, res, next) => {
  try {
    const id = uuidSchema.safeParse(req.params.id);
    const body = replaceCoachMealPlanEntryRequestSchema.safeParse(req.body);
    if (!id.success || !body.success) {
      invalidRequest(res, {
        id: id.success ? undefined : id.error.flatten(),
        body: body.success ? undefined : body.error.flatten(),
      });
      return;
    }
    const entryId = await coachMealPlanningService.replaceMealPlanEntry(
      req.authenticatedUserId,
      id.data,
      body.data
    );
    res.json({ entryId });
  } catch (error) {
    handleDomainError(error, res, next);
  }
});

export default router;
