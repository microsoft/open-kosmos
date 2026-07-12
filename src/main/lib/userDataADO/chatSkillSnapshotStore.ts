/**
 * ChatSkillSnapshotStore — the in-memory owner of per-chat resolved skill
 * snapshots ({@link ChatSkillSnapshot}).
 *
 * A skill snapshot is a rebuildable cache, not user content: it is the resolved
 * skill metadata + prebuilt prompt that AgentChat injects at a turn boundary. It
 * used to be persisted inside each `profile.json` chat (`chat.skill_snapshot`),
 * which coupled the skill registry to `profile.json` (a skill registry change had
 * to rewrite `profile.json` just to drop stale snapshots). The next-turn refresh
 * tech-doc (§11) confirms persistence is NOT required for correctness — the
 * snapshot can always be rebuilt in memory from the live binding + registry — so
 * it now lives here, keyed by `alias -> chatId`, and `profile.json` no longer
 * carries it.
 *
 * Correctness is preserved by {@link AgentChatPromptService.refreshSkillSnapshotIfNeeded}:
 * every turn it rebuilds a candidate snapshot and compares `binding_signature` +
 * `registry_signature` against the cached entry, so a cold cache (process restart,
 * eviction) simply rebuilds on the next turn. The proactive invalidation hooks
 * below are an eagerness optimization layered on top of that signature check.
 */

import { ChatConfig, ChatSkillSnapshot } from './types/profile';
import { getChatPrimaryAgent } from './agentAccessor';
import { createConsoleLogger } from '../unifiedLogger';

const logger = createConsoleLogger();

class ChatSkillSnapshotStore {
  private static instance: ChatSkillSnapshotStore | null = null;

  /** alias -> (chatId -> snapshot). The runtime source of truth for snapshots. */
  private store: Map<string, Map<string, ChatSkillSnapshot>> = new Map();

  static getInstance(): ChatSkillSnapshotStore {
    if (!ChatSkillSnapshotStore.instance) {
      ChatSkillSnapshotStore.instance = new ChatSkillSnapshotStore();
    }
    return ChatSkillSnapshotStore.instance;
  }

  /** The cached snapshot for a chat, or `undefined` when absent. */
  get(alias: string, chatId: string): ChatSkillSnapshot | undefined {
    return this.store.get(alias)?.get(chatId);
  }

  /** Cache (or replace) the snapshot for a chat. */
  set(alias: string, chatId: string, snapshot: ChatSkillSnapshot): void {
    let byChat = this.store.get(alias);
    if (!byChat) {
      byChat = new Map();
      this.store.set(alias, byChat);
    }
    byChat.set(chatId, snapshot);
  }

  /** Drop the snapshot for a single chat (no-op when absent). */
  clear(alias: string, chatId: string): void {
    const byChat = this.store.get(alias);
    if (!byChat) {
      return;
    }
    byChat.delete(chatId);
    if (byChat.size === 0) {
      this.store.delete(alias);
    }
  }

  /** Drop all snapshots for an alias (sign-out / cache clear). */
  clearForAlias(alias: string): void {
    this.store.delete(alias);
  }

  /** Drop all snapshots for every alias (full cache clear). */
  clearAll(): void {
    this.store.clear();
  }

  /**
   * Invalidate the snapshots of chats whose single-agent skill binding overlaps
   * the given skill names — used after a skill registry change so an affected
   * chat rebuilds its snapshot on the next turn. Returns the number cleared.
   *
   * Mirrors the old `clearSkillSnapshotsForAffectedChats` selection logic, but
   * reads the (read-only) chat list to decide which in-memory entries to drop
   * instead of mutating `profile.json`.
   */
  invalidateAffectedChats(
    alias: string,
    chats: ReadonlyArray<ChatConfig> | undefined,
    skillNames: string[],
  ): number {
    if (!Array.isArray(skillNames) || skillNames.length === 0) {
      return 0;
    }
    const byChat = this.store.get(alias);
    if (!byChat || byChat.size === 0) {
      return 0;
    }

    const affectedSkillNames = new Set(skillNames);
    let clearedCount = 0;

    for (const chat of chats || []) {
      const skills = getChatPrimaryAgent(chat)?.skills;
      if (!Array.isArray(skills) || !byChat.has(chat.chat_id)) {
        continue;
      }
      if (!skills.some(skillName => affectedSkillNames.has(skillName))) {
        continue;
      }

      byChat.delete(chat.chat_id);
      clearedCount++;

      logger.info('[ChatSkillSnapshotStore] Invalidated chat skill snapshot due to skill registry change', 'invalidateAffectedChats', {
        alias,
        chatId: chat.chat_id,
        affectedSkillNames: Array.from(affectedSkillNames),
      });
    }

    if (byChat.size === 0) {
      this.store.delete(alias);
    }

    return clearedCount;
  }
}

export const chatSkillSnapshotStore = ChatSkillSnapshotStore.getInstance();
export { ChatSkillSnapshotStore };
