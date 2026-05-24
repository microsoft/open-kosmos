/**
 * Type definitions for Profile configuration V2
 */

import { BUILTIN_DEFAULTS_VERSION } from '../../../../shared/constants/builtinSkills';

/** Default model ID — consistent with GhcModelsManager.getDefaultModel() */
const DEFAULT_MODEL_ID = 'claude-sonnet-4.6';

/**
 * Skill configuration
 */
export interface SkillConfig {
  /** Skill name (also used as folder name) */
  name: string;
  /** Skill description */
  description: string;
  /** Skill version */
  version: string;
  /** Skill source: ON-DEVICE (from local machine) or PLUGIN (from plugin system) */
  source: 'ON-DEVICE' | 'PLUGIN';
}

/**
 * Chat-level resolved Skill snapshot item
 */
export interface ChatSkillSnapshotItem {
  /** Skill name */
  name: string;
  /** Skill description */
  description: string;
  /** Skill version */
  version: string;
  /** Absolute SKILL.md path */
  file_path: string;
}

/**
 * Chat-level Skill snapshot used by AgentChat at turn boundaries
 */
export interface ChatSkillSnapshot {
  /** Signature of normalized chat.agent.skills */
  binding_signature: string;
  /** Signature of resolved installed skill metadata */
  registry_signature: string;
  /** Snapshot generation timestamp */
  generated_at: string;
  /** Resolved valid skills */
  skills: ChatSkillSnapshotItem[];
  /** Missing skill names referenced by the agent but not found in profile.skills */
  missing_skill_names?: string[];
  /** Prebuilt prompt text consumed by AgentChat */
  prompt: string;
}

/**
 * Sub-agent context access mode (only 'isolated' is supported)
 * @deprecated Kept for backward compatibility with persisted data; always treated as 'isolated'
 */
export type SubAgentContextAccess = 'isolated';

/**
 * Sub-Agent lightweight index — stored in profile.json
 * Only retains the minimum fields needed for ProfileCacheManager notification mechanism.
 * Full configuration is read from agents/{name}/AGENT.md files.
 */
export interface SubAgentIndex {
  /** Sub-agent unique name (matches directory name and name in AGENT.md) */
  name: string;
  /** Local version number */
  version: string;
  /** Source: locally created or plugin */
  source: 'ON-DEVICE' | 'PLUGIN';
}

/**
 * Sub-Agent MCP server configuration
 * Compatible with Claude Code's mcpServers (supports referencing by name or inline definition)
 */
export type SubAgentMcpServerConfig =
  | string                          // Reference a configured server name (Claude Code format)
  | AgentMcpServer;                 // OpenKosmos inline definition format

/**
 * Sub-Agent full configuration — parsed from AGENT.md files
 * Compatible with Claude Code sub-agent front-matter standard fields
 *
 * Design principles:
 * - Claude Code standard fields at top, OpenKosmos extension fields isolated via x-openkosmos namespace
 * - system_prompt is parsed from AGENT.md Markdown body, not present in YAML front-matter
 * - Legacy fields (source, remoteVersion, mcp_servers, max_turns) kept optional for backward compatibility,
 *   to be removed after Phase 2 integration is complete
 */
export interface SubAgentConfig {
  // ========== Claude Code Standard Fields ==========
  /** Unique identifier and display name (lowercase letters + digits + hyphens), must be unique */
  name: string;
  /** Description used by Claude for delegation decisions, required */
  description: string;
  /**
   * Claude Code tool list (omit to inherit all)
   * Stores Claude Code original tool names (e.g., Read, Grep, Glob, Bash),
   * mapped to OpenKosmos tool names at runtime by SubAgentManager
   */
  tools?: string[];
  /** Disallowed tools list — corresponds to Claude Code's disallowedTools */
  disallowedTools?: string[];
  /** Model selection: specific model name or 'inherit' (default: inherit) */
  model?: string;
  /** Pre-loaded Skills name list */
  skills?: string[];
  /** MCP server configuration (camelCase, compatible with Claude Code mcpServers) */
  mcpServers?: SubAgentMcpServerConfig[];

