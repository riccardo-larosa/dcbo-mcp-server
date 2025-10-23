/**
 * OAuth2 proxy endpoints
 * Proxies OAuth2 authorization and token requests to Docebo tenants
 * Supports virtual client credentials for Dynamic Client Registration (DCR)
 */

import { Request, Response } from 'express';
import { getTenantConfig, getTenantOAuthEndpoints } from './tenants.js';
import { lookupVirtualClient, validateVirtualClient } from './virtual-clients.js';

interface OAuthState {
  tenant: string;
  original?: string; // Original state from client
}

interface ResolvedCredentials {
  clientId: string;
  clientSecret: string;
  tenantId: string;
}

/**
 * Resolve client credentials (virtual or real)
 * If client_id is a virtual client, resolve to real tenant credentials
 * Otherwise, use tenant credentials directly
 */
function resolveClientCredentials(clientId: string | undefined, tenant: string): ResolvedCredentials | null {
  // If no client_id provided, use tenant credentials
  if (!clientId) {
    const tenantConfig = getTenantConfig(tenant);
    if (!tenantConfig) return null;

    return {
      clientId: tenantConfig.credentials.clientId,
      clientSecret: tenantConfig.credentials.clientSecret,
      tenantId: tenant,
    };
  }

  // Check if this is a virtual client
  const virtualClient = lookupVirtualClient(clientId);

  if (virtualClient) {
    console.log(`[OAuth Proxy] Resolved virtual client ${clientId} to tenant ${virtualClient.tenantId}`);

    // Get real tenant credentials
    const tenantConfig = getTenantConfig(virtualClient.tenantId);
    if (!tenantConfig) {
      console.error(`[OAuth Proxy] Tenant ${virtualClient.tenantId} not configured for virtual client`);
      return null;
    }

    return {
      clientId: tenantConfig.credentials.clientId,
      clientSecret: tenantConfig.credentials.clientSecret,
      tenantId: virtualClient.tenantId,
    };
  }

  // Not a virtual client, use tenant credentials
  const tenantConfig = getTenantConfig(tenant);
  if (!tenantConfig) return null;

  return {
    clientId: tenantConfig.credentials.clientId,
    clientSecret: tenantConfig.credentials.clientSecret,
    tenantId: tenant,
  };
}

/**
 * Encode tenant info into OAuth state parameter
 */
function encodeState(tenant: string, originalState?: string): string {
  const stateObj: OAuthState = {
    tenant,
    original: originalState,
  };
  return Buffer.from(JSON.stringify(stateObj)).toString('base64url');
}

/**
 * Decode tenant info from OAuth state parameter
 */
function decodeState(encodedState: string): OAuthState | null {
  try {
    const decoded = Buffer.from(encodedState, 'base64url').toString('utf-8');
    return JSON.parse(decoded) as OAuthState;
  } catch (error) {
    console.error('[OAuth Proxy] Failed to decode state:', error);
    return null;
  }
}

/**
 * Handle /oauth2/authorize - Proxy authorization request to Docebo tenant
 *
 * Query parameters:
 * - tenant: Required. The Docebo tenant ID (e.g., "riccardo-lr-test")
 * - All other OAuth2 parameters are forwarded to Docebo
 */
export async function handleAuthorize(req: Request, res: Response): Promise<void> {
  let { tenant, resource, ...oauthParams } = req.query;

  // If tenant not provided directly, try to extract from resource parameter
  if (!tenant && resource && typeof resource === 'string') {
    const match = resource.match(/\/mcp\/([^/?]+)/);
    if (match) {
      tenant = match[1];
      console.log(`[OAuth Proxy] Extracted tenant from resource parameter: ${tenant}`);
    }
  }

  // Validate tenant parameter
  if (!tenant || typeof tenant !== 'string') {
    res.status(400).json({
      error: 'invalid_request',
      error_description: 'Missing required parameter: tenant (provide either ?tenant=X or ?resource=.../mcp/X)',
    });
    return;
  }

  console.log(`[OAuth Proxy] Authorize request for tenant: ${tenant}`);

  // Get tenant configuration
  const tenantConfig = getTenantConfig(tenant);

  if (!tenantConfig) {
    res.status(404).json({
      error: 'invalid_request',
      error_description: `Tenant '${tenant}' is not configured`,
    });
    return;
  }

  const tenantEndpoints = getTenantOAuthEndpoints(tenant);

  if (!tenantEndpoints) {
    res.status(500).json({
      error: 'server_error',
      error_description: 'Failed to get tenant endpoints',
    });
    return;
  }

  // Encode tenant into state parameter
  const originalState = oauthParams.state as string | undefined;
  const newState = encodeState(tenant, originalState);

  // Build authorization URL for Docebo
  const authUrl = new URL(tenantEndpoints.authorizationUrl);

  // Forward all OAuth parameters except tenant, client_id, and redirect_uri
  // We'll replace client_id and redirect_uri with Docebo's configured values
  Object.entries(oauthParams).forEach(([key, value]) => {
    if (key !== 'state' && key !== 'client_id' && key !== 'redirect_uri' && key !== 'resource' && value) {
      authUrl.searchParams.set(key, String(value));
    }
  });

  // Inject Docebo's client_id
  authUrl.searchParams.set('client_id', tenantConfig.credentials.clientId);

  // Inject configured redirect_uri if available
  if (tenantConfig.credentials.redirectUri) {
    authUrl.searchParams.set('redirect_uri', tenantConfig.credentials.redirectUri);
  } else if (oauthParams.redirect_uri) {
    // Fall back to client-provided redirect_uri
    authUrl.searchParams.set('redirect_uri', String(oauthParams.redirect_uri));
  }

  // Set our encoded state
  authUrl.searchParams.set('state', newState);

  console.log(`[OAuth Proxy] Redirecting to: ${authUrl.origin}${authUrl.pathname}`);

  // Redirect to Docebo's authorization endpoint
  res.redirect(authUrl.toString());
}

