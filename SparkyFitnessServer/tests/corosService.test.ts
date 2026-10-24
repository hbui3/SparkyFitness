import { vi, beforeEach, describe, expect, it } from 'vitest';
import {
  resolveCorosMcpUrl,
  corosIssuerFromMcpUrl,
} from '../integrations/coros/corosConstants.js';

process.env.SPARKY_FITNESS_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.SPARKY_FITNESS_FRONTEND_URL = 'https://app.example.com';

const mockDb = {
  query: vi.fn(),
  release: vi.fn(),
};

const { mockAxiosPost } = vi.hoisted(() => ({
  mockAxiosPost: vi.fn(),
}));

vi.mock('axios', () => ({
  default: {
    post: mockAxiosPost,
    isAxiosError: () => false,
  },
}));

vi.mock('../db/poolManager.js', () => ({
  getSystemClient: vi.fn(async () => mockDb),
  getClient: vi.fn(async () => mockDb),
}));

vi.mock('../config/db.js', () => ({
  default: mockDb,
}));

vi.mock('../config/logging.js', () => ({
  log: vi.fn(),
  error: vi.fn(),
}));

const mockExternalProviderRepo = {
  findByUserIdAndProviderType: vi.fn(),
  updateProviderCredentials: vi.fn(),
  deleteProvider: vi.fn(),
  getCredentialByProviderType: vi.fn(),
  findActiveOidcProviders: vi.fn(),
};

vi.mock('../repositories/externalProviderRepository.js', () => ({
  externalProviderRepository: mockExternalProviderRepo,
}));

const { default: corosService } =
  await import('../integrations/coros/corosService.js');

describe('corosConstants and corosService URL handling', () => {
  it('resolves valid regional MCP endpoints', () => {
    expect(resolveCorosMcpUrl('https://mcpus.coros.com/mcp')).toBe(
      'https://mcpus.coros.com/mcp'
    );
    expect(resolveCorosMcpUrl('https://mcpeu.coros.com/mcp')).toBe(
      'https://mcpeu.coros.com/mcp'
    );
    expect(resolveCorosMcpUrl('https://mcpcn.coros.com/mcp')).toBe(
      'https://mcpcn.coros.com/mcp'
    );
    expect(resolveCorosMcpUrl(undefined)).toBe('https://mcpus.coros.com/mcp');
  });

  it('rejects invalid or unauthorized hostnames', () => {
    expect(() => resolveCorosMcpUrl('https://evil.com/mcp')).toThrow();
    expect(() => resolveCorosMcpUrl('http://mcpus.coros.com/mcp')).toThrow();
  });

  it('derives issuer origin from mcp url', () => {
    expect(corosIssuerFromMcpUrl('https://mcpus.coros.com/mcp')).toBe(
      'https://mcpus.coros.com'
    );
  });
});

describe('corosService authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SPARKY_FITNESS_ENCRYPTION_KEY =
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    process.env.SPARKY_FITNESS_FRONTEND_URL = 'https://app.example.com';
    mockAxiosPost.mockResolvedValue({
      data: { client_id: 'dcr-client-id' },
    });
    mockDb.query.mockImplementation(async (sql: string) => {
      if (typeof sql === 'string' && sql.includes('external_data_providers')) {
        return {
          rows: [
            {
              id: '11111111-1111-4111-8111-111111111111',
              base_url: 'https://mcpus.coros.com/mcp',
              client_id: 'test-client',
              provider_type: 'coros_mcp',
              is_active: true,
              encrypted_app_id: 'enc-app-id',
              app_id_iv: '0123456789abcdef0123456789abcdef',
              app_id_tag: '0123456789abcdef0123456789abcdef',
            },
          ],
        };
      }
      return { rows: [] };
    });
  });

  it('generates authorization URL with PKCE and state', async () => {
    const result = await corosService.getAuthorizationUrl(
      '11111111-1111-4111-8111-111111111111',
      'https://app.example.com/coros/callback'
    );
    expect(result).toContain('https://mcpus.coros.com/oauth2/authorize');
    expect(result).toContain('response_type=code');
    expect(result).toContain('code_challenge_method=S256');
    expect(result).toContain('state=');
  });
});
