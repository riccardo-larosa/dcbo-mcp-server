/**
 * OAuth2 proxy endpoints
 * Proxies OAuth2 authorization and token requests to Docebo tenants
 */

import { Request, Response } from 'express';
import { getTenantConfig, getTenantOAuthEndpoints } from './tenants.js';
import { appConfig } from './config.js';

interface OAuthState {
  tenant: string;
  original?: string; // Original state from client
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
  const { tenant, ...oauthParams } = req.query;

  // Validate tenant parameter
  if (!tenant || typeof tenant !== 'string') {
    res.status(400).json({
      error: 'invalid_request',
      error_description: 'Missing required parameter: tenant',
    });
    return;
  }

  console.log(`[OAuth Proxy] Authorize request for tenant: ${tenant}`);

  // Get tenant configuration
  const tenantEndpoints = getTenantOAuthEndpoints(tenant);

  if (!tenantEndpoints) {
    res.status(404).json({
      error: 'invalid_request',
      error_description: `Tenant '${tenant}' is not configured`,
    });
    return;
  }

  // Encode tenant into state parameter
  const originalState = oauthParams.state as string | undefined;
  const newState = encodeState(tenant, originalState);

  // Build authorization URL for Docebo
  const authUrl = new URL(tenantEndpoints.authorizationUrl);

  // Forward all OAuth parameters except tenant
  Object.entries(oauthParams).forEach(([key, value]) => {
    if (key !== 'state' && value) {
      authUrl.searchParams.set(key, String(value));
    }
  });

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
    // Extract tenant from state parameter
    const state = req.body.state;

    if (state) {
      const decodedState = decodeState(state);
      if (decodedState) {
        tenant = decodedState.tenant;
      }
    }

    // If no state, try to extract from code (some clients don't send state in token request)
    // For now, we'll require state
    if (!tenant) {
      res.status(400).json({
        error: 'invalid_request',
        error_description: 'Missing state parameter or unable to determine tenant',
      });
      return;
    }
  } else if (grantType === 'refresh_token' || grantType === 'password') {
    // For refresh_token and password grants, tenant must be in query parameter
    tenant = req.query.tenant as string;

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

  // Build token request body for Docebo
  const tokenBody = new URLSearchParams();

  // Add grant type
  tokenBody.set('grant_type', grantType);

  // Add tenant credentials
  tokenBody.set('client_id', tenantConfig.credentials.clientId);
  tokenBody.set('client_secret', tenantConfig.credentials.clientSecret);

  // Forward grant-specific parameters
  if (grantType === 'authorization_code') {
    const { code, redirect_uri, code_verifier } = req.body;

    if (code) tokenBody.set('code', code);
    if (redirect_uri) tokenBody.set('redirect_uri', redirect_uri);
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
