// src/renderer/types/authTypes.ts - V3.0 adapted for new auth.json format
// Renderer process auth type definitions, consistent with main process

/**
 * Unique authentication data structure - AuthData
 * Fully consistent with main process, used throughout the authentication flow
 *
 * V3.0 New token structure (no backward compatibility):
 * - gitHubTokens: obtained from GitHub OAuth, contains full token info (no expires field, validity checked via getUserInfo)
 * - copilotTokens: obtained from Copilot API, expires_at is a seconds-level timestamp
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
 * AuthManager interface definition (renderer process)
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
 * Authentication recovery check result
 */
export interface AuthRecoveryResult {
  isRecoverable: boolean;
  authData?: AuthData;
  errorType?: string;
  message?: string;
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

/**
 * Device Code Flow related types
 */
export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export interface DeviceFlowAuthResult {
  success: boolean;
  authData?: AuthData;
  error?: string;
  newInterval?: number;
}

/**
 * Auth Context type (for React Context)
 */
export interface AuthContextType {
  authData: AuthData | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  loading: boolean;
  isAuthenticated: boolean;
  user: AuthData['ghcAuth']['user'] | null;
  getCopilotToken: () => string | null;
  getGitHubToken: () => string | null;
}