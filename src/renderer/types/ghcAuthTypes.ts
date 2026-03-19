// src/renderer/types/ghcAuthTypes.ts
export interface GhcUser {
  id: string;
  login: string;
  email: string;
  name: string;
  avatarUrl?: string;
  copilotPlan: 'individual' | 'business' | 'enterprise';
}

export interface GhcSession {
  user: GhcUser;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  copilotCapabilities: string[];
  profilePath: string; // User Profile directory path
}

export interface GhcAuthContextType {
  session: GhcSession | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  loading: boolean;
  isAuthenticated: boolean;
  userProfile: GhcUser | null;
}

export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export interface CopilotTokenResponse {
  token: string;
  expires_at: number;
  refresh_in: number;
  endpoints: {
    api: string;
    proxy: string;
    telemetry: string;
  };
}

// Token persistence configuration
export interface GhcAuthStorage {
  refresh: string;
  access: string;
  expires: number;
  user: GhcUser;
  capabilities: string[];
  lastUpdated: number;
}