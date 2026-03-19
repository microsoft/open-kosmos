#!/usr/bin/env node
/**
 * Automatically detect Electron version and rebuild native modules
 * Resolves the issue where Electron version cannot be detected during the postinstall phase in CI/CD
 */

const { execSync } = require('child_process');
const path = require('path');

// Read electron version from package.json
const packageJson = require(path.join(__dirname, '..', 'package.json'));
const electronVersion = packageJson.devDependencies.electron?.replace(/[\^~>=<]/g, '') || '';

if (!electronVersion) {
  console.warn('[rebuild-native] Warning: Could not find electron version in package.json');
  process.exit(0);
}

console.log(`[rebuild-native] Rebuilding native modules for Electron v${electronVersion}...`);

try {
  execSync(
    `npx @electron/rebuild --force --only better-sqlite3 -v ${electronVersion}`,
    { stdio: 'inherit', cwd: path.join(__dirname, '..') }
  );
  console.log('[rebuild-native] Successfully rebuilt native modules');
} catch (error) {
  console.warn('[rebuild-native] Warning: native module rebuild failed, but continuing...');
  // Don't throw error, let CI continue
}
