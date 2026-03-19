/**
 * Type definitions for App configuration (app.json)
 *
 * app.json is stored at {userData}/app.json, holding app-level global configuration
 * unrelated to user profiles. Read/write is managed by AppCacheManager.
 */

import type { ScreenshotSettings } from '../../../../shared/ipc/screenshot';
export type { ScreenshotSettings };

// ─── Runtime Environment ─────────────────────────────────────────────────────────────

/**
 * Runtime environment mode
 * - `system`: Use system-installed Python / bun / uv
 * - `internal`: Use Kosmos built-in bun / uv / Python
 */
export type RuntimeMode = 'system' | 'internal';

/**
 * Runtime environment configuration
 * Corresponds to the `runtimeEnvironment` field in app.json.
 * Legacy config stored at {userData}/runtimeConfig.json is auto-migrated on read.
 */
export interface RuntimeEnvironment {
  /** Runtime mode */
  mode: RuntimeMode;
  /** Built-in bun version, e.g. "1.3.6" */
  bunVersion: string;
  /** Built-in uv version, e.g. "0.6.17" */
  uvVersion: string;
  /**
   * Pinned Python version (only meaningful in internal mode)
   * Supports two formats:
   * - Short version: "3.10.12"
   * - Full platform identifier: "cpython-3.10.12-macos-aarch64-none"
   * null means unpinned, using the latest installed version
   */
  pinnedPythonVersion?: string | null;
}

/**
 * Default Runtime environment configuration
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
 * app.json complete data structure
 *
 * All fields are optional; integrityEnsure fills in missing fields on read.
 */
export interface AppConfig {
  /**
   * Updater version, e.g. "0.0.5"
   * Written by Kosmos Updater; App reads this field only and should not modify it.
   */
  updaterVersion?: string;

  /**
   * Built-in native-server version, e.g. "1.0.0"
   * Maintained by NativeServerFetcher; used to determine if an update is needed.
   */
  nativeServerVersion?: string;

  /**
   * Runtime environment configuration
   * If this field is missing, AppCacheManager will migrate data from the legacy runtimeConfig.json.
   */
  runtimeEnvironment?: RuntimeEnvironment;

  /**
   * Voice Input feature configuration (global, unrelated to user profile)
   */
  voiceInput?: Partial<VoiceInputConfig>;

  /**
   * Screenshot feature configuration (global, unrelated to user profile)
   * On first read, if missing, AppCacheManager migrates from the first profile's profile.json; otherwise uses defaults.
   */
  screenshotSettings?: ScreenshotSettings;
}

/**
 * Default AppConfig (minimal usable configuration)
 */
export const DEFAULT_APP_CONFIG: AppConfig = {
  runtimeEnvironment: { ...DEFAULT_RUNTIME_ENVIRONMENT },
  voiceInput: { ...DEFAULT_VOICE_INPUT_CONFIG },
  screenshotSettings: { ...DEFAULT_SCREENSHOT_SETTINGS },
};

// ─── Type Guards ──────────────────────────────────────────────────────────────

/**
 * Check if a value is a valid RuntimeMode
 */
export function isRuntimeMode(value: any): value is RuntimeMode {
  return value === 'system' || value === 'internal';
}

/**
 * Check if an object is a valid RuntimeEnvironment
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
 * Check if an object is a valid AppConfig (loose check, allows missing fields)
 */
export function isAppConfig(obj: any): obj is AppConfig {
  if (obj === null || typeof obj !== 'object') return false;
  if (obj.updaterVersion !== undefined && typeof obj.updaterVersion !== 'string') return false;
  if (obj.nativeServerVersion !== undefined && typeof obj.nativeServerVersion !== 'string') return false;
  if (obj.runtimeEnvironment !== undefined && !isRuntimeEnvironment(obj.runtimeEnvironment)) return false;
  return true;
}