  // ========== OpenKosmos Extension Fields (in AGENT.md under x-openkosmos namespace) ==========
  /** Sub-agent built-in tool whitelist (e.g., read_file, execute_command) (empty array = no restriction) */
  builtin_tools?: string[];
  /**
   * Sub-agent disallowed built-in tool blacklist (e.g., write_file, execute_command)
   * Excluded from available built-in tools at runtime.
   * When importing Claude Code AGENT.md, auto-generated from disallowedTools mapping.
   */
  disallow_builtin_tools?: string[];
  /**
   * Whether to inherit parent Agent's MCP server configuration (default: true)
   * - true: merge parent + sub-agent's own MCP servers at runtime (sub-agent's same-name servers take priority)
   * - false: only use sub-agent's own configured MCP servers
   */
  inherit_mcp_servers?: boolean;
  /**
   * Whether to inherit parent Agent's Skills configuration (default: true)
   * - true: union of parent + sub-agent's own Skills at runtime (deduplicated)
   * - false: only use sub-agent's own configured Skills
   */
  inherit_skills?: boolean;
  /**
   * Whether to inherit parent Agent's Knowledge Base (default: true)
   * - true: use parent's knowledge base when sub-agent has none
   * - false: do not inherit parent knowledge base
   */
  inherit_knowledge_base?: boolean;
  /** Knowledge base path (sub-agent's own; takes priority over inherited) */
  knowledgeBase?: string;

  // ========== Runtime Fields (not persisted to AGENT.md YAML, parsed from Markdown body) ==========
  /** Sub-agent system prompt (parsed from AGENT.md Markdown body) */
  system_prompt: string;

  // ========== Compatibility Fields (backward compatible, to be removed after Phase 2 migration) ==========
  /** @deprecated Use mcpServers instead — remove after Phase 2 */
  mcp_servers?: AgentMcpServer[];

  // ========== Sub-Agent Library Fields ==========
  /** Display name (human-friendly label) */
  display_name?: string;
  /** Emoji icon for the sub-agent */
  emoji?: string;
  /** Context access level for sub-agent */
  context_access?: string;
  /** Maximum execution turns for the sub-agent */
  max_turns?: number;
  /** Version string for tracking updates */
  version?: string;
  /** Source origin: ON-DEVICE (local file), PLUGIN (MCP-installed) */
  source?: 'ON-DEVICE' | 'PLUGIN';
}

/**
 * Default sub-agent configuration
 */
export const DEFAULT_SUB_AGENT_CONFIG: Partial<SubAgentConfig> = {
  model: 'inherit',
  mcp_servers: [],
  mcpServers: [],
  skills: [],
  tools: [],
  builtin_tools: [],
  disallow_builtin_tools: [],
  inherit_mcp_servers: true,
  inherit_skills: true,
};

/**
 * Sub-agent resource limit constants
 * Used for SubAgentManager runtime resource control
 */
export const SUB_AGENT_LIMITS = {
  MAX_PARALLEL_TASKS: Infinity,
  MAX_SPAWNS_PER_SESSION: Infinity,
  /** Max concurrent background sub-agents per parent session */
  MAX_BACKGROUND_TASKS: Infinity,
  /** Auto-promote sync sub-agents to background after this duration (aligned with Claude Code) */
  AUTO_BACKGROUND_TIMEOUT_MS: 120_000,
} as const;

/**
 * Default system prompt for ad-hoc sub-agents (created inline without AGENT.md).
 * Kept intentionally generic so the LLM can specialize via the task description.
 */
export const DEFAULT_ADHOC_SYSTEM_PROMPT =
  `You are a focused task worker. Complete the assigned task efficiently using the available tools. ` +
  `Report your findings clearly and concisely. Do not ask clarifying questions — work with what you have. ` +
  `If you create files, mention the full file paths in your response.`;

/**
 * Sub-agent task execution result
 * Returned by SubAgentManager.spawnSubAgent(), contains complete task execution information
 */
export interface SubAgentTaskResult {
  subAgentName: string;
  taskId: string;
  success: boolean;
  result?: string;
  error?: string;
  turnCount: number;
  durationMs: number;
  /** Warnings about unavailable MCP servers or skills detected at spawn time */
  availabilityWarnings?: string[];
  /** Partial result extracted from context history on timeout/cancellation */
  partialResult?: string;
  /** True if this task was auto-promoted from sync to background after 120s */
  autoPromoted?: boolean;
}

/**
 * Background sub-agent task tracking.
 * Used by SubAgentManager to manage fire-and-forget sub-agents.
 */
export interface BackgroundSubAgentTask {
  taskId: string;
  parentSessionId: string;
  subAgentName: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  startTime: number;
  /** Messages from parent agent pending delivery to this sub-agent */
  pendingMessages: string[];
}

/**
 * Notification from a sub-agent to its parent agent.
 * Queued and injected into the parent's next LLM turn.
 */
export interface SubAgentNotification {
  taskId: string;
  subAgentName: string;
  type: 'info' | 'warning' | 'need_input';
  message: string;
  timestamp: number;
}

/**
 * Sub-agent execution step
 * Records each step of operation during sub-agent runtime (tool calls or text output)
 * Used for real-time UI progress display and future persistence
 */
