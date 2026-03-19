/**
 * Login Page E2E Tests — Pure UI Rendering Validation
 *
 * Uses the real Electron app (electronApp fixture), does not click login button, does not trigger IPC.
 * Validates that the login page static UI renders correctly.
 *
 * Device code flow tests (requiring login button clicks) can be found in:
 *   mock-auth-device-flow.e2e.ts (uses mockedEmptyTest fixture + IPC mock)
 *
 * Run: npm run test:e2e -- --grep "Login Page"
 *      npx playwright test tests/e2e/auth.e2e.ts
 */
import { test, expect } from './fixtures/electronApp';
import { Selectors } from './helpers/selectors';

/**
 * Wait for app to navigate to login page
 * In empty userData environment, startup flow: App ready → StartupPage (~2.5s) → /login
 */
async function waitForLoginPage(
  page: import('@playwright/test').Page,
): Promise<void> {
  await page.waitForURL(/#\/login/, { timeout: 30_000 });
}

// ==================== Pure UI Rendering Tests ====================
// Does not click login button, does not trigger IPC calls, safe to use real Electron app.

test.describe('Login Page UI Tests', () => {
  test('Login page renders correctly (SignInPage root element)', async ({ mainWindow }) => {
    await waitForLoginPage(mainWindow);

    // Verify .signin-page root element
    await expect(
      mainWindow.locator(Selectors.SIGN_IN_PAGE),
    ).toBeVisible({ timeout: 10_000 });

    // Verify .signin-card card container
    await expect(
      mainWindow.locator(Selectors.SIGN_IN_CARD),
    ).toBeVisible({ timeout: 5_000 });
  });

  test('Welcome title contains brand name', async ({ mainWindow }) => {
    await waitForLoginPage(mainWindow);

    // New user scenario shows "Welcome to KOSMOS"
    const titleLocator = mainWindow.locator(Selectors.SIGN_IN_CARD_TITLE);
    await expect(titleLocator).toBeVisible({ timeout: 10_000 });

    const titleText = await titleLocator.textContent();
    expect(titleText).toMatch(/Welcome to.*KOSMOS/i);
  });

  test('GitHub Copilot auth description area exists', async ({ mainWindow }) => {
    await waitForLoginPage(mainWindow);

    // Verify "GitHub Copilot Authentication" title
    await expect(
      mainWindow.locator('text=GitHub Copilot Authentication'),
    ).toBeVisible({ timeout: 10_000 });

    // Verify description text contains GitHub-related content (use more precise selector to avoid multiple matches)
    await expect(
      mainWindow.locator('h4:has-text("GitHub Copilot")'),
    ).toBeVisible({ timeout: 5_000 });
  });

  test('Login button exists and is clickable', async ({ mainWindow }) => {
    await waitForLoginPage(mainWindow);

    // Verify "Sign In with GitHub Copilot" button exists
    const signInButton = mainWindow.locator(Selectors.SIGN_IN_BUTTON);
    await expect(signInButton).toBeVisible({ timeout: 10_000 });

    // Verify button is clickable (not disabled)
    await expect(signInButton).toBeEnabled({ timeout: 5_000 });
  });

  test('Login card contains correct icon', async ({ mainWindow }) => {
    await waitForLoginPage(mainWindow);

    // Verify icon container exists (.signin-icon-wrapper with SVG inside)
    const iconWrapper = mainWindow.locator('.signin-icon-wrapper');
    await expect(iconWrapper).toBeVisible({ timeout: 10_000 });

    // Verify icon container has SVG element inside
    const svgInIcon = iconWrapper.locator('svg');
    await expect(svgInIcon).toBeVisible({ timeout: 5_000 });
  });

  test('Login page uses correct visual styles', async ({ mainWindow }) => {
    await waitForLoginPage(mainWindow);

    // Verify .signin-page background style (gradient)
    const signinPage = mainWindow.locator(Selectors.SIGN_IN_PAGE);
    await expect(signinPage).toBeVisible({ timeout: 10_000 });

    // Verify card has rounded corners (via computed style)
    const cardBorderRadius = await mainWindow.evaluate(() => {
      const card = document.querySelector('.signin-card');
      if (!card) return '';
      return window.getComputedStyle(card).borderRadius;
    });

    // .signin-card has border-radius
    expect(cardBorderRadius).toBeTruthy();
    // Extract px value as number for comparison
    const radiusValue = parseInt(cardBorderRadius, 10);
    expect(radiusValue).toBeGreaterThanOrEqual(6); // at least 6px border-radius
  });
});
