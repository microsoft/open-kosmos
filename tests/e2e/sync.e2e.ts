/**
 * Sync Settings E2E Tests
 *
 * Tests the Sync Settings functionality via IPC.
 * Verifies that the application can manage sync settings and operations.
 *
 * Run: npm run test:e2e -- --grep "Sync Settings"
 *      npx playwright test tests/e2e/sync.e2e.ts
 */
import { test, expect } from './fixtures/electronApp';

// Type definitions for sync API
interface SyncSettings {
  enabled: boolean;
  repoUrl: string;
  lastSyncTime: string | null;
}

interface SyncStatus {
  hasLocalChanges: boolean;
  hasRemoteChanges: boolean;
  isInitialized: boolean;
  currentBranch: string | null;
}

interface SyncResult {
  success: boolean;
  error?: string;
}

test.describe('Sync Settings', () => {
  test('should get sync settings via IPC', async ({ mainWindow }) => {
    // Wait for app to be ready
    await mainWindow.waitForFunction(
      () => {
        const body = document.querySelector('body');
        return body && !body.textContent?.includes('Initializing Core Services');
      },
      { timeout: 30_000 },
    );

    // Call the sync:getSettings IPC via renderer's electronAPI
    const settings = await mainWindow.evaluate(async () => {
      const api = (window as unknown as {
        electronAPI: {
          sync: {
            getSettings: () => Promise<SyncSettings>;
          };
        };
      }).electronAPI;
      return await api.sync.getSettings();
    });

    // Verify the response structure
    expect(settings).toBeDefined();
    expect(typeof settings.enabled).toBe('boolean');
    expect(typeof settings.repoUrl).toBe('string');
    // lastSyncTime can be null or string
    expect(settings.lastSyncTime === null || typeof settings.lastSyncTime === 'string').toBe(true);
  });

  test('should set and get repo URL', async ({ mainWindow }) => {
    await mainWindow.waitForFunction(
      () => {
        const body = document.querySelector('body');
        return body && !body.textContent?.includes('Initializing Core Services');
      },
      { timeout: 30_000 },
    );

    const testUrl = 'https://github.com/test/test-repo.git';

    // Set the repo URL
    const setResult = await mainWindow.evaluate(async (url) => {
      const api = (window as unknown as {
        electronAPI: {
          sync: {
            setRepoUrl: (url: string) => Promise<SyncResult>;
          };
        };
      }).electronAPI;
      return await api.sync.setRepoUrl(url);
    }, testUrl);

    // Check if feature is enabled or not
    if (setResult.success) {
      // Feature is enabled, verify the URL was saved
      const settings = await mainWindow.evaluate(async () => {
        const api = (window as unknown as {
          electronAPI: {
            sync: {
              getSettings: () => Promise<SyncSettings>;
            };
          };
        }).electronAPI;
        return await api.sync.getSettings();
      });

      expect(settings.repoUrl).toBe(testUrl);
    } else {
      // Feature is disabled, should return appropriate error
      expect(setResult.error).toBeDefined();
    }
  });

  test('should get sync status', async ({ mainWindow }) => {
    await mainWindow.waitForFunction(
      () => {
        const body = document.querySelector('body');
        return body && !body.textContent?.includes('Initializing Core Services');
      },
      { timeout: 30_000 },
    );

    // Call the sync:getStatus IPC
    const status = await mainWindow.evaluate(async () => {
      const api = (window as unknown as {
        electronAPI: {
          sync: {
            getStatus: (checkChanges?: boolean) => Promise<SyncStatus | null>;
          };
        };
      }).electronAPI;
      return await api.sync.getStatus();
    });

    // Status can be null if no repo is configured or feature is disabled
    if (status !== null) {
      expect(typeof status.hasLocalChanges).toBe('boolean');
      expect(typeof status.hasRemoteChanges).toBe('boolean');
      expect(typeof status.isInitialized).toBe('boolean');
      expect(status.currentBranch === null || typeof status.currentBranch === 'string').toBe(true);
    }
  });

  test('should validate repo URL format', async ({ mainWindow }) => {
    await mainWindow.waitForFunction(
      () => {
        const body = document.querySelector('body');
        return body && !body.textContent?.includes('Initializing Core Services');
      },
      { timeout: 30_000 },
    );

    // Test with empty URL - should fail
    const emptyResult = await mainWindow.evaluate(async () => {
      const api = (window as unknown as {
        electronAPI: {
          sync: {
            validateRepoUrl: (url: string) => Promise<SyncResult>;
          };
        };
      }).electronAPI;
      return await api.sync.validateRepoUrl('');
    });

    // Empty URL should fail validation
    if (emptyResult.error !== 'Sync feature is not enabled') {
      expect(emptyResult.success).toBe(false);
      expect(emptyResult.error).toBeDefined();
    }
  });

  test('should toggle sync enabled state', async ({ mainWindow }) => {
    await mainWindow.waitForFunction(
      () => {
        const body = document.querySelector('body');
        return body && !body.textContent?.includes('Initializing Core Services');
      },
      { timeout: 30_000 },
    );

    // Get initial state
    const initialSettings = await mainWindow.evaluate(async () => {
      const api = (window as unknown as {
        electronAPI: {
          sync: {
            getSettings: () => Promise<SyncSettings>;
          };
        };
      }).electronAPI;
      return await api.sync.getSettings();
    });

    // Toggle enabled state
    const newEnabled = !initialSettings.enabled;
    const setResult = await mainWindow.evaluate(async (enabled) => {
      const api = (window as unknown as {
        electronAPI: {
          sync: {
            setEnabled: (enabled: boolean) => Promise<SyncResult>;
          };
        };
      }).electronAPI;
      return await api.sync.setEnabled(enabled);
    }, newEnabled);

    if (setResult.success) {
      // Verify the state was changed
      const updatedSettings = await mainWindow.evaluate(async () => {
        const api = (window as unknown as {
          electronAPI: {
            sync: {
              getSettings: () => Promise<SyncSettings>;
            };
          };
        }).electronAPI;
        return await api.sync.getSettings();
      });

      expect(updatedSettings.enabled).toBe(newEnabled);

      // Restore original state
      await mainWindow.evaluate(async (enabled) => {
        const api = (window as unknown as {
          electronAPI: {
            sync: {
              setEnabled: (enabled: boolean) => Promise<SyncResult>;
            };
          };
        }).electronAPI;
        return await api.sync.setEnabled(enabled);
      }, initialSettings.enabled);
    }
  });

  test('sync settings response contains expected properties', async ({ mainWindow }) => {
    await mainWindow.waitForFunction(
      () => {
        const body = document.querySelector('body');
        return body && !body.textContent?.includes('Initializing Core Services');
      },
      { timeout: 30_000 },
    );

    const settings = await mainWindow.evaluate(async () => {
      const api = (window as unknown as {
        electronAPI: {
          sync: {
            getSettings: () => Promise<SyncSettings>;
          };
        };
      }).electronAPI;
      return await api.sync.getSettings();
    });

    // Verify object has all required properties
    expect(settings).toHaveProperty('enabled');
    expect(settings).toHaveProperty('repoUrl');
    expect(settings).toHaveProperty('lastSyncTime');

    // enabled should always be a boolean
    expect([true, false]).toContain(settings.enabled);
  });
});
