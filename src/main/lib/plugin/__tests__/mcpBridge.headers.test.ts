/**
 * Tests for `resolveConfig` header substitution behavior in `mcpBridge.ts`.
 *
 * Focus: a header value whose `${VAR}` placeholder cannot be resolved
 * (env var missing, no default supplied) must be dropped so the server
 * receives a clean request and can return a proper 401 + WWW-Authenticate,
 * letting the OAuth retry layer take over. Sending the literal
 * `Bearer ${GITHUB_PERSONAL_ACCESS_TOKEN}` would make the server reject
 * with 400 ("Authorization header is badly formatted") — which our auth
 * retry only matches on 401/403.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../unifiedLogger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

vi.mock('../../mcpRuntime/mcpClientManager', () => ({
  mcpClientManager: { add: vi.fn(), delete: vi.fn() },
}));

import { injectPluginMcpServers } from '../bridges/mcpBridge';
import { mcpClientManager } from '../../mcpRuntime/mcpClientManager';
import type { LoadedPlugin } from '../types';

const addMock = mcpClientManager.add as ReturnType<typeof vi.fn>;

function makePlugin(mcpServers: Record<string, any>): LoadedPlugin {
  return {
    id: 'github',
    path: '/tmp/plugins/github',
    enabled: true,
    manifest: {
      name: 'github',
      version: '1.0.0',
      mcpServers,
    } as any,
    skills: [],
    commands: [],
    agents: [],
    hooks: [],
    injectedMcpServers: [],
  } as unknown as LoadedPlugin;
}

beforeEach(() => {
  addMock.mockReset();
  delete process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
});

afterEach(() => {
  delete process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
});

describe('mcpBridge header substitution', () => {
  it('keeps headers whose ${VAR} resolves from process.env', async () => {
    process.env.GITHUB_PERSONAL_ACCESS_TOKEN = 'ghp_real_token';

    const plugin = makePlugin({
      github: {
        type: 'http',
        url: 'https://api.githubcopilot.com/mcp/',
        headers: { Authorization: 'Bearer ${GITHUB_PERSONAL_ACCESS_TOKEN}' },
      },
    });

    await injectPluginMcpServers(plugin);

    expect(addMock).toHaveBeenCalledTimes(1);
    const fullConfig = addMock.mock.calls[0][1];
    expect(fullConfig.headers).toEqual({ Authorization: 'Bearer ghp_real_token' });
  });

  it('DROPS headers whose ${VAR} cannot be resolved (env var missing)', async () => {
    // No process.env.GITHUB_PERSONAL_ACCESS_TOKEN set in this test.

    const plugin = makePlugin({
      github: {
        type: 'http',
        url: 'https://api.githubcopilot.com/mcp/',
        headers: { Authorization: 'Bearer ${GITHUB_PERSONAL_ACCESS_TOKEN}' },
      },
    });

    await injectPluginMcpServers(plugin);

    expect(addMock).toHaveBeenCalledTimes(1);
    const fullConfig = addMock.mock.calls[0][1];
    // Authorization header MUST NOT contain the literal `${...}` placeholder.
    expect(fullConfig.headers).toEqual({});
  });

  it('keeps a header whose value is fully substituted, drops a sibling that is not', async () => {
    process.env.MY_GOOD_HEADER = 'good-value';
    // MY_BAD_HEADER intentionally not set

    const plugin = makePlugin({
      remote: {
        type: 'http',
        url: 'https://api.example.com/mcp/',
        headers: {
          'X-Good': 'value=${MY_GOOD_HEADER}',
          'X-Bad': 'value=${MY_BAD_HEADER}',
          'X-Static': 'no-vars',
        },
      },
    });

    await injectPluginMcpServers(plugin);

    const fullConfig = addMock.mock.calls[0][1];
    expect(fullConfig.headers).toEqual({
      'X-Good': 'value=good-value',
      'X-Static': 'no-vars',
    });

    delete process.env.MY_GOOD_HEADER;
  });

  it('honors ${VAR:-default} fallback even when the env var is missing', async () => {
    // No env var; default value should be used; the resulting header is kept.
    const plugin = makePlugin({
      github: {
        type: 'http',
        url: 'https://api.example.com/',
        headers: { 'X-Region': '${UNSET_REGION:-us-east-1}' },
      },
    });

    await injectPluginMcpServers(plugin);

    const fullConfig = addMock.mock.calls[0][1];
    expect(fullConfig.headers).toEqual({ 'X-Region': 'us-east-1' });
  });
});
