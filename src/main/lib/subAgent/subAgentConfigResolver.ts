/**
 * SubAgentConfigResolver — Pure helper functions for sub-agent configuration resolution.
 *
 * Extracted from SubAgentManager to keep the manager file under the 1000-line policy.
 * All functions are stateless and operate on their inputs only.
 *
 * File location: src/main/lib/subAgent/subAgentConfigResolver.ts
 */

import type { SubAgent } from './types';
import type {
  SubAgentConfig,
  AgentMcpServer,
} from '../userDataADO/types/profile';
import { profileCacheManager } from '../userDataADO/profileCacheManager';
import * as path from 'path';
import { extractMonthFromChatSessionId } from '../userDataADO/pathUtils';
import { app } from 'electron';
import { getModelById } from '../llm/ghcModelsManager';
import { INHERIT_MODEL_VALUE } from '@shared/constants/subAgent';
import { mcpClientManager } from '../mcpRuntime/mcpClientManager';
import { existsSync } from 'fs';
import { createConsoleLogger } from '../unifiedLogger';

// Lazy-init logger (same pattern as manager)
let logger: any;
(async () => {
  logger = await createConsoleLogger();
})();

function getLogger() {
  return logger || console;
}

/**
 * Resolve model for a sub-agent.
 *
 * Resolution order:
 *   1. Empty / `inherit` → use parent model.
 *   2. Configured id resolves via the model registry → use it.
 *   3. Configured id is unknown → log warning and fall back to parent model.
 */
export function resolveSubAgentModel(
  subAgentConfig: SubAgentConfig,
  parentModel: string,
  subAgentName: string,
): string {
  const configuredModel = subAgentConfig.model?.trim();
  if (!configuredModel || configuredModel.toLowerCase() === INHERIT_MODEL_VALUE) {
    return parentModel;
  }
  if (getModelById(configuredModel)) {
    return configuredModel;
  }
  getLogger().warn?.(
    `[SubAgentConfigResolver] Sub-agent "${subAgentName}" requested unknown model "${configuredModel}"; falling back to parent model "${parentModel}".`,
    'resolveSubAgentModel',
  );
  return parentModel;
}

/**
 * Get parent Agent config (for inheritance resolution)
 */
