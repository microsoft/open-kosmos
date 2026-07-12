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

const getBrowserDisplayText = (args: Record<string, unknown> | null): string => {
  const action = typeof args?.action === 'string' ? args.action : '';
  const str = (key: string): string =>
    typeof args?.[key] === 'string' ? (args[key] as string).trim() : '';
  const locator = (): string =>
    str('text') || str('selector') || str('name') || str('label') || str('placeholder') || str('testId');
  switch (action) {
    case 'navigate': {
      const url = str('url');
      return url ? `Opened ${url}` : 'Opened a page';
    }
    case 'open_local_file': {
      const localPath = str('localPath') || str('filePath') || str('url');
      return localPath ? `Opened local file ${localPath}` : 'Opened a local file';
    }
    case 'get_state':
      return 'Checked browser state';
    case 'back':
      return 'Went back';
    case 'forward':
      return 'Went forward';
    case 'reload':
      return 'Reloaded the page';
    case 'stop':
      return 'Stopped loading';
    case 'screenshot':
      return 'Took a screenshot';
    case 'capture_visual_baseline': {
      const target = str('baselineName');
      return target ? `Captured visual baseline: ${target}` : 'Captured visual baseline';
    }
    case 'compare_visual_baseline': {
      const target = str('baselineName');
      return target ? `Compared visual baseline: ${target}` : 'Compared visual baseline';
    }
    case 'read_page':
      return 'Read the page';
    case 'inspect':
      return 'Inspected the page';
    case 'diagnostics':
      return 'Checked browser diagnostics';
    case 'click': {
      const target = locator();
      return target ? `Clicked ${target}` : 'Clicked an element';
    }
    case 'double_click': {
      const target = locator();
      return target ? `Double-clicked ${target}` : 'Double-clicked an element';
    }
    case 'right_click': {
      const target = locator();
      return target ? `Right-clicked ${target}` : 'Right-clicked an element';
    }
    case 'type': {
      const target = locator();
      return target ? `Typed into ${target}` : 'Typed text';
    }
    case 'wait_for': {
      const target = locator();
      return target ? `Waited for ${target}` : 'Waited for the page';
    }
    case 'wait_for_url': {
      const target = str('url');
      return target ? `Waited for URL: ${target}` : 'Waited for page URL';
    }
    case 'scroll':
      return 'Scrolled the page';
    case 'press_key': {
      const key = str('key');
      return key ? `Pressed ${key}` : 'Pressed a key';
    }
    case 'hover': {
      const target = locator();
      return target ? `Hovered ${target}` : 'Hovered an element';
    }
    case 'clear': {
      const target = locator();
      return target ? `Cleared ${target}` : 'Cleared a field';
    }
    case 'select_option': {
      const target = str('value') || str('text');
      return target ? `Selected ${target}` : 'Selected an option';
    }
    case 'upload_file':
      return 'Uploaded a file';
    case 'paste':
      return 'Pasted text';
    case 'drag':
      return 'Dragged an element';
    case 'set_slider':
      return 'Set a slider';
    case 'assert_visible': {
      const target = locator();
      return target ? `Checked visibility of ${target}` : 'Checked element visibility';
    }
    case 'assert_text': {
      const target = str('text');
      return target ? `Checked text: ${target}` : 'Checked page text';
    }
    case 'assert_clickable': {
      const target = locator();
      return target ? `Checked clickability of ${target}` : 'Checked element clickability';
    }
    case 'assert_enabled': {
      const target = locator();
      return target ? `Checked enabled state of ${target}` : 'Checked element is enabled';
    }
    case 'assert_disabled': {
      const target = locator();
      return target ? `Checked disabled state of ${target}` : 'Checked element is disabled';
    }
    case 'assert_url': {
      const target = str('url');
      return target ? `Checked URL: ${target}` : 'Checked page URL';
    }
    case 'assert_not_blank':
      return 'Checked page is not blank';
    case 'assert_images_loaded':
      return 'Checked images loaded';
    case 'assert_media_rendered':
      return 'Checked media rendering';
    case 'assert_dialog_open':
      return 'Checked dialog state';
    case 'assert_toast':
      return 'Checked toast notification';
    case 'assert_table_rows':
      return 'Checked table rows';
    case 'assert_form_validity':
      return 'Checked form validity';
    case 'assert_menu_open':
      return 'Checked menu state';
    case 'assert_tooltip':
      return 'Checked tooltip';
    case 'assert_drawer_open':
      return 'Checked drawer state';
    case 'assert_list_items':
      return 'Checked list items';
    case 'assert_card_visible':
      return 'Checked card visibility';
    case 'assert_no_console_errors':
      return 'Checked browser console errors';
    case 'assert_no_network_errors':
      return 'Checked browser network errors';
    case 'accessibility_snapshot':
      return 'Captured accessibility snapshot';
    case 'set_date':
      return 'Set a date field';
    case 'multi_select':
      return 'Selected multiple options';
    case 'network_diagnostics':
      return 'Checked network diagnostics';
    case 'download_diagnostics':
      return 'Checked download diagnostics';
    case 'assert_downloaded':
      return 'Checked download completion';
    case 'inspect_frames':
      return 'Inspected frames';
    case 'layout_audit':
      return 'Audited page layout';
    default:
      return 'Used the browser';
  }
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

    // ===== Embedded browser automation =====
    case 'browser':
      return getBrowserDisplayText(args);

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

    // ===== Embedded browser automation =====
    case 'browser':
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
