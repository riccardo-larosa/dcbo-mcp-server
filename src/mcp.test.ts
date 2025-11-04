/**
 * Unit tests for MCP JSON-RPC handler
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleMcpRequest } from './mcp.js';

// Mock the docebo module
vi.mock('./docebo.js', () => ({
  listUsers: vi.fn(),
  enrollUser: vi.fn(),
  harmonySearch: vi.fn(),
}));

import { listUsers, enrollUser, harmonySearch } from './docebo.js';

describe('handleMcpRequest', () => {
  const mockBearerToken = 'test-token-123';
  const mockTenant = 'riccardo-lr-test';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('initialize', () => {
    it('should handle initialize request', async () => {
      const request = {
        jsonrpc: '2.0' as const,
        id: 1,
        method: 'initialize',
        params: {},
      };

      const response = await handleMcpRequest(request, mockBearerToken, mockTenant);

      expect(response.jsonrpc).toBe('2.0');
      expect(response.id).toBe(1);
      expect('result' in response && response.result).toEqual({
        protocolVersion: '2025-03-26',
        serverInfo: {
          name: 'docebo-mcp-server',
          version: '1.0.0',
        },
        capabilities: {
          tools: {},
        },
      });
    });

    it('should reject invalid JSON-RPC version', async () => {
      const request = {
        jsonrpc: '1.0' as any,
        id: 1,
        method: 'initialize',
      };

      const response = await handleMcpRequest(request, mockBearerToken, mockTenant);

      expect('error' in response && response.error).toBeDefined();
      expect('error' in response && response.error.code).toBe(-32600);
      expect('error' in response && response.error.message).toContain('Invalid JSON-RPC version');
    });
  });

  describe('tools/list', () => {
    it('should return list of available tools', async () => {
      const request = {
        jsonrpc: '2.0' as const,
        id: 2,
        method: 'tools/list',
      };

      const response = await handleMcpRequest(request, mockBearerToken, mockTenant);

      expect('result' in response && response.result).toHaveProperty('tools');
      const tools = 'result' in response && response.result && (response.result as any).tools;
      expect(tools).toHaveLength(3);
      expect(tools[0].name).toBe('docebo_list_users');
      expect(tools[1].name).toBe('docebo_harmony_search');
      expect(tools[2].name).toBe('docebo_enroll_user');
    });
  });

  describe('tools/call - docebo_list_users', () => {
    it('should call listUsers and return results', async () => {
      const mockUserData = {
        data: {
          items: [{ user_id: 1, username: 'test' }],
          total_count: 1,
          current_page: 1,
          page_size: 200,
          has_more_page: false,
        },
      };

      vi.mocked(listUsers).mockResolvedValueOnce(mockUserData);

      const request = {
        jsonrpc: '2.0' as const,
        id: 3,
        method: 'tools/call',
        params: {
          name: 'docebo_list_users',
          arguments: { page: 1 },
        },
      };

      const response = await handleMcpRequest(request, mockBearerToken, mockTenant);

      expect(listUsers).toHaveBeenCalledWith({ page: 1 }, mockBearerToken, mockTenant);
      expect('result' in response && response.result).toHaveProperty('content');
      const content = 'result' in response && response.result && (response.result as any).content;
      expect(content[0].type).toBe('text');
      expect(JSON.parse(content[0].text)).toEqual(mockUserData);
    });
  });

  describe('tools/call - docebo_enroll_user', () => {
    it('should call enrollUser and return results', async () => {
      const mockEnrollmentResult = {
        success: true,
        enrolled: { id_user: 123, id_course: 456, waiting: false },
      };

      vi.mocked(enrollUser).mockResolvedValueOnce(mockEnrollmentResult);

      const request = {
        jsonrpc: '2.0' as const,
        id: 4,
        method: 'tools/call',
        params: {
          name: 'docebo_enroll_user',
          arguments: { user_id: 123, course_id: 456 },
        },
      };

      const response = await handleMcpRequest(request, mockBearerToken, mockTenant);

      expect(enrollUser).toHaveBeenCalledWith(
        { user_id: 123, course_id: 456 },
        mockBearerToken,
        mockTenant
      );
      expect('result' in response && response.result).toHaveProperty('content');
    });

    it('should validate required parameters', async () => {
      const request = {
        jsonrpc: '2.0' as const,
        id: 5,
        method: 'tools/call',
        params: {
          name: 'docebo_enroll_user',
          arguments: { user_id: 123 }, // Missing course_id
        },
      };

      const response = await handleMcpRequest(request, mockBearerToken, mockTenant);

      expect('error' in response && response.error).toBeDefined();
      expect('error' in response && response.error.code).toBe(-32602);
      expect('error' in response && response.error.message).toContain(
        'Missing required parameters'
      );
      expect(enrollUser).not.toHaveBeenCalled();
    });

    it('should validate missing user_id', async () => {
      const request = {
        jsonrpc: '2.0' as const,
        id: 6,
        method: 'tools/call',
        params: {
          name: 'docebo_enroll_user',
          arguments: { course_id: 456 }, // Missing user_id
        },
      };

      const response = await handleMcpRequest(request, mockBearerToken, mockTenant);

      expect('error' in response && response.error).toBeDefined();
      expect('error' in response && response.error.code).toBe(-32602);
      expect(enrollUser).not.toHaveBeenCalled();
    });
  });

  describe('tools/call - docebo_harmony_search', () => {
    it('should call harmonySearch and return results', async () => {
      const mockSearchResult = {
        query: 'test query',
        sessionId: 'session-123',
        events: [],
      };

      vi.mocked(harmonySearch).mockResolvedValueOnce(mockSearchResult);

      const request = {
        jsonrpc: '2.0' as const,
        id: 7,
        method: 'tools/call',
        params: {
          name: 'docebo_harmony_search',
          arguments: { query: 'test query' },
        },
      };

      const response = await handleMcpRequest(request, mockBearerToken, mockTenant);

      expect(harmonySearch).toHaveBeenCalledWith(
        { query: 'test query' },
        mockBearerToken,
        mockTenant
      );
      expect('result' in response && response.result).toHaveProperty('content');
    });
  });

  describe('error handling', () => {
    it('should handle unknown tool name', async () => {
      const request = {
        jsonrpc: '2.0' as const,
        id: 8,
        method: 'tools/call',
        params: {
          name: 'unknown_tool',
          arguments: {},
        },
      };

      const response = await handleMcpRequest(request, mockBearerToken, mockTenant);

      expect('error' in response && response.error).toBeDefined();
      expect('error' in response && response.error.code).toBe(-32601);
      expect('error' in response && response.error.message).toContain('Unknown tool');
    });

    it('should handle unknown method', async () => {
      const request = {
        jsonrpc: '2.0' as const,
        id: 9,
        method: 'unknown/method',
      };

      const response = await handleMcpRequest(request, mockBearerToken, mockTenant);

      expect('error' in response && response.error).toBeDefined();
      expect('error' in response && response.error.code).toBe(-32601);
      expect('error' in response && response.error.message).toContain('Method not found');
    });

    it('should handle missing tool name in tools/call', async () => {
      const request = {
        jsonrpc: '2.0' as const,
        id: 10,
        method: 'tools/call',
        params: {
          arguments: {},
        },
      };

      const response = await handleMcpRequest(request, mockBearerToken, mockTenant);

      expect('error' in response && response.error).toBeDefined();
      expect('error' in response && response.error.code).toBe(-32602);
      expect('error' in response && response.error.message).toContain('Missing required parameter: name');
    });

    it('should handle exceptions from tools', async () => {
      vi.mocked(listUsers).mockRejectedValueOnce(new Error('API connection failed'));

      const request = {
        jsonrpc: '2.0' as const,
        id: 11,
        method: 'tools/call',
        params: {
          name: 'docebo_list_users',
          arguments: {},
        },
      };

      const response = await handleMcpRequest(request, mockBearerToken, mockTenant);

      expect('error' in response && response.error).toBeDefined();
      expect('error' in response && response.error.code).toBe(-32603);
      expect('error' in response && response.error.message).toBe('API connection failed');
      expect('error' in response && response.error.data).toBeDefined();
    });
  });

  describe('request ID handling', () => {
    it('should preserve request ID in response', async () => {
      const request = {
        jsonrpc: '2.0' as const,
        id: 'custom-id-123',
        method: 'initialize',
      };

      const response = await handleMcpRequest(request, mockBearerToken, mockTenant);

      expect(response.id).toBe('custom-id-123');
    });

    it('should handle null request ID', async () => {
      const request = {
        jsonrpc: '2.0' as const,
        id: null,
        method: 'initialize',
      };

      const response = await handleMcpRequest(request, mockBearerToken, mockTenant);

      expect(response.id).toBeNull();
    });
  });
});
