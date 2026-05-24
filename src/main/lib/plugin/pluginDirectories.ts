/**
 * Plugin directory and path management.
 *
 * Layout under {userData}:
 *   plugins/
 *   ├── installed.json          — install registry
 *   └── packages/
 *       └── {plugin-name}/      — extracted plugin content
 */

import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';

/** Root directory for all plugin data. */
export function getPluginsBaseDir(): string {
  return path.join(app.getPath('userData'), 'plugins');
}

/** Directory where extracted plugin packages live. */
export function getPluginPackagesDir(): string {
  return path.join(getPluginsBaseDir(), 'packages');
}

/** Absolute path to a specific plugin's package directory. */
export function getPluginDir(pluginName: string): string {
  return path.join(getPluginPackagesDir(), pluginName);
}

/** Path to the global installed-plugins registry file. */
export function getInstalledPluginsFilePath(): string {
  return path.join(getPluginsBaseDir(), 'installed.json');
}

/** Ensure all required plugin directories exist. */
export function ensurePluginDirectories(): void {
  const dirs = [getPluginsBaseDir(), getPluginPackagesDir()];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}
