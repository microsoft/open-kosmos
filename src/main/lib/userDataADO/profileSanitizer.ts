/**
 * Profile sanitization functions — pure functions for schema normalization and default-filling.
 * Extracted from ProfileCacheManager for modularity.
 *
 * sanitizeProfileV2() is the single source of truth for profile structure.
 * It is called in two places:
 *   1. ensureV2ProfileIntegrity (read-time normalization)
 *   2. writeProfileToFile (write-time normalization)
 */

import { randomUUID } from 'crypto';
import { createConsoleLogger } from '../unifiedLogger';
import { generateChatId as generateRuntimeChatId } from '../utilities/idFactory';
import {
  ProfileV2,
  McpServerConfig,
  ChatConfig,
  ChatAgent,
  ArchivedChatEntry,
  AgentMcpServer,
  ChatSession,
  StarredChatSessionIndexItem,
  HookDefinition,
  HookAction,
  CommandHookAction,
  HttpHookAction,
  HttpHookMethod,
  AgentHookEvent,
  ZeroStates,
  DEFAULT_CHAT_AGENT,
  DEFAULT_CONFIRMATION_SETTINGS,
  DEFAULT_BROWSER_SETTINGS,
  DEFAULT_MEMEX_SETTINGS,
  DEFAULT_CODING_AGENT_SETTINGS,
  DEFAULT_COMPUTER_USE_SETTINGS,
  DEFAULT_ZERO_STATES,
  type CodingCliId,
  getAgentKnowledge,
  isBuiltinAgent,
  withNormalizedAgentKnowledge,
} from './types/profile';
import { normalizeAgentSystemPrompt } from '@shared/types/agentSystemPrompt';
import { CODING_CLI_IDS } from '@shared/types/codingCli';
import { BRAND_NAME } from '@shared/constants/branding';
import { agentIdOf, getChatPrimaryAgent } from './agentAccessor';
import { BUILTIN_SKILL_NAMES } from '../../../shared/constants/builtinSkills';
import {
  MAX_HOOK_HTTP_BODY_LENGTH,
  MAX_HOOK_HTTP_HEADER_CHARS,
  MAX_HOOK_HTTP_HEADERS,
  MAX_HOOK_IF_LENGTH,
  MAX_HOOK_TIMEOUT_MS,
} from '../agentHooks/types';

const logger = createConsoleLogger();

/**
 * Generate a random Chat ID (wrapper around idFactory).
 */
export function generateChatId(): string {
  return generateRuntimeChatId();
}

/** Lifecycle events a Hook may declare. Entries with other event names are dropped. */
const VALID_HOOK_EVENTS: ReadonlySet<AgentHookEvent> = new Set<AgentHookEvent>([
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'Stop',
  'PreCompact',
  'PostCompact',
]);

const VALID_HOOK_HTTP_METHODS: ReadonlySet<HttpHookMethod> = new Set<HttpHookMethod>([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
]);

function isCodingCliId(value: unknown): value is CodingCliId {
  return typeof value === 'string' && (CODING_CLI_IDS as readonly string[]).includes(value);
}

function sanitizeHookTimeout(
  source: Record<string, unknown>,
  target: CommandHookAction | HttpHookAction,
): void {
  if (typeof source.timeout === 'number' && source.timeout > 0) {
    target.timeout = Math.min(source.timeout, MAX_HOOK_TIMEOUT_MS / 1000);
    return;
  }
  if (typeof source.timeoutMs === 'number' && source.timeoutMs > 0) {
    target.timeoutMs = Math.min(source.timeoutMs, MAX_HOOK_TIMEOUT_MS);
  }
}

/** Copy an optional `if` permission-rule condition onto a sanitized action. */
function applyHookIf(source: Record<string, unknown>, target: CommandHookAction | HttpHookAction): void {
  if (typeof source.if === 'string' && source.if.trim() !== '') {
    target.if = source.if.slice(0, MAX_HOOK_IF_LENGTH);
  }
}

/** Normalize a single HTTP Hook action, or return null when malformed. */
function sanitizeHttpHookAction(action: Record<string, unknown>): HttpHookAction | null {
  if (typeof action.url !== 'string' || action.url.trim() === '') return null;
  const clean: HttpHookAction = { type: 'http', url: action.url };
  applyHookIf(action, clean);
  if (typeof action.method === 'string' && VALID_HOOK_HTTP_METHODS.has(action.method as HttpHookMethod)) {
    clean.method = action.method as HttpHookMethod;
  }
  if (action.headers && typeof action.headers === 'object' && !Array.isArray(action.headers)) {
    const headers: Record<string, string> = {};
    let headerChars = 0;
    for (const [key, value] of Object.entries(action.headers as Record<string, unknown>)) {
      if (Object.keys(headers).length >= MAX_HOOK_HTTP_HEADERS) break;
      if (typeof value !== 'string') continue;
      const nextChars = headerChars + key.length + value.length;
      if (nextChars > MAX_HOOK_HTTP_HEADER_CHARS) break;
      headers[key] = value;
      headerChars = nextChars;
    }
    if (Object.keys(headers).length > 0) clean.headers = headers;
  }
  if (typeof action.body === 'string') clean.body = action.body.slice(0, MAX_HOOK_HTTP_BODY_LENGTH);
  sanitizeHookTimeout(action, clean);
  if (typeof action.async === 'boolean') clean.async = action.async;
  return clean;
}

/** Normalize a single Hook action, keeping only well-formed command and HTTP actions. */
function sanitizeHookAction(action: unknown): HookAction | null {
  if (!action || typeof action !== 'object') return null;
  const raw = action as Record<string, unknown>;
  if (raw.type === 'command') {
    if (typeof raw.command !== 'string' || raw.command.trim() === '') return null;
    const clean: CommandHookAction = { type: 'command', command: raw.command };
    applyHookIf(raw, clean);
    if (Array.isArray(raw.args)) {
      clean.args = raw.args.filter((entry): entry is string => typeof entry === 'string');
    }
    sanitizeHookTimeout(raw, clean);
    if (typeof raw.async === 'boolean') clean.async = raw.async;
    return clean;
  }
  if (raw.type === 'http') {
    return sanitizeHttpHookAction(raw);
  }
  return null;
}

/**
 * Sanitize the profile-level Hook library. Drops entries without a stable id,
 * deduplicates by id (first occurrence wins), and normalizes the flat
 * event/matcher/action shape. Hooks with an unknown event or malformed action
 * are dropped. Provenance fields are defaulted to match Skill/MCP normalization:
 * `version` to `1.0.0`, `remoteVersion` to an empty string, and `source` to
 * `ON-DEVICE` unless explicitly `IN-LIBRARY`.
 */
export function sanitizeHooks(hooks: unknown): HookDefinition[] {
  if (!Array.isArray(hooks)) return [];
  const seen = new Set<string>();
  const result: HookDefinition[] = [];
  for (const raw of hooks) {
    if (!raw || typeof raw !== 'object') continue;
    const hook = raw as Record<string, unknown>;
    if (typeof hook.id !== 'string' || hook.id.trim() === '') continue;
    if (seen.has(hook.id)) continue;
    if (typeof hook.event !== 'string' || !VALID_HOOK_EVENTS.has(hook.event as AgentHookEvent)) continue;
    const action = sanitizeHookAction(hook.action);
    if (!action) continue;
    seen.add(hook.id);
    const now = new Date().toISOString();
    const clean: HookDefinition = {
      id: hook.id,
      name: typeof hook.name === 'string' && hook.name.trim() !== '' ? hook.name : hook.id,
      ...(typeof hook.description === 'string' ? { description: hook.description } : {}),
      version: typeof hook.version === 'string' && hook.version.trim() !== '' ? hook.version : '1.0.0',
      remoteVersion: typeof hook.remoteVersion === 'string' ? hook.remoteVersion : '',
      source: hook.source === 'IN-LIBRARY' ? 'IN-LIBRARY' : 'ON-DEVICE',
      enabled: typeof hook.enabled === 'boolean' ? hook.enabled : false,
      event: hook.event as AgentHookEvent,
      action,
      createdAt: typeof hook.createdAt === 'string' ? hook.createdAt : now,
      updatedAt: typeof hook.updatedAt === 'string' ? hook.updatedAt : now,
    };
    if (typeof hook.matcher === 'string' && hook.matcher.trim() !== '') clean.matcher = hook.matcher;
    result.push(clean);
  }
  return result;
}

