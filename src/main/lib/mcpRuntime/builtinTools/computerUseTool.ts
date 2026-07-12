/**
 * ComputerUseTool — agent-facing control of the real local desktop.
 *
 * One consolidated tool with an `action` discriminator (mirrors the `browser`
 * tool). Perception, targeting, and synthetic input are delegated to the
 * injected {@link ComputerUseManager}; this file owns argument validation,
 * action routing, the human-in-the-loop confirmation gate, the vision return
 * shape, and the never-throw contract.
 *
 * Coordinates in args are screenshot-image-space (the pixels of the last
 * screenshot the agent saw); the manager grounds them before dispatch.
 *
 * Safety: mutating actions gate on HITL confirmation. Coordinate pointer
 * actions always confirm because v1 cannot inspect the target control behind a
 * screenshot coordinate; high-impact verbs also ALWAYS confirm. Ordinary
 * text/keyboard actions confirm unless the foreground app is allowlisted.
 *
 * Errors never throw out of `execute`; every failure returns `{ ok:false,
 * error }` so the agent can read the reason and recover.
 */

import { createLogger } from '../../unifiedLogger';
import { getComputerUseManager, ComputerUseManager, DispatchContext } from '../../computerUse/ComputerUseManager';
import type { CaptureResult, ComputerUseToolArgs, MouseButton } from '../../computerUse/types';
import {
  buildComputerUseConfirmationFingerprint,
  buildComputerUseConfirmationRequest,
  computerUseConfirmationStore,
  COMPUTER_USE_CONFIRMATION_APPROVE_VALUE,
  COMPUTER_USE_CONFIRMATION_METADATA_KEY,
} from '../../computerUse/confirmationGate';
import type { RequestInteractiveInputArgs } from '@shared/types/requestInteractiveInputTypes';

const logger = createLogger();

interface ToolError {
  ok: false;
  error: string;
  requiresConfirmation?: true;
  confirmationId?: string;
  confirmationRequest?: RequestInteractiveInputArgs;
}

export interface ComputerUseExecuteOptions {
  signal?: AbortSignal;
  chatSessionId?: string;
  workspaceRoot?: string;
  /** Per-profile control-layering settings, supplied by builtinToolsManager. */
  settings?: { alwaysAllowedApps?: string[]; requireConfirmation?: boolean };
  /** Test seam: defaults to the process-wide manager. */
  manager?: ComputerUseManager;
}

/** High-impact verbs that always require confirmation, mirroring embeddedBrowserTool. */
const RISKY_PATTERNS: RegExp[] = [
  /\bpublish\b/,
  /\bpost\b/,
  /\bdelete\b/,
  /\bremove\b/,
  /\bpay\b/,
  /\bpurchase\b/,
  /\bbuy\b/,
  /\bauthorize\b/,
  /\bgrant\s+access\b/,
  /\bsubmit\s+order\b/,
  /\bsubmit\b/,
  /\bsend\b/,
  /\bconfirm\b/,
  /\bsave\b/,
  /\bmerge\b/,
  /\bapprove\b/,
];

// Key names mirror inputDriver.ts aliases so approved keys are dispatchable.
const NAVIGATION_KEYS = new Set(['tab', 'esc', 'escape', 'up', 'down', 'left', 'right', 'home', 'end', 'pageup', 'pagedown']);
const ACTIVATION_KEYS = new Set(['enter', 'return', 'numenter', 'space']);
const DESTRUCTIVE_KEYS = new Set(['backspace', 'delete', 'del']);
const SUBMIT_CHORD_KEYS = new Set(['enter', 'return', 'numenter']);
const COMMAND_MODIFIERS = new Set(['cmd', 'command', 'meta', 'super']);
const CONTROL_MODIFIERS = new Set(['ctrl', 'control']);
const ALT_MODIFIERS = new Set(['alt', 'option']);
const WINDOW_CLOSING_KEYS = new Set(['q', 'w', 'm']);
const COORDINATE_POINTER_ACTIONS = new Set(['click', 'double_click', 'right_click', 'drag']);
const MOUSE_BUTTONS = new Set<unknown>(['left', 'right', 'middle']);

