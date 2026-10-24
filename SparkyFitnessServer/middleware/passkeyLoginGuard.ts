import type { Request, Response, NextFunction } from 'express';
import { log } from '../config/logging.js';
import globalSettingsRepository from '../models/globalSettingsRepository.js';
import { isPasskeyLoginDisabled } from '../utils/passkeyLogin.js';

// Listing, renaming and deleting passkeys stay available so users can still
// clean up credentials while passkey login is off.
const PASSKEY_LOGIN_ROUTES = new Set([
  '/api/auth/passkey/generate-authenticate-options',
  '/api/auth/passkey/verify-authentication',
  '/api/auth/passkey/generate-register-options',
  '/api/auth/passkey/verify-registration',
]);

/**
 * Block passkey sign-in and new passkey registration when passkey login is
 * off. Reads the admin setting with SPARKY_FITNESS_DISABLE_PASSKEY_LOGIN
 * applied on top, the same value the login page shows.
 */
export async function passkeyLoginGuard(
  req: Request,
  res: Response,
  next: NextFunction
) {
  if (!PASSKEY_LOGIN_ROUTES.has(req.path.replace(/\/$/, ''))) return next();
  let disabled: boolean;
  try {
    const settings = await globalSettingsRepository.getGlobalSettings();
    disabled = !settings.enable_passkey_login;
  } catch (error) {
    log(
      'error',
      '[AUTH] Could not read login settings; applying the environment settings only:',
      error
    );
    disabled = isPasskeyLoginDisabled();
  }
  if (disabled) {
    return res.status(400).json({
      message: 'Passkey login is not enabled',
      code: 'PASSKEY_LOGIN_DISABLED',
    });
  }
  next();
}
