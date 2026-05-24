/**
 * Git Version E2E Tests
 *
 * Tests the Git version detection functionality via IPC.
 * Verifies that the application can correctly detect Git installation version.
 *
 * Run: npm run test:e2e -- --grep "Git Version"
 *      npx playwright test tests/e2e/git-version.e2e.ts
 */
import { test, expect } from './fixtures/electronApp';

test.describe('Git Version Detection', () => {
  test('should detect Git installation version via IPC', async ({ mainWindow }) => {
    // Wait for app to be ready
    await mainWindow.waitForFunction(
      () => {
        const body = document.querySelector('body');
        return body && !body.textContent?.includes('Initializing Core Services');
      },
      { timeout: 30_000 },
    );

    // Call the runtime:check-git-version IPC via renderer's electronAPI
    // Use retry logic to handle execution context destruction during navigation
    let gitVersion!: { installed: boolean; version: string | null; path: string | null };
    const maxRetries = 3;
    for (let i = 0; i < maxRetries; i++) {
      try {
        gitVersion = await mainWindow.evaluate(async () => {
          // Access electronAPI exposed via preload
          const api = (window as unknown as { electronAPI: { runtime: { checkGitVersion: () => Promise<{ installed: boolean; version: string | null; path: string | null }> } } }).electronAPI;
          return await api.runtime.checkGitVersion();
        });
        break;
      } catch (err) {
        if (
          i < maxRetries - 1 &&
          String(err).includes('Execution context was destroyed')
        ) {
          await mainWindow.waitForLoadState('domcontentloaded');
          continue;
        }
        throw err;
      }
    }

    // Verify the response structure
    expect(gitVersion).toBeDefined();
    expect(typeof gitVersion.installed).toBe('boolean');

    if (gitVersion.installed) {
      // If Git is installed, version should be a string
      expect(typeof gitVersion.version).toBe('string');
      expect(gitVersion.version).toMatch(/^\d+\.\d+/); // Version format: X.Y or X.Y.Z
      // Path may be null or empty on some systems even if installed
      if (gitVersion.path) {
        expect(typeof gitVersion.path).toBe('string');
        expect(gitVersion.path.toLowerCase()).toContain('git');
      }
    } else {
      // If Git is not installed, version and path should be null
      expect(gitVersion.version).toBeNull();
      expect(gitVersion.path).toBeNull();
    }
  });

  test('Git version response contains expected properties', async ({ mainWindow }) => {
    await mainWindow.waitForFunction(
      () => {
        const body = document.querySelector('body');
        return body && !body.textContent?.includes('Initializing Core Services');
      },
      { timeout: 30_000 },
    );

    // Use retry logic to handle execution context destruction during navigation
    let gitVersion!: { installed: boolean; version: string | null; path: string | null };
    const maxRetries = 3;
    for (let i = 0; i < maxRetries; i++) {
      try {
        gitVersion = await mainWindow.evaluate(async () => {
          const api = (window as unknown as { electronAPI: { runtime: { checkGitVersion: () => Promise<{ installed: boolean; version: string | null; path: string | null }> } } }).electronAPI;
          return await api.runtime.checkGitVersion();
        });
        break;
      } catch (err) {
        if (
          i < maxRetries - 1 &&
          String(err).includes('Execution context was destroyed')
        ) {
          await mainWindow.waitForLoadState('domcontentloaded');
          continue;
        }
        throw err;
      }
    }

    // Verify object has all required properties
    expect(gitVersion).toHaveProperty('installed');
    expect(gitVersion).toHaveProperty('version');
    expect(gitVersion).toHaveProperty('path');

    // installed should always be a boolean
    expect([true, false]).toContain(gitVersion.installed);
  });
});
