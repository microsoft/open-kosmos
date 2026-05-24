/* eslint-disable @typescript-eslint/no-unsafe-function-type */
/**
 * @fileoverview Record-Replay V3 RPC API Tests
 * @description
 * Tests for the queue management RPC APIs:
 * - rr_v3.enqueueRun
 * - rr_v3.listQueue
 * - rr_v3.cancelQueueItem
 *
 * Tests for Flow CRUD RPC APIs:
 * - rr_v3.saveFlow
 * - rr_v3.deleteFlow
 */

import { beforeEach, describe, expect, it } from 'vitest';

import type { EventsBus } from '@/entrypoints/background/record-replay-v3/engine/transport/events-bus';
import type { RunScheduler } from '@/entrypoints/background/record-replay-v3/engine/queue/scheduler';
import { RpcServer } from '@/entrypoints/background/record-replay-v3/engine/transport/rpc-server';
import {
  createMockEventsBus,
  createMockScheduler,
  createMockStorage,
  createTestFlow,
  getInternal,
} from './rpc-api-test-helpers';

// ==================== Tests ====================

describe('V3 RPC Queue Management APIs', () => {
  let storage: ReturnType<typeof createMockStorage>;
  let events: EventsBus;
  let scheduler: RunScheduler;
  let server: RpcServer;
  let runIdCounter: number;
  let fixedNow: number;

  beforeEach(() => {
    storage = createMockStorage();
    events = createMockEventsBus();
    scheduler = createMockScheduler();
    runIdCounter = 0;
    fixedNow = 1_700_000_000_000;

    server = new RpcServer({
      storage,
      events,
      scheduler,
      generateRunId: () => `run-${++runIdCounter}`,
      now: () => fixedNow,
    });
  });

  describe('rr_v3.enqueueRun', () => {
    it('creates run record, enqueues, emits event, and kicks scheduler', async () => {
      // Setup: add a flow
      const flow = createTestFlow('flow-1');
      getInternal(storage).flowsMap.set(flow.id, flow);

      // Act: call enqueueRun via handleRequest
      const result = await (server as unknown as { handleRequest: Function }).handleRequest(
        { method: 'rr_v3.enqueueRun', params: { flowId: 'flow-1' }, requestId: 'req-1' },
        { subscriptions: new Set() },
      );

      // Assert: run record created
      expect(storage.runs.save).toHaveBeenCalledTimes(1);
      const savedRun = (storage.runs.save as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(savedRun).toMatchObject({
        id: 'run-1',
        flowId: 'flow-1',
        status: 'queued',
        attempt: 0,
        maxAttempts: 1,
      });

      // Assert: enqueued
      expect(storage.queue.enqueue).toHaveBeenCalledTimes(1);

      // Assert: event emitted via EventsBus
      expect(events.append).toHaveBeenCalledWith(
        expect.objectContaining({
          runId: 'run-1',
          type: 'run.queued',
          flowId: 'flow-1',
        }),
      );

      // Assert: scheduler kicked
      expect(scheduler.kick).toHaveBeenCalledTimes(1);

      // Assert: result
      expect(result).toMatchObject({
        runId: 'run-1',
        position: 1,
      });
    });

    it('throws if flowId is missing', async () => {
      await expect(
        (server as unknown as { handleRequest: Function }).handleRequest(
          { method: 'rr_v3.enqueueRun', params: {}, requestId: 'req-1' },
          { subscriptions: new Set() },
        ),
      ).rejects.toThrow('flowId is required');
    });

    it('throws if flow does not exist', async () => {
      await expect(
        (server as unknown as { handleRequest: Function }).handleRequest(
          { method: 'rr_v3.enqueueRun', params: { flowId: 'non-existent' }, requestId: 'req-1' },
          { subscriptions: new Set() },
        ),
      ).rejects.toThrow('Flow "non-existent" not found');
    });

    it('respects custom priority and maxAttempts', async () => {
      const flow = createTestFlow('flow-1');
      getInternal(storage).flowsMap.set(flow.id, flow);

      await (server as unknown as { handleRequest: Function }).handleRequest(
        {
          method: 'rr_v3.enqueueRun',
          params: { flowId: 'flow-1', priority: 10, maxAttempts: 3 },
          requestId: 'req-1',
        },
        { subscriptions: new Set() },
      );

      expect(storage.queue.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          priority: 10,
          maxAttempts: 3,
        }),
      );
    });

    it('passes args and debug config', async () => {
      const flow = createTestFlow('flow-1');
      getInternal(storage).flowsMap.set(flow.id, flow);

      const args = { url: 'https://example.com' };
      const debug = { pauseOnStart: true, breakpoints: ['node-1'] };

      await (server as unknown as { handleRequest: Function }).handleRequest(
        {
          method: 'rr_v3.enqueueRun',
          params: { flowId: 'flow-1', args, debug },
          requestId: 'req-1',
        },
        { subscriptions: new Set() },
      );

      expect(storage.runs.save).toHaveBeenCalledWith(
        expect.objectContaining({
          args,
          debug,
        }),
      );
    });

    it('rejects NaN priority', async () => {
      const flow = createTestFlow('flow-1');
      getInternal(storage).flowsMap.set(flow.id, flow);

      await expect(
        (server as unknown as { handleRequest: Function }).handleRequest(
          {
            method: 'rr_v3.enqueueRun',
            params: { flowId: 'flow-1', priority: NaN },
            requestId: 'req-1',
          },
          { subscriptions: new Set() },
        ),
      ).rejects.toThrow('priority must be a finite number');
    });

    it('rejects Infinity maxAttempts', async () => {
      const flow = createTestFlow('flow-1');
      getInternal(storage).flowsMap.set(flow.id, flow);

      await expect(
        (server as unknown as { handleRequest: Function }).handleRequest(
          {
            method: 'rr_v3.enqueueRun',
            params: { flowId: 'flow-1', maxAttempts: Infinity },
            requestId: 'req-1',
          },
          { subscriptions: new Set() },
        ),
      ).rejects.toThrow('maxAttempts must be a finite number');
    });

    it('rejects maxAttempts < 1', async () => {
      const flow = createTestFlow('flow-1');
      getInternal(storage).flowsMap.set(flow.id, flow);

      await expect(
        (server as unknown as { handleRequest: Function }).handleRequest(
          {
            method: 'rr_v3.enqueueRun',
            params: { flowId: 'flow-1', maxAttempts: 0 },
            requestId: 'req-1',
          },
          { subscriptions: new Set() },
        ),
      ).rejects.toThrow('maxAttempts must be >= 1');
    });

    it('persists startNodeId in RunRecord when provided', async () => {
      // Setup: add a flow with multiple nodes
      const flow = createTestFlow('flow-start-node');
      getInternal(storage).flowsMap.set(flow.id, flow);

      // Act: enqueue with startNodeId
      const targetNodeId = flow.nodes[0].id; // Use the first node
      await (server as unknown as { handleRequest: Function }).handleRequest(
        {
          method: 'rr_v3.enqueueRun',
          params: { flowId: 'flow-start-node', startNodeId: targetNodeId },
          requestId: 'req-1',
        },
        { subscriptions: new Set() },
      );

      // Assert: RunRecord should have startNodeId
      const runsMap = getInternal(storage).runsMap;
      expect(runsMap.size).toBe(1);
      const runRecord = Array.from(runsMap.values())[0];
      expect(runRecord.startNodeId).toBe(targetNodeId);
    });

    it('throws if startNodeId does not exist in flow', async () => {
      // Setup: add a flow
      const flow = createTestFlow('flow-invalid-start');
      getInternal(storage).flowsMap.set(flow.id, flow);

      // Act & Assert
      await expect(
        (server as unknown as { handleRequest: Function }).handleRequest(
          {
            method: 'rr_v3.enqueueRun',
            params: { flowId: 'flow-invalid-start', startNodeId: 'non-existent-node' },
            requestId: 'req-1',
          },
          { subscriptions: new Set() },
        ),
      ).rejects.toThrow('startNodeId "non-existent-node" not found in flow');
    });
  });

  describe('rr_v3.listQueue', () => {
    it('returns all queue items sorted by priority DESC and createdAt ASC', async () => {
      // Setup: add items with different priorities and times
      getInternal(storage).queueMap.set('run-1', {
        id: 'run-1',
        flowId: 'flow-1',
        status: 'queued',
        priority: 5,
        createdAt: 1000,
        updatedAt: 1000,
        attempt: 0,
        maxAttempts: 1,
      });
      getInternal(storage).queueMap.set('run-2', {
        id: 'run-2',
        flowId: 'flow-1',
        status: 'queued',
        priority: 10,
        createdAt: 2000,
        updatedAt: 2000,
        attempt: 0,
        maxAttempts: 1,
      });
      getInternal(storage).queueMap.set('run-3', {
        id: 'run-3',
        flowId: 'flow-1',
        status: 'queued',
        priority: 10,
        createdAt: 1500,
        updatedAt: 1500,
        attempt: 0,
        maxAttempts: 1,
      });

      const result = (await (server as unknown as { handleRequest: Function }).handleRequest(
        { method: 'rr_v3.listQueue', params: {}, requestId: 'req-1' },
        { subscriptions: new Set() },
      )) as RunQueueItem[];

      // run-3 (priority 10, earlier) > run-2 (priority 10, later) > run-1 (priority 5)
      expect(result.map((r) => r.id)).toEqual(['run-3', 'run-2', 'run-1']);
    });

    it('filters by status', async () => {
      getInternal(storage).queueMap.set('run-1', {
        id: 'run-1',
        flowId: 'flow-1',
        status: 'queued',
        priority: 0,
        createdAt: 1000,
        updatedAt: 1000,
        attempt: 0,
        maxAttempts: 1,
      });
      getInternal(storage).queueMap.set('run-2', {
        id: 'run-2',
        flowId: 'flow-1',
        status: 'running',
        priority: 0,
        createdAt: 2000,
        updatedAt: 2000,
        attempt: 1,
        maxAttempts: 1,
      });

      const result = (await (server as unknown as { handleRequest: Function }).handleRequest(
        { method: 'rr_v3.listQueue', params: { status: 'queued' }, requestId: 'req-1' },
        { subscriptions: new Set() },
      )) as RunQueueItem[];

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('run-1');
    });

    it('rejects invalid status', async () => {
      await expect(
        (server as unknown as { handleRequest: Function }).handleRequest(
          { method: 'rr_v3.listQueue', params: { status: 'invalid' }, requestId: 'req-1' },
          { subscriptions: new Set() },
        ),
      ).rejects.toThrow('status must be one of: queued, running, paused');
    });
  });

  describe('rr_v3.cancelQueueItem', () => {
    it('cancels queue item, patches run, and emits event', async () => {
      // Setup
      getInternal(storage).queueMap.set('run-1', {
        id: 'run-1',
        flowId: 'flow-1',
        status: 'queued',
        priority: 0,
        createdAt: 1000,
        updatedAt: 1000,
        attempt: 0,
        maxAttempts: 1,
      });
      getInternal(storage).runsMap.set('run-1', {
        schemaVersion: 3,
        id: 'run-1',
        flowId: 'flow-1',
        status: 'queued',
        createdAt: 1000,
        updatedAt: 1000,
        attempt: 0,
        maxAttempts: 1,
        nextSeq: 0,
      });

      const result = await (server as unknown as { handleRequest: Function }).handleRequest(
        { method: 'rr_v3.cancelQueueItem', params: { runId: 'run-1' }, requestId: 'req-1' },
        { subscriptions: new Set() },
      );

      // Assert: queue.cancel called
      expect(storage.queue.cancel).toHaveBeenCalledWith('run-1', fixedNow, undefined);

      // Assert: run patched
      expect(storage.runs.patch).toHaveBeenCalledWith('run-1', {
        status: 'canceled',
        updatedAt: fixedNow,
        finishedAt: fixedNow,
      });

      // Assert: event emitted via EventsBus
      expect(events.append).toHaveBeenCalledWith(
        expect.objectContaining({
          runId: 'run-1',
          type: 'run.canceled',
        }),
      );

      // Assert: result
      expect(result).toMatchObject({ ok: true, runId: 'run-1' });
    });

    it('throws if runId is missing', async () => {
      await expect(
        (server as unknown as { handleRequest: Function }).handleRequest(
          { method: 'rr_v3.cancelQueueItem', params: {}, requestId: 'req-1' },
          { subscriptions: new Set() },
        ),
      ).rejects.toThrow('runId is required');
    });

    it('throws if queue item does not exist', async () => {
      await expect(
        (server as unknown as { handleRequest: Function }).handleRequest(
          {
            method: 'rr_v3.cancelQueueItem',
            params: { runId: 'non-existent' },
            requestId: 'req-1',
          },
          { subscriptions: new Set() },
        ),
      ).rejects.toThrow('Queue item "non-existent" not found');
    });

    it('throws if queue item is not queued', async () => {
      getInternal(storage).queueMap.set('run-1', {
        id: 'run-1',
        flowId: 'flow-1',
        status: 'running',
        priority: 0,
        createdAt: 1000,
        updatedAt: 1000,
        attempt: 1,
        maxAttempts: 1,
      });

      await expect(
        (server as unknown as { handleRequest: Function }).handleRequest(
          { method: 'rr_v3.cancelQueueItem', params: { runId: 'run-1' }, requestId: 'req-1' },
          { subscriptions: new Set() },
        ),
      ).rejects.toThrow('Cannot cancel queue item "run-1" with status "running"');
    });

    it('includes reason in cancel event', async () => {
      getInternal(storage).queueMap.set('run-1', {
        id: 'run-1',
        flowId: 'flow-1',
        status: 'queued',
        priority: 0,
        createdAt: 1000,
        updatedAt: 1000,
        attempt: 0,
        maxAttempts: 1,
      });

      await (server as unknown as { handleRequest: Function }).handleRequest(
        {
          method: 'rr_v3.cancelQueueItem',
          params: { runId: 'run-1', reason: 'User requested cancellation' },
          requestId: 'req-1',
        },
        { subscriptions: new Set() },
      );

      expect(storage.queue.cancel).toHaveBeenCalledWith(
        'run-1',
        fixedNow,
        'User requested cancellation',
      );
      expect(events.append).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: 'User requested cancellation',
        }),
      );
    });
  });
});