export class ComputerUseTool {
  static async execute(args: ComputerUseToolArgs, options: ComputerUseExecuteOptions = {}): Promise<unknown> {
    const { signal, chatSessionId, settings, manager: injected } = options;
    try {
      const action = args?.action;
      if (!action) return ComputerUseTool.fail('Missing required "action".');

      const manager = injected ?? getComputerUseManager();
      const ctx: DispatchContext = { chatSessionId, confirmed: false, signal };

      switch (action) {
        case 'wait':
          return await ComputerUseTool.wait(args, signal);
        case 'list_displays':
          if (signal?.aborted) return ComputerUseTool.aborted();
          return { ok: true, displays: manager.listDisplays() };
        case 'list_windows':
          if (signal?.aborted) return ComputerUseTool.aborted();
          return { ok: true, windows: await manager.listWindows() };
        case 'screenshot': {
          if (signal?.aborted) return ComputerUseTool.aborted();
          const shot = await manager.screenshot(args.display, ctx);
          // The image is the vision payload the turn runner injects; `description`
          // gives the model the situational context (frontmost app + display layout)
          // it otherwise lacks — the #1 cause of clicks landing on the wrong app is
          // the agent not realizing its target is on another display or unfocused.
          // `width`/`height` let image-token accounting size the frame (auto-detail
          // token calc throws without them, which silently disables compression).
          return {
            type: 'image',
            data: shot.data,
            mimeType: shot.mimeType,
            width: shot.width,
            height: shot.height,
            description: ComputerUseTool.describeShot(shot),
          };
        }
        case 'focus_window': {
          if (signal?.aborted) return ComputerUseTool.aborted();
          const target = (args.appId ?? args.title ?? '').trim();
          if (!target) return ComputerUseTool.fail('focus_window requires appId or title.');
          const ok = await manager.focusWindow({ appId: args.appId, title: args.title }, ctx);
          return ok ? { ok: true, focused: target } : ComputerUseTool.fail(`Could not focus "${target}".`);
        }
        case 'move_mouse': {
          const pt = ComputerUseTool.requirePoint(args);
          if ('error' in pt) return pt;
          if (signal?.aborted) return ComputerUseTool.aborted();
          const mapped = await manager.moveMouse(pt.x, pt.y, ctx);
          return { ok: true, screenPoint: mapped };
        }
        case 'scroll': {
          const pt = ComputerUseTool.requirePoint(args);
          if ('error' in pt) return pt;
          if (signal?.aborted) return ComputerUseTool.aborted();
          const mapped = await manager.scroll(pt.x, pt.y, args.dx ?? 0, args.dy ?? 0, ctx);
          return { ok: true, screenPoint: mapped };
        }
        case 'click':
        case 'double_click':
        case 'right_click':
        case 'drag':
        case 'type_text':
        case 'press_key':
        case 'hotkey':
          return await ComputerUseTool.runMutating(action, args, manager, ctx, settings, signal);
        default:
          return ComputerUseTool.fail(`Unknown action "${action}".`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(`[ComputerUse] action failed: ${message}`);
      return ComputerUseTool.fail(message);
    }
  }

  /** Run a mutating action behind the confirmation gate, then dispatch. */
  private static async runMutating(
    action: string,
    args: ComputerUseToolArgs,
    manager: ComputerUseManager,
    ctx: DispatchContext,
    settings?: { alwaysAllowedApps?: string[]; requireConfirmation?: boolean },
    signal?: AbortSignal,
  ): Promise<unknown> {
    const validation = ComputerUseTool.validateMutating(action, args);
    if (validation) return validation;

    // Surface a missing-permission error BEFORE the confirmation gate (the documented decision
    // flow checks "permission ok?" before confirmation). Otherwise the user is asked to approve a
    // click/type that then fails on dispatch for lack of Accessibility — they approve an action
    // that could never run.
    const permissionError = manager.accessibilityError();
    if (permissionError) return ComputerUseTool.fail(permissionError);

    if (signal?.aborted) return ComputerUseTool.aborted();

    const gate = await ComputerUseTool.confirmationGate(action, args, manager, ctx, settings);
    if (gate) return gate;

    // Honor turn cancellation before emitting any synthetic input. Each computer_use
    // action is its own tool call, so checking once here is the right granularity:
    // if the turn was aborted (while the confirmation card was open, or between
    // actions) we must not click/type/drag into whatever now has focus.
    if (signal?.aborted) return ComputerUseTool.aborted();

    switch (action) {
      case 'click':
        return ComputerUseTool.dispatchClick(args, manager, ctx, args.button ?? 'left');
      case 'double_click': {
        const mapped = await manager.doubleClick(Number(args.x), Number(args.y), ctx);
        return { ok: true, screenPoint: mapped };
      }
      case 'right_click':
        return ComputerUseTool.dispatchClick(args, manager, ctx, 'right');
      case 'drag': {
        const mapped = await manager.drag(args.from as { x: number; y: number }, args.to as { x: number; y: number }, ctx);
        return { ok: true, ...mapped };
      }
      case 'type_text':
        await manager.typeText(String(args.text), ctx);
        return { ok: true, typed: String(args.text).length };
      case 'press_key':
        await manager.pressKey(String(args.key), ctx);
        return { ok: true, key: String(args.key) };
      case 'hotkey':
        await manager.hotkey(args.keys as string[], ctx);
        return { ok: true, keys: args.keys };
      /* v8 ignore next 2 -- the switch is exhaustive over the gated action set; this guards future additions */
      default:
        return ComputerUseTool.fail(`Unknown action "${action}".`);
    }
  }

  private static async dispatchClick(
    args: ComputerUseToolArgs,
    manager: ComputerUseManager,
    ctx: DispatchContext,
    button: MouseButton,
  ): Promise<unknown> {
    const mapped = await manager.click(Number(args.x), Number(args.y), button, ctx);
    return { ok: true, screenPoint: mapped };
  }

  /**
   * Build the situational text the model reads alongside a screenshot: which display
   * it is looking at, the full multi-display layout, and the OS frontmost app. The
   * agent grounds clicks on the captured display, so when its target window is on a
   * different screen — or simply not the frontmost app — clicking blindly lands input
   * on the wrong window (the failure mode behind "a window got closed mid-run"). This
   * text lets the agent notice the mismatch and recover via `focus_window` or a
   * `displayId`-scoped screenshot instead.
   */
  static describeShot(shot: CaptureResult): string {
    const front = shot.foregroundApp?.trim() || 'unknown';
    const displays = shot.displays ?? [];
    const layout = displays.length
      ? displays
          .map((d) => {
            const role = d.primary ? 'primary' : 'secondary';
            const tag = d.id === shot.displayId ? ' [captured]' : '';
            return `#${d.id} ${d.bounds.width}x${d.bounds.height}@(${d.bounds.x},${d.bounds.y}) ${role}${tag}`;
          })
          .join('; ')
      : `#${shot.displayId}`;
    const multi =
      displays.length > 1
        ? ' If the window you intend to operate is not visible here, it is on another display — re-run screenshot with that displayId before clicking.'
        : '';
    return (
      `Screenshot of display #${shot.displayId} (${shot.width}x${shot.height}px). ` +
      `Frontmost app: ${front}. Displays: ${layout}.${multi} ` +
      'Clicks are grounded to THIS display; if the frontmost app is not the one you mean to control, call focus_window first instead of clicking.'
    );
  }

  /** Per-action required-argument validation. Returns an error envelope or null. */
  private static validateMutating(action: string, args: ComputerUseToolArgs): ToolError | null {
    switch (action) {
      case 'click':
        if (args.button !== undefined && !MOUSE_BUTTONS.has(args.button)) {
          return ComputerUseTool.fail('click button must be one of left, right, or middle.');
        }
        return ComputerUseTool.hasXY(args) ? null : ComputerUseTool.fail('click requires numeric x and y.');
      case 'double_click':
      case 'right_click':
        return ComputerUseTool.hasXY(args) ? null : ComputerUseTool.fail(`${action} requires numeric x and y.`);
      case 'drag':
        return ComputerUseTool.isPoint(args.from) && ComputerUseTool.isPoint(args.to)
          ? null
          : ComputerUseTool.fail('drag requires from{x,y} and to{x,y}.');
      case 'type_text':
        return typeof args.text === 'string' && args.text.length > 0
          ? null
          : ComputerUseTool.fail('type_text requires a non-empty text.');
      case 'press_key':
        return typeof args.key === 'string' && args.key.trim().length > 0
          ? null
          : ComputerUseTool.fail('press_key requires a key.');
      case 'hotkey':
        return Array.isArray(args.keys) &&
          args.keys.length > 0 &&
          args.keys.every((key) => typeof key === 'string' && key.trim().length > 0)
          ? null
          : ComputerUseTool.fail('hotkey requires a non-empty keys array of non-empty strings.');
      /* v8 ignore next 2 -- unreachable: validateMutating is only called for the gated actions above */
      default:
        return null;
    }
  }

  /**
   * Decide whether confirmation is required and, if so and not yet confirmed,
   * return the recoverable blocked envelope. Returns null to proceed.
   */
  private static async confirmationGate(
    action: string,
    args: ComputerUseToolArgs,
    manager: ComputerUseManager,
    ctx: DispatchContext,
    settings?: { alwaysAllowedApps?: string[]; requireConfirmation?: boolean },
  ): Promise<ToolError | null> {
    // Only true navigation keys bypass confirmation; alphanumeric keys can type text.
    if (action === 'press_key' && NAVIGATION_KEYS.has(String(args.key).trim().toLowerCase())) {
      return null;
    }
    const reason =
      ComputerUseTool.highImpactReason(action, args) ??
      ComputerUseTool.coordinatePointerConfirmationReason(action);
    const requireConfirmation = settings?.requireConfirmation !== false;
    const fingerprint = buildComputerUseConfirmationFingerprint(args);
    const providedId = typeof args.confirmationId === 'string' && args.confirmationId.trim().length > 0
      ? args.confirmationId.trim()
      : '';
    let allowlisted = false;
    if (!reason && requireConfirmation) {
      const candidates = (await manager.refreshForegroundAppCandidates(ctx.chatSessionId)).map(ComputerUseTool.normalizeAppId);
      // Defensive: profile cache settings can briefly hold a renderer-supplied malformed value.
      const allowlist = (Array.isArray(settings?.alwaysAllowedApps) ? settings!.alwaysAllowedApps : [])
        .filter((app): app is string => typeof app === 'string')
        .map(ComputerUseTool.normalizeAppId);
      allowlisted =
        candidates.length > 0 &&
        allowlist.some((app) => app.length > 0 && candidates.includes(app));
    }

    if (!reason && (allowlisted || !requireConfirmation)) {
      if (providedId) {
        computerUseConfirmationStore.consumeApproved(providedId, ctx.chatSessionId, fingerprint);
      }
      return null;
    }

    if (
      args.confirmed === true &&
      providedId &&
      computerUseConfirmationStore.consumeApproved(providedId, ctx.chatSessionId, fingerprint)
    ) {
      ctx.confirmed = true;
      return null;
    }

    const isReusedPending =
      providedId && computerUseConfirmationStore.hasPending(providedId, ctx.chatSessionId, fingerprint);
    const confirmationId = isReusedPending
      ? providedId
      : computerUseConfirmationStore.createPendingWithRequest(ctx.chatSessionId, fingerprint, (id) =>
          buildComputerUseConfirmationRequest(id, args),
        );
    return {
      ok: false,
      requiresConfirmation: true,
      confirmationId,
      confirmationRequest: computerUseConfirmationStore.getTrustedRequest(confirmationId, ctx.chatSessionId) ?? buildComputerUseConfirmationRequest(confirmationId, args),
      error:
        `Confirmation required${reason ? ` (high-impact: ${reason})` : ''} before this ${action}. ` +
        `Call request_interactive_input with exactly the provided confirmationRequest payload. ` +
        `Its metadata.${COMPUTER_USE_CONFIRMATION_METADATA_KEY} must be "${confirmationId}" and its approve value must be "${COMPUTER_USE_CONFIRMATION_APPROVE_VALUE}". ` +
        `After the user approves, retry the same action with confirmed:true and confirmationId:"${confirmationId}".`,
    };
  }

  private static coordinatePointerConfirmationReason(action: string): string | null {
    return COORDINATE_POINTER_ACTIONS.has(action)
      ? 'coordinate pointer actions can activate uninspectable high-impact controls'
      : null;
  }

  /** Classify high-impact intent from the intent string, typed text, and hotkey chord. */
  private static highImpactReason(action: string, args: ComputerUseToolArgs): string | null {
    const chordReason = ComputerUseTool.highImpactChordReason(action, args);
    if (chordReason) return chordReason;
    const standaloneKey = ComputerUseTool.standaloneKeyForHighImpactCheck(action, args);
    if (standaloneKey && ComputerUseTool.isActivationKey(standaloneKey)) return 'activation key can submit or confirm focused controls';
    if (standaloneKey && ComputerUseTool.isDestructiveKey(standaloneKey)) return 'destructive key can delete focused content';

    const parts = [args.intent, action === 'type_text' ? args.text : '', (args.keys ?? []).join(' ')]
      .filter((p): p is string => typeof p === 'string' && p.length > 0)
      .join(' ')
      .toLowerCase();
    if (parts.length === 0) return null;
    const hit = RISKY_PATTERNS.find((pattern) => pattern.test(parts));
    return hit ? hit.source.replace(/\\b/g, '').replace(/\\s\+/g, ' ') : null;
  }

  private static standaloneKeyForHighImpactCheck(action: string, args: ComputerUseToolArgs): string {
    if (action === 'press_key') {
      return String(args.key ?? '');
    }

    return action === 'hotkey' && Array.isArray(args.keys) && args.keys.length === 1
      ? String(args.keys[0] ?? '')
      : '';
  }

  private static highImpactChordReason(action: string, args: ComputerUseToolArgs): string | null {
    const keys =
      action === 'hotkey' && Array.isArray(args.keys)
        ? args.keys.map((key) => key.trim().toLowerCase()).filter(Boolean)
        : action === 'press_key' && typeof args.key === 'string'
          ? [args.key.trim().toLowerCase()].filter(Boolean)
          : [];
    if (keys.length === 0) return null;

    const hasCommand = keys.some((key) => COMMAND_MODIFIERS.has(key));
    const hasControl = keys.some((key) => CONTROL_MODIFIERS.has(key));
    const hasAlt = keys.some((key) => ALT_MODIFIERS.has(key));
    if ((hasCommand || hasControl) && keys.includes('s')) return 'keyboard shortcut saves content';
    if ((hasCommand || hasControl) && keys.some((key) => SUBMIT_CHORD_KEYS.has(key))) {
      return 'keyboard shortcut submits or sends content';
    }

    if (hasCommand && keys.some((key) => WINDOW_CLOSING_KEYS.has(key))) {
      if (keys.includes('q')) return 'keyboard shortcut cmd+q quits apps';
      if (keys.includes('w')) return 'keyboard shortcut cmd+w closes windows';
      if (keys.includes('m')) return 'keyboard shortcut cmd+m minimizes windows';
    }
    if (hasControl && keys.includes('q')) return 'keyboard shortcut ctrl+q quits apps';
    if (hasControl && keys.includes('w')) return 'keyboard shortcut ctrl+w closes windows';
    // Windows window/app-closing chords: alt+f4 quits the active app (the direct analog of
    // cmd+q), ctrl+f4 closes the active document/tab/MDI child (analog of ctrl+w). Gating them
    // structurally keeps the "closing shortcuts always confirm" rule honest on Windows.
    if (hasAlt && keys.includes('f4')) return 'keyboard shortcut alt+f4 quits apps';
    if (hasControl && keys.includes('f4')) return 'keyboard shortcut ctrl+f4 closes windows';
    return null;
  }

  private static isActivationKey(key: string): boolean {
    return ACTIVATION_KEYS.has(key.trim().toLowerCase());
  }

  private static isDestructiveKey(key: string): boolean {
    return DESTRUCTIVE_KEYS.has(key.trim().toLowerCase());
  }

  /**
   * Normalize an app identifier for allowlist comparison: trim, lowercase, and drop a
   * trailing `.exe`. This lets a user allowlist any of `Microsoft Edge`, `msedge`, or
   * `msedge.exe` and have it match the foreground app's friendly name or process name.
   */
  private static normalizeAppId(value: string): string {
    return value.trim().toLowerCase().replace(/\.exe$/, '');
  }

  private static hasXY(args: ComputerUseToolArgs): boolean {
    return typeof args.x === 'number' && typeof args.y === 'number';
  }

  private static isPoint(value: unknown): value is { x: number; y: number } {
    return (
      typeof value === 'object' &&
      value !== null &&
      typeof (value as { x?: unknown }).x === 'number' &&
      typeof (value as { y?: unknown }).y === 'number'
    );
  }

  private static requirePoint(args: ComputerUseToolArgs): { x: number; y: number } | ToolError {
    if (!ComputerUseTool.hasXY(args)) {
      return ComputerUseTool.fail(`${args.action} requires numeric x and y.`);
    }
    return { x: Number(args.x), y: Number(args.y) };
  }

  private static async wait(args: ComputerUseToolArgs, signal?: AbortSignal): Promise<unknown> {
    const ms = Math.max(0, Math.min(Number(args.ms ?? 0), 10000));
    await ComputerUseTool.sleep(ms, signal);
    return { ok: true, waited: ms };
  }

  private static sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      const onAbort = () => {
        clearTimeout(timer);
        resolve();
      };
      if (signal) {
        if (signal.aborted) {
          clearTimeout(timer);
          resolve();
          return;
        }
        signal.addEventListener('abort', onAbort, { once: true });
      }
    });
  }

  private static fail(error: string): ToolError {
    return { ok: false, error };
  }

  /** Cancellation envelope returned when the turn was aborted before dispatch. */
  private static aborted(): ToolError {
    return { ok: false, error: 'aborted' };
  }
}
