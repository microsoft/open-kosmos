/**
 * AppCacheManager
 *
 * Manages reading/writing and in-memory caching of {userData}/app.json.
 * On data changes, syncs every live renderer entry in real time via the IPC event 'app:configUpdated'.
 *
 * app.json structure:
 * {
 *   "updaterVersion": "0.0.5",
 *   "runtimeEnvironment": {
 *     "mode": "system" | "internal",
 *     "bunVersion": "1.3.6",
 *     "uvVersion": "0.6.17",
 *     "pinnedPythonVersion": "cpython-3.10.12-macos-aarch64-none" | null
 *   }
 * }
 *
 * Migration rules (integrityEnsure):
 *   If runtimeEnvironment is absent in app.json, migrate it from {userData}/runtimeConfig.json.
 *   Obsolete nativeServerVersion values are removed locally during initialization.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as electron from 'electron';
import { createConsoleLogger } from '../unifiedLogger';
import {
  AppConfig,
  RuntimeEnvironment,
  DEFAULT_RUNTIME_ENVIRONMENT,
  DEFAULT_APP_CONFIG,
  DEFAULT_UI_LANGUAGE,
  DEFAULT_VOICE_INPUT_CONFIG,
  DEFAULT_SCREENSHOT_SETTINGS,
  DEFAULT_APPEARANCE_CONFIG,
  isAppConfig,
  isThemeSource,
  isUiLanguage,
} from './types/app';
import type { ScreenshotSettings, ThemeSource } from './types/app';
import { getWindowBackgroundColor } from '../windowTheme';

// Re-export types so external callers can import them directly from appCacheManager
export { DEFAULT_RUNTIME_ENVIRONMENT, DEFAULT_APP_CONFIG, DEFAULT_UI_LANGUAGE, DEFAULT_VOICE_INPUT_CONFIG, DEFAULT_SCREENSHOT_SETTINGS, DEFAULT_APPEARANCE_CONFIG, isAppConfig, isUiLanguage, isThemeSource } from './types/app';
export type { UiLanguage, AppearanceConfig, ThemeSource, VoiceInputConfig, ScreenshotSettings } from './types/app';

const logger = createConsoleLogger();

const APP_CONFIG_FILENAME = 'app.json';
const LEGACY_RUNTIME_CONFIG_FILENAME = 'runtimeConfig.json';
const DEFAULT_ZOOM_LEVEL = 0;
const ZOOM_MIN = -3;
const ZOOM_MAX = 3;
const ZOOM_STEP = 0.5;

export interface AppConfigUpdateResult {
  config: AppConfig;
  revision: number;
}

function sanitizeZoomLevel(value: unknown, fallback: number = DEFAULT_ZOOM_LEVEL): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;

  const clamped = Math.min(Math.max(value, ZOOM_MIN), ZOOM_MAX);
  return Math.round(clamped / ZOOM_STEP) * ZOOM_STEP;
}

function getElectronApp(): Electron.App {
  try {
    if ((global as any).electron?.app) {
      return (global as any).electron.app;
    }
    return electron.app;
  } catch {
    throw new Error('[AppCacheManager] Electron app not available');
  }
}

function getElectronNativeTheme(): Electron.NativeTheme | undefined {
  try {
    return (electron as typeof electron & { nativeTheme?: Electron.NativeTheme }).nativeTheme;
  } catch {
    return undefined;
  }
}

// ─── AppCacheManager ──────────────────────────────────────────────────────────

/**
 * AppCacheManager — singleton
 *
 * Responsibilities:
 * 1. Read / write {userData}/app.json
 * 2. Keep an in-memory cache of the latest config
 * 3. integrityEnsure on read (migrate from legacy runtimeConfig.json when runtimeEnvironment is missing)
 * 4. appConfigSanitize on write (strip invalid fields and enforce type safety)
 * 5. Notify every live renderer entry via IPC after data updates
 *
 * 📖 Development guide: when adding new app-level config fields, see:
 * src/main/lib/userDataADO/README.md — "App-Level Config Development Guide"
 * The guide uses runtimeEnvironment as the reference implementation, covering
 * type definitions, integrity migration, and frontend sync.
 */
export class AppCacheManager {
  private static instance: AppCacheManager;

  private cache: AppConfig = {};
  private mainWindow: Electron.BrowserWindow | null = null;
  private initialized = false;
  private nativeThemeListenerInstalled = false;
  private updateQueue: Promise<unknown> = Promise.resolve();
  private configRevision = 0;

