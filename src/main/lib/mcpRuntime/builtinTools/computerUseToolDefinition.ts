import type { BuiltinToolDefinition } from './types';

/**
 * Metadata-only definition for the `computer_use` built-in tool (agent control
 * of the real local desktop: screenshots + synthetic mouse/keyboard on native
 * apps). Kept in its own module — like embeddedBrowserToolDefinition — so the
 * registration block in builtinToolsManager stays small and the heavy,
 * electron/native-backed implementation (computerUseTool) is lazy-imported at
 * execution time. Gated by the per-profile `computerUse.enabled` switch in
 * profile.json — toggled from Settings -> Computer Use.
 */
export const computerUseToolDefinition: BuiltinToolDefinition = {
  name: 'computer_use',
  description:
    'Control the real local desktop: capture the screen and drive native apps with synthetic mouse ' +
    'and keyboard input. Use this for desktop apps that are NOT web pages (for web pages use the browser tool).\n\n' +
    'Workflow: ALWAYS call screenshot first, then issue pointer actions whose x/y are in the pixel ' +
    'coordinates of the SCREENSHOT you just received. The tool grounds those coordinates against the ' +
    'last screenshot, so take a fresh screenshot after anything that changes the screen.\n\n' +
    'TARGETING: every screenshot reports its display id, the full multi-display layout, and the OS ' +
    'frontmost app. Clicks are grounded to the CAPTURED display only. Before clicking, confirm the ' +
    'frontmost app is the one you mean to control; if it is not, call focus_window first. If your ' +
    'target window is not visible in the screenshot, it may be on another display — re-run screenshot ' +
    'with that display id (from list_displays) instead of clicking blindly on the wrong screen.\n\n' +
    'Actions:\n' +
    '- screenshot: capture a display as an image you can see; optionally pass display (id from list_displays). ' +
    'The result also reports the frontmost app and every display so you can tell which screen/app you are on.\n' +
    '- list_displays: list displays with id, bounds, scaleFactor, primary.\n' +
    '- list_windows: list visible app windows with appId/title/focused.\n' +
    '- focus_window: bring an app to the foreground by appId or title (sets the foreground app for allowlist checks).\n' +
    '- move_mouse: move the cursor to x,y.\n' +
    '- click/double_click/right_click: click at x,y (button defaults to left/right accordingly).\n' +
    '- drag: press at from{x,y} and release at to{x,y}.\n' +
    '- scroll: scroll at x,y by dx,dy (positive dy scrolls down, positive dx scrolls right).\n' +
    '- type_text: type the given text into the focused field.\n' +
    '- press_key: press a single key (e.g. "enter", "tab", "esc", "a").\n' +
    '- hotkey: press a chord of keys together (e.g. ["cmd","c"]).\n' +
    '- wait: sleep ms milliseconds.\n\n' +
    'SAFETY: coordinate pointer actions (click/double_click/right_click/drag) require confirmation because ' +
    'the tool cannot prove which control a screenshot coordinate targets. Other mutating actions ' +
    '(type_text/hotkey, and activation key presses) may require confirmation. For high-impact or ' +
    'irreversible steps (publish, delete, pay, purchase, send, submit, approve, grant access, etc.) you ' +
    'MUST first call request_interactive_input using the confirmationId returned by the blocked action, ' +
    'then retry the SAME action with confirmed:true and that confirmationId only after the user approves. ' +
    'Pass a short intent string describing what the action does so the safety ' +
    'guard can classify it.',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: [
          'screenshot',
          'list_displays',
          'list_windows',
          'focus_window',
          'move_mouse',
          'click',
          'double_click',
          'right_click',
          'drag',
          'scroll',
          'type_text',
          'press_key',
          'hotkey',
          'wait',
        ],
        description: 'The desktop action to perform.',
      },
      display: { type: 'number', description: 'Display id (from list_displays) for screenshot; defaults to primary.' },
      appId: { type: 'string', description: 'App identifier/name for focus_window.' },
      title: { type: 'string', description: 'Window title for focus_window (alternative to appId).' },
      x: { type: 'number', description: 'X coordinate in screenshot pixel space.' },
      y: { type: 'number', description: 'Y coordinate in screenshot pixel space.' },
      button: { type: 'string', enum: ['left', 'right', 'middle'], description: 'Mouse button for click.' },
      from: {
        type: 'object',
        properties: { x: { type: 'number' }, y: { type: 'number' } },
        description: 'Drag start point in screenshot pixel space.',
      },
      to: {
        type: 'object',
        properties: { x: { type: 'number' }, y: { type: 'number' } },
        description: 'Drag end point in screenshot pixel space.',
      },
      dx: { type: 'number', description: 'Horizontal scroll amount (positive scrolls right).' },
      dy: { type: 'number', description: 'Vertical scroll amount (positive scrolls down).' },
      text: { type: 'string', description: 'Text to type for type_text.' },
      key: { type: 'string', description: 'Key name for press_key (e.g. enter, tab, esc, a).' },
      keys: { type: 'array', items: { type: 'string' }, description: 'Key chord for hotkey (e.g. ["cmd","c"]).' },
      ms: { type: 'number', description: 'Milliseconds to sleep for wait.' },
      confirmed: {
        type: 'boolean',
        description: 'Set true only with confirmationId after the user approved via request_interactive_input.',
      },
      confirmationId: {
        type: 'string',
        description: 'Server-issued confirmation id returned by a blocked mutating action.',
      },
      intent: {
        type: 'string',
        description:
          'Short description of what a mutating action does, used by the high-impact safety guard.',
      },
    },
    required: ['action'],
  },
};
