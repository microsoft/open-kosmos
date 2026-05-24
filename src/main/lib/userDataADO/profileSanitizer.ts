/**
 * Profile sanitization functions — pure functions for schema normalization and default-filling.
 * Extracted from ProfileCacheManager for modularity.
 *
 * sanitizeProfileV2() is the single source of truth for profile structure.
 * It is called in two places:
 *   1. ensureV2ProfileIntegrity (read-time normalization)
 *   2. writeProfileToFile (write-time normalization)
 */

import * as path from 'path';
import { createConsoleLogger } from '../unifiedLogger';
import { generateChatId as generateRuntimeChatId } from '../utilities/idFactory';
import {
  ProfileV2,
  ChatConfig,
  ChatAgent,
  AgentMcpServer,
  ChatSkillSnapshot,
  ChatSkillSnapshotItem,
  ChatSession,
  StarredChatSessionIndexItem,
  SubAgentConfig,
  SubAgentIndex,
  DEFAULT_CHAT_AGENT,
  DEFAULT_CONFIRMATION_SETTINGS,
  DEFAULT_ZERO_STATES,
  getAgentKnowledge,
  isBuiltinAgent,
  withNormalizedAgentKnowledge,
} from './types/profile';
import { BUILTIN_SKILL_NAMES } from '../../../shared/constants/builtinSkills';

const logger = createConsoleLogger();

/**
 * Generate a random Chat ID (wrapper around idFactory).
 */
export function generateChatId(): string {
  return generateRuntimeChatId();
}

/**
 * Sanitize sub-agents array, ensuring data integrity and removing dangling references.
 *
 * Post-migration: sub_agents contains SubAgentIndex[] (lightweight).
 * Pre-migration: sub_agents may contain SubAgentConfig[] (full).
 * This method handles both formats gracefully.
 */
export function sanitizeSubAgents(profile: ProfileV2, cleanChats: ChatConfig[]): SubAgentIndex[] | SubAgentConfig[] {
  if (!Array.isArray(profile.sub_agents)) {
    return [];
  }

  // Deduplicate by name (also filters out null/undefined entries)
  const seen = new Set<string>();
  const deduped = profile.sub_agents.filter(sa => {
    if (!sa || !sa.name || seen.has(sa.name)) return false;
    seen.add(sa.name);
    return true;
  });

  // Detect format: if first valid item has system_prompt, it's old (pre-migration) format
  const isOldFormat = deduped.length > 0 &&
    'system_prompt' in (deduped[0] as any);

  let sanitized: SubAgentIndex[] | SubAgentConfig[];

  if (isOldFormat) {
    // Pre-migration: sanitize as full SubAgentConfig (backward compat)
    sanitized = (deduped as SubAgentConfig[]).map(sa => ({
      name: sa.name,
      description: sa.description || '',
      system_prompt: sa.system_prompt || '',
      mcp_servers: Array.isArray(sa.mcp_servers) ? sa.mcp_servers : [],
      skills: Array.isArray(sa.skills) ? sa.skills : [],
      builtin_tools: Array.isArray(sa.builtin_tools) ? sa.builtin_tools : [],
      inherit_mcp_servers: sa.inherit_mcp_servers ?? true,
      inherit_skills: sa.inherit_skills ?? true,
    })) as SubAgentConfig[];
  } else {
    // Post-migration: sanitize as lightweight SubAgentIndex
    sanitized = (deduped as SubAgentIndex[]).map(sa => ({
      name: sa.name,
      version: sa.version || '1.0.0',
      source: sa.source || 'ON-DEVICE' as const,
    })) as SubAgentIndex[];
  }

  // Clean ChatAgent references to non-existent sub-agents
  const validNames = new Set(sanitized.map(sa => sa.name));
  for (const chat of cleanChats) {
    if (chat.agent?.sub_agents) {
      chat.agent.sub_agents = chat.agent.sub_agents.filter(name => validNames.has(name));
    }
  }

  return sanitized;
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
      source: item.source || undefined,
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

  return {
    chatId,
    chatSessionId: session.chatSession_id,
    title: session.title,
    lastUpdated: session.last_updated,
    readStatus: session.readStatus ?? existingItem?.readStatus,
    source: session.source ?? existingItem?.source,
    agentName: chat.agent?.name || 'Unnamed Agent',
    agentEmoji: chat.agent?.emoji,
    agentAvatar: chat.agent?.avatar,
    agentSource: chat.agent?.source,
    agentVersion: chat.agent?.version,
    starredAt: session.starredAt || fallbackStarredAt || new Date().toISOString(),
  };
}

