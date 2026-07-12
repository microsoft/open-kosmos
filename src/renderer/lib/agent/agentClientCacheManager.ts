/**
 * Agent Client Cache Manager (Frontend)
 *
 * Normalized renderer cache for agent configurations, part of the sidecar
 * renderer-normalization workstream (see
 * docs/sidecar-renderer-normalization-tech-doc.md). Mirrors
 * {@link ../mcp/mcpClientCacheManager} exactly:
 *
 * 1. Holds an `id -> AgentConfig` map hydrated from the agent store.
 * 2. Pulls the initial snapshot via `profile.getRegisteredAgents(alias)`.
 * 3. Listens for `agents:changed` pushes emitted by the main-process
 *    `ProfileCacheManager` and replaces the cache wholesale.
 * 4. Notifies subscribers so React consumers can read agents by id instead of
 *    the inline `chat.agent` facade.
 *
 * Additive for now: the monolithic `profile:cacheUpdated` push is untouched and
 * remains authoritative until the recompose glue is removed in a later phase.
 */

import type { AgentConfig } from '../../../main/lib/userDataADO/types/agentStore';
import { createLogger } from '../utilities/logger';

const logger = createLogger('[AgentClientCacheManager]');

/**
 * Payload shape for the `agents:changed` push and the `agents:getAll` pull.
 */
export interface AgentsChangedPayload {
  alias: string;
  agents: AgentConfig[];
  timestamp: number;
}

/**
 * Read-only snapshot of the agent cache handed to subscribers.
 */
export interface AgentCacheData {
  agents: AgentConfig[];
  isInitialized: boolean;
  lastUpdated: number;
}

/**
 * Data change listener type.
 */
export type AgentDataListener = (data: AgentCacheData) => void;

/**
 * AgentClientCacheManager - Frontend agent config cache (Singleton).
 */
export class AgentClientCacheManager {
  private static instance: AgentClientCacheManager;

  private agents: Map<string, AgentConfig> = new Map();
  private alias: string | null = null;
  private isInitialized = false;
  private lastUpdated = 0;
  private listeners: AgentDataListener[] = [];
  private cleanupFunctions: (() => void)[] = [];

  private constructor() {
    this.setupIPCListeners();
  }

  static getInstance(): AgentClientCacheManager {
    if (!AgentClientCacheManager.instance) {
      AgentClientCacheManager.instance = new AgentClientCacheManager();
    }
    return AgentClientCacheManager.instance;
  }

  /**
   * Get a read-only snapshot of the cache.
   */
  getCache(): AgentCacheData {
    return {
      agents: [...this.agents.values()],
      isInitialized: this.isInitialized,
      lastUpdated: this.lastUpdated,
    };
  }

  /**
   * Subscribe to cache changes. Returns an unsubscribe function.
   */
  subscribe(listener: AgentDataListener): () => void {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index > -1) {
        this.listeners.splice(index, 1);
      }
    };
  }

  /**
   * Initialize the cache by pulling the current agents for the given alias.
   * Safe to call more than once (a profile switch re-pulls for the new alias).
   */
  async initialize(alias: string): Promise<void> {
    // A profile switch / sign-in as a different user must not expose the
    // previous user's agents while the async pull is in flight: drop the stale
    // snapshot up front when the alias actually changes. A same-alias re-init
    // keeps the current cache to avoid a needless flush + re-render flicker.
    if (this.alias !== null && this.alias !== alias) {
      this.replaceAgents([]);
    }
    this.alias = alias;

    try {
      const api = window.electronAPI?.profile;
      if (api?.getRegisteredAgents) {
        const result = await api.getRegisteredAgents(alias);
        // A newer initialize() / profile switch may have advanced the active alias
        // while this pull was in flight. Applying this now-stale snapshot would
        // clobber the current user's cache with the previous user's agents (the
        // `agents:changed` push handler guards the same way at handleAgentsChanged).
        // Bail if we were superseded — the winning initialize() owns the cache.
        if (this.alias !== alias) {
          return;
        }
        if (result?.success && Array.isArray(result.data)) {
          this.replaceAgents(result.data);
        }
      }
      this.isInitialized = true;
      logger.debug('[AgentClientCacheManager] Initialized for alias:', alias);
    } catch (error) {
      logger.error('[AgentClientCacheManager] Initialization failed:', error);
    }
  }

  /**
   * Register the `agents:changed` push listener.
   */
  private setupIPCListeners(): void {
    const api = typeof window !== 'undefined' ? window.electronAPI?.profile : undefined;
    if (api?.onAgentsChanged) {
      const cleanup = api.onAgentsChanged((data: AgentsChangedPayload) => {
        this.handleAgentsChanged(data);
      });
      this.cleanupFunctions.push(cleanup);
      logger.debug('[AgentClientCacheManager] IPC listener registered');
    } else {
      logger.warn('[AgentClientCacheManager] electronAPI.profile.onAgentsChanged not available');
    }
  }

  /**
   * Apply an `agents:changed` push, ignoring pushes for other aliases.
   */
  private handleAgentsChanged(data: AgentsChangedPayload): void {
    if (!this.alias || data?.alias !== this.alias) {
      return;
    }
    if (!data || !Array.isArray(data.agents)) {
      logger.warn('[AgentClientCacheManager] Invalid agents payload received');
      return;
    }
    this.replaceAgents(data.agents);
  }

  /**
   * Replace the whole cache with a fresh agent list and notify subscribers.
   */
  private replaceAgents(agents: AgentConfig[]): void {
    const next = new Map<string, AgentConfig>();
    for (const agent of agents) {
      if (agent && agent.id) {
        next.set(agent.id, agent);
      }
    }
    this.agents = next;
    this.lastUpdated = Date.now();
    this.notifyListeners();
  }

  private notifyListeners(): void {
    const snapshot = this.getCache();
    this.listeners.forEach((listener) => {
      try {
        listener(snapshot);
      } catch (error) {
        logger.error('[AgentClientCacheManager] Listener error:', error);
      }
    });
  }

  // ========== Read-only access methods ==========

  /**
   * Resolve a single agent by id, or null if not cached.
   */
  getAgent(id: string | undefined | null): AgentConfig | null {
    if (!id) {
      return null;
    }
    return this.agents.get(id) ?? null;
  }

  /**
   * Resolve agents by id, preserving order and dropping ids the cache misses.
   */
  getAgents(ids: string[] | undefined | null): AgentConfig[] {
    if (!Array.isArray(ids)) {
      return [];
    }
    const resolved: AgentConfig[] = [];
    for (const id of ids) {
      const agent = this.agents.get(id);
      if (agent) {
        resolved.push(agent);
      }
    }
    return resolved;
  }

  /**
   * All cached agents.
   */
  getAllAgents(): AgentConfig[] {
    return [...this.agents.values()];
  }

  /**
   * Reset the cache on sign-out / profile teardown.
   *
   * Mirrors {@link ../mcp/mcpClientCacheManager}.cleanup: the signed-out user's
   * agents are dropped and subscribers are notified with an empty snapshot so no
   * stale data lingers in the UI, but the IPC push listener and React
   * subscribers are deliberately PRESERVED. `setupIPCListeners()` self-wires
   * only once (in the constructor), so tearing the listener down here would
   * permanently stop `agents:changed` updates for the next signed-in user;
   * keeping it lets the next `initialize()` re-hydrate while live pushes keep
   * flowing.
   */
  cleanup(): void {
    this.alias = null;
    this.isInitialized = false;
    this.replaceAgents([]);
  }
}

// Export singleton instance
export const agentClientCacheManager = AgentClientCacheManager.getInstance();
