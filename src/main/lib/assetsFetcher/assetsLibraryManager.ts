/**
 * Assets Library Manager
 *
 * Unified service for fetching remote library data (agent, mcp, skills, sub-agents)
 * and updating profile.json remoteVersion fields.
 *
 * Responsibilities:
 * 1. Periodically fetch remote agent_lib.json, mcp_lib.json, skills_lib.json
 * 2. Cache library data locally to USER DATA/assets/{agent, mcp, skills, sub-agent}
 * 3. Update remoteVersion fields in user's profile.json
 */

import { createLogger } from '../unifiedLogger';
import { McpLibraryFetcher } from './mcpLibraryFetcher';
import { AgentLibraryFetcher } from './agentLibraryFetcher';
import { SkillLibraryFetcher } from '../skill/skillLibraryFetcher';
import { profileCacheManager } from '../userDataADO/profileCacheManager';

const logger = createLogger();

/**
 * Library item with version information
 */
interface LibraryItemVersion {
  name: string;
  version: string;
}

/**
 * Result of library fetch operation
 */
interface LibraryFetchResult {
  success: boolean;
  type: 'agent' | 'mcp' | 'skills' | 'sub-agents';
  items?: LibraryItemVersion[];
  error?: string;
}

/**
 * Result of profile update operation
 */
interface ProfileUpdateResult {
  success: boolean;
  updatedAgents: number;
  updatedMcpServers: number;
  updatedSkills: number;
  updatedSubAgents: number;
  errors: string[];
}

/**
 * AssetsLibraryManager - Singleton service for managing remote library data
 */
export class AssetsLibraryManager {
  private static instance: AssetsLibraryManager;
  private mcpFetcher: McpLibraryFetcher;
  private agentFetcher: AgentLibraryFetcher;
  private skillFetcher: SkillLibraryFetcher;
  private isChecking: boolean = false;
  private lastCheckTime: number | null = null;

  private constructor() {
    this.mcpFetcher = McpLibraryFetcher.getInstance();
    this.agentFetcher = AgentLibraryFetcher.getInstance();
    this.skillFetcher = SkillLibraryFetcher.getInstance();

    logger.info('[AssetsLibraryManager] Initialized', 'AssetsLibraryManager');
  }

  public static getInstance(): AssetsLibraryManager {
    if (!AssetsLibraryManager.instance) {
      AssetsLibraryManager.instance = new AssetsLibraryManager();
    }
    return AssetsLibraryManager.instance;
  }

  /**
   * Check if a library check is currently in progress
   */
  public isCheckInProgress(): boolean {
    return this.isChecking;
  }

  /**
   * Get the timestamp of the last successful check
   */
  public getLastCheckTime(): number | null {
    return this.lastCheckTime;
  }

  /**
   * Fetch all remote library data and cache locally
   * This fetches agent_lib.json, mcp_lib.json, and skills_lib.json
   */
  public async fetchAllLibraries(): Promise<LibraryFetchResult[]> {
    const results: LibraryFetchResult[] = [];

    logger.info('[AssetsLibraryManager] Starting to fetch all remote libraries...', 'AssetsLibraryManager');

    // Fetch all libraries in parallel
    const [mcpResult, agentResult, skillResult] = await Promise.allSettled([
      this.fetchMcpLibrary(),
      this.fetchAgentLibrary(),
      this.fetchSkillLibrary()
    ]);

    // Process MCP result
    if (mcpResult.status === 'fulfilled') {
      results.push(mcpResult.value);
    } else {
      results.push({
        success: false,
        type: 'mcp',
        error: mcpResult.reason instanceof Error ? mcpResult.reason.message : String(mcpResult.reason)
      });
    }

    // Process Agent result
    if (agentResult.status === 'fulfilled') {
      results.push(agentResult.value);
    } else {
      results.push({
        success: false,
        type: 'agent',
        error: agentResult.reason instanceof Error ? agentResult.reason.message : String(agentResult.reason)
      });
    }

    // Process Skill result
    if (skillResult.status === 'fulfilled') {
      results.push(skillResult.value);
    } else {
      results.push({
        success: false,
        type: 'skills',
        error: skillResult.reason instanceof Error ? skillResult.reason.message : String(skillResult.reason)
      });
    }

    const successCount = results.filter(r => r.success).length;
    logger.info(`[AssetsLibraryManager] Fetch completed: ${successCount}/${results.length} libraries successful`, 'AssetsLibraryManager');

    return results;
  }

