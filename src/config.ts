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
    clientId: string;
    clientSecret: string;
    username: string;
    password: string;
  };
  server: {
    port: number;
    mcpApiKey: string;
    allowedOrigins: string[];
    allowLocalDev: boolean;
  };
}

function validateEnv(): Config {
  const required = [
    'DOCEBO_BASE_URL',
    'DOCEBO_CLIENT_ID',
    'DOCEBO_CLIENT_SECRET',
    'DOCEBO_USERNAME',
    'DOCEBO_PASSWORD',
    'MCP_API_KEY',
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

  // Parse allowed origins
  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
    : ['https://chat.openai.com', 'https://claude.ai'];

  // Allow disabling origin check for local development (MCP Inspector, etc.)
  const allowLocalDev = process.env.ALLOW_LOCAL_DEV === 'true';

  return {
    docebo: {
      baseUrl: baseUrl.replace(/\/$/, ''), // Remove trailing slash
      clientId: process.env.DOCEBO_CLIENT_ID!,
      clientSecret: process.env.DOCEBO_CLIENT_SECRET!,
      username: process.env.DOCEBO_USERNAME!,
      password: process.env.DOCEBO_PASSWORD!,
    },
    server: {
      port: parseInt(process.env.PORT || '3000', 10),
      mcpApiKey: process.env.MCP_API_KEY!,
      allowedOrigins,
      allowLocalDev,
    },
  };
}

export const appConfig = validateEnv();

// Log loaded config (without secrets)
console.log('[Config] Loaded configuration:', {
  doceboBaseUrl: appConfig.docebo.baseUrl,
  serverPort: appConfig.server.port,
  allowedOrigins: appConfig.server.allowedOrigins,
  allowLocalDev: appConfig.server.allowLocalDev,
});

if (appConfig.server.allowLocalDev) {
  console.warn('[Config] ⚠️  Local dev mode enabled - Origin validation relaxed!');
}
