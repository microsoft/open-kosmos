import * as fs from 'fs';
import * as path from 'path';
import { createLogger } from '../unifiedLogger';
import {
  SchedulerJob,
  ScheduleJobLocation,
  ScheduleMonthFile,
  normalizeScheduleMonthFile,
  normalizeSchedulerJob,
} from '../scheduler/types';
import {
  getProfileDirectoryPath,
} from './pathUtils';
import {
  extractMonthKeyFromScheduleJob,
  getMonthKeyFromRunAt,
  isValidScheduleJobId,
} from '../scheduler/id';

const logger = createLogger();

function isValidMonthKey(monthKey: string): boolean {
  return /^\d{6}$/.test(monthKey);
}

function getSchedulesRootPath(alias: string): string {
  const profileDir = getProfileDirectoryPath(alias);
  const schedulesRoot = path.join(profileDir, 'schedules');
  if (!fs.existsSync(schedulesRoot)) {
    fs.mkdirSync(schedulesRoot, { recursive: true });
  }
  return schedulesRoot;
}

function getScheduleMonthFilePath(alias: string, monthKey: string): string {
  if (!isValidMonthKey(monthKey)) {
    throw new Error(`Invalid schedule month key: ${monthKey}`);
  }
  return path.join(getSchedulesRootPath(alias), `${monthKey}.json`);
}

function resolveMonthKeyForJob(job: SchedulerJob): string {
  if (job.scheduleType === 'once') {
    const monthKey = job.runAt ? getMonthKeyFromRunAt(job.runAt) : null;
    if (!monthKey) {
      throw new Error(`Unable to resolve month key from runAt for job ${job.id}`);
    }
    return monthKey;
  }

  const fromId = extractMonthKeyFromScheduleJob(job.id);
  if (fromId) {
    return fromId;
  }

  throw new Error(`Unable to resolve month key for cron job ${job.id}`);
}

export class ScheduleSettingsManager {
  private static instance: ScheduleSettingsManager;
  private readonly monthWriteLocks: Map<string, Promise<void>> = new Map();

  static getInstance(): ScheduleSettingsManager {
    if (!ScheduleSettingsManager.instance) {
      ScheduleSettingsManager.instance = new ScheduleSettingsManager();
    }
    return ScheduleSettingsManager.instance;
  }

  private getMonthLockKey(alias: string, monthKey: string): string {
    return `${alias}::${monthKey}`;
  }

  private async withMonthWriteLock<T>(
    alias: string,
    monthKey: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const lockKey = this.getMonthLockKey(alias, monthKey);
    const previousLock = this.monthWriteLocks.get(lockKey) || Promise.resolve();

    let release!: () => void;
    const currentLock = new Promise<void>((resolve) => {
      release = resolve;
    });

    this.monthWriteLocks.set(
      lockKey,
      previousLock.then(() => currentLock, () => currentLock),
    );

    await previousLock;

    try {
      return await operation();
    } finally {
      release();
      if (this.monthWriteLocks.get(lockKey) === currentLock) {
        this.monthWriteLocks.delete(lockKey);
      }
    }
  }

  private async writeFileAtomically(filePath: string, content: string): Promise<void> {
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;

    try {
      await fs.promises.writeFile(tempPath, content, 'utf-8');
      await fs.promises.rename(tempPath, filePath);
    } catch (error) {
      try {
        if (fs.existsSync(tempPath)) {
          await fs.promises.unlink(tempPath);
        }
      } catch {
        // ignore temp cleanup failure
      }
      throw error;
    }
  }

  async ensureSchedulesDir(alias: string): Promise<string> {
    return getSchedulesRootPath(alias);
  }

