import express from 'express';
import { authenticate } from '../../middleware/authMiddleware.js';
import { demoGuard } from '../../middleware/demoGuardMiddleware.js';
import { auth } from '../../auth.js';
import {
  API_KEY_SCOPE_PERMISSIONS,
  createApiKeyBodySchema,
} from '@workspace/shared';
const router = express.Router();
// auth is required lazily within handlers to avoid early initialization issues during migrations
// const { auth } = require('../../auth');
/**
 * @swagger
 * /identity/user/generate-api-key:
 *   post:
 *     summary: Generate an API key for the current user
 *     tags: [Identity & Security]
 *     description: Creates a new Better Auth API key for the currently authenticated user.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *             properties:
 *               name:
 *                 type: string
 *               expiresIn:
 *                 type: number
 *                 nullable: true
 *                 description: Expiration time in seconds (default 1 year; null never expires)
 *               scope:
 *                 type: string
 *                 enum: [read, full]
 *                 default: full
 *                 description: "read: the key can only read data (GET requests and read-only MCP tools). full: the key can read and write."
 *     responses:
 *       201:
 *         description: API key generated successfully.
 *       400:
 *         description: Invalid request body.
 */
router.post(
  '/user/generate-api-key',
  authenticate,
  demoGuard,
  async (req, res, next) => {
    const parsed = createApiKeyBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid request body',
        details: parsed.error.flatten().fieldErrors,
      });
    }
    const { name, expiresIn, scope } = parsed.data;
    try {
      // @ts-expect-error TS(2339): Property 'createApiKey' does not exist on type 'In... Remove this comment to see the full error message
      const result = await auth.api.createApiKey({
        // Better Auth's server API takes endpoint fields under `body`; the
        // plugin declares /api-key/create with `body: createApiKeyBodySchema`.
        // Passed flat, every field arrived undefined.
        body: {
          // Key the credential to the authenticated actor, never the switched
          // context (req.userId). A family-sharing delegate acting on behalf of
          // another user must not be able to mint/list/delete that user's API
          // keys — doing so would let a narrow delegation (e.g. medications)
          // escalate into full account takeover. Mirrors the isAdmin check in
          // authMiddleware.ts, which also guards on the authenticated user.
          //
          // `userId` is a server-only field on the create schema, so this stays
          // an explicit binding rather than a session lookup.
          userId: req.authenticatedUserId,
          name,
          // Default 1 year when omitted; null creates a key that never expires.
          expiresIn: expiresIn === undefined ? 31536000 : expiresIn,
          // Server-only field: Better Auth refuses `permissions` from a client
          // request, which is why scoped keys are created through this route.
          permissions: API_KEY_SCOPE_PERMISSIONS[scope],
        },
      });
      res.status(201).json({
        message: 'API key generated successfully',
        apiKey: {
          id: result.id,
          key: result.key, // Only returned on creation
          name: result.name,
          createdAt: result.createdAt,
          scope,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);
/**
 * @swagger
 * /identity/user/api-key/{apiKeyId}:
 *   delete:
 *     summary: Delete an API key
 *     tags: [Identity & Security]
 *     description: Deletes a specific Better Auth API key for the currently authenticated user.
 *     parameters:
 *       - in: path
 *         name: apiKeyId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: API key deleted successfully.
 *       404:
 *         description: API key not found.
 */
router.delete(
  '/user/api-key/:apiKeyId',
  authenticate,
  demoGuard,
  async (req, res, next) => {
    const { apiKeyId } = req.params;
    try {
      // @ts-expect-error TS(2339): Property 'deleteApiKey' does not exist on type 'In... Remove this comment to see the full error message
      await auth.api.deleteApiKey({
        // Two corrections beyond the `body` wrapper: the delete schema names
        // the field `keyId` (not `apiKeyId`), and it has no `userId` field at
        // all, so the previous binding was silently dropped.
        body: { keyId: apiKeyId },
        // /api-key/delete runs behind Better Auth's sessionMiddleware, so the
        // owner comes from the session rather than a passed id. Forwarding the
        // request headers preserves the guarantee the removed `userId` was
        // there for: authMiddleware derives req.authenticatedUserId from
        // getSession({ headers: req.headers }), so the session resolves to the
        // authenticated actor — never the switched context — and a delegate
        // still cannot delete the account owner's keys.
        headers: req.headers,
      });
      res.status(200).json({ message: 'API key deleted successfully.' });
    } catch (error) {
      // @ts-expect-error TS(2571): Object is of type 'unknown'.
      if (error.message.includes('not found')) {
        return res.status(404).json({ error: 'API key not found.' });
      }
      next(error);
    }
  }
);
/**
 * @swagger
 * /identity/user-api-keys:
 *   get:
 *     summary: Get the current user's API keys
 *     tags: [Identity & Security]
 *     description: Retrieves a list of Better Auth API keys for the currently authenticated user.
 *     responses:
 *       200:
 *         description: A list of API keys.
 */
router.get('/user-api-keys', authenticate, async (req, res, next) => {
  try {
    // @ts-expect-error TS(2339): Property 'listApiKeys' does not exist on type 'Inf... Remove this comment to see the full error message
    // /api-key/list is a GET declared with `query`, not `body`, and it takes
    // no `userId` — so unlike the other two this one is not a missing `body`
    // wrapper. It runs behind sessionMiddleware, so the owner comes from the
    // session. Forwarding the headers keeps the same guarantee the removed
    // `userId` was there for: the session is the authenticated actor's, never
    // the switched context, so a delegate cannot list the owner's keys.
    const result = await auth.api.listApiKeys({
      headers: req.headers,
    });
    // The endpoint returns { apiKeys, total, limit, offset }. The route has
    // always been documented as returning "a list of API keys", so unwrap to
    // the array rather than leaking the pagination envelope.
    res.status(200).json(result?.apiKeys ?? []);
  } catch (error) {
    next(error);
  }
});
export default router;
