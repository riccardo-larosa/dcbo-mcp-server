/**
 * Tenant management utilities
 * Handles multi-tenant credential storage and Docebo URL construction
 */

export interface TenantCredentials {
  clientId: string;
  clientSecret: string;
  redirectUri?: string;
}

export interface TenantConfig {
  tenantId: string;
  baseUrl: string; // e.g., https://riccardo-lr-test.docebosaas.com
  credentials: TenantCredentials;
}

/**
 * Get tenant credentials from environment variables
 * Format: TENANT_<UPPERCASE_TENANT>_CLIENT_ID, CLIENT_SECRET, and optional REDIRECT_URI
 *
 * Example:
 *   TENANT_RICCARDO_LR_TEST_CLIENT_ID=my-client
 *   TENANT_RICCARDO_LR_TEST_CLIENT_SECRET=secret123
 *   TENANT_RICCARDO_LR_TEST_REDIRECT_URI=https://example.com/oauth/callback
 */
export function getTenantCredentials(tenantId: string): TenantCredentials | null {
  // Convert tenant ID to environment variable format
  // e.g., "riccardo-lr-test" -> "RICCARDO_LR_TEST"
  const envKey = tenantId.toUpperCase().replace(/-/g, '_');

  const clientId = process.env[`TENANT_${envKey}_CLIENT_ID`];
  const clientSecret = process.env[`TENANT_${envKey}_CLIENT_SECRET`];
  const redirectUri = process.env[`TENANT_${envKey}_REDIRECT_URI`];

  if (!clientId || !clientSecret) {
    console.warn(`[Tenants] No credentials found for tenant: ${tenantId}`);
    return null;
  }

  return {
    clientId,
    clientSecret,
    redirectUri,
  };
}

/**
 * Get full tenant configuration including Docebo URLs
 */
export function getTenantConfig(tenantId: string): TenantConfig | null {
  const credentials = getTenantCredentials(tenantId);

  if (!credentials) {
    return null;
  }

  const baseUrl = `https://${tenantId}.docebosaas.com`;

  return {
    tenantId,
    baseUrl,
    credentials,
  };
}

/**
 * Get Docebo OAuth2 endpoints for a tenant
 */
export function getTenantOAuthEndpoints(tenantId: string) {
  const config = getTenantConfig(tenantId);

  if (!config) {
    return null;
  }

  return {
    authorizationUrl: `${config.baseUrl}/oauth2/authorize`,
    tokenUrl: `${config.baseUrl}/oauth2/token`,
  };
}

/**
 * Get Docebo API base URL for a tenant
 */
export function getTenantApiUrl(tenantId: string): string | null {
  const config = getTenantConfig(tenantId);

  if (!config) {
    return null;
  }

  return config.baseUrl;
}

/**
 * List all configured tenants (from environment variables)
 */
export function listConfiguredTenants(): string[] {
  const tenants: string[] = [];

  // Scan environment variables for TENANT_*_CLIENT_ID patterns
  Object.keys(process.env).forEach((key) => {
    const match = key.match(/^TENANT_(.+)_CLIENT_ID$/);
    if (match) {
      // Convert back to tenant ID format
      // e.g., "RICCARDO_LR_TEST" -> "riccardo-lr-test"
      const tenantId = match[1].toLowerCase().replace(/_/g, '-');
      tenants.push(tenantId);
    }
  });

  return tenants;
}

// Log configured tenants on startup
const configuredTenants = listConfiguredTenants();
if (configuredTenants.length > 0) {
  console.log(`[Tenants] Configured tenants: ${configuredTenants.join(', ')}`);
} else {
  console.warn('[Tenants] No tenants configured! Add TENANT_*_CLIENT_ID and TENANT_*_CLIENT_SECRET to environment');
}
