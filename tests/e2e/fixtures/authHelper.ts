import type { ElectronApplication } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

// ==================== V3 AuthData Type Definitions ====================

/**
 * V3 AuthData structure (matches hasValidGhcAuth validation rules in src/main/lib/auth/authManager.ts)
 *
 * Validation requirements:
 * - ghcAuth.user.id     — non-empty string
 * - ghcAuth.user.login  — non-empty string
 * - ghcAuth.user.name   — non-empty string
 * - ghcAuth.gitHubTokens.access_token — non-empty string
 * - ghcAuth.copilotTokens.token       — non-empty string
 * - ghcAuth.copilotTokens.expires_at  — positive integer
 */
export interface MockGhcUser {
  id: string;
  login: string;
  email: string;
  name: string;
  avatarUrl: string;
  copilotPlan: string;
}

export interface MockGitHubTokens {
  timestamp: string;
  api_url: string;
  access_token: string;
  token_type: string;
  scope: string;
}

export interface MockCopilotTokens {
  timestamp: string;
  api_url: string;
  expires_at: number;
  token: string;
}

export interface MockGhcAuth {
  alias: string;
  user: MockGhcUser;
  gitHubTokens: MockGitHubTokens;
  copilotTokens: MockCopilotTokens;
  capabilities: string[];
}

export interface MockAuthData {
  version: string;
  createdAt: string;
  updatedAt: string;
  authProvider: string;
  ghcAuth: MockGhcAuth;
}

// ==================== Mock Data Retrieval Functions ====================

/**
 * Read mock-data JSON file and return V3 AuthData object
 * Alias can be dynamically adjusted
 *
 * @param alias - User alias (defaults to the value in JSON)
 * @returns V3 AuthData object
 */
export function getMockAuthData(alias?: string): MockAuthData {
  const jsonPath = path.resolve(
    __dirname,
    '../mock-data/auth-single-user.json',
  );
  const rawData = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));

  if (alias) {
    rawData.ghcAuth.alias = alias;
    rawData.ghcAuth.user.login = alias;
    rawData.ghcAuth.user.name = `E2E User ${alias}`;
  }

  return rawData as MockAuthData;
}

/**
 * Get mock AuthData for the second user (for multi-user scenarios)
 *
 * @returns V3 AuthData object (2nd user)
 */
export function getMockAuthDataUser2(): MockAuthData {
  const jsonPath = path.resolve(
    __dirname,
    '../mock-data/auth-multi-user-1.json',
  );
  return JSON.parse(fs.readFileSync(jsonPath, 'utf-8')) as MockAuthData;
}

/**
 * Write AuthData list to userData directory, creating the complete profile directory structure
 *
 * Created file structure:
 * {userDataDir}/profiles/{alias}/
 *   ├── auth.json       — V3 AuthData
 *   ├── profile.json    — basic profile data
 *   ├── chatSessions/   — chat history directory
 *   └── skills/         — skills directory
 *
 * @param userDataDir - test userData directory path
 * @param authDataList - AuthData list to write
 */
export function seedUserDataDir(
  userDataDir: string,
  authDataList: MockAuthData[],
): void {
  for (const authData of authDataList) {
    const alias = authData.ghcAuth.alias;
    const profileDir = path.join(userDataDir, 'profiles', alias);

    // Create directory structure
    fs.mkdirSync(profileDir, { recursive: true });
    fs.mkdirSync(path.join(profileDir, 'chatSessions'), { recursive: true });
    fs.mkdirSync(path.join(profileDir, 'skills'), { recursive: true });

    // Write auth.json (complete V3 AuthData)
    fs.writeFileSync(
      path.join(profileDir, 'auth.json'),
      JSON.stringify(authData, null, 2),
    );

    // Write basic profile.json
    const profileData = getMockProfileData(alias);
    fs.writeFileSync(
      path.join(profileDir, 'profile.json'),
      JSON.stringify(profileData, null, 2),
    );
  }
}

/**
 * Return mock profile.json content
 *
 * @param alias - user alias
 * @returns profile.json data object
 */
export function getMockProfileData(alias: string): Record<string, unknown> {
  return {
    version: 2,
    alias,
    freDone: true,
    primaryAgent: 'Kobi',
    chatConfigs: [],
    chats: [
      {
        chat_id: 'mock-chat-kobi',
        agent: {
          name: 'Kobi',
          emoji: '🤖',
          description: 'Your AI Assistant',
          system_prompt: 'You are Kobi, an AI assistant.',
        },
        sessions: [],
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      },
    ],
    agents: [
      {
        name: 'Kobi',
        emoji: '🤖',
        description: 'Your AI Assistant',
        system_prompt: 'You are Kobi, an AI assistant.',
      },
    ],
    mcpServers: [],
    mcp_servers: [],
    skills: [],
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
  };
}

/**
 * Return mock DeviceCodeResponse (simulates GitHub OAuth device code)
 *
 * @returns DeviceCodeResponse object
 */
export function getMockDeviceCode(): Record<string, unknown> {
  return {
    device_code: 'mock_device_code_xyz',
    user_code: 'ABCD-1234',
    verification_uri: 'https://github.com/login/device',
    expires_in: 900,
    interval: 5,
  };
}

/**
 * Return mock authInfo for device flow success response (for auth:deviceFlowSuccess event)
 *
 * @param alias - user alias
 * @returns AuthData after successful device flow
 */
