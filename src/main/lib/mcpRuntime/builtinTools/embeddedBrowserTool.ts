/**
 * EmbeddedBrowserTool — agent-facing control of the in-app embedded browser.
 *
 * One consolidated tool with an `action` discriminator (mirrors manage_process /
 * browser automation). The actual web page is a native Electron
 * WebContentsView owned by EmbeddedBrowserManager (one view per chat session);
 * this tool drives that view for the CURRENT session.
 *
 * Actions:
 *  - navigate/get_state/back/forward/reload/stop
 *  - screenshot/read_page/inspect/diagnostics
 *  - click/type/wait_for/scroll/press_key/hover/clear/select_option
 *
 * Per-session: the target view is resolved from the chatSessionId captured by
 * BuiltinMcpClient before async tool-dispatch boundaries. The model never
 * passes a sessionId, so two chats can each drive their own browser.
 *
 * Input engine: click/type dispatch *trusted* events through the Chrome
 * DevTools Protocol (webContents.debugger), not synthetic JS events — this
 * survives React's synthetic-event handling, real focus, and trusted-event
 * checks. Element geometry is resolved in-page (getBoundingClientRect after
 * scrollIntoView) and the CDP input is dispatched at the element's center.
 *
 * Vision: `screenshot` returns `{ type:'image', data:<base64>, mimeType }`.
 * The turn runner detects this shape, strips the base64 from the transcript,
 * and injects a vision message so the agent literally sees the page. `data`
 * MUST be raw base64 with NO `data:` prefix (the prefix breaks dedup hashing).
 *
 * Safety: this tool never publishes/pays/deletes on its own. For any
 * high-impact / irreversible action the agent must first call the
 * `request_interactive_input` tool (a blocking confirmation card), matching
 * Codex's "stop before high-impact action" rule.
 *
 * Errors never throw out of `execute`; every failure returns `{ ok:false,
 * error }` JSON so the agent can read the reason and recover.
 */

import { getEmbeddedBrowserManager, redactEmbeddedBrowserDiagnosticUrl, registerEmbeddedBrowserRuntimeCleanup } from '../../embeddedBrowser/EmbeddedBrowserManager';
import { createLogger } from '../../unifiedLogger';
import { FileSecurityValidator } from '../../security/fileSecurityValidator';
import * as fs from 'fs';
import * as path from 'path';
import { assertClickableExpression, assertTextExpression, assertVisibleExpression, clearFieldExpression, dialogOpenExpression, elementRectExpression, enabledStateExpression, existsExpression, fileInputObjectExpression, focusFieldExpression, formValidityExpression, imagesLoadedExpression, inspectExpression, inspectFramesExpression, layoutAuditExpression, listItemsExpression, mediaRenderedExpression, multiSelectExpression, networkErrorsExpression, notBlankExpression, readPageExpression, resolveTargetExpression, runtimeDiagnosticsExpression, scrollExpression, selectOptionExpression, semanticContainerExpression, setDateExpression, setSliderExpression, tableRowsExpression, toastExpression } from './embeddedBrowserToolExpressions';
import { WorkspacePreviewServer } from './embeddedBrowserPreviewServer';
import { captureComparableScreenshot, clearVisualBaselines, compareScreenshotPixels, configureBrowserVisualHelpers, getVisualBaseline, isToolError, resolveScreenshotViewport, screenshotHash, storeVisualBaseline } from './embeddedBrowserVisualHelpers';
import { accessibilitySnapshot, assertClickable, assertDialogOpen, assertDownloaded, assertEnabledState, assertFormValidity, assertImagesLoaded, assertListItems, assertMediaRendered, assertNoConsoleErrors, assertNoNetworkErrors, assertNotBlank, assertSemanticContainer, assertTableRows, assertText, assertToast, assertUrl, assertVisible, configureBrowserAssertionHandlers, downloadDiagnostics, inspectFrames, layoutAudit, multiSelect, networkDiagnostics, setDate } from './embeddedBrowserAssertionHandlers';

const logger = createLogger();

/** Result caps to keep read_page from flooding the model context. */
const MAX_TEXT_CHARS = 20000;
const MAX_HEADINGS = 50;
const MAX_LINKS = 100;
const MAX_INSPECT_ELEMENTS = 120;

/** wait_for polling. */
const DEFAULT_WAIT_MS = 10000;
const MAX_WAIT_MS = 30000;
const WAIT_POLL_MS = 250;

import type { BrowserAction, EmbeddedBrowserToolArgs } from './embeddedBrowserToolTypes';

interface ExecuteOptions {
  signal?: AbortSignal;
  chatSessionId?: string;
  workspaceRoot?: string;
}

/** A simple failure envelope the agent can read and recover from. */
type ToolError = { ok: false; error: string };

export class EmbeddedBrowserTool {
  static {
    registerEmbeddedBrowserRuntimeCleanup((sessionId) => {
      clearVisualBaselines(sessionId);
      WorkspacePreviewServer.shared().clear(sessionId);
    });
    configureBrowserAssertionHandlers({
      ensurePageReady: EmbeddedBrowserTool.ensurePageReady,
      fail: EmbeddedBrowserTool.fail,
      hasLocator: EmbeddedBrowserTool.hasLocator,
      hasFieldLocator: EmbeddedBrowserTool.hasFieldLocator,
    });
  }

  static {
    configureBrowserVisualHelpers({
      fail: EmbeddedBrowserTool.fail,
      hasLocator: EmbeddedBrowserTool.hasLocator,
    });
  }

