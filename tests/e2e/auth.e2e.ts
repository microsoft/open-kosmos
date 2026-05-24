/**
 * Sign-in page E2E tests — pure UI rendering validation
 *
 * Uses the real Electron app (electronApp fixture), does not click the login button,
 * and does not trigger IPC calls. Validates the static UI rendering of the login page.
 *
 * Tests related to the device code flow (requires clicking the login button) can be found in:
 *   mock-auth-device-flow.e2e.ts (uses mockedEmptyTest fixture + IPC mock)
 *
 * Run: npm run test:e2e -- --grep "login page"
 *       npx playwright test tests/e2e/auth.e2e.ts
 */
import { test, expect } from './fixtures/electronApp';
import { Selectors } from './helpers/selectors';

/**
 * Wait for the app to navigate to the login page.
 * In an empty userData environment, the startup flow is: App ready → StartupPage (~2.5s) → /login
 */
async function waitForLoginPage(
  page: import('@playwright/test').Page,
): Promise<void> {
  await page.waitForURL(/#\/login/, { timeout: 30_000 });
}

// ==================== Pure UI rendering tests ====================
// Does not click the login button or trigger IPC calls — safe to use with the real Electron app.

test.describe('Login page UI tests', () => {
  test('login page renders correctly (SignInPage root element)', async ({ mainWindow }) => {
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

  test('Welcome title contains the brand name', async ({ mainWindow }) => {
    await waitForLoginPage(mainWindow);

    // New user scenario shows "Welcome to KOSMOS"
    const titleLocator = mainWindow.locator(Selectors.SIGN_IN_CARD_TITLE);
    await expect(titleLocator).toBeVisible({ timeout: 10_000 });

    const titleText = await titleLocator.textContent();
    expect(titleText).toMatch(/Welcome to.*KOSMOS/i);
  });

  test('GitHub Copilot authentication description section exists', async ({ mainWindow }) => {
    await waitForLoginPage(mainWindow);

    // Verify "GitHub Copilot Authentication" heading
    await expect(
      mainWindow.locator('text=GitHub Copilot Authentication'),
    ).toBeVisible({ timeout: 10_000 });

    // Verify description text contains GitHub-related content (use more precise selector to avoid multiple matches)
    await expect(
      mainWindow.locator('h4:has-text("GitHub Copilot")'),
    ).toBeVisible({ timeout: 5_000 });
  });

  test('sign-in button exists and is clickable', async ({ mainWindow }) => {
    await waitForLoginPage(mainWindow);

    // Verify "Sign In with GitHub Copilot" button exists
    const signInButton = mainWindow.locator(Selectors.SIGN_IN_BUTTON);
    await expect(signInButton).toBeVisible({ timeout: 10_000 });

    // Verify button is clickable (not disabled)
    await expect(signInButton).toBeEnabled({ timeout: 5_000 });
  });

  test('login card contains the correct icon', async ({ mainWindow }) => {
    await waitForLoginPage(mainWindow);

    // Verify icon container exists (SVG inside .signin-icon-wrapper)
    const iconWrapper = mainWindow.locator('.signin-icon-wrapper');
    await expect(iconWrapper).toBeVisible({ timeout: 10_000 });

    // Verify icon container contains an SVG element
    const svgInIcon = iconWrapper.locator('svg');
    await expect(svgInIcon).toBeVisible({ timeout: 5_000 });
  });

  test('login page uses correct visual styles', async ({ mainWindow }) => {
    await waitForLoginPage(mainWindow);

    // Verify .signin-page background style (gradient)
    const signinPage = mainWindow.locator(Selectors.SIGN_IN_PAGE);
    await expect(signinPage).toBeVisible({ timeout: 10_000 });

    // Verify card has border-radius (via computed style)
    const cardBorderRadius = await mainWindow.evaluate(() => {
      const card = document.querySelector('.signin-card');
      if (!card) return '';
      return window.getComputedStyle(card).borderRadius;
    });

    // .signin-card has border-radius
    expect(cardBorderRadius).toBeTruthy();
    // Extract px value as a number for comparison
    const radiusValue = parseInt(cardBorderRadius, 10);
    expect(radiusValue).toBeGreaterThanOrEqual(6); // at least 6px border-radius
  });
});
