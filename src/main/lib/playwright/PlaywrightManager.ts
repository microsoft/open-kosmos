/**
 * PlaywrightManager — Playwright browser lifecycle management (app-level singleton)
 *
 * Responsibilities:
 * 1. Browser installation detection and auto-install
 * 2. Temporary browser instance launch (headless chromium for search tools)
 * 3. Persistent browser context management (Edge + SSO cookies for browser auth)
 * 4. Close all browsers on app exit
 *
 * IMPORTANT — Packaging Lessons Learned (March 2026):
 * ─────────────────────────────────────────────────────
 * This module imports "playwright-core" (NOT "playwright") at runtime.
 * In an Electron app packaged with electron-builder, only `dependencies`
 * (not `devDependencies`) are included in the final asar/app bundle.
 *
 * Key rules for this module:
 *
 * 1. playwright-core MUST be in package.json `dependencies`.
 *    "playwright" is the test-runner wrapper (~280 MB with bundled browsers);
 *    "playwright-core" is the lightweight API-only library (~8 MB).
 *    Only playwright-core is needed at runtime.
 *
 * 2. playwright-core MUST be in electron-builder `asarUnpack`.
 *    It spawns child processes (browser server) and performs filesystem I/O
 *    (mkdtemp, mkdir for user-data dirs), which cannot work inside asar.
 *
 * 3. playwright-core MUST be in webpack `externals`.
 *    Webpack must not bundle it — it needs to resolve from node_modules at
 *    runtime (outside asar, per rule #2).
 *
 * 4. All source files must import from 'playwright-core', not 'playwright'.
 *    The runtime package name must match what's in `dependencies`.
 *
 * Historical context: Commit 7ea925e moved "playwright" from dependencies
 * to devDependencies to reduce installer size, but forgot that the main
 * process requires it at runtime for browser auth and web search tools.
 * This silently broke all browser automation in packaged builds while
 * working fine in development (where devDeps are installed in node_modules).
 * Fixed in commit 09521ea.
 *
 * Incident notes from March 2026:
 * 5. Never spawn `process.execPath` for Playwright CLI inside Electron.
 *    In packaged builds that executable is the app itself, so a missing
 *    browser could accidentally relaunch a second app instance instead of
 *    running a Node-compatible CLI.
 *
 * 6. Prefer the bundled playwright-core CLI over `npx playwright install`.
 *    Using the local CLI keeps the browser revision aligned with the exact
 *    runtime dependency that will launch it later and avoids extra package
 *    resolution/network variability from npm.
 *
 * 7. `require.resolve('playwright-core/cli')` is not reliable here because
 *    Playwright's package exports do not expose that subpath. Resolve
 *    `playwright-core/package.json` first and derive `cli.js` from it.
 *
 * 8. A standalone validation script can prove that the Bun-backed `node`
 *    shim is capable of starting the CLI, but that does not prove first-run
 *    browser installation will be fast enough in real app sessions. The real
 *    install path still depends on current CDN throughput and filesystem lock
 *    handling in the shared Playwright cache.
 */

import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { app } from 'electron';
import { getUnifiedLogger } from '../unifiedLogger';
import { BrowserProfileManager } from './browserProfiles';
import type {
  BrowserCheckResult,
  BrowserInstallResult,
  LaunchOptions,
  PersistentContextOptions,
} from './types';

// Playwright types — lazily imported to avoid loading at module init
import type { Browser, BrowserContext } from 'playwright-core';
import { chromium } from 'playwright-core';

const logger = getUnifiedLogger();

// Browser installation state cache
let browserInstallChecked = false;
let browserAvailable = false;

// Installation lock
let installPromise: Promise<boolean> | null = null;

interface InstallStrategy {
  command: string;
  args: string[];
  shell: boolean;
  label: string;
}

interface InstallCommandResult {
  success: boolean;
  exitCode?: number | null;
  stdout: string;
  stderr: string;
  error?: string;
  timedOut?: boolean;
}

export class PlaywrightManager {
  private static instance: PlaywrightManager | null = null;
  readonly profiles = new BrowserProfileManager();

  // Track active instances for cleanup
  private activeBrowsers: Set<Browser> = new Set();
  private activeContexts: Set<BrowserContext> = new Set();

  private constructor() {}

  static getInstance(): PlaywrightManager {
    if (!PlaywrightManager.instance) {
      PlaywrightManager.instance = new PlaywrightManager();
    }
    return PlaywrightManager.instance;
  }

