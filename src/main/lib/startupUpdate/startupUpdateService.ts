/**
 * Startup Update Service
 *
 * Checks for and installs updates to MCP servers, Skills, and Agents
 * during application startup (after FRE is completed).
 *
 * Flow:
 *   step1: Check MCP updates (fetch remote mcp_lib.json, update remoteVersion)
 *   step2: Install MCP updates (merge ENV: preserve local values)
 *   step3: Check Skills updates (fetch remote skills_lib.json, update remoteVersion)
 *   step4: Install Skills updates (direct overwrite)
 *   step5: Check Agent updates (fetch remote agent_lib.json, update remoteVersion)
 *   step6: Install Agent updates (merge mcp_servers/skills: preserve local selections)
 *   step7: Complete
 */

import { createLogger } from '../unifiedLogger';
import { isFeatureEnabled } from '../featureFlags';
import { profileCacheManager } from '../userDataADO/profileCacheManager';
import { McpServerConfig, SkillConfig, ChatConfig, AgentMcpServer } from '../userDataADO/types/profile';

const logger = createLogger();

export type StartupUpdateStep =
  | 'check-models'
  | 'check-mcp'
  | 'install-mcp'
  | 'check-skills'
  | 'install-skills'
  | 'check-agents'
  | 'install-agents'
  | 'check-sub-agents'
  | 'install-sub-agents'
  | 'complete';

export interface StartupUpdateProgress {
  step: StartupUpdateStep;
  message: string;
  progress: number; // 0-100
  error?: string;
}

export interface StartupUpdateResult {
  success: boolean;
  hasUpdates: boolean;
  updatedMcpCount: number;
  updatedSkillCount: number;
  updatedAgentCount: number;
  updatedSubAgentCount: number;
  errors: string[];
}

interface McpLibItem {
  name: string;
  version?: string;
  transport?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  [key: string]: any;
}

interface SkillLibItem {
  name: string;
  version: string;
  description: string;
  [key: string]: any;
}

interface AgentLibItem {
  name: string;
  version: string;
  source?: string;
  description?: string;
  requirements?: {
    software?: Record<string, string>;
    mcp?: string[];
    skills?: string[];
  };
  configuration?: {
    name?: string;
    emoji?: string;
    avatar?: string;
    model?: string;
    mcp_servers?: Array<{ name: string; tools?: string[] }>;
    system_prompt?: string;
    context_enhancement?: any;
    skills?: string[];
    workspace?: string;
    knowledgeBase?: string;
    zero_states?: any;
  };
  [key: string]: any;
}



/**
 * Compare two semantic versions
 * @returns true if newVersion > oldVersion
 */
function isVersionGreater(newVersion: string, oldVersion: string): boolean {
  const parse = (v: string): number[] => {
    const parts = v.split('.');
    return [
      parseInt(parts[0], 10) || 0,
      parseInt(parts[1], 10) || 0,
      parseInt(parts[2], 10) || 0,
    ];
  };
  const n = parse(newVersion);
  const o = parse(oldVersion);
  for (let i = 0; i < 3; i++) {
    if (n[i] > o[i]) return true;
    if (n[i] < o[i]) return false;
  }
  return false;
}

/**
 * Merge environment variables:
 * - Same key in both: preserve local value (user-configured)
 * - New key only in remote: use remote value
 * - Key only in local: preserve (backward compatibility)
 */
export function mergeEnv(localEnv: Record<string, string>, remoteEnv: Record<string, string>): Record<string, string> {
  const merged: Record<string, string> = { ...remoteEnv };
  // Preserve local values for keys that exist in both, and keep local-only keys
  for (const key of Object.keys(localEnv)) {
    if (key in merged) {
      // Same key: preserve local value if non-empty
      if (localEnv[key]) {
        merged[key] = localEnv[key];
      }
    } else {
      // Local-only key: preserve for backward compatibility
      merged[key] = localEnv[key];
    }
  }
  return merged;
}

