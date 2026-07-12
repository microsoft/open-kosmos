/**
 * Standalone agent store types.
 *
 * These describe the on-disk agent store (`agents/{id}/agent.json` plus the
 * `agents/index.json` index), kept separate from the chat-centric `profile.json`
 * types in {@link ./profile}. Extracted from `profile.ts` to keep that module
 * within its line budget while the agent/chat separation lands.
 */
import type { ChatAgent } from './profile';

/**
 * Standalone Agent configuration, persisted as `agents/{id}/agent.json`.
 *
 * It is a {@link ChatAgent} plus a stable `id`. For agents created after the
 * agent/chat separation the id is a name-independent UUID (`buildAgentUuid`,
 * `agent_{timestamp}_{random}`) so a rename never changes it. Legacy agents
 * migrated from the inline model keep their name-derived id
 * (`buildAgentId` -> `agent-{name}-{source}`), which is already unique and
 * remains stable. This is the SSOT for an agent once agents are separated from
 * chats (1 Chat : N Agents). Additive for now — existing inline
 * `ChatConfig.agent` usage continues to work until migration.
 */
export interface AgentConfig extends ChatAgent {
  /** Stable agent id: `agent_{timestamp}_{random}` (new) or legacy `agent-{name}-{source}`. */
  id: string;
}

/**
 * Lightweight agent index entry stored in the agent index files.
 */
export interface AgentIndexItem {
  /** Agent id (matches the `agents/{id}/` folder). */
  id: string;
  /** Display name (denormalized for fast list rendering). */
  name: string;
}

/**
 * Agent index file schema, used for the single `agents/index.json` (ALL agents).
 */
export interface AgentIndexFile {
  agents: AgentIndexItem[];
}