/**
 * Sanitize a ChatSkillSnapshot, returning undefined if it has no useful content.
 */
export function sanitizeChatSkillSnapshot(snapshot: any): ChatSkillSnapshot | undefined {
  if (!snapshot || typeof snapshot !== 'object') {
    return undefined;
  }

  const skills: ChatSkillSnapshotItem[] = Array.isArray(snapshot.skills)
    ? snapshot.skills
        .filter((skill: any) => skill && typeof skill === 'object' && typeof skill.name === 'string' && skill.name.trim() !== '')
        .map((skill: any) => ({
          name: skill.name,
          description: typeof skill.description === 'string' ? skill.description : '',
          version: typeof skill.version === 'string' ? skill.version : '',
          file_path: typeof skill.file_path === 'string' ? skill.file_path : '',
        }))
    : [];

  const normalized: ChatSkillSnapshot = {
    binding_signature: typeof snapshot.binding_signature === 'string' ? snapshot.binding_signature : '',
    registry_signature: typeof snapshot.registry_signature === 'string' ? snapshot.registry_signature : '',
    generated_at: typeof snapshot.generated_at === 'string' ? snapshot.generated_at : new Date().toISOString(),
    skills,
    prompt: typeof snapshot.prompt === 'string' ? snapshot.prompt : '',
  };

  if (Array.isArray(snapshot.missing_skill_names)) {
    const missingSkillNames = snapshot.missing_skill_names
      .filter((skillName: any) => typeof skillName === 'string' && skillName.trim() !== '');
    if (missingSkillNames.length > 0) {
      normalized.missing_skill_names = missingSkillNames;
    }
  }

  const hasUsefulContent =
    normalized.binding_signature ||
    normalized.registry_signature ||
    normalized.prompt ||
    normalized.skills.length > 0 ||
    (normalized.missing_skill_names?.length || 0) > 0;

  return hasUsefulContent ? normalized : undefined;
}

/**
 * Clear skill snapshots for chats whose agent skills overlap with the given skill names.
 * Returns the number of cleared snapshots.
 */
export function clearSkillSnapshotsForAffectedChats(profile: ProfileV2, skillNames: string[]): number {
  if (!Array.isArray(skillNames) || skillNames.length === 0) {
    return 0;
  }

  const affectedSkillNames = new Set(skillNames);
  let clearedCount = 0;

  for (const chat of profile.chats || []) {
    if (!chat.skill_snapshot || !chat.agent?.skills || !Array.isArray(chat.agent.skills)) {
      continue;
    }

    const isAffected = chat.agent.skills.some(skillName => affectedSkillNames.has(skillName));
    if (!isAffected) {
      continue;
    }

    delete chat.skill_snapshot;
    clearedCount++;

    logger.info('[ProfileCacheManager] Cleared chat skill snapshot due to skill registry change', 'clearSkillSnapshotsForAffectedChats', {
      alias: profile.alias,
      chatId: chat.chat_id,
      affectedSkillNames: Array.from(affectedSkillNames),
    });
  }

  return clearedCount;
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
    agent: { ...DEFAULT_CHAT_AGENT, workspace: '' }
  };
}

/**
 * V2 Profile data sanitization and validation (schema normalizer; pure function with no side effects).
 *
 * 📖 Standard pattern for adding new fields, see README Step 3b:
 * src/main/lib/userDataADO/README.md — "3b. sanitizeProfileV2 — called on every write"
 */
