/**
 * AppCacheManager
 *
 * Manages reading/writing and in-memory caching of {userData}/app.json.
 * On data changes, syncs to the frontend AppDataManager in real time via the IPC event 'app:configUpdated'.
 *
 * app.json structure:
 * {
 *   "updaterVersion": "0.0.5",
 *   "nativeServerVersion": "1.0.0",
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
 */

import * as fs from 'fs';
import * as path from 'path';
import { BrowserWindow } from 'electron';
import { createConsoleLogger } from '../unifiedLogger';
import {
  AppConfig,
  RuntimeEnvironment,
  RuntimeMode,
  DEFAULT_RUNTIME_ENVIRONMENT,
  DEFAULT_APP_CONFIG,
  DEFAULT_VOICE_INPUT_CONFIG,
  DEFAULT_SCREENSHOT_SETTINGS,
  isAppConfig,
} from './types/app';
import type { ScreenshotSettings } from './types/app';

// Re-export types so external callers can import them directly from appCacheManager
export { DEFAULT_RUNTIME_ENVIRONMENT, DEFAULT_APP_CONFIG, DEFAULT_VOICE_INPUT_CONFIG, DEFAULT_SCREENSHOT_SETTINGS, isAppConfig } from './types/app';
export type { VoiceInputConfig, ScreenshotSettings } from './types/app';

const logger = createConsoleLogger();

const APP_CONFIG_FILENAME = 'app.json';
const LEGACY_RUNTIME_CONFIG_FILENAME = 'runtimeConfig.json';

function getElectronApp(): Electron.App {
  try {
    if ((global as any).electron?.app) {
      return (global as any).electron.app;
    }
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { app } = require('electron');
    return app;
  } catch {
    throw new Error('[AppCacheManager] Electron app not available');
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
 * 5. Notify the frontend AppDataManager via IPC after data updates
 *
 * 📖 Development guide: when adding new app-level config fields, see:
 * src/main/lib/userDataADO/README.md — "App-Level Config Development Guide"
 * The guide uses runtimeEnvironment as the reference implementation, covering
 * type definitions, integrity migration, and frontend sync.
 */
export class AppCacheManager {
  private static instance: AppCacheManager;

  private cache: AppConfig = {};
  private mainWindow: BrowserWindow | null = null;
  private initialized = false;

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

  public setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window;
    // Push the current config immediately after setting the window reference to ensure frontend AppDataManager initialization
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
      const firstProfileDir = entries.find((e) => e.isDirectory());
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

    // nativeServerVersion: string | undefined
    if (typeof config.nativeServerVersion === 'string') {
      sanitized.nativeServerVersion = config.nativeServerVersion;
    }

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
   * Return a read-only copy of the current in-memory AppConfig.
   */
  public getConfig(): AppConfig {
    return { ...this.cache };
  }

  /**
   * Update AppConfig (partial updates supported). Persists and then notifies the frontend.
   * @param updates Fields to update (shallow merge; runtimeEnvironment supports partial field updates)
   */
  public async updateConfig(updates: Partial<AppConfig>): Promise<void> {
    const merged: AppConfig = {
      ...this.cache,
      ...updates,
      // Deep-merge runtimeEnvironment
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
    };

    const sanitized = this.appConfigSanitize(merged);
    this.cache = sanitized;

    await this.writeConfigToDisk(sanitized);
    this.scheduleNotifyFrontend();

    logger.info('[AppCacheManager] Config updated', 'AppCacheManager', { updates });
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
      let targetWindow: BrowserWindow | null = this.mainWindow;

      if (!targetWindow || targetWindow.isDestroyed()) {
        const windows = BrowserWindow.getAllWindows();
        targetWindow = windows.find((w) => !w.isDestroyed()) ?? null;
      }

      if (!targetWindow || targetWindow.isDestroyed()) {
        logger.warn('[AppCacheManager] Main window unavailable, skipping notification', 'AppCacheManager');
        return;
      }

      targetWindow.webContents.send('app:configUpdated', {
        config: { ...this.cache },
        timestamp: Date.now(),
      });
    } catch (error) {
      logger.error('[AppCacheManager] Failed to notify frontend', 'AppCacheManager', {
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
