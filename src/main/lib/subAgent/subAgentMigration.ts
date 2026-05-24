/**
 * SubAgentMigration — One-time data migration
 *
 * Migrates the legacy SubAgentConfig[] format in profile.json (containing full fields like
 * system_prompt, mcp_servers, etc.) to file-system-based agents/{name}/AGENT.md +
 * lightweight SubAgentIndex[] in profile.json.
 *
 * Migration strategy: automatic, transparent, one-time.
 * Detected and executed at application startup.
 *
 * Atomicity guarantees:
 * 1. Phase A: Write all AGENT.md files to a temporary directory agents_migration_tmp/
 * 2. Phase B: After all succeed, rename to the final agents/ directory
 * 3. Phase C: Update profile.json (SubAgentConfig[] → SubAgentIndex[] + migration flag)
 * 4. If Phase A fails, clean up the temporary directory, leave profile unchanged, retry on next startup
 */

import * as fs from 'fs';
import * as path from 'path';
import { createConsoleLogger } from '../unifiedLogger';
import { SubAgentFileManager } from './subAgentFileManager';

import type {
  SubAgentConfig,
  SubAgentIndex,
  ProfileV2,
} from '../userDataADO/types/profile';

const logger = createConsoleLogger();

/** Migration flag key name */
const MIGRATION_FLAG_KEY = 'sub_agents_file_based';

/** Backup field key name (stored at the same level as _migrationFlags) */
const MIGRATION_BACKUP_KEY = '_sub_agents_file_based_backup';

/** Temporary directory name (used during migration) */
const AGENTS_TMP_DIRNAME = 'agents_migration_tmp';

/** Final directory name */
const AGENTS_DIRNAME = 'agents';

/**
 * SubAgentMigration — Singleton
 */
export class SubAgentMigration {
  private static instance: SubAgentMigration | null = null;

  private fileManager: SubAgentFileManager;

  private constructor() {
    this.fileManager = SubAgentFileManager.getInstance();
  }

  static getInstance(): SubAgentMigration {
    if (!SubAgentMigration.instance) {
      SubAgentMigration.instance = new SubAgentMigration();
    }
    return SubAgentMigration.instance;
  }

  static resetInstance(): void {
    SubAgentMigration.instance = null;
  }

  // =========================================================================
  // Detection
  // =========================================================================

  /**
   * Check whether migration is needed
   *
   * Conditions:
   * 1. _migrationFlags.sub_agents_file_based !== true
   * 2. profile.sub_agents array exists and is non-empty
   * 3. sub_agents[0] contains the system_prompt field (legacy format indicator)
   */
  needsMigration(profile: ProfileV2): boolean {
    // Already migrated
    if (profile._migrationFlags?.[MIGRATION_FLAG_KEY] === true) {
      return false;
    }

    // No sub_agents data, no migration needed
    if (!Array.isArray(profile.sub_agents) || profile.sub_agents.length === 0) {
      return false;
    }

    // Check if it is the legacy format (contains the system_prompt field)
    const firstAgent = profile.sub_agents[0] as unknown as Record<string, unknown>;
    return 'system_prompt' in firstAgent;
  }

  // =========================================================================
  // Execute migration
  // =========================================================================

  /**
   * Execute migration
   *
   * Migrates profile.sub_agents: SubAgentConfig[] to:
   * - File system: agents/{name}/AGENT.md
   * - profile.json: sub_agents: SubAgentIndex[]
   *
   * @returns The migrated SubAgentIndex[], or null if migration failed
   */
  async migrate(profileDir: string, profile: ProfileV2): Promise<SubAgentIndex[] | null> {
    const oldConfigs = (profile.sub_agents || []) as SubAgentConfig[];

    if (oldConfigs.length === 0) {
      logger.info('[SubAgentMigration] No sub-agents to migrate');
      return this.markComplete(profile, []);
    }

    logger.info(`[SubAgentMigration] Starting migration of ${oldConfigs.length} sub-agent(s)...`);

    const tmpDir = path.join(profileDir, AGENTS_TMP_DIRNAME);
    const finalDir = path.join(profileDir, AGENTS_DIRNAME);

    try {
      // Phase A: Write all AGENT.md files to the temporary directory
      await this.phaseA_writeToTmpDir(tmpDir, oldConfigs);

      // Phase B: Rename the temporary directory to the final directory
      await this.phaseB_renameTmpToFinal(tmpDir, finalDir);

      // Phase C: Update profile (convert to SubAgentIndex[] + set flag)
      const indices = this.buildSubAgentIndices(oldConfigs);
      this.markComplete(profile, indices);

      // Back up old data (stored in profile, to be cleaned up after 30 days)
      (profile as unknown as Record<string, unknown>)[MIGRATION_BACKUP_KEY] = oldConfigs;

      logger.info(`[SubAgentMigration] Migration completed successfully. ${indices.length} sub-agent(s) migrated.`);
      return indices;

    } catch (error) {
      // Migration failed: clean up temporary directory, leave profile unchanged
      logger.error(`[SubAgentMigration] Migration failed: ${error}`);
      await this.cleanupTmpDir(tmpDir);
      return null;
    }
  }

