import { createConsoleLogger } from '../unifiedLogger';
import { getDefaultWorkspacePath } from './pathUtils';
import type { ArchivedChatEntry, ChatConfig, ChatConfigRuntime, ProfileV2 } from './types/profile';

const logger = createConsoleLogger();

type WorkspaceChat = Pick<ChatConfig, 'chat_id'> & {
  workspace?: string;
  chatSessions?: ChatConfigRuntime['chatSessions'];
};

function deriveWorkspace(alias: string, chatId: string): string | undefined {
  try {
    return getDefaultWorkspacePath(alias, chatId);
  } catch (error) {
    logger.warn('[ProfileWorkspace] Failed to derive chat workspace path', 'deriveWorkspace', {
      alias,
      chatId,
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}

function attachWorkspace<T extends WorkspaceChat>(alias: string, chat: T): T {
  const workspace = typeof chat.chat_id === 'string' && chat.chat_id.trim() !== ''
    ? deriveWorkspace(alias, chat.chat_id)
    : undefined;
  const next = { ...chat };
  if (workspace) {
    next.workspace = workspace;
  } else {
    delete next.workspace;
  }
  return next;
}

function stripWorkspace<T extends WorkspaceChat>(chat: T): Omit<T, 'workspace'> {
  const next = { ...chat };
  delete next.workspace;
  return next;
}

/**
 * Runtime chats always resolve their workspace from `{userData}/profiles/{alias}/chat_workspaces/{chat_id}`.
 * The derived value is attached in memory / IPC payloads and never stored in profile.json.
 */
export function attachDerivedChatWorkspaces<T extends Omit<ProfileV2, 'chats'> & { chats?: WorkspaceChat[] }>(
  alias: string,
  profile: T,
): T {
  const next = profile;
  if (Array.isArray(next.chats)) {
    next.chats = next.chats.map(chat => attachWorkspace(alias, chat));
  }
  if (Array.isArray(next.archived_chats)) {
    next.archived_chats = next.archived_chats.map(entry => attachWorkspace(alias, entry as ArchivedChatEntry)) as T['archived_chats'];
  }
  return next;
}

/** Return the profile.json shape: chat workspace fields are derived, so they are omitted on disk. */
export function stripDerivedChatWorkspacesForDisk<T extends Omit<ProfileV2, 'chats'> & { chats?: WorkspaceChat[] }>(
  profile: T,
): T {
  return {
    ...profile,
    ...(Array.isArray(profile.chats) ? { chats: profile.chats.map(stripWorkspace) } : {}),
    ...(Array.isArray(profile.archived_chats)
      ? { archived_chats: profile.archived_chats.map(entry => stripWorkspace(entry as ArchivedChatEntry)) }
      : {}),
  } as T;
}
