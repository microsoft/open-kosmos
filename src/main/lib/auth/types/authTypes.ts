// src/main/lib/auth/types/authTypes.ts - V3.0 adapted for new auth.json format

/**
 * The sole authentication data structure - AuthData
 * Used throughout the entire auth flow, from auth.json to memory to IPC communication
 *
 * V3.0 new Token structure (no backward compatibility):
 * - gitHubTokens: Obtained from GitHub OAuth, contains complete token info (no expires field, validity verified via getUserInfo)
 * - copilotTokens: Obtained from Copilot API, expires_at is a seconds-level timestamp
 */
export interface AuthData {
  version: string;
  createdAt: string;
  updatedAt: string;
  authProvider: string;
  ghcAuth: {
    alias: string;
    user: {
      id: string;
      login: string;
      email: string;
      name: string;
      avatarUrl: string;
      copilotPlan: 'individual' | 'business' | 'enterprise';
    };
    gitHubTokens: {
      timestamp: string;
      api_url: string;
      access_token: string;
      token_type: string;
      scope: string;
    };
    copilotTokens: {
      timestamp: string;
      api_url: string;
      expires_at: number; // Seconds-level timestamp
      token: string;
    };
    capabilities: string[];
  };
}

/**
 * Token refresh result
 */
export interface TokenRefreshResult {
  success: boolean;
  authData?: AuthData;
  error?: string;
  requiresReauth?: boolean;
  errorType?: string;
  httpStatus?: number;
}

/**
 * AuthManager interface definition
 */
export interface IAuthManager {
  setCurrentAuth(authData: AuthData): Promise<void>;
  getCurrentAuth(): AuthData | null;
  destroyCurrentAuth(): Promise<void>;
  getCopilotAccessToken(): string | null;
  getGitHubAccessToken(): string | null;
  getLocalActiveAuths(): Promise<AuthData[]>;
  refreshCopilotToken(): Promise<TokenRefreshResult>;
}

/**
 * Profile scan result type
 */
export interface ProfileWithExpiredAuth {
  alias: string;
  reason: string;
}

export interface ProfileWithInvalidAuth {
  alias: string;
  reason: string;
}

export interface ValidAuthsForSignin {
  validAuths: AuthData[];
  expiredAuths: ProfileWithExpiredAuth[];
  invalidAuths: ProfileWithInvalidAuth[];
}

/**
 * Profile with auth type
 */
export interface ProfileWithAuth {
  alias: string;
  authData: AuthData;
}