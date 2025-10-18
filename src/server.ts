/**
 * Express server with OAuth2 proxy and MCP endpoint
 * Acts as OAuth2 authorization server proxy for Docebo tenants
 */

import express, { Request, Response, NextFunction } from 'express';
import { appConfig } from './config.js';
import { handleMcpRequest } from './mcp.js';
import { handleAuthorize, handleToken } from './oauth-proxy.js';

const app = express();

// Parse JSON bodies
app.use(express.json());

// Parse URL-encoded bodies (for OAuth2 token requests)
app.use(express.urlencoded({ extended: true }));

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
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    next();
    return;
  }

  // Production mode: Check allowed origins
  if (origin && appConfig.server.allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  } else if (appConfig.server.allowedOrigins.includes('*')) {
    // Allow all if configured
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }

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
 * OAuth2 Authorization Server Metadata (RFC 8414)
 * Describes the OAuth2 endpoints this server provides
 */
app.get('/.well-known/oauth-authorization-server', validateOrigin, (_req: Request, res: Response) => {
  res.json({
    issuer: appConfig.server.publicUrl,
    authorization_endpoint: `${appConfig.server.publicUrl}/oauth2/authorize`,
    token_endpoint: `${appConfig.server.publicUrl}/oauth2/token`,
    scopes_supported: ['api'],
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token', 'password'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
  });
});

/**
 * OAuth2 Protected Resource Metadata (RFC 9728)
 * Indicates which authorization server protects this resource
 */
app.get('/.well-known/oauth-protected-resource', validateOrigin, (_req: Request, res: Response) => {
  res.json({
    resource: appConfig.server.publicUrl,
    authorization_servers: [appConfig.server.publicUrl],
    bearer_methods_supported: ['header'],
    resource_documentation: `${appConfig.server.publicUrl}/docs`,
  });
});

/**
 * OAuth2 Authorization endpoint (proxy to Docebo)
 * Requires: ?tenant=<tenant-id>
 */
app.get('/oauth2/authorize', validateOrigin, async (req: Request, res: Response) => {
  await handleAuthorize(req, res);
});

/**
 * OAuth2 Token endpoint (proxy to Docebo)
 */
app.post('/oauth2/token', validateOrigin, async (req: Request, res: Response) => {
  await handleToken(req, res);
});

/**
 * OPTIONS handler for CORS preflight
 */
app.options('*', validateOrigin, (_req: Request, res: Response) => {
  res.status(204).end();
});

/**
 * MCP JSON-RPC endpoint
 * Requires: ?tenant=<tenant-id>
 * Requires: Authorization: Bearer <token>
 */
app.post('/mcp', validateOrigin, extractBearerToken, async (req: Request, res: Response) => {
  try {
    const request = req.body;
    const tenant = req.query.tenant as string;

    // Validate tenant parameter
    if (!tenant) {
      res.status(400).json({
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32600,
          message: 'Missing required query parameter: tenant',
        },
      });
      return;
    }

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

    // Handle the request with the bearer token and tenant
    const response = await handleMcpRequest(request, res.locals.bearerToken, tenant);

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
    message: 'Endpoint not found',
    available_endpoints: {
      health: 'GET /health',
      oauth_discovery: 'GET /.well-known/oauth-authorization-server',
      resource_discovery: 'GET /.well-known/oauth-protected-resource',
      authorize: 'GET /oauth2/authorize?tenant=<tenant-id>',
      token: 'POST /oauth2/token',
      mcp: 'POST /mcp?tenant=<tenant-id>',
    },
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
  console.log(`[Server] Docebo MCP OAuth2 Proxy Server`);
  console.log(`[Server] Running on port ${port}`);
  console.log(`[Server] Public URL: ${appConfig.server.publicUrl}`);
  console.log('='.repeat(60));
  console.log('[Server] Endpoints:');
  console.log(`  Health:      GET  /health`);
  console.log(`  OAuth Discovery: GET  /.well-known/oauth-authorization-server`);
  console.log(`  Resource Meta:   GET  /.well-known/oauth-protected-resource`);
  console.log(`  Authorize:   GET  /oauth2/authorize?tenant=<id>&...`);
  console.log(`  Token:       POST /oauth2/token`);
  console.log(`  MCP:         POST /mcp?tenant=<id>`);
  console.log('='.repeat(60));
});
