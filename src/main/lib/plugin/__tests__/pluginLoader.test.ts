// @ts-nocheck
/**
 * Tests for pluginLoader — installed.json I/O, auto-discovery helpers,
 * hook normalization, loadPluginFromDir, loadAllInstalledPlugins.
 */

import * as fs from 'fs';
import * as path from 'path';

// ── module-level mocks ──────────────────────────────────────────────────────

vi.mock('../../unifiedLogger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

// pluginDirectories — return predictable paths (no electron dependency)
vi.mock('../pluginDirectories', () => ({
  getInstalledPluginsFilePath: () => '/userData/plugins/installed.json',
  getPluginDir: (name: string) => `/userData/plugins/packages/${name}`,
  ensurePluginDirectories: vi.fn(),
}));

// pluginValidator — we control what it returns per test
const mockValidatePluginManifest = vi.fn();
vi.mock('../pluginValidator', () => ({
  validatePluginManifest: (...args: any[]) => mockValidatePluginManifest(...args),
}));

vi.mock('fs');

// ── Import SUT after mocks ──────────────────────────────────────────────────

import {
  readInstalledPluginsFile,
  writeInstalledPluginsFile,
  addPluginRecord,
  removePluginRecord,
  getPluginRecord,
  loadPluginFromDir,
  loadAllInstalledPlugins,
} from '../pluginLoader';
import type { InstalledPluginsFile, PluginInstallRecord, OpenKosmosPluginManifest } from '../types';

const mockFs = vi.mocked(fs);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeManifest(name = 'test-plugin'): OpenKosmosPluginManifest {
  return {
    name,
    version: '1.0.0',
    description: 'A test plugin',
    author: { name: 'Tester' },
  };
}

function makeRecord(id = 'test-plugin', pluginPath = `/plugins/${id}`, enabled = true): PluginInstallRecord {
  return { id, path: pluginPath, enabled, installedAt: Date.now() };
}

// ---------------------------------------------------------------------------
// readInstalledPluginsFile
// ---------------------------------------------------------------------------

describe('readInstalledPluginsFile', () => {
  afterEach(() => vi.clearAllMocks());

  it('returns empty file when file does not exist', () => {
    mockFs.existsSync.mockReturnValue(false);
    const result = readInstalledPluginsFile();
    expect(result).toEqual({ version: 1, plugins: [] });
  });

  it('parses valid installed.json', () => {
    const data: InstalledPluginsFile = { version: 1, plugins: [makeRecord()] };
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(JSON.stringify(data));
    const result = readInstalledPluginsFile();
    expect(result.plugins).toHaveLength(1);
    expect(result.plugins[0].id).toBe('test-plugin');
  });

  it('returns empty on invalid JSON', () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue('not json {{');
    const result = readInstalledPluginsFile();
    expect(result).toEqual({ version: 1, plugins: [] });
  });

  it('returns empty when version or plugins field is wrong', () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(JSON.stringify({ version: 2, plugins: [] }));
    const result = readInstalledPluginsFile();
    expect(result).toEqual({ version: 1, plugins: [] });
  });

  it('returns empty when plugins is not an array', () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(JSON.stringify({ version: 1, plugins: {} }));
    const result = readInstalledPluginsFile();
    expect(result).toEqual({ version: 1, plugins: [] });
  });
});

// ---------------------------------------------------------------------------
// writeInstalledPluginsFile
// ---------------------------------------------------------------------------

describe('writeInstalledPluginsFile', () => {
  afterEach(() => vi.clearAllMocks());

  it('writes JSON to the correct path', () => {
    mockFs.existsSync.mockReturnValue(true);
    const data: InstalledPluginsFile = { version: 1, plugins: [] };
    writeInstalledPluginsFile(data);
    expect(mockFs.writeFileSync).toHaveBeenCalledWith(
      '/userData/plugins/installed.json',
      JSON.stringify(data, null, 2),
      'utf-8',
    );
  });
});

// ---------------------------------------------------------------------------
// addPluginRecord / removePluginRecord / getPluginRecord
// ---------------------------------------------------------------------------