  /**
   * Dispatch a `browser` tool call. Returns a plain JSON-able object for all
   * actions except `screenshot`, which returns the `{type:'image',...}` shape
   * the turn runner converts into a vision message. Never throws.
   */
  static async execute(args: EmbeddedBrowserToolArgs, options: ExecuteOptions = {}): Promise<unknown> {
    const { signal, chatSessionId, workspaceRoot } = options;
    try {
      const action = args?.action;
      if (!action) return EmbeddedBrowserTool.fail('Missing required "action".');

      const sessionId = chatSessionId;
      if (!sessionId) {
        return EmbeddedBrowserTool.fail('No chat session context; cannot target a browser view.');
      }

      const manager = getEmbeddedBrowserManager();
      if (!manager) {
        return EmbeddedBrowserTool.fail('Embedded browser is not available in this build.');
      }

      switch (action) {
        case 'navigate':
          return await EmbeddedBrowserTool.navigate(manager, sessionId, args, signal);
        case 'open_local_file':
          return await EmbeddedBrowserTool.openLocalFile(manager, sessionId, args, signal, workspaceRoot);
        case 'get_state':
          return await EmbeddedBrowserTool.getState(manager, sessionId, signal);
        case 'back':
          return await EmbeddedBrowserTool.history(manager, sessionId, 'back', signal);
        case 'forward':
          return await EmbeddedBrowserTool.history(manager, sessionId, 'forward', signal);
        case 'reload':
          return await EmbeddedBrowserTool.reload(manager, sessionId, signal);
        case 'stop':
          return await EmbeddedBrowserTool.stop(manager, sessionId, signal);
        case 'screenshot':
          return await EmbeddedBrowserTool.screenshot(manager, sessionId, args, signal);
        case 'capture_visual_baseline':
          return await EmbeddedBrowserTool.captureVisualBaseline(manager, sessionId, args, signal);
        case 'compare_visual_baseline':
          return await EmbeddedBrowserTool.compareVisualBaseline(manager, sessionId, args, signal);
        case 'read_page':
          return await EmbeddedBrowserTool.readPage(manager, sessionId, signal);
        case 'inspect':
          return await EmbeddedBrowserTool.inspect(manager, sessionId, signal);
        case 'diagnostics':
          return await EmbeddedBrowserTool.diagnostics(manager, sessionId, signal);
        case 'click':
          return await EmbeddedBrowserTool.click(manager, sessionId, args, signal, 'left', 1);
        case 'double_click':
          return await EmbeddedBrowserTool.click(manager, sessionId, args, signal, 'left', 2);
        case 'right_click':
          return await EmbeddedBrowserTool.click(manager, sessionId, args, signal, 'right', 1);
        case 'type':
          return await EmbeddedBrowserTool.type(manager, sessionId, args, signal);
        case 'wait_for':
          return await EmbeddedBrowserTool.waitFor(manager, sessionId, args, signal);
        case 'wait_for_url':
          return await EmbeddedBrowserTool.waitForUrl(manager, sessionId, args, signal);
        case 'scroll':
          return await EmbeddedBrowserTool.scroll(manager, sessionId, args, signal);
        case 'press_key':
          return await EmbeddedBrowserTool.pressKey(manager, sessionId, args, signal);
        case 'hover':
          return await EmbeddedBrowserTool.hover(manager, sessionId, args, signal);
        case 'clear':
          return await EmbeddedBrowserTool.clear(manager, sessionId, args, signal);
        case 'select_option':
          return await EmbeddedBrowserTool.selectOption(manager, sessionId, args, signal);
        case 'upload_file':
          return await EmbeddedBrowserTool.uploadFile(manager, sessionId, args, signal, workspaceRoot);
        case 'paste':
          return await EmbeddedBrowserTool.paste(manager, sessionId, args, signal);
        case 'drag':
          return await EmbeddedBrowserTool.drag(manager, sessionId, args, signal);
        case 'set_slider':
          return await EmbeddedBrowserTool.setSlider(manager, sessionId, args, signal);
        case 'assert_visible':
          return await assertVisible(manager, sessionId, args, signal);
        case 'assert_text':
          return await assertText(manager, sessionId, args, signal);
        case 'assert_clickable':
          return await assertClickable(manager, sessionId, args, signal);
        case 'assert_enabled':
          return await assertEnabledState(manager, sessionId, args, signal, true);
        case 'assert_disabled':
          return await assertEnabledState(manager, sessionId, args, signal, false);
        case 'assert_url':
          return await assertUrl(manager, sessionId, args, signal);
        case 'assert_not_blank':
          return await assertNotBlank(manager, sessionId, signal);
        case 'assert_images_loaded':
          return await assertImagesLoaded(manager, sessionId, signal);
        case 'assert_media_rendered':
          return await assertMediaRendered(manager, sessionId, args, signal);
        case 'assert_dialog_open':
          return await assertDialogOpen(manager, sessionId, args, signal);
        case 'assert_toast':
          return await assertToast(manager, sessionId, args, signal);
        case 'assert_table_rows':
          return await assertTableRows(manager, sessionId, args, signal);
        case 'assert_form_validity':
          return await assertFormValidity(manager, sessionId, args, signal);
        case 'assert_menu_open':
          return await assertSemanticContainer(manager, sessionId, args, signal, 'menu');
        case 'assert_tooltip':
          return await assertSemanticContainer(manager, sessionId, args, signal, 'tooltip');
        case 'assert_drawer_open':
          return await assertSemanticContainer(manager, sessionId, args, signal, 'drawer');
        case 'assert_list_items':
          return await assertListItems(manager, sessionId, args, signal);
        case 'assert_card_visible':
          return await assertSemanticContainer(manager, sessionId, args, signal, 'card');
        case 'assert_no_console_errors':
          return await assertNoConsoleErrors(manager, sessionId, signal);
        case 'assert_no_network_errors':
          return await assertNoNetworkErrors(manager, sessionId, signal);
        case 'accessibility_snapshot':
          return await accessibilitySnapshot(manager, sessionId, signal);
        case 'set_date':
          return await setDate(manager, sessionId, args, signal);
        case 'multi_select':
          return await multiSelect(manager, sessionId, args, signal);
        case 'network_diagnostics':
          return await networkDiagnostics(manager, sessionId, signal);
        case 'download_diagnostics':
          return await downloadDiagnostics(manager, sessionId, signal);
        case 'assert_downloaded':
          return await assertDownloaded(manager, sessionId, args, signal);
        case 'inspect_frames':
          return await inspectFrames(manager, sessionId, signal);
        case 'layout_audit':
          return await layoutAudit(manager, sessionId, signal);
        default:
          return EmbeddedBrowserTool.fail(`Unknown action "${String(action)}".`);
      }

    } catch (err) {
      // Defensive catch-all: surface the reason instead of throwing so the
      // agent can read it and try a different approach.
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(`[EmbeddedBrowserTool] ${args?.action} failed: ${message}`);
      return EmbeddedBrowserTool.fail(message);
    }
  }

