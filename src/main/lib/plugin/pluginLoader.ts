/**
 * Plugin loader — discovers and loads plugins from disk.
 *
 * Compatible with the Claude Code plugin format:
 *   - Manifest: `.claude-plugin/plugin.json` or root `plugin.json`
 *   - Skills: auto-scan `skills/<name>/SKILL.md` + manifest `skills` field
 *   - Commands: auto-scan `commands/*.md` (YAML frontmatter + body)
 *   - Agents: auto-scan `agents/*.md` (YAML frontmatter + body)
 *   - Hooks: merge `hooks/hooks.json` + manifest `hooks` field
 *   - MCP: merge `.mcp.json` + manifest `mcpServers` field
 *
 * The loader normalizes Claude Code's hook-matcher format into flat
 * `HookCommand[]` arrays so downstream code can stay simple.
 */

import * as path from 'path';
import * as fs from 'fs';
import { createLogger } from '../unifiedLogger';
import {
  getInstalledPluginsFilePath,
  getPluginDir,
  ensurePluginDirectories,
} from './pluginDirectories';
import { validatePluginManifest } from './pluginValidator';
import type {
  HookCommand,
  HookEvent,
  HookMatcher,
  HooksFileFormat,
  HooksSettings,
  InstalledPluginsFile,
  OpenKosmosPluginManifest,
  LoadedPlugin,
  PluginAgent,
  PluginCommand,
  PluginError,
  PluginInstallRecord,
  PluginLoadResult,
  PluginMcpServerConfig,
} from './types';

const logger = createLogger();

// ---------------------------------------------------------------------------
// installed.json I/O
// ---------------------------------------------------------------------------

export function readInstalledPluginsFile(): InstalledPluginsFile {
  const filePath = getInstalledPluginsFilePath();
  try {
    if (fs.existsSync(filePath)) {
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      if (raw && raw.version === 1 && Array.isArray(raw.plugins)) {
        return raw as InstalledPluginsFile;
      }
    }
  } catch (e) {
    logger.error(`[PluginLoader] Failed to read installed.json: ${e}`);
  }
  return { version: 1, plugins: [] };
}

export function writeInstalledPluginsFile(data: InstalledPluginsFile): void {
  ensurePluginDirectories();
  const filePath = getInstalledPluginsFilePath();
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

export function addPluginRecord(record: PluginInstallRecord): void {
  const data = readInstalledPluginsFile();
  data.plugins = data.plugins.filter(p => p.id !== record.id);
  data.plugins.push(record);
  writeInstalledPluginsFile(data);
}

export function removePluginRecord(pluginId: string): void {
  const data = readInstalledPluginsFile();
  data.plugins = data.plugins.filter(p => p.id !== pluginId);
  writeInstalledPluginsFile(data);
}

export function getPluginRecord(pluginId: string): PluginInstallRecord | undefined {
  return readInstalledPluginsFile().plugins.find(p => p.id === pluginId);
}

// ---------------------------------------------------------------------------
// Auto-discovery helpers
// ---------------------------------------------------------------------------

/**
 * Auto-scan `skills/` directory for sub-directories containing SKILL.md.
 * This mirrors Claude Code's behaviour of auto-discovering skills.
 */
function autoDiscoverSkills(pluginDir: string): string[] {
  const skillsRoot = path.join(pluginDir, 'skills');
  if (!fs.existsSync(skillsRoot) || !fs.statSync(skillsRoot).isDirectory()) {
    return [];
  }

  const discovered: string[] = [];
  try {
    for (const entry of fs.readdirSync(skillsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const skillDir = path.join(skillsRoot, entry.name);
      const skillMd = path.join(skillDir, 'SKILL.md');
      if (fs.existsSync(skillMd)) {
        discovered.push(skillDir);
      }
    }
  } catch (e) {
    logger.warn(`[PluginLoader] Error scanning skills/ directory: ${e}`);
  }

  return discovered;
}

/**
 * Load hooks from `hooks/hooks.json` (Claude Code format).
 * Returns the parsed HooksFileFormat or null.
 */
function loadExternalHooksFile(pluginDir: string): HooksFileFormat | null {
  const hooksPath = path.join(pluginDir, 'hooks', 'hooks.json');
  if (!fs.existsSync(hooksPath)) return null;

  try {
    const raw = JSON.parse(fs.readFileSync(hooksPath, 'utf-8'));
    // Claude Code stores hooks under a `hooks` key: { hooks: { SessionStart: [...] } }
    const hooksObj = raw?.hooks ?? raw;
    if (typeof hooksObj !== 'object' || hooksObj === null) return null;
    return hooksObj as HooksFileFormat;
  } catch (e) {
    logger.warn(`[PluginLoader] Error reading hooks/hooks.json: ${e}`);
    return null;
  }
}

/**
 * Load MCP server configs from `.mcp.json` (Claude Code format).
 * Returns a record of server configs, or null.
 */
function loadExternalMcpFile(pluginDir: string): Record<string, PluginMcpServerConfig> | null {
  const mcpPath = path.join(pluginDir, '.mcp.json');
  if (!fs.existsSync(mcpPath)) return null;

  try {
    const raw = JSON.parse(fs.readFileSync(mcpPath, 'utf-8'));
    // Claude Code stores under `mcpServers` key: { mcpServers: { ... } }
    const servers = raw?.mcpServers ?? raw;
    if (typeof servers !== 'object' || servers === null || Array.isArray(servers)) return null;
    return servers as Record<string, PluginMcpServerConfig>;
  } catch (e) {
    logger.warn(`[PluginLoader] Error reading .mcp.json: ${e}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Commands & Agents auto-discovery
// ---------------------------------------------------------------------------

/**
 * Simple YAML frontmatter parser.
 * Extracts key-value pairs from `---` delimited frontmatter and the body.
 */
function parseMarkdownWithFrontmatter(content: string): { frontmatter: Record<string, string>; body: string } {
  const frontmatter: Record<string, string> = {};
  let body = content;

  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (match) {
    const fmBlock = match[1];
    body = match[2].trim();
    for (const line of fmBlock.split('\n')) {
      const colonIdx = line.indexOf(':');
      if (colonIdx > 0) {
        const key = line.slice(0, colonIdx).trim();
        let value = line.slice(colonIdx + 1).trim();
        // Strip surrounding quotes
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        frontmatter[key] = value;
      }
    }
  }

  return { frontmatter, body };
}

/**
 * Auto-discover commands from `commands/*.md`.
 *
 * Claude Code format: YAML frontmatter (description, allowed-tools, etc.)
 * + markdown body as the command prompt.
 */
function autoDiscoverCommands(pluginDir: string): PluginCommand[] {
  const commandsDir = path.join(pluginDir, 'commands');
  if (!fs.existsSync(commandsDir) || !fs.statSync(commandsDir).isDirectory()) {
    return [];
  }

  const commands: PluginCommand[] = [];
  try {
    for (const entry of fs.readdirSync(commandsDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      const filePath = path.join(commandsDir, entry.name);
      const content = fs.readFileSync(filePath, 'utf-8');
      const { frontmatter, body } = parseMarkdownWithFrontmatter(content);
      const name = entry.name.replace(/\.md$/, '');

      commands.push({
        name,
        description: frontmatter['description'] || undefined,
        promptBody: body,
        sourcePath: path.relative(pluginDir, filePath),
        allowedTools: frontmatter['allowed-tools']
          ? frontmatter['allowed-tools'].split(',').map(s => s.trim()).filter(Boolean)
          : undefined,
      });
    }
  } catch (e) {
    logger.warn(`[PluginLoader] Error scanning commands/ directory: ${e}`);
  }

  return commands;
}

/**
 * Auto-discover agents from `agents/*.md`.
 *
 * Claude Code format: YAML frontmatter (name, description, model, etc.)
 * + markdown body as the agent's system prompt.
 */
function autoDiscoverAgents(pluginDir: string): PluginAgent[] {
  const agentsDir = path.join(pluginDir, 'agents');
  if (!fs.existsSync(agentsDir) || !fs.statSync(agentsDir).isDirectory()) {
    return [];
  }

  const agents: PluginAgent[] = [];
  try {
    for (const entry of fs.readdirSync(agentsDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      const filePath = path.join(agentsDir, entry.name);
      const content = fs.readFileSync(filePath, 'utf-8');
      const { frontmatter, body } = parseMarkdownWithFrontmatter(content);
      const fileBaseName = entry.name.replace(/\.md$/, '');

      agents.push({
        name: frontmatter['name'] || fileBaseName,
        description: frontmatter['description'] || undefined,
        model: frontmatter['model'] || undefined,
        systemPrompt: body,
        sourcePath: path.relative(pluginDir, filePath),
      });
    }
  } catch (e) {
    logger.warn(`[PluginLoader] Error scanning agents/ directory: ${e}`);
  }

  return agents;
}

// ---------------------------------------------------------------------------
// Hook format normalization
// ---------------------------------------------------------------------------

/**
 * Flatten Claude Code's HookMatcher[] into flat HookCommand[].
 *
 * Claude Code format:
 *   `SessionStart: [ { matcher?: "x|y", hooks: [ { type, command, ... } ] } ]`
 *
 * OpenKosmos internal:
 *   `SessionStart: [ { type, command, ... } ]`
 *
 * The `matcher` field is currently ignored (all matchers match) since OpenKosmos
 * only supports SessionStart which doesn't need matcher filtering.
 */
function flattenHookMatchers(matchers: HookMatcher[]): HookCommand[] {
  const commands: HookCommand[] = [];
  for (const m of matchers) {
    if (Array.isArray(m.hooks)) {
      for (const h of m.hooks) {
        if (h.type === 'command' && typeof h.command === 'string') {
          commands.push({
            type: 'command',
            command: h.command,
            timeout: h.timeout,
            async: h.async,
          });
        }
      }
    }
  }
  return commands;
}

/**
 * Detect whether a hooks value is the Claude Code matcher format
 * (array of `{ hooks: [...] }`) or the flat OpenKosmos format
 * (array of `{ type: 'command', command: '...' }`).
 */
function isMatcherFormat(value: unknown): value is HookMatcher[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  const first = value[0];
  return typeof first === 'object' && first !== null && 'hooks' in first && Array.isArray(first.hooks);
}

/**
 * Normalize any hooks value (matcher or flat) into flat HookCommand[].
 */
function normalizeHooksValue(value: unknown): HookCommand[] {
  if (!Array.isArray(value)) return [];
  if (isMatcherFormat(value)) {
    return flattenHookMatchers(value);
  }
  // Already flat format
  return value.filter(
    (h: any) => h && h.type === 'command' && typeof h.command === 'string',
  ) as HookCommand[];
}

/**
 * Merge multiple hook sources into a single HooksSettings.
 * Later sources append to earlier ones for the same event.
 */
function mergeHooks(...sources: (Record<string, unknown> | null | undefined)[]): HooksSettings {
  const merged: HooksSettings = {};
  const validEvents: HookEvent[] = ['SessionStart'];

  for (const source of sources) {
    if (!source || typeof source !== 'object') continue;
    for (const event of validEvents) {
      const value = (source as any)[event];
      if (!value) continue;
      const commands = normalizeHooksValue(value);
      if (commands.length > 0) {
        merged[event] = [...(merged[event] ?? []), ...commands];
      }
    }
  }

  return merged;
}

// ---------------------------------------------------------------------------
// Single-plugin loading
// ---------------------------------------------------------------------------

/**
 * Load a single plugin from its directory on disk.
 *
 * Performs manifest validation, then auto-discovers resources:
 *   1. Skills: `skills/<name>/SKILL.md` (Claude Code auto-scan) + manifest `skills`
 *   2. Commands: `commands/*.md` (YAML frontmatter + body)
 *   3. Agents: `agents/*.md` (YAML frontmatter + body)
 *   4. Hooks: `hooks/hooks.json` (Claude Code external) + manifest `hooks`
 *   5. MCP: `.mcp.json` (Claude Code external) + manifest `mcpServers`
 */
export function loadPluginFromDir(
  pluginDir: string,
  record?: PluginInstallRecord,
): { plugin: LoadedPlugin | null; errors: PluginError[] } {
  const { manifest, errors } = validatePluginManifest(pluginDir);
  if (!manifest) {
    return { plugin: null, errors };
  }

  // --- Skills: manifest + auto-discovery ---
  const manifestSkills = typeof manifest.skills === 'string'
    ? [manifest.skills]
    : manifest.skills ?? [];
  const manifestSkillPaths = manifestSkills
    .map(sp => path.resolve(pluginDir, sp))
    .filter(p => fs.existsSync(p));

  const autoSkillPaths = autoDiscoverSkills(pluginDir);

  // Deduplicate (auto-discovered paths may overlap with manifest)
  const allSkillPaths = new Set([...manifestSkillPaths, ...autoSkillPaths]);
  const resolvedSkillPaths = [...allSkillPaths];

  if (resolvedSkillPaths.length > 0) {
    logger.info(`[PluginLoader] "${manifest.name}": discovered ${resolvedSkillPaths.length} skill(s)`);
  }

  // --- Commands: auto-discovery ---
  const commands = autoDiscoverCommands(pluginDir);
  if (commands.length > 0) {
    manifest.commands = commands;
    logger.info(`[PluginLoader] "${manifest.name}": discovered ${commands.length} command(s)`);
  }

  // --- Agents: auto-discovery ---
  const agents = autoDiscoverAgents(pluginDir);
  if (agents.length > 0) {
    manifest.agents = agents;
    logger.info(`[PluginLoader] "${manifest.name}": discovered ${agents.length} agent(s)`);
  }

  // --- Hooks: manifest + hooks/hooks.json ---
  const externalHooks = loadExternalHooksFile(pluginDir);
  const mergedHooks = mergeHooks(externalHooks, manifest.hooks);
  manifest.hooks = Object.keys(mergedHooks).length > 0 ? mergedHooks : undefined;

  // --- MCP: manifest + .mcp.json ---
  const externalMcp = loadExternalMcpFile(pluginDir);
  if (externalMcp) {
    manifest.mcpServers = { ...externalMcp, ...(manifest.mcpServers ?? {}) };
  }

  // Update manifest skills to reflect all discovered paths (relative)
  manifest.skills = resolvedSkillPaths.map(p => path.relative(pluginDir, p));

  const plugin: LoadedPlugin = {
    id: manifest.name,
    manifest,
    path: pluginDir,
    enabled: record?.enabled ?? true,
    resolvedSkillPaths,
    injectedMcpServers: [],
    injectedSkills: [],
  };

  return { plugin, errors: [] };
}

// ---------------------------------------------------------------------------
// Bulk loading
// ---------------------------------------------------------------------------

/**
 * Load all installed plugins from the registry.
 */
export function loadAllInstalledPlugins(): PluginLoadResult {
  const result: PluginLoadResult = { enabled: [], disabled: [], errors: [] };
  const installed = readInstalledPluginsFile();

  for (const record of installed.plugins) {
    const pluginDir = record.path;

    if (!fs.existsSync(pluginDir)) {
      result.errors.push({
        pluginId: record.id,
        message: `Plugin directory missing: ${pluginDir}`,
      });
      continue;
    }

    const { plugin, errors } = loadPluginFromDir(pluginDir, record);
    result.errors.push(...errors);

    if (plugin) {
      if (plugin.enabled) {
        result.enabled.push(plugin);
      } else {
        result.disabled.push(plugin);
      }
    }
  }

  logger.info(
    `[PluginLoader] Loaded ${result.enabled.length} enabled, ${result.disabled.length} disabled, ${result.errors.length} errors`,
  );
  return result;
}
