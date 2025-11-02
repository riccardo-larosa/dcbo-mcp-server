/**
 * Docebo API client
 * Handles authenticated API calls using client-provided tokens
 */

import { getTenantApiUrl } from './tenants.js';

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
export async function listUsers(params: ListUsersParams = {}, bearerToken: string, tenant: string): Promise<ListUsersResponse> {
  // Get tenant API URL
  const baseUrl = getTenantApiUrl(tenant);

  if (!baseUrl) {
    throw new Error(`Tenant '${tenant}' is not configured`);
  }

  // Build query string
  const queryParams = new URLSearchParams();
  if (params.page) queryParams.set('page', params.page.toString());
  if (params.page_size) queryParams.set('page_size', params.page_size.toString());
  if (params.sort_attr) queryParams.set('sort_attr', params.sort_attr);
  if (params.sort_dir) queryParams.set('sort_dir', params.sort_dir);
  if (params.search_text) queryParams.set('search_text', params.search_text);

  const url = `${baseUrl}/manage/v1/user?${queryParams.toString()}`;

  console.log('[Docebo] Fetching users from', url);

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${bearerToken}`,
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

export interface HarmonySearchParams {
  query: string;
}

export interface HarmonySearchResponse {
  // TODO: Define response structure once API details are provided
  [key: string]: unknown;
}

interface BootstrapResponse {
  data: {
    ai?: {
      geppetto?: {
        chat?: {
          start_url?: string;
          message_stream_url?: string;
        };
      };
    };
    [key: string]: unknown;
  };
}

/**
 * Search Docebo using Harmony Search (RAG)
 * This function will call 2-3 APIs to retrieve comprehensive search results
 */
export async function harmonySearch(params: HarmonySearchParams, bearerToken: string, tenant: string): Promise<HarmonySearchResponse> {
  // Get tenant API URL
  const baseUrl = getTenantApiUrl(tenant);

  if (!baseUrl) {
    throw new Error(`Tenant '${tenant}' is not configured`);
  }

  console.log('[Docebo] Harmony Search query:', params.query);

  // Step 1: Call /manage/v1/site/bootstrap to get Geppetto URLs
  const bootstrapUrl = `${baseUrl}/manage/v1/site/bootstrap`;
  console.log('[Docebo] Fetching bootstrap data from', bootstrapUrl);

  const bootstrapResponse = await fetch(bootstrapUrl, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${bearerToken}`,
      Accept: 'application/json',
    },
  });

  if (!bootstrapResponse.ok) {
    const text = await bootstrapResponse.text();
    throw new Error(
      `Docebo bootstrap API error: ${bootstrapResponse.status} ${bootstrapResponse.statusText} - ${text}`
    );
  }

  const bootstrapData = await bootstrapResponse.json() as BootstrapResponse;

  // Extract Geppetto URLs
  const geppettoStartUrl = bootstrapData.data.ai?.geppetto?.chat?.start_url;
  const geppettoMessageStreamUrl = bootstrapData.data.ai?.geppetto?.chat?.message_stream_url;

  console.log('[Docebo] Geppetto Start URL:', geppettoStartUrl);
  console.log('[Docebo] Geppetto Message Stream URL:', geppettoMessageStreamUrl);

  if (!geppettoStartUrl || !geppettoMessageStreamUrl) {
    throw new Error('Geppetto URLs not found in bootstrap response');
  }

  // Step 2: Get Geppetto authentication token
  const geppettoAuthUrl = `${baseUrl}/manage/v1/globalsearch/ai/auth`;
  console.log('[Docebo] Fetching Geppetto auth token from', geppettoAuthUrl);

  const geppettoAuthResponse = await fetch(geppettoAuthUrl, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${bearerToken}`,
      Accept: 'application/json',
    },
  });

  if (!geppettoAuthResponse.ok) {
    const text = await geppettoAuthResponse.text();
    throw new Error(
      `Docebo Geppetto auth API error: ${geppettoAuthResponse.status} ${geppettoAuthResponse.statusText} - ${text}`
    );
  }

  const geppettoAuthData = await geppettoAuthResponse.json() as { data: { token: string } };
  const geppettoToken = geppettoAuthData.data.token;

  console.log('[Docebo] Geppetto token obtained:', geppettoToken ? '[PRESENT]' : '[MISSING]');

  if (!geppettoToken) {
    throw new Error('Geppetto token not found in auth response');
  }

  // Step 3: Start Geppetto session
  console.log('[Docebo] Starting Geppetto session at', geppettoStartUrl);

  const startSessionResponse = await fetch(geppettoStartUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${geppettoToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({}), // Empty body
  });

  if (!startSessionResponse.ok) {
    const text = await startSessionResponse.text();
    throw new Error(
      `Geppetto start session error: ${startSessionResponse.status} ${startSessionResponse.statusText} - ${text}`
    );
  }

  const startSessionData = await startSessionResponse.json() as { session: string };
  const sessionId = startSessionData.session;

  console.log('[Docebo] Geppetto session started:', sessionId);

  if (!sessionId) {
    throw new Error('Session ID not found in start session response');
  }

  // Step 4: Send the search query via message stream
  console.log('[Docebo] Sending query to message stream:', geppettoMessageStreamUrl);

  const messageBody = {
    message: params.query,
    session: sessionId,
    resources: [],
    enable_general_knowledge: false,
  };

  const messageStreamResponse = await fetch(geppettoMessageStreamUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${geppettoToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(messageBody),
  });

  if (!messageStreamResponse.ok) {
    const text = await messageStreamResponse.text();
    throw new Error(
      `Geppetto message stream error: ${messageStreamResponse.status} ${messageStreamResponse.statusText} - ${text}`
    );
  }

  // The response is Server-Sent Events (SSE) format, read as text
  const streamText = await messageStreamResponse.text();

  // Parse SSE format to extract data
  const lines = streamText.split('\n');
  const events: Array<{ event: string; data: unknown }> = [];
  let currentEvent: { event?: string; data?: string } = {};

  for (const line of lines) {
    if (line.startsWith('event:')) {
      currentEvent.event = line.substring(6).trim();
    } else if (line.startsWith('data:')) {
      currentEvent.data = line.substring(5).trim();
    } else if (line === '' && currentEvent.event) {
      // Empty line marks end of event
      try {
        events.push({
          event: currentEvent.event,
          data: currentEvent.data ? JSON.parse(currentEvent.data) : null,
        });
      } catch (e) {
        // If data is not JSON, store as string
        events.push({
          event: currentEvent.event,
          data: currentEvent.data,
        });
      }
      currentEvent = {};
    }
  }

  console.log('[Docebo] Harmony Search completed successfully');
  console.log('[Docebo] Parsed', events.length, 'events');

  // Return the search results
  return {
    query: params.query,
    sessionId,
    events,
    rawStream: streamText,
  };
}
