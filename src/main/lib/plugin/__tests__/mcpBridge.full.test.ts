/**
 * Full coverage tests for mcpBridge.ts.
 *
 * Covers: removePluginMcpServers, isPluginMcpServer, "already exists" error
 * path, generic error path, OPENKOSMOS_PLUGIN_ROOT / CLAUDE_PLUGIN_ROOT
 * substitution, stdio transport (no headers applied), and env var expansion.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../unifiedLogger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

vi.mock('../../mcpRuntime/mcpClientManager', () => ({
  mcpClientManager: { add: vi.fn(), delete: vi.fn() },
}));

import {
  injectPluginMcpServers,
  removePluginMcpServers,
  isPluginMcpServer,
} from '../bridges/mcpBridge';
import { mcpClientManager } from '../../mcpRuntime/mcpClientManager';
import type { LoadedPlugin } from '../types';

const addMock = mcpClientManager.add as ReturnType<typeof vi.fn>;
const deleteMock = mcpClientManager.delete as ReturnType<typeof vi.fn>;

function makePlugin(
  mcpServers: Record<string, any> = {},
  overrides: Partial<LoadedPlugin> = {},
): LoadedPlugin {
  return {
    id: 'test-plugin',
    path: '/tmp/plugins/test-plugin',
    enabled: true,
    manifest: {
      name: 'test-plugin',
      version: '1.0.0',
      mcpServers,
    } as any,
    skills: [],
    commands: [],
    agents: [],
    hooks: [],
    injectedMcpServers: [],
    resolvedSkillPaths: [],
    injectedSkills: [],
    ...overrides,
  } as unknown as LoadedPlugin;
}

beforeEach(() => {
  addMock.mockReset();
  deleteMock.mockReset();
  addMock.mockResolvedValue(undefined);
  deleteMock.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// isPluginMcpServer
// ---------------------------------------------------------------------------
describe('isPluginMcpServer', () => {
  it('returns true for plugin-scoped names', () => {
    expect(isPluginMcpServer('plugin--myplugin--myserver')).toBe(true);
  });

  it('returns false for user-managed server names', () => {
    expect(isPluginMcpServer('my-server')).toBe(false);
    expect(isPluginMcpServer('github')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// injectPluginMcpServers — edge cases
// ---------------------------------------------------------------------------
describe('injectPluginMcpServers — edge cases', () => {
  it('returns [] when plugin has no mcpServers', async () => {
    const plugin = makePlugin({});
    plugin.manifest.mcpServers = undefined;
    const result = await injectPluginMcpServers(plugin);
    expect(result).toEqual([]);
    expect(addMock).not.toHaveBeenCalled();
  });

  it('returns [] when mcpServers is empty object', async () => {
    const plugin = makePlugin({});
    const result = await injectPluginMcpServers(plugin);
    expect(result).toEqual([]);
  });

  it('handles "already exists" error as success', async () => {
    addMock.mockRejectedValueOnce(new Error('Server already exists'));
    const plugin = makePlugin({
      server1: { type: 'stdio', command: 'node', args: ['server.js'] },
    });
    const result = await injectPluginMcpServers(plugin);
    expect(result).toEqual(['plugin--test-plugin--server1']);
  });

  it('handles generic add errors gracefully (not included in result)', async () => {
    addMock.mockRejectedValueOnce(new Error('Connection refused'));
    const plugin = makePlugin({
      server1: { type: 'stdio', command: 'node', args: ['server.js'] },
    });
    const result = await injectPluginMcpServers(plugin);
    expect(result).toEqual([]);
  });

  it('substitutes ${OPENKOSMOS_PLUGIN_ROOT} in command', async () => {
    const plugin = makePlugin({
      server: { type: 'stdio', command: '${OPENKOSMOS_PLUGIN_ROOT}/bin/server', args: [] },
    });
    await injectPluginMcpServers(plugin);
    const config = addMock.mock.calls[0][1];
    expect(config.command).toBe('/tmp/plugins/test-plugin/bin/server');
  });

  it('substitutes ${CLAUDE_PLUGIN_ROOT} in command', async () => {
    const plugin = makePlugin({
      server: { type: 'stdio', command: '${CLAUDE_PLUGIN_ROOT}/run.js', args: [] },
    });
    await injectPluginMcpServers(plugin);
    const config = addMock.mock.calls[0][1];
    expect(config.command).toBe('/tmp/plugins/test-plugin/run.js');
  });

  it('substitutes env vars in args array', async () => {
    process.env.MY_ARG = 'hello';
    const plugin = makePlugin({
      server: {
        type: 'stdio',
        command: 'node',
        args: ['${MY_ARG}', 'static'],
      },
    });
    await injectPluginMcpServers(plugin);
    const config = addMock.mock.calls[0][1];
    expect(config.args).toEqual(['hello', 'static']);
    delete process.env.MY_ARG;
  });

  it('substitutes env vars in env map', async () => {
    process.env.MY_TOKEN = 'secret123';
    const plugin = makePlugin({
      server: {
        type: 'stdio',
        command: 'server',
        env: { TOKEN: '${MY_TOKEN}' },
      },
    });
    await injectPluginMcpServers(plugin);
    const config = addMock.mock.calls[0][1];
    expect(config.env.TOKEN).toBe('secret123');
    delete process.env.MY_TOKEN;
  });

  it('does not add headers for stdio transport even if headers are declared', async () => {
    const plugin = makePlugin({
      server: {
        type: 'stdio',
        command: 'server',
        headers: { Authorization: 'Bearer token' },
      },
    });
    await injectPluginMcpServers(plugin);
    const config = addMock.mock.calls[0][1];
    expect(config.headers).toBeUndefined();
  });

  it('uses transport field over type field when both present', async () => {
    const plugin = makePlugin({
      server: {
        transport: 'sse',
        type: 'stdio', // transport takes priority
        url: 'https://example.com/sse',
        command: '',
      },
    });
    await injectPluginMcpServers(plugin);
    const config = addMock.mock.calls[0][1];
    expect(config.transport).toBe('sse');
  });

  it('defaults transport to stdio when neither transport nor type is set', async () => {
    const plugin = makePlugin({
      server: { command: 'node', args: [] },
    });
    await injectPluginMcpServers(plugin);
    const config = addMock.mock.calls[0][1];
    expect(config.transport).toBe('stdio');
  });

  it('handles http server with no command or args (url-only config)', async () => {
    const plugin = makePlugin({
      remote: {
        type: 'http',
        url: 'https://api.example.com/mcp',
        // no command, no args, no env
      },
    });
    const result = await injectPluginMcpServers(plugin);
    expect(result).toHaveLength(1);
    const config = addMock.mock.calls[0][1];
    expect(config.command).toBe('');
    expect(config.args).toEqual([]);
    expect(config.env).toEqual({});
    expect(config.url).toBe('https://api.example.com/mcp');
  });
});

// ---------------------------------------------------------------------------
// removePluginMcpServers
// ---------------------------------------------------------------------------
describe('removePluginMcpServers', () => {
  it('calls delete for each injected server', async () => {
    const plugin = makePlugin({}, {
      injectedMcpServers: ['plugin--test-plugin--s1', 'plugin--test-plugin--s2'],
    });
    await removePluginMcpServers(plugin);
    expect(deleteMock).toHaveBeenCalledTimes(2);
    expect(deleteMock).toHaveBeenCalledWith('plugin--test-plugin--s1', { pluginBypass: true });
    expect(deleteMock).toHaveBeenCalledWith('plugin--test-plugin--s2', { pluginBypass: true });
  });

  it('does nothing when injectedMcpServers is empty', async () => {
    const plugin = makePlugin({}, { injectedMcpServers: [] });
    await removePluginMcpServers(plugin);
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it('handles delete errors gracefully', async () => {
    deleteMock.mockRejectedValueOnce(new Error('Server not found'));
    const plugin = makePlugin({}, {
      injectedMcpServers: ['plugin--test-plugin--s1'],
    });
    // Should not throw
    await expect(removePluginMcpServers(plugin)).resolves.toBeUndefined();
  });
});
