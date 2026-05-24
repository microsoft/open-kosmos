/* eslint-disable @typescript-eslint/no-unsafe-function-type */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { FlowV3 } from '@/entrypoints/background/record-replay-v3/domain/flow';
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

describe('V3 RPC Flow CRUD APIs', () => {
  let storage: ReturnType<typeof createMockStorage>;
  let events: EventsBus;
  let scheduler: RunScheduler;
  let server: RpcServer;
  let fixedNow: number;

  beforeEach(() => {
    storage = createMockStorage();
    events = createMockEventsBus();
    scheduler = createMockScheduler();
    fixedNow = 1_700_000_000_000;

    server = new RpcServer({
      storage,
      events,
      scheduler,
      now: () => fixedNow,
    });
  });

  describe('rr_v3.saveFlow', () => {
    it('saves a new flow with all required fields', async () => {
      const flowInput = {
        name: 'My New Flow',
        entryNodeId: 'node-1',
        nodes: [
          { id: 'node-1', kind: 'click', config: { selector: '#btn' } },
          { id: 'node-2', kind: 'delay', config: { ms: 1000 } },
        ],
        edges: [{ id: 'e1', from: 'node-1', to: 'node-2' }],
      };

      const result = (await (server as unknown as { handleRequest: Function }).handleRequest(
        { method: 'rr_v3.saveFlow', params: { flow: flowInput }, requestId: 'req-1' },
        { subscriptions: new Set() },
      )) as FlowV3;

      expect(storage.flows.save).toHaveBeenCalledTimes(1);
      expect(result.schemaVersion).toBe(3);
      expect(result.id).toMatch(/^flow_\d+_[a-z0-9]+$/);
      expect(result.name).toBe('My New Flow');
      expect(result.entryNodeId).toBe('node-1');
      expect(result.nodes).toHaveLength(2);
      expect(result.edges).toHaveLength(1);
      expect(result.createdAt).toBeDefined();
      expect(result.updatedAt).toBeDefined();
    });

    it('updates an existing flow', async () => {
      const existing = createTestFlow('flow-1');
      const pastDate = new Date(Date.now() - 100000).toISOString();
      existing.createdAt = pastDate;
      existing.updatedAt = pastDate;
      getInternal(storage).flowsMap.set(existing.id, existing);

      const flowInput = {
        id: 'flow-1',
        name: 'Updated Flow',
        entryNodeId: 'node-start',
        nodes: [{ id: 'node-start', kind: 'navigate', config: { url: 'https://example.com' } }],
        edges: [],
        createdAt: existing.createdAt,
      };

      const result = (await (server as unknown as { handleRequest: Function }).handleRequest(
        { method: 'rr_v3.saveFlow', params: { flow: flowInput }, requestId: 'req-1' },
        { subscriptions: new Set() },
      )) as FlowV3;

      expect(result.id).toBe('flow-1');
      expect(result.name).toBe('Updated Flow');
      expect(result.createdAt).toBe(existing.createdAt);
      expect(result.updatedAt).not.toBe(existing.updatedAt);
    });

    it('preserves createdAt when updating without providing it', async () => {
      const existing = createTestFlow('flow-1');
      const pastDate = new Date(Date.now() - 100000).toISOString();
      existing.createdAt = pastDate;
      existing.updatedAt = pastDate;
      getInternal(storage).flowsMap.set(existing.id, existing);

      const flowInput = {
        id: 'flow-1',
        name: 'Updated Without CreatedAt',
        entryNodeId: 'node-start',
        nodes: [{ id: 'node-start', kind: 'test', config: {} }],
        edges: [],
      };

      const result = (await (server as unknown as { handleRequest: Function }).handleRequest(
        { method: 'rr_v3.saveFlow', params: { flow: flowInput }, requestId: 'req-1' },
        { subscriptions: new Set() },
      )) as FlowV3;

      expect(result.createdAt).toBe(existing.createdAt);
      expect(result.updatedAt).not.toBe(existing.updatedAt);
    });

    it('throws if flow is missing', async () => {
      await expect(
        (server as unknown as { handleRequest: Function }).handleRequest(
          { method: 'rr_v3.saveFlow', params: {}, requestId: 'req-1' },
          { subscriptions: new Set() },
        ),
      ).rejects.toThrow('flow is required');
    });

    it('throws if name is missing', async () => {
      await expect(
        (server as unknown as { handleRequest: Function }).handleRequest(
          {
            method: 'rr_v3.saveFlow',
            params: {
              flow: {
                entryNodeId: 'node-1',
                nodes: [{ id: 'node-1', kind: 'test', config: {} }],
              },
            },
            requestId: 'req-1',
          },
          { subscriptions: new Set() },
        ),
      ).rejects.toThrow('flow.name is required');
    });

    it('throws if entryNodeId is missing', async () => {
      await expect(
        (server as unknown as { handleRequest: Function }).handleRequest(
          {
            method: 'rr_v3.saveFlow',
            params: {
              flow: {
                name: 'Test',
                nodes: [{ id: 'node-1', kind: 'test', config: {} }],
              },
            },
            requestId: 'req-1',
          },
          { subscriptions: new Set() },
        ),
      ).rejects.toThrow('flow.entryNodeId is required');
    });

    it('throws if entryNodeId does not exist in nodes', async () => {
      await expect(
        (server as unknown as { handleRequest: Function }).handleRequest(
          {
            method: 'rr_v3.saveFlow',
            params: {
              flow: {
                name: 'Test',
                entryNodeId: 'non-existent',
                nodes: [{ id: 'node-1', kind: 'test', config: {} }],
              },
            },
            requestId: 'req-1',
          },
          { subscriptions: new Set() },
        ),
      ).rejects.toThrow('Entry node "non-existent" does not exist in flow');
    });

    it('throws if edge references non-existent source node', async () => {
      await expect(
        (server as unknown as { handleRequest: Function }).handleRequest(
          {
            method: 'rr_v3.saveFlow',
            params: {
              flow: {
                name: 'Test',
                entryNodeId: 'node-1',
                nodes: [{ id: 'node-1', kind: 'test', config: {} }],
                edges: [{ id: 'e1', from: 'non-existent', to: 'node-1' }],
              },
            },
            requestId: 'req-1',
          },
          { subscriptions: new Set() },
        ),
      ).rejects.toThrow('Edge "e1" references non-existent source node "non-existent"');
    });

    it('throws if edge references non-existent target node', async () => {
      await expect(
        (server as unknown as { handleRequest: Function }).handleRequest(
          {
            method: 'rr_v3.saveFlow',
            params: {
              flow: {
                name: 'Test',
                entryNodeId: 'node-1',
                nodes: [{ id: 'node-1', kind: 'test', config: {} }],
                edges: [{ id: 'e1', from: 'node-1', to: 'non-existent' }],
              },
            },
            requestId: 'req-1',
          },
          { subscriptions: new Set() },
        ),
      ).rejects.toThrow('Edge "e1" references non-existent target node "non-existent"');
    });

    it('validates node structure', async () => {
      await expect(
        (server as unknown as { handleRequest: Function }).handleRequest(
          {
            method: 'rr_v3.saveFlow',
            params: {
              flow: {
                name: 'Test',
                entryNodeId: 'node-1',
                nodes: [{ id: 'node-1' }],
              },
            },
            requestId: 'req-1',
          },
          { subscriptions: new Set() },
        ),
      ).rejects.toThrow('flow.nodes[0].kind is required');
    });

    it('generates edge ID if not provided', async () => {
      const result = (await (server as unknown as { handleRequest: Function }).handleRequest(
        {
          method: 'rr_v3.saveFlow',
          params: {
            flow: {
              name: 'Test',
              entryNodeId: 'node-1',
              nodes: [
                { id: 'node-1', kind: 'test', config: {} },
                { id: 'node-2', kind: 'test', config: {} },
              ],
              edges: [{ from: 'node-1', to: 'node-2' }],
            },
          },
          requestId: 'req-1',
        },
        { subscriptions: new Set() },
      )) as FlowV3;

      expect(result.edges[0].id).toMatch(/^edge_0_[a-z0-9]+$/);
    });

    it('saves flow with optional fields', async () => {
      const result = (await (server as unknown as { handleRequest: Function }).handleRequest(
        {
          method: 'rr_v3.saveFlow',
          params: {
            flow: {
              name: 'Test',
              description: 'A test flow',
              entryNodeId: 'node-1',
              nodes: [
                { id: 'node-1', kind: 'test', config: {}, name: 'Start Node', disabled: false },
              ],
              edges: [],
              variables: [
                { name: 'url', description: 'Target URL', default: 'https://example.com' },
              ],
              policy: { runTimeoutMs: 30000, defaultNodePolicy: { onError: { kind: 'stop' } } },
              meta: { tags: ['test', 'demo'] },
            },
          },
          requestId: 'req-1',
        },
        { subscriptions: new Set() },
      )) as FlowV3;

      expect(result.description).toBe('A test flow');
      expect(result.variables).toHaveLength(1);
      expect(result.policy).toEqual({
        runTimeoutMs: 30000,
        defaultNodePolicy: { onError: { kind: 'stop' } },
      });
      expect(result.meta).toEqual({ tags: ['test', 'demo'] });
      expect(result.nodes[0].name).toBe('Start Node');
    });

    it('throws if variable is missing name', async () => {
      await expect(
        (server as unknown as { handleRequest: Function }).handleRequest(
          {
            method: 'rr_v3.saveFlow',
            params: {
              flow: {
                name: 'Test',
                entryNodeId: 'node-1',
                nodes: [{ id: 'node-1', kind: 'test', config: {} }],
                variables: [{ description: 'Missing name field' }],
              },
            },
            requestId: 'req-1',
          },
          { subscriptions: new Set() },
        ),
      ).rejects.toThrow('flow.variables[0].name is required');
    });

    it('throws if duplicate variable names', async () => {
      await expect(
        (server as unknown as { handleRequest: Function }).handleRequest(
          {
            method: 'rr_v3.saveFlow',
            params: {
              flow: {
                name: 'Test',
                entryNodeId: 'node-1',
                nodes: [{ id: 'node-1', kind: 'test', config: {} }],
                variables: [{ name: 'myVar' }, { name: 'myVar' }],
              },
            },
            requestId: 'req-1',
          },
          { subscriptions: new Set() },
        ),
      ).rejects.toThrow('Duplicate variable name: "myVar"');
    });

    it('throws if duplicate node IDs', async () => {
      await expect(
        (server as unknown as { handleRequest: Function }).handleRequest(
          {
            method: 'rr_v3.saveFlow',
            params: {
              flow: {
                name: 'Test',
                entryNodeId: 'node-1',
                nodes: [
                  { id: 'node-1', kind: 'test', config: {} },
                  { id: 'node-1', kind: 'test', config: {} },
                ],
              },
            },
            requestId: 'req-1',
          },
          { subscriptions: new Set() },
        ),
      ).rejects.toThrow('Duplicate node ID: "node-1"');
    });

    it('throws if duplicate edge IDs', async () => {
      await expect(
        (server as unknown as { handleRequest: Function }).handleRequest(
          {
            method: 'rr_v3.saveFlow',
            params: {
              flow: {
                name: 'Test',
                entryNodeId: 'node-1',
                nodes: [
                  { id: 'node-1', kind: 'test', config: {} },
                  { id: 'node-2', kind: 'test', config: {} },
                ],
                edges: [
                  { id: 'e1', from: 'node-1', to: 'node-2' },
                  { id: 'e1', from: 'node-2', to: 'node-1' },
                ],
              },
            },
            requestId: 'req-1',
          },
          { subscriptions: new Set() },
        ),
      ).rejects.toThrow('Duplicate edge ID: "e1"');
    });
  });

  describe('rr_v3.deleteFlow', () => {
    it('deletes an existing flow', async () => {
      const flow = createTestFlow('flow-1');
      getInternal(storage).flowsMap.set(flow.id, flow);

      const result = await (server as unknown as { handleRequest: Function }).handleRequest(
        { method: 'rr_v3.deleteFlow', params: { flowId: 'flow-1' }, requestId: 'req-1' },
        { subscriptions: new Set() },
      );

      expect(storage.flows.delete).toHaveBeenCalledWith('flow-1');
      expect(result).toEqual({ ok: true, flowId: 'flow-1' });
    });

    it('throws if flowId is missing', async () => {
      await expect(
        (server as unknown as { handleRequest: Function }).handleRequest(
          { method: 'rr_v3.deleteFlow', params: {}, requestId: 'req-1' },
          { subscriptions: new Set() },
        ),
      ).rejects.toThrow('flowId is required');
    });

    it('throws if flow does not exist', async () => {
      await expect(
        (server as unknown as { handleRequest: Function }).handleRequest(
          { method: 'rr_v3.deleteFlow', params: { flowId: 'non-existent' }, requestId: 'req-1' },
          { subscriptions: new Set() },
        ),
      ).rejects.toThrow('Flow "non-existent" not found');
    });

    it('throws if flow has linked triggers', async () => {
      const flow = createTestFlow('flow-1');
      getInternal(storage).flowsMap.set(flow.id, flow);
      (storage.triggers.list as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: 'trigger-1', kind: 'manual', flowId: 'flow-1', enabled: true },
      ]);

      await expect(
        (server as unknown as { handleRequest: Function }).handleRequest(
          { method: 'rr_v3.deleteFlow', params: { flowId: 'flow-1' }, requestId: 'req-1' },
          { subscriptions: new Set() },
        ),
      ).rejects.toThrow('Cannot delete flow "flow-1": it has 1 linked trigger(s): trigger-1');
    });

    it('throws if flow has multiple linked triggers', async () => {
      const flow = createTestFlow('flow-1');
      getInternal(storage).flowsMap.set(flow.id, flow);

      (storage.triggers.list as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: 'trigger-1', kind: 'manual', flowId: 'flow-1', enabled: true },
        { id: 'trigger-2', kind: 'cron', flowId: 'flow-1', enabled: true, cron: '0 * * * *' },
      ]);

      await expect(
        (server as unknown as { handleRequest: Function }).handleRequest(
          { method: 'rr_v3.deleteFlow', params: { flowId: 'flow-1' }, requestId: 'req-1' },
          { subscriptions: new Set() },
        ),
      ).rejects.toThrow(
        'Cannot delete flow "flow-1": it has 2 linked trigger(s): trigger-1, trigger-2',
      );
    });

    it('throws if flow has queued runs', async () => {
      const flow = createTestFlow('flow-1');
      getInternal(storage).flowsMap.set(flow.id, flow);
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

      await expect(
        (server as unknown as { handleRequest: Function }).handleRequest(
          { method: 'rr_v3.deleteFlow', params: { flowId: 'flow-1' }, requestId: 'req-1' },
          { subscriptions: new Set() },
        ),
      ).rejects.toThrow('Cannot delete flow "flow-1": it has 1 queued run(s): run-1');
    });

    it('allows deletion when runs are running (not queued)', async () => {
      const flow = createTestFlow('flow-1');
      getInternal(storage).flowsMap.set(flow.id, flow);
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

      const result = await (server as unknown as { handleRequest: Function }).handleRequest(
        { method: 'rr_v3.deleteFlow', params: { flowId: 'flow-1' }, requestId: 'req-1' },
        { subscriptions: new Set() },
      );

      expect(result).toEqual({ ok: true, flowId: 'flow-1' });
    });
  });

  describe('rr_v3.getFlow', () => {
    it('returns flow by id', async () => {
      const flow = createTestFlow('flow-1');
      getInternal(storage).flowsMap.set(flow.id, flow);

      const result = await (server as unknown as { handleRequest: Function }).handleRequest(
        { method: 'rr_v3.getFlow', params: { flowId: 'flow-1' }, requestId: 'req-1' },
        { subscriptions: new Set() },
      );

      expect(result).toEqual(flow);
    });

    it('returns null for non-existent flow', async () => {
      const result = await (server as unknown as { handleRequest: Function }).handleRequest(
        { method: 'rr_v3.getFlow', params: { flowId: 'non-existent' }, requestId: 'req-1' },
        { subscriptions: new Set() },
      );

      expect(result).toBeNull();
    });

    it('throws if flowId is missing', async () => {
      await expect(
        (server as unknown as { handleRequest: Function }).handleRequest(
          { method: 'rr_v3.getFlow', params: {}, requestId: 'req-1' },
          { subscriptions: new Set() },
        ),
      ).rejects.toThrow('flowId is required');
    });
  });

  describe('rr_v3.listFlows', () => {
    it('returns all flows', async () => {
      const flow1 = createTestFlow('flow-1');
      const flow2 = createTestFlow('flow-2');
      getInternal(storage).flowsMap.set(flow1.id, flow1);
      getInternal(storage).flowsMap.set(flow2.id, flow2);

      const result = (await (server as unknown as { handleRequest: Function }).handleRequest(
        { method: 'rr_v3.listFlows', params: {}, requestId: 'req-1' },
        { subscriptions: new Set() },
      )) as FlowV3[];

      expect(result).toHaveLength(2);
      expect(result.map((flow) => flow.id).sort()).toEqual(['flow-1', 'flow-2']);
    });

    it('returns empty array when no flows exist', async () => {
      const result = await (server as unknown as { handleRequest: Function }).handleRequest(
        { method: 'rr_v3.listFlows', params: {}, requestId: 'req-1' },
        { subscriptions: new Set() },
      );

      expect(result).toEqual([]);
    });
  });
});