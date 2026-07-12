/**
 * SubAgentConfigResolver — Pure helper functions for sub-agent configuration resolution.
 *
 * Extracted from SubAgentManager to keep the manager file under the 1000-line policy.
 * All functions are stateless and operate on their inputs only.
 *
 * File location: src/main/lib/subAgent/subAgentConfigResolver.ts
 */

import type {
  SubAgentConfig,
  AgentMcpServer,
} from '../userDataADO/types/profile';
import { profileCacheManager } from '../userDataADO/profileCacheManager';
import { getChatPrimaryAgent, getChatWorkspace } from '../userDataADO/agentAccessor';
import { extractMonthFromChatSessionId } from '../userDataADO/pathUtils';
import { getModelById } from '../llm/ghcModelsManager';
import { INHERIT_MODEL_VALUE } from '@shared/constants/subAgent';
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
 * Get parent Agent config (for inheritance resolution).
 *
 * Resolve via `getChatPrimaryAgent`, NOT the raw `parentChatConfig.agent`:
 * post-separation `getAllChatConfigs` returns agent_ids-only cache chats (inline
 * agents stripped), so reading `.agent` directly yields `undefined` and the caller
 * fails with "Parent agent config not found" — sub-agents would silently stop
 * inheriting the parent's MCP tools. The accessor resolves `agent_ids` through the
 * store, matching the sibling `deriveDeliverablesPath` below.
 */
export function getParentAgentConfig(
  parentChatId: string,
  userAlias: string,
): { mcp_servers: AgentMcpServer[]; skills?: string[]; knowledgeBase?: string } | undefined {
  try {
    const allChats = profileCacheManager.getAllChatConfigs(userAlias);
    const parentChatConfig = allChats?.find((chat: any) => chat.chat_id === parentChatId);
    return getChatPrimaryAgent(parentChatConfig) ?? undefined;
  } catch {
    return undefined;
  }
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
    const workspacePath = getChatWorkspace(parentChatConfig);
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
