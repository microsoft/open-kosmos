import type { Page, ElectronApplication } from '@playwright/test';

/**
 * Wait for app to fully load (through App.tsx's isAppReady gate)
 *
 * App.tsx displays "Initializing Core Services..." text before backend services are ready.
 * This function waits for that text to disappear from the DOM.
 *
 * @param page - Playwright Page object
 * @param timeout - timeout in milliseconds
 */
export async function waitForAppReady(
  page: Page,
  timeout = 30_000,
): Promise<void> {
  await page.waitForFunction(
    () => {
      const body = document.querySelector('body');
      return (
        body && !body.textContent?.includes('Initializing Core Services')
      );
    },
    { timeout },
  );
}

/**
 * Wait for a specific selector to become visible
 * Wraps the common waitForSelector pattern with a friendly error message
 *
 * @param page - Playwright Page object
 * @param selector - CSS selector
 * @param description - description of the wait target (used in error message)
 * @param timeout - timeout in milliseconds
 */
export async function waitForVisible(
  page: Page,
  selector: string,
  description = selector,
  timeout = 10_000,
): Promise<void> {
  try {
    await page.locator(selector).waitFor({ state: 'visible', timeout });
  } catch {
    const currentUrl = page.url();
    const bodySnippet = await page
      .locator('body')
      .textContent()
      .catch(() => '<unable to read>')
      .then((text) => text?.slice(0, 300));
    throw new Error(
      `[E2E] Timed out waiting for "${description}" (${selector}) to be visible.\n` +
        `  Current URL: ${currentUrl}\n` +
        `  Body snippet: ${bodySnippet}`,
    );
  }
}

/**
 * Wait for a specific IPC call to complete (via polling)
 *
 * @param checkFn - async check function that returns a boolean
 * @param timeout - timeout in milliseconds
 * @param interval - polling interval in milliseconds
 */
export async function waitForCondition(
  checkFn: () => Promise<boolean>,
  timeout = 10_000,
  interval = 500,
): Promise<void> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    const ready = await checkFn();
    if (ready) return;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  throw new Error(`[E2E] Condition check timed out after ${timeout}ms`);
}

/**
 * Safely get page text content (won't throw on failure)
 * Used for debugging and error diagnostics
 *
 * @param page - Playwright Page object
 * @param maxLength - maximum return length
 * @returns page text content or error description
 */
export async function safeGetPageText(
  page: Page,
  maxLength = 500,
): Promise<string> {
  try {
    const text = await page.locator('body').textContent();
    return text?.slice(0, maxLength) || '<empty>';
  } catch {
    return '<unable to read page content>';
  }
}

/**
 * Wait for specific text to disappear from the page
 *
 * @param page - Playwright Page object
 * @param text - text to wait to disappear
 * @param timeout - timeout in milliseconds
 */
export async function waitForTextToDisappear(
  page: Page,
  text: string,
  timeout = 15_000,
): Promise<void> {
  await page.waitForFunction(
    (t) => {
      const body = document.querySelector('body');
      return body && !body.textContent?.includes(t);
    },
    text,
    { timeout },
  );
}

/**
 * Take a screenshot for debugging
 * Saved to tests/e2e/test-results/ directory
 *
 * @param page - Playwright Page object
 * @param name - screenshot filename (without extension)
 */
export async function debugScreenshot(
  page: Page,
  name: string,
): Promise<void> {
  const path = `tests/e2e/test-results/debug-${name}-${Date.now()}.png`;
  await page.screenshot({ path, fullPage: true });
  console.log(`[E2E Debug] Screenshot saved: ${path}`);
}