/**
 * Sanitize starred chat sessions index, removing orphaned or invalid entries.
 */
export function sanitizeStarredChatSessions(
  profile: ProfileV2,
  cleanChats: ChatConfig[],
): StarredChatSessionIndexItem[] {
  const rawItems = profile['starred-chat-sessions'];
  if (!Array.isArray(rawItems)) {
    return [];
  }

  const chatsById = new Map(cleanChats.map((chat) => [chat.chat_id, chat]));
  const seen = new Set<string>();

  const sanitized: StarredChatSessionIndexItem[] = [];

  for (const rawItem of rawItems) {
    if (!rawItem || typeof rawItem !== 'object') {
      continue;
    }

    const item = rawItem as Partial<StarredChatSessionIndexItem>;
    const chatId = typeof item.chatId === 'string' ? item.chatId : '';
    const chat = chatsById.get(chatId);
    const agent = chat?.agent;
    const chatSessionId = typeof item.chatSessionId === 'string' ? item.chatSessionId : '';
    const title = typeof item.title === 'string' && item.title.trim().length > 0 ? item.title : 'Untitled Session';
    const lastUpdated = typeof item.lastUpdated === 'string' && item.lastUpdated.trim().length > 0
      ? item.lastUpdated
      : new Date().toISOString();
    const starredAt = typeof item.starredAt === 'string' && item.starredAt.trim().length > 0
      ? item.starredAt
      : lastUpdated;

    if (!chat || !chatSessionId || seen.has(chatSessionId)) {
      continue;
    }

    seen.add(chatSessionId);
    sanitized.push({
      chatId,
      chatSessionId,
      title,
      lastUpdated,
      readStatus: item.readStatus === 'read' ? 'read' : item.readStatus === 'unread' ? 'unread' : undefined,
      agentName: agent?.name || (typeof item.agentName === 'string' && item.agentName.trim().length > 0 ? item.agentName : 'Unnamed Agent'),
      agentEmoji: agent?.emoji || item.agentEmoji,
      agentAvatar: agent?.avatar || item.agentAvatar,
      agentSource: agent?.source || item.agentSource,
      agentVersion: agent?.version || item.agentVersion,
      starredAt,
    });
  }

  return sanitized.sort((a, b) => new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime());
}

/**
 * Sanitize `profile.archived_chats` (the archive list SSOT). Keeps only entries
 * with a non-empty `chat_id` (the restore key) and a non-empty `agent_ids`,
 * dropping any inline `agent` object and unknown junk so the persisted form
 * references agents by id alone — symmetric with how active chats are stored.
 * Returns [] when there is nothing valid to persist.
 */
export function sanitizeArchivedChats(profile: ProfileV2): ArchivedChatEntry[] {
  const rawItems = (profile as { archived_chats?: unknown }).archived_chats;
  if (!Array.isArray(rawItems)) {
    return [];
  }
  const seen = new Set<string>();
  const sanitized: ArchivedChatEntry[] = [];
  for (const rawItem of rawItems) {
    if (!rawItem || typeof rawItem !== 'object') {
      continue;
    }
    const item = rawItem as Partial<ArchivedChatEntry> & { agent?: unknown };
    const chatId = typeof item.chat_id === 'string' ? item.chat_id.trim() : '';
    if (!chatId || seen.has(chatId)) {
      continue;
    }
    const agentIds = Array.isArray(item.agent_ids)
      ? item.agent_ids.filter((id): id is string => typeof id === 'string' && id.trim() !== '')
      : [];
    if (agentIds.length === 0) {
      continue;
    }
    seen.add(chatId);
    const entry: ArchivedChatEntry = {
      chat_id: chatId,
      chat_type: item.chat_type === 'multi_agent' ? 'multi_agent' : 'single_agent',
      agent_ids: agentIds,
    };
    if (typeof item.archived_at === 'string' && item.archived_at.trim() !== '') {
      entry.archived_at = item.archived_at;
    }
    if (Array.isArray(item.starred_sessions) && item.starred_sessions.length > 0) {
      entry.starred_sessions = item.starred_sessions;
    }
    sanitized.push(entry);
  }
  return sanitized;
}