export interface SubAgentStep {
  /** Step type: tool execution started / tool execution completed / tool execution failed / text output / turn started / LLM streaming text (open union type for future extensibility) */
  type: 'tool_start' | 'tool_done' | 'tool_error' | 'text' | 'turn_start' | 'llm_streaming' | string;
  /** Tool call ID (used for in-place replacement matching from tool_start -> tool_done/tool_error) */
  toolCallId?: string;
  /** Tool name (only for tool_* types) */
  toolName?: string;
  /** Human-readable summary of tool arguments (<=200 characters) */
  toolArgsSummary?: string;
  /** Current turn (1-based, indicates the turn being executed) */
  turn: number;
  /** Step timestamp (ms) */
  timestamp: number;
  /** Tool execution duration (only present for tool_done / tool_error, ms) */
  durationMs?: number;
  /** Tool result length (only present for tool_done, character count) */
  toolResultLength?: number;
  /** Text snippet (only for text type, truncated to <=2 lines) */
  textSnippet?: string;
}

/**
 * Sub-agent runtime state
 * Used to track sub-agent execution progress, pushed to Renderer via IPC for display
 */
export interface SubAgentRuntimeState {
  taskId: string;
  subAgentName: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  startTime: number;
  endTime?: number;
  currentTurn: number;
  /** Correlated with parent toolCall.id, used for precise Renderer matching (resolves parallel same-name sub-agent conflicts) */
  correlationId?: string;
  /** Sub-agent max turns removed — sub-agents run until done (safety cap: 200 turns) */
  // maxTurns was removed; use turnCount for metrics only
  /** Execution steps list (bounded, keeps at most 30 entries, FIFO eviction) */
  steps: SubAgentStep[];
  /** Most recent LLM text output snippet (<=4 lines, <=500 characters, for UI thinking process display) */
  lastTextSnippet?: string;
  /** Current LLM streaming text being generated (updated in real-time, cleared after turn ends) */
  streamingText?: string;
}

/**
 * Sub-agent update information
 * Comparison result returned when StartupUpdateService checks for updates
 */
export interface SubAgentUpdateInfo {
  /** Sub-agent name */
  name: string;
  /** Current local version */
  currentVersion: string;
  /** Latest version on CDN */
  latestVersion: string;
  /** Whether an update is available */
  hasUpdate: boolean;
  /** Updated sub-agent configuration (for one-click update) */
  updatedConfig?: SubAgentConfig;
}

/**
 * MCP Server configuration
 */
export interface McpServerConfig {
  /** Name of the MCP server */
  name: string;
  /** Transport type ('stdio', 'sse', or 'StreamableHttp') */
  transport: 'stdio' | 'sse' | 'StreamableHttp' | string;
  /** Command to execute (for stdio transport) */
  command: string;
  /** Command line arguments */
  args: string[];
  /** Environment variables */
  env: Record<string, string>;
  /** Server URL (for sse/http transport) */
  url: string;
  /** Whether this server is currently in use */
  in_use: boolean;
  /** MCP server version */
  version?: string;
  /** MCP server source: ON-DEVICE (from local machine) or PLUGIN (from plugin) */
  source?: 'ON-DEVICE' | 'PLUGIN';
  /** If true, server is managed by the system and hidden from user-facing UI */
  hidden?: boolean;
  /** HTTP headers for sse/http transports (e.g. Authorization) */
  headers?: Record<string, string>;
  /**
   * Optional OAuth 2.0 configuration for HTTP/SSE servers.
   *
   * Most fields are optional. When the authorization server supports
   * Dynamic Client Registration (RFC 7591) the runtime can auto-register
   * a client and persist its credentials; if not, the user (or plugin
   * author) must provide `clientId` manually.
   */
  oauth?: {
    /**
     * Pre-registered OAuth client_id. Required when the authorization
     * server does not support Dynamic Client Registration.
     */
    clientId?: string;
    /**
     * OAuth client secret for confidential clients. Most public OAuth
     * apps registered for desktop tools are public clients (PKCE only)
     * and should leave this unset.
     */
    clientSecret?: string;
    /**
     * Override the local OAuth callback port. Defaults to the global
     * OpenKosmos OAuth callback port (33420). Set this only when the
     * provider's redirect URI is fixed to a specific port.
     */
    callbackPort?: number;
    /**
     * Direct URL to the OAuth authorization server metadata document.
     * When set, the runtime skips RFC 9728 protected-resource discovery
     * and fetches this URL directly. Useful for providers that do not
     * publish `/.well-known/oauth-protected-resource`.
     */
    authServerMetadataUrl?: string;
    /**
     * URL where the user can register a new OAuth app for this server.
     * Surfaced in the DCR-fallback dialog when the runtime cannot
     * auto-register a client. Plugin authors who know their server's
     * developer-portal URL should populate this so users see a one-click
     * jump-off button.
     */
    setupUrl?: string;
    /**
     * Step-by-step instructions for registering an OAuth app. Each entry
     * is rendered as a list item. Use `{redirectUri}` and `{serverName}`
     * placeholders that the dialog substitutes at render time.
     */
    setupInstructions?: string[];
  };
}

