/**
 * OAuth2 token manager for Docebo
 * Handles password grant flow with in-memory caching and refresh tokens
 */

import { appConfig } from './config.js';

interface TokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
  refresh_token?: string;
}

interface CachedToken {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number; // Unix timestamp in milliseconds
}

class TokenManager {
  private cache: CachedToken | null = null;
  private refreshPromise: Promise<string> | null = null;

  /**
   * Get a valid access token, refreshing if necessary
   */
  async getToken(): Promise<string> {
    // Return cached token if still valid (with 60s buffer)
    if (this.cache && this.cache.expiresAt > Date.now() + 60_000) {
      return this.cache.accessToken;
    }

    // If already refreshing, wait for that promise
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    // Start new refresh
    this.refreshPromise = this.fetchNewToken();
    try {
      const token = await this.refreshPromise;
      return token;
    } finally {
      this.refreshPromise = null;
    }
  }

  /**
   * Fetch a new token from Docebo OAuth2 endpoint using password grant
   */
  private async fetchNewToken(): Promise<string> {
    const url = `${appConfig.docebo.baseUrl}/oauth2/token`;

    const body = new URLSearchParams({
      grant_type: 'password',
      client_id: appConfig.docebo.clientId,
      client_secret: appConfig.docebo.clientSecret,
      username: appConfig.docebo.username,
      password: appConfig.docebo.password,
      scope: 'api',
    });

    console.log('[OAuth] Fetching new token from', url);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `Docebo OAuth2 failed: ${response.status} ${response.statusText} - ${text}`
      );
    }

    const data = await response.json() as TokenResponse;

    // Cache with expiry and refresh token
    const expiresAt = Date.now() + data.expires_in * 1000;
    this.cache = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt,
    };

    console.log('[OAuth] Token acquired, expires at', new Date(expiresAt).toISOString());

    return data.access_token;
  }

  /**
   * Clear cached token (useful for testing or manual refresh)
   */
  clearCache(): void {
    this.cache = null;
  }
}

// Singleton instance
export const tokenManager = new TokenManager();
