// src/renderer/components/chat/toolCallDisplayConfig.ts
// Tool Call display configuration file, mapping tool names to descriptive text and icons

import { LucideIcon, Globe, FileText, FileSearch, FolderOpen, Terminal, Brain, Code, Wrench, FilePlus, FileEdit, Database, MessageSquare, Eye, Zap, Settings, Book, Image, Mail, Calendar, Link, Download, Upload, Play } from 'lucide-react';

/**
 * Tool icon type
 */
export type ToolIconType =
  | 'globe'       // Web/search
  | 'file'        // File read
  | 'file-plus'   // File create
  | 'file-edit'   // File edit
  | 'file-search' // File search
  | 'folder'      // Folder/directory
  | 'terminal'    // Command execution
  | 'code'        // Code execution
  | 'brain'       // Memory/AI
  | 'database'    // Database
  | 'message'     // Message/conversation
  | 'image'       // Image
  | 'mail'        // Email
  | 'calendar'    // Calendar
  | 'link'        // Link
  | 'download'    // Download
  | 'upload'      // Upload
  | 'play'        // Execute/play
  | 'settings'    // Settings
  | 'book'        // Documentation
  | 'eye'         // View
  | 'zap'         // Quick action
  | 'wrench';     // Default tool

/**
 * Mapping from icon type to Lucide component
 */
export const iconTypeToComponent: Record<ToolIconType, LucideIcon> = {
  'globe': Globe,
  'file': FileText,
  'file-plus': FilePlus,
  'file-edit': FileEdit,
  'file-search': FileSearch,
  'folder': FolderOpen,
  'terminal': Terminal,
  'code': Code,
  'brain': Brain,
  'database': Database,
  'message': MessageSquare,
  'image': Image,
  'mail': Mail,
  'calendar': Calendar,
  'link': Link,
  'download': Download,
  'upload': Upload,
  'play': Play,
  'settings': Settings,
  'book': Book,
  'eye': Eye,
  'zap': Zap,
  'wrench': Wrench,
};

/**
 * Safely parse a JSON string
 */
const safeParseArgs = (toolArgs?: string): Record<string, unknown> | null => {
  if (!toolArgs) return null;
  try {
    return JSON.parse(toolArgs);
  } catch {
    return null;
  }
};

/**
 * Get the description from arguments
 */
const getDescriptionFromArgs = (args: Record<string, unknown> | null): string | null => {
  if (!args) return null;
  if (args.description && typeof args.description === 'string' && args.description.trim()) {
    return args.description.trim();
  }
  return null;
};

// ===== Fallback display text generator functions for each tool =====

const getExecuteCommandDisplayText = (args: Record<string, unknown> | null): string => {
  if (args?.command && typeof args.command === 'string' && args.command.trim()) {
    return `Executed command: ${args.command.trim()}`;
  }
  return 'Executed command';
};

const getWebSearchDisplayText = (args: Record<string, unknown> | null): string => {
  if (args?.queries && Array.isArray(args.queries) && args.queries.length > 0) {
    const queriesStr = args.queries.join(', ');
    return `Searched: ${queriesStr}`;
  }
  return 'Searched the web';
};

const getImageSearchDisplayText = (args: Record<string, unknown> | null): string => {
  if (args?.queries && Array.isArray(args.queries) && args.queries.length > 0) {
    const queriesStr = args.queries.join(', ');
    return `Searched images: ${queriesStr}`;
  }
  return 'Searched images';
};

const getFetchWebContentDisplayText = (args: Record<string, unknown> | null): string => {
  if (args?.urls && Array.isArray(args.urls) && args.urls.length > 0) {
    const urlsStr = args.urls.join(', ');
    return `Fetched: ${urlsStr}`;
  }
  return 'Fetched web content';
};

const getWriteFileDisplayText = (args: Record<string, unknown> | null): string => {
  if (args?.filePath && typeof args.filePath === 'string' && args.filePath.trim()) {
    const filePath = args.filePath.trim();
    const fileName = filePath.split(/[/\\]/).pop() || filePath;
    return `Wrote file: ${fileName}`;
  }
  return 'Wrote file';
};

const getPresentDisplayText = (args: Record<string, unknown> | null): string => {
  if (args?.description && typeof args.description === 'string' && args.description.trim()) {
    return args.description.trim();
  }
  if (args?.filePaths && Array.isArray(args.filePaths) && args.filePaths.length > 0) {
    const count = args.filePaths.length;
    return count === 1 ? 'Presented 1 file' : `Presented ${count} files`;
  }
  return 'Presented deliverable';
};

const getReadFileDisplayText = (args: Record<string, unknown> | null): string => {
  if (args?.filePath && typeof args.filePath === 'string' && args.filePath.trim()) {
    const filePath = args.filePath.trim();
    const fileName = filePath.split(/[/\\]/).pop() || filePath;
    return `Read file: ${fileName}`;
  }
  return 'Read file';
};

