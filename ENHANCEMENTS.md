# Future Enhancements

This document tracks potential improvements and features for future consideration.

## OAuth2 Multi-Tenant Support

### Tenant ID Validation

**Status**: Not Implemented
**Priority**: Medium

Currently, the server accepts any tenant ID without validation. For production deployments, consider adding tenant validation:

- Validate that the tenant ID provided in `?tenant=xxx` parameter exists in configuration
- Return clear error messages if tenant not configured
- Prevents unnecessary proxy calls to non-existent tenants

**Current behavior:**
- Server proxies OAuth2 requests to any tenant ID without validation
- If tenant doesn't exist, Docebo returns error to client

**Proposed implementation:**
```typescript
function validateTenant(tenantId: string): boolean {
  return getTenantCredentials(tenantId) !== null;
}

// In authorize/token endpoints:
if (!validateTenant(tenant)) {
  return res.status(404).json({
    error: 'tenant_not_found',
    message: `Tenant '${tenant}' is not configured`
  });
}
```

**Benefits:**
- Better error messages for clients
- Faster failure for invalid tenants
- Reduced load on Docebo servers
- Security: prevents enumeration of tenant IDs

### Root-Level OAuth Discovery Endpoint

**Status**: ✅ Implemented
**Priority**: Low

**Implementation**:
- OAuth discovery endpoint is available at the root: `/.well-known/oauth-authorization-server`
- Supports CORS for MCP Inspector and other web-based clients
- Includes OPTIONS handler for CORS preflight requests
- Works with both production (`*.docebosaas.com`) and localhost deployments

**Deployment Note**:
If the application is deployed at a subpath like `/mcp` via reverse proxy, configure the proxy to route `/.well-known/oauth-authorization-server` requests to the application. For example, with nginx:

```nginx
location /.well-known/oauth-authorization-server {
    proxy_pass http://app_server/.well-known/oauth-authorization-server;
}
```

The Express application itself serves the endpoint at `/.well-known/oauth-authorization-server` (application root), regardless of deployment path.

---

## How to Use This Document

- Add new enhancement ideas as they are identified
- Include context, rationale, and implementation considerations
- Mark items as "Implemented" when completed and reference the commit/PR
- Prioritize items as: Low, Medium, High, or Critical
