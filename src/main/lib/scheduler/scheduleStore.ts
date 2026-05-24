import { BrowserWindow } from 'electron';
import * as cron from 'node-cron';
import { createLogger } from '../unifiedLogger';
import { scheduleSettingsManager } from '../userDataADO/scheduleSettingsManager';
import {
  SchedulerJob,
  ScheduleJobUpdate,
  normalizeSchedulerJob,
} from './types';
import {
  extractMonthKeyFromScheduleJob,
  generateScheduleJobId,
  getMonthKeyFromRunAt,
  isValidScheduleJobId,
} from './id';

const logger = createLogger();

function cloneDeep<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function getMonthMapKey(alias: string, monthKey: string): string {
  return `${alias}::${monthKey}`;
}

function resolveMonthKey(job: SchedulerJob): string {
  if (job.scheduleType === 'once') {
    const monthKey = job.runAt ? getMonthKeyFromRunAt(job.runAt) : null;
    if (!monthKey) {
      throw new Error(`Invalid runAt for schedule job ${job.id}`);
    }
    return monthKey;
  }

  const fromId = extractMonthKeyFromScheduleJob(job.id);
  if (!fromId) {
    throw new Error(`Invalid schedule job id for cron schedule ${job.id}`);
  }

  return fromId;
}

function validateJob(job: SchedulerJob): void {
  if (!isValidScheduleJobId(job.id)) {
    throw new Error(`Invalid schedule job id: ${job.id}`);
  }

  if (!job.name.trim()) {
    throw new Error('Schedule name is required');
  }

  if (!job.message.trim()) {
    throw new Error('Schedule message is required');
  }

  if (!job.agentId.trim()) {
    throw new Error('Schedule agentId is required');
  }

  if (job.scheduleType === 'cron') {
    if (!job.cronExpression?.trim()) {
      throw new Error('cronExpression is required for cron schedule');
    }
    if (!cron.validate(job.cronExpression.trim())) {
      throw new Error(`Invalid cron expression: ${job.cronExpression}`);
    }
    return;
  }

  if (!job.runAt?.trim()) {
    throw new Error('runAt is required for one-time schedule');
  }

  if (Number.isNaN(Date.parse(job.runAt))) {
    throw new Error(`Invalid runAt: ${job.runAt}`);
  }
}

export interface ScheduleJobRuntimeState {
  loaded: boolean;
  dirty: boolean;
  revision: number;
  persistedRevision: number;
  lastAccessedAt: number;
  isFlushing: boolean;
}

export interface ScheduleJobAggregate {
  alias: string;
  monthKey: string;
  settings: SchedulerJob;
  runtime: ScheduleJobRuntimeState;
}

export interface ScheduleJobsProjection {
  alias: string;
  jobs: SchedulerJob[];
  timestamp: number;
}

export class ScheduleStore {
  private static instance: ScheduleStore;

  private readonly jobsById: Map<string, ScheduleJobAggregate> = new Map();
  private readonly monthToJobIds: Map<string, Set<string>> = new Map();
  private readonly loadedMonths: Set<string> = new Set();
  private readonly jobMutationQueues: Map<string, Promise<void>> = new Map();
  private mainWindow: BrowserWindow | null = null;
  private currentAlias: string | null = null;

  static getInstance(): ScheduleStore {
    if (!ScheduleStore.instance) {
      ScheduleStore.instance = new ScheduleStore();
    }
    return ScheduleStore.instance;
  }

  setMainWindow(window: BrowserWindow | null): void {
    this.mainWindow = window;
  }

  getCurrentAlias(): string | null {
    return this.currentAlias;
  }

