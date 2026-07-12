export type BrowserAction =
  | 'navigate'
  | 'open_local_file'
  | 'get_state'
  | 'back'
  | 'forward'
  | 'reload'
  | 'stop'
  | 'screenshot'
  | 'capture_visual_baseline'
  | 'compare_visual_baseline'
  | 'read_page'
  | 'inspect'
  | 'diagnostics'
  | 'click'
  | 'double_click'
  | 'right_click'
  | 'type'
  | 'wait_for'
  | 'wait_for_url'
  | 'scroll'
  | 'press_key'
  | 'hover'
  | 'clear'
  | 'select_option'
  | 'upload_file'
  | 'paste'
  | 'drag'
  | 'set_slider'
  | 'assert_visible'
  | 'assert_text'
  | 'assert_clickable'
  | 'assert_enabled'
  | 'assert_disabled'
  | 'assert_url'
  | 'assert_not_blank'
  | 'assert_images_loaded'
  | 'assert_media_rendered'
  | 'assert_dialog_open'
  | 'assert_toast'
  | 'assert_table_rows'
  | 'assert_form_validity'
  | 'assert_menu_open'
  | 'assert_tooltip'
  | 'assert_drawer_open'
  | 'assert_list_items'
  | 'assert_card_visible'
  | 'assert_no_console_errors'
  | 'assert_no_network_errors'
  | 'accessibility_snapshot'
  | 'set_date'
  | 'multi_select'
  | 'network_diagnostics'
  | 'download_diagnostics'
  | 'assert_downloaded'
  | 'inspect_frames'
  | 'layout_audit';

export interface EmbeddedBrowserToolArgs {
  action: BrowserAction;
  /** navigate: the URL (scheme optional; localhost/IP → http, else https). */
  url?: string;
  /** open_local_file: local file to preview through a workspace-confined localhost server. */
  localPath?: string;
  /** click/type/wait_for: a CSS selector resolved in-page. */
  selector?: string;
  /** click/wait_for: visible-text match; type: the text to insert. */
  text?: string;
  /** type: press Enter after inserting (submit the form/field). */
  submit?: boolean;
  /** wait_for: max time to poll before giving up (ms). */
  timeoutMs?: number;
  /** screenshot: viewport preset to apply before capture. */
  viewport?: 'desktop' | 'mobile';
  /** screenshot: explicit viewport width. */
  width?: number;
  /** screenshot: explicit viewport height. */
  height?: number;
  /** scroll: pixels to scroll horizontally. */
  x?: number;
  /** scroll: pixels to scroll vertically. */
  y?: number;
  /** press_key: key name, e.g. Enter, Escape, Tab, ArrowDown. */
  key?: string;
  /** select_option: option value or visible label. */
  value?: string;
  /** multi_select: option values or labels to select. */
  values?: string[];
  /** screenshot: capture the full scrollable page by temporarily resizing the view. */
  fullPage?: boolean;
  /** click/hover/wait_for: ARIA role locator. */
  role?: string;
  /** click/hover/wait_for: accessible name/text locator. */
  name?: string;
  /** locators: require exact text/name match instead of substring. */
  exact?: boolean;
  /** press_key: modifier keys to hold while pressing key. */
  modifiers?: string[];
  /** Locators: iframe selector to resolve inside one same-origin frame. */
  frameSelector?: string;
  /** Locators: shadow host selector to resolve inside one open shadow root. */
  shadowSelector?: string;
  /** Locators: associated label text. */
  label?: string;
  /** Locators: placeholder text. */
  placeholder?: string;
  /** Locators: data-testid/data-test-id/data-test selector value. */
  testId?: string;
  /** upload_file: path to one local file. */
  filePath?: string;
  /** upload_file: paths to local files. */
  files?: string[];
  /** drag: source locator selector. */
  sourceSelector?: string;
  /** drag: target locator selector. */
  targetSelector?: string;
  /** scroll: absolute target position. */
  scrollTo?: 'top' | 'bottom' | 'left' | 'right';
  /** scroll/set_slider: target percentage from 0 to 100. */
  percent?: number;
  /** visual baseline actions: in-memory baseline key scoped to this chat session. */
  baselineName?: string;
  /** compare_visual_baseline: per-channel pixel difference threshold, 0-255. */
  pixelThreshold?: number;
  /** compare_visual_baseline: include a generated diff image when dimensions match. */
  includeDiffImage?: boolean;
  /** assertions: whether assert_visible expects the target to be visible. */
  expected?: boolean;
  /** assert_table_rows: expected row count. */
  expectedCount?: number;
}
