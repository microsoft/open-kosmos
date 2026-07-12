/**
 * Type definitions for Profile configuration V2
 */

import { BUILTIN_DEFAULTS_VERSION } from '../../../../shared/constants/builtinSkills';
import { buildChatSessionId } from '../../../../shared/utils/idFormats';
import { createDefaultAgentSystemPrompt, normalizeAgentSystemPrompt, type AgentSystemPrompt } from '../../../../shared/types/agentSystemPrompt';
import type { HookDefinition } from '../../../../shared/agentHooks/profileTypes';
export type { AgentHookEvent, CommandHookAction, HookAction, HookDefinition, HttpHookAction, HttpHookMethod } from '../../../../shared/agentHooks/profileTypes';
import type { CodingCliId } from '../../../../shared/types/codingCli';
export type { CodingCliId } from '../../../../shared/types/codingCli';

/** Default model ID — consistent with GhcModelsManager.getDefaultModel() */
const DEFAULT_MODEL_ID = 'claude-opus-4.6';

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
  /** Inert legacy version metadata retained for persisted-profile compatibility */
  remoteVersion?: string;
  /** Legacy Skill origin metadata retained for persisted profile compatibility. */
  source: 'IN-LIBRARY' | 'ON-DEVICE';
}

/** Schema version of the standalone skills.json file */
export const SKILLS_FILE_VERSION = '2.0.0';

/**
 * Standalone skills file (`skills.json`) — the global skill registry, persisted
 * separately from `profile.json`. `ProfileV2.skills` is hydrated from this file
 * at load time and is NOT written back into `profile.json`.
 */
export interface SkillsFileV2 {
  /** Schema version */
  version: string;
  /** Last updated timestamp */
  updatedAt: string;
  /** Global skill registry */
  skills: SkillConfig[];
}

/** Schema version of the standalone hooks.json file */
export const HOOKS_FILE_VERSION = '1.0.0';

/**
 * Standalone hooks file (`hooks.json`) — the global Agent Hook library, persisted
 * separately from `profile.json`. `ProfileV2.hooks` is hydrated from this file at
 * load time and is NOT written back into `profile.json`.
 *
 * NOTE: only the hook *list* moves to this file. The Hooks master switch
 * (`ProfileV2.hooksEnabled`) intentionally stays in `profile.json`.
 */
export interface HooksFileV2 {
  /** Schema version */
  version: string;
  /** Last updated timestamp */
  updatedAt: string;
  /** Global Agent Hook library */
  hooks: HookDefinition[];
}

/**
 * Chat-level resolved Skill snapshot item.
 * In-memory only (held by ChatSkillSnapshotStore); never persisted to disk.
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
 * Chat-level Skill snapshot used by AgentChat at turn boundaries.
 * In-memory only (held by ChatSkillSnapshotStore); never persisted to disk.
 * Rebuilt lazily on the next turn after a cold cache or binding/registry change.
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
  /** Missing skill names referenced by the agent but not found in the installed skill registry */
  missing_skill_names?: string[];
  /** Prebuilt prompt text consumed by AgentChat */
  prompt: string;
}

/**
 * Sub-Agent configuration consumed by the ad-hoc runtime.
 * Ad-hoc sub-agents are spawned inline by the LLM via the `sub_agent` tool;
 * their config is built synthetically in-memory and never persisted to disk.
 */
export interface SubAgentConfig {
  /** Unique identifier and display name */
  name: string;
  /** Description of the sub-agent's purpose */
  description: string;
  /** Model selection: specific model name or 'inherit' (default: inherit) */
  model?: string;
  /** Sub-agent built-in tool whitelist (e.g., read_file, execute_command) (empty array = no restriction) */
  builtin_tools?: string[];
  /** Sub-agent disallowed built-in tool blacklist (excluded from available built-in tools at runtime) */
  disallow_builtin_tools?: string[];
  /** Sub-agent system prompt */
  system_prompt: string;
  /** Inline MCP server configuration */
  mcp_servers?: AgentMcpServer[];
}


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
 * Default system prompt for ad-hoc sub-agents (created inline at spawn time).
 * Kept intentionally generic so the LLM can specialize via the task description.
 */