/**
 * Merge agent MCP servers: preserve local selections, add new remote ones.
 * For same-name servers, merge the selected tools arrays.
 *
 * Tools merge rules:
 * - tools: [] means "all tools selected" (select all)
 * - If either local or remote has [] → result is [] (preserve "all selected")
 * - Otherwise → union of both tool arrays (add new remote tools, keep local ones)
 */
export function mergeAgentMcpServers(
  localServers: AgentMcpServer[],
  remoteServers: Array<{ name: string; tools?: string[] }>
): AgentMcpServer[] {
  const mergedMap = new Map<string, AgentMcpServer>();

  // Start with remote servers (ensure tools defaults to [])
  for (const remote of remoteServers) {
    mergedMap.set(remote.name, { name: remote.name, tools: remote.tools || [] });
  }

  // Merge local: merge tools for same-name servers, add servers not in remote
  for (const local of localServers) {
    const remote = mergedMap.get(local.name);
    if (remote) {
      // Server exists in both local and remote — merge tools
      const localTools = local.tools || [];
      const remoteTools = remote.tools || [];

      let mergedTools: string[];
      if (localTools.length === 0 || remoteTools.length === 0) {
        // [] means "all tools selected" — if either side is all, keep all
        mergedTools = [];
      } else {
        // Both have specific selections: union
        const toolSet = new Set<string>(localTools);
        for (const t of remoteTools) {
          toolSet.add(t);
        }
        mergedTools = Array.from(toolSet);
      }

      mergedMap.set(local.name, { name: local.name, tools: mergedTools });
    } else {
      // Server only in local, keep it
      mergedMap.set(local.name, { ...local });
    }
  }

  return Array.from(mergedMap.values());
}

/**
 * Merge agent skills: keep local selections, add new remote ones
 */
export function mergeAgentSkills(localSkills: string[], remoteSkills: string[]): string[] {
  const merged = new Set<string>(remoteSkills);
  for (const skill of localSkills) {
    merged.add(skill);
  }
  return Array.from(merged);
}

import { BUILTIN_SKILL_NAMES } from '../../../shared/constants/builtinSkills';
import { ghcModelsManager } from "../llm/ghcModelsManager";
import { McpLibraryFetcher } from "../assetsFetcher/mcpLibraryFetcher";
import { openkosmosPlaceholderManager, containsOpenKosmosPlaceholder } from "../userDataADO/openkosmosPlaceholders";
import { mcpClientManager } from "../mcpRuntime/mcpClientManager";
import { SkillLibraryFetcher } from "../skill/skillLibraryFetcher";
import { AgentLibraryFetcher } from "../assetsFetcher/agentLibraryFetcher";

/**
 * Built-in skills that must be installed if not present.
 * These are checked during startup update and auto-installed.
 */
const BUILTIN_SKILLS: string[] = BUILTIN_SKILL_NAMES;

/**
 * Startup Update Service - checks and installs updates at startup
 */
export class StartupUpdateService {
  private alias: string;
  private progressCallback: (progress: StartupUpdateProgress) => void;

  // Items that need update (populated during check steps)
  private mcpUpdates: { local: McpServerConfig; remote: McpLibItem }[] = [];
  private skillUpdates: { local: SkillConfig; remote: SkillLibItem }[] = [];
  private skillsToInstall: SkillLibItem[] = []; // Built-in skills not yet installed
  private agentUpdates: { local: ChatConfig; remote: AgentLibItem }[] = [];

  constructor(alias: string, progressCallback: (progress: StartupUpdateProgress) => void) {
    this.alias = alias;
    this.progressCallback = progressCallback;
  }