  /**
   * Fetch MCP library data
   */
  private async fetchMcpLibrary(): Promise<LibraryFetchResult> {
    try {
      logger.info('[AssetsLibraryManager] Fetching MCP library...', 'AssetsLibraryManager');

      const result = await this.mcpFetcher.fetchAndUpdate();

      if (result.success && result.data) {
        const items: LibraryItemVersion[] = result.data.mcp_servers.map(server => ({
          name: server.name,
          version: server.version || '1.0.0'
        }));

        logger.info(`[AssetsLibraryManager] MCP library fetched: ${items.length} servers`, 'AssetsLibraryManager');

        return {
          success: true,
          type: 'mcp',
          items
        };
      }

      return {
        success: false,
        type: 'mcp',
        error: result.error || 'Unknown error fetching MCP library'
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`[AssetsLibraryManager] Failed to fetch MCP library: ${errorMessage}`, 'AssetsLibraryManager');
      return {
        success: false,
        type: 'mcp',
        error: errorMessage
      };
    }
  }

  /**
   * Fetch Agent library data
   */
  private async fetchAgentLibrary(): Promise<LibraryFetchResult> {
    try {
      logger.info('[AssetsLibraryManager] Fetching Agent library...', 'AssetsLibraryManager');

      const result = await this.agentFetcher.fetchAndUpdate();

      if (result.success && result.data) {
        const items: LibraryItemVersion[] = result.data.agents.map(agent => ({
          name: agent.name,
          version: agent.version || '1.0.0'
        }));

        logger.info(`[AssetsLibraryManager] Agent library fetched: ${items.length} agents`, 'AssetsLibraryManager');

        return {
          success: true,
          type: 'agent',
          items
        };
      }

      return {
        success: false,
        type: 'agent',
        error: result.error || 'Unknown error fetching Agent library'
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`[AssetsLibraryManager] Failed to fetch Agent library: ${errorMessage}`, 'AssetsLibraryManager');
      return {
        success: false,
        type: 'agent',
        error: errorMessage
      };
    }
  }

  /**
   * Fetch Skill library data
   */
  private async fetchSkillLibrary(): Promise<LibraryFetchResult> {
    try {
      logger.info('[AssetsLibraryManager] Fetching Skill library...', 'AssetsLibraryManager');

      const result = await this.skillFetcher.getLibraryData();

      if (result.success && result.data) {
        const items: LibraryItemVersion[] = result.data.skills.map(skill => ({
          name: skill.name,
          version: skill.version || '1.0.0'
        }));

        logger.info(`[AssetsLibraryManager] Skill library fetched: ${items.length} skills`, 'AssetsLibraryManager');

        return {
          success: true,
          type: 'skills',
          items
        };
      }

      return {
        success: false,
        type: 'skills',
        error: result.error || 'Unknown error fetching Skill library'
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`[AssetsLibraryManager] Failed to fetch Skill library: ${errorMessage}`, 'AssetsLibraryManager');
      return {
        success: false,
        type: 'skills',
        error: errorMessage
      };
    }
  }

