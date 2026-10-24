/**
 * Whether passkey sign-in and new passkey registration are turned off.
 * FORCE restores passkeys when an admin or DISABLE has turned them off.
 */
export function isPasskeyLoginDisabled(): boolean {
  return (
    process.env.SPARKY_FITNESS_DISABLE_PASSKEY_LOGIN === 'true' &&
    process.env.SPARKY_FITNESS_FORCE_PASSKEY_LOGIN !== 'true'
  );
}
