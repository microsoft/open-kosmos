/**
 * SubAgentLifecycle — Background execution, IPC state updates, and session lifecycle.
 *
 * Extracted from SubAgentManager to keep it under the 1000-line policy.
 * This class owns background-specific Maps and operates on shared Maps via constructor injection.
 *
 * File location: src/main/lib/subAgent/subAgentLifecycle.ts
 */

import type { CancellationToken } from '../cancellation/CancellationToken';
import type {
  SubAgentRuntimeState,
  SubAgentTaskResult,
  BackgroundSubAgentTask,
  SubAgentNotification,
} from '../userDataADO/types/profile';
import { SUB_AGENT_LIMITS } from '../userDataADO/types/profile';
import { SubAgentTaskStore } from './subAgentTaskStore';
import { sanitizeSubAgentResult } from './subAgentConfigResolver';
import { createConsoleLogger } from '../unifiedLogger';

// Lazy-init logger (same pattern as manager)
let logger: any;
(async () => {
  logger = await createConsoleLogger();
})();

function getLogger() {
  return logger || console;
}

/** State update throttle interval (ms) */
const STATE_UPDATE_THROTTLE_MS = 100;

/** Shared internal Maps from SubAgentManager — passed via constructor */
export interface SubAgentSharedState {
  runtimeStates: Map<string, SubAgentRuntimeState>;
  activeInstances: Map<string, any>; // SubAgentChat
  parentChildMap: Map<string, Set<string>>;
  spawnCountMap: Map<string, number>;
}

/** Callback interface for lifecycle to delegate spawning back to manager */
export interface SubAgentSpawner {
  spawnSubAgent(params: any): Promise<SubAgentTaskResult>;
  spawnAdhocSubAgent(params: any): Promise<SubAgentTaskResult>;
}

export class SubAgentLifecycle {
  /** Background sub-agent tasks (fire-and-forget) */
  private backgroundTasks: Map<string, BackgroundSubAgentTask> = new Map();

  /** Completed background task results, keyed by parentSessionId */
  private resultQueue: Map<string, SubAgentTaskResult[]> = new Map();

  /** Notification queue from sub-agents to parent */
  private notificationQueue: Map<string, SubAgentNotification[]> = new Map();

  /** Throttle timers (indexed by taskId) */
  private stateUpdateThrottles = new Map<string, NodeJS.Timeout>();

  /** Latest pending state buffered during throttle */
  private pendingStateUpdates = new Map<string, { eventSender: Electron.WebContents; state: SubAgentRuntimeState }>();