  // ── action handlers ────────────────────────────────────────────────────────

  private static async getState(
    manager: NonNullable<ReturnType<typeof getEmbeddedBrowserManager>>,
    sessionId: string,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const nav = manager.getNavState(sessionId);
    if (!nav && !manager.hasNavigablePage(sessionId)) {
      return { ok: true, hasPage: false };
    }
    const restored = await EmbeddedBrowserTool.ensurePageReady(manager, sessionId, signal);
    if (restored) return restored;
    const currentNav = manager.getNavState(sessionId);
    return { ok: true, hasPage: !!currentNav, ...EmbeddedBrowserTool.redactNavState(currentNav) };
  }

  private static async history(
    manager: NonNullable<ReturnType<typeof getEmbeddedBrowserManager>>,
    sessionId: string,
    direction: 'back' | 'forward',
    signal?: AbortSignal,
  ): Promise<unknown> {
    const restored = await EmbeddedBrowserTool.ensurePageReady(manager, sessionId, signal);
    if (restored) return restored;
    direction === 'back' ? manager.goBack(sessionId) : manager.goForward(sessionId);
    return { ok: true, action: direction, ...EmbeddedBrowserTool.redactNavState(manager.getNavState(sessionId)) };
  }

  private static async reload(
    manager: NonNullable<ReturnType<typeof getEmbeddedBrowserManager>>,
    sessionId: string,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const restored = await EmbeddedBrowserTool.ensurePageReady(manager, sessionId, signal);
    if (restored) return restored;
    manager.reload(sessionId);
    return { ok: true, action: 'reload', ...EmbeddedBrowserTool.redactNavState(manager.getNavState(sessionId)) };
  }

  private static async stop(
    manager: NonNullable<ReturnType<typeof getEmbeddedBrowserManager>>,
    sessionId: string,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const restored = await EmbeddedBrowserTool.ensurePageReady(manager, sessionId, signal);
    if (restored) return restored;
    manager.stop(sessionId);
    return { ok: true, action: 'stop', ...EmbeddedBrowserTool.redactNavState(manager.getNavState(sessionId)) };
  }

  private static async navigate(
    manager: NonNullable<ReturnType<typeof getEmbeddedBrowserManager>>,
    sessionId: string,
    args: EmbeddedBrowserToolArgs,
    signal?: AbortSignal,
    workspaceRoot?: string,
  ): Promise<unknown> {
    const raw = args.url?.trim();
    if (!raw) return EmbeddedBrowserTool.fail('navigate requires a "url".');
    const url = EmbeddedBrowserTool.normalizeUrl(raw);
    const nav = await manager.ensureViewForAutomation(sessionId, url, signal);
    return {
      ok: true,
      url: redactEmbeddedBrowserDiagnosticUrl(nav.url),
      title: nav.title,
      isLoading: nav.isLoading,
      canGoBack: nav.canGoBack,
      canGoForward: nav.canGoForward,
    };
  }

  private static async openLocalFile(
    manager: NonNullable<ReturnType<typeof getEmbeddedBrowserManager>>,
    sessionId: string,
    args: EmbeddedBrowserToolArgs,
    signal?: AbortSignal,
    workspaceRoot?: string,
  ): Promise<unknown> {
    const rawPath = args.localPath?.trim() || args.filePath?.trim() || args.url?.trim();
    if (!rawPath) return EmbeddedBrowserTool.fail('open_local_file requires "localPath".');
    const root = EmbeddedBrowserTool.getTrustedWorkspaceRoot(workspaceRoot);
    const preview = await WorkspacePreviewServer.shared().register(sessionId, root, rawPath);
    const nav = await manager.ensureViewForAutomation(sessionId, preview.url, signal);
    return {
      ok: true,
      url: nav.url,
      title: nav.title,
      isLoading: nav.isLoading,
      canGoBack: nav.canGoBack,
      canGoForward: nav.canGoForward,
      localPath: preview.filePath,
      workspaceRoot: preview.workspaceRoot,
    };
  }

  private static async screenshot(
    manager: NonNullable<ReturnType<typeof getEmbeddedBrowserManager>>,
    sessionId: string,
    args: EmbeddedBrowserToolArgs,
    signal?: AbortSignal,
    workspaceRoot?: string,
  ): Promise<unknown> {
    // Only reveal/ensure a view when this session actually has a page. A fresh,
    // never-navigated session has nothing to capture, so creating a blank view
    // and auto-opening the panel (what ensureViewForAutomation does) would just
    // flash an empty browser at the user before we error. Fail cleanly instead.
    if (!manager.hasNavigablePage(sessionId)) {
      return EmbeddedBrowserTool.fail(
        'The embedded browser has no page open yet. Call the navigate action first.',
      );
    }
    // Make sure the (existing or reclaimed) view is revealed and ready.
    await manager.ensureViewForAutomation(sessionId, undefined, signal);
    const viewport = await resolveScreenshotViewport(manager, sessionId, args);
    const previousViewport = viewport ? manager.getAutomationViewport(sessionId) : null;
    if (viewport) {
      manager.setAutomationViewport(sessionId, viewport.width, viewport.height);
    }
    try {
      const rect = EmbeddedBrowserTool.hasLocator(args)
        ? await manager.executeJs(sessionId, elementRectExpression(args)) as CaptureRect | null
        : null;
      if (EmbeddedBrowserTool.hasLocator(args) && !rect) {
        return EmbeddedBrowserTool.fail('No element matched the screenshot locator.');
      }
      const shot = await manager.captureScreenshot(sessionId, rect ?? undefined);
      // This exact shape is what the turn runner turns into a vision message.
      return { type: 'image', data: shot.data, mimeType: shot.mimeType };
    } finally {
      if (previousViewport) {
        manager.setAutomationViewport(sessionId, previousViewport.width, previousViewport.height);
      }
    }
  }

