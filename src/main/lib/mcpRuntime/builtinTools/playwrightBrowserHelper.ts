/**
 * PlaywrightBrowserHelper - Playwright browser detection and auto-installation tool
 * 
 * Checks whether Chromium headless browser is installed before executing search tools,
 * and automatically installs it if not found.
 * Supports tools that depend on Playwright such as Bing/Google Web/Image Search.
 * 
 * Key design decisions:
 * - Only uses headless mode, not headful mode
 * - Validates browser availability through actual chromium.launch() instead of hardcoded paths
 * - Browser version automatically matches the Playwright version, no manual version maintenance needed
 */

import { getUnifiedLogger } from '../../unifiedLogger';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const logger = getUnifiedLogger();

// Browser installation status cache
let browserInstallChecked = false;
let browserAvailable = false;

// Installation lock to prevent concurrent installations
let installInProgress = false;
let installPromise: Promise<boolean> | null = null;

export interface BrowserCheckResult {
  installed: boolean;
  browserPath?: string;
  error?: string;
}

export interface BrowserInstallResult {
  success: boolean;
  message: string;
  browserPath?: string;
}

/**
 * Check if Playwright Chromium browser is installed
 * 
 * Validates by actually attempting chromium.launch({ headless: true }),
 * which accurately detects the browser matching the current version regardless of Playwright upgrades.
 * Does not rely on hardcoded paths or version numbers.
 */
export async function checkBrowserInstalled(): Promise<BrowserCheckResult> {
  // If already checked and browser is available, return cached result directly
  if (browserInstallChecked && browserAvailable) {
    return {
      installed: true
    };
  }
  
  try {
    logger.debug('[PlaywrightBrowserHelper] Checking if Playwright Chromium browser is installed...');
    
    // Validate browser availability through actual launch
    // This is the most reliable approach, as Playwright internally selects the correct version of headless-shell
    const { chromium } = await import('playwright');
    
    try {
      const browser = await chromium.launch({
        headless: true,
        timeout: 15000 // 15-second timeout, for detection only
      });
      await browser.close();
      
      logger.debug('[PlaywrightBrowserHelper] Playwright Chromium browser verified successfully (headless launch test passed)');
      browserInstallChecked = true;
      browserAvailable = true;
      return {
        installed: true
      };
    } catch (launchError) {
      const errorMsg = String(launchError);
      
      // Distinguish between "browser not installed" and "other launch errors"
      if (errorMsg.includes('Executable doesn\'t exist') || 
          errorMsg.includes('browserType.launch') ||
          errorMsg.includes('ENOENT') ||
          errorMsg.includes('not found') ||
          errorMsg.includes('install')) {
        logger.warn(`[PlaywrightBrowserHelper] Playwright Chromium browser not installed: ${errorMsg}`);
        browserInstallChecked = true;
        browserAvailable = false;
        return {
          installed: false,
          error: `Playwright Chromium browser not installed. Error: ${errorMsg}`
        };
      }
      
      // Other errors (e.g., timeout), also mark as not installed to trigger installation
      logger.warn(`[PlaywrightBrowserHelper] Playwright browser launch failed: ${errorMsg}`);
      browserInstallChecked = true;
      browserAvailable = false;
      return {
        installed: false,
        error: errorMsg
      };
    }
  } catch (error) {
    logger.error('[PlaywrightBrowserHelper] Error checking browser installation status:', String(error));
    return {
      installed: false,
      error: String(error)
    };
  }
}

/**
 * Get the cli.js path of playwright-core from the app's built-in node_modules
 * This ensures we use the installer consistent with the bundled Playwright version
 */
function getPlaywrightCliPath(): string | null {
  try {
    // Try multiple possible paths
    const possiblePaths = [
      // Development environment: node_modules in project root
      path.join(__dirname, '..', '..', '..', '..', '..', 'node_modules', 'playwright-core', 'cli.js'),
      path.join(__dirname, '..', '..', '..', '..', '..', 'node_modules', 'playwright', 'node_modules', 'playwright-core', 'cli.js'),
      // Production environment: paths inside app.asar
      path.join(process.resourcesPath || '', 'app.asar', 'node_modules', 'playwright-core', 'cli.js'),
      path.join(process.resourcesPath || '', 'app.asar', 'node_modules', 'playwright', 'node_modules', 'playwright-core', 'cli.js'),
      // Unpacked asar
      path.join(process.resourcesPath || '', 'app.asar.unpacked', 'node_modules', 'playwright-core', 'cli.js'),
      path.join(process.resourcesPath || '', 'app.asar.unpacked', 'node_modules', 'playwright', 'node_modules', 'playwright-core', 'cli.js'),
    ];
    
    for (const cliPath of possiblePaths) {
      if (fs.existsSync(cliPath)) {
        logger.debug(`[PlaywrightBrowserHelper] Found Playwright CLI: ${cliPath}`);
        return cliPath;
      }
    }
    
    // Try to find via require.resolve
    try {
      const resolved = require.resolve('playwright-core/cli');
      if (fs.existsSync(resolved)) {
        logger.debug(`[PlaywrightBrowserHelper] Found Playwright CLI via require.resolve: ${resolved}`);
        return resolved;
      }
    } catch {
      // ignore
    }
    
    logger.warn('[PlaywrightBrowserHelper] Built-in Playwright CLI not found');
    return null;
  } catch (error) {
    logger.error('[PlaywrightBrowserHelper] Error finding Playwright CLI:', String(error));
    return null;
  }
}

