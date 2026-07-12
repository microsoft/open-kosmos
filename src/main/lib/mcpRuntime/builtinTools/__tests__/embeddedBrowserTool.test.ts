/**
 * EmbeddedBrowserTool unit tests
 *
 * Covers every branch of the consolidated `browser` tool's execute():
 *  - dispatch guards (missing action / no session / no manager / unknown action)
 *  - navigate: missing url, every normalizeUrl branch, nav-state mapping
 *  - screenshot: vision-image shape, raw base64 (no data: prefix)
 *  - read_page: executeJs delegation + ok merge
 *  - click: arg validation, not-found envelope, 3-step CDP mouse dispatch, both
 *    selector and visible-text resolver arms
 *  - type: arg validation, focus-not-found, insertText, submit/no-submit
 *  - wait_for: arg validation, immediate hit, timeout, abort (pre + mid-sleep),
 *    timeout clamp, abortable sleep retry
 *  - defensive catch-all (Error + non-Error throws)
 *
 * The manager, execution context, and logger are fully mocked, so no Electron
 * WebContentsView or real page is required — the tool only orchestrates string
 * expressions and CDP command names.
 */

const {
  mockGetExecutionContext,
  mockGetEmbeddedBrowserManager,
  mockGetChatConfig,
  managerMock,
} = vi.hoisted(() => {
  const managerMock = {
    ensureViewForAutomation: vi.fn(),
    captureScreenshot: vi.fn(),
    hasNavigablePage: vi.fn(),
    executeJs: vi.fn(),
    sendCdpCommand: vi.fn(),
    getNavState: vi.fn(),
    getRawNavState: vi.fn(),
    goBack: vi.fn(),
    goForward: vi.fn(),
    reload: vi.fn(),
    stop: vi.fn(),
    setAutomationViewport: vi.fn(),
    getAutomationViewport: vi.fn(),
    getDiagnostics: vi.fn(),
    enableNetworkDiagnostics: vi.fn(),
  };
  return {
    mockGetExecutionContext: vi.fn(),
    mockGetEmbeddedBrowserManager: vi.fn(() => managerMock),
    mockGetChatConfig: vi.fn(),
    managerMock,
  };
});

vi.mock('../builtinToolsManager', async () => ({
  BuiltinToolsManager: {
    getExecutionContext: mockGetExecutionContext,
  },
}));

vi.mock('../../../embeddedBrowser/EmbeddedBrowserManager', async () => ({
  getEmbeddedBrowserManager: mockGetEmbeddedBrowserManager,
  redactEmbeddedBrowserDiagnosticUrl: (value: string | undefined) => {
    if (!value) return '';
    try {
      const url = new URL(value);
      if (url.username) url.username = '[redacted]';
      if (url.password) url.password = '[redacted]';
      if (url.hash) url.hash = '#[redacted]';
      for (const key of Array.from(url.searchParams.keys())) {
        if (/(^|[-_])(access_token|auth|authorization|code|cookie|csrf|xsrf|key|pass|password|pwd|secret|session|sig|signature|token)($|[-_])/i.test(key)) {
          url.searchParams.set(key, '[redacted]');
        }
      }
      return url.toString();
    } catch {
      return value;
    }
  },
  registerEmbeddedBrowserRuntimeCleanup: vi.fn(),
}));

vi.mock('../../../userDataADO/profileCacheManager', async () => ({
  profileCacheManager: {
    getChatConfig: mockGetChatConfig,
  },
}));

vi.mock('../../../unifiedLogger', async () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { EmbeddedBrowserTool } from '../embeddedBrowserTool';
import { WorkspacePreviewServer } from '../embeddedBrowserPreviewServer';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import sharp from 'sharp';

function fetchPreview(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    }).on('error', reject);
  });
}

const NAV_STATE = {
  url: 'https://example.com/',
  title: 'Example',
  isLoading: false,
  canGoBack: false,
  canGoForward: false,
};

function executeBrowserTool(args: any, options: { signal?: AbortSignal; chatSessionId?: string; workspaceRoot?: string } = {}) {
  return EmbeddedBrowserTool.execute(args, { chatSessionId: 'session_1', workspaceRoot: process.cwd(), ...options });
}

