import { test as base, _electron as electron, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import {
  getMockAuthData,
  getMockAuthDataUser2,
  getMockProfileData,
  seedUserDataDir,
  type MockAuthData,
} from './authHelper';

// ==================== Utility functions ====================

function createTestUserDataDir(): string {
  const dirName = `kosmos-e2e-mock-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const dirPath = path.join(os.tmpdir(), dirName);
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

function cleanupTestUserDataDir(dirPath: string): void {
  try {
    fs.rmSync(dirPath, { recursive: true, force: true });
  } catch (e) {
    console.warn(
      `[E2E Mock Cleanup] Failed to cleanup test userData: ${dirPath}`,
      e,
    );
  }
}

/**
 * Graceful close with force-kill fallback.
 * Electron may have background tasks (analytics, startup update, etc.) that
 * prevent clean shutdown; don't let fixture teardown hang forever.
 *
 * We must call `app.close()` (not skip it) so that Playwright cleans up its
 * internal CDP WebSocket and event listeners — otherwise the worker's Node.js
 * event loop never drains and Playwright reports "Worker teardown timeout".
 *
 * To prevent `app.close()` from hanging (it waits for the process to quit),
 * we start a background timer that force-kills the process after 5 s.
 * Killing the process causes CDP to disconnect, which causes `app.close()`
 * to settle — so the promise is never left dangling.
 */
async function safeCloseApp(app: ElectronApplication): Promise<void> {
  const proc = app.process();

  // Background kill-timer: if graceful quit hasn't finished in 5 s, SIGKILL.
  // This causes CDP disconnect → app.close() settles.
  const killTimer = setTimeout(() => {
    try {
      proc.kill('SIGKILL');
    } catch {
      /* already dead */
    }
  }, 5_000);

  try {
    await app.close();
  } catch {
    // app.close() may throw if the process was force-killed — that's fine.
  } finally {
    clearTimeout(killTimer);
  }

  // Belt-and-suspenders: ensure process is really dead
  if (proc.exitCode === null) {
    try {
      proc.kill('SIGKILL');
    } catch {
      /* already dead */
    }
  }
}

function getElectronEntryPath(): string {
  const distMain = path.resolve(__dirname, '../../../dist/main');
  const bootstrapPath = path.join(distMain, 'main.js');

  if (!fs.existsSync(bootstrapPath)) {
    throw new Error(
      `[E2E] Build output not found at ${bootstrapPath}.\n` +
        'Please run "npm run build" before executing E2E tests.',
    );
  }

  return bootstrapPath;
}

/**
 * Wait for app initialization to complete ("Initializing Core Services" disappears).
 *
 * Returns the main window Page.
 */
async function waitForAppReady(window: Page, label: string): Promise<void> {
  try {
    await window.waitForFunction(
      () => {
        const body = document.querySelector('body');
        return (
          body && !body.textContent?.includes('Initializing Core Services')
        );
      },
      { timeout: 30_000 },
    );
  } catch {
    const bodyText = await window
      .locator('body')
      .textContent()
      .catch(() => '<unable to read>');
    console.warn(
      `[E2E ${label}] App readiness wait timed out. Body: ${bodyText?.slice(0, 200)}`,
    );
  }
}

// ==================== Fixture type definitions ====================

/**
 * Empty user environment Mock Fixture (Group A: device flow tests)
 *
 * Provides:
 * - testUserDataDir: isolated empty userData directory
 * - mockedApp: ElectronApplication with IPC mocks injected
 * - mockedWindow: main window Page (waits for app ready)
 */
type MockedEmptyFixtures = {
  testUserDataDir: string;
  mockedApp: ElectronApplication;
  mockedWindow: Page;
};

/**
 * Pre-seeded authentication environment Mock Fixture (Group B/C: pre-seeded auth + post-auth navigation tests)
 *
 * Provides:
 * - testUserDataDir: userData directory with auth.json pre-seeded
 * - preseededAuthData: list of pre-seeded AuthData objects
 * - authenticatedApp: ElectronApplication with IPC mocks injected
 * - authenticatedWindow: main window Page (waits for app ready)
 */
type MockedAuthenticatedFixtures = {
  testUserDataDir: string;
  preseededAuthData: MockAuthData[];
  authenticatedApp: ElectronApplication;
  authenticatedWindow: Page;
};

/**
 * Multi-user pre-seeded authentication environment Mock Fixture
 */
type MockedMultiUserFixtures = {
  testUserDataDir: string;
  preseededAuthData: MockAuthData[];
  multiUserApp: ElectronApplication;
  multiUserWindow: Page;
};

// ==================== mockedEmptyApp — empty user environment ====================

/**
 * Empty user environment + IPC mock fixture
 *
 * Used for Group A (device flow tests):
 * - No profiles pre-seeded
 * - Mock auth:getLocalActiveSessions returns an empty array
 * - Mock auth:startGhcDeviceFlow does not make real calls
 * - App navigates to /login (SHOW_NEW_USER_SIGNUP)
 *
 * Key timing:
 * 1. electron.launch() — main process starts, renderer begins loading
 * 2. firstWindow() — wait for BrowserWindow to open; renderer shows "Initializing Core Services..."
 *    (App.tsx's isAppReady gate blocks StartupPage from rendering at this point)
 * 3. evaluate() — inject IPC mock into the main process (safe: StartupPage has not called any IPC yet)
 * 4. isAppReady becomes true → StartupPage renders → calls our mocked IPC handlers
 */
export const mockedEmptyTest = base.extend<MockedEmptyFixtures>({
  testUserDataDir: async ({}, use) => {
    const dir = createTestUserDataDir();
    await use(dir);
    cleanupTestUserDataDir(dir);
  },

  mockedApp: async ({ testUserDataDir }, use) => {
    const entryPath = getElectronEntryPath();

    const app = await electron.launch({
      args: [
        entryPath,
        '--disable-gpu-sandbox',
        '--no-sandbox',
        '--disable-gpu',
      ],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        KOSMOS_TEST_USER_DATA_PATH: testUserDataDir,
      },
      timeout: 30_000,
    });

    // Critical fix: wait for firstWindow() first to stabilize the CDP context,
    // then inject IPC mocks. At this point the renderer shows "Initializing Core Services..."
    // and StartupPage has not yet rendered, so auth:getLocalActiveSessions has not been called.
    const window = await app.firstWindow();
    console.log(
      '[E2E Mock Empty] firstWindow obtained, injecting IPC mocks...',
    );

    await app.evaluate(async ({ ipcMain, BrowserWindow }) => {
      const safeHandle = (
        channel: string,
        handler: (...args: any[]) => any,
      ) => {
        try {
          ipcMain.removeHandler(channel);
        } catch {
          /* handler may not exist */
        }
        ipcMain.handle(channel, handler);
      };

      // ---- Core mocks: prevent real API calls ----
      // All return values must use the { success: true, data: ... } envelope format
      // (consistent with the return format of real handlers in src/main/main.ts)

      // 🚀 app:isReady → immediately return true (skip backend initialization wait)
      // Real handler requires isAnalyticsReady && isAgentChatReady; mock returns true directly.
      safeHandle('app:isReady', () => ({
        success: true,
        data: true,
      }));

      // Also push app:ready event (ensure App.tsx's onAppReady listener also receives it)
      // Retry sending app:ready until renderer consumes it (idempotent)
      const readyInterval = setInterval(() => {
        const wins = BrowserWindow.getAllWindows();
        if (wins.length > 0) {
          wins[0].webContents.send('app:ready', true);
        }
      }, 200);
      setTimeout(() => clearInterval(readyInterval), 30_000);

      // Dynamic state: setCurrentSession stores authData, getCurrentSession returns it.
      // Uses global instead of closure variables so tests can pre-set session data via app.evaluate().
      // (Resolves race condition between AuthProvider.initializeAuth() and auth:authChanged)
      (global as any).__e2eMockCurrentSessionData = null;

      // auth:getLocalActiveSessions → empty array (no existing users, routes to /login)
      safeHandle('auth:getLocalActiveSessions', () => ({
        success: true,
        data: [],
      }));

      // auth:startGhcDeviceFlow → return success only, do not start real OAuth flow.
      // Device code / success / failure events are pushed manually by the test via app.evaluate + webContents.send.
      safeHandle('auth:startGhcDeviceFlow', () => ({
        success: true,
        message: 'Mock: waiting for test to push events',
      }));

      // auth:setCurrentSession → store authData + send auth:authChanged push notification.
      // Critical: real handler calls notifyRendererAuthChanged('auth_set', authData).
      // Mock must replicate this side effect; otherwise AuthProvider won't update isAuthenticated.
      safeHandle('auth:setCurrentSession', (_event: any, authData: any) => {
        (global as any).__e2eMockCurrentSessionData = authData;
        // Replicate the notifyRendererAuthChanged side effect of the real handler
        setImmediate(() => {
          const wins = BrowserWindow.getAllWindows();
          if (wins.length > 0) {
            wins[0].webContents.send('auth:authChanged', {
              type: 'auth_set',
              authData: authData,
            });
          }
        });
        return { success: true };
      });

      // auth:getCurrentSession → return current session (initially null, updated after setCurrentSession)
      safeHandle('auth:getCurrentSession', () => ({
        success: true,
        data: (global as any).__e2eMockCurrentSessionData,
      }));

      // auth:signOut → success
      safeHandle('auth:signOut', () => ({
        success: true,
      }));

      // auth:destroyCurrentSession → success
      safeHandle('auth:destroyCurrentSession', () => ({
        success: true,
      }));

      // auth:getAccessToken → mock token
      safeHandle('auth:getAccessToken', () => ({
        success: true,
        data: 'mock_copilot_access_token',
      }));

      // auth:stopTokenMonitoring → success
      safeHandle('auth:stopTokenMonitoring', () => ({
        success: true,
      }));

      // auth:getMonitoringStatus → not monitoring
      safeHandle('auth:getMonitoringStatus', () => ({
        success: true,
        data: { isMonitoring: false },
      }));

      // signin:getProfilesWithGhcAuth → empty array
      safeHandle('signin:getProfilesWithGhcAuth', () => ({
        success: true,
        data: [],
      }));

      // mcp:getServerStatus → empty array (prevents mcpClientCacheManager from calling unmocked handlers)
      safeHandle('mcp:getServerStatus', () => ({
        success: true,
        data: [],
      }));

      // profile:getProfile → return null (no profile in empty user environment)
      safeHandle('profile:getProfile', () => ({
        success: true,
        data: null,
      }));
    });

    console.log('[E2E Mock Empty] IPC mocks injected successfully.');

    await use(app);
    await safeCloseApp(app);
  },

  mockedWindow: async ({ mockedApp }, use) => {
    // firstWindow() was already called in the mockedApp fixture;
    // calling it again returns the same already-opened window.
    const window = await mockedApp.firstWindow();

    // Wait for app initialization to complete ("Initializing Core Services" disappears)
    await waitForAppReady(window, 'Mock Empty');

    await use(window);
  },
});

// ==================== mockedAuthenticatedApp — single-user pre-seeded auth ====================

/**
 * Pre-seeded single-user auth environment + IPC mock fixture
 *
 * Used for Group B/C (pre-seeded auth + post-auth navigation tests):
 * - Pre-seeds 1 profile into userData
 * - Mock auth:getLocalActiveSessions returns 1 user
 * - App navigates to /auto-login → /loading
 */
export const mockedAuthenticatedTest = base.extend<MockedAuthenticatedFixtures>(
  {
    testUserDataDir: async ({}, use) => {
      const dir = createTestUserDataDir();
      await use(dir);
      cleanupTestUserDataDir(dir);
    },

    preseededAuthData: async ({}, use) => {
      const authData = [getMockAuthData()];
      await use(authData);
    },

    authenticatedApp: async ({ testUserDataDir, preseededAuthData }, use) => {
      // 1. Pre-seed auth.json into userData directory before launch
      seedUserDataDir(testUserDataDir, preseededAuthData);

      const entryPath = getElectronEntryPath();

      // 2. Launch Electron
      const app = await electron.launch({
        args: [
          entryPath,
          '--disable-gpu-sandbox',
          '--no-sandbox',
          '--disable-gpu',
        ],
        env: {
          ...process.env,
          NODE_ENV: 'test',
          DISABLE_ANALYTICS: 'true',
          KOSMOS_TEST_USER_DATA_PATH: testUserDataDir,
        },
        timeout: 30_000,
      });

      // 3. Critical fix: wait for firstWindow() first to stabilize the CDP context
      const window = await app.firstWindow();
      console.log(
        '[E2E Mock Auth] firstWindow obtained, injecting IPC mocks...',
      );

      // 4. Inject IPC mocks — prevent real GitHub API calls
      const mockData = preseededAuthData;
      await app.evaluate(async ({ ipcMain, BrowserWindow }, dataList) => {
        const safeHandle = (
          channel: string,
          handler: (...args: any[]) => any,
        ) => {
          try {
            ipcMain.removeHandler(channel);
          } catch {
            /* ignore */
          }
          ipcMain.handle(channel, handler);
        };

        // 🚀 app:isReady → immediately return true (skip backend initialization wait)
        safeHandle('app:isReady', () => ({
          success: true,
          data: true,
        }));

        // Push app:ready event
        // Retry sending app:ready until renderer consumes it (idempotent)
        const readyInterval = setInterval(() => {
          const wins = BrowserWindow.getAllWindows();
          if (wins.length > 0) {
            wins[0].webContents.send('app:ready', true);
          }
        }, 200);
        setTimeout(() => clearInterval(readyInterval), 30_000);

        // Core: return pre-seeded user list (avoids getBasicValidProfiles calling GitHub API)
        // All return values must use the { success: true, data: ... } envelope format
        safeHandle('auth:getLocalActiveSessions', () => ({
          success: true,
          data: dataList,
        }));

        // auth:setCurrentSession → success + send auth:authChanged push notification
        // Critical fix: real handler calls notifyRendererAuthChanged('auth_set', authData)
        // Mock must replicate this side effect; otherwise AuthProvider won't update isAuthenticated
        safeHandle('auth:setCurrentSession', (_event: any, authData: any) => {
          setImmediate(() => {
            const wins = BrowserWindow.getAllWindows();
            if (wins.length > 0) {
              wins[0].webContents.send('auth:authChanged', {
                type: 'auth_set',
                authData: authData || dataList[0],
              });
            }
          });
          return { success: true };
        });

        // auth:getCurrentSession → return first user
        safeHandle('auth:getCurrentSession', () => ({
          success: true,
          data: dataList[0] || null,
        }));

        // auth:signOut → success
        safeHandle('auth:signOut', () => ({
          success: true,
        }));

        // auth:startGhcDeviceFlow → mock
        safeHandle('auth:startGhcDeviceFlow', () => ({
          success: true,
          message: 'Mock: device flow (preseeded env)',
        }));

        // auth:destroyCurrentSession → success
        safeHandle('auth:destroyCurrentSession', () => ({
          success: true,
        }));

        // auth:getAccessToken → mock token
        safeHandle('auth:getAccessToken', () => ({
          success: true,
          data: 'mock_copilot_access_token',
        }));

        // auth:refreshCurrentSessionToken → success
        safeHandle('auth:refreshCurrentSessionToken', () => ({
          success: true,
        }));

        // auth:stopTokenMonitoring → success
        safeHandle('auth:stopTokenMonitoring', () => ({
          success: true,
        }));

        // auth:getMonitoringStatus → not monitoring
        safeHandle('auth:getMonitoringStatus', () => ({
          success: true,
          data: { isMonitoring: false },
        }));

        // signin:getProfilesWithGhcAuth → return profile list
        safeHandle('signin:getProfilesWithGhcAuth', () => ({
          success: true,
          data: dataList.map((d: any) => ({
            alias: d.ghcAuth?.alias,
            authData: d,
            hasValidAuth: true,
          })),
        }));

        // mcp:getServerStatus → empty array (prevents mcpClientCacheManager from calling unmocked handlers)
        safeHandle('mcp:getServerStatus', () => ({
          success: true,
          data: [],
        }));

        // profile:getProfile → return mock profile and push profile:cacheUpdated
        // Key: profileDataManager.initialize() calls this IPC,
        // return value is ignored; isInitialized is only set by profile:cacheUpdated push event.
        // Delay 500ms to ensure profileDataManager has set this.userAlias
        safeHandle('profile:getProfile', (_event: any, alias: string) => {
          const matchedUser = dataList.find(
            (d: any) => d.ghcAuth?.alias === alias,
          );
          if (matchedUser) {
            const profileData = {
              version: 2,
              alias,
              freDone: true,
              primaryAgent: 'Kobi',
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
              mcp_servers: [],
              skills: [],
              createdAt: '2025-01-01T00:00:00.000Z',
              updatedAt: '2025-01-01T00:00:00.000Z',
            };
            // Delay push of profile:cacheUpdated (wait for profileDataManager to set userAlias)
            setImmediate(() => {
              const wins = BrowserWindow.getAllWindows();
              if (wins.length > 0) {
                wins[0].webContents.send('profile:cacheUpdated', {
                  alias,
                  profile: profileData,
                  timestamp: Date.now(),
                });
              }
            });
            return {
              success: true,
              data: profileData,
            };
          }
          return { success: false, error: 'Profile not found' };
        });
      }, mockData);

      console.log('[E2E Mock Auth] IPC mocks injected successfully.');

      await use(app);
      await safeCloseApp(app);
    },

    authenticatedWindow: async ({ authenticatedApp }, use) => {
      // firstWindow() was already called in the authenticatedApp fixture
      const window = await authenticatedApp.firstWindow();

      await waitForAppReady(window, 'Mock Auth');

      await use(window);
    },
  },
);

// ==================== mockedMultiUserApp — multi-user pre-seeded auth ====================

/**
 * Pre-seeded multi-user auth environment + IPC mock fixture
 *
 * - Pre-seeds 2 profiles into userData
 * - Mock auth:getLocalActiveSessions returns 2 users
 * - App navigates to /login (SHOW_USER_SELECTION) showing "Choose Your Profile"
 */
export const mockedMultiUserTest = base.extend<MockedMultiUserFixtures>({
  testUserDataDir: async ({}, use) => {
    const dir = createTestUserDataDir();
    await use(dir);
    cleanupTestUserDataDir(dir);
  },

  preseededAuthData: async ({}, use) => {
    const authData = [getMockAuthData(), getMockAuthDataUser2()];
    await use(authData);
  },

  multiUserApp: async ({ testUserDataDir, preseededAuthData }, use) => {
    // Pre-seed multi-user auth.json
    seedUserDataDir(testUserDataDir, preseededAuthData);

    const entryPath = getElectronEntryPath();

    const app = await electron.launch({
      args: [
        entryPath,
        '--disable-gpu-sandbox',
        '--no-sandbox',
        '--disable-gpu',
      ],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        KOSMOS_TEST_USER_DATA_PATH: testUserDataDir,
      },
      timeout: 30_000,
    });

    // Critical fix: wait for firstWindow() first to stabilize the CDP context
    const window = await app.firstWindow();
    console.log(
      '[E2E Mock MultiUser] firstWindow obtained, injecting IPC mocks...',
    );

    // Inject IPC mocks — return 2 users
    const mockData = preseededAuthData;
    await app.evaluate(async ({ ipcMain, BrowserWindow }, dataList) => {
      const safeHandle = (
        channel: string,
        handler: (...args: any[]) => any,
      ) => {
        try {
          ipcMain.removeHandler(channel);
        } catch {
          /* ignore */
        }
        ipcMain.handle(channel, handler);
      };

      // 🚀 app:isReady → immediately return true
      safeHandle('app:isReady', () => ({
        success: true,
        data: true,
      }));

      // Push app:ready event
      // Retry sending app:ready until renderer consumes it (idempotent)
      const readyInterval = setInterval(() => {
        const wins = BrowserWindow.getAllWindows();
        if (wins.length > 0) {
          wins[0].webContents.send('app:ready', true);
        }
      }, 200);
      setTimeout(() => clearInterval(readyInterval), 30_000);

      // Return 2 users → SHOW_USER_SELECTION
      // All return values must use the { success: true, data: ... } envelope format
      safeHandle('auth:getLocalActiveSessions', () => ({
        success: true,
        data: dataList,
      }));

      // auth:setCurrentSession → success + send auth:authChanged push notification
      safeHandle('auth:setCurrentSession', (_event: any, authData: any) => {
        setImmediate(() => {
          const wins = BrowserWindow.getAllWindows();
          if (wins.length > 0) {
            wins[0].webContents.send('auth:authChanged', {
              type: 'auth_set',
              authData: authData || dataList[0],
            });
          }
        });
        return { success: true };
      });

      // Multi-user env: auth:getCurrentSession must return null (no user selected yet)
      // If non-null is returned, AuthProvider.isAuthenticated will be true immediately,
      // and SignInWrapper's useEffect will skip the profile selection page and navigate directly to /loading
      safeHandle('auth:getCurrentSession', () => ({
        success: true,
        data: null,
      }));

      safeHandle('auth:signOut', () => ({
        success: true,
      }));

      safeHandle('auth:startGhcDeviceFlow', () => ({
        success: true,
        message: 'Mock: device flow (multi-user env)',
      }));

      safeHandle('auth:destroyCurrentSession', () => ({
        success: true,
      }));

      safeHandle('auth:getAccessToken', () => ({
        success: true,
        data: 'mock_copilot_access_token',
      }));

      safeHandle('auth:refreshCurrentSessionToken', () => ({
        success: true,
      }));

      safeHandle('auth:stopTokenMonitoring', () => ({
        success: true,
      }));

      safeHandle('auth:getMonitoringStatus', () => ({
        success: true,
        data: { isMonitoring: false },
      }));

      safeHandle('signin:getProfilesWithGhcAuth', () => ({
        success: true,
        data: dataList.map((d: any) => ({
          alias: d.ghcAuth?.alias,
          authData: d,
          hasValidAuth: true,
        })),
      }));

      // mcp:getServerStatus → empty array
      safeHandle('mcp:getServerStatus', () => ({
        success: true,
        data: [],
      }));

      // profile:getProfile → return mock profile and push profile:cacheUpdated
      safeHandle('profile:getProfile', (_event: any, alias: string) => {
        const matchedUser = dataList.find(
          (d: any) => d.ghcAuth?.alias === alias,
        );
        if (matchedUser) {
          const profileData = {
            version: 2,
            alias,
            freDone: true,
            primaryAgent: 'Kobi',
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
            mcp_servers: [],
            skills: [],
            createdAt: '2025-01-01T00:00:00.000Z',
            updatedAt: '2025-01-01T00:00:00.000Z',
          };
          setImmediate(() => {
            const wins = BrowserWindow.getAllWindows();
            if (wins.length > 0) {
              wins[0].webContents.send('profile:cacheUpdated', {
                alias,
                profile: profileData,
                timestamp: Date.now(),
              });
            }
          });
          return {
            success: true,
            data: profileData,
          };
        }
        return { success: false, error: 'Profile not found' };
      });
    }, mockData);

    console.log('[E2E Mock MultiUser] IPC mocks injected successfully.');

    await use(app);
    await safeCloseApp(app);
  },

  multiUserWindow: async ({ multiUserApp }, use) => {
    // firstWindow() was already called in the multiUserApp fixture
    const window = await multiUserApp.firstWindow();

    await waitForAppReady(window, 'Mock MultiUser');

    await use(window);
  },
});

export { expect };

// ==================== mockedChatReadyApp — chat-ready environment ====================

/**
 * Chat-ready Mock Fixture (for Chat E2E tests)
 *
 * Extends mockedAuthenticatedApp:
 * - Pre-seeded auth + profile (with freDone=true, primaryAgent='Kobi', chats containing Kobi)
 * - Mocks all agentChat IPC handlers
 * - Mocks startup update → completes immediately
 * - Mocks profile:updateFreDone → success
 * - Finally navigates to /agent and shows chat UI
 *
 * Provides:
 * - testUserDataDir: pre-seeded userData directory
 * - preseededAuthData: pre-seeded AuthData
 * - chatApp: ElectronApplication with all mocks injected
 * - chatWindow: main window Page (arrived at /agent chat page)
 */
type MockedChatReadyFixtures = {
  testUserDataDir: string;
  preseededAuthData: MockAuthData[];
  chatApp: ElectronApplication;
  chatWindow: Page;
};

export const mockedChatReadyTest = base.extend<MockedChatReadyFixtures>({
  testUserDataDir: async ({}, use) => {
    const dir = createTestUserDataDir();
    await use(dir);
    cleanupTestUserDataDir(dir);
  },

  preseededAuthData: async ({}, use) => {
    const authData = [getMockAuthData()];
    await use(authData);
  },

  chatApp: async ({ testUserDataDir, preseededAuthData }, use) => {
    // 1. Pre-seed auth.json
    seedUserDataDir(testUserDataDir, preseededAuthData);

    const entryPath = getElectronEntryPath();

    // 2. Launch Electron
    const app = await electron.launch({
      args: [
        entryPath,
        '--disable-gpu-sandbox',
        '--no-sandbox',
        '--disable-gpu',
      ],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        KOSMOS_TEST_USER_DATA_PATH: testUserDataDir,
      },
      timeout: 30_000,
    });

    // 3. Wait for firstWindow() first to stabilize the CDP context
    const window = await app.firstWindow();
    console.log('[E2E Mock Chat] firstWindow obtained, injecting IPC mocks...');

    // 4. Inject all IPC mocks (auth + chat + startup)
    const mockData = preseededAuthData;
    await app.evaluate(async ({ ipcMain, BrowserWindow }, dataList) => {
      const safeHandle = (
        channel: string,
        handler: (...args: any[]) => any,
      ) => {
        try {
          ipcMain.removeHandler(channel);
        } catch {
          /* ignore */
        }
        ipcMain.handle(channel, handler);
      };

      // ==================== App ready ====================

      safeHandle('app:isReady', () => ({
        success: true,
        data: true,
      }));

      // IMPORTANT: Do NOT send app:ready here via setTimeout.
      // The app:ready event is triggered by a separate app.evaluate() call AFTER this one completes.
      // This prevents the race condition where the renderer calls the REAL startup:checkAndInstallUpdates
      // handler before the mock is registered.

      // ==================== Auth-related ====================

      safeHandle('auth:getLocalActiveSessions', () => ({
        success: true,
        data: dataList,
      }));

      safeHandle('auth:setCurrentSession', (_event: any, authData: any) => {
        setImmediate(() => {
          const wins = BrowserWindow.getAllWindows();
          if (wins.length > 0) {
            wins[0].webContents.send('auth:authChanged', {
              type: 'auth_set',
              authData: authData || dataList[0],
            });
          }
        });
        return { success: true };
      });

      safeHandle('auth:getCurrentSession', () => ({
        success: true,
        data: dataList[0] || null,
      }));

      safeHandle('auth:signOut', () => ({ success: true }));
      safeHandle('auth:startGhcDeviceFlow', () => ({
        success: true,
        message: 'Mock: device flow (chat env)',
      }));
      safeHandle('auth:destroyCurrentSession', () => ({ success: true }));
      safeHandle('auth:getAccessToken', () => ({
        success: true,
        data: 'mock_copilot_access_token',
      }));
      safeHandle('auth:refreshCurrentSessionToken', () => ({
        success: true,
      }));
      safeHandle('auth:stopTokenMonitoring', () => ({ success: true }));
      safeHandle('auth:getMonitoringStatus', () => ({
        success: true,
        data: { isMonitoring: false },
      }));

      safeHandle('signin:getProfilesWithGhcAuth', () => ({
        success: true,
        data: dataList.map((d: any) => ({
          alias: d.ghcAuth?.alias,
          authData: d,
          hasValidAuth: true,
        })),
      }));

      // ==================== MCP ====================

      safeHandle('mcp:getServerStatus', () => ({
        success: true,
        data: [],
      }));

      // ==================== Profile ====================

      const mockChatId = 'mock-chat-kobi';
      const archivedChatSessions = [
        {
          chatSession_id: 'session-history-target',
          title: 'Archived Session Scroll Target',
          last_updated: '2026-03-28T12:00:00.000Z',
          readStatus: 'read',
        },
        {
          chatSession_id: 'session-history-older',
          title: 'Archived Session Older History',
          last_updated: '2026-03-20T09:00:00.000Z',
          readStatus: 'read',
        },
      ];

      const createTextMessage = (
        id: string,
        role: 'user' | 'assistant',
        text: string,
        timestamp: number,
      ) => ({
        id,
        role,
        timestamp,
        streamingComplete: true,
        content: [{ type: 'text', text }],
      });

      const cloneMessages = (messages: any[]) =>
        messages.map((message) => ({
          ...message,
          content: Array.isArray(message.content)
            ? message.content.map((part: any) => ({ ...part }))
            : message.content,
        }));

      const buildSessionTranscript = (
        prefix: string,
        oldestMarker: string,
        newestMarker: string,
      ) => {
        const transcript: any[] = [];

        transcript.push(
          createTextMessage(
            `${prefix}-assistant-oldest`,
            'assistant',
            `${oldestMarker}\n\n${'Old history paragraph. '.repeat(24)}`,
            1,
          ),
        );

        for (let index = 1; index <= 7; index += 1) {
          transcript.push(
            createTextMessage(
              `${prefix}-user-${index}`,
              'user',
              `${prefix} user turn ${index}: ${'context '.repeat(18)}`,
              index * 2,
            ),
          );
          transcript.push(
            createTextMessage(
              `${prefix}-assistant-${index}`,
              'assistant',
              `${prefix} assistant turn ${index}: ${'response '.repeat(28)}`,
              index * 2 + 1,
            ),
          );
        }

        transcript.push(
          createTextMessage(
            `${prefix}-assistant-newest`,
            'assistant',
            `${newestMarker}\n\n${'Latest history paragraph. '.repeat(28)}`,
            999,
          ),
        );

        return transcript;
      };

      const chatMessagesBySessionId: Record<string, any[]> = {
        'session-history-target': buildSessionTranscript(
          'target-session',
          'OLDEST_TARGET_MARKER',
          'NEWEST_TARGET_MARKER',
        ),
        'session-history-older': buildSessionTranscript(
          'older-session',
          'OLDEST_OLDER_MARKER',
          'NEWEST_OLDER_MARKER',
        ),
      };

      const getMessagesForSession = (chatSessionId: string | null) => {
        if (!chatSessionId) {
          return [];
        }

        return cloneMessages(chatMessagesBySessionId[chatSessionId] || []);
      };

      const sendChatSessionSnapshot = (chatId: string | null, chatSessionId: string | null) => {
        if (!chatId || !chatSessionId) {
          return;
        }

        const wins = BrowserWindow.getAllWindows();
        if (wins.length === 0) {
          return;
        }

        wins[0].webContents.send('agentChat:currentChatSessionIdChanged', {
          chatId,
          chatSessionId,
        });
        wins[0].webContents.send('agentChat:chatSessionCacheCreated', {
          chatSessionId,
          chatId,
          initialData: {
            messages: getMessagesForSession(chatSessionId),
          },
        });
      };

      const mockProfileData = (alias: string) => ({
        version: 2,
        alias,
        freDone: true,
        primaryAgent: 'Kobi',
        chats: [
          {
            chat_id: mockChatId,
            agent: {
              name: 'Kobi',
              emoji: '🤖',
              description: 'Your AI Assistant',
              system_prompt: 'You are Kobi, an AI assistant.',
            },
            sessions: archivedChatSessions,
            chatSessions: archivedChatSessions,
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
        mcp_servers: [],
        skills: [],
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      });

      safeHandle('profile:getProfile', (_event: any, alias: string) => {
        const matchedUser = dataList.find(
          (d: any) => d.ghcAuth?.alias === alias,
        );
        if (matchedUser) {
          const profileData = mockProfileData(alias);
          setImmediate(() => {
            const wins = BrowserWindow.getAllWindows();
            if (wins.length > 0) {
              wins[0].webContents.send('profile:cacheUpdated', {
                alias,
                profile: profileData,
                timestamp: Date.now(),
              });
            }
          });
          return { success: true, data: profileData };
        }
        return { success: false, error: 'Profile not found' };
      });

      safeHandle('profile:updateFreDone', () => ({ success: true }));

      safeHandle('profile:getChatSessions', (_event: any, alias: string, chatId: string, minCount: number = 10) => {
        if (!dataList.some((d: any) => d.ghcAuth?.alias === alias) || chatId !== mockChatId) {
          return {
            success: false,
            error: 'Chat not found',
          };
        }

        return {
          success: true,
          data: {
            sessions: archivedChatSessions.slice(0, minCount),
            hasMore: false,
            nextMonthIndex: 0,
          },
        };
      });

      safeHandle('profile:getMoreChatSessions', (_event: any, alias: string, chatId: string) => {
        if (!dataList.some((d: any) => d.ghcAuth?.alias === alias) || chatId !== mockChatId) {
          return {
            success: false,
            error: 'Chat not found',
          };
        }

        return {
          success: true,
          data: {
            sessions: [],
            hasMore: false,
            nextMonthIndex: 0,
          },
        };
      });

      safeHandle('profile:getChatSession', (_event: any, chatId: string, sessionId: string) => {
        if (chatId !== mockChatId) {
          return {
            success: false,
            error: 'Chat not found',
          };
        }

        const session = archivedChatSessions.find(
          (item) => item.chatSession_id === sessionId,
        );

        return {
          success: Boolean(session),
          data: session || null,
          error: session ? undefined : 'Session not found',
        };
      });

      // ==================== Startup Update ====================

      // startup:checkAndInstallUpdates → immediately succeed (skip update check)
      safeHandle('startup:checkAndInstallUpdates', () => ({
        success: true,
        data: {
          success: true,
          hasUpdates: false,
          updatedMcpCount: 0,
          updatedSkillCount: 0,
          updatedAgentCount: 0,
        },
      }));

      // ==================== Auto Update (App Version) ====================
      // These mocks prevent the UpdateManager from running and triggering
      // "Unsupported platform: linux-x64" errors on Linux CI.

      safeHandle('update:checkForUpdates', () => ({
        success: true,
        data: { hasUpdate: false },
      }));

      safeHandle('update:downloadUpdate', () => ({
        success: true,
      }));

      safeHandle('update:quitAndInstall', () => ({
        success: true,
      }));

      safeHandle('update:getVersion', () => ({
        success: true,
        data: '0.0.0-test',
      }));

      safeHandle('update:skipVersion', () => ({
        success: true,
      }));

      safeHandle('update:getPreferences', () => ({
        success: true,
        data: {
          autoDownload: false,
          autoInstall: false,
        },
      }));

      safeHandle('update:updatePreferences', () => ({
        success: true,
      }));

      // ==================== AgentChat-related ====================

      // Chat session state
      let currentChatId: string | null = null;
      let currentChatSessionId: string | null = null;
      let chatMessages: any[] = [];

      // agentChat:initialize → success
      safeHandle('agentChat:initialize', () => ({
        success: true,
      }));

      // agentChat:startNewChatFor → create session, return chatSessionId
      // Note: push events (currentChatSessionIdChanged / chatSessionCacheCreated)
      // are NOT pushed inside this handler, but explicitly pushed by the chatWindow fixture
      // after detecting startNewChatFor was called. Reason: setTimeout + webContents.send()
      // inside mock handlers is unreliable in Playwright test environment
      // (events may not reach renderer's ipcRenderer.on listeners).
      safeHandle('agentChat:startNewChatFor', (_event: any, chatId: string) => {
        const nextCallCount =
          (((global as any).__e2e_startNewChatForCallCount as number | undefined) ?? 0) + 1;
        (global as any).__e2e_startNewChatForCallCount = nextCallCount;
        (global as any).__e2e_lastStartNewChatForChatId = chatId;
        currentChatId = chatId;
        currentChatSessionId = `chatSession_mock_${Date.now()}`;
        chatMessages = [];
        console.log(
          `[E2E Mock Chat] Started new chat session: ${currentChatSessionId} for chatId: ${chatId} (call ${nextCallCount})`,
        );

        return {
          success: true,
          chatSessionId: currentChatSessionId,
        };
      });

      // agentChat:switchToChatSession → switch session
      safeHandle(
        'agentChat:switchToChatSession',
        (_event: any, chatId: string, sessionId: string) => {
          currentChatId = chatId;
          currentChatSessionId = sessionId;
          chatMessages = getMessagesForSession(sessionId);
          sendChatSessionSnapshot(chatId, sessionId);
          return {
            success: true,
            data: {
              chatId,
              chatSessionId: sessionId,
              agentName: 'Kobi',
            },
          };
        },
      );

      // agentChat:streamMessage → simulate LLM streaming response
      // Note: streaming events are NOT pushed inside this handler (setTimeout + webContents.send unreliable in test env).
      // Instead, pending info is stored in global.__e2e_pendingStreamResponse; test side reads it via
      // chatApp.evaluate() and pushes events. Using global instead of closure variables because each
      // chatApp.evaluate() creates a new execution context.
      safeHandle('agentChat:streamMessage', (_event: any, message: any) => {
        const assistantMessageId = `msg_assistant_${Date.now()}`;
        const mockResponse =
          'Hello! I am Kobi, your AI assistant. How can I help you today?';
        (global as any).__e2e_pendingStreamResponse = {
          assistantMessageId,
          mockResponse,
          chatId: currentChatId,
          chatSessionId: currentChatSessionId,
        };
        console.log(
          `[E2E Mock Chat] streamMessage called, pending response stored: ${assistantMessageId}`,
        );
        return { success: true };
      });

      // agentChat:cancelChat → success
      safeHandle('agentChat:cancelChat', () => ({
        success: true,
      }));

      // agentChat:cancelChatSession → success
      safeHandle('agentChat:cancelChatSession', () => ({
        success: true,
      }));

      // agentChat:getCurrentInstance → return Kobi agent info
      safeHandle('agentChat:getCurrentInstance', () => ({
        success: true,
        data: {
          chatId: currentChatId || mockChatId,
          chatSessionId: currentChatSessionId,
          agentName: 'Kobi',
        },
      }));

      // agentChat:getChatHistory → return empty or current messages
      safeHandle('agentChat:getChatHistory', () => ({
        success: true,
        data: chatMessages,
      }));

      // agentChat:getDisplayMessages → return empty or current messages
      safeHandle('agentChat:getDisplayMessages', () => ({
        success: true,
        data: chatMessages,
      }));

      // agentChat:getCurrentChatId → return current chatId
      safeHandle('agentChat:getCurrentChatId', () => ({
        success: true,
        data: currentChatId,
      }));

      // agentChat:getChatStatusInfo → idle
      safeHandle('agentChat:getChatStatusInfo', () => ({
        success: true,
        data: {
          chatId: currentChatId || mockChatId,
          chatStatus: 'idle',
          agentName: 'Kobi',
        },
      }));

      // agentChat:getCurrentContextTokenUsage → 0
      safeHandle('agentChat:getCurrentContextTokenUsage', () => ({
        success: true,
        data: {
          tokenCount: 0,
          totalMessages: 0,
          contextMessages: 0,
          compressionRatio: 1,
        },
      }));

      // agentChat:refreshCurrentInstance → success
      safeHandle('agentChat:refreshCurrentInstance', () => ({
        success: true,
        data: {
          chatId: currentChatId || mockChatId,
          chatSessionId: currentChatSessionId,
          agentName: 'Kobi',
        },
      }));

      // agentChat:syncChatHistory → success
      safeHandle('agentChat:syncChatHistory', () => ({
        success: true,
      }));

      // agentChat:retryChat → success
      safeHandle('agentChat:retryChat', () => ({
        success: true,
      }));

      // agentChat:sendApprovalResponse → success
      safeHandle('agentChat:sendApprovalResponse', () => ({
        success: true,
      }));

      // agentChat:sendBatchApprovalResponse → success
      safeHandle('agentChat:sendBatchApprovalResponse', () => ({
        success: true,
      }));

      // agentChat:removeAgentChatInstance → success
      safeHandle('agentChat:removeAgentChatInstance', () => ({
        success: true,
      }));

      // agentChat:forkChatSession → success
      safeHandle('agentChat:forkChatSession', () => ({
        success: true,
        chatSessionId: `chatSession_fork_${Date.now()}`,
      }));

      // ==================== Platform info ====================

      safeHandle('getPlatformInfo', () => ({
        platform: process.platform,
      }));
    }, mockData);

    console.log('[E2E Mock Chat] IPC mocks injected successfully.');

    // Now that ALL mocks are in place (including startup:checkAndInstallUpdates),
    // trigger the app:ready event. This ensures the renderer won't call the REAL
    // startup:checkAndInstallUpdates handler.
    await app.evaluate(({ BrowserWindow }) => {
      const wins = BrowserWindow.getAllWindows();
      if (wins.length > 0) {
        wins[0].webContents.send('app:ready', true);
      }
    });
    console.log('[E2E Mock Chat] app:ready event triggered.');

    await use(app);
    await safeCloseApp(app);
  },

  chatWindow: async ({ chatApp, preseededAuthData }, use) => {
    const window = await chatApp.firstWindow();

    const alias = preseededAuthData[0].ghcAuth.alias;

    // Capture renderer process console logs (for debugging)
    window.on('console', (msg) => {
      const text = msg.text();
      if (
        text.includes('AgentPage') ||
        text.includes('StartupUpdate') ||
        text.includes('AgentChatSessionCacheManager')
      ) {
        console.log(`[Renderer] ${text}`);
      }
    });

    // Wait for React to mount first ("Starting KOSMOS" disappears)
    console.log('[E2E Mock Chat] Waiting for React to mount...');
    try {
      await window.waitForFunction(
        () => {
          const body = document.querySelector('body');
          // "Starting KOSMOS" is the pre-React loading text in index.html
          // React replaces this text after mounting
          return body && !body.textContent?.includes('Starting');
        },
        { timeout: 30_000 },
      );
      console.log('[E2E Mock Chat] React mounted (no more "Starting" text).');
    } catch {
      const bodyText = await window
        .locator('body')
        .textContent()
        .catch(() => '<unable to read>');
      console.warn(
        `[E2E Mock Chat] React mount wait timed out. URL: ${window.url()} Body: ${bodyText?.slice(0, 500)}`,
      );
    }

    // Wait for "Initializing Core Services" to disappear (app:isReady mock should make it disappear quickly)
    await waitForAppReady(window, 'Mock Chat');
    console.log(`[E2E Mock Chat] App ready. Current URL: ${window.url()}`);

    // Wait to reach /auto-login, /loading, /login, or /agent
    await window.waitForURL(/#\/(auto-login|loading|login|agent)/, {
      timeout: 30_000,
    });

    // Navigate to correct route
    const currentUrl = window.url();
    console.log(`[E2E Mock Chat] After waitForURL. Current URL: ${currentUrl}`);

    if (!currentUrl.includes('#/agent')) {
      // Manually push profile:cacheUpdated as fallback
      const profileData = getMockProfileData(alias);
      await chatApp.evaluate(
        async ({ BrowserWindow }, params) => {
          const wins = BrowserWindow.getAllWindows();
          if (wins.length > 0) {
            wins[0].webContents.send('profile:cacheUpdated', {
              alias: params.alias,
              profile: params.profile,
              timestamp: Date.now(),
            });
          }
        },
        { alias, profile: profileData },
      );

      try {
        await window.waitForURL(/#\/agent/, { timeout: 20_000 });
        console.log('[E2E Mock Chat] Navigated to /agent.');
      } catch {
        const url2 = window.url();
        const bodyText2 = await window
          .locator('body')
          .textContent()
          .catch(() => '<unable to read>');
        console.warn(
          `[E2E Mock Chat] Failed to reach /agent. URL: ${url2} Body: ${bodyText2?.slice(0, 500)}`,
        );
      }
    }

    // Unconditional fallback: re-push profile:cacheUpdated to ensure renderer has profile data.
    // Under CI load, the earlier push during /auto-login → /agent navigation may have been
    // dropped if the renderer wasn't ready to process it yet.
    await chatApp.evaluate(
      async ({ BrowserWindow }, params) => {
        const wins = BrowserWindow.getAllWindows();
        if (wins.length > 0) {
          wins[0].webContents.send('profile:cacheUpdated', {
            alias: params.alias,
            profile: params.profile,
            timestamp: Date.now(),
          });
        }
      },
      { alias, profile: getMockProfileData(alias) },
    );

    // Wait for chat UI ready — chat-textarea visible.
    // This is a hard requirement: if the chat textarea doesn't appear,
    // the test body will fail with a confusing assertion error, so we
    // throw here to surface the real problem (fixture setup failure).
    //
    // Defense in depth: If the update error overlay appears (race condition where
    // the REAL startup:checkAndInstallUpdates was called before our mock), we'll
    // detect and dismiss it, then retry waiting for the chat textarea.
    let chatTextareaVisible = false;
    for (let attempt = 0; attempt < 2 && !chatTextareaVisible; attempt++) {
      try {
        await window
          .locator('.chat-textarea')
          .waitFor({ state: 'visible', timeout: attempt === 0 ? 60_000 : 30_000 });
        chatTextareaVisible = true;
        console.log('[E2E Mock Chat] Chat textarea visible — chat UI ready.');
      } catch {
        // Check if the update error overlay is blocking us
        const updateErrorOverlay = window.locator('text="Update Check Failed"');
        if (await updateErrorOverlay.isVisible({ timeout: 1000 }).catch(() => false)) {
          console.warn(
            `[E2E Mock Chat] Update error overlay detected on attempt ${attempt + 1} — dismissing it (defense in depth).`,
          );
          // Click the "Close" button to dismiss the overlay
          const closeButton = window.locator('button:has-text("Close")');
          if (await closeButton.isVisible({ timeout: 500 }).catch(() => false)) {
            await closeButton.click();
            // Wait for the overlay to close and the app to recover
            await window.waitForTimeout(500);
            // Continue to next attempt
            continue;
          }
        }
        // If no overlay or couldn't dismiss, throw on last attempt
        if (attempt === 1) {
          const bodyText = await window
            .locator('body')
            .textContent()
            .catch(() => '<unable to read>');
          throw new Error(
            `[E2E Mock Chat] Chat textarea not found after retries — fixture setup failed.\n` +
              `URL: ${window.url()}\nBody: ${bodyText?.slice(0, 500)}`,
          );
        }
      }
    }

    // TODO: Eventually use startNewChatFor IPC to stay consistent with main process behavior.
    // Currently, since setTimeout + webContents.send inside handlers is unreliable in test environments,
    // the fixture explicitly pushes events instead.

    // Wait for agentChat session initialization to complete
    // Full chain: chat-textarea visible → InstallUpdateOnStartupView completes (~800ms) →
    //   selectPrimaryAgentOnStartup → startNewChatFor IPC → mock returns
    //
    // Unlike the real main process, the mock startNewChatFor does NOT push push events
    // (setTimeout + webContents.send is unreliable in test environments).
    // Therefore, the fixture explicitly pushes push events after detecting
    // startNewChatFor has been called, via chatApp.evaluate().
    console.log('[E2E Mock Chat] Waiting for chat session to initialize...');
    try {
      // Step 1: Poll main process — wait for startNewChatFor to fully complete
      // startNewChatFor handler synchronously sets currentChatId and currentChatSessionId,
      // returned together via getCurrentInstance mock.
      // Polling for non-null chatSessionId ensures startNewChatFor has executed.
      // Note: startNewChatFor is called after InstallUpdateOnStartupView completes (~800ms)
      const sessionInfo = await window.evaluate(async () => {
        // Poll until chatSessionId is non-null (up to 15s)
        const startTime = Date.now();
        const timeout = 30_000;
        while (Date.now() - startTime < timeout) {
          try {
            const result = await (
              window as any
            ).electronAPI?.agentChat?.getCurrentInstance?.();
            if (result?.data?.chatSessionId) {
              return result.data as { chatId: string; chatSessionId: string };
            }
          } catch {
            /* ignore */
          }
          await new Promise((r) => setTimeout(r, 200));
        }
        return null;
      });
      console.log(
        '[E2E Mock Chat] Session info from main process:',
        JSON.stringify(sessionInfo),
      );

      if (sessionInfo?.chatId && sessionInfo?.chatSessionId) {
        // Step 2: Explicitly push push events to renderer from fixture side
        // Using chatApp.evaluate() to call webContents.send() directly,
        // which is more reliable than setTimeout + webContents.send inside mock handlers.
        await chatApp.evaluate(
          ({ BrowserWindow }, info) => {
            const wins = BrowserWindow.getAllWindows();
            if (wins.length > 0) {
              console.log(
                '[E2E Mock Chat] Pushing session events from fixture:',
                info.chatId,
                info.chatSessionId,
              );
              wins[0].webContents.send(
                'agentChat:currentChatSessionIdChanged',
                {
                  chatId: info.chatId,
                  chatSessionId: info.chatSessionId,
                },
              );
              wins[0].webContents.send('agentChat:chatSessionCacheCreated', {
                chatSessionId: info.chatSessionId,
                chatId: info.chatId,
                initialData: {},
              });
            }
          },
          {
            chatId: sessionInfo.chatId,
            chatSessionId: sessionInfo.chatSessionId,
          },
        );
        console.log('[E2E Mock Chat] Push events sent from fixture');

        // Step 3: Wait for React to complete the state update chain:
        //   handleCurrentChatSessionIdChanged → notifyCallbacks → setState →
        //   React render → useEffect → directMessageUpdateCallbacks registered
        await window.waitForFunction(
          () => {
            const textarea = document.querySelector('.chat-textarea');
            return textarea !== null && !(textarea as HTMLTextAreaElement).disabled;
          },
          { timeout: 10_000 },
        );
      } else {
        console.warn(
          '[E2E Mock Chat] Could not get session info — push events not sent',
        );
      }

      console.log(
        '[E2E Mock Chat] Chat session initialized — ready for tests.',
      );
    } catch {
      console.warn(
        '[E2E Mock Chat] Chat session init wait timed out — proceeding anyway.',
      );
    }

    await use(window);
  },
});