/**
 * User information from GitHub Copilot
 */
export interface GhcUser {
  /** User ID */
  id: string;
  /** GitHub username */
  login: string;
  /** User email address */
  email: string;
  /** User display name */
  name: string;
  /** User avatar URL */
  avatarUrl: string;
  /** GitHub Copilot plan type */
  copilotPlan: string;
}

/**
 * Authentication tokens for GitHub Copilot
 */
export interface GhcTokens {
  /** Refresh token */
  refresh: string;
  /** Access token */
  access: string;
  /** Token expiration timestamp */
  expires: number;
}

/**
 * Input/Output modalities supported by a model
 */
export interface ModelModalities {
  /** Supported input types */
  input: string[];
  /** Supported output types */
  output: string[];
}

/**
 * Model context and output limits
 */
export interface ModelLimit {
  /** Maximum context length */
  context: number;
  /** Maximum output length */
  output: number;
}

/**
 * Model configuration
 */
export interface ModelConfig {
  /** Model ID */
  id: string;
  /** Human-readable model name */
  name: string;
  /** Whether model supports attachments */
  attachment: boolean;
  /** Whether model supports reasoning */
  reasoning: boolean;
  /** Whether model supports temperature adjustment */
  temperature: boolean;
  /** Whether model supports tool calling */
  tool_call: boolean;
  /** Knowledge cutoff date */
  knowledge: string;
  /** Model release date */
  release_date: string;
  /** Last updated date */
  last_updated: string;
  /** Supported modalities */
  modalities: ModelModalities;
  /** Whether model has open weights */
  open_weights: boolean;
  /** Model limits */
  limit: ModelLimit;
}


export type SchedulerExecutionStatus = 'running' | 'completed' | 'failed';
export type ChatSessionReadStatus = 'read' | 'unread';

/**
 * ChatSession configuration (V2)
 */
export interface ChatSession {
 /** ChatSession ID, format: chatSession_YYYYMMDDHHMMSS_<deviceid>_<random> */
  chatSession_id: string;
  /** Last updated time */
  last_updated: string;
  /** ChatSession title */
  title: string;
  /** ID of the scheduler job that created this session, if any */
  schedulerJobId?: string;
  /** Execution status for scheduled sessions */
  schedulerExecutionStatus?: SchedulerExecutionStatus;
  /** Start time for scheduled execution */
  schedulerStartedAt?: string;
  /** Completion time for scheduled execution */
  schedulerCompletedAt?: string;
  /** Error summary when scheduled execution fails */
  schedulerError?: string;
  /** Read status for unread indicator */
  readStatus?: ChatSessionReadStatus;
  /** Whether the session is explicitly starred by the user */
  starred?: boolean;
  /** Timestamp of the latest star action */
  starredAt?: string;
  /** Session source; treated as a local session when not set */
  source?: { type: 'local' } | { type: 'remote'; channel: string } | null;
}

/**
 * Starred ChatSession lightweight index item persisted in profile.json.
 * Used by the sidebar to render starred sessions without scanning all chats.
 */
export interface StarredChatSessionIndexItem {
  /** Chat ID owning the session */
  chatId: string;
  /** ChatSession ID */
  chatSessionId: string;
  /** Session title snapshot */
  title: string;
  /** Session last updated timestamp snapshot */
  lastUpdated: string;
  /** Latest read status snapshot */
  readStatus?: ChatSessionReadStatus;
  /** Session source snapshot */
  source?: { type: 'local' } | { type: 'remote'; channel: string } | null;
  /** Agent display name snapshot */
  agentName: string;
  /** Agent emoji snapshot */
  agentEmoji?: string;
  /** Agent avatar snapshot */
  agentAvatar?: string;
  /** Agent source snapshot */
  agentSource?: 'ON-DEVICE' | 'EXTERNAL';
  /** Agent version snapshot */
  agentVersion?: string;
  /** Timestamp of the latest star action */
  starredAt: string;
}

/**
 * Agent MCP Server configuration (with selected tools)
 */
export interface AgentMcpServer {
  /** MCP server name */
  name: string;
  /** Selected tool list for the current agent */
  tools: string[];
}

export interface AgentKnowledge {
  /** Knowledge Base directory path, defaults to workspace/knowledge */
  knowledgeBase?: string;
}

/**
 * Quick Start configuration item
 */
