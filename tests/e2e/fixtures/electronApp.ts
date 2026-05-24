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
 * E2E test fixture type definitions
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
 * Create an isolated test userData directory.
 * Each test uses an independent directory to avoid cross-test interference.
 */
function createTestUserDataDir(): string {
  const dirName = `kosmos-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const dirPath = path.join(os.tmpdir(), dirName);
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

/**
 * Clean up the test userData directory.
 */
function cleanupTestUserDataDir(dirPath: string): void {
  try {
    fs.rmSync(dirPath, { recursive: true, force: true });
  } catch (e) {
    console.warn(`[E2E Cleanup] Failed to cleanup test userData: ${dirPath}`, e);
  }
}

/**
 * Get the Electron app root directory path.
 *
 * Returns the project root directory rather than a specific JS file, so that Electron
 * reads the root-level package.json (whose "main" field points to dist/main/main.js),
 * which correctly resolves APIs that depend on package.json such as app.getVersion().
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
  // Fixture: isolated test userData directory
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
        // Specify the full userData path directly, bypassing webpack DefinePlugin compile-time substitution.
        // bootstrap.ts reads this value at runtime via process['env']['KOSMOS_TEST_USER_DATA_PATH'],
        // which takes priority over the USER_DATA_NAME injected by DefinePlugin.
        KOSMOS_TEST_USER_DATA_PATH: testUserDataDir,
      },
      // Electron launch timeout
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

  // Fixture: main window Page object (waits for app ready)
  mainWindow: async ({ electronApp }, use) => {
    // Wait for the first window to appear
    const window = await electronApp.firstWindow();

    // Wait for app ready — App.tsx shows "Initializing Core Services..." when isAppReady=false.
    // Waiting for this text to disappear means backend services have finished initializing.
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
      // If timed out, print the current page content to aid debugging
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
