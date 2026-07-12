import { app } from 'electron';
import { existsSync, renameSync } from 'fs';
import * as path from 'path';

/**
 * Bootstrap (Stage 1) — Brand-Specific User Data Path Configuration
 *
 * This module configures `app.setName()` / `app.setPath('userData', ...)` and
 * MUST run before ANY other module reads `app.getPath('userData')`.
 *
 * ============================================================================
 * WHY THIS IS A SEPARATE MODULE (not inline in bootstrap.ts)
 * ============================================================================
 *
 * ES modules evaluate their `import` dependencies in source order, BEFORE the
 * importing module's own top-level statements run. `bootstrap.ts` ends with
 * `import './main'`, and `./main` has side effects at load time (module-level
 * singletons such as builtinToolsManager, plus
 * `new ElectronApp()`) that read `app.getPath('userData')`.
 *
 * When the main process is bundled with Vite/Rolldown (the `npm run dev`
 * pipeline), all of `./main` is inlined and evaluated BEFORE the body of
 * `bootstrap.ts`. If the setName/setPath calls lived in `bootstrap.ts`'s body,
 * they would run too late: by then Electron has already resolved `userData`
 * using the default app name ("Electron" for an unpackaged dev binary), so
 * runtime tools (bun/uv/python) install under
 * `.../Application Support/Electron/` instead of the brand folder
 * (`openkosmos-app`). The webpack/production build uses CommonJS
 * `require('./main')` (call-site ordering) and a packaged executable name, so
 * it was unaffected — hiding the dev/prod divergence.
 *
 * By placing this logic in a module that `bootstrap.ts` imports BEFORE
 * `./main`, ESM ordering guarantees it runs first under both bundlers.
 *
 * ============================================================================
 * ENVIRONMENT VARIABLES (injected at build time via define/DefinePlugin)
 * ============================================================================
 *
 * process.env.APP_NAME       → productName from config.json
 *                              "OpenKosmos"
 * process.env.APP_ID         → appId from config.json (Windows AUMID)
 * process.env.USER_DATA_NAME → userDataName from config.json
 *                              "openkosmos-app"
 *
 * ============================================================================
 * RUNTIME OVERRIDES (NOT replaced by the bundler define plugins)
 * ============================================================================
 *
 * The build-time vars above are string-literal-replaced at compile time, so a
 * runtime env var of the same name has no effect. Two runtime escape hatches
 * exist for cases where the compiled value is wrong or missing:
 *
 *   OPENKOSMOS_TEST_USER_DATA_PATH → exact userData path (E2E test isolation).
 *   OPENKOSMOS_USER_DATA_NAME      → override only the folder name under appData.
 *                                Lets a dev run pin the brand userData folder
 *                                without rebuilding (e.g. when launching a stale
 *                                or default-named bundle).
 *
 * Both are read via the bracket form `process['env'][...]` so the bundler does
 * not statically replace them.
 *
 * ============================================================================
 * LOGGING: why this module uses console.log (documented exception)
 * ============================================================================
 *
 * The OpenKosmos rule is that main-process code uses the unified logger. This module
 * is the one deliberate exception: it runs in Bootstrap Stage 1, BEFORE `./main`
 * and therefore before `app.setPath('userData', ...)` has taken effect. The
 * unified logger writes to `{userData}/logs/` and resolves that directory LAZILY
 * on its first call (then caches it for the process lifetime). Calling the logger
 * here would (a) bind that cached log dir to the PRE-override `userData` — the
 * exact ordering bug this module exists to prevent, sending logs to
 * `.../Application Support/Electron/logs/` instead of the brand folder — and
 * (b) pull the logger's transitive side effects ahead of the brand path setup.
 * These few `console.log` lines are intentionally raw startup diagnostics emitted
 * before any structured logging is available.
 */

// Access raw process.env at runtime (bracket form avoids define replacement).
function readRuntimeEnv(name: string): string | undefined {
  try {
    return process['env'][name];
  } catch {
    return undefined;
  }
}

const DEFAULT_USER_DATA_NAME = 'openkosmos-app';
const LEGACY_USER_DATA_NAME = 'kosmos-app';

function resolveUserDataPath(appDataPath: string, userDataName: string): string {
  const targetPath = path.join(appDataPath, userDataName);
  if (userDataName !== DEFAULT_USER_DATA_NAME) {
    return targetPath;
  }

  const legacyPath = path.join(appDataPath, LEGACY_USER_DATA_NAME);
  if (existsSync(targetPath) || !existsSync(legacyPath)) {
    return targetPath;
  }

  try {
    renameSync(legacyPath, targetPath);
    console.log(`[Bootstrap] Migrated legacy user data to: ${targetPath}`);
    return targetPath;
  } catch (error) {
    console.error(
      `[Bootstrap] Failed to migrate legacy user data; continuing with the legacy path: ${legacyPath}`,
      error,
    );
    return legacyPath;
  }
}

const testUserDataOverride = readRuntimeEnv('OPENKOSMOS_TEST_USER_DATA_PATH');

if (testUserDataOverride) {
  console.log(`[Bootstrap] E2E Test Mode — overriding userData to: ${testUserDataOverride}`);
  if (process.env.APP_NAME) {
    app.setName(process.env.APP_NAME);
  }
  app.setPath('userData', testUserDataOverride);
} else if (process.env.APP_NAME) {
  console.log(`[Bootstrap] Setting App Name to: ${process.env.APP_NAME}`);
  app.setName(process.env.APP_NAME);

  // USER_DATA_NAME determines the folder name under AppData/Application Support.
  // Explicit runtime folder overrides bypass migration. Otherwise use the
  // build-time folder name (or the OpenKosmos default) and migrate legacy data
  // only when selecting the standard destination.
  const runtimeUserDataName = readRuntimeEnv('OPENKOSMOS_USER_DATA_NAME');
  const userDataName = runtimeUserDataName || process.env.USER_DATA_NAME || DEFAULT_USER_DATA_NAME;
  const appDataPath = app.getPath('appData');
  const customUserDataPath = runtimeUserDataName
    ? path.join(appDataPath, runtimeUserDataName)
    : resolveUserDataPath(appDataPath, userDataName);
  console.log(`[Bootstrap] Setting User Data Path to: ${customUserDataPath}`);
  app.setPath('userData', customUserDataPath);
}

// On Windows, set the App User Model ID (AUMID) so that system notifications
// display the correct app name instead of the Electron default. Must be called
// before the first BrowserWindow is created.
if (process.platform === 'win32' && process.env.APP_ID) {
  console.log(`[Bootstrap] Setting App User Model ID to: ${process.env.APP_ID}`);
  app.setAppUserModelId(process.env.APP_ID);
}
