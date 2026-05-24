/**
 * Playwright shared service type definitions
 */

/** Browser installation check result */
export interface BrowserCheckResult {
  installed: boolean;
  browserPath?: string;
  error?: string;
}

/** Browser installation result */
export interface BrowserInstallResult {
  success: boolean;
  message: string;
  browserPath?: string;
}

/** Browser launch options */
export interface LaunchOptions {
  /** Use an installed browser channel, e.g. "msedge" */
  channel?: string;
  /** Headless mode */
  headless?: boolean;
  /** Browser launch timeout (ms) */
  timeout?: number;
  /** Extra Chromium CLI arguments */
  args?: string[];
  /** Arguments to remove from Playwright’s default arg list */
  ignoreDefaultArgs?: string[] | boolean;
  /** Viewport size */
  viewport?: { width: number; height: number };
}

/** Persistent context launch options */
export interface PersistentContextOptions extends LaunchOptions {
  /** Profile name, used to construct the userData path */
  profileName: string;
  /** Window off-screen (invisible) but not headless */
  offscreen?: boolean;
}
