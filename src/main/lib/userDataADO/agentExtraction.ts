/** Disk extraction sidecar for agent/chat separation. */

import { ProfileV2, ChatAgent, ChatConfig, ArchivedChatEntry } from './types/profile';
import { AgentConfig } from './types/agentStore';
import { buildAgentUuid, buildAgentId } from '@shared/utils/idFormats';
import { readAgent, writeAgent, deleteAgent, getAgentKnowledgeDir, getAgentsRootDir, listAgents, setRegistryAgents, consolidateLegacyAgentIndexes, isSafeAgentId, migrateStoredAgentSystemPrompts, stripStoredAgentWorkspaces } from './agentStoreManager';
import { getChatAgentIds, getChatAgents, agentIdOf } from './agentAccessor';
import { moveContentsToDirectory } from './pathUtils';
import { migrateMemexMemoryToAgentStore } from './memexMemoryMigration';
import { createConsoleLogger } from '../unifiedLogger';
import * as fs from 'fs';
import * as path from 'path';

const logger = createConsoleLogger();

/** Normalize a thrown value to a log-friendly string (single covered branch). */
function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Rebuild missing inline chat agents from the store using `agent_ids`. */
export function hydrateChatsFromStore(profileDir: string, profile: ProfileV2): boolean {
  const chats = Array.isArray(profile.chats) ? profile.chats : [];
  let changed = false;
  for (const chat of chats) {
    const ids = Array.isArray(chat.agent_ids) ? chat.agent_ids : [];
    if (ids.length === 0 || chat.agent || (Array.isArray(chat.agents) && chat.agents.length > 0)) {
      continue;
    }
    const resolved = ids.map((id) => readAgent(profileDir, id)).filter((a): a is AgentConfig => a !== null);
    if (resolved.length === 0) {
      continue;
    }
    chat.agent = resolved[0];
    if (resolved.length > 1) {
      chat.agents = resolved;
    }
    changed = true;
  }
  return changed;
}

/** First `chat_workspaces` subdir segment for an in-profile path. */
function workspaceSubdir(profileDir: string, candidate: string | undefined | null): string | null {
  if (typeof candidate !== 'string' || candidate.length === 0) {
    return null;
  }
  const rel = path.relative(path.join(profileDir, 'chat_workspaces'), candidate);
  if (rel.length === 0 || rel.startsWith('..')) {
    return null;
  }
  /* v8 ignore next 3 -- Windows cross-drive only; path.relative never yields an absolute path on POSIX */
  if (path.isAbsolute(rel)) {
    return null;
  }
  return rel.split(path.sep)[0];
}

/** Candidate legacy `chat_workspaces` dirs for a chat; knowledge references are excluded. */
export function legacyWorkspaceDirNames(profileDir: string, chat: ChatConfig): string[] {
  const names = new Set<string>(getChatAgentIds(chat));
  const chatSub = workspaceSubdir(profileDir, chat.workspace);
  if (chatSub !== null) {
    names.add(chatSub);
  }
  for (const agent of getChatAgents(chat)) {
    if (agent?.name) {
      names.add(buildAgentId(agent.name, agent.source));
    }
    const sub = workspaceSubdir(profileDir, agent?.workspace);
    if (sub !== null) {
      names.add(sub);
    }
  }
  return [...names];
}

function firstLegacyAgentWorkspace(chat: ChatConfig): string {
  for (const agent of getChatAgents(chat)) {
    const workspace = agent?.workspace;
    if (typeof workspace === 'string' && workspace.trim() !== '') {
      return workspace;
    }
  }
  return '';
}

function stripInlineAgentWorkspaces(chat: ChatConfig): boolean {
  let changed = false;
  if (chat.agent && 'workspace' in chat.agent) {
    delete chat.agent.workspace;
    changed = true;
  }
  if (Array.isArray(chat.agents)) {
    for (const agent of chat.agents) {
      if (agent && 'workspace' in agent) {
        delete agent.workspace;
        changed = true;
      }
    }
  }
  return changed;
}

/** Move legacy agent-owned workspace configuration onto the owning chat. */
export function migrateWorkspaceToChat(profile: ProfileV2): boolean {
  const chats = Array.isArray(profile.chats) ? profile.chats : [];
  let changed = false;
  for (const chat of chats) {
    const chatWorkspace = typeof chat.workspace === 'string' ? chat.workspace : '';
    if (chatWorkspace.trim() === '') {
      const legacyWorkspace = firstLegacyAgentWorkspace(chat);
      if (legacyWorkspace) {
        chat.workspace = legacyWorkspace;
        changed = true;
      }
    }
    changed = stripInlineAgentWorkspaces(chat) || changed;
  }
  return changed;
}

/**
 * Ensure every chat carries `agent_ids` derived from its inline agent(s).
 * Idempotent: chats that already hold a non-empty `agent_ids` are left as-is.
 * Runs on every load independent of the migration version, so a profile that
 * reached a bumped `profileMigrationVersion` WITHOUT persisted agent_ids (e.g.
 * an early/interrupted agent-separation build) still heals — agent_ids is the
 * precondition `stripInlineChatAgentsForDisk` needs before it can drop inline
 * agents from disk. Returns true when any chat was updated.
 */
