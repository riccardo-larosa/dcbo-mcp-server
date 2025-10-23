/**
 * Express server with OAuth2 proxy and MCP endpoint
 * Acts as OAuth2 authorization server proxy for Docebo tenants
 */

import express, { Request, Response, NextFunction } from 'express';
import { appConfig } from './config.js';
import { handleMcpRequest } from './mcp.js';
import { handleAuthorize, handleToken } from './oauth-proxy.js';
import { initializeStorage, registerVirtualClient } from './virtual-clients.js';

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
 * Extract tenant from resource query parameter if provided
 */
app.get('/.well-known/oauth-authorization-server', validateOrigin, (req: Request, res: Response) => {
  // Check if resource parameter contains tenant info (e.g., .../mcp/riccardo-lr-test)
  const resourceParam = req.query.resource as string | undefined;

  if (resourceParam) {
    // Try to extract tenant from resource URL
    const match = resourceParam.match(/\/mcp\/([^/?]+)/);
    if (match) {
      const tenant = match[1];
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
      return;
    }
  }

  // Default response with {tenant} placeholder - client should provide resource parameter
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
 * OAuth2 Authorization Server Metadata - Inspector appends path pattern
 * Path: /.well-known/oauth-authorization-server/mcp/:tenant
 */
app.get('/.well-known/oauth-authorization-server/mcp/:tenant', validateOrigin, (req: Request, res: Response) => {
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
 * OAuth2 Protected Resource Metadata (RFC 9728) - Root level
 * Extract tenant from resource query parameter if provided
 */
app.get('/.well-known/oauth-protected-resource', validateOrigin, (req: Request, res: Response) => {
  // Check if resource parameter contains tenant info (e.g., .../mcp/riccardo-lr-test)
  const resourceParam = req.query.resource as string | undefined;

  if (resourceParam) {
    // Try to extract tenant from resource URL
    const match = resourceParam.match(/\/mcp\/([^/?]+)/);
    if (match) {
      const tenant = match[1];
      const baseUrl = `${appConfig.server.publicUrl}/mcp/${tenant}`;

      res.json({
        resource: baseUrl,
        authorization_servers: [baseUrl],
        bearer_methods_supported: ['header'],
        resource_documentation: `${appConfig.server.publicUrl}/docs`,
      });
      return;
    }
  }

  // Default response without tenant info
  res.json({
    resource: appConfig.server.publicUrl,
    authorization_servers: [appConfig.server.publicUrl],
    bearer_methods_supported: ['header'],
    resource_documentation: `${appConfig.server.publicUrl}/docs`,
  });
});

/**
 * Inspector tries weird path patterns - handle them
 * Return tenant-specific metadata when accessed via /.well-known/oauth-protected-resource/mcp/:tenant
 */
app.get('/.well-known/oauth-protected-resource/mcp/:tenant', validateOrigin, (req: Request, res: Response) => {
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
    registration_endpoint: `${baseUrl}/oauth2/register`, // DCR endpoint (POC)
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
 * OAuth2 Authorization endpoint - Fallback for {tenant} placeholder
 * When Inspector uses literal {tenant} from discovery, extract from resource parameter
 */
app.get('/mcp/{tenant}/oauth2/authorize', validateOrigin, async (req: Request, res: Response) => {
  // Tenant will be extracted from resource parameter in handleAuthorize
  await handleAuthorize(req, res);
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
  console.log(`[Server] POST /mcp/${req.params.tenant}/oauth2/token`);
  console.log(`[Server] Setting req.body.tenant = ${req.params.tenant}`);
  // Add tenant from path to body for handleToken (query is read-only after parsing)
  req.body.tenant = req.params.tenant;
  await handleToken(req, res);
});

/**
 * Dynamic Client Registration (DCR) endpoint - RFC 7591 (POC)
 * Path: /mcp/:tenant/oauth2/register
 *
 * ⚠️ WARNING: This is a proof-of-concept implementation for testing only.
 * NOT SECURE for production use.
 *
 * Allows MCP clients to "register" dynamically even though Docebo doesn't support DCR.
 * The server creates virtual client credentials and maps them to real tenant credentials.
 */
app.post('/mcp/:tenant/oauth2/register', validateOrigin, (req: Request, res: Response) => {
  const tenant = req.params.tenant;
  console.log(`[DCR] Registration request for tenant: ${tenant}`);

  try {
    // Extract client metadata from request body
    const { client_name, redirect_uris, grant_types, response_types, scope } = req.body;

    console.log(`[DCR] Client metadata:`, {
      client_name,
      redirect_uris,
      grant_types,
      response_types,
      scope
    });

    // Register virtual client
    const { clientId, clientSecret } = registerVirtualClient(
      tenant,
      client_name,
      redirect_uris
    );

    // Return RFC 7591 compliant response
    const response = {
      client_id: clientId,
      client_secret: clientSecret,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      // client_secret_expires_at: 0, // Never expires in this POC
      client_name: client_name || 'MCP Client',
      redirect_uris: redirect_uris || [],
      grant_types: grant_types || ['authorization_code', 'refresh_token'],
      response_types: response_types || ['code'],
      token_endpoint_auth_method: 'client_secret_post'
    };

    console.log(`[DCR] Successfully registered virtual client: ${clientId}`);
    res.status(201).json(response);
  } catch (error) {
    console.error('[DCR] Registration error:', error);
    res.status(500).json({
      error: 'server_error',
      error_description: 'Failed to register client',
    });
  }
});

/**
 * OAuth2 Callback endpoint
 * Path: /oauth/callback
 * Receives authorization code from Docebo and displays it or forwards to client
 */
app.get('/oauth/callback', validateOrigin, (req: Request, res: Response) => {
  const { code, state, error, error_description } = req.query;

  if (error) {
    res.status(400).send(`
      <html>
        <body>
          <h1>OAuth Error</h1>
          <p><strong>Error:</strong> ${error}</p>
          <p><strong>Description:</strong> ${error_description || 'No description provided'}</p>
        </body>
      </html>
    `);
    return;
  }

  if (!code || !state) {
    res.status(400).send(`
      <html>
        <body>
          <h1>Invalid Callback</h1>
          <p>Missing required parameters: code or state</p>
        </body>
      </html>
    `);
    return;
  }

  // Display the authorization code and state for the user to copy
  res.send(`
    <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; max-width: 800px; margin: 50px auto; padding: 20px; }
          h1 { color: #333; }
          .code-box { background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0; word-break: break-all; }
          .label { font-weight: bold; color: #666; }
          button { background: #4CAF50; color: white; padding: 10px 20px; border: none; border-radius: 5px; cursor: pointer; }
          button:hover { background: #45a049; }
        </style>
      </head>
      <body>
        <h1>OAuth Authorization Successful!</h1>
        <p>You have successfully authorized the application. Use the following information:</p>

        <div class="code-box">
          <div class="label">Authorization Code:</div>
          <div id="code">${code}</div>
          <button onclick="copyToClipboard('code')">Copy Code</button>
        </div>

        <div class="code-box">
          <div class="label">State:</div>
          <div id="state">${state}</div>
          <button onclick="copyToClipboard('state')">Copy State</button>
        </div>

        <p>You can now close this window and return to the application.</p>

        <script>
          function copyToClipboard(elementId) {
            const text = document.getElementById(elementId).innerText;
            navigator.clipboard.writeText(text).then(() => {
              alert('Copied to clipboard!');
            });
          }
        </script>
      </body>
    </html>
  `);
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

// Initialize virtual client storage
initializeStorage();

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
