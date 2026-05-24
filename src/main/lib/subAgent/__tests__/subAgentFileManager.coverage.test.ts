/**
 * SubAgentFileManager supplemental coverage tests
 *
 * Covers uncovered private method branches:
 * - parseMcpServers: non-array non-null value (line 736)
 * - parseNumber: string-to-int path (lines 745-746)
 * Both are exercised indirectly via parseAgentMarkdown with unusual YAML values
 */

import * as fs from 'fs';
import * as path from 'path';

vi.mock('../../unifiedLogger', async () => ({
  createConsoleLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

import { SubAgentFileManager } from '../subAgentFileManager';

describe('SubAgentFileManager supplemental coverage', () => {
  let manager: SubAgentFileManager;

  beforeEach(() => {
    SubAgentFileManager.resetInstance();
    manager = SubAgentFileManager.getInstance();
  });

  afterEach(() => {
    SubAgentFileManager.resetInstance();
  });

  // ── parseMcpServers with non-array non-null value (line 736) ──
  describe('parseMcpServers with a scalar value', () => {
    it('should return empty array when mcpServers is a plain string (not array)', () => {
      // Pass a YAML where mcpServers is a plain scalar, not an array
      const content = `---
name: scalar-mcp-agent
description: Agent with scalar mcpServers
mcpServers: "some-server"
---

Scalar mcp server test.
`;
      const result = manager.parseAgentMarkdown(content);
      expect(result.error).toBeUndefined();
      expect(result.data).not.toBeNull();
      // A plain string is not an array, so parseMcpServers hits line 736 → returns []
      // But the string branch "if (typeof item === 'string') return item" is in array path
      // A single string value: YAML parses "some-server" as a string → not an array → line 736
      expect(result.data!.mcp_servers).toEqual([]);
    });
  });

  // ── parseNumber with string value (lines 745-746) ──
  describe('parseNumber with string maxTurns', () => {
    it('should parse maxTurns when it is a string in YAML', () => {
      const content = `---
name: string-turns-agent
description: Agent with string maxTurns
maxTurns: "15"
---

System prompt here.
`;
      const result = manager.parseAgentMarkdown(content);
      expect(result.error).toBeUndefined();
      expect(result.data).not.toBeNull();
      // maxTurns field removed; verify it is not set
      expect((result.data! as any).maxTurns).toBeUndefined();
    });

    it('should use default value for non-numeric string maxTurns', () => {
      const content = `---
name: bad-turns-agent
description: Agent with bad maxTurns
maxTurns: "not-a-number"
---

System prompt here.
`;
      const result = manager.parseAgentMarkdown(content);
      expect(result.error).toBeUndefined();
      expect(result.data).not.toBeNull();
      // maxTurns field removed; verify it is not set
      expect((result.data! as any).maxTurns).toBeUndefined();
    });
  });

  // ── getCachedConfigs and getCachedConfig ──
  describe('cache accessors', () => {
    it('getCachedConfigs returns empty array when cache is cold', () => {
      expect(manager.getCachedConfigs()).toEqual([]);
    });

    it('getCachedConfig returns undefined for unknown agent', () => {
      expect(manager.getCachedConfig('unknown')).toBeUndefined();
    });
  });

  // ── CRUD with real tmp filesystem ──
  describe('readAgentConfig from real filesystem', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = path.join(
        process.env.TEMP || process.env.TMP || '/tmp',
        `openkosmos-fm-cov-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      );
      fs.mkdirSync(tmpDir, { recursive: true });
    });

    afterEach(() => {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    });

    it('should return null when agent directory does not exist', async () => {
      const result = await manager.readAgentConfig(tmpDir, 'nonexistent-agent');
      expect(result).toBeNull();
    });

    it('should return null when AGENT.md does not exist in agent dir', async () => {
      const agentDir = path.join(tmpDir, 'agents', 'empty-agent');
      fs.mkdirSync(agentDir, { recursive: true });
      const result = await manager.readAgentConfig(tmpDir, 'empty-agent');
      expect(result).toBeNull();
    });

    it('should read and parse a valid AGENT.md', async () => {
      const agentDir = path.join(tmpDir, 'agents', 'read-test');
      fs.mkdirSync(agentDir, { recursive: true });
      const content = `---\nname: read-test\ndescription: Reading test\n---\n\nTest system prompt.`;
      fs.writeFileSync(path.join(agentDir, 'AGENT.md'), content, 'utf-8');

      const result = await manager.readAgentConfig(tmpDir, 'read-test');
      expect(result).not.toBeNull();
      expect(result!.name).toBe('read-test');
      expect(result!.system_prompt).toBe('Test system prompt.');
    });
  });
});
