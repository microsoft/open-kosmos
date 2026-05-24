/**
 * Extra coverage for pluginLoader — auto-discovery edge cases,
 * hooks normalization (flat vs matcher format, merging), commands/agents
 * scanning, .mcp.json edge cases, and manifest-skills-string branch.
 */

import * as fs from 'fs';
import * as path from 'path';

vi.mock('../../unifiedLogger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock('../pluginDirectories', () => ({
  getInstalledPluginsFilePath: () => '/userData/plugins/installed.json',
  getPluginDir: (name: string) => `/userData/plugins/packages/${name}`,
  ensurePluginDirectories: vi.fn(),
}));

const mockValidatePluginManifest = vi.fn();
vi.mock('../pluginValidator', () => ({
  validatePluginManifest: (...args: any[]) => mockValidatePluginManifest(...args),
}));

vi.mock('fs');

import { loadPluginFromDir } from '../pluginLoader';
import type { OpenKosmosPluginManifest } from '../types';

const mockFs = vi.mocked(fs);

const PLUGIN_DIR = '/plugins/test-plugin';

function makeManifest(overrides: Partial<OpenKosmosPluginManifest> = {}): OpenKosmosPluginManifest {
  return {
    name: 'test-plugin',
    version: '1.0.0',
    description: 'A test plugin',
    author: { name: 'Tester' },
    ...overrides,
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Skills: manifest `skills` as string (single-skill shorthand)
// ---------------------------------------------------------------------------

describe('loadPluginFromDir — manifest skills as string', () => {
  it('converts manifest skills string to resolved array', () => {
    const manifest = makeManifest({ skills: 'skills/my-skill' });
    mockValidatePluginManifest.mockReturnValue({ manifest, errors: [] });

    mockFs.existsSync.mockImplementation((p) => {
      const s = String(p);
      // skills root does NOT exist (skip auto-discovery)
      if (s === path.join(PLUGIN_DIR, 'skills')) return false;
      // manifest skill path exists
      if (s === path.resolve(PLUGIN_DIR, 'skills/my-skill')) return true;
      return false;
    });
    mockFs.statSync.mockReturnValue({ isDirectory: () => false } as any);

    const result = loadPluginFromDir(PLUGIN_DIR);
    expect(result.plugin).not.toBeNull();
    expect(result.plugin!.resolvedSkillPaths.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Skills: auto-discovery scan error is swallowed
// ---------------------------------------------------------------------------

describe('loadPluginFromDir — skills scan error', () => {
  it('returns plugin without crashing when readdirSync throws', () => {
    const manifest = makeManifest();
    mockValidatePluginManifest.mockReturnValue({ manifest, errors: [] });

    mockFs.existsSync.mockImplementation((p) => {
      if (String(p) === path.join(PLUGIN_DIR, 'skills')) return true;
      return false;
    });
    mockFs.statSync.mockReturnValue({ isDirectory: () => true } as any);
    mockFs.readdirSync.mockImplementation(() => {
      throw new Error('permission denied');
    });

    const result = loadPluginFromDir(PLUGIN_DIR);
    expect(result.plugin).not.toBeNull();
    expect(result.plugin!.resolvedSkillPaths).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Commands auto-discovery
// ---------------------------------------------------------------------------

describe('loadPluginFromDir — commands auto-discovery', () => {
  it('parses commands/*.md with frontmatter', () => {
    const manifest = makeManifest();
    mockValidatePluginManifest.mockReturnValue({ manifest, errors: [] });

    const commandsDir = path.join(PLUGIN_DIR, 'commands');
    const cmdFile = path.join(commandsDir, 'deploy.md');
    const cmdContent = `---\ndescription: "Deploy the app"\nallowed-tools: bash,python\n---\nRun the deployment script.`;

    mockFs.existsSync.mockImplementation((p) => {
      if (String(p) === commandsDir) return true;
      return false;
    });
    mockFs.statSync.mockImplementation((p) => {
      if (String(p) === commandsDir) return { isDirectory: () => true } as any;
      return { isDirectory: () => false } as any;
    });
    mockFs.readdirSync.mockImplementation((p) => {
      if (String(p) === commandsDir) {
        return [{ name: 'deploy.md', isFile: () => true, isDirectory: () => false }] as any;
      }
      return [];
    });
    mockFs.readFileSync.mockImplementation((p) => {
      if (String(p) === cmdFile) return cmdContent;
      return '{}';
    });

    const result = loadPluginFromDir(PLUGIN_DIR);
    expect(result.plugin).not.toBeNull();
    expect(result.plugin!.manifest.commands).toHaveLength(1);
    const cmd = result.plugin!.manifest.commands![0];
    expect(cmd.name).toBe('deploy');
    expect(cmd.description).toBe('Deploy the app');
    expect(cmd.allowedTools).toEqual(['bash', 'python']);
    expect(cmd.promptBody).toContain('Run the deployment script');
  });

  it('skips non-.md files in commands/', () => {
    const manifest = makeManifest();
    mockValidatePluginManifest.mockReturnValue({ manifest, errors: [] });

    const commandsDir = path.join(PLUGIN_DIR, 'commands');

    mockFs.existsSync.mockImplementation((p) => String(p) === commandsDir);
    mockFs.statSync.mockReturnValue({ isDirectory: () => true } as any);
    mockFs.readdirSync.mockReturnValue([
      { name: 'README.txt', isFile: () => true, isDirectory: () => false },
    ] as any);

    const result = loadPluginFromDir(PLUGIN_DIR);
    expect(result.plugin!.manifest.commands).toBeUndefined();
  });

  it('handles commands scan error gracefully', () => {
    const manifest = makeManifest();
    mockValidatePluginManifest.mockReturnValue({ manifest, errors: [] });

    const commandsDir = path.join(PLUGIN_DIR, 'commands');
    mockFs.existsSync.mockImplementation((p) => String(p) === commandsDir);
    mockFs.statSync.mockReturnValue({ isDirectory: () => true } as any);
    mockFs.readdirSync.mockImplementation(() => {
      throw new Error('disk error');
    });

    const result = loadPluginFromDir(PLUGIN_DIR);
    expect(result.plugin).not.toBeNull();
  });

  it('does not set commands when directory missing', () => {
    const manifest = makeManifest();
    mockValidatePluginManifest.mockReturnValue({ manifest, errors: [] });
    mockFs.existsSync.mockReturnValue(false);

    const result = loadPluginFromDir(PLUGIN_DIR);
    expect(result.plugin!.manifest.commands).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Agents auto-discovery
// ---------------------------------------------------------------------------

describe('loadPluginFromDir — agents auto-discovery', () => {
  it('parses agents/*.md with frontmatter', () => {
    const manifest = makeManifest();
    mockValidatePluginManifest.mockReturnValue({ manifest, errors: [] });

    const agentsDir = path.join(PLUGIN_DIR, 'agents');
    const agentFile = path.join(agentsDir, 'coder.md');
    const agentContent = `---\nname: "Coder Agent"\ndescription: "Writes code"\nmodel: gpt-4\n---\nYou are a coding assistant.`;

    mockFs.existsSync.mockImplementation((p) => {
      if (String(p) === agentsDir) return true;
      return false;
    });
    mockFs.statSync.mockReturnValue({ isDirectory: () => true } as any);
    mockFs.readdirSync.mockImplementation((p) => {
      if (String(p) === agentsDir) {
        return [{ name: 'coder.md', isFile: () => true, isDirectory: () => false }] as any;
      }
      return [];
    });
    mockFs.readFileSync.mockImplementation((p) => {
      if (String(p) === agentFile) return agentContent;
      return '{}';
    });

    const result = loadPluginFromDir(PLUGIN_DIR);
    expect(result.plugin).not.toBeNull();
    expect(result.plugin!.manifest.agents).toHaveLength(1);
    const agent = result.plugin!.manifest.agents![0];
    expect(agent.name).toBe('Coder Agent');
    expect(agent.description).toBe('Writes code');
    expect(agent.model).toBe('gpt-4');
    expect(agent.systemPrompt).toContain('coding assistant');
  });

  it('uses filename as agent name when frontmatter name missing', () => {
    const manifest = makeManifest();
    mockValidatePluginManifest.mockReturnValue({ manifest, errors: [] });

    const agentsDir = path.join(PLUGIN_DIR, 'agents');
    const agentFile = path.join(agentsDir, 'unnamed.md');

    mockFs.existsSync.mockImplementation((p) => String(p) === agentsDir);
    mockFs.statSync.mockReturnValue({ isDirectory: () => true } as any);
    mockFs.readdirSync.mockReturnValue([
      { name: 'unnamed.md', isFile: () => true, isDirectory: () => false },
    ] as any);
    mockFs.readFileSync.mockImplementation((p) => {
      if (String(p) === agentFile) return 'Just a plain agent';
      return '{}';
    });

    const result = loadPluginFromDir(PLUGIN_DIR);
    expect(result.plugin!.manifest.agents![0].name).toBe('unnamed');
  });

  it('handles agents scan error gracefully', () => {
    const manifest = makeManifest();
    mockValidatePluginManifest.mockReturnValue({ manifest, errors: [] });

    const agentsDir = path.join(PLUGIN_DIR, 'agents');
    mockFs.existsSync.mockImplementation((p) => String(p) === agentsDir);
    mockFs.statSync.mockReturnValue({ isDirectory: () => true } as any);
    mockFs.readdirSync.mockImplementation(() => {
      throw new Error('disk error');
    });

    const result = loadPluginFromDir(PLUGIN_DIR);
    expect(result.plugin).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parseMarkdownWithFrontmatter edge cases (via commands)
// ---------------------------------------------------------------------------

describe('parseMarkdownWithFrontmatter — edge cases', () => {
  it('handles frontmatter values with single-quoted strings', () => {
    const manifest = makeManifest();
    mockValidatePluginManifest.mockReturnValue({ manifest, errors: [] });

    const commandsDir = path.join(PLUGIN_DIR, 'commands');
    const cmdFile = path.join(commandsDir, 'greet.md');
    const cmdContent = `---\ndescription: 'Hello world'\n---\nBody text.`;

    mockFs.existsSync.mockImplementation((p) => String(p) === commandsDir);
    mockFs.statSync.mockReturnValue({ isDirectory: () => true } as any);
    mockFs.readdirSync.mockReturnValue([
      { name: 'greet.md', isFile: () => true, isDirectory: () => false },
    ] as any);
    mockFs.readFileSync.mockImplementation(() => cmdContent);

    const result = loadPluginFromDir(PLUGIN_DIR);
    expect(result.plugin!.manifest.commands![0].description).toBe('Hello world');
  });

  it('handles command with no allowed-tools (undefined)', () => {
    const manifest = makeManifest();
    mockValidatePluginManifest.mockReturnValue({ manifest, errors: [] });

    const commandsDir = path.join(PLUGIN_DIR, 'commands');
    const cmdContent = `---\ndescription: test\n---\nBody.`;

    mockFs.existsSync.mockImplementation((p) => String(p) === commandsDir);
    mockFs.statSync.mockReturnValue({ isDirectory: () => true } as any);
    mockFs.readdirSync.mockReturnValue([
      { name: 'cmd.md', isFile: () => true, isDirectory: () => false },
    ] as any);
    mockFs.readFileSync.mockImplementation(() => cmdContent);

    const result = loadPluginFromDir(PLUGIN_DIR);
    expect(result.plugin!.manifest.commands![0].allowedTools).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Hooks: flat format (already HookCommand[])
// ---------------------------------------------------------------------------

describe('loadPluginFromDir — hooks flat format', () => {
  it('accepts flat HookCommand[] in manifest hooks', () => {
    const manifest = makeManifest({
      hooks: {
        SessionStart: [{ type: 'command', command: 'npm install' }],
      } as any,
    });
    mockValidatePluginManifest.mockReturnValue({ manifest, errors: [] });
    mockFs.existsSync.mockReturnValue(false);

    const result = loadPluginFromDir(PLUGIN_DIR);
    expect(result.plugin!.manifest.hooks?.SessionStart).toBeDefined();
    expect(result.plugin!.manifest.hooks!.SessionStart![0].command).toBe('npm install');
  });
});

// ---------------------------------------------------------------------------
// Hooks: external hooks.json error is swallowed
// ---------------------------------------------------------------------------

describe('loadPluginFromDir — external hooks.json error', () => {
  it('still loads plugin when hooks.json has invalid JSON', () => {
    const manifest = makeManifest();
    mockValidatePluginManifest.mockReturnValue({ manifest, errors: [] });

    const hooksPath = path.join(PLUGIN_DIR, 'hooks', 'hooks.json');
    mockFs.existsSync.mockImplementation((p) => String(p) === hooksPath);
    mockFs.readFileSync.mockImplementation((p) => {
      if (String(p) === hooksPath) return '{ invalid json {{';
      return '{}';
    });

    const result = loadPluginFromDir(PLUGIN_DIR);
    expect(result.plugin).not.toBeNull();
    expect(result.plugin!.manifest.hooks).toBeUndefined();
  });

  it('handles hooks.json returning non-object value', () => {
    const manifest = makeManifest();
    mockValidatePluginManifest.mockReturnValue({ manifest, errors: [] });

    const hooksPath = path.join(PLUGIN_DIR, 'hooks', 'hooks.json');
    mockFs.existsSync.mockImplementation((p) => String(p) === hooksPath);
    mockFs.readFileSync.mockImplementation(() => JSON.stringify('a string'));

    const result = loadPluginFromDir(PLUGIN_DIR);
    expect(result.plugin).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// MCP: .mcp.json edge cases
// ---------------------------------------------------------------------------

describe('loadPluginFromDir — .mcp.json edge cases', () => {
  it('handles .mcp.json with invalid JSON gracefully', () => {
    const manifest = makeManifest();
    mockValidatePluginManifest.mockReturnValue({ manifest, errors: [] });

    const mcpPath = path.join(PLUGIN_DIR, '.mcp.json');
    mockFs.existsSync.mockImplementation((p) => String(p) === mcpPath);
    mockFs.readFileSync.mockImplementation(() => 'not json');

    const result = loadPluginFromDir(PLUGIN_DIR);
    expect(result.plugin).not.toBeNull();
    expect(result.plugin!.manifest.mcpServers).toBeUndefined();
  });

  it('ignores .mcp.json when servers is an array (invalid)', () => {
    const manifest = makeManifest();
    mockValidatePluginManifest.mockReturnValue({ manifest, errors: [] });

    const mcpPath = path.join(PLUGIN_DIR, '.mcp.json');
    mockFs.existsSync.mockImplementation((p) => String(p) === mcpPath);
    mockFs.readFileSync.mockImplementation(() => JSON.stringify({ mcpServers: ['a', 'b'] }));

    const result = loadPluginFromDir(PLUGIN_DIR);
    expect(result.plugin!.manifest.mcpServers).toBeUndefined();
  });

  it('merges manifest mcpServers over .mcp.json servers', () => {
    const manifest = makeManifest({
      mcpServers: { manifestServer: { command: 'node', args: ['m.js'] } } as any,
    });
    mockValidatePluginManifest.mockReturnValue({ manifest, errors: [] });

    const mcpPath = path.join(PLUGIN_DIR, '.mcp.json');
    mockFs.existsSync.mockImplementation((p) => String(p) === mcpPath);
    mockFs.readFileSync.mockImplementation(() =>
      JSON.stringify({ mcpServers: { externalServer: { command: 'python', args: ['s.py'] } } })
    );

    const result = loadPluginFromDir(PLUGIN_DIR);
    expect(result.plugin!.manifest.mcpServers?.manifestServer).toBeDefined();
    expect(result.plugin!.manifest.mcpServers?.externalServer).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Hooks merging — both sources contribute
// ---------------------------------------------------------------------------

describe('loadPluginFromDir — hooks merge from both sources', () => {
  it('combines hooks from hooks.json and manifest', () => {
    const manifest = makeManifest({
      hooks: {
        SessionStart: [{ type: 'command', command: 'from-manifest' }],
      } as any,
    });
    mockValidatePluginManifest.mockReturnValue({ manifest, errors: [] });

    const hooksPath = path.join(PLUGIN_DIR, 'hooks', 'hooks.json');
    mockFs.existsSync.mockImplementation((p) => String(p) === hooksPath);
    mockFs.readFileSync.mockImplementation((p) => {
      if (String(p) === hooksPath) {
        return JSON.stringify({
          SessionStart: [{ hooks: [{ type: 'command', command: 'from-file' }] }],
        });
      }
      return '{}';
    });

    const result = loadPluginFromDir(PLUGIN_DIR);
    const hooks = result.plugin!.manifest.hooks?.SessionStart ?? [];
    expect(hooks.some((h) => h.command === 'from-file')).toBe(true);
    expect(hooks.some((h) => h.command === 'from-manifest')).toBe(true);
  });
});