export interface QuickStartItem {
  /** Quick start title */
  title: string;
  /** Image URL (optional) */
  image?: string;
  /** Description */
  description: string;
  /** Triggered prompt */
  prompt: string;
}

/**
 * Zero States configuration - Agent initial state display
 */
export interface ZeroStates {
  /** Welcome message */
  greeting?: string;
  /** Quick start items list */
  quick_starts?: QuickStartItem[];
}

/**
 * Default Zero States configuration
 */
export const DEFAULT_ZERO_STATES: ZeroStates = {
  greeting: "",
  quick_starts: []
};

/**
 * Chat Agent configuration (V2)
 */
export interface ChatAgent {
  /** Agent role */
  role: string;
  /** Agent emoji */
  emoji: string;
  /** Agent avatar URL */
  avatar?: string;
  /** Agent name */
  name: string;
  /** Model used */
  model: string;
  /** Auth token for external agent WebSocket authentication */
  authToken?: string;
  /** Working directory path */
  workspace?: string;
  /** Unified knowledge configuration persisted in profile.json */
  knowledge?: AgentKnowledge;
  /** @deprecated Use knowledge.knowledgeBase */
  knowledgeBase?: string;
  /** Agent version */
  version?: string;
  /** Agent source: ON-DEVICE (from local machine) or EXTERNAL (remote agent via WebSocket) */
  source?: 'ON-DEVICE' | 'EXTERNAL';
  /** Agent-specific MCP server list (new structure: includes tool selection) */
  mcp_servers: AgentMcpServer[];
  /** System prompt */
  system_prompt: string;
  /**
   * Per-chat reasoning effort selected by the user.
   * Only meaningful for models whose capabilities expose `reasoning_effort`.
   * Stored canonicalized to lowercase (e.g. `low`, `medium`, `high`,
   * `minimal`, future tiers). `undefined` means "do not send a
   * reasoning_effort parameter".
   */
  reasoningEffort?: string;
  /** Context Enhancement configuration */
  context_enhancement?: Record<string, unknown>;
  skills?: string[];
  /** Plugin IDs enabled for this Agent — when enabled, plugin skills/MCP are auto-added */
  enabled_plugins?: string[];
  /** Sub-agent name list referenced by the Agent */
  sub_agents?: string[];
  /** Zero States configuration - Agent initial state display */
  zero_states?: ZeroStates;
}

/**
 * A Teams chat connected to an agent for briefing purposes.
 */
export interface AgentTeamsChat {
  chatId: string;
  display: string;
  chatType: string;
  topic: string;
}

/**
 * Chat configuration (V2) - persisted configuration
 */
export interface ChatConfig {
  /** Chat ID, format: chat_YYYYMMDDHHMMSS_<deviceid>_<random> */
  chat_id: string;
  /** Chat type */
  chat_type: 'single_agent' | 'multi_agent';
  /** Single agent configuration (when chat_type is single_agent) */
  agent?: ChatAgent;
  /** Multi-agent configuration (when chat_type is multi_agent) */
  agents?: ChatAgent[];
  /** Chat-level resolved skill snapshot, refreshed lazily at next-turn boundary */
  skill_snapshot?: ChatSkillSnapshot;
}

/**
 * Chat runtime configuration - includes dynamically loaded chatSessions
 * Used for frontend display and in-memory operations, chatSessions are not persisted to profile.json
 */
export interface ChatConfigRuntime extends ChatConfig {
  /** ChatSession list (dynamically loaded at runtime, not persisted) */
  chatSessions?: ChatSession[];
}

/**
 * Browser Control settings configuration
 */
export interface BrowserControlSettings {
  /** Browser type */
  browser: 'chrome' | 'edge';
  /** Control mode */
  mode?: 'extension' | 'cdp';
}

/**
 * DevTools MCP (Browser Control CDP) settings configuration
 */
export interface DevToolsMcpSettings {
  /** Browser type */
  browser: 'chrome' | 'edge';
}

// ═══════════════════════════════════════════


export interface InlineEditRegenerateConfirmationSettings {
  /** Skip the confirmation dialog when regenerating from an edited message */
  skipConfirmation: boolean;
}

export interface ConfirmationSettings {
  /** Confirmation preference for inline edit regenerate flow */
  inlineEditRegenerate: InlineEditRegenerateConfirmationSettings;
}

/**
 * Profile V2 configuration interface (current)
 */