describe('EmbeddedBrowserTool.execute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    EmbeddedBrowserTool.clearVisualBaselines();
    mockGetExecutionContext.mockReturnValue({ chatSessionId: 'session_1', chatId: 'chat-1', userAlias: 'user' });
    mockGetChatConfig.mockReturnValue({ agent: { workspace: process.cwd() } });
    mockGetEmbeddedBrowserManager.mockReturnValue(managerMock);
    managerMock.ensureViewForAutomation.mockResolvedValue({ ...NAV_STATE });
    managerMock.captureScreenshot.mockResolvedValue({ data: 'BASE64DATA', mimeType: 'image/png' });
    managerMock.hasNavigablePage.mockReturnValue(true);
    managerMock.executeJs.mockResolvedValue({});
    managerMock.sendCdpCommand.mockResolvedValue(undefined);
    managerMock.getNavState.mockReturnValue({ ...NAV_STATE });
    managerMock.getRawNavState.mockReturnValue({ ...NAV_STATE });
    managerMock.setAutomationViewport.mockReturnValue({ x: 0, y: 0, width: 390, height: 844 });
    managerMock.getAutomationViewport.mockReturnValue({ x: 0, y: 0, width: 800, height: 600 });
    managerMock.getDiagnostics.mockReturnValue({
      readyState: null,
      url: 'https://example.com/',
      title: 'Example',
      isLoading: false,
      recentEvents: [{ type: 'console', message: 'boom', timestamp: 1 }],
      networkEvents: [],
      downloads: [],
    });
  });

  // ── dispatch guards ─────────────────────────────────────────────────────

  describe('dispatch guards', () => {
    it('fails when action is missing (args without action)', async () => {
      const res = await executeBrowserTool({} as any);
      expect(res).toEqual({ ok: false, error: 'Missing required "action".' });
    });

    describe('navigation state error branches', () => {
      it('returns ensurePageReady failure for get_state when nav exists but page is not navigable', async () => {
        managerMock.getNavState.mockReturnValue({ ...NAV_STATE });
        managerMock.hasNavigablePage.mockReturnValue(false);
        const res = await executeBrowserTool({ action: 'get_state' });
        expect(res).toEqual({
          ok: false,
          error: 'The embedded browser has no page open yet. Call the navigate action first.',
        });
      });

      it.each(['back', 'forward', 'reload', 'stop'] as const)('returns ensurePageReady failure for %s', async (action) => {
        managerMock.hasNavigablePage.mockReturnValue(false);
        const res = await executeBrowserTool({ action });
        expect(res).toEqual({
          ok: false,
          error: 'The embedded browser has no page open yet. Call the navigate action first.',
        });
      });

      it('fails open_local_file when no local path is provided', async () => {
        const res = await executeBrowserTool({ action: 'open_local_file' });
        expect(res).toEqual({ ok: false, error: 'open_local_file requires "localPath".' });
      });

      it('fails screenshot when selector is requested but no element matches', async () => {
        managerMock.executeJs.mockResolvedValue(null);
        const res = await executeBrowserTool({ action: 'screenshot', selector: '#missing' });
        expect(res).toEqual({ ok: false, error: 'No element matched the screenshot locator.' });
      });

      it('fails visual baseline capture when baselineName is missing', async () => {
        const res = await executeBrowserTool({ action: 'capture_visual_baseline' });
        expect(res).toEqual({ ok: false, error: 'capture_visual_baseline requires baselineName.' });
      });

      it('fails visual baseline compare when baselineName is missing', async () => {
        const res = await executeBrowserTool({ action: 'compare_visual_baseline' });
        expect(res).toEqual({ ok: false, error: 'compare_visual_baseline requires baselineName.' });
      });

      it('fails visual baseline compare when baseline has not been captured', async () => {
        const res = await executeBrowserTool({ action: 'compare_visual_baseline', baselineName: 'missing' });
        expect(res).toEqual({ ok: false, error: 'No visual baseline named "missing" exists for this chat session.' });
      });

      it.each([
        ['wait_for_url', {}, 'wait_for_url requires url.'],
        ['press_key', {}, 'press_key requires a "key".'],
        ['hover', {}, 'hover requires a "selector", "text", "role", or "name".'],
        ['clear', {}, 'clear requires a locator.'],
        ['select_option', {}, 'select_option requires a locator.'],
        ['upload_file', {}, 'upload_file requires a file input locator.'],
        ['paste', {}, 'paste requires "text".'],
        ['drag', {}, 'drag requires "sourceSelector" and "targetSelector".'],
      ] as const)('fails %s validation', async (action, args, error) => {
        const res = await executeBrowserTool({ action, ...args });
        expect(res).toEqual({ ok: false, error });
      });

      it('fails select_option when locator exists but value/text is missing', async () => {
        const res = await executeBrowserTool({ action: 'select_option', selector: '#sel' });
        expect(res).toEqual({ ok: false, error: 'select_option requires a "value" or "text".' });
      });

      it('fails upload_file when no files are provided for a valid locator', async () => {
        const res = await executeBrowserTool({ action: 'upload_file', selector: 'input[type=file]' });
        expect(res).toEqual({ ok: false, error: 'upload_file requires "filePath" or "files".' });
      });

      it('covers get_state when a page exists but nav state is absent', async () => {
        managerMock.getNavState.mockReturnValueOnce(null).mockReturnValueOnce({ ...NAV_STATE, url: 'https://restored.test/' });
        managerMock.hasNavigablePage.mockReturnValue(true);
        const res = await executeBrowserTool({ action: 'get_state' });
        expect(res).toEqual(expect.objectContaining({ ok: true, hasPage: true, url: 'https://restored.test/' }));
      });

      it('redacts sensitive URLs in navigation-facing tool results', async () => {
        const rawUrl = 'https://user:pass@example.com/callback?code=secret&safe=1#frag';
        const redactedUrl = 'https://%5Bredacted%5D:%5Bredacted%5D@example.com/callback?code=%5Bredacted%5D&safe=1#[redacted]';
        managerMock.getNavState.mockReturnValue({ ...NAV_STATE, url: rawUrl });
        managerMock.getRawNavState.mockReturnValue({ ...NAV_STATE, url: rawUrl });
        managerMock.ensureViewForAutomation.mockResolvedValue({ ...NAV_STATE, url: rawUrl });

        await expect(executeBrowserTool({ action: 'get_state' }))
          .resolves.toMatchObject({ ok: true, url: redactedUrl });
        await expect(executeBrowserTool({ action: 'navigate', url: rawUrl }))
          .resolves.toMatchObject({ ok: true, url: redactedUrl });
        await expect(executeBrowserTool({ action: 'wait_for_url', url: rawUrl, exact: true }))
          .resolves.toMatchObject({ ok: true, found: true, actualUrl: redactedUrl, expectedUrl: redactedUrl });
      });

      it('covers wait_for_url exact match success and timeout branches', async () => {
        managerMock.getNavState.mockReturnValueOnce({ ...NAV_STATE, url: 'https://example.com/target' });
        managerMock.getRawNavState.mockReturnValueOnce({ ...NAV_STATE, url: 'https://example.com/target' });
        await expect(executeBrowserTool({ action: 'wait_for_url', url: 'https://example.com/target', exact: true }))
          .resolves.toMatchObject({ ok: true, found: true, exact: true });

        managerMock.getNavState.mockReturnValue({ ...NAV_STATE, url: 'https://example.com/other' });
        managerMock.getRawNavState.mockReturnValue({ ...NAV_STATE, url: 'https://example.com/other' });
        await expect(executeBrowserTool({ action: 'wait_for_url', url: 'missing', timeoutMs: 0 }))
          .resolves.toMatchObject({ ok: true, found: false, actualUrl: 'https://example.com/other' });
      });

      it('covers wait_for_url abort branches', async () => {
        const controller = new AbortController();
        controller.abort();
        await expect(executeBrowserTool({ action: 'wait_for_url', url: 'example' }, { signal: controller.signal }))
          .resolves.toMatchObject({ ok: false, found: false, error: 'aborted' });
      });

      it('covers set_slider success and not-found branches', async () => {
        managerMock.executeJs.mockResolvedValueOnce({ found: true, value: 50 });
        await expect(executeBrowserTool({ action: 'set_slider', selector: '#slider', percent: 50 }))
          .resolves.toMatchObject({ ok: true, found: true, value: 50 });

        managerMock.executeJs.mockResolvedValueOnce({ found: false });
        await expect(executeBrowserTool({ action: 'set_slider', selector: '#slider', percent: 10 }))
          .resolves.toEqual({ ok: false, error: 'No slider matched the given locator.' });
      });

      it('covers hover, clear, select_option, paste, drag not-found branches', async () => {
        managerMock.executeJs.mockResolvedValueOnce({ found: false, count: 0 });
        await expect(executeBrowserTool({ action: 'hover', selector: '#missing' }))
          .resolves.toEqual({ ok: false, matched: 0, error: 'No element matched the given selector/text.' });

        managerMock.executeJs.mockResolvedValueOnce({ found: false });
        await expect(executeBrowserTool({ action: 'clear', selector: '#missing' }))
          .resolves.toEqual({ ok: false, error: 'No input matched the given locator.' });

        managerMock.executeJs.mockResolvedValueOnce({ found: false });
        await expect(executeBrowserTool({ action: 'select_option', selector: '#missing', value: 'x' }))
          .resolves.toEqual({ ok: false, error: 'No matching select option was found.' });

        managerMock.executeJs.mockResolvedValueOnce({ found: false });
        await expect(executeBrowserTool({ action: 'paste', selector: '#missing', text: 'x' }))
          .resolves.toEqual({ ok: false, error: 'No input matched the given locator.' });

        managerMock.executeJs.mockResolvedValueOnce(null).mockResolvedValueOnce({ found: true, x: 1, y: 1 });
        await expect(executeBrowserTool({ action: 'drag', sourceSelector: '#a', targetSelector: '#b' }))
          .resolves.toEqual({ ok: false, error: 'No drag source or target matched the given selectors.' });
      });
    });

    it('fails when args is undefined (optional-chain arm)', async () => {
      const res = await executeBrowserTool(undefined as any);
      expect(res).toEqual({ ok: false, error: 'Missing required "action".' });
    });

    it('fails when there is no chat session context (undefined context)', async () => {
      mockGetExecutionContext.mockReturnValue(undefined);
      const res = await executeBrowserTool({ action: 'read_page' }, { chatSessionId: undefined });
      expect(res).toEqual({ ok: false, error: 'No chat session context; cannot target a browser view.' });
    });

    it('fails when the execution context has no chatSessionId', async () => {
      mockGetExecutionContext.mockReturnValue({});
      const res = await executeBrowserTool({ action: 'read_page' }, { chatSessionId: undefined });
      expect(res).toEqual({ ok: false, error: 'No chat session context; cannot target a browser view.' });
    });

    it('uses the captured chatSessionId option instead of the mutable global execution context', async () => {
      mockGetExecutionContext.mockReturnValue({ chatSessionId: 'wrong-session' });
      await executeBrowserTool(
        { action: 'navigate', url: 'https://example.com' },
        { chatSessionId: 'captured-session' },
      );
      expect(managerMock.ensureViewForAutomation).toHaveBeenCalledWith(
        'captured-session',
        'https://example.com',
        undefined,
      );
      expect(mockGetExecutionContext).not.toHaveBeenCalled();
    });

    it('fails when the embedded browser manager is unavailable', async () => {
      mockGetEmbeddedBrowserManager.mockReturnValue(null as any);
      const res = await executeBrowserTool({ action: 'read_page' });
      expect(res).toEqual({ ok: false, error: 'Embedded browser is not available in this build.' });
    });

    it('fails on an unknown action', async () => {
      const res = await executeBrowserTool({ action: 'bogus' } as any);
      expect(res).toEqual({ ok: false, error: 'Unknown action "bogus".' });
    });
  });

  // ── navigate ────────────────────────────────────────────────────────────

  describe('navigate', () => {
    it('requires a url', async () => {
      const res = await executeBrowserTool({ action: 'navigate' });
      expect(res).toEqual({ ok: false, error: 'navigate requires a "url".' });
      expect(managerMock.ensureViewForAutomation).not.toHaveBeenCalled();
    });

    it('treats a whitespace-only url as missing', async () => {
      const res = await executeBrowserTool({ action: 'navigate', url: '   ' });
      expect(res).toEqual({ ok: false, error: 'navigate requires a "url".' });
    });

    it('navigates and maps the nav state into the result', async () => {
      const res = await executeBrowserTool({ action: 'navigate', url: 'https://example.com/' });
      expect(managerMock.ensureViewForAutomation).toHaveBeenCalledWith('session_1', 'https://example.com/', undefined);
      expect(res).toEqual({
        ok: true,
        url: 'https://example.com/',
        title: 'Example',
        isLoading: false,
        canGoBack: false,
        canGoForward: false,
      });
    });
  });

  // ── normalizeUrl (observed through navigate) ─────────────────────────────

  describe('normalizeUrl (via navigate)', () => {
    const cases: Array<[string, string]> = [
      // already-schemed → unchanged
      ['https://example.com/path', 'https://example.com/path'],
      ['http://foo.bar', 'http://foo.bar'],
      // loopback → http
      ['localhost:3000', 'http://localhost:3000'],
      ['localhost', 'http://localhost'],
      ['127.0.0.1:8080', 'http://127.0.0.1:8080'],
      ['0.0.0.0', 'http://0.0.0.0'],
      ['::1', 'http://[::1]'],
      ['::1:9229', 'http://[::1]:9229'],
      ['::1/debug', 'http://[::1]/debug'],
      ['[::1]:9229', 'http://[::1]:9229'],
      // anything else → https
      ['example.com', 'https://example.com'],
      ['example.com:8443', 'https://example.com:8443'],
      ['example.com:8080/path', 'https://example.com:8080/path'],
      ['my-app.local:5173', 'https://my-app.local:5173'],
      ['host.docker.internal:3000', 'https://host.docker.internal:3000'],
      ['sub.domain.co/path', 'https://sub.domain.co/path'],
      // single-label intranet/dev host:port shorthand → https (not a scheme)
      ['intranet:8080', 'https://intranet:8080'],
      ['grafana:3000', 'https://grafana:3000'],
      // about:blank → safe blank bootstrap page (case-insensitive)
      ['about:blank', 'about:blank'],
      ['About:Blank', 'about:blank'],
    ];

    it.each(cases)('normalizes %s → %s', async (input, expected) => {
      await executeBrowserTool({ action: 'navigate', url: input });
      expect(managerMock.ensureViewForAutomation).toHaveBeenCalledWith('session_1', expected, undefined);
    });

    it.each([
      'file:///Users/me/.ssh/id_rsa',
      'javascript://alert(1)',
      'data://text/plain,secret',
      'ftp://example.com/file',
      'mailto:user@example.com',
      'tel:+15551234',
      'chrome:flags',
      'tel:123',
      'mailto:123',
      'chrome:80',
      'example.com:abc',
    ])(
      'rejects non-web scheme %s',
      async (url) => {
        const res = await executeBrowserTool({ action: 'navigate', url });
        expect(res).toEqual({ ok: false, error: 'navigate only supports http and https URLs.' });
        expect(managerMock.ensureViewForAutomation).not.toHaveBeenCalled();
      },
    );

    it('passes the abort signal into navigation restore/load', async () => {
      const controller = new AbortController();
      await executeBrowserTool(
        { action: 'navigate', url: 'https://example.com/' },
        { signal: controller.signal },
      );
      expect(managerMock.ensureViewForAutomation).toHaveBeenCalledWith(
        'session_1',
        'https://example.com/',
        controller.signal,
      );
    });
  });

  // ── screenshot ──────────────────────────────────────────────────────────

  describe('screenshot', () => {
    it('ensures a view (no url) then returns the vision-image shape', async () => {
      const res = await executeBrowserTool({ action: 'screenshot' });
      expect(managerMock.ensureViewForAutomation).toHaveBeenCalledWith('session_1', undefined, undefined);
      expect(managerMock.captureScreenshot).toHaveBeenCalledWith('session_1', undefined);
      expect(res).toEqual({ type: 'image', data: 'BASE64DATA', mimeType: 'image/png' });
    });

    it('returns raw base64 with no data: prefix (vision dedup relies on this)', async () => {
      const res = (await executeBrowserTool({ action: 'screenshot' })) as { data: string };
      expect(res.data).not.toMatch(/^data:/);
    });

    it('fails cleanly without creating a view or opening the panel when there is no page', async () => {
      managerMock.hasNavigablePage.mockReturnValue(false);
      const res = await executeBrowserTool({ action: 'screenshot' });
      expect(res).toEqual({
        ok: false,
        error: 'The embedded browser has no page open yet. Call the navigate action first.',
      });
      // The empty path must not fabricate a view or auto-open the panel.
      expect(managerMock.ensureViewForAutomation).not.toHaveBeenCalled();
      expect(managerMock.captureScreenshot).not.toHaveBeenCalled();
    });

    it('applies a viewport preset before capture', async () => {
      await executeBrowserTool({ action: 'screenshot', viewport: 'mobile' });
      expect(managerMock.setAutomationViewport).toHaveBeenCalledWith('session_1', 390, 844);
      expect(managerMock.captureScreenshot).toHaveBeenCalledWith('session_1', undefined);
    });

    it('clamps explicit screenshot viewport dimensions', async () => {
      await executeBrowserTool({ action: 'screenshot', width: 99999, height: 1 });
      expect(managerMock.setAutomationViewport).toHaveBeenCalledWith('session_1', 3840, 240);
    });

    it('supports full-page screenshots by sizing to document scroll dimensions', async () => {
      managerMock.executeJs.mockResolvedValue({ width: 2000, height: 6000 });
      await executeBrowserTool({ action: 'screenshot', fullPage: true });
      expect(managerMock.executeJs).toHaveBeenCalledWith('session_1', expect.stringContaining('scrollHeight'));
      expect(managerMock.setAutomationViewport).toHaveBeenCalledWith('session_1', 2000, 6000);
      expect(managerMock.setAutomationViewport).toHaveBeenCalledWith('session_1', 800, 600);
    });

    it('captures a selector crop when screenshot selector is provided', async () => {
      managerMock.executeJs.mockResolvedValue({ x: 10, y: 20, width: 30, height: 40 });
      await executeBrowserTool({ action: 'screenshot', selector: '#chart' });
      expect(managerMock.captureScreenshot).toHaveBeenCalledWith('session_1', {
        x: 10,
        y: 20,
        width: 30,
        height: 40,
      });
    });

    it('captures and compares visual baselines in the current chat session', async () => {
      const before = await sharp({ create: { width: 1, height: 1, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } } }).png().toBuffer();
      const after = await sharp({ create: { width: 1, height: 1, channels: 4, background: { r: 0, g: 0, b: 255, alpha: 1 } } }).png().toBuffer();
      managerMock.captureScreenshot.mockResolvedValueOnce({ data: before.toString('base64'), mimeType: 'image/png' });
      const baseline = await executeBrowserTool({ action: 'capture_visual_baseline', baselineName: 'home' });
      expect(baseline).toEqual({
        ok: true,
        baselineName: 'home',
        hash: expect.stringMatching(/^[a-f0-9]{64}$/),
        bytes: before.length,
        mimeType: 'image/png',
        capturedAt: expect.any(Number),
      });

      managerMock.captureScreenshot.mockResolvedValueOnce({ data: after.toString('base64'), mimeType: 'image/png' });
      const comparison = await executeBrowserTool({ action: 'compare_visual_baseline', baselineName: 'home' });
      expect(comparison).toEqual({
        ok: false,
        matched: false,
        baselineName: 'home',
        baselineHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        currentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        baselineBytes: before.length,
        currentBytes: after.length,
        byteDelta: after.length - before.length,
        pixelDiff: {
          comparable: true,
          width: 1,
          height: 1,
          changedPixels: 1,
          totalPixels: 1,
          changedRatio: 1,
          threshold: 0,
          changedBounds: { x: 0, y: 0, width: 1, height: 1 },
        },
        baselineCapturedAt: expect.any(Number),
        mimeType: 'image/png',
      });
    });

    it('rejects oversized visual baselines instead of reporting success after eviction', async () => {
      const oversizedPng = Buffer.alloc((25 * 1024 * 1024) + 1).toString('base64');
      managerMock.captureScreenshot.mockResolvedValueOnce({ data: oversizedPng, mimeType: 'image/png' });
      const result = await executeBrowserTool({ action: 'capture_visual_baseline', baselineName: 'huge' });

      expect(result).toEqual({ ok: false, error: expect.stringContaining('Visual baseline is too large to store') });
      await expect(executeBrowserTool({ action: 'compare_visual_baseline', baselineName: 'huge' })).resolves.toEqual({
        ok: false,
        error: 'No visual baseline named "huge" exists for this chat session.',
      });
    });

    it('returns visual diff images and handles missing baseline validation', async () => {
      await expect(executeBrowserTool({ action: 'capture_visual_baseline' })).resolves.toEqual({
        ok: false,
        error: 'capture_visual_baseline requires baselineName.',
      });
      await expect(executeBrowserTool({ action: 'compare_visual_baseline' })).resolves.toEqual({
        ok: false,
        error: 'compare_visual_baseline requires baselineName.',
      });
      await expect(executeBrowserTool({ action: 'compare_visual_baseline', baselineName: 'missing' })).resolves.toEqual({
        ok: false,
        error: 'No visual baseline named "missing" exists for this chat session.',
      });

      const before = await sharp({ create: { width: 1, height: 1, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } }).png().toBuffer();
      const after = await sharp({ create: { width: 1, height: 1, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } }).png().toBuffer();
      managerMock.captureScreenshot.mockResolvedValueOnce({ data: before.toString('base64'), mimeType: 'image/png' });
      await executeBrowserTool({ action: 'capture_visual_baseline', baselineName: 'diff-image' });
      managerMock.captureScreenshot.mockResolvedValueOnce({ data: after.toString('base64'), mimeType: 'image/png' });
      const comparison = await executeBrowserTool({ action: 'compare_visual_baseline', baselineName: 'diff-image', includeDiffImage: true });
      expect(comparison).toEqual(expect.objectContaining({
        ok: false,
        pixelDiff: expect.objectContaining({
          changedBounds: { x: 0, y: 0, width: 1, height: 1 },
          diffImage: expect.objectContaining({ available: true, mimeType: 'image/png', bytes: expect.any(Number) }),
        }),
      }));
    });

    it('bounds visual baseline storage and clears session baselines on browser teardown', async () => {
      const png = (await sharp({ create: { width: 1, height: 1, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } }).png().toBuffer()).toString('base64');
      managerMock.captureScreenshot.mockResolvedValue({ data: png, mimeType: 'image/png' });
      for (let i = 0; i < 33; i += 1) {
        await executeBrowserTool({ action: 'capture_visual_baseline', baselineName: `baseline-${i}` });
      }

      await expect(executeBrowserTool({ action: 'compare_visual_baseline', baselineName: 'baseline-0' })).resolves.toEqual({
        ok: false,
        error: 'No visual baseline named "baseline-0" exists for this chat session.',
      });
      await expect(executeBrowserTool({ action: 'compare_visual_baseline', baselineName: 'baseline-32' })).resolves.toEqual(expect.objectContaining({ baselineName: 'baseline-32' }));

      EmbeddedBrowserTool.clearVisualBaselines('session_1');
      await expect(executeBrowserTool({ action: 'compare_visual_baseline', baselineName: 'baseline-32' })).resolves.toEqual({
        ok: false,
        error: 'No visual baseline named "baseline-32" exists for this chat session.',
      });
    });

    describe('local preview and advanced interactions', () => {
      it('opens a workspace-confined local file through localhost preview', async () => {
        const workspaceRoot = process.cwd();
        const localPath = path.join(workspaceRoot, 'package.json');
        const res = await executeBrowserTool({ action: 'open_local_file', localPath, workspaceRoot: '/' });
        expect(managerMock.ensureViewForAutomation).toHaveBeenCalledWith(
          'session_1',
          expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/preview\//),
          undefined,
        );
        expect(res).toEqual(expect.objectContaining({ ok: true, localPath, workspaceRoot }));
      });

      it('invalidates local preview tokens for a cleaned-up session', async () => {
        const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'openkosmos-browser-preview-'));
        const localPath = path.join(workspaceRoot, 'report.txt');
        fs.writeFileSync(localPath, 'preview-body');
        try {
          const preview = await WorkspacePreviewServer.shared().register('session_1', workspaceRoot, localPath);
          await expect(fetchPreview(preview.url)).resolves.toEqual({ status: 200, body: 'preview-body' });
          WorkspacePreviewServer.shared().clear('session_1');
          await expect(fetchPreview(preview.url)).resolves.toEqual({ status: 404, body: 'Unknown preview token' });
        } finally {
          WorkspacePreviewServer.shared().clear('session_1');
          fs.rmSync(workspaceRoot, { recursive: true, force: true });
        }
      });

      it('keeps preview tokens for other sessions when clearing one session', async () => {
        const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'openkosmos-browser-preview-other-'));
        const localPath = path.join(workspaceRoot, 'report.txt');
        fs.writeFileSync(localPath, 'preview-body');
        try {
          const preview = await WorkspacePreviewServer.shared().register('session_2', workspaceRoot, localPath);
          WorkspacePreviewServer.shared().clear('session_1');
          await expect(fetchPreview(preview.url)).resolves.toEqual({ status: 200, body: 'preview-body' });
        } finally {
          WorkspacePreviewServer.shared().clear();
          fs.rmSync(workspaceRoot, { recursive: true, force: true });
        }
      });

      it('returns not found for malformed preview paths', async () => {
        const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'openkosmos-browser-preview-malformed-'));
        const localPath = path.join(workspaceRoot, 'report.txt');
        fs.writeFileSync(localPath, 'preview-body');
        try {
          const preview = await WorkspacePreviewServer.shared().register('session_1', workspaceRoot, localPath);
          const malformedUrl = preview.url.replace(/[^/]+$/, '%E0%A4%A');
          const res = await fetchPreview(malformedUrl);
          expect(res.status).toBe(404);
          expect(res.body).toBe('Not found');
          expect(res.body).not.toContain(workspaceRoot);
        } finally {
          WorkspacePreviewServer.shared().clear();
          fs.rmSync(workspaceRoot, { recursive: true, force: true });
        }
      });

      it('handles local preview read stream errors without an unhandled stream error', async () => {
        const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'openkosmos-browser-preview-error-'));
        const localPath = path.join(workspaceRoot, 'report.txt');
        fs.writeFileSync(localPath, 'preview-body');
        const preview = await WorkspacePreviewServer.shared().register('session_1', workspaceRoot, localPath);
        const unhandled = vi.fn();
        process.once('uncaughtException', unhandled);
        try {
          fs.chmodSync(localPath, 0o000);
          await fetchPreview(preview.url).catch(() => ({ status: 0, body: '' }));
          expect(unhandled).not.toHaveBeenCalled();
        } finally {
          process.off('uncaughtException', unhandled);
          fs.chmodSync(localPath, 0o600);
          WorkspacePreviewServer.shared().clear('session_1');
          fs.rmSync(workspaceRoot, { recursive: true, force: true });
        }
      });

      it('caps preview tokens and supports clearing all tokens', async () => {
        const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'openkosmos-browser-preview-cap-'));
        const localPath = path.join(workspaceRoot, 'report.txt');
        fs.writeFileSync(localPath, 'preview-body');
        try {
          const previews = [];
          for (let i = 0; i < 101; i += 1) {
            previews.push(await WorkspacePreviewServer.shared().register('session_1', workspaceRoot, localPath));
          }
          await expect(fetchPreview(previews[0].url)).resolves.toEqual({ status: 404, body: 'Unknown preview token' });
          await expect(fetchPreview(previews[100].url)).resolves.toEqual({ status: 200, body: 'preview-body' });
          WorkspacePreviewServer.shared().clear();
          expect((WorkspacePreviewServer.shared() as any).server).toBeNull();
          expect((WorkspacePreviewServer.shared() as any).port).toBeNull();
        } finally {
          WorkspacePreviewServer.shared().clear();
          fs.rmSync(workspaceRoot, { recursive: true, force: true });
        }
      });

      it('closes the local preview listener when clearing all preview state', async () => {
        const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'openkosmos-browser-preview-close-'));
        const localPath = path.join(workspaceRoot, 'report.txt');
        fs.writeFileSync(localPath, 'preview-body');
        try {
          const preview = await WorkspacePreviewServer.shared().register('session_1', workspaceRoot, localPath);
          await expect(fetchPreview(preview.url)).resolves.toEqual({ status: 200, body: 'preview-body' });
          WorkspacePreviewServer.shared().clear();
          expect((WorkspacePreviewServer.shared() as any).server).toBeNull();
          expect((WorkspacePreviewServer.shared() as any).port).toBeNull();
        } finally {
          WorkspacePreviewServer.shared().clear();
          fs.rmSync(workspaceRoot, { recursive: true, force: true });
        }
      });

      it('fails local file actions without an explicit trusted workspace root', async () => {
        mockGetExecutionContext.mockReturnValue({ chatSessionId: 'session_1' });
        const localPath = path.join(process.cwd(), 'package.json');
        await expect(executeBrowserTool({ action: 'open_local_file', localPath }, { workspaceRoot: '' })).resolves.toEqual({
          ok: false,
          error: 'Browser file actions require an explicit trusted workspace root.',
        });
        await expect(executeBrowserTool({ action: 'upload_file', selector: 'input[type=file]', filePath: localPath }, { workspaceRoot: '' })).resolves.toEqual({
          ok: false,
          error: 'Browser file actions require an explicit trusted workspace root.',
        });
      });

      it('rejects filesystem root as the trusted workspace root', async () => {
        const localPath = path.join(process.cwd(), 'package.json');
        await expect(executeBrowserTool({ action: 'open_local_file', localPath }, { workspaceRoot: path.parse(process.cwd()).root })).resolves.toEqual({
          ok: false,
          error: 'Browser file actions require a trusted workspace root.',
        });
      });

      it('rejects local preview files outside the workspace root', async () => {
        const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openkosmos-browser-outside-'));
        const outsideFile = path.join(outsideDir, 'outside.txt');
        fs.writeFileSync(outsideFile, 'outside');
        const res = await executeBrowserTool({
          action: 'open_local_file',
          localPath: outsideFile,
          workspaceRoot: process.cwd(),
        });
        try {
          expect(res).toEqual({
            ok: false,
            error: expect.stringContaining('inside the workspace root'),
          });
        } finally {
          fs.rmSync(outsideDir, { recursive: true, force: true });
        }
      });

      it('uploads files through CDP DOM.setFileInputFiles', async () => {
        const filePath = path.join(process.cwd(), 'package.json');
        const realFilePath = fs.realpathSync(filePath);
        managerMock.sendCdpCommand
          .mockResolvedValueOnce({ result: { objectId: 'object-1' } })
          .mockResolvedValueOnce({ nodeId: 42 })
          .mockResolvedValueOnce(undefined)
          .mockResolvedValueOnce(undefined);
        const res = await executeBrowserTool({ action: 'upload_file', selector: 'input[type=file]', filePath });
        expect(managerMock.sendCdpCommand).toHaveBeenNthCalledWith(
          1,
          'session_1',
          'Runtime.evaluate',
          expect.objectContaining({ expression: expect.stringContaining('resolveLocator') }),
        );
        expect(managerMock.sendCdpCommand).toHaveBeenNthCalledWith(3, 'session_1', 'DOM.setFileInputFiles', {
          nodeId: 42,
          files: [realFilePath],
        });
        expect(res).toEqual({ ok: true, files: [realFilePath] });
      });

      it('rejects upload files outside the trusted workspace root', async () => {
        const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openkosmos-browser-upload-'));
        const outsideFile = path.join(outsideDir, 'outside.txt');
        fs.writeFileSync(outsideFile, 'outside');
        const res = await executeBrowserTool({
          action: 'upload_file',
          selector: 'input[type=file]',
          filePath: outsideFile,
        });
        try {
          expect(res).toEqual({
            ok: false,
            error: expect.stringContaining('inside the workspace root'),
          });
          expect(managerMock.sendCdpCommand).not.toHaveBeenCalled();
        } finally {
          fs.rmSync(outsideDir, { recursive: true, force: true });
        }
      });

      it('pastes text into the current focus or a resolved field', async () => {
        managerMock.executeJs.mockResolvedValue({ found: true });
        const res = await executeBrowserTool({ action: 'paste', selector: 'textarea', text: 'hello' });
        expect(managerMock.sendCdpCommand).toHaveBeenCalledWith('session_1', 'Input.insertText', { text: 'hello' });
        expect(res).toEqual({ ok: true });
      });

      it('drags from a source selector to a target selector', async () => {
        managerMock.executeJs
          .mockResolvedValueOnce({ found: true, count: 1, x: 10, y: 10, tag: 'DIV', text: 'Card' })
          .mockResolvedValueOnce({ found: true, count: 1, x: 110, y: 110, tag: 'DIV', text: 'Backlog' });
        const res = await executeBrowserTool({ action: 'drag', sourceSelector: '#source', targetSelector: '#target' });
        expect(managerMock.sendCdpCommand).toHaveBeenCalledTimes(4);
        expect(managerMock.sendCdpCommand).toHaveBeenNthCalledWith(
          4,
          'session_1',
          'Input.dispatchMouseEvent',
          expect.objectContaining({ type: 'mouseReleased', x: 110, y: 110 }),
        );
        expect(res).toEqual({ ok: true });
      });

      it('blocks drag when the source or target is high-impact', async () => {
        managerMock.executeJs
          .mockResolvedValueOnce({ found: true, count: 1, x: 10, y: 10, tag: 'DIV', text: 'Card' })
          .mockResolvedValueOnce({ found: true, count: 1, x: 110, y: 110, tag: 'DIV', text: 'Delete lane' });
        const res = await executeBrowserTool({ action: 'drag', sourceSelector: '#source', targetSelector: '#delete' });
        expect(res).toEqual({
          ok: false,
          requiresConfirmation: true,
          error: expect.stringContaining('High-impact browser action blocked'),
        });
        expect(managerMock.sendCdpCommand).not.toHaveBeenCalled();
      });

      it('sets a slider by percentage', async () => {
        managerMock.executeJs.mockResolvedValue({ found: true, value: '50', percent: 50 });
        const res = await executeBrowserTool({ action: 'set_slider', selector: 'input[type=range]', percent: 50 });
        expect(managerMock.executeJs).toHaveBeenCalledWith('session_1', expect.stringContaining("role === 'slider'"));
        expect(res).toEqual({ ok: true, found: true, value: '50', percent: 50 });
      });

      it('runs visibility, text, and console assertions', async () => {
        managerMock.executeJs
          .mockResolvedValueOnce({ found: true, visible: true, text: 'Save', tag: 'BUTTON' })
          .mockResolvedValueOnce({ found: true, text: 'Done', scoped: false });
        managerMock.getDiagnostics.mockReturnValueOnce({
          readyState: null,
          url: 'https://example.com/',
          title: 'Example',
          isLoading: false,
          recentEvents: [],
        });
        await expect(executeBrowserTool({ action: 'assert_visible', text: 'Save' })).resolves.toEqual({
          ok: true,
          passed: true,
          expected: true,
          found: true,
          visible: true,
          text: 'Save',
          tag: 'BUTTON',
        });
        await expect(executeBrowserTool({ action: 'assert_text', text: 'Done' })).resolves.toEqual({
          ok: true,
          passed: true,
          expectedText: 'Done',
          found: true,
          text: 'Done',
          scoped: false,
        });
        managerMock.executeJs.mockResolvedValueOnce({ found: true, clickable: true, reason: 'clickable', tag: 'BUTTON' });
        await expect(executeBrowserTool({ action: 'assert_clickable', selector: 'button' })).resolves.toEqual({
          ok: true,
          passed: true,
          found: true,
          clickable: true,
          reason: 'clickable',
          tag: 'BUTTON',
        });
        managerMock.executeJs
          .mockResolvedValueOnce({ found: true, enabled: true, disabled: false, tag: 'BUTTON', text: 'Save' })
          .mockResolvedValueOnce({ found: true, enabled: false, disabled: true, tag: 'BUTTON', text: 'Save' });
        await expect(executeBrowserTool({ action: 'assert_enabled', selector: 'button' })).resolves.toEqual({
          ok: true,
          passed: true,
          expectedEnabled: true,
          found: true,
          enabled: true,
          disabled: false,
          tag: 'BUTTON',
          text: 'Save',
        });
        await expect(executeBrowserTool({ action: 'assert_disabled', selector: 'button' })).resolves.toEqual({
          ok: true,
          passed: true,
          expectedEnabled: false,
          found: true,
          enabled: false,
          disabled: true,
          tag: 'BUTTON',
          text: 'Save',
        });
        await expect(executeBrowserTool({ action: 'assert_url', url: 'example.com' })).resolves.toEqual({
          ok: true,
          passed: true,
          actualUrl: 'https://example.com/',
          expectedUrl: 'example.com',
          exact: false,
        });
        managerMock.executeJs
          .mockResolvedValueOnce({ blank: false, textLength: 12, visibleElements: 3, mediaElements: 0, readyState: 'complete' })
          .mockResolvedValueOnce({ passed: false, total: 1, failures: [{ src: 'broken.png', complete: true, naturalWidth: 0, naturalHeight: 0 }], images: [] })
          .mockResolvedValueOnce({ passed: true, canvases: [{ nonEmpty: true }], videos: [], svgs: [] });
        await expect(executeBrowserTool({ action: 'assert_not_blank' })).resolves.toEqual({
          ok: true,
          passed: true,
          blank: false,
          textLength: 12,
          visibleElements: 3,
          mediaElements: 0,
          readyState: 'complete',
        });
        await expect(executeBrowserTool({ action: 'assert_images_loaded' })).resolves.toEqual({
          ok: false,
          passed: false,
          total: 1,
          failures: [{ src: 'broken.png', complete: true, naturalWidth: 0, naturalHeight: 0 }],
          images: [],
        });
        await expect(executeBrowserTool({ action: 'assert_media_rendered', selector: 'canvas' })).resolves.toEqual({
          ok: true,
          passed: true,
          canvases: [{ nonEmpty: true }],
          videos: [],
          svgs: [],
        });
        managerMock.executeJs
          .mockResolvedValueOnce({ found: true, count: 1, dialogs: [{ text: 'Settings' }] })
          .mockResolvedValueOnce({ found: true, count: 1, toasts: [{ text: 'Saved' }] })
          .mockResolvedValueOnce({ found: true, rowCount: 2, rows: ['A', 'B'] })
          .mockResolvedValueOnce({ found: true, valid: false, invalidControls: [{ name: 'email', valueMissing: true }], controlCount: 2 });
        await expect(executeBrowserTool({ action: 'assert_dialog_open', text: 'Settings' })).resolves.toEqual({
          ok: true,
          passed: true,
          found: true,
          count: 1,
          dialogs: [{ text: 'Settings' }],
        });
        await expect(executeBrowserTool({ action: 'assert_toast', text: 'Saved' })).resolves.toEqual({
          ok: true,
          passed: true,
          found: true,
          count: 1,
          toasts: [{ text: 'Saved' }],
        });
        await expect(executeBrowserTool({ action: 'assert_table_rows', selector: 'table', expectedCount: 2 })).resolves.toEqual({
          ok: true,
          passed: true,
          expectedCount: 2,
          found: true,
          rowCount: 2,
          rows: ['A', 'B'],
        });
        await expect(executeBrowserTool({ action: 'assert_form_validity', selector: 'form', expected: false })).resolves.toEqual({
          ok: true,
          passed: true,
          expected: false,
          found: true,
          valid: false,
          invalidControls: [{ name: 'email', valueMissing: true }],
          controlCount: 2,
        });
        await expect(executeBrowserTool({ action: 'assert_no_console_errors' })).resolves.toEqual({
          ok: true,
          passed: true,
          errors: [],
          checkedEvents: 0,
        });
        expect(managerMock.executeJs).toHaveBeenCalledWith('session_1', expect.stringContaining('document.images'));
        expect(managerMock.executeJs).toHaveBeenCalledWith('session_1', expect.stringContaining('HTMLCanvasElement'));
      });

      it('asserts semantic menu, tooltip, drawer, list, and card components', async () => {
        managerMock.executeJs
          .mockResolvedValueOnce({ found: true, count: 1, menus: [{ text: 'File' }] })
          .mockResolvedValueOnce({ found: true, count: 1, tooltips: [{ text: 'Help' }] })
          .mockResolvedValueOnce({ found: true, count: 1, drawers: [{ text: 'Settings' }] })
          .mockResolvedValueOnce({ found: true, itemCount: 3, items: ['One', 'Two', 'Three'] })
          .mockResolvedValueOnce({ found: true, count: 1, cards: [{ text: 'Plan' }] });
        await expect(executeBrowserTool({ action: 'assert_menu_open', text: 'File' })).resolves.toEqual(expect.objectContaining({
          ok: true,
          passed: true,
          found: true,
          count: 1,
          menus: [{ text: 'File' }],
        }));
        await expect(executeBrowserTool({ action: 'assert_tooltip', text: 'Help' })).resolves.toEqual(expect.objectContaining({
          ok: true,
          passed: true,
          found: true,
          count: 1,
          tooltips: [{ text: 'Help' }],
        }));
        await expect(executeBrowserTool({ action: 'assert_drawer_open', text: 'Settings' })).resolves.toEqual(expect.objectContaining({
          ok: true,
          passed: true,
          found: true,
          count: 1,
          drawers: [{ text: 'Settings' }],
        }));
        await expect(executeBrowserTool({ action: 'assert_list_items', selector: 'ul', expectedCount: 3 })).resolves.toEqual(expect.objectContaining({
          ok: true,
          passed: true,
          expectedCount: 3,
          found: true,
          itemCount: 3,
          items: ['One', 'Two', 'Three'],
        }));
        await expect(executeBrowserTool({ action: 'assert_card_visible', text: 'Plan' })).resolves.toEqual(expect.objectContaining({
          ok: true,
          passed: true,
          found: true,
          count: 1,
          cards: [{ text: 'Plan' }],
        }));
      });

      it('captures an accessibility snapshot through CDP', async () => {
        const longName = 'x'.repeat(600);
        managerMock.sendCdpCommand.mockResolvedValueOnce({
          nodes: Array.from({ length: 205 }, (_, index) => ({ role: { value: 'button' }, name: { value: index === 0 ? longName : `Button ${index}` } })),
        });
        const res = await executeBrowserTool({ action: 'accessibility_snapshot' });
        expect(managerMock.sendCdpCommand).toHaveBeenCalledWith('session_1', 'Accessibility.getFullAXTree', {});
        expect(res).toEqual({
          ok: true,
          tree: expect.objectContaining({
            nodeCount: 205,
            returnedNodeCount: 200,
            truncated: true,
            nodes: expect.arrayContaining([
              expect.objectContaining({ name: { value: `${'x'.repeat(500)}...` } }),
            ]),
          }),
        });
      });

      it('asserts no network errors from resource timing response status', async () => {
        managerMock.executeJs.mockResolvedValue({ failures: [{ name: 'https://example.com/missing.js', responseStatus: 404 }] });
        const res = await executeBrowserTool({ action: 'assert_no_network_errors' });
        expect(managerMock.executeJs).toHaveBeenCalledWith('session_1', expect.stringContaining('responseStatus >= 400'));
        expect(res).toEqual({
          ok: false,
          passed: false,
          failures: [{ name: 'https://example.com/missing.js', responseStatus: 404 }],
        });
      });

      it('returns CDP network diagnostics with runtime failures', async () => {
          managerMock.getDiagnostics.mockReturnValueOnce({
            readyState: null,
            url: 'https://example.com/',
            title: 'Example',
            isLoading: false,
            recentEvents: [],
            networkEvents: [{ type: 'response', url: 'https://example.com/app.js', status: 200, timestamp: 1 }],
            downloads: [],
          });
          managerMock.executeJs.mockResolvedValue({ failures: [] });
          const res = await executeBrowserTool({ action: 'network_diagnostics' });
          expect(managerMock.enableNetworkDiagnostics).toHaveBeenCalledWith('session_1');
          expect(res).toEqual({
            ok: true,
            networkEvents: [{ type: 'response', url: 'https://example.com/app.js', status: 200, timestamp: 1 }],
            failures: [],
          });
      });

      it('returns and asserts download diagnostics', async () => {
          const downloads = [
            { type: 'started', timestamp: 1, filename: 'report.csv', url: 'https://example.com/report.csv' },
            { type: 'done', timestamp: 2, filename: 'report.csv', url: 'https://example.com/report.csv', savePath: '/tmp/report.csv', state: 'completed' },
          ];
          managerMock.getDiagnostics.mockReturnValue({
            readyState: null,
            url: 'https://example.com/',
            title: 'Example',
            isLoading: false,
            recentEvents: [],
            networkEvents: [],
            downloads,
          });
          await expect(executeBrowserTool({ action: 'download_diagnostics' })).resolves.toEqual({
            ok: true,
            downloads,
          });
          await expect(executeBrowserTool({ action: 'assert_downloaded', text: 'report.csv' })).resolves.toEqual({
            ok: true,
            passed: true,
            downloads,
            matches: [downloads[1]],
          });
          await expect(executeBrowserTool({ action: 'assert_downloaded', text: 'missing.zip' })).resolves.toEqual({
            ok: false,
            passed: false,
            downloads,
            matches: [],
          });
      });

      it('inspects frames and audits layout', async () => {
          managerMock.executeJs
            .mockResolvedValueOnce({ frames: [{ src: 'https://frame.test', sameOrigin: true }] })
            .mockResolvedValueOnce({ horizontalOverflow: true, offscreen: [], clipped: [], overlaps: [], imageAspectAnomalies: [] });
          await expect(executeBrowserTool({ action: 'inspect_frames' })).resolves.toEqual({
            ok: true,
            frames: [{ src: 'https://frame.test', sameOrigin: true }],
          });
          await expect(executeBrowserTool({ action: 'layout_audit' })).resolves.toEqual({
            ok: true,
            horizontalOverflow: true,
            offscreen: [],
            clipped: [],
            overlaps: [],
            imageAspectAnomalies: [],
          });
          expect(managerMock.executeJs).toHaveBeenNthCalledWith(1, 'session_1', expect.stringContaining("document.querySelectorAll('iframe,frame')"));
          expect(managerMock.executeJs).toHaveBeenNthCalledWith(2, 'session_1', expect.stringContaining('horizontalOverflow'));
          expect(managerMock.executeJs).toHaveBeenNthCalledWith(2, 'session_1', expect.stringContaining('imageAspectAnomalies'));
      });

      it('sets date inputs and multi-selects options', async () => {
        managerMock.executeJs
          .mockResolvedValueOnce({ found: true, value: '2026-06-09', type: 'date' })
          .mockResolvedValueOnce({ found: true, selected: [{ value: 'a', text: 'A' }] });
        await expect(executeBrowserTool({ action: 'set_date', selector: 'input[type=date]', value: '2026-06-09' })).resolves.toEqual({
          ok: true,
          found: true,
          value: '2026-06-09',
          type: 'date',
        });
        await expect(executeBrowserTool({ action: 'multi_select', selector: 'select[multiple]', values: ['a'] })).resolves.toEqual({
          ok: true,
          found: true,
          selected: [{ value: 'a', text: 'A' }],
        });
        expect(managerMock.executeJs).toHaveBeenNthCalledWith(1, 'session_1', expect.stringContaining("['date', 'datetime-local'"));
        expect(managerMock.executeJs).toHaveBeenNthCalledWith(2, 'session_1', expect.stringContaining('select.multiple'));
      });
    });
  });

  describe('navigation state actions', () => {
    it('returns hasPage:false from get_state when no page exists', async () => {
      managerMock.getNavState.mockReturnValue(null);
      managerMock.hasNavigablePage.mockReturnValue(false);
      const res = await executeBrowserTool({ action: 'get_state' });
      expect(res).toEqual({ ok: true, hasPage: false });
      expect(managerMock.ensureViewForAutomation).not.toHaveBeenCalled();
    });

    it('routes back, forward, reload, and stop through the manager', async () => {
      await executeBrowserTool({ action: 'back' });
      await executeBrowserTool({ action: 'forward' });
      await executeBrowserTool({ action: 'reload' });
      await executeBrowserTool({ action: 'stop' });
      expect(managerMock.goBack).toHaveBeenCalledWith('session_1');
      expect(managerMock.goForward).toHaveBeenCalledWith('session_1');
      expect(managerMock.reload).toHaveBeenCalledWith('session_1');
      expect(managerMock.stop).toHaveBeenCalledWith('session_1');
      expect(managerMock.ensureViewForAutomation).toHaveBeenCalledTimes(4);
    });
  });

  // ── read_page ───────────────────────────────────────────────────────────

  describe('read_page', () => {
    it('delegates to executeJs and merges ok:true into the page object', async () => {
      managerMock.executeJs.mockResolvedValue({
        title: 'T',
        url: 'https://example.com/',
        text: 'body text',
        headings: [{ tag: 'H1', text: 'Hello' }],
        links: [{ text: 'Home', href: 'https://example.com/' }],
      });

      const res = await executeBrowserTool({ action: 'read_page' });
      expect(managerMock.ensureViewForAutomation).toHaveBeenCalledWith('session_1', undefined, undefined);
      expect(managerMock.executeJs).toHaveBeenCalledWith('session_1', expect.stringContaining('document.body'));
      expect(res).toEqual({
        ok: true,
        title: 'T',
        url: 'https://example.com/',
        text: 'body text',
        headings: [{ tag: 'H1', text: 'Hello' }],
        links: [{ text: 'Home', href: 'https://example.com/' }],
      });
    });

    describe('inspect and diagnostics', () => {
      it('inspect returns structured page details', async () => {
        managerMock.executeJs.mockResolvedValue({ elements: [{ tag: 'BUTTON', text: 'Save' }], forms: [] });
        const res = await executeBrowserTool({ action: 'inspect' });
        expect(managerMock.executeJs).toHaveBeenCalledWith('session_1', expect.stringContaining('querySelectorAll'));
        expect(res).toEqual({ ok: true, elements: [{ tag: 'BUTTON', text: 'Save' }], forms: [] });
      });

      it('diagnostics combines document readiness with manager diagnostics', async () => {
        managerMock.getDiagnostics.mockReturnValue({
          readyState: null,
          url: 'https://user:pass@example.com/callback?code=secret&safe=1#frag',
          title: 'Example',
          isLoading: false,
          recentEvents: [{ type: 'console', message: 'boom', timestamp: 1 }],
          networkEvents: [],
          downloads: [],
        });
        managerMock.executeJs.mockResolvedValue({
          readyState: 'complete',
          resources: [{ name: 'https://example.com/app.js', initiatorType: 'script' }],
          images: [{ complete: true, naturalWidth: 100 }],
          canvases: [{ width: 300, height: 150, nonEmpty: true }],
          videos: [],
        });
        const res = await executeBrowserTool({ action: 'diagnostics' });
        expect(res).toEqual({
          ok: true,
          readyState: 'complete',
          url: 'https://%5Bredacted%5D:%5Bredacted%5D@example.com/callback?code=%5Bredacted%5D&safe=1#[redacted]',
          title: 'Example',
          isLoading: false,
          recentEvents: [{ type: 'console', message: 'boom', timestamp: 1 }],
          networkEvents: [],
          downloads: [],
          resources: [{ name: 'https://example.com/app.js', initiatorType: 'script' }],
          images: [{ complete: true, naturalWidth: 100 }],
          canvases: [{ width: 300, height: 150, nonEmpty: true }],
          videos: [],
        });
      });
    });

    it('fails cleanly without creating a view when there is no navigable page', async () => {
      managerMock.hasNavigablePage.mockReturnValue(false);
      const res = await executeBrowserTool({ action: 'read_page' });
      expect(res).toEqual({
        ok: false,
        error: 'The embedded browser has no page open yet. Call the navigate action first.',
      });
      expect(managerMock.ensureViewForAutomation).not.toHaveBeenCalled();
      expect(managerMock.executeJs).not.toHaveBeenCalled();
    });
  });

  // ── click ───────────────────────────────────────────────────────────────

  describe('click', () => {
    it('requires a selector, text, role, or name', async () => {
      const res = await executeBrowserTool({ action: 'click' });
      expect(res).toEqual({ ok: false, error: 'click requires a "selector", "text", "role", or "name".' });
    });

    it('returns a not-found envelope when nothing matches', async () => {
      managerMock.executeJs.mockResolvedValue({ found: false, count: 0 });
      const res = await executeBrowserTool({ action: 'click', selector: '.missing' });
      expect(managerMock.ensureViewForAutomation).toHaveBeenCalledWith('session_1', undefined, undefined);
      expect(res).toEqual({ ok: false, matched: 0, error: 'No element matched the given selector/text.' });
      expect(managerMock.sendCdpCommand).not.toHaveBeenCalled();
    });

    it('returns a not-found envelope when the resolver returns null', async () => {
      managerMock.executeJs.mockResolvedValue(null);
      const res = await executeBrowserTool({ action: 'click', selector: '.missing' });
      expect(res).toEqual({ ok: false, matched: 0, error: 'No element matched the given selector/text.' });
    });

    it('dispatches a trusted 3-step mouse click at the element center (selector arm)', async () => {
      managerMock.executeJs.mockResolvedValue({ found: true, count: 1, x: 10, y: 20, tag: 'BUTTON', text: 'Open details' });
      const res = await executeBrowserTool({ action: 'click', selector: 'button.primary' });

      const base = { x: 10, y: 20, button: 'left', clickCount: 1 };
      expect(managerMock.sendCdpCommand).toHaveBeenNthCalledWith(1, 'session_1', 'Input.dispatchMouseEvent', { type: 'mouseMoved', ...base });
      expect(managerMock.sendCdpCommand).toHaveBeenNthCalledWith(2, 'session_1', 'Input.dispatchMouseEvent', { type: 'mousePressed', ...base });
      expect(managerMock.sendCdpCommand).toHaveBeenNthCalledWith(3, 'session_1', 'Input.dispatchMouseEvent', { type: 'mouseReleased', ...base });
      expect(res).toEqual({ ok: true, matched: 1, tag: 'BUTTON', button: 'left', clickCount: 1 });
    });

    it('resolves by visible text (text arm) and reports the match count', async () => {
      managerMock.executeJs.mockResolvedValue({ found: true, count: 2, x: 5, y: 6, tag: 'A', text: 'Learn more' });
      const res = await executeBrowserTool({ action: 'click', text: 'Learn more' });
      // The in-page resolver expression must embed the visible-text needle.
      expect(managerMock.executeJs).toHaveBeenCalledWith('session_1', expect.stringContaining('Learn more'));
      expect(res).toEqual({ ok: true, matched: 2, tag: 'A', button: 'left', clickCount: 1 });
    });

    it('supports role/name locators and double/right click variants', async () => {
      managerMock.executeJs.mockResolvedValue({ found: true, count: 1, x: 1, y: 2, tag: 'BUTTON', text: 'Open' });
      await executeBrowserTool({ action: 'double_click', role: 'button', name: 'Open' });
      await executeBrowserTool({ action: 'right_click', name: 'Open' });
      expect(managerMock.executeJs).toHaveBeenCalledWith('session_1', expect.stringContaining('const role = "button"'));
      expect(managerMock.sendCdpCommand).toHaveBeenNthCalledWith(
        2,
        'session_1',
        'Input.dispatchMouseEvent',
        expect.objectContaining({ button: 'left', clickCount: 2 }),
      );
      expect(managerMock.sendCdpCommand).toHaveBeenNthCalledWith(
        5,
        'session_1',
        'Input.dispatchMouseEvent',
        expect.objectContaining({ button: 'right', clickCount: 1 }),
      );
    });

    it('blocks high-impact click targets until explicit confirmation is requested', async () => {
      managerMock.executeJs.mockResolvedValue({ found: true, count: 1, x: 1, y: 2, tag: 'BUTTON', text: 'Delete project' });
      const res = await executeBrowserTool({ action: 'click', text: 'Delete project' });
      expect(res).toEqual({
        ok: false,
        requiresConfirmation: true,
        error: expect.stringContaining('High-impact browser action blocked'),
      });
      expect(managerMock.sendCdpCommand).not.toHaveBeenCalled();
    });

    it('does not allow model-supplied confirmation data to bypass high-impact click blocking', async () => {
      managerMock.executeJs.mockResolvedValue({ found: true, count: 1, x: 1, y: 2, tag: 'BUTTON', text: 'Delete project' });
      const res = await executeBrowserTool({
        action: 'click',
        text: 'Delete project',
        confirmationToken: 'model-supplied-token',
      });
      expect(managerMock.sendCdpCommand).not.toHaveBeenCalled();
      expect(res).toEqual({
        ok: false,
        requiresConfirmation: true,
        error: expect.stringContaining('High-impact browser action blocked'),
      });
    });

    it('does not block benign words that contain risky substrings', async () => {
      managerMock.executeJs.mockResolvedValue({ found: true, count: 1, x: 1, y: 2, tag: 'BUTTON', text: 'Postpone payment details' });
      const res = await executeBrowserTool({ action: 'click', text: 'Postpone payment details' });
      expect(res).toEqual({ ok: true, matched: 1, tag: 'BUTTON', button: 'left', clickCount: 1 });
      expect(managerMock.sendCdpCommand).toHaveBeenCalledTimes(3);
    });

    it.each([
      ['Confirm'],
      ['Save changes'],
      ['Approve request'],
      ['合并'],
      [''],
    ])('blocks ambiguous or irreversible activation label %j', async (text) => {
      managerMock.executeJs.mockResolvedValue({ found: true, count: 1, x: 1, y: 2, tag: 'BUTTON', text });
      const res = await executeBrowserTool({ action: 'click', selector: 'button' });
      expect(res).toEqual(expect.objectContaining({ ok: false, requiresConfirmation: true }));
      expect(managerMock.sendCdpCommand).not.toHaveBeenCalled();
    });
  });

  // ── type ────────────────────────────────────────────────────────────────

  describe('type', () => {
    it('requires a locator', async () => {
      const res = await executeBrowserTool({ action: 'type', text: 'hello' });
      expect(res).toEqual({
        ok: false,
        error: 'type requires a locator ("selector", "text", "role", "name", "label", "placeholder", or "testId").',
      });
    });

    it('requires text', async () => {
      const res = await executeBrowserTool({ action: 'type', selector: 'input' });
      expect(res).toEqual({ ok: false, error: 'type requires "text".' });
    });

    it('returns an error when the input is not found', async () => {
      managerMock.executeJs.mockResolvedValue({ found: false });
      const res = await executeBrowserTool({ action: 'type', selector: 'input', text: 'hi' });
      expect(res).toEqual({ ok: false, error: 'No input matched the given locator.' });
      expect(managerMock.sendCdpCommand).not.toHaveBeenCalled();
    });

    it('inserts text via CDP without submitting by default', async () => {
      managerMock.executeJs.mockResolvedValue({ found: true, count: 1, x: 1, y: 1, tag: 'INPUT' });
      const res = await executeBrowserTool({ action: 'type', selector: 'input', text: 'hello' });
      expect(managerMock.ensureViewForAutomation).toHaveBeenCalledWith('session_1', undefined, undefined);
      expect(managerMock.sendCdpCommand).toHaveBeenCalledTimes(1);
      expect(managerMock.sendCdpCommand).toHaveBeenCalledWith('session_1', 'Input.insertText', { text: 'hello' });
      expect(res).toEqual({ ok: true, submitted: false });
    });

    it('presses Enter after inserting when submit is true', async () => {
      managerMock.executeJs
        .mockResolvedValueOnce({ found: true, count: 1, x: 1, y: 1, tag: 'INPUT' })
        .mockResolvedValueOnce({ found: true, count: 1, x: 0, y: 0, tag: 'INPUT', text: 'Search' });
      const res = await executeBrowserTool({ action: 'type', selector: 'input', text: 'hello', submit: true });

      const enter = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 };
      expect(managerMock.sendCdpCommand).toHaveBeenNthCalledWith(1, 'session_1', 'Input.insertText', { text: 'hello' });
      expect(managerMock.sendCdpCommand).toHaveBeenNthCalledWith(2, 'session_1', 'Input.dispatchKeyEvent', { type: 'keyDown', ...enter });
      expect(managerMock.sendCdpCommand).toHaveBeenNthCalledWith(3, 'session_1', 'Input.dispatchKeyEvent', { type: 'keyUp', ...enter });
      expect(res).toEqual({ ok: true, submitted: true });
    });

    it('blocks submit=true when the focused form exposes a high-impact action', async () => {
      managerMock.executeJs
        .mockResolvedValueOnce({ found: true, count: 1, x: 1, y: 1, tag: 'INPUT' })
        .mockResolvedValueOnce({ found: true, count: 1, x: 0, y: 0, tag: 'INPUT', text: 'Delete project' });
      const res = await executeBrowserTool({ action: 'type', selector: 'input', text: 'confirm', submit: true });
      expect(res).toEqual({
        ok: false,
        requiresConfirmation: true,
        error: expect.stringContaining('High-impact browser action blocked'),
      });
      expect(managerMock.sendCdpCommand).toHaveBeenCalledTimes(1);
      expect(managerMock.sendCdpCommand).toHaveBeenCalledWith('session_1', 'Input.insertText', { text: 'confirm' });
    });
  });

  // ── wait_for ────────────────────────────────────────────────────────────

  describe('wait_for', () => {
    it('requires a locator', async () => {
      const res = await executeBrowserTool({ action: 'wait_for' });
      expect(res).toEqual({ ok: false, error: 'wait_for requires a locator.' });
    });

    describe('Codex parity interactions', () => {
      it('scrolls the page by default distance', async () => {
        managerMock.executeJs.mockResolvedValue({ found: true, target: 'window', scrollX: 0, scrollY: 600 });
        const res = await executeBrowserTool({ action: 'scroll' });
        expect(managerMock.executeJs).toHaveBeenCalledWith('session_1', expect.stringContaining('window.scrollBy'));
        expect(res).toEqual({ ok: true, found: true, target: 'window', scrollX: 0, scrollY: 600 });
      });

      it('scrolls a selector-scoped container', async () => {
        managerMock.executeJs.mockResolvedValue({ found: true, target: '.list', scrollTop: 400 });
        const res = await executeBrowserTool({ action: 'scroll', selector: '.list', y: 400 });
        expect(managerMock.executeJs).toHaveBeenCalledWith('session_1', expect.stringContaining('resolveLocator'));
        expect(res).toEqual({ ok: true, found: true, target: '.list', scrollTop: 400 });
      });

      it('supports absolute and percentage scrolling', async () => {
        managerMock.executeJs.mockResolvedValue({ found: true, target: 'window', scrollY: 1000 });
        const res = await executeBrowserTool({ action: 'scroll', scrollTo: 'bottom', percent: 50 });
        expect(managerMock.executeJs).toHaveBeenCalledWith('session_1', expect.stringContaining("to === 'bottom'"));
        expect(res).toEqual({ ok: true, found: true, target: 'window', scrollY: 1000 });
      });

      it('presses a key through CDP', async () => {
        managerMock.executeJs.mockResolvedValue({ found: true, count: 1, x: 0, y: 0, tag: 'INPUT', text: 'Search' });
        const res = await executeBrowserTool({ action: 'press_key', key: 'Enter', modifiers: ['Meta', 'IgnoredModifier'] });
        expect(managerMock.sendCdpCommand).toHaveBeenNthCalledWith(
          1,
          'session_1',
          'Input.dispatchKeyEvent',
          expect.objectContaining({ type: 'keyDown', key: 'Enter', modifiers: 4 }),
        );
        expect(managerMock.sendCdpCommand).toHaveBeenNthCalledWith(
          2,
          'session_1',
          'Input.dispatchKeyEvent',
          expect.objectContaining({ type: 'keyUp', key: 'Enter' }),
        );
        expect(res).toEqual({ ok: true, key: 'Enter' });
      });

      it.each([
        ['Space alias', 'Space'],
        ['literal space', ' '],
      ])('dispatches %s as the browser Space key', async (_label, key) => {
        managerMock.executeJs.mockResolvedValue({ found: true, count: 1, x: 0, y: 0, tag: 'BUTTON', text: 'Toggle' });
        const res = await executeBrowserTool({ action: 'press_key', key });
        const space = { key: ' ', code: 'Space', windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32, modifiers: 0 };

        expect(managerMock.sendCdpCommand).toHaveBeenNthCalledWith(
          1,
          'session_1',
          'Input.dispatchKeyEvent',
          { type: 'keyDown', ...space },
        );
        expect(managerMock.sendCdpCommand).toHaveBeenNthCalledWith(
          2,
          'session_1',
          'Input.dispatchKeyEvent',
          { type: 'keyUp', ...space },
        );
        expect(res).toEqual({ ok: true, key });
      });

      it('blocks Enter on a focused high-impact target', async () => {
        managerMock.executeJs.mockResolvedValue({ found: true, count: 1, x: 0, y: 0, tag: 'BUTTON', text: 'Pay now' });
        const res = await executeBrowserTool({ action: 'press_key', key: 'Enter' });
        expect(res).toEqual({
          ok: false,
          requiresConfirmation: true,
          error: expect.stringContaining('High-impact browser action blocked'),
        });
        expect(managerMock.sendCdpCommand).not.toHaveBeenCalled();
      });

      it('blocks Enter when the focused form has an unlabeled submitter', async () => {
        managerMock.executeJs.mockResolvedValue({ found: true, count: 1, x: 0, y: 0, tag: 'INPUT', text: '__UNLABELED_ACTIVATION_TARGET__' });
        const res = await executeBrowserTool({ action: 'press_key', key: 'Enter' });
        expect(res).toEqual(expect.objectContaining({ ok: false, requiresConfirmation: true }));
        expect(managerMock.sendCdpCommand).not.toHaveBeenCalled();
      });

      it('hovers an element by selector or text', async () => {
        managerMock.executeJs.mockResolvedValue({ found: true, count: 1, x: 9, y: 10, tag: 'BUTTON' });
        const res = await executeBrowserTool({ action: 'hover', text: 'Menu' });
        expect(managerMock.sendCdpCommand).toHaveBeenCalledWith('session_1', 'Input.dispatchMouseEvent', {
          type: 'mouseMoved',
          x: 9,
          y: 10,
        });
        expect(res).toEqual({ ok: true, matched: 1, tag: 'BUTTON' });
      });

      it('clears a field and selects an option via page JS', async () => {
        managerMock.executeJs.mockResolvedValueOnce({ found: true }).mockResolvedValueOnce({
          found: true,
          value: 'us',
          text: 'United States',
        });
        await expect(executeBrowserTool({ action: 'clear', selector: 'input[name=q]' })).resolves.toEqual({ ok: true });
        await expect(executeBrowserTool({ action: 'select_option', selector: 'select', value: 'us' })).resolves.toEqual({
          ok: true,
          found: true,
          value: 'us',
          text: 'United States',
        });
        expect(managerMock.executeJs).toHaveBeenNthCalledWith(1, 'session_1', expect.stringContaining("el.value = ''"));
        expect(managerMock.executeJs).toHaveBeenNthCalledWith(2, 'session_1', expect.stringContaining('select.options'));
      });
    });

    it('resolves immediately when the target is already present (selector arm)', async () => {
      managerMock.executeJs.mockResolvedValue(true);
      const res = (await executeBrowserTool({ action: 'wait_for', selector: '.ready' })) as any;
      expect(managerMock.ensureViewForAutomation).toHaveBeenCalledWith('session_1', undefined, undefined);
      expect(res.ok).toBe(true);
      expect(res.found).toBe(true);
      expect(typeof res.waitedMs).toBe('number');
    });

    it('waits for a matching URL', async () => {
      managerMock.getNavState.mockReturnValue({ ...NAV_STATE, url: 'https://example.com/settings' });
      managerMock.getRawNavState.mockReturnValue({ ...NAV_STATE, url: 'https://example.com/settings' });
      const res = (await executeBrowserTool({ action: 'wait_for_url', url: '/settings', timeoutMs: 0 })) as any;
      expect(res).toEqual({
        ok: true,
        found: true,
        actualUrl: 'https://example.com/settings',
        expectedUrl: '/settings',
        exact: false,
        waitedMs: expect.any(Number),
      });
    });

    it('clamps an over-large timeout and still resolves on first hit (text arm)', async () => {
      managerMock.executeJs.mockResolvedValue(true);
      const res = (await executeBrowserTool({ action: 'wait_for', text: 'Done', timeoutMs: 999999 })) as any;
      expect(managerMock.executeJs).toHaveBeenCalledWith('session_1', expect.stringContaining('Done'));
      expect(res).toEqual({ ok: true, found: true, waitedMs: expect.any(Number) });
    });

    it('returns immediately with found:false when timeout is zero and target absent', async () => {
      managerMock.executeJs.mockResolvedValue(false);
      const res = (await executeBrowserTool({ action: 'wait_for', selector: '.never', timeoutMs: 0 })) as any;
      expect(res).toEqual({ ok: true, found: false, waitedMs: expect.any(Number) });
    });

    it('returns aborted when the signal is already aborted', async () => {
      const controller = new AbortController();
      controller.abort();
      managerMock.executeJs.mockResolvedValue(false);
      const res = (await executeBrowserTool(
        { action: 'wait_for', selector: '.x' },
        { signal: controller.signal },
      )) as any;
      expect(res).toEqual({ ok: false, found: false, waitedMs: expect.any(Number), error: 'aborted' });
      expect(managerMock.executeJs).not.toHaveBeenCalled();
    });

    describe('with fake timers', () => {
      beforeEach(() => {
        vi.useFakeTimers();
      });
      afterEach(() => {
        vi.useRealTimers();
      });

      it('polls again after sleeping and resolves when the target appears', async () => {
        // Non-aborting signal exercises addEventListener + removeEventListener (defined arms).
        const controller = new AbortController();
        managerMock.executeJs.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

        const p = executeBrowserTool(
          { action: 'wait_for', selector: '.late', timeoutMs: 5000 },
          { signal: controller.signal },
        );
        await vi.advanceTimersByTimeAsync(250);
        const res = (await p) as any;

        expect(managerMock.executeJs).toHaveBeenCalledTimes(2);
        expect(res).toEqual({ ok: true, found: true, waitedMs: expect.any(Number) });
      });

      it('times out cleanly when the target never appears', async () => {
        managerMock.executeJs.mockResolvedValue(false);

        const p = executeBrowserTool({ action: 'wait_for', selector: '.never', timeoutMs: 500 });
        await vi.advanceTimersByTimeAsync(600);
        const res = (await p) as any;

        expect(res).toEqual({ ok: true, found: false, waitedMs: expect.any(Number) });
      });

      it('aborts mid-sleep when the signal fires during a poll wait', async () => {
        const controller = new AbortController();
        managerMock.executeJs.mockResolvedValue(false);

        const p = executeBrowserTool(
          { action: 'wait_for', selector: '.x', timeoutMs: 5000 },
          { signal: controller.signal },
        );
        await vi.advanceTimersByTimeAsync(100); // first poll false → enters sleep(250)
        controller.abort();                     // onAbort clears the timer and resolves
        await vi.advanceTimersByTimeAsync(0);    // flush the loop continuation
        const res = (await p) as any;

        expect(res).toEqual({ ok: false, found: false, waitedMs: expect.any(Number), error: 'aborted' });
      });
    });
  });

  describe('page-dependent idle-restore guard', () => {
    it.each([
      [{ action: 'click', selector: '.button' } as const],
      [{ action: 'type', selector: 'input', text: 'hello' } as const],
      [{ action: 'wait_for', selector: '.ready' } as const],
    ])('fails %s without creating a view when there is no navigable page', async (args) => {
      managerMock.hasNavigablePage.mockReturnValue(false);

      const res = await executeBrowserTool(args);

      expect(res).toEqual({
        ok: false,
        error: 'The embedded browser has no page open yet. Call the navigate action first.',
      });
      expect(managerMock.ensureViewForAutomation).not.toHaveBeenCalled();
      expect(managerMock.executeJs).not.toHaveBeenCalled();
      expect(managerMock.sendCdpCommand).not.toHaveBeenCalled();
    });
  });

  // ── defensive catch-all ───────────────────────────────────────────────────

  describe('error handling', () => {
    it('catches an Error thrown by the manager and returns its message', async () => {
      managerMock.ensureViewForAutomation.mockRejectedValue(new Error('boom'));
      const res = await executeBrowserTool({ action: 'navigate', url: 'https://example.com' });
      expect(res).toEqual({ ok: false, error: 'boom' });
    });

    it('stringifies a non-Error throw', async () => {
      managerMock.ensureViewForAutomation.mockRejectedValue('stringfail');
      const res = await executeBrowserTool({ action: 'navigate', url: 'https://example.com' });
      expect(res).toEqual({ ok: false, error: 'stringfail' });
    });
  });
});