describe('addPluginRecord', () => {
  afterEach(() => vi.clearAllMocks());

  it('appends a new record', () => {
    mockFs.existsSync.mockReturnValue(false); // empty file
    addPluginRecord(makeRecord('new-plugin'));
    expect(mockFs.writeFileSync).toHaveBeenCalled();
    const written = JSON.parse((mockFs.writeFileSync as any).mock.calls[0][1]);
    expect(written.plugins[0].id).toBe('new-plugin');
  });

  it('replaces an existing record with the same id', () => {
    const existing: InstalledPluginsFile = { version: 1, plugins: [makeRecord('p1', '/old-path')] };
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(JSON.stringify(existing));
    addPluginRecord(makeRecord('p1', '/new-path'));
    const written = JSON.parse((mockFs.writeFileSync as any).mock.calls[0][1]);
    expect(written.plugins).toHaveLength(1);
    expect(written.plugins[0].path).toBe('/new-path');
  });
});

describe('removePluginRecord', () => {
  afterEach(() => vi.clearAllMocks());

  it('removes a record by id', () => {
    const data: InstalledPluginsFile = { version: 1, plugins: [makeRecord('p1'), makeRecord('p2')] };
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(JSON.stringify(data));
    removePluginRecord('p1');
    const written = JSON.parse((mockFs.writeFileSync as any).mock.calls[0][1]);
    expect(written.plugins).toHaveLength(1);
    expect(written.plugins[0].id).toBe('p2');
  });
});