  /**
   * Run the full startup update check and install process
   */
  async run(): Promise<StartupUpdateResult> {
    const result: StartupUpdateResult = {
      success: true,
      hasUpdates: false,
      updatedMcpCount: 0,
      updatedSkillCount: 0,
      updatedAgentCount: 0,
      updatedSubAgentCount: 0,
      errors: [],
    };

    const startTime = Date.now();
    logger.info('[StartupUpdate] Starting startup update check...', 'StartupUpdateService');

    try {
      // Step 0: Refresh GitHub Copilot models from remote API
      await this.refreshModels();

      // Step 1: Check MCP updates
      await this.checkMcpUpdates();

      // Step 2: Install MCP updates
      const mcpCount = await this.installMcpUpdates();
      result.updatedMcpCount = mcpCount;

      // Step 3: Check Skills updates
      await this.checkSkillUpdates();

      // Step 4: Install Skills updates
      const skillCount = await this.installSkillUpdates();
      result.updatedSkillCount = skillCount;

      // Step 5: Check Agent updates
      await this.checkAgentUpdates();

      // Step 6: Install Agent updates
      const agentCount = await this.installAgentUpdates();
      result.updatedAgentCount = agentCount;

      // Step 7: Complete
      result.hasUpdates = mcpCount + skillCount + agentCount > 0;

      this.progressCallback({
        step: 'complete',
        message: result.hasUpdates
          ? `Updates installed: ${mcpCount} MCP, ${skillCount} Skills, ${agentCount} Agents`
          : 'Everything is up to date!',
        progress: 100,
      });

      const duration = Date.now() - startTime;
      logger.info(`[StartupUpdate] Completed in ${duration}ms - MCP: ${mcpCount}, Skills: ${skillCount}, Agents: ${agentCount}`, 'StartupUpdateService');

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`[StartupUpdate] Failed: ${errorMsg}`, 'StartupUpdateService');
      result.success = false;
      result.errors.push(errorMsg);

      this.progressCallback({
        step: 'complete',
        message: 'Update check failed',
        progress: 100,
        error: errorMsg,
      });
    }