  private static async captureVisualBaseline(
      manager: NonNullable<ReturnType<typeof getEmbeddedBrowserManager>>,
      sessionId: string,
      args: EmbeddedBrowserToolArgs,
      signal?: AbortSignal,
    ): Promise<unknown> {
      const baselineName = args.baselineName?.trim();
      if (!baselineName) return EmbeddedBrowserTool.fail('capture_visual_baseline requires baselineName.');
      const shot = await captureComparableScreenshot(manager, sessionId, args, signal);
      if (isToolError(shot)) return shot;
      const hash = screenshotHash(shot.data);
      const bytes = Buffer.byteLength(shot.data, 'base64');
      const capturedAt = Date.now();
      const storeError = storeVisualBaseline(sessionId, baselineName, { data: shot.data, hash, bytes, mimeType: shot.mimeType, capturedAt });
      if (storeError) return storeError;
      return { ok: true, baselineName, hash, bytes, mimeType: shot.mimeType, capturedAt };
    }

  static clearVisualBaselines(sessionId?: string): void {
    clearVisualBaselines(sessionId);
  }

  private static async compareVisualBaseline(
      manager: NonNullable<ReturnType<typeof getEmbeddedBrowserManager>>,
      sessionId: string,
      args: EmbeddedBrowserToolArgs,
      signal?: AbortSignal,
    ): Promise<unknown> {
      const baselineName = args.baselineName?.trim();
      if (!baselineName) return EmbeddedBrowserTool.fail('compare_visual_baseline requires baselineName.');
      const baseline = getVisualBaseline(sessionId, baselineName);
      if (!baseline) return EmbeddedBrowserTool.fail(`No visual baseline named "${baselineName}" exists for this chat session.`);
      const shot = await captureComparableScreenshot(manager, sessionId, args, signal);
      if (isToolError(shot)) return shot;
      const hash = screenshotHash(shot.data);
      const bytes = Buffer.byteLength(shot.data, 'base64');
      const pixelDiff = await compareScreenshotPixels(baseline.data, shot.data, args.pixelThreshold, args.includeDiffImage === true);
      const matched = hash === baseline.hash || pixelDiff.changedPixels === 0;
      return {
        ok: matched,
        matched,
        baselineName,
        baselineHash: baseline.hash,
        currentHash: hash,
        baselineBytes: baseline.bytes,
        currentBytes: bytes,
        byteDelta: bytes - baseline.bytes,
        pixelDiff,
        baselineCapturedAt: baseline.capturedAt,
        mimeType: shot.mimeType,
      };
  }

  private static async readPage(
    manager: NonNullable<ReturnType<typeof getEmbeddedBrowserManager>>,
    sessionId: string,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const restored = await EmbeddedBrowserTool.ensurePageReady(manager, sessionId, signal);
    if (restored) return restored;
    const expr = readPageExpression();
    const page = await manager.executeJs(sessionId, expr);
    return { ok: true, ...(page as Record<string, unknown>) };
  }

  private static async inspect(
    manager: NonNullable<ReturnType<typeof getEmbeddedBrowserManager>>,
    sessionId: string,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const restored = await EmbeddedBrowserTool.ensurePageReady(manager, sessionId, signal);
    if (restored) return restored;
    const page = await manager.executeJs(sessionId, inspectExpression());
    return { ok: true, ...(page as Record<string, unknown>) };
  }

  private static async diagnostics(
    manager: NonNullable<ReturnType<typeof getEmbeddedBrowserManager>>,
    sessionId: string,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const restored = await EmbeddedBrowserTool.ensurePageReady(manager, sessionId, signal);
    if (restored) return restored;
    const runtime = await manager.executeJs(sessionId, runtimeDiagnosticsExpression());
    const diagnostics = manager.getDiagnostics(sessionId);
    return { ok: true, ...diagnostics, url: redactEmbeddedBrowserDiagnosticUrl(diagnostics.url), ...(runtime as Record<string, unknown>) };
  }