  constructor(
    private shared: SubAgentSharedState,
    private spawner: SubAgentSpawner,
    private emitEvent: (event: string, data: any) => void,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════
  //  Background (Async) Execution
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Spawn a sub-agent in the background (fire-and-forget).
   */
  public async spawnSubAgentAsync(params: {
    parentSessionId: string;
    parentChatId: string;
    userAlias: string;
    subAgentName: string;
    task: string;
    cancellationToken?: CancellationToken;
    eventSender?: Electron.WebContents;
    correlationId?: string;
    adhoc?: boolean;
    systemPrompt?: string;
    tools?: string[];
    model?: string;
  }): Promise<{ taskId: string; status: 'launched' } | { taskId: string; status: 'error'; error: string }> {
    const runningBackground = [...this.backgroundTasks.values()]
      .filter(t => t.parentSessionId === params.parentSessionId && t.status === 'running').length;
    if (runningBackground >= SUB_AGENT_LIMITS.MAX_BACKGROUND_TASKS) {
      return {
        taskId: '',
        status: 'error',
        error: `Maximum background sub-agents (${SUB_AGENT_LIMITS.MAX_BACKGROUND_TASKS}) already running for this session`,
      };
    }

    const totalSpawns = this.shared.spawnCountMap.get(params.parentSessionId) || 0;
    if (totalSpawns >= SUB_AGENT_LIMITS.MAX_SPAWNS_PER_SESSION) {
      return {
        taskId: '',
        status: 'error',
        error: `Maximum sub-agent spawns (${SUB_AGENT_LIMITS.MAX_SPAWNS_PER_SESSION}) reached for this session`,
      };
    }

    const taskId = `sa_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const abortController = new AbortController();

    this.backgroundTasks.set(taskId, {
      taskId,
      parentSessionId: params.parentSessionId,
      subAgentName: params.adhoc ? `adhoc-${taskId.slice(0, 12)}` : params.subAgentName,
      status: 'running',
      startTime: Date.now(),
      pendingMessages: [],
    });

    this.shared.spawnCountMap.set(params.parentSessionId, totalSpawns + 1);

    SubAgentTaskStore.getInstance().createTask(params.userAlias, {
      taskId,
      subAgentName: params.adhoc ? `adhoc-${taskId.slice(0, 12)}` : params.subAgentName,
      parentSessionId: params.parentSessionId,
      parentChatId: params.parentChatId,
      startTime: Date.now(),
      model: params.model || 'default',
      isAdhoc: !!params.adhoc,
      taskDescription: params.task,
    });

    void this.executeInBackground(taskId, params, abortController);

    return { taskId, status: 'launched' };
  }

  private async executeInBackground(
    taskId: string,
    params: {
      parentSessionId: string;
      parentChatId: string;
      userAlias: string;
      subAgentName: string;
      task: string;
      cancellationToken?: CancellationToken;
      eventSender?: Electron.WebContents;
      correlationId?: string;
      adhoc?: boolean;
      systemPrompt?: string;
      tools?: string[];
      model?: string;
    },
    abortController: AbortController,
  ): Promise<void> {
    const startTime = Date.now();
    const bgTask = this.backgroundTasks.get(taskId);

    try {
      const bgCancellationToken: CancellationToken = {
        get isCancellationRequested() { return abortController.signal.aborted; },
        onCancellationRequested: (listener: () => void) => {
          abortController.signal.addEventListener('abort', listener, { once: true });
          return { dispose: () => abortController.signal.removeEventListener('abort', listener) };
        },
      };

      let result: SubAgentTaskResult;

      if (params.adhoc) {
        result = await this.spawner.spawnAdhocSubAgent({
          parentSessionId: params.parentSessionId,
          parentChatId: params.parentChatId,
          userAlias: params.userAlias,
          task: params.task,
          systemPrompt: params.systemPrompt,
          tools: params.tools,
          model: params.model,
          cancellationToken: bgCancellationToken,
          eventSender: params.eventSender,
          correlationId: params.correlationId,
          noAutoPromote: true,
          externalTaskId: taskId,
        });
      } else {
        result = await this.spawner.spawnSubAgent({
          parentSessionId: params.parentSessionId,
          parentChatId: params.parentChatId,
          userAlias: params.userAlias,
          subAgentName: params.subAgentName,
          task: params.task,
          cancellationToken: bgCancellationToken,
          eventSender: params.eventSender,
          correlationId: params.correlationId,
          noAutoPromote: true,
          externalTaskId: taskId,
        });
      }

      this.enqueueResult(params.parentSessionId, result);
      if (bgTask) {
        bgTask.status = result.success ? 'completed' : 'failed';
      }

    } catch (error) {
      const errorResult: SubAgentTaskResult = {
        subAgentName: params.adhoc ? `adhoc-${taskId.slice(0, 12)}` : params.subAgentName,
        taskId,
        success: false,
        error: error instanceof Error ? error.message : String(error),
        turnCount: 0,
        durationMs: Date.now() - startTime,
      };
      this.enqueueResult(params.parentSessionId, errorResult);
      if (bgTask) {
        bgTask.status = 'failed';
      }
    }
  }

  /**
   * Auto-promote a sync sub-agent to background execution.
   */
  public promoteToBackground(
    taskId: string,
    chatPromise: Promise<string>,
    chat: any,
    params: { parentSessionId: string; parentChatId: string; userAlias: string; subAgentName?: string; eventSender?: Electron.WebContents; correlationId?: string },
    startTime: number,
    availabilityWarnings: string[],
    overrideSubAgentName?: string,
  ): SubAgentTaskResult {
    const subAgentName = overrideSubAgentName || params.subAgentName || 'unknown';

    this.backgroundTasks.set(taskId, {
      taskId,
      parentSessionId: params.parentSessionId,
      subAgentName,
      status: 'running',
      startTime,
      pendingMessages: [],
    });

    void chatPromise.then(
      (resultText) => {
        const bgTask = this.backgroundTasks.get(taskId);
        if (bgTask) bgTask.status = 'completed';
        SubAgentTaskStore.getInstance().completeTask(taskId, 'completed', sanitizeSubAgentResult(resultText));
        this.enqueueResult(params.parentSessionId, {
          subAgentName,
          taskId,
          success: true,
          result: sanitizeSubAgentResult(resultText),
          turnCount: chat.getTurnCount(),
          durationMs: Date.now() - startTime,
          autoPromoted: true,
          availabilityWarnings: availabilityWarnings.length > 0 ? availabilityWarnings : undefined,
        });
      },
      (error) => {
        const bgTask = this.backgroundTasks.get(taskId);
        if (bgTask) bgTask.status = 'failed';
        const partialResult = chat.extractPartialResult?.();
        SubAgentTaskStore.getInstance().completeTask(taskId, 'failed', undefined, error instanceof Error ? error.message : String(error));
        this.enqueueResult(params.parentSessionId, {
          subAgentName,
          taskId,
          success: false,
          error: error instanceof Error ? error.message : String(error),
          partialResult,
          turnCount: chat.getTurnCount(),
          durationMs: Date.now() - startTime,
          autoPromoted: true,
        });
      }
    ).finally(() => {
      chat.dispose?.();
      this.shared.activeInstances.delete(taskId);
      this.backgroundTasks.delete(taskId);
    });

    params.eventSender?.send('subAgent:autoPromoted', { taskId, subAgentName });

    getLogger().info?.('[SubAgentManager] Sub-agent auto-promoted to background', 'promoteToBackground', {
      taskId, subAgentName, elapsedMs: Date.now() - startTime,
    });

    const partialResult = chat.extractPartialResult?.();
    return {
      subAgentName,
      taskId,
      success: true,
      result: `⏱️ Sub-agent "${subAgentName}" auto-promoted to background after ${SUB_AGENT_LIMITS.AUTO_BACKGROUND_TIMEOUT_MS / 1000}s. ` +
        `Results will be delivered at your next turn. Use get_subagent_status to check progress.` +
        (partialResult ? `\n\nPartial progress so far:\n${partialResult.slice(0, 2000)}` : ''),
      turnCount: chat.getTurnCount(),
      durationMs: Date.now() - startTime,
      autoPromoted: true,
      availabilityWarnings: availabilityWarnings.length > 0 ? availabilityWarnings : undefined,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Message & Result Queues
  // ═══════════════════════════════════════════════════════════════════════

  public sendMessageToSubAgent(taskId: string, message: string): { success: boolean; error?: string } {
    const bgTask = this.backgroundTasks.get(taskId);
    if (!bgTask) return { success: false, error: `Background task "${taskId}" not found` };
    if (bgTask.status !== 'running') return { success: false, error: `Task is ${bgTask.status}, cannot send message` };
    if (message.length > 2000) return { success: false, error: 'Message too long (max 2000 characters)' };
    if (bgTask.pendingMessages.length >= 5) return { success: false, error: 'Message queue full (max 5 pending messages)' };
    bgTask.pendingMessages.push(message);
    return { success: true };
  }

  public getBackgroundTask(taskId: string): BackgroundSubAgentTask | undefined {
    return this.backgroundTasks.get(taskId);
  }

  private enqueueResult(parentSessionId: string, result: SubAgentTaskResult): void {
    if (!this.resultQueue.has(parentSessionId)) {
      this.resultQueue.set(parentSessionId, []);
    }
    this.resultQueue.get(parentSessionId)!.push(result);
    this.emitEvent('subAgentResultReady', { parentSessionId });
  }

  public drainResults(parentSessionId: string): SubAgentTaskResult[] {
    const results = this.resultQueue.get(parentSessionId) || [];
    this.resultQueue.delete(parentSessionId);
    return results;
  }

  public handleNotification(parentSessionId: string, notification: SubAgentNotification): void {
    if (!this.notificationQueue.has(parentSessionId)) {
      this.notificationQueue.set(parentSessionId, []);
    }
    const queue = this.notificationQueue.get(parentSessionId)!;
    if (queue.length < 5) {
      queue.push(notification);
    }
  }

  public drainNotifications(parentSessionId: string): SubAgentNotification[] {
    const notifications = this.notificationQueue.get(parentSessionId) || [];
    this.notificationQueue.delete(parentSessionId);
    return notifications;
  }

  public getBackgroundTaskStatus(parentSessionId: string): Array<{ taskId: string; subAgentName: string; status: string; durationMs: number }> {
    const tasks: Array<{ taskId: string; subAgentName: string; status: string; durationMs: number }> = [];
    for (const [, task] of this.backgroundTasks) {
      if (task.parentSessionId === parentSessionId) {
        tasks.push({ taskId: task.taskId, subAgentName: task.subAgentName, status: task.status, durationMs: Date.now() - task.startTime });
      }
    }
    return tasks;
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  IPC State Updates (throttled)
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Safely send sub-agent state updates to Renderer with throttling.
   * Terminal events (completed/failed/cancelled) are sent immediately.
   */
  public sendStateUpdate(
    eventSender: Electron.WebContents | undefined,
    state: SubAgentRuntimeState,
    force = false
  ): void {
    if (!eventSender) return;

    if (!force) {
      const key = state.taskId;
      if (this.stateUpdateThrottles.has(key)) {
        this.pendingStateUpdates.set(key, {
          eventSender,
          state: { ...state, steps: [...state.steps] },
        });
        return;
      }
      this.stateUpdateThrottles.set(key, setTimeout(() => {
        this.stateUpdateThrottles.delete(key);
        const pending = this.pendingStateUpdates.get(key);
        if (pending) {
          this.pendingStateUpdates.delete(key);
          this.sendStateUpdate(pending.eventSender, pending.state);
        }
      }, STATE_UPDATE_THROTTLE_MS));
    } else {
      const key = state.taskId;
      const timer = this.stateUpdateThrottles.get(key);
      if (timer) {
        clearTimeout(timer);
        this.stateUpdateThrottles.delete(key);
      }
      this.pendingStateUpdates.delete(key);
    }

    try {
      if (!eventSender.isDestroyed()) {
        eventSender.send('subAgent:stateUpdate', state);
      }
    } catch (err) {
      getLogger().warn?.(
        `[SubAgentManager] Failed to send stateUpdate: ${err instanceof Error ? err.message : String(err)}`,
        'sendStateUpdate'
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Session Lifecycle
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Cancel all sub-agents under the specified parent session
   */
  public async cancelByParentSession(parentSessionId: string): Promise<number> {
    const childTaskIds = this.shared.parentChildMap.get(parentSessionId);
    if (!childTaskIds) return 0;

    getLogger().info?.('[SubAgentManager] Cancelling sub-agents for parent session', 'cancelByParentSession', {
      parentSessionId,
      childCount: childTaskIds.size,
    });

    let cancelledCount = 0;
    for (const taskId of childTaskIds) {
      const state = this.shared.runtimeStates.get(taskId);
      if (state && state.status === 'running') {
        state.status = 'cancelled';
        state.endTime = Date.now();
        cancelledCount++;
      }

      const chat = this.shared.activeInstances.get(taskId);
      if (chat) {
        chat.dispose();
        this.shared.activeInstances.delete(taskId);
      }
    }

    this.shared.parentChildMap.delete(parentSessionId);

    for (const [, task] of this.backgroundTasks) {
      if (task.parentSessionId === parentSessionId && task.status === 'running') {
        task.status = 'cancelled';
        cancelledCount++;
      }
    }

    return cancelledCount;
  }

  public getRuntimeState(taskId: string): SubAgentRuntimeState | undefined {
    return this.shared.runtimeStates.get(taskId);
  }

  public getStatesForParentSession(parentSessionId: string): SubAgentRuntimeState[] {
    const childTaskIds = this.shared.parentChildMap.get(parentSessionId);
    if (!childTaskIds) return [];

    const states: SubAgentRuntimeState[] = [];
    for (const taskId of childTaskIds) {
      const state = this.shared.runtimeStates.get(taskId);
      if (state) states.push(state);
    }
    return states;
  }

  public cleanup(): void {
    const completedTaskIds: string[] = [];

    for (const [taskId, state] of this.shared.runtimeStates) {
      if (state.status === 'completed' || state.status === 'failed' || state.status === 'cancelled') {
        completedTaskIds.push(taskId);
      }
    }

    for (const taskId of completedTaskIds) {
      this.shared.runtimeStates.delete(taskId);
      this.shared.activeInstances.delete(taskId);
      const timer = this.stateUpdateThrottles.get(taskId);
      if (timer) {
        clearTimeout(timer);
        this.stateUpdateThrottles.delete(taskId);
      }
      this.pendingStateUpdates.delete(taskId);
    }

    // Clean up empty parentChildMap entries
    for (const [sessionId, taskIds] of this.shared.parentChildMap) {
      for (const taskId of taskIds) {
        if (!this.shared.activeInstances.has(taskId)) {
          taskIds.delete(taskId);
        }
      }
      if (taskIds.size === 0) {
        this.shared.parentChildMap.delete(sessionId);
      }
    }
  }

  /**
   * Full cleanup when a parent session is disposed.
   */
  public cancelAllForSession(parentSessionId: string): void {
    const taskIds = this.shared.parentChildMap.get(parentSessionId);
    if (taskIds) {
      for (const taskId of taskIds) {
        const state = this.shared.runtimeStates.get(taskId);
        if (state && state.status === 'running') {
          state.status = 'cancelled';
          state.endTime = Date.now();
        }

        const chat = this.shared.activeInstances.get(taskId);
        if (chat) {
          chat.dispose();
        }
        this.shared.activeInstances.delete(taskId);
        this.shared.runtimeStates.delete(taskId);

        const timer = this.stateUpdateThrottles.get(taskId);
        if (timer) {
          clearTimeout(timer);
          this.stateUpdateThrottles.delete(taskId);
        }
        this.pendingStateUpdates.delete(taskId);
      }
    }

    this.resultQueue.delete(parentSessionId);
    this.notificationQueue.delete(parentSessionId);
    this.shared.parentChildMap.delete(parentSessionId);
    this.shared.spawnCountMap.delete(parentSessionId);

    for (const [taskId, task] of this.backgroundTasks) {
      if (task.parentSessionId === parentSessionId) {
        if (task.status === 'running') {
          task.status = 'cancelled';
        }
        this.backgroundTasks.delete(taskId);
      }
    }

    SubAgentTaskStore.getInstance().removeInMemoryForSession(parentSessionId);

    getLogger().info?.('[SubAgentManager] Cancelled all tasks for disposed session', 'cancelAllForSession', {
      parentSessionId,
      taskCount: taskIds?.size ?? 0,
    });
  }

  public getActiveCount(): number {
    return this.shared.activeInstances.size;
  }

  public getStats(): { activeInstances: number; totalRuntimeStates: number; parentSessions: number } {
    return {
      activeInstances: this.shared.activeInstances.size,
      totalRuntimeStates: this.shared.runtimeStates.size,
      parentSessions: this.shared.parentChildMap.size,
    };
  }
}
