/**
 * Generic sidecar list cache (Frontend).
 *
 * Part of the sidecar renderer-normalization workstream (see
 * docs/sidecar-renderer-normalization-tech-doc.md). Skills and Hooks are
 * "full-list replace" sidecars: unlike agents (a per-id map), the renderer just
 * mirrors the whole list and swaps it wholesale on every push. This class
 * captures that shared behaviour once so `skillClientCacheManager` and
 * `hookClientCacheManager` are thin instantiations instead of two near-identical
 * copies of the subscribe / alias-filter / notify / teardown plumbing.
 *
 * It intentionally mirrors {@link ../mcp/mcpClientCacheManager} and
 * {@link ../agent/agentClientCacheManager}: pull the initial list via an IPC
 * invoke, replace the list on each `*:changed` push, notify subscribers.
 * Additive only — the monolithic `profile:cacheUpdated` push is untouched.
 */

import { createLogger } from '../utilities/logger';

/** Read-only snapshot of a sidecar list cache handed to subscribers. */
export interface ListCacheData<T> {
  items: T[];
  isInitialized: boolean;
  lastUpdated: number;
}

/** Data change listener type. */
export type ListDataListener<T> = (data: ListCacheData<T>) => void;

/** Result shape of the IPC pull (mirrors the `{ success, data }` bridge contract). */
export interface ListPullResult<T> {
  success: boolean;
  data?: T[];
  error?: string;
}

/**
 * Wiring for one concrete sidecar list cache. The concrete manager supplies
 * closures that already know the electronAPI methods and payload field name.
 */
export interface SidecarListCacheOptions<T> {
  /** Human label for logs, e.g. `Skill` / `Hook`. */
  label: string;
  /** IPC pull of the current list for an alias (undefined when API unavailable). */
  pull: (alias: string) => Promise<ListPullResult<T> | undefined> | undefined;
  /** Subscribe to the `*:changed` push; returns an unsubscribe (or undefined). */
  subscribeRaw: (handler: (payload: any) => void) => (() => void) | undefined;
  /** Extract the item array from a raw push/pull payload. */
  extractItems: (payload: any) => T[] | undefined;
}

/**
 * Generic full-list-replace sidecar cache.
 */
export class SidecarListCacheManager<T> {
  private items: T[] = [];
  private alias: string | null = null;
  private isInitialized = false;
  private lastUpdated = 0;
  private listeners: ListDataListener<T>[] = [];
  private cleanupFunctions: (() => void)[] = [];
  private readonly logger: ReturnType<typeof createLogger>;

  constructor(private readonly options: SidecarListCacheOptions<T>) {
    this.logger = createLogger(`[${options.label}ClientCacheManager]`);
    this.setupIPCListener();
  }

  /** Read-only snapshot of the cache. */
  getCache(): ListCacheData<T> {
    return {
      items: [...this.items],
      isInitialized: this.isInitialized,
      lastUpdated: this.lastUpdated,
    };
  }

  /** All cached items. */
  getItems(): T[] {
    return [...this.items];
  }

  /** Subscribe to cache changes. Returns an unsubscribe function. */
  subscribe(listener: ListDataListener<T>): () => void {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index > -1) {
        this.listeners.splice(index, 1);
      }
    };
  }

  /** Initialize by pulling the current list for the given alias. */
  async initialize(alias: string): Promise<void> {
    if (this.alias !== null && this.alias !== alias) {
      this.replaceItems([]);
    }
    this.alias = alias;
    try {
      const result = await this.options.pull(alias);
      if (this.alias !== alias) {
        return;
      }
      if (result?.success) {
        const items = this.options.extractItems(result);
        if (Array.isArray(items)) {
          this.replaceItems(items);
        }
      }
      this.isInitialized = true;
      this.logger.debug('Initialized for alias:', alias);
    } catch (error) {
      this.logger.error('Initialization failed:', error);
    }
  }

  private setupIPCListener(): void {
    const cleanup = this.options.subscribeRaw((payload: any) => {
      this.handleChanged(payload);
    });
    if (cleanup) {
      this.cleanupFunctions.push(cleanup);
      this.logger.debug('IPC listener registered');
    } else {
      this.logger.warn('change subscription unavailable');
    }
  }

  private handleChanged(payload: any): void {
    if (!this.alias || payload?.alias !== this.alias) {
      return;
    }
    const items = this.options.extractItems(payload);
    if (!Array.isArray(items)) {
      this.logger.warn('Invalid payload received');
      return;
    }
    this.replaceItems(items);
  }

  private replaceItems(items: T[]): void {
    this.items = [...items];
    this.lastUpdated = Date.now();
    this.notifyListeners();
  }

  private notifyListeners(): void {
    const snapshot = this.getCache();
    this.listeners.forEach((listener) => {
      try {
        listener(snapshot);
      } catch (error) {
        this.logger.error('Listener error:', error);
      }
    });
  }

  /** Reset account-bound data while preserving IPC listeners and subscribers. */
  cleanup(): void {
    this.alias = null;
    this.isInitialized = false;
    this.replaceItems([]);
  }
}
