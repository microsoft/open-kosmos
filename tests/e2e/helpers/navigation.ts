import type { Page } from '@playwright/test';

/**
 * Navigate to a specified route (compatible with HashRouter)
 *
 * @param page - Playwright Page object
 * @param route - target route path, e.g. '/agent' or '/settings/mcp'
 */
export async function navigateTo(page: Page, route: string): Promise<void> {
  const currentUrl = page.url();
  const baseUrl = currentUrl.split('#')[0];
  const targetUrl = `${baseUrl}#${route}`;
  await page.goto(targetUrl);
  // Wait for route change to take effect
  await page.waitForTimeout(500);
}

/**
 * Wait for route change to target path (regex match)
 *
 * @param page - Playwright Page object
 * @param routePattern - route matching regex, e.g. /#\/agent/
 * @param timeout - timeout in milliseconds
 */
export async function waitForRoute(
  page: Page,
  routePattern: RegExp,
  timeout = 15_000,
): Promise<void> {
  await page.waitForURL(routePattern, { timeout });
}

/**
 * Get current HashRouter route path
 *
 * @param page - Playwright Page object
 * @returns current hash route path, e.g. '/agent/chat'
 */
export async function getCurrentRoute(page: Page): Promise<string> {
  const url = page.url();
  const hash = url.split('#')[1] || '/';
  return hash;
}

/**
 * Click to navigate to a specified route and wait for route change
 *
 * @param page - Playwright Page object
 * @param selector - navigation link selector
 * @param expectedRoute - expected destination route regex
 * @param timeout - timeout in milliseconds
 */
export async function clickAndWaitForRoute(
  page: Page,
  selector: string,
  expectedRoute: RegExp,
  timeout = 15_000,
): Promise<void> {
  await Promise.all([
    page.waitForURL(expectedRoute, { timeout }),
    page.locator(selector).click(),
  ]);
}