/**
 * Build a StarredChatSessionIndexItem from a chat session.
 */
export function buildStarredChatSessionIndexItem(
  profile: ProfileV2,
  chatId: string,
  session: Partial<ChatSession>,
  fallbackStarredAt?: string,
): StarredChatSessionIndexItem | null {
  const chat = profile.chats.find((candidate) => candidate.chat_id === chatId);
  const existingItem = (profile['starred-chat-sessions'] || []).find(
    (item) => item.chatSessionId === session.chatSession_id,
  );
  if (!chat || !session.chatSession_id || !session.title || !session.last_updated) {
    return null;
  }

  // Resolve the chat's primary agent through the accessor (registry/store) instead
  // of reading chat.agent directly: cached profiles keep only agent_ids (inline
  // agents are stripped), so a separated chat would otherwise persist a starred
  // index entry with "Unnamed Agent" and no emoji/avatar/source/version.
  const primaryAgent = getChatPrimaryAgent(chat);
  return {
    chatId,
    chatSessionId: session.chatSession_id,
    title: session.title,
    lastUpdated: session.last_updated,
    readStatus: session.readStatus ?? existingItem?.readStatus,
    agentName: primaryAgent?.name || 'Unnamed Agent',
    agentEmoji: primaryAgent?.emoji,
    agentAvatar: primaryAgent?.avatar,
    agentSource: primaryAgent?.source,
    agentVersion: primaryAgent?.version,
    starredAt: session.starredAt || fallbackStarredAt || new Date().toISOString(),
  };
}

/**
 * Normalize agent skill names: deduplicate, trim, and filter out invalid entries.
 */
export function normalizeAgentSkillNames(skillNames?: string[]): string[] {
  if (!Array.isArray(skillNames)) {
    return [];
  }

  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const rawSkillName of skillNames) {
    if (typeof rawSkillName !== 'string') {
      continue;
    }

    const skillName = rawSkillName.trim();
    if (!skillName || seen.has(skillName)) {
      continue;
    }

    seen.add(skillName);
    normalized.push(skillName);
  }

  return normalized;
}

/**
 * Create a default chat config.
 */
export function createDefaultChat(): ChatConfig {
  return {
    chat_id: generateChatId(),
    chat_type: 'single_agent',
    agent: { ...DEFAULT_CHAT_AGENT }
  };
}

/**
 * Plugin-injected resources (MCP servers, skills) were scoped with a
 * `plugin--<pluginId>--<name>` naming convention. The plugin feature has been
 * removed, so any persisted entry still referencing such a name is an orphan —
 * its underlying global server/skill no longer exists. These are stripped during
 * sanitization in two places:
 *  - Agent bindings: leaving a dead `plugin--` MCP binding in an agent's
 *    non-empty `mcp_servers` allowlist would otherwise zero out the agent's
 *    available tools (a non-empty list is treated as an allowlist), and a dead
 *    skill name is a dangling reference.
 *  - Global MCP/skill registries: entries are normally dropped by their retired
 *    `source: 'PLUGIN'` tag, but matching the `plugin--` name as well catches
 *    entries from a corrupt or partially-migrated sidecar whose `source` was
 *    lost or coerced, which would otherwise resurface as user-managed resources.
 */
function isPluginScopedResourceName(name: unknown): boolean {
  return typeof name === 'string' && name.startsWith('plugin--');
}

function sanitizeAgentMcpServers(servers: unknown): AgentMcpServer[] {
  return Array.isArray(servers)
    ? servers
        .map(server => {
          if (typeof server === 'string') {
            return { name: server, tools: [] };
          }
          if (server && typeof server === 'object') {
            const candidate = server as Partial<AgentMcpServer>;
            return {
              name: candidate.name || '',
              tools: Array.isArray(candidate.tools) ? candidate.tools : []
            };
          }
          return null;
        })
        .filter((server): server is AgentMcpServer => server !== null && server.name !== '')
        .filter(server => !isPluginScopedResourceName(server.name))
    : [];
}

function sanitizeAgentHookIds(hooks: unknown): string[] {
  return Array.isArray(hooks)
    ? hooks.filter((id): id is string => typeof id === 'string' && id.trim() !== '')
    : [];
}

