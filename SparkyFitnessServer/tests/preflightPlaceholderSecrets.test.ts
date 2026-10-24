import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';
import { log } from '../config/logging.js';

vi.mock('../config/logging.js', () => ({ log: vi.fn() }));

const ENV_KEYS = [
  'SPARKY_FITNESS_DB_HOST',
  'SPARKY_FITNESS_DB_NAME',
  'SPARKY_FITNESS_DB_USER',
  'SPARKY_FITNESS_DB_PASSWORD',
  'SPARKY_FITNESS_APP_DB_USER',
  'SPARKY_FITNESS_APP_DB_PASSWORD',
  'SPARKY_FITNESS_FRONTEND_URL',
  'SPARKY_FITNESS_API_ENCRYPTION_KEY',
  'BETTER_AUTH_SECRET',
] as const;

/**
 * The placeholders shipped in docker/.env.example and docker/.env.simple.example.
 * The check exists so that no server runs on them.
 */
const TEMPLATE_PLACEHOLDERS = {
  BETTER_AUTH_SECRET: [
    'changeme_replace_with_a_strong_better_auth_secret',
    'replace_with_a_base64_secret',
  ],
  SPARKY_FITNESS_API_ENCRYPTION_KEY: [
    'changeme_replace_with_a_64_character_hex_string',
    'replace_with_a_64_character_hex_string',
  ],
};

const fixture = (label: string) =>
  `${label}-${crypto.randomBytes(8).toString('hex')}`;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  vi.mocked(log).mockClear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  process.env.SPARKY_FITNESS_DB_PASSWORD = fixture('db');
  process.env.SPARKY_FITNESS_FRONTEND_URL = 'http://localhost:3004';
  process.env.SPARKY_FITNESS_API_ENCRYPTION_KEY = crypto
    .randomBytes(32)
    .toString('hex');
  process.env.BETTER_AUTH_SECRET = crypto.randomBytes(32).toString('base64');
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

const loadPreflight = async () =>
  (await import('../utils/preflightChecks.js')).default.runPreflightChecks;

describe('preflight rejects template placeholder secrets', () => {
  it('starts with real secrets', async () => {
    const runPreflightChecks = await loadPreflight();
    expect(() => runPreflightChecks()).not.toThrow();
  });

  // security/encryption.ts accepts both key formats; the check must not reject either
  for (const format of ['hex', 'base64'] as const) {
    it(`starts with a ${format} encryption key`, async () => {
      process.env.SPARKY_FITNESS_API_ENCRYPTION_KEY = crypto
        .randomBytes(32)
        .toString(format);
      const runPreflightChecks = await loadPreflight();
      expect(() => runPreflightChecks()).not.toThrow();
    });
  }

  for (const [varName, placeholders] of Object.entries(TEMPLATE_PLACEHOLDERS)) {
    for (const placeholder of placeholders) {
      it(`refuses to start when ${varName} is "${placeholder}"`, async () => {
        process.env[varName] = placeholder;
        const runPreflightChecks = await loadPreflight();
        expect(() => runPreflightChecks()).toThrow(/placeholder/);
        expect(log).toHaveBeenCalledWith(
          'error',
          expect.stringContaining(varName)
        );
      });
    }
  }

  it('explains the 2FA impact of replacing BETTER_AUTH_SECRET', async () => {
    process.env.BETTER_AUTH_SECRET = 'replace_with_a_base64_secret';
    const runPreflightChecks = await loadPreflight();
    expect(() => runPreflightChecks()).toThrow();
    const printed = vi.mocked(console.error).mock.calls.flat().join('\n');
    expect(printed).toContain('Reset MFA');
    expect(printed).toContain('openssl rand -base64 32');
  });

  it('does not reject a real secret that merely contains "replace"', async () => {
    process.env.BETTER_AUTH_SECRET =
      'correct-horse-replace_with-battery-staple';
    const runPreflightChecks = await loadPreflight();
    expect(() => runPreflightChecks()).not.toThrow();
  });

  it('only warns for the template database password', async () => {
    process.env.SPARKY_FITNESS_DB_PASSWORD = 'changeme_db_password';
    const runPreflightChecks = await loadPreflight();
    expect(() => runPreflightChecks()).not.toThrow();
    expect(log).toHaveBeenCalledWith(
      'warn',
      expect.stringContaining('SPARKY_FITNESS_DB_PASSWORD')
    );
  });
});

describe('preflight checks the decoded BETTER_AUTH_SECRET length', () => {
  // auth.ts decodes the value as base64, dropping characters outside it
  for (const value of ['...', '!!!!', '   ']) {
    it(`refuses to start when "${value}" decodes to an empty key`, async () => {
      process.env.BETTER_AUTH_SECRET = value;
      const runPreflightChecks = await loadPreflight();
      expect(() => runPreflightChecks()).toThrow(/empty key/);
    });
  }

  it('starts but warns when the key is under 32 bytes', async () => {
    process.env.BETTER_AUTH_SECRET = 'correct horse battery staple';
    const runPreflightChecks = await loadPreflight();
    expect(() => runPreflightChecks()).not.toThrow();
    expect(log).toHaveBeenCalledWith(
      'warn',
      expect.stringContaining('18 bytes')
    );
  });

  it('does not warn for a generated 32-byte key', async () => {
    const runPreflightChecks = await loadPreflight();
    runPreflightChecks();
    expect(log).not.toHaveBeenCalledWith(
      'warn',
      expect.stringContaining('BETTER_AUTH_SECRET')
    );
  });
});
