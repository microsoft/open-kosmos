/**
 * Type definitions for App configuration (app.json)
 *
 * app.json is stored at {userData}/app.json, saving application-level global configuration
 * unrelated to user profiles. Read/write is handled by AppCacheManager.
 */

import type { ScreenshotSettings } from '../../../../shared/ipc/screenshot';
export type { ScreenshotSettings };

// ─── Runtime Environment ──────────────────────────────────────────────────────

/**
 * Runtime environment mode
 * - `system`: use Python / bun / uv already installed on the system
 * - `internal`: use OpenKosmos built-in bun / uv / Python
 */
export type RuntimeMode = 'system' | 'internal';

/**
 * Runtime environment configuration
 * Corresponds to the `runtimeEnvironment` field in app.json.
 * Legacy configuration was stored in {userData}/runtimeConfig.json and is auto-migrated on read.
 */
export interface RuntimeEnvironment {
  /** Runtime mode */
  mode: RuntimeMode;
  /** Built-in bun version number, e.g., "1.3.6" */
  bunVersion: string;
  /** Built-in uv version number, e.g., "0.6.17" */
  uvVersion: string;
  /**
   * Pinned Python version (only meaningful in internal mode)
   * Supports two formats:
   * - Short version: "3.10.12"
   * - Full platform identifier: "cpython-3.10.12-macos-aarch64-none"
   * null means no lock, use the latest installed version
   */
  pinnedPythonVersion?: string | null;
}

/**
 * Default Runtime Environment configuration
 */
export const DEFAULT_RUNTIME_ENVIRONMENT: RuntimeEnvironment = {
  mode: 'internal',
  bunVersion: '1.3.6',
  uvVersion: '0.6.17',
  pinnedPythonVersion: '3.10.12',
};

// ─── Voice Input ─────────────────────────────────────────────────────────────

/**
 * App-level Voice Input configuration (stored in app.json).
 * This is a global feature switch — not tied to any user profile.
 */
export interface VoiceInputConfig {
  /** Master switch: whether voice input is enabled */
  voiceInputEnabled: boolean;
  /** Selected Whisper model size ('tiny'|'base'|'small'|'medium'|'turbo') or '' for none */
  whisperModelSelected: string;
  /**
   * Speech recognition language code ('auto' | 'en' | 'zh' | ...)
   * Empty string maps to 'auto' (Auto-Detect).
   */
  recognitionLanguage: string;
  /** Enable GPU acceleration (Metal on macOS, Vulkan on Windows/Linux) */
  gpuAcceleration: boolean;
}

export const DEFAULT_VOICE_INPUT_CONFIG: VoiceInputConfig = {
  voiceInputEnabled: false,
  whisperModelSelected: '',
  recognitionLanguage: 'auto',
  gpuAcceleration: false,
};

// ─── Screenshot ──────────────────────────────────────────────────────────────

/**
 * App-level Screenshot configuration (stored in app.json).
 * Migrated from profile-level screenshotSettings — now shared across all profiles.
 */
export const DEFAULT_SCREENSHOT_SETTINGS: ScreenshotSettings = {
  enabled: true,
  shortcut: 'CommandOrControl+Shift+S',
  shortcutEnabled: false,
  savePath: '',
  freRejected: false,
};

// ─── AppConfig ────────────────────────────────────────────────────────────────

/**
 * Full data structure for app.json
 *
 * All fields are optional; missing fields are filled in by integrityEnsure on read.
 */
export interface AppConfig {
  /**
   * Updater version number, e.g., "0.0.5"
   * Written by OpenKosmos Updater; the App only reads this field and should not modify it.
   */
  updaterVersion?: string;

  /**
   * Built-in native-server version number, e.g., "1.0.0"
   * Maintained by NativeServerFetcher, used to determine whether an update is needed.
   */
  nativeServerVersion?: string;

  /**
   * Runtime environment configuration.
   * If this field is missing, AppCacheManager will migrate data from the legacy runtimeConfig.json.
   */
  runtimeEnvironment?: RuntimeEnvironment;

  /**
   * Voice Input feature configuration (global, unrelated to user profile)
   */
  voiceInput?: Partial<VoiceInputConfig>;

  /**
   * Screenshot feature configuration (global, unrelated to user profile).
   * On first read, if missing, AppCacheManager will migrate from the first profile's profile.json; otherwise uses defaults.
   */
  screenshotSettings?: ScreenshotSettings;

  /**
   * Whether the left sidebar is collapsed (global application-level layout preference)
   */
  leftSidebarCollapsed?: boolean;

  /**
   * Left sidebar width (CSS pixels, global application-level layout preference)
   * Range 288 ~ 576, default 288
   */
  leftSidebarWidth?: number;

  /**
   * Page zoom level (global, unrelated to user profile)
   * 0 means 100%; each ±0.5 is approximately ±10%; range -3 ~ 3
   */
  zoomLevel?: number;

  /**
   * Whether the main window is maximized (global application-level window preference)
   */
  mainWindowMaximized?: boolean;
}

/**
 * Default AppConfig (minimal usable configuration)
 */
export const DEFAULT_APP_CONFIG: AppConfig = {
  runtimeEnvironment: { ...DEFAULT_RUNTIME_ENVIRONMENT },
  voiceInput: { ...DEFAULT_VOICE_INPUT_CONFIG },
  screenshotSettings: { ...DEFAULT_SCREENSHOT_SETTINGS },
  leftSidebarCollapsed: false,
  leftSidebarWidth: 288,
  zoomLevel: 0,
  mainWindowMaximized: false,
};

// ─── Type Guards ──────────────────────────────────────────────────────────────

/**
 * Determine whether a value is a valid RuntimeMode
 */
export function isRuntimeMode(value: any): value is RuntimeMode {
  return value === 'system' || value === 'internal';
}

/**
 * Determine whether an object is a valid RuntimeEnvironment
 */
export function isRuntimeEnvironment(obj: any): obj is RuntimeEnvironment {
  return (
    obj !== null &&
    typeof obj === 'object' &&
    isRuntimeMode(obj.mode) &&
    typeof obj.bunVersion === 'string' &&
    typeof obj.uvVersion === 'string' &&
    (obj.pinnedPythonVersion === undefined ||
      obj.pinnedPythonVersion === null ||
      typeof obj.pinnedPythonVersion === 'string')
  );
}

/**
 * Determine whether an object is a valid AppConfig (lenient check, allows missing fields)
 */
export function isAppConfig(obj: any): obj is AppConfig {
  if (obj === null || typeof obj !== 'object') return false;
  if (obj.updaterVersion !== undefined && typeof obj.updaterVersion !== 'string') return false;
  if (obj.nativeServerVersion !== undefined && typeof obj.nativeServerVersion !== 'string') return false;
  if (obj.runtimeEnvironment !== undefined && !isRuntimeEnvironment(obj.runtimeEnvironment)) return false;
  if (obj.leftSidebarCollapsed !== undefined && typeof obj.leftSidebarCollapsed !== 'boolean') return false;
  if (obj.zoomLevel !== undefined && (!Number.isFinite(obj.zoomLevel) || typeof obj.zoomLevel !== 'number')) return false;
  if (obj.mainWindowMaximized !== undefined && typeof obj.mainWindowMaximized !== 'boolean') return false;
  return true;
}