export interface ProfileV2 {
  /** Profile version */
  version: string;
  /** Created time */
  createdAt: string;
  /** Updated time */
  updatedAt: string;
  /** User alias */
  alias: string;
  /** Whether First Run Experience is completed */
  freDone?: boolean;
  /** Primary Agent, displayed first in AgentChatList and used as the default Agent on app startup. Defaults to Kobi */
  primaryAgent?: string;
  /** MCP server configuration */
  mcp_servers: McpServerConfig[];
  /** Skills configuration list */
  skills?: SkillConfig[];
  /**
   * Sub-Agent lightweight index (after file-based refactoring)
   * Full configuration is stored in agents/{name}/AGENT.md files,
   * only name/version/source are kept here for ProfileCacheManager notification.
   *
   * Compatibility: before migration this field may still be SubAgentConfig[] (old format),
   * SubAgentMigration will automatically convert to SubAgentIndex[] on startup.
   */
  sub_agents?: SubAgentIndex[] | SubAgentConfig[];
  /** Chat configuration */
  chats: ChatConfig[];
  /** Profile-level starred session index for sidebar rendering */
  'starred-chat-sessions'?: StarredChatSessionIndexItem[];
  /** Voice Input settings configuration */
  voiceInputSettings?: VoiceInputSettings;
  /** Browser Control settings configuration */
  browserControl?: BrowserControlSettings;
  /** DevTools MCP (Browser Control CDP) settings configuration */
  devToolsMcpSettings?: DevToolsMcpSettings;
  /**
   * Migration markers
   * Records completed one-time data migrations to prevent re-execution.
   * sanitizeProfileV2 preserves this field but does not actively clean it up.
   */
  _migrationFlags?: Record<string, boolean>;
  /** Confirmation dialog preferences */
  confirmationSettings?: ConfirmationSettings;
  /** Built-in defaults migration version. Tracks which version of built-in tools/skills has been applied to existing agents. */
  builtinDefaultsVersion?: number;
  /** Profile data migration version. Tracks which one-time migrations have been applied. */
  profileMigrationVersion?: number;
}

/**
 * Profile type definitions
 */
export type Profile = ProfileV2;

/**
 * Version detection type guard
 */
export function isProfileV2(profile: any): profile is ProfileV2 {
  return (
    profile &&
    typeof profile === 'object' &&
    'alias' in profile &&              // V2 specific field
    'chats' in profile &&              // V2 specific field
    !('authProvider' in profile) &&    // V1 field does not exist
    !('ghcAuth' in profile) &&         // V1 field does not exist
    typeof profile.alias === 'string' &&
    Array.isArray(profile.chats)
  );
}


/**
 * Generic version detector
 */
export function detectProfileVersion(profile: any): 'v2' | 'unknown' {
  if (isProfileV2(profile)) {
    return 'v2';
  } else {
    return 'unknown';
  }
}

/**
 * Type guard to check if an object is a valid Profile (legacy)
 */
export function isProfile(obj: any): obj is Profile {
  return isProfileV2(obj);
}

/**
 * Type guard to check if an object is a valid MCP Server Config
 */
export function isMcpServerConfig(obj: any): obj is McpServerConfig {
  return (
    obj &&
    typeof obj.name === 'string' &&
    typeof obj.transport === 'string' &&
    ['stdio', 'sse', 'StreamableHttp'].includes(obj.transport) &&
    typeof obj.command === 'string' &&
    Array.isArray(obj.args) &&
    typeof obj.env === 'object' &&
    typeof obj.url === 'string' &&
    typeof obj.in_use === 'boolean'
  );
}



/**
 * Default Chat Agent configuration
 */
export const DEFAULT_CHAT_AGENT: ChatAgent = {
  role: "Default Assistant",
  emoji: "🐬",
  avatar: "",
  name: "Kobi",
  model: DEFAULT_MODEL_ID,
  version: "1.0.0",
  source: "ON-DEVICE",
  knowledge: {
    knowledgeBase: "",
  },
  mcp_servers: [
    {
      name: "builtin-tools",
      tools: []  // Empty array means use all tools from the server
    }
  ],
  system_prompt: "You are a highly capable AI assistant designed to help users with a wide variety of tasks. Your core capabilities include:\n\n**Communication & Analysis:**\n- Provide clear, accurate, and helpful responses to questions\n- Analyze complex problems and break them down into manageable parts\n- Adapt your communication style to match the user's needs and expertise level\n\n**Technical Assistance:**\n- Help with programming, debugging, and code review across multiple languages\n- Assist with data analysis, research, and information synthesis\n- Provide guidance on best practices and technical decision-making\n\n**Creative & Productive Support:**\n- Generate creative content including writing, brainstorming, and ideation\n- Help with planning, organization, and project management\n- Assist with document creation, editing, and formatting\n\n**Interaction Guidelines:**\n- Always strive for accuracy and cite sources when appropriate\n- Ask clarifying questions when requirements are unclear\n- Provide step-by-step explanations for complex procedures\n- Respect user privacy and maintain confidentiality\n- Be honest about limitations and uncertainties\n\n**Tools & Integration:**\n- Leverage available MCP servers and tools to enhance capabilities\n- Use web browsing, file operations, and data processing tools when beneficial\n- Integrate multiple information sources to provide comprehensive responses\n\nYour goal is to be a reliable, knowledgeable, and adaptable assistant that helps users accomplish their objectives efficiently and effectively.",
  skills: ['skill-creator'],
  zero_states: DEFAULT_ZERO_STATES
};

