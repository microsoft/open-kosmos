/**
 * SubAgentTaskWatcherRegistry — Tracks which frontend panels are watching which tasks
 *
 * Only emits streaming chunks when a UI panel is actively watching the task.
 * Prevents IPC spam for background tasks that nobody is viewing.
 */

import type { WebContents } from 'electron';

export class SubAgentTaskWatcherRegistry {
  private static instance: SubAgentTaskWatcherRegistry;
  private watchers: Map<string, WebContents> = new Map();

  private constructor() {}

  public static getInstance(): SubAgentTaskWatcherRegistry {
    if (!SubAgentTaskWatcherRegistry.instance) {
      SubAgentTaskWatcherRegistry.instance = new SubAgentTaskWatcherRegistry();
    }
    return SubAgentTaskWatcherRegistry.instance;
  }

  /**
   * Register a frontend panel as watching a specific task
   */
  public watch(taskId: string, sender: WebContents): void {
    this.watchers.set(taskId, sender);
  }

  /**
   * Unregister a watcher for a task
   */
  public unwatch(taskId: string): void {
    this.watchers.delete(taskId);
  }

  /**
   * Check if a task is being watched
   */
  public isWatched(taskId: string): boolean {
    const watcher = this.watchers.get(taskId);
    if (!watcher) return false;
    // Check if the WebContents is still valid (window not closed)
    if (watcher.isDestroyed()) {
      this.watchers.delete(taskId);
      return false;
    }
    return true;
  }

  /**
   * Get the watcher for a task (to send IPC)
   */
  public getWatcher(taskId: string): WebContents | undefined {
    const watcher = this.watchers.get(taskId);
    if (watcher && watcher.isDestroyed()) {
      this.watchers.delete(taskId);
      return undefined;
    }
    return watcher;
  }

  /**
   * Clean up all watchers (e.g., on app quit)
   */
  public clear(): void {
    this.watchers.clear();
  }
}
