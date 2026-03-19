/**
 * BuiltinToolsManager - Unified manager for all built-in tools
 * Strictly implements seamless integration with the MCP tool system per the design specification
 * Responsible for registration, execution, and OpenAI format conversion of built-in tools
 *
 * Singleton pattern implementation, ensuring a globally unique instance
 *
 * Performance optimization: Heavy modules (playwright tools, etc.) use lazy loading
 * Only dynamically imported when the tool is actually executed, reducing startup time
 */

import { BuiltinToolDefinition, ToolExecutionResult } from './types';
import { isFeatureEnabled } from '../../featureFlags';

// Lightweight tools - imported immediately (no heavy dependencies)
import { ReadFileTool } from './readFileTool';
import { ReadHtmlTool } from './readHtmlTool';
import { WriteFileTool } from './writeFileTool';
import { SearchTextInFilesTool } from './searchTextInFilesTool';
import { SearchFilesTool } from './searchFilesTool';
import { ExecuteCommandTool } from './executeCommandTool';
import { GetCurrentDateTimeTool } from './getCurrentDateTimeTool';
import { AddMcpByConfigTool } from './addMcpByConfigTool';
import { UpdateMcpByConfigTool } from './updateMcpByConfigTool';
import { CheckMcpStatusTool } from './checkMcpStatusTool';
import { CheckSkillStatusTool } from './checkSkillStatusTool';
import { AddAgentByConfigTool } from './addAgentByConfigTool';
import { UpdateAgentByConfigTool } from './updateAgentByConfigTool';
import { CheckAgentStatusTool } from './checkAgentStatusTool';
import { GetAllAgentsTool } from './getAllAgentsTool';
import { SetPrimaryAgentTool } from './setPrimaryAgentTool';
import { MoveFileTool } from './moveFileTool';
import { PresentTool } from './presentDeliverablesTool';

// Heavy tools - lazy loaded (depend on playwright, mammoth, etc.)
// BingWebSearchTool, BingImageSearchTool, GoogleWebSearchTool, GoogleImageSearchTool
// FetchWebContentTool, ReadOfficeFileTool, DownloadAndSaveAsTool, ToggleMcpByNameTool

/**
 * Built-in tool detailed info format (compatible with MCP tool format)
 */
export interface BuiltinToolInfo {
  name: string;
  description?: string;
  inputSchema: any;
  serverId: string; // Built-in tools uniformly use 'builtin' as serverId
}

export class BuiltinToolsManager {
  private static instance: BuiltinToolsManager | null = null;
  private tools = new Map<string, BuiltinToolDefinition>();
  private isInitialized = false;

  /**
   * Private constructor to prevent direct external instantiation
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
   * Initialize built-in tools manager
   * Register all available built-in tools
   *
   * Performance optimization: Only registers tool definitions (metadata), does not load heavy modules
   * Heavy tool definitions use static metadata; actual modules are loaded at execution time
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    console.time('[BuiltinToolsManager] initialize');
    
    try {
      // ===== Lightweight tools (register immediately) =====
      
      // Register ReadFileTool
      const readFileTool = ReadFileTool.getDefinition();
      this.tools.set('read_file', readFileTool);

      // Register ReadHtmlTool (HTML-specific safe reading)
      const readHtmlTool = ReadHtmlTool.getDefinition();
      this.tools.set('read_html', readHtmlTool);

      // Register WriteFileTool (unified file writing tool, supports create, overwrite, append, and other modes)
      const writeFileTool = WriteFileTool.getDefinition();
      this.tools.set('write_file', writeFileTool);
      
      // Register SearchTextInFilesTool (search file contents)
      const searchTextInFilesTool = SearchTextInFilesTool.getDefinition();
      this.tools.set('search_text_in_files', searchTextInFilesTool);

      // Register SearchFilesTool (search file names and paths)
      const searchFilesTool = SearchFilesTool.getDefinition();
      this.tools.set('search_files', searchFilesTool);

      // Register ExecuteCommandTool
      const executeCommandTool = ExecuteCommandTool.getDefinition();
      this.tools.set('execute_command', executeCommandTool);

      // Register GetCurrentDateTimeTool
      const getCurrentDateTimeTool = GetCurrentDateTimeTool.getDefinition();
      this.tools.set('get_current_datetime', getCurrentDateTimeTool);

      // Register AddMcpByConfigTool
      const addMcpByConfigTool = AddMcpByConfigTool.getDefinition();
      this.tools.set('add_mcp_by_config', addMcpByConfigTool);

      // Register UpdateMcpByConfigTool
      const updateMcpByConfigTool = UpdateMcpByConfigTool.getDefinition();
      this.tools.set('update_mcp_by_config', updateMcpByConfigTool);

      // Register CheckMcpStatusTool
      const checkMcpStatusTool = CheckMcpStatusTool.getDefinition();
      this.tools.set('check_mcp_status', checkMcpStatusTool);

      // Register CheckSkillStatusTool
      const checkSkillStatusTool = CheckSkillStatusTool.getDefinition();
      this.tools.set('check_skill_status', checkSkillStatusTool);

      // Register AddAgentByConfigTool
      const addAgentByConfigTool = AddAgentByConfigTool.getDefinition();
      this.tools.set('add_agent_by_config', addAgentByConfigTool);

      // Register UpdateAgentByConfigTool
      const updateAgentByConfigTool = UpdateAgentByConfigTool.getDefinition();
      this.tools.set('update_agent_by_config', updateAgentByConfigTool);

      // Register CheckAgentStatusTool
      const checkAgentStatusTool = CheckAgentStatusTool.getDefinition();
      this.tools.set('check_agent_status', checkAgentStatusTool);

      // Register GetAllAgentsTool
      const getAllAgentsTool = GetAllAgentsTool.getDefinition();
      this.tools.set('get_all_agents', getAllAgentsTool);

      // Register SetPrimaryAgentTool
      const setPrimaryAgentTool = SetPrimaryAgentTool.getDefinition();
      this.tools.set('set_primary_agent', setPrimaryAgentTool);

      // Register MoveFileTool (file move tool) - protected by browserControl feature flag
      if (isFeatureEnabled('browserControl')) {
        const moveFileTool = MoveFileTool.getDefinition();
        this.tools.set('move_file', moveFileTool);
      }

      // Register PresentTool (present final deliverables)
      const presentTool = PresentTool.getDefinition();
      this.tools.set('present_deliverables', presentTool);

      // ===== Heavy tools (use static definitions, lazy load actual modules) =====
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
      // Only register metadata, don't load actual modules; dynamically imported at execution time
      
      // BingWebSearchTool - depends on playwright
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

      // BingImageSearchTool - depends on playwright
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

      // GoogleWebSearchTool - depends on playwright
      this.tools.set('google_web_search', {
        name: 'google_web_search',
        description: 'Search Google for web pages. Supports multiple queries in parallel.',
        inputSchema: {
          type: 'object',
          properties: {
            description: { type: 'string', description: 'A brief one-sentence description of what this search is for' },
            queries: { type: 'array', items: { type: 'string' }, description: 'Array of search queries' },
            maxResults: { type: 'number', description: 'Max results per query (default 5)' },
            timeout: { type: 'number', description: 'Timeout in seconds (default 60)' }
          },
          required: ['description', 'queries']
        }
      });

      // GoogleImageSearchTool - depends on playwright
      this.tools.set('google_image_search', {
        name: 'google_image_search',
        description: 'Search Google for images. Supports multiple queries in parallel.',
        inputSchema: {
          type: 'object',
          properties: {
            description: { type: 'string', description: 'A brief one-sentence description of what this search is for' },
            queries: { type: 'array', items: { type: 'string' }, description: 'Array of search queries' },
            maxResults: { type: 'number', description: 'Max results per query (default 5)' },
            timeout: { type: 'number', description: 'Timeout in seconds (default 60)' }
          },
          required: ['description', 'queries']
        }
      });

      // FetchWebContentTool - depends on node-html-parser
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

      // ReadOfficeFileTool - depends on mammoth, etc.
      this.tools.set('read_office_file', {
        name: 'read_office_file',
        description: 'Read and extract text content from Office files (docx, xlsx, pptx, pdf).',
        inputSchema: {
          type: 'object',
          properties: {
            filePath: { type: 'string', description: 'Path to the Office file' }
          },
          required: ['filePath']
        }
      });

      // DownloadAndSaveAsTool - may depend on network modules
      this.tools.set('download_and_save_as', {
        name: 'download_and_save_as',
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

      // Edge Build/Test tools - depends on edge environment modules
      this.tools.set('edge_init_environment', {
        name: 'edge_init_environment',
        description: 'Initialize the Edge Chromium development environment. Sets up depot_tools, runs gclient sync, and prepares the build environment. Must be called before using edge_build_target or edge_run_tests.',
        inputSchema: {
          type: 'object',
          properties: {
            repoPath: { type: 'string', description: 'Absolute path to the Edge Chromium repository root (e.g., "D:\\\\edge\\\\src")' },
            buildPath: { type: 'string', description: 'Optional build output directory name relative to <repoPath>/out/ (default: "debug_x64")' }
          },
          required: ['repoPath']
        }
      });

      this.tools.set('edge_build_target', {
        name: 'edge_build_target',
        description: 'Build an Edge Chromium target using autoninja. The Edge environment must be initialized first via edge_init_environment.',
        inputSchema: {
          type: 'object',
          properties: {
            buildTarget: { type: 'string', description: 'Build target to compile (e.g., "components_unittests", "unit_tests", "chrome")' }
          },
          required: ['buildTarget']
        }
      });

      this.tools.set('edge_run_tests', {
        name: 'edge_run_tests',
        description: 'Run Edge Chromium gtest tests with an optional filter. The Edge environment must be initialized first via edge_init_environment.',
        inputSchema: {
          type: 'object',
          properties: {
            testTarget: { type: 'string', description: 'Test target to run (e.g., "components_unittests", "unit_tests")' },
            testFilter: { type: 'string', description: 'Optional gtest filter pattern (e.g., "MyTest.*", "SuiteA.TestB:SuiteC.*"). Defaults to "*" (all tests).' }
          },
          required: ['testTarget']
        }
      });

      this.tools.set('edge_get_testing_guide', {
        name: 'edge_get_testing_guide',
        description: 'Retrieve Edge/Chromium C++ unit testing guides and prompt templates. Available guides: "create_unit_tests" - Step-by-step prompt for creating unit tests; "add_unit_test" - Prompt for complex files; "add_unit_test_instructions" - Comprehensive reference guide with templates; "code_analysis" - C++ code structure analysis guide; "test_case_generation" - LLM test case generation guide; "mock_generation" - Intelligent mock generation guide.',
        inputSchema: {
          type: 'object',
          properties: {
            guide: {
              type: 'string',
              enum: ['create_unit_tests', 'add_unit_test', 'add_unit_test_instructions', 'code_analysis', 'test_case_generation', 'mock_generation'],
              description: 'The guide/prompt to retrieve'
            }
          },
          required: ['guide']
        }
      });

      // ToggleMcpByNameTool - depends on mcpClientManager
      this.tools.set('toggle_mcp_by_name', {
        name: 'toggle_mcp_by_name',
        description: 'Toggle the connection state of an MCP server by its name. Supports three actions: "connect" (establish connection), "disconnect" (close connection), and "reconnect" (disconnect then connect again). Note: The builtin server cannot be toggled.',
        inputSchema: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'The name of the MCP server to toggle (e.g., "filesystem", "github", "brave-search")'
            },
            action: {
              type: 'string',
              enum: ['connect', 'disconnect', 'reconnect'],
              description: 'The action to perform: "connect" to establish connection, "disconnect" to close connection, or "reconnect" to restart connection'
            }
          },
          required: ['name', 'action']
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
   * Unified tool execution entry point with error handling and result standardization
   *
   * Performance optimization: Heavy tools dynamically import modules at execution time
   */
  async executeTool(name: string, args: any): Promise<ToolExecutionResult> {
    if (!this.isInitialized) {
      throw new Error('BuiltinToolsManager not initialized');
    }

    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Builtin tool not found: ${name}`);
    }

    console.time(`[BuiltinToolsManager] executeTool:${name}`);
    
    try {
      let result;
      
      // ===== Lightweight tools (already imported) =====
      if (name === 'read_file') {
        result = await ReadFileTool.execute(args);
      } else if (name === 'read_html') {
        result = await ReadHtmlTool.execute(args);
      } else if (name === 'write_file') {
        result = await WriteFileTool.execute(args);
      } else if (name === 'search_text_in_files') {
        result = await SearchTextInFilesTool.execute(args);
      } else if (name === 'search_files') {
        result = await SearchFilesTool.execute(args);
      } else if (name === 'execute_command') {
        result = await ExecuteCommandTool.execute(args);
      } else if (name === 'get_current_datetime') {
        result = await GetCurrentDateTimeTool.execute(args);
      } else if (name === 'add_mcp_by_config') {
        result = await AddMcpByConfigTool.execute(args);
      } else if (name === 'update_mcp_by_config') {
        result = await UpdateMcpByConfigTool.execute(args);
      } else if (name === 'check_mcp_status') {
        result = await CheckMcpStatusTool.execute(args);
      } else if (name === 'check_skill_status') {
        result = await CheckSkillStatusTool.execute(args);
      } else if (name === 'add_agent_by_config') {
        result = await AddAgentByConfigTool.execute(args);
      } else if (name === 'update_agent_by_config') {
        result = await UpdateAgentByConfigTool.execute(args);
      } else if (name === 'check_agent_status') {
        result = await CheckAgentStatusTool.execute(args);
      } else if (name === 'get_all_agents') {
        result = await GetAllAgentsTool.execute();
      } else if (name === 'set_primary_agent') {
        result = await SetPrimaryAgentTool.execute(args);
      } else if (name === 'move_file') {
        // browserControl feature flag protection
        if (!isFeatureEnabled('browserControl')) {
          return { success: false, error: 'move_file tool is not available when browserControl feature is disabled' };
        }
        result = await MoveFileTool.execute(args);
      } else if (name === 'present_deliverables') {
        result = await PresentTool.execute(args);
      }
      // ===== Heavy tools (lazy loaded) =====
      else if (name === 'bing_web_search') {
        const { BingWebSearchTool } = await import('./bingWebSearchTool');
        result = await BingWebSearchTool.execute(args);
      } else if (name === 'bing_image_search') {
        const { BingImageSearchTool } = await import('./bingImageSearchTool');
        result = await BingImageSearchTool.execute(args);
      } else if (name === 'google_web_search') {
        const { GoogleWebSearchTool } = await import('./googleWebSearchTool');
        result = await GoogleWebSearchTool.execute(args);
      } else if (name === 'google_image_search') {
        const { GoogleImageSearchTool } = await import('./googleImageSearchTool');
        result = await GoogleImageSearchTool.execute(args);
      } else if (name === 'fetch_web_content') {
        const { FetchWebContentTool } = await import('./fetchWebContentTool');
        result = await FetchWebContentTool.execute(args);
      } else if (name === 'read_office_file') {
        const { ReadOfficeFileTool } = await import('./readOfficeFileTool');
        result = await ReadOfficeFileTool.execute(args);
      } else if (name === 'download_and_save_as') {
        const { DownloadAndSaveAsTool } = await import('./downloadAndSaveAsTool');
        result = await DownloadAndSaveAsTool.execute(args);
      } else if (name === 'toggle_mcp_by_name') {
        const { ToggleMcpByNameTool } = await import('./toggleMcpByNameTool');
        result = await ToggleMcpByNameTool.execute(args);
      } else if (name === 'edge_init_environment') {
        const { EdgeInitEnvironmentTool } = await import('./edgeInitEnvironmentTool');
        result = await EdgeInitEnvironmentTool.execute(args);
      } else if (name === 'edge_build_target') {
        const { EdgeBuildTargetTool } = await import('./edgeBuildTargetTool');
        result = await EdgeBuildTargetTool.execute(args);
      } else if (name === 'edge_run_tests') {
        const { EdgeRunTestsTool } = await import('./edgeRunTestsTool');
        result = await EdgeRunTestsTool.execute(args);
      } else if (name === 'edge_get_testing_guide') {
        const { EdgeGetTestingGuideTool } = await import('./edgeGetTestingGuideTool');
        result = await EdgeGetTestingGuideTool.execute(args);
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
   * Get a specific tool's definition
   */
  getTool(name: string): BuiltinToolDefinition | undefined {
    return this.tools.get(name);
  }

  /**
   * Get detailed info of all built-in tools (MCP format compatible)
   * Returns a list of tool info compatible with the MCPTool format
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
   * Get detailed info of a specific tool (MCP format compatible)
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
 * Export the singleton instance getter function
 * Uses the getInstance() method to ensure a globally unique instance
 */
export const getBuiltinToolsManager = (): BuiltinToolsManager => {
  return BuiltinToolsManager.getInstance();
};

/**
 * Export default instance for backward compatibility
 * @deprecated Use getBuiltinToolsManager() or BuiltinToolsManager.getInstance()
 */
export const builtinToolsManager = BuiltinToolsManager.getInstance();