  // Debounce timer for batched frontend notifications
  private notifyTimer: NodeJS.Timeout | null = null;

  private constructor() {}

  static getInstance(): AppCacheManager {
    if (!AppCacheManager.instance) {
      AppCacheManager.instance = new AppCacheManager();
    }
    return AppCacheManager.instance;
  }

  // ── Setup ──────────────────────────────────────────────────────────────────

  public setMainWindow(window: Electron.BrowserWindow): void {
    this.mainWindow = window;
    this.applyWindowBackground(this.cache.appearance?.themeSource);
    // Push the current config immediately after the window reference is set, to ensure the frontend AppDataManager is initialized
    this.sendConfigToFrontend();
  }

  // ── Paths ──────────────────────────────────────────────────────────────────

  private getUserDataPath(): string {
    return getElectronApp().getPath('userData');
  }

  private getAppConfigPath(): string {
    return path.join(this.getUserDataPath(), APP_CONFIG_FILENAME);
  }

  private getLegacyRuntimeConfigPath(): string {
    return path.join(this.getUserDataPath(), LEGACY_RUNTIME_CONFIG_FILENAME);
  }

  // ── Load ───────────────────────────────────────────────────────────────────

  /**
   * Initialize: read app.json (including integrity check and data migration)
   */
  public async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      const raw = this.readRawConfig();
      const ensured = this.integrityEnsure(raw);
      this.cache = ensured;

      // Persist synchronously if the integrity check produced changes
      if (this.needsWrite(raw, ensured)) {
        await this.writeConfigToDisk(ensured);
      }

