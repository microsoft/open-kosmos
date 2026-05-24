import type { Page } from '@playwright/test';

/**
 * Navigate to the specified route (compatible with HashRouter).
 *
 * @param page - Playwright Page object
 * @param route - target route path, e.g. '/agent' or '/settings/mcp'
 */
export async function navigateTo(page: Page, route: string): Promise<void> {
  const currentUrl = page.url();
  const baseUrl = currentUrl.split('#')[0];
  const targetUrl = `${baseUrl}#${route}`;
  await page.goto(targetUrl);
  // Wait for the route change to take effect in the renderer
  await page.waitForFunction(
    (target: string) => window.location.hash.includes(target),
    route,
    { timeout: 5_000 },
  );
}

/**
 * Wait for a route change to the target path (regex match).
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
 * Get the current HashRouter route path.
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
 * Click to navigate to the specified route, then wait for the route change.
 *
 * @param page - Playwright Page object
 * @param selector - selector for the navigation link
 * @param expectedRoute - regex for the expected destination route
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
