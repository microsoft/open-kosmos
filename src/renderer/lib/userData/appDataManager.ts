/**
 * AppDataManager (frontend)
 *
 * Responsibilities:
 * 1. Cache a copy of the AppConfig from the main process AppCacheManager in frontend memory.
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

export class AppDataManager {
  private static instance: AppDataManager;

  private cache: AppConfig = {};
  private listeners: AppDataListener[] = [];
  private initialized = false;

  // Debounced notifications
  private notifyTimer: NodeJS.Timeout | null = null;

  private constructor() {
    // Register IPC listeners in the constructor immediately to avoid missing any messages
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
   * Normal flow: backend pushes immediately when setMainWindow is called; frontend receives it directly and this fallback is never triggered.
   */
  private static readonly FALLBACK_TIMEOUT_MS = 3000;

  private startFallbackTimer(): void {
    setTimeout(() => {
      if (!this.initialized) {
        logger.warn('[AppDataManager] No backend push received before timeout; performing fallback fetch...');
        this.fallbackFetch();
      }
    }, AppDataManager.FALLBACK_TIMEOUT_MS);
  }

  private async fallbackFetch(): Promise<void> {
    try {
      if (window.electronAPI?.appConfig) {
        const result = await window.electronAPI.appConfig.getAppConfig();
        if (result.success && result.data) {
          this.cache = result.data;
          this.initialized = true;
          this.notifyListeners(true);
        }
      }
    } catch (error) {
      logger.error('[AppDataManager] Fallback fetch failed', error);
    }
  }

  // ── IPC Listeners ────────────────────────────────────────────────────────

  private setupIpcListeners(): void {
    if (typeof window === 'undefined' || !window.electronAPI?.appConfig) {
      // Skip in test environments or SSR
      return;
    }

    window.electronAPI.appConfig.onConfigUpdated(
      (data: { config: AppConfig; timestamp: number }) => {
        this.handleConfigUpdate(data.config);
      },
    );
  }

  private handleConfigUpdate(config: AppConfig): void {
    this.cache = { ...config };
    this.initialized = true;
    this.scheduleNotify();
  }

  // ── Subscription ─────────────────────────────────────────────────────────

  /**
   * Subscribe to AppConfig changes. Returns an unsubscribe function.
   */
  subscribe(listener: AppDataListener): () => void {
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
  async updateConfig(updates: Partial<AppConfig>): Promise<{ success: boolean; error?: string }> {
    try {
      if (!window.electronAPI?.appConfig) {
        return { success: false, error: 'electronAPI.appConfig is not available' };
      }
      return await window.electronAPI.appConfig.updateAppConfig(updates);
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
