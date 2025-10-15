# Future Enhancements

This document tracks potential improvements and features for future consideration.

## OAuth2 Multi-Tenant Support

### Tenant ID Validation

**Status**: Not Implemented
**Priority**: Medium

Currently, the server trusts the hostname when constructing tenant-specific OAuth2 endpoints. For production deployments, consider adding tenant validation:

- Validate that the tenant ID extracted from the hostname corresponds to a valid Docebo tenant
- Options for validation:
  - Maintain a whitelist of allowed tenant IDs
  - Call a Docebo API endpoint to verify tenant existence
  - Check against a database of valid tenants
- Return appropriate error responses (404 or 403) for invalid tenants
- Add configuration option to enable/disable validation

**Implementation Notes**:
- Could be implemented as middleware that runs before the OAuth discovery endpoint
- Should be cached to avoid performance impact
- Consider rate limiting to prevent tenant enumeration attacks

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
