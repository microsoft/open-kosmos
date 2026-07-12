/**
 * Barrel for the renderer agent cache (sidecar renderer-normalization workstream).
 */

export {
  AgentClientCacheManager,
  agentClientCacheManager,
} from './agentClientCacheManager';
export type {
  AgentCacheData,
  AgentDataListener,
  AgentsChangedPayload,
} from './agentClientCacheManager';
export { useAgent, useAgents } from './useAgents';
export type { ResolvedAgent } from './useAgents';
export {
  chatAgentId,
  resolveChatAgent,
  resolveChatAgents,
  useChatAgent,
  useChatAgentMap,
} from './resolveChatAgent';
export type { ChatAgentSource } from './resolveChatAgent';
