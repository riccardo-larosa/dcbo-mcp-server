# Docebo MCP Server

Minimal MCP (Model Context Protocol) server that exposes Docebo LMS API through a secure JSON-RPC interface.

## Features

- **MCP 2025-06-18 Compliant**: Implements RFC 9728 (Protected Resource Metadata) and RFC 8414 (Authorization Server Metadata)
- **Multi-Tenant OAuth2**: Automatic tenant detection from hostname with zero configuration
- **Client-Side OAuth2**: MCP clients handle OAuth2 authentication with Docebo
- **Stateless Server**: No credentials stored on server, accepts client Bearer tokens
- **Secure API**: Origin validation for production security
- **Streamable HTTP Transport**: JSON-RPC over HTTP/HTTPS
- **Single Tool**: `docebo.list_users` - List and search Docebo users

## Prerequisites

- Node.js 22.x or later
- Docebo LMS instance with API access
- OAuth2 app configured in Docebo (for client authentication)

## Installation

```bash
npm install
```

## Server Configuration

### Multi-Tenant Support

This server supports multi-tenant deployments on Docebo SaaS infrastructure:

- **Production**: Deploy at `<tenantId>.docebosaas.com/mcp` - OAuth2 endpoints are automatically detected from the hostname
- **Development**: Run on `localhost` - OAuth2 endpoints are configured via `.env` file

### Configuration Steps

1. Copy the example environment file:

```bash
cp .env.example .env
```

2. Configure the server:

```env
# Docebo API base URL
DOCEBO_BASE_URL=https://your-tenant.docebosaas.com

# OAuth2 endpoints (ONLY required for localhost development)
# In production (*.docebosaas.com), endpoints are dynamically determined from the hostname
OAUTH_AUTHORIZATION_URL=https://your-tenant.docebosaas.com/oauth2/authorize
OAUTH_TOKEN_URL=https://your-tenant.docebosaas.com/oauth2/token

PORT=3000
ALLOWED_ORIGINS=https://chat.openai.com,https://claude.ai

# For local development with MCP Inspector
ALLOW_LOCAL_DEV=true
```

**Configuration Notes**:
- The server is stateless and doesn't store any credentials
- **Production deployments** (`*.docebosaas.com`): OAuth2 endpoints are automatically derived from the hostname - no need to set `OAUTH_AUTHORIZATION_URL` or `OAUTH_TOKEN_URL`
- **Local development** (`localhost`): You must specify `OAUTH_AUTHORIZATION_URL` and `OAUTH_TOKEN_URL` in `.env`
- MCP clients discover OAuth2 endpoints automatically from `/.well-known/oauth-authorization-server`

## Client Configuration

MCP clients (like Claude Desktop, ChatGPT, or custom clients) must be configured to handle OAuth2 authentication with Docebo.

### OAuth2 Discovery

The MCP server implements both **RFC 9728 (OAuth 2.0 Protected Resource Metadata)** and **RFC 8414 (Authorization Server Metadata)** for automatic OAuth2 discovery, complying with the MCP 2025-06-18 specification.

#### Protected Resource Metadata (RFC 9728) - Required by MCP Spec

MCP clients discover the authorization server by fetching:

```
GET /.well-known/oauth-protected-resource
```

**Multi-Tenant Example:**

For a deployment at `https://acme.docebosaas.com/mcp`:

```json
{
  "resource": "https://acme.docebosaas.com/mcp",
  "authorization_servers": [
    "https://acme.docebosaas.com/oauth2"
  ]
}
```

#### Authorization Server Metadata (RFC 8414)

For clients that need detailed authorization server information:

```
GET /.well-known/oauth-authorization-server
```

Returns:

```json
{
  "issuer": "https://acme.docebosaas.com/oauth2",
  "authorization_endpoint": "https://acme.docebosaas.com/oauth2/authorize",
  "token_endpoint": "https://acme.docebosaas.com/oauth2/token",
  "scopes_supported": ["api"],
  "response_types_supported": ["code"],
  "grant_types_supported": ["authorization_code", "password", "refresh_token"],
  "code_challenge_methods_supported": ["S256"]
}
```

#### WWW-Authenticate Header

When authentication fails (401 Unauthorized), the server includes a `WWW-Authenticate` header pointing to the protected resource metadata:

```
WWW-Authenticate: Bearer realm="https://acme.docebosaas.com/.well-known/oauth-protected-resource"
```

Each tenant automatically gets their own OAuth2 endpoints based on their subdomain. No configuration required!

### Example: Claude Desktop Configuration

If your MCP client supports automatic discovery, you can simply configure:

```json
{
  "mcpServers": {
    "docebo": {
      "url": "https://acme.docebosaas.com/mcp",
      "transport": "streamable-http"
    }
  }
}
```

The client will automatically discover OAuth2 endpoints from the `.well-known` endpoint.

Alternatively, configure OAuth2 explicitly for each tenant:

```json
{
  "mcpServers": {
    "docebo": {
      "url": "https://acme.docebosaas.com/mcp",
      "transport": "streamable-http",
      "oauth": {
        "authorizationUrl": "https://acme.docebosaas.com/oauth2/authorize",
        "tokenUrl": "https://acme.docebosaas.com/oauth2/token",
        "clientId": "your-docebo-oauth-client-id",
        "clientSecret": "your-docebo-oauth-client-secret",
        "scopes": ["api"]
      }
    }
  }
}
```

### Docebo OAuth2 Setup

1. In Docebo, go to **Admin Menu** → **API & SSO** → **API Credentials**
2. Click **Add OAuth2 App**
3. Configure:
   - **Client ID**: Create a unique name (e.g., "mcp-client")
   - **Grant Types**: Check "Authorization Code" and "Password"
   - **Redirect URL**: For Authorization Code flow, add your client's callback URL
4. Note the **Client Secret** generated by Docebo
5. Use these credentials in your MCP client configuration

## Development

Start the server in watch mode:

```bash
npm run dev
```

### Using with MCP Inspector

#### OAuth Discovery Flow

