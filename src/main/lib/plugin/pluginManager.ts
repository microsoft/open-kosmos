/**
 * PluginManager — singleton that owns the full plugin lifecycle.
 *
 * Responsibilities:
 *   1. Load all installed plugins on startup
 *   2. Install / uninstall plugins (copy to packages dir, update registry)
 *   3. Enable / disable plugins (activate or deactivate extension points)
 *   4. Coordinate bridges (Skill, MCP) and hooks
 *
 * Follows the same Singleton pattern as other OpenKosmos managers.
 */

import * as fs from 'fs';
import * as path from 'path';
import { createLogger } from '../unifiedLogger';
import {
  ensurePluginDirectories,
  getPluginDir,
  getPluginPackagesDir,
} from './pluginDirectories';
import {
  loadAllInstalledPlugins,
  loadPluginFromDir,
  addPluginRecord,
  removePluginRecord,
  getPluginRecord,
} from './pluginLoader';
import { hookRegistry } from './hooks/hookRegistry';
import { injectPluginSkills, removePluginSkills } from './bridges/skillBridge';
import { injectPluginMcpServers, removePluginMcpServers } from './bridges/mcpBridge';
import type {
  LoadedPlugin,
  PluginError,
  PluginInstallRecord,
  HookEvent,
} from './types';
import { profileCacheManager } from "../userDataADO/profileCacheManager";
import { isProfileV2 } from "../userDataADO/types/profile";
import { mcpClientManager } from "../mcpRuntime/mcpClientManager";

const logger = createLogger();

export class PluginManager {
  private static instance: PluginManager;
  private plugins: Map<string, LoadedPlugin> = new Map();
  private currentUserAlias: string | null = null;
  private initialized = false;

  static getInstance(): PluginManager {
    if (!PluginManager.instance) {
      PluginManager.instance = new PluginManager();
    }
    return PluginManager.instance;
  }

  // ========================================================================
  // Initialization
  // ========================================================================

  /**
   * Initialize the plugin system — called once after user login.
   * Loads all installed plugins and activates enabled ones.
   */
  async initialize(userAlias: string): Promise<{ errors: PluginError[] }> {
    // Guard against double initialization (e.g. profile switch)
    if (this.initialized) {
      logger.info('[PluginManager] Already initialized, skipping');
      return { errors: [] };
    }

    this.currentUserAlias = userAlias;
    ensurePluginDirectories();

    const loadResult = loadAllInstalledPlugins();
    const errors: PluginError[] = [...loadResult.errors];

    // Store all plugins (enabled + disabled)
    for (const p of [...loadResult.enabled, ...loadResult.disabled]) {
      this.plugins.set(p.id, p);
    }

    // Activate enabled plugins (register hooks, inject skills/MCP)
    for (const p of loadResult.enabled) {
      const activateErrors = await this.activatePlugin(p);
      errors.push(...activateErrors);
    }

    this.initialized = true;
    logger.info(
      `[PluginManager] Initialized: ${loadResult.enabled.length} active, ${loadResult.disabled.length} disabled, ${errors.length} errors`,
    );

    return { errors };
  }

  // ========================================================================
  // Install / Uninstall
  // ========================================================================

  /**
   * Install a plugin from a source directory.
   *
   * The source directory must contain a valid `plugin.json`.
   * The plugin will be copied into the packages directory.
   */
  async installPlugin(sourceDir: string): Promise<{ error?: string }> {
    if (!this.currentUserAlias) {
      return { error: 'Plugin manager not initialized (no user alias)' };
    }

    // Validate manifest in source
    const { plugin, errors } = loadPluginFromDir(sourceDir);
    if (!plugin) {
      return { error: errors.map(e => e.message).join('; ') };
    }

    // Check for duplicate
    if (this.plugins.has(plugin.id)) {
      return { error: `Plugin "${plugin.id}" is already installed` };
    }

    // Copy to packages directory
    const targetDir = getPluginDir(plugin.id);
    try {
      if (fs.existsSync(targetDir)) {
        fs.rmSync(targetDir, { recursive: true, force: true });
      }
      copyDirRecursive(sourceDir, targetDir);
    } catch (e) {
      return { error: `Failed to copy plugin files: ${e}` };
    }

    // Re-load from target (validates paths in final location)
    const { plugin: finalPlugin, errors: finalErrors } = loadPluginFromDir(targetDir);
    if (!finalPlugin) {
      // Clean up
      fs.rmSync(targetDir, { recursive: true, force: true });
      return { error: finalErrors.map(e => e.message).join('; ') };
    }

    // Persist to installed.json
    const record: PluginInstallRecord = {
      id: finalPlugin.id,
      version: finalPlugin.manifest.version,
      path: targetDir,
      enabled: true,
      installedAt: new Date().toISOString(),
    };
    addPluginRecord(record);

    // Register and activate
    this.plugins.set(finalPlugin.id, finalPlugin);
    const activateErrors = await this.activatePlugin(finalPlugin);

    if (activateErrors.length > 0) {
      logger.warn(
        `[PluginManager] Plugin "${finalPlugin.id}" installed with activation warnings: ${activateErrors.map(e => e.message).join('; ')}`,
      );
    }

    logger.info(`[PluginManager] Plugin "${finalPlugin.id}" installed successfully`);
    return {};
  }