export function getAgentKnowledge(agent?: ChatAgent | null): AgentKnowledge {
  if (!agent) {
    return {
      knowledgeBase: '',
    };
  }

  return {
    knowledgeBase: agent.knowledge?.knowledgeBase ?? agent.knowledgeBase ?? '',
  };
}

export function withNormalizedAgentKnowledge(agent: ChatAgent): ChatAgent {
  const {
    knowledgeBase: _legacyKnowledgeBase,
    teams_enabled: _legacyTeamsEnabled,
    teams_chats: _legacyTeamsChats,
    outlook_emails_enabled: _legacyOutlookEmailsEnabled,
    ...normalizedAgent
  } = agent as ChatAgent & {
    knowledgeBase?: string;
    teams_enabled?: unknown;
    teams_chats?: unknown;
    outlook_emails_enabled?: unknown;
  };

  return {
    ...normalizedAgent,
    knowledge: getAgentKnowledge(agent),
  };
}

/**
 * Default Profile V2 configuration
 */
export const DEFAULT_PROFILE_V2: Partial<ProfileV2> = {
  version: "2.0.0",
  freDone: false,
  primaryAgent: "Kobi",
  mcp_servers: [],
  'starred-chat-sessions': [],
  confirmationSettings: {
    inlineEditRegenerate: {
      skipConfirmation: false,
    },
  },
  builtinDefaultsVersion: BUILTIN_DEFAULTS_VERSION,
  profileMigrationVersion: 2,
  chats: []
};


/**
 * Default MCP server configuration
 */
export const DEFAULT_MCP_SERVER: McpServerConfig = {
  name: "",
  transport: "stdio",
  command: "",
  args: [],
  env: {},
  url: "",
  in_use: true,
  version: "1.0.0",
  source: "ON-DEVICE"
};

/**
 * Default Browser Control configuration
 */
export const DEFAULT_BROWSER_CONTROL_SETTINGS: BrowserControlSettings = {
  browser: 'edge',
  mode: 'extension'
};

/**
 * Default DevTools MCP (Browser Control CDP) settings configuration
 */
export const DEFAULT_DEVTOOLS_MCP_SETTINGS: DevToolsMcpSettings = {
  browser: 'edge'
};

export const DEFAULT_CONFIRMATION_SETTINGS: ConfirmationSettings = {
  inlineEditRegenerate: {
    skipConfirmation: false,
  },
};

/**
 * Whisper model size options
 */
export type WhisperModelSize = 'tiny' | 'base' | 'small' | 'medium' | 'turbo';

/**
 * Whisper model information
 */
export interface WhisperModelInfo {
  /** Model size identifier */
  size: WhisperModelSize;
  /** Model file name */
  fileName: string;
  /** Model file size in bytes */
  fileSize: number;
  /** Human-readable file size */
  fileSizeDisplay: string;
  /** Download URL */
  downloadUrl: string;
  /** Description */
  description: string;
}

/**
 * Voice Input Settings configuration
 */
export interface VoiceInputSettings {
  /** Whisper model size to use for voice input */
  whisperModel: WhisperModelSize;
  /** Language for speech recognition: 'auto' for auto-detect or specific language code */
  language: string;
  /** Enable GPU acceleration (Vulkan on Windows/Linux, Metal on macOS) */
  useGPU?: boolean;
  /** Enable translation to English (only available for 'small', 'medium', and 'turbo' models) */
  translate?: boolean;
}

/**
 * Default Voice Input Settings
 */
export const DEFAULT_VOICE_INPUT_SETTINGS: VoiceInputSettings = {
  whisperModel: 'base',
  language: 'auto',
  useGPU: false,
  translate: false
};

/**
 * Whisper model definitions with download URLs and metadata
 */
