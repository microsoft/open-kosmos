/**
 * BuiltinToolsManager - Unified management of all built-in tools
 * Strictly follows the design for seamless integration with the MCP tool system
 * Handles registration, execution, and OpenAI format conversion of built-in tools
 *
 * Singleton pattern implementation ensuring a single global instance
 *
 * 🚀 Performance optimization: heavy modules (playwright tools, etc.) use lazy loading
 * Only dynamically imported when a tool is actually executed, reducing startup time
 */

import { BuiltinToolDefinition, ToolExecutionResult } from './types';
import { isFeatureEnabled } from '../../featureFlags';
import type { ToolExecutionContext } from '../../subAgent/types';

// 🚀 Lightweight tools - imported immediately (no heavy dependencies)
import { ReadFileTool } from './readFileTool';
import { ReadHtmlTool } from './readHtmlTool';
import { WriteFileTool } from './writeFileTool';
import { SearchFileContentsTool } from './searchFileContentsTool';
import { SearchFilesTool } from './searchFilesTool';
import { ExecuteCommandTool } from './executeCommandTool';
// ManageProcessTool uses lazy import to avoid ipcMain side effects in tests
import { GetCurrentDateTimeTool } from './getCurrentDateTimeTool';
import { RequestInteractiveInputTool } from './requestInteractiveInputTool';
import { CreateMcpServerFromConfigTool } from './createMcpServerFromConfigTool';
import { UpdateMcpServerTool } from './updateMcpServerTool';
import { GetMcpStatusTool } from './getMcpStatusTool';
import { SearchSkillsTool } from './searchSkillsTool';
import { ApplySkillToAgentsTool } from './applySkillToAgentsTool';
import { UninstallSkillsTool } from './uninstallSkillsTool';
import { RemoveSkillsFromAgentsTool } from './removeSkillsFromAgentsTool';
import { CreateAgentFromConfigTool } from './createAgentFromConfigTool';
import { UpdateAgentTool } from './updateAgentTool';
import { GetAgentStatusTool } from './getAgentStatusTool';
import { ListAgentsTool } from './listAgentsTool';
import { SetPrimaryAgentTool } from './setPrimaryAgentTool';
import { MoveFileTool } from './moveFileTool';
import { PresentTool } from './presentDeliverablesTool';
import { CreateScheduleTool } from './createScheduleTool';
import { GetScheduleTool } from './getScheduleTool';
import { UpdateScheduleTool } from './updateScheduleTool';
import { RunScheduleTool } from './runScheduleTool';
import { CodingAgentTool } from './codingAgentTool';
import { ToolSearchTool } from './toolSearchTool';
import type { McpTool } from '../../chat/toolSearchFilter';

// Facade tools — simplified AI-friendly interfaces wrapping existing tools
import { ManageSkillsFacade } from './facades/manageSkillsFacade';
import { ManageMcpFacade } from './facades/manageMcpFacade';
import { ManageAgentsFacade } from './facades/manageAgentsFacade';
import { SearchMcpFacade } from './facades/searchMcpFacade';
import { SearchAgentsFacade } from './facades/searchAgentsFacade';

import { createLogger } from '../../unifiedLogger';
const logger = createLogger();

// 🐢 Heavy tools - lazy loaded (depend on playwright, mammoth, etc.)
// BingWebSearchTool, BingImageSearchTool
// FetchWebContentTool, ReadOfficeFileTool, DownloadFileTool, SetMcpConnectionStateTool

/**
 * Built-in tool detail info format (compatible with MCP tool format)
 */
export interface BuiltinToolInfo {
  name: string;
  description?: string;
  inputSchema: any;
  serverId: string; // Built-in tools use 'builtin' as a fixed serverId
}

export class BuiltinToolsManager {
  private static instance: BuiltinToolsManager | null = null;
  private tools = new Map<string, BuiltinToolDefinition>();
  // Internal-only tools: callable by renderer code (FRE, agent library UI) via
  // executeTool(), but NOT returned by getAllTools() so they stay hidden from AI.
  private internalTools = new Map<string, BuiltinToolDefinition>();
  private isInitialized = false;

  /**
   * Current tool execution context (statically injected)
   *
   * Lifecycle: Set by AgentChat.executeToolCall() before calling BuiltinToolsManager.executeTool(),
   *           cleared after executeTool() returns.
   * Thread safety: Electron main process uses a single-threaded event loop, only one executeTool() runs at a time,
   *           so the static variable has no race conditions.
   *
   * Note: Existing built-in tools do not need modification; they do not read this context.
   *       Only sub_agent uses it.
   */
  private static currentExecutionContext: ToolExecutionContext | null = null;

  public static setExecutionContext(context: ToolExecutionContext): void {
    BuiltinToolsManager.currentExecutionContext = context;
  }

  public static clearExecutionContext(): void {
    BuiltinToolsManager.currentExecutionContext = null;
  }

  public static getExecutionContext(): ToolExecutionContext | null {
    return BuiltinToolsManager.currentExecutionContext;
  }

  /**
   * Deferred tools context for ToolSearchTool, keyed by chatSessionId.
   * Set before each turn by the streaming service when tool search is enabled.
   * Per-session isolation prevents cross-session context leakage in concurrent scenarios
   * (e.g., foreground chat + scheduled-silent session).
   */
  private static deferredToolsContextMap: Map<string, McpTool[]> = new Map();

  public static setDeferredToolsContext(sessionId: string, tools: McpTool[]): void {
    BuiltinToolsManager.deferredToolsContextMap.set(sessionId, tools);
  }

  public static clearDeferredToolsContext(sessionId: string): void {
    BuiltinToolsManager.deferredToolsContextMap.delete(sessionId);
  }

  public static getDeferredToolsContext(sessionId?: string): McpTool[] | null {
    if (!sessionId) return null;
    return BuiltinToolsManager.deferredToolsContextMap.get(sessionId) ?? null;
  }

  /**
   * Private constructor to prevent external instantiation
   */
  private constructor() {
  }

  /**
   * Get singleton instance
   */
  static getInstance(): BuiltinToolsManager {
    if (!BuiltinToolsManager.instance) {
      BuiltinToolsManager.instance = new BuiltinToolsManager();
    }
    return BuiltinToolsManager.instance;
  }

  /**
   * Reset singleton instance (for testing only)
   */
  static resetInstance(): void {
    if (BuiltinToolsManager.instance) {
      BuiltinToolsManager.instance.reset();
      BuiltinToolsManager.instance = null;
    }
  }

  /**
   * Initialize the built-in tools manager
   * Register all available built-in tools
   *
   * 🚀 Performance optimization: only registers tool definitions (metadata), does not load heavy modules
   * Heavy tool definitions use static metadata; actual modules are loaded at execution time
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    console.time('[BuiltinToolsManager] initialize');

    try {
      // ===== Lightweight tools (registered immediately) =====

      // Register ReadFileTool
      const readFileTool = ReadFileTool.getDefinition();
      this.tools.set('read_file', readFileTool);

      // Register ReadHtmlTool (HTML-specific safe reading)
      const readHtmlTool = ReadHtmlTool.getDefinition();
      this.tools.set('read_html', readHtmlTool);

      // Register WriteFileTool (unified file write tool, supports create, overwrite, append, and more)
      const writeFileTool = WriteFileTool.getDefinition();
      this.tools.set('write_file', writeFileTool);

      // Register SearchFileContentsTool (search file contents)
      const searchFileContentsTool = SearchFileContentsTool.getDefinition();
      this.tools.set('search_file_contents', searchFileContentsTool);

      // Register SearchFilesTool (search file names and paths)
      const searchFilesTool = SearchFilesTool.getDefinition();
      this.tools.set('search_files', searchFilesTool);

      // Register ExecuteCommandTool
      const executeCommandTool = ExecuteCommandTool.getDefinition();
      this.tools.set('execute_command', executeCommandTool);

      // 🐢 ManageProcessTool - lazy load to avoid ipcMain side effects in tests
      // Uses static metadata like other heavy tools; actual module loaded at execution time
      this.tools.set('manage_process', {
        name: 'manage_process',
        description:
          'Manage background processes spawned via execute_command with background=true.\n\n' +
          'Actions:\n' +
          '- list: List all active and recently-exited background sessions\n' +
          '- poll: Check the status of a specific session (running/exited/error)\n' +
          '- log: Read output lines from a session\'s ring buffer (supports pagination)\n' +
          '- kill: Terminate a running background process\n\n' +
          'Session data is retained for 5 minutes after process exit for log retrieval.',
        inputSchema: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['list', 'poll', 'log', 'kill'],
              description: 'Action to perform on background processes'
            },
            sessionId: {
              type: 'string',
              description: 'Session ID returned by execute_command with background=true. Required for poll/log/kill.'
            },
            offset: {
              type: 'number',
              description: 'For log action: line offset to start reading from (0-based, default 0)'
            },
            limit: {
              type: 'number',
              description: 'For log action: maximum number of lines to return (default 50)'
            }
          },
          required: ['action']
        }
      });

      // Register GetCurrentDateTimeTool
      const getCurrentDateTimeTool = GetCurrentDateTimeTool.getDefinition();
      this.tools.set('get_current_datetime', getCurrentDateTimeTool);

      // Register ToolSearchTool (deferred tool loading)
      if (isFeatureEnabled('openkosmosFeatureToolSearch')) {
        const toolSearchTool = ToolSearchTool.getDefinition();
        this.tools.set('tool_search', toolSearchTool);
      }

      // Register RequestInteractiveInputTool
      const requestInteractiveInputTool = RequestInteractiveInputTool.getDefinition();
      this.tools.set('request_interactive_input', requestInteractiveInputTool);

      // Register SearchSkillsTool
      const searchSkillsTool = SearchSkillsTool.getDefinition();
      this.tools.set('search_skills', searchSkillsTool);

      // ===== Facade tools (simplified AI-friendly interfaces wrapping existing tools) =====
      this.tools.set('manage_skills', ManageSkillsFacade.getDefinition());
      this.tools.set('manage_mcp', ManageMcpFacade.getDefinition());
      this.tools.set('manage_agents', ManageAgentsFacade.getDefinition());
      this.tools.set('search_mcp', SearchMcpFacade.getDefinition());
      this.tools.set('search_agents', SearchAgentsFacade.getDefinition());

      // Legacy tools — not exposed to AI, but still called programmatically by
      // renderer code (FreSettingUpView, AddFromAgentLibraryViewContent).
      // Registered in internalTools so executeTool()'s guard passes without
      // polluting getAllTools() / the AI tool inventory.
      // TODO: Migrate renderer callers to dedicated IPC channels, then remove.
      this.internalTools.set('create_mcp_server_from_config', CreateMcpServerFromConfigTool.getDefinition());
      this.internalTools.set('create_agent_from_config', CreateAgentFromConfigTool.getDefinition());
      this.internalTools.set('list_agents', ListAgentsTool.getDefinition());

      // 🔒 Register MoveFileTool (file move tool) - browserControl feature flag protected
      if (isFeatureEnabled('browserControl')) {
        const moveFileTool = MoveFileTool.getDefinition();
        this.tools.set('move_file', moveFileTool);
      }

      // Register PresentTool (present final deliverables)
      const presentTool = PresentTool.getDefinition();
      this.tools.set('present_deliverables', presentTool);

      // Register scheduler tools - openkosmosFeatureScheduler feature flag
      if (isFeatureEnabled('openkosmosFeatureScheduler')) {
        const createScheduleTool = CreateScheduleTool.getDefinition();
        this.tools.set('create_schedule', createScheduleTool);

        const getScheduleTool = GetScheduleTool.getDefinition();
        this.tools.set('get_schedule', getScheduleTool);

        const updateScheduleTool = UpdateScheduleTool.getDefinition();
        this.tools.set('update_schedule', updateScheduleTool);

        const runScheduleTool = RunScheduleTool.getDefinition();
        this.tools.set('run_schedule', runScheduleTool);
      }

      // Register CodingAgentTool (foreground coding agent execution)
      if (isFeatureEnabled('openkosmosFeatureCodingAgent')) {
        const codingAgentTool = CodingAgentTool.getDefinition();
        this.tools.set('coding_agent', codingAgentTool);
      }

      // ===== Heavy tools (using static definitions, lazy-loaded actual modules) =====
      // ⚠️ IMPORTANT CAUTION FOR LLM / DEVELOPERS:
      // When modifying or adding tools below, you MUST ensure that the `inputSchema` defined here
      // matches EXACTLY with the arguments interface defined in the corresponding tool implementation file
      // (e.g. `BingWebSearchToolArgs` in `bingWebSearchTool.ts`).
      //
      // CRITICAL CHECKLIST:
      // 1. Parameter Names: Must match exactly (e.g. 'name' vs 'serverName').
      // 2. Data Types: Must match (string, number, boolean, array).
      // 3. Required Fields: 'required' array here must match non-optional properties in interface.
      //
      // Inconsistencies will cause runtime errors! The model follows THIS schema, but the tool executes based on ITS interface.

      // These tools depend on heavy modules like playwright, mammoth, etc.
      // Only register metadata, do not load actual modules; dynamically imported at execution time

      // 🐢 BingWebSearchTool - depends on playwright
      this.tools.set('bing_web_search', {
        name: 'bing_web_search',
        description: 'Search Bing for web pages. Supports multiple queries in parallel.',
        inputSchema: {
          type: 'object',
          properties: {
            description: { type: 'string', description: 'A brief one-sentence description of what this search is for' },
            queries: { type: 'array', items: { type: 'string' }, description: 'Array of search queries' },
            lang: { type: 'string', description: 'Search language: en or zh' },
            locale: { type: 'string', description: 'Search locale: us or cn' },
            maxResults: { type: 'number', description: 'Max results per query (default 5)' },
            timeout: { type: 'number', description: 'Timeout in seconds (default 60)' }
          },
          required: ['description', 'queries', 'lang', 'locale']
        }
      });

      // 🐢 BingImageSearchTool - depends on playwright
      this.tools.set('bing_image_search', {
        name: 'bing_image_search',
        description: 'Search Bing for images. Supports multiple queries in parallel.',
        inputSchema: {
          type: 'object',
          properties: {
            description: { type: 'string', description: 'A brief one-sentence description of what this search is for' },
            queries: { type: 'array', items: { type: 'string' }, description: 'Array of search queries' },
            lang: { type: 'string', description: 'Search language: en or zh' },
            locale: { type: 'string', description: 'Search locale: us or cn' },
            maxResults: { type: 'number', description: 'Max results per query (default 5)' },
            timeout: { type: 'number', description: 'Timeout in seconds (default 60)' }
          },
          required: ['description', 'queries']
        }
      });

      // 🐢 FetchWebContentTool - depends on node-html-parser
      this.tools.set('fetch_web_content', {
        name: 'fetch_web_content',
        description: 'Fetch and extract text content from web pages. Supports multiple URLs in parallel. Removes HTML tags, JavaScript, CSS, keeping only main text.',
        inputSchema: {
          type: 'object',
          properties: {
            description: { type: 'string', description: 'A brief one-sentence description of what this fetch is for' },
            urls: { type: 'array', items: { type: 'string' }, description: 'Array of web page URLs to fetch (max 20)' },
            timeoutSeconds: { type: 'number', description: 'Request timeout in seconds (default: 30, range: 5-60)' },
            maxContentSize: { type: 'number', description: 'Max content size per URL in bytes (default: 1MB)' }
          },
          required: ['description', 'urls']
        }
      });

      // 🐢 DownloadFileTool - may depend on network modules
      this.tools.set('download_file', {
        name: 'download_file',
        description: 'Download a file from URL and save it to local path.',
        inputSchema: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'The URL to download from' },
            filename: { type: 'string', description: 'The filename to save as (e.g. "image.png")' },
            saveDirectory: { type: 'string', description: 'The directory to save the file in. Defaults to User Downloads folder.' },
            overwrite: { type: 'boolean', description: 'Whether to overwrite existing file (default: false)' }
          },
          required: ['url', 'filename']
        }
      });

      // ──── Sub-Agent tool (unified, lazy load) ────
      // Always available; named spawning gated at execution time.
      {
        const { SubAgentTool } = await import('./subAgentTool');
        const def = SubAgentTool.getDefinition();
        this.tools.set(def.name, def);
        this.tools.set('get_subagent_status', {
          name: 'get_subagent_status',
          description: 'Check the status of background sub-agent tasks for the current session. ' +
            'Returns running, completed, and failed background tasks.',
          inputSchema: {
            type: 'object',
            properties: {},
            required: []
          }
        });
      }

      // ──── notify_parent tool (sub-agent only, gated at execution time) ────
      this.tools.set('notify_parent', {
        name: 'notify_parent',
        description: 'Send a notification to the parent agent. Use this to report progress, warnings, or request input. ' +
          'The parent will receive the notification at their next turn.',
        inputSchema: {
          type: 'object',
          properties: {
            message: {
              type: 'string',
              description: 'The notification message to send to the parent agent'
            },
            type: {
              type: 'string',
              enum: ['info', 'warning', 'need_input'],
              description: 'Notification type (default: info)'
            }
          },
          required: ['message']
        }
      });

      // ──── send_to_subagent tool (parent only) ────
      this.tools.set('send_to_subagent', {
        name: 'send_to_subagent',
        description: 'Send a message or instruction to a running background sub-agent. ' +
          'The sub-agent will incorporate it at its next turn.',
        inputSchema: {
          type: 'object',
          properties: {
            task_id: {
              type: 'string',
              description: 'Background sub-agent task ID'
            },
            message: {
              type: 'string',
              description: 'Message or instruction to send to the sub-agent'
            }
          },
          required: ['task_id', 'message']
        }
      });

      this.isInitialized = true;
      console.timeEnd('[BuiltinToolsManager] initialize');

    } catch (error) {
      console.timeEnd('[BuiltinToolsManager] initialize');
      throw error;
    }
  }

  /**
   * Execute a built-in tool
   * Unified tool execution entry point with error handling and result normalization
   *
   * 🚀 Performance optimization: heavy tools dynamically import modules at execution time
   */
  async executeTool(name: string, args: any, signal?: AbortSignal, chatSessionId?: string): Promise<ToolExecutionResult> {
    if (!this.isInitialized) {
      throw new Error('BuiltinToolsManager not initialized');
    }

    const tool = this.tools.get(name) || this.internalTools.get(name);
    if (!tool) {
      throw new Error(`Builtin tool not found: ${name}`);
    }

    console.time(`[BuiltinToolsManager] executeTool:${name}`);

    if (signal?.aborted) {
      return { success: false, error: `Tool execution aborted: ${name}` };
    }

    try {
      let result;

      // ===== Lightweight tools (already imported) =====
      if (name === 'read_file') {
        result = await ReadFileTool.execute(args, { signal });
        await this.maybeTrackSkillInvocationFromReadFile(args);
      } else if (name === 'read_html') {
        result = await ReadHtmlTool.execute(args, { signal });
      } else if (name === 'write_file') {
        result = await WriteFileTool.execute(args, { signal });
      } else if (name === 'search_file_contents') {
        result = await SearchFileContentsTool.execute(args, { signal });
      } else if (name === 'search_files') {
        result = await SearchFilesTool.execute(args, { signal });
      } else if (name === 'execute_command') {
        result = await ExecuteCommandTool.execute(args, { signal });
      } else if (name === 'manage_process') {
        const { ManageProcessTool } = await import('./manageProcessTool');
        result = await ManageProcessTool.execute(args, { signal });
      } else if (name === 'get_current_datetime') {
        result = await GetCurrentDateTimeTool.execute(args);
      } else if (name === 'request_interactive_input') {
        result = await RequestInteractiveInputTool.execute(args);
      } else if (name === 'search_skills') {
        result = await SearchSkillsTool.execute(args);
      }
      // ===== Legacy tools (kept for programmatic renderer calls, not exposed to AI) =====
      // TODO: Migrate renderer callers (FreSettingUpView) to dedicated IPC channels, then remove these.
      else if (name === 'create_mcp_server_from_config') {
        result = await CreateMcpServerFromConfigTool.execute(args);
      } else if (name === 'tool_search') {
        result = ToolSearchTool.execute(args, chatSessionId);
      } else if (name === 'create_agent_from_config') {
        result = await CreateAgentFromConfigTool.execute(args);
      } else if (name === 'list_agents') {
        result = await ListAgentsTool.execute();
      }
      // ===== Facade tools =====
      else if (name === 'manage_skills') {
        result = await ManageSkillsFacade.execute(args);
      } else if (name === 'manage_mcp') {
        result = await ManageMcpFacade.execute(args);
      } else if (name === 'manage_agents') {
        result = await ManageAgentsFacade.execute(args);
      } else if (name === 'search_mcp') {
        result = await SearchMcpFacade.execute(args);
      } else if (name === 'search_agents') {
        result = await SearchAgentsFacade.execute(args);
      } else if (name === 'move_file') {
        // 🔒 browserControl feature flag protected
        if (!isFeatureEnabled('browserControl')) {
          return { success: false, error: 'move_file tool is not available when browserControl feature is disabled' };
        }
        result = await MoveFileTool.execute(args, { signal });
      } else if (name === 'present_deliverables') {
        result = await PresentTool.execute(args);
      } else if (name === 'create_schedule') {
        result = await CreateScheduleTool.execute(args);
      } else if (name === 'get_schedule') {
        result = await GetScheduleTool.execute(args);
      } else if (name === 'update_schedule') {
        result = await UpdateScheduleTool.execute(args);
      } else if (name === 'run_schedule') {
        result = await RunScheduleTool.execute(args);
      } else if (name === 'coding_agent') {
        if (!isFeatureEnabled('openkosmosFeatureCodingAgent')) {
          result = { content: [{ type: 'text', text: 'coding_agent tool is disabled (openkosmosFeatureCodingAgent feature flag is off)' }], isError: true };
        } else {
          result = await CodingAgentTool.execute(args, { signal });
        }
      }
      // ===== Heavy tools (lazy loaded) =====
      else if (name === 'bing_web_search') {
        const { BingWebSearchTool } = await import('./bingWebSearchTool');
        result = await BingWebSearchTool.execute(args, { signal });
      } else if (name === 'bing_image_search') {
        const { BingImageSearchTool } = await import('./bingImageSearchTool');
        result = await BingImageSearchTool.execute(args, { signal });
      } else if (name === 'fetch_web_content') {
        const { FetchWebContentTool } = await import('./fetchWebContentTool');
        result = await FetchWebContentTool.execute(args, { signal });
      } else if (name === 'download_file') {
        const { DownloadFileTool } = await import('./downloadFileTool');
        result = await DownloadFileTool.execute(args, { signal });
      }
      // ──── Unified Sub-Agent tool ────
      else if (name === 'sub_agent') {
        // Named sub-agent spawning (subagent_type) requires feature flag; adhoc always allowed
        if (args.subagent_type && !isFeatureEnabled('openkosmosFeatureSubAgent')) {
          result = { content: [{ type: 'text', text: 'Named Sub-Agent feature is disabled. You can still use ad-hoc sub-agents by omitting subagent_type.' }], isError: true };
        } else {
          const { SubAgentTool } = await import('./subAgentTool');
          result = await SubAgentTool.execute(args, { signal });
        }
      } else if (name === 'get_subagent_status') {
        const context = BuiltinToolsManager.getExecutionContext();
        if (!context) {
          result = { content: [{ type: 'text', text: 'No execution context available.' }], isError: true };
        } else {
          const { SubAgentManager } = await import('../../subAgent/subAgentManager');
          const manager = SubAgentManager.getInstance();
          const status = manager.getBackgroundTaskStatus(context.chatSessionId);
          result = { content: [{ type: 'text', text: JSON.stringify(status, null, 2) }], isError: false };
        }
      } else if (name === 'notify_parent') {
        const context = BuiltinToolsManager.getExecutionContext();
        if (!context) {
          result = { content: [{ type: 'text', text: 'No execution context available.' }], isError: true };
        } else if (!context.isSubAgent) {
          result = { content: [{ type: 'text', text: 'notify_parent can only be called from within a sub-agent.' }], isError: true };
        } else {
          const { SubAgentManager } = await import('../../subAgent/subAgentManager');
          const manager = SubAgentManager.getInstance();
          manager.handleNotification(context.chatSessionId, {
            taskId: context.currentToolCallId || 'unknown',
            subAgentName: 'sub-agent',
            type: args.type || 'info',
            message: args.message,
            timestamp: Date.now(),
          });
          result = { content: [{ type: 'text', text: 'Notification sent to parent agent.' }], isError: false };
        }
      } else if (name === 'send_to_subagent') {
        const context = BuiltinToolsManager.getExecutionContext();
        if (!context) {
          result = { content: [{ type: 'text', text: 'No execution context available.' }], isError: true };
        } else if (context.isSubAgent) {
          result = { content: [{ type: 'text', text: 'send_to_subagent can only be called by the parent agent.' }], isError: true };
        } else {
          const { SubAgentManager } = await import('../../subAgent/subAgentManager');
          const manager = SubAgentManager.getInstance();
          const sendResult = manager.sendMessageToSubAgent(args.task_id, args.message);
          if (sendResult.success) {
            result = { content: [{ type: 'text', text: `Message delivered to background sub-agent (taskId: ${args.task_id}).` }], isError: false };
          } else {
            result = { content: [{ type: 'text', text: sendResult.error || 'Failed to send message.' }], isError: true };
          }
        }
      } else {
        throw new Error(`Execution not implemented for tool: ${name}`);
      }

      console.timeEnd(`[BuiltinToolsManager] executeTool:${name}`);
      return {
        success: true,
        data: JSON.stringify(result)
      };

    } catch (error) {
      console.timeEnd(`[BuiltinToolsManager] executeTool:${name}`);

      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private async maybeTrackSkillInvocationFromReadFile(_args: { filePath?: unknown }): Promise<void> {
    // Analytics removed.
  }

  /**
   * Get OpenAI format tool definitions
   * For seamless integration with the MCP tool system, unifying tool format
   */
  getOpenAIToolDefinitions(): any[] {
    const definitions = [];

    for (const [name, tool] of this.tools) {
      definitions.push({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema
        }
      });
    }


    return definitions;
  }

  /**
   * Get all registered tool definitions
   */
  getAllTools(): BuiltinToolDefinition[] {
    return Array.from(this.tools.values());
  }

  /**
   * Check if a tool is registered
   */
  hasTool(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Get a specific tool definition
   */
  getTool(name: string): BuiltinToolDefinition | undefined {
    return this.tools.get(name);
  }

  /**
   * Get detailed info for all built-in tools (MCP format compatible)
   * Returns a tool info list compatible with the MCPTool format
   */
  getAllToolsInfo(): BuiltinToolInfo[] {
    const toolsInfo: BuiltinToolInfo[] = [];

    for (const [name, tool] of this.tools) {
      toolsInfo.push({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        serverId: 'builtin' // Built-in tools use a fixed serverId
      });
    }


    return toolsInfo;
  }

  /**
   * Get detailed info for a specific tool (MCP format compatible)
   */
  getToolInfo(name: string): BuiltinToolInfo | undefined {
    const tool = this.tools.get(name);
    if (!tool) {
      return undefined;
    }

    return {
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      serverId: 'builtin'
    };
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      totalTools: this.tools.size,
      tools: Array.from(this.tools.keys()),
      isInitialized: this.isInitialized
    };
  }

  /**
   * Check if a tool is a built-in tool
   * Used by AgentChat to distinguish built-in tools from MCP tools
   */
  isBuiltinTool(toolName: string): boolean {
    return this.tools.has(toolName);
  }

  /**
   * Reset manager state (for testing)
   */
  reset(): void {
    this.tools.clear();
    this.isInitialized = false;
  }
}

/**
 * Export singleton instance getter function
 * Uses getInstance() method to ensure a single global instance
 */
export const getBuiltinToolsManager = (): BuiltinToolsManager => {
  return BuiltinToolsManager.getInstance();
};

/**
 * Export default instance for backward compatibility
 * @deprecated Use getBuiltinToolsManager() or BuiltinToolsManager.getInstance()
 */
export const builtinToolsManager = BuiltinToolsManager.getInstance();
