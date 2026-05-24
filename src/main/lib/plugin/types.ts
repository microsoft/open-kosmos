/**
 * Core types for the OpenKosmos Plugin System.
 *
 * Compatible with the Claude Code plugin format:
 *   - Manifest at `.claude-plugin/plugin.json` (fallback: root `plugin.json`)
 *   - Auto-discovered `skills/` directories containing SKILL.md
 *   - Auto-discovered `commands/*.md` and `agents/*.md`
 *   - External `hooks/hooks.json` with matcher support
 *   - External `.mcp.json` for MCP server declarations
 *
 * Plugin-provided resources are read-only from the user's perspective
 * and follow the plugin's install / uninstall lifecycle.
 */

// ---------------------------------------------------------------------------
// Manifest — what lives inside plugin.json
// ---------------------------------------------------------------------------

export interface PluginAuthor {
  name: string;
  email?: string;
  url?: string;
}

/** MCP server config as declared in manifest or .mcp.json. */
export interface PluginMcpServerConfig {
  /** OpenKosmos-style transport field */
  transport?: 'stdio' | 'sse' | 'StreamableHttp' | string;
  /** Claude Code-style type field (mapped to transport) */
  type?: 'stdio' | 'sse' | 'http' | 'ws' | string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  /** HTTP headers for sse/http transports (e.g. Authorization) */
  headers?: Record<string, string>;
}

/** A single hook action (shell command). */
export interface CommandHook {
  type: 'command';
  command: string;
  /** Max execution time in ms (default 10 000). */
  timeout?: number;
  /** If true, the hook runs asynchronously (fire-and-forget). */
  async?: boolean;
}

export type HookCommand = CommandHook;

export type HookEvent = 'SessionStart';

/**
 * Claude Code hook matcher entry.
 * Each event maps to an array of matcher groups.
 */
export interface HookMatcher {
  /** Glob/regex filter — `*` or omitted = match all. */
  matcher?: string;
  hooks: HookCommand[];
}

/** Raw hooks file format (Claude Code style: event → HookMatcher[]). */
export type HooksFileFormat = Partial<Record<HookEvent, HookMatcher[]>>;

/** Normalized internal format: flat command arrays per event. */
export type HooksSettings = Partial<Record<HookEvent, HookCommand[]>>;

// ---------------------------------------------------------------------------
// Commands & Agents — parsed from .md files with YAML frontmatter
// ---------------------------------------------------------------------------

/** A plugin command parsed from `commands/<name>.md`. */
export interface PluginCommand {
  /** Derived from the filename (without .md extension). */
  name: string;
  /** From YAML frontmatter. */
  description?: string;
  /** The markdown body — serves as the command prompt. */
  promptBody: string;
  /** Relative path within the plugin directory. */
  sourcePath: string;
  /** Optional: tools the command is allowed to use. */
  allowedTools?: string[];
}

/** A plugin agent parsed from `agents/<name>.md`. */
export interface PluginAgent {
  /** From YAML frontmatter `name`, or derived from filename. */
  name: string;
  /** From YAML frontmatter. */
  description?: string;
  /** From YAML frontmatter (e.g. 'inherit'). */
  model?: string;
  /** The markdown body — serves as the agent's system prompt. */
  systemPrompt: string;
  /** Relative path within the plugin directory. */
  sourcePath: string;
}

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

/**
 * Plugin manifest.
 *
 * Only `name` is truly required (matching Claude Code).  Missing
 * `version` / `description` are given defaults at load time.
 */
export interface OpenKosmosPluginManifest {
  name: string;
  version: string;
  description: string;
  author: PluginAuthor;

  /** Relative paths to skill directories (each must contain SKILL.md). */
  skills?: string | string[];
  /** MCP servers keyed by logical server name. */
  mcpServers?: Record<string, PluginMcpServerConfig>;
  /** Lifecycle hooks (normalized — flat arrays). */
  hooks?: HooksSettings;
  /** Plugin commands discovered from `commands/*.md`. */
  commands?: PluginCommand[];
  /** Plugin agents discovered from `agents/*.md`. */
  agents?: PluginAgent[];

  // Claude Code extended fields (preserved but not actively used)
  homepage?: string;
  repository?: string;
  license?: string;
  keywords?: string[];
}

// ---------------------------------------------------------------------------
// Runtime — in-memory representation after loading
// ---------------------------------------------------------------------------

export interface LoadedPlugin {
  /** Unique identifier — equals manifest.name. */
  id: string;
  manifest: OpenKosmosPluginManifest;
  /** Absolute path to the plugin root directory on disk. */
  path: string;
  enabled: boolean;

  // Resolved absolute paths
  resolvedSkillPaths: string[];
  /** Scoped MCP server names injected into MCPClientManager. */
  injectedMcpServers: string[];
  /** Skill names injected into the profile. */
  injectedSkills: string[];
}

// ---------------------------------------------------------------------------
// Persistence — installed.json
// ---------------------------------------------------------------------------

export interface PluginInstallRecord {
  id: string;
  version: string;
  /** Absolute path on disk. */
  path: string;
  enabled: boolean;
  installedAt: string;
}

export interface InstalledPluginsFile {
  version: 1;
  plugins: PluginInstallRecord[];
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export interface PluginError {
  pluginId?: string;
  message: string;
}

export interface PluginLoadResult {
  enabled: LoadedPlugin[];
  disabled: LoadedPlugin[];
  errors: PluginError[];
}