function deriveAgentIdsFromInlineAgents(agent: ChatAgent | undefined, agents: ChatAgent[]): string[] {
  const ids: string[] = [];
  const inlineAgents = agents.length > 0 ? agents : agent ? [agent] : [];
  for (const inlineAgent of inlineAgents) {
    if (!inlineAgent?.name) {
      continue;
    }
    const id = agentIdOf(inlineAgent);
    if (!ids.includes(id)) {
      ids.push(id);
    }
  }
  return ids;
}

/**
 * Accepted card-id pattern — must match card IPC consumers.
 * Lowercase alphanumeric with optional hyphens, 2-64 chars.
 */
const VALID_CARD_ID_RE = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/;

/**
 * Backfill missing or invalid `id` fields on QuickStartItem entries.
 * Called during profile sanitization (read-time and write-time normalization).
 * Ensures all persisted ids conform to the card IPC contract.
 */
export function sanitizeZeroStates(zeroStates: ZeroStates | undefined): ZeroStates {
  const base = zeroStates || DEFAULT_ZERO_STATES;
  if (Array.isArray(base.quick_starts) && base.quick_starts.length > 0) {
    const backfilled = base.quick_starts.map(item => {
      if (!item || typeof item !== 'object') return { title: '', description: '', prompt: '', id: randomUUID().slice(0, 8) };
      return {
        ...item,
        id: (item.id && typeof item.id === 'string' && VALID_CARD_ID_RE.test(item.id)) ? item.id : randomUUID().slice(0, 8),
      };
    });
    return { ...base, quick_starts: backfilled };
  }
  // Coerce non-array quick_starts to empty array
  if (base.quick_starts && !Array.isArray(base.quick_starts)) {
    return { ...base, quick_starts: [] };
  }
  return base;
}

function sanitizeChatAgent(agent: ChatAgent | undefined): ChatAgent | undefined {
  if (!agent) return undefined;
  const normalizedKnowledge = getAgentKnowledge(agent);
  const normalizedSkills = Array.isArray(agent.skills)
    ? agent.skills.filter(skill => !isPluginScopedResourceName(skill))
    : [];
  const { workspace: _legacyWorkspace, ...agentWithoutWorkspace } = agent as ChatAgent & { workspace?: string };

  const cleanAgent = withNormalizedAgentKnowledge({
    // Preserve the stable agent id so an inline agent that survives a disk write
    // (the durability gate keeps it when its store write has not succeeded yet)
    // reloads under the SAME id instead of a name-derived legacy id — otherwise a
    // failed sidecar write leaves chat.agent_ids pointing at an id the reload can
    // never reproduce, permanently breaking that chat's agent resolution.
    ...(agentWithoutWorkspace.id ? { id: agentWithoutWorkspace.id } : {}),
    role: agentWithoutWorkspace.role || DEFAULT_CHAT_AGENT.role,
    emoji: agentWithoutWorkspace.emoji || DEFAULT_CHAT_AGENT.emoji,
    avatar: agentWithoutWorkspace.avatar || '',
    name: agentWithoutWorkspace.name || DEFAULT_CHAT_AGENT.name,
    model: agentWithoutWorkspace.model || DEFAULT_CHAT_AGENT.model,
    knowledge: {
      knowledgeBase: normalizedKnowledge.knowledgeBase || '',
    },
    version: agentWithoutWorkspace.version || '1.0.0',
    remoteVersion: agentWithoutWorkspace.remoteVersion ?? '',
    source: agentWithoutWorkspace.source || 'ON-DEVICE',
    mcp_servers: sanitizeAgentMcpServers(agentWithoutWorkspace.mcp_servers),
    system_prompt: agentWithoutWorkspace.system_prompt !== undefined
      ? normalizeAgentSystemPrompt(agentWithoutWorkspace.system_prompt)
      : normalizeAgentSystemPrompt(DEFAULT_CHAT_AGENT.system_prompt),
    skills: normalizedSkills,
    hooks: sanitizeAgentHookIds(agentWithoutWorkspace.hooks),
    zero_states: sanitizeZeroStates(agentWithoutWorkspace.zero_states),
    authToken: typeof agentWithoutWorkspace.authToken === 'string' ? agentWithoutWorkspace.authToken : undefined,
  });

  if (isBuiltinAgent(cleanAgent.name, BRAND_NAME)) {
    const existingSkills = cleanAgent.skills || [];
    const missingSkills = BUILTIN_SKILL_NAMES.filter(skill => !existingSkills.includes(skill));
    if (missingSkills.length > 0) {
      cleanAgent.skills = [...existingSkills, ...missingSkills];
    }
  }

  return cleanAgent;
}