export function ensureChatAgentIds(profile: ProfileV2): boolean {
  const chats = Array.isArray(profile.chats) ? profile.chats : [];
  let changed = false;
  for (const chat of chats) {
    if (Array.isArray(chat.agent_ids) && chat.agent_ids.length > 0) {
      continue;
    }
    const ids = getChatAgentIds(chat);
    if (ids.length > 0) {
      chat.agent_ids = ids;
      changed = true;
    }
  }
  return changed;
}

/** Consolidate legacy workspace dirs and paths into chat_workspaces/{chat_id}. */
export function consolidateWorkspaceDirsToChatId(profileDir: string, profile: ProfileV2): boolean {
  const chats = Array.isArray(profile.chats) ? profile.chats : [];
  let moved = false;
  for (const chat of chats) {
    const ids = legacyWorkspaceDirNames(profileDir, chat);
    if (!isSafeAgentId(chat.chat_id)) {
      continue;
    }
    const target = path.join(profileDir, 'chat_workspaces', chat.chat_id);
    const workspace = typeof chat.workspace === 'string' ? chat.workspace.trim() : '';
    const workspaceRoot = path.join(profileDir, 'chat_workspaces');
    const isProfileWorkspace = workspaceSubdir(profileDir, workspace) !== null || path.resolve(workspace) === path.resolve(workspaceRoot);
    if (workspace && isProfileWorkspace && path.resolve(workspace) !== path.resolve(target)) {
      chat.workspace = target;
      moved = true;
    }
    for (const id of ids) {
      if (id === chat.chat_id || !isSafeAgentId(id)) {
        continue;
      }
      const legacy = path.join(profileDir, 'chat_workspaces', id);
      try {
        if (!fs.existsSync(legacy) || !fs.statSync(legacy).isDirectory()) {
          continue;
        }
        fs.mkdirSync(target, { recursive: true });
        moved = moveContentsToDirectory(legacy, target, ['knowledge']) > 0 || moved;
        if (fs.readdirSync(legacy).length === 0) {
          fs.rmdirSync(legacy);
        }
      } catch (error) {
        logger.warn('[agentExtraction] Failed to consolidate workspace (non-fatal)', 'consolidateWorkspaceDirsToChatId', {
          chatId: chat.chat_id, agentId: id, reason: reason(error),
        });
      }
    }
  }
  return moved;
}

/** Move legacy per-agent knowledge into `agents/{id}/knowledge` best-effort. */
export async function migrateKnowledgeToAgentStore(profileDir: string, profile: ProfileV2): Promise<boolean> {
  const chats = Array.isArray(profile.chats) ? profile.chats : [];
  let moved = false;
  for (const chat of chats) {
    const ids = getChatAgentIds(chat);
    if (ids.length === 0) {
      continue;
    }
    const agents = getChatAgents(chat);
    for (let index = 0; index < ids.length; index += 1) {
      const targetId = ids[index];
      if (!targetId || !isSafeAgentId(targetId)) {
        continue;
      }
      const target = getAgentKnowledgeDir(profileDir, targetId);
      const agent = agents[index];
      const sources = new Set<string>([targetId]);
      if (agent?.name) {
        sources.add(buildAgentId(agent.name, agent.source));
        const workspaceDir = workspaceSubdir(profileDir, agent.workspace);
        if (workspaceDir !== null) {
          sources.add(workspaceDir);
        }
      }
      if (ids.length === 1) {
        if (chat.chat_id) {
          sources.add(chat.chat_id);
        }
        const chatWorkspaceDir = workspaceSubdir(profileDir, chat.workspace);
        if (chatWorkspaceDir !== null) {
          sources.add(chatWorkspaceDir);
        }
      }
      for (const dir of sources) {
        if (!isSafeAgentId(dir)) {
          continue;
        }
        const legacy = path.join(profileDir, 'chat_workspaces', dir, 'knowledge');
        try {
          if (!fs.existsSync(legacy) || !fs.statSync(legacy).isDirectory()) {
            continue;
          }
          const entries = fs.readdirSync(legacy);
          if (entries.length === 0) {
            fs.rmdirSync(legacy);
            if (dir !== chat.chat_id && fs.readdirSync(path.dirname(legacy)).length === 0) {
              fs.rmdirSync(path.dirname(legacy));
            }
            moved = true;
            continue;
          }
          fs.mkdirSync(target, { recursive: true });
          for (const name of entries) {
            const dst = path.join(target, name);
            if (fs.existsSync(dst)) {
              continue;
            }
            fs.renameSync(path.join(legacy, name), dst);
            moved = true;
          }
          if (fs.readdirSync(legacy).length === 0) {
            fs.rmdirSync(legacy);
          }
        } catch (error) {
          logger.warn('[agentExtraction] Failed to move knowledge (non-fatal)', 'migrateKnowledgeToAgentStore', {
            agentId: targetId, dir, reason: reason(error),
          });
        }
      }

      const ownDirKb = (p: string | undefined): boolean => {
        const sub = workspaceSubdir(profileDir, p);
        return sub !== null && sources.has(sub);
      };
      const inline = agents[index];
      if (inline?.knowledge && ownDirKb(inline.knowledge.knowledgeBase)) {
        inline.knowledge.knowledgeBase = target;
        moved = true;
      }
      if (index === 0 && chat.agent?.knowledge && ownDirKb(chat.agent.knowledge.knowledgeBase)) {
        chat.agent.knowledge.knowledgeBase = target;
        moved = true;
      }
      const stored = readAgent(profileDir, targetId);
      if (stored?.knowledge && ownDirKb(stored.knowledge.knowledgeBase)) {
        stored.knowledge.knowledgeBase = target;
        try {
          await writeAgent(profileDir, stored);
          moved = true;
        } catch (error) {
          logger.warn('[agentExtraction] Failed to repoint stored knowledgeBase (non-fatal)', 'migrateKnowledgeToAgentStore', {
            agentId: targetId, reason: reason(error),
          });
        }
      }
    }
  }
  return moved;
}