describe('getPluginRecord', () => {
  afterEach(() => vi.clearAllMocks());

  it('returns matching record', () => {
    const data: InstalledPluginsFile = { version: 1, plugins: [makeRecord('p1')] };
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(JSON.stringify(data));
    expect(getPluginRecord('p1')?.id).toBe('p1');
  });

  it('returns undefined when not found', () => {
    mockFs.existsSync.mockReturnValue(false);
    expect(getPluginRecord('missing')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// loadPluginFromDir
// ---------------------------------------------------------------------------

describe('loadPluginFromDir', () => {
  const PLUGIN_DIR = '/plugins/test-plugin';

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when manifest validation fails', () => {
    mockValidatePluginManifest.mockReturnValue({
      manifest: null,
      errors: [{ message: 'No plugin.json' }],
    });
    const result = loadPluginFromDir(PLUGIN_DIR);
    expect(result.plugin).toBeNull();
    expect(result.errors[0].message).toMatch(/No plugin\.json/);
  });

  it('returns plugin with default enabled=true when no record provided', () => {
    mockValidatePluginManifest.mockReturnValue({
      manifest: makeManifest(),
      errors: [],
    });
    // No skills, commands, agents, hooks, mcp
    mockFs.existsSync.mockReturnValue(false);

    const result = loadPluginFromDir(PLUGIN_DIR);
    expect(result.plugin).not.toBeNull();
    expect(result.plugin!.enabled).toBe(true);
    expect(result.plugin!.id).toBe('test-plugin');
  });

  it('uses record.enabled=false when provided', () => {
    mockValidatePluginManifest.mockReturnValue({
      manifest: makeManifest(),
      errors: [],
    });
    mockFs.existsSync.mockReturnValue(false);

    const record = makeRecord('test-plugin', PLUGIN_DIR, false);
    const result = loadPluginFromDir(PLUGIN_DIR, record);
    expect(result.plugin!.enabled).toBe(false);
  });

  it('auto-discovers skills from skills/ directory', () => {
    const manifest = makeManifest();
    mockValidatePluginManifest.mockReturnValue({ manifest, errors: [] });

    mockFs.existsSync.mockImplementation((p) => {
      const s = String(p);
      // skills dir exists
      if (s === path.join(PLUGIN_DIR, 'skills')) return true;
      // skill sub-dir SKILL.md
      if (s === path.join(PLUGIN_DIR, 'skills', 'my-skill', 'SKILL.md')) return true;
      return false;
    });
    mockFs.statSync.mockImplementation((p) => {
      const s = String(p);
      if (s === path.join(PLUGIN_DIR, 'skills')) return { isDirectory: () => true } as any;
      return { isDirectory: () => false } as any;
    });
    mockFs.readdirSync.mockImplementation((p) => {
      const s = String(p);
      if (s === path.join(PLUGIN_DIR, 'skills')) {
        return [{ name: 'my-skill', isDirectory: () => true }] as any;
      }
      return [];
    });

    const result = loadPluginFromDir(PLUGIN_DIR);
    expect(result.plugin!.resolvedSkillPaths.length).toBeGreaterThan(0);
  });

  it('loads external hooks from hooks/hooks.json', () => {
    const manifest = makeManifest();
    mockValidatePluginManifest.mockReturnValue({ manifest, errors: [] });

    const hooksPath = path.join(PLUGIN_DIR, 'hooks', 'hooks.json');
    const hooksData = {
      SessionStart: [{ hooks: [{ type: 'command', command: 'echo hello' }] }],
    };

    mockFs.existsSync.mockImplementation((p) => String(p) === hooksPath);
    mockFs.readFileSync.mockImplementation((p) => {
      if (String(p) === hooksPath) return JSON.stringify(hooksData);
      return '{}';
    });

    const result = loadPluginFromDir(PLUGIN_DIR);
    expect(result.plugin).not.toBeNull();
    expect(result.plugin!.manifest.hooks?.SessionStart).toBeDefined();
    expect(result.plugin!.manifest.hooks!.SessionStart![0].command).toBe('echo hello');
  });

  it('loads external mcp from .mcp.json', () => {
    const manifest = makeManifest();
    mockValidatePluginManifest.mockReturnValue({ manifest, errors: [] });

    const mcpPath = path.join(PLUGIN_DIR, '.mcp.json');
    const mcpData = { mcpServers: { myserver: { command: 'node', args: ['srv.js'] } } };

    mockFs.existsSync.mockImplementation((p) => String(p) === mcpPath);
    mockFs.readFileSync.mockImplementation((p) => {
      if (String(p) === mcpPath) return JSON.stringify(mcpData);
      return '{}';
    });

    const result = loadPluginFromDir(PLUGIN_DIR);
    expect(result.plugin!.manifest.mcpServers?.myserver).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// loadAllInstalledPlugins
// ---------------------------------------------------------------------------

describe('loadAllInstalledPlugins', () => {
  afterEach(() => vi.clearAllMocks());

  it('returns empty result when installed.json is missing', () => {
    mockFs.existsSync.mockReturnValue(false);
    const result = loadAllInstalledPlugins();
    expect(result.enabled).toHaveLength(0);
    expect(result.disabled).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it('reports error for missing plugin directory', () => {
    const data: InstalledPluginsFile = { version: 1, plugins: [makeRecord('p1', '/missing-dir')] };
    mockFs.existsSync.mockImplementation((p) => {
      // installed.json exists, but plugin dir doesn't
      if (String(p) === '/userData/plugins/installed.json') return true;
      return false;
    });
    mockFs.readFileSync.mockReturnValue(JSON.stringify(data));

    const result = loadAllInstalledPlugins();
    expect(result.errors[0].message).toMatch(/Plugin directory missing/);
  });

  it('adds enabled plugins to result.enabled', () => {
    const record = makeRecord('p1', '/plugins/p1', true);
    const data: InstalledPluginsFile = { version: 1, plugins: [record] };
    mockFs.existsSync.mockImplementation((p) => {
      if (String(p) === '/userData/plugins/installed.json') return true;
      if (String(p) === '/plugins/p1') return true;
      return false;
    });
    mockFs.readFileSync.mockReturnValue(JSON.stringify(data));
    mockValidatePluginManifest.mockReturnValue({ manifest: makeManifest('p1'), errors: [] });

    const result = loadAllInstalledPlugins();
    expect(result.enabled).toHaveLength(1);
    expect(result.disabled).toHaveLength(0);
  });

  it('adds disabled plugins to result.disabled', () => {
    const record = makeRecord('p1', '/plugins/p1', false);
    const data: InstalledPluginsFile = { version: 1, plugins: [record] };
    mockFs.existsSync.mockImplementation((p) => {
      if (String(p) === '/userData/plugins/installed.json') return true;
      if (String(p) === '/plugins/p1') return true;
      return false;
    });
    mockFs.readFileSync.mockReturnValue(JSON.stringify(data));
    mockValidatePluginManifest.mockReturnValue({ manifest: makeManifest('p1'), errors: [] });

    const result = loadAllInstalledPlugins();
    expect(result.disabled).toHaveLength(1);
    expect(result.enabled).toHaveLength(0);
  });
});