The [MCP Inspector](https://github.com/modelcontextprotocol/inspector) is a tool for testing MCP servers locally.

**How it works in development mode:**
- MCP Inspector discovers OAuth endpoints at `http://localhost:3000`
- The server returns localhost URLs to avoid CORS issues
- OAuth endpoints point to localhost, but they don't actually work (no proxy)
- You must **manually obtain a token** from Docebo and paste it into MCP Inspector

**Setup steps:**

1. Enable local dev mode in your `.env`:
   ```env
   ALLOW_LOCAL_DEV=true
   ```

2. **Manually get an OAuth2 token** from Docebo:
   ```bash
   curl -X POST "https://your-tenant.docebosaas.com/oauth2/token" \
     -d "grant_type=password" \
     -d "client_id=your_oauth_client_id" \
     -d "client_secret=your_oauth_client_secret" \
     -d "username=admin" \
     -d "password=your_password" \
     -d "scope=api"
   ```

   Save the `access_token` from the response.

3. Start the server:
   ```bash
   npm run dev
   ```

4. Run the MCP Inspector:
   ```bash
   npx @modelcontextprotocol/inspector streamable-http http://localhost:3000/mcp
   ```

5. **In the Inspector UI:**
   - MCP Inspector will discover OAuth metadata automatically
   - When prompted for authentication, **manually paste the token** you obtained in step 2
   - Or add it as a header: `Authorization: Bearer <access_token_from_step_2>`

**Important**: Always set `ALLOW_LOCAL_DEV=false` in production! This setting disables origin validation and should only be used for local development.

## Production

### Multi-Tenant Deployment

This server is designed for deployment at `<tenantId>.docebosaas.com/mcp`. Each tenant automatically gets their own OAuth2 endpoints without any configuration.

**Example deployments:**
- `https://acme.docebosaas.com/mcp` → OAuth2 at `https://acme.docebosaas.com/oauth2/*`
- `https://widgets-inc.docebosaas.com/mcp` → OAuth2 at `https://widgets-inc.docebosaas.com/oauth2/*`

Build and run:

```bash
npm run build
npm start
```

**Production checklist:**
- ✅ Set `ALLOW_LOCAL_DEV=false` (disable origin validation bypass)
- ✅ Configure `ALLOWED_ORIGINS` with your MCP client origins
- ✅ Deploy at `<tenantId>.docebosaas.com/mcp`
- ✅ Remove or leave empty `OAUTH_AUTHORIZATION_URL` and `OAUTH_TOKEN_URL` (not needed in production)

## Testing

### 1. Get OAuth2 Token from Docebo

```bash
curl -X POST "https://your-tenant.docebosaas.com/oauth2/token" \
  -d "grant_type=password" \
  -d "client_id=your_oauth_client_id" \
  -d "client_secret=your_oauth_client_secret" \
  -d "username=admin" \
  -d "password=your_password" \
  -d "scope=api"
```

### 2. Test Docebo API with Token

```bash
TOKEN="<access_token_from_step_1>"

curl -H "Authorization: Bearer $TOKEN" \
  "https://your-tenant.docebosaas.com/manage/v1/user?page_size=5"
```

### 3. Test MCP Server Health

```bash
curl http://localhost:3000/health
```

### 4. Test MCP Endpoint with Bearer Token

```bash
TOKEN="<access_token_from_step_1>"

# Initialize
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Origin: https://claude.ai" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
      "protocolVersion": "2025-03-26",
      "clientInfo": {
        "name": "test-client",
        "version": "1.0.0"
      }
    }
  }'

# List tools
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Origin: https://claude.ai" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/list"
  }'

# Call tool
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Origin: https://claude.ai" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "jsonrpc": "2.0",
    "id": 3,
    "method": "tools/call",
    "params": {
      "name": "docebo.list_users",
      "arguments": {
        "page": 1,
        "page_size": 5
      }
    }
  }'
```

## API Reference

### MCP Tool: docebo.list_users

Lists users from Docebo LMS with optional filtering and pagination.

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `page` | number | Page number (1-indexed) |
| `page_size` | number | Users per page (default: 200, max: 200) |
| `sort_attr` | string | Sort attribute (e.g., "user_id", "username") |
| `sort_dir` | string | Sort direction: "asc" or "desc" |
| `search_text` | string | Search filter for username or email |

**Example:**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "docebo.list_users",
    "arguments": {
      "page": 1,
      "page_size": 10,
      "search_text": "john"
    }
  }
}
```

## Security

- **HTTPS Required**: Always use HTTPS in production
- **API Key Protection**: Keep `MCP_API_KEY` secret
- **Origin Validation**: Only whitelisted origins are allowed
- **Token Caching**: OAuth tokens are cached in memory with auto-refresh
- **No Logging of Secrets**: Tokens and keys are never logged

## Architecture

```
┌─────────────────┐
│  MCP Client     │ (Claude.ai, ChatGPT, etc.)
│  (Browser)      │
└────────┬────────┘
         │ HTTPS + API Key
         │
┌────────▼────────┐
│  Express Server │
│  - Origin Check │
│  - API Key Auth │
└────────┬────────┘
         │
┌────────▼────────┐
│  MCP Handler    │
│  (JSON-RPC)     │
└────────┬────────┘
         │
┌────────▼────────┐
│  OAuth Manager  │
│  (Token Cache)  │
└────────┬────────┘
         │
┌────────▼────────┐
│  Docebo API     │
│  /manage/v1/*   │
└─────────────────┘
```

## Project Structure

```
dcbo-mcp-server/
├── src/
│   ├── config.ts       # Environment validation & dynamic endpoint detection
│   ├── oauth.ts        # Token management
│   ├── docebo.ts       # Docebo API client
│   ├── mcp.ts          # JSON-RPC handler
│   └── server.ts       # Express app with OAuth2 discovery
├── .env.example
├── ENHANCEMENTS.md     # Future enhancement ideas
├── package.json
├── tsconfig.json
└── README.md
```

## How It Works

### Multi-Tenant OAuth2 Detection

The server automatically detects which tenant it's serving based on the `Host` header:

1. Client requests: `https://acme.docebosaas.com/mcp/.well-known/oauth-authorization-server`
2. Server extracts hostname: `acme.docebosaas.com`
3. Server constructs tenant-specific endpoints:
   - `issuer`: `https://acme.docebosaas.com/oauth2`
   - `authorization_endpoint`: `https://acme.docebosaas.com/oauth2/authorize`
   - `token_endpoint`: `https://acme.docebosaas.com/oauth2/token`
4. Returns discovery metadata with tenant-specific URLs

For localhost development, the server falls back to `.env` configuration.

## License

MIT