export function sanitizeProfileV2(profile: ProfileV2): ProfileV2 {
  try {
    // Sanitize MCP server configs, ensuring version and source fields exist
    const cleanMcpServers = (profile.mcp_servers || []).map(server => ({
      name: server.name || '',
      transport: server.transport || 'stdio',
      command: server.command || '',
      args: Array.isArray(server.args) ? server.args : [],
      env: (server.env && typeof server.env === 'object') ? server.env : {},
      url: server.url || '',
      in_use: Boolean(server.in_use),
      version: server.version || '1.0.0',
      source: server.source || 'ON-DEVICE',
      ...(server.hidden != null && { hidden: Boolean(server.hidden) }),
      ...(server.headers && typeof server.headers === 'object' && { headers: server.headers }),
    }));

    // Sanitize chats config
    const cleanChats = (profile.chats || []).map(chat => {
      // Backward compat: read workspace from chat.workspace (legacy) or chat.agent.workspace
      const legacyWorkspace = (chat as any).workspace;
      const agentWorkspace = chat.agent?.workspace;
      const workspacePath = typeof agentWorkspace === 'string' && agentWorkspace
        ? agentWorkspace
        : (typeof legacyWorkspace === 'string' ? legacyWorkspace : '');

      const cleanAgent = chat.agent ? (() => {
        const normalizedKnowledge = getAgentKnowledge(chat.agent);
        const normalizedSkills = Array.isArray(chat.agent.skills) ? chat.agent.skills : [];

        return withNormalizedAgentKnowledge({
        role: chat.agent.role || DEFAULT_CHAT_AGENT.role,
        emoji: chat.agent.emoji || DEFAULT_CHAT_AGENT.emoji,
        avatar: chat.agent.avatar || '',
        name: chat.agent.name || DEFAULT_CHAT_AGENT.name,
        model: chat.agent.model || DEFAULT_CHAT_AGENT.model,
        workspace: workspacePath,
        knowledge: {
          knowledgeBase: normalizedKnowledge.knowledgeBase || (workspacePath ? path.join(workspacePath, 'knowledge') : ''),
        },
        version: chat.agent.version || '1.0.0',
        source: chat.agent.source || 'ON-DEVICE',
        mcp_servers: Array.isArray(chat.agent.mcp_servers)
          ? chat.agent.mcp_servers
              .map(server => {
                if (typeof server === 'string') {
                  return { name: server, tools: [] };
                } else if (server && typeof server === 'object') {
                  return {
                    name: server.name || '',
                    tools: Array.isArray(server.tools) ? server.tools : []
                  };
                } else {
                  return null;
                }
              })
              .filter((server): server is AgentMcpServer => server !== null && server.name !== '')
          : [],
        system_prompt: chat.agent.system_prompt !== undefined ? chat.agent.system_prompt : DEFAULT_CHAT_AGENT.system_prompt,
        context_enhancement: chat.agent.context_enhancement,
        skills: normalizedSkills,
        sub_agents: Array.isArray(chat.agent.sub_agents) ? chat.agent.sub_agents : [],
        enabled_plugins: Array.isArray(chat.agent.enabled_plugins) ? chat.agent.enabled_plugins : [],
        zero_states: chat.agent.zero_states || DEFAULT_ZERO_STATES,
        authToken: typeof chat.agent.authToken === 'string' ? chat.agent.authToken : undefined,
      });
      })() : undefined;

      // Ensure builtin agents include all builtin skills
      if (cleanAgent && isBuiltinAgent(cleanAgent.name)) {
        const existingSkills = cleanAgent.skills || [];
        const missingSkills = BUILTIN_SKILL_NAMES.filter(s => !existingSkills.includes(s));
        if (missingSkills.length > 0) {
          cleanAgent.skills = [...existingSkills, ...missingSkills];
        }
      }

      return {
        chat_id: chat.chat_id || generateChatId(),
        chat_type: chat.chat_type || 'single_agent',
        ...(cleanAgent && { agent: cleanAgent }),
        ...(sanitizeChatSkillSnapshot(chat.skill_snapshot)
          ? { skill_snapshot: sanitizeChatSkillSnapshot(chat.skill_snapshot)! }
          : {})
      } as ChatConfig;
    });

    // Build the sanitized V2 Profile
    const sanitizedProfile: ProfileV2 = {
      version: profile.version || '2.0.0',
      createdAt: profile.createdAt || new Date().toISOString(),
      updatedAt: profile.updatedAt || new Date().toISOString(),
      alias: profile.alias || '',
      freDone: typeof profile.freDone === 'boolean' ? profile.freDone : false,
      primaryAgent: profile.primaryAgent || 'Kobi',
      mcp_servers: cleanMcpServers,
      skills: Array.isArray(profile.skills) ? profile.skills.map(skill => ({
        name: skill.name || '',
        description: skill.description || '',
        version: skill.version || '1.0.0',
        source: skill.source || 'ON-DEVICE'
      })) : [],
      sub_agents: sanitizeSubAgents(profile, cleanChats),
      chats: cleanChats.length > 0 ? cleanChats : [createDefaultChat()],
      'starred-chat-sessions': sanitizeStarredChatSessions(profile, cleanChats),
      browserControl: profile.browserControl,
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
    return {
      version: '2.0.0',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      alias: profile.alias || '',
      freDone: false,
      primaryAgent: 'Kobi',
      mcp_servers: [],
      skills: [],
      sub_agents: [],
      chats: [createDefaultChat()],
      'starred-chat-sessions': [],
      confirmationSettings: DEFAULT_CONFIRMATION_SETTINGS,
    };
  }
}