/**
 * Normalize an installed global MCP server config list, ensuring every entry carries the
 * canonical fields (`version`, `remoteVersion`, `source`, boolean `in_use`,
 * etc.). Shared by `sanitizeProfileV2` (the transient load/migration window) and
 * `McpConfigManager` (the runtime owner of `mcp.json`) so both produce byte-for-
 * byte identical entries — the single source of truth for the installed server config on-disk
 * shape. Null/non-object entries (e.g. from a tampered or truncated file) are
 * dropped rather than coerced, so this never throws on malformed input. Pure
 * function, no side effects.
 */
export function sanitizeMcpServerList(servers: McpServerConfig[] | undefined): McpServerConfig[] {
  return (servers || [])
    .filter((server): server is McpServerConfig => server != null && typeof server === 'object')
    // Migration for the removed plugin feature: drop orphaned plugin-injected MCP
    // servers. They carry the retired `source: 'PLUGIN'` value and point at plugin
    // install directories that no longer exist, so they are removed on the next
    // load/write instead of surfacing as broken user-managed servers. The
    // `plugin--` name check additionally catches entries whose source was lost or
    // coerced in a corrupt/partially-migrated sidecar.
    .filter(server => (server.source as string | undefined) !== 'PLUGIN' && !isPluginScopedResourceName(server.name))
    .map(server => ({
      name: server.name || '',
      transport: server.transport || 'stdio',
      command: server.command || '',
      args: Array.isArray(server.args) ? server.args : [],
      env: (server.env && typeof server.env === 'object') ? server.env : {},
      url: server.url || '',
      in_use: Boolean(server.in_use),
      version: server.version || '1.0.0',
      remoteVersion: server.remoteVersion ?? '',
      source: server.source || 'ON-DEVICE',
      ...(server.hidden != null && { hidden: Boolean(server.hidden) }),
      ...(server.headers && typeof server.headers === 'object' && { headers: server.headers }),
      ...(server.oauth && typeof server.oauth === 'object' && { oauth: server.oauth }),
    }));
}

/**
 * V2 Profile data sanitization and validation (schema normalizer; pure function with no side effects).
 *
 * 📖 Standard pattern for adding new fields, see README Step 3b:
 * src/main/lib/userDataADO/README.md — "3b. sanitizeProfileV2 — called on every write"
 */
