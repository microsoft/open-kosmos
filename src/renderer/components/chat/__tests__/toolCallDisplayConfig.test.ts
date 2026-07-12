/**
 * Tests for toolCallDisplayConfig.ts — full branch coverage
 */

import { describe, it, expect } from 'vitest';
import {
  iconTypeToComponent,
  getToolCallDisplayText,
  getToolCallsSummaryText,
  getToolCallIconType,
  getToolCallIcon,
  ToolIconType,
} from '../toolCallDisplayConfig';
import {
  Globe, FileText, FilePlus, FileEdit, FileSearch, FolderOpen,
  Terminal, Code, Brain, Database, MessageSquare, Image,
  Mail, Calendar, Link, Download, Upload, Play, Settings, Book, Eye, Zap, Wrench,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// iconTypeToComponent
// ---------------------------------------------------------------------------
describe('iconTypeToComponent', () => {
  const cases: [ToolIconType, any][] = [
    ['globe', Globe],
    ['file', FileText],
    ['file-plus', FilePlus],
    ['file-edit', FileEdit],
    ['file-search', FileSearch],
    ['folder', FolderOpen],
    ['terminal', Terminal],
    ['code', Code],
    ['brain', Brain],
    ['database', Database],
    ['message', MessageSquare],
    ['image', Image],
    ['mail', Mail],
    ['calendar', Calendar],
    ['link', Link],
    ['download', Download],
    ['upload', Upload],
    ['play', Play],
    ['settings', Settings],
    ['book', Book],
    ['eye', Eye],
    ['zap', Zap],
    ['wrench', Wrench],
  ];

  it.each(cases)('maps %s → correct Lucide component', (type, component) => {
    expect(iconTypeToComponent[type]).toBe(component);
  });
});

// ---------------------------------------------------------------------------
// getToolCallDisplayText — description shortcut
// ---------------------------------------------------------------------------
describe('getToolCallDisplayText — description field', () => {
  it('returns description when present and non-empty', () => {
    const args = JSON.stringify({ description: '  My description  ' });
    expect(getToolCallDisplayText('execute_command', args)).toBe('My description');
  });

  describe('present', () => {
    it('uses a non-empty present description', () => {
      expect(getToolCallDisplayText('present_deliverables', JSON.stringify({ description: '  Demo ready  ' })))
        .toBe('Demo ready');
    });
  });

  it('ignores description when empty/whitespace', () => {
    const args = JSON.stringify({ description: '   ' });
    expect(getToolCallDisplayText('execute_command', args)).toBe('Executed command');
  });

  it('ignores description when not a string', () => {
    const args = JSON.stringify({ description: 42 });
    expect(getToolCallDisplayText('execute_command', args)).toBe('Executed command');
  });
});

// ---------------------------------------------------------------------------
// safeParseArgs branches
// ---------------------------------------------------------------------------
describe('getToolCallDisplayText — arg parsing', () => {
  it('handles undefined toolArgs gracefully', () => {
    expect(getToolCallDisplayText('execute_command', undefined)).toBe('Executed command');
  });

  it('handles invalid JSON gracefully', () => {
    expect(getToolCallDisplayText('execute_command', 'not-json')).toBe('Executed command');
  });
});

// ---------------------------------------------------------------------------
// execute_command
// ---------------------------------------------------------------------------
describe('execute_command', () => {
  it('includes trimmed command in text', () => {
    expect(getToolCallDisplayText('execute_command', JSON.stringify({ command: '  ls -la  ' })))
      .toBe('Executed command: ls -la');
  });

  it('falls back when command missing', () => {
    expect(getToolCallDisplayText('execute_command', JSON.stringify({}))).toBe('Executed command');
  });

  it('falls back when command is not a string', () => {
    expect(getToolCallDisplayText('execute_command', JSON.stringify({ command: 99 }))).toBe('Executed command');
  });
});

// ---------------------------------------------------------------------------
// bing_web_search
// ---------------------------------------------------------------------------
describe('bing_web_search', () => {
  it('joins queries', () => {
    expect(getToolCallDisplayText('bing_web_search', JSON.stringify({ queries: ['a', 'b'] })))
      .toBe('Searched: a, b');
  });

  it('falls back when queries empty', () => {
    expect(getToolCallDisplayText('bing_web_search', JSON.stringify({ queries: [] }))).toBe('Searched the web');
  });

  it('falls back when queries missing', () => {
    expect(getToolCallDisplayText('bing_web_search', JSON.stringify({}))).toBe('Searched the web');
  });

  it('falls back when queries not array', () => {
    expect(getToolCallDisplayText('bing_web_search', JSON.stringify({ queries: 'q' }))).toBe('Searched the web');
  });
});

// ---------------------------------------------------------------------------
// bing_image_search
// ---------------------------------------------------------------------------
describe('bing_image_search', () => {
  it('joins queries', () => {
    expect(getToolCallDisplayText('bing_image_search', JSON.stringify({ queries: ['cat'] })))
      .toBe('Searched images: cat');
  });

  it('falls back when no queries', () => {
    expect(getToolCallDisplayText('bing_image_search', JSON.stringify({}))).toBe('Searched images');
  });
});

// ---------------------------------------------------------------------------
// fetch_web_content
// ---------------------------------------------------------------------------
describe('fetch_web_content', () => {
  it('joins urls', () => {
    expect(getToolCallDisplayText('fetch_web_content', JSON.stringify({ urls: ['http://a.com', 'http://b.com'] })))
      .toBe('Fetched: http://a.com, http://b.com');
  });

  it('falls back when no urls', () => {
    expect(getToolCallDisplayText('fetch_web_content', JSON.stringify({}))).toBe('Fetched web content');
  });
});

// ---------------------------------------------------------------------------
// browser (embedded browser automation) — one case per action arm
// ---------------------------------------------------------------------------
describe('browser', () => {
  it('navigate with url', () => {
    expect(getToolCallDisplayText('browser', JSON.stringify({ action: 'navigate', url: 'https://x.test' })))
      .toBe('Opened https://x.test');
  });

  it('navigate without url falls back', () => {
    expect(getToolCallDisplayText('browser', JSON.stringify({ action: 'navigate' }))).toBe('Opened a page');
  });

  it('screenshot', () => {
    expect(getToolCallDisplayText('browser', JSON.stringify({ action: 'screenshot' }))).toBe('Took a screenshot');
  });

  it('read_page', () => {
    expect(getToolCallDisplayText('browser', JSON.stringify({ action: 'read_page' }))).toBe('Read the page');
  });

  it('click with text', () => {
    expect(getToolCallDisplayText('browser', JSON.stringify({ action: 'click', text: 'Submit' })))
      .toBe('Clicked Submit');
  });

  it('click falls back to selector when no text', () => {
    expect(getToolCallDisplayText('browser', JSON.stringify({ action: 'click', selector: '#go' })))
      .toBe('Clicked #go');
  });

  it('click without target falls back', () => {
    expect(getToolCallDisplayText('browser', JSON.stringify({ action: 'click' }))).toBe('Clicked an element');
  });

  it('type with selector', () => {
    expect(getToolCallDisplayText('browser', JSON.stringify({ action: 'type', selector: '#name' })))
      .toBe('Typed into #name');
  });

  it('type without selector falls back', () => {
    expect(getToolCallDisplayText('browser', JSON.stringify({ action: 'type' }))).toBe('Typed text');
  });

  it('wait_for with text', () => {
    expect(getToolCallDisplayText('browser', JSON.stringify({ action: 'wait_for', text: 'Ready' })))
      .toBe('Waited for Ready');
  });

  it('wait_for falls back to selector when no text', () => {
    expect(getToolCallDisplayText('browser', JSON.stringify({ action: 'wait_for', selector: '.spinner' })))
      .toBe('Waited for .spinner');
  });

  it('wait_for without target falls back', () => {
    expect(getToolCallDisplayText('browser', JSON.stringify({ action: 'wait_for' }))).toBe('Waited for the page');
  });

  it('unknown action falls back', () => {
    expect(getToolCallDisplayText('browser', JSON.stringify({ action: 'frobnicate' }))).toBe('Used the browser');
  });

  it('missing action falls back', () => {
    expect(getToolCallDisplayText('browser', JSON.stringify({}))).toBe('Used the browser');
  });

  it('non-string action arg falls back', () => {
    expect(getToolCallDisplayText('browser', JSON.stringify({ action: 42 }))).toBe('Used the browser');
  });

  it.each([
    [{ action: 'open_local_file', localPath: '/tmp/report.html' }, 'Opened local file /tmp/report.html'],
    [{ action: 'open_local_file' }, 'Opened a local file'],
    [{ action: 'get_state' }, 'Checked browser state'],
    [{ action: 'back' }, 'Went back'],
    [{ action: 'forward' }, 'Went forward'],
    [{ action: 'reload' }, 'Reloaded the page'],
    [{ action: 'stop' }, 'Stopped loading'],
    [{ action: 'capture_visual_baseline', baselineName: 'home' }, 'Captured visual baseline: home'],
    [{ action: 'capture_visual_baseline' }, 'Captured visual baseline'],
    [{ action: 'compare_visual_baseline', baselineName: 'home' }, 'Compared visual baseline: home'],
    [{ action: 'compare_visual_baseline' }, 'Compared visual baseline'],
    [{ action: 'inspect' }, 'Inspected the page'],
    [{ action: 'diagnostics' }, 'Checked browser diagnostics'],
    [{ action: 'double_click', name: 'Submit' }, 'Double-clicked Submit'],
    [{ action: 'double_click' }, 'Double-clicked an element'],
    [{ action: 'right_click', label: 'Options' }, 'Right-clicked Options'],
    [{ action: 'right_click' }, 'Right-clicked an element'],
    [{ action: 'wait_for_url', url: '/settings' }, 'Waited for URL: /settings'],
    [{ action: 'wait_for_url' }, 'Waited for page URL'],
    [{ action: 'scroll' }, 'Scrolled the page'],
    [{ action: 'press_key', key: 'Enter' }, 'Pressed Enter'],
    [{ action: 'press_key' }, 'Pressed a key'],
    [{ action: 'hover', placeholder: 'Search' }, 'Hovered Search'],
    [{ action: 'hover' }, 'Hovered an element'],
    [{ action: 'clear', testId: 'name' }, 'Cleared name'],
    [{ action: 'clear' }, 'Cleared a field'],
    [{ action: 'select_option', value: 'US' }, 'Selected US'],
    [{ action: 'select_option' }, 'Selected an option'],
    [{ action: 'upload_file' }, 'Uploaded a file'],
    [{ action: 'paste' }, 'Pasted text'],
    [{ action: 'drag' }, 'Dragged an element'],
    [{ action: 'set_slider' }, 'Set a slider'],
    [{ action: 'assert_visible', selector: '#panel' }, 'Checked visibility of #panel'],
    [{ action: 'assert_visible' }, 'Checked element visibility'],
    [{ action: 'assert_text', text: 'Saved' }, 'Checked text: Saved'],
    [{ action: 'assert_text' }, 'Checked page text'],
    [{ action: 'assert_clickable', text: 'Save' }, 'Checked clickability of Save'],
    [{ action: 'assert_clickable' }, 'Checked element clickability'],
    [{ action: 'assert_enabled', selector: '#save' }, 'Checked enabled state of #save'],
    [{ action: 'assert_enabled' }, 'Checked element is enabled'],
    [{ action: 'assert_disabled', selector: '#save' }, 'Checked disabled state of #save'],
    [{ action: 'assert_disabled' }, 'Checked element is disabled'],
    [{ action: 'assert_url', url: '/done' }, 'Checked URL: /done'],
    [{ action: 'assert_url' }, 'Checked page URL'],
    [{ action: 'assert_not_blank' }, 'Checked page is not blank'],
    [{ action: 'assert_images_loaded' }, 'Checked images loaded'],
    [{ action: 'assert_media_rendered' }, 'Checked media rendering'],
    [{ action: 'assert_dialog_open' }, 'Checked dialog state'],
    [{ action: 'assert_toast' }, 'Checked toast notification'],
    [{ action: 'assert_table_rows' }, 'Checked table rows'],
    [{ action: 'assert_form_validity' }, 'Checked form validity'],
    [{ action: 'assert_menu_open' }, 'Checked menu state'],
    [{ action: 'assert_tooltip' }, 'Checked tooltip'],
    [{ action: 'assert_drawer_open' }, 'Checked drawer state'],
    [{ action: 'assert_list_items' }, 'Checked list items'],
    [{ action: 'assert_card_visible' }, 'Checked card visibility'],
    [{ action: 'assert_no_console_errors' }, 'Checked browser console errors'],
    [{ action: 'assert_no_network_errors' }, 'Checked browser network errors'],
    [{ action: 'accessibility_snapshot' }, 'Captured accessibility snapshot'],
    [{ action: 'set_date' }, 'Set a date field'],
    [{ action: 'multi_select' }, 'Selected multiple options'],
    [{ action: 'network_diagnostics' }, 'Checked network diagnostics'],
    [{ action: 'download_diagnostics' }, 'Checked download diagnostics'],
    [{ action: 'assert_downloaded' }, 'Checked download completion'],
    [{ action: 'inspect_frames' }, 'Inspected frames'],
    [{ action: 'layout_audit' }, 'Audited page layout'],
  ])('formats browser action %j', (args, expected) => {
    expect(getToolCallDisplayText('browser', JSON.stringify(args))).toBe(expected);
  });

  it('icon type → globe', () => {
    expect(getToolCallIconType('browser')).toBe('globe');
  });
});

// ---------------------------------------------------------------------------
// write_file
// ---------------------------------------------------------------------------
describe('write_file', () => {
  it('extracts filename from unix path', () => {
    expect(getToolCallDisplayText('write_file', JSON.stringify({ filePath: '/home/user/out.txt' })))
      .toBe('Wrote file: out.txt');
  });

  it('extracts filename from windows path', () => {
    expect(getToolCallDisplayText('write_file', JSON.stringify({ filePath: 'C:\\Users\\foo\\bar.ts' })))
      .toBe('Wrote file: bar.ts');
  });

  it('uses filePath directly when no separator', () => {
    expect(getToolCallDisplayText('write_file', JSON.stringify({ filePath: 'file.txt' })))
      .toBe('Wrote file: file.txt');
  });

  it('falls back when no filePath', () => {
    expect(getToolCallDisplayText('write_file', JSON.stringify({}))).toBe('Wrote file');
  });
});

// ---------------------------------------------------------------------------
// read_file
// ---------------------------------------------------------------------------
describe('read_file', () => {
  it('extracts filename', () => {
    expect(getToolCallDisplayText('read_file', JSON.stringify({ filePath: '/a/b/c.py' })))
      .toBe('Read file: c.py');
  });

  it('falls back', () => {
    expect(getToolCallDisplayText('read_file', JSON.stringify({}))).toBe('Read file');
  });
});

// ---------------------------------------------------------------------------
// read_html
// ---------------------------------------------------------------------------
describe('read_html', () => {
  it('includes mode when present', () => {
    expect(getToolCallDisplayText('read_html', JSON.stringify({ filePath: '/x/page.html', mode: 'raw' })))
      .toBe('Read HTML: page.html (raw)');
  });

  it('omits mode when missing', () => {
    expect(getToolCallDisplayText('read_html', JSON.stringify({ filePath: '/x/page.html' })))
      .toBe('Read HTML: page.html');
  });

  it('falls back when no filePath', () => {
    expect(getToolCallDisplayText('read_html', JSON.stringify({}))).toBe('Read HTML');
  });

  it('mode ignored when not a string', () => {
    expect(getToolCallDisplayText('read_html', JSON.stringify({ filePath: 'a.html', mode: 42 })))
      .toBe('Read HTML: a.html');
  });
});

// ---------------------------------------------------------------------------
// read_office_file
// ---------------------------------------------------------------------------
describe('read_office_file', () => {
  it('extracts filename', () => {
    expect(getToolCallDisplayText('read_office_file', JSON.stringify({ filePath: '/docs/report.docx' })))
      .toBe('Read document: report.docx');
  });

  it('falls back', () => {
    expect(getToolCallDisplayText('read_office_file', JSON.stringify({}))).toBe('Read office document');
  });
});

// ---------------------------------------------------------------------------
// move_file / download_file / get_current_datetime
// ---------------------------------------------------------------------------
describe('static-text tools', () => {
  it('move_file', () => expect(getToolCallDisplayText('move_file')).toBe('Moved file'));
  it('download_file', () => expect(getToolCallDisplayText('download_file')).toBe('Downloaded file'));
  it('get_current_datetime', () => expect(getToolCallDisplayText('get_current_datetime')).toBe('Got current time'));
});

// ---------------------------------------------------------------------------
// search_files
// ---------------------------------------------------------------------------
describe('search_files', () => {
  it('includes pattern', () => {
    expect(getToolCallDisplayText('search_files', JSON.stringify({ pattern: '*.ts' })))
      .toBe('Searched files: *.ts');
  });

  it('falls back when no pattern', () => {
    expect(getToolCallDisplayText('search_files', JSON.stringify({}))).toBe('Searched files');
  });
});

// ---------------------------------------------------------------------------
// search_file_contents
// ---------------------------------------------------------------------------
describe('search_file_contents', () => {
  it('includes up to 2 patterns with ellipsis', () => {
    expect(getToolCallDisplayText('search_file_contents', JSON.stringify({ patterns: ['a', 'b', 'c'] })))
      .toBe('Searched text: a, b...');
  });

  it('includes exactly 2 patterns without ellipsis', () => {
    expect(getToolCallDisplayText('search_file_contents', JSON.stringify({ patterns: ['x', 'y'] })))
      .toBe('Searched text: x, y');
  });

  it('falls back when patterns empty', () => {
    expect(getToolCallDisplayText('search_file_contents', JSON.stringify({ patterns: [] }))).toBe('Searched text in files');
  });

  it('falls back when patterns missing', () => {
    expect(getToolCallDisplayText('search_file_contents', JSON.stringify({}))).toBe('Searched text in files');
  });
});

// ---------------------------------------------------------------------------
// MCP management tools
// ---------------------------------------------------------------------------
describe('mcp management tools', () => {
  it('create_mcp_server_from_config', () =>
    expect(getToolCallDisplayText('create_mcp_server_from_config')).toBe('Added MCP server'));
  it('update_mcp_server', () =>
    expect(getToolCallDisplayText('update_mcp_server')).toBe('Updated MCP server'));
  it('get_mcp_status', () =>
    expect(getToolCallDisplayText('get_mcp_status')).toBe('Checked MCP status'));
  it('set_mcp_connection_state', () =>
    expect(getToolCallDisplayText('set_mcp_connection_state')).toBe('Toggled MCP server'));
});

// ---------------------------------------------------------------------------
// Agent management tools
// ---------------------------------------------------------------------------
describe('agent management tools', () => {
  it('create_agent_from_config', () =>
    expect(getToolCallDisplayText('create_agent_from_config')).toBe('Added agent'));
  it('update_agent', () =>
    expect(getToolCallDisplayText('update_agent')).toBe('Updated agent'));
  it('get_agent_status', () =>
    expect(getToolCallDisplayText('get_agent_status')).toBe('Checked agent status'));
  it('list_agents', () =>
    expect(getToolCallDisplayText('list_agents')).toBe('Got all agents'));
  it('set_primary_agent', () =>
    expect(getToolCallDisplayText('set_primary_agent')).toBe('Set primary agent'));
});

// ---------------------------------------------------------------------------
// search_skills
// ---------------------------------------------------------------------------
describe('search_skills', () => {
  it('includes query', () => {
    expect(getToolCallDisplayText('search_skills', JSON.stringify({ query: 'typescript' })))
      .toBe('Searched skills: typescript');
  });

  it('falls back when no query', () => {
    expect(getToolCallDisplayText('search_skills', JSON.stringify({}))).toBe('Searched skills');
  });
});

// ---------------------------------------------------------------------------
// schedule tools
// ---------------------------------------------------------------------------
describe('schedule tools', () => {
  it('create_schedule with name', () => {
    expect(getToolCallDisplayText('create_schedule', JSON.stringify({ name: 'Daily' })))
      .toBe('Created schedule: Daily');
  });

  it('create_schedule without name', () => {
    expect(getToolCallDisplayText('create_schedule', JSON.stringify({}))).toBe('Created schedule');
  });

  it('get_schedule', () =>
    expect(getToolCallDisplayText('get_schedule')).toBe('Retrieved schedules'));

  it('update_schedule with name', () => {
    expect(getToolCallDisplayText('update_schedule', JSON.stringify({ name: 'Weekly' })))
      .toBe('Edited schedule: Weekly');
  });

  it('update_schedule without name', () => {
    expect(getToolCallDisplayText('update_schedule', JSON.stringify({}))).toBe('Edited schedule');
  });

  it('run_schedule', () =>
    expect(getToolCallDisplayText('run_schedule')).toBe('Ran schedule'));
});

// ---------------------------------------------------------------------------
// present_deliverables
// ---------------------------------------------------------------------------
describe('present_deliverables', () => {
  it('uses description when present', () => {
    expect(getToolCallDisplayText('present_deliverables', JSON.stringify({ description: 'Final report' })))
      .toBe('Final report');
  });

  it('uses filePaths count (singular)', () => {
    expect(getToolCallDisplayText('present_deliverables', JSON.stringify({ filePaths: ['a.txt'] })))
      .toBe('Presented 1 file');
  });

  it('uses filePaths count (plural)', () => {
    expect(getToolCallDisplayText('present_deliverables', JSON.stringify({ filePaths: ['a.txt', 'b.txt'] })))
      .toBe('Presented 2 files');
  });

  it('falls back when no args', () => {
    expect(getToolCallDisplayText('present_deliverables', JSON.stringify({}))).toBe('Presented deliverable');
  });
});

// ---------------------------------------------------------------------------
// tool_search
// ---------------------------------------------------------------------------
describe('tool_search', () => {
  it('with query and result text containing matches and total', () => {
    const toolResult = JSON.stringify({ data: JSON.stringify({ matches: ['a', 'b'], total_deferred_tools: 10 }) });
    expect(getToolCallDisplayText('tool_search', JSON.stringify({ query: 'my query' }), toolResult))
      .toBe('Searched tools: my query → found 2/10');
  });

  it('with select: prefix (singular)', () => {
    expect(getToolCallDisplayText('tool_search', JSON.stringify({ query: 'select:toolA' })))
      .toBe('Fetched tool: toolA');
  });

  it('with select: prefix (plural)', () => {
    expect(getToolCallDisplayText('tool_search', JSON.stringify({ query: 'select:toolA, toolB' })))
      .toBe('Fetched tools: toolA, toolB');
  });

  it('with query, matches but no total', () => {
    const toolResult = JSON.stringify({ data: JSON.stringify({ matches: ['x'] }) });
    expect(getToolCallDisplayText('tool_search', JSON.stringify({ query: 'stuff' }), toolResult))
      .toBe('Searched tools: stuff → found 1');
  });

  it('with query, result is direct object (non-nested data)', () => {
    const toolResult = JSON.stringify({ matches: ['x'], total_deferred_tools: 5 });
    expect(getToolCallDisplayText('tool_search', JSON.stringify({ query: 'q' }), toolResult))
      .toBe('Searched tools: q → found 1/5');
  });

  it('without query', () => {
    expect(getToolCallDisplayText('tool_search', JSON.stringify({}))).toBe('Searched tools');
  });

  it('without query but with result', () => {
    const toolResult = JSON.stringify({ data: JSON.stringify({ matches: ['a', 'b'] }) });
    expect(getToolCallDisplayText('tool_search', JSON.stringify({}), toolResult)).toBe('Searched tools → found 2');
  });

  it('with invalid result JSON', () => {
    expect(getToolCallDisplayText('tool_search', JSON.stringify({ query: 'x' }), 'bad json'))
      .toBe('Searched tools: x');
  });

  it('with no args at all', () => {
    expect(getToolCallDisplayText('tool_search')).toBe('Searched tools');
  });
});

// ---------------------------------------------------------------------------
// default case
// ---------------------------------------------------------------------------
describe('default case', () => {
  it('uses tool name', () => {
    expect(getToolCallDisplayText('some_custom_tool')).toBe('Used some_custom_tool');
  });
});

// ---------------------------------------------------------------------------
// getToolCallsSummaryText
// ---------------------------------------------------------------------------
describe('getToolCallsSummaryText', () => {
  it('returns singular for count 1', () => {
    expect(getToolCallsSummaryText(1)).toBe('Used 1 tool');
  });

  it('returns plural for count > 1', () => {
    expect(getToolCallsSummaryText(3)).toBe('Used 3 tools');
  });

  it('returns plural for count 0', () => {
    expect(getToolCallsSummaryText(0)).toBe('Used 0 tools');
  });
});

// ---------------------------------------------------------------------------
// getToolCallIconType — explicit mappings
// ---------------------------------------------------------------------------
describe('getToolCallIconType — explicit mappings', () => {
  const cases: [string, ToolIconType][] = [
    ['execute_command', 'terminal'],
    ['bing_web_search', 'globe'],
    ['fetch_web_content', 'globe'],
    ['bing_image_search', 'image'],
    ['write_file', 'file-edit'],
    ['read_file', 'file'],
    ['read_html', 'globe'],
    ['read_office_file', 'book'],
    ['move_file', 'folder'],
    ['search_files', 'file-search'],
    ['search_file_contents', 'file-search'],
    ['download_file', 'download'],
    ['get_current_datetime', 'calendar'],
    ['create_mcp_server_from_config', 'settings'],
    ['update_mcp_server', 'settings'],
    ['get_mcp_status', 'settings'],
    ['set_mcp_connection_state', 'settings'],
    ['create_agent_from_config', 'brain'],
    ['update_agent', 'brain'],
    ['get_agent_status', 'brain'],
    ['list_agents', 'brain'],
    ['set_primary_agent', 'brain'],
    ['search_skills', 'zap'],
    ['tool_search', 'zap'],
    ['create_schedule', 'calendar'],
    ['get_schedule', 'calendar'],
    ['update_schedule', 'calendar'],
    ['run_schedule', 'calendar'],
    ['present_deliverables', 'eye'],
  ];

  it.each(cases)('%s → %s', (tool, expected) => {
    expect(getToolCallIconType(tool)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// inferIconTypeFromName — pattern matching
// ---------------------------------------------------------------------------
describe('inferIconTypeFromName via getToolCallIconType default', () => {
  it('search → globe', () => expect(getToolCallIconType('my_search_tool')).toBe('globe'));
  it('web → globe', () => expect(getToolCallIconType('web_scraper')).toBe('globe'));
  it('fetch → globe', () => expect(getToolCallIconType('fetch_data')).toBe('globe'));
  it('create → file-plus', () => expect(getToolCallIconType('create_item')).toBe('file-plus'));
  it('new → file-plus', () => expect(getToolCallIconType('new_record')).toBe('file-plus'));
  it('write → file-edit', () => expect(getToolCallIconType('write_log')).toBe('file-edit'));
  it('edit → file-edit', () => expect(getToolCallIconType('edit_config')).toBe('file-edit'));
  it('update → file-edit', () => expect(getToolCallIconType('update_record')).toBe('file-edit'));
  it('modify → file-edit', () => expect(getToolCallIconType('modify_file')).toBe('file-edit'));
  it('read → file', () => expect(getToolCallIconType('read_config')).toBe('file'));
  it('get → file', () => expect(getToolCallIconType('get_config')).toBe('file'));
  it('view → file', () => expect(getToolCallIconType('view_data')).toBe('file'));
  it('find → file-search', () => expect(getToolCallIconType('find_files')).toBe('file-search'));
  it('grep → file-search', () => expect(getToolCallIconType('grep_files')).toBe('file-search'));
  it('glob → file-search', () => expect(getToolCallIconType('glob_match')).toBe('file-search'));
  it('list → folder', () => expect(getToolCallIconType('list_dir')).toBe('folder'));
  it('dir → folder', () => expect(getToolCallIconType('show_dir')).toBe('folder'));
  it('folder → folder', () => expect(getToolCallIconType('open_folder')).toBe('folder'));
  it('command → terminal', () => expect(getToolCallIconType('run_command')).toBe('terminal'));
  it('exec → terminal', () => expect(getToolCallIconType('exec_process')).toBe('terminal'));
  it('run → terminal', () => expect(getToolCallIconType('run_script')).toBe('terminal'));
  it('shell → terminal', () => expect(getToolCallIconType('shell_cmd')).toBe('terminal'));
  it('bash → terminal', () => expect(getToolCallIconType('bash_exec')).toBe('terminal'));
  it('terminal → terminal', () => expect(getToolCallIconType('terminal_cmd')).toBe('terminal'));
  it('code → code', () => expect(getToolCallIconType('code_eval')).toBe('code'));
  it('python → code', () => expect(getToolCallIconType('python_code')).toBe('code'));
  it('script → code', () => expect(getToolCallIconType('my_script')).toBe('code')); // 'script' matches code
  it('memory → brain', () => expect(getToolCallIconType('memory_store')).toBe('brain'));
  it('remember → brain', () => expect(getToolCallIconType('remember_fact')).toBe('brain'));
  it('database → database', () => expect(getToolCallIconType('database_query')).toBe('database'));
  it('sql → database', () => expect(getToolCallIconType('run_sql')).toBe('terminal')); // 'run' matches terminal before 'sql'
  it('query → database', () => expect(getToolCallIconType('query_db')).toBe('database'));
  it('image → image', () => expect(getToolCallIconType('image_gen')).toBe('image'));
  it('photo → image', () => expect(getToolCallIconType('photo_upload')).toBe('image'));
  it('picture → image', () => expect(getToolCallIconType('picture_show')).toBe('image'));
  it('message → message', () => expect(getToolCallIconType('send_message')).toBe('message'));
  it('chat → message', () => expect(getToolCallIconType('chat_send')).toBe('message'));
  it('send → message', () => expect(getToolCallIconType('send_data')).toBe('message'));
  it('download → download', () => expect(getToolCallIconType('download_assets')).toBe('download'));
  it('upload → upload', () => expect(getToolCallIconType('upload_data')).toBe('upload'));
  it('unknown → wrench', () => expect(getToolCallIconType('some_random_tool')).toBe('wrench'));
});

// ---------------------------------------------------------------------------
// getToolCallIcon
// ---------------------------------------------------------------------------
describe('getToolCallIcon', () => {
  it('returns the correct Lucide component for a known tool', () => {
    expect(getToolCallIcon('execute_command')).toBe(Terminal);
  });

  it('returns Wrench for unknown tool', () => {
    expect(getToolCallIcon('completely_unknown')).toBe(Wrench);
  });

  it('returns Globe for bing_web_search', () => {
    expect(getToolCallIcon('bing_web_search')).toBe(Globe);
  });
});
