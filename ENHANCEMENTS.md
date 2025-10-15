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

**Status**: Not Implemented
**Priority**: Low

**Current Implementation**:
- OAuth discovery endpoint is at: `<tenant>.docebosaas.com/mcp/.well-known/oauth-authorization-server`

**Proposed Enhancement**:
- Also support root-level discovery at: `<tenant>.docebosaas.com/.well-known/oauth-authorization-server`

**Rationale**:
- RFC 8414 (OAuth 2.0 Authorization Server Metadata) specifies the `.well-known` endpoint should be at the root
- Some OAuth2 clients may expect the discovery endpoint at the root level
- Better compliance with OAuth2 standards

**Implementation Considerations**:
- May require coordination with reverse proxy or load balancer configuration
- Both endpoints could coexist (root and `/mcp` prefix)
- Ensure consistent response from both endpoints
- Update documentation to reflect both endpoint locations

**Potential Challenges**:
- If the MCP server is deployed at `/mcp`, it may not have access to configure routes at the root level
- May require web server/reverse proxy configuration (e.g., nginx, Apache)
- Consider whether this should be handled at the application level or infrastructure level

---

## How to Use This Document

- Add new enhancement ideas as they are identified
- Include context, rationale, and implementation considerations
- Mark items as "Implemented" when completed and reference the commit/PR
- Prioritize items as: Low, Medium, High, or Critical