  async initialize(alias: string): Promise<void> {
    logger.info('scheduler.store.initialize.start', 'initialize', {
      alias,
      previousAlias: this.currentAlias,
      cachedJobCountBefore: this.jobsById.size,
      loadedMonthCountBefore: this.loadedMonths.size,
    });

    this.currentAlias = alias;
    this.clearAliasState(alias);
    await scheduleSettingsManager.ensureSchedulesDir(alias);

    const months = await scheduleSettingsManager.listScheduleMonths(alias);
    for (const monthKey of months) {
      await this.ensureMonthLoaded(alias, monthKey);
    }

    logger.info('scheduler.store.initialize.end', 'initialize', {
      alias,
      loadedMonthKeys: months,
      loadedMonthCount: months.length,
      cachedJobCountAfter: Array.from(this.jobsById.values()).filter((aggregate) => aggregate.alias === alias).length,
    });
  }

  async getJobsProjection(alias: string, agentId?: string): Promise<ScheduleJobsProjection> {
    const months = await scheduleSettingsManager.listScheduleMonths(alias);
    for (const monthKey of months) {
      await this.ensureMonthLoaded(alias, monthKey);
    }

    const jobs = Array.from(this.jobsById.values())
      .filter((aggregate) => aggregate.alias === alias)
      .map((aggregate) => cloneDeep(aggregate.settings))
      .filter((job) => !agentId || job.agentId === agentId)
      .sort((a, b) => b.id.localeCompare(a.id));

    return {
      alias,
      jobs,
      timestamp: Date.now(),
    };
  }

  async listJobs(alias: string, agentId?: string): Promise<SchedulerJob[]> {
    const projection = await this.getJobsProjection(alias, agentId);
    return projection.jobs;
  }

  async getJob(alias: string, jobId: string): Promise<SchedulerJob | null> {
    const aggregate = await this.ensureJobLoaded(alias, jobId);
    return aggregate ? cloneDeep(aggregate.settings) : null;
  }

  async createJob(alias: string, input: Omit<SchedulerJob, 'id'> & { id?: string }): Promise<SchedulerJob> {
    const job = normalizeSchedulerJob({
      ...cloneDeep(input),
      id: input.id && input.id.trim() ? input.id : generateScheduleJobId(),
    });

    validateJob(job);

    if (await this.ensureJobLoaded(alias, job.id)) {
      throw new Error(`Schedule job already exists: ${job.id}`);
    }

    const monthKey = resolveMonthKey(job);
    const aggregate = this.buildAggregate(alias, monthKey, job, false);
    aggregate.runtime.dirty = true;
    aggregate.runtime.revision = 1;
    this.cacheAggregate(aggregate);

    await this.flushJob(job.id);
    this.notifyJobCreated(aggregate);
    return cloneDeep(aggregate.settings);
  }

  async updateJob(alias: string, jobId: string, updates: ScheduleJobUpdate): Promise<SchedulerJob | null> {
    const aggregate = await this.ensureJobLoaded(alias, jobId);
    if (!aggregate) {
      return null;
    }

    return this.enqueueOnJob(jobId, async () => {
      const current = this.jobsById.get(jobId);
      if (!current) {
        return null;
      }

      const nextSettings = normalizeSchedulerJob({
        ...cloneDeep(current.settings),
        ...cloneDeep(updates),
        id: current.settings.id,
      });
      validateJob(nextSettings);

      const previousMonthKey = current.monthKey;
      const nextMonthKey = resolveMonthKey(nextSettings);

      current.settings = nextSettings;
      current.monthKey = nextMonthKey;
      current.runtime.dirty = true;
      current.runtime.revision += 1;
      current.runtime.lastAccessedAt = Date.now();

      if (previousMonthKey !== nextMonthKey) {
        this.removeAggregateFromMonthIndex(current.alias, previousMonthKey, jobId);
        this.addAggregateToMonthIndex(current.alias, nextMonthKey, jobId);
      }

      await this.flushJob(jobId, { previousMonthKey });
      this.notifyJobPatched(current);
      return cloneDeep(current.settings);
    });
  }

  async toggleJob(alias: string, jobId: string, enabled: boolean): Promise<SchedulerJob | null> {
    return this.updateJob(alias, jobId, { enabled });
  }

  async deleteJob(alias: string, jobId: string): Promise<boolean> {
    const aggregate = await this.ensureJobLoaded(alias, jobId);
    if (!aggregate) {
      return false;
    }

    return this.enqueueOnJob(jobId, async () => {
      const current = this.jobsById.get(jobId);
      if (!current) {
        return false;
      }

      const deleted = await scheduleSettingsManager.deleteScheduleJob(alias, current.monthKey, jobId);
      if (!deleted) {
        return false;
      }

      this.jobsById.delete(jobId);
      this.removeAggregateFromMonthIndex(alias, current.monthKey, jobId);
      this.notifyJobDeleted(alias, jobId);
      return true;
    });
  }

  async markJobExecutionStarted(alias: string, jobId: string, startedAt: string): Promise<SchedulerJob | null> {
    logger.info('scheduler.store.mark-execution-started.before', 'markJobExecutionStarted', {
      alias,
      jobId,
      startedAt,
    });

    const updated = await this.updateJob(alias, jobId, {
      status: 'pending',
      lastRunAt: startedAt,
    });

    logger.info('scheduler.store.mark-execution-started.after', 'markJobExecutionStarted', {
      alias,
      jobId,
      startedAt,
      success: !!updated,
      updatedFields: updated
        ? {
            status: updated.status,
            lastRunAt: updated.lastRunAt,
          }
        : null,
    });

    return updated;
  }

  async markJobExecutionCompleted(alias: string, jobId: string, executedAt: string): Promise<SchedulerJob | null> {
    const aggregate = await this.ensureJobLoaded(alias, jobId);
    if (!aggregate) {
      logger.info('scheduler.store.mark-execution-completed.after', 'markJobExecutionCompleted', {
        alias,
        jobId,
        executedAt,
        success: false,
        reason: 'job-not-found',
      });
      return null;
    }

    logger.info('scheduler.store.mark-execution-completed.before', 'markJobExecutionCompleted', {
      alias,
      jobId,
      executedAt,
      scheduleType: aggregate.settings.scheduleType,
      previousStatus: aggregate.settings.status,
      previousLastRunAt: aggregate.settings.lastRunAt,
      previousLastFinishedAt: aggregate.settings.lastFinishedAt,
    });

    if (aggregate.settings.scheduleType === 'once') {
      const updated = await this.updateJob(alias, jobId, {
        enabled: false,
        status: 'completed',
        lastRunAt: executedAt,
        lastFinishedAt: executedAt,
        executedAt,
      });

      logger.info('scheduler.store.mark-execution-completed.after', 'markJobExecutionCompleted', {
        alias,
        jobId,
        executedAt,
        success: !!updated,
        updatedFields: updated
          ? {
              enabled: updated.enabled,
              status: updated.status,
              lastRunAt: updated.lastRunAt,
              lastFinishedAt: updated.lastFinishedAt,
              executedAt: updated.executedAt,
            }
          : null,
      });
      return updated;
    }

    const updated = await this.updateJob(alias, jobId, {
      status: 'pending',
      lastRunAt: executedAt,
      lastFinishedAt: executedAt,
    });

    logger.info('scheduler.store.mark-execution-completed.after', 'markJobExecutionCompleted', {
      alias,
      jobId,
      executedAt,
      success: !!updated,
      updatedFields: updated
        ? {
            status: updated.status,
            lastRunAt: updated.lastRunAt,
            lastFinishedAt: updated.lastFinishedAt,
          }
        : null,
    });
    return updated;
  }

  async markJobExecutionFailed(alias: string, jobId: string, executedAt: string): Promise<SchedulerJob | null> {
    const aggregate = await this.ensureJobLoaded(alias, jobId);
    if (!aggregate) {
      logger.info('scheduler.store.mark-execution-failed.after', 'markJobExecutionFailed', {
        alias,
        jobId,
        executedAt,
        success: false,
        reason: 'job-not-found',
      });
      return null;
    }

    logger.info('scheduler.store.mark-execution-failed.before', 'markJobExecutionFailed', {
      alias,
      jobId,
      executedAt,
      scheduleType: aggregate.settings.scheduleType,
      previousStatus: aggregate.settings.status,
      previousLastRunAt: aggregate.settings.lastRunAt,
      previousLastFinishedAt: aggregate.settings.lastFinishedAt,
    });

    if (aggregate.settings.scheduleType === 'once') {
      const updated = await this.updateJob(alias, jobId, {
        enabled: false,
        status: 'failed',
        lastRunAt: executedAt,
        lastFinishedAt: executedAt,
        executedAt,
      });

      logger.info('scheduler.store.mark-execution-failed.after', 'markJobExecutionFailed', {
        alias,
        jobId,
        executedAt,
        success: !!updated,
        updatedFields: updated
          ? {
              enabled: updated.enabled,
              status: updated.status,
              lastRunAt: updated.lastRunAt,
              lastFinishedAt: updated.lastFinishedAt,
              executedAt: updated.executedAt,
            }
          : null,
      });
      return updated;
    }

    const updated = await this.updateJob(alias, jobId, {
      status: 'failed',
      lastRunAt: executedAt,
      lastFinishedAt: executedAt,
    });

    logger.info('scheduler.store.mark-execution-failed.after', 'markJobExecutionFailed', {
      alias,
      jobId,
      executedAt,
      success: !!updated,
      updatedFields: updated
        ? {
            status: updated.status,
            lastRunAt: updated.lastRunAt,
            lastFinishedAt: updated.lastFinishedAt,
          }
        : null,
    });
    return updated;
  }

  async markJobExpired(alias: string, jobId: string): Promise<SchedulerJob | null> {
    logger.info('scheduler.store.mark-expired.before', 'markJobExpired', {
      alias,
      jobId,
    });

    const updated = await this.updateJob(alias, jobId, {
      enabled: false,
      status: 'expired',
    });

    logger.info('scheduler.store.mark-expired.after', 'markJobExpired', {
      alias,
      jobId,
      success: !!updated,
      updatedFields: updated
        ? {
            enabled: updated.enabled,
            status: updated.status,
          }
        : null,
    });
    return updated;
  }

  private async ensureJobLoaded(alias: string, jobId: string): Promise<ScheduleJobAggregate | null> {
    const cached = this.jobsById.get(jobId);
    if (cached) {
      cached.runtime.lastAccessedAt = Date.now();
      return cached;
    }

    if (!isValidScheduleJobId(jobId)) {
      logger.warn('[ScheduleStore] Invalid schedule job id', 'ensureJobLoaded', {
        alias,
        jobId,
      });
      return null;
    }

    const location = await scheduleSettingsManager.findJobLocation(alias, jobId);
    if (!location) {
      return null;
    }

    const aggregate = this.buildAggregate(alias, location.monthKey, location.job, true);
    this.cacheAggregate(aggregate);
    return aggregate;
  }

  private async ensureMonthLoaded(alias: string, monthKey: string): Promise<void> {
    const monthMapKey = getMonthMapKey(alias, monthKey);
    if (this.loadedMonths.has(monthMapKey)) {
      return;
    }

    const monthFile = await scheduleSettingsManager.readScheduleMonth(alias, monthKey);
    logger.info('scheduler.store.initialize.month-loaded', 'ensureMonthLoaded', {
      alias,
      monthKey,
      jobCount: monthFile.schedulerJobs.length,
      jobIds: monthFile.schedulerJobs.map((job) => job.id),
    });

    for (const job of monthFile.schedulerJobs) {
      const aggregate = this.buildAggregate(alias, monthKey, job, true);
      this.cacheAggregate(aggregate);
    }

    this.loadedMonths.add(monthMapKey);
  }

