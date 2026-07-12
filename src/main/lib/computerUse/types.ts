/**
 * Shared types for the Computer Use module.
 *
 * Computer Use drives the real local desktop (screenshots + synthetic mouse /
 * keyboard on any native app). These types describe the agent-facing action
 * surface, perception results, and the dependency seams the manager is built on
 * so every branch is fakeable in tests.
 */

export type { ComputerUseSettings } from '../userDataADO/types/profile';
export { DEFAULT_COMPUTER_USE_SETTINGS } from '../userDataADO/types/profile';

/** A 2D point. Screenshot-image-space when produced by the model; physical/logical screen-space after mapping. */
export interface Point {
  x: number;
  y: number;
}

/** Mouse button identifiers accepted by click actions. */
export type MouseButton = 'left' | 'right' | 'middle';

/** Logical bounds of a display (Electron `Display.bounds`). */
export interface DisplayBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Display descriptor returned by `list_displays`. */
export interface DisplayInfo {
  id: number;
  bounds: DisplayBounds;
  scaleFactor: number;
  primary: boolean;
}

/** Window descriptor returned by `list_windows`. */
export interface WindowInfo {
  appId: string;
  title: string;
  focused: boolean;
}

/**
 * Identity of the OS foreground application, used by the allowlist gate.
 *
 * `name` is the human-friendly application name (e.g. `Microsoft Edge`, `WeChat`)
 * shown to the user; `candidates` are every identifier the allowlist may legitimately
 * match against (friendly name + raw process name on Windows), so a user can allowlist
 * either `Microsoft Edge` or `msedge`. Matching is normalized (trim/lowercase/strip
 * `.exe`) by the gate, not here.
 */
export interface ForegroundApp {
  name: string;
  candidates: string[];
}

/** Result of a screen capture, including the actual pixel frame the model must ground against. */
export interface CaptureResult {
  /** Raw base64 (NO `data:` prefix) — the turn runner injects this as a vision message. */
  data: string;
  mimeType: string;
  /** Actual captured pixel width/height of the image. */
  width: number;
  height: number;
  /** Id of the display the image came from. */
  displayId: number;
  /** Logical bounds of that display, used for coordinate mapping. */
  bounds: DisplayBounds;
  scaleFactor: number;
  /** App last brought to the foreground via `focus_window`, if any. */
  foregroundApp?: string;
  /**
   * Every display present when the frame was captured. The model only ever sees the
   * ONE captured display, so without this it cannot tell that a target window living
   * on another screen even exists — it would keep grounding clicks on the captured
   * display and drive the wrong app. Surfaced so the agent can re-screenshot a
   * specific `displayId` (or `focus_window`) instead of clicking blindly.
   */
  displays?: DisplayInfo[];
}

/**
 * macOS permission status. On non-darwin platforms screen recording is reported
 * as `granted` and accessibility as `true` (no equivalent gate).
 */
export interface PermissionStatus {
  /** `getMediaAccessStatus('screen')` value, or `granted` off macOS. */
  screenRecording: string;
  /** `isTrustedAccessibilityClient`, or `true` off macOS. */
  accessibility: boolean;
}

/** The agent-facing action discriminator. */
export type ComputerUseAction =
  | 'screenshot'
  | 'list_displays'
  | 'list_windows'
  | 'focus_window'
  | 'move_mouse'
  | 'click'
  | 'double_click'
  | 'right_click'
  | 'drag'
  | 'scroll'
  | 'type_text'
  | 'press_key'
  | 'hotkey'
  | 'wait';

/** Raw args the tool accepts (single tool + action enum, same ergonomics as `browser`). */
export interface ComputerUseToolArgs {
  action?: ComputerUseAction;
  display?: number;
  appId?: string;
  title?: string;
  x?: number;
  y?: number;
  button?: MouseButton;
  from?: Point;
  to?: Point;
  dx?: number;
  dy?: number;
  text?: string;
  key?: string;
  keys?: string[];
  ms?: number;
  /** Set true to proceed past a confirmation gate after the user approved via request_interactive_input. */
  confirmed?: boolean;
  /** Server-issued confirmation id returned by a blocked mutating action. */
  confirmationId?: string;
  /** Short description of the user-intent behind a mutating action; used for the high-impact guard. */
  intent?: string;
}

/** Uniform tool error envelope; mutating-gate blocks add `requiresConfirmation: true`. */
export interface ComputerUseError {
  ok: false;
  error: string;
  requiresConfirmation?: true;
}

/** A single recorded action for the audit trail. */
export interface AuditEntry {
  chatSessionId?: string;
  action: string;
  target?: string;
  ts: number;
  confirmed: boolean;
}