  /**
   * Uninstall a plugin — clean up per-agent references, deactivate, remove from registry, delete files.
   */
  async uninstallPlugin(pluginId: string): Promise<{ error?: string }> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      return { error: `Plugin "${pluginId}" not found` };
    }

    // 1. Clean up per-agent references (enabled_plugins, skills, mcp_servers)
    await this.removePluginFromAllAgents(pluginId);

    // 2. Deactivate globally (hooks, profile-level skills/MCP)
    //    Always deactivate on uninstall — even if plugin.enabled is false,
    //    MCP servers or skills may still be registered from a prior activation.
    await this.deactivatePlugin(plugin);

    // 3. Remove from registry
    removePluginRecord(pluginId);
    this.plugins.delete(pluginId);

    // 4. Delete files
    try {
      if (fs.existsSync(plugin.path)) {
        fs.rmSync(plugin.path, { recursive: true, force: true });
      }
    } catch (e) {
      logger.error(`[PluginManager] Failed to delete plugin files: ${e}`);
    }

    logger.info(`[PluginManager] Plugin "${pluginId}" uninstalled`);
    return {};
  }

  // ========================================================================
  // Enable / Disable
  // ========================================================================

  async enablePlugin(pluginId: string): Promise<{ error?: string }> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) return { error: `Plugin "${pluginId}" not found` };
    if (plugin.enabled) return {};

    plugin.enabled = true;
    this.updateRecordEnabled(pluginId, true);
    const errors = await this.activatePlugin(plugin);

    if (errors.length > 0) {
      return { error: errors.map(e => e.message).join('; ') };
    }
    logger.info(`[PluginManager] Plugin "${pluginId}" enabled`);
    return {};
  }

  /**
   * Restart a plugin — deactivate then re-activate.
   * Useful when environment variables (e.g. auth tokens) change
   * and MCP servers need to reconnect with the new values.
   */
  async restartPlugin(pluginId: string): Promise<{ error?: string }> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) return { error: `Plugin "${pluginId}" not found` };
    if (!plugin.enabled) return { error: `Plugin "${pluginId}" is not enabled` };

    logger.info(`[PluginManager] Restarting plugin "${pluginId}"...`);

    // Deactivate (unhook, remove skills, disconnect MCP)
    await this.deactivatePlugin(plugin);

    // Re-activate (re-register hooks, re-inject skills, reconnect MCP with fresh env)
    const errors = await this.activatePlugin(plugin);

    if (errors.length > 0) {
      return { error: errors.map(e => e.message).join('; ') };
    }

    logger.info(`[PluginManager] Plugin "${pluginId}" restarted successfully`);
    return {};
  }

  async disablePlugin(pluginId: string): Promise<{ error?: string }> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) return { error: `Plugin "${pluginId}" not found` };
    if (!plugin.enabled) return {};

    await this.deactivatePlugin(plugin);
    plugin.enabled = false;
    this.updateRecordEnabled(pluginId, false);

    logger.info(`[PluginManager] Plugin "${pluginId}" disabled`);
    return {};
  }

  // ========================================================================
  // Per-Agent Enable / Disable
  // ========================================================================

  /**
   * Enable a plugin for a specific agent.
   * Automatically adds all plugin skills to agent.skills[] and MCP servers to agent.mcp_servers[].
   */
  async enablePluginForAgent(
    pluginId: string,
    userAlias: string,
    chatId: string,
  ): Promise<{ error?: string }> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) return { error: `Plugin "${pluginId}" not found` };

    // Dynamic import to avoid circular deps
    const chatConfig = profileCacheManager.getChatConfig(userAlias, chatId);
    if (!chatConfig?.agent) return { error: 'Chat has no agent configured' };

    const agent = chatConfig.agent;

    // 1. Ensure plugin is globally activated (skills injected to profile, hooks registered)
    if (!plugin.enabled) {
      plugin.enabled = true;
      this.updateRecordEnabled(pluginId, true);
    }

    // Activate and wait for completion before mutating agent config.
    // activatePlugin writes to profile-level skills/MCP; we must wait
    // for it to finish so the subsequent updateChatAgent doesn't race.
    const activateErrors = await this.activatePlugin(plugin);
    if (activateErrors.length > 0) {
      const skillFailed = activateErrors.some(e => e.message.includes('Skill injection'));
      const mcpFailed = activateErrors.some(e => e.message.includes('MCP injection'));
      if (skillFailed && mcpFailed) {
        return { error: `Plugin activation failed: ${activateErrors.map(e => e.message).join('; ')}` };
      }
      logger.warn(
        `[PluginManager] Plugin "${pluginId}" activated with warnings: ${activateErrors.map(e => e.message).join('; ')}`,
      );
    }

    // 2. Only add skills/MCP that were actually injected successfully
    const currentSkills = new Set(agent.skills ?? []);
    for (const skillName of plugin.injectedSkills) {
      currentSkills.add(skillName);
    }

    const currentMcpNames = new Set(agent.mcp_servers.map(s => s.name));
    const newMcpServers = [...agent.mcp_servers];
    for (const mcpName of plugin.injectedMcpServers) {
      if (!currentMcpNames.has(mcpName)) {
        newMcpServers.push({ name: mcpName, tools: [] }); // empty tools = use all
      }
    }

    // 3. Add pluginId to enabled_plugins
    const enabledPlugins = new Set(agent.enabled_plugins ?? []);
    enabledPlugins.add(pluginId);

    // 4. Persist — single write to avoid race with activatePlugin's profile writes
    const ok = await profileCacheManager.updateChatAgent(userAlias, chatId, {
      skills: Array.from(currentSkills),
      mcp_servers: newMcpServers,
      enabled_plugins: Array.from(enabledPlugins),
    });

    if (!ok) return { error: 'Failed to update agent config' };
    logger.info(`[PluginManager] Plugin "${pluginId}" enabled for agent in chat ${chatId}`);
    return {};
  }

  /**
   * Disable a plugin for a specific agent.
   * Removes all plugin skills from agent.skills[] and MCP servers from agent.mcp_servers[].
   */
  async disablePluginForAgent(
    pluginId: string,
    userAlias: string,
    chatId: string,
  ): Promise<{ error?: string }> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) return { error: `Plugin "${pluginId}" not found` };

    const chatConfig = profileCacheManager.getChatConfig(userAlias, chatId);
    if (!chatConfig?.agent) return { error: 'Chat has no agent configured' };

    const agent = chatConfig.agent;
    const pluginPrefix = `plugin--${pluginId}--`;

    // 1. Remove plugin skills from agent.skills[]
    const filteredSkills = (agent.skills ?? []).filter(s => !s.startsWith(pluginPrefix));

    // 2. Remove plugin MCP servers from agent.mcp_servers[]
    const pluginMcpPrefix = `plugin--${pluginId}--`;
    const filteredMcp = agent.mcp_servers.filter(s => !s.name.startsWith(pluginMcpPrefix));

    // 3. Remove pluginId from enabled_plugins
    const enabledPlugins = (agent.enabled_plugins ?? []).filter(id => id !== pluginId);

    // 4. Persist
    const ok = await profileCacheManager.updateChatAgent(userAlias, chatId, {
      skills: filteredSkills,
      mcp_servers: filteredMcp,
      enabled_plugins: enabledPlugins,
    });

    if (!ok) return { error: 'Failed to update agent config' };
    logger.info(`[PluginManager] Plugin "${pluginId}" disabled for agent in chat ${chatId}`);
    return {};
  }

  // ========================================================================
  // Queries
  // ========================================================================

  getPlugins(): LoadedPlugin[] {
    return Array.from(this.plugins.values());
  }

  getEnabledPlugins(): LoadedPlugin[] {
    return this.getPlugins().filter(p => p.enabled);
  }

  getPlugin(pluginId: string): LoadedPlugin | undefined {
    return this.plugins.get(pluginId);
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  // ========================================================================
  // Activation / Deactivation (private)
  // ========================================================================

  private async activatePlugin(plugin: LoadedPlugin): Promise<PluginError[]> {
    const errors: PluginError[] = [];

    // 1. Register hooks (passing plugin.path for env var injection)
    //    Always unregister first to prevent duplicates on re-activation
    hookRegistry.unregisterPluginHooks(plugin.id);
    if (plugin.manifest.hooks) {
      for (const [event, commands] of Object.entries(plugin.manifest.hooks)) {
        if (commands && commands.length > 0) {
          hookRegistry.registerPluginHooks(plugin.id, plugin.path, event as HookEvent, commands);
        }
      }
    }

    // 2. Inject skills
    if (this.currentUserAlias && plugin.resolvedSkillPaths.length > 0) {
      try {
        const injected = await injectPluginSkills(plugin, this.currentUserAlias);
        plugin.injectedSkills = injected;
      } catch (e) {
        errors.push({ pluginId: plugin.id, message: `Skill injection failed: ${e}` });
      }
    }

    // 3. Inject MCP servers
    if (plugin.manifest.mcpServers) {
      try {
        const injected = await injectPluginMcpServers(plugin);
        plugin.injectedMcpServers = injected;
      } catch (e) {
        errors.push({ pluginId: plugin.id, message: `MCP injection failed: ${e}` });
      }
    }

    return errors;
  }

  private async deactivatePlugin(plugin: LoadedPlugin): Promise<void> {
    // 1. Unregister hooks
    hookRegistry.unregisterPluginHooks(plugin.id);

    // 2. Remove skills
    if (this.currentUserAlias && plugin.injectedSkills.length > 0) {
      await removePluginSkills(plugin, this.currentUserAlias);
      plugin.injectedSkills = [];
    }

    // 3. Remove MCP servers — use injectedMcpServers if available,
    //    otherwise fall back to prefix-based discovery from profile.
    //    injectedMcpServers can be empty after a restart if the plugin
    //    was disabled and never re-activated.
    if (plugin.injectedMcpServers.length > 0) {
      await removePluginMcpServers(plugin);
      plugin.injectedMcpServers = [];
    } else {
      // Fallback: scan profile mcp_servers for this plugin's prefix
      await this.removePluginMcpServersByPrefix(plugin.id);
    }
  }

  // ========================================================================
  // Helpers (private)
  // ========================================================================

  private updateRecordEnabled(pluginId: string, enabled: boolean): void {
    const record = getPluginRecord(pluginId);
    if (record) {
      addPluginRecord({ ...record, enabled });
    }
  }

  /**
   * Remove a plugin's references from ALL agent configs across the profile.
   * Cleans up `enabled_plugins`, `skills`, and `mcp_servers` for each agent.
   */
  private async removePluginFromAllAgents(pluginId: string): Promise<void> {
    if (!this.currentUserAlias) return;

    const profile = profileCacheManager.getCachedProfile(this.currentUserAlias);
    if (!profile || !isProfileV2(profile)) return;

    const pluginPrefix = `plugin--${pluginId}--`;

    for (const chat of profile.chats) {
      const agent = chat.agent;
      if (!agent) continue;

      const hasPluginEnabled = (agent.enabled_plugins ?? []).includes(pluginId);
      const hasPluginSkills = (agent.skills ?? []).some(s => s.startsWith(pluginPrefix));
      const hasPluginMcp = agent.mcp_servers.some(s => s.name.startsWith(pluginPrefix));

      if (!hasPluginEnabled && !hasPluginSkills && !hasPluginMcp) continue;

      const filteredSkills = (agent.skills ?? []).filter(s => !s.startsWith(pluginPrefix));
      const filteredMcp = agent.mcp_servers.filter(s => !s.name.startsWith(pluginPrefix));
      const filteredPlugins = (agent.enabled_plugins ?? []).filter(id => id !== pluginId);

      await profileCacheManager.updateChatAgent(this.currentUserAlias, chat.chat_id, {
        skills: filteredSkills,
        mcp_servers: filteredMcp,
        enabled_plugins: filteredPlugins,
      });

      logger.info(`[PluginManager] Cleaned up plugin "${pluginId}" references from agent in chat ${chat.chat_id}`);
    }
  }

  /**
   * Fallback: remove MCP servers from the profile by prefix when
   * plugin.injectedMcpServers is empty (e.g. after restart without re-activation).
   */
  private async removePluginMcpServersByPrefix(pluginId: string): Promise<void> {
    if (!this.currentUserAlias) return;

    const profile = profileCacheManager.getCachedProfile(this.currentUserAlias);
    if (!profile || !isProfileV2(profile)) return;

    const prefix = `plugin--${pluginId}--`;
    const toRemove = (profile.mcp_servers ?? [])
      .filter(s => s.name.startsWith(prefix))
      .map(s => s.name);

    for (const serverName of toRemove) {
      try {
        // Disconnect and delete from profile
        await mcpClientManager.delete(serverName, { pluginBypass: true });
        logger.info(`[PluginManager] Removed orphaned MCP server "${serverName}" by prefix`);
      } catch (e) {
        logger.warn(`[PluginManager] Failed to remove MCP server "${serverName}": ${e}`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Filesystem helpers
// ---------------------------------------------------------------------------

function copyDirRecursive(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// Export singleton
export const pluginManager = PluginManager.getInstance();
