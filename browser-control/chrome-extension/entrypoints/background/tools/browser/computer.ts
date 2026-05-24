import { createErrorResponse, ToolResult } from '@/common/tool-handler';
import { BaseBrowserToolExecutor } from '../base-browser';
import { TOOL_NAMES } from 'chrome-mcp-shared';
import { ERROR_MESSAGES, TIMEOUTS } from '@/common/constants';
import { TOOL_MESSAGE_TYPES } from '@/common/message-types';
import { clickTool, fillTool } from './interaction';
import { keyboardTool } from './keyboard';
import { screenshotTool } from './screenshot';
import { screenshotContextManager, scaleCoordinates } from '@/utils/screenshot-context';
import {
  type ActionType,
} from './gif-recorder';
import {
  CDPHelper,
  ComputerParams,
  Coordinates,
  MouseButton,
  domHoverFallback,
  executeWaitAction,
  mapActionToCapture,
  triggerAutoCapture,
} from './computer-shared';

class ComputerTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.COMPUTER;

  async execute(args: ComputerParams): Promise<ToolResult> {
    const params = args || ({} as ComputerParams);
    if (!params.action) return createErrorResponse('Action parameter is required');

    try {
      const explicit = await this.tryGetTab(args.tabId);
      const tab = explicit || (await this.getActiveTabOrThrowInWindow(args.windowId));
      if (!tab.id)
        return createErrorResponse(ERROR_MESSAGES.TAB_NOT_FOUND + ': Active tab has no ID');

      const result = await this.executeAction(params, tab);

      if (!result.isError && params.action !== 'screenshot' && params.action !== 'wait') {
        const actionType = mapActionToCapture(params.action);
        if (actionType) {
          const ctx = screenshotContextManager.getContext(tab.id);
          const toViewport = (c?: Coordinates): { x: number; y: number } | undefined => {
            if (!c) return undefined;
            if (!ctx) return { x: c.x, y: c.y };
            const scaled = scaleCoordinates(c.x, c.y, ctx);
            return { x: scaled.x, y: scaled.y };
          };

          const endCoords = toViewport(params.coordinates);
          const startCoords = toViewport(params.startCoordinates);

          await triggerAutoCapture(tab.id, actionType, {
            coordinateSpace: 'viewport',
            coordinates: endCoords,
            startCoordinates: startCoords,
            endCoordinates: actionType === 'drag' ? endCoords : undefined,
            text: params.text,
            ref: params.ref,
          });
        }
      }

      return result;
    } catch (error) {
      console.error('Error in computer tool:', error);
      return createErrorResponse(
        `Failed to execute action: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async executeAction(params: ComputerParams, tab: chrome.tabs.Tab): Promise<ToolResult> {
    if (!tab.id) {
      return createErrorResponse(ERROR_MESSAGES.TAB_NOT_FOUND + ': Active tab has no ID');
    }

    const project = (c?: Coordinates): Coordinates | undefined => {
      if (!c) return undefined;
      const ctx = screenshotContextManager.getContext(tab.id!);
      if (!ctx) return c;
      const scaled = scaleCoordinates(c.x, c.y, ctx);
      return { x: scaled.x, y: scaled.y };
    };

    switch (params.action) {
      case 'resize_page': {
        const width = Number((params as any).coordinates?.x || (params as any).text);
        const height = Number((params as any).coordinates?.y || (params as any).value);
        const w = Number((params as any).width ?? width);
        const h = Number((params as any).height ?? height);
        if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
          return createErrorResponse('Provide width and height for resize_page (positive numbers)');
        }
        try {
          await CDPHelper.attach(tab.id);
          try {
            await CDPHelper.send(tab.id, 'Emulation.setDeviceMetricsOverride', {
              width: Math.round(w),
              height: Math.round(h),
              deviceScaleFactor: 0,
              mobile: false,
              screenWidth: Math.round(w),
              screenHeight: Math.round(h),
            });
          } finally {
            await CDPHelper.detach(tab.id);
          }
        } catch (e) {
          if (tab.windowId !== undefined) {
            await chrome.windows.update(tab.windowId, {
              width: Math.round(w),
              height: Math.round(h),
            });
          } else {
            return createErrorResponse(
              `Failed to resize via CDP and cannot determine windowId: ${e instanceof Error ? e.message : String(e)}`,
            );
          }
        }
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ success: true, action: 'resize_page', width: w, height: h }),
            },
          ],
          isError: false,
        };
      }
      case 'hover': {
        let coord: Coordinates | undefined = undefined;
        let resolvedBy: 'ref' | 'selector' | 'coordinates' | undefined;

        try {
          if (params.ref) {
            await this.injectContentScript(tab.id, ['inject-scripts/accessibility-tree-helper.js']);
            try {
              await this.sendMessageToTab(tab.id, { action: 'focusByRef', ref: params.ref });
            } catch {}
            const resolved = await this.sendMessageToTab(tab.id, {
              action: TOOL_MESSAGE_TYPES.RESOLVE_REF,
              ref: params.ref,
            });
            if (resolved && resolved.success) {
              coord = project({ x: resolved.center.x, y: resolved.center.y });
              resolvedBy = 'ref';
            }
          } else if (params.selector) {
            await this.injectContentScript(tab.id, ['inject-scripts/accessibility-tree-helper.js']);
            const selectorType = params.selectorType || 'css';
            const ensured = await this.sendMessageToTab(tab.id, {
              action: TOOL_MESSAGE_TYPES.ENSURE_REF_FOR_SELECTOR,
              selector: params.selector,
              isXPath: selectorType === 'xpath',
            });
            if (ensured && ensured.success) {
              const resolvedRef = typeof ensured.ref === 'string' ? ensured.ref : undefined;
              if (resolvedRef) {
                try {
                  await this.sendMessageToTab(tab.id, { action: 'focusByRef', ref: resolvedRef });
                } catch {}
                const reResolved = await this.sendMessageToTab(tab.id, {
                  action: TOOL_MESSAGE_TYPES.RESOLVE_REF,
                  ref: resolvedRef,
                });
                if (reResolved && reResolved.success) {
                  coord = project({ x: reResolved.center.x, y: reResolved.center.y });
                } else {
                  coord = project({ x: ensured.center.x, y: ensured.center.y });
                }
              } else {
                coord = project({ x: ensured.center.x, y: ensured.center.y });
              }
              resolvedBy = 'selector';
            }
          } else if (params.coordinates) {
            coord = project(params.coordinates);
            resolvedBy = 'coordinates';
          }
        } catch {}

        if (!coord)
          return createErrorResponse(
            'Provide ref or selector or coordinates for hover, or failed to resolve target',
          );
        {
          const stale = ((): any => {
            if (!params.coordinates) return null;
            const getHostname = (url: string): string => {
              try {
                return new URL(url).hostname;
              } catch {
                return '';
              }
            };
            const currentHostname = getHostname(tab.url || '');
            const ctx = screenshotContextManager.getContext(tab.id!);
            const contextHostname = (ctx as any)?.hostname as string | undefined;
            if (contextHostname && contextHostname !== currentHostname) {
              return createErrorResponse(
                `Security check failed: Domain changed since last screenshot (from ${contextHostname} to ${currentHostname}) during hover. Capture a new screenshot or use ref/selector.`,
              );
            }
            return null;
          })();
          if (stale) return stale;
        }

        try {
          await CDPHelper.attach(tab.id);
          try {
            await CDPHelper.dispatchMouseEvent(tab.id, {
              type: 'mouseMoved',
              x: coord.x,
              y: coord.y,
              button: 'none',
              buttons: 0,
            });
          } finally {
            await CDPHelper.detach(tab.id);
          }

          const holdMs = Math.max(
            0,
            Math.min(params.duration ? params.duration * 1000 : 400, 5000),
          );
          if (holdMs > 0) await new Promise((r) => setTimeout(r, holdMs));

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: true,
                  action: 'hover',
                  coordinates: coord,
                  resolvedBy,
                  transport: 'cdp',
                }),
              },
            ],
            isError: false,
          };
        } catch (error) {
          console.warn('[ComputerTool] CDP hover failed, attempting DOM fallback', error);
          return await domHoverFallback(this.sendMessageToTab.bind(this), tab.id, coord, resolvedBy, params.ref);
        }
      }
      case 'left_click':
      case 'right_click': {
        const modifiersMask = CDPHelper.modifierMask(
          [
            params.modifiers?.altKey ? 'alt' : undefined,
            params.modifiers?.ctrlKey ? 'ctrl' : undefined,
            params.modifiers?.metaKey ? 'meta' : undefined,
            params.modifiers?.shiftKey ? 'shift' : undefined,
          ].filter((v): v is string => typeof v === 'string'),
        );

        if (params.ref) {
          // Prefer DOM click via ref
          const domResult = await clickTool.execute({
            ref: params.ref,
            waitForNavigation: false,
            timeout: TIMEOUTS.DEFAULT_WAIT * 5,
            button: params.action === 'right_click' ? 'right' : 'left',
            modifiers: params.modifiers,
          });
          return domResult;
        }
        if (params.selector) {
          // Support selector-based click
          const domResult = await clickTool.execute({
            selector: params.selector,
            selectorType: params.selectorType,
            frameId: params.frameId,
            waitForNavigation: false,
            timeout: TIMEOUTS.DEFAULT_WAIT * 5,
            button: params.action === 'right_click' ? 'right' : 'left',
            modifiers: params.modifiers,
          });
          return domResult;
        }
        if (!params.coordinates)
          return createErrorResponse('Provide ref, selector, or coordinates for click action');
        {
          const stale = ((): any => {
            const getHostname = (url: string): string => {
              try {
                return new URL(url).hostname;
              } catch {
                return '';
              }
            };
            const currentHostname = getHostname(tab.url || '');
            const ctx = screenshotContextManager.getContext(tab.id!);
            const contextHostname = (ctx as any)?.hostname as string | undefined;
            if (contextHostname && contextHostname !== currentHostname) {
              return createErrorResponse(
                `Security check failed: Domain changed since last screenshot (from ${contextHostname} to ${currentHostname}) during ${params.action}. Capture a new screenshot or use ref/selector.`,
              );
            }
            return null;
          })();
          if (stale) return stale;
        }
        const coord = project(params.coordinates)!;
        const domResult = await clickTool.execute({
          coordinates: coord,
          waitForNavigation: false,
          timeout: TIMEOUTS.DEFAULT_WAIT * 5,
          button: params.action === 'right_click' ? 'right' : 'left',
          modifiers: params.modifiers,
        });
        if (!domResult.isError) {
          return domResult; // Standardized response from click tool
        }
        try {
          await CDPHelper.attach(tab.id);
          const button: MouseButton = params.action === 'right_click' ? 'right' : 'left';
          const clickCount = 1;
          await CDPHelper.dispatchMouseEvent(tab.id, {
            type: 'mouseMoved',
            x: coord.x,
            y: coord.y,
            button: 'none',
            buttons: 0,
            modifiers: modifiersMask,
          });
          for (let i = 1; i <= clickCount; i++) {
            await CDPHelper.dispatchMouseEvent(tab.id, {
              type: 'mousePressed',
              x: coord.x,
              y: coord.y,
              button,
              buttons: button === 'left' ? 1 : 2,
              clickCount: i,
              modifiers: modifiersMask,
            });
            await CDPHelper.dispatchMouseEvent(tab.id, {
              type: 'mouseReleased',
              x: coord.x,
              y: coord.y,
              button,
              buttons: 0,
              clickCount: i,
              modifiers: modifiersMask,
            });
          }
          await CDPHelper.detach(tab.id);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: true,
                  action: params.action,
                  coordinates: coord,
                }),
              },
            ],
            isError: false,
          };
        } catch (e) {
          await CDPHelper.detach(tab.id);
          return createErrorResponse(
            `CDP click failed: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
      case 'double_click':
      case 'triple_click': {
        // Calculate CDP modifier mask for click events
        const modifiersMask = CDPHelper.modifierMask(
          [
            params.modifiers?.altKey ? 'alt' : undefined,
            params.modifiers?.ctrlKey ? 'ctrl' : undefined,
            params.modifiers?.metaKey ? 'meta' : undefined,
            params.modifiers?.shiftKey ? 'shift' : undefined,
          ].filter((v): v is string => typeof v === 'string'),
        );

        if (!params.coordinates && !params.ref && !params.selector)
          return createErrorResponse(
            'Provide ref, selector, or coordinates for double/triple click',
          );
        let coord = params.coordinates ? project(params.coordinates)! : (undefined as any);
        // If ref is provided, resolve center via accessibility helper
        if (params.ref) {
          try {
            await this.injectContentScript(tab.id, ['inject-scripts/accessibility-tree-helper.js']);
            const resolved = await this.sendMessageToTab(tab.id, {
              action: TOOL_MESSAGE_TYPES.RESOLVE_REF,
              ref: params.ref,
            });
            if (resolved && resolved.success) {
              coord = project({ x: resolved.center.x, y: resolved.center.y })!;
            }
          } catch (e) {
            // ignore and use provided coordinates
          }
        } else if (params.selector) {
          // Support selector-based click
          try {
            await this.injectContentScript(tab.id, ['inject-scripts/accessibility-tree-helper.js']);
            const selectorType = params.selectorType || 'css';
            const ensured = await this.sendMessageToTab(
              tab.id,
              {
                action: TOOL_MESSAGE_TYPES.ENSURE_REF_FOR_SELECTOR,
                selector: params.selector,
                isXPath: selectorType === 'xpath',
              },
              params.frameId,
            );
            if (ensured && ensured.success) {
              coord = project({ x: ensured.center.x, y: ensured.center.y })!;
            }
          } catch (e) {
            // ignore
          }
        }
        if (!coord) return createErrorResponse('Failed to resolve coordinates from ref/selector');
        {
          const stale = ((): any => {
            if (!params.coordinates) return null;
            const getHostname = (url: string): string => {
              try {
                return new URL(url).hostname;
              } catch {
                return '';
              }
            };
            const currentHostname = getHostname(tab.url || '');
            const ctx = screenshotContextManager.getContext(tab.id!);
            const contextHostname = (ctx as any)?.hostname as string | undefined;
            if (contextHostname && contextHostname !== currentHostname) {
              return createErrorResponse(
                `Security check failed: Domain changed since last screenshot (from ${contextHostname} to ${currentHostname}) during ${params.action}. Capture a new screenshot or use ref/selector.`,
              );
            }
            return null;
          })();
          if (stale) return stale;
        }
        try {
          await CDPHelper.attach(tab.id);
          const button: MouseButton = 'left';
          const clickCount = params.action === 'double_click' ? 2 : 3;
          await CDPHelper.dispatchMouseEvent(tab.id, {
            type: 'mouseMoved',
            x: coord.x,
            y: coord.y,
            button: 'none',
            buttons: 0,
            modifiers: modifiersMask,
          });
          for (let i = 1; i <= clickCount; i++) {
            await CDPHelper.dispatchMouseEvent(tab.id, {
              type: 'mousePressed',
              x: coord.x,
              y: coord.y,
              button,
              buttons: 1,
              clickCount: i,
              modifiers: modifiersMask,
            });
            await CDPHelper.dispatchMouseEvent(tab.id, {
              type: 'mouseReleased',
              x: coord.x,
              y: coord.y,
              button,
              buttons: 0,
              clickCount: i,
              modifiers: modifiersMask,
            });
          }
          await CDPHelper.detach(tab.id);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: true,
                  action: params.action,
                  coordinates: coord,
                }),
              },
            ],
            isError: false,
          };
        } catch (e) {
          await CDPHelper.detach(tab.id);
          return createErrorResponse(
            `CDP ${params.action} failed: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
      case 'left_click_drag': {
        if (!params.startCoordinates && !params.startRef)
          return createErrorResponse('Provide startRef or startCoordinates for drag');
        if (!params.coordinates && !params.ref)
          return createErrorResponse('Provide ref or end coordinates for drag');
        let start = params.startCoordinates
          ? project(params.startCoordinates)!
          : (undefined as any);
        let end = params.coordinates ? project(params.coordinates)! : (undefined as any);
        {
          const stale = ((): any => {
            if (!params.startCoordinates && !params.coordinates) return null;
            const getHostname = (url: string): string => {
              try {
                return new URL(url).hostname;
              } catch {
                return '';
              }
            };
            const currentHostname = getHostname(tab.url || '');
            const ctx = screenshotContextManager.getContext(tab.id!);
            const contextHostname = (ctx as any)?.hostname as string | undefined;
            if (contextHostname && contextHostname !== currentHostname) {
              return createErrorResponse(
                `Security check failed: Domain changed since last screenshot (from ${contextHostname} to ${currentHostname}) during left_click_drag. Capture a new screenshot or use ref/selector.`,
              );
            }
            return null;
          })();
          if (stale) return stale;
        }
        if (params.startRef || params.ref) {
          await this.injectContentScript(tab.id, ['inject-scripts/accessibility-tree-helper.js']);
        }
        if (params.startRef) {
          try {
            const resolved = await this.sendMessageToTab(tab.id, {
              action: TOOL_MESSAGE_TYPES.RESOLVE_REF,
              ref: params.startRef,
            });
            if (resolved && resolved.success)
              start = project({ x: resolved.center.x, y: resolved.center.y })!;
          } catch {
            // ignore
          }
        }
        if (params.ref) {
          try {
            const resolved = await this.sendMessageToTab(tab.id, {
              action: TOOL_MESSAGE_TYPES.RESOLVE_REF,
              ref: params.ref,
            });
            if (resolved && resolved.success)
              end = project({ x: resolved.center.x, y: resolved.center.y })!;
          } catch {
            // ignore
          }
        }
        if (!start || !end) return createErrorResponse('Failed to resolve drag coordinates');
        try {
          await CDPHelper.attach(tab.id);
          await CDPHelper.dispatchMouseEvent(tab.id, {
            type: 'mouseMoved',
            x: start.x,
            y: start.y,
            button: 'none',
            buttons: 0,
          });
          await CDPHelper.dispatchMouseEvent(tab.id, {
            type: 'mousePressed',
            x: start.x,
            y: start.y,
            button: 'left',
            buttons: 1,
            clickCount: 1,
          });
          await CDPHelper.dispatchMouseEvent(tab.id, {
            type: 'mouseMoved',
            x: end.x,
            y: end.y,
            button: 'left',
            buttons: 1,
          });
          await CDPHelper.dispatchMouseEvent(tab.id, {
            type: 'mouseReleased',
            x: end.x,
            y: end.y,
            button: 'left',
            buttons: 0,
            clickCount: 1,
          });
          await CDPHelper.detach(tab.id);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ success: true, action: 'left_click_drag', start, end }),
              },
            ],
            isError: false,
          };
        } catch (e) {
          await CDPHelper.detach(tab.id);
          return createErrorResponse(`Drag failed: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      case 'scroll': {
        if (!params.coordinates && !params.ref)
          return createErrorResponse('Provide ref or coordinates for scroll');
        let coord = params.coordinates ? project(params.coordinates)! : (undefined as any);
        if (params.ref) {
          try {
            await this.injectContentScript(tab.id, ['inject-scripts/accessibility-tree-helper.js']);
            const resolved = await this.sendMessageToTab(tab.id, {
              action: TOOL_MESSAGE_TYPES.RESOLVE_REF,
              ref: params.ref,
            });
            if (resolved && resolved.success)
              coord = project({ x: resolved.center.x, y: resolved.center.y })!;
          } catch {
            // ignore
          }
        }
        if (!coord) return createErrorResponse('Failed to resolve scroll coordinates');
        {
          const stale = ((): any => {
            if (!params.coordinates) return null;
            const getHostname = (url: string): string => {
              try {
                return new URL(url).hostname;
              } catch {
                return '';
              }
            };
            const currentHostname = getHostname(tab.url || '');
            const ctx = screenshotContextManager.getContext(tab.id!);
            const contextHostname = (ctx as any)?.hostname as string | undefined;
            if (contextHostname && contextHostname !== currentHostname) {
              return createErrorResponse(
                `Security check failed: Domain changed since last screenshot (from ${contextHostname} to ${currentHostname}) during scroll. Capture a new screenshot or use ref/selector.`,
              );
            }
            return null;
          })();
          if (stale) return stale;
        }
        const direction = params.scrollDirection || 'down';
        const amount = Math.max(1, Math.min(params.scrollAmount || 3, 10));
        // Convert to deltas (~100px per tick)
        const unit = 100;
        let deltaX = 0,
          deltaY = 0;
        if (direction === 'up') deltaY = -amount * unit;
        if (direction === 'down') deltaY = amount * unit;
        if (direction === 'left') deltaX = -amount * unit;
        if (direction === 'right') deltaX = amount * unit;
        try {
          await CDPHelper.attach(tab.id);
          await CDPHelper.dispatchMouseEvent(tab.id, {
            type: 'mouseWheel',
            x: coord.x,
            y: coord.y,
            deltaX,
            deltaY,
          });
          await CDPHelper.detach(tab.id);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: true,
                  action: 'scroll',
                  coordinates: coord,
                  deltaX,
                  deltaY,
                }),
              },
            ],
            isError: false,
          };
        } catch (e) {
          await CDPHelper.detach(tab.id);
          return createErrorResponse(
            `Scroll failed: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
      case 'type': {
        if (!params.text) return createErrorResponse('Text parameter is required for type action');
        try {
          // Optional focus via ref before typing
          if (params.ref) {
            await clickTool.execute({
              ref: params.ref,
              waitForNavigation: false,
              timeout: TIMEOUTS.DEFAULT_WAIT * 5,
            });
          }
          await CDPHelper.attach(tab.id);
          // Use CDP insertText to avoid complex KeyboardEvent emulation for long text
          await CDPHelper.insertText(tab.id, params.text);
          await CDPHelper.detach(tab.id);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: true,
                  action: 'type',
                  length: params.text.length,
                }),
              },
            ],
            isError: false,
          };
        } catch (e) {
          await CDPHelper.detach(tab.id);
          // Fallback to DOM-based keyboard tool
          const res = await keyboardTool.execute({
            keys: params.text.split('').join(','),
            delay: 0,
            selector: undefined,
          });
          return res;
        }
      }
      case 'fill': {
        if (!params.ref && !params.selector) {
          return createErrorResponse('Provide ref or selector and a value for fill');
        }
        // Reuse existing fill tool to leverage robust DOM event behavior
        const res = await fillTool.execute({
          selector: params.selector as any,
          selectorType: params.selectorType as any,
          ref: params.ref as any,
          value: params.value as any,
        } as any);
        return res;
      }
      case 'fill_form': {
        const elements = (params as any).elements as Array<{
          ref: string;
          value: string | number | boolean;
        }>;
        if (!Array.isArray(elements) || elements.length === 0) {
          return createErrorResponse('elements must be a non-empty array for fill_form');
        }
        const results: Array<{ ref: string; ok: boolean; error?: string }> = [];
        for (const item of elements) {
          if (!item || !item.ref) {
            results.push({ ref: String(item?.ref || ''), ok: false, error: 'missing ref' });
            continue;
          }
          try {
            const r = await fillTool.execute({
              ref: item.ref as any,
              value: item.value as any,
            } as any);
            const ok = !r.isError;
            results.push({ ref: item.ref, ok, error: ok ? undefined : 'failed' });
          } catch (e) {
            results.push({
              ref: item.ref,
              ok: false,
              error: String(e instanceof Error ? e.message : e),
            });
          }
        }
        const successCount = results.filter((r) => r.ok).length;
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                action: 'fill_form',
                filled: successCount,
                total: results.length,
                results,
              }),
            },
          ],
          isError: false,
        };
      }
      case 'key': {
        if (!params.text)
          return createErrorResponse(
            'text is required for key action (e.g., "Backspace Backspace Enter" or "cmd+a")',
          );
        const tokens = params.text.trim().split(/\s+/).filter(Boolean);
        const repeat = params.repeat ?? 1;
        if (!Number.isInteger(repeat) || repeat < 1 || repeat > 100) {
          return createErrorResponse('repeat must be an integer between 1 and 100 for key action');
        }
        try {
          // Optional focus via ref before key events
          if (params.ref) {
            await clickTool.execute({
              ref: params.ref,
              waitForNavigation: false,
              timeout: TIMEOUTS.DEFAULT_WAIT * 5,
            });
          }
          await CDPHelper.attach(tab.id);
          for (let i = 0; i < repeat; i++) {
            for (const t of tokens) {
              if (t.includes('+')) await CDPHelper.dispatchKeyChord(tab.id, t);
              else await CDPHelper.dispatchSimpleKey(tab.id, t);
            }
          }
          await CDPHelper.detach(tab.id);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ success: true, action: 'key', keys: tokens, repeat }),
              },
            ],
            isError: false,
          };
        } catch (e) {
          await CDPHelper.detach(tab.id);
          // Fallback to DOM keyboard simulation (comma-separated combinations)
          const keysStr = tokens.join(',');
          const repeatedKeys =
            repeat === 1 ? keysStr : Array.from({ length: repeat }, () => keysStr).join(',');
          const res = await keyboardTool.execute({ keys: repeatedKeys });
          return res;
        }
      }
      case 'wait': {
        return await executeWaitAction(
          {
            injectContentScript: this.injectContentScript.bind(this),
            sendMessageToTab: this.sendMessageToTab.bind(this),
          },
          tab.id,
          params,
        );
      }
      case 'scroll_to': {
        if (!params.ref) {
          return createErrorResponse('ref is required for scroll_to action');
        }
        try {
          await this.injectContentScript(tab.id, ['inject-scripts/accessibility-tree-helper.js']);
          const resp = await this.sendMessageToTab(tab.id, {
            action: 'focusByRef',
            ref: params.ref,
          });
          if (!resp || resp.success !== true) {
            return createErrorResponse(resp?.error || 'scroll_to failed: element not found');
          }
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: true,
                  action: 'scroll_to',
                  ref: params.ref,
                }),
              },
            ],
            isError: false,
          };
        } catch (e) {
          return createErrorResponse(
            `scroll_to failed: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
      case 'zoom': {
        const region = params.region;
        if (!region) {
          return createErrorResponse('region is required for zoom action');
        }
        const x0 = Number(region.x0);
        const y0 = Number(region.y0);
        const x1 = Number(region.x1);
        const y1 = Number(region.y1);
        if (![x0, y0, x1, y1].every(Number.isFinite)) {
          return createErrorResponse('region must contain finite numbers (x0, y0, x1, y1)');
        }
        if (x0 < 0 || y0 < 0 || x1 <= x0 || y1 <= y0) {
          return createErrorResponse('Invalid region: require x0>=0, y0>=0 and x1>x0, y1>y0');
        }

        // Project coordinates from screenshot space to viewport space
        const p0 = project({ x: x0, y: y0 })!;
        const p1 = project({ x: x1, y: y1 })!;
        const rx0 = Math.min(p0.x, p1.x);
        const ry0 = Math.min(p0.y, p1.y);
        const rx1 = Math.max(p0.x, p1.x);
        const ry1 = Math.max(p0.y, p1.y);
        const w = rx1 - rx0;
        const h = ry1 - ry0;
        if (w <= 0 || h <= 0) {
          return createErrorResponse('Invalid region after projection');
        }

        // Security check: verify domain hasn't changed since last screenshot
        {
          const getHostname = (url: string): string => {
            try {
              return new URL(url).hostname;
            } catch {
              return '';
            }
          };
          const ctx = screenshotContextManager.getContext(tab.id!);
          const contextHostname = (ctx as any)?.hostname as string | undefined;
          const currentHostname = getHostname(tab.url || '');
          if (contextHostname && contextHostname !== currentHostname) {
            return createErrorResponse(
              `Security check failed: Domain changed since last screenshot (from ${contextHostname} to ${currentHostname}) during zoom. Capture a new screenshot first.`,
            );
          }
        }

        try {
          await CDPHelper.attach(tab.id);
          const metrics: any = await CDPHelper.send(tab.id, 'Page.getLayoutMetrics', {});
          const viewport = metrics?.layoutViewport ||
            metrics?.visualViewport || {
              clientWidth: 800,
              clientHeight: 600,
              pageX: 0,
              pageY: 0,
            };
          const vw = Math.round(Number(viewport.clientWidth || 800));
          const vh = Math.round(Number(viewport.clientHeight || 600));
          if (rx1 > vw || ry1 > vh) {
            await CDPHelper.detach(tab.id);
            return createErrorResponse(
              `Region exceeds viewport boundaries (${vw}x${vh}). Choose a region within the visible viewport.`,
            );
          }
          const pageX = Number(viewport.pageX || 0);
          const pageY = Number(viewport.pageY || 0);

          const shot: any = await CDPHelper.send(tab.id, 'Page.captureScreenshot', {
            format: 'png',
            captureBeyondViewport: false,
            fromSurface: true,
            clip: {
              x: pageX + rx0,
              y: pageY + ry0,
              width: w,
              height: h,
              scale: 1,
            },
          });
          await CDPHelper.detach(tab.id);

          const base64Data = String(shot?.data || '');
          if (!base64Data) {
            return createErrorResponse('Failed to capture zoom screenshot via CDP');
          }
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: true,
                  action: 'zoom',
                  type: 'image',
                  mimeType: 'image/png',
                  data: base64Data,
                  region: { x0: rx0, y0: ry0, x1: rx1, y1: ry1 },
                }),
              },
            ],
            isError: false,
          };
        } catch (e) {
          await CDPHelper.detach(tab.id);
          return createErrorResponse(`zoom failed: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      case 'screenshot': {
        // Reuse existing screenshot tool; it already supports base64 save option
        const result = await screenshotTool.execute({
          name: 'computer',
          storeBase64: true,
          fullPage: false,
        });
        return result;
      }
      default:
        return createErrorResponse(`Unsupported action: ${params.action}`);
    }
  }
}

export const computerTool = new ComputerTool();
