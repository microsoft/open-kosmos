/* eslint-disable @typescript-eslint/no-unsafe-function-type */
import { vi } from 'vitest';

import type { FlowV3 } from '@/entrypoints/background/record-replay-v3/domain/flow';
import type { RunRecordV3 } from '@/entrypoints/background/record-replay-v3/domain/events';
import type { StoragePort } from '@/entrypoints/background/record-replay-v3/engine/storage/storage-port';
import type { EventsBus } from '@/entrypoints/background/record-replay-v3/engine/transport/events-bus';
import type { RunScheduler } from '@/entrypoints/background/record-replay-v3/engine/queue/scheduler';
import type { RunQueueItem } from '@/entrypoints/background/record-replay-v3/engine/queue/queue';

export function createMockStorage(): StoragePort {
  const flowsMap = new Map<string, FlowV3>();
  const runsMap = new Map<string, RunRecordV3>();
  const queueMap = new Map<string, RunQueueItem>();
  const eventsLog: Array<{ runId: string; type: string }> = [];

  return {
    flows: {
      list: vi.fn(async () => Array.from(flowsMap.values())),
      get: vi.fn(async (id: string) => flowsMap.get(id) ?? null),
      save: vi.fn(async (flow: FlowV3) => {
        flowsMap.set(flow.id, flow);
      }),
      delete: vi.fn(async (id: string) => {
        flowsMap.delete(id);
      }),
    },
    runs: {
      list: vi.fn(async () => Array.from(runsMap.values())),
      get: vi.fn(async (id: string) => runsMap.get(id) ?? null),
      save: vi.fn(async (record: RunRecordV3) => {
        runsMap.set(record.id, record);
      }),
      patch: vi.fn(async (id: string, patch: Partial<RunRecordV3>) => {
        const existing = runsMap.get(id);
        if (existing) {
          runsMap.set(id, { ...existing, ...patch });
        }
      }),
    },
    events: {
      append: vi.fn(async (event: { runId: string; type: string }) => {
        eventsLog.push(event);
        return { ...event, ts: Date.now(), seq: eventsLog.length };
      }),
      list: vi.fn(async () => eventsLog),
    },
    queue: {
      enqueue: vi.fn(async (input) => {
        const now = Date.now();
        const item: RunQueueItem = {
          ...input,
          priority: input.priority ?? 0,
          maxAttempts: input.maxAttempts ?? 1,
          status: 'queued',
          createdAt: now,
          updatedAt: now,
          attempt: 0,
        };
        queueMap.set(input.id, item);
        return item;
      }),
      claimNext: vi.fn(async () => null),
      heartbeat: vi.fn(async () => {}),
      reclaimExpiredLeases: vi.fn(async () => []),
      markRunning: vi.fn(async () => {}),
      markPaused: vi.fn(async () => {}),
      markDone: vi.fn(async () => {}),
      cancel: vi.fn(async (runId: string) => {
        queueMap.delete(runId);
      }),
      get: vi.fn(async (runId: string) => queueMap.get(runId) ?? null),
      list: vi.fn(async (status?: string) => {
        const items = Array.from(queueMap.values());
        if (status) {
          return items.filter((item) => item.status === status);
        }
        return items;
      }),
    },
    persistentVars: {
      get: vi.fn(async () => undefined),
      set: vi.fn(async () => ({ key: '', value: null, updatedAt: 0 })),
      delete: vi.fn(async () => {}),
      list: vi.fn(async () => []),
    },
    triggers: {
      list: vi.fn(async () => []),
      get: vi.fn(async () => null),
      save: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
    },
    _internal: { flowsMap, runsMap, queueMap, eventsLog },
  } as unknown as StoragePort & {
    _internal: {
      flowsMap: Map<string, FlowV3>;
      runsMap: Map<string, RunRecordV3>;
      queueMap: Map<string, RunQueueItem>;
      eventsLog: Array<{ runId: string; type: string }>;
    };
  };
}

export function createMockEventsBus(): EventsBus {
  const subscribers: Array<(event: unknown) => void> = [];
  return {
    subscribe: vi.fn((callback: (event: unknown) => void) => {
      subscribers.push(callback);
      return () => {
        const idx = subscribers.indexOf(callback);
        if (idx >= 0) subscribers.splice(idx, 1);
      };
    }),
    append: vi.fn(async (event) => {
      const fullEvent = { ...event, ts: Date.now(), seq: 1 };
      subscribers.forEach((callback) => callback(fullEvent));
      return fullEvent as ReturnType<EventsBus['append']> extends Promise<infer T> ? T : never;
    }),
    list: vi.fn(async () => []),
  } as EventsBus;
}

export function createMockScheduler(): RunScheduler {
  return {
    start: vi.fn(),
    stop: vi.fn(),
    kick: vi.fn(async () => {}),
    getState: vi.fn(() => ({
      started: false,
      ownerId: 'test-owner',
      maxParallelRuns: 3,
      activeRunIds: [],
    })),
    dispose: vi.fn(),
  };
}

export function createTestFlow(id: string, options: { withNodes?: boolean } = {}): FlowV3 {
  const now = new Date().toISOString();
  const nodes =
    options.withNodes !== false
      ? [
          { id: 'node-start', kind: 'test', config: {} },
          { id: 'node-end', kind: 'test', config: {} },
        ]
      : [];
  return {
    schemaVersion: 3,
    id: id as FlowV3['id'],
    name: `Test Flow ${id}`,
    entryNodeId: 'node-start' as FlowV3['entryNodeId'],
    nodes: nodes as FlowV3['nodes'],
    edges: [{ id: 'edge-1', from: 'node-start', to: 'node-end' }] as FlowV3['edges'],
    variables: [],
    createdAt: now,
    updatedAt: now,
  };
}

export interface MockStorageInternal {
  flowsMap: Map<string, FlowV3>;
  runsMap: Map<string, RunRecordV3>;
  queueMap: Map<string, RunQueueItem>;
  eventsLog: Array<{ runId: string; type: string }>;
}

export function getInternal(storage: StoragePort): MockStorageInternal {
  return (storage as unknown as { _internal: MockStorageInternal })._internal;
}