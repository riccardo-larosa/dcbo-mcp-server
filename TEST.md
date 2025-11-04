# Testing Guide

This project uses [Vitest](https://vitest.dev/) for testing.

## Running Tests

```bash
# Run all tests once
npm test

# Run tests in watch mode (re-runs on file changes)
npm run test:watch

# Run tests with UI
npm run test:ui

# Run tests with coverage report
npm run test:coverage
```

## Test Structure

```
src/
├── docebo.test.ts       # Unit tests for Docebo API functions
├── mcp.test.ts          # Unit tests for MCP JSON-RPC handlers
└── vitest.config.ts     # Vitest configuration
```

## Test Coverage

### `docebo.test.ts` - Docebo API Functions

- **enrollUser()**
  - ✅ Successful enrollment
  - ✅ Request body construction with defaults
  - ✅ Custom level and assignment_type
  - ✅ API error handling
  - ✅ Unexpected response format
  - ✅ Unconfigured tenant error
  - ✅ Waiting/waitlist enrollments

- **listUsers()**
  - ✅ Successful user listing
  - ✅ Query string building with search parameters

- **harmonySearch()**
  - ✅ SSE event parsing
  - ✅ Missing Geppetto URLs error

### `mcp.test.ts` - MCP JSON-RPC Protocol

- **initialize**
  - ✅ Successful initialization
  - ✅ Invalid JSON-RPC version rejection

- **tools/list**
  - ✅ Returns all available tools

- **tools/call**
  - ✅ docebo_list_users execution
  - ✅ docebo_enroll_user execution
  - ✅ docebo_enroll_user parameter validation
  - ✅ docebo_harmony_search execution

- **Error Handling**
  - ✅ Unknown tool name
  - ✅ Unknown method
  - ✅ Missing required parameters
  - ✅ Exception propagation
  - ✅ Request ID preservation

## Writing New Tests

### Example: Testing a new API function

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { myNewFunction } from './docebo.js';

// Mock fetch globally
global.fetch = vi.fn();

describe('myNewFunction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should handle success case', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: 'test' }),
    } as Response);

    const result = await myNewFunction(params, token, tenant);

    expect(result).toBeDefined();
    expect(fetch).toHaveBeenCalledWith(/* ... */);
  });
});
```

### Example: Testing a new MCP tool

```typescript
import { describe, it, expect, vi } from 'vitest';
import { handleMcpRequest } from './mcp.js';

vi.mock('./docebo.js', () => ({
  myNewTool: vi.fn(),
}));

describe('tools/call - my_new_tool', () => {
  it('should call myNewTool and return results', async () => {
    const request = {
      jsonrpc: '2.0' as const,
      id: 1,
      method: 'tools/call',
      params: {
        name: 'my_new_tool',
        arguments: { param: 'value' },
      },
    };

    const response = await handleMcpRequest(request, 'token', 'tenant');

    expect('result' in response && response.result).toBeDefined();
  });
});
```

## Best Practices

1. **Use mocks for external dependencies** - Mock `fetch` for API calls
2. **Clear mocks between tests** - Use `beforeEach(() => vi.clearAllMocks())`
3. **Test both success and error cases** - Don't just test the happy path
4. **Test edge cases** - Missing parameters, invalid data, etc.
5. **Keep tests focused** - One assertion per test when possible
6. **Use descriptive test names** - Make it clear what is being tested

## Continuous Integration

Tests run automatically on:
- Every commit (pre-commit hook - if configured)
- Pull requests (GitHub Actions - if configured)
- Before deployment

## Coverage Goals

- **Unit tests**: 80%+ coverage
- **Critical paths**: 100% coverage (enrollment, authentication)
- **Error handling**: All error paths tested
