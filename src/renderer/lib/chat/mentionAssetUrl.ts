/**
 * Mention-scheme asset URL resolution for rendering.
 *
 * Assistant messages register local deliverables (e.g. screenshots) inside
 * `<IMAGE_REGISTRY>` blocks using the same path schemas the agent system prompt
 * advertises: `@chat-session:{path}`, `@knowledge-base:{path}`, `@workspace:{path}`.
 * The image-rendering pipeline only understands `http(s)://`, `file://` and absolute
 * paths, so these mention URLs must be resolved to real local files before display.
 *
 * This module turns a mention-scheme URL into an encoded `file://` URL pointing at the
 * actual file on disk. Non-mention URLs are returned unchanged, and when the relevant
 * base directory cannot be determined the original URL is returned so existing error
 * handling still applies (no regression).
 */
import { profileDataManager } from '@/lib/userData';
import { agentChatSessionCacheManager } from '@/lib/chat/agentChatSessionCacheManager';
import { resolveChatAgent } from '../agent/resolveChatAgent';

const CHAT_SESSION_PREFIX = '@chat-session:';
const KNOWLEDGE_BASE_PREFIX = '@knowledge-base:';
const WORKSPACE_PREFIX = '@workspace:';

const MENTION_PREFIXES = [CHAT_SESSION_PREFIX, KNOWLEDGE_BASE_PREFIX, WORKSPACE_PREFIX] as const;

/**
 * Resolve the chat session deliverables folder from the chat workspace path and a
 * chat session id. Returns null when inputs are missing or the session id format is
 * unrecognized. Uses forward slashes unconditionally; the OS/Chromium normalizes them.
 *
 * Mirrors the deliverables path schema built in the main process
 * (`agentChatPromptService`): `{workspace}/{YYYYMM}/{chatSessionId}`.
 */
export function resolveChatSessionFolder(
  workspacePath: string | undefined | null,
  chatSessionId: string | undefined | null,
): string | null {
  if (!workspacePath || typeof workspacePath !== 'string' || workspacePath.trim().length === 0) {
    return null;
  }
  if (!chatSessionId) {
    return null;
  }
  const match = chatSessionId.match(/^chatSession_(\d{4})(\d{2})/);
  if (!match) {
    return null;
  }
  const yearMonth = `${match[1]}${match[2]}`;
  return `${workspacePath}/${yearMonth}/${chatSessionId}`;
}

/**
 * Convert an absolute local filesystem path to an encoded `file://` URL.
 * Handles Windows backslashes and drive letters, and percent-encodes path
 * segments (spaces, etc.) so the URL is safe to use as an `<img>` source.
 */
export function localPathToFileUrl(absPath: string): string {
  let normalized = absPath.replace(/\\/g, '/');
  // Ensure a leading slash so Windows paths like "C:/..." become "/C:/...".
  if (!normalized.startsWith('/')) {
    normalized = `/${normalized}`;
  }
  const encoded = normalized
    .split('/')
    .map((segment) => (/^[A-Za-z]:$/.test(segment) ? segment : encodeURIComponent(segment)))
    .join('/');
  return `file://${encoded}`;
}

export interface MentionAssetBases {
  chatSessionFolder?: string | null;
  knowledgeBasePath?: string | null;
  workspacePath?: string | null;
}

/**
 * Read the current chat/session context to compute the base directories used to
 * resolve mention-scheme asset URLs.
 */
export function getCurrentMentionAssetBases(): MentionAssetBases {
  const currentChat = profileDataManager.getCurrentChat?.() as
    | { workspace?: string; agent?: { knowledgeBase?: string; knowledge?: { knowledgeBase?: string } } }
    | null
    | undefined;
  const primaryAgent = resolveChatAgent(currentChat as never);
  const workspacePath = currentChat?.workspace;
  const knowledgeBasePath =
    primaryAgent?.knowledge?.knowledgeBase ?? (primaryAgent as { knowledgeBase?: string })?.knowledgeBase;
  const chatSessionId = agentChatSessionCacheManager.getCurrentChatSessionId?.();

  return {
    chatSessionFolder: resolveChatSessionFolder(workspacePath, chatSessionId),
    knowledgeBasePath: knowledgeBasePath ?? null,
    workspacePath: workspacePath ?? null,
  };
}

/**
 * Resolve a mention-scheme image URL (`@chat-session:`, `@knowledge-base:`,
 * `@workspace:`) to an encoded `file://` URL pointing at the real local file.
 *
 * - Non-mention URLs (http(s), data, file, absolute paths) are returned unchanged.
 * - When the relevant base directory cannot be determined, the original URL is
 *   returned so the caller's existing error handling applies.
 *
 * @param url   The raw URL declared in the image registry.
 * @param bases Optional pre-computed base directories; defaults to the current
 *              chat/session context. Passing explicit bases keeps the core logic pure.
 */
export function resolveMentionAssetUrl(url: string, bases?: MentionAssetBases): string {
  if (!url || typeof url !== 'string' || !url.startsWith('@')) {
    return url;
  }

  const prefix = MENTION_PREFIXES.find((candidate) => url.startsWith(candidate));
  if (!prefix) {
    return url;
  }

  const relativePath = url.slice(prefix.length).replace(/^[\\/]+/, '').trim();
  if (!relativePath) {
    return url;
  }

  const resolvedBases = bases ?? getCurrentMentionAssetBases();
  let base: string | null | undefined;
  if (prefix === CHAT_SESSION_PREFIX) {
    base = resolvedBases.chatSessionFolder;
  } else if (prefix === KNOWLEDGE_BASE_PREFIX) {
    base = resolvedBases.knowledgeBasePath;
  } else {
    base = resolvedBases.workspacePath;
  }

  if (!base || typeof base !== 'string' || base.trim().length === 0) {
    return url;
  }

  const normalizedBase = base.replace(/[\\/]+$/, '');
  return localPathToFileUrl(`${normalizedBase}/${relativePath}`);
}
