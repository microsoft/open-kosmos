/**
 * Browser Control status-check utility functions
 * Shared by the main.ts IPC handler and browserControlHttpServer
 */

import { exec } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BROWSER_CONFIG, BrowserType } from './browserConfig';
import { createLogger } from '../unifiedLogger';
import { profileCacheManager } from "../userDataADO";
const logger = createLogger();

const MCP_SERVER_NAME = 'openkosmos-chrome-extension';
const NATIVE_HOST_NAME = 'com.chromemcp.nativehost';

/**
 * Check whether the browser is installed
 * Windows: detected via the App Paths registry key
 * macOS: temporarily returns true directly
 *
 * @param browser Browser type ('chrome' | 'edge')
 * @returns Whether the browser is installed
 */
export async function checkBrowserInstalled(browser: BrowserType): Promise<boolean> {
  if (process.platform === 'darwin') {
    // macOS: check whether /Applications/{AppName}.app exists
    const browserConfig = BROWSER_CONFIG[browser];
    const appPath = `/Applications/${browserConfig.macAppName}.app`;
    return fs.existsSync(appPath);
  }

  try {
    const browserConfig = BROWSER_CONFIG[browser];

    return await new Promise<boolean>((resolve) => {
      exec(`reg query "${browserConfig.appPathRegKey}"`, (error: Error | null) => {
        resolve(!error);
      });
    });
  } catch {
    return false;
  }
}

/**
 * Check whether Browser Control is enabled for the specified browser
 * Windows: determined by the NativeMessagingHosts registry configuration
 * macOS: temporarily returns true directly
 *
 * @param browser Browser type ('chrome' | 'edge')
 * @returns Whether Browser Control is enabled
 */
export async function checkBrowserControlEnabled(browser: BrowserType): Promise<boolean> {
  if (process.platform === 'darwin') {
    // macOS: check whether the NativeMessagingHost manifest file exists
    // Chrome: ~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.chromemcp.nativehost.json
    // Edge:   ~/Library/Application Support/Microsoft Edge/NativeMessagingHosts/com.chromemcp.nativehost.json
    const browserConfig = BROWSER_CONFIG[browser];
    const browserDirName = browser === 'chrome' ? 'Google/Chrome' : 'Microsoft Edge';
    const manifestPath = path.join(
      os.homedir(), 'Library', 'Application Support',
      ...browserDirName.split('/'),
      'NativeMessagingHosts', `${NATIVE_HOST_NAME}.json`
    );
    return fs.existsSync(manifestPath);
  }

  try {
    const browserConfig = BROWSER_CONFIG[browser];
    const regPath = `HKCU\\${browserConfig.nativeHostRegPath}\\${NATIVE_HOST_NAME}`;

    return await new Promise<boolean>((resolve) => {
      exec(`reg query "${regPath}"`, (error: Error | null, stdout: string) => {
        resolve(!error && stdout.includes(NATIVE_HOST_NAME));
      });
    });
  } catch {
    return false;
  }
}

/**
 * Check the full Browser Control status
 * enabled = browser installed AND NativeMessagingHost configured AND MCP profile configured AND Native Server installed
 *
 * @param browser Browser type
 * @param userAlias Current user alias
 * @returns Whether fully enabled (all conditions met)
 */
export async function checkBrowserControlStatus(
  browser: BrowserType,
  userAlias: string | null
): Promise<boolean> {
  try {
    // 1. Check if browser is installed
    const isBrowserInstalled = await checkBrowserInstalled(browser);
    if (!isBrowserInstalled) {
      return false;
    }

    // 2. Check if Native Messaging Host is configured (Windows: registry, macOS: manifest file)
    const isRegistryConfigured = await checkBrowserControlEnabled(browser);
    if (!isRegistryConfigured) {
      return false;
    }

    // 3. Check if MCP profile has config
    if (!userAlias) {
      return false;
    }

    const serverInfo = profileCacheManager.getMcpServerInfo(userAlias, MCP_SERVER_NAME);
    if (!serverInfo.config) {
      return false;
    }

    // 4. Check if Native Server is installed locally
    const { NativeServerFetcher } = await import('./nativeServerFetcher');
    const fetcher = new NativeServerFetcher();
    const nativeServerCheck = fetcher.checkLocalNativeServer();
    if (!nativeServerCheck.exists) {
      return false;
    }

    return true;
  } catch (error) {
    logger.warn(`[BrowserControlStatus] checkBrowserControlStatus failed: ${error instanceof Error ? error.message : String(error)}`)
    return false;
  }
}
