/**
 * Configuration loader and validator
 * Reads and validates environment variables
 */

import { config } from 'dotenv';

// Load .env file in development
config();

interface Config {
  docebo: {
    baseUrl: string;
  };
  oauth: {
    authorizationUrl: string;
    tokenUrl: string;
  };
  server: {
    port: number;
    allowedOrigins: string[];
    allowLocalDev: boolean;
  };
}

function validateEnv(): Config {
  // Only DOCEBO_BASE_URL is required
  // OAuth URLs are optional and only used in local dev mode
  const required = ['DOCEBO_BASE_URL'];

  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  // Validate BASE_URL format
  const baseUrl = process.env.DOCEBO_BASE_URL!;
  if (!baseUrl.startsWith('https://') && !baseUrl.startsWith('http://localhost')) {
    throw new Error('DOCEBO_BASE_URL must use HTTPS (or http://localhost for dev)');
  }

  // OAuth URLs are optional - used only for local development
  const authUrl = process.env.OAUTH_AUTHORIZATION_URL || '';
  const tokenUrl = process.env.OAUTH_TOKEN_URL || '';

  if (authUrl && !authUrl.startsWith('https://') && !authUrl.startsWith('http://localhost')) {
    throw new Error('OAUTH_AUTHORIZATION_URL must use HTTPS (or http://localhost for dev)');
  }

  if (tokenUrl && !tokenUrl.startsWith('https://') && !tokenUrl.startsWith('http://localhost')) {
    throw new Error('OAUTH_TOKEN_URL must use HTTPS (or http://localhost for dev)');
  }

  // Parse allowed origins
  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
    : ['https://chat.openai.com', 'https://claude.ai'];

  // Allow disabling origin check for local development (MCP Inspector, etc.)
  const allowLocalDev = process.env.ALLOW_LOCAL_DEV === 'true';

  return {
    docebo: {
      baseUrl: baseUrl.replace(/\/$/, ''), // Remove trailing slash
    },
    oauth: {
      authorizationUrl: authUrl,
      tokenUrl: tokenUrl,
    },
    server: {
      port: parseInt(process.env.PORT || '3000', 10),
      allowedOrigins,
      allowLocalDev,
    },
  };
}

export const appConfig = validateEnv();

/**
 * Get OAuth endpoints based on hostname
 * For production (*.docebosaas.com), derives endpoints from hostname
 * For localhost, uses .env values
 */
export interface OAuthEndpoints {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
}

export function getOAuthEndpoints(hostname: string): OAuthEndpoints {
  const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname.startsWith('localhost:');

  if (isLocalhost) {
    // Local development: Return localhost URLs to avoid CORS issues
    // The /oauth2/* endpoints on localhost proxy to Docebo
    // User manually edits redirect_uri to use ngrok URL for MCP Inspector callback
    const port = appConfig.server.port;

    return {
      issuer: `http://localhost:${port}/oauth2`,
      authorizationEndpoint: `http://localhost:${port}/oauth2/authorize`,
      tokenEndpoint: `http://localhost:${port}/oauth2/token`,
    };
  }

  // Production: extract tenant from hostname and construct URLs
  // Expected format: <tenantId>.docebosaas.com or <tenantId>.docebosaas.com:port
  const match = hostname.match(/^([^.]+)\.docebosaas\.com(?::\d+)?$/);

  if (match) {
    const tenantId = match[1];
    const baseUrl = `https://${tenantId}.docebosaas.com`;

    return {
      issuer: `${baseUrl}/oauth2`,
      authorizationEndpoint: `${baseUrl}/oauth2/authorize`,
      tokenEndpoint: `${baseUrl}/oauth2/token`,
    };
  }

  // Fallback: use the hostname as-is (assumes it's a valid Docebo domain)
  const protocol = hostname.startsWith('localhost') ? 'http' : 'https';
  const baseUrl = `${protocol}://${hostname}`;

  return {
    issuer: `${baseUrl}/oauth2`,
    authorizationEndpoint: `${baseUrl}/oauth2/authorize`,
    tokenEndpoint: `${baseUrl}/oauth2/token`,
  };
}

/**
 * Get the real Docebo OAuth endpoints for fetching authorization server metadata
 * Used to proxy metadata requests to the actual Docebo server
 */
export function getDoceboOAuthEndpoints(): OAuthEndpoints {
  const baseUrl = appConfig.docebo.baseUrl;

  return {
    issuer: `${baseUrl}/oauth2`,
    authorizationEndpoint: `${baseUrl}/oauth2/authorize`,
    tokenEndpoint: `${baseUrl}/oauth2/token`,
  };
}

// Log loaded config (without secrets)
console.log('[Config] Loaded configuration:', {
  doceboBaseUrl: appConfig.docebo.baseUrl,
  oauthAuthorizationUrl: appConfig.oauth.authorizationUrl || '(dynamic - based on hostname)',
  oauthTokenUrl: appConfig.oauth.tokenUrl || '(dynamic - based on hostname)',
  serverPort: appConfig.server.port,
  allowedOrigins: appConfig.server.allowedOrigins,
  allowLocalDev: appConfig.server.allowLocalDev,
});

if (appConfig.server.allowLocalDev) {
  console.warn('[Config] ⚠️  Local dev mode enabled - Origin validation relaxed!');
}
