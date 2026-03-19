import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { McpServerConfig } from "../userDataADO/types";
import { createConsoleLogger } from "../unifiedLogger";
import { ChildProcess } from "child_process";

// Initialize console-only logger for MCP client
let advancedLogger: any;
(async () => {
  advancedLogger = await createConsoleLogger();
})();

interface Tool {
  name: string;
  description?: string; // Make description optional to match the SDK type
  inputSchema: any;
}

export class MCPClient {
  private server: McpServerConfig;
  private mcp: Client;
  private transport: StdioClientTransport | SSEClientTransport | any | null = null;
  private tools: Tool[] = [];
  private lastError: Error | null = null; // Track the last connection error
  private childProcess: ChildProcess | null = null; // Track the child process for cleanup
  

  constructor(mcpServer: McpServerConfig) {
    this.server = mcpServer;
    this.mcp = new Client({ name: this.server.name, version: "1.0.0" });
    this.lastError = null;

    // Log complete MCP server configuration details
    
    if (mcpServer.command) {
    }
    
    if (mcpServer.args && mcpServer.args.length > 0) {
    } else {
    }
    
    if (mcpServer.url) {
    }
    
    if (mcpServer.env && Object.keys(mcpServer.env).length > 0) {
      Object.entries(mcpServer.env).forEach(([key, value]) => {
      });
    } else {
    }
    
  }

  private resolveCommandPath(command: string): string {
    // Windows doesn't need special path resolution, return the original command directly (no sandbox issues on Windows)
    if (process.platform === 'win32') {
      return command;
    }
    
    // Mac/Linux need sandbox adaptation - generic command resolution: uvx, pip, uv, python, npm, node, etc.
    
    // First try using the which command - this is the most reliable method
    try {
      const { execSync } = require('child_process');
      const result = execSync(`which ${command}`, {
        encoding: 'utf8',
        env: this.getEnhancedEnvironment(),
        timeout: 5000 // 5 second timeout
      }).trim();
      
      if (result && result.length > 0) {
        return result;
      }
    } catch (error) {
    }
    
    // If which fails, manually check common paths
    const possiblePaths = this.getCommonCommandPaths(command);
    const fs = require('fs');
    
    for (const path of possiblePaths) {
      try {
        if (fs.existsSync(path) && fs.statSync(path).isFile()) {
          // Check if the file is executable
          try {
            fs.accessSync(path, fs.constants.X_OK);
            return path;
          } catch (e) {
            // File exists but is not executable, skip
            continue;
          }
        }
      } catch (error) {
        // Ignore filesystem errors
      }
    }
    
    return command; // Return original command, let system PATH handle it
  }

  private getCommonCommandPaths(command: string): string[] {
    // Windows doesn't need special path handling
    if (process.platform === 'win32') {
      const baseCommand = command.split(' ')[0];
      return [baseCommand]; // Only return original command
    }
    
    // Mac/Linux path adaptation
    const baseCommand = command.split(' ')[0]; // Handle commands with arguments
    const homePath = process.env.HOME || '/Users/' + (process.env.USER || 'user');
    
    return [
      baseCommand, // Original command
      `/opt/homebrew/bin/${baseCommand}`,         // Homebrew (Apple Silicon)
      `/usr/local/bin/${baseCommand}`,            // Homebrew (Intel) / manual install
      `/usr/bin/${baseCommand}`,                  // System commands
      `/bin/${baseCommand}`,                      // Core system commands
      `/usr/sbin/${baseCommand}`,                 // System admin commands
      `/sbin/${baseCommand}`,                     // Core system admin commands
      `${homePath}/.local/bin/${baseCommand}`,    // User local install
      `${homePath}/.cargo/bin/${baseCommand}`,    // Rust/Cargo install
      `${homePath}/.npm-global/bin/${baseCommand}`, // npm global install
      `${homePath}/.pyenv/shims/${baseCommand}`,  // pyenv-managed Python
      `${homePath}/.nvm/current/bin/${baseCommand}`, // nvm-managed Node.js
      `/Library/Frameworks/Python.framework/Versions/Current/bin/${baseCommand}`, // Python.org install
      `/opt/miniconda3/bin/${baseCommand}`,       // Miniconda
      `/opt/anaconda3/bin/${baseCommand}`,        // Anaconda
    ];
  }

  private getEnhancedEnvironment(): Record<string, string> {
    // Windows doesn't need special environment variable handling, return original environment directly
    if (process.platform === 'win32') {
      return {
        ...Object.fromEntries(
          Object.entries(process.env).filter(([, value]) => value !== undefined)
        ) as Record<string, string>
      };
    }
    
    // Mac/Linux need enhanced environment variables to solve sandbox issues
    const homePath = process.env.HOME || '/Users/' + (process.env.USER || 'user');
    
    // Build enhanced PATH containing all possible command locations
    const pathComponents = [
      '/opt/homebrew/bin',                    // Homebrew (Apple Silicon)
      '/opt/homebrew/sbin',
      '/usr/local/bin',                       // Homebrew (Intel) / manual install
      '/usr/local/sbin',
      '/usr/bin',                             // System commands
      '/bin',                                 // Core system commands
      '/usr/sbin',                            // System admin commands
      '/sbin',                                // Core system admin commands
      `${homePath}/.local/bin`,               // User local install
      `${homePath}/.cargo/bin`,               // Rust/Cargo install
      `${homePath}/.npm-global/bin`,          // npm global install
      `${homePath}/.pyenv/shims`,             // pyenv-managed Python
      `${homePath}/.nvm/current/bin`,         // nvm-managed Node.js
      '/Library/Frameworks/Python.framework/Versions/Current/bin', // Python.org install
      '/opt/miniconda3/bin',                  // Miniconda
      '/opt/anaconda3/bin',                   // Anaconda
      process.env.PATH || ''                  // Original PATH
    ];
    
    return {
      ...Object.fromEntries(
        Object.entries(process.env).filter(([, value]) => value !== undefined)
      ) as Record<string, string>,
      PATH: pathComponents.filter(p => p).join(':'),
      // Ensure other important environment variables are also passed
      HOME: process.env.HOME || homePath,
      USER: process.env.USER || 'user',
      SHELL: process.env.SHELL || '/bin/zsh',
      TMPDIR: process.env.TMPDIR || '/tmp',
      LANG: process.env.LANG || 'en_US.UTF-8'
    };
  }

  async connectToServer(): Promise<string | Error> {
    try {
      // Initialize transport and connect to server
      if (this.server.transport === 'stdio') {
        // Platform-adaptive command resolution - Mac/Linux need sandbox adaptation, Windows does not
        const originalCommand = this.server.command!;
        const resolvedCommand = this.resolveCommandPath(originalCommand);
        
        // Get enhanced environment variables (returns original environment on Windows)
        const enhancedEnv = this.getEnhancedEnvironment();
        
        // Merge server-specific environment variables
        if (this.server.env) {
          Object.assign(enhancedEnv, this.server.env);
        }
        
        
        // Only show enhanced PATH on non-Windows systems
        if (process.platform !== 'win32' && enhancedEnv.PATH) {
        }
        
        this.transport = new StdioClientTransport({
          command: resolvedCommand,
          args: this.server.args!,
          env: enhancedEnv,
        });
        
        // Store reference to child process for cleanup
        if ((this.transport as any).process) {
          this.childProcess = (this.transport as any).process;
        }
      } else if (this.server.transport === 'sse') {
        // For SSE transport, use url first, then fall back to serverLink for backward compatibility
        const serverUrl = this.server.url || (this.server as any).serverLink;
        if (!serverUrl) {
          throw new Error('SSE transport requires url field');
        }
        this.transport = new SSEClientTransport(new URL(serverUrl));
      } else if (this.server.transport === 'StreamableHttp') {
        // StreamableHttp transport
        const serverUrl = this.server.url;
        if (!serverUrl) {
          throw new Error('StreamableHttp transport requires url field');
        }
        this.transport = new StreamableHTTPClientTransport(new URL(serverUrl));
      } else {
        throw new Error(`Unsupported transport type: ${this.server.transport}`);
      }

      await this.mcp.connect(this.transport);

      // List available tools
      const toolsResult = await this.mcp.listTools();
      this.tools = toolsResult.tools.map((tool: any) => ({
        name: tool.name,
        description: tool.description || "", // Provide a default empty string for undefined descriptions
        inputSchema: tool.inputSchema,
      }));

      
      
      this.lastError = null; // Clear any previous error on successful connection
      return "connected";
    } catch (e) {
      this.lastError = e instanceof Error ? e : new Error(String(e));
      return this.lastError;
    }
  }

  // Get the last connection error
  getLastError(): Error | null {
    return this.lastError;
  }

  async getTools(): Promise<Tool[]> {
    return this.tools;
  }
  
  /**
   * Execute a tool with the given name and arguments
   * 
   * @param toolName - The name of the tool to execute
   * @param toolArgs - The arguments to pass to the tool
   * @returns The tool's response content as a string
   */
  async executeTool({ toolName, toolArgs }: { toolName: string, toolArgs: { [key: string]: unknown } }): Promise<string> {
    try {
      const result = await this.mcp.callTool({
        name: toolName,
        arguments: toolArgs,
      });
      
      // Return the content from the tool result
      return result.content as string;
    } catch (e) {
      throw e instanceof Error ? e : new Error(String(e));
    }
  }
  
  async cleanup(): Promise<void> {
    const cleanupStart = Date.now();
    const cleanupId = `cleanup_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    
    
    try {
      // Phase 1: Close MCP connection gracefully
      if (this.transport) {
        try {
          await Promise.race([
            this.mcp.close(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Close timeout')), 5000))
          ]);
        } catch (error) {
        }
      }
      
      // Phase 2: Force terminate child process if it exists
      if (this.childProcess && !this.childProcess.killed) {
        
        try {
          // First try graceful termination
          this.childProcess.kill('SIGTERM');
          
          // Wait up to 3 seconds for graceful termination
          await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => {
              reject(new Error('Graceful termination timeout'));
            }, 3000);
            
            this.childProcess!.on('exit', () => {
              clearTimeout(timeout);
              resolve();
            });
          });
        } catch (error) {
          // If graceful termination fails, force kill
          try {
            this.childProcess.kill('SIGKILL');
          } catch (killError) {
          }
        }
      } else if (this.childProcess?.killed) {
      } else {
      }
      
      // Phase 3: Clean up transport and state
      
      // Try to access and cleanup transport internals if possible
      if (this.transport && typeof (this.transport as any).cleanup === 'function') {
        try {
          await (this.transport as any).cleanup();
        } catch (transportError) {
        }
      }
      
    } finally {
      // Phase 4: Always clear references regardless of cleanup success
      
      this.transport = null;
      this.childProcess = null;
      this.tools = [];
      this.lastError = null;
      
      const cleanupDuration = Date.now() - cleanupStart;
    }
  }
}