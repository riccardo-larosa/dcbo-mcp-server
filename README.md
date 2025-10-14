# Docebo MCP Server

Minimal MCP (Model Context Protocol) server that exposes Docebo LMS API through a secure JSON-RPC interface.

## Features

- **OAuth2 Authentication**: Automatic token management with in-memory caching
- **Secure API**: API key + Origin validation
- **Streamable HTTP Transport**: JSON-RPC over HTTP/HTTPS
- **Single Tool**: `docebo.list_users` - List and search Docebo users

## Prerequisites

- Node.js 22.x or later
- Docebo LMS instance with API access
- OAuth2 client credentials (client_id + client_secret)

## Installation

```bash
npm install
```

## Configuration

1. Copy the example environment file:

```bash
cp .env.example .env
```

2. Fill in your credentials:

```env
DOCEBO_BASE_URL=https://your-tenant.docebosaas.com
DOCEBO_CLIENT_ID=your_client_id
DOCEBO_CLIENT_SECRET=your_client_secret
MCP_API_KEY=your-generated-api-key-here
PORT=3000
ALLOWED_ORIGINS=https://chat.openai.com,https://claude.ai

# For local development with MCP Inspector
ALLOW_LOCAL_DEV=true
```

### Generating an API Key

```bash
# Generate a secure random key
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Development

Start the server in watch mode:

```bash
npm run dev
```

### Using with MCP Inspector

The [MCP Inspector](https://github.com/modelcontextprotocol/inspector) is a tool for testing MCP servers locally. To use it with this server:

1. Enable local dev mode in your `.env`:
   ```env
   ALLOW_LOCAL_DEV=true
   ```

2. Start the server:
   ```bash
   npm run dev
   ```

3. Run the MCP Inspector:
   ```bash
   npx @modelcontextprotocol/inspector http://localhost:3000/mcp
   ```

4. In the Inspector UI, configure the API key:
   - Add header: `Authorization: MCP-Key <your-api-key>`

**Important**: Always set `ALLOW_LOCAL_DEV=false` in production! This setting disables origin validation and should only be used for local development.

## Production

Build and run:

```bash
npm run build
npm start
```

## Testing

### 1. Test Docebo OAuth2

```bash
curl -X POST "$DOCEBO_BASE_URL/oauth2/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials&client_id=$DOCEBO_CLIENT_ID&client_secret=$DOCEBO_CLIENT_SECRET"
```

### 2. Test Docebo API

```bash
# Get token first
TOKEN="<token_from_step_1>"

curl -H "Authorization: Bearer $TOKEN" \
  "$DOCEBO_BASE_URL/manage/v1/users?page_size=5"
```

### 3. Test MCP Server Health

```bash
curl http://localhost:3000/health
```

### 4. Test MCP Endpoint

```bash
# Initialize
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Origin: https://claude.ai" \
  -H "Authorization: MCP-Key your-api-key-here" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
      "protocolVersion": "0.1.0",
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
  -H "Authorization: MCP-Key your-api-key-here" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/list"
  }'

# Call tool
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Origin: https://claude.ai" \
  -H "Authorization: MCP-Key your-api-key-here" \
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
│   ├── config.ts       # Environment validation
│   ├── oauth.ts        # Token management
│   ├── docebo.ts       # Docebo API client
│   ├── mcp.ts          # JSON-RPC handler
│   └── server.ts       # Express app
├── .env.example
├── package.json
├── tsconfig.json
└── README.md
```

## License

MIT