  private static async click(
    manager: NonNullable<ReturnType<typeof getEmbeddedBrowserManager>>,
    sessionId: string,
    args: EmbeddedBrowserToolArgs,
    signal?: AbortSignal,
    button: 'left' | 'right' = 'left',
    clickCount = 1,
  ): Promise<unknown> {
    if (!EmbeddedBrowserTool.hasLocator(args)) {
      return EmbeddedBrowserTool.fail('click requires a "selector", "text", "role", or "name".');
    }
    const restored = await EmbeddedBrowserTool.ensurePageReady(manager, sessionId, signal);
    if (restored) return restored;
    const expr = resolveTargetExpression(args);
    const hit = (await manager.executeJs(sessionId, expr)) as ResolvedTarget;
    if (!hit?.found) {
      return { ok: false, matched: 0, error: 'No element matched the given selector/text.' };
    }
    const safety = EmbeddedBrowserTool.highImpactReason(hit);
    if (safety) {
      return {
        ok: false,
        requiresConfirmation: true,
        error: `High-impact browser action blocked: ${safety}. Ask the user to perform this action manually or use request_interactive_input for explicit guidance; the browser tool will not dispatch this click.`,
      };
    }
    const base = { x: hit.x, y: hit.y, button, clickCount };
    await manager.sendCdpCommand(sessionId, 'Input.dispatchMouseEvent', { type: 'mouseMoved', ...base });
    await manager.sendCdpCommand(sessionId, 'Input.dispatchMouseEvent', { type: 'mousePressed', ...base });
    await manager.sendCdpCommand(sessionId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', ...base });
    return { ok: true, matched: hit.count, tag: hit.tag, button, clickCount };
  }

  private static async setSlider(
    manager: NonNullable<ReturnType<typeof getEmbeddedBrowserManager>>,
    sessionId: string,
    args: EmbeddedBrowserToolArgs,
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (!EmbeddedBrowserTool.hasFieldLocator(args)) return EmbeddedBrowserTool.fail('set_slider requires a locator.');
    const percent = Number(args.percent);
    if (!Number.isFinite(percent)) return EmbeddedBrowserTool.fail('set_slider requires "percent".');
    const restored = await EmbeddedBrowserTool.ensurePageReady(manager, sessionId, signal);
    if (restored) return restored;
    const result = await manager.executeJs(sessionId, setSliderExpression(args, percent));
    if ((result as ResolvedTarget)?.found === false) {
      return { ok: false, error: 'No slider matched the given locator.' };
    }
    return { ok: true, ...(result as Record<string, unknown>) };
  }


  private static async type(
    manager: NonNullable<ReturnType<typeof getEmbeddedBrowserManager>>,
    sessionId: string,
    args: EmbeddedBrowserToolArgs,
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (!EmbeddedBrowserTool.hasFieldLocator(args)) {
      return EmbeddedBrowserTool.fail('type requires a locator ("selector", "text", "role", "name", "label", "placeholder", or "testId").');
    }
    if (typeof args.text !== 'string') return EmbeddedBrowserTool.fail('type requires "text".');
    const restored = await EmbeddedBrowserTool.ensurePageReady(manager, sessionId, signal);
    if (restored) return restored;

    // Focus (and select existing content so insertText replaces it → "fill"
    // semantics) directly in-page; this is more reliable than click-to-focus.
    const focusExpr = focusFieldExpression(args);
    const focus = (await manager.executeJs(sessionId, focusExpr)) as ResolvedTarget;
    if (!focus?.found) {
      return { ok: false, error: 'No input matched the given locator.' };
    }

    // insertText fires a real `input` event, so React-controlled inputs update.
    await manager.sendCdpCommand(sessionId, 'Input.insertText', { text: args.text });

    if (args.submit) {
      const safety = await EmbeddedBrowserTool.activeTargetHighImpactReason(manager, sessionId);
      if (safety) return EmbeddedBrowserTool.highImpactBlocked(safety, 'keyboard submission');
      const enter = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 };
      await manager.sendCdpCommand(sessionId, 'Input.dispatchKeyEvent', { type: 'keyDown', ...enter });
      await manager.sendCdpCommand(sessionId, 'Input.dispatchKeyEvent', { type: 'keyUp', ...enter });
    }
    return { ok: true, submitted: !!args.submit };
  }

  private static async waitFor(
    manager: NonNullable<ReturnType<typeof getEmbeddedBrowserManager>>,
    sessionId: string,
    args: EmbeddedBrowserToolArgs,
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (!EmbeddedBrowserTool.hasLocator(args)) {
      return EmbeddedBrowserTool.fail('wait_for requires a locator.');
    }

    const start = Date.now();
    if (signal?.aborted) {
      return { ok: false, found: false, waitedMs: Date.now() - start, error: 'aborted' };
    }
    const restored = await EmbeddedBrowserTool.ensurePageReady(manager, sessionId, signal);
    if (restored) return restored;
    const timeout = Math.min(
      Math.max(args.timeoutMs ?? DEFAULT_WAIT_MS, 0),
      MAX_WAIT_MS,
    );
    const expr = existsExpression(args);

    // Poll the page until the target appears, the timeout elapses, or abort.
    for (;;) {
      if (signal?.aborted) {
        return { ok: false, found: false, waitedMs: Date.now() - start, error: 'aborted' };
      }

      const present = await manager.executeJs(sessionId, expr);
      if (present === true) {
        return { ok: true, found: true, waitedMs: Date.now() - start };
      }
      if (Date.now() - start >= timeout) {
        return { ok: true, found: false, waitedMs: Date.now() - start };
      }
      await EmbeddedBrowserTool.sleep(WAIT_POLL_MS, signal);
    }
  }

  private static async waitForUrl(
    manager: NonNullable<ReturnType<typeof getEmbeddedBrowserManager>>,
    sessionId: string,
    args: EmbeddedBrowserToolArgs,
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (!args.url?.trim()) return EmbeddedBrowserTool.fail('wait_for_url requires url.');
    const start = Date.now();
    if (signal?.aborted) return { ok: false, found: false, waitedMs: Date.now() - start, error: 'aborted' };
    const restored = await EmbeddedBrowserTool.ensurePageReady(manager, sessionId, signal);
    if (restored) return restored;
    const expectedUrl = args.url.trim();
    const exact = args.exact ?? false;
    const timeout = Math.min(Math.max(args.timeoutMs ?? DEFAULT_WAIT_MS, 0), MAX_WAIT_MS);
    for (;;) {
      if (signal?.aborted) return { ok: false, found: false, waitedMs: Date.now() - start, error: 'aborted' };
      const actualUrl = EmbeddedBrowserTool.getRawNavUrl(manager, sessionId);
      const found = exact ? actualUrl === expectedUrl : actualUrl.includes(expectedUrl);
      if (found) return { ok: true, found: true, actualUrl: redactEmbeddedBrowserDiagnosticUrl(actualUrl), expectedUrl: redactEmbeddedBrowserDiagnosticUrl(expectedUrl), exact, waitedMs: Date.now() - start };
      if (Date.now() - start >= timeout) return { ok: true, found: false, actualUrl: redactEmbeddedBrowserDiagnosticUrl(actualUrl), expectedUrl: redactEmbeddedBrowserDiagnosticUrl(expectedUrl), exact, waitedMs: Date.now() - start };
      await EmbeddedBrowserTool.sleep(WAIT_POLL_MS, signal);
    }
  }

  private static async scroll(
    manager: NonNullable<ReturnType<typeof getEmbeddedBrowserManager>>,
    sessionId: string,
    args: EmbeddedBrowserToolArgs,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const restored = await EmbeddedBrowserTool.ensurePageReady(manager, sessionId, signal);
    if (restored) return restored;
    const x = Number.isFinite(args.x) ? Number(args.x) : 0;
    const y = Number.isFinite(args.y) ? Number(args.y) : 600;
    const result = await manager.executeJs(sessionId, scrollExpression(args, x, y));
    return { ok: true, ...(result as Record<string, unknown>) };
  }

