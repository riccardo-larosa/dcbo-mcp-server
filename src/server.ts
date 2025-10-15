/**
 * Express server with security middleware
 * Exposes MCP JSON-RPC endpoint at /mcp
 */

import express, { Request, Response, NextFunction } from 'express';
import { appConfig } from './config.js';
import { handleMcpRequest } from './mcp.js';

const app = express();

// Parse JSON bodies
app.use(express.json());

/**
 * Security middleware: validate Origin header
 */
function validateOrigin(req: Request, res: Response, next: NextFunction): void {
  const origin = req.headers.origin;

  // In local dev mode, skip origin validation (for MCP Inspector, etc.)
  if (appConfig.server.allowLocalDev) {
    console.log('[Security] Local dev mode - allowing request from:', origin || 'no-origin');

    // Set permissive CORS headers for local dev
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    next();
    return;
  }

  // Production mode: strict origin validation
  if (!origin) {
    res.status(403).json({
      error: 'Forbidden',
      message: 'Origin header is required',
    });
    return;
  }

  if (!appConfig.server.allowedOrigins.includes(origin)) {
    console.warn('[Security] Blocked request from unauthorized origin:', origin);
    res.status(403).json({
      error: 'Forbidden',
      message: 'Origin not allowed',
    });
    return;
  }

  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  next();
}

/**
 * Security middleware: extract Bearer token from Authorization header
 * Token will be validated by Docebo API when making requests
 */
function extractBearerToken(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Authorization header is required',
    });
    return;
  }

  // Expected format: "Bearer <token>"
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid Authorization format. Expected: Bearer <token>',
    });
    return;
  }

  // Store the token in res.locals for use by handlers
  res.locals.bearerToken = match[1];

  next();
}

/**
 * Health check endpoint
 */
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});

/**
 * OAuth2 Protected Resource Metadata (RFC 9728)
 * Allows MCP clients to discover the authorization server
 */
app.get('/.well-known/oauth-authorization-server', (_req: Request, res: Response) => {
  res.json({
    issuer: appConfig.docebo.baseUrl,
    authorization_endpoint: `${appConfig.docebo.baseUrl}/oauth2/authorize`,
    token_endpoint: `${appConfig.docebo.baseUrl}/oauth2/token`,
    scopes_supported: ['api'],
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'password', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
  });
});

/**
 * OPTIONS handler for CORS preflight
 */
app.options('/mcp', validateOrigin, (_req: Request, res: Response) => {
  res.status(204).end();
});

/**
 * MCP JSON-RPC endpoint
 */
app.post('/mcp', validateOrigin, extractBearerToken, async (req: Request, res: Response) => {
  try {
    const request = req.body;

    // Validate JSON-RPC structure
    if (!request || typeof request !== 'object' || !request.method) {
      res.status(400).json({
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32600,
          message: 'Invalid Request: missing method field',
        },
      });
      return;
    }

    // Handle the request with the bearer token
    const response = await handleMcpRequest(request, res.locals.bearerToken);

    res.json(response);
  } catch (error) {
    console.error('[Server] Unexpected error:', error);

    res.status(500).json({
      jsonrpc: '2.0',
      id: null,
      error: {
        code: -32603,
        message: 'Internal server error',
      },
    });
  }
});

/**
 * 404 handler
 */
app.use((_req: Request, res: Response) => {
  res.status(404).json({
    error: 'Not Found',
    message: 'Endpoint not found. Try POST /mcp',
  });
});

/**
 * Global error handler
 */
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[Server] Global error handler:', err);

  res.status(500).json({
    error: 'Internal Server Error',
    message: err.message,
  });
});

/**
 * Start server
 */
const port = appConfig.server.port;

app.listen(port, () => {
  console.log('='.repeat(60));
  console.log(`[Server] Docebo MCP Server running on port ${port}`);
  console.log(`[Server] MCP endpoint: http://localhost:${port}/mcp`);
  console.log(`[Server] Health check: http://localhost:${port}/health`);
  console.log('='.repeat(60));
});
