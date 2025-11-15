/**
 * Tests for Virtual Client Management (DCR POC)
 * Verifies virtual client registration, lookup, and credential validation
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fs from 'fs';
import {
  initializeStorage,
  generateVirtualClientSecret,
  validateVirtualClient,
  registerVirtualClient,
  lookupVirtualClient,
  listVirtualClients,
} from './virtual-clients.js';

// Mock fs module
vi.mock('fs');

describe('generateVirtualClientSecret', () => {
  it('generates deterministic secret for same client ID', () => {
    const clientId = 'test-client-123';

    const secret1 = generateVirtualClientSecret(clientId);
    const secret2 = generateVirtualClientSecret(clientId);

    expect(secret1).toBe(secret2);
    expect(secret1).toHaveLength(64); // SHA256 hex = 64 chars
  });

  it('generates different secrets for different client IDs', () => {
    const secret1 = generateVirtualClientSecret('client-1');
    const secret2 = generateVirtualClientSecret('client-2');

    expect(secret1).not.toBe(secret2);
  });

  it('generates consistent HMAC-based secrets', () => {
    // The actual env var is loaded at module import time,
    // so we can't test changing it dynamically. Instead,
    // verify that the secret is a valid hex string.
    const secret = generateVirtualClientSecret('test-client');

    expect(secret).toMatch(/^[a-f0-9]{64}$/); // Valid SHA256 hex
    expect(typeof secret).toBe('string');
  });
});

describe('validateVirtualClient', () => {
  it('returns true for valid client ID and secret', () => {
    const clientId = 'test-client-id';
    const validSecret = generateVirtualClientSecret(clientId);

    const isValid = validateVirtualClient(clientId, validSecret);

    expect(isValid).toBe(true);
  });

  it('returns false for invalid secret', () => {
    const clientId = 'test-client-id';
    const invalidSecret = 'wrong-secret';

    const isValid = validateVirtualClient(clientId, invalidSecret);

    expect(isValid).toBe(false);
  });

  it('returns false for mismatched client ID', () => {
    const clientId1 = 'client-1';
    const clientId2 = 'client-2';
    const secret1 = generateVirtualClientSecret(clientId1);

    const isValid = validateVirtualClient(clientId2, secret1);

    expect(isValid).toBe(false);
  });
});

describe('initializeStorage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates storage file if not exists', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});

    initializeStorage();

    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('virtual-clients.txt'),
      expect.stringContaining('# Virtual Client Mappings'),
      'utf-8'
    );
  });

  it('does not overwrite existing storage file', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);

    initializeStorage();

    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });
});

describe('registerVirtualClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.appendFileSync).mockImplementation(() => {});
  });

  it('generates UUID client ID', () => {
    const result = registerVirtualClient('test-tenant');

    // Should be a valid UUID format
    expect(result.clientId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  it('appends to storage file', () => {
    const result = registerVirtualClient('test-tenant', 'Test Client', ['https://example.com']);

    expect(fs.appendFileSync).toHaveBeenCalledWith(
      expect.stringContaining('virtual-clients.txt'),
      expect.stringContaining(`${result.clientId}|test-tenant`),
      'utf-8'
    );
  });

  it('includes optional client name and redirect URIs', () => {
    registerVirtualClient('test-tenant', 'My App', ['https://app.com', 'https://backup.com']);

    const writeCall = vi.mocked(fs.appendFileSync).mock.calls[0];
    const writtenLine = writeCall[1] as string;

    expect(writtenLine).toContain('My App');
    expect(writtenLine).toContain('https://app.com,https://backup.com');
  });

  it('returns client ID and secret', () => {
    const result = registerVirtualClient('test-tenant');

    expect(result).toHaveProperty('clientId');
    expect(result).toHaveProperty('clientSecret');
    expect(result.clientId).toMatch(/^[0-9a-f-]{36}$/); // UUID format
    expect(result.clientSecret).toHaveLength(64);
  });

  it('handles registration without optional fields', () => {
    registerVirtualClient('test-tenant');

    const writeCall = vi.mocked(fs.appendFileSync).mock.calls[0];
    const writtenLine = writeCall[1] as string;

    // Should have empty fields for clientName and redirectUris
    expect(writtenLine.trim()).toMatch(/\|\|$/); // Ends with ||
  });
});

describe('lookupVirtualClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('finds virtual client by ID', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      '# Header\nclient-123|tenant-1|2025-01-01T00:00:00Z|Test Client|https://example.com\n'
    );

    const client = lookupVirtualClient('client-123');

    expect(client).toEqual({
      virtualClientId: 'client-123',
      tenantId: 'tenant-1',
      createdAt: '2025-01-01T00:00:00Z',
      clientName: 'Test Client',
      redirectUris: ['https://example.com'],
    });
  });

  it('returns null when client not found', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      '# Header\nclient-123|tenant-1|2025-01-01T00:00:00Z|Test|https://example.com\n'
    );

    const client = lookupVirtualClient('nonexistent-client');

    expect(client).toBeNull();
  });

  it('returns null when storage file missing', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const client = lookupVirtualClient('client-123');

    expect(client).toBeNull();
  });

  it('parses redirect URIs correctly', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      'client-123|tenant-1|2025-01-01T00:00:00Z|App|https://uri1.com,https://uri2.com,https://uri3.com\n'
    );

    const client = lookupVirtualClient('client-123');

    expect(client?.redirectUris).toEqual([
      'https://uri1.com',
      'https://uri2.com',
      'https://uri3.com',
    ]);
  });

  it('skips comment lines and empty lines', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      '# Comment line\n\nclient-123|tenant-1|2025-01-01T00:00:00Z|Test|\n# Another comment\n'
    );

    const client = lookupVirtualClient('client-123');

    expect(client).not.toBeNull();
    expect(client?.virtualClientId).toBe('client-123');
  });

  it('handles empty client name', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      'client-123|tenant-1|2025-01-01T00:00:00Z||\n'
    );

    const client = lookupVirtualClient('client-123');

    expect(client?.clientName).toBeUndefined();
  });

  it('handles empty redirect URIs', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      'client-123|tenant-1|2025-01-01T00:00:00Z|Test|\n'
    );

    const client = lookupVirtualClient('client-123');

    expect(client?.redirectUris).toBeUndefined();
  });
});

describe('listVirtualClients', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns all virtual clients from storage', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      '# Header\n' +
      'client-1|tenant-1|2025-01-01T00:00:00Z|App1|https://app1.com\n' +
      'client-2|tenant-2|2025-01-02T00:00:00Z|App2|https://app2.com\n'
    );

    const clients = listVirtualClients();

    expect(clients).toHaveLength(2);
    expect(clients[0].virtualClientId).toBe('client-1');
    expect(clients[1].virtualClientId).toBe('client-2');
  });

  it('returns empty array when storage file missing', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const clients = listVirtualClients();

    expect(clients).toEqual([]);
  });

  it('skips malformed lines', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      '# Header\n' +
      'client-1|tenant-1|2025-01-01T00:00:00Z|App1|https://app1.com\n' +
      'invalid-line\n' + // Only 1 part
      'also|invalid\n' + // Only 2 parts
      'client-2|tenant-2|2025-01-02T00:00:00Z|App2|https://app2.com\n'
    );

    const clients = listVirtualClients();

    expect(clients).toHaveLength(2);
    expect(clients[0].virtualClientId).toBe('client-1');
    expect(clients[1].virtualClientId).toBe('client-2');
  });

  it('handles empty storage file', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue('# Header\n');

    const clients = listVirtualClients();

    expect(clients).toEqual([]);
  });
});
