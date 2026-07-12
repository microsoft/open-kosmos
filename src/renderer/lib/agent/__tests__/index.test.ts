/**
 * @vitest-environment happy-dom
 *
 * Smoke test for the agent lib barrel: ensures the public surface is exported.
 */

import { describe, it, expect } from 'vitest';

Object.defineProperty(window, 'electronAPI', {
  configurable: true,
  writable: true,
  value: { profile: { onAgentsChanged: () => () => {} } },
});

import * as agentLib from '../index';

describe('agent lib barrel', () => {
  it('re-exports the cache manager and hooks', () => {
    expect(agentLib.AgentClientCacheManager).toBeTypeOf('function');
    expect(agentLib.agentClientCacheManager).toBeDefined();
    expect(agentLib.useAgent).toBeTypeOf('function');
    expect(agentLib.useAgents).toBeTypeOf('function');
  });
});