export function getParentAgentConfig(
  parentChatId: string,
  userAlias: string,
): { mcp_servers: AgentMcpServer[]; skills?: string[]; knowledgeBase?: string } | undefined {
  try {
    const allChats = profileCacheManager.getAllChatConfigs(userAlias);
    const parentChatConfig = allChats?.find((chat: any) => chat.chat_id === parentChatId);
    return parentChatConfig?.agent ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolve inherited config — merge sub-agent persisted config + parent config into runtime resolution result.
 *
 * Merge rules:
 * - MCP Servers: array merge, sub-agent's same-name servers take priority (override parent)
 * - Skills: set union (deduplicated)
 * - Knowledge Base: value override (sub-agent non-empty takes priority, otherwise use parent)
 *
 * See tech doc §4.7
 */
export function resolveInheritedConfig(
  subAgentConfig: SubAgentConfig,
  parentAgentConfig?: { mcp_servers: AgentMcpServer[]; skills?: string[]; knowledgeBase?: string },
): {
  resolvedMcpServers: SubAgent['resolvedMcpServers'];
  resolvedSkills: SubAgent['resolvedSkills'];
  resolvedKnowledgeBase?: string;
} {
  // ── MCP Servers merge ──
  const childServers = (subAgentConfig.mcp_servers || []).map(s => ({
    name: s.name,
    connected: false,
    tools: s.tools || [],
    inherited: false,
  }));

  let resolvedMcpServers = [...childServers];

  if (subAgentConfig.inherit_mcp_servers !== false && parentAgentConfig?.mcp_servers) {
    const childNames = new Set(childServers.map(s => s.name));
    const parentInherited = parentAgentConfig.mcp_servers
      .filter(ps => !childNames.has(ps.name))
      .map(ps => ({
        name: ps.name,
        connected: false,
        tools: ps.tools || [],
        inherited: true,
      }));
    resolvedMcpServers = [...parentInherited, ...childServers];
  }

  // ── Skills merge ──
  const childSkills = (subAgentConfig.skills || []).map(name => ({
    name,
    installed: false,
    inherited: false,
  }));

  let resolvedSkills = [...childSkills];

  if (subAgentConfig.inherit_skills !== false && parentAgentConfig?.skills) {
    const childNames = new Set(childSkills.map(s => s.name));
    const parentInherited = parentAgentConfig.skills
      .filter(name => !childNames.has(name))
      .map(name => ({
        name,
        installed: false,
        inherited: true,
      }));
    resolvedSkills = [...parentInherited, ...childSkills];
  }

  // ── Knowledge Base merge ── (child takes priority; respects inherit flag)
  let resolvedKnowledgeBase: string | undefined;
  if (subAgentConfig.knowledgeBase) {
    // Sub-agent has its own knowledge base → use its own
    resolvedKnowledgeBase = subAgentConfig.knowledgeBase;
  } else if (subAgentConfig.inherit_knowledge_base !== false && parentAgentConfig?.knowledgeBase) {
    // Sub-agent has no knowledge base but inheritance is enabled → use parent's
    resolvedKnowledgeBase = parentAgentConfig.knowledgeBase;
  }

  return { resolvedMcpServers, resolvedSkills, resolvedKnowledgeBase };
}

/**
 * Validate that resolved MCP servers and skills are actually available at runtime.
 * Returns a list of human-readable warnings for any unavailable resources.
 * These warnings are surfaced to the parent LLM via the tool result.
 */
export function validateToolAvailability(
  resolved: {
    resolvedMcpServers: SubAgent['resolvedMcpServers'];
    resolvedSkills: SubAgent['resolvedSkills'];
  },
  userAlias: string,
): string[] {
  const warnings: string[] = [];

  // Check MCP servers: compare resolved names against actually connected servers
  try {
    const allRuntimeStates = mcpClientManager.getAllMcpServerRuntimeStates();
    const connectedNames = new Set(
      allRuntimeStates
        .filter(s => s.status === 'connected')
        .map(s => s.serverName)
    );
    for (const server of resolved.resolvedMcpServers) {
      if (!connectedNames.has(server.name)) {
        warnings.push(`MCP server "${server.name}" is not connected (its tools will be unavailable)`);
      }
    }
  } catch (err) {
    getLogger().warn?.(
      `[SubAgentConfigResolver] Failed to check MCP server availability: ${err instanceof Error ? err.message : String(err)}`,
      'validateToolAvailability'
    );
  }

  // Check skills: verify skill directories exist on disk
  try {
    const appPath = app.getPath('userData');
    for (const skill of resolved.resolvedSkills) {
      const skillDir = path.join(appPath, 'profiles', userAlias, 'skills', skill.name);
      if (!existsSync(skillDir)) {
        warnings.push(`Skill "${skill.name}" is not installed`);
      }
    }
  } catch (err) {
    getLogger().warn?.(
      `[SubAgentConfigResolver] Failed to check skill availability: ${err instanceof Error ? err.message : String(err)}`,
      'validateToolAvailability'
    );
  }

  if (warnings.length > 0) {
    getLogger().warn?.(
      `[SubAgentConfigResolver] Tool availability warnings: ${warnings.join('; ')}`,
      'validateToolAvailability'
    );
  }

  return warnings;
}

/**
 * Derive deliverables path from parent session, isolated per sub-agent.
 *
 * Path format: {workspace}/{YYYYMM}/{chatSessionId}/{safeName}-{shortTaskId}
 * This ensures each sub-agent writes to its own subdirectory, preventing file
 * collisions between parallel sub-agents and the parent agent.
 */
export function deriveDeliverablesPath(
  parentSessionId: string,
  parentChatId: string,
  userAlias: string,
  subAgentName: string,
  taskId: string,
): string | undefined {
  try {
    const allChats = profileCacheManager.getAllChatConfigs(userAlias);
    const parentChatConfig = allChats?.find((chat: any) => chat.chat_id === parentChatId);
    const workspacePath = parentChatConfig?.agent?.workspace;
    if (!workspacePath || typeof workspacePath !== 'string' || !workspacePath.trim()) {
      return undefined;
    }

    const sep = workspacePath.includes('\\') ? '\\' : '/';
    const safeName = subAgentName.replace(/[^a-z0-9-]/gi, '-').slice(0, 30);
    const shortTaskId = taskId.slice(0, 12);

    const yearMonth = extractMonthFromChatSessionId(parentSessionId);
    if (yearMonth) {
      return `${workspacePath}${sep}${yearMonth}${sep}${parentSessionId}${sep}${safeName}-${shortTaskId}`;
    }

    return `${workspacePath}${sep}${safeName}-${shortTaskId}`;
  } catch {
    return undefined;
  }
}

/**
 * Sanitize sub-agent result text.
 *
 * Defends against child→parent result injection attacks:
 * Wrapped in explicit structural markers for clarity.
 *
 * See §8.5.2 Mitigation Strategies
 */
export function sanitizeSubAgentResult(result: string): string {
  return [
    '<sub_agent_result>',
    result,
    '</sub_agent_result>',
  ].join('\n');
}
