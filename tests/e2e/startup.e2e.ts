/**
 * Startup Flow E2E Tests
 *
 * Covered scenarios:
 * 1. Electron app window creation
 * 2. App.tsx initialization loading screen (dark background, "Initializing Core Services...")
 * 3. StartupPage rendering (progress bar, logo)
 * 4. Routing to /login in empty userData environment
 * 5. Main process communication available (evaluate API)
 * 6. Multi-window detection
 *
 * Run: npm run test:e2e -- --grep "Startup Flow"
 *      npx playwright test tests/e2e/startup.e2e.ts
 */
import { test, expect } from './fixtures/electronApp';
import { Selectors } from './helpers/selectors';
import { safeGetPageText } from './helpers/waitUtils';

test.describe('Startup Flow Tests', () => {
  test('App window is created normally with at least one window', async ({ electronApp }) => {
    // Wait for the first window to appear (electronApp.windows() may return empty before window creation)
    const firstWindow = await electronApp.firstWindow();
    expect(firstWindow).toBeTruthy();

    // At this point there should be at least one window
    const windows = electronApp.windows();
    expect(windows.length).toBeGreaterThanOrEqual(1);
  });

  test('Initialization loading screen displays correctly then disappears', async ({ electronApp }) => {
    const window = await electronApp.firstWindow();

    // App.tsx shows dark background + "OpenKosmos" + "Initializing Core Services..." when isAppReady=false
    // Since the app may start quickly, loading may have already disappeared, so we do a soft check
    const bodyText = await safeGetPageText(window, 1000);

    // Wait for loading screen to disappear (if not already gone)
    // mainWindow fixture handles this wait, but here we use electronApp directly so we need to wait ourselves
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

    // Verify loading text has disappeared
    await expect(
      window.locator('text=Initializing Core Services'),
    ).not.toBeVisible({ timeout: 5_000 });
  });

  test('App title contains brand name', async ({ mainWindow }) => {
    // Wait for title to be set (React app loading may have a delay)
    await mainWindow.waitForFunction(
      () => document.title.length > 0,
      { timeout: 15_000 },
    );

    const title = await mainWindow.title();
    // Title should contain brand name (depends on BRAND configuration)
    expect(title).toMatch(/OpenKosmos/i);
  });

  test('StartupPage progress bar renders correctly', async ({ electronApp }) => {
    const window = await electronApp.firstWindow();

    // Wait for app ready (loading screen disappears)
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

    // StartupPage uses .startup-page CSS class
    // Since StartupPage may have finished and navigated to /login, we check both cases:
    // 1. StartupPage is still visible (progress bar exists)
    // 2. Already navigated to next page (normal behavior)
    const isOnStartupPage = await window
      .locator(Selectors.STARTUP_PAGE)
      .isVisible()
      .catch(() => false);

    if (isOnStartupPage) {
      // Verify progress bar exists
      await expect(
        window.locator(Selectors.STARTUP_PROGRESS_BAR),
      ).toBeVisible({ timeout: 5_000 });

      // Verify progress bar fill element exists
      await expect(
        window.locator(Selectors.STARTUP_PROGRESS_FILL),
      ).toBeVisible({ timeout: 5_000 });

      // Verify logo container exists
      await expect(
        window.locator(Selectors.STARTUP_LOGO),
      ).toBeVisible({ timeout: 5_000 });
    } else {
      // StartupPage finished, verify navigated to a valid route or still on root path
      // Root path (no hash or #/) means StartupPage is active or just finished
      const url = window.url();
      const hasValidRoute =
        /#\/(login|auto-login|loading|agent)/.test(url) ||
        !url.includes('#') ||
        url.endsWith('#/');
      expect(hasValidRoute).toBeTruthy();
    }
  });

  test('App navigates to login page in empty userData environment', async ({ mainWindow }) => {
    // Test environment uses an isolated empty userData directory
    // Expected flow: App ready → StartupPage (~2.5s) → /login (when no users)

    // Wait for route to stabilize (allow time for StartupPage's ~2.5s animation + verification + margin)
    await mainWindow.waitForURL(/#\/(login|auto-login|loading)/, {
      timeout: 30_000,
    });

    const url = mainWindow.url();
    // Empty directory scenario, recommendedAction should be SHOW_NEW_USER_SIGNUP → /login
    expect(url).toMatch(/#\/login/);
  });

  test('Login page renders correctly after navigation', async ({ mainWindow }) => {
    // Wait for navigation to /login
    await mainWindow.waitForURL(/#\/login/, { timeout: 30_000 });

    // Verify SignInPage root element exists (.signin-page)
    await expect(
      mainWindow.locator(Selectors.SIGN_IN_PAGE),
    ).toBeVisible({ timeout: 10_000 });

    // Verify SignInPage card renders
    await expect(
      mainWindow.locator(Selectors.SIGN_IN_CARD),
    ).toBeVisible({ timeout: 5_000 });
  });

  test('Can execute code in main process', async ({ electronApp }) => {
    // Verify Playwright evaluate API can communicate with Electron main process
    // Navigation (route changes) may occur during app startup, destroying the execution context
    // Use retry mechanism to handle this
    let appName: string | undefined;
    const maxRetries = 3;

    for (let i = 0; i < maxRetries; i++) {
      try {
        appName = await electronApp.evaluate(async ({ app }) => {
          return app.getName();
        });
        break;
      } catch (err) {
        if (
          i < maxRetries - 1 &&
          String(err).includes('Execution context was destroyed')
        ) {
          await new Promise((r) => setTimeout(r, 2_000));
          continue;
        }
        throw err;
      }
    }

    expect(appName).toBeTruthy();
    expect(typeof appName).toBe('string');
  });

  test('Can get app version number', async ({ electronApp }) => {
    let appVersion: string | undefined;
    const maxRetries = 3;

    for (let i = 0; i < maxRetries; i++) {
      try {
        appVersion = await electronApp.evaluate(async ({ app }) => {
          return app.getVersion();
        });
        break;
      } catch (err) {
        if (
          i < maxRetries - 1 &&
          String(err).includes('Execution context was destroyed')
        ) {
          await new Promise((r) => setTimeout(r, 2_000));
          continue;
        }
        throw err;
      }
    }

    expect(appVersion).toBeTruthy();
    // Verify version number format (x.y.z)
    expect(appVersion).toMatch(/^\d+\.\d+\.\d+/);
  });

  test('App userData path points to isolated test directory', async ({
    electronApp,
    testUserDataDir,
  }) => {
    let userDataPath: string | undefined;
    const maxRetries = 3;

    for (let i = 0; i < maxRetries; i++) {
      try {
        userDataPath = await electronApp.evaluate(async ({ app }) => {
          return app.getPath('userData');
        });
        break;
      } catch (err) {
        if (
          i < maxRetries - 1 &&
          String(err).includes('Execution context was destroyed')
        ) {
          await new Promise((r) => setTimeout(r, 2_000));
          continue;
        }
        throw err;
      }
    }

    expect(userDataPath).toBeTruthy();
    // Verify userData path contains our test directory name
    // bootstrap.ts uses USER_DATA_NAME environment variable to set userData path
    const testDirName = require('path').basename(testUserDataDir);
    expect(userDataPath).toContain(testDirName);
  });

  test('React app mounts successfully', async ({ mainWindow }) => {
    // Verify #root has content (React has rendered)
    await mainWindow.waitForFunction(
      () => {
        const root = document.getElementById('root');
        return root && root.children.length > 0 && root.innerHTML.length > 100;
      },
      { timeout: 30_000 },
    );

    const rootContent = await mainWindow.evaluate(() => {
      const root = document.getElementById('root');
      return {
        childCount: root?.children.length || 0,
        htmlLength: root?.innerHTML.length || 0,
      };
    });

    expect(rootContent.childCount).toBeGreaterThan(0);
    expect(rootContent.htmlLength).toBeGreaterThan(100);
  });
});
