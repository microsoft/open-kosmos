/**
 * Standalone Agent store: persists agents as `agents/{id}/agent.json` plus a
 * single index file. This is the SSOT for the agent/chat separation
 * (1 Chat : N Agents) and replaces the inline `chat.agent` + the legacy
 * `archive/archived_agents.json` layout.
 *
 * Layout:
 *   agents/
 *     index.json            { agents: [{ id, name }] }   ALL agents
 *     {agentId}/agent.json  AgentConfig
 *     {agentId}/knowledge/  per-agent knowledge (moved from chat_workspaces)
 *     {agentId}/memory/     per-agent Memex Memory cards
 *
 * Agents have no active/archived state of their own — "archive" is a CHAT
 * concept tracked by `ProfileV2.archived_chats` (profile.json). Every agent,
 * whether its chat is active or archived, lives in the one `index.json`.
 *
 * The store is intentionally free of Electron deps — it operates on an absolute
 * profile directory so it is trivially testable on a temp dir.
 */

import * as fs from 'fs';
import * as path from 'path';
import { AgentConfig, AgentIndexFile, AgentIndexItem } from './types/agentStore';
import { writeFileAtomicallyWithRetry } from './atomicFileWrite';
import { isNormalizedAgentSystemPrompt, normalizeAgentSystemPrompt } from '@shared/types/agentSystemPrompt';

/** The single agent index file name (relative to `agents/`). */
export const AGENT_INDEX_FILE = 'index.json';

/** Absolute `agents/` directory for a profile. */
export function getAgentsRootDir(profileDir: string): string {
  return path.join(profileDir, 'agents');
}

/**
 * A store agent id must be a single safe path segment. Every per-agent path
 * (config, knowledge, and {@link deleteAgent}'s recursive-rm target) is derived
 * from the id via {@link getAgentDir}, so an id carrying a path separator or `..`
 * would let `writeAgent`/`deleteAgent` escape `agents/` — `deleteAgent` would
 * recursively remove an arbitrary directory. Ids DERIVED by `buildAgentId` are
 * already sanitized, but ids carried verbatim on `ChatAgent.id` / `chat.agent_ids`
 * (renderer- or profile-supplied, e.g. a corrupted profile.json) bypass that, so
 * they are confined here at the single choke point.
 */
export function isSafeAgentId(agentId: unknown): agentId is string {
  return (
    typeof agentId === 'string' &&
    agentId.length > 0 &&
    agentId !== '.' &&
    agentId !== '..' &&
    !agentId.includes('/') &&
    !agentId.includes('\\') &&
    !agentId.includes('\0')
  );
}

/** Absolute `agents/{id}/` directory for one agent. */
export function getAgentDir(profileDir: string, agentId: string): string {
  if (!isSafeAgentId(agentId)) {
    throw new Error(`Unsafe agent id rejected by path-traversal guard: ${JSON.stringify(agentId)}`);
  }
  return path.join(getAgentsRootDir(profileDir), agentId);
}

/** Absolute `agents/{id}/agent.json` path. */
export function getAgentConfigPath(profileDir: string, agentId: string): string {
  return path.join(getAgentDir(profileDir, agentId), 'agent.json');
}

/** Absolute `agents/{id}/knowledge/` directory. */
export function getAgentKnowledgeDir(profileDir: string, agentId: string): string {
  return path.join(getAgentDir(profileDir, agentId), 'knowledge');
}

/** Absolute `agents/{id}/memory/` directory for Memex Memory. */
export function getAgentMemoryDir(profileDir: string, agentId: string): string {
  return path.join(getAgentDir(profileDir, agentId), 'memory');
}

