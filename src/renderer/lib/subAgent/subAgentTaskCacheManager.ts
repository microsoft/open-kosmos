/**
 * SubAgentTaskCacheManager — Renderer-side cache for sub-agent task data
 *
 * Manages in-memory message caches for sub-agent tasks being viewed.
 * Handles streaming chunk accumulation and provides subscription for React hooks.
 */

import type { SubAgentStreamingChunk, SubAgentTaskSnapshot, SubAgentTaskViewStatus } from '@shared/types/subAgentStreamingTypes';

interface SubAgentTaskCache {
  taskId: string;
  subAgentName: string;
  status: SubAgentTaskViewStatus;
  startTime: number;
  endTime?: number;
  turnCount: number;
  model: string;
  messages: any[];
}

type Listener = () => void;

class SubAgentTaskCacheManagerImpl {
  private taskCaches: Map<string, SubAgentTaskCache> = new Map();
  private listeners: Set<Listener> = new Set();
  private cleanupFn: (() => void) | null = null;

  constructor() {
    this.setupStreamingListener();
  }

  private setupStreamingListener(): void {
    if (typeof window === 'undefined' || !window.electronAPI?.subAgentTask) return;
    this.cleanupFn = window.electronAPI.subAgentTask.onStreamingChunk((chunk: SubAgentStreamingChunk) => {
      this.handleStreamingChunk(chunk);
    });
  }

  private handleStreamingChunk(chunk: SubAgentStreamingChunk): void {
    const cache = this.taskCaches.get(chunk.taskId);
    if (!cache) return;

    if (chunk.type === 'complete' || chunk.type === 'tool_result') {
      // Re-fetch messages from backend to get the latest state
      this.refreshMessages(chunk.taskId);
    }
  }

  /**
   * Re-fetch task messages from the backend (for streaming updates)
   */
  private async refreshMessages(taskId: string): Promise<void> {
    try {
      const result = await window.electronAPI.subAgentTask.open(taskId);
      if (!result.success || !result.data) return;

      const cache = this.taskCaches.get(taskId);
      if (!cache) return;

      const snapshot = result.data as SubAgentTaskSnapshot;
      cache.messages = snapshot.messages || [];
      cache.status = snapshot.status;
      cache.turnCount = snapshot.turnCount;
      cache.endTime = snapshot.endTime;
      this.notifyListeners();
    } catch {
      // Silently fail — next chunk will retry
    }
  }

  /**
   * Open a task — fetch snapshot from backend and start watching
   */
  async open(taskId: string): Promise<SubAgentTaskCache | null> {
    const result = await window.electronAPI.subAgentTask.open(taskId);
    if (!result.success || !result.data) return null;

    const snapshot = result.data as SubAgentTaskSnapshot;
    const cache: SubAgentTaskCache = {
      taskId: snapshot.taskId,
      subAgentName: snapshot.subAgentName,
      status: snapshot.status,
      startTime: snapshot.startTime,
      endTime: snapshot.endTime,
      turnCount: snapshot.turnCount,
      model: snapshot.model,
      messages: snapshot.messages || [],
    };

    this.taskCaches.set(taskId, cache);
    this.notifyListeners();
    return cache;
  }

  /**
   * Close a task — stop watching and remove from cache
   */
  async close(taskId: string): Promise<void> {
    await window.electronAPI.subAgentTask.close(taskId);
    this.taskCaches.delete(taskId);
    this.notifyListeners();
  }

  /**
   * Get cached messages for a task
   */
  getMessages(taskId: string): any[] {
    return this.taskCaches.get(taskId)?.messages ?? [];
  }

  /**
   * Get status for a task
   */
  getStatus(taskId: string): SubAgentTaskViewStatus | undefined {
    return this.taskCaches.get(taskId)?.status;
  }

  /**
   * Subscribe to changes (for useSyncExternalStore)
   */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Get snapshot version (for useSyncExternalStore)
   */
  getSnapshot(): Map<string, SubAgentTaskCache> {
    return this.taskCaches;
  }

  private notifyListeners(): void {
    // Create a new Map reference to trigger React re-renders
    this.taskCaches = new Map(this.taskCaches);
    for (const listener of this.listeners) {
      listener();
    }
  }

  dispose(): void {
    if (this.cleanupFn) {
      this.cleanupFn();
      this.cleanupFn = null;
    }
    this.taskCaches.clear();
    this.listeners.clear();
  }
}

export const subAgentTaskCacheManager = new SubAgentTaskCacheManagerImpl();
