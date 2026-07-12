/**
 * AppDataManager (frontend)
 *
 * Responsibilities:
 * 1. Seed the startup appearance config synchronously from preload, then cache the full AppConfig from the main process.
 * 2. Listen for the `app:configUpdated` IPC event to stay in sync with the main process in real time.
 * 3. Provide subscribe/unsubscribe mechanism for React components to receive change notifications.
 * 4. Provide convenience invoke methods for main process app config operations.
 *
 * Note: AppDataManager is for frontend use only; it does not directly access the filesystem.
 */

import type { AppConfig, RuntimeEnvironment } from './types';
import { createLogger } from '../utilities/logger';
const logger = createLogger('[AppDataManager]');

export type AppDataListener = (config: AppConfig) => void;

function readInitialAppConfigSeed(): AppConfig {
  if (typeof window === 'undefined') {
    return {};
  }

  const seed = window.electronAPI?.appConfig?.getInitialAppConfig?.();
  return seed ? { ...seed } : {};
}

interface AppConfigIpcResult {
  success: boolean;
  data?: AppConfig;
  revision?: number;
  error?: string;
}

interface AppConfigUpdatedPayload {
  config: AppConfig;
  timestamp: number;
  revision?: number;
}

export class AppDataManager {
  private static instance: AppDataManager;

  private cache: AppConfig = readInitialAppConfigSeed();
  private listeners: AppDataListener[] = [];
  private initialized = false;
  private ipcListenerRegistered = false;
  private fallbackFetchPromise: Promise<void> | null = null;
  private configRevision = 0;

  // Debounced notifications
  private notifyTimer: NodeJS.Timeout | null = null;

  private constructor() {
    // Register IPC listeners in the constructor immediately to avoid missing any messages.
    // If the singleton is created before the preload bridge is available, subscribe()
    // retries registration and performs a one-shot fetch.
    this.setupIpcListeners();
    // Fallback: if no backend push arrives before the timeout (abnormal case), do a single manual pull
    this.startFallbackTimer();
  }

  static getInstance(): AppDataManager {
    if (!AppDataManager.instance) {
      AppDataManager.instance = new AppDataManager();
    }
    return AppDataManager.instance;
  }

  // ── Fallback fetch ────────────────────────────────────────────────────────────

  /**
   * Fallback timer: if the backend has not pushed the initial config within FALLBACK_TIMEOUT_MS
   * (abnormal case), do a manual pull to ensure data is eventually available.
   * Normal flow: preload provides the initial appearance seed, then the backend pushes the full config when setMainWindow is called.
   */
  private static readonly FALLBACK_TIMEOUT_MS = 3000;

  private startFallbackTimer(): void {
    setTimeout(() => {
      if (!this.initialized) {
        logger.warn('[AppDataManager] No backend push received before timeout; performing fallback fetch...');
        this.requestFallbackFetch();
      }
    }, AppDataManager.FALLBACK_TIMEOUT_MS);
  }

  private requestFallbackFetch(): void {
    if (this.initialized || this.fallbackFetchPromise) {
      return;
    }

    this.setupIpcListeners();
    if (typeof window === 'undefined' || !window.electronAPI?.appConfig) {
      return;
    }

    this.fallbackFetchPromise = this.fallbackFetch().finally(() => {
      this.fallbackFetchPromise = null;
    });
  }

  private async fallbackFetch(): Promise<void> {
    await this.fetchLatestConfig({ immediate: true });
  }

  async fetchLatestConfig(options: boolean | { immediate?: boolean; cache?: boolean } = false): Promise<AppConfig | null> {
    const immediate = typeof options === 'boolean' ? options : options.immediate ?? false;
    const shouldCache = typeof options === 'boolean' ? true : options.cache ?? true;
    try {
      if (window.electronAPI?.appConfig) {
        const result: AppConfigIpcResult = await window.electronAPI.appConfig.getAppConfig();
        if (result.success && result.data) {
          const config = { ...result.data };
          if (shouldCache) {
            this.cache = config;
            if (typeof result.revision === 'number') {
              this.configRevision = Math.max(this.configRevision, result.revision);
            }
            this.initialized = true;
            this.notifyListeners(immediate);
          }
          return config;
        }
      }
    } catch (error) {
      logger.error('[AppDataManager] fetchLatestConfig failed', error);
    }
    return null;
  }