  private static async pressKey(
    manager: NonNullable<ReturnType<typeof getEmbeddedBrowserManager>>,
    sessionId: string,
    args: EmbeddedBrowserToolArgs,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const key = typeof args.key === 'string' && args.key.length === 1 ? args.key : args.key?.trim();
    if (!key) return EmbeddedBrowserTool.fail('press_key requires a "key".');
    const restored = await EmbeddedBrowserTool.ensurePageReady(manager, sessionId, signal);
    if (restored) return restored;
    if (EmbeddedBrowserTool.isActivationKey(key)) {
      const safety = await EmbeddedBrowserTool.activeTargetHighImpactReason(manager, sessionId);
      if (safety) return EmbeddedBrowserTool.highImpactBlocked(safety, `keyboard ${key}`);
    }
    const params = EmbeddedBrowserTool.keyEventParams(key, args.modifiers);
    await manager.sendCdpCommand(sessionId, 'Input.dispatchKeyEvent', { type: 'keyDown', ...params });
    await manager.sendCdpCommand(sessionId, 'Input.dispatchKeyEvent', { type: 'keyUp', ...params });
    return { ok: true, key };
  }

  private static async hover(
    manager: NonNullable<ReturnType<typeof getEmbeddedBrowserManager>>,
    sessionId: string,
    args: EmbeddedBrowserToolArgs,
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (!EmbeddedBrowserTool.hasLocator(args)) {
      return EmbeddedBrowserTool.fail('hover requires a "selector", "text", "role", or "name".');
    }
    const restored = await EmbeddedBrowserTool.ensurePageReady(manager, sessionId, signal);
    if (restored) return restored;
    const hit = (await manager.executeJs(
      sessionId,
      resolveTargetExpression(args),
    )) as ResolvedTarget;
    if (!hit?.found) {
      return { ok: false, matched: 0, error: 'No element matched the given selector/text.' };
    }
    await manager.sendCdpCommand(sessionId, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: hit.x,
      y: hit.y,
    });
    return { ok: true, matched: hit.count, tag: hit.tag };
  }

  private static async clear(
    manager: NonNullable<ReturnType<typeof getEmbeddedBrowserManager>>,
    sessionId: string,
    args: EmbeddedBrowserToolArgs,
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (!EmbeddedBrowserTool.hasFieldLocator(args)) {
      return EmbeddedBrowserTool.fail('clear requires a locator.');
    }
    const restored = await EmbeddedBrowserTool.ensurePageReady(manager, sessionId, signal);
    if (restored) return restored;
    const cleared = await manager.executeJs(sessionId, clearFieldExpression(args));
    if ((cleared as ResolvedTarget)?.found === false) {
      return { ok: false, error: 'No input matched the given locator.' };
    }
    return { ok: true };
  }

  private static async selectOption(
    manager: NonNullable<ReturnType<typeof getEmbeddedBrowserManager>>,
    sessionId: string,
    args: EmbeddedBrowserToolArgs,
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (!EmbeddedBrowserTool.hasFieldLocator(args)) {
      return EmbeddedBrowserTool.fail('select_option requires a locator.');
    }
    const value = args.value ?? args.text;
    if (typeof value !== 'string') return EmbeddedBrowserTool.fail('select_option requires a "value" or "text".');
    const restored = await EmbeddedBrowserTool.ensurePageReady(manager, sessionId, signal);
    if (restored) return restored;
    const result = await manager.executeJs(sessionId, selectOptionExpression(args, value));
    if ((result as ResolvedTarget)?.found === false) {
      return { ok: false, error: 'No matching select option was found.' };
    }
    return { ok: true, ...(result as Record<string, unknown>) };
  }

  private static async uploadFile(
    manager: NonNullable<ReturnType<typeof getEmbeddedBrowserManager>>,
    sessionId: string,
    args: EmbeddedBrowserToolArgs,
    signal?: AbortSignal,
    workspaceRoot?: string,
  ): Promise<unknown> {
    if (!EmbeddedBrowserTool.hasLocator(args)) {
      return EmbeddedBrowserTool.fail('upload_file requires a file input locator.');
    }
    const files = [...(args.files ?? []), ...(args.filePath ? [args.filePath] : [])]
      .map((file) => file.trim())
      .filter(Boolean);
    if (files.length === 0) return EmbeddedBrowserTool.fail('upload_file requires "filePath" or "files".');
    const confinedFiles = EmbeddedBrowserTool.resolveWorkspaceFiles(files, 'upload_file', workspaceRoot);
    const restored = await EmbeddedBrowserTool.ensurePageReady(manager, sessionId, signal);
    if (restored) return restored;
    const evaluated = await manager.sendCdpCommand(sessionId, 'Runtime.evaluate', {
      expression: fileInputObjectExpression(args),
      objectGroup: 'embedded-browser-upload',
      returnByValue: false,
    }) as { result?: { objectId?: string; subtype?: string } };
    const objectId = evaluated?.result?.objectId;
    if (!objectId || evaluated?.result?.subtype === 'null') {
      return { ok: false, error: 'No file input matched the given locator.' };
    }
    const requested = await manager.sendCdpCommand(sessionId, 'DOM.requestNode', { objectId }) as { nodeId?: number };
    if (!requested?.nodeId) return { ok: false, error: 'Could not resolve the file input node.' };
    await manager.sendCdpCommand(sessionId, 'DOM.setFileInputFiles', {
      nodeId: requested.nodeId,
      files: confinedFiles,
    });
    await manager.sendCdpCommand(sessionId, 'Runtime.releaseObject', { objectId });
    return { ok: true, files: confinedFiles };
  }

  private static async paste(
    manager: NonNullable<ReturnType<typeof getEmbeddedBrowserManager>>,
    sessionId: string,
    args: EmbeddedBrowserToolArgs,
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (typeof args.text !== 'string') return EmbeddedBrowserTool.fail('paste requires "text".');
    const restored = await EmbeddedBrowserTool.ensurePageReady(manager, sessionId, signal);
    if (restored) return restored;
    if (EmbeddedBrowserTool.hasFieldLocator(args)) {
      const focus = await manager.executeJs(sessionId, focusFieldExpression(args)) as ResolvedTarget;
      if (!focus?.found) return { ok: false, error: 'No input matched the given locator.' };
    }
    await manager.sendCdpCommand(sessionId, 'Input.insertText', { text: args.text });
    return { ok: true };
  }

  private static async drag(
    manager: NonNullable<ReturnType<typeof getEmbeddedBrowserManager>>,
    sessionId: string,
    args: EmbeddedBrowserToolArgs,
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (!args.sourceSelector || !args.targetSelector) {
      return EmbeddedBrowserTool.fail('drag requires "sourceSelector" and "targetSelector".');
    }
    const restored = await EmbeddedBrowserTool.ensurePageReady(manager, sessionId, signal);
    if (restored) return restored;
    const source = await manager.executeJs(sessionId, resolveTargetExpression({ ...args, selector: args.sourceSelector })) as ResolvedTarget;
    const target = await manager.executeJs(sessionId, resolveTargetExpression({ ...args, selector: args.targetSelector })) as ResolvedTarget;
    if (!source?.found || !target?.found) return { ok: false, error: 'No drag source or target matched the given selectors.' };
    const safety = EmbeddedBrowserTool.highImpactReason(source) || EmbeddedBrowserTool.highImpactReason(target);
    if (safety) return EmbeddedBrowserTool.highImpactBlocked(safety, 'drag');
    const from = { x: source.x, y: source.y, button: 'left' };
    const to = { x: target.x, y: target.y, button: 'left' };
    await manager.sendCdpCommand(sessionId, 'Input.dispatchMouseEvent', { type: 'mouseMoved', ...from });
    await manager.sendCdpCommand(sessionId, 'Input.dispatchMouseEvent', { type: 'mousePressed', ...from, clickCount: 1 });
    await manager.sendCdpCommand(sessionId, 'Input.dispatchMouseEvent', { type: 'mouseMoved', ...to });
    await manager.sendCdpCommand(sessionId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', ...to, clickCount: 1 });
    return { ok: true };
  }

  private static async ensurePageReady(
    manager: NonNullable<ReturnType<typeof getEmbeddedBrowserManager>>,
    sessionId: string,
    signal?: AbortSignal,
  ): Promise<ToolError | undefined> {
    if (!manager.hasNavigablePage(sessionId)) {
      return EmbeddedBrowserTool.fail(
        'The embedded browser has no page open yet. Call the navigate action first.',
      );
    }
    await manager.ensureViewForAutomation(sessionId, undefined, signal);
    return undefined;
  }

  // In-page expression builders live in embeddedBrowserToolExpressions.ts.

  private static normalizeUrl(input: string): string {
    const text = input.trim();
    if (/^https?:\/\//i.test(text)) {
      try {
        new URL(text);
      } catch {
        throw new Error('navigate requires a valid http or https URL.');
      }
      return text;
    }
    // about:blank is a safe empty page agents can use to bootstrap a blank view.
    if (/^about:blank$/i.test(text)) return 'about:blank';
    const unbracketedIpv6Loopback = text.match(/^::1(?::(\d+))?(\/.*)?$/i);
    if (unbracketedIpv6Loopback) {
      const [, port, path = ''] = unbracketedIpv6Loopback;
      return `http://[::1]${port ? `:${port}` : ''}${path}`;
    }
    if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?(\/|$)/i.test(text)) {
      return `http://${text}`;
    }
    // Reject explicit non-web schemes (file:, data:, mailto:, tel:, chrome:, about:, ...). A
    // bare host:port with a numeric port (example.com:8080, intranet:3000) is a host shorthand.
    const schemeMatch = text.match(/^([a-z][a-z0-9+.-]*):(.*)$/i);
    if (schemeMatch && (/^(about|blob|chrome|data|file|ftp|javascript|mailto|tel|ws|wss)$/i.test(schemeMatch[1]) || !/^\d+([/?#].*)?$/.test(schemeMatch[2]))) {
      throw new Error('navigate only supports http and https URLs.');
    }
    return `https://${text}`;
  }


  private static keyEventParams(key: string, modifiers: string[] = []): Record<string, unknown> {
    const normalized = key === ' ' ? 'Space' : key.length === 1 ? key : key[0].toUpperCase() + key.slice(1);
    const codeByKey: Record<string, { code: string; keyCode: number }> = {
      Space: { code: 'Space', keyCode: 32 },
      Enter: { code: 'Enter', keyCode: 13 },
      Escape: { code: 'Escape', keyCode: 27 },
      Tab: { code: 'Tab', keyCode: 9 },
      Backspace: { code: 'Backspace', keyCode: 8 },
      Delete: { code: 'Delete', keyCode: 46 },
      ArrowUp: { code: 'ArrowUp', keyCode: 38 },
      ArrowDown: { code: 'ArrowDown', keyCode: 40 },
      ArrowLeft: { code: 'ArrowLeft', keyCode: 37 },
      ArrowRight: { code: 'ArrowRight', keyCode: 39 },
    };
    const special = codeByKey[normalized];
    if (special) {
      const eventKey = normalized === 'Space' ? ' ' : normalized;
      return {
        key: eventKey,
        code: special.code,
        windowsVirtualKeyCode: special.keyCode,
        nativeVirtualKeyCode: special.keyCode,
        modifiers: EmbeddedBrowserTool.modifierMask(modifiers),
      };
    }
    return { text: key, key, code: `Key${key.toUpperCase()}`, modifiers: EmbeddedBrowserTool.modifierMask(modifiers) };
  }

  private static hasLocator(args: EmbeddedBrowserToolArgs): boolean {
    return !!(args.selector || args.text || args.role || args.name || args.label || args.placeholder || args.testId);
  }

  private static getRawNavUrl(
    manager: NonNullable<ReturnType<typeof getEmbeddedBrowserManager>>,
    sessionId: string,
  ): string {
    const rawState = (manager as { getRawNavState?: (id: string) => { url?: string } | null }).getRawNavState?.(sessionId);
    return rawState?.url ?? manager.getNavState(sessionId)?.url ?? '';
  }

  private static redactNavState<T extends { url?: string } | null | undefined>(state: T): T {
    if (!state?.url) return state;
    return { ...state, url: redactEmbeddedBrowserDiagnosticUrl(state.url) };
  }

  private static hasFieldLocator(args: EmbeddedBrowserToolArgs): boolean {
    return !!(args.selector || args.role || args.name || args.label || args.placeholder || args.testId);
  }

  private static highImpactReason(hit: ResolvedTarget): string | null {
    const label = String(hit.text ?? '').trim(), text = `${label} ${hit.role ?? ''}`.toLowerCase();
    if (text.includes('__unlabeled_activation_target__')) return 'unlabeled activation target';
    if (!label && ['BUTTON', 'A'].includes(String(hit.tag ?? '').toUpperCase())) return 'unlabeled activation target';
    if (/[^\x00-\x7F]/.test(label)) return 'localized activation target';
    const risky = [/\bpublish\b/, /\bpost\b/, /\bdelete\b/, /\bremove\b/, /\bpay\b/, /\bpurchase\b/, /\bbuy\b/, /\bauthorize\b/, /\bgrant\s+access\b/, /\bsubmit\s+order\b/, /\bconfirm\b/, /\bsave\b/, /\bmerge\b/, /\bapprove\b/];
    return risky.find((pattern) => pattern.test(text))?.source.replace(/\\b/g, '').replace(/\\s\+/g, ' ') ?? null;
  }

  private static getTrustedWorkspaceRoot(workspaceRootInput?: string): string {
    const workspaceRoot = workspaceRootInput?.trim();
    if (!workspaceRoot) {
      throw new Error('Browser file actions require an explicit trusted workspace root.');
    }
    const root = fs.realpathSync(path.resolve(workspaceRoot));
    const parsed = path.parse(root);
    if (root === parsed.root) {
      throw new Error('Browser file actions require a trusted workspace root.');
    }
    return root;
  }

  private static highImpactBlocked(safety: string, action: string): ToolError & { requiresConfirmation: true } {
    return {
      ok: false,
      requiresConfirmation: true,
      error: `High-impact browser action blocked: ${safety}. Ask the user to perform this action manually or use request_interactive_input for explicit guidance; the browser tool will not dispatch this ${action}.`,
    };
  }

  private static isActivationKey(key: string): boolean {
    return ['enter', 'numenter', 'space', ' '].includes(key === ' ' ? key : key.trim().toLowerCase());
  }

  private static async activeTargetHighImpactReason(
    manager: NonNullable<ReturnType<typeof getEmbeddedBrowserManager>>,
    sessionId: string,
  ): Promise<string | null> {
    const target = (await manager.executeJs(sessionId, `(() => {
      const active = document.activeElement;
      if (!active) return { found: false, count: 0, x: 0, y: 0 };
      const form = active instanceof HTMLElement ? active.closest('form') : null;
      const submitters = form ? Array.from(form.querySelectorAll('button, input[type="submit"], input[type="button"], [role="button"]')) : [];
      const hasUnlabeledSubmitter = submitters.some((el) => ![el.textContent, el.getAttribute?.('aria-label'), el.getAttribute?.('title'), el.getAttribute?.('value')].some((value) => String(value || '').trim()));
      const textParts = [
        hasUnlabeledSubmitter ? '__UNLABELED_ACTIVATION_TARGET__' : '',
        active.textContent,
        active.getAttribute?.('aria-label'),
        active.getAttribute?.('title'),
        active.getAttribute?.('value'),
        form?.getAttribute?.('aria-label'),
        form?.textContent,
        ...submitters.map((el) => [el.textContent, el.getAttribute?.('aria-label'), el.getAttribute?.('title'), el.getAttribute?.('value')].filter(Boolean).join(' ')),
      ].filter(Boolean);
      return {
        found: true,
        count: 1,
        x: 0,
        y: 0,
        tag: active.tagName,
        role: active.getAttribute?.('role') ?? undefined,
        text: textParts.join(' '),
      };
    })()`)) as ResolvedTarget;
    return target?.found ? EmbeddedBrowserTool.highImpactReason(target) : null;
  }

  private static resolveWorkspaceFiles(files: string[], action: string, workspaceRootInput?: string): string[] {
    const workspaceRoot = EmbeddedBrowserTool.getTrustedWorkspaceRoot(workspaceRootInput);
    const realRoot = fs.realpathSync(workspaceRoot);
    return files.map((file) => {
      const validation = FileSecurityValidator.isPathInWorkspace(file, realRoot);
      if (!validation.isInWorkspace || !validation.normalizedPath) {
        throw new Error(`${action} can only access files inside the workspace root.`);
      }
      const realFile = fs.realpathSync(validation.normalizedPath);
      const relative = path.relative(realRoot, realFile);
      if (relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error(`${action} can only access files inside the workspace root.`);
      }
      if (!fs.statSync(realFile).isFile()) {
        throw new Error(`${action} requires file paths.`);
      }
      return realFile;
    });
  }

  private static modifierMask(modifiers: string[]): number {
    const bits: Record<string, number> = { alt: 1, ctrl: 2, control: 2, meta: 4, cmd: 4, command: 4, shift: 8 };
    return modifiers.reduce((mask, key) => mask | (bits[key.toLowerCase()] ?? 0), 0);
  }

  private static fail(error: string): ToolError {
    return { ok: false, error };
  }

  /** Abortable sleep used between wait_for polls. */
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
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }
}

/** Shape returned by the in-page target resolver. */
interface ResolvedTarget { found: boolean; count: number; x: number; y: number; tag?: string; text?: string; role?: string; }

interface CaptureRect { x: number; y: number; width: number; height: number; }