  // ══════════════════════════════════════════════════════════════
  // Browser Installation Detection & Auto-install
  // ══════════════════════════════════════════════════════════════

  /**
   * Check if Playwright Chromium browser is installed.
   * Verifies via actual chromium.launch(), not hard-coded paths.
   */
  async checkBrowserInstalled(): Promise<BrowserCheckResult> {
    if (browserInstallChecked && browserAvailable) {
      // Guard against the exe being deleted after the last successful check
      // (e.g. playwright-core version bump, disk cleanup, manual removal).
      // chromium.executablePath() is synchronous and cheap — no launch needed.
      try {
        const chromiumType = await this._importChromium();
        const exePath = chromiumType.executablePath();
        if (fs.existsSync(exePath)) {
          return { installed: true };
        }
        logger.warn(`[PlaywrightManager] Cached browser available but exe no longer on disk (${exePath}), re-checking...`);
      } catch {
        // executablePath() failed (e.g. no browser set), fall through to full check
      }
      // Invalidate cache and do a full re-check
      browserInstallChecked = false;
      browserAvailable = false;
    }

    try {
      logger.debug('[PlaywrightManager] Checking if Playwright Chromium is installed...');
      const chromium = await this._importChromium();

      const browser = await chromium.launch({ headless: true, timeout: 15_000 });
      await browser.close();

      logger.debug('[PlaywrightManager] Playwright Chromium verified (headless launch OK)');
      browserInstallChecked = true;
      browserAvailable = true;
      return { installed: true };
    } catch (launchError) {
      const errorMsg = String(launchError);
      const isNotInstalled =
        errorMsg.includes("Executable doesn't exist") ||
        errorMsg.includes('browserType.launch') ||
        errorMsg.includes('ENOENT') ||
        errorMsg.includes('not found') ||
        errorMsg.includes('install');

      if (isNotInstalled) {
        logger.warn(`[PlaywrightManager] Chromium not installed: ${errorMsg}`);
      } else {
        logger.warn(`[PlaywrightManager] Chromium launch failed: ${errorMsg}`);
      }

      browserInstallChecked = true;
      browserAvailable = false;
      return { installed: false, error: errorMsg };
    }
  }

  /**
   * Install Playwright Chromium headless-shell.
   * Prefers built-in CLI, falls back to npx.
   */
  async installBrowser(): Promise<BrowserInstallResult> {
    // Concurrent install guard
    if (installPromise) {
      logger.debug('[PlaywrightManager] Install already in progress, waiting...');
      const result = await installPromise;
      return {
        success: result,
        message: result ? 'Browser installed by concurrent process' : 'Concurrent installation failed',
      };
    }

    installPromise = this._doInstall();
    try {
      const success = await installPromise;
      return {
        success,
        message: success
          ? 'Playwright Chromium headless-shell installed successfully'
          : 'Failed to install Playwright Chromium headless-shell',
      };
    } finally {
      installPromise = null;
    }
  }

  private async _doInstall(): Promise<boolean> {
    logger.info('[PlaywrightManager] Installing Playwright Chromium headless-shell...');

    const cliPath = this._findPlaywrightCli();
    const strategies = this._getInstallStrategies(cliPath);
    const errors: string[] = [];

    for (const strategy of strategies) {
      logger.info(`[PlaywrightManager] Attempting browser install via ${strategy.label}: ${this._formatCommand(strategy.command, strategy.args)}`);
      const result = await this._runInstallCommand(strategy.command, strategy.args, strategy.shell);

      if (result.success) {
        logger.info(`[PlaywrightManager] Chromium headless-shell installed via ${strategy.label}`);
        browserInstallChecked = false;
        browserAvailable = false;
        return true;
      }

      const outputSummary = this._summarizeInstallOutput(result.stdout, result.stderr);
      const errorMessage = result.error || `exit ${result.exitCode ?? 'unknown'}${outputSummary ? `: ${outputSummary}` : ''}`;
      logger.warn(`[PlaywrightManager] Install attempt failed via ${strategy.label}: ${errorMessage}`);
      errors.push(`${strategy.label}: ${errorMessage}`);

      if (result.timedOut) {
        // After a timeout Playwright may leave __dirlock behind in the shared
        // browser cache. Clean it up before trying the next strategy so the
        // next install attempt doesn't block on a stale lock.
        // NOTE: We clean the lock and then CONTINUE to the next strategy
        // (system node / npx) rather than breaking, because the Bun-backed
        // shim is known to be incompatible with Playwright's download logic
        // and a real Node/npx install can still succeed.
        this._cleanupPlaywrightInstallLock('install timeout');
        logger.warn('[PlaywrightManager] Install timed out; cleaned lock, continuing to next strategy');
        continue;
      }
    }

    logger.error(`[PlaywrightManager] All install strategies failed: ${errors.join(' | ')}`);
    return false;
  }

