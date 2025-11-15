/**
 * Unit tests for Docebo API client functions
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { enrollUser, listUsers, harmonySearch } from './docebo.js';
import * as tenants from './tenants.js';

// Mock dependencies
vi.mock('./tenants.js');
global.fetch = vi.fn();

describe('enrollUser', () => {
  const mockBearerToken = 'test-token-123';
  const mockTenant = 'riccardo-lr-test';

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock tenant API URL
    vi.mocked(tenants.getTenantApiUrl).mockReturnValue(
      `https://${mockTenant}.docebosaas.com`
    );
  });

  it('should successfully enroll a user in a course', async () => {
    const mockResponse = {
      data: {
        errors: [
          {
            enrolled: [
              {
                id_user: 123,
                id_course: 456,
                waiting: false,
              },
            ],
          },
        ],
      },
    };

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    } as Response);

    const result = await enrollUser(
      { user_id: 123, course_id: 456 },
      mockBearerToken,
      mockTenant
    );

    expect(result.success).toBe(true);
    expect(result.enrolled).toEqual({
      id_user: 123,
      id_course: 456,
      waiting: false,
    });
  });

  it('should build correct enrollment request body with defaults', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          errors: [{ enrolled: [{ id_user: 123, id_course: 456, waiting: false }] }],
        },
      }),
    } as Response);

    await enrollUser({ user_id: 123, course_id: 456 }, mockBearerToken, mockTenant);

    expect(fetch).toHaveBeenCalledWith(
      'https://riccardo-lr-test.docebosaas.com/learn/v1/enrollments',
      expect.objectContaining({
        method: 'POST',
        headers: {
          Authorization: `Bearer ${mockBearerToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          user_ids: [123],
          course_ids: [456],
          level: 3, // Default to student
          assignment_type: undefined,
          date_begin_validity: undefined,
          date_expire_validity: undefined,
          consider_ef_as_optional: true,
        }),
      })
    );
  });

  it('should use custom level and assignment_type when provided', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          errors: [{ enrolled: [{ id_user: 123, id_course: 456, waiting: false }] }],
        },
      }),
    } as Response);

    await enrollUser(
      {
        user_id: 123,
        course_id: 456,
        level: 6, // Instructor
        assignment_type: 'mandatory',
      },
      mockBearerToken,
      mockTenant
    );

    const callBody = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
    expect(callBody.level).toBe(6);
    expect(callBody.assignment_type).toBe('mandatory');
  });

  it('should handle API error responses', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      text: async () => 'Invalid course ID',
    } as Response);

    await expect(
      enrollUser({ user_id: 123, course_id: 999 }, mockBearerToken, mockTenant)
    ).rejects.toThrow('Docebo enrollment API error: 400 Bad Request - Invalid course ID');
  });

  it('should handle unexpected response format', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: {} }), // Missing errors array
    } as Response);

    const result = await enrollUser(
      { user_id: 123, course_id: 456 },
      mockBearerToken,
      mockTenant
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe('Enrollment failed or returned unexpected response');
  });

  it('should throw error for unconfigured tenant', async () => {
    // Mock the tenant API URL to return null for invalid tenant
    vi.mocked(tenants.getTenantApiUrl).mockReturnValue(null);

    await expect(
      enrollUser({ user_id: 123, course_id: 456 }, mockBearerToken, 'invalid-tenant')
    ).rejects.toThrow("Tenant 'invalid-tenant' is not configured");
  });

  it('should handle waiting enrollments', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          errors: [
            {
              enrolled: [
                {
                  id_user: 123,
                  id_course: 456,
                  waiting: true, // User is on waitlist
                },
              ],
            },
          ],
        },
      }),
    } as Response);

    const result = await enrollUser(
      { user_id: 123, course_id: 456 },
      mockBearerToken,
      mockTenant
    );

    expect(result.success).toBe(true);
    expect(result.enrolled?.waiting).toBe(true);
  });
});

describe('listUsers', () => {
  const mockBearerToken = 'test-token-123';
  const mockTenant = 'riccardo-lr-test';

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock tenant API URL
    vi.mocked(tenants.getTenantApiUrl).mockReturnValue(
      `https://${mockTenant}.docebosaas.com`
    );
  });

  it('should list users successfully', async () => {
    const mockResponse = {
      data: {
        items: [
          {
            user_id: 1,
            username: 'john.doe',
            email: 'john@example.com',
            first_name: 'John',
            last_name: 'Doe',
          },
        ],
        total_count: 1,
        current_page: 1,
        page_size: 200,
        has_more_page: false,
      },
    };

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    } as Response);

    const result = await listUsers({}, mockBearerToken, mockTenant);

    expect(result.data.items).toHaveLength(1);
    expect(result.data.items[0].username).toBe('john.doe');
  });

  it('should build query string with search parameters', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { items: [], total_count: 0 } }),
    } as Response);

    await listUsers(
      {
        page: 2,
        page_size: 50,
        search_text: 'john',
        sort_attr: 'username',
        sort_dir: 'asc',
      },
      mockBearerToken,
      mockTenant
    );

    const callUrl = vi.mocked(fetch).mock.calls[0][0] as string;
    expect(callUrl).toContain('page=2');
    expect(callUrl).toContain('page_size=50');
    expect(callUrl).toContain('search_text=john');
    expect(callUrl).toContain('sort_attr=username');
    expect(callUrl).toContain('sort_dir=asc');
  });
});

describe('harmonySearch', () => {
  const mockBearerToken = 'test-token-123';
  const mockTenant = 'riccardo-lr-test';

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock tenant API URL
    vi.mocked(tenants.getTenantApiUrl).mockReturnValue(
      `https://${mockTenant}.docebosaas.com`
    );
  });

  it('should parse SSE events correctly', async () => {
    // Mock bootstrap response
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          ai: {
            geppetto: {
              chat: {
                start_url: 'https://geppetto.example.com/start',
                message_stream_url: 'https://geppetto.example.com/stream',
              },
            },
          },
        },
      }),
    } as Response);

    // Mock geppetto auth response
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { token: 'geppetto-token' } }),
    } as Response);

    // Mock session start response
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ session: 'session-123' }),
    } as Response);

    // Mock SSE stream response
    const sseData = `event: token
data: {"text":"Hello"}

event: complete
data: {"done":true}

`;

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      text: async () => sseData,
    } as Response);

    const result = await harmonySearch({ query: 'test query' }, mockBearerToken, mockTenant);

    expect(result.query).toBe('test query');
    expect(result.sessionId).toBe('session-123');
    expect(result.events).toHaveLength(2);
    expect(result.events[0].event).toBe('token');
    expect(result.events[1].event).toBe('complete');
  });

  it('should throw error if Geppetto URLs not found', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: {} }), // No AI data
    } as Response);

    await expect(
      harmonySearch({ query: 'test' }, mockBearerToken, mockTenant)
    ).rejects.toThrow('Geppetto URLs not found in bootstrap response');
  });
});