const getReadHtmlDisplayText = (args: Record<string, unknown> | null): string => {
  if (args?.filePath && typeof args.filePath === 'string' && args.filePath.trim()) {
    const filePath = args.filePath.trim();
    const fileName = filePath.split(/[/\\]/).pop() || filePath;
    const mode = args.mode && typeof args.mode === 'string' ? ` (${args.mode})` : '';
    return `Read HTML: ${fileName}${mode}`;
  }
  return 'Read HTML';
};

const getReadOfficeFileDisplayText = (args: Record<string, unknown> | null): string => {
  if (args?.filePath && typeof args.filePath === 'string' && args.filePath.trim()) {
    const filePath = args.filePath.trim();
    const fileName = filePath.split(/[/\\]/).pop() || filePath;
    return `Read document: ${fileName}`;
  }
  return 'Read office document';
};

const getSearchFilesDisplayText = (args: Record<string, unknown> | null): string => {
  if (args?.pattern && typeof args.pattern === 'string' && args.pattern.trim()) {
    return `Searched files: ${args.pattern.trim()}`;
  }
  return 'Searched files';
};

const getSearchTextInFilesDisplayText = (args: Record<string, unknown> | null): string => {
  if (args?.patterns && Array.isArray(args.patterns) && args.patterns.length > 0) {
    const patternsStr = args.patterns.slice(0, 2).join(', ');
    const suffix = args.patterns.length > 2 ? '...' : '';
    return `Searched text: ${patternsStr}${suffix}`;
  }
  return 'Searched text in files';
};

/**
 * Get the display text for a Tool Call
 * @param toolName - tool name (function.name)
 * @param toolArgs - tool arguments (function.arguments), optional JSON string
 * @returns display text
 */
export const getToolCallDisplayText = (toolName: string, toolArgs?: string, toolResultText?: string): string => {
  const args = safeParseArgs(toolArgs);

  // Return description first (if available)
  const description = getDescriptionFromArgs(args);
  if (description) {
    return description;
  }

  // Return display text based on tool name
  switch (toolName) {
    // ===== Command execution tools =====
    case 'execute_command':
      return getExecuteCommandDisplayText(args);

    // ===== Web search tools =====
    case 'bing_web_search':
      return getWebSearchDisplayText(args);

    case 'bing_image_search':
      return getImageSearchDisplayText(args);

    case 'fetch_web_content':
      return getFetchWebContentDisplayText(args);

    // ===== File write tools =====
    case 'write_file':
      return getWriteFileDisplayText(args);

    // ===== File read tools =====
    case 'read_file':
      return getReadFileDisplayText(args);
    case 'read_html':
      return getReadHtmlDisplayText(args);
    case 'read_office_file':
      return getReadOfficeFileDisplayText(args);

    // ===== File operation tools =====
    case 'move_file':
      return 'Moved file';

    // ===== File search tools =====
    case 'search_files':
      return getSearchFilesDisplayText(args);
    case 'search_file_contents':
      return getSearchTextInFilesDisplayText(args);

    // ===== Download tools =====
    case 'download_file':
      return 'Downloaded file';

    // ===== Time tools =====
    case 'get_current_datetime':
      return 'Got current time';

    // ===== MCP management tools =====
    case 'create_mcp_server_from_config':
      return 'Added MCP server';
    case 'update_mcp_server':
      return 'Updated MCP server';
    case 'get_mcp_status':
      return 'Checked MCP status';
    case 'set_mcp_connection_state':
      return 'Toggled MCP server';

    // ===== Agent management tools =====
    case 'create_agent_from_config':
      return 'Added agent';
    case 'update_agent':
      return 'Updated agent';
    case 'get_agent_status':
      return 'Checked agent status';
    case 'list_agents':
      return 'Got all agents';
    case 'set_primary_agent':
      return 'Set primary agent';

    // ===== Skill management tools =====
    case 'search_skills': {
      if (args?.query && typeof args.query === 'string' && args.query.trim()) {
        return `Searched skills: ${args.query.trim()}`;
      }
      return 'Searched skills';
    }

    // ===== Schedule tools =====
    case 'create_schedule': {
      if (args?.name && typeof args.name === 'string' && args.name.trim()) {
        return `Created schedule: ${args.name.trim()}`;
      }
      return 'Created schedule';
    }
    case 'get_schedule':
      return 'Retrieved schedules';
    case 'update_schedule': {
      if (args?.name && typeof args.name === 'string' && args.name.trim()) {
        return `Edited schedule: ${args.name.trim()}`;
      }
      return 'Edited schedule';
    }
    case 'run_schedule':
      return 'Ran schedule';

    // ===== Present tools =====
    case 'present_deliverables':
      return getPresentDisplayText(args);

    // ===== Tool Search =====
    case 'tool_search': {
      // Parse result to get match count and total
      let matchCount: number | null = null;
      let totalCount: number | null = null;
      if (toolResultText) {
        try {
          const parsed = JSON.parse(toolResultText);
          const data = typeof parsed.data === 'string' ? JSON.parse(parsed.data) : parsed;
          if (Array.isArray(data.matches)) {
            matchCount = data.matches.length;
          }
          if (typeof data.total_deferred_tools === 'number') {
            totalCount = data.total_deferred_tools;
          }
        } catch { /* ignore */ }
      }
      const countInfo = matchCount !== null
        ? ` → found ${matchCount}${totalCount !== null ? `/${totalCount}` : ''}`
        : '';

      if (args?.query && typeof args.query === 'string' && args.query.trim()) {
        const query = args.query.trim();
        if (query.startsWith('select:')) {
          const names = query.substring(7).split(',').map((n: string) => n.trim()).filter(Boolean);
          return `Fetched tool${names.length > 1 ? 's' : ''}: ${names.join(', ')}${countInfo}`;
        }
        return `Searched tools: ${query}${countInfo}`;
      }
      return `Searched tools${countInfo}`;
    }

    // ===== Default =====
    default:
      return `Used ${toolName}`;
  }
};

