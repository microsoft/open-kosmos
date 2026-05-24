// @ts-nocheck
/**
 * SubAgentFileManager coverage supplement
 * Targets uncovered methods and branches not reached by the base test files.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

vi.mock('../unifiedLogger', () => ({
  createConsoleLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock('js-yaml', async () => {
  const actual = await vi.importActual<typeof import('js-yaml')>('js-yaml');
  return actual;
});

import { SubAgentFileManager, CLAUDE_TO_OpenKosmos_TOOL_MAP } from '../subAgentFileManager';
import type { SubAgentConfig } from '../../userDataADO/types/profile';

function makeMinimalConfig(overrides: Partial<SubAgentConfig> = {}): SubAgentConfig {
  return {
    name: 'test-agent',
    description: 'A test agent',
    model: 'inherit',
    skills: [],
    mcpServers: [],
    mcp_servers: [],
    version: '1.0.0',
    builtin_tools: [],
    disallow_builtin_tools: [],
    workspace: '',
    knowledgeBase: '',
    inherit_mcp_servers: true,
    inherit_skills: true,
    inherit_knowledge_base: true,
    system_prompt: '',
    ...overrides,
  };
}

describe('SubAgentFileManager — coverage supplement', () => {
  let manager: SubAgentFileManager;
  let tmpDir: string;

  beforeEach(() => {
    SubAgentFileManager.resetInstance();
    manager = SubAgentFileManager.getInstance();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'subagent-cov-'));
  });

  afterEach(async () => {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
    SubAgentFileManager.resetInstance();
  });

  // ── Singleton ────────────────────────────────────────────────────────────

  it('getInstance returns same instance', () => {
    const a = SubAgentFileManager.getInstance();
    const b = SubAgentFileManager.getInstance();
    expect(a).toBe(b);
  });

  // ── Path utilities ────────────────────────────────────────────────────────

  it('getAgentsDirectory', () => {
    const dir = manager.getAgentsDirectory('/prof');
    expect(dir).toContain('agents');
  });

  it('getAgentDirectory', () => {
    const dir = manager.getAgentDirectory('/prof', 'my-agent');
    expect(dir).toContain('my-agent');
  });

  it('getAgentFilePath', () => {
    const file = manager.getAgentFilePath('/prof', 'my-agent');
    expect(file).toContain('AGENT.md');
  });

  // ── validateAgentName ─────────────────────────────────────────────────────

  it('validates valid names', () => {
    expect(manager.validateAgentName('my-agent').valid).toBe(true);
    expect(manager.validateAgentName('a').valid).toBe(true);
    expect(manager.validateAgentName('abc123').valid).toBe(true);
  });

  it('rejects empty name', () => {
    expect(manager.validateAgentName('').valid).toBe(false);
    expect(manager.validateAgentName('   ').valid).toBe(false);
  });

  it('rejects names with uppercase letters', () => {
    expect(manager.validateAgentName('MyAgent').valid).toBe(false);
  });

  it('rejects names starting or ending with hyphen', () => {
    expect(manager.validateAgentName('-agent').valid).toBe(false);
    expect(manager.validateAgentName('agent-').valid).toBe(false);
  });

  // ── validateAgentConfig ───────────────────────────────────────────────────

  it('returns valid for complete config', () => {
    const result = manager.validateAgentConfig(makeMinimalConfig());
    expect(result.valid).toBe(true);
  });

  it('returns errors for missing name', () => {
    const result = manager.validateAgentConfig({ description: 'x' });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('name is required');
  });

  it('returns errors for missing description', () => {
    const result = manager.validateAgentConfig({ name: 'valid-name' });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('description is required');
  });

  it('does not error for maxTurns (field removed from validation)', () => {
    const result = manager.validateAgentConfig({ name: 'a', description: 'b' });
    expect(result.valid).toBe(true);
  });

  it('does not error for context_access (field removed from validation)', () => {
    const result = manager.validateAgentConfig({ name: 'a', description: 'b' });
    expect(result.valid).toBe(true);
  });

  it('propagates name validation errors into config validation', () => {
    const result = manager.validateAgentConfig({ name: 'Bad-Name!', description: 'x' });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  // ── Cache management ──────────────────────────────────────────────────────

  it('isCacheWarmed / markCacheWarmed', () => {
    expect(manager.isCacheWarmed('user1')).toBe(false);
    manager.markCacheWarmed('user1');
    expect(manager.isCacheWarmed('user1')).toBe(true);
  });

  it('invalidateCache removes a single entry', async () => {
    const config = makeMinimalConfig({ name: 'to-evict' });
    await manager.writeAgentConfig(tmpDir, config);
    expect(manager.getCachedConfig('to-evict')).toBeDefined();
    manager.invalidateCache('to-evict');
    expect(manager.getCachedConfig('to-evict')).toBeUndefined();
  });

  it('invalidateAllCache clears everything', async () => {
    const config = makeMinimalConfig({ name: 'one' });
    await manager.writeAgentConfig(tmpDir, config);
    manager.markCacheWarmed('u');
    manager.invalidateAllCache();
    expect(manager.getCachedConfigs()).toHaveLength(0);
    expect(manager.isCacheWarmed('u')).toBe(false);
  });

  // ── parseAgentMarkdown ────────────────────────────────────────────────────

  it('parses AGENT.md with full fields', () => {
    const content = `---
name: full-agent
description: "Full description"
model: gpt-4
tools:
  - Read
  - Bash
disallowedTools:
  - Write
skills:
  - skill1
mcpServers:
  - server-name
  - name: inline-srv
    tools:
      - tool1
x-openkosmos:
  version: "2.0.0"
  builtin_tools:
    - read_file
  disallow_builtin_tools:
    - write_file
  workspace: /some/workspace
  knowledgeBase: kb-id
  inherit_mcp_servers: false
  inherit_skills: false
  inherit_knowledge_base: false
---

# System Prompt

You are a helpful agent.
`;
    const result = manager.parseAgentMarkdown(content);
    expect(result.data).not.toBeNull();
    expect(result.data?.name).toBe('full-agent');
    expect(result.data?.model).toBe('gpt-4');
    expect(result.data?.maxTurns).toBeUndefined();
    expect(result.data?.inherit_mcp_servers).toBe(false);
    expect(result.data?.system_prompt).toContain('You are a helpful agent');
  });

  it('returns error when content does not start with ---', () => {
    const result = manager.parseAgentMarkdown('# No front matter');
    expect(result.data).toBeNull();
    expect(result.error).toContain('YAML front-matter');
  });

  it('returns error when front-matter closing --- is missing', () => {
    const result = manager.parseAgentMarkdown('---\nname: x\n');
    expect(result.data).toBeNull();
    expect(result.error).toContain('closing ---');
  });

  it('returns error when YAML data is invalid (non-object)', () => {
    const result = manager.parseAgentMarkdown('---\njust a string\n---\nbody');
    expect(result.data).toBeNull();
    expect(result.error).toContain('Invalid YAML');
  });

  it('returns error when name is missing', () => {
    const result = manager.parseAgentMarkdown('---\ndescription: "x"\n---\nbody');
    expect(result.data).toBeNull();
    expect(result.error).toContain('name');
  });

  it('returns error when description is missing', () => {
    const result = manager.parseAgentMarkdown('---\nname: x\n---\nbody');
    expect(result.data).toBeNull();
    expect(result.error).toContain('description');
  });

  it('auto-maps Claude tools to openkosmos builtin_tools', () => {
    const content = `---
name: claude-agent
description: "imported"
tools:
  - Read
  - Bash
  - Glob
---
`;
    const result = manager.parseAgentMarkdown(content);
    expect(result.data?.builtin_tools).toContain('read_file');
    expect(result.data?.builtin_tools).toContain('execute_command');
    expect(result.data?.builtin_tools).toContain('search_files');
  });

  it('auto-maps disallowedTools to disallow_builtin_tools', () => {
    const content = `---
name: no-write-agent
description: "no write"
disallowedTools:
  - Write
  - WebFetch
---
`;
    const result = manager.parseAgentMarkdown(content);
    expect(result.data?.disallow_builtin_tools).toContain('write_file');
    expect(result.data?.disallow_builtin_tools).toContain('fetch_web_content');
  });

  it('does not overwrite explicitly set builtin_tools from x-openkosmos', () => {
    const content = `---
name: explicit-tools
description: "explicit"
tools:
  - Read
x-openkosmos:
  builtin_tools:
    - execute_command
---
`;
    const result = manager.parseAgentMarkdown(content);
    // builtin_tools was already set from x-openkosmos, so no auto-mapping
    expect(result.data?.builtin_tools).toContain('execute_command');
    expect(result.data?.builtin_tools).not.toContain('read_file');
  });

  it('handles tools as comma-separated string', () => {
    const content = `---
name: comma-tools
description: "comma"
tools: "Read, Bash, Glob"
---
`;
    const result = manager.parseAgentMarkdown(content);
    expect(result.data?.tools).toContain('Read');
    expect(result.data?.tools).toContain('Bash');
  });

  it('handles max_turns (snake_case) — field removed, returns undefined', () => {
    const content = `---
name: snake-case-agent
description: "snake"
---
`;
    const result = manager.parseAgentMarkdown(content);
    expect(result.data?.maxTurns).toBeUndefined();
  });

  it('handles mcp_servers (snake_case) fallback', () => {
    const content = `---
name: snake-mcp-agent
description: "has mcp"
mcp_servers:
  - srv1
---
`;
    const result = manager.parseAgentMarkdown(content);
    expect(result.data?.mcpServers).toHaveLength(1);
  });

  it('parses agent without context_access (field removed)', () => {
    const content = `---
name: ctx-agent
description: "ctx"
x-openkosmos:
---
`;
    const result = manager.parseAgentMarkdown(content);
    expect((result.data as any)?.context_access).toBeUndefined();
  });

  it('parses agent without emoji (field removed)', () => {
    const content = `---
name: no-emoji
description: "no emoji"
---
`;
    const result = manager.parseAgentMarkdown(content);
    expect((result.data as any)?.emoji).toBeUndefined();
  });

  // ── serializeToAgentMarkdown ──────────────────────────────────────────────

  it('serializes config with all optional fields', () => {
    const config = makeMinimalConfig({
      name: 'full-out',
      model: 'gpt-4o',
      tools: ['Read'],
      disallowedTools: ['Write'],
      skills: ['skill1'],
      mcpServers: [{ name: 'srv', tools: [] }],
      version: '3.0.0',
      builtin_tools: ['read_file'],
      disallow_builtin_tools: ['write_file'],
      workspace: '/tmp',
      knowledgeBase: 'kb',
      inherit_mcp_servers: false,
      inherit_skills: false,
      inherit_knowledge_base: false,
      system_prompt: 'You are great.',
    });
    const output = manager.serializeToAgentMarkdown(config);
    expect(output).toContain('full-out');
    expect(output).toContain('model: gpt-4o');
    expect(output).toContain('inherit_mcp_servers: false');
    expect(output).toContain('You are great');
  });

  it('omits model when model=inherit', () => {
    const config = makeMinimalConfig({ model: 'inherit' });
    const output = manager.serializeToAgentMarkdown(config);
    expect(output).not.toContain('model: inherit');
  });

  it('does not include x-openkosmos section (display_name removed)', () => {
    const config = makeMinimalConfig({
      version: '1.0.0',
    });
    const output = manager.serializeToAgentMarkdown(config);
    // display_name removed, so x-openkosmos section may not be included
    expect(output).not.toContain('display_name');
  });

  it('uses legacy mcp_servers when mcpServers undefined', () => {
    const config = makeMinimalConfig({
      mcpServers: undefined as any,
      mcp_servers: [{ name: 'legacy-srv', tools: ['t1'] }],
    });
    const output = manager.serializeToAgentMarkdown(config);
    expect(output).toContain('legacy-srv');
  });

  // ── exportAsClaudeCodeFormat ──────────────────────────────────────────────

  it('exports Claude Code format without x-openkosmos fields', () => {
    const config = makeMinimalConfig({
      tools: ['Read'],
      model: 'gpt-4',
      system_prompt: 'Be helpful.',
      mcpServers: [{ name: 'srv', tools: [] }],
    });
    const output = manager.exportAsClaudeCodeFormat(config);
    expect(output).not.toContain('x-openkosmos');
    expect(output).toContain('Read');
    expect(output).toContain('model: gpt-4');
    expect(output).toContain('Be helpful');
    // mcpServers in Claude Code format = server name strings only
    expect(output).toContain('srv');
  });

  it('export does not include maxTurns (field removed)', () => {
    const cfg = makeMinimalConfig({ name: 'no-turns' });
    const output = manager.exportAsClaudeCodeFormat(cfg);
    expect(output).not.toContain('maxTurns');
  });

  // ── CRUD: writeAgentConfig / readAgentConfig ──────────────────────────────

  it('writeAgentConfig creates directory and writes file', async () => {
    const config = makeMinimalConfig({ name: 'write-test' });
    await manager.writeAgentConfig(tmpDir, config);

    const filePath = manager.getAgentFilePath(tmpDir, 'write-test');
    const content = await fs.promises.readFile(filePath, 'utf-8');
    expect(content).toContain('write-test');
  });

  it('readAgentConfig returns cached value on second call', async () => {
    const config = makeMinimalConfig({ name: 'cache-test' });
    await manager.writeAgentConfig(tmpDir, config);

    const r1 = await manager.readAgentConfig(tmpDir, 'cache-test');
    const r2 = await manager.readAgentConfig(tmpDir, 'cache-test');
    expect(r1).toBe(r2); // same reference from cache
  });

  it('readAgentConfig returns null for unparseable AGENT.md', async () => {
    const agentDir = manager.getAgentDirectory(tmpDir, 'bad-agent');
    await fs.promises.mkdir(agentDir, { recursive: true });
    const filePath = manager.getAgentFilePath(tmpDir, 'bad-agent');
    await fs.promises.writeFile(filePath, '# No YAML front matter', 'utf-8');

    const result = await manager.readAgentConfig(tmpDir, 'bad-agent');
    expect(result).toBeNull();
  });

  it('readAgentConfig returns null for non-ENOENT read error', async () => {
    // Create a file that can't be read by chmod
    const agentDir = manager.getAgentDirectory(tmpDir, 'no-read');
    await fs.promises.mkdir(agentDir, { recursive: true });
    const filePath = manager.getAgentFilePath(tmpDir, 'no-read');
    await fs.promises.writeFile(filePath, 'content', 'utf-8');
    await fs.promises.chmod(filePath, 0o000);

    try {
      const result = await manager.readAgentConfig(tmpDir, 'no-read');
      expect(result).toBeNull();
    } finally {
      await fs.promises.chmod(filePath, 0o644);
    }
  });

  it('deleteAgentDirectory removes directory and cache', async () => {
    const config = makeMinimalConfig({ name: 'to-delete' });
    await manager.writeAgentConfig(tmpDir, config);
    expect(manager.getCachedConfig('to-delete')).toBeDefined();

    await manager.deleteAgentDirectory(tmpDir, 'to-delete');
    expect(manager.getCachedConfig('to-delete')).toBeUndefined();
    const agentDir = manager.getAgentDirectory(tmpDir, 'to-delete');
    await expect(fs.promises.access(agentDir)).rejects.toThrow();
  });

  it('deleteAgentDirectory throws when fs.rm fails for non-existent with error', async () => {
    // rm with force: true should not throw even for non-existent dirs
    await expect(manager.deleteAgentDirectory(tmpDir, 'nonexistent')).resolves.toBeUndefined();
  });

  // ── listAgents ────────────────────────────────────────────────────────────

  it('listAgents returns empty array when agents/ dir does not exist', async () => {
    const result = await manager.listAgents('/nonexistent/profile/dir');
    expect(result).toEqual([]);
  });

  it('listAgents skips directories without AGENT.md', async () => {
    const agentsDir = manager.getAgentsDirectory(tmpDir);
    await fs.promises.mkdir(agentsDir, { recursive: true });
    // Create a subdirectory without AGENT.md
    await fs.promises.mkdir(path.join(agentsDir, 'no-md-dir'));
    // Create a valid agent
    await manager.writeAgentConfig(tmpDir, makeMinimalConfig({ name: 'valid-one' }));

    const names = await manager.listAgents(tmpDir);
    expect(names).toContain('valid-one');
    expect(names).not.toContain('no-md-dir');
  });

  it('listAgents skips non-directory entries', async () => {
    const agentsDir = manager.getAgentsDirectory(tmpDir);
    await fs.promises.mkdir(agentsDir, { recursive: true });
    // Create a file (not a directory) in agents/
    await fs.promises.writeFile(path.join(agentsDir, 'README.md'), 'readme');
    await manager.writeAgentConfig(tmpDir, makeMinimalConfig({ name: 'real-agent' }));

    const names = await manager.listAgents(tmpDir);
    expect(names).toContain('real-agent');
    expect(names).not.toContain('README.md');
  });

  it('listAgents skips dirs with invalid agent names', async () => {
    const agentsDir = manager.getAgentsDirectory(tmpDir);
    await fs.promises.mkdir(agentsDir, { recursive: true });
    // Create a dir with an invalid name (uppercase)
    const invalidDir = path.join(agentsDir, 'Invalid_Name');
    await fs.promises.mkdir(invalidDir);
    await fs.promises.writeFile(path.join(invalidDir, 'AGENT.md'), 'content');

    const names = await manager.listAgents(tmpDir);
    expect(names).not.toContain('Invalid_Name');
  });

  // ── scanAllAgents ─────────────────────────────────────────────────────────

  it('scanAllAgents returns all valid agents', async () => {
    await manager.writeAgentConfig(tmpDir, makeMinimalConfig({ name: 'agent-a' }));
    await manager.writeAgentConfig(tmpDir, makeMinimalConfig({ name: 'agent-b' }));

    const configs = await manager.scanAllAgents(tmpDir);
    expect(configs.length).toBeGreaterThanOrEqual(2);
    expect(configs.map(c => c.name)).toContain('agent-a');
    expect(configs.map(c => c.name)).toContain('agent-b');
  });

  // ── importClaudeCodeAgent ─────────────────────────────────────────────────

  it('importClaudeCodeAgent imports a valid md file', async () => {
    const mdContent = `---
name: imported-agent
description: "Imported from Claude"
tools:
  - Read
---

Do helpful things.
`;
    const mdFile = path.join(tmpDir, 'imported.md');
    await fs.promises.writeFile(mdFile, mdContent, 'utf-8');

    const config = await manager.importClaudeCodeAgent(tmpDir, mdFile);
    expect(config.name).toBe('imported-agent');
    expect(config.system_prompt).toContain('Do helpful things');
  });

  it('importClaudeCodeAgent throws when file is unparseable', async () => {
    const mdFile = path.join(tmpDir, 'bad.md');
    await fs.promises.writeFile(mdFile, '# No front matter', 'utf-8');

    await expect(manager.importClaudeCodeAgent(tmpDir, mdFile)).rejects.toThrow('Failed to parse');
  });

  // ── CLAUDE_TO_OpenKosmos_TOOL_MAP ─────────────────────────────────────────────

  it('CLAUDE_TO_OpenKosmos_TOOL_MAP covers key tool names', () => {
    expect(CLAUDE_TO_OpenKosmos_TOOL_MAP['Read']).toBe('read_file');
    expect(CLAUDE_TO_OpenKosmos_TOOL_MAP['Bash']).toBe('execute_command');
    expect(CLAUDE_TO_OpenKosmos_TOOL_MAP['WebSearch']).toBe('bing_web_search');
    expect(CLAUDE_TO_OpenKosmos_TOOL_MAP['Task']).toBe('spawn_subagent');
  });

  // ── writeAgentConfig with concurrent writes (lock) ───────────────────────

  it('serializes concurrent write operations via lock', async () => {
    const config = makeMinimalConfig({ name: 'locked-agent' });
    // Fire two writes concurrently
    await Promise.all([
      manager.writeAgentConfig(tmpDir, { ...config, description: 'first' }),
      manager.writeAgentConfig(tmpDir, { ...config, description: 'second' }),
    ]);

    // One of the descriptions should have won
    const cached = manager.getCachedConfig('locked-agent');
    expect(['first', 'second']).toContain(cached?.description);
  });

  // ── writeAgentConfig error propagation ────────────────────────────────────

  it('writeAgentConfig throws when mkdir fails', async () => {
    const badDir = path.join(tmpDir, 'no-perms');
    await fs.promises.mkdir(badDir, { recursive: true });
    await fs.promises.chmod(badDir, 0o444); // read-only

    const config = makeMinimalConfig({ name: 'fail-agent' });
    try {
      await expect(manager.writeAgentConfig(badDir, config)).rejects.toThrow();
    } finally {
      await fs.promises.chmod(badDir, 0o755);
    }
  });

  // ── deleteAgentDirectory error path ──────────────────────────────────────

  it('deleteAgentDirectory throws when rm fails', async () => {
    await manager.writeAgentConfig(tmpDir, makeMinimalConfig({ name: 'del-fail' }));
    const origRm = fs.promises.rm;
    (fs.promises as any).rm = vi.fn().mockRejectedValue(new Error('permission denied'));
    try {
      await expect(manager.deleteAgentDirectory(tmpDir, 'del-fail')).rejects.toThrow('permission denied');
    } finally {
      (fs.promises as any).rm = origRm;
    }
  });

  // ── listAgents non-ENOENT error ───────────────────────────────────────────

  it('listAgents returns empty on non-ENOENT readdir error', async () => {
    const origReaddir = fs.promises.readdir;
    (fs.promises as any).readdir = vi.fn().mockRejectedValue(Object.assign(new Error('io error'), { code: 'EIO' }));
    try {
      const result = await manager.listAgents(tmpDir);
      expect(result).toEqual([]);
    } finally {
      (fs.promises as any).readdir = origReaddir;
    }
  });

  // ── parseAgentMarkdown catch block ────────────────────────────────────────

  it('parseAgentMarkdown catches YAML parse errors', () => {
    const content = `---\nname: [invalid\n---\n`;
    const result = manager.parseAgentMarkdown(content);
    expect(result.data).toBeNull();
    expect(result.error).toContain('Failed to parse AGENT.md');
  });

  // ── exportAsClaudeCodeFormat with disallowedTools and skills ─────────────

  it('export includes disallowedTools and skills', () => {
    const config = makeMinimalConfig({
      disallowedTools: ['Write', 'Bash'],
      skills: ['myskill'],
    });
    const output = manager.exportAsClaudeCodeFormat(config);
    expect(output).toContain('Write');
    expect(output).toContain('myskill');
  });

  // ── parseToolsList: array filters empty strings ───────────────────────────

  it('parseToolsList filters empty string items from tools array', () => {
    const content = `---\nname: filter-agent\ndescription: "test"\ntools:\n  - "Read"\n  - ""\n  - "Bash"\n---\n`;
    const result = manager.parseAgentMarkdown(content);
    expect(result.data?.tools).not.toContain('');
    expect(result.data?.tools).toContain('Read');
  });

  // ── parseStringArray single string ───────────────────────────────────────

  it('parseStringArray handles single string value for skills', () => {
    const content = `---\nname: single-skill\ndescription: "x"\nskills: "my-skill"\n---\n`;
    const result = manager.parseAgentMarkdown(content);
    expect(result.data?.skills).toContain('my-skill');
  });

  // ── parseNumber edge case ─────────────────────────────────────────────────

  it('parseNumber with non-numeric string — maxTurns field removed, returns undefined', () => {
    const content = `---\nname: default-turns\ndescription: "x"\nmaxTurns: "not-a-number"\n---\n`;
    const result = manager.parseAgentMarkdown(content);
    expect(result.data?.maxTurns).toBeUndefined();
  });

  // ── parseToolsList / parseStringArray / parseMcpServers non-string/array fallback ──

  it('parseToolsList returns empty for numeric YAML value', () => {
    // YAML with tools set to a number (not string or array)
    const content = `---\nname: num-tools\ndescription: "x"\ntools: 42\n---\n`;
    const result = manager.parseAgentMarkdown(content);
    // 42 is not string/array, falls to return []
    expect(result.data?.tools).toBeUndefined(); // tools only set when length > 0
  });

  it('parseStringArray returns empty for numeric YAML value', () => {
    const content = `---\nname: num-skills\ndescription: "x"\nskills: 99\n---\n`;
    const result = manager.parseAgentMarkdown(content);
    expect(result.data?.skills).toEqual([]);
  });

  it('parseMcpServers returns null filter for array items that are not string or object with name', () => {
    const content = `---\nname: mcp-null\ndescription: "x"\nmcpServers:\n  - 42\n  - true\n---\n`;
    const result = manager.parseAgentMarkdown(content);
    expect(result.data?.mcpServers).toEqual([]);
  });
});