export function getMockDeviceFlowSuccessAuthInfo(
  alias?: string,
): MockAuthData {
  return getMockAuthData(alias);
}

// ==================== IPC Mock Injection Functions ====================

/**
 * Bypass authentication via IPC Mock (V3 version)
 * Inject mock handlers in the Electron main process so the app thinks the user is logged in
 *
 * @param electronApp - Playwright ElectronApplication instance
 * @param authDataList - mock AuthData list to return
 */
export async function mockAuthIpcHandlers(
  electronApp: ElectronApplication,
  authDataList: MockAuthData[],
): Promise<void> {
  await electronApp.evaluate(
    async ({ ipcMain }, dataList) => {
      const safeHandle = (
        channel: string,
        handler: (...args: any[]) => any,
      ) => {
        try {
          ipcMain.removeHandler(channel);
        } catch {
          // handler may not exist, ignore error
        }
        ipcMain.handle(channel, handler);
      };

      // Mock auth:getLocalActiveSessions → return pre-seeded user list
      // This is the key mock that prevents real GitHub API calls
      // All return values must use { success: true, data: ... } envelope format
      safeHandle('auth:getLocalActiveSessions', () => ({
        success: true,
        data: dataList,
      }));

      // Mock auth:setCurrentSession → success (skip real post-auth initialization)
      safeHandle('auth:setCurrentSession', () => ({
        success: true,
      }));

      // Mock auth:getCurrentSession → return first user (if any)
      safeHandle('auth:getCurrentSession', () => ({
        success: true,
        data: dataList.length > 0 ? dataList[0] : null,
      }));

      // Mock auth:signOut → success
      safeHandle('auth:signOut', () => ({
        success: true,
      }));

      // Mock auth:startGhcDeviceFlow → do not actually start device flow (tests manually push events)
      safeHandle('auth:startGhcDeviceFlow', () => ({
        success: true,
        message: 'Mock: device flow started (no real API call)',
      }));

      // Mock auth:getAccessToken → return mock token
      safeHandle('auth:getAccessToken', () => ({
        success: true,
        data: 'mock_copilot_access_token',
      }));

      // Mock auth:refreshCurrentSessionToken → success
      safeHandle('auth:refreshCurrentSessionToken', () => ({
        success: true,
      }));

      // Mock auth:stopTokenMonitoring → success
      safeHandle('auth:stopTokenMonitoring', () => ({
        success: true,
      }));

      // Mock auth:getMonitoringStatus → not monitoring
      safeHandle('auth:getMonitoringStatus', () => ({
        success: true,
        data: { isMonitoring: false },
      }));

      // Mock auth:destroyCurrentSession → success
      safeHandle('auth:destroyCurrentSession', () => ({
        success: true,
      }));

      // Mock signin:getProfilesWithGhcAuth → return profile list
      safeHandle('signin:getProfilesWithGhcAuth', () => ({
        success: true,
        data: dataList.map((d: any) => ({
          alias: d.ghcAuth?.alias,
          authData: d,
          hasValidAuth: true,
        })),
      }));
    },
    authDataList,
  );
}

/**
 * Mock IPC handlers for empty user environment (for device flow tests)
 *
 * @param electronApp - Playwright ElectronApplication instance
 */
export async function mockEmptyAuthIpcHandlers(
  electronApp: ElectronApplication,
): Promise<void> {
  await mockAuthIpcHandlers(electronApp, []);
}

/**
 * Clear auth mocks in the main process, restoring real behavior
 *
 * @param electronApp - Playwright ElectronApplication instance
 * @param channels - list of IPC channels to clear
 */
export async function clearAuthMocks(
  electronApp: ElectronApplication,
  channels: string[] = [
    'auth:getLocalActiveSessions',
    'auth:setCurrentSession',
    'auth:getCurrentSession',
    'auth:signOut',
    'auth:startGhcDeviceFlow',
    'auth:getAccessToken',
    'auth:refreshCurrentSessionToken',
    'auth:stopTokenMonitoring',
    'auth:getMonitoringStatus',
    'auth:destroyCurrentSession',
    'signin:getProfilesWithGhcAuth',
  ],
): Promise<void> {
  await electronApp.evaluate(
    async ({ ipcMain }, channelList) => {
      for (const channel of channelList) {
        try {
          ipcMain.removeHandler(channel);
        } catch {
          // ignore
        }
      }
    },
    channels,
  );
}

// ==================== Backward-Compatible Legacy Functions ====================

/**
 * Pre-seed auth data to test userData directory (backward compatible with old version)
 * @deprecated Use seedUserDataDir + getMockAuthData instead
 */
export function seedAuthData(
  userDataDir: string,
  options?: {
    alias?: string;
    githubToken?: string;
    copilotToken?: string;
  },
): void {
  const alias = options?.alias || 'e2e-test-user';
  const authData = getMockAuthData(alias);
  seedUserDataDir(userDataDir, [authData]);
}

/**
 * Bypass authentication via IPC Mock (backward compatible with old version)
 * @deprecated Use mockAuthIpcHandlers instead
 */
export async function mockAuthInMainProcess(
  electronApp: ElectronApplication,
): Promise<void> {
  const mockData = getMockAuthData();
  await mockAuthIpcHandlers(electronApp, [mockData]);
}
