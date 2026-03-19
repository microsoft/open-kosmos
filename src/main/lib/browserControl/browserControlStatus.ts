/**
 * Browser Control status check utility functions
 * Shared by main.ts IPC handler and browserControlMonitor
 */

import { exec } from 'child_process';
import { BROWSER_CONFIG, BrowserType } from './browserConfig';

const MCP_SERVER_NAME = 'kosmos-chrome-extension';
const NATIVE_HOST_NAME = 'com.chromemcp.nativehost';

/**
 * Check if the browser is installed
 * Detected via registry App Paths
 * 
 * @param browser Browser type ('chrome' | 'edge')
 * @returns Whether installed
 */
export async function checkBrowserInstalled(browser: BrowserType): Promise<boolean> {
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
 * Check if Browser Control is enabled for the specified browser
 * Determined by NativeMessagingHosts configuration in the registry
 * 
 * @param browser Browser type ('chrome' | 'edge')
 * @returns Whether enabled
 */
export async function checkBrowserControlEnabled(browser: BrowserType): Promise<boolean> {
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
 * Check complete Browser Control status (registry + MCP profile)
 * 
 * @param browser Browser type
 * @param userAlias Current user alias
 * @returns Whether enabled (registry config exists AND MCP config exists)
 */
export async function checkBrowserControlStatus(
  browser: BrowserType,
  userAlias: string | null
): Promise<boolean> {
  try {
    // 1. Check if Native Messaging Host configuration exists in registry
    const isRegistryConfigured = await checkBrowserControlEnabled(browser);
    if (!isRegistryConfigured) {
      return false;
    }
    
    // 2. Check if configuration exists in MCP profile
    if (!userAlias) {
      return false;
    }
    
    const { profileCacheManager } = await import('../userDataADO');
    const serverInfo = profileCacheManager.getMcpServerInfo(userAlias, MCP_SERVER_NAME);
    
    return !!serverInfo.config;
  } catch (error) {
    console.warn('[BrowserControlStatus] checkBrowserControlStatus failed:', error);
    return false;
  }
}
