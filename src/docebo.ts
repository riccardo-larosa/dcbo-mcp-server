/**
 * Docebo API client
 * Handles authenticated API calls
 */

import { appConfig } from './config.js';
import { tokenManager } from './oauth.js';

export interface DoceboUser {
  user_id: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  [key: string]: unknown; // Allow other fields
}

export interface ListUsersResponse {
  data: {
    items: DoceboUser[];
    total_count: number;
    current_page: number;
    page_size: number;
    has_more_page: boolean;
  };
}

export interface ListUsersParams {
  page?: number;
  page_size?: number;
  sort_attr?: string;
  sort_dir?: 'asc' | 'desc';
  search_text?: string;
}

/**
 * List users from Docebo
 */
export async function listUsers(params: ListUsersParams = {}): Promise<ListUsersResponse> {
  const token = await tokenManager.getToken();

  // Build query string
  const queryParams = new URLSearchParams();
  if (params.page) queryParams.set('page', params.page.toString());
  if (params.page_size) queryParams.set('page_size', params.page_size.toString());
  if (params.sort_attr) queryParams.set('sort_attr', params.sort_attr);
  if (params.sort_dir) queryParams.set('sort_dir', params.sort_dir);
  if (params.search_text) queryParams.set('search_text', params.search_text);

  const url = `${appConfig.docebo.baseUrl}/manage/v1/user?${queryParams.toString()}`;

  console.log('[Docebo] Fetching users from', url);

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Docebo API error: ${response.status} ${response.statusText} - ${text}`
    );
  }

  const data = await response.json() as ListUsersResponse;

  console.log('[Docebo] Retrieved', data.data.items.length, 'users');

  return data;
}