/**
 * Final knowledge-reference pass, run AFTER every agent's knowledge has been
 * relocated (active AND archived). A knowledgeBase that STILL points inside
 * chat_workspaces here is a CROSS-agent reference: the agent reads another
 * agent's knowledge (e.g. an active agent sharing an archived agent's docs).
 * Follow it to that knowledge's new `agents/{ownerId}/knowledge` home — but ONLY
 * when the knowledge actually migrated (the store dir now exists with content).
 * A reference whose knowledge did not migrate, or that points at the user's own
 * external folder, is left untouched. Updates both the inline agents on active
 * chats and the stored agent.json SSOT (active and archived). Returns true when
 * anything changed.
 */
export async function repointCrossAgentKnowledge(profileDir: string, profile: ProfileV2): Promise<boolean> {
  const chats = Array.isArray(profile.chats) ? profile.chats : [];
  const storeAgents = listAgents(profileDir);
  // Resolve a legacy workspace subdir name to the store id whose knowledge it
  // migrated under. Two key kinds coexist without collision (chat_… vs agent-…):
  //   • chat_id → the chat's agent store id (kb pointed at chat_workspaces/{chat_id});
  //   • the legacy name-derived id agent-{name}-{source} → store id (kb still points
  //     at the pre-consolidation per-agent dir). The name-derived mapping is
  //     essential now that store ids are UUIDs and no longer equal the legacy dir
  //     name — it covers BOTH active and archived agents via the single store index.
  const dirNameToStoreId = new Map<string, string>();
  for (const chat of chats) {
    const id = getChatAgentIds(chat)[0];
    if (chat.chat_id && id) {
      dirNameToStoreId.set(chat.chat_id, id);
    }
  }
  for (const stored of storeAgents) {
    if (stored.id) {
      dirNameToStoreId.set(buildAgentId(stored.name, stored.source), stored.id);
    }
  }
  // Resolve a kb path to the store knowledge dir it should follow to, or null
  // when it must stay as-is (external path, or knowledge not actually migrated).
  const followTarget = (kb: string | undefined | null): string | null => {
    const refDir = workspaceSubdir(profileDir, kb);
    if (refDir === null) {
      return null;
    }
    // A malformed agent_ids entry can seed dirNameToStoreId with a traversal id;
    // reject it before getAgentKnowledgeDir throws (treat as "not migrated").
    const resolvedId = dirNameToStoreId.get(refDir) ?? refDir;
    if (!isSafeAgentId(resolvedId)) {
      return null;
    }
    const dest = getAgentKnowledgeDir(profileDir, resolvedId);
    try {
      // A missing dir (ENOENT) or a file at that path (ENOTDIR) throws and is
      // treated as "not migrated"; an empty dir is migrated-but-empty -> skip.
      return fs.readdirSync(dest).length > 0 ? dest : null;
    } catch {
      return null;
    }
  };

  let changed = false;
  // Inline agents on active chats (the renderer-facing facade).
  for (const chat of chats) {
    for (const agent of getChatAgents(chat)) {
      const kb = agent?.knowledge;
      if (!kb) {
        continue;
      }
      const dest = followTarget(kb.knowledgeBase);
      if (dest !== null) {
        kb.knowledgeBase = dest;
        changed = true;
      }
    }
  }
  // Stored agent.json SSOT (all agents).
  for (const stored of storeAgents) {
    const kb = stored.knowledge;
    if (!kb) {
      continue;
    }
    const dest = followTarget(kb.knowledgeBase);
    if (dest === null) {
      continue;
    }
    kb.knowledgeBase = dest;
    try {
      await writeAgent(profileDir, stored);
      changed = true;
    } catch (error) {
      logger.warn('[agentExtraction] Failed to repoint cross-agent knowledgeBase (non-fatal)', 'repointCrossAgentKnowledge', {
        agentId: stored.id, reason: reason(error),
      });
    }
  }
  return changed;
}

/**
 * Run every agent-store migration for one profile load, in dependency order:
 * collapse any legacy split agent indexes into the single `index.json`, mirror
 * inline agents into the store, hydrate chats that lost inline data, heal
 * missing agent_ids, relocate per-agent knowledge and Memex Memory into the store, consolidate
 * legacy chat_workspaces/{agentId} dirs into the chat_id dir, import the legacy
 * archived-chat list onto `profile.archived_chats`, repoint cross-agent knowledge
 * references to wherever that knowledge migrated, then refresh the in-memory
 * registry (Memex memory only once the relevant active/archived ids are durable,
 * so a failed save cannot strand it under a re-minted id). Best-effort; returns true
 * when any profile mutation needs re-save.
 */
