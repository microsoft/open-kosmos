import { BUILTIN_SERVER_NAME } from '../mcpRuntime/builtinMcpClient';
import { mcpClientManager } from '../mcpRuntime/mcpClientManager';
import { createLogger } from '../unifiedLogger';
import { profileCacheManager } from '../userDataADO/profileCacheManager';
import { getChatAgents } from '../userDataADO/agentAccessor';
import { mcpConfigManager } from '../userDataADO/mcpConfigManager';
import type { ChatAgent } from '../userDataADO/types';
import type { SchedulerJob } from './types';

export const SCHEDULER_MCP_READY_GATE_TIMEOUT_MS = 30_000;

const logger = createLogger();

type SchedulerMcpServerResolution = {
  waitTargets: string[];
  requiredServers: string[];
};

export type SchedulerMcpReadiness =
  | (SchedulerMcpServerResolution & { ready: true; notConnected: [] })
  | (SchedulerMcpServerResolution & { ready: false; notConnected: string[] });

const EMPTY_RESOLUTION: SchedulerMcpServerResolution = { waitTargets: [], requiredServers: [] };

export function resolveSchedulerJobMcpServers(
  job: SchedulerJob,
  alias: string | null,
): SchedulerMcpServerResolution {
  if (!alias) {
    return EMPTY_RESOLUTION;
  }

  try {
    const chatConfig = profileCacheManager.getChatConfig(alias, job.chat_id);
    if (!chatConfig) {
      return EMPTY_RESOLUTION;
    }

    const agents: ChatAgent[] = getChatAgents(chatConfig);
    if (agents.length === 0) {
      return EMPTY_RESOLUTION;
    }

    const profile = profileCacheManager.getCachedProfile(alias);
    if (!profile) {
      return EMPTY_RESOLUTION;
    }
    // `in_use !== false` intentionally mirrors the chat tool-gating predicate
    // (agentChatPromptService.getCurrentAvailableTools / mcpClientManager.getInUseServerNames)
    // so a scheduled run waits on exactly the external servers an interactive run would use.
    // Installed MCP server configs are always normalized by sanitizeMcpServerList (`in_use: Boolean(...)`), so
    // `in_use` is a strict boolean here; `in_use !== false` is therefore equivalent to the
    // `Boolean(in_use)` rule mcpClientManager.initialize() uses to start connections. A required
    // server can never be one that initialization would skip, so the gate cannot permanently
    // wedge a job on a server that is never brought up.
    const activeExternalServers = new Set(
      mcpConfigManager.getServers(alias)
        .filter((server) => server.in_use !== false && server.name !== BUILTIN_SERVER_NAME)
        .map((server) => server.name),
    );

    const explicit = new Set<string>();
    for (const agent of agents) {
      const boundServers = agent.mcp_servers ?? [];
      for (const server of boundServers) {
        if (server.name && activeExternalServers.has(server.name)) {
          explicit.add(server.name);
        }
      }
    }

    const requiredServers = Array.from(explicit);
    return { waitTargets: requiredServers, requiredServers };
  } catch (error) {
    logger.warn('scheduler.execute.resolve-mcp-servers-failed', 'resolveSchedulerJobMcpServers', {
      jobId: job.id,
      chatId: job.chat_id,
      alias,
      error: error instanceof Error ? error.message : String(error),
    });
    return EMPTY_RESOLUTION;
  }
}

export async function ensureSchedulerJobMcpReady(
  job: SchedulerJob,
  alias: string | null,
): Promise<SchedulerMcpReadiness> {
  const { waitTargets, requiredServers } = resolveSchedulerJobMcpServers(job, alias);
  if (waitTargets.length > 0) {
    await mcpClientManager.waitForServersSettled(waitTargets, SCHEDULER_MCP_READY_GATE_TIMEOUT_MS);
  }
  const notConnected = requiredServers.filter(
    (name) => mcpClientManager.getMcpServerRuntimeState(name)?.status !== 'connected',
  );
  return notConnected.length > 0
    ? { ready: false, waitTargets, requiredServers, notConnected }
    : { ready: true, waitTargets, requiredServers, notConnected: [] };
}

export function formatSchedulerMcpDisconnectedError(notConnected: string[]): string {
  const serverList = notConnected.length > 0 ? notConnected.join(', ') : 'unknown';
  return notConnected.length === 1
    ? `Required MCP server disconnected: ${serverList}`
    : `Required MCP servers disconnected: ${serverList}`;
}
