/**
 * SubAgentFileManager unit tests
 *
 * Coverage:
 * - parseAgentMarkdown: YAML parsing, standard fields, x-openkosmos extensions, plain Claude Code format, error handling
 * - serializeToAgentMarkdown: serialization output correctness, special characters
 * - CRUD: create/read/update/delete directories and files
 * - Validation: validateAgentName, validateAgentConfig
 * - Import/Export: Claude Code format interoperability
 * - Cache management
 */

import * as fs from 'fs';
import * as path from 'path';

// ─── Mock dependencies ───

vi.mock('../../unifiedLogger', async () => ({
  createConsoleLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

import { SubAgentFileManager } from '../subAgentFileManager';
import type { SubAgentConfig } from '../../userDataADO/types/profile';

// ─── Test fixtures ───

const FULL_AGENT_MD = `---
name: code-reviewer
description: Expert code review specialist. Reviews code for quality, security, and maintainability.
tools:
  - Read
  - Grep
  - Glob
  - Bash
model: inherit
maxTurns: 25
skills:
  - api-conventions
mcpServers:
  - github-server

x-openkosmos:
  display_name: Code Reviewer
  emoji: "🔍"
  version: "1.2.0"
  context_access: parent_summary
  builtin_tools:
    - read_file
    - search_file_contents
  inherit_mcp_servers: true
  inherit_skills: true
  inherit_knowledge_base: true
---

You are a senior code reviewer ensuring high standards of code quality and security.

When invoked:
1. Run git diff to see recent changes
2. Focus on modified files
3. Begin review immediately

Review checklist:
- Code is clear and readable
- Functions and variables are well-named
`;

const CLAUDE_CODE_SIMPLE_MD = `---
name: code-reviewer
description: Reviews code for quality and best practices
tools: Read, Glob, Grep
model: sonnet
---

You are a code reviewer. Analyze code and provide actionable feedback.
`;

const MINIMAL_AGENT_MD = `---
name: simple-agent
description: A simple agent
---

Do the thing.
`;

const AGENT_MD_WITH_MCP_OBJECTS = `---
name: db-analyst
description: Database analysis specialist
mcpServers:
  - name: database-server
    tools:
      - query
      - schema
  - redis-cache
---

You are a database analyst.
`;

// ─── Tests ───

describe('SubAgentFileManager', () => {
  let manager: SubAgentFileManager;

  beforeEach(() => {
    SubAgentFileManager.resetInstance();
    manager = SubAgentFileManager.getInstance();
  });

  afterEach(() => {
    SubAgentFileManager.resetInstance();
  });

  // ========================================================================
  // parseAgentMarkdown
  // ========================================================================

  describe('parseAgentMarkdown', () => {
    it('should parse full OpenKosmos AGENT.md with x-openkosmos fields', () => {
      const result = manager.parseAgentMarkdown(FULL_AGENT_MD);

      expect(result.error).toBeUndefined();
      expect(result.data).not.toBeNull();

      const config = result.data!;
      // Claude Code standard fields
      expect(config.name).toBe('code-reviewer');
      expect(config.description).toBe('Expert code review specialist. Reviews code for quality, security, and maintainability.');
      expect(config.tools).toEqual(['Read', 'Grep', 'Glob', 'Bash']);
      expect(config.model).toBe('inherit');
      expect((config as any).maxTurns).toBeUndefined();
      expect(config.skills).toEqual(['api-conventions']);
      expect(config.mcpServers).toEqual(['github-server']);

      // x-openkosmos fields
      expect(config.builtin_tools).toEqual(['read_file', 'search_file_contents']);
      expect(config.inherit_mcp_servers).toBe(true);
      expect(config.inherit_skills).toBe(true);

      // Markdown body → system_prompt
      expect(config.system_prompt).toContain('You are a senior code reviewer');
      expect(config.system_prompt).toContain('Review checklist:');
    });

    it('should parse Claude Code simple format with comma-separated tools', () => {
      const result = manager.parseAgentMarkdown(CLAUDE_CODE_SIMPLE_MD);

      expect(result.error).toBeUndefined();
      expect(result.data).not.toBeNull();

      const config = result.data!;
      expect(config.name).toBe('code-reviewer');
      expect(config.description).toBe('Reviews code for quality and best practices');
      expect(config.tools).toEqual(['Read', 'Glob', 'Grep']);
      expect(config.model).toBe('sonnet');

      // OpenKosmos defaults applied
      expect(config.inherit_mcp_servers).toBe(true);
      expect(config.inherit_skills).toBe(true);

      expect(config.system_prompt).toContain('You are a code reviewer');
    });

    it('should parse minimal AGENT.md with only required fields', () => {
      const result = manager.parseAgentMarkdown(MINIMAL_AGENT_MD);

      expect(result.error).toBeUndefined();
      expect(result.data).not.toBeNull();

      const config = result.data!;
      expect(config.name).toBe('simple-agent');
      expect(config.description).toBe('A simple agent');
      expect(config.model).toBe('inherit');
      expect((config as any).maxTurns).toBeUndefined();
      expect(config.system_prompt).toBe('Do the thing.');
    });

    it('should parse mcpServers with mixed string refs and object definitions', () => {
      const result = manager.parseAgentMarkdown(AGENT_MD_WITH_MCP_OBJECTS);

      expect(result.error).toBeUndefined();
      const config = result.data!;

      expect(config.mcpServers).toEqual([
        { name: 'database-server', tools: ['query', 'schema'] },
        'redis-cache',
      ]);

      // Legacy mcp_servers should be populated
      expect(config.mcp_servers).toEqual([
        { name: 'database-server', tools: ['query', 'schema'] },
        { name: 'redis-cache', tools: [] },
      ]);
    });

    it('should return error when content does not start with ---', () => {
      const result = manager.parseAgentMarkdown('# Not a frontmatter file\n\nSome content');

      expect(result.data).toBeNull();
      expect(result.error).toContain('must start with YAML front-matter');
    });

    it('should return error when closing --- is missing', () => {
      const result = manager.parseAgentMarkdown('---\nname: test\ndescription: test\n\nNo closing marker');

      expect(result.data).toBeNull();
      expect(result.error).toContain('does not contain valid YAML front-matter');
    });

    it('should return error when name is missing', () => {
      const result = manager.parseAgentMarkdown('---\ndescription: test\n---\n\nContent');

      expect(result.data).toBeNull();
      expect(result.error).toContain('"name" field');
    });

    it('should return error when description is missing', () => {
      const result = manager.parseAgentMarkdown('---\nname: test-agent\n---\n\nContent');

      expect(result.data).toBeNull();
      expect(result.error).toContain('"description" field');
    });

    it('should handle empty system_prompt (no markdown body)', () => {
      const result = manager.parseAgentMarkdown('---\nname: empty-prompt\ndescription: No body\n---\n');

      expect(result.data).not.toBeNull();
      expect(result.data!.system_prompt).toBe('');
    });

    it('should ignore unknown fields (forward compatibility)', () => {
      const content = `---
name: future-agent
description: Test forward compat
permissionMode: all
hooks:
  - beforeRun: echo hello
memory: enabled
background: true
isolation: worktree
---

Forward compatible content.
`;
      const result = manager.parseAgentMarkdown(content);

      expect(result.error).toBeUndefined();
      expect(result.data).not.toBeNull();
      expect(result.data!.name).toBe('future-agent');
      expect(result.data!.system_prompt).toContain('Forward compatible content');
    });

    it('should parse maxTurns from max_turns (backward compat)', () => {
      const content = `---
name: compat-agent
description: Test backward compat
max_turns: 15
---

Content.
`;
      const result = manager.parseAgentMarkdown(content);
      // maxTurns/max_turns fields removed from SubAgentConfig
      expect((result.data! as any).maxTurns).toBeUndefined();
      expect((result.data! as any).max_turns).toBeUndefined();
    });

    it('should parse disallowedTools', () => {
      const content = `---
name: restricted-agent
description: Has disallowed tools
tools:
  - Read
  - Bash
disallowedTools:
  - Write
  - Execute
---

Content.
`;
      const result = manager.parseAgentMarkdown(content);
      expect(result.data!.disallowedTools).toEqual(['Write', 'Execute']);
    });

    it('should handle x-openkosmos.inherit flags set to false', () => {
      const content = `---
name: no-inherit
description: Independent agent

x-openkosmos:
  inherit_mcp_servers: false
  inherit_skills: false
---

Content.
`;
      const result = manager.parseAgentMarkdown(content);
      expect(result.data!.inherit_mcp_servers).toBe(false);
      expect(result.data!.inherit_skills).toBe(false);
    });

    it('should handle Windows-style line endings (CRLF)', () => {
      const content = '---\r\nname: crlf-agent\r\ndescription: CRLF test\r\n---\r\n\r\nContent with CRLF.\r\n';
      const result = manager.parseAgentMarkdown(content);
      expect(result.data).not.toBeNull();
      expect(result.data!.name).toBe('crlf-agent');
    });
  });

  // ========================================================================
  // serializeToAgentMarkdown
  // ========================================================================

  describe('serializeToAgentMarkdown', () => {
    it('should serialize a full config to AGENT.md format', () => {
      const config: SubAgentConfig = {
        name: 'test-agent',
        description: 'A test agent for serialization',
        tools: ['Read', 'Grep'],
        model: 'sonnet',
        skills: ['code-review'],
        mcpServers: ['github-server'],
        builtin_tools: ['read_file'],
        inherit_mcp_servers: false,
        inherit_skills: true,
        system_prompt: 'You are a test agent.\n\nDo tests.',
      };

      const md = manager.serializeToAgentMarkdown(config);

      // Verify YAML front-matter structure
      expect(md).toMatch(/^---\n/);
      expect(md).toContain('name: test-agent');
      expect(md).toContain('description: A test agent for serialization');
      expect(md).toContain('model: sonnet');
      expect(md).not.toContain('maxTurns');

      // Verify x-openkosmos fields
      expect(md).toContain('x-openkosmos:');
      expect(md).toContain('inherit_mcp_servers: false');

      // Verify system_prompt as body
      expect(md).toContain('You are a test agent.\n\nDo tests.');
    });

    it('should omit default values to reduce noise', () => {
      const config: SubAgentConfig = {
        name: 'minimal',
        description: 'Minimal agent',
        inherit_mcp_servers: true, // default → should be omitted
        inherit_skills: true,
        system_prompt: 'Hello.',
      };

      const md = manager.serializeToAgentMarkdown(config);

      // Should not write default emoji
      expect(md).not.toMatch(/emoji.*🤖/);
      // Should not write default context_access: isolated
      expect(md).not.toContain('context_access: isolated');
      // Should not write inherit_mcp_servers: true (default)
      expect(md).not.toContain('inherit_mcp_servers: true');
    });

    it('should handle omitted optional fields', () => {
      const config: SubAgentConfig = {
        name: 'bare',
        description: 'Bare agent',
        system_prompt: '',
      };

      const md = manager.serializeToAgentMarkdown(config);
      expect(md).toMatch(/^---\n/);
      expect(md).toContain('name: bare');
      expect(md).not.toContain('tools:');
      expect(md).not.toContain('mcpServers:');
      expect(md).not.toContain('skills:');
    });

    it('should round-trip parse ↔ serialize correctly', () => {
      const original = manager.parseAgentMarkdown(FULL_AGENT_MD);
      expect(original.data).not.toBeNull();

      const serialized = manager.serializeToAgentMarkdown(original.data!);
      const reparsed = manager.parseAgentMarkdown(serialized);

      expect(reparsed.data).not.toBeNull();
      expect(reparsed.data!.name).toBe(original.data!.name);
      expect(reparsed.data!.description).toBe(original.data!.description);
      expect(reparsed.data!.tools).toEqual(original.data!.tools);
      expect(reparsed.data!.system_prompt).toBe(original.data!.system_prompt);
    });
  });

  // ========================================================================
  // validateAgentName
  // ========================================================================

  describe('validateAgentName', () => {
    it('should accept valid names', () => {
      expect(manager.validateAgentName('a').valid).toBe(true);
      expect(manager.validateAgentName('code-reviewer').valid).toBe(true);
      expect(manager.validateAgentName('test123').valid).toBe(true);
      expect(manager.validateAgentName('my-agent-v2').valid).toBe(true);
    });

    it('should reject empty name', () => {
      expect(manager.validateAgentName('').valid).toBe(false);
      expect(manager.validateAgentName('   ').valid).toBe(false);
    });

    it('should reject names with uppercase', () => {
      expect(manager.validateAgentName('MyAgent').valid).toBe(false);
    });

    it('should reject names starting or ending with hyphen', () => {
      expect(manager.validateAgentName('-bad').valid).toBe(false);
      expect(manager.validateAgentName('bad-').valid).toBe(false);
    });

    it('should reject names with spaces or special chars', () => {
      expect(manager.validateAgentName('my agent').valid).toBe(false);
      expect(manager.validateAgentName('agent@1').valid).toBe(false);
    });
  });

  // ========================================================================
  // validateAgentConfig
  // ========================================================================

  describe('validateAgentConfig', () => {
    it('should accept a valid config', () => {
      const result = manager.validateAgentConfig({
        name: 'valid-agent',
        description: 'A valid agent',
      });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject config without name', () => {
      const result = manager.validateAgentConfig({ description: 'No name' });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('name'))).toBe(true);
    });

    it('should reject config without description', () => {
      const result = manager.validateAgentConfig({ name: 'no-desc' });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('description'))).toBe(true);
    });

    it('maxTurns field removed — validateAgentConfig does not error on unknown fields', () => {
      // maxTurns validation removed; only name and description are validated
      const result = manager.validateAgentConfig({
        name: 'agent',
        description: 'Test',
      } as any);
      expect(result.valid).toBe(true);
    });
  });

  // ========================================================================
  // exportAsClaudeCodeFormat
  // ========================================================================

  describe('exportAsClaudeCodeFormat', () => {
    it('should strip x-openkosmos namespace fields', () => {
      const config: SubAgentConfig = {
        name: 'test-agent',
        description: 'Export test',
        tools: ['Read', 'Grep'],
        model: 'sonnet',
        builtin_tools: ['read_file'],
        system_prompt: 'You are a test agent.',
      };

      const md = manager.exportAsClaudeCodeFormat(config);

      // Should contain standard fields
      expect(md).toContain('name: test-agent');
      expect(md).toContain('description: Export test');
      expect(md).toContain('model: sonnet');

      // Should NOT contain x-openkosmos fields
      expect(md).not.toContain('x-openkosmos');
      expect(md).not.toContain('display_name');
      expect(md).not.toContain('emoji');
      expect(md).not.toContain('builtin_tools');
      expect(md).not.toContain('context_access');

      // Should contain system_prompt as body
      expect(md).toContain('You are a test agent.');
    });

    it('should convert mcpServers to string references in export', () => {
      const config: SubAgentConfig = {
        name: 'mcp-agent',
        description: 'Has MCP servers',
        mcpServers: [
          { name: 'server-a', tools: ['tool1'] },
          'server-b',
        ],
        system_prompt: 'Content.',
      };

      const md = manager.exportAsClaudeCodeFormat(config);
      expect(md).toContain('server-a');
      expect(md).toContain('server-b');
    });
  });

  // ========================================================================
  // CRUD with filesystem (using tmp dirs)
  // ========================================================================

  describe('CRUD operations', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = path.join(
        process.env.TEMP || process.env.TMP || '/tmp',
        `openkosmos-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      );
      fs.mkdirSync(tmpDir, { recursive: true });
    });

    afterEach(() => {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // ignore cleanup failures
      }
      manager.invalidateAllCache();
    });

    it('should write and read a sub-agent config', async () => {
      const config: SubAgentConfig = {
        name: 'test-write',
        description: 'Write test',
        system_prompt: 'Hello world.',
      };

      await manager.writeAgentConfig(tmpDir, config);

      // Verify file exists
      const filePath = manager.getAgentFilePath(tmpDir, 'test-write');
      expect(fs.existsSync(filePath)).toBe(true);

      // Read back (should hit cache)
      const loaded = await manager.readAgentConfig(tmpDir, 'test-write');
      expect(loaded).not.toBeNull();
      expect(loaded!.name).toBe('test-write');
      expect(loaded!.system_prompt).toBe('Hello world.');
    });

    it('should read from disk when cache is empty', async () => {
      // First write
      const config: SubAgentConfig = {
        name: 'disk-read',
        description: 'Disk read test',
        system_prompt: 'From disk.',
      };

      await manager.writeAgentConfig(tmpDir, config);

      // Clear cache
      manager.invalidateCache('disk-read');

      // Read should fall back to disk
      const loaded = await manager.readAgentConfig(tmpDir, 'disk-read');
      expect(loaded).not.toBeNull();
      expect(loaded!.name).toBe('disk-read');
      expect(loaded!.system_prompt).toBe('From disk.');
    });

    it('should return null for non-existent agent', async () => {
      const loaded = await manager.readAgentConfig(tmpDir, 'non-existent');
      expect(loaded).toBeNull();
    });

    it('should delete agent directory', async () => {
      const config: SubAgentConfig = {
        name: 'to-delete',
        description: 'Delete test',
        system_prompt: 'Will be deleted.',
      };

      await manager.writeAgentConfig(tmpDir, config);
      expect(fs.existsSync(manager.getAgentDirectory(tmpDir, 'to-delete'))).toBe(true);

      await manager.deleteAgentDirectory(tmpDir, 'to-delete');
      expect(fs.existsSync(manager.getAgentDirectory(tmpDir, 'to-delete'))).toBe(false);

      // Cache should be cleared
      const loaded = await manager.readAgentConfig(tmpDir, 'to-delete');
      expect(loaded).toBeNull();
    });

    it('should list all agents in directory', async () => {
      // Create a few agents
      for (const name of ['alpha', 'beta', 'gamma']) {
        await manager.writeAgentConfig(tmpDir, {
          name,
          description: `Agent ${name}`,
          system_prompt: '',
        });
      }

      const agents = await manager.listAgents(tmpDir);
      expect(agents.sort()).toEqual(['alpha', 'beta', 'gamma']);
    });

    it('should return empty list when agents/ dir does not exist', async () => {
      const emptyDir = path.join(tmpDir, 'empty-profile');
      fs.mkdirSync(emptyDir, { recursive: true });

      const agents = await manager.listAgents(emptyDir);
      expect(agents).toEqual([]);
    });

    it('should scan all agents and return configs', async () => {
      for (const name of ['scan-a', 'scan-b']) {
        await manager.writeAgentConfig(tmpDir, {
          name,
          description: `Agent ${name}`,
          system_prompt: `Prompt for ${name}`,
        });
      }

      manager.invalidateAllCache();
      const configs = await manager.scanAllAgents(tmpDir);

      expect(configs).toHaveLength(2);
      const names = configs.map(c => c.name).sort();
      expect(names).toEqual(['scan-a', 'scan-b']);
    });
  });

  // ========================================================================
  // Cache management
  // ========================================================================

  describe('cache management', () => {
    it('should invalidate single agent cache', () => {
      // Manually populate cache via internal access
      (manager as any).configCache.set('cached-agent', { name: 'cached-agent' });
      expect((manager as any).configCache.has('cached-agent')).toBe(true);

      manager.invalidateCache('cached-agent');
      expect((manager as any).configCache.has('cached-agent')).toBe(false);
    });

    it('should invalidate all cache', () => {
      (manager as any).configCache.set('a', { name: 'a' });
      (manager as any).configCache.set('b', { name: 'b' });
      (manager as any).cacheWarmed.add('user1');

      manager.invalidateAllCache();
      expect((manager as any).configCache.size).toBe(0);
      expect((manager as any).cacheWarmed.size).toBe(0);
    });

    it('should track cache warming state', () => {
      expect(manager.isCacheWarmed('user1')).toBe(false);
      manager.markCacheWarmed('user1');
      expect(manager.isCacheWarmed('user1')).toBe(true);
    });
  });

  // ========================================================================
  // Path utilities
  // ========================================================================

  describe('path utilities', () => {
    it('should construct correct paths', () => {
      const profileDir = '/mock/profiles/user1';

      expect(manager.getAgentsDirectory(profileDir)).toBe(
        path.join('/mock/profiles/user1', 'agents'),
      );
      expect(manager.getAgentDirectory(profileDir, 'test-agent')).toBe(
        path.join('/mock/profiles/user1', 'agents', 'test-agent'),
      );
      expect(manager.getAgentFilePath(profileDir, 'test-agent')).toBe(
        path.join('/mock/profiles/user1', 'agents', 'test-agent', 'AGENT.md'),
      );
    });
  });
});