  // =========================================================================
  // Three phases of migration
  // =========================================================================

  /**
   * Phase A: Write all SubAgentConfig entries to the temporary directory
   */
  private async phaseA_writeToTmpDir(tmpDir: string, configs: SubAgentConfig[]): Promise<void> {
    // Clean up any leftovers from a previous failed attempt
    await this.cleanupTmpDir(tmpDir);

    for (const config of configs) {
      if (!config.name) {
        logger.warn('[SubAgentMigration] Skipping sub-agent with empty name');
        continue;
      }

      const agentDir = path.join(tmpDir, config.name);
      await fs.promises.mkdir(agentDir, { recursive: true });

      const content = this.fileManager.serializeToAgentMarkdown(config);
      const filePath = path.join(agentDir, 'AGENT.md');
      await fs.promises.writeFile(filePath, content, 'utf-8');

      logger.info(`[SubAgentMigration] Phase A: Written ${config.name}/AGENT.md`);
    }
  }

  /**
   * Phase B: Rename the temporary directory to the final agents/ directory
   *
   * If agents/ already exists (from another source), merge contents instead of overwriting
   */
  private async phaseB_renameTmpToFinal(tmpDir: string, finalDir: string): Promise<void> {
    try {
      await fs.promises.access(finalDir);
      // finalDir already exists → move subdirectories one by one (merge)
      const entries = await fs.promises.readdir(tmpDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const src = path.join(tmpDir, entry.name);
        const dst = path.join(finalDir, entry.name);
        // If the target already exists, skip it (do not overwrite existing agent files)
        try {
          await fs.promises.access(dst);
          logger.info(`[SubAgentMigration] Phase B: Skipping "${entry.name}" — already exists in agents/`);
        } catch {
          await fs.promises.rename(src, dst);
        }
      }
      // Clean up temporary directory
      await this.cleanupTmpDir(tmpDir);
    } catch {
      // finalDir does not exist → rename directly
      await fs.promises.rename(tmpDir, finalDir);
    }

    logger.info('[SubAgentMigration] Phase B: agents/ directory ready');
  }

  // =========================================================================
  // Helper methods
  // =========================================================================

  /**
   * Build SubAgentIndex[] from the legacy SubAgentConfig[]
   */
  private buildSubAgentIndices(configs: SubAgentConfig[]): SubAgentIndex[] {
    return configs
      .filter(c => c.name)
      .map(c => ({
        name: c.name,
        version: c.version || '1.0.0',
        source: 'ON-DEVICE' as const,
      }));
  }

  /**
   * Mark migration as complete and update profile
   */
  private markComplete(profile: ProfileV2, indices: SubAgentIndex[]): SubAgentIndex[] {
    // Update sub_agents to lightweight indices
    // Note: Although ProfileV2.sub_agents is typed as SubAgentConfig[],
    // after migration it actually stores SubAgentIndex[]. Phase 2 will update the ProfileV2 type.
    (profile as unknown as Record<string, unknown>).sub_agents = indices;

    // Set migration flag
    if (!profile._migrationFlags) {
      profile._migrationFlags = {};
    }
    profile._migrationFlags[MIGRATION_FLAG_KEY] = true;

    return indices;
  }

  /**
   * Clean up the temporary directory
   */
  private async cleanupTmpDir(tmpDir: string): Promise<void> {
    try {
      await fs.promises.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup failures
    }
  }
}
