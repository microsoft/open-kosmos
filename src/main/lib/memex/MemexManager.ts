/**
 * MemexManager — manages per-agent memex MCP servers.
 *
 * When enabled, registers a hidden stdio MCP server for each agent,
 * with MEMEX_HOME pointing to a per-agent directory under the user profile.
 * When disabled, disconnects and removes all memex MCP servers.
 */

import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import type { BrowserWindow } from 'electron';
import type { McpServerConfig } from '../userDataADO/types/profile';
import type { MemexResult } from '@shared/ipc/memex';
import { safeConsole } from '../utilities/safeConsole';

const execAsync = promisify(exec);
const MEMEX_SERVER_PREFIX = 'memex-';

export interface MemexManagerDeps {
  getAlias: () => string;
  getProfileCacheManager: () => Promise<{
    addMcpServerConfig: (alias: string, config: McpServerConfig) => Promise<boolean>;
    deleteMcpServerConfig: (alias: string, serverName: string) => Promise<boolean>;
    getAllMcpServerInfo: (alias: string) => Array<{ config: McpServerConfig }>;
    getAllChatConfigs: (alias: string) => Array<{ chat_id: string; agent?: { name: string; mcp_servers: Array<{ name: string; tools: string[] }> } }>;
    updateChatAgent: (alias: string, chatId: string, agentUpdates: any) => Promise<boolean>;
  }>;
  getMcpClientManager: () => Promise<{
    connect: (serverName: string) => Promise<void>;
    disconnect: (serverName: string) => Promise<void>;
    delete: (serverName: string) => Promise<void>;
  }>;
  getUserDataDir: () => string;
  getMainWindow: () => BrowserWindow | null;
}

function memexServerName(chatId: string): string {
  return `${MEMEX_SERVER_PREFIX}${chatId}`;
}

function isMemexServer(serverName: string): boolean {
  return serverName.startsWith(MEMEX_SERVER_PREFIX);
}

function buildMemexHome(userDataDir: string, alias: string, chatId: string): string {
  return path.join(userDataDir, 'profiles', alias, 'memex_memory', chatId);
}

function buildMcpConfig(serverName: string, memexHome: string): McpServerConfig {
  return {
    name: serverName,
    transport: 'stdio',
    command: 'memex',
    args: ['mcp'],
    env: { MEMEX_HOME: memexHome },
    url: '',
    in_use: true,
    hidden: true,
    source: 'ON-DEVICE',
  };
}

export class MemexManager {
  constructor(private readonly deps: MemexManagerDeps) {}

  private sendPhase(phase: string): void {
    this.deps.getMainWindow()?.webContents.send('memex:phaseChange', phase);
  }

  /**
   * Ensure the `memex` CLI is globally installed. Installs via npm if missing.
   * Throws on failure so the caller can surface the error to the user.
   */
  private async ensureMemexInstalled(): Promise<void> {
    try {
      await execAsync('memex --version');
      return; // already installed
    } catch {
      // not found — try to install
    }

    safeConsole.log('[MemexManager] memex CLI not found, installing @touchskyer/memex globally…');
    this.sendPhase('installing');
    try {
      await execAsync('npm install -g @touchskyer/memex@0.1.27');
    } catch (installErr) {
      throw new Error(
        `Failed to install memex CLI. Ensure npm is available and you have global install permissions. ` +
        `(${installErr instanceof Error ? installErr.message : installErr})`
      );
    }

    // Verify installation actually succeeded
    try {
      await execAsync('memex --version');
    } catch {
      throw new Error('memex CLI installed but cannot be found on PATH. Check your npm global bin directory.');
    }
  }