  // ── IPC Listeners ────────────────────────────────────────────────────────

  private setupIpcListeners(): void {
    if (this.ipcListenerRegistered) {
      return;
    }

    if (typeof window === 'undefined' || !window.electronAPI?.appConfig) {
      // Skip in test environments or SSR
      return;
    }

    window.electronAPI.appConfig.onConfigUpdated(
      (data: AppConfigUpdatedPayload) => {
        this.handleConfigUpdate(data.config, data.revision);
      },
    );
    this.ipcListenerRegistered = true;
  }

  private handleConfigUpdate(config: AppConfig, revision?: number): void {
    if (typeof revision === 'number' && revision < this.configRevision) {
      return;
    }
    this.cache = { ...config };
    this.configRevision = typeof revision === 'number'
      ? Math.max(this.configRevision, revision)
      : this.configRevision + 1;
    this.initialized = true;
    this.scheduleNotify();
  }

  // ── Subscription ─────────────────────────────────────────────────────────

  /**
   * Subscribe to AppConfig changes. Returns an unsubscribe function.
   */
  subscribe(listener: AppDataListener): () => void {
    const wasRegistered = this.ipcListenerRegistered;
    this.setupIpcListeners();
    if (!wasRegistered && this.ipcListenerRegistered && !this.initialized) {
      this.requestFallbackFetch();
    }
    this.listeners.push(listener);
    return () => {
      const idx = this.listeners.indexOf(listener);
      if (idx > -1) this.listeners.splice(idx, 1);
    };
  }

  // ── Notifications ─────────────────────────────────────────────────────────

  private scheduleNotify(): void {
    if (this.notifyTimer) clearTimeout(this.notifyTimer);
    this.notifyTimer = setTimeout(() => {
      this.notifyTimer = null;
      this.performNotify();
    }, 100);
  }

  private notifyListeners(immediate = false): void {
    if (immediate) {
      this.performNotify();
      return;
    }
    this.scheduleNotify();
  }

  private performNotify(): void {
    const snapshot = this.getConfig();
    this.listeners.forEach((listener) => {
      try {
        listener(snapshot);
      } catch (e) {
        logger.error('[AppDataManager] listener error', e);
      }
    });
  }

  // ── Read ─────────────────────────────────────────────────────────────────

  /**
   * Get the current cached AppConfig (read-only copy).
   */
  getConfig(): AppConfig {
    return { ...this.cache };
  }

  getConfigRevision(): number {
    return this.configRevision;
  }

  /**
   * Get runtimeEnvironment (read-only copy).
   */
  getRuntimeEnvironment(): RuntimeEnvironment | undefined {
    return this.cache.runtimeEnvironment
      ? { ...this.cache.runtimeEnvironment }
      : undefined;
  }

  /**
   * Whether initialization has completed (main process data received at least once).
   */
  isReady(): boolean {
    return this.initialized;
  }

  // ── Write (delegated to main process) ────────────────────────────────────

  /**
   * Update AppConfig (partial fields) — delegates persistence to the main process via IPC.
   */
  async updateConfig(updates: Partial<AppConfig>): Promise<{ success: boolean; revision?: number; error?: string }> {
    try {
      if (!window.electronAPI?.appConfig) {
        return { success: false, error: 'electronAPI.appConfig is not available' };
      }
      const result = await window.electronAPI.appConfig.updateAppConfig(updates);
      if (result.success && typeof result.revision === 'number') {
        this.configRevision = Math.max(this.configRevision, result.revision);
      }
      return result;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

/** Global singleton export */
export const appDataManager = AppDataManager.getInstance();