  private _getInstallStrategies(cliPath: string | null): InstallStrategy[] {
    const strategies: InstallStrategy[] = [];

    if (cliPath) {
      const internalNodeShim = this._findInternalNodeShim();
      if (internalNodeShim) {
        strategies.push({
          command: internalNodeShim,
          args: [cliPath, 'install', 'chromium-headless-shell'],
          // On Windows the shim is a .cmd batch file which requires the
          // cmd.exe interpreter to run — shell: false causes spawn EINVAL.
          shell: process.platform === 'win32',
          label: 'internal node shim',
        });
      }

      // Keep a real system Node fallback after the Bun-backed shim. The shim
      // is valid and avoids Electron relaunch issues, but a true Node runtime
      // is still useful as a secondary path when troubleshooting environment-
      // specific Bun behavior.
      strategies.push({
        command: process.platform === 'win32' ? 'node.exe' : 'node',
        args: [cliPath, 'install', 'chromium-headless-shell'],
        shell: false,
        label: 'system node',
      });
    } else {
      logger.warn('[PlaywrightManager] Built-in CLI not found, falling back to npx-only install flow');
    }

    strategies.push({
      command: process.platform === 'win32' ? 'npx.cmd' : 'npx',
      args: ['playwright', 'install', 'chromium-headless-shell'],
      shell: process.platform === 'win32',
      label: 'npx fallback',
    });

    return strategies;
  }

  private _findInternalNodeShim(): string | null {
    try {
      const userDataPath = app.getPath('userData');
      const binDir = path.join(userDataPath, 'bin');
      const nodeShim = path.join(binDir, process.platform === 'win32' ? 'node.cmd' : 'node');
      const bunBinary = path.join(binDir, process.platform === 'win32' ? 'bun.exe' : 'bun');

      if (fs.existsSync(nodeShim) && fs.existsSync(bunBinary)) {
        return nodeShim;
      }
    } catch (error) {
      logger.warn(`[PlaywrightManager] Failed to resolve internal node shim: ${error instanceof Error ? error.message : String(error)}`);
    }

    return null;
  }

  private _formatCommand(command: string, args: string[]): string {
    return [command, ...args].map((part) => {
      if (/\s/.test(part)) {
        return JSON.stringify(part);
      }
      return part;
    }).join(' ');
  }