/** Absolute path of the agent index file. */
export function getAgentIndexPath(profileDir: string): string {
  return path.join(getAgentsRootDir(profileDir), AGENT_INDEX_FILE);
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * In-memory agent registry keyed by absolute profile dir. The standalone store
 * is the disk SSOT; this registry is its hot cache so the IPC boundary can
 * re-inject inline agents into chats (by `agent_ids`) without a disk read per
 * notification. Populated on profile load; cleared on cache clear.
 */
const registry = new Map<string, Map<string, AgentConfig>>();

/** Replace all registry agents for a profile dir. */
export function setRegistryAgents(profileDir: string, agents: AgentConfig[]): void {
  const map = new Map<string, AgentConfig>();
  for (const agent of agents) {
    if (agent?.id) {
      map.set(agent.id, agent);
    }
  }
  registry.set(profileDir, map);
}

/**
 * Insert or replace a single agent in the registry (write-through on persist).
 * Creates the per-profile map if this is the first entry so a write before the
 * load-time {@link setRegistryAgents} still establishes a hot-cache entry.
 */
export function upsertRegistryAgent(profileDir: string, agent: AgentConfig): void {
  if (!agent?.id) {
    return;
  }
  let map = registry.get(profileDir);
  if (!map) {
    map = new Map<string, AgentConfig>();
    registry.set(profileDir, map);
  }
  map.set(agent.id, agent);
}

/** Evict a single agent from the registry (write-through on delete). */
export function removeRegistryAgent(profileDir: string, agentId: string): void {
  registry.get(profileDir)?.delete(agentId);
}

/** Read one registered agent, or null when absent. */
export function getRegistryAgent(profileDir: string, agentId: string): AgentConfig | null {
  return registry.get(profileDir)?.get(agentId) ?? null;
}

/** Resolve a list of agent ids against the registry, skipping unknown ids. */
export function getRegistryAgentsByIds(profileDir: string, ids: string[]): AgentConfig[] {
  const map = registry.get(profileDir);
  if (!map) {
    return [];
  }
  return ids
    .map((id) => map.get(id))
    .filter((a): a is AgentConfig => a != null);
}

/**
 * Snapshot every registered agent for a profile dir. Used by the granular
 * `agents:changed` push and the `agents:getAll` pull so the renderer's
 * normalized agent cache can hold the full set independent of chat references.
 */
export function getAllRegistryAgents(profileDir: string): AgentConfig[] {
  const map = registry.get(profileDir);
  return map ? Array.from(map.values()) : [];
}

/** Drop the registry for one profile dir, or all when none is given. */
export function clearRegistry(profileDir?: string): void {
  if (profileDir) {
    registry.delete(profileDir);
  } else {
    registry.clear();
  }
}

/** Read one agent's config, or null when missing/unparseable. */
export function readAgent(profileDir: string, agentId: string): AgentConfig | null {
  try {
    const file = getAgentConfigPath(profileDir, agentId);
    if (!fs.existsSync(file)) {
      return null;
    }
    const agent = JSON.parse(fs.readFileSync(file, 'utf8')) as AgentConfig;
    return {
      ...agent,
      system_prompt: normalizeAgentSystemPrompt(agent.system_prompt),
    };
  } catch {
    return null;
  }
}

/** Persist one agent's config (atomically) and reflect it in the index. */
export async function writeAgent(
  profileDir: string,
  agent: AgentConfig
): Promise<void> {
  if (!agent?.id) {
    throw new Error('AgentConfig.id is required to persist an agent.');
  }
  if (!isSafeAgentId(agent.id)) {
    throw new Error(`AgentConfig.id is not a safe path segment: ${JSON.stringify(agent.id)}`);
  }
  const agentDir = getAgentDir(profileDir, agent.id);
  // An agent is only "durable" once it is BOTH on disk AND in the index: `readAgent`
  // (and the `syncChatAgentsToStore` durability gate keyed on it) checks `agent.json`,
  // while `listAgents` and the load-time registry rebuild are index-driven. If the
  // index write below fails for a NEWLY created agent, the orphaned `agent.json` would
  // let the gate report it durable while every index-driven reader omits it — the chat
  // would strip its inline copy and bind `agent_ids` to an id that is unresolvable now
  // and after restart. Roll the orphan back so `readAgent` reports the truth. For an
  // UPDATE we keep the freshly written config: the pre-existing index entry already
  // makes the agent reachable, so deleting its dir (and knowledge) would be the very
  // data loss we are guarding against.
  const isNewAgent = !fs.existsSync(getAgentConfigPath(profileDir, agent.id));
  ensureDir(agentDir);
  ensureDir(getAgentKnowledgeDir(profileDir, agent.id));
  ensureDir(getAgentMemoryDir(profileDir, agent.id));
  const { workspace: _legacyWorkspace, ...agentWithoutWorkspace } = agent as AgentConfig & { workspace?: string };
  const agentForDisk = {
    ...agentWithoutWorkspace,
    system_prompt: normalizeAgentSystemPrompt(agentWithoutWorkspace.system_prompt),
  } as AgentConfig;
  await writeFileAtomicallyWithRetry(
    getAgentConfigPath(profileDir, agent.id),
    JSON.stringify(agentForDisk, null, 2)
  );
  try {
    await upsertIndex(profileDir, { id: agent.id, name: agent.name });
  } catch (error) {
    if (isNewAgent) {
      try {
        fs.rmSync(agentDir, { recursive: true, force: true });
      } catch {
        // Best-effort rollback; the caller's failure still propagates below.
      }

    }
    throw error;
  }
  // Write-through the hot registry so the IPC re-injection at the notification
  // boundary (performNotification → getRegistryAgentsByIds) serves THIS edit,
  // not the load-time snapshot. Without it the renderer receives a stale
  // chat.agent after a save and the editor immediately re-dirties.
  upsertRegistryAgent(profileDir, agentForDisk);
}

/**
 * List all known agent configs from the single index, skipping ids whose
 * `agent.json` is missing.
 */
export function listAgents(profileDir: string): AgentConfig[] {
  const agents: AgentConfig[] = [];
  for (const item of readIndex(profileDir)) {
    const agent = readAgent(profileDir, item.id);
    if (agent) {
      agents.push(agent);
    }
  }
  return agents;
}

/**
 * Rewrite legacy stored agent configs whose `system_prompt` is still a string
 * into the file-map shape. Best-effort per agent so one corrupt file does not
 * block the rest of profile load.
 */
export async function migrateStoredAgentSystemPrompts(
  profileDir: string,
  onError?: (agentId: string, error: unknown) => void,
): Promise<boolean> {
  let changed = false;
  for (const item of readIndex(profileDir)) {
    if (!item?.id || !isSafeAgentId(item.id)) {
      continue;
    }
    try {
      const file = getAgentConfigPath(profileDir, item.id);
      if (!fs.existsSync(file)) {
        continue;
      }
      const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as AgentConfig;
      if (isNormalizedAgentSystemPrompt(raw.system_prompt)) {
        continue;
      }
      await writeAgent(profileDir, {
        ...raw,
        id: item.id,
        system_prompt: normalizeAgentSystemPrompt(raw.system_prompt),
      });
      changed = true;
    } catch (error) {
      onError?.(item.id, error);
    }
  }
  return changed;
}

export async function stripStoredAgentWorkspaces(
  profileDir: string,
  onError?: (agentId: string, error: unknown) => void,
): Promise<boolean> {
  let changed = false;
  for (const agent of listAgents(profileDir)) {
    if (!('workspace' in agent)) {
      continue;
    }
    try {
      await writeAgent(profileDir, agent);
      changed = true;
    } catch (error) {
      onError?.(agent.id, error);
    }
  }
  return changed;
}

/** Read the agent index file, returning [] when absent or invalid. */
export function readIndex(profileDir: string): AgentIndexItem[] {
  try {
    const file = getAgentIndexPath(profileDir);
    if (!fs.existsSync(file)) {
      return [];
    }
    const data = JSON.parse(fs.readFileSync(file, 'utf8')) as AgentIndexFile;
    return Array.isArray(data?.agents) ? data.agents : [];
  } catch {
    return [];
  }
}

async function writeIndex(
  profileDir: string,
  items: AgentIndexItem[]
): Promise<void> {
  ensureDir(getAgentsRootDir(profileDir));
  await writeFileAtomicallyWithRetry(
    getAgentIndexPath(profileDir),
    JSON.stringify({ agents: items } satisfies AgentIndexFile, null, 2)
  );
}

async function upsertIndex(
  profileDir: string,
  item: AgentIndexItem
): Promise<void> {
  const items = readIndex(profileDir);
  const idx = items.findIndex((i) => i.id === item.id);
  if (idx >= 0) {
    items[idx] = item;
  } else {
    items.push(item);
  }
  await writeIndex(profileDir, items);
}

async function removeFromIndex(
  profileDir: string,
  agentId: string
): Promise<void> {
  const items = readIndex(profileDir);
  const next = items.filter((i) => i.id !== agentId);
  if (next.length !== items.length) {
    await writeIndex(profileDir, next);
  }
}

/** Legacy split-index file names, retired in favor of the single index.json. */
const LEGACY_INDEX_FILES = ['index_active.json', 'index_archived.json'] as const;

/** Read a legacy index file by absolute path, returning [] on any failure. */
function readLegacyIndex(filePath: string): AgentIndexItem[] {
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8')) as AgentIndexFile;
    return Array.isArray(data?.agents) ? data.agents : [];
  } catch {
    return [];
  }
}