  /**
   * Update remoteVersion fields in user's profile.json based on fetched library data
   *
   * @param alias User alias
   * @param libraryResults Results from fetchAllLibraries()
   * @returns Update result summary
   */
  public async updateProfileRemoteVersions(alias: string, libraryResults: LibraryFetchResult[]): Promise<ProfileUpdateResult> {
    const result: ProfileUpdateResult = {
      success: true,
      updatedAgents: 0,
      updatedMcpServers: 0,
      updatedSkills: 0,
      updatedSubAgents: 0,  // Deprecated: sub-agent library removed
      errors: []
    };

    logger.info(`[AssetsLibraryManager] Updating profile remoteVersions for user: ${alias}`, 'AssetsLibraryManager');

    // Build lookup maps for quick access
    const mcpVersionMap = new Map<string, string>();
    const agentVersionMap = new Map<string, string>();
    const skillVersionMap = new Map<string, string>();

    for (const libResult of libraryResults) {
      if (!libResult.success || !libResult.items) continue;

      for (const item of libResult.items) {
        switch (libResult.type) {
          case 'mcp':
            mcpVersionMap.set(item.name, item.version);
            break;
          case 'agent':
            agentVersionMap.set(item.name, item.version);
            break;
          case 'skills':
            skillVersionMap.set(item.name, item.version);
            break;
        }
      }
    }

    // Get current profile
    const profile = profileCacheManager.getCachedProfile(alias);
    if (!profile) {
      result.success = false;
      result.errors.push(`Profile not found for user: ${alias}`);
      return result;
    }

    // Update MCP servers remoteVersion
    // Note: Update by name match only, regardless of source (IN-LIBRARY or ON-DEVICE)
    // Even ON-DEVICE servers should have remoteVersion updated if a same-named library item exists
    if (mcpVersionMap.size > 0) {
      for (const mcpServer of profile.mcp_servers || []) {
        const remoteVersion = mcpVersionMap.get(mcpServer.name);
        if (remoteVersion && mcpServer.remoteVersion !== remoteVersion) {
          try {
            const updateSuccess = await profileCacheManager.updateMcpServerConfig(alias, mcpServer.name, {
              remoteVersion: remoteVersion
            });
            if (updateSuccess) {
              result.updatedMcpServers++;
              logger.info(`[AssetsLibraryManager] Updated MCP server "${mcpServer.name}" remoteVersion to ${remoteVersion}`, 'AssetsLibraryManager');
            }
          } catch (error) {
            const errorMsg = `Failed to update MCP server "${mcpServer.name}": ${error instanceof Error ? error.message : String(error)}`;
            result.errors.push(errorMsg);
            logger.error(`[AssetsLibraryManager] ${errorMsg}`, 'AssetsLibraryManager');
          }
        }
      }
    }

    // Update Skills remoteVersion
    if (skillVersionMap.size > 0) {
      for (const skill of profile.skills || []) {
        const remoteVersion = skillVersionMap.get(skill.name);
        if (remoteVersion && skill.remoteVersion !== remoteVersion) {
          try {
            const updateSuccess = await profileCacheManager.updateSkill(alias, skill.name, {
              remoteVersion: remoteVersion
            } as any);
            if (updateSuccess) {
              result.updatedSkills++;
              logger.info(`[AssetsLibraryManager] Updated skill "${skill.name}" remoteVersion to ${remoteVersion}`, 'AssetsLibraryManager');
            }
          } catch (error) {
            const errorMsg = `Failed to update skill "${skill.name}": ${error instanceof Error ? error.message : String(error)}`;
            result.errors.push(errorMsg);
            logger.error(`[AssetsLibraryManager] ${errorMsg}`, 'AssetsLibraryManager');
          }
        }
      }
    }

    // Update Agents remoteVersion (in chats)
    if (agentVersionMap.size > 0) {
      for (const chat of profile.chats || []) {
        if (chat.agent) {
          const remoteVersion = agentVersionMap.get(chat.agent.name);
          if (remoteVersion && chat.agent.remoteVersion !== remoteVersion) {
            try {
              const updateSuccess = await profileCacheManager.updateChatAgent(alias, chat.chat_id, {
                remoteVersion: remoteVersion
              });
              if (updateSuccess) {
                result.updatedAgents++;
                logger.info(`[AssetsLibraryManager] Updated agent "${chat.agent.name}" remoteVersion to ${remoteVersion}`, 'AssetsLibraryManager');
              }
            } catch (error) {
              const errorMsg = `Failed to update agent "${chat.agent.name}": ${error instanceof Error ? error.message : String(error)}`;
              result.errors.push(errorMsg);
              logger.error(`[AssetsLibraryManager] ${errorMsg}`, 'AssetsLibraryManager');
            }
          }
        }
      }
    }

    if (result.errors.length > 0) {
      result.success = false;
    }

    logger.info(`[AssetsLibraryManager] Profile update completed - Agents: ${result.updatedAgents}, MCP: ${result.updatedMcpServers}, Skills: ${result.updatedSkills}`, 'AssetsLibraryManager');

    return result;
  }

