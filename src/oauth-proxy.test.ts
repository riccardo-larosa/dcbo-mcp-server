/**
 * Tests for OAuth2 proxy endpoints
 * Verifies OAuth2 authorization and token request proxying logic
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Request, Response } from 'express';
import { decodeState, handleAuthorize, handleToken } from './oauth-proxy.js';
import * as tenants from './tenants.js';
import * as virtualClients from './virtual-clients.js';

// Mock dependencies
vi.mock('./tenants.js');
vi.mock('./virtual-clients.js');
global.fetch = vi.fn();

// Helper to create mock Request
function createMockRequest(overrides: Partial<Request> = {}): Request {
  return {
    query: {},
    body: {},
    params: {},
    headers: {},
    ...overrides,
  } as Request;
}

// Helper to create mock Response
function createMockResponse(): Response {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    redirect: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return res;
}

describe('decodeState', () => {
  it('decodes valid state parameter', () => {
    // Encode: { tenant: 'test-tenant', original: 'abc123' }
    const encoded = Buffer.from(
      JSON.stringify({ tenant: 'test-tenant', original: 'abc123' })
    ).toString('base64url');

    const decoded = decodeState(encoded);

    expect(decoded).toEqual({
      tenant: 'test-tenant',
      original: 'abc123',
    });
  });

  it('decodes state with all fields', () => {
    const encoded = Buffer.from(
      JSON.stringify({
        tenant: 'my-tenant',
        original: 'state123',
        redirectUri: 'https://example.com/callback',
      })
    ).toString('base64url');

    const decoded = decodeState(encoded);

    expect(decoded).toEqual({
      tenant: 'my-tenant',
      original: 'state123',
      redirectUri: 'https://example.com/callback',
    });
  });

  it('returns null for invalid base64url', () => {
    const decoded = decodeState('invalid!!!base64');

    expect(decoded).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    const encoded = Buffer.from('not valid json').toString('base64url');

    const decoded = decodeState(encoded);

    expect(decoded).toBeNull();
  });

  it('handles special characters in state', () => {
    const encoded = Buffer.from(
      JSON.stringify({ tenant: 'tenant-1', original: 'state/with+special=chars' })
    ).toString('base64url');

    const decoded = decodeState(encoded);

    expect(decoded?.original).toBe('state/with+special=chars');
  });
});

describe('handleAuthorize', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('extracts tenant from query parameter', async () => {
    const req = createMockRequest({
      query: {
        tenant: 'test-tenant',
        response_type: 'code',
        client_id: 'my-client',
      },
    });
    const res = createMockResponse();

    vi.mocked(tenants.getTenantConfig).mockReturnValue({
      tenantId: 'test-tenant',
      baseUrl: 'https://test-tenant.docebosaas.com',
      credentials: {
        clientId: 'real-client-id',
        clientSecret: 'real-secret',
        redirectUri: 'https://proxy.example.com/callback',
      },
    });

    vi.mocked(tenants.getTenantOAuthEndpoints).mockReturnValue({
      authorizationUrl: 'https://test-tenant.docebosaas.com/oauth2/authorize',
      tokenUrl: 'https://test-tenant.docebosaas.com/oauth2/token',
    });

    await handleAuthorize(req, res);

    expect(res.redirect).toHaveBeenCalled();
    const redirectUrl = vi.mocked(res.redirect).mock.calls[0][0] as string;
    expect(redirectUrl).toContain('test-tenant.docebosaas.com/oauth2/authorize');
  });

  it('extracts tenant from resource parameter', async () => {
    const req = createMockRequest({
      query: {
        resource: 'https://proxy.example.com/mcp/my-tenant',
        response_type: 'code',
      },
    });
    const res = createMockResponse();

    vi.mocked(tenants.getTenantConfig).mockReturnValue({
      tenantId: 'my-tenant',
      baseUrl: 'https://my-tenant.docebosaas.com',
      credentials: {
        clientId: 'real-client-id',
        clientSecret: 'real-secret',
      },
    });

    vi.mocked(tenants.getTenantOAuthEndpoints).mockReturnValue({
      authorizationUrl: 'https://my-tenant.docebosaas.com/oauth2/authorize',
      tokenUrl: 'https://my-tenant.docebosaas.com/oauth2/token',
    });

    await handleAuthorize(req, res);

    expect(tenants.getTenantConfig).toHaveBeenCalledWith('my-tenant');
  });

  it('returns 400 when tenant missing', async () => {
    const req = createMockRequest({
      query: { response_type: 'code' },
    });
    const res = createMockResponse();

    await handleAuthorize(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'invalid_request',
      error_description: expect.stringContaining('Missing required parameter: tenant'),
    });
  });

  it('returns 404 when tenant not configured', async () => {
    const req = createMockRequest({
      query: { tenant: 'nonexistent' },
    });
    const res = createMockResponse();

    vi.mocked(tenants.getTenantConfig).mockReturnValue(null);

    await handleAuthorize(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      error: 'invalid_request',
      error_description: "Tenant 'nonexistent' is not configured",
    });
  });

  it('redirects to Docebo with tenant credentials', async () => {
    const req = createMockRequest({
      query: {
        tenant: 'test-tenant',
        response_type: 'code',
        scope: 'api',
      },
    });
    const res = createMockResponse();

    vi.mocked(tenants.getTenantConfig).mockReturnValue({
      tenantId: 'test-tenant',
      baseUrl: 'https://test-tenant.docebosaas.com',
      credentials: {
        clientId: 'real-client-id',
        clientSecret: 'real-secret',
        redirectUri: 'https://proxy.example.com/callback',
      },
    });

    vi.mocked(tenants.getTenantOAuthEndpoints).mockReturnValue({
      authorizationUrl: 'https://test-tenant.docebosaas.com/oauth2/authorize',
      tokenUrl: 'https://test-tenant.docebosaas.com/oauth2/token',
    });

    await handleAuthorize(req, res);

    const redirectUrl = vi.mocked(res.redirect).mock.calls[0][0] as string;
    expect(redirectUrl).toContain('client_id=real-client-id');
    expect(redirectUrl).toContain('redirect_uri=https%3A%2F%2Fproxy.example.com%2Fcallback');
  });

  it('encodes state with original state preserved', async () => {
    const req = createMockRequest({
      query: {
        tenant: 'test-tenant',
        state: 'original-state-123',
        response_type: 'code',
      },
    });
    const res = createMockResponse();

    vi.mocked(tenants.getTenantConfig).mockReturnValue({
      tenantId: 'test-tenant',
      baseUrl: 'https://test-tenant.docebosaas.com',
      credentials: {
        clientId: 'real-client-id',
        clientSecret: 'real-secret',
      },
    });

    vi.mocked(tenants.getTenantOAuthEndpoints).mockReturnValue({
      authorizationUrl: 'https://test-tenant.docebosaas.com/oauth2/authorize',
      tokenUrl: 'https://test-tenant.docebosaas.com/oauth2/token',
    });

    await handleAuthorize(req, res);

    const redirectUrl = vi.mocked(res.redirect).mock.calls[0][0] as string;
    const url = new URL(redirectUrl);
    const state = url.searchParams.get('state');

    expect(state).toBeTruthy();
    const decoded = decodeState(state!);
    expect(decoded?.tenant).toBe('test-tenant');
    expect(decoded?.original).toBe('original-state-123');
  });

  it('uses tenant redirect_uri when configured', async () => {
    const req = createMockRequest({
      query: {
        tenant: 'test-tenant',
        redirect_uri: 'https://client.example.com/callback',
        response_type: 'code',
      },
    });
    const res = createMockResponse();

    vi.mocked(tenants.getTenantConfig).mockReturnValue({
      tenantId: 'test-tenant',
      baseUrl: 'https://test-tenant.docebosaas.com',
      credentials: {
        clientId: 'real-client-id',
        clientSecret: 'real-secret',
        redirectUri: 'https://proxy.example.com/callback', // Tenant's configured URI
      },
    });

    vi.mocked(tenants.getTenantOAuthEndpoints).mockReturnValue({
      authorizationUrl: 'https://test-tenant.docebosaas.com/oauth2/authorize',
      tokenUrl: 'https://test-tenant.docebosaas.com/oauth2/token',
    });

    await handleAuthorize(req, res);

    const redirectUrl = vi.mocked(res.redirect).mock.calls[0][0] as string;
    // Should use tenant's configured redirect_uri, not client's
    expect(redirectUrl).toContain('redirect_uri=https%3A%2F%2Fproxy.example.com%2Fcallback');
  });

  it('forwards OAuth parameters except excluded ones', async () => {
    const req = createMockRequest({
      query: {
        tenant: 'test-tenant',
        response_type: 'code',
        scope: 'api',
        code_challenge: 'challenge123',
        code_challenge_method: 'S256',
        client_id: 'should-be-replaced',
        resource: 'should-be-excluded',
      },
    });
    const res = createMockResponse();

    vi.mocked(tenants.getTenantConfig).mockReturnValue({
      tenantId: 'test-tenant',
      baseUrl: 'https://test-tenant.docebosaas.com',
      credentials: {
        clientId: 'real-client-id',
        clientSecret: 'real-secret',
      },
    });

    vi.mocked(tenants.getTenantOAuthEndpoints).mockReturnValue({
      authorizationUrl: 'https://test-tenant.docebosaas.com/oauth2/authorize',
      tokenUrl: 'https://test-tenant.docebosaas.com/oauth2/token',
    });

    await handleAuthorize(req, res);

    const redirectUrl = vi.mocked(res.redirect).mock.calls[0][0] as string;
    expect(redirectUrl).toContain('response_type=code');
    expect(redirectUrl).toContain('scope=api');
    expect(redirectUrl).toContain('code_challenge=challenge123');
    expect(redirectUrl).toContain('client_id=real-client-id'); // Replaced
    expect(redirectUrl).not.toContain('should-be-replaced');
  });
});

describe('handleToken', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('authorization_code: extracts tenant from body', async () => {
    const req = createMockRequest({
      body: {
        grant_type: 'authorization_code',
        tenant: 'test-tenant',
        code: 'auth-code-123',
        client_id: 'my-client',
        client_secret: 'my-secret',
      },
    });
    const res = createMockResponse();

    vi.mocked(tenants.getTenantConfig).mockReturnValue({
      tenantId: 'test-tenant',
      baseUrl: 'https://test-tenant.docebosaas.com',
      credentials: {
        clientId: 'real-client-id',
        clientSecret: 'real-secret',
        redirectUri: 'https://proxy.example.com/callback',
      },
    });

    vi.mocked(tenants.getTenantOAuthEndpoints).mockReturnValue({
      authorizationUrl: 'https://test-tenant.docebosaas.com/oauth2/authorize',
      tokenUrl: 'https://test-tenant.docebosaas.com/oauth2/token',
    });

    vi.mocked(virtualClients.lookupVirtualClient).mockReturnValue(null);

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ access_token: 'test-token', token_type: 'Bearer' }),
    } as Response);

    await handleToken(req, res);

    expect(fetch).toHaveBeenCalledWith(
      'https://test-tenant.docebosaas.com/oauth2/token',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      })
    );
  });

  it('authorization_code: extracts tenant from state', async () => {
    const state = Buffer.from(
      JSON.stringify({ tenant: 'state-tenant' })
    ).toString('base64url');

    const req = createMockRequest({
      body: {
        grant_type: 'authorization_code',
        code: 'auth-code-123',
        state: state,
      },
    });
    const res = createMockResponse();

    vi.mocked(tenants.getTenantConfig).mockReturnValue({
      tenantId: 'state-tenant',
      baseUrl: 'https://state-tenant.docebosaas.com',
      credentials: {
        clientId: 'real-client-id',
        clientSecret: 'real-secret',
      },
    });

    vi.mocked(tenants.getTenantOAuthEndpoints).mockReturnValue({
      authorizationUrl: 'https://state-tenant.docebosaas.com/oauth2/authorize',
      tokenUrl: 'https://state-tenant.docebosaas.com/oauth2/token',
    });

    vi.mocked(virtualClients.lookupVirtualClient).mockReturnValue(null);

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ access_token: 'test-token' }),
    } as Response);

    await handleToken(req, res);

    expect(tenants.getTenantConfig).toHaveBeenCalledWith('state-tenant');
  });

  it('authorization_code: returns 400 when tenant missing', async () => {
    const req = createMockRequest({
      body: {
        grant_type: 'authorization_code',
        code: 'auth-code-123',
      },
    });
    const res = createMockResponse();

    await handleToken(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'invalid_request',
      error_description: expect.stringContaining('unable to determine tenant'),
    });
  });

  it('authorization_code: uses tenant redirect_uri override', async () => {
    const req = createMockRequest({
      body: {
        grant_type: 'authorization_code',
        tenant: 'test-tenant',
        code: 'auth-code-123',
        redirect_uri: 'https://client.example.com/callback',
      },
    });
    const res = createMockResponse();

    vi.mocked(tenants.getTenantConfig).mockReturnValue({
      tenantId: 'test-tenant',
      baseUrl: 'https://test-tenant.docebosaas.com',
      credentials: {
        clientId: 'real-client-id',
        clientSecret: 'real-secret',
        redirectUri: 'https://proxy.example.com/callback', // Should override client's
      },
    });

    vi.mocked(tenants.getTenantOAuthEndpoints).mockReturnValue({
      authorizationUrl: 'https://test-tenant.docebosaas.com/oauth2/authorize',
      tokenUrl: 'https://test-tenant.docebosaas.com/oauth2/token',
    });

    vi.mocked(virtualClients.lookupVirtualClient).mockReturnValue(null);

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ access_token: 'test-token' }),
    } as Response);

    await handleToken(req, res);

    const fetchCall = vi.mocked(fetch).mock.calls[0];
    const body = fetchCall[1]?.body as string;
    const params = new URLSearchParams(body);

    expect(params.get('redirect_uri')).toBe('https://proxy.example.com/callback');
  });

  it('authorization_code: resolves virtual client credentials', async () => {
    const req = createMockRequest({
      body: {
        grant_type: 'authorization_code',
        tenant: 'test-tenant',
        code: 'auth-code-123',
        client_id: 'virtual-client-123',
      },
    });
    const res = createMockResponse();

    vi.mocked(virtualClients.lookupVirtualClient).mockReturnValue({
      virtualClientId: 'virtual-client-123',
      tenantId: 'real-tenant',
      createdAt: '2025-01-01T00:00:00Z',
    });

    vi.mocked(tenants.getTenantConfig).mockReturnValue({
      tenantId: 'real-tenant',
      baseUrl: 'https://real-tenant.docebosaas.com',
      credentials: {
        clientId: 'real-client-id',
        clientSecret: 'real-secret',
      },
    });

    vi.mocked(tenants.getTenantOAuthEndpoints).mockReturnValue({
      authorizationUrl: 'https://real-tenant.docebosaas.com/oauth2/authorize',
      tokenUrl: 'https://real-tenant.docebosaas.com/oauth2/token',
    });

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ access_token: 'test-token' }),
    } as Response);

    await handleToken(req, res);

    const fetchCall = vi.mocked(fetch).mock.calls[0];
    const body = fetchCall[1]?.body as string;
    const params = new URLSearchParams(body);

    expect(params.get('client_id')).toBe('real-client-id');
    expect(params.get('client_secret')).toBe('real-secret');
  });

  it('refresh_token: extracts tenant from body', async () => {
    const req = createMockRequest({
      body: {
        grant_type: 'refresh_token',
        tenant: 'test-tenant',
        refresh_token: 'refresh-token-123',
      },
    });
    const res = createMockResponse();

    vi.mocked(tenants.getTenantConfig).mockReturnValue({
      tenantId: 'test-tenant',
      baseUrl: 'https://test-tenant.docebosaas.com',
      credentials: {
        clientId: 'real-client-id',
        clientSecret: 'real-secret',
      },
    });

    vi.mocked(tenants.getTenantOAuthEndpoints).mockReturnValue({
      authorizationUrl: 'https://test-tenant.docebosaas.com/oauth2/authorize',
      tokenUrl: 'https://test-tenant.docebosaas.com/oauth2/token',
    });

    vi.mocked(virtualClients.lookupVirtualClient).mockReturnValue(null);

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ access_token: 'new-token' }),
    } as Response);

    await handleToken(req, res);

    const fetchCall = vi.mocked(fetch).mock.calls[0];
    const body = fetchCall[1]?.body as string;
    const params = new URLSearchParams(body);

    expect(params.get('grant_type')).toBe('refresh_token');
    expect(params.get('refresh_token')).toBe('refresh-token-123');
  });

  it('password: forwards username/password/scope', async () => {
    const req = createMockRequest({
      body: {
        grant_type: 'password',
        tenant: 'test-tenant',
        username: 'testuser',
        password: 'testpass',
        scope: 'api',
      },
    });
    const res = createMockResponse();

    vi.mocked(tenants.getTenantConfig).mockReturnValue({
      tenantId: 'test-tenant',
      baseUrl: 'https://test-tenant.docebosaas.com',
      credentials: {
        clientId: 'real-client-id',
        clientSecret: 'real-secret',
      },
    });

    vi.mocked(tenants.getTenantOAuthEndpoints).mockReturnValue({
      authorizationUrl: 'https://test-tenant.docebosaas.com/oauth2/authorize',
      tokenUrl: 'https://test-tenant.docebosaas.com/oauth2/token',
    });

    vi.mocked(virtualClients.lookupVirtualClient).mockReturnValue(null);

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ access_token: 'pwd-token' }),
    } as Response);

    await handleToken(req, res);

    const fetchCall = vi.mocked(fetch).mock.calls[0];
    const body = fetchCall[1]?.body as string;
    const params = new URLSearchParams(body);

    expect(params.get('grant_type')).toBe('password');
    expect(params.get('username')).toBe('testuser');
    expect(params.get('password')).toBe('testpass');
    expect(params.get('scope')).toBe('api');
  });

  it('unsupported grant type returns 400', async () => {
    const req = createMockRequest({
      body: {
        grant_type: 'client_credentials',
      },
    });
    const res = createMockResponse();

    await handleToken(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'unsupported_grant_type',
      error_description: expect.stringContaining('client_credentials'),
    });
  });

  it('returns 404 for unconfigured tenant', async () => {
    const req = createMockRequest({
      body: {
        grant_type: 'refresh_token',
        tenant: 'nonexistent',
        refresh_token: 'token-123',
      },
    });
    const res = createMockResponse();

    vi.mocked(virtualClients.lookupVirtualClient).mockReturnValue(null);
    vi.mocked(tenants.getTenantConfig).mockReturnValue(null);

    await handleToken(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      error: 'invalid_request',
      error_description: "Tenant 'nonexistent' is not configured",
    });
  });

  it('handles Docebo token error responses', async () => {
    const req = createMockRequest({
      body: {
        grant_type: 'authorization_code',
        tenant: 'test-tenant',
        code: 'invalid-code',
      },
    });
    const res = createMockResponse();

    vi.mocked(tenants.getTenantConfig).mockReturnValue({
      tenantId: 'test-tenant',
      baseUrl: 'https://test-tenant.docebosaas.com',
      credentials: {
        clientId: 'real-client-id',
        clientSecret: 'real-secret',
      },
    });

    vi.mocked(tenants.getTenantOAuthEndpoints).mockReturnValue({
      authorizationUrl: 'https://test-tenant.docebosaas.com/oauth2/authorize',
      tokenUrl: 'https://test-tenant.docebosaas.com/oauth2/token',
    });

    vi.mocked(virtualClients.lookupVirtualClient).mockReturnValue(null);

    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: 'invalid_grant', error_description: 'Code expired' }),
    } as Response);

    await handleToken(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'invalid_grant',
      error_description: 'Code expired',
    });
  });
});
