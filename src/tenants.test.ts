/**
 * Tests for tenant management utilities
 * Verifies multi-tenant credential storage and Docebo URL construction
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getTenantCredentials,
  getTenantConfig,
  getTenantOAuthEndpoints,
  getTenantApiUrl,
  listConfiguredTenants,
} from './tenants.js';

describe('getTenantCredentials', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  it('loads credentials from environment variables', () => {
    process.env.TENANT_TEST_TENANT_CLIENT_ID = 'test-client-id';
    process.env.TENANT_TEST_TENANT_CLIENT_SECRET = 'test-secret';
    process.env.TENANT_TEST_TENANT_REDIRECT_URI = 'https://example.com/callback';

    const credentials = getTenantCredentials('test-tenant');

    expect(credentials).toEqual({
      clientId: 'test-client-id',
      clientSecret: 'test-secret',
      redirectUri: 'https://example.com/callback',
    });
  });

  it('converts hyphens to underscores in env var names', () => {
    // Tenant ID: "my-test-tenant" -> Env var: "TENANT_MY_TEST_TENANT_*"
    process.env.TENANT_MY_TEST_TENANT_CLIENT_ID = 'multi-hyphen-client';
    process.env.TENANT_MY_TEST_TENANT_CLIENT_SECRET = 'multi-hyphen-secret';

    const credentials = getTenantCredentials('my-test-tenant');

    expect(credentials).toEqual({
      clientId: 'multi-hyphen-client',
      clientSecret: 'multi-hyphen-secret',
      redirectUri: undefined,
    });
  });

  it('returns null when CLIENT_ID missing', () => {
    process.env.TENANT_INCOMPLETE_CLIENT_SECRET = 'secret-only';

    const credentials = getTenantCredentials('incomplete');

    expect(credentials).toBeNull();
  });

  it('returns null when CLIENT_SECRET missing', () => {
    process.env.TENANT_INCOMPLETE_CLIENT_ID = 'client-only';

    const credentials = getTenantCredentials('incomplete');

    expect(credentials).toBeNull();
  });

  it('includes optional REDIRECT_URI when present', () => {
    process.env.TENANT_WITH_REDIRECT_CLIENT_ID = 'client-id';
    process.env.TENANT_WITH_REDIRECT_CLIENT_SECRET = 'secret';
    process.env.TENANT_WITH_REDIRECT_REDIRECT_URI = 'https://redirect.example.com';

    const credentials = getTenantCredentials('with-redirect');

    expect(credentials).toEqual({
      clientId: 'client-id',
      clientSecret: 'secret',
      redirectUri: 'https://redirect.example.com',
    });
  });

  it('omits REDIRECT_URI when not set', () => {
    process.env.TENANT_NO_REDIRECT_CLIENT_ID = 'client-id';
    process.env.TENANT_NO_REDIRECT_CLIENT_SECRET = 'secret';

    const credentials = getTenantCredentials('no-redirect');

    expect(credentials).toEqual({
      clientId: 'client-id',
      clientSecret: 'secret',
      redirectUri: undefined,
    });
  });
});

describe('getTenantConfig', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('builds config with Docebo baseUrl', () => {
    process.env.TENANT_MY_TENANT_CLIENT_ID = 'client-id';
    process.env.TENANT_MY_TENANT_CLIENT_SECRET = 'secret';

    const config = getTenantConfig('my-tenant');

    expect(config).toEqual({
      tenantId: 'my-tenant',
      baseUrl: 'https://my-tenant.docebosaas.com',
      credentials: {
        clientId: 'client-id',
        clientSecret: 'secret',
        redirectUri: undefined,
      },
    });
  });

  it('returns null when credentials not found', () => {
    const config = getTenantConfig('nonexistent-tenant');

    expect(config).toBeNull();
  });

  it('constructs correct baseUrl from tenant ID with hyphens', () => {
    process.env.TENANT_COMPLEX_TENANT_NAME_CLIENT_ID = 'client-id';
    process.env.TENANT_COMPLEX_TENANT_NAME_CLIENT_SECRET = 'secret';

    const config = getTenantConfig('complex-tenant-name');

    expect(config?.baseUrl).toBe('https://complex-tenant-name.docebosaas.com');
  });
});

describe('getTenantOAuthEndpoints', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns correct OAuth URLs for tenant', () => {
    process.env.TENANT_OAUTH_TENANT_CLIENT_ID = 'client-id';
    process.env.TENANT_OAUTH_TENANT_CLIENT_SECRET = 'secret';

    const endpoints = getTenantOAuthEndpoints('oauth-tenant');

    expect(endpoints).toEqual({
      authorizationUrl: 'https://oauth-tenant.docebosaas.com/oauth2/authorize',
      tokenUrl: 'https://oauth-tenant.docebosaas.com/oauth2/token',
    });
  });

  it('returns null when tenant not configured', () => {
    const endpoints = getTenantOAuthEndpoints('unconfigured-tenant');

    expect(endpoints).toBeNull();
  });
});

describe('getTenantApiUrl', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns correct API base URL for tenant', () => {
    process.env.TENANT_API_TENANT_CLIENT_ID = 'client-id';
    process.env.TENANT_API_TENANT_CLIENT_SECRET = 'secret';

    const apiUrl = getTenantApiUrl('api-tenant');

    expect(apiUrl).toBe('https://api-tenant.docebosaas.com');
  });

  it('returns null when tenant not configured', () => {
    const apiUrl = getTenantApiUrl('unconfigured-tenant');

    expect(apiUrl).toBeNull();
  });
});

describe('listConfiguredTenants', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    // Clear all TENANT_* variables
    Object.keys(process.env).forEach((key) => {
      if (key.startsWith('TENANT_')) {
        delete process.env[key];
      }
    });
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('scans environment for TENANT_*_CLIENT_ID patterns', () => {
    process.env.TENANT_TENANT1_CLIENT_ID = 'client1';
    process.env.TENANT_TENANT1_CLIENT_SECRET = 'secret1';
    process.env.TENANT_TENANT2_CLIENT_ID = 'client2';
    process.env.TENANT_TENANT2_CLIENT_SECRET = 'secret2';

    const tenants = listConfiguredTenants();

    expect(tenants).toContain('tenant1');
    expect(tenants).toContain('tenant2');
    expect(tenants).toHaveLength(2);
  });

  it('converts underscores back to hyphens in tenant IDs', () => {
    process.env.TENANT_MY_HYPHENATED_TENANT_CLIENT_ID = 'client-id';
    process.env.TENANT_MY_HYPHENATED_TENANT_CLIENT_SECRET = 'secret';

    const tenants = listConfiguredTenants();

    expect(tenants).toContain('my-hyphenated-tenant');
  });

  it('returns empty array when no tenants configured', () => {
    const tenants = listConfiguredTenants();

    expect(tenants).toEqual([]);
  });

  it('ignores other TENANT_* variables without _CLIENT_ID suffix', () => {
    process.env.TENANT_VALID_CLIENT_ID = 'client-id';
    process.env.TENANT_VALID_CLIENT_SECRET = 'secret';
    process.env.TENANT_INVALID_CLIENT_SECRET = 'secret-only'; // No CLIENT_ID
    process.env.TENANT_ANOTHER_REDIRECT_URI = 'https://example.com'; // Not CLIENT_ID

    const tenants = listConfiguredTenants();

    expect(tenants).toContain('valid');
    expect(tenants).not.toContain('invalid');
    expect(tenants).not.toContain('another');
    expect(tenants).toHaveLength(1);
  });

  it('handles multiple tenants with mixed formats', () => {
    process.env.TENANT_SIMPLE_CLIENT_ID = 'client1';
    process.env.TENANT_SIMPLE_CLIENT_SECRET = 'secret1';
    process.env.TENANT_WITH_HYPHENS_CLIENT_ID = 'client2';
    process.env.TENANT_WITH_HYPHENS_CLIENT_SECRET = 'secret2';
    process.env.TENANT_LOTS_OF_HYPHENS_HERE_CLIENT_ID = 'client3';
    process.env.TENANT_LOTS_OF_HYPHENS_HERE_CLIENT_SECRET = 'secret3';

    const tenants = listConfiguredTenants();

    expect(tenants).toContain('simple');
    expect(tenants).toContain('with-hyphens');
    expect(tenants).toContain('lots-of-hyphens-here');
    expect(tenants).toHaveLength(3);
  });
});