export function sanitizeProfileV2(profile: ProfileV2): ProfileV2 {
  try {
    // Sanitize MCP server configs, ensuring version, remoteVersion, and source fields exist
    const cleanMcpServers = sanitizeMcpServerList(profile.mcp_servers);

    // Sanitize chats config
    const cleanChats = (profile.chats || []).map(chat => {
      const cleanAgent = sanitizeChatAgent(chat.agent);
      const cleanAgents = Array.isArray(chat.agents)
        ? chat.agents
            .map(agent => sanitizeChatAgent(agent))
            .filter((agent): agent is ChatAgent => agent !== undefined)
        : [];
      // Preserve agent_ids: it is the separated-model SSOT (chat -> agents) and
      // the precondition stripInlineChatAgentsForDisk needs before it can drop
      // inline agents. Rebuilding the chat without it silently reverts a chat to
      // inline-only on every write, so the inline strip can never take effect.
      const rawAgentIds = Array.isArray(chat.agent_ids)
        ? chat.agent_ids.filter((id): id is string => typeof id === 'string' && id.trim() !== '')
        : [];
      const cleanAgentIds = rawAgentIds.length > 0
        ? rawAgentIds
        : deriveAgentIdsFromInlineAgents(cleanAgent, cleanAgents);

      return {
        chat_id: chat.chat_id || generateChatId(),
        chat_type: chat.chat_type || 'single_agent',
        ...(cleanAgentIds.length > 0 && { agent_ids: cleanAgentIds }),
        ...(cleanAgent && { agent: cleanAgent }),
        ...(cleanAgents.length > 0 && { agents: cleanAgents }),
      } as ChatConfig;
    });

    // Archive list SSOT (moved out of the standalone agents/archived_chats.json).
    const cleanArchivedChats = sanitizeArchivedChats(profile);

    // Build the sanitized V2 Profile
    const sanitizedProfile: ProfileV2 = {
      version: profile.version || '2.0.0',
      createdAt: profile.createdAt || new Date().toISOString(),
      updatedAt: profile.updatedAt || new Date().toISOString(),
      alias: profile.alias || '',
      freDone: typeof profile.freDone === 'boolean' ? profile.freDone : false,
      ...(profile.primaryChat && { primaryChat: profile.primaryChat }),
      mcp_servers: cleanMcpServers,
      skills: Array.isArray(profile.skills) ? profile.skills
        // Migration for the removed plugin feature: drop orphaned plugin-injected
        // skills. They carry the retired `source: 'PLUGIN'` value and are backed by
        // directory links into plugin folders that no longer exist. The `plugin--`
        // name check additionally catches entries whose source was lost or coerced.
        .filter(skill => (skill.source as string | undefined) !== 'PLUGIN' && !isPluginScopedResourceName(skill.name))
        .map(skill => ({
          name: skill.name || '',
          description: skill.description || '',
          version: skill.version || '1.0.0',
          remoteVersion: skill.remoteVersion ?? '',
          source: skill.source || 'ON-DEVICE'
        })) : [],
      hooks: sanitizeHooks(profile.hooks),
      hooksEnabled: typeof profile.hooksEnabled === 'boolean' ? profile.hooksEnabled : false,
      chats: cleanChats.length > 0 ? cleanChats : [createDefaultChat()],
      ...(cleanArchivedChats.length > 0 && { archived_chats: cleanArchivedChats }),
      'starred-chat-sessions': sanitizeStarredChatSessions(profile, cleanChats),
      browser: {
        ...DEFAULT_BROWSER_SETTINGS,
        ...profile.browser,
        enabled: profile.browser?.enabled === true,
      },
      memex: {
        ...DEFAULT_MEMEX_SETTINGS,
        ...profile.memex,
        enabled: profile.memex?.enabled === true,
      },
      codingAgentSettings: {
        ...DEFAULT_CODING_AGENT_SETTINGS,
        enabled: profile.codingAgentSettings?.enabled === true,
        cli: isCodingCliId(profile.codingAgentSettings?.cli)
          ? profile.codingAgentSettings.cli
          : DEFAULT_CODING_AGENT_SETTINGS.cli,
      },
      computerUse: {
        ...DEFAULT_COMPUTER_USE_SETTINGS,
        ...profile.computerUse,
        enabled: profile.computerUse?.enabled === true,
        requireConfirmation: profile.computerUse?.requireConfirmation !== false,
        alwaysAllowedApps: Array.isArray(profile.computerUse?.alwaysAllowedApps)
          ? profile.computerUse!.alwaysAllowedApps.filter(
              (app): app is string => typeof app === 'string' && app.trim().length > 0,
            )
          : [],
      },
      syncSettings: profile.syncSettings,
      confirmationSettings: {
        ...DEFAULT_CONFIRMATION_SETTINGS,
        ...profile.confirmationSettings,
        inlineEditRegenerate: {
          ...DEFAULT_CONFIRMATION_SETTINGS.inlineEditRegenerate,
          ...(profile.confirmationSettings?.inlineEditRegenerate || {}),
        },
      },
      builtinDefaultsVersion: profile.builtinDefaultsVersion,
      profileMigrationVersion: profile.profileMigrationVersion,
    };

    return sanitizedProfile;
  } catch (error) {
    // Return minimal safe V2 config
    const fallbackChat = createDefaultChat();
    return {
      version: '2.0.0',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      alias: profile.alias || '',
      freDone: false,
      primaryChat: fallbackChat.chat_id,
      mcp_servers: [],
      skills: [],
      chats: [fallbackChat],
      'starred-chat-sessions': [],
      confirmationSettings: DEFAULT_CONFIRMATION_SETTINGS,
    };
  }
}