  /**
   * Main check method: fetch all libraries and update profile remoteVersions
   * Called by auto update mechanism
   *
   * @param alias User alias (optional, if not provided will use current user from profileCacheManager)
   */
  public async checkAndUpdateLibraries(alias?: string): Promise<{
    fetchResults: LibraryFetchResult[];
    updateResult?: ProfileUpdateResult;
  }> {
    if (this.isChecking) {
      logger.warn('[AssetsLibraryManager] Check already in progress, skipping...', 'AssetsLibraryManager');
      return {
        fetchResults: []
      };
    }

    this.isChecking = true;
    const startTime = Date.now();

    try {
      logger.info('[AssetsLibraryManager] Starting library check...', 'AssetsLibraryManager');

      // Step 1: Fetch all libraries
      const fetchResults = await this.fetchAllLibraries();

      // Step 2: Update profile remoteVersions if alias is provided
      let updateResult: ProfileUpdateResult | undefined;

      if (alias) {
        updateResult = await this.updateProfileRemoteVersions(alias, fetchResults);
      } else {
        // Try to get current user from profileCacheManager
        const cachedAliases = profileCacheManager.getCachedAliases();
        if (cachedAliases.length > 0) {
          // Use the first cached alias (typically the current user)
          updateResult = await this.updateProfileRemoteVersions(cachedAliases[0], fetchResults);
        } else {
          logger.warn('[AssetsLibraryManager] No user alias available for profile update', 'AssetsLibraryManager');
        }
      }

      this.lastCheckTime = Date.now();
      const duration = this.lastCheckTime - startTime;

      logger.info(`[AssetsLibraryManager] Library check completed in ${duration}ms`, 'AssetsLibraryManager');

      return {
        fetchResults,
        updateResult
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`[AssetsLibraryManager] Library check failed: ${errorMessage}`, 'AssetsLibraryManager');

      return {
        fetchResults: [{
          success: false,
          type: 'agent',
          error: errorMessage
        }]
      };
    } finally {
      this.isChecking = false;
    }
  }

  /**
   * Get cached library data from local files
   * Useful for getting library data without making network requests
   */
  public async getCachedLibraryData(): Promise<{
    mcp: any | null;
    agent: any | null;
    skills: any | null;
    subAgents: any | null;
  }> {
    const [mcpResult, agentResult, skillResult] = await Promise.allSettled([
      this.mcpFetcher.getLibraryData(),
      this.agentFetcher.getLibraryData(),
      this.skillFetcher.getLibraryData()
    ]);

    return {
      mcp: mcpResult.status === 'fulfilled' && mcpResult.value.success ? mcpResult.value.data : null,
      agent: agentResult.status === 'fulfilled' && agentResult.value.success ? agentResult.value.data : null,
      skills: skillResult.status === 'fulfilled' && skillResult.value.success ? skillResult.value.data : null,
      subAgents: null
    };
  }
}

// Export singleton instance
export const assetsLibraryManager = AssetsLibraryManager.getInstance();
