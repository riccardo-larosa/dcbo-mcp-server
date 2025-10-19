/**
 * Configuration loader and validator
 * Reads and validates environment variables for multi-tenant MCP server
 */

import { config } from 'dotenv';

// Load .env file in development
config();

interface Config {
  server: {
    port: number;
    publicUrl: string; // e.g., https://mcp.docebosaas.com or ngrok URL
    allowedOrigins: string[];
    allowLocalDev: boolean;
  };
}

function validateEnv(): Config {
  const required = ['SERVER_PUBLIC_URL'];

  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  const publicUrl = process.env.SERVER_PUBLIC_URL!.replace(/\/$/, ''); // Remove trailing slash

  // Validate URL format
  if (!publicUrl.startsWith('https://') && !publicUrl.startsWith('http://')) {
    throw new Error('SERVER_PUBLIC_URL must be a valid HTTP(S) URL');
  }

  // Parse allowed origins
  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
    : ['*']; // Allow all origins by default for OAuth

  // Allow disabling origin check for local development (MCP Inspector, etc.)
  const allowLocalDev = process.env.ALLOW_LOCAL_DEV === 'true';

  return {
    server: {
      port: parseInt(process.env.PORT || '3000', 10),
      publicUrl,
      allowedOrigins,
      allowLocalDev,
    },
  };
}

export const appConfig = validateEnv();

// Log loaded config (without secrets)
console.log('[Config] Loaded configuration:', {
  //serverPort: appConfig.server.port,
  serverPublicUrl: appConfig.server.publicUrl,
  allowedOrigins: appConfig.server.allowedOrigins,
  allowLocalDev: appConfig.server.allowLocalDev,
});

if (appConfig.server.allowLocalDev) {
  console.warn('[Config] ⚠️  Local dev mode enabled - Origin validation relaxed!');
}
