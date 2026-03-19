/**
 * Adapter functions - Provide convenient integration for existing components
 */

import { getTerminalManager } from './TerminalManager';
import { TerminalConfig, TerminalResult } from './types';

/**
 * Create an adapter for ExecuteCommandTool
 */
export async function createExecuteCommandAdapter(): Promise<{
  execute: (config: {
    command: string;
    args?: string[];
    cwd: string;
    timeoutSeconds?: number;
    shell?: 'powershell' | 'cmd' | 'bash' | 'sh' | 'zsh';
  }) => Promise<TerminalResult>;
}> {
  const manager = getTerminalManager();

  return {
    async execute(config): Promise<TerminalResult> {
      const terminalConfig: TerminalConfig = {
        command: config.command,
        args: config.args || [],
        cwd: config.cwd,
        type: 'command',
        shell: config.shell,
        timeoutMs: config.timeoutSeconds ? config.timeoutSeconds * 1000 : undefined,
        persistent: false
      };

      return await manager.executeCommand(terminalConfig);
    }
  };
}

/**
 * Create an adapter for MCP Transport
 */
export async function createMcpTransportAdapter(): Promise<{
  create: (config: {
    command: string;
    args: string[];
    cwd?: string;
    env?: Record<string, string | null>;
    envFile?: string;
  }) => Promise<{
    send: (message: string) => void;
    stop: () => Promise<void>;
    onMessage: (handler: (message: string) => void) => void;
    onError: (handler: (error: Error) => void) => void;
    onExit: (handler: (code: number | null, signal: string | null) => void) => void;
  }>;
}> {
  const manager = getTerminalManager();

  return {
    async create(config) {
      const terminalConfig: TerminalConfig = {
        command: config.command,
        args: config.args,
        cwd: config.cwd || process.cwd(),
        env: config.env,
        envFile: config.envFile,
        type: 'mcp_transport',
        persistent: true
      };

      const instance = await manager.createMcpTransport(terminalConfig);

      return {
        send: (message: string) => instance.send(message),
        stop: () => instance.stop(),
        onMessage: (handler: (message: string) => void) => {
          instance.on('message', handler);
        },
        onError: (handler: (error: Error) => void) => {
          instance.on('error', handler);
        },
        onExit: (handler: (code: number | null, signal: string | null) => void) => {
          instance.on('exit', handler);
        }
      };
    }
  };
}