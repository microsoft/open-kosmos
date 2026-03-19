/**
 * AppDataManager (Frontend)
 *
 * Responsibilities:
 * 1. Cache a copy of AppConfig from the main process AppCacheManager in frontend memory.
 * 2. Listen to `app:configUpdated` IPC events to stay in sync with the main process in real-time.
 * 3. Provide subscribe / unsubscribe mechanism for React components to subscribe to change notifications.
 * 4. Provide convenient invoke methods to call main process app config operations.
 *
 * Note: AppDataManager is for frontend use only and does not directly operate on the file system.
 */

import type { AppConfig, RuntimeEnvironment } from './types';

export type AppDataListener = (config: AppConfig) => void;

export class AppDataManager {
  private static instance: AppDataManager;

  private cache: AppConfig = {};
  private listeners: AppDataListener[] = [];
  private initialized = false;

  // Debounced notification
  private notifyTimer: NodeJS.Timeout | null = null;

  private constructor() {
    // Register IPC listeners immediately in constructor to ensure no messages are missed
    this.setupIpcListeners();
    // Fallback: If backend push hasn't arrived before timeout (abnormal case), proactively fetch once
    this.startFallbackTimer();
  }

  static getInstance(): AppDataManager {
    if (!AppDataManager.instance) {
      AppDataManager.instance = new AppDataManager();
    }
    return AppDataManager.instance;
  }

  // ── Fallback fetch ─────────────────────────────────────────────────────────────────

  /**
   * Fallback timer: If the backend hasn't pushed the initial config within FALLBACK_TIMEOUT_MS (abnormal case),
   * proactively fetch once to ensure data is eventually available.
   * Normal flow: Backend pushes immediately during setMainWindow, frontend receives directly, this fallback won't trigger.
   */
  private static readonly FALLBACK_TIMEOUT_MS = 3000;

  private startFallbackTimer(): void {
    setTimeout(() => {
      if (!this.initialized) {
        console.warn('[AppDataManager] Backend push not received before timeout, executing fallback fetch...');
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
      console.error('[AppDataManager] Fallback fetch failed', error);
    }
  }

  // ── IPC Listeners ─────────────────────────────────────────────────────────────────

  private setupIpcListeners(): void {
    if (typeof window === 'undefined' || !window.electronAPI?.appConfig) {
      // Skip in test or SSR environments
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

  // ── Subscription Mechanism ─────────────────────────────────────────────────────────────────

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

  // ── Notification ─────────────────────────────────────────────────────────────────────

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
        console.error('[AppDataManager] listener error', e);
      }
    });
  }

  // ── Read ─────────────────────────────────────────────────────────────────────

  /**
   * Get the currently cached AppConfig (read-only copy).
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
   * Whether initialization is complete (has received data from main process).
   */
  isReady(): boolean {
    return this.initialized;
  }

  // ── Write (delegated to main process) ────────────────────────────────────────────────────────

  /**
   * Update AppConfig (partial fields), delegating persistence to the main process via IPC.
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
