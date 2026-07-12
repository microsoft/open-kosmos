/**
 * Single source of truth for resolving a chat's agents in the separated
 * Agent/Chat model. Agents are owned by the standalone store (`agents/{id}`)
 * and a chat references them through `agent_ids`; inline `chat.agent`/`agents`
 * are a hydrated facade kept only for transition. Consumers should read agents
 * through these helpers instead of touching `chat.agent` directly so the inline
 * fields can eventually be removed without another wide refactor.
 */

import { ChatConfig, ChatAgent } from './types/profile';
import { buildAgentId } from '@shared/utils/idFormats';

/**
 * The stable id of an inline agent: its carried `id` when present (UUID-style,
 * minted at creation and preserved across renames), else the legacy
 * name-derived {@link buildAgentId}. New agents always carry an id; only inline
 * agents that predate the standalone store fall back to name derivation. This is
 * the single "inline agent -> id" derivation used across the store/migration
 * paths, so a rename can never change an existing agent's id.
 */
export function agentIdOf(agent: { id?: string; name: string; source?: string }): string {
  return agent.id && agent.id.length > 0 ? agent.id : buildAgentId(agent.name, agent.source);
}

/**
 * Pluggable resolver from `agent_ids` to inline agents. The default is
 * inline-only (returns nothing), so a chat with no inline data resolves empty
 * until a host (profileCacheManager) installs a resolver bound to the active
 * profile's registry. This keeps the accessor free of disk/Electron deps.
 */
let agentResolver: (ids: string[]) => ChatAgent[] = () => [];

/** Install the agent_ids → agents resolver. Pass null to restore the default. */
export function setAccessorAgentResolver(fn: ((ids: string[]) => ChatAgent[]) | null): void {
  agentResolver = fn ?? (() => []);
}

/** Resolve all agents bound to a chat, preferring inline (hydrated) data. */
export function getChatAgents(chat: ChatConfig | null | undefined): ChatAgent[] {
  if (!chat) {
    return [];
  }
  const inlineAgents = chat.agents;
  if (Array.isArray(inlineAgents) && inlineAgents.length > 0) {
    return inlineAgents;
  }
  if (chat.agent) {
    return [chat.agent];
  }
  const ids = Array.isArray(chat.agent_ids) ? chat.agent_ids : [];
  return ids.length > 0 ? agentResolver(ids) : [];
}

/**
 * The primary agent of a chat: the distinct inline `chat.agent` when set (the
 * designated primary/lead a multi-agent chat can carry separately from its
 * `agents` list), otherwise the first resolved agent (`agents[0]` of an inline
 * multi list, or `agent_ids[0]` for a separated chat). Because hydration sets
 * `chat.agent = agents[0]` and separated chats carry no inline `chat.agent`,
 * this only differs from `getChatAgents(chat)[0]` for hand-built configs whose
 * primary differs from `agents[0]` — matching what consumers that read
 * `chat.agent` directly always saw.
 */
export function getChatPrimaryAgent(chat: ChatConfig | null | undefined): ChatAgent | undefined {
  return chat?.agent ?? getChatAgents(chat)[0];
}

/** Resolve the chat-owned runtime workspace path, falling back to legacy agent.workspace during migration. */
export function getChatWorkspace(chat: ChatConfig | null | undefined): string | undefined {
  const workspace = chat?.workspace;
  if (typeof workspace === 'string' && workspace.trim() !== '') {
    return workspace;
  }
  const legacyWorkspace = getChatPrimaryAgent(chat)?.workspace;
  return typeof legacyWorkspace === 'string' && legacyWorkspace.trim() !== ''
    ? legacyWorkspace
    : undefined;
}

/** The agent ids bound to a chat, deriving from inline names when unset. */
export function getChatAgentIds(chat: ChatConfig | null | undefined): string[] {
  if (!chat) {
    return [];
  }
  if (Array.isArray(chat.agent_ids) && chat.agent_ids.length > 0) {
    return chat.agent_ids;
  }
  return getChatAgents(chat)
    .filter((a) => a?.name)
    .map((a) => agentIdOf(a));
}

/** True when a chat owns an agent resolving to the given id. */
export function chatHasAgentId(chat: ChatConfig | null | undefined, agentId: string): boolean {
  return getChatAgentIds(chat).includes(agentId);
}

/**
 * Locate the chat whose `chat_id` matches `primaryChat`. The primary chat is
 * identified by its stable chat_id (never by agent name), so this is a direct
 * id lookup.
 */
export function findChatByPrimaryChat<T extends ChatConfig>(
  chats: T[] | undefined,
  primaryChat: string | undefined,
): T | undefined {
  if (!Array.isArray(chats) || !primaryChat) {
    return undefined;
  }
  return chats.find((chat) => chat.chat_id === primaryChat);
}

/**
 * Collect every agent id still referenced by chats OTHER than `excludeChatId`,
 * scanning both the active `chats` list and the `archived_chats` list. Agents
 * are shared: a single store entry (`agents/{id}`) can be bound to more than one
 * chat. When editing one chat drops an id from its binding, the store entry must
 * only be pruned if no other active or archived chat still references it — this
 * set is the "referenced elsewhere" guard the CRUD write-through passes to
 * {@link import('./agentExtraction').syncChatAgentsToStore} so a shared agent
 * (and its knowledge) is never deleted out from under another chat.
 */
export function collectAgentIdsReferencedByOtherChats(
  profile:
    | { chats?: ChatConfig[]; archived_chats?: { chat_id?: string; agent_ids?: string[] }[] }
    | null
    | undefined,
  excludeChatId: string,
): Set<string> {
  const ids = new Set<string>();
  const activeChats = Array.isArray(profile?.chats) ? profile!.chats : [];
  for (const chat of activeChats) {
    if (!chat || chat.chat_id === excludeChatId) {
      continue;
    }
    for (const id of getChatAgentIds(chat)) {
      ids.add(id);
    }
  }
  const archivedChats = Array.isArray(profile?.archived_chats) ? profile!.archived_chats : [];
  for (const entry of archivedChats) {
    if (!entry || entry.chat_id === excludeChatId) {
      continue;
    }
    const entryIds = Array.isArray(entry.agent_ids) ? entry.agent_ids : [];
    for (const id of entryIds) {
      ids.add(id);
    }
  }
  return ids;
}
