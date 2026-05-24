/**
 * SubAgentMigration supplemental coverage tests
 *
 * Covers uncovered lines:
 * - migrate() failure path (catch block lines 139-141) — Phase A write error
 * - phaseB_renameTmpToFinal — skip path when destination already exists (line 190)
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

import { SubAgentMigration } from '../subAgentMigration';
import { SubAgentFileManager } from '../subAgentFileManager';
import type { ProfileV2, SubAgentConfig } from '../../userDataADO/types/profile';

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
    description: 'A test agent',
    system_prompt: 'You are a test agent.',
    mcp_servers: [],
    ...overrides,
  };
}

describe('SubAgentMigration supplemental coverage', () => {
  let migration: SubAgentMigration;
  let tmpDir: string;

  beforeEach(() => {
    SubAgentMigration.resetInstance();
    SubAgentFileManager.resetInstance();
    migration = SubAgentMigration.getInstance();

    tmpDir = path.join(
      process.env.TEMP || process.env.TMP || '/tmp',
      `openkosmos-migration-cov-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    SubAgentMigration.resetInstance();
    SubAgentFileManager.resetInstance();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch { /* ignore */ }
  });

  describe('migrate() failure path (catch block)', () => {
    it('should return null when serializeToAgentMarkdown throws and leave profile unchanged', async () => {
      const profile = createMockProfile({
        sub_agents: [
          createLegacySubAgentConfig({ name: 'fail-agent', system_prompt: 'Fail.' }),
        ],
      });

      // Mock the fileManager's serialize to throw
      const fileManagerInstance = SubAgentFileManager.getInstance();
      vi.spyOn(fileManagerInstance, 'serializeToAgentMarkdown').mockImplementation(() => {
        throw new Error('Serialization failed');
      });

      const result = await migration.migrate(tmpDir, profile);

      // Should return null on failure
      expect(result).toBeNull();
      // Profile should not have migration flag set
      expect(profile._migrationFlags?.sub_agents_file_based).not.toBe(true);
    });
  });

  describe('phaseB merge — skip existing agent (line 190)', () => {
    it('should skip agent directories that already exist in agents/', async () => {
      // Pre-create an existing agent directory in agents/ AND agents_migration_tmp/
      const agentsDir = path.join(tmpDir, 'agents');
      const existingAgentDir = path.join(agentsDir, 'code-reviewer');
      fs.mkdirSync(existingAgentDir, { recursive: true });
      fs.writeFileSync(
        path.join(existingAgentDir, 'AGENT.md'),
        '---\nname: code-reviewer\n---\n\nOriginal content.',
        'utf-8',
      );

      const profile = createMockProfile({
        sub_agents: [
          createLegacySubAgentConfig({
            name: 'code-reviewer',
            system_prompt: 'New migrated content.',
          }),
        ],
      });

      const result = await migration.migrate(tmpDir, profile);

      expect(result).not.toBeNull();
      // The existing agent directory content should be preserved (not overwritten)
      const content = fs.readFileSync(
        path.join(agentsDir, 'code-reviewer', 'AGENT.md'),
        'utf-8',
      );
      // Original content should still be there (skip, not overwrite)
      expect(content).toContain('Original content.');
    });
  });
});