/**
 * Install Playwright Chromium headless browser
 * Only installs chromium-headless-shell, not the full chromium GUI browser
 * 
 * Installation strategy:
 * 1. Prefer the app's built-in playwright-core CLI to ensure version consistency
 * 2. Fall back to npx playwright install
 * The installed browser version is determined by Playwright itself, no hardcoding needed
 */
export async function installBrowser(): Promise<BrowserInstallResult> {
  // If installation is already in progress, wait for it to complete
  if (installInProgress && installPromise) {
    logger.debug('[PlaywrightBrowserHelper] Browser installation in progress, waiting for completion...');
    const result = await installPromise;
    return {
      success: result,
      message: result ? 'Browser already installed by concurrent process' : 'Concurrent installation failed'
    };
  }
  
  installInProgress = true;
  
  installPromise = (async () => {
    try {
      logger.info('[PlaywrightBrowserHelper] Starting Playwright Chromium headless browser installation...');
      
      // Prefer the app's built-in Playwright CLI to ensure the installed browser version matches the app
      const playwrightCliPath = getPlaywrightCliPath();
      
      let command: string;
      let args: string[];
      
      if (playwrightCliPath) {
        // Use the built-in Playwright CLI
        command = process.execPath; // Use the current Node.js/Electron executable
        args = [playwrightCliPath, 'install', 'chromium-headless-shell'];
        logger.info(`[PlaywrightBrowserHelper] Installing headless browser using built-in Playwright CLI: ${playwrightCliPath}`);
      } else {
        // Fall back to npx (version mismatch possible, but at least try)
        command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
        args = ['playwright', 'install', 'chromium-headless-shell'];
        logger.warn('[PlaywrightBrowserHelper] Built-in Playwright CLI not found, falling back to npx (version mismatch possible)');
      }
      
      logger.info(`[PlaywrightBrowserHelper] Executing command: ${command} ${args.join(' ')}`);
      
      return new Promise<boolean>((resolve) => {
        const child = spawn(command, args, {
          stdio: ['pipe', 'pipe', 'pipe'],
          shell: true,
          env: {
            ...process.env,
            PATH: process.env.PATH
          }
        });
        
        let stdout = '';
        let stderr = '';
        
        child.stdout?.on('data', (data: Buffer) => {
          const output = data.toString();
          stdout += output;
          logger.debug('[PlaywrightBrowserHelper] stdout:', output.trim());
        });
        
        child.stderr?.on('data', (data: Buffer) => {
          const output = data.toString();
          stderr += output;
          // Playwright progress info is output to stderr
          if (output.includes('Downloading') || output.includes('chromium')) {
            logger.info('[PlaywrightBrowserHelper] Installation progress:', output.trim());
          } else {
            logger.debug('[PlaywrightBrowserHelper] stderr:', output.trim());
          }
        });
        
        child.on('close', (code: number | null) => {
          if (code === 0) {
            logger.info('[PlaywrightBrowserHelper] Playwright Chromium headless browser installed successfully');
            // Reset cache after successful installation so next checkBrowserInstalled re-verifies via launch
            browserInstallChecked = false;
            browserAvailable = false;
            resolve(true);
          } else {
            logger.error(`[PlaywrightBrowserHelper] Browser installation failed, exit code: ${code}`);
            logger.error('[PlaywrightBrowserHelper] stdout:', stdout);
            logger.error('[PlaywrightBrowserHelper] stderr:', stderr);
            resolve(false);
          }
        });
        
        child.on('error', (error: Error) => {
          logger.error('[PlaywrightBrowserHelper] Installation process error:', error.message);
          resolve(false);
        });
        
        // Set timeout (5 minutes)
        setTimeout(() => {
          if (child.exitCode === null) {
            logger.error('[PlaywrightBrowserHelper] Browser installation timed out, force terminating');
            child.kill('SIGTERM');
            resolve(false);
          }
        }, 5 * 60 * 1000);
      });
      
    } catch (error) {
      logger.error('[PlaywrightBrowserHelper] Error installing browser:', String(error));
      return false;
    } finally {
      installInProgress = false;
      installPromise = null;
    }
  })();
  
  const success = await installPromise;
  
  return {
    success,
    message: success 
      ? 'Playwright Chromium headless-shell installed successfully' 
      : 'Failed to install Playwright Chromium headless-shell'
  };
}

/**
 * Ensure browser is installed, automatically install if not
 * This is the main function that search tools should call
 */
export async function ensureBrowserInstalled(): Promise<BrowserCheckResult> {
  // First check if browser is installed
  const checkResult = await checkBrowserInstalled();
  
  if (checkResult.installed) {
    logger.debug('[PlaywrightBrowserHelper] Browser is installed, ready to proceed');
    return checkResult;
  }
  
  // Browser not installed, attempt automatic installation
  logger.info('[PlaywrightBrowserHelper] Browser not installed, starting automatic installation...');
  
  const installResult = await installBrowser();
  
  if (installResult.success) {
    // After successful installation, re-verify via launch test
    const verifyResult = await checkBrowserInstalled();
    if (verifyResult.installed) {
      return verifyResult;
    }
    
    // Install command succeeded but verification failed (rare case)
    logger.warn('[PlaywrightBrowserHelper] Install command succeeded but browser verification failed');
    return {
      installed: false,
      error: 'Install command executed successfully, but browser verification failed. You may need to restart the application.'
    };
  }
  
  // Installation failed
  return {
    installed: false,
    error: installResult.message
  };
}

/**
 * Reset browser installation status cache (for testing or forced re-check)
 */
export function resetBrowserCheckCache(): void {
  browserInstallChecked = false;
  browserAvailable = false;
  logger.debug('[PlaywrightBrowserHelper] Browser installation status cache has been reset');
}