    return result;
  }

  // ==================== Step 0: Refresh Models from Remote ====================

  private async refreshModels(): Promise<void> {
    this.progressCallback({
      step: 'check-models',
      message: 'Refreshing model list from remote...',
      progress: 2,
    });

    try {

      // Ensure initialized first (loads from local file)
      await ghcModelsManager.initialize(this.alias);

      // Then refresh from remote API to get latest model data
      // refreshFromRemote() automatically notifies renderers on success
      const refreshed = await ghcModelsManager.refreshFromRemote();

      if (refreshed) {
        logger.info('[StartupUpdate] Models refreshed from remote successfully', 'StartupUpdateService');
      } else {
        logger.info('[StartupUpdate] Models refresh skipped (no changes or token unavailable)', 'StartupUpdateService');
      }

      this.progressCallback({
        step: 'check-models',
        message: refreshed ? 'Model list updated' : 'Models are up to date',
        progress: 4,
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.warn(`[StartupUpdate] Models refresh failed (non-fatal): ${errorMsg}`, 'StartupUpdateService');
      // Non-fatal: continue with other checks even if model refresh fails
    }
  }

  // ==================== Step 1: Check MCP Updates ====================

  private async checkMcpUpdates(): Promise<void> {
    this.progressCallback({
      step: 'check-mcp',
      message: 'Checking MCP server updates...',
      progress: 5,
    });

    try {
      // 1. Fetch remote mcp_lib.json
      const mcpFetcher = McpLibraryFetcher.getInstance();
      const fetchResult = await mcpFetcher.fetchAndUpdate();

      if (!fetchResult.success || !fetchResult.data) {
        logger.warn('[StartupUpdate] Failed to fetch MCP library, skipping MCP updates', 'StartupUpdateService');
        return;
      }

      const remoteMcpServers: McpLibItem[] = fetchResult.data.mcp_servers || [];

      // 2. Get local profile MCP servers
      const profile = profileCacheManager.getCachedProfile(this.alias);
      if (!profile) {
        logger.warn('[StartupUpdate] No profile found, skipping MCP updates', 'StartupUpdateService');
        return;
      }

      const localMcpServers = profile.mcp_servers || [];
      const remoteMap = new Map<string, McpLibItem>();
      for (const remote of remoteMcpServers) {
        remoteMap.set(remote.name, remote);
      }

      // 3. Update remoteVersion and find items needing update
      this.mcpUpdates = [];
      for (const local of localMcpServers) {
        if (local.source !== 'IN-LIBRARY') continue;

        const remote = remoteMap.get(local.name);
        if (!remote) continue;

        const remoteVersion = remote.version || '1.0.0';

        // Update remoteVersion in profile
        if (local.remoteVersion !== remoteVersion) {
          await profileCacheManager.updateMcpServerConfig(this.alias, local.name, {
            remoteVersion: remoteVersion,
          });
        }

        // Check if update needed
        const localVersion = local.version || '1.0.0';
        if (localVersion !== remoteVersion && isVersionGreater(remoteVersion, localVersion)) {
          this.mcpUpdates.push({ local, remote });
        }
      }

      this.progressCallback({
        step: 'check-mcp',
        message: this.mcpUpdates.length > 0
          ? `Found ${this.mcpUpdates.length} MCP server update(s)`
          : 'MCP servers are up to date',
        progress: 15,
      });

      logger.info(`[StartupUpdate] MCP check done: ${this.mcpUpdates.length} updates needed`, 'StartupUpdateService');
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`[StartupUpdate] MCP check failed: ${errorMsg}`, 'StartupUpdateService');
      // Non-fatal, continue with other checks
    }
  }

  // ==================== Step 2: Install MCP Updates ====================

  private async installMcpUpdates(): Promise<number> {
    if (this.mcpUpdates.length === 0) {
      this.progressCallback({
        step: 'install-mcp',
        message: 'No MCP updates to install',
        progress: 25,
      });
      return 0;
    }

    this.progressCallback({
      step: 'install-mcp',
      message: `Installing ${this.mcpUpdates.length} MCP server update(s)...`,
      progress: 20,
    });

    let count = 0;

    for (const { local, remote } of this.mcpUpdates) {
      try {
        logger.info(`[StartupUpdate] Updating MCP: ${local.name} ${local.version} → ${remote.version}`, 'StartupUpdateService');

        // Merge ENV: preserve local values
        const mergedEnv = mergeEnv(local.env || {}, remote.env || {});

        // Process OpenKosmos placeholders
        let processedEnv = mergedEnv;
        try {
          processedEnv = openkosmosPlaceholderManager.replacePlaceholdersInObject(mergedEnv, { alias: this.alias });
        } catch (e) {
          logger.warn(`[StartupUpdate] Failed to process placeholders for MCP ${local.name}`, 'StartupUpdateService');
        }

        // Process URL placeholders
        let processedUrl = remote.url || local.url || '';
        if (processedUrl) {
          try {
            if (containsOpenKosmosPlaceholder(processedUrl)) {
              processedUrl = openkosmosPlaceholderManager.replacePlaceholders(processedUrl, { alias: this.alias });
            }
          } catch (e) {
            // Keep original URL
          }
        }

        // Build full McpServerConfig for mcpClientManager.update()
        const updatedConfig: McpServerConfig = {
          name: local.name,
          transport: remote.transport || local.transport,
          in_use: local.in_use,
          command: remote.command || local.command,
          args: remote.args || local.args || [],
          env: processedEnv,
          url: processedUrl,
          version: remote.version || '1.0.0',
          source: 'IN-LIBRARY',
          remoteVersion: remote.version || '1.0.0',
        };

        // Use mcpClientManager.update() to save config AND trigger reconnect
        await mcpClientManager.update(local.name, updatedConfig);

        count++;
        logger.info(`[StartupUpdate] MCP ${local.name} updated successfully`, 'StartupUpdateService');
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error(`[StartupUpdate] Failed to update MCP ${local.name}: ${errorMsg}`, 'StartupUpdateService');
      }
    }

    this.progressCallback({
      step: 'install-mcp',
      message: `Updated ${count} MCP server(s)`,
      progress: 30,
    });

    return count;
  }

  // ==================== Step 3: Check Skills Updates ====================

  private async checkSkillUpdates(): Promise<void> {
    this.progressCallback({
      step: 'check-skills',
      message: 'Checking skill updates...',
      progress: 35,
    });

    try {
      // 1. Fetch remote skills_lib.json
      const skillFetcher = SkillLibraryFetcher.getInstance();
      const fetchResult = await skillFetcher.getLibraryData();

      if (!fetchResult.success || !fetchResult.data) {
        logger.warn('[StartupUpdate] Failed to fetch Skills library, skipping skill updates', 'StartupUpdateService');
        return;
      }

      const remoteSkills: SkillLibItem[] = fetchResult.data.skills || [];

      // 2. Get local profile skills
      const profile = profileCacheManager.getCachedProfile(this.alias);
      if (!profile) return;

      const localSkills = profile.skills || [];
      const remoteMap = new Map<string, SkillLibItem>();
      for (const remote of remoteSkills) {
        remoteMap.set(remote.name, remote);
      }

      const localSkillNames = new Set(localSkills.map(s => s.name));

      // 2.5 Check built-in skills: if not installed locally, add to install list
      this.skillsToInstall = [];
      for (const builtinName of BUILTIN_SKILLS) {
        if (!localSkillNames.has(builtinName)) {
          const remote = remoteMap.get(builtinName);
          if (remote) {
            this.skillsToInstall.push(remote);
            logger.info(`[StartupUpdate] Built-in skill '${builtinName}' not installed, will install`, 'StartupUpdateService');
          } else {
            logger.warn(`[StartupUpdate] Built-in skill '${builtinName}' not found in remote library`, 'StartupUpdateService');
          }
        }
      }

      // 3. Update remoteVersion and find IN-LIBRARY items needing update
      this.skillUpdates = [];
      for (const local of localSkills) {
        if (local.source !== 'IN-LIBRARY') continue;

        const remote = remoteMap.get(local.name);
        if (!remote) continue;

        const remoteVersion = remote.version || '1.0.0';

        // Update remoteVersion in profile
        if (local.remoteVersion !== remoteVersion) {
          await profileCacheManager.updateSkill(this.alias, local.name, {
            remoteVersion: remoteVersion,
          } as any);
        }

        // Check if update needed
        const localVersion = local.version || '1.0.0';
        if (localVersion !== remoteVersion && isVersionGreater(remoteVersion, localVersion)) {
          this.skillUpdates.push({ local, remote });
        }
      }

      const totalActions = this.skillsToInstall.length + this.skillUpdates.length;
      this.progressCallback({
        step: 'check-skills',
        message: totalActions > 0
          ? `Found ${this.skillsToInstall.length} skill(s) to install, ${this.skillUpdates.length} to update`
          : 'Skills are up to date',
        progress: 45,
      });

      logger.info(`[StartupUpdate] Skills check done: ${this.skillsToInstall.length} to install, ${this.skillUpdates.length} to update`, 'StartupUpdateService');
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`[StartupUpdate] Skills check failed: ${errorMsg}`, 'StartupUpdateService');
    }
  }

  // ==================== Step 4: Install Skills Updates ====================

  private async installSkillUpdates(): Promise<number> {
    const totalActions = this.skillsToInstall.length + this.skillUpdates.length;

    if (totalActions === 0) {
      this.progressCallback({
        step: 'install-skills',
        message: 'No skill updates to install',
        progress: 55,
      });
      return 0;
    }

    this.progressCallback({
      step: 'install-skills',
      message: `Installing ${totalActions} skill(s)...`,
      progress: 50,
    });

    let count = 0;

    // 1. Install missing built-in skills
    for (const remote of this.skillsToInstall) {
      try {
        logger.info(`[StartupUpdate] Installing built-in skill: ${remote.name} v${remote.version}`, 'StartupUpdateService');

        const skillFetcher = SkillLibraryFetcher.getInstance();
        const result = await skillFetcher.addSkill(remote.name, this.alias);

        if (result.success) {
          count++;
          logger.info(`[StartupUpdate] Built-in skill ${remote.name} installed successfully`, 'StartupUpdateService');
        } else {
          logger.warn(`[StartupUpdate] Failed to install built-in skill ${remote.name}: ${result.error}`, 'StartupUpdateService');
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error(`[StartupUpdate] Failed to install built-in skill ${remote.name}: ${errorMsg}`, 'StartupUpdateService');
      }
    }

    // 2. Update existing IN-LIBRARY skills that have newer versions
    for (const { local, remote } of this.skillUpdates) {
      try {
        logger.info(`[StartupUpdate] Updating skill: ${local.name} ${local.version} → ${remote.version}`, 'StartupUpdateService');

        const skillFetcher = SkillLibraryFetcher.getInstance();
        const result = await skillFetcher.updateSkill(local.name, this.alias);

        if (result.success) {
          count++;
          logger.info(`[StartupUpdate] Skill ${local.name} updated successfully`, 'StartupUpdateService');
        } else {
          logger.warn(`[StartupUpdate] Failed to update skill ${local.name}: ${result.error}`, 'StartupUpdateService');
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error(`[StartupUpdate] Failed to update skill ${local.name}: ${errorMsg}`, 'StartupUpdateService');
      }
    }

    this.progressCallback({
      step: 'install-skills',
      message: `Installed/updated ${count} skill(s)`,
      progress: 60,
    });

    return count;
  }

  // ==================== Step 5: Check Agent Updates ====================

  private async checkAgentUpdates(): Promise<void> {
    this.progressCallback({
      step: 'check-agents',
      message: 'Checking agent updates...',
      progress: 65,
    });

    try {
      // 1. Fetch remote agent_lib.json
      const agentFetcher = AgentLibraryFetcher.getInstance();
      const fetchResult = await agentFetcher.fetchAndUpdate();

      if (!fetchResult.success || !fetchResult.data) {
        logger.warn('[StartupUpdate] Failed to fetch Agent library, skipping agent updates', 'StartupUpdateService');
        return;
      }

      const remoteAgents: AgentLibItem[] = fetchResult.data.agents || [];

      // 2. Get local profile agents (from chats)
      const profile = profileCacheManager.getCachedProfile(this.alias);
      if (!profile) return;

      const localChats = profile.chats || [];
      const remoteMap = new Map<string, AgentLibItem>();
      for (const remote of remoteAgents) {
        remoteMap.set(remote.name, remote);
      }

      // 3. Update remoteVersion and find items needing update
      this.agentUpdates = [];
      for (const chat of localChats) {
        if (!chat.agent) continue;
        if (chat.agent.source !== 'IN-LIBRARY') continue;

        const remote = remoteMap.get(chat.agent.name);
        if (!remote) continue;

        const remoteVersion = remote.version || '1.0.0';

        // Update remoteVersion in profile
        if (chat.agent.remoteVersion !== remoteVersion) {
          await profileCacheManager.updateChatAgent(this.alias, chat.chat_id, {
            remoteVersion: remoteVersion,
          });
        }

        // Check if update needed
        const localVersion = chat.agent.version || '1.0.0';
        if (localVersion !== remoteVersion && isVersionGreater(remoteVersion, localVersion)) {
          this.agentUpdates.push({ local: chat, remote });
        }
      }

      this.progressCallback({
        step: 'check-agents',
        message: this.agentUpdates.length > 0
          ? `Found ${this.agentUpdates.length} agent update(s)`
          : 'Agents are up to date',
        progress: 75,
      });

      logger.info(`[StartupUpdate] Agent check done: ${this.agentUpdates.length} updates needed`, 'StartupUpdateService');
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`[StartupUpdate] Agent check failed: ${errorMsg}`, 'StartupUpdateService');
    }
  }

  // ==================== Step 6: Install Agent Updates ====================

  private async installAgentUpdates(): Promise<number> {
    if (this.agentUpdates.length === 0) {
      this.progressCallback({
        step: 'install-agents',
        message: 'No agent updates to install',
        progress: 90,
      });
      return 0;
    }

    this.progressCallback({
      step: 'install-agents',
      message: `Installing ${this.agentUpdates.length} agent update(s)...`,
      progress: 80,
    });

    let count = 0;

    for (const { local: chat, remote } of this.agentUpdates) {
      const agent = chat.agent!;
      try {
        logger.info(`[StartupUpdate] Updating agent: ${agent.name} ${agent.version} → ${remote.version}`, 'StartupUpdateService');

        const remoteConfig = remote.configuration || {};

        // Merge mcp_servers: preserve local selections, add new remote ones
        const mergedMcpServers = mergeAgentMcpServers(
          agent.mcp_servers || [],
          remoteConfig.mcp_servers || [],
        );

        // Merge skills: preserve local selections, add new remote ones
        const mergedSkills = mergeAgentSkills(
          agent.skills || [],
          remoteConfig.skills || [],
        );

        // Build update object following merge rules:
        // - Remote-first: avatar, emoji, name, system_prompt, zero_states
        // - Local-first (keep local if exists, otherwise use remote): model, workspace, knowledgeBase, context_enhancement
        // - Merge: mcp_servers, skills
        const agentUpdate: Partial<typeof agent> = {
          // Remote-first: emoji / avatar (fallback to local if remote is empty)
          emoji: remoteConfig.emoji || agent.emoji || '🤖',
          avatar: remoteConfig.avatar || agent.avatar || '',
          // Remote-first: name (fallback to local if remote is empty)
          name: remoteConfig.name || remote.name || agent.name,
          // Local-first: model (keep local if exists, otherwise use remote)
          model: agent.model || remoteConfig.model,
          // Always use remote: system_prompt (clear if remote has none, always align with remote)
          system_prompt: 'system_prompt' in remoteConfig ? (remoteConfig.system_prompt || '') : '',
          // Local-first: context_enhancement (keep local if exists, otherwise use remote)
          context_enhancement: agent.context_enhancement || remoteConfig.context_enhancement,
          // Merge
          mcp_servers: mergedMcpServers,
          skills: mergedSkills,
          // Version info
          version: remote.version || '1.0.0',
          source: 'IN-LIBRARY',
          remoteVersion: remote.version || '1.0.0',
          // Always use remote (same as system_prompt): clear if remote has none, always align with remote
          zero_states: remoteConfig.zero_states || undefined,
        };

        // 🔒 Defensive protection: workspace and knowledgeBase always use local values, never overwritten by remote
        delete agentUpdate.workspace;
        delete agentUpdate.knowledge;

        const success = await profileCacheManager.updateChatAgent(
          this.alias,
          chat.chat_id,
          agentUpdate,
        );

        if (success) {
          count++;
          logger.info(`[StartupUpdate] Agent ${agent.name} updated successfully`, 'StartupUpdateService');
        } else {
          logger.warn(`[StartupUpdate] Failed to update agent ${agent.name}`, 'StartupUpdateService');
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error(`[StartupUpdate] Failed to update agent ${agent.name}: ${errorMsg}`, 'StartupUpdateService');
      }
    }

    this.progressCallback({
      step: 'install-agents',
      message: `Updated ${count} agent(s)`,
      progress: 80,
    });

    return count;
  }

}
