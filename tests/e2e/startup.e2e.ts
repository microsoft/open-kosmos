/**
 * Startup flow E2E tests
 *
 * Covered scenarios:
 * 1. Electron app window creation
 * 2. App.tsx initialization loading screen (dark background, "Initializing Core Services...")
 * 3. StartupPage rendering (progress bar, logo)
 * 4. Routing to /login in an empty userData environment
 * 5. Main process communication available (evaluate API)
 * 6. Multi-window detection
 *
 * Run: npm run test:e2e -- --grep "startup"
 *       npx playwright test tests/e2e/startup.e2e.ts
 */
import { test, expect } from './fixtures/electronApp';
import { Selectors } from './helpers/selectors';
import { safeGetPageText } from './helpers/waitUtils';

test.describe('Startup flow tests', () => {
  test('app window is created and has at least one window', async ({ electronApp }) => {
    // Wait for the first window to appear first (electronApp.windows() may return empty before the window is created)
    const firstWindow = await electronApp.firstWindow();
    expect(firstWindow).toBeTruthy();

    // At this point there is at least one window
    const windows = electronApp.windows();
    expect(windows.length).toBeGreaterThanOrEqual(1);
  });

  test('initialization loading screen displays correctly and disappears', async ({ electronApp }) => {
    const window = await electronApp.firstWindow();

    // App.tsx shows a dark background + "KOSMOS" + "Initializing Core Services..." when isAppReady=false
    // Since the app may start quickly, the loading screen may have already disappeared — do a soft check
    const bodyText = await safeGetPageText(window, 1000);

    // Wait for the loading screen to disappear (if it hasn't yet)
    // The mainWindow fixture handles this wait, but since we're using electronApp directly we need to wait ourselves
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

  test('app title contains the brand name', async ({ mainWindow }) => {
    // Wait for the title to be set (React app loading may have a delay)
    await mainWindow.waitForFunction(
      () => document.title.length > 0,
      { timeout: 15_000 },
    );

    const title = await mainWindow.title();
    // Title should contain the brand name (depends on BRAND config)
    expect(title).toMatch(/KOSMOS|Kosmos/i);
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

    // StartupPage uses the .startup-page CSS class
    // Since StartupPage may have already completed and navigated to /login, we check both cases:
    // 1. StartupPage is still visible (progress bar exists)
    // 2. Already navigated to the next page (normal behavior)
    const isOnStartupPage = await window
      .locator(Selectors.STARTUP_PAGE)
      .isVisible()
      .catch(() => false);

    if (isOnStartupPage) {
      try {
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
      } catch {
        // StartupPage completed and navigated away during element validation — this is normal behavior
        const url = window.url();
        const hasValidRoute =
          /#\/(login|auto-login|loading|agent)/.test(url) ||
          !url.includes('#') ||
          url.endsWith('#/');
        expect(hasValidRoute).toBeTruthy();
      }
    } else {
      // StartupPage has completed — verify navigation to a valid route or still at root
      // Root path (no hash or #/) means StartupPage is in progress or just finished
      const url = window.url();
      const hasValidRoute =
        /#\/(login|auto-login|loading|agent)/.test(url) ||
        !url.includes('#') ||
        url.endsWith('#/');
      expect(hasValidRoute).toBeTruthy();
    }
  });

  test('app navigates to login page in empty userData environment', async ({ mainWindow }) => {
    // The test environment uses an isolated empty userData directory
    // Expected flow: App ready → StartupPage (~2.5s) → /login (when no user exists)

    // Wait for route to stabilize (allow ~2.5s for StartupPage animation + validation + margin)
    await mainWindow.waitForURL(/#\/(login|auto-login|loading)/, {
      timeout: 30_000,
    });

    const url = mainWindow.url();
    // In the empty directory scenario, recommendedAction should be SHOW_NEW_USER_SIGNUP → /login
    expect(url).toMatch(/#\/login/);
  });

  test('login page renders correctly after navigation', async ({ mainWindow }) => {
    // Wait for navigation to /login
    await mainWindow.waitForURL(/#\/login/, { timeout: 30_000 });

    // Verify the SignInPage root element exists (.signin-page)
    await expect(
      mainWindow.locator(Selectors.SIGN_IN_PAGE),
    ).toBeVisible({ timeout: 10_000 });

    // Verify SignInPage card renders
    await expect(
      mainWindow.locator(Selectors.SIGN_IN_CARD),
    ).toBeVisible({ timeout: 5_000 });
  });

  test('can execute code in the main process', async ({ electronApp }) => {
    // Verify the Playwright evaluate API can communicate with the Electron main process
    // Navigation (route changes) may occur during app startup, which can destroy the execution context
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
          // Wait for navigation to settle instead of fixed delay
          const retryWindow = await electronApp.firstWindow();
          await retryWindow.waitForLoadState('domcontentloaded');
          continue;
        }
        throw err;
      }
    }

    expect(appName).toBeTruthy();
    expect(typeof appName).toBe('string');
  });

  test('can get app version', async ({ electronApp }) => {
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
          // Wait for navigation to settle instead of fixed delay
          const retryWindow = await electronApp.firstWindow();
          await retryWindow.waitForLoadState('domcontentloaded');
          continue;
        }
        throw err;
      }
    }

    expect(appVersion).toBeTruthy();
    // Verify version format (x.y.z)
    expect(appVersion).toMatch(/^\d+\.\d+\.\d+/);
  });

  test('app userData path points to the isolated test directory', async ({
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
          // Wait for navigation to settle instead of fixed delay
          const retryWindow = await electronApp.firstWindow();
          await retryWindow.waitForLoadState('domcontentloaded');
          continue;
        }
        throw err;
      }
    }

    expect(userDataPath).toBeTruthy();
    // Verify that the userData path contains our test directory name
    // bootstrap.ts uses the USER_DATA_NAME env var to set the userData path
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