/**
 * One-time store-format migration: merge the legacy split indexes
 * (`index_active.json` + `index_archived.json`) into the single `index.json`,
 * then delete the split files. Unions by id (an existing `index.json` entry
 * wins, then active, then archived). Idempotent — a no-op once the split files
 * are gone. Best-effort: if the merge/write fails the legacy files are left
 * intact for the next load, and the function resolves false rather than throwing
 * (so a profile load is never broken by a consolidation hiccup). Returns true
 * when the split files were merged and removed.
 */
export async function consolidateLegacyAgentIndexes(profileDir: string): Promise<boolean> {
  const root = getAgentsRootDir(profileDir);
  const present = LEGACY_INDEX_FILES
    .map((name) => path.join(root, name))
    .filter((p) => fs.existsSync(p));
  if (present.length === 0) {
    return false;
  }
  try {
    const byId = new Map<string, AgentIndexItem>();
    for (const item of readIndex(profileDir)) {
      if (item?.id) {
        byId.set(item.id, item);
      }
    }
    for (const filePath of present) {
      for (const item of readLegacyIndex(filePath)) {
        if (item?.id && !byId.has(item.id)) {
          byId.set(item.id, item);
        }
      }
    }
    await writeIndex(profileDir, [...byId.values()]);
    for (const filePath of present) {
      try {
        fs.rmSync(filePath, { force: true });
      } catch {
        /* best-effort: a leftover split file is retried on the next load. */
      }
    }
    return true;
  } catch {
    // Keep the legacy split files intact (no data loss) and retry next load.
    return false;
  }
}

/** Delete an agent's folder and remove it from the index. */
export async function deleteAgent(profileDir: string, agentId: string): Promise<void> {
  // Defense-in-depth: never let an unsafe id reach the recursive rmSync below,
  // independent of getAgentDir's own guard. A traversal id is not a real store
  // entry, so skipping it is a safe no-op.
  if (!isSafeAgentId(agentId)) {
    return;
  }
  const dir = getAgentDir(profileDir, agentId);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  await removeFromIndex(profileDir, agentId);
  // Keep the hot registry in lockstep with disk on removal.
  removeRegistryAgent(profileDir, agentId);
}