  async enable(): Promise<MemexResult> {
    try {
      await this.ensureMemexInstalled();

      this.sendPhase('configuring');
      const alias = this.deps.getAlias();
      if (!alias) {
        return { success: false, error: 'No current user alias' };
      }
      const pcManager = await this.deps.getProfileCacheManager();
      const mcpManager = await this.deps.getMcpClientManager();
      const userDataDir = this.deps.getUserDataDir();
      const chats = pcManager.getAllChatConfigs(alias);

      for (const chat of chats) {
        if (!chat.agent) continue; // skip non-agent chats

        const serverName = memexServerName(chat.chat_id);
        const existing = pcManager.getAllMcpServerInfo(alias).find(s => s.config.name === serverName);
        if (existing) continue; // already registered

        const memexHome = buildMemexHome(userDataDir, alias, chat.chat_id);
        const config = buildMcpConfig(serverName, memexHome);
        await pcManager.addMcpServerConfig(alias, config);

        // Auto-bind to agent's mcp_servers
        if (chat.agent) {
          const agentMcpServers = chat.agent.mcp_servers || [];
          if (!agentMcpServers.some(s => s.name === serverName)) {
            await pcManager.updateChatAgent(alias, chat.chat_id, {
              mcp_servers: [...agentMcpServers, { name: serverName, tools: [] }],
            });
          }
        }

        // Connect async (don't block the loop)
        mcpManager.connect(serverName).catch(err => {
          safeConsole.warn(`[MemexManager] Failed to connect ${serverName}:`, err);
        });
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async disable(): Promise<MemexResult> {
    try {
      const alias = this.deps.getAlias();
      if (!alias) {
        return { success: false, error: 'No current user alias' };
      }
      const pcManager = await this.deps.getProfileCacheManager();
      const mcpManager = await this.deps.getMcpClientManager();
      const servers = pcManager.getAllMcpServerInfo(alias);
      const chats = pcManager.getAllChatConfigs(alias);

      // Unbind memex from all agents' mcp_servers
      for (const chat of chats) {
        if (chat.agent?.mcp_servers) {
          const filtered = chat.agent.mcp_servers.filter(s => !isMemexServer(s.name));
          if (filtered.length !== chat.agent.mcp_servers.length) {
            await pcManager.updateChatAgent(alias, chat.chat_id, {
              mcp_servers: filtered,
            });
          }
        }
      }

      // Disconnect and remove all memex MCP servers
      for (const { config } of servers) {
        if (isMemexServer(config.name)) {
          try {
            await mcpManager.disconnect(config.name);
          } catch { /* may already be disconnected */ }
          await mcpManager.delete(config.name);
        }
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async getStatus(): Promise<MemexResult<{ enabled: boolean }>> {
    try {
      const alias = this.deps.getAlias();
      if (!alias) {
        return { success: true, data: { enabled: false } };
      }
      const pcManager = await this.deps.getProfileCacheManager();
      const servers = pcManager.getAllMcpServerInfo(alias);
      const hasMemex = servers.some(s => isMemexServer(s.config.name));
      return { success: true, data: { enabled: hasMemex } };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Called when a new agent is created. If memex is enabled, register a memex MCP for it.
   */
  async onAgentCreated(chatId: string): Promise<void> {
    const alias = this.deps.getAlias();
    if (!alias) return;

    const pcManager = await this.deps.getProfileCacheManager();
    const servers = pcManager.getAllMcpServerInfo(alias);
    // Only auto-register if memex is enabled (i.e., at least one memex server exists)
    if (!servers.some(s => isMemexServer(s.config.name))) return;

    const serverName = memexServerName(chatId);
    const memexHome = buildMemexHome(this.deps.getUserDataDir(), alias, chatId);
    const config = buildMcpConfig(serverName, memexHome);
    await pcManager.addMcpServerConfig(alias, config);

    // Auto-bind to agent
    const chat = pcManager.getAllChatConfigs(alias).find(c => c.chat_id === chatId);
    if (chat?.agent) {
      const agentMcpServers = chat.agent.mcp_servers || [];
      if (!agentMcpServers.some(s => s.name === serverName)) {
        await pcManager.updateChatAgent(alias, chatId, {
          mcp_servers: [...agentMcpServers, { name: serverName, tools: [] }],
        });
      }
    }

    const mcpManager = await this.deps.getMcpClientManager();
    mcpManager.connect(serverName).catch(err => {
      safeConsole.warn(`[MemexManager] Failed to connect ${serverName}:`, err);
    });
  }

  /**
   * Called when an agent is deleted. Clean up its memex MCP server.
   */
  async onAgentDeleted(chatId: string): Promise<void> {
    const alias = this.deps.getAlias();
    if (!alias) return;

    const serverName = memexServerName(chatId);
    const mcpManager = await this.deps.getMcpClientManager();
    try {
      await mcpManager.disconnect(serverName);
    } catch { /* may not exist */ }
    try {
      await mcpManager.delete(serverName);
    } catch { /* may not exist */ }
  }
}
