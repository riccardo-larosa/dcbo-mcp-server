/**
 * MCP JSON-RPC handler
 * Implements minimal MCP protocol with one tool: docebo.list_users
 */

import { listUsers, ListUsersParams, harmonySearch, HarmonySearchParams, enrollUser, EnrollUserParams } from './docebo.js';

// JSON-RPC types
interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: unknown;
}

interface JsonRpcSuccessResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result: unknown;
}

interface JsonRpcErrorResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;

// MCP protocol types
interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

// Error codes per JSON-RPC 2.0 spec
const ERROR_CODES = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
};

/**
 * Available MCP tools
 */
const TOOLS: ToolDefinition[] = [
  {
    name: 'docebo_list_users',
    description: 'List users from Docebo LMS. Returns paginated user data.',
    inputSchema: {
      type: 'object',
      properties: {
        page: {
          type: 'number',
          description: 'Page number (1-indexed)',
        },
        page_size: {
          type: 'number',
          description: 'Number of users per page (default: 200, max: 200)',
        },
        sort_attr: {
          type: 'string',
          description: 'Attribute to sort by (e.g., "user_id", "username")',
        },
        sort_dir: {
          type: 'string',
          enum: ['asc', 'desc'],
          description: 'Sort direction',
        },
        search_text: {
          type: 'string',
          description: 'Search filter for username or email',
        },
      },
    },
  },
  {
    name: 'docebo_harmony_search',
    description: 'Search Docebo Learning Management System',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query text',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'docebo_enroll_user',
    description: 'Enroll a user in a Docebo course. Requires user ID and course ID.',
    inputSchema: {
      type: 'object',
      properties: {
        user_id: {
          type: 'number',
          description: 'User ID (numeric)',
        },
        course_id: {
          type: 'number',
          description: 'Course ID (numeric)',
        },
        level: {
          type: 'number',
          enum: [3, 4, 6],
          description: 'Enrollment level: 3=student (default), 4=tutor, 6=instructor',
        },
        assignment_type: {
          type: 'string',
          enum: ['mandatory', 'required', 'recommended', 'optional'],
          description: 'Assignment type (optional)',
        },
        date_begin_validity: {
          type: 'string',
          description: 'Start date for enrollment validity (yyyy-mm-dd format, optional)',
        },
        date_expire_validity: {
          type: 'string',
          description: 'Expiration date for enrollment (yyyy-mm-dd format, optional)',
        },
      },
      required: ['user_id', 'course_id'],
    },
  },
];

/**
 * Handle MCP JSON-RPC requests
 */
export async function handleMcpRequest(request: JsonRpcRequest, bearerToken: string, tenant: string): Promise<JsonRpcResponse> {
  const requestId = request.id ?? null;

  // Validate JSON-RPC version
  if (request.jsonrpc !== '2.0') {
    return {
      jsonrpc: '2.0',
      id: requestId,
      error: {
        code: ERROR_CODES.INVALID_REQUEST,
        message: 'Invalid JSON-RPC version. Must be "2.0"',
      },
    };
  }

  console.log('[MCP] Handling request:', request.method);

  try {
    switch (request.method) {
      case 'initialize':
        return {
          jsonrpc: '2.0',
          id: requestId,
          result: {
            protocolVersion: '2025-03-26',
            serverInfo: {
              name: 'docebo-mcp-server',
              version: '1.0.0',
            },
            capabilities: {
              tools: {},
            },
          },
        };

      case 'tools/list':
        return {
          jsonrpc: '2.0',
          id: requestId,
          result: {
            tools: TOOLS,
          },
        };

      case 'tools/call': {
        const params = request.params as { name?: string; arguments?: unknown };

        if (!params?.name) {
          return {
            jsonrpc: '2.0',
            id: requestId,
            error: {
              code: ERROR_CODES.INVALID_PARAMS,
              message: 'Missing required parameter: name',
            },
          };
        }

        // Route to tool handler
        if (params.name === 'docebo_list_users') {
          const toolArgs = (params.arguments as ListUsersParams) || {};
          const result = await listUsers(toolArgs, bearerToken, tenant);

          return {
            jsonrpc: '2.0',
            id: requestId,
            result: {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(result, null, 2),
                },
              ],
            },
          };
        }

        if (params.name === 'docebo_harmony_search') {
          const toolArgs = (params.arguments as HarmonySearchParams) || { query: '' };
          const result = await harmonySearch(toolArgs, bearerToken, tenant);

          return {
            jsonrpc: '2.0',
            id: requestId,
            result: {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(result, null, 2),
                },
              ],
            },
          };
        }

        if (params.name === 'docebo_enroll_user') {
          const toolArgs = params.arguments as EnrollUserParams;

          if (!toolArgs?.user_id || !toolArgs?.course_id) {
            return {
              jsonrpc: '2.0',
              id: requestId,
              error: {
                code: ERROR_CODES.INVALID_PARAMS,
                message: 'Missing required parameters: user_id and course_id',
              },
            };
          }

          const result = await enrollUser(toolArgs, bearerToken, tenant);

          return {
            jsonrpc: '2.0',
            id: requestId,
            result: {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(result, null, 2),
                },
              ],
            },
          };
        }

        return {
          jsonrpc: '2.0',
          id: requestId,
          error: {
            code: ERROR_CODES.METHOD_NOT_FOUND,
            message: `Unknown tool: ${params.name}`,
          },
        };
      }

      default:
        return {
          jsonrpc: '2.0',
          id: requestId,
          error: {
            code: ERROR_CODES.METHOD_NOT_FOUND,
            message: `Method not found: ${request.method}`,
          },
        };
    }
  } catch (error) {
    console.error('[MCP] Error handling request:', error);

    return {
      jsonrpc: '2.0',
      id: requestId,
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: error instanceof Error ? error.message : 'Internal error',
        data: error instanceof Error ? error.stack : undefined,
      },
    };
  }
}
