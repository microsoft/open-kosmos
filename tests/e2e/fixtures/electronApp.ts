import {
  test as base,
  _electron as electron,
  expect,
} from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

/**
 * E2E Test Fixture Type Definitions
 */
type ElectronFixtures = {
  /** Electron application instance */
  electronApp: ElectronApplication;
  /** Main window Page object */
  mainWindow: Page;
  /** Test userData directory */
  testUserDataDir: string;
};

/**
 * Create an isolated test userData directory
 * Each test uses an independent directory to avoid interference
 */
function createTestUserDataDir(): string {
  const dirName = `kosmos-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const dirPath = path.join(os.tmpdir(), dirName);
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

/**
 * Clean up test userData directory
 */
function cleanupTestUserDataDir(dirPath: string): void {
  try {
    fs.rmSync(dirPath, { recursive: true, force: true });
  } catch (e) {
    console.warn(`[E2E Cleanup] Failed to cleanup test userData: ${dirPath}`, e);
  }
}

/**
 * Get Electron app root directory path
 *
 * Returns the project root instead of a specific JS file, so that Electron reads
 * the root package.json (where "main" points to dist/main/main.js), correctly
 * resolving APIs like app.getVersion() that depend on package.json.
 */
function getElectronEntryPath(): string {
  const projectRoot = path.resolve(__dirname, '../../..');
  const mainJs = path.join(projectRoot, 'dist/main/main.js');

  if (!fs.existsSync(mainJs)) {
    throw new Error(
      `[E2E] Build output not found at ${mainJs}.\n` +
        'Please run "npm run build" before executing E2E tests.',
    );
  }

  return projectRoot;
}

export const test = base.extend<ElectronFixtures>({
  // Fixture: Isolated test userData directory
  testUserDataDir: async ({}, use) => {
    const dir = createTestUserDataDir();
    await use(dir);
    cleanupTestUserDataDir(dir);
  },

  // Fixture: Electron application instance
  electronApp: async ({ testUserDataDir }, use) => {
    const entryPath = getElectronEntryPath();

    const app = await electron.launch({
      args: [
        entryPath,
        '--disable-gpu-sandbox',
        '--no-sandbox',
        // Disable hardware acceleration to reduce CI environment issues
        '--disable-gpu',
      ],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        // Specify the full userData path directly, bypassing webpack DefinePlugin compile-time replacement.
        // In bootstrap.ts, process['env']['KOSMOS_TEST_USER_DATA_PATH']
        // is read at runtime, taking priority over the DefinePlugin-injected USER_DATA_NAME.
        KOSMOS_TEST_USER_DATA_PATH: testUserDataDir,
      },
      // Electron startup timeout
      timeout: 30_000,
    });

    await use(app);

    // Graceful close with force-kill fallback.
    // We must call app.close() so Playwright cleans up its internal CDP
    // WebSocket / listeners (otherwise the worker event loop never drains).
    // A background kill-timer ensures app.close() never hangs indefinitely.
    const proc = app.process();
    const killTimer = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch { /* already dead */ }
    }, 5_000);
    try {
      await app.close();
    } catch {
      // app.close() may throw if the process was force-killed — fine.
    } finally {
      clearTimeout(killTimer);
    }
    if (proc.exitCode === null) {
      try { proc.kill('SIGKILL'); } catch { /* already dead */ }
    }
  },

  // Fixture: Main window Page object (app ready state)
  mainWindow: async ({ electronApp }, use) => {
    // Wait for first window to appear
    const window = await electronApp.firstWindow();

    // Wait for app ready — App.tsx shows "Initializing Core Services..." when isAppReady=false
    // Waiting for that text to disappear means backend services have finished initializing
    try {
      await window.waitForFunction(
        () => {
          const body = document.querySelector('body');
          return (
            body &&
            !body.textContent?.includes('Initializing Core Services')
          );
        },
        { timeout: 30_000 },
      );
    } catch {
      // If timed out, print current page content for debugging
      const bodyText = await window
        .locator('body')
        .textContent()
        .catch(() => '<unable to read>');
      console.warn(
        `[E2E] App readiness wait timed out. Current body text: ${bodyText?.slice(0, 200)}`,
      );
    }

    await use(window);
  },
});

export { expect };
