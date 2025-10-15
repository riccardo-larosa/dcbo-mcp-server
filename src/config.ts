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
  const required = [
    'DOCEBO_BASE_URL',
    'OAUTH_AUTHORIZATION_URL',
    'OAUTH_TOKEN_URL',
  ];

  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  // Validate BASE_URL format
  const baseUrl = process.env.DOCEBO_BASE_URL!;
  if (!baseUrl.startsWith('https://')) {
    throw new Error('DOCEBO_BASE_URL must use HTTPS');
  }

  // Validate OAuth URLs
  const authUrl = process.env.OAUTH_AUTHORIZATION_URL!;
  const tokenUrl = process.env.OAUTH_TOKEN_URL!;

  if (!authUrl.startsWith('https://') && !authUrl.startsWith('http://localhost')) {
    throw new Error('OAUTH_AUTHORIZATION_URL must use HTTPS (or http://localhost for dev)');
  }

  if (!tokenUrl.startsWith('https://') && !tokenUrl.startsWith('http://localhost')) {
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

// Log loaded config (without secrets)
console.log('[Config] Loaded configuration:', {
  doceboBaseUrl: appConfig.docebo.baseUrl,
  oauthAuthorizationUrl: appConfig.oauth.authorizationUrl,
  oauthTokenUrl: appConfig.oauth.tokenUrl,
  serverPort: appConfig.server.port,
  allowedOrigins: appConfig.server.allowedOrigins,
  allowLocalDev: appConfig.server.allowLocalDev,
});

if (appConfig.server.allowLocalDev) {
  console.warn('[Config] ⚠️  Local dev mode enabled - Origin validation relaxed!');
}