  private _runInstallCommand(command: string, args: string[], shell: boolean): Promise<InstallCommandResult> {
    return new Promise((resolve) => {
      const child = spawn(command, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell,
        env: { ...process.env },
        windowsHide: true,
      });

      let stdout = '';
      let stderr = '';
      let settled = false;

      const finish = (result: InstallCommandResult) => {
        if (settled) {
          return;
        }
        settled = true;
        resolve(result);
      };

      child.stdout?.on('data', (data: Buffer) => {
        const output = data.toString();
        stdout += output;
        this._logInstallOutput('stdout', output);
      });

      child.stderr?.on('data', (data: Buffer) => {
        const output = data.toString();
        stderr += output;
        this._logInstallOutput('stderr', output);
      });

      child.on('close', (code: number | null) => {
        finish({
          success: code === 0,
          exitCode: code,
          stdout,
          stderr,
        });
      });

      child.on('error', (error: Error) => {
        finish({
          success: false,
          exitCode: -1,
          stdout,
          stderr,
          error: error.message,
        });
      });

      setTimeout(() => {
        if (child.exitCode === null) {
          // First-run browser downloads are large enough to expose slow CDN
          // paths in the field. Keep this timeout explicit and log-heavy so
          // future tuning decisions are based on real progress data instead of
          // a generic "search is stuck" symptom.
          logger.error('[PlaywrightManager] Install timed out, killing process');
          child.kill('SIGTERM');

          setTimeout(() => {
            if (child.exitCode === null) {
              logger.error('[PlaywrightManager] Install process ignored SIGTERM, sending SIGKILL');
              child.kill('SIGKILL');
            }
          }, 2_000);

          finish({
            success: false,
            exitCode: null,
            stdout,
            stderr,
            error: 'timed out after 5 minutes',
            timedOut: true,
          });
        }
      }, 5 * 60 * 1000);
    });
  }

  private _logInstallOutput(stream: 'stdout' | 'stderr', output: string): void {
    for (const line of output.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      const lowerLine = trimmed.toLowerCase();
      if (
        lowerLine.includes('download') ||
        lowerLine.includes('extract') ||
        lowerLine.includes('install') ||
        lowerLine.includes('chromium') ||
        lowerLine.includes('headless-shell') ||
        lowerLine.includes('error') ||
        lowerLine.includes('failed') ||
        lowerLine.includes('lock')
      ) {
        logger.info(`[PlaywrightManager] Install ${stream}: ${trimmed}`);
      } else {
        logger.debug(`[PlaywrightManager] Install ${stream}: ${trimmed}`);
      }
    }
  }

  private _summarizeInstallOutput(stdout: string, stderr: string): string {
    const combined = `${stderr}\n${stdout}`
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(-6);

    return combined.join(' | ').slice(0, 600);
  }

  private _cleanupPlaywrightInstallLock(reason: string): void {
    try {
      const lockPath = path.join(this._getPlaywrightCacheDir(), '__dirlock');
      if (!fs.existsSync(lockPath)) {
        return;
      }

      const lockStats = fs.statSync(lockPath);
      fs.rmSync(lockPath, { recursive: true, force: true });
      logger.warn(`[PlaywrightManager] Removed Playwright install lock after ${reason} (${lockStats.isDirectory() ? 'directory' : 'file'}): ${lockPath}`);
    } catch (error) {
      logger.warn(`[PlaywrightManager] Failed to remove Playwright install lock after ${reason}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private _getPlaywrightCacheDir(): string {
    if (process.platform === 'darwin') {
      return path.join(app.getPath('home'), 'Library', 'Caches', 'ms-playwright');
    }

    if (process.platform === 'win32') {
      return path.join(process.env.LOCALAPPDATA || app.getPath('temp'), 'ms-playwright');
    }

    return path.join(process.env.XDG_CACHE_HOME || path.join(app.getPath('home'), '.cache'), 'ms-playwright');
  }

  private _findPlaywrightCli(): string | null {
    const appPath = app.getAppPath();
    const possiblePaths = [
      // Webpack main-process output lives under .webpack/... in dev and inside
      // app.asar/.webpack/... in packaged builds, so this relative fallback
      // needs one extra ".." compared with a naive source-tree assumption.
      path.join(__dirname, '..', '..', '..', '..', '..', '..', 'node_modules', 'playwright-core', 'cli.js'),
      path.join(__dirname, '..', '..', '..', '..', '..', '..', 'node_modules', 'playwright', 'node_modules', 'playwright-core', 'cli.js'),
      path.join(appPath, 'node_modules', 'playwright-core', 'cli.js'),
      path.join(appPath, 'node_modules', 'playwright', 'node_modules', 'playwright-core', 'cli.js'),
      path.join(process.resourcesPath || '', 'app.asar', 'node_modules', 'playwright-core', 'cli.js'),
      path.join(process.resourcesPath || '', 'app.asar.unpacked', 'node_modules', 'playwright-core', 'cli.js'),
    ];

    for (const p of possiblePaths) {
      if (fs.existsSync(p)) return p;
    }

    try {
      // Do not use require.resolve('playwright-core/cli') here; package
      // exports block that subpath in modern installs.
      const packageJsonPath = require.resolve('playwright-core/package.json');
      const resolved = path.join(path.dirname(packageJsonPath), 'cli.js');
      if (fs.existsSync(resolved)) return resolved;
    } catch {
      // ignore
    }

    return null;
  }

  /**
   * Ensure browser is installed; auto-install if missing, then re-verify.
   */
  async ensureBrowserInstalled(): Promise<BrowserCheckResult> {
    const check = await this.checkBrowserInstalled();
    if (check.installed) return check;

    logger.info('[PlaywrightManager] Browser not installed, auto-installing...');
    const installResult = await this.installBrowser();

    if (installResult.success) {
      const verify = await this.checkBrowserInstalled();
      if (verify.installed) return verify;
      return { installed: false, error: 'Install succeeded but verification failed' };
    }

    return { installed: false, error: installResult.message };
  }

  // ══════════════════════════════════════════════════════════════
  // Temporary Browser (search tools, etc.)
  // ══════════════════════════════════════════════════════════════

  /**
   * Launch a temporary headless browser (no persistent profile).
   * Caller is responsible for closing the returned Browser.
   */
  async launchBrowser(options?: LaunchOptions): Promise<Browser> {
    const chromium = await this._importChromium();
    const browser = await chromium.launch({
      headless: options?.headless ?? true,
      channel: options?.channel,
      timeout: options?.timeout ?? 30_000,
      args: options?.args,
      ignoreDefaultArgs: options?.ignoreDefaultArgs,
    });
    this.activeBrowsers.add(browser);
    browser.on('disconnected', () => this.activeBrowsers.delete(browser));
    return browser;
  }

  // ══════════════════════════════════════════════════════════════
  // Persistent Context (for browser auth)
  // ══════════════════════════════════════════════════════════════

  /**
   * Launch a persistent browser context.
   * Prefers Edge (channel: "msedge") for enterprise SSO, falls back to bundled chromium.
   * Caller is responsible for closing the returned BrowserContext.
   */
  async launchPersistentContext(options: PersistentContextOptions): Promise<BrowserContext> {
    const chromium = await this._importChromium();
    const profilePath = this.profiles.ensureProfileDir(options.profileName);

    const launchArgs: string[] = [...(options.args || [])];
    if (options.offscreen) {
      launchArgs.push('--window-position=-32000,-32000', '--window-size=1,1');
    }

    const launchOpts = {
      headless: options.headless ?? false,
      timeout: options.timeout ?? 30_000,
      args: launchArgs.length > 0 ? launchArgs : undefined,
      viewport: options.viewport,
    };

    // Try Edge first (better SSO in enterprise)
    const channel = options.channel || 'msedge';
    try {
      const ctx = await chromium.launchPersistentContext(profilePath, {
        channel,
        ...launchOpts,
      });
      this.activeContexts.add(ctx);
      ctx.on('close', () => this.activeContexts.delete(ctx));
      logger.info(`[PlaywrightManager] Persistent context launched (channel=${channel}, profile=${options.profileName})`);
      return ctx;
    } catch (edgeError) {
      if (channel !== 'msedge') throw edgeError;
      logger.warn(`[PlaywrightManager] Edge not available, falling back to bundled chromium: ${edgeError instanceof Error ? edgeError.message : String(edgeError)}`);
    }

    // Fallback to bundled chromium
    const ctx = await chromium.launchPersistentContext(profilePath, launchOpts);
    this.activeContexts.add(ctx);
    ctx.on('close', () => this.activeContexts.delete(ctx));
    logger.info(`[PlaywrightManager] Persistent context launched (bundled chromium, profile=${options.profileName})`);
    return ctx;
  }

  // ══════════════════════════════════════════════════════════════
  // Internal helpers
  // ══════════════════════════════════════════════════════════════

  /**
   * Return the `chromium` browser type from playwright-core.
   *
   * playwright-core is `external` in both webpack and electron-vite main builds,
   * and `node_modules/playwright-core/**` is unpacked from asar. If loading
   * fails, it fails at main-process module-init time (other tools also do
   * `import { ... } from 'playwright-core'` at the top), not here.
   */
  private async _importChromium() {
    if (!chromium) {
      logger.error(
        '[PlaywrightManager] playwright-core.chromium is undefined — ' +
        'playwright-core may be trapped inside asar. ' +
        'Add "node_modules/playwright-core/**" to asarUnpack.'
      );
      throw new Error(
        '[PlaywrightManager] playwright-core.chromium is undefined — ' +
        'playwright-core may be trapped inside asar. ' +
        'Add "node_modules/playwright-core/**" to asarUnpack.'
      );
    }
    return chromium;
  }

  // ══════════════════════════════════════════════════════════════
  // Lifecycle
  // ══════════════════════════════════════════════════════════════

  /** Close all active browser instances */
  async closeAll(): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const ctx of this.activeContexts) {
      promises.push(ctx.close().catch((e) => logger.warn(`[PlaywrightManager] Failed to close context: ${e}`)));
    }
    for (const browser of this.activeBrowsers) {
      promises.push(browser.close().catch((e) => logger.warn(`[PlaywrightManager] Failed to close browser: ${e}`)));
    }
    await Promise.allSettled(promises);
    this.activeContexts.clear();
    this.activeBrowsers.clear();
    logger.info('[PlaywrightManager] All browsers closed');
  }

  /** Reset browser installation detection cache */
  resetInstallCache(): void {
    browserInstallChecked = false;
    browserAvailable = false;
  }
}
