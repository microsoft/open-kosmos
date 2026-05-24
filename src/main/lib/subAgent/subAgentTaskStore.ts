/**
 * SubAgentTaskStore — Persistence layer for sub-agent task records
 *
 * Parallels ChatSessionStore: writes JSON files to disk with dual history
 * (chat_history for UI, context_history for API). Debounced writes (2s idle)
 * with force-flush on completion.
 *
 * Storage: {userData}/profiles/{userAlias}/sub-agent-tasks/{YYYY-MM}/{taskId}.json
 */

import * as fs from 'fs';
import * as path from 'path';
import { app, BrowserWindow } from 'electron';
import type { Message } from '@shared/types/chatTypes';
import type { SubAgentTaskFile, SubAgentTaskMetadata, SubAgentTaskStatus, SubAgentTaskSummary } from './subAgentTaskTypes';
import { createLogger } from '../unifiedLogger';
import { ChatSessionTitleLlmSummarizer } from '../llm/chatSessionTitleLlmSummarizer';

const logger = createLogger();

const FLUSH_DEBOUNCE_MS = 2000;

interface TaskEntry {
  file: SubAgentTaskFile;
  dirty: boolean;
  userAlias: string;
  flushTimer?: ReturnType<typeof setTimeout>;
}

export class SubAgentTaskStore {
  private static instance: SubAgentTaskStore;
  private tasksById: Map<string, TaskEntry> = new Map();
  private mainWindow: BrowserWindow | null = null;

  private constructor() {}

  public static getInstance(): SubAgentTaskStore {
    if (!SubAgentTaskStore.instance) {
      SubAgentTaskStore.instance = new SubAgentTaskStore();
    }
    return SubAgentTaskStore.instance;
  }

  public setMainWindow(window: BrowserWindow | null): void {
    this.mainWindow = window;
  }

