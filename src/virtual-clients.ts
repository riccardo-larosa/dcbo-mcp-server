/**
 * Virtual Client Management for Dynamic Client Registration (DCR) POC
 *
 * ⚠️ WARNING: This is a proof-of-concept implementation for testing only.
 * NOT SECURE for production use.
 *
 * Limitations:
 * - Plaintext file storage (virtual-clients.txt)
 * - No encryption
 * - No authentication for registration
 * - No rate limiting
 * - No revocation mechanism
 * - Not suitable for concurrent access
 *
 * This allows MCP clients to "register" dynamically even though Docebo doesn't
 * support RFC 7591. The server translates virtual client credentials to real
 * tenant credentials during OAuth flows.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const STORAGE_FILE = path.join(process.cwd(), 'virtual-clients.txt');
const SERVER_SECRET = process.env.DCR_SERVER_SECRET || 'default-secret-change-me';

export interface VirtualClient {
  virtualClientId: string;
  tenantId: string;
  createdAt: string;
  clientName?: string;
  redirectUris?: string[];
}

export interface VirtualClientCredentials {
  tenantId: string;
  realClientId: string;
  realClientSecret: string;
  realRedirectUri: string;
}

/**
 * Initialize virtual clients storage file if it doesn't exist
 */
export function initializeStorage(): void {
  if (!fs.existsSync(STORAGE_FILE)) {
    const header = `# Virtual Client Mappings (POC - NOT SECURE)
# Format: virtual_client_id|tenant_id|created_at|client_name|redirect_uris
# DO NOT use in production - this is for testing only
`;
    fs.writeFileSync(STORAGE_FILE, header, 'utf-8');
    console.log('[Virtual Clients] Initialized storage file:', STORAGE_FILE);
  }
}

/**
 * Generate virtual client secret from client ID
 * Uses HMAC to derive a consistent secret from the client ID
 */
export function generateVirtualClientSecret(virtualClientId: string): string {
  return crypto
    .createHmac('sha256', SERVER_SECRET)
    .update(virtualClientId)
    .digest('hex');
}

/**
 * Register a new virtual client
 */
export function registerVirtualClient(
  tenantId: string,
  clientName?: string,
  redirectUris?: string[]
): { clientId: string; clientSecret: string } {
  const virtualClientId = crypto.randomUUID();
  const virtualClientSecret = generateVirtualClientSecret(virtualClientId);
  const createdAt = new Date().toISOString();

  const client: VirtualClient = {
    virtualClientId,
    tenantId,
    createdAt,
    clientName,
    redirectUris,
  };

  // Append to file
  const line = serializeClient(client);
  fs.appendFileSync(STORAGE_FILE, line + '\n', 'utf-8');

  console.log(`[Virtual Clients] Registered new client: ${virtualClientId} for tenant: ${tenantId}`);

  return {
    clientId: virtualClientId,
    clientSecret: virtualClientSecret,
  };
}

/**
 * Lookup a virtual client by ID
 */
export function lookupVirtualClient(virtualClientId: string): VirtualClient | null {
  if (!fs.existsSync(STORAGE_FILE)) {
    return null;
  }

  const content = fs.readFileSync(STORAGE_FILE, 'utf-8');
  const lines = content.split('\n');

  for (const line of lines) {
    if (line.startsWith('#') || line.trim() === '') {
      continue;
    }

    const client = deserializeClient(line);
    if (client && client.virtualClientId === virtualClientId) {
      return client;
    }
  }

  return null;
}

/**
 * Validate virtual client credentials
 */
export function validateVirtualClient(clientId: string, clientSecret: string): boolean {
  const expectedSecret = generateVirtualClientSecret(clientId);
  return clientSecret === expectedSecret;
}

/**
 * Serialize client to storage format
 */
function serializeClient(client: VirtualClient): string {
  const redirectUris = client.redirectUris?.join(',') || '';
  return `${client.virtualClientId}|${client.tenantId}|${client.createdAt}|${client.clientName || ''}|${redirectUris}`;
}

/**
 * Deserialize client from storage format
 */
function deserializeClient(line: string): VirtualClient | null {
  const parts = line.split('|');
  if (parts.length < 3) {
    return null;
  }

  const [virtualClientId, tenantId, createdAt, clientName, redirectUrisStr] = parts;

  return {
    virtualClientId,
    tenantId,
    createdAt,
    clientName: clientName || undefined,
    redirectUris: redirectUrisStr ? redirectUrisStr.split(',') : undefined,
  };
}

/**
 * List all virtual clients (for debugging)
 */
export function listVirtualClients(): VirtualClient[] {
  if (!fs.existsSync(STORAGE_FILE)) {
    return [];
  }

  const content = fs.readFileSync(STORAGE_FILE, 'utf-8');
  const lines = content.split('\n');
  const clients: VirtualClient[] = [];

  for (const line of lines) {
    if (line.startsWith('#') || line.trim() === '') {
      continue;
    }

    const client = deserializeClient(line);
    if (client) {
      clients.push(client);
    }
  }

  return clients;
}