export async function runAgentStoreMigrations(profileDir: string, profile: ProfileV2, durableProfile?: ProfileV2): Promise<boolean> {
  await consolidateLegacyAgentIndexes(profileDir);
  await extractAgentsToStore(profileDir, profile);
  const storedPromptChanged = await migrateStoredAgentSystemPrompts(profileDir, (agentId, error) => {
    logger.warn('[agentExtraction] Failed to migrate stored agent system prompt (non-fatal)', 'runAgentStoreMigrations', {
      agentId,
      reason: reason(error),
    });
  });
  hydrateChatsFromStore(profileDir, profile);
  const workspaceChanged = migrateWorkspaceToChat(profile);
  const healed = ensureChatAgentIds(profile);
  const activeKnowledgeChanged = await migrateKnowledgeToAgentStore(profileDir, profile);
  const activeMemexChanged = migrateMemexMemoryToAgentStore(profileDir, profile, durableProfile);
  const activeWorkspaceChanged = consolidateWorkspaceDirsToChatId(profileDir, profile);
  // Capture archive-list durability BEFORE migrateArchivedAgentsToStore may freshly import it; archived
  // Memex memory migrates only once the ids are durable (see JSDoc) to avoid stranding it under a re-mintable id.
  const archivedIdsWereDurable = Array.isArray(profile.archived_chats);
  const archivedChanged = await migrateArchivedAgentsToStore(profileDir, profile);
  const archivedProfile = Array.isArray(profile.archived_chats)
    ? ({ chats: profile.archived_chats as unknown as ChatConfig[] } as ProfileV2)
    : null;
  const archivedKnowledgeChanged = archivedProfile ? await migrateKnowledgeToAgentStore(profileDir, archivedProfile) : false;
  const archivedMemexChanged = archivedProfile && archivedIdsWereDurable ? migrateMemexMemoryToAgentStore(profileDir, archivedProfile) : false;
  const archivedWorkspaceChanged = archivedProfile ? consolidateWorkspaceDirsToChatId(profileDir, archivedProfile) : false;
  const repointChanged = await repointCrossAgentKnowledge(profileDir, profile);
  const storedWorkspaceChanged = await stripStoredAgentWorkspaces(profileDir, (agentId, error) => {
    logger.warn('[agentExtraction] Failed to strip stored agent workspace (non-fatal)', 'stripStoredAgentWorkspaces', {
      agentId,
      reason: reason(error),
    });
  });
  setRegistryAgents(profileDir, listAgents(profileDir));
  return healed || archivedChanged || workspaceChanged || activeKnowledgeChanged || activeMemexChanged || activeWorkspaceChanged || archivedKnowledgeChanged || archivedMemexChanged || archivedWorkspaceChanged || repointChanged || storedPromptChanged || storedWorkspaceChanged;
}

/**
 * A legacy/transitional archived-chat entry as read from disk: the legacy
 * `archive/archived_agents.json` inlines the full `agent`, while the former
 * store-backed `agents/archived_chats.json` references agents by `agent_ids`.
 * Both are normalized into {@link ArchivedChatEntry} on `profile.archived_chats`.
 */
interface LegacyArchivedEntry {
  chat_id?: string;
  chat_type?: ChatConfig['chat_type'];
  workspace?: string;
  agent?: ChatAgent;
  agent_ids?: string[];
  archived_at?: string;
  starred_sessions?: unknown;
  [key: string]: unknown;
}

/**
 * Resolve the archived-chats source file. Prefers the store-backed
 * `agents/archived_chats.json` (post-migration SSOT), and falls back to the
 * legacy `archive/archived_agents.json`. Only a regular FILE qualifies so a
 * stray directory at the target path can never masquerade as the source.
 */
function resolveArchivedChatsSource(profileDir: string): { path: string; legacy: boolean } | null {
  // statSync alone (no preceding existsSync) avoids a TOCTOU race and tolerates a
  // missing path or stat failure by treating it as "not a file".
  const isFile = (p: string): boolean => {
    try {
      return fs.statSync(p).isFile();
    } catch {
      return false;
    }
  };
  const storePath = path.join(getAgentsRootDir(profileDir), 'archived_chats.json');
  if (isFile(storePath)) {
    return { path: storePath, legacy: false };
  }
  const legacyPath = path.join(profileDir, 'archive', 'archived_agents.json');
  if (isFile(legacyPath)) {
    return { path: legacyPath, legacy: true };
  }
  return null;
}

/** Derive an archived entry's agent ids: explicit `agent_ids` win, else derive. */
function resolveArchivedEntryIds(entry: LegacyArchivedEntry): string[] {
  const explicit = Array.isArray(entry.agent_ids)
    ? entry.agent_ids.filter((id): id is string => typeof id === 'string' && id.length > 0)
    : [];
  if (explicit.length > 0) {
    return explicit;
  }
  return entry.agent?.name ? [agentIdOf(entry.agent)] : [];
}

/** Remove a file if it exists. Returns true when a file was actually removed. */
function removeFileIfExists(filePath: string, context: string): boolean {
  try {
    if (fs.existsSync(filePath)) {
      fs.rmSync(filePath, { force: true });
      return true;
    }
  } catch (error) {
    logger.warn('[agentExtraction] Failed to remove file (non-fatal)', context, {
      filePath, reason: reason(error),
    });
  }
  return false;
}

/**
 * Retire the transitional standalone archive files once `profile.json` owns the
 * archive list: the store-backed `agents/archived_chats.json`, the legacy
 * `archive/archived_agents.json`, and the now-empty `archive/` dir. Best-effort;
 * returns true when anything was removed.
 */
function retireTransitionalArchiveFiles(profileDir: string): boolean {
  let changed = false;
  if (removeFileIfExists(path.join(getAgentsRootDir(profileDir), 'archived_chats.json'), 'retireTransitionalArchiveFiles')) {
    changed = true;
  }
  if (removeFileIfExists(path.join(profileDir, 'archive', 'archived_agents.json'), 'retireTransitionalArchiveFiles')) {
    changed = true;
  }
  const legacyArchiveDir = path.join(profileDir, 'archive');
  try {
    if (fs.existsSync(legacyArchiveDir) && fs.readdirSync(legacyArchiveDir).length === 0) {
      fs.rmdirSync(legacyArchiveDir);
      changed = true;
    }
  } catch (error) {
    logger.warn('[agentExtraction] Failed to remove empty archive dir (non-fatal)', 'retireTransitionalArchiveFiles', {
      reason: reason(error),
    });
  }
  return changed;
}

/**
 * Migrate the legacy/transitional archived-chat LIST onto `profile.archived_chats`
 * (the SSOT in `profile.json`) and ensure each archived chat's agent exists in the
 * standalone store. "Archive" is a chat concept: the agent is persisted exactly
 * like any other — one `agents/{id}/` dir (agent.json + knowledge) registered in
 * the single `index.json` — and the chat's workspace dir is consolidated to
 * `{chat_id}` with knowledge relocated into the store (reusing the active-chat
 * helpers via synthetic chats). There is no separate archived agent index.
 *
 * Each archived agent lacking an id is minted a stable UUID first, exactly like
 * active chats, so archived and active agents share ONE id scheme instead of
 * archived falling back to the deprecated name-derived id.
 *
 * Two-phase, so no archive metadata can be lost if a migrating load fails to save
 * `profile.json`:
 *   • Phase 1 (profile has no `archived_chats`): import the list from the
 *     store-backed `agents/archived_chats.json` or the legacy
 *     `archive/archived_agents.json` into `profile.archived_chats`, KEEPING the
 *     source file as a safety net. The outer load persists the profile.
 *   • Phase 2 (profile already owns `archived_chats` from a prior durable save):
 *     retire the transitional files.
 * Idempotent and best-effort. Returns true when anything changed.
 */
export async function migrateArchivedAgentsToStore(profileDir: string, profile: ProfileV2): Promise<boolean> {
  let changed = false;

  // Phase 2: the profile already owns the archive list (a prior load imported it
  // and the save succeeded), so the source files are now safe to retire.
  if (Array.isArray(profile.archived_chats)) {
    if (retireTransitionalArchiveFiles(profileDir)) {
      changed = true;
    }
    return changed;
  }

  // Phase 1: import the archive list from the transitional file(s).
  const source = resolveArchivedChatsSource(profileDir);
  if (!source) {
    return changed;
  }
  let parsed: { archived_chats?: LegacyArchivedEntry[]; archived_agents?: LegacyArchivedEntry[] };
  try {
    parsed = JSON.parse(fs.readFileSync(source.path, 'utf8'));
  } catch (error) {
    logger.warn('[agentExtraction] Failed to read archived chats (non-fatal)', 'migrateArchivedAgentsToStore', {
      reason: reason(error),
    });
    return changed;
  }
  const entries: LegacyArchivedEntry[] = Array.isArray(parsed?.archived_chats)
    ? parsed.archived_chats
    : Array.isArray(parsed?.archived_agents)
      ? parsed.archived_agents
      : [];

  const syntheticChats: ChatConfig[] = [];
  const rewritten: ArchivedChatEntry[] = [];
  let allPersisted = true;
  for (const entry of entries) {
    // Mint a stable, name-independent UUID on the archived entry's inline agent
    // when it lacks one — mirroring the active-chat path (profileMigration ->
    // ensureInlineAgentIds). Legacy archived agents carry no id, so without this
    // resolveArchivedEntryIds would fall back to the deprecated name-derived id
    // (agent-{name}-{source}) while active agents get a UUID, leaving the profile
    // with two id schemes. Minting first makes both paths share ONE scheme.
    if (entry.agent) {
      ensureInlineAgentIds({ agent: entry.agent });
    }
    const ids = resolveArchivedEntryIds(entry);
    const id = ids[0];
    // An entry is restorable only with both an agent id and a chat_id (the
    // workspace/session key). Anything else cannot be unarchived, so drop it.
    if (!id || !entry.chat_id) {
      continue;
    }
    // Ensure the archived chat's agent exists in the store (single index.json).
    // When the agent.json is absent (legacy inline-only archive), persist it from
    // the inline config so it can be resolved/restored later.
    const stored = readAgent(profileDir, id);
    const config: AgentConfig | null = stored ?? (entry.agent?.name ? { ...entry.agent, id } : null);
    if (config && !stored) {
      try {
        await writeAgent(profileDir, config);
        changed = true;
      } catch (error) {
        allPersisted = false;
        logger.warn('[agentExtraction] Failed to persist archived agent (non-fatal)', 'migrateArchivedAgentsToStore', {
          id, reason: reason(error),
        });
      }
    }
    const workspace = typeof entry.workspace === 'string' && entry.workspace.trim() !== ''
      ? entry.workspace
      : (typeof entry.agent?.workspace === 'string' ? entry.agent.workspace : undefined);
    syntheticChats.push({
      chat_id: entry.chat_id,
      chat_type: entry.chat_type || 'single_agent',
      ...(workspace && { workspace }),
      agent: entry.agent,
      agent_ids: ids,
    });
    const cleaned: ArchivedChatEntry = {
      chat_id: entry.chat_id,
      chat_type: entry.chat_type === 'multi_agent' ? 'multi_agent' : 'single_agent',
      ...(workspace && { workspace }),
      agent_ids: ids,
    };
    if (typeof entry.archived_at === 'string' && entry.archived_at.trim() !== '') {
      cleaned.archived_at = entry.archived_at;
    }
    if (Array.isArray(entry.starred_sessions) && entry.starred_sessions.length > 0) {
      cleaned.starred_sessions = entry.starred_sessions as ArchivedChatEntry['starred_sessions'];
    }
    rewritten.push(cleaned);
  }

  // Reuse the active-chat helpers so archived chats reach the SAME storage form:
  // workspace dirs keyed by chat_id, knowledge under agents/{id}/knowledge.
  const syntheticProfile = { chats: syntheticChats } as unknown as ProfileV2;
  if (await migrateKnowledgeToAgentStore(profileDir, syntheticProfile)) {
    changed = true;
  }
  if (consolidateWorkspaceDirsToChatId(profileDir, syntheticProfile)) {
    changed = true;
  }
  const syntheticWorkspaceByChatId = new Map(syntheticChats.map(chat => [chat.chat_id, chat.workspace]));
  for (const entry of rewritten) {
    const workspace = syntheticWorkspaceByChatId.get(entry.chat_id);
    if (workspace) {
      entry.workspace = workspace;
    }
  }

  // If any archived agent could not be durably persisted to the store, do NOT
  // hand the list to the profile or retire the transitional source files this
  // load. The transitional file holds the ONLY copy of that agent's inline
  // config, so keeping it lets the failed write be retried on the next load
  // instead of committing to Phase 2 (which retires the source) and leaving an
  // unrestorable archived chat pointing at a missing agents/{id}/agent.json.
  if (!allPersisted) {
    return changed;
  }

  if (rewritten.length === 0) {
    // Nothing restorable in the source — retire the transitional files outright
    // (no archive metadata to preserve), rather than re-reading them every load.
    if (retireTransitionalArchiveFiles(profileDir)) {
      changed = true;
    }
    return changed;
  }

  // Hand the imported list to the profile; the outer load persists it durably.
  // The source file is retired on the NEXT load (Phase 2), once profile.json is
  // confirmed to own the data — so a failed save here loses nothing.
  profile.archived_chats = rewritten;
  return true;
}

function collectAgents(profile: ProfileV2): ChatAgent[] {
  const chats = Array.isArray(profile.chats) ? profile.chats : [];
  const out: ChatAgent[] = [];
  for (const chat of chats) {
    if (Array.isArray(chat.agents) && chat.agents.length > 0) {
      out.push(...chat.agents);
    } else if (chat.agent) {
      out.push(chat.agent);
    }
  }
  return out;
}

/**
 * Mirror every chat agent into the store. Best-effort and idempotent; returns
 * the number of agents newly written. Skips nameless agents and ones already
 * present on disk.
 */
export async function extractAgentsToStore(
  profileDir: string,
  profile: ProfileV2
): Promise<number> {
  let written = 0;
  const seen = new Set<string>();
  for (const agent of collectAgents(profile)) {
    if (!agent?.name) {
      continue;
    }
    const id = agentIdOf(agent);
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    if (readAgent(profileDir, id)) {
      continue;
    }
    const config: AgentConfig = { ...agent, id };
    try {
      await writeAgent(profileDir, config);
      written += 1;
    } catch (error) {
      logger.warn('[agentExtraction] Failed to persist agent (non-fatal)', 'extractAgentsToStore', {
        id,
        error: reason(error),
      });
    }
  }
  return written;
}

/** A chat's inline agents (multi `agents` preferred, else single `agent`). */
function inlineAgentsOf(chat: { agent?: ChatAgent; agents?: ChatAgent[] }): ChatAgent[] {
  return Array.isArray(chat.agents) && chat.agents.length > 0
    ? chat.agents
    : chat.agent
      ? [chat.agent]
      : [];
}

/**
 * Mint a stable, name-independent id ({@link buildAgentUuid}) on each inline
 * agent that lacks one. Called on the create path so a brand-new agent owns a
 * UUID from the start — the id then survives every later rename because it does
 * not encode the name. Idempotent: agents that already carry an id (e.g. an
 * existing agent re-referenced by a new chat) are left untouched.
 */
export function ensureInlineAgentIds(chat: { agent?: ChatAgent; agents?: ChatAgent[] }): void {
  for (const agent of inlineAgentsOf(chat)) {
    if (agent && (!agent.id || agent.id.length === 0)) {
      agent.id = buildAgentUuid();
    }
  }
}

/**
 * Write a chat's inline agents into the standalone store under their stable ids
 * ({@link agentIdOf}: carried `id`, else legacy name-derived) and return those
 * ids (deduped, order-preserving). Nameless agents are skipped. Best-effort: a
 * per-agent write failure is logged and swallowed so a CRUD path never throws.
 * When a `failedSink` is supplied, the id of every agent whose `writeAgent`
 * actually threw is pushed into it — this is the ONLY reliable failure signal for
 * an UPDATE to an existing agent, where the previous `agent.json` survives an
 * atomic-write failure and `readAgent` therefore still returns (stale) content.
 * Pure writer — does NOT prune/delete or mutate the chat; callers decide how to
 * stamp `agent_ids`.
 */
async function writeInlineAgentsToStore(
  profileDir: string,
  inline: ChatAgent[],
  failedSink?: string[]
): Promise<string[]> {
  const ids: string[] = [];
  for (const agent of inline) {
    if (!agent?.name) {
      continue;
    }
    const id = agentIdOf(agent);
    if (ids.includes(id)) {
      continue;
    }
    ids.push(id);
    try {
      await writeAgent(profileDir, { ...agent, id });
    } catch (error) {
      failedSink?.push(id);
      logger.warn('[agentExtraction] Failed to write-through agent (non-fatal)', 'writeInlineAgentsToStore', {
        id,
        error: reason(error),
      });
    }
  }
  return ids;
}

/**
 * Re-persist every chat's inline agent(s) into the standalone store after
 * post-store mutations such as builtin-defaults migration. Same id, no prune, no
 * `agent_ids` re-stamp. Per-agent write failures are logged and optionally
 * surfaced so callers can avoid committing a version bump before the store syncs.
 */
export async function syncInlineChatAgentsToStore(
  profileDir: string,
  profile: ProfileV2,
  writeFailedSink?: string[]
): Promise<void> {
  const chats = Array.isArray(profile.chats) ? profile.chats : [];
  const writeFailed: string[] = [];
  for (const chat of chats) {
    await writeInlineAgentsToStore(profileDir, inlineAgentsOf(chat), writeFailed);
  }
  if (writeFailedSink && writeFailed.length > 0) {
    writeFailedSink.push(...writeFailed);
  }
}

function findLegacyAgentIdForInline(
  profileDir: string,
  agent: ChatAgent,
  existingIds: string[],
  usedIds: ReadonlySet<string>,
  index: number,
): string | undefined {
  if (!agent?.name) return undefined;
  const legacyDerivedId = buildAgentId(agent.name, agent.source);
  if (existingIds.includes(legacyDerivedId) && !usedIds.has(legacyDerivedId)) return legacyDerivedId;
  return existingIds.find((id) => {
    if (usedIds.has(id)) return false;
    const stored = readAgent(profileDir, id);
    return stored?.name === agent.name && stored?.source === agent.source;
  }) ?? (existingIds[index] && !usedIds.has(existingIds[index]) ? existingIds[index] : undefined);
}

export async function syncChatAgentsToStore(
  profileDir: string,
  chat: { agent?: ChatAgent; agents?: ChatAgent[]; agent_ids?: string[] },
  referencedByOtherChats?: ReadonlySet<string>,
  staleSink?: string[],
  writeFailedSink?: string[],
  prepareInlineAgentsForStore?: (inline: ChatAgent[]) => void,
): Promise<string[]> {
  const inline = inlineAgentsOf(chat);
  const existingIds = Array.isArray(chat.agent_ids) ? chat.agent_ids : [];
  // Preserve stable ids for legacy inline agents during edits/renames.
  const assignedLegacyIds = new Set<string>();
  inline.forEach((agent, index) => {
    if (agent && (!agent.id || agent.id.length === 0)) {
      const legacyId = findLegacyAgentIdForInline(profileDir, agent, existingIds, assignedLegacyIds, index);
      if (legacyId) {
        agent.id = legacyId;
        assignedLegacyIds.add(legacyId);
      }
    }
  });
  prepareInlineAgentsForStore?.(inline);
  const writeFailed: string[] = [];
  const nextIds = await writeInlineAgentsToStore(profileDir, inline, writeFailed);
  // Same-id update failures are visible only from the thrown writeAgent call.
  if (writeFailedSink && writeFailed.length > 0) {
    writeFailedSink.push(...writeFailed);
  }
  // Rebind only after all writes reached the store; writeFailed catches same-id failures.
  const allPersisted = writeFailed.length === 0 && nextIds.every((id) => readAgent(profileDir, id) !== null);
  if (!allPersisted) {
    logger.warn(
      '[agentExtraction] Agent store write incomplete; preserving existing binding (no prune, no re-stamp)',
      'syncChatAgentsToStore',
      { nextIds, existingIds },
    );
    return existingIds;
  }
  // Prune only agents removed from this chat and not referenced elsewhere.
  const stale = existingIds.filter(
    (id) => !nextIds.includes(id) && !(referencedByOtherChats?.has(id) ?? false)
  );
  // Defer destructive prune until the caller's profile.json write is durable.
  if (staleSink) {
    staleSink.push(...stale);
  } else {
    await pruneStaleStoreAgents(profileDir, stale);
  }
  chat.agent_ids = nextIds;
  return nextIds;
}

