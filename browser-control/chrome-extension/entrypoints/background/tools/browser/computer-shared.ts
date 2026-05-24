import { createErrorResponse, ToolResult } from '@/common/tool-handler';
import { TOOL_MESSAGE_TYPES } from '@/common/message-types';
import { cdpSessionManager } from '@/utils/cdp-session-manager';
import { captureFrameOnAction, isAutoCaptureActive, type ActionMetadata, type ActionType } from './gif-recorder';

export type MouseButton = 'left' | 'right' | 'middle';

export interface Coordinates {
  x: number;
  y: number;
}

export interface ZoomRegion {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface Modifiers {
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
}

export interface ComputerParams {
  action:
    | 'left_click'
    | 'right_click'
    | 'double_click'
    | 'triple_click'
    | 'left_click_drag'
    | 'scroll'
    | 'type'
    | 'key'
    | 'hover'
    | 'wait'
    | 'fill'
    | 'fill_form'
    | 'resize_page'
    | 'scroll_to'
    | 'zoom'
    | 'screenshot';
  coordinates?: Coordinates;
  startCoordinates?: Coordinates;
  ref?: string;
  startRef?: string;
  scrollDirection?: 'up' | 'down' | 'left' | 'right';
  scrollAmount?: number;
  text?: string;
  repeat?: number;
  modifiers?: Modifiers;
  region?: ZoomRegion;
  duration?: number;
  selector?: string;
  selectorType?: 'css' | 'xpath';
  value?: string;
  frameId?: number;
  tabId?: number;
  windowId?: number;
  background?: boolean;
}

export class CDPHelper {
  static async attach(tabId: number): Promise<void> {
    await cdpSessionManager.attach(tabId, 'computer');
  }

  static async detach(tabId: number): Promise<void> {
    await cdpSessionManager.detach(tabId, 'computer');
  }

  static async send(tabId: number, method: string, params?: object): Promise<any> {
    return await cdpSessionManager.sendCommand(tabId, method, params);
  }

  static async dispatchMouseEvent(tabId: number, opts: any) {
    const params: any = {
      type: opts.type,
      x: Math.round(opts.x),
      y: Math.round(opts.y),
      modifiers: opts.modifiers || 0,
    };
    if (
      opts.type === 'mousePressed' ||
      opts.type === 'mouseReleased' ||
      opts.type === 'mouseMoved'
    ) {
      params.button = opts.button || 'none';
      if (opts.type === 'mousePressed' || opts.type === 'mouseReleased') {
        params.clickCount = opts.clickCount || 1;
      }
      params.buttons = opts.buttons !== undefined ? opts.buttons : 0;
    }
    if (opts.type === 'mouseWheel') {
      params.deltaX = opts.deltaX || 0;
      params.deltaY = opts.deltaY || 0;
    }
    await this.send(tabId, 'Input.dispatchMouseEvent', params);
  }

  static async insertText(tabId: number, text: string) {
    await this.send(tabId, 'Input.insertText', { text });
  }

  static modifierMask(mods: string[]): number {
    const map: Record<string, number> = {
      alt: 1,
      ctrl: 2,
      control: 2,
      meta: 4,
      cmd: 4,
      command: 4,
      win: 4,
      windows: 4,
      shift: 8,
    };
    let mask = 0;
    for (const mod of mods) {
      mask |= map[mod] || 0;
    }
    return mask;
  }

  private static KEY_ALIASES: Record<string, { key: string; code?: string; text?: string }> = {
    enter: { key: 'Enter', code: 'Enter' },
    return: { key: 'Enter', code: 'Enter' },
    backspace: { key: 'Backspace', code: 'Backspace' },
    delete: { key: 'Delete', code: 'Delete' },
    tab: { key: 'Tab', code: 'Tab' },
    escape: { key: 'Escape', code: 'Escape' },
    esc: { key: 'Escape', code: 'Escape' },
    space: { key: ' ', code: 'Space', text: ' ' },
    pageup: { key: 'PageUp', code: 'PageUp' },
    pagedown: { key: 'PageDown', code: 'PageDown' },
    home: { key: 'Home', code: 'Home' },
    end: { key: 'End', code: 'End' },
    arrowup: { key: 'ArrowUp', code: 'ArrowUp' },
    arrowdown: { key: 'ArrowDown', code: 'ArrowDown' },
    arrowleft: { key: 'ArrowLeft', code: 'ArrowLeft' },
    arrowright: { key: 'ArrowRight', code: 'ArrowRight' },
  };

  private static resolveKeyDef(token: string): { key: string; code?: string; text?: string } {
    const normalized = (token || '').toLowerCase();
    if (this.KEY_ALIASES[normalized]) return this.KEY_ALIASES[normalized];
    if (/^f([1-9]|1[0-2])$/.test(normalized)) {
      return { key: normalized.toUpperCase(), code: normalized.toUpperCase() };
    }
    if (normalized.length === 1) {
      const upper = normalized.toUpperCase();
      return { key: upper, code: `Key${upper}`, text: normalized };
    }
    return { key: token };
  }

  static async dispatchSimpleKey(tabId: number, token: string) {
    const def = this.resolveKeyDef(token);
    if (def.text && def.text.length === 1) {
      await this.insertText(tabId, def.text);
      return;
    }
    await this.send(tabId, 'Input.dispatchKeyEvent', {
      type: 'rawKeyDown',
      key: def.key,
      code: def.code,
    });
    await this.send(tabId, 'Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: def.key,
      code: def.code,
    });
  }