/**
 * Get the summary display text for a Tool Calls Section
 * @param count - number of tool calls
 * @returns summary display text
 */
export const getToolCallsSummaryText = (count: number): string => {
  if (count === 1) {
    return 'Used 1 tool';
  }
  return `Used ${count} tools`;
};

/**
 * Get the icon type for a Tool Call
 * @param toolName - tool name (function.name)
 * @returns icon type
 */
export const getToolCallIconType = (toolName: string): ToolIconType => {
  switch (toolName) {
    // ===== Command execution tools =====
    case 'execute_command':
      return 'terminal';

    // ===== Web search tools =====
    case 'bing_web_search':
    case 'fetch_web_content':
      return 'globe';

    case 'bing_image_search':
      return 'image';

    // ===== File write tools =====
    case 'write_file':
      return 'file-edit';

    // ===== File read tools =====
    case 'read_file':
      return 'file';
    case 'read_html':
      return 'globe';
    case 'read_office_file':
      return 'book';

    // ===== File operation tools =====
    case 'move_file':
      return 'folder';

    // ===== File search tools =====
    case 'search_files':
    case 'search_file_contents':
      return 'file-search';

    // ===== Download tools =====
    case 'download_file':
      return 'download';

    // ===== Time tools =====
    case 'get_current_datetime':
      return 'calendar';

    // ===== MCP management tools =====
    case 'create_mcp_server_from_config':
    case 'update_mcp_server':
    case 'get_mcp_status':
    case 'set_mcp_connection_state':
      return 'settings';

    // ===== Agent management tools =====
    case 'create_agent_from_config':
    case 'update_agent':
    case 'get_agent_status':
    case 'list_agents':
    case 'set_primary_agent':
      return 'brain';

    // ===== Skill management tools =====
    case 'search_skills':
    case 'tool_search':
      return 'zap';

    // ===== Schedule tools =====
    case 'create_schedule':
    case 'get_schedule':
    case 'update_schedule':
    case 'run_schedule':
      return 'calendar';

    // ===== Present tools =====
    case 'present_deliverables':
      return 'eye';

    // ===== Default: infer from tool name pattern =====
    default:
      return inferIconTypeFromName(toolName);
  }
};

/**
 * Infer icon type from tool name pattern
 */
const inferIconTypeFromName = (toolName: string): ToolIconType => {
  const lowerName = toolName.toLowerCase();

  if (lowerName.includes('search') || lowerName.includes('web') || lowerName.includes('fetch')) {
    return 'globe';
  }
  if (lowerName.includes('create') || lowerName.includes('new')) {
    return 'file-plus';
  }
  if (lowerName.includes('write') || lowerName.includes('edit') || lowerName.includes('update') || lowerName.includes('modify')) {
    return 'file-edit';
  }
  if (lowerName.includes('read') || lowerName.includes('get') || lowerName.includes('view')) {
    return 'file';
  }
  if (lowerName.includes('find') || lowerName.includes('grep') || lowerName.includes('glob')) {
    return 'file-search';
  }
  if (lowerName.includes('list') || lowerName.includes('dir') || lowerName.includes('folder')) {
    return 'folder';
  }
  if (lowerName.includes('command') || lowerName.includes('exec') || lowerName.includes('run') || lowerName.includes('shell') || lowerName.includes('bash') || lowerName.includes('terminal')) {
    return 'terminal';
  }
  if (lowerName.includes('code') || lowerName.includes('python') || lowerName.includes('script')) {
    return 'code';
  }
  if (lowerName.includes('memory') || lowerName.includes('remember')) {
    return 'brain';
  }
  if (lowerName.includes('database') || lowerName.includes('sql') || lowerName.includes('query')) {
    return 'database';
  }
  if (lowerName.includes('image') || lowerName.includes('photo') || lowerName.includes('picture')) {
    return 'image';
  }
  if (lowerName.includes('message') || lowerName.includes('chat') || lowerName.includes('send')) {
    return 'message';
  }
  if (lowerName.includes('download')) {
    return 'download';
  }
  if (lowerName.includes('upload')) {
    return 'upload';
  }

  return 'wrench';
};

/**
 * Get the icon component for a Tool Call
 * @param toolName - tool name (function.name)
 * @returns Lucide icon component
 */
export const getToolCallIcon = (toolName: string): LucideIcon => {
  const iconType = getToolCallIconType(toolName);
  return iconTypeToComponent[iconType];
};
