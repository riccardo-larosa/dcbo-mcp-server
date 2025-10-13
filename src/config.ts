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
  };
  server: {
    port: number;
    mcpApiKey: string;
    allowedOrigins: string[];
  };
}

function validateEnv(): Config {
  const required = [
    'DOCEBO_BASE_URL',
    'DOCEBO_CLIENT_ID',
    'DOCEBO_CLIENT_SECRET',
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

  return {
    docebo: {
      baseUrl: baseUrl.replace(/\/$/, ''), // Remove trailing slash
      clientId: process.env.DOCEBO_CLIENT_ID!,
      clientSecret: process.env.DOCEBO_CLIENT_SECRET!,
    },
    server: {
      port: parseInt(process.env.PORT || '3000', 10),
      mcpApiKey: process.env.MCP_API_KEY!,
      allowedOrigins,
    },
  };
}

export const appConfig = validateEnv();

// Log loaded config (without secrets)
console.log('[Config] Loaded configuration:', {
  doceboBaseUrl: appConfig.docebo.baseUrl,
  serverPort: appConfig.server.port,
  allowedOrigins: appConfig.server.allowedOrigins,
});
