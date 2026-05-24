import * as fs from 'fs';
import * as path from 'path';
import { scheduleSettingsManager } from '../userDataADO/scheduleSettingsManager';

export interface PendingColdStartCatchUp {
  occurrenceAt: string;
  recordedAt: string;
}

export interface SchedulerRuntimeState {
  schemaVersion: 1;
  alias: string;
  isActive: boolean;
  lastActivatedAt?: string;
  lastDeactivatedAt?: string;
  pendingColdStartCatchUps?: Record<string, PendingColdStartCatchUp>;
}

function normalizeIsoString(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return undefined;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : new Date(parsed).toISOString();
}

function normalizePendingColdStartCatchUps(value: unknown): Record<string, PendingColdStartCatchUp> | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const entries = Object.entries(value as Record<string, unknown>);
  const normalized = entries.reduce<Record<string, PendingColdStartCatchUp>>((accumulator, [jobId, entry]) => {
    if (!entry || typeof entry !== 'object') {
      return accumulator;
    }

    const occurrenceAt = normalizeIsoString((entry as PendingColdStartCatchUp).occurrenceAt);
    const recordedAt = normalizeIsoString((entry as PendingColdStartCatchUp).recordedAt);
    if (!occurrenceAt || !recordedAt) {
      return accumulator;
    }

    accumulator[jobId] = {
      occurrenceAt,
      recordedAt,
    };
    return accumulator;
  }, {});

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function normalizeRuntimeState(alias: string, input: unknown): SchedulerRuntimeState {
  const value = input && typeof input === 'object' ? input as Partial<SchedulerRuntimeState> : {};

  return {
    schemaVersion: 1,
    alias,
    isActive: value.isActive === true,
    lastActivatedAt: normalizeIsoString(value.lastActivatedAt),
    lastDeactivatedAt: normalizeIsoString(value.lastDeactivatedAt),
    pendingColdStartCatchUps: normalizePendingColdStartCatchUps(value.pendingColdStartCatchUps),
  };
}

export class SchedulerRuntimeStateStore {
  private static instance: SchedulerRuntimeStateStore;
  private readonly writeLocks: Map<string, Promise<void>> = new Map();

  static getInstance(): SchedulerRuntimeStateStore {
    if (!SchedulerRuntimeStateStore.instance) {
      SchedulerRuntimeStateStore.instance = new SchedulerRuntimeStateStore();
    }
    return SchedulerRuntimeStateStore.instance;
  }

  private async getStateFilePath(alias: string): Promise<string> {
    const schedulesRoot = await scheduleSettingsManager.ensureSchedulesDir(alias);
    return path.join(schedulesRoot, 'runtime-state.json');
  }

  private async readStateFile(alias: string): Promise<SchedulerRuntimeState> {
    const filePath = await this.getStateFilePath(alias);
    if (!fs.existsSync(filePath)) {
      return normalizeRuntimeState(alias, null);
    }

    const content = await fs.promises.readFile(filePath, 'utf-8');
    if (!content.trim()) {
      return normalizeRuntimeState(alias, null);
    }

    return normalizeRuntimeState(alias, JSON.parse(content));
  }

  private async writeStateFile(alias: string, state: SchedulerRuntimeState): Promise<void> {
    const filePath = await this.getStateFilePath(alias);
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    const content = JSON.stringify(state, null, 2);

    try {
      await fs.promises.writeFile(tempPath, content, 'utf-8');
      await fs.promises.rename(tempPath, filePath);
    } finally {
      if (fs.existsSync(tempPath)) {
        await fs.promises.unlink(tempPath).catch(() => undefined);
      }
    }
  }

  private async withAliasLock<T>(alias: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.writeLocks.get(alias) || Promise.resolve();

    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });

    this.writeLocks.set(alias, previous.then(() => current, () => current));
    await previous;

    try {
      return await operation();
    } finally {
      release();
      if (this.writeLocks.get(alias) === current) {
        this.writeLocks.delete(alias);
      }
    }
  }

  async readState(alias: string): Promise<SchedulerRuntimeState> {
    return this.withAliasLock(alias, async () => this.readStateFile(alias));
  }

  async markActivated(alias: string, activatedAt: string): Promise<SchedulerRuntimeState> {
    return this.withAliasLock(alias, async () => {
      const current = await this.readStateFile(alias);
      const nextState: SchedulerRuntimeState = {
        ...current,
        isActive: true,
        lastActivatedAt: normalizeIsoString(activatedAt) || current.lastActivatedAt,
      };
      await this.writeStateFile(alias, nextState);
      return nextState;
    });
  }

  async markDeactivated(alias: string, deactivatedAt: string): Promise<SchedulerRuntimeState> {
    return this.withAliasLock(alias, async () => {
      const current = await this.readStateFile(alias);
      const nextState: SchedulerRuntimeState = {
        ...current,
        isActive: false,
        lastDeactivatedAt: normalizeIsoString(deactivatedAt) || current.lastDeactivatedAt,
      };
      await this.writeStateFile(alias, nextState);
      return nextState;
    });
  }

  async markPendingColdStartCatchUp(
    alias: string,
    jobId: string,
    occurrenceAt: string,
    recordedAt: string,
  ): Promise<SchedulerRuntimeState> {
    return this.withAliasLock(alias, async () => {
      const current = await this.readStateFile(alias);
      const nextState: SchedulerRuntimeState = {
        ...current,
        pendingColdStartCatchUps: {
          ...(current.pendingColdStartCatchUps || {}),
          [jobId]: {
            occurrenceAt: normalizeIsoString(occurrenceAt) || occurrenceAt,
            recordedAt: normalizeIsoString(recordedAt) || recordedAt,
          },
        },
      };
      await this.writeStateFile(alias, nextState);
      return nextState;
    });
  }

  async clearPendingColdStartCatchUp(alias: string, jobId: string): Promise<SchedulerRuntimeState> {
    return this.withAliasLock(alias, async () => {
      const current = await this.readStateFile(alias);
      if (!current.pendingColdStartCatchUps?.[jobId]) {
        return current;
      }

      const pendingColdStartCatchUps = { ...current.pendingColdStartCatchUps };
      delete pendingColdStartCatchUps[jobId];

      const nextState: SchedulerRuntimeState = {
        ...current,
        pendingColdStartCatchUps: Object.keys(pendingColdStartCatchUps).length > 0
          ? pendingColdStartCatchUps
          : undefined,
      };
      await this.writeStateFile(alias, nextState);
      return nextState;
    });
  }
}

export const schedulerRuntimeStateStore = SchedulerRuntimeStateStore.getInstance();