/** Load-time migration of legacy chat-scoped Memex Memory into agent stores. */

import * as fs from 'fs';
import * as path from 'path';
import { ProfileV2 } from './types/profile';
import { getAgentMemoryDir, isSafeAgentId } from './agentStoreManager';
import { getChatAgentIds } from './agentAccessor';
import { moveContentsToDirectory } from './pathUtils';
import { createConsoleLogger } from '../unifiedLogger';

const logger = createConsoleLogger();

/** Normalize a thrown value to a log-friendly string. */
function reason(error: unknown): string {
  /* v8 ignore next -- fs/Node reject with Error instances; the non-Error
     fallback is a defensive guard that tests cannot reach. */
  return error instanceof Error ? error.message : String(error);
}

/**
 * Delete Finder metadata (`.DS_Store`) and any now-empty directories under the
 * legacy `memex_memory` root, removing the root itself when nothing real
 * remains. This keeps orphan/unreferenced legacy dirs (that only ever held
 * metadata) from lingering after a successful card migration, WITHOUT touching
 * real card data. Returns true when anything was pruned.
 */
function pruneLegacyMemexMetadata(profileDir: string): boolean {
  const legacyRoot = path.join(profileDir, 'memex_memory');
  const prune = (dir: string): boolean => {
    let changed = false;
    for (const entry of fs.readdirSync(dir)) {
      const fullPath = path.join(dir, entry);
      const stat = fs.lstatSync(fullPath);
      // Never follow or delete a symlink: following it could reach outside the
      // profile and destroy an external target's files (confinement escape).
      if (stat.isSymbolicLink()) {
        continue;
      }
      if (stat.isDirectory()) {
        changed = prune(fullPath) || changed;
        if (fs.readdirSync(fullPath).length === 0) {
          fs.rmdirSync(fullPath);
          changed = true;
        }
        continue;
      }
      if (entry === '.DS_Store') {
        fs.rmSync(fullPath, { force: true });
        changed = true;
      }
    }
    return changed;
  };

  try {
    if (!fs.existsSync(legacyRoot)) {
      return false;
    }
    const rootStat = fs.lstatSync(legacyRoot);
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
      return false;
    }
    const changed = prune(legacyRoot);
    if (fs.readdirSync(legacyRoot).length === 0) {
      fs.rmdirSync(legacyRoot);
      return true;
    }
    return changed;
  } catch (error) {
    logger.warn('[memexMemoryMigration] Failed to prune legacy memex metadata (non-fatal)', 'pruneLegacyMemexMetadata', {
      reason: reason(error),
    });
  }
  return false;
}

/** Derive a non-colliding destination path by suffixing the source chat id. */
function uniqueConflictPath(targetPath: string, chatId: string): string {
  const parsed = path.parse(targetPath);
  const base = `${parsed.name}-${chatId}`;
  let candidate = path.join(parsed.dir, `${base}${parsed.ext}`);
  let index = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(parsed.dir, `${base}-${index}${parsed.ext}`);
    index += 1;
  }
  return candidate;
}

/**
 * Resolve the entries that {@link moveContentsToDirectory} deliberately left in
 * place. That helper moves every non-conflicting entry out first and merges
 * same-named directory subtrees recursively, so by construction EVERY entry
 * still present in `srcDir` collides with an existing `destDir` entry (dest is
 * always present here). Same-named directories keep merging; any other collision
 * (file-vs-file, dir-vs-file) moves under a `-{chatId}` suffix so the older
 * legacy copy stays reachable instead of stranded. The precondition is
 * guaranteed by the sole caller, whose non-fatal try/catch absorbs any violation.
 */
function moveRemainingMemexConflicts(srcDir: string, destDir: string, chatId: string): number {
  let moved = 0;
  for (const entry of fs.readdirSync(srcDir)) {
    const src = path.join(srcDir, entry);
    const dest = path.join(destDir, entry);
    if (fs.statSync(src).isDirectory() && fs.statSync(dest).isDirectory()) {
      moved += moveRemainingMemexConflicts(src, dest, chatId);
      fs.rmdirSync(src);
      continue;
    }
    fs.renameSync(src, uniqueConflictPath(dest, chatId));
    moved += 1;
  }
  return moved;
}

/**
 * True when `dir` or any nested entry is a symbolic link. Uses `lstat` and never
 * follows a link, so the walk stays confined to the profile. Legacy Memex memory
 * is plain card/metadata files; a symlink is anomalous and, if relocated into the
 * agent store, would let Memex read/write outside the profile — so such a tree is
 * refused rather than migrated.
 */
function containsSymlink(dir: string): boolean {
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = fs.lstatSync(full);
    if (stat.isSymbolicLink()) {
      return true;
    }
    if (stat.isDirectory() && containsSymlink(full)) {
      return true;
    }
  }
  return false;
}

/** Current chats whose primary agent id is already durable in profile.json. */
function durablyBoundMemexChats(profile: ProfileV2, durableProfile: ProfileV2 | undefined): ProfileV2 {
  if (!durableProfile) {
    return profile;
  }
  const durablePrimaryByChatId = new Map<string, string>();
  for (const chat of Array.isArray(durableProfile.chats) ? durableProfile.chats : []) {
    if (typeof chat.chat_id !== 'string' || !Array.isArray(chat.agent_ids) || typeof chat.agent_ids[0] !== 'string') {
      continue;
    }
    durablePrimaryByChatId.set(chat.chat_id, chat.agent_ids[0]);
  }
  const chats = (Array.isArray(profile.chats) ? profile.chats : []).filter((chat) => {
    const chatId = chat.chat_id;
    const agentId = getChatAgentIds(chat)[0];
    return typeof chatId === 'string' && typeof agentId === 'string' && durablePrimaryByChatId.get(chatId) === agentId;
  });
  return { chats } as ProfileV2;
}

/** Migrate one legacy `memex_memory/{chatId}` dir into `agents/{agentId}/memory`. */
function migrateOneLegacyMemexDir(profileDir: string, chatId: string, agentId: string): boolean {
  if (!isSafeAgentId(chatId) || !isSafeAgentId(agentId)) {
    return false;
  }

  const legacy = path.join(profileDir, 'memex_memory', chatId);
  const target = getAgentMemoryDir(profileDir, agentId);
  try {
    if (!fs.existsSync(legacy)) {
      return false;
    }
    // lstat (not stat): a symlinked legacy dir must be refused, not followed —
    // relocating it into the agent store would let Memex operate outside the
    // profile. Non-directories are likewise skipped.
    const legacyStat = fs.lstatSync(legacy);
    if (legacyStat.isSymbolicLink() || !legacyStat.isDirectory()) {
      return false;
    }
    // Refuse any tree with a symlink at any depth: moveContentsToDirectory /
    // renameSync would relocate the link into agents/{agentId}/memory, so a later
    // Memex read/write would escape the profile. Leave it in place (not deleted).
    if (containsSymlink(legacy)) {
      logger.warn('[memexMemoryMigration] Skipped legacy memex dir with symlink(s) to preserve profile confinement', 'migrateMemexMemoryToAgentStore', {
        chatId, agentId,
      });
      return false;
    }
    let moved = pruneLegacyMemexMetadata(profileDir);
    if (!fs.existsSync(legacy)) {
      return moved;
    }

    fs.mkdirSync(target, { recursive: true });
    const directMoves = moveContentsToDirectory(legacy, target);
    if (fs.readdirSync(legacy).length > 0) {
      const conflictMoves = moveRemainingMemexConflicts(legacy, target, chatId);
      logger.warn('[memexMemoryMigration] Moved conflicting memex memory with chat-id suffixes', 'migrateMemexMemoryToAgentStore', {
        chatId, agentId, directMoves, conflictMoves,
      });
    }
    // Prune leaves only real card data behind (see line above), and both movers
    // relocate every entry into the agent store, so the legacy dir is always
    // empty here; drop it and report the migration as applied.
    fs.rmdirSync(legacy);
    return true;
  } catch (error) {
    logger.warn('[memexMemoryMigration] Failed to move memex memory (non-fatal)', 'migrateMemexMemoryToAgentStore', {
      chatId, agentId, reason: reason(error),
    });
    return false;
  } finally {
    pruneLegacyMemexMetadata(profileDir);
  }
}

/**
 * Move legacy chat-scoped Memex Memory into `agents/{primaryAgentId}/memory`.
 *
 * Legacy Memex storage was keyed by chat_id, so multi-agent chats cannot be
 * split safely. To preserve old UI/tool semantics without duplicating private
 * memories across agents, the legacy directory migrates to the primary agent
 * (`agent_ids[0]`) only. If two chats that share one agent contain the same card
 * slug, the existing target card wins and the later legacy file is moved with a
 * `-{chatId}` suffix so it remains visible to Memex instead of staying stranded
 * in the legacy directory.
 *
 * Confinement: a legacy directory that IS a symlink, or that contains a symlink
 * at any depth, is refused (left in place, never followed) so migration cannot
 * relocate a link into `agents/{agentId}/memory` and let Memex read/write outside
 * the profile.
 *
 * Durability: when `durableProfile` is supplied, a chat migrates only if its
 * current primary `agent_id` already exists in that durable profile snapshot.
 * This keeps a failed first V6 profile write from stranding memory under a
 * freshly minted transient agent id.
 */
export function migrateMemexMemoryToAgentStore(profileDir: string, profile: ProfileV2, durableProfile?: ProfileV2): boolean {
  const migrationProfile = durablyBoundMemexChats(profile, durableProfile);
  const chats = Array.isArray(migrationProfile.chats) ? migrationProfile.chats : [];
  let moved = false;
  for (const chat of chats) {
    const chatId = chat.chat_id;
    const agentId = getChatAgentIds(chat)[0];
    if (!chatId || !agentId) {
      continue;
    }
    moved = migrateOneLegacyMemexDir(profileDir, chatId, agentId) || moved;
  }
  moved = pruneLegacyMemexMetadata(profileDir) || moved;
  return moved;
}