/**
 * Best-effort delete of store entries that fell out of a chat's binding. Split out
 * of {@link syncChatAgentsToStore} so CRUD callers can run it AFTER their profile
 * write is durable: pruning before the write commits risks deleting an agent the
 * persisted profile still references if that write then fails. Per-id failures are
 * logged and swallowed so a cleanup pass never throws.
 */
export async function pruneStaleStoreAgents(profileDir: string, ids: readonly string[]): Promise<void> {
  for (const id of ids) {
    try {
      await deleteAgent(profileDir, id);
    } catch (error) {
      logger.warn('[agentExtraction] Failed to delete stale agent (non-fatal)', 'pruneStaleStoreAgents', {
        id,
        error: reason(error),
      });
    }
  }
}

/**
 * Persist a NEW chat's agent(s) into the standalone store (`agents/{id}/`) and
 * register the chat→agent mapping (`agent_ids`). Create-safe counterpart to
 * {@link syncChatAgentsToStore}: it mints a stable id for each inline agent that
 * lacks one, writes the inline agents, and stamps `agent_ids` from them, but
 * NEVER prunes or deletes. A brand-new chat has nothing to prune, and a chat that
 * references existing agents by id only (no inline) must keep those ids without
 * deleting the shared store entries. When inline agents are present their ids win
 * (a stale caller-supplied `agent_ids` is corrected); when there are none, any
 * caller-provided `agent_ids` are preserved untouched. Returns the chat's ids.
 *
 * When a `writeFailedSink` is supplied, the id of every inline agent whose
 * `writeAgent` actually threw is pushed into it (surfaced from
 * {@link writeInlineAgentsToStore}). `agent_ids` are still stamped from the
 * attempted ids so the in-memory chat stays consistent, but a non-empty sink lets
 * the CRUD caller ABORT before {@link buildRendererProfilePayload} strips the inline
 * agent — otherwise a new chat whose store write failed would persist an `agent_ids`
 * pointer to a missing `agent.json` and render agent-less (no model/tools) until a
 * manual retry, since the store (not profile.json) is the SSOT after the strip.
 */
export async function persistNewChatAgents(
  profileDir: string,
  chat: { agent?: ChatAgent; agents?: ChatAgent[]; agent_ids?: string[] },
  writeFailedSink?: string[]
): Promise<string[]> {
  ensureInlineAgentIds(chat);
  const writtenIds = await writeInlineAgentsToStore(profileDir, inlineAgentsOf(chat), writeFailedSink);
  if (writtenIds.length > 0) {
    chat.agent_ids = writtenIds;
  }
  return Array.isArray(chat.agent_ids) ? chat.agent_ids : [];
}

/**
 * Persist a brand-new profile's default chat agent(s) into the standalone store
 * and stamp each chat's `agent_ids`, so a first-run profile ends up in the same
 * shape a MIGRATED profile has after load (store is SSOT, chats carry ids). This
 * is the create path's counterpart to the load path's integrity extraction.
 * Without it the default chat carries only an inline `agent`: `writeProfileToFile`
 * strips inline agents once ids resolve (nothing is in the store yet, so it keeps
 * them un-stamped), and `performNotification` pushes an agent_ids-less chat, so
 * the renderer's `resolveChatAgent` returns null and a first-run user sees no
 * default agent/model/tools. Create-safe: delegates to {@link persistNewChatAgents}
 * per chat, which mints ids and never prunes. When a `writeFailedSink` is supplied,
 * ids whose `writeAgent` threw are surfaced into it so the caller can treat a failed
 * seed as a failed profile creation instead of persisting an agent-less default chat.
 */
export async function seedNewProfileAgents(
  profileDir: string,
  profile: ProfileV2,
  writeFailedSink?: string[]
): Promise<void> {
  const chats = Array.isArray(profile.chats) ? profile.chats : [];
  for (const chat of chats) {
    await persistNewChatAgents(profileDir, chat, writeFailedSink);
  }
}

/**
 * Produce a disk-write copy of `profile` with each chat's inline `agent`/`agents`
 * removed, keeping only `chat_id` + `agent_ids`. A chat is stripped only when it
 * carries `agent_ids` AND every id resolves in the store (durability gate),
 * mirroring how mcp/skills/hooks are stripped from profile.json once their
 * sidecar holds the data. Chats whose agents are not yet persisted keep their
 * inline fields so nothing is lost. Does not mutate the input.
 */
export function stripInlineChatAgentsForDisk(profileDir: string, profile: ProfileV2): ProfileV2 {
  const chats = Array.isArray(profile.chats) ? profile.chats : [];
  return {
    ...profile,
    chats: chats.map((chat) => {
      const ids = Array.isArray(chat.agent_ids) ? chat.agent_ids : [];
      const persisted = ids.length > 0 && ids.every((id) => readAgent(profileDir, id) !== null);
      if (!persisted) {
        return chat;
      }
      const next = { ...chat };
      delete next.agent;
      delete next.agents;
      return next;
    }),
  };
}