      this.applyNativeThemeSource(ensured.appearance?.themeSource);
      this.applyWindowBackground(ensured.appearance?.themeSource);
      this.initialized = true;
      logger.info('[AppCacheManager] Initialization complete', 'AppCacheManager', { config: this.cache });
    } catch (error) {
      logger.error('[AppCacheManager] Initialization failed', 'AppCacheManager', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Read the raw JSON from disk without any transformation.
   */
  private readRawConfig(): Partial<AppConfig> {
    const configPath = this.getAppConfigPath();
    if (!fs.existsSync(configPath)) {
      logger.info('[AppCacheManager] app.json not found, using empty config', 'AppCacheManager');
      return {};
    }

    try {
      const content = fs.readFileSync(configPath, 'utf-8');
      return JSON.parse(content) as Partial<AppConfig>;
    } catch (error) {
      logger.warn('[AppCacheManager] Failed to read app.json, using empty config', 'AppCacheManager', {
        error: error instanceof Error ? error.message : String(error),
      });
      return {};
    }
  }

  // ── integrityEnsure ────────────────────────────────────────────────────────

  /**
   * Integrity check:
   * - If runtimeEnvironment is missing, migrate from legacy runtimeConfig.json; otherwise fill with defaults.
   * - All other fields are left as-is.
   *
   * 📖 Standard pattern for adding new fields, see README Step 3a:
   * src/main/lib/userDataADO/README.md — "3a. integrityEnsure — called on every read"
   */
  private integrityEnsure(raw: Partial<AppConfig>): AppConfig {
    const result: AppConfig = { ...raw };
    delete (result as AppConfig & { microsoft?: unknown }).microsoft;
    delete (result as AppConfig & { nativeServerVersion?: unknown }).nativeServerVersion;

    if (!result.runtimeEnvironment) {
      const migrated = this.migrateRuntimeEnvironmentFromLegacy();
      result.runtimeEnvironment = migrated
        ? { ...DEFAULT_RUNTIME_ENVIRONMENT, ...migrated }
        : { ...DEFAULT_RUNTIME_ENVIRONMENT };

      if (migrated) {
        logger.info(
          '[AppCacheManager] runtimeEnvironment migrated from runtimeConfig.json',
          'AppCacheManager',
          { migrated },
        );
      } else {
        logger.info(
          '[AppCacheManager] runtimeEnvironment not found, using default values',
          'AppCacheManager',
        );
      }
    } else {
      // Fill in any sub-fields that may be missing
      result.runtimeEnvironment = {
        ...DEFAULT_RUNTIME_ENVIRONMENT,
        ...result.runtimeEnvironment,
      };
    }

    if (!isUiLanguage(result.uiLanguage)) {
      result.uiLanguage = DEFAULT_UI_LANGUAGE;
    }

    // voiceInput: fill with defaults if missing, merge sub-fields to add any new keys
    if (!result.voiceInput) {
      result.voiceInput = { ...DEFAULT_VOICE_INPUT_CONFIG };
    } else {
      result.voiceInput = { ...DEFAULT_VOICE_INPUT_CONFIG, ...result.voiceInput };
    }

    // screenshotSettings: fill with defaults if missing; on first run migrate from first profile
    if (!result.screenshotSettings) {
      const migrated = this.migrateScreenshotFromFirstProfile();
      result.screenshotSettings = migrated
        ? { ...DEFAULT_SCREENSHOT_SETTINGS, ...migrated }
        : { ...DEFAULT_SCREENSHOT_SETTINGS };

      if (migrated) {
        logger.info(
          '[AppCacheManager] screenshotSettings migrated from first profile',
          'AppCacheManager',
          { migrated },
        );
      } else {
        logger.info(
          '[AppCacheManager] screenshotSettings not found in profile, using default values',
          'AppCacheManager',
        );
      }
    } else {
      result.screenshotSettings = { ...DEFAULT_SCREENSHOT_SETTINGS, ...result.screenshotSettings };
    }

    // appearance: fill with defaults if missing, merge sub-fields to add any new keys
    if (!result.appearance) {
      result.appearance = { ...DEFAULT_APPEARANCE_CONFIG };
    } else {
      result.appearance = {
        ...DEFAULT_APPEARANCE_CONFIG,
        themeSource: isThemeSource(result.appearance.themeSource)
          ? result.appearance.themeSource
          : DEFAULT_APPEARANCE_CONFIG.themeSource,
      };
    }

    if (typeof result.leftSidebarCollapsed !== 'boolean') {
      result.leftSidebarCollapsed = DEFAULT_APP_CONFIG.leftSidebarCollapsed;
    }

    // leftSidebarWidth: clamp to [288, 400], default 288
    if (typeof result.leftSidebarWidth !== 'number' || !Number.isFinite(result.leftSidebarWidth)) {
      result.leftSidebarWidth = DEFAULT_APP_CONFIG.leftSidebarWidth;
    } else {
      result.leftSidebarWidth = Math.round(Math.min(400, Math.max(288, result.leftSidebarWidth)));
    }

    // zoomLevel: fill with default if missing and normalize persisted values
    result.zoomLevel = sanitizeZoomLevel(result.zoomLevel, DEFAULT_ZOOM_LEVEL);

    if (typeof result.mainWindowMaximized !== 'boolean') {
      result.mainWindowMaximized = DEFAULT_APP_CONFIG.mainWindowMaximized;
    }

    return result;
  }

  /**
   * Attempt to read ScreenshotSettings from the first user profile's profile.json.
   * Returns null if no profile exists or reading fails.
   */
  private migrateScreenshotFromFirstProfile(): Partial<ScreenshotSettings> | null {
    try {
      const profilesDir = path.join(this.getUserDataPath(), 'profiles');
      if (!fs.existsSync(profilesDir)) return null;

      const entries = fs.readdirSync(profilesDir, { withFileTypes: true });
      // Filter out hidden directories
      const firstProfileDir = entries.find((e) => {
        if (e.name.startsWith('.')) return false;
        return e.isDirectory();
      });
      if (!firstProfileDir) return null;

      const profileJsonPath = path.join(profilesDir, firstProfileDir.name, 'profile.json');
      if (!fs.existsSync(profileJsonPath)) return null;

      const content = fs.readFileSync(profileJsonPath, 'utf-8');
      const profile = JSON.parse(content);
      if (profile && typeof profile === 'object' && profile.screenshotSettings) {
        return profile.screenshotSettings as Partial<ScreenshotSettings>;
      }
      return null;
    } catch (error) {
      logger.warn('[AppCacheManager] Failed to migrate screenshotSettings from first profile', 'AppCacheManager', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Attempt to read RuntimeEnvironment data from the legacy runtimeConfig.json.
   * Returns null if the legacy file does not exist or reading fails.
   */
  private migrateRuntimeEnvironmentFromLegacy(): Partial<RuntimeEnvironment> | null {
    const legacyPath = this.getLegacyRuntimeConfigPath();
    if (!fs.existsSync(legacyPath)) return null;

    try {
      const content = fs.readFileSync(legacyPath, 'utf-8');
      const parsed = JSON.parse(content) as Partial<RuntimeEnvironment>;
      return parsed;
    } catch (error) {
      logger.warn('[AppCacheManager] Failed to read runtimeConfig.json', 'AppCacheManager', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Check whether the integrity check produced any changes (determines whether persistence is needed).
   */
  private needsWrite(before: Partial<AppConfig>, after: AppConfig): boolean {
    return JSON.stringify(before) !== JSON.stringify(after);
  }

  // ── appConfigSanitize ──────────────────────────────────────────────────────

  /**
   * Pre-write sanitization: filter invalid types and fill in required fields.
   *
   * 📖 Standard pattern for adding new fields, see README Step 3b:
   * src/main/lib/userDataADO/README.md — "3b. appConfigSanitize — called on every write"
   */
  private appConfigSanitize(config: Partial<AppConfig>): AppConfig {
    const sanitized: AppConfig = {};

    // updaterVersion: string | undefined
    if (typeof config.updaterVersion === 'string') {
      sanitized.updaterVersion = config.updaterVersion;
    }

    sanitized.uiLanguage = isUiLanguage(config.uiLanguage)
      ? config.uiLanguage
      : DEFAULT_UI_LANGUAGE;

    // runtimeEnvironment: RuntimeEnvironment | undefined
    const re = config.runtimeEnvironment;
    if (re && typeof re === 'object') {
      sanitized.runtimeEnvironment = {
        mode:
          re.mode === 'internal' || re.mode === 'system'
            ? re.mode
            : DEFAULT_RUNTIME_ENVIRONMENT.mode,
        bunVersion:
          typeof re.bunVersion === 'string' && re.bunVersion
            ? re.bunVersion
            : DEFAULT_RUNTIME_ENVIRONMENT.bunVersion,
        uvVersion:
          typeof re.uvVersion === 'string' && re.uvVersion
            ? re.uvVersion
            : DEFAULT_RUNTIME_ENVIRONMENT.uvVersion,
        pinnedPythonVersion:
          typeof re.pinnedPythonVersion === 'string'
            ? re.pinnedPythonVersion
            : re.pinnedPythonVersion === null
            ? null
            : DEFAULT_RUNTIME_ENVIRONMENT.pinnedPythonVersion ?? '3.10.12',
      };
    }

    // voiceInput: VoiceInputConfig | undefined
    const vi = config.voiceInput;
    if (vi && typeof vi === 'object') {
      sanitized.voiceInput = {
        voiceInputEnabled: typeof vi.voiceInputEnabled === 'boolean' ? vi.voiceInputEnabled : DEFAULT_VOICE_INPUT_CONFIG.voiceInputEnabled,
        whisperModelSelected: typeof vi.whisperModelSelected === 'string' ? vi.whisperModelSelected : DEFAULT_VOICE_INPUT_CONFIG.whisperModelSelected,
        recognitionLanguage: typeof vi.recognitionLanguage === 'string' ? vi.recognitionLanguage : DEFAULT_VOICE_INPUT_CONFIG.recognitionLanguage,
        gpuAcceleration: typeof vi.gpuAcceleration === 'boolean' ? vi.gpuAcceleration : DEFAULT_VOICE_INPUT_CONFIG.gpuAcceleration,
      };
    }

    // screenshotSettings: ScreenshotSettings | undefined
    const ss = config.screenshotSettings;
    if (ss && typeof ss === 'object') {
      sanitized.screenshotSettings = {
        enabled: typeof ss.enabled === 'boolean' ? ss.enabled : DEFAULT_SCREENSHOT_SETTINGS.enabled,
        shortcut: typeof ss.shortcut === 'string' ? ss.shortcut : DEFAULT_SCREENSHOT_SETTINGS.shortcut,
        shortcutEnabled: typeof ss.shortcutEnabled === 'boolean' ? ss.shortcutEnabled : DEFAULT_SCREENSHOT_SETTINGS.shortcutEnabled,
        savePath: typeof ss.savePath === 'string' ? ss.savePath : DEFAULT_SCREENSHOT_SETTINGS.savePath,
        freRejected: typeof ss.freRejected === 'boolean' ? ss.freRejected : DEFAULT_SCREENSHOT_SETTINGS.freRejected,
      };
    }

    // appearance: AppearanceConfig | undefined
    const appearance = config.appearance;
    if (appearance && typeof appearance === 'object') {
      sanitized.appearance = {
        themeSource: isThemeSource(appearance.themeSource)
          ? appearance.themeSource
          : DEFAULT_APPEARANCE_CONFIG.themeSource,
      };
    }

    if (typeof config.leftSidebarCollapsed === 'boolean') {
      sanitized.leftSidebarCollapsed = config.leftSidebarCollapsed;
    }

    // leftSidebarWidth: number, clamp to [288, 400]
    if (typeof config.leftSidebarWidth === 'number' && Number.isFinite(config.leftSidebarWidth)) {
      sanitized.leftSidebarWidth = Math.round(Math.min(400, Math.max(288, config.leftSidebarWidth)));
    }

    sanitized.zoomLevel = sanitizeZoomLevel(config.zoomLevel, DEFAULT_ZOOM_LEVEL);

    if (typeof config.mainWindowMaximized === 'boolean') {
      sanitized.mainWindowMaximized = config.mainWindowMaximized;
    }

    return sanitized;
  }

  // ── Write ──────────────────────────────────────────────────────────────────

  /**
   * Persist AppConfig data to app.json.
   * appConfigSanitize is applied before writing.
   */
  private async writeConfigToDisk(config: AppConfig): Promise<void> {
    const sanitized = this.appConfigSanitize(config);
    const configPath = this.getAppConfigPath();
    try {
      await fs.promises.writeFile(configPath, JSON.stringify(sanitized, null, 2), 'utf-8');
      logger.info('[AppCacheManager] app.json persisted', 'AppCacheManager', { path: configPath });
    } catch (error) {
      logger.error('[AppCacheManager] Failed to write app.json', 'AppCacheManager', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Synchronously read only the persisted startup theme source from app.json.
   *
   * This is intentionally narrower than initialize(): BrowserWindow creation uses it before
   * the async AppCacheManager initialization path can finish, so first-frame theme seeding
   * never depends on initialize() assigning cache before its first await.
   */
  public readStartupThemeSourceSync(): ThemeSource {
    try {
      const themeSource = this.readRawConfig().appearance?.themeSource;
      return isThemeSource(themeSource) ? themeSource : DEFAULT_APPEARANCE_CONFIG.themeSource;
    } catch (error) {
      logger.warn('[AppCacheManager] Failed to read startup theme source, using default', 'AppCacheManager', {
        error: error instanceof Error ? error.message : String(error),
      });
      return DEFAULT_APPEARANCE_CONFIG.themeSource;
    }
  }

  /**
   * Return a read-only copy of the current in-memory AppConfig.
   */
  public getConfig(): AppConfig {
    return { ...this.cache };
  }

  /**
   * Monotonic in-memory revision for live app-config writes.
   * Not persisted to app.json; used only to order IPC updates across windows.
   */
  public getConfigRevision(): number {
    return this.configRevision;
  }

  /**
   * Update AppConfig (partial updates supported). Persists and then notifies the frontend.
   * @param updates Fields to update (shallow merge; runtimeEnvironment supports partial field updates)
   */
  public updateConfig(updates: Partial<AppConfig>): Promise<AppConfigUpdateResult> {
    const run = this.updateQueue.then(() => this.applyConfigUpdate(updates));
    this.updateQueue = run.catch(() => undefined);
    return run;
  }

  private async applyConfigUpdate(updates: Partial<AppConfig>): Promise<AppConfigUpdateResult> {
    const merged: AppConfig = {
      ...this.cache,
      ...updates,
      // Deep-merge runtimeEnvironment
      uiLanguage: updates.uiLanguage !== undefined ? updates.uiLanguage : this.cache.uiLanguage,
      runtimeEnvironment:
        updates.runtimeEnvironment || this.cache.runtimeEnvironment
          ? {
              ...(this.cache.runtimeEnvironment ?? DEFAULT_RUNTIME_ENVIRONMENT),
              ...(updates.runtimeEnvironment ?? {}),
            }
          : undefined,
      // Deep-merge voiceInput
      voiceInput:
        updates.voiceInput || this.cache.voiceInput
          ? {
              ...(this.cache.voiceInput ?? DEFAULT_VOICE_INPUT_CONFIG),
              ...(updates.voiceInput ?? {}),
            }
          : undefined,
      // Deep-merge screenshotSettings
      screenshotSettings:
        updates.screenshotSettings || this.cache.screenshotSettings
          ? {
              ...(this.cache.screenshotSettings ?? DEFAULT_SCREENSHOT_SETTINGS),
              ...(updates.screenshotSettings ?? {}),
            }
          : undefined,
      // Deep-merge appearance
      appearance:
        updates.appearance || this.cache.appearance
          ? {
              ...(this.cache.appearance ?? DEFAULT_APPEARANCE_CONFIG),
              ...(updates.appearance ?? {}),
            }
          : undefined,
      // zoomLevel: simple scalar, no deep-merge needed
      zoomLevel: updates.zoomLevel !== undefined ? updates.zoomLevel : this.cache.zoomLevel,
      mainWindowMaximized:
        updates.mainWindowMaximized !== undefined
          ? updates.mainWindowMaximized
          : this.cache.mainWindowMaximized,
    };

    const sanitized = this.appConfigSanitize(merged);

    await this.writeConfigToDisk(sanitized);
    this.cache = sanitized;
    this.applyNativeThemeSource(sanitized.appearance?.themeSource);
    this.applyWindowBackground(sanitized.appearance?.themeSource);
    this.configRevision += 1;
    this.scheduleNotifyFrontend();

    logger.info('[AppCacheManager] Config updated', 'AppCacheManager', { updates });
    return { config: { ...this.cache }, revision: this.configRevision };
  }

  private applyNativeThemeSource(themeSource: ThemeSource | undefined): void {
    const currentNativeTheme = getElectronNativeTheme();
    if (!currentNativeTheme) {
      logger.warn('[AppCacheManager] Electron nativeTheme unavailable, skipping themeSource sync', 'AppCacheManager');
      return;
    }

    currentNativeTheme.themeSource = themeSource ?? DEFAULT_APPEARANCE_CONFIG.themeSource;
    this.installNativeThemeListener(currentNativeTheme);
  }

  private installNativeThemeListener(currentNativeTheme: Electron.NativeTheme): void {
    if (this.nativeThemeListenerInstalled) return;
    if (typeof currentNativeTheme.on !== 'function') return;
    this.nativeThemeListenerInstalled = true;

    currentNativeTheme.on('updated', () => {
      this.applyWindowBackground(this.cache.appearance?.themeSource);
    });
  }

  private applyWindowBackground(themeSource: ThemeSource | undefined): void {
    const targetWindow = this.mainWindow;
    if (!targetWindow || targetWindow.isDestroyed()) return;
    if (typeof targetWindow.setBackgroundColor !== 'function') return;

    targetWindow.setBackgroundColor(getWindowBackgroundColor(themeSource, getElectronNativeTheme()));
  }

  // ── Frontend Notification ──────────────────────────────────────────────────

  /**
   * Debounced frontend notification (150 ms).
   */
  private scheduleNotifyFrontend(): void {
    if (this.notifyTimer) {
      clearTimeout(this.notifyTimer);
    }
    this.notifyTimer = setTimeout(() => {
      this.notifyTimer = null;
      this.sendConfigToFrontend();
    }, 150);
  }

  /**
   * Immediately send the current cache to the frontend via IPC.
   */
  private sendConfigToFrontend(): void {
    try {
      const targetWindows = new Set<Electron.BrowserWindow>();

      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        targetWindows.add(this.mainWindow);
      }

      for (const window of electron.BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) {
          targetWindows.add(window);
        }
      }

      if (targetWindows.size === 0) {
        logger.warn('[AppCacheManager] No renderer window available, skipping notification', 'AppCacheManager');
        return;
      }

      const payload = {
        config: { ...this.cache },
        timestamp: Date.now(),
        revision: this.configRevision,
      };

      for (const targetWindow of targetWindows) {
        try {
          targetWindow.webContents.send('app:configUpdated', payload);
        } catch (error) {
          logger.error('[AppCacheManager] Failed to notify renderer window', 'AppCacheManager', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    } catch (error) {
      logger.error('[AppCacheManager] Failed to notify renderer windows', 'AppCacheManager', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // ── Screenshot Settings Public API ────────────────────────────────────────

  /**
   * Get the current screenshot settings (read-only copy).
   */
  public getScreenshotSettings(): ScreenshotSettings {
    return { ...(this.cache.screenshotSettings ?? DEFAULT_SCREENSHOT_SETTINGS) };
  }

  /**
   * Update screenshot settings (partial updates supported). Persists and notifies frontend.
   */
  public async updateScreenshotSettings(settings: Partial<ScreenshotSettings>): Promise<boolean> {
    try {
      await this.updateConfig({
        screenshotSettings: {
          ...(this.cache.screenshotSettings ?? DEFAULT_SCREENSHOT_SETTINGS),
          ...settings,
        },
      });
      return true;
    } catch (err) {
      logger.error('[AppCacheManager] Failed to update screenshotSettings', 'AppCacheManager', {
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }
}

/** Global singleton export */
export const appCacheManager = AppCacheManager.getInstance();
