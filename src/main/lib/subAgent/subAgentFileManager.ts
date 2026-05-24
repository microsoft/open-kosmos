/**
 * SubAgentFileManager — Sub-Agent File System Manager
 *
 * Responsibilities:
 * 1. Parse AGENT.md (YAML front-matter + Markdown body)
 * 2. Serialize SubAgentConfig → AGENT.md
 * 3. Manage CRUD operations for the agents/ directory
 * 4. Import Claude Code format .md files from external sources
 * 5. Provide directory scanning to discover all installed sub-agents
 *
 * Design notes:
 * - YAML parsing reuses js-yaml (consistent with SkillManager)
 * - All file I/O uses fs.promises (async), since sub-agent files are read on hot paths
 * - Write operations are serialized via writeLock Map (similar to RuntimeManager.installLocks)
 * - Maintains internal configCache to avoid frequent disk I/O
 */

import * as fs from 'fs';
import * as path from 'path';
// @ts-ignore - js-yaml types may not be available
import * as yaml from 'js-yaml';
import { createConsoleLogger } from '../unifiedLogger';

import type {
  SubAgentConfig,
  SubAgentContextAccess,
  SubAgentMcpServerConfig,
  AgentMcpServer,
} from '../userDataADO/types/profile';

const logger = createConsoleLogger();

/** AGENT.md filename constant */
const AGENT_MD_FILENAME = 'AGENT.md';

/** agents subdirectory name */
const AGENTS_DIRNAME = 'agents';

/** Sub-agent name regex: lowercase letters + digits + hyphens + underscores, cannot start or end with hyphen/underscore */
const AGENT_NAME_PATTERN = /^[a-z0-9]([a-z0-9_-]*[a-z0-9])?$/;

/** YAML front-matter regex */
const YAML_FRONTMATTER_REGEX = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---/;

/**
 * Claude Code → OpenKosmos built-in tool name mapping
 *
 * Claude Code uses short names (e.g. Read, Grep), OpenKosmos uses full identifiers (e.g. read_file).
 * When importing Claude Code AGENT.md, `tools` are automatically mapped to `x-openkosmos.builtin_tools`,
 * and `disallowedTools` are mapped to `x-openkosmos.disallow_builtin_tools`, while preserving the original fields.
 */
export const CLAUDE_TO_OpenKosmos_TOOL_MAP: Record<string, string> = {
  // File Operations
  Read: 'read_file',
  Write: 'write_file',
  Edit: 'write_file',
  MultiEdit: 'write_file',
  NotebookRead: 'read_file',
  NotebookEdit: 'write_file',
  // File Search
  Glob: 'search_files',
  Grep: 'search_file_contents',
  // Command Execution
  Bash: 'execute_command',
  // Web
  WebFetch: 'fetch_web_content',
  WebSearch: 'bing_web_search',
  // Sub-Agent (always blocked by BLOCKED_TOOLS at runtime, but mapping kept for completeness)
  Task: 'spawn_subagent',
};

/**
 * Parse result
 */
export interface ParseResult<T> {
  data: T | null;
  error?: string;
}

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * SubAgentFileManager — Singleton
 */
export class SubAgentFileManager {
  private static instance: SubAgentFileManager | null = null;

  /** In-memory cache: agentName → SubAgentConfig */
  private configCache: Map<string, SubAgentConfig> = new Map();

  /** Write lock: agentName → Promise (serializes write operations) */
  private writeLocks: Map<string, Promise<void>> = new Map();

  /** Whether cache has completed initial load (per userAlias) */
  private cacheWarmed: Set<string> = new Set();

  private constructor() {}

  static getInstance(): SubAgentFileManager {
    if (!SubAgentFileManager.instance) {
      SubAgentFileManager.instance = new SubAgentFileManager();
    }
    return SubAgentFileManager.instance;
  }

  static resetInstance(): void {
    SubAgentFileManager.instance = null;
  }

  // =========================================================================
  // Sync cache accessors (for hot paths that cannot be async)
  // =========================================================================

  /**
   * Return all cached SubAgentConfig values synchronously.
   * Only returns data that has already been loaded via scanAllAgents / readAgentConfig.
   * Callers must ensure the cache is warm (e.g. after getSubAgents() on startup).
   */
  getCachedConfigs(): SubAgentConfig[] {
    return Array.from(this.configCache.values());
  }

  /**
   * Return a single cached SubAgentConfig by name, or undefined if not cached.
   */
  getCachedConfig(name: string): SubAgentConfig | undefined {
    return this.configCache.get(name);
  }

  // =========================================================================
  // Path utilities
  // =========================================================================

  /**
   * Get the agents/ root directory path
   */
  getAgentsDirectory(profileDir: string): string {
    return path.join(profileDir, AGENTS_DIRNAME);
  }

  /**
   * Get a single agent's directory path
   */
  getAgentDirectory(profileDir: string, agentName: string): string {
    return path.join(profileDir, AGENTS_DIRNAME, agentName);
  }

  /**
   * Get the AGENT.md file path
   */
  getAgentFilePath(profileDir: string, agentName: string): string {
    return path.join(profileDir, AGENTS_DIRNAME, agentName, AGENT_MD_FILENAME);
  }

  // =========================================================================
  // Parse AGENT.md
  // =========================================================================


  /**
   * Parse AGENT.md file content into SubAgentConfig
   *
   * Format rules:
   * 1. YAML front-matter: delimited by `---`, starting at the first line
   * 2. Markdown body: all content after front-matter → system_prompt
   * 3. Standard fields: name, description, tools, model, skills, mcpServers
   * 4. OpenKosmos extension fields: placed under the x-openkosmos namespace
   * 5. Forward compatibility: unrecognized front-matter fields are ignored
   */
  parseAgentMarkdown(content: string): ParseResult<SubAgentConfig> {
    try {
      // Check if the first line is ---
      if (!content.startsWith('---')) {
        return {
          data: null,
          error: 'AGENT.md must start with YAML front-matter (---). Expected format:\n---\nname: agent-name\ndescription: "description"\n---',
        };
      }

      // Extract YAML front-matter
      const match = content.match(YAML_FRONTMATTER_REGEX);
      if (!match) {
        return {
          data: null,
          error: 'AGENT.md does not contain valid YAML front-matter. Expected closing --- marker.',
        };
      }

      const yamlContent = match[1];
      const yamlData = yaml.load(yamlContent) as Record<string, unknown>;

      // Validate YAML structure
      if (!yamlData || typeof yamlData !== 'object') {
        return { data: null, error: 'Invalid YAML front-matter structure' };
      }

      // Required field validation
      if (!yamlData.name || typeof yamlData.name !== 'string' || !yamlData.name.trim()) {
        return { data: null, error: 'AGENT.md front-matter must contain a valid "name" field' };
      }
      if (!yamlData.description || typeof yamlData.description !== 'string' || !yamlData.description.trim()) {
        return { data: null, error: 'AGENT.md front-matter must contain a valid "description" field' };
      }

      // Extract Markdown body → system_prompt
      const frontMatterEnd = content.indexOf('\n---', 4);
      const markdownBody = frontMatterEnd >= 0
        ? content.substring(frontMatterEnd + 4).trim()
        : '';

      // Extract x-openkosmos extension fields
      const xOpenKosmos = (yamlData['x-openkosmos'] as Record<string, unknown>) || {};

      // Parse tools (supports comma-separated string or array)
      const tools = this.parseToolsList(yamlData.tools);

      // Parse disallowedTools
      const disallowedTools = this.parseToolsList(yamlData.disallowedTools);

      // Parse mcpServers (supports Claude Code string references and OpenKosmos inline config)
      const mcpServers = this.parseMcpServers(yamlData.mcpServers || yamlData.mcp_servers);

      // Parse skills
      const skills = this.parseStringArray(yamlData.skills);

      // Build SubAgentConfig
      const config: SubAgentConfig = {
        // Claude Code standard fields
        name: String(yamlData.name).trim(),
        description: String(yamlData.description).trim(),
        tools: tools.length > 0 ? tools : undefined,
        disallowedTools: disallowedTools.length > 0 ? disallowedTools : undefined,
        model: yamlData.model != null ? String(yamlData.model) : 'inherit',
        skills: skills.length > 0 ? skills : [],
        mcpServers: mcpServers.length > 0 ? mcpServers : [],

        // OpenKosmos extension fields (read from x-openkosmos namespace, fallback to defaults)
        builtin_tools: this.parseStringArray(xOpenKosmos.builtin_tools),
        disallow_builtin_tools: this.parseStringArray(xOpenKosmos.disallow_builtin_tools),
        inherit_mcp_servers: xOpenKosmos.inherit_mcp_servers != null ? Boolean(xOpenKosmos.inherit_mcp_servers) : true,
        inherit_skills: xOpenKosmos.inherit_skills != null ? Boolean(xOpenKosmos.inherit_skills) : true,

        // Runtime fields
        system_prompt: markdownBody,

        // Compatibility fields (source is not set during file parsing; it belongs to SubAgentIndex)
        mcp_servers: this.mcpServersToLegacy(mcpServers),
      };

      // === Claude Code tools → OpenKosmos builtin_tools auto-mapping ===
      // During import, map tools (Claude Code original names) to builtin_tools,
      // and map disallowedTools to disallow_builtin_tools, while preserving original fields
      if (tools.length > 0 && (!config.builtin_tools || config.builtin_tools.length === 0)) {
        const mapped = this.mapClaudeToolsToOpenKosmos(tools);
        if (mapped.length > 0) {
          config.builtin_tools = mapped;
        }
      }
      if (disallowedTools.length > 0 && (!config.disallow_builtin_tools || config.disallow_builtin_tools.length === 0)) {
        const mapped = this.mapClaudeToolsToOpenKosmos(disallowedTools);
        if (mapped.length > 0) {
          config.disallow_builtin_tools = mapped;
        }
      }

      logger.info(`[SubAgentFileManager] Parsed AGENT.md - name: "${config.name}", description: "${config.description}"`);
      return { data: config };

    } catch (error) {
      return {
        data: null,
        error: `Failed to parse AGENT.md: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Serialize SubAgentConfig → AGENT.md file content
   */
  serializeToAgentMarkdown(config: SubAgentConfig): string {
    // Build standard fields YAML object
    const standardFields: Record<string, unknown> = {
      name: config.name,
      description: config.description,
    };

    // tools (Claude Code standard tool names only)
    if (config.tools && config.tools.length > 0) {
      standardFields.tools = config.tools;
    }

    // disallowedTools
    if (config.disallowedTools && config.disallowedTools.length > 0) {
      standardFields.disallowedTools = config.disallowedTools;
    }

    // model
    if (config.model && config.model !== 'inherit') {
      standardFields.model = config.model;
    }

    // skills
    if (config.skills && config.skills.length > 0) {
      standardFields.skills = config.skills;
    }

    // mcpServers (prefer mcpServers, fallback to converting mcp_servers)
    const mcpServers = config.mcpServers ?? this.legacyToMcpServers(config.mcp_servers);
    if (mcpServers && mcpServers.length > 0) {
      standardFields.mcpServers = mcpServers.map(s =>
        typeof s === 'string' ? s : { name: s.name, tools: s.tools },
      );
    }

    // Build x-openkosmos extension fields
    const xOpenKosmos: Record<string, unknown> = {};

    if (config.builtin_tools && config.builtin_tools.length > 0) {
      xOpenKosmos.builtin_tools = config.builtin_tools;
    }
    if (config.disallow_builtin_tools && config.disallow_builtin_tools.length > 0) {
      xOpenKosmos.disallow_builtin_tools = config.disallow_builtin_tools;
    }
    if (config.inherit_mcp_servers === false) {
      xOpenKosmos.inherit_mcp_servers = false;
    }
    if (config.inherit_skills === false) {
      xOpenKosmos.inherit_skills = false;
    }

    // Merge into top-level YAML object
    const yamlObj: Record<string, unknown> = { ...standardFields };
    if (Object.keys(xOpenKosmos).length > 0) {
      yamlObj['x-openkosmos'] = xOpenKosmos;
    }

    // Render YAML (no flow style, for readability)
    const yamlStr = yaml.dump(yamlObj, {
      lineWidth: -1,      // No automatic line wrapping
      noRefs: true,       // No YAML references
      quotingType: '"',   // Use double quotes
      forceQuotes: false, // Only quote when necessary
    }).trimEnd();

    // Concatenate front-matter + body
    const body = config.system_prompt || '';
    return `---\n${yamlStr}\n---\n\n${body}\n`;
  }

  // =========================================================================
  // CRUD operations
  // =========================================================================


  /**
   * Read a single sub-agent config
   * Reads from cache first; on cache miss, loads from disk
   */
  async readAgentConfig(profileDir: string, agentName: string): Promise<SubAgentConfig | null> {
    // 1. Cache hit
    const cached = this.configCache.get(agentName);
    if (cached) {
      return cached;
    }

    // 2. Read from disk
    const filePath = this.getAgentFilePath(profileDir, agentName);
    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      const result = this.parseAgentMarkdown(content);
      if (result.data) {
        this.configCache.set(agentName, result.data);
        return result.data;
      }
      logger.warn(`[SubAgentFileManager] Failed to parse ${filePath}: ${result.error}`);
      return null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        logger.info(`[SubAgentFileManager] AGENT.md not found: ${filePath}`);
      } else {
        logger.warn(`[SubAgentFileManager] Failed to read ${filePath}: ${error}`);
      }
      return null;
    }
  }

  /**
   * Write sub-agent config to AGENT.md
   * Serializes concurrent writes via writeLock
   */
  async writeAgentConfig(profileDir: string, config: SubAgentConfig): Promise<void> {
    const agentName = config.name;

    // Serialize write operations
    const existingLock = this.writeLocks.get(agentName) || Promise.resolve();
    const writePromise = existingLock.then(async () => {
      const agentDir = this.getAgentDirectory(profileDir, agentName);
      const filePath = this.getAgentFilePath(profileDir, agentName);

      // Ensure directory exists
      await fs.promises.mkdir(agentDir, { recursive: true });

      // Serialize and write
      const content = this.serializeToAgentMarkdown(config);
      await fs.promises.writeFile(filePath, content, 'utf-8');

      // Update cache
      this.configCache.set(agentName, config);

      logger.info(`[SubAgentFileManager] Written AGENT.md for "${agentName}" at ${agentDir}`);
    }).catch((error) => {
      logger.error(`[SubAgentFileManager] Failed to write AGENT.md for "${agentName}": ${error}`);
      throw error;
    });

    this.writeLocks.set(agentName, writePromise.catch(() => {}));
    await writePromise;
  }

  /**
   * Delete a sub-agent directory (including AGENT.md and auxiliary files)
   */
  async deleteAgentDirectory(profileDir: string, agentName: string): Promise<void> {
    const agentDir = this.getAgentDirectory(profileDir, agentName);
    try {
      await fs.promises.rm(agentDir, { recursive: true, force: true });
      this.configCache.delete(agentName);
      logger.info(`[SubAgentFileManager] Deleted agent directory: ${agentDir}`);
    } catch (error) {
      logger.warn(`[SubAgentFileManager] Failed to delete agent directory ${agentDir}: ${error}`);
      throw error;
    }
  }

  /**
   * List all sub-agent names under the agents/ directory
   */
  async listAgents(profileDir: string): Promise<string[]> {
    const agentsDir = this.getAgentsDirectory(profileDir);
    try {
      const entries = await fs.promises.readdir(agentsDir, { withFileTypes: true });
      const agentNames: string[] = [];

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        // Validate directory name as a valid agent name
        if (!this.validateAgentName(entry.name).valid) continue;
        // Check if AGENT.md exists
        const agentFile = path.join(agentsDir, entry.name, AGENT_MD_FILENAME);
        try {
          await fs.promises.access(agentFile, fs.constants.R_OK);
          agentNames.push(entry.name);
        } catch {
          // Skip directories without AGENT.md
        }
      }

      return agentNames;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        // agents/ directory does not exist = no agents
        return [];
      }
      logger.warn(`[SubAgentFileManager] Failed to list agents: ${error}`);
      return [];
    }
  }

  // =========================================================================
  // Scan and sync
  // =========================================================================

  /**
   * Scan the agents/ directory and load all sub-agent configs
   * Returns the full SubAgentConfig list while populating the cache
   */
  async scanAllAgents(profileDir: string): Promise<SubAgentConfig[]> {
    const names = await this.listAgents(profileDir);
    const configs: SubAgentConfig[] = [];

    for (const name of names) {
      const config = await this.readAgentConfig(profileDir, name);
      if (config) {
        configs.push(config);
      }
    }

    return configs;
  }

  // =========================================================================
  // Import / Export
  // =========================================================================

  /**
   * Import a Claude Code format .md file as a OpenKosmos sub-agent
   *
   * Flow:
   * 1. Read the .md file
   * 2. Parse YAML front-matter (Claude Code standard fields)
   * 3. Fill in OpenKosmos defaults (display_name, emoji, version)
   * 4. Write to agents/{name}/AGENT.md
   */
  async importClaudeCodeAgent(profileDir: string, mdFilePath: string): Promise<SubAgentConfig> {
    const content = await fs.promises.readFile(mdFilePath, 'utf-8');
    const result = this.parseAgentMarkdown(content);

    if (!result.data) {
      throw new Error(`Failed to parse Claude Code agent file: ${result.error}`);
    }

    const config = result.data;
    // Imported agent does not set source (that belongs to SubAgentIndex), defaults to ON-DEVICE
    await this.writeAgentConfig(profileDir, config);

    return config;
  }

  /**
   * Export as Claude Code standard format (strips x-openkosmos namespace)
   */
  exportAsClaudeCodeFormat(config: SubAgentConfig): string {
    // Keep only Claude Code standard fields
    const standardFields: Record<string, unknown> = {
      name: config.name,
      description: config.description,
    };

    if (config.tools && config.tools.length > 0) {
      standardFields.tools = config.tools;
    }
    if (config.disallowedTools && config.disallowedTools.length > 0) {
      standardFields.disallowedTools = config.disallowedTools;
    }
    if (config.model && config.model !== 'inherit') {
      standardFields.model = config.model;
    }
    if (config.skills && config.skills.length > 0) {
      standardFields.skills = config.skills;
    }
    // mcpServers → export as string reference names
    const mcpServers = config.mcpServers ?? this.legacyToMcpServers(config.mcp_servers);
    if (mcpServers && mcpServers.length > 0) {
      standardFields.mcpServers = mcpServers.map(s =>
        typeof s === 'string' ? s : s.name,
      );
    }

    const yamlStr = yaml.dump(standardFields, {
      lineWidth: -1,
      noRefs: true,
      quotingType: '"',
      forceQuotes: false,
    }).trimEnd();

    const body = config.system_prompt || '';
    return `---\n${yamlStr}\n---\n\n${body}\n`;
  }

  // =========================================================================
  // Validation
  // =========================================================================

  /**
   * Validate agent name
   * Rules: lowercase letters + digits + hyphens, cannot start/end with hyphen, at least 1 character
   */
  validateAgentName(name: string): ValidationResult {
    const errors: string[] = [];
    if (!name || name.trim() === '') {
      errors.push('Agent name cannot be empty');
    } else if (!AGENT_NAME_PATTERN.test(name)) {
      errors.push('Agent name can only contain lowercase letters (a-z), numbers (0-9), hyphens (-), and underscores (_). Cannot start or end with hyphen or underscore.');
    }
    return { valid: errors.length === 0, errors };
  }

  /**
   * Validate SubAgentConfig completeness
   */
  validateAgentConfig(config: Partial<SubAgentConfig>): ValidationResult {
    const errors: string[] = [];

    if (!config.name) {
      errors.push('name is required');
    } else {
      const nameResult = this.validateAgentName(config.name);
      errors.push(...nameResult.errors);
    }

    if (!config.description) {
      errors.push('description is required');
    }

    return { valid: errors.length === 0, errors };
  }

  // =========================================================================
  // Cache management
  // =========================================================================

  /**
   * Invalidate cache for a specific agent
   */
  invalidateCache(agentName: string): void {
    this.configCache.delete(agentName);
  }

  /**
   * Invalidate all caches (used for "Sync from Disk" operations)
   */
  invalidateAllCache(): void {
    this.configCache.clear();
    this.cacheWarmed.clear();
  }

  /**
   * Check whether the cache has been warmed
   */
  isCacheWarmed(userAlias: string): boolean {
    return this.cacheWarmed.has(userAlias);
  }

  /**
   * Mark the cache as warmed
   */
  markCacheWarmed(userAlias: string): void {
    this.cacheWarmed.add(userAlias);
  }

  // =========================================================================
  // Internal helper methods
  // =========================================================================

  /**
   * Parse tools field (supports comma-separated string or array)
   * Claude Code supports the `tools: Read, Grep, Glob` format
   */
  private parseToolsList(value: unknown): string[] {
    if (!value) return [];
    if (Array.isArray(value)) {
      return value.filter(v => typeof v === 'string' && v.trim()).map(v => String(v).trim());
    }
    if (typeof value === 'string') {
      return value.split(',').map(s => s.trim()).filter(Boolean);
    }
    return [];
  }

  /**
   * Parse string array
   */
  private parseStringArray(value: unknown): string[] {
    if (!value) return [];
    if (Array.isArray(value)) {
      return value.filter(v => typeof v === 'string' && v.trim()).map(v => String(v).trim());
    }
    if (typeof value === 'string') {
      return [value.trim()].filter(Boolean);
    }
    return [];
  }

  /**
   * Parse mcpServers (supports string references and object definitions)
   */
  private parseMcpServers(value: unknown): SubAgentMcpServerConfig[] {
    if (!value) return [];
    if (Array.isArray(value)) {
      return value.map(item => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object' && 'name' in item) {
          return {
            name: String(item.name),
            tools: Array.isArray(item.tools) ? item.tools.map(String) : [],
          } as AgentMcpServer;
        }
        return null;
      }).filter((v): v is SubAgentMcpServerConfig => v !== null);
    }
    return [];
  }

  /**
   * Parse a number with a default value
   */
  private parseNumber(value: unknown, defaultValue: number): number {
    if (typeof value === 'number' && !isNaN(value)) return value;
    if (typeof value === 'string') {
      const n = parseInt(value, 10);
      if (!isNaN(n)) return n;
    }
    return defaultValue;
  }

  /**
   * Parse context_access
   */
  /**
   * Convert agent name to display_name (hyphens to spaces, capitalize first letter)
   */
  private nameToDisplayName(name: string): string {
    return name
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  /**
   * Map a list of Claude Code tool names to OpenKosmos built-in tool names
   * Unmappable names are ignored (may be Claude Code exclusive tools with no OpenKosmos equivalent)
   */
  private mapClaudeToolsToOpenKosmos(claudeTools: string[]): string[] {
    const mapped: string[] = [];
    const seen = new Set<string>();
    for (const tool of claudeTools) {
      const openkosmosName = CLAUDE_TO_OpenKosmos_TOOL_MAP[tool];
      if (openkosmosName && !seen.has(openkosmosName)) {
        seen.add(openkosmosName);
        mapped.push(openkosmosName);
      }
    }
    return mapped;
  }

  /**
   * Convert SubAgentMcpServerConfig[] to legacy AgentMcpServer[]
   * Used for backward compatibility (mcp_servers field)
   */
  private mcpServersToLegacy(servers: SubAgentMcpServerConfig[]): AgentMcpServer[] {
    return servers.map(s => {
      if (typeof s === 'string') {
        return { name: s, tools: [] };
      }
      return s;
    });
  }

  /**
   * Convert legacy AgentMcpServer[] to SubAgentMcpServerConfig[]
   */
  private legacyToMcpServers(servers?: AgentMcpServer[]): SubAgentMcpServerConfig[] {
    if (!servers) return [];
    return servers.map(s => ({
      name: s.name,
      tools: s.tools || [],
    }));
  }
}
