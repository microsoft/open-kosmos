import type { BuiltinToolDefinition } from './types';

/**
 * Metadata-only definition for the `browser` built-in tool (agent control of the
 * in-app embedded browser). Kept in its own module — like azureToolDefinitions —
 * so the registration block in builtinToolsManager stays small and the heavy
 * electron-backed implementation (embeddedBrowserTool) is still lazy-imported at
 * execution time. Gated by the per-profile `browser.enabled` switch in
 * profile.json — toggled from Settings → Browser.
 */
export const embeddedBrowserToolDefinition: BuiltinToolDefinition = {
  name: 'browser',
  description:
    'Control the in-app embedded browser to open, inspect, and interact with web pages ' +
    '(local dev servers or public sites; only http/https URLs are allowed). The panel auto-opens so the user can watch.\n\n' +
    'Actions:\n' +
    '- navigate: open a URL (scheme optional; localhost → http, else https). Returns url/title/loading.\n' +
    '- open_local_file: preview a workspace-confined local HTML/report/demo file through a temporary localhost server.\n' +
    '- get_state/back/forward/reload/stop: inspect or control browser navigation state.\n' +
    '- screenshot: capture the current page as an image you can see; optionally pass viewport="desktop"|"mobile", width+height, fullPage=true, or selector for an element crop.\n' +
    '- capture_visual_baseline/compare_visual_baseline: store and compare an in-memory screenshot baseline for quick visual regression checks, including pixel diff when dimensions match.\n' +
    '- read_page: get the page title, URL, visible text, headings, and links as JSON (capped).\n' +
    '- inspect: get structured visible controls/forms/roles/rects for UI validation.\n' +
    '- diagnostics: get ready/loading state plus recent console/load/render failures.\n' +
    '- click/double_click/right_click: click by CSS selector, visible text, role, accessible name, label, placeholder, or test id.\n' +
    '- type: focus an input by locator, replace its value with "text"; set submit=true to press Enter.\n' +
    '- wait_for/wait_for_url: poll until a locator or URL appears (timeoutMs, default 10s).\n' +
    '- scroll/press_key/hover/clear/select_option/upload_file/paste/drag/set_slider: common browser QA interactions.\n' +
    '- assert_visible/assert_text/assert_clickable/assert_enabled/assert_disabled/assert_url/assert_not_blank/assert_images_loaded/assert_media_rendered/assert_dialog_open/assert_toast/assert_table_rows/assert_form_validity/assert_menu_open/assert_tooltip/assert_drawer_open/assert_list_items/assert_card_visible/assert_no_console_errors/assert_no_network_errors/accessibility_snapshot/network_diagnostics/download_diagnostics/assert_downloaded/inspect_frames/layout_audit: QA inspection and assertions.\n' +
    '- set_date/multi_select: specialized form controls.\n\n' +
    'The browser is scoped to the current chat session automatically. Click/type use trusted ' +
    'OS-level input so they work with React and other frameworks. ' +
    'IMPORTANT: This tool must NOT be used to perform high-impact or irreversible actions ' +
    '(publishing, paying, deleting, granting access). Before any such step, call ' +
    'request_interactive_input to get explicit user confirmation.',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: [
          'navigate',
          'open_local_file',
          'get_state',
          'back',
          'forward',
          'reload',
          'stop',
          'screenshot',
          'capture_visual_baseline',
          'compare_visual_baseline',
          'read_page',
          'inspect',
          'diagnostics',
          'click',
          'double_click',
          'right_click',
          'type',
          'wait_for',
          'wait_for_url',
          'scroll',
          'press_key',
          'hover',
          'clear',
          'select_option',
          'upload_file',
          'paste',
          'drag',
          'set_slider',
          'assert_visible',
          'assert_text',
          'assert_clickable',
          'assert_enabled',
          'assert_disabled',
          'assert_url',
          'assert_not_blank',
          'assert_images_loaded',
          'assert_media_rendered',
          'assert_dialog_open',
          'assert_toast',
          'assert_table_rows',
          'assert_form_validity',
          'assert_no_console_errors',
          'assert_no_network_errors',
          'accessibility_snapshot',
          'set_date',
          'multi_select',
          'network_diagnostics',
          'download_diagnostics',
          'assert_downloaded',
          'inspect_frames',
          'layout_audit',
          'assert_menu_open',
          'assert_tooltip',
          'assert_drawer_open',
          'assert_list_items',
          'assert_card_visible',
        ],
        description: 'The browser operation to perform.',
      },
      url: {
        type: 'string',
        description: 'For navigate: the URL to open. Scheme optional. For assert_url/wait_for_url: expected URL or URL substring.',
      },
      localPath: {
        type: 'string',
        description: 'For open_local_file: local file path to preview. It must resolve inside the trusted workspace root.',
      },
      selector: {
        type: 'string',
        description: 'For click/double_click/right_click/type/wait_for/hover/clear/select_option/upload_file/scroll/screenshot/drag: a CSS selector resolved in the page.',
      },
      text: {
        type: 'string',
        description:
          'For click/wait_for/hover: visible text to match. For type/paste: the text to insert. For select_option: option label fallback.',
      },
      submit: {
        type: 'boolean',
        description: 'For type: press Enter after inserting the text (default false).',
      },
      timeoutMs: {
        type: 'number',
        description: 'For wait_for: max time to poll in milliseconds (default 10000, max 30000).',
      },
      viewport: {
        type: 'string',
        enum: ['desktop', 'mobile'],
        description: 'For screenshot: apply a standard viewport size before capturing.',
      },
      width: {
        type: 'number',
        description: 'For screenshot: explicit viewport width in CSS pixels (320-3840).',
      },
      height: {
        type: 'number',
        description: 'For screenshot: explicit viewport height in CSS pixels (240-2160).',
      },
      fullPage: {
        type: 'boolean',
        description: 'For screenshot: temporarily resize to the scrollable document size before capture.',
      },
      baselineName: {
        type: 'string',
        description: 'For capture_visual_baseline/compare_visual_baseline: baseline key scoped to the current chat session.',
      },
      pixelThreshold: {
        type: 'number',
        description: 'For compare_visual_baseline: per-channel pixel difference threshold from 0 to 255 (default 0).',
      },
      includeDiffImage: {
        type: 'boolean',
        description: 'For compare_visual_baseline: include diff-image metadata when dimensions match; raw diff PNG base64 is omitted from nested JSON results.',
      },
      expectedCount: {
        type: 'number',
        description: 'For assert_table_rows/assert_list_items: exact expected visible row/item count.',
      },
      role: {
        type: 'string',
        description: 'For locator-based actions: ARIA role locator, such as button, link, textbox, checkbox, or combobox.',
      },
      name: {
        type: 'string',
        description: 'For locator-based actions: accessible name locator.',
      },
      exact: {
        type: 'boolean',
        description: 'For text/name locators: require exact match instead of substring match.',
      },
      x: {
        type: 'number',
        description: 'For scroll: horizontal pixels to scroll (default 0).',
      },
      y: {
        type: 'number',
        description: 'For scroll: vertical pixels to scroll (default 600).',
      },
      scrollTo: {
        type: 'string',
        enum: ['top', 'bottom', 'left', 'right'],
        description: 'For scroll: absolute target edge to scroll to.',
      },
      percent: {
        type: 'number',
        description: 'For scroll/set_slider: target percentage from 0 to 100.',
      },
      key: {
        type: 'string',
        description: 'For press_key: key name such as Enter, Escape, Tab, ArrowDown, or a single character.',
      },
      value: {
        type: 'string',
        description: 'For select_option/set_date/multi_select: option value, date/time value, or label fallback.',
      },
      values: {
        type: 'array',
        items: { type: 'string' },
        description: 'For multi_select: option values or labels to select.',
      },
      modifiers: {
        type: 'array',
        items: { type: 'string' },
        description: 'For press_key: modifier keys to hold, e.g. ["Meta"] or ["Control","Shift"].',
      },
      frameSelector: {
        type: 'string',
        description: 'For locator-based actions: same-origin iframe selector to resolve inside.',
      },
      shadowSelector: {
        type: 'string',
        description: 'For locator-based actions: open shadow host selector to resolve inside.',
      },
      label: {
        type: 'string',
        description: 'For locator-based actions: form label text.',
      },
      placeholder: {
        type: 'string',
        description: 'For locator-based actions: input/textarea placeholder text.',
      },
      testId: {
        type: 'string',
        description: 'For locator-based actions: data-testid/data-test-id/data-test value.',
      },
      filePath: {
        type: 'string',
        description: 'For upload_file: one workspace-confined local file path to attach to a file input.',
      },
      files: {
        type: 'array',
        items: { type: 'string' },
        description: 'For upload_file: workspace-confined local file paths to attach to a file input.',
      },
      sourceSelector: {
        type: 'string',
        description: 'For drag: CSS selector for the source element.',
      },
      targetSelector: {
        type: 'string',
        description: 'For drag: CSS selector for the target element.',
      },
      expected: {
        type: 'boolean',
        description: 'For assert_visible: expected visibility, default true.',
      },
    },
    required: ['action'],
  },
};