  async listScheduleMonths(alias: string): Promise<string[]> {
    try {
      const schedulesRoot = await this.ensureSchedulesDir(alias);
      const entries = await fs.promises.readdir(schedulesRoot, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isFile() && /^\d{6}\.json$/.test(entry.name))
        .map((entry) => entry.name.replace(/\.json$/, ''))
        .sort()
        .reverse();
    } catch (error) {
      logger.warn('[ScheduleSettingsManager] Failed to list schedule months', 'listScheduleMonths', {
        alias,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  async readScheduleMonth(alias: string, monthKey: string): Promise<ScheduleMonthFile> {
    const filePath = getScheduleMonthFilePath(alias, monthKey);
    try {
      if (!fs.existsSync(filePath)) {
        return { schedulerJobs: [] };
      }

      const content = await fs.promises.readFile(filePath, 'utf-8');
      if (!content.trim()) {
        return { schedulerJobs: [] };
      }

      return normalizeScheduleMonthFile(JSON.parse(content));
    } catch (error) {
      logger.error('[ScheduleSettingsManager] Failed to read schedule month', 'readScheduleMonth', {
        alias,
        monthKey,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async writeScheduleMonth(alias: string, monthKey: string, file: ScheduleMonthFile): Promise<void> {
    const filePath = getScheduleMonthFilePath(alias, monthKey);
    const normalized: ScheduleMonthFile = {
      schedulerJobs: file.schedulerJobs.map((job) => normalizeSchedulerJob(job)),
    };

    await this.withMonthWriteLock(alias, monthKey, async () => {
      await this.writeFileAtomically(filePath, JSON.stringify(normalized, null, 2));
    });
  }

  async upsertScheduleJob(alias: string, job: SchedulerJob): Promise<string> {
    if (!isValidScheduleJobId(job.id)) {
      throw new Error(`Invalid schedule job id: ${job.id}`);
    }

    const monthKey = resolveMonthKeyForJob(job);

    await this.withMonthWriteLock(alias, monthKey, async () => {
      const monthFile = await this.readScheduleMonth(alias, monthKey);
      const nextJob = normalizeSchedulerJob(job);
      const index = monthFile.schedulerJobs.findIndex((item) => item.id === job.id);

      if (index >= 0) {
        monthFile.schedulerJobs[index] = nextJob;
      } else {
        monthFile.schedulerJobs.push(nextJob);
      }

      monthFile.schedulerJobs.sort((a, b) => b.id.localeCompare(a.id));
      const filePath = getScheduleMonthFilePath(alias, monthKey);
      await this.writeFileAtomically(filePath, JSON.stringify(monthFile, null, 2));
    });

    return monthKey;
  }

  async deleteScheduleJob(alias: string, monthKey: string, jobId: string): Promise<boolean> {
    return this.withMonthWriteLock(alias, monthKey, async () => {
      const monthFile = await this.readScheduleMonth(alias, monthKey);
      const nextJobs = monthFile.schedulerJobs.filter((job) => job.id !== jobId);
      if (nextJobs.length === monthFile.schedulerJobs.length) {
        return false;
      }

      const filePath = getScheduleMonthFilePath(alias, monthKey);
      if (nextJobs.length === 0) {
        try {
          if (fs.existsSync(filePath)) {
            await fs.promises.unlink(filePath);
          }
        } catch (error) {
          logger.error('[ScheduleSettingsManager] Failed to delete empty schedule month file', 'deleteScheduleJob', {
            alias,
            monthKey,
            jobId,
            error: error instanceof Error ? error.message : String(error),
          });
          throw error;
        }
        return true;
      }

      await this.writeFileAtomically(
        filePath,
        JSON.stringify({ schedulerJobs: nextJobs }, null, 2),
      );
      return true;
    });
  }

  async findJobLocation(alias: string, jobId: string): Promise<ScheduleJobLocation | null> {
    const months = await this.listScheduleMonths(alias);
    for (const monthKey of months) {
      const monthFile = await this.readScheduleMonth(alias, monthKey);
      const job = monthFile.schedulerJobs.find((item) => item.id === jobId);
      if (job) {
        return {
          monthKey,
          job,
        };
      }
    }
    return null;
  }

  async getAllJobs(alias: string): Promise<SchedulerJob[]> {
    const months = await this.listScheduleMonths(alias);
    const jobs: SchedulerJob[] = [];

    for (const monthKey of months) {
      const monthFile = await this.readScheduleMonth(alias, monthKey);
      jobs.push(...monthFile.schedulerJobs);
    }

    return jobs.sort((a, b) => b.id.localeCompare(a.id));
  }
}

export const scheduleSettingsManager = ScheduleSettingsManager.getInstance();
