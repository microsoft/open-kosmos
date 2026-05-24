import { app } from 'electron';
import * as path from 'path';

/**
 * Bootstrap - Brand-Specific User Data Path Configuration
 *
 * This file MUST be the entry point (configured in webpack.main.config.js)
 * to ensure user data paths are set BEFORE any other modules cache them.
 *
 * ============================================================================
 * ENVIRONMENT VARIABLES (injected at build time via webpack.DefinePlugin)
 * ============================================================================
 *
 * process.env.APP_NAME       → productName from config.json
 *                              e.g. "OpenKosmos"
 *
 * process.env.APP_ID         → appId from config.json (used as Windows AUMID)
 *                              e.g. "com.openkosmos.app"
 *
 * process.env.USER_DATA_NAME → userDataName from config.json
 *                              e.g. "openkosmos-app"
 *
 * process.env.BRAND_NAME     → Brand folder name
 *                              e.g. "openkosmos"
 *
 * ============================================================================
 * USER DATA PATH RESOLUTION
 * ============================================================================
 *
 * Windows:
 *   app.getPath('appData') = C:\Users\<user>\AppData\Roaming
 *   userData = C:\Users\<user>\AppData\Roaming\<userDataName>
 *            → openkosmos-app
 *
 * macOS:
 *   app.getPath('appData') = ~/Library/Application Support
 *   userData = ~/Library/Application Support/<userDataName>
 *            → openkosmos-app
 *
 * Linux:
 *   app.getPath('appData') = ~/.config
 *   userData = ~/.config/<userDataName>
 *
 * ============================================================================
 * WHY THIS IS IMPORTANT
 * ============================================================================
 *
 * 1. Brand Isolation: Separate user data directories per brand
 * 2. Timing: Must run before ANY module calls app.getPath('userData')
 * 3. Electron Default: Without this, Electron uses package.json "name" field
 *    which would be "openkosmos-app" for both brands (collision!)
 *
 */
// ============================================================================
// E2E TEST OVERRIDE: Allow tests to specify an exact userData path at runtime.
//
// process.env.USER_DATA_NAME is replaced by webpack DefinePlugin at build time,
// so runtime env vars with that name are ignored. We use a separate env var
// (OpenKosmos_TEST_USER_DATA_PATH) that webpack does NOT replace, giving E2E tests
// full control over the userData directory for isolation.
// ============================================================================
const testUserDataOverride = (() => {
  try {
    // Access the raw process.env at runtime (not DefinePlugin-replaced)
    return process['env']['OpenKosmos_TEST_USER_DATA_PATH'];
  } catch {
    return undefined;
  }
})();

if (testUserDataOverride) {
  console.log(`[Bootstrap] E2E Test Mode — overriding userData to: ${testUserDataOverride}`);
  if (process.env.APP_NAME) {
    app.setName(process.env.APP_NAME);
  }
  app.setPath('userData', testUserDataOverride);
} else if (process.env.APP_NAME) {
  console.log(`[Bootstrap] Setting App Name to: ${process.env.APP_NAME}`);
  app.setName(process.env.APP_NAME);

  // USER_DATA_NAME determines the folder name under AppData/Application Support
  // This is separate from APP_NAME to allow flexibility (no spaces in folder names)
  const userDataName = process.env.USER_DATA_NAME || process.env.APP_NAME;
  const customUserDataPath = path.join(app.getPath('appData'), userDataName);
  console.log(`[Bootstrap] Setting User Data Path to: ${customUserDataPath}`);
  app.setPath('userData', customUserDataPath);
}

// On Windows, set the App User Model ID (AUMID) so that system notifications
// display the correct app name instead of the Electron default "electron.app.<productName>".
// This must be called before the first BrowserWindow is created.
if (process.platform === 'win32' && process.env.APP_ID) {
  console.log(`[Bootstrap] Setting App User Model ID to: ${process.env.APP_ID}`);
  app.setAppUserModelId(process.env.APP_ID);
}

// Import the original main entry point
import './main';