/**
 * Handle /oauth2/token - Proxy token request to Docebo tenant
 *
 * Supports authorization_code, refresh_token, and password grant types
 */
export async function handleToken(req: Request, res: Response): Promise<void> {
  const grantType = req.body.grant_type;

  console.log(`[OAuth Proxy] Token request with grant_type: ${grantType}`);

  // Determine tenant based on grant type
  let tenant: string | null = null;

  if (grantType === 'authorization_code') {
    // First, check if tenant is provided in body (from tenant-specific endpoint)
    tenant = req.body.tenant || req.query.tenant as string;
    console.log(`[OAuth Proxy] Checking tenant from body/query: ${tenant}`);

    // If not in body/query, try to extract tenant from state parameter
    if (!tenant) {
      const state = req.body.state;
      console.log(`[OAuth Proxy] No tenant in body/query, checking state: ${state}`);

      if (state) {
        const decodedState = decodeState(state);
        if (decodedState) {
          tenant = decodedState.tenant;
        }
      }
    }

    // If still no tenant, return error
    if (!tenant) {
      res.status(400).json({
        error: 'invalid_request',
        error_description: 'Missing state parameter or unable to determine tenant. Use tenant-specific endpoint: /mcp/<tenant>/oauth2/token',
      });
      return;
    }
  } else if (grantType === 'refresh_token' || grantType === 'password') {
    // For refresh_token and password grants, tenant can be in body or query parameter
    tenant = req.body.tenant || req.query.tenant as string;

    if (!tenant) {
      res.status(400).json({
        error: 'invalid_request',
        error_description: 'Missing required parameter: tenant',
      });
      return;
    }
  } else {
    res.status(400).json({
      error: 'unsupported_grant_type',
      error_description: `Grant type '${grantType}' is not supported`,
    });
    return;
  }

  console.log(`[OAuth Proxy] Token request for tenant: ${tenant}`);

  // Resolve credentials (virtual client or tenant credentials)
  const resolvedCreds = resolveClientCredentials(req.body.client_id, tenant);

  if (!resolvedCreds) {
    res.status(404).json({
      error: 'invalid_request',
      error_description: `Tenant '${tenant}' is not configured`,
    });
    return;
  }

  // Update tenant to the resolved tenant (in case of virtual client)
  tenant = resolvedCreds.tenantId;

  const tenantConfig = getTenantConfig(tenant);
  if (!tenantConfig) {
    res.status(404).json({
      error: 'invalid_request',
      error_description: `Tenant '${tenant}' is not configured`,
    });
    return;
  }

  const tenantEndpoints = getTenantOAuthEndpoints(tenant);

  if (!tenantEndpoints) {
    res.status(500).json({
      error: 'server_error',
      error_description: 'Failed to get tenant endpoints',
    });
    return;
  }

  // Build token request body for Docebo
  const tokenBody = new URLSearchParams();

  // Add grant type
  tokenBody.set('grant_type', grantType);

  // Add resolved credentials (real tenant credentials)
  tokenBody.set('client_id', resolvedCreds.clientId);
  tokenBody.set('client_secret', resolvedCreds.clientSecret);

  // Forward grant-specific parameters
  if (grantType === 'authorization_code') {
    const { code, redirect_uri, code_verifier } = req.body;

    if (code) tokenBody.set('code', code);
    // Use tenant's configured redirect_uri instead of client's
    // This ensures it matches what was registered in Docebo
    if (tenantConfig.credentials.redirectUri) {
      tokenBody.set('redirect_uri', tenantConfig.credentials.redirectUri);
      console.log(`[OAuth Proxy] Using tenant redirect_uri: ${tenantConfig.credentials.redirectUri}`);
    } else if (redirect_uri) {
      tokenBody.set('redirect_uri', redirect_uri);
      console.log(`[OAuth Proxy] Using client redirect_uri: ${redirect_uri}`);
    }
    if (code_verifier) tokenBody.set('code_verifier', code_verifier);
  } else if (grantType === 'refresh_token') {
    const { refresh_token, scope } = req.body;

    if (refresh_token) tokenBody.set('refresh_token', refresh_token);
    if (scope) tokenBody.set('scope', scope);
  } else if (grantType === 'password') {
    const { username, password, scope } = req.body;

    if (username) tokenBody.set('username', username);
    if (password) tokenBody.set('password', password);
    if (scope) tokenBody.set('scope', scope || 'api');
  }

  console.log(`[OAuth Proxy] Proxying token request to: ${tenantEndpoints.tokenUrl}`);

  // Proxy token request to Docebo
  try {
    const response = await fetch(tenantEndpoints.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: tokenBody.toString(),
    });

    const data = await response.json();

    // Forward response from Docebo
    res.status(response.status).json(data);

    if (response.ok) {
      console.log(`[OAuth Proxy] Token issued successfully for tenant: ${tenant}`);
    } else {
      console.warn(`[OAuth Proxy] Token request failed: ${response.status}`, data);
    }
  } catch (error) {
    console.error('[OAuth Proxy] Token request error:', error);

    res.status(500).json({
      error: 'server_error',
      error_description: 'Failed to proxy token request',
    });
  }
}