export const DEFAULT_ADHOC_SYSTEM_PROMPT =
  `You are a focused task worker. Complete the assigned task efficiently using the available tools. ` +
  `Report your findings clearly and concisely. Do not ask clarifying questions — work with what you have. ` +
  `If you create files, mention the full file paths in your response.`;

/**
 * Sub-agent task execution result
 * Returned by SubAgentManager.spawnAdhocSubAgent(), contains complete task execution information
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
  /** Inert legacy version metadata retained for persisted profile compatibility. */
  remoteVersion?: string;
  /** Legacy MCP origin metadata retained for persisted profile compatibility. */
  source?: 'IN-LIBRARY' | 'ON-DEVICE';
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
  /** Agent display name snapshot */
  agentName: string;
  /** Agent emoji snapshot */
  agentEmoji?: string;
  /** Agent avatar snapshot */
  agentAvatar?: string;
  /** Agent source snapshot */
  agentSource?: 'IN-LIBRARY' | 'ON-DEVICE' | 'EXTERNAL';
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
  /** Knowledge Base directory path, defaults to agents/{id}/knowledge */
  knowledgeBase?: string;
}

/**
 * Quick Start configuration item
 */
export interface QuickStartItem {
  /** Stable identifier for persisted card references (8-char hex, auto-generated) */
  id?: string;
  /** Quick start title */
  title: string;
  /** Image source (optional): remote http(s) URL, local absolute path, or file:// URL */
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
  /**
   * Stable agent id (UUID-style `agent_{timestamp}_{random}`), minted once at
   * creation and carried so a rename never changes it. Legacy inline agents that
   * predate the standalone store have no id and fall back to the name-derived
   * `buildAgentId`. The standalone store's `AgentConfig` requires this field;
   * here it is optional so pre-store profiles still type-check.
   */
  id?: string;
  /** Agent role */
  role: string;
  /** Agent emoji */
  emoji: string;
  /** Inert legacy avatar metadata retained for persisted-profile compatibility */
  avatar?: string;
  /** Agent name */
  name: string;
  /** Model used */
  model: string;
  /** Auth token for external agent WebSocket authentication */
  authToken?: string;
  /**
   * @deprecated Workspace is chat-owned and derived from `chat_id` after the
   * Agent/Chat separation. This optional field remains only so legacy inline
   * agents can be migrated safely.
   */
  workspace?: string;
  /** Unified knowledge configuration persisted in profile.json */
  knowledge?: AgentKnowledge;
  /** @deprecated Use knowledge.knowledgeBase */
  knowledgeBase?: string;
  /** Agent version */
  version?: string;
  /** Inert legacy version metadata retained for persisted-profile compatibility */
  remoteVersion?: string;
  /** Agent origin metadata; IN-LIBRARY is a legacy persisted value with no remote behavior. */
  source?: 'IN-LIBRARY' | 'ON-DEVICE' | 'EXTERNAL';
  /** Agent-specific MCP server list (new structure: includes tool selection) */
  mcp_servers: AgentMcpServer[];
  /** System prompt files, stored as a filename-to-content map. */
  system_prompt: AgentSystemPrompt;
  /**
   * Per-chat reasoning effort selected by the user.
   * Only meaningful for models whose capabilities expose `reasoning_effort`.
   * Stored canonicalized to lowercase (e.g. `low`, `medium`, `high`,
   * `minimal`, future tiers). `undefined` means "do not send a
   * reasoning_effort parameter".
   */
  reasoningEffort?: string;
  /** Skills name list used by the Agent */
  skills?: string[];
  /** Agent Hook ids bound to this Agent (mirrors skills/mcp_servers selection) */
  hooks?: string[];
  /** Zero States configuration - Agent initial state display */
  zero_states?: ZeroStates;
}

/**
 * Chat configuration (V2) - persisted configuration
 */
export interface ChatConfig {
  /** Chat ID, format: chat_YYYYMMDDHHMMSS_<deviceid>_<random> */
  chat_id: string;
  /** Chat type */
  chat_type: 'single_agent' | 'multi_agent';
  /** Runtime-only chat workspace path derived from alias + chat_id; not persisted in profile.json. */
  workspace?: string;
  /** Single agent configuration (when chat_type is single_agent) */
  agent?: ChatAgent;
  /** Multi-agent configuration (when chat_type is multi_agent) */
  agents?: ChatAgent[];
  /**
   * Target mapping (1 Chat : N Agents): agent ids owned by this chat, length ≥ 1.
   * Additive during migration — once standalone agents land, chats reference
   * agents by id here and the inline `agent`/`agents` fields are removed.
   */
  agent_ids?: string[];
}

/**
 * One archived chat. Archiving removes the chat from {@link ProfileV2.chats} and
 * records it here (in `profile.json`), referencing its agents by id (resolved
 * from the standalone agent store) rather than inlining the agent config. This
 * is the SSOT for the archive list and replaces the former standalone
 * `agents/archived_chats.json` file. Workspace dirs and chat sessions are keyed
 * by `chat_id` and preserved on disk so the chat can be restored intact; the
 * workspace path itself is derived at runtime and is not persisted here.
 */
export interface ArchivedChatEntry {
  /** ISO timestamp when the chat was archived. */
  archived_at?: string;
  /** The archived chat's id; its workspace + sessions live under this id. */
  chat_id: string;
  /** @deprecated Runtime-only compatibility field; archived chat workspaces are derived from chat_id. */
  workspace?: string;
  /** Chat type captured at archive time. */
  chat_type?: ChatConfig['chat_type'];
  /** Agent ids the chat owned, resolved against the standalone agent store. */
  agent_ids: string[];
  /** Starred sessions captured at archive time, restored on unarchive. */
  starred_sessions?: StarredChatSessionIndexItem[];
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
 * Profile-level Embedded Browser configuration (stored in profile.json).
 * Per-profile feature switch.
 *
 * Controls both:
 * 1. Availability of the agent-facing `browser` built-in tool, and
 * 2. Visibility of the Browser entry (Globe button) in the ChatView header.
 */
export interface BrowserSettings {
  /** Master switch: whether the embedded browser tool + header entry are enabled */
  enabled: boolean;
}

/**
 * Profile-level Memex Memory configuration (stored in profile.json).
 * Per-profile feature switch.
 *
 * Controls both:
 * 1. Availability of the agent-facing `memex_memory` built-in tool, and
 * 2. Visibility of the Agent Memory entry (Brain button) in the ChatView header.
 */
export interface MemexSettings {
  /** Master switch: whether the memex_memory tool + header entry are enabled */
  enabled: boolean;
}

/**
 * Profile-level Computer Use configuration (stored in profile.json).
 * Per-profile feature switch for the agent-facing `computer_use` built-in tool,
 * which drives the real local desktop (screenshots + synthetic mouse/keyboard on
 * native apps). Off by default; safety comes from this switch, OS permissions,
 * default confirmation, and the per-app allowlist rather than sandbox isolation.
 */
export interface ComputerUseSettings {
  /** Any-App master switch: whether the computer_use tool is enabled. Default false. */
  enabled: boolean;
  /**
   * Bundle ids / process names whose ordinary (non high-impact) actions skip the
   * per-action confirmation requirement. The high-impact guard is never bypassed.
   */
  alwaysAllowedApps: string[];
  /**
   * When true (default), mutating actions in apps that are not always-allowed
   * require explicit user confirmation before input is dispatched.
   */
  requireConfirmation: boolean;
}

/**
 * DevTools MCP settings configuration
 */
export interface DevToolsMcpSettings {
  /** Browser type */
  browser: 'chrome' | 'edge';
}

/**
 * Coding Agent settings configuration (profile-level).
 * Selects which coding-agent CLI the `coding_agent` built-in tool drives.
 */
export interface CodingAgentSettings {
  /**
   * Master switch for the coding_agent built-in tool. When false the tool is neither
   * advertised to the model nor runnable, and the Settings page hides CLI selection.
   * Defaults to false.
   */
  enabled: boolean;
  /** Default coding CLI used by the coding_agent built-in tool. */
  cli: CodingCliId;
}

/**
 * Sync settings configuration
 */
export interface SyncSettings {
  /** Whether sync is enabled */
  enabled: boolean;
  /** GitHub repository URL */
  repoUrl: string;
  /** Last sync timestamp */
  lastSyncTime: string | null;
}

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
  /** Primary chat id — the chat displayed first in AgentChatList and selected as the default on app startup. Empty/unset falls back to the first chat. */
  primaryChat?: string;
  /**
   * Installed global MCP server configs (transient, DEPRECATED for direct use).
   *
   * @deprecated Installed MCP server configs are owned by `McpConfigManager` and persisted in
   * `mcp.json`, decoupled from `profile.json`. This field is populated only transiently
   * during the profile load/migration window (so legacy migrations can inspect it) and is
   * stripped from the cached profile before it is handed to consumers. Runtime reads MUST go
   * through `mcpConfigManager.getServers(alias)` — do NOT read or write this field directly.
   */
  mcp_servers?: McpServerConfig[];
  /**
   * Global skill registry — the user's installed/registered skills (transient,
   * DEPRECATED for direct use). It contains local configuration only.
   *
   * @deprecated The skill registry is owned by `SkillsConfigManager` and persisted in
   * `skills.json` (see {@link SkillsFileV2}), decoupled from `profile.json`. This field is
   * populated only transiently during the profile load/migration window (so legacy
   * migrations can inspect it) and is stripped from the cached profile before it is handed
   * to consumers. Runtime reads MUST go through `skillsConfigManager.getSkills(alias)` — do
   * NOT read or write this field directly.
   */
  skills?: SkillConfig[];
  /**
   * Agent Hooks library (profile-level resource, like mcp_servers and skills) —
   * the user's installed/created global hooks (transient, DEPRECATED for direct use).
   * Resolved into effective Hooks per Agent at runtime via direct/indirect bindings.
   *
   * @deprecated The hook library is owned by `HooksConfigManager` and persisted in
   * `hooks.json` (see {@link HooksFileV2}), decoupled from `profile.json`. This field is
   * populated only transiently during the profile load/migration window (so legacy
   * migrations can inspect it) and is stripped from the cached profile before it is handed
   * to consumers. Runtime reads MUST go through `hooksConfigManager.getHooks(alias)` — do
   * NOT read or write this field directly. The Hooks master switch (`hooksEnabled`) is the
   * exception: it stays in `profile.json` and is NOT moved to `hooks.json`.
   */
  hooks?: HookDefinition[];
  /**
   * Profile-level master switch for Hooks runtime execution and management UI.
   * Defaults to false. Persisted in `profile.json` (NOT in `hooks.json`).
   */
  hooksEnabled?: boolean;
  /** Chat configuration */
  chats: ChatConfig[];
  /**
   * Archived chats (removed from {@link chats}), each referencing its agents by
   * id. SSOT for the archive list; replaces the standalone
   * `agents/archived_chats.json`. Omitted when nothing is archived.
   */
  archived_chats?: ArchivedChatEntry[];
  /** Profile-level starred session index for sidebar rendering */
  'starred-chat-sessions'?: StarredChatSessionIndexItem[];
  /** Voice Input settings configuration */
  voiceInputSettings?: VoiceInputSettings;
  /** Embedded Browser feature switch (per-profile). Controls the agent `browser` tool and the header Browser entry. */
  browser?: BrowserSettings;
  /** Memex Memory feature switch (per-profile). Controls the agent `memex_memory` tool and the header Agent Memory entry. */
  memex?: MemexSettings;
  /** Computer Use feature switch (per-profile). Controls the agent `computer_use` tool that drives the native desktop. */
  computerUse?: ComputerUseSettings;
  /** DevTools MCP settings configuration */
  devToolsMcpSettings?: DevToolsMcpSettings;
  /** Coding Agent settings configuration (selected coding-agent CLI) */
  codingAgentSettings?: CodingAgentSettings;
  /**
   * Migration markers
   * Records completed one-time data migrations to prevent re-execution.
   * sanitizeProfileV2 preserves this field but does not actively clean it up.
   */
  _migrationFlags?: Record<string, boolean>;
  /** Sync settings configuration */
  syncSettings?: SyncSettings;
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
  system_prompt: normalizeAgentSystemPrompt("You are a highly capable AI assistant designed to help users with a wide variety of tasks. Your core capabilities include:\n\n**Communication & Analysis:**\n- Provide clear, accurate, and helpful responses to questions\n- Analyze complex problems and break them down into manageable parts\n- Adapt your communication style to match the user's needs and expertise level\n\n**Technical Assistance:**\n- Help with programming, debugging, and code review across multiple languages\n- Assist with data analysis, research, and information synthesis\n- Provide guidance on best practices and technical decision-making\n\n**Creative & Productive Support:**\n- Generate creative content including writing, brainstorming, and ideation\n- Help with planning, organization, and project management\n- Assist with document creation, editing, and formatting\n\n**Interaction Guidelines:**\n- Always strive for accuracy and cite sources when appropriate\n- Ask clarifying questions when requirements are unclear\n- Provide step-by-step explanations for complex procedures\n- Respect user privacy and maintain confidentiality\n- Be honest about limitations and uncertainties\n\n**Tools & Integration:**\n- Leverage available MCP servers and tools to enhance capabilities\n- Use web browsing, file operations, and data processing tools when beneficial\n- Integrate multiple information sources to provide comprehensive responses\n\nYour goal is to be a reliable, knowledgeable, and adaptable assistant that helps users accomplish their objectives efficiently and effectively."),
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

export { createDefaultAgentSystemPrompt, normalizeAgentSystemPrompt, type AgentSystemPrompt };

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
 * Default DevTools MCP settings configuration
 */
export const DEFAULT_DEVTOOLS_MCP_SETTINGS: DevToolsMcpSettings = {
  browser: 'edge'
};

/**
 * Default Coding Agent settings configuration.
 * The feature is off by default (the user opts in from Settings → Coding CLI); the
 * default CLI is Claude Code, preserving the original single-CLI behavior once enabled.
 */
export const DEFAULT_CODING_AGENT_SETTINGS: CodingAgentSettings = {
  enabled: false,
  cli: 'claude'
};

/**
 * Default Sync settings configuration
 */
export const DEFAULT_SYNC_SETTINGS: SyncSettings = {
  enabled: false,
  repoUrl: '',
  lastSyncTime: null,
};

export const DEFAULT_CONFIRMATION_SETTINGS: ConfirmationSettings = {
  inlineEditRegenerate: {
    skipConfirmation: false,
  },
};

/**
 * Default Embedded Browser settings (per-profile, disabled by default)
 */
export const DEFAULT_BROWSER_SETTINGS: BrowserSettings = {
  enabled: false,
};

/**
 * Default Memex Memory settings (per-profile, disabled by default)
 */
export const DEFAULT_MEMEX_SETTINGS: MemexSettings = {
  enabled: false,
};

/**
 * Default Computer Use settings (per-profile, disabled by default). When the
 * feature is enabled the agent can drive the real desktop; mutating actions
 * still require confirmation unless the target app is always-allowed.
 */
export const DEFAULT_COMPUTER_USE_SETTINGS: ComputerUseSettings = {
  enabled: false,
  alwaysAllowedApps: [],
  requireConfirmation: true,
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

/** Built-in system agents that are pinned and protected from deletion. */
export const BUILTIN_AGENT_NAMES_OpenKosmos: string[] = ['Kobi'];

/**
 * Get the built-in agent name list.
 */
export function getBuiltinAgentNames(_brandName?: string): string[] {
  return BUILTIN_AGENT_NAMES_OpenKosmos;
}

/**
 * Check whether the specified agent is a built-in agent.
 *
 * @param agentName agent name (case-insensitive)
 * @param _brandName retained for compatibility with existing call sites
 * @returns true if it is a built-in agent, false otherwise
 *
 * @example
 * isBuiltinAgent('Kobi')          // true
 * isBuiltinAgent('Custom Agent')  // false
 */
export function isBuiltinAgent(agentName: string | undefined | null, _brandName?: string): boolean {
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
   * Uses renderer-safe entropy instead of the main-process device ID generator,
   * because this shared profile type module is imported by renderer bundles.
   */
  static generateChatSessionId(): string {
    const cryptoApi = globalThis.crypto;
    const deviceId = cryptoApi?.randomUUID?.() || Math.random().toString(36).slice(2);
    return buildChatSessionId(deviceId);
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
