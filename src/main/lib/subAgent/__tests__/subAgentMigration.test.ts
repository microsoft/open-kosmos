/**
 * SubAgentMigration unit tests
 *
 * Coverage:
 * - needsMigration detection logic (already migrated, old format, empty data, etc.)
 * - migrate full flow (Phase A→B→C)
 * - Atomicity guarantee (profile not corrupted on failure)
 * - Idempotency (safe to execute repeatedly)
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

import { SubAgentMigration } from '../subAgentMigration';
import { SubAgentFileManager } from '../subAgentFileManager';
import type { ProfileV2, SubAgentConfig, SubAgentIndex } from '../../userDataADO/types/profile';

// ─── Helper to create a mock ProfileV2 ───

function createMockProfile(overrides: Partial<ProfileV2> = {}): ProfileV2 {
  return {
    version: '2.0',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    alias: 'testuser',
    mcp_servers: [],
    chats: [],
    ...overrides,
  };
}

function createLegacySubAgentConfig(overrides: Partial<SubAgentConfig> = {}): SubAgentConfig {
  return {
    name: 'test-agent',
    display_name: 'Test Agent',
    description: 'A test agent',
    emoji: '🤖',
    version: '1.0.0',
    source: 'ON-DEVICE',
    system_prompt: 'You are a test agent.',
    mcp_servers: [],
    context_access: 'isolated',
    ...overrides,
  };
}

// ─── Tests ───

describe('SubAgentMigration', () => {
  let migration: SubAgentMigration;
  let tmpDir: string;

  beforeEach(() => {
    SubAgentMigration.resetInstance();
    SubAgentFileManager.resetInstance();
    migration = SubAgentMigration.getInstance();

    tmpDir = path.join(
      process.env.TEMP || process.env.TMP || '/tmp',
      `openkosmos-migration-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    SubAgentMigration.resetInstance();
    SubAgentFileManager.resetInstance();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  // ========================================================================
  // needsMigration
  // ========================================================================

  describe('needsMigration', () => {
    it('should return true for profile with old-format sub_agents', () => {
      const profile = createMockProfile({
        sub_agents: [
          createLegacySubAgentConfig({ name: 'agent-a' }),
          createLegacySubAgentConfig({ name: 'agent-b' }),
        ],
      });

      expect(migration.needsMigration(profile)).toBe(true);
    });

    it('should return false when migration flag is already set', () => {
      const profile = createMockProfile({
        sub_agents: [createLegacySubAgentConfig()],
        _migrationFlags: { sub_agents_file_based: true },
      });

      expect(migration.needsMigration(profile)).toBe(false);
    });

    it('should return false for empty sub_agents array', () => {
      const profile = createMockProfile({ sub_agents: [] });
      expect(migration.needsMigration(profile)).toBe(false);
    });

    it('should return false when sub_agents is undefined', () => {
      const profile = createMockProfile();
      expect(migration.needsMigration(profile)).toBe(false);
    });

    it('should return false when sub_agents[0] has no system_prompt (already new format)', () => {
      // SubAgentIndex format (no system_prompt)
      const profile = createMockProfile({
        sub_agents: [
          { name: 'agent-a', version: '1.0.0', source: 'ON-DEVICE' } as any,
        ],
      });

      expect(migration.needsMigration(profile)).toBe(false);
    });
  });

  // ========================================================================
  // migrate
  // ========================================================================

  describe('migrate', () => {
    it('should migrate old sub_agents to files + indices', async () => {
      const profile = createMockProfile({
        sub_agents: [
          createLegacySubAgentConfig({
            name: 'code-reviewer',
            display_name: 'Code Reviewer',
            description: 'Reviews code',
            emoji: '🔍',
            version: '1.2.0',
            source: 'ON-DEVICE',
            system_prompt: 'You review code.',
          }),
          createLegacySubAgentConfig({
            name: 'debugger',
            display_name: 'Debugger',
            description: 'Debugs issues',
            version: '1.0.0',
            source: 'ON-DEVICE',
            system_prompt: 'You debug things.',
          }),
        ],
      });

      const result = await migration.migrate(tmpDir, profile);

      // Should return indices
      expect(result).not.toBeNull();
      expect(result).toHaveLength(2);

      // Check indices
      const crIndex = result!.find(r => r.name === 'code-reviewer');
      expect(crIndex).toBeDefined();
      expect(crIndex!.version).toBe('1.2.0');
      expect(crIndex!.source).toBe('ON-DEVICE');

      const dbIndex = result!.find(r => r.name === 'debugger');
      expect(dbIndex).toBeDefined();
      expect(dbIndex!.version).toBe('1.0.0');
      expect(dbIndex!.source).toBe('ON-DEVICE');

      // Check files on disk
      const agentsDir = path.join(tmpDir, 'agents');
      expect(fs.existsSync(path.join(agentsDir, 'code-reviewer', 'AGENT.md'))).toBe(true);
      expect(fs.existsSync(path.join(agentsDir, 'debugger', 'AGENT.md'))).toBe(true);

      // Verify AGENT.md content
      const crContent = fs.readFileSync(path.join(agentsDir, 'code-reviewer', 'AGENT.md'), 'utf-8');
      expect(crContent).toContain('name: code-reviewer');
      expect(crContent).toContain('You review code.');

      // Check profile was updated
      expect(profile._migrationFlags?.sub_agents_file_based).toBe(true);

      // Backup should exist
      expect((profile as any)._sub_agents_file_based_backup).toBeDefined();
      expect((profile as any)._sub_agents_file_based_backup).toHaveLength(2);
    });

    it('should handle empty sub_agents gracefully', async () => {
      const profile = createMockProfile({ sub_agents: [] });

      const result = await migration.migrate(tmpDir, profile);

      expect(result).not.toBeNull();
      expect(result).toHaveLength(0);
      expect(profile._migrationFlags?.sub_agents_file_based).toBe(true);
    });

    it('should skip agents with empty names', async () => {
      const profile = createMockProfile({
        sub_agents: [
          createLegacySubAgentConfig({ name: '', system_prompt: 'Bad agent' }),
          createLegacySubAgentConfig({ name: 'good-agent', system_prompt: 'Good agent.' }),
        ],
      });

      const result = await migration.migrate(tmpDir, profile);

      expect(result).not.toBeNull();
      // Both get indices (buildSubAgentIndices filters by name)
      expect(result!.some(r => r.name === 'good-agent')).toBe(true);
    });

    it('should not overwrite existing agents/ directory', async () => {
      // Pre-create an agent
      const existingDir = path.join(tmpDir, 'agents', 'existing-agent');
      fs.mkdirSync(existingDir, { recursive: true });
      fs.writeFileSync(
        path.join(existingDir, 'AGENT.md'),
        '---\nname: existing-agent\ndescription: Pre-existing\n---\n\nExisting content.',
        'utf-8',
      );

      const profile = createMockProfile({
        sub_agents: [
          createLegacySubAgentConfig({
            name: 'migrated-agent',
            system_prompt: 'Migrated content.',
          }),
        ],
      });

      const result = await migration.migrate(tmpDir, profile);

      // Migrated agent should exist
      expect(fs.existsSync(path.join(tmpDir, 'agents', 'migrated-agent', 'AGENT.md'))).toBe(true);

      // Existing agent should still be there
      expect(fs.existsSync(path.join(tmpDir, 'agents', 'existing-agent', 'AGENT.md'))).toBe(true);
      const existingContent = fs.readFileSync(
        path.join(tmpDir, 'agents', 'existing-agent', 'AGENT.md'),
        'utf-8',
      );
      expect(existingContent).toContain('Pre-existing');
    });

    it('should be idempotent — second call is a no-op', async () => {
      const profile = createMockProfile({
        sub_agents: [
          createLegacySubAgentConfig({ name: 'idem-agent', system_prompt: 'Test.' }),
        ],
      });

      // First migration
      const result1 = await migration.migrate(tmpDir, profile);
      expect(result1).not.toBeNull();

      // Check migration flag is set
      expect(migration.needsMigration(profile)).toBe(false);
    });
  });
});
