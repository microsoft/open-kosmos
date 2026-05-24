/**
 * MCP Bridge — injects / removes plugin MCP servers via MCPClientManager.
 *
 * Plugin MCP servers are scoped with a `plugin--<pluginName>--<serverName>`
 * naming convention and have `source: 'PLUGIN'` so they are distinguishable
 * from user-managed servers and protected from user modification.
 *
 * Supports environment-variable substitution in command/args/env:
 *   ${OPENKOSMOS_PLUGIN_ROOT}  →  plugin installation directory
 */

import { createLogger } from '../../unifiedLogger';
import { mcpClientManager } from '../../mcpRuntime/mcpClientManager';
import type { McpServerConfig } from '../../userDataADO/types/profile';
import type { LoadedPlugin, PluginMcpServerConfig } from '../types';

const logger = createLogger();

// ---------------------------------------------------------------------------
// Variable substitution
// ---------------------------------------------------------------------------

/**
 * Expand variables in a string value.
 *
 * Resolution order (first match wins):
 *   1. `${OPENKOSMOS_PLUGIN_ROOT}` / `${CLAUDE_PLUGIN_ROOT}` → plugin install path
 *   2. `${VAR:-default}` → process.env[VAR], falling back to `default`
 *   3. `${VAR}` → process.env[VAR], or left as-is if missing
 *
 * Compatible with Claude Code's `expandEnvVarsInString()`.
 */
function substituteVars(value: string, plugin: LoadedPlugin): string {
  return value.replace(/\$\{([^}]+)\}/g, (match, varContent: string) => {
    // Plugin-root shortcuts (exact match, no default-value parsing)
    if (varContent === 'OPENKOSMOS_PLUGIN_ROOT' || varContent === 'CLAUDE_PLUGIN_ROOT') {
      return plugin.path;
    }

    // Support ${VAR:-default} syntax
    const [varName, defaultValue] = varContent.split(':-', 2);
    const envValue = process.env[varName];

    if (envValue !== undefined) {
      return envValue;
    }
    if (defaultValue !== undefined) {
      return defaultValue;
    }

    // Leave unresolved — allows debugging and downstream error reporting
    return match;
  });
}

/**
 * Map Claude Code's `type` field to OpenKosmos's `transport` field.
 * Claude Code uses: "stdio", "sse", "http", "ws"
 * OpenKosmos uses:      "stdio", "sse", "StreamableHttp"
 */
function resolveTransport(raw: PluginMcpServerConfig): string {
  // Prefer explicit `transport`, fall back to `type`
  const value = raw.transport ?? raw.type;
  if (!value) return 'stdio';

  // Map Claude Code "http" → OpenKosmos "http" (VscodeTransportFactory handles it)
  return value;
}

function resolveConfig(
  raw: PluginMcpServerConfig,
  plugin: LoadedPlugin,
): Partial<McpServerConfig> {
  const transport = resolveTransport(raw);
  const isRemote = transport !== 'stdio';

  const resolved: Partial<McpServerConfig> = {
    transport,
    command: raw.command ? substituteVars(raw.command, plugin) : '',
    args: (raw.args ?? []).map(a => substituteVars(a, plugin)),
    env: {} as Record<string, string>,
    url: raw.url ? substituteVars(raw.url, plugin) : '',
  };

  if (raw.env) {
    for (const [k, v] of Object.entries(raw.env)) {
      (resolved.env as Record<string, string>)[k] = substituteVars(v, plugin);
    }
  }

  // Substitute ${VAR} in headers; drop any header whose placeholders
  // didn't resolve. Sending a literal `Bearer ${TOKEN}` would yield a 400
  // ("badly formatted Authorization") that our 401/403-only OAuth retry
  // wouldn't catch; dropping lets the server send a clean 401 instead.
  if (raw.headers && isRemote) {
    const resolvedHeaders: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw.headers)) {
      const expanded = substituteVars(v, plugin);
      if (hasUnresolvedPlaceholder(expanded)) {
        logger.warn(
          `[McpBridge] Plugin "${plugin.id}" header "${k}" still contains an ` +
          `unresolved \${...} placeholder after substitution; dropping the header. ` +
          `The MCP server will see no Authorization, allowing OAuth flow to take over.`,
        );
        continue;
      }
      resolvedHeaders[k] = expanded;
    }
    resolved.headers = resolvedHeaders;
  }

  return resolved;
}

function hasUnresolvedPlaceholder(value: string): boolean {
  return /\$\{[^}]+\}/.test(value);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Inject all MCP servers declared by a plugin into MCPClientManager.
 *
 * @returns List of scoped server names that were successfully injected.
 */
export async function injectPluginMcpServers(
  plugin: LoadedPlugin,
): Promise<string[]> {
  const mcpServers = plugin.manifest.mcpServers;
  if (!mcpServers || Object.keys(mcpServers).length === 0) {
    return [];
  }

  const injected: string[] = [];

  for (const [logicalName, rawConfig] of Object.entries(mcpServers)) {
    const scopedName = `plugin--${plugin.id}--${logicalName}`;
    const resolved = resolveConfig(rawConfig, plugin);

    const fullConfig: McpServerConfig = {
      name: scopedName,
      transport: resolved.transport ?? 'stdio',
      command: resolved.command ?? '',
      args: (resolved.args ?? []) as string[],
      env: (resolved.env ?? {}) as Record<string, string>,
      url: (resolved.url ?? '') as string,
      in_use: true,
      source: 'PLUGIN' as any, // Extended source type
      ...(resolved.headers ? { headers: resolved.headers } : {}),
    };

    try {
      await mcpClientManager.add(scopedName, fullConfig);
      injected.push(scopedName);
      logger.info(`[McpBridge] Injected MCP server "${scopedName}" from plugin "${plugin.id}"`);
    } catch (e) {
      // Server may already exist (e.g. re-activation after startup).
      // Treat "already exists" as success — the server is registered.
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('already exists')) {
        injected.push(scopedName);
        logger.info(`[McpBridge] MCP server "${scopedName}" already registered, skipping add`);
      } else {
        logger.error(`[McpBridge] Failed to inject MCP server "${scopedName}": ${e}`);
      }
    }
  }

  return injected;
}

/**
 * Remove all MCP servers that were injected by a plugin.
 */
export async function removePluginMcpServers(
  plugin: LoadedPlugin,
): Promise<void> {
  for (const serverName of plugin.injectedMcpServers) {
    try {
      await mcpClientManager.delete(serverName, { pluginBypass: true });
      logger.info(`[McpBridge] Removed plugin MCP server "${serverName}"`);
    } catch (e) {
      logger.error(`[McpBridge] Failed to remove MCP server "${serverName}": ${e}`);
    }
  }
}

/**
 * Check if a server name belongs to a plugin (uses naming convention).
 */
export function isPluginMcpServer(serverName: string): boolean {
  return serverName.startsWith('plugin--');
}