  private async enqueueOnJob<T>(jobId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.jobMutationQueues.get(jobId) || Promise.resolve();

    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });

    this.jobMutationQueues.set(
      jobId,
      previous.then(() => current, () => current),
    );

    await previous;

    try {
      return await task();
    } finally {
      release();
      if (this.jobMutationQueues.get(jobId) === current) {
        this.jobMutationQueues.delete(jobId);
      }
    }
  }

  private buildAggregate(alias: string, monthKey: string, job: SchedulerJob, loaded: boolean): ScheduleJobAggregate {
    return {
      alias,
      monthKey,
      settings: normalizeSchedulerJob(job),
      runtime: {
        loaded,
        dirty: false,
        revision: 0,
        persistedRevision: 0,
        lastAccessedAt: Date.now(),
        isFlushing: false,
      },
    };
  }

  private cacheAggregate(aggregate: ScheduleJobAggregate): void {
    this.jobsById.set(aggregate.settings.id, aggregate);
    this.addAggregateToMonthIndex(aggregate.alias, aggregate.monthKey, aggregate.settings.id);
    this.loadedMonths.add(getMonthMapKey(aggregate.alias, aggregate.monthKey));
  }

  private addAggregateToMonthIndex(alias: string, monthKey: string, jobId: string): void {
    const mapKey = getMonthMapKey(alias, monthKey);
    const existing = this.monthToJobIds.get(mapKey) || new Set<string>();
    existing.add(jobId);
    this.monthToJobIds.set(mapKey, existing);
  }

  private removeAggregateFromMonthIndex(alias: string, monthKey: string, jobId: string): void {
    const mapKey = getMonthMapKey(alias, monthKey);
    const existing = this.monthToJobIds.get(mapKey);
    if (!existing) {
      return;
    }

    existing.delete(jobId);
    if (existing.size === 0) {
      this.monthToJobIds.delete(mapKey);
      this.loadedMonths.delete(mapKey);
      return;
    }

    this.monthToJobIds.set(mapKey, existing);
  }

  private async flushJob(jobId: string, options?: { previousMonthKey?: string }): Promise<void> {
    const aggregate = this.jobsById.get(jobId);
    if (!aggregate) {
      return;
    }

    const targetRevision = aggregate.runtime.revision;
    aggregate.runtime.isFlushing = true;
    const snapshot = normalizeSchedulerJob(aggregate.settings);

    if (options?.previousMonthKey && options.previousMonthKey !== aggregate.monthKey) {
      await scheduleSettingsManager.deleteScheduleJob(aggregate.alias, options.previousMonthKey, jobId);
    }

    await scheduleSettingsManager.upsertScheduleJob(aggregate.alias, snapshot);
    aggregate.runtime.isFlushing = false;

    if (aggregate.runtime.revision === targetRevision) {
      aggregate.runtime.persistedRevision = targetRevision;
      aggregate.runtime.dirty = false;
    }
  }

  private clearAliasState(alias: string): void {
    Array.from(this.jobsById.entries()).forEach(([jobId, aggregate]) => {
      if (aggregate.alias === alias) {
        this.jobsById.delete(jobId);
      }
    });

    Array.from(this.monthToJobIds.keys()).forEach((key) => {
      if (key.startsWith(`${alias}::`)) {
        this.monthToJobIds.delete(key);
        this.loadedMonths.delete(key);
      }
    });
  }

  private getWindow(): BrowserWindow | null {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      return this.mainWindow;
    }

    const windows = BrowserWindow.getAllWindows();
    return windows.find((window) => !window.isDestroyed()) || null;
  }

  private notifyJobCreated(aggregate: ScheduleJobAggregate): void {
    const window = this.getWindow();
    if (!window?.webContents) {
      return;
    }

    window.webContents.send('scheduleStore:jobCreated', {
      alias: aggregate.alias,
      job: cloneDeep(aggregate.settings),
      timestamp: Date.now(),
    });
  }

  private notifyJobPatched(aggregate: ScheduleJobAggregate): void {
    const window = this.getWindow();
    if (!window?.webContents) {
      return;
    }

    window.webContents.send('scheduleStore:jobPatched', {
      alias: aggregate.alias,
      jobId: aggregate.settings.id,
      job: cloneDeep(aggregate.settings),
      timestamp: Date.now(),
    });
  }

  private notifyJobDeleted(alias: string, jobId: string): void {
    const window = this.getWindow();
    if (!window?.webContents) {
      return;
    }

    window.webContents.send('scheduleStore:jobDeleted', {
      alias,
      jobId,
      timestamp: Date.now(),
    });
  }
}

export const scheduleStore = ScheduleStore.getInstance();
