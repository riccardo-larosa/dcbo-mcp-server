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

// Apply CORS middleware globally to handle ALL requests including 404s
app.use(validateOrigin);

/**
 * Security middleware: validate Origin header
 */
function validateOrigin(req: Request, res: Response, next: NextFunction): void {
  const origin = req.headers.origin;

  // In local dev mode, skip origin validation (for MCP Inspector, etc.)
  if (appConfig.server.allowLocalDev) {
    console.log('[Security] Local dev mode - allowing request from:', origin || 'no-origin');

    // Set permissive CORS headers for local dev (including MCP-specific headers)
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS, HEAD');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, mcp-protocol-version, ngrok-skip-browser-warning');

    // Handle OPTIONS preflight
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }

    next();
    return;
  }

  // Production mode: Check allowed origins
  if (origin && appConfig.server.allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS, HEAD');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, mcp-protocol-version, ngrok-skip-browser-warning');
  } else if (appConfig.server.allowedOrigins.includes('*')) {
    // Allow all if configured
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS, HEAD');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, mcp-protocol-version, ngrok-skip-browser-warning');
  }

  // Handle OPTIONS preflight
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
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
 * OAuth2 Authorization Server Metadata (RFC 8414) - Root level
 * When accessed from root, we need the full MCP path in the request
 */
app.get('/.well-known/oauth-authorization-server', validateOrigin, (_req: Request, res: Response) => {
  // Default response - client should specify tenant in the resource path
  res.json({
    issuer: appConfig.server.publicUrl,
    authorization_endpoint: `${appConfig.server.publicUrl}/mcp/{tenant}/oauth2/authorize`,
    token_endpoint: `${appConfig.server.publicUrl}/mcp/{tenant}/oauth2/token`,
    scopes_supported: ['api'],
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token', 'password'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
  });
});

/**
 * OAuth2 Protected Resource Metadata (RFC 9728) - Root level
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
 * Inspector tries weird path patterns - handle them
 */
app.get('/.well-known/oauth-protected-resource/mcp/:tenant', validateOrigin, (_req: Request, res: Response) => {
  res.json({
    resource: appConfig.server.publicUrl,
    authorization_servers: [appConfig.server.publicUrl],
    bearer_methods_supported: ['header'],
    resource_documentation: `${appConfig.server.publicUrl}/docs`,
  });
});

/**
 * OAuth2 Authorization Server Metadata (RFC 8414) - Tenant-specific path
 * Path: /mcp/:tenant/.well-known/oauth-authorization-server
 */
app.get('/mcp/:tenant/.well-known/oauth-authorization-server', validateOrigin, (req: Request, res: Response) => {
  const tenant = req.params.tenant;
  const baseUrl = `${appConfig.server.publicUrl}/mcp/${tenant}`;

  res.json({
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/oauth2/authorize`,
    token_endpoint: `${baseUrl}/oauth2/token`,
    scopes_supported: ['api'],
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token', 'password'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
  });
});

/**
 * OAuth2 Protected Resource Metadata (RFC 9728) - Tenant-specific path
 * Path: /mcp/:tenant/.well-known/oauth-protected-resource
 */
app.get('/mcp/:tenant/.well-known/oauth-protected-resource', validateOrigin, (req: Request, res: Response) => {
  const tenant = req.params.tenant;
  const baseUrl = `${appConfig.server.publicUrl}/mcp/${tenant}`;

  res.json({
    resource: baseUrl,
    authorization_servers: [baseUrl],
    bearer_methods_supported: ['header'],
    resource_documentation: `${appConfig.server.publicUrl}/docs`,
  });
});

/**
 * OAuth2 Authorization endpoint (proxy to Docebo) - Tenant-specific
 * Path: /mcp/:tenant/oauth2/authorize
 */
app.get('/mcp/:tenant/oauth2/authorize', validateOrigin, async (req: Request, res: Response) => {
  // Add tenant from path to query params for handleAuthorize
  req.query.tenant = req.params.tenant;
  await handleAuthorize(req, res);
});

/**
 * OAuth2 Token endpoint (proxy to Docebo) - Tenant-specific
 * Path: /mcp/:tenant/oauth2/token
 */
app.post('/mcp/:tenant/oauth2/token', validateOrigin, async (req: Request, res: Response) => {
  // Add tenant from path to query params for handleToken
  req.query.tenant = req.params.tenant;
  await handleToken(req, res);
});

/**
 * HEAD endpoint for MCP - allows clients to check if endpoint exists
 */
app.head('/mcp/:tenant', validateOrigin, (_req: Request, res: Response) => {
  res.status(200).end();
});

/**
 * GET endpoint for MCP - return endpoint information
 */
app.get('/mcp/:tenant', validateOrigin, (req: Request, res: Response) => {
  const tenant = req.params.tenant;
  const baseUrl = `${appConfig.server.publicUrl}/mcp/${tenant}`;

  res.json({
    name: 'Docebo MCP Server',
    version: '1.0.0',
    tenant: tenant,
    endpoints: {
      mcp: `POST ${baseUrl}`,
      oauth_authorization: `GET ${baseUrl}/oauth2/authorize`,
      oauth_token: `POST ${baseUrl}/oauth2/token`,
      oauth_discovery: `GET ${baseUrl}/.well-known/oauth-authorization-server`,
      resource_metadata: `GET ${baseUrl}/.well-known/oauth-protected-resource`,
    },
  });
});

/**
 * MCP JSON-RPC endpoint - Tenant-specific
 * Path: /mcp/:tenant
 * Requires: Authorization: Bearer <token>
 */
app.post('/mcp/:tenant', validateOrigin, extractBearerToken, async (req: Request, res: Response) => {
  try {
    const request = req.body;
    const tenant = req.params.tenant;

    // Validate tenant parameter
    if (!tenant) {
      res.status(400).json({
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32600,
          message: 'Missing required path parameter: tenant',
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
      oauth_discovery: 'GET /mcp/<tenant>/.well-known/oauth-authorization-server',
      resource_discovery: 'GET /mcp/<tenant>/.well-known/oauth-protected-resource',
      authorize: 'GET /mcp/<tenant>/oauth2/authorize',
      token: 'POST /mcp/<tenant>/oauth2/token',
      mcp: 'POST /mcp/<tenant>',
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
  console.log('[Server] Tenant-specific Endpoints (replace <tenant> with tenant ID):');
  console.log(`  Health:          GET  /health`);
  console.log(`  OAuth Discovery: GET  /mcp/<tenant>/.well-known/oauth-authorization-server`);
  console.log(`  Resource Meta:   GET  /mcp/<tenant>/.well-known/oauth-protected-resource`);
  console.log(`  Authorize:       GET  /mcp/<tenant>/oauth2/authorize`);
  console.log(`  Token:           POST /mcp/<tenant>/oauth2/token`);
  console.log(`  MCP:             POST /mcp/<tenant>`);
  console.log('='.repeat(60));
  console.log('[Server] Example for tenant "riccardo-lr-test":');
  console.log(`  ${appConfig.server.publicUrl}/mcp/riccardo-lr-test`);
  console.log('='.repeat(60));
});