  private getWindow(): BrowserWindow | null {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      return this.mainWindow;
    }
    return null;
  }

  private notifyTaskCreated(entry: TaskEntry): void {
    const window = this.getWindow();
    if (!window?.webContents) return;
    window.webContents.send('subAgentTaskStore:taskCreated', {
      taskId: entry.file.taskId,
      subAgentName: entry.file.subAgentName,
      parentSessionId: entry.file.parentSessionId,
      status: entry.file.status,
      startTime: entry.file.startTime,
      turnCount: entry.file.turnCount,
      model: entry.file.model,
      title: entry.file.title,
    });
  }

  private notifyTaskUpdated(entry: TaskEntry): void {
    const window = this.getWindow();
    if (!window?.webContents) return;
    window.webContents.send('subAgentTaskStore:taskUpdated', {
      taskId: entry.file.taskId,
      parentSessionId: entry.file.parentSessionId,
      status: entry.file.status,
      endTime: entry.file.endTime,
      turnCount: entry.file.turnCount,
      title: entry.file.title,
    });
  }

  /**
   * Create a new task record (called at sub-agent spawn time)
   */
  public createTask(userAlias: string, metadata: SubAgentTaskMetadata): void {
    // Generate default title from task description or agent name
    const defaultTitle = metadata.taskDescription
      ? metadata.taskDescription.slice(0, 50) + (metadata.taskDescription.length > 50 ? '...' : '')
      : metadata.subAgentName;

    const file: SubAgentTaskFile = {
      taskId: metadata.taskId,
      subAgentName: metadata.subAgentName,
      parentSessionId: metadata.parentSessionId,
      parentChatId: metadata.parentChatId,
      startTime: metadata.startTime,
      status: 'running',
      model: metadata.model,
      isAdhoc: metadata.isAdhoc,
      turnCount: 0,
      title: defaultTitle,
      chat_history: [],
      context_history: [],
    };

    const entry: TaskEntry = { file, dirty: true, userAlias };
    this.tasksById.set(metadata.taskId, entry);
    this.scheduleFlush(metadata.taskId);
    this.notifyTaskCreated(entry);

    // Fire-and-forget: async LLM title generation
    if (metadata.taskDescription) {
      this.generateTitleAsync(metadata.taskId, metadata.taskDescription);
    }
  }

  /**
   * Append a message to the task's history
   */
  public appendMessage(taskId: string, msg: Message, target: 'both' | 'context_only' = 'both'): void {
    const entry = this.tasksById.get(taskId);
    if (!entry) return;

    entry.file.context_history.push(msg);
    if (target === 'both') {
      entry.file.chat_history.push(msg);
    }
    entry.dirty = true;
    this.scheduleFlush(taskId);
  }

  /**
   * Append multiple messages
   */
  public appendMessages(taskId: string, msgs: Message[], target: 'both' | 'context_only' = 'both'): void {
    const entry = this.tasksById.get(taskId);
    if (!entry) return;

    entry.file.context_history.push(...msgs);
    if (target === 'both') {
      entry.file.chat_history.push(...msgs);
    }
    entry.dirty = true;
    this.scheduleFlush(taskId);
  }

  /**
   * Replace context_history after compression (chatHistory stays intact)
   */
  public replaceContextHistory(taskId: string, newContextHistory: Message[]): void {
    const entry = this.tasksById.get(taskId);
    if (!entry) return;

    entry.file.context_history = [...newContextHistory];
    entry.dirty = true;
    this.scheduleFlush(taskId);
  }

  /**
   * Update turn count
   */
  public incrementTurnCount(taskId: string): void {
    const entry = this.tasksById.get(taskId);
    if (!entry) return;
    entry.file.turnCount++;
    entry.dirty = true;
  }

  /**
   * Mark task as completed/failed/cancelled — force flush immediately
   */
  public completeTask(taskId: string, status: SubAgentTaskStatus, result?: string, error?: string): void {
    const entry = this.tasksById.get(taskId);
    if (!entry) return;

    entry.file.status = status;
    entry.file.endTime = Date.now();
    if (result !== undefined) entry.file.result = result;
    if (error !== undefined) entry.file.error = error;
    entry.dirty = true;

    // Force flush immediately on completion
    this.flushNow(taskId);
    this.notifyTaskUpdated(entry);
  }

  /**
   * Get task file (for IPC loading)
   */
  public getTaskFile(taskId: string): SubAgentTaskFile | undefined {
    return this.tasksById.get(taskId)?.file;
  }

  /**
   * Get all tasks for a given parent session (metadata only, no histories).
   * Checks both in-memory and on-disk tasks.
   */
  public getTasksForSession(parentSessionId: string, userAlias?: string): SubAgentTaskSummary[] {
    const seen = new Set<string>();
    const results: SubAgentTaskSummary[] = [];

    // 1. In-memory tasks
    for (const [, entry] of this.tasksById) {
      if (entry.file.parentSessionId === parentSessionId) {
        seen.add(entry.file.taskId);
        results.push({
          taskId: entry.file.taskId,
          subAgentName: entry.file.subAgentName,
          status: entry.file.status,
          startTime: entry.file.startTime,
          endTime: entry.file.endTime,
          turnCount: entry.file.turnCount,
          model: entry.file.model,
          title: entry.file.title,
        });
      }
    }

    // 2. Scan disk for tasks not in memory
    if (userAlias) {
      const baseDir = this.getBaseDir(userAlias);
      if (fs.existsSync(baseDir)) {
        try {
          const monthDirs = fs.readdirSync(baseDir).filter(d => /^\d{6}$/.test(d));
          for (const monthDir of monthDirs) {
            const dirPath = path.join(baseDir, monthDir);
            const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.json'));
            for (const file of files) {
              const taskId = file.replace('.json', '');
              if (seen.has(taskId)) continue;
              try {
                const content = fs.readFileSync(path.join(dirPath, file), 'utf-8');
                const taskFile = JSON.parse(content) as SubAgentTaskFile;
                if (taskFile.parentSessionId === parentSessionId) {
                  seen.add(taskId);
                  // Recover orphaned running tasks: if on disk but not in memory,
                  // it was interrupted by app exit — mark as cancelled
                  const recoveredStatus: SubAgentTaskStatus =
                    taskFile.status === 'running' ? 'cancelled' : taskFile.status;
                  if (recoveredStatus !== taskFile.status) {
                    taskFile.status = recoveredStatus;
                    taskFile.endTime = taskFile.endTime || Date.now();
                    // Persist the recovery to disk
                    try {
                      const recoveredPath = path.join(dirPath, file);
                      fs.writeFileSync(recoveredPath, JSON.stringify(taskFile, null, 2), 'utf-8');
                    } catch { /* best-effort */ }
                  }
                  results.push({
                    taskId: taskFile.taskId,
                    subAgentName: taskFile.subAgentName,
                    status: recoveredStatus,
                    startTime: taskFile.startTime,
                    endTime: taskFile.endTime,
                    turnCount: taskFile.turnCount,
                    model: taskFile.model,
                    title: taskFile.title,
                  });
                }
              } catch {
                // Skip corrupted files
              }
            }
          }
        } catch (err) {
          logger.warn('[SubAgentTaskStore] Failed to scan disk for session tasks', 'getTasksForSession', {
            parentSessionId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    return results;
  }

  /**
   * Load task from disk (for viewing completed tasks)
   */
  public async loadFromDisk(userAlias: string, taskId: string): Promise<SubAgentTaskFile | null> {
    // Check in-memory first
    const inMemory = this.tasksById.get(taskId);
    if (inMemory) return inMemory.file;

    // Try to find on disk — need to scan month dirs
    const baseDir = this.getBaseDir(userAlias);
    if (!fs.existsSync(baseDir)) return null;

    try {
      const monthDirs = fs.readdirSync(baseDir).filter(d => /^\d{6}$/.test(d));
      for (const monthDir of monthDirs) {
        const filePath = path.join(baseDir, monthDir, `${taskId}.json`);
        if (fs.existsSync(filePath)) {
          const content = fs.readFileSync(filePath, 'utf-8');
          const taskFile = JSON.parse(content) as SubAgentTaskFile;
          // Recover orphaned running task — was interrupted by app exit
          if (taskFile.status === 'running') {
            taskFile.status = 'cancelled';
            taskFile.endTime = taskFile.endTime || Date.now();
            try {
              fs.writeFileSync(filePath, JSON.stringify(taskFile, null, 2), 'utf-8');
            } catch { /* best-effort */ }
          }
          return taskFile;
        }
      }
    } catch (err) {
      logger.warn('[SubAgentTaskStore] Failed to load task from disk', 'loadFromDisk', {
        taskId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return null;
  }

  /**
   * Remove in-memory entries for a session (called on session dispose)
   * Does NOT delete files — keeps them for audit.
   */
  public removeInMemoryForSession(parentSessionId: string): void {
    for (const [taskId, entry] of this.tasksById) {
      if (entry.file.parentSessionId === parentSessionId) {
        if (entry.flushTimer) clearTimeout(entry.flushTimer);
        // Flush any dirty state before removing
        if (entry.dirty) {
          this.flushNow(taskId);
        }
        this.tasksById.delete(taskId);
      }
    }
  }

  // ─── Private ───

  private async generateTitleAsync(taskId: string, taskDescription: string): Promise<void> {
    try {
      const response = await ChatSessionTitleLlmSummarizer.generateTitle(taskDescription);
      if (response?.success && response.title) {
        const entry = this.tasksById.get(taskId);
        if (entry) {
          entry.file.title = response.title.trim();
          entry.dirty = true;
          this.scheduleFlush(taskId);
          this.notifyTaskUpdated(entry);
        }
      }
    } catch (err) {
      logger.warn('[SubAgentTaskStore] Async title generation failed', 'generateTitleAsync', {
        taskId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private scheduleFlush(taskId: string): void {
    const entry = this.tasksById.get(taskId);
    if (!entry) return;

    if (entry.flushTimer) clearTimeout(entry.flushTimer);
    entry.flushTimer = setTimeout(() => {
      this.flushNow(taskId);
    }, FLUSH_DEBOUNCE_MS);
  }

  private flushNow(taskId: string): void {
    const entry = this.tasksById.get(taskId);
    if (!entry || !entry.dirty) return;

    if (entry.flushTimer) {
      clearTimeout(entry.flushTimer);
      entry.flushTimer = undefined;
    }

    try {
      const filePath = this.getFilePath(entry.userAlias, entry.file);
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Atomic write: write to temp file then rename
      const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify(entry.file, null, 2), 'utf-8');
      fs.renameSync(tempPath, filePath);

      entry.dirty = false;
    } catch (err) {
      logger.error('[SubAgentTaskStore] Failed to flush task to disk', 'flushNow', {
        taskId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private getBaseDir(userAlias: string): string {
    const userData = app.getPath('userData');
    return path.join(userData, 'profiles', userAlias, 'sub-agent-tasks');
  }

  private getFilePath(userAlias: string, file: SubAgentTaskFile): string {
    const yearMonth = this.getYearMonth(file.startTime);
    return path.join(this.getBaseDir(userAlias), yearMonth, `${file.taskId}.json`);
  }

  private getYearMonth(timestamp: number): string {
    const d = new Date(timestamp);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    return `${y}${m}`;
  }
}