export const WHISPER_MODELS: Record<WhisperModelSize, WhisperModelInfo> = {
  tiny: {
    size: 'tiny',
    fileName: 'ggml-tiny.bin',
    fileSize: 75_000_000,
    fileSizeDisplay: '75 MB',
    downloadUrl: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin',
    description: 'Fast, good accuracy'
  },
  base: {
    size: 'base',
    fileName: 'ggml-base.bin',
    fileSize: 142_000_000,
    fileSizeDisplay: '142 MB',
    downloadUrl: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin',
    description: 'Balanced (Recommended)'
  },
  small: {
    size: 'small',
    fileName: 'ggml-small-q8_0.bin',
    fileSize: 264_000_000,
    fileSizeDisplay: '264 MB',
    downloadUrl: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q8_0.bin',
    description: 'Better accuracy'
  },
  medium: {
    size: 'medium',
    fileName: 'ggml-medium-q5_0.bin',
    fileSize: 539_000_000,
    fileSizeDisplay: '539 MB',
    downloadUrl: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium-q5_0.bin',
    description: 'Best accuracy'
  },
  turbo: {
    size: 'turbo',
    fileName: 'ggml-large-v3-turbo-q5_0.bin',
    fileSize: 574_000_000,
    fileSizeDisplay: '574 MB',
    downloadUrl: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin',
    description: 'Best accuracy'
  }
};

/**
 * Built-in Agent name constants
 * The built-in agents list for openkosmos branding:
 * - openkosmos: Kobi only
 *
 * ===== Built-in Agents System =====
 *
 * Built-in agents are system-preset agents with the following characteristics:
 * 1. 🏷️ Displayed with a "Built-in" badge
 * 2. 📍 Pinned below the navigation bar Divider (higher position priority than primaryAgent)
 * 3. 🔒 Cannot be deleted (delete button hidden in frontend + backend protection)
 *
 * ===== Branding Configuration =====
 *
 * | Branding   | Built-in Agents     | Kobi Visibility Rules                     |
 * |------------|---------------------|------------------------------------------|
 * | openkosmos     | Kobi                | Always visible                            |
 */

/** Built-in agent list for openkosmos branding (Kobi only) */
export const BUILTIN_AGENT_NAMES_OpenKosmos: string[] = ['Kobi'];

/**
 * Get the built-in agent name list.
 * Always returns the openkosmos list (Kobi only).
 */
export function getBuiltinAgentNames(brandName?: string): string[] {
  return BUILTIN_AGENT_NAMES_OpenKosmos;
}

/**
 * Check whether the specified agent is a built-in agent.
 *
 * @param agentName agent name (case-insensitive)
 * @param brandName unused — kept for call-site compatibility
 * @returns true if it is a built-in agent, false otherwise
 *
 * @example
 * isBuiltinAgent('Kobi')  // true
 * isBuiltinAgent('Custom Agent')  // false
 */
export function isBuiltinAgent(agentName: string | undefined | null, brandName?: string): boolean {
  if (!agentName) return false;
  const builtinNames = getBuiltinAgentNames();
  return builtinNames.some(
    name => name.toLowerCase() === agentName.toLowerCase()
  );
}

/**
 * ChatSession utility functions
 */
export class ChatSessionUtils {
  /**
   * Generate ChatSession ID
   */
  static generateChatSessionId(): string {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { generateChatSessionId } = require('../../utilities/idFactory') as typeof import('../../utilities/idFactory');
    return generateChatSessionId();
  }

  /**
   * Create default ChatSession
   */
  static createDefaultChatSession(title: string = "New ChatSession"): ChatSession {
    return {
      chatSession_id: this.generateChatSessionId(),
      last_updated: new Date().toISOString(),
      title: title,
      readStatus: 'unread'
    };
  }

  /**
   * Validate ChatSession object
   */
  static isValidChatSession(obj: any): obj is ChatSession {
    return (
      obj &&
      typeof obj === 'object' &&
      typeof obj.chatSession_id === 'string' &&
      typeof obj.last_updated === 'string' &&
      typeof obj.title === 'string' &&
      (obj.readStatus === undefined || obj.readStatus === 'read' || obj.readStatus === 'unread') &&
      obj.chatSession_id.startsWith('chatSession_')
    );
  }

  /**
   * Clean and validate ChatSession array
   */
  static sanitizeChatSessions(chatSessions: any[]): ChatSession[] {
    if (!Array.isArray(chatSessions)) {
      return [];
    }

    return chatSessions
      .filter(chatSession => this.isValidChatSession(chatSession))
      .map(chatSession => ({
        chatSession_id: chatSession.chatSession_id,
        last_updated: chatSession.last_updated,
        title: chatSession.title || "Untitled ChatSession",
        readStatus: chatSession.readStatus === 'read' ? 'read' : 'unread',
        source: chatSession.source ? {...chatSession.source} : undefined,
      }));
  }
}

/**
 * Default ChatSession configuration
 */
export const DEFAULT_CHAT_SESSION: ChatSession = {
  chatSession_id: 'chatSession_20250101000000_example-device_abcdef123',
  last_updated: new Date().toISOString(),
  title: "Default ChatSession",
  readStatus: 'unread'
};