  static async dispatchKeyChord(tabId: number, chord: string) {
    const parts = chord.split('+');
    const modifiers: string[] = [];
    let keyToken = '';
    for (const rawPart of parts) {
      const part = rawPart.trim().toLowerCase();
      if (
        ['ctrl', 'control', 'alt', 'shift', 'cmd', 'meta', 'command', 'win', 'windows'].includes(
          part,
        )
      ) {
        modifiers.push(part);
      } else {
        keyToken = rawPart.trim();
      }
    }
    const mask = this.modifierMask(modifiers);
    const def = this.resolveKeyDef(keyToken);
    await this.send(tabId, 'Input.dispatchKeyEvent', {
      type: 'rawKeyDown',
      key: def.key,
      code: def.code,
      text: def.text,
      modifiers: mask,
    });
    await this.send(tabId, 'Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: def.key,
      code: def.code,
      modifiers: mask,
    });
  }
}

export function mapActionToCapture(action: string): ActionType | null {
  const mapping: Record<string, ActionType> = {
    left_click: 'click',
    right_click: 'right_click',
    double_click: 'double_click',
    triple_click: 'triple_click',
    left_click_drag: 'drag',
    scroll: 'scroll',
    type: 'type',
    key: 'key',
    hover: 'hover',
    fill: 'fill',
    fill_form: 'fill',
    resize_page: 'other',
    scroll_to: 'scroll',
    zoom: 'other',
  };
  return mapping[action] || null;
}

export async function domHoverFallback(
  sendMessageToTab: (tabId: number, message: unknown) => Promise<any>,
  tabId: number,
  coord?: Coordinates,
  resolvedBy?: 'ref' | 'selector' | 'coordinates',
  ref?: string,
): Promise<ToolResult> {
  if (ref) {
    try {
      const resp = await sendMessageToTab(tabId, {
        action: TOOL_MESSAGE_TYPES.DISPATCH_HOVER_FOR_REF,
        ref,
      });
      if (resp?.success) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                action: 'hover',
                resolvedBy: 'ref',
                transport: 'dom-ref',
                target: resp.target,
              }),
            },
          ],
          isError: false,
        };
      }
    } catch (error) {
      console.warn('[ComputerTool] DOM ref hover failed, falling back to coordinates', error);
    }
  }

  if (!coord) {
    return createErrorResponse('Hover fallback requires coordinates or ref');
  }

  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: (point) => {
        const target = document.elementFromPoint(point.x, point.y);
        if (!target) {
          return { success: false, error: 'No element found at coordinates' };
        }

        for (const type of ['mousemove', 'mouseover', 'mouseenter']) {
          target.dispatchEvent(
            new MouseEvent(type, {
              bubbles: true,
              cancelable: true,
              clientX: point.x,
              clientY: point.y,
              view: window,
            }),
          );
        }

        return {
          success: true,
          target: {
            tagName: target.tagName,
            id: target.id,
            className: target.className,
            text: target.textContent?.trim()?.slice(0, 100) || '',
          },
        };
      },
      args: [coord],
    });

    const payload = injection?.result;
    if (!payload?.success) {
      return createErrorResponse(payload?.error || 'DOM hover fallback failed');
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
            action: 'hover',
            coordinates: coord,
            resolvedBy,
            transport: 'dom',
            target: payload.target,
          }),
        },
      ],
      isError: false,
    };
  } catch (error) {
    return createErrorResponse(
      `DOM hover fallback failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function triggerAutoCapture(
  tabId: number,
  actionType: ActionType,
  metadata?: Partial<ActionMetadata>,
): Promise<void> {
  if (!isAutoCaptureActive(tabId)) {
    return;
  }

  try {
    await captureFrameOnAction(tabId, {
      type: actionType,
      ...metadata,
    });
  } catch (error) {
    console.warn('[ComputerTool] Auto-capture failed:', error);
  }
}

interface WaitActionContext {
  injectContentScript: (
    tabId: number,
    files: string[],
    allFrames?: boolean,
    world?: 'ISOLATED' | 'MAIN',
    reinstall?: boolean,
  ) => Promise<void>;
  sendMessageToTab: (tabId: number, message: unknown) => Promise<any>;
}

export async function executeWaitAction(
  context: WaitActionContext,
  tabId: number,
  params: ComputerParams,
): Promise<ToolResult> {
  const hasTextCondition = typeof params.text === 'string' && params.text.trim().length > 0;
  if (hasTextCondition) {
    try {
      await context.injectContentScript(
        tabId,
        ['inject-scripts/wait-helper.js'],
        false,
        'ISOLATED',
        true,
      );
      const appear = (params as any).appear !== false;
      const timeoutMs = Math.max(0, Math.min(((params as any).timeout as number) || 10000, 120000));
      const resp = await context.sendMessageToTab(tabId, {
        action: TOOL_MESSAGE_TYPES.WAIT_FOR_TEXT,
        text: params.text,
        appear,
        timeout: timeoutMs,
      });
      if (!resp || resp.success !== true) {
        return createErrorResponse(
          resp && resp.reason === 'timeout'
            ? `wait_for timed out after ${timeoutMs}ms for text: ${params.text}`
            : `wait_for failed: ${resp && resp.error ? resp.error : 'unknown error'}`,
        );
      }
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              action: 'wait_for',
              appear,
              text: params.text,
              matched: resp.matched || null,
              tookMs: resp.tookMs,
            }),
          },
        ],
        isError: false,
      };
    } catch (error) {
      return createErrorResponse(
        `wait_for failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const seconds = Math.max(0, Math.min((params as any).duration || 0, 30));
  if (!seconds) {
    return createErrorResponse('Duration parameter is required and must be > 0');
  }
  await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({ success: true, action: 'wait', duration: seconds }),
      },
    ],
    isError: false,
  };
}