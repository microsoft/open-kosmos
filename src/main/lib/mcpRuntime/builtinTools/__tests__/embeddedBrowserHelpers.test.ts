import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import sharp from 'sharp';
import {
  assertClickable,
  assertDownloaded,
  assertEnabledState,
  assertDialogOpen,
  assertFormValidity,
  assertImagesLoaded,
  assertListItems,
  assertMediaRendered,
  assertNoConsoleErrors,
  assertNoNetworkErrors,
  assertNotBlank,
  assertSemanticContainer,
  assertTableRows,
  assertText,
  assertToast,
  assertUrl,
  assertVisible,
  accessibilitySnapshot,
  configureBrowserAssertionHandlers,
  downloadDiagnostics,
  inspectFrames,
  layoutAudit,
  multiSelect,
  networkDiagnostics,
  setDate,
} from '../embeddedBrowserAssertionHandlers';
import { WorkspacePreviewServer } from '../embeddedBrowserPreviewServer';
import { embeddedBrowserToolDefinition } from '../embeddedBrowserToolDefinition';
import {
  assertTextExpression,
  imagesLoadedExpression,
  inspectExpression,
  inspectFramesExpression,
  mediaRenderedExpression,
  networkErrorsExpression,
  readPageExpression,
  resolveTargetExpression,
  runtimeDiagnosticsExpression,
} from '../embeddedBrowserToolExpressions';
import {
  captureComparableScreenshot,
  clearVisualBaselines,
  compareScreenshotPixels,
  configureBrowserVisualHelpers,
  getVisualBaseline,
  isToolError,
  resolveScreenshotViewport,
  screenshotHash,
  storeVisualBaseline,
  visualBaselineKey,
} from '../embeddedBrowserVisualHelpers';
import { ChatSessionUtils } from '../../../userDataADO/types/profile';

const manager = {
  executeJs: vi.fn(),
  getNavState: vi.fn(),
  getDiagnostics: vi.fn(),
  getRawNavState: vi.fn(),
  hasNavigablePage: vi.fn(),
  ensureViewForAutomation: vi.fn(),
  getAutomationViewport: vi.fn(),
  setAutomationViewport: vi.fn(),
  captureScreenshot: vi.fn(),
  sendCdpCommand: vi.fn(),
  enableNetworkDiagnostics: vi.fn(),
} as any;

function requestText(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    }).on('error', reject);
  });
}

async function pngBase64(color: { r: number; g: number; b: number }): Promise<string> {
  return (await sharp({
    create: { width: 1, height: 1, channels: 4, background: { ...color, alpha: 1 } },
  }).png().toBuffer()).toString('base64');
}

describe('embedded browser helper modules', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configureBrowserAssertionHandlers({
      ensurePageReady: vi.fn(async () => undefined),
      fail: (error) => ({ ok: false, error }),
      hasLocator: (args) => Boolean(args.selector || args.text || args.role || args.name),
      hasFieldLocator: (args) => Boolean(args.selector || args.label || args.placeholder),
    });
    configureBrowserVisualHelpers({
      fail: (error) => ({ ok: false, error }),
      hasLocator: (args) => Boolean(args.selector || args.text || args.role || args.name),
    });
  });

  it('redacts sensitive URLs in page and diagnostics expressions', () => {
    for (const expression of [
      readPageExpression(),
      inspectExpression(),
      runtimeDiagnosticsExpression(),
      networkErrorsExpression(),
      inspectFramesExpression(),
      imagesLoadedExpression(),
      mediaRenderedExpression({} as any),
    ]) {
      expect(expression).toContain('redactDiagnosticUrl');
      expect(expression).toContain('[redacted]');
      expect(expression).toContain('url.username');
      expect(expression).toContain('url.password');
      expect(expression).toContain('pass|password|pwd');
    }
    expect(inspectExpression()).toContain('url: redactDiagnosticUrl(location.href)');
    expect(readPageExpression()).toContain('href: redactDiagnosticUrl(a.href)');
    expect(runtimeDiagnosticsExpression()).toContain('location: redactDiagnosticUrl(location.href)');
    expect(networkErrorsExpression()).toContain('name: redactDiagnosticUrl(entry.name)');
    expect(inspectFramesExpression()).toContain('src: redactDiagnosticUrl(frame.src ||');
    expect(imagesLoadedExpression()).toContain('src: redactDiagnosticUrl(img.currentSrc || img.src)');
    expect(mediaRenderedExpression({} as any)).toContain('src: redactDiagnosticUrl(video.currentSrc || video.src)');
  });

  it('covers assertion handler validation and alternate result branches', async () => {
    await expect(assertVisible(manager, 's1', {} as any)).resolves.toEqual({ ok: false, error: 'assert_visible requires a locator.' });
    await expect(assertText(manager, 's1', { text: '   ' } as any)).resolves.toEqual({ ok: false, error: 'assert_text requires "text".' });
    await expect(assertClickable(manager, 's1', {} as any)).resolves.toEqual({ ok: false, error: 'assert_clickable requires a locator.' });
    await expect(assertEnabledState(manager, 's1', {} as any, undefined, true)).resolves.toEqual({ ok: false, error: 'assert_enabled requires a locator.' });
    await expect(assertEnabledState(manager, 's1', {} as any, undefined, false)).resolves.toEqual({ ok: false, error: 'assert_disabled requires a locator.' });
    await expect(assertUrl(manager, 's1', {} as any)).resolves.toEqual({ ok: false, error: 'assert_url requires url.' });
    manager.getNavState.mockReturnValueOnce(null);
    await expect(assertUrl(manager, 's1', { url: 'example' } as any)).resolves.toEqual({
      ok: false,
      error: 'The embedded browser has no page open yet. Call the navigate action first.',
    });
    manager.getNavState.mockReturnValueOnce({ url: 'https://example.com/path' });
    await expect(assertUrl(manager, 's1', { url: 'https://example.com/path', exact: true } as any)).resolves.toMatchObject({ ok: true, exact: true });
    manager.getNavState.mockReturnValueOnce({ url: 'https://example.com/callback?code=%5Bredacted%5D' });
    manager.getRawNavState.mockReturnValueOnce({ url: 'https://example.com/callback?code=secret' });
    await expect(assertUrl(manager, 's1', { url: 'https://example.com/callback?code=secret', exact: true } as any)).resolves.toMatchObject({
      ok: true,
      actualUrl: 'https://example.com/callback?code=%5Bredacted%5D',
      expectedUrl: 'https://example.com/callback?code=%5Bredacted%5D',
      exact: true,
    });
  });

  it('makes scoped assert_text fail closed when the locator is missing', () => {
    const expression = assertTextExpression({ action: 'assert_text', selector: '#missing', text: 'Done' });
    expect(expression).toContain('scopedLocatorRequested');
    expect(expression).toContain("reason: 'not_found'");
    expect(expression).not.toContain("document.body?.innerText || ''");
  });

  it('covers diagnostics assertion helper branches', async () => {
    manager.getDiagnostics.mockReturnValue({
      downloads: [
        { type: 'done', filename: 'report.csv', url: 'https://x.test/report.csv', state: 'completed' },
        { type: 'done', filename: 'partial.csv', url: 'https://x.test/partial.csv', state: 'interrupted' },
      ],
    });
    await expect(downloadDiagnostics(manager, 's1')).resolves.toMatchObject({ ok: true, downloads: expect.any(Array) });
    await expect(assertDownloaded(manager, 's1', {} as any)).resolves.toMatchObject({ ok: true, matches: [expect.objectContaining({ filename: 'report.csv' })] });
    await expect(assertDownloaded(manager, 's1', { text: 'partial' } as any)).resolves.toMatchObject({ ok: false, matches: [] });
    manager.executeJs.mockResolvedValueOnce({ frames: [] }).mockResolvedValueOnce({ issues: [] });
    await expect(inspectFrames(manager, 's1')).resolves.toEqual({ ok: true, frames: [] });
    await expect(layoutAudit(manager, 's1')).resolves.toEqual({ ok: true, issues: [] });
  });

  it('returns restored page errors from every assertion handler', async () => {
    const restored = { ok: false as const, error: 'restore failed' };
    configureBrowserAssertionHandlers({
      ensurePageReady: vi.fn(async () => restored),
      fail: (error) => ({ ok: false, error }),
      hasLocator: () => true,
      hasFieldLocator: () => true,
    });
    const args = { selector: '#x', text: 'hello', url: 'https://example.com', value: '2026-01-01', values: ['a'], expectedCount: 1 } as any;
    const calls: Array<Promise<unknown>> = [
      assertVisible(manager, 's1', args),
      assertText(manager, 's1', args),
      assertClickable(manager, 's1', args),
      assertEnabledState(manager, 's1', args, undefined, true),
      assertUrl(manager, 's1', args),
      assertNotBlank(manager, 's1'),
      assertImagesLoaded(manager, 's1'),
      assertMediaRendered(manager, 's1', args),
      assertDialogOpen(manager, 's1', args),
      assertToast(manager, 's1', args),
      assertTableRows(manager, 's1', args),
      assertFormValidity(manager, 's1', args),
      assertSemanticContainer(manager, 's1', args, undefined, 'menu'),
      assertListItems(manager, 's1', args),
      assertNoConsoleErrors(manager, 's1'),
      assertNoNetworkErrors(manager, 's1'),
      accessibilitySnapshot(manager, 's1'),
      setDate(manager, 's1', args),
      multiSelect(manager, 's1', args),
      networkDiagnostics(manager, 's1'),
      downloadDiagnostics(manager, 's1'),
      assertDownloaded(manager, 's1', args),
      inspectFrames(manager, 's1'),
      layoutAudit(manager, 's1'),
    ];
    await expect(Promise.all(calls)).resolves.toEqual(calls.map(() => restored));
  });

  it('covers assertion helper success/failure condition combinations', async () => {
    manager.executeJs
      .mockResolvedValueOnce({ failures: undefined })
      .mockResolvedValueOnce({ passed: false })
      .mockResolvedValueOnce({ found: false })
      .mockResolvedValueOnce({ found: true })
      .mockResolvedValueOnce({ found: true, rowCount: 2 })
      .mockResolvedValueOnce({ found: true, valid: false })
      .mockResolvedValueOnce({ found: true })
      .mockResolvedValueOnce({ found: true, itemCount: 2 })
      .mockResolvedValueOnce({ failures: undefined })
      .mockResolvedValueOnce({ found: false })
      .mockResolvedValueOnce({ found: false });
    manager.getDiagnostics.mockReturnValue({
      recentEvents: [
        { type: 'console', level: 'warn' },
        { type: 'console', level: 'error' },
        { type: 'page-error' },
        { type: 'load-failure' },
      ],
      networkEvents: [{ type: 'failure' }],
      downloads: [],
    });
    manager.sendCdpCommand.mockResolvedValueOnce({ nodes: [] });

    await expect(assertImagesLoaded(manager, 's1')).resolves.toMatchObject({ ok: true, passed: true });
    await expect(assertMediaRendered(manager, 's1', {} as any)).resolves.toMatchObject({ ok: false, passed: false });
    await expect(assertDialogOpen(manager, 's1', {} as any)).resolves.toMatchObject({ ok: false, passed: false });
    await expect(assertToast(manager, 's1', {} as any)).resolves.toMatchObject({ ok: true, passed: true });
    await expect(assertTableRows(manager, 's1', { expectedCount: 2 } as any)).resolves.toMatchObject({ ok: true, expectedCount: 2 });
    await expect(assertFormValidity(manager, 's1', { expected: false } as any)).resolves.toMatchObject({ ok: true, expected: false });
    await expect(assertSemanticContainer(manager, 's1', {} as any, undefined, 'tooltip')).resolves.toMatchObject({ ok: true, kind: 'tooltip' });
    await expect(assertListItems(manager, 's1', { expectedCount: 1 } as any)).resolves.toMatchObject({ ok: false, expectedCount: 1 });
    await expect(assertNoConsoleErrors(manager, 's1')).resolves.toMatchObject({ ok: false, checkedEvents: 4 });
    await expect(assertNoNetworkErrors(manager, 's1')).resolves.toMatchObject({ ok: false, failures: [expect.objectContaining({ type: 'failure' })] });
    await expect(accessibilitySnapshot(manager, 's1')).resolves.toEqual({
      ok: true,
      tree: { nodes: [], truncated: false, nodeCount: 0, returnedNodeCount: 0 },
    });
    await expect(setDate(manager, 's1', {} as any)).resolves.toEqual({ ok: false, error: 'set_date requires a locator.' });
    await expect(setDate(manager, 's1', { selector: '#date' } as any)).resolves.toEqual({ ok: false, error: 'set_date requires "value" or "text".' });
    await expect(setDate(manager, 's1', { selector: '#date', value: '2026-01-01' } as any)).resolves.toEqual({ ok: false, error: 'No date input matched the given locator.' });
    await expect(multiSelect(manager, 's1', {} as any)).resolves.toEqual({ ok: false, error: 'multi_select requires a locator.' });
    await expect(multiSelect(manager, 's1', { selector: '#multi' } as any)).resolves.toEqual({ ok: false, error: 'multi_select requires "values", "value", or "text".' });
    await expect(multiSelect(manager, 's1', { selector: '#multi', values: ['a'] } as any)).resolves.toEqual({ ok: false, error: 'No multi-select matched the given locator/options.' });
  });

  it('generates fail-closed frame and shadow scoped locator expressions', () => {
    const expression = resolveTargetExpression({ frameSelector: '#checkout-frame', shadowSelector: '#root', text: 'Confirm' } as any);
    expect(expression).toContain("__locatorScopeError = 'frame not found'");
    expect(expression).toContain("__locatorScopeError = 'frame inaccessible'");
    expect(expression).toContain("__locatorScopeError = 'shadow host not found'");
    expect(expression).toContain("__locatorScopeError = 'shadow root unavailable'");
    expect(expression).toContain('if (__locatorScopeError || !root) return null;');
    expect(expression).not.toContain('|| document');
    expect(expression).not.toContain('|| rootDocument');
  });

  it('serves registered workspace previews and same-directory relative assets', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openkosmos-preview-test-'));
    const nested = path.join(root, 'demo');
    fs.mkdirSync(nested);
    fs.writeFileSync(path.join(nested, 'index.html'), '<link rel="stylesheet" href="style.css"><link rel="stylesheet" href="missing.css"><style>.hero{background:url("bg.png?sig=secret#frag")} .skip{background:url("#icon")}</style><script src="https://cdn.test/app.js"></script>');
    fs.writeFileSync(path.join(nested, 'style.css'), 'body { color: red; background: url("css-bg.png?sig=secret#frag"); }');
    fs.writeFileSync(path.join(nested, 'bg.png'), 'fake png');
    fs.writeFileSync(path.join(nested, 'css-bg.png'), 'fake css png');
    fs.writeFileSync(path.join(nested, 'secret.txt'), 'do not serve');
    fs.writeFileSync(path.join(root, 'outside.css'), 'body { color: blue; }');
    const preview = await WorkspacePreviewServer.shared().register('session_1', root, 'demo/index.html');
    const ok = await requestText(preview.url);
    expect(ok.status).toBe(200);
    expect(ok.body).toContain('style.css');

    await expect(WorkspacePreviewServer.shared().register('session_1', root, '.')).rejects.toThrow('requires a file path');
    await expect(WorkspacePreviewServer.shared().register('session_1', root, path.dirname(root))).rejects.toThrow('inside the workspace root');

    const unknown = await requestText(preview.url.replace('/preview/', '/preview/unknown-'));
    expect(unknown.status).toBe(404);
    const badRoute = await requestText(preview.url.replace(/\/preview\/.*/, '/not-preview'));
    expect(badRoute.status).toBe(404);
    const res = { writeHead: vi.fn(() => res), end: vi.fn() } as any;
    (WorkspacePreviewServer.shared() as any).handle({}, res);
    expect(res.writeHead).toHaveBeenCalledWith(404);
    const directory = await requestText(preview.url.replace(/\/[^/]+$/, '/'));
    expect(directory.status).toBe(403);
    const asset = await requestText(preview.url.replace(/\/[^/]+$/, '/style.css'));
    expect(asset.status).toBe(200);
    expect(asset.body).toContain('color: red');
    const cssAsset = await requestText(preview.url.replace(/\/[^/]+$/, '/bg.png'));
    expect(cssAsset.status).toBe(200);
    const linkedCssAsset = await requestText(preview.url.replace(/\/[^/]+$/, '/css-bg.png'));
    expect(linkedCssAsset.status).toBe(200);
    expect(linkedCssAsset.body).toBe('fake css png');
    const missingAsset = await requestText(preview.url.replace(/\/[^/]+$/, '/missing.css'));
    expect(missingAsset.status).toBe(404);
    expect(missingAsset.body).toBe('Not found');
    expect(missingAsset.body).not.toContain(root);
    expect(missingAsset.body).not.toContain(nested);
    const unreferencedSibling = await requestText(preview.url.replace(/\/[^/]+$/, '/secret.txt'));
    expect(unreferencedSibling.status).toBe(403);
    const parentAsset = await requestText(preview.url.replace(/\/[^/]+$/, '/%2E%2E%2Foutside.css'));
    expect(parentAsset.status).toBe(403);
    const linkName = `.tmp-preview-link-${Date.now()}`;
    try {
      fs.symlinkSync(path.join(root, 'outside.css'), path.join(nested, linkName));
      const forbidden = await requestText(preview.url.replace(/\/[^/]+$/, `/${linkName}`));
      expect(forbidden.status).toBe(403);
    } finally {
      fs.rmSync(path.join(nested, linkName), { force: true });
    }
    const noExtension = `.tmp-preview-${Date.now()}`;
    try {
      fs.writeFileSync(path.join(root, noExtension), 'raw');
      const rawPreview = await WorkspacePreviewServer.shared().register('session_1', root, noExtension);
      const raw = await requestText(rawPreview.url);
      expect(raw.status).toBe(200);
      expect(raw.body).toBe('raw');
    } finally {
      fs.rmSync(path.join(root, noExtension), { force: true });
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('normalizes preview asset allowlists conservatively', () => {
    const server = new (WorkspacePreviewServer as any)();
    expect(server.normalizeRelativeAsset('')).toBe('');
    expect(server.normalizeRelativeAsset('#icon')).toBe('');
    expect(server.normalizeRelativeAsset('/absolute.css')).toBe('');
    expect(server.normalizeRelativeAsset('https://cdn.test/app.js')).toBe('');
    expect(server.normalizeRelativeAsset('//cdn.test/app.js')).toBe('');
    expect(server.normalizeRelativeAsset('assets\\app.js?token=secret#frag')).toBe('assets/app.js');
    expect(server.collectAllowedRelativeAssets('/missing/index.html', 'index.html')).toEqual(new Set());
    expect(server.collectAllowedRelativeAssets('/missing/file.txt', 'file.txt')).toEqual(new Set());
  });

  it('covers preview token denied-file handler branches', () => {
    const server = new (WorkspacePreviewServer as any)();
    const root = fs.realpathSync(process.cwd());
    const token = 'token-for-denials';
    const res = { writeHead: vi.fn(() => res), end: vi.fn() } as any;

    server.roots.set(token, {
      sessionId: 'session_1',
      workspaceRoot: path.join(root, 'src'),
      baseDir: root,
      filePath: path.join(root, 'package.json'),
      relativeName: 'package.json',
      allowedRelatives: new Set(),
      createdAt: Date.now(),
    });
    server.handle({ url: `/preview/${token}/package.json` }, res);
    expect(res.writeHead).toHaveBeenCalledWith(403);

    res.writeHead.mockClear();
    res.end.mockClear();
    server.roots.set(token, {
      sessionId: 'session_1',
      workspaceRoot: root,
      baseDir: root,
      filePath: root,
      relativeName: path.basename(root),
      allowedRelatives: new Set(),
      createdAt: Date.now(),
    });
    server.handle({ url: `/preview/${token}/${encodeURIComponent(path.basename(root))}` }, res);
    expect(res.writeHead).toHaveBeenCalledWith(404);
  });

  it('expires old preview tokens and caps token storage', () => {
    const server = new (WorkspacePreviewServer as any)();
    const root = fs.realpathSync(process.cwd());
    const res = { writeHead: vi.fn(() => res), end: vi.fn() } as any;
    const oldToken = 'old-token';
    server.roots.set(oldToken, {
      workspaceRoot: root,
      filePath: path.join(root, 'package.json'),
      relativeName: 'package.json',
      createdAt: Date.now() - (31 * 60 * 1000),
    });

    server.handle({ url: `/preview/${oldToken}/package.json` }, res);
    expect(res.writeHead).toHaveBeenCalledWith(404);
    expect(server.roots.has(oldToken)).toBe(false);

    for (let i = 0; i < 105; i += 1) {
      server.roots.set(`token-${i}`, {
        workspaceRoot: root,
        filePath: path.join(root, 'package.json'),
        relativeName: 'package.json',
        createdAt: Date.now(),
      });
    }
    server.pruneRoots();
    expect(server.roots.size).toBe(100);
    expect(server.roots.has('token-0')).toBe(false);
    expect(server.roots.has('token-104')).toBe(true);
  });

  it('covers visual helper viewport, hash, error, and pixel comparison branches', async () => {
    manager.hasNavigablePage.mockReturnValueOnce(false);
    await expect(captureComparableScreenshot(manager, 's1', {} as any)).resolves.toEqual({
      ok: false,
      error: 'The embedded browser has no page open yet. Call the navigate action first.',
    });

    manager.hasNavigablePage.mockReturnValue(true);
    manager.getAutomationViewport.mockReturnValue({ width: 800, height: 600 });
    manager.executeJs.mockImplementationOnce(async () => null);
    await expect(captureComparableScreenshot(manager, 's1', { selector: '#missing' } as any)).resolves.toEqual({
      ok: false,
      error: 'No element matched the screenshot locator.',
    });

    manager.executeJs.mockResolvedValueOnce({ x: 1, y: 2, width: 3, height: 4 });
    manager.captureScreenshot.mockResolvedValueOnce({ data: Buffer.from('shot').toString('base64'), mimeType: 'image/png' });
    await expect(captureComparableScreenshot(manager, 's1', { selector: '#ok', viewport: 'mobile' } as any)).resolves.toMatchObject({ mimeType: 'image/png' });
    expect(manager.setAutomationViewport).toHaveBeenCalledWith('s1', 390, 844);
    expect(manager.setAutomationViewport).toHaveBeenCalledWith('s1', 800, 600);

    expect(screenshotHash(Buffer.from('x').toString('base64'))).toMatch(/^[a-f0-9]{64}$/);
    expect(isToolError({ ok: false, error: 'x' })).toBe(true);
    expect(visualBaselineKey('s1', 'home')).toBe('s1:home');
    const baseline = { data: 'x', hash: 'h', bytes: 1024 * 1024, mimeType: 'image/png', capturedAt: 1 };
    storeVisualBaseline('s1', 'home', baseline);
    expect(getVisualBaseline('s1', 'home')).toEqual(baseline);
    const oversized = storeVisualBaseline('s1', 'oversized', { ...baseline, bytes: (25 * 1024 * 1024) + 1 });
    expect(oversized).toEqual({ ok: false, error: expect.stringContaining('Visual baseline is too large to store') });
    expect(getVisualBaseline('s1', 'oversized')).toBeUndefined();
    clearVisualBaselines('other');
    expect(getVisualBaseline('s1', 'home')).toEqual(baseline);
    clearVisualBaselines();
    expect(getVisualBaseline('s1', 'home')).toBeUndefined();
    for (let i = 0; i < 30; i += 1) {
      storeVisualBaseline('s1', `large-${i}`, { ...baseline, bytes: 1024 * 1024, capturedAt: i });
    }
    expect(getVisualBaseline('s1', 'large-0')).toBeUndefined();
    expect(getVisualBaseline('s1', 'large-29')).toBeDefined();
    clearVisualBaselines();

    manager.executeJs.mockResolvedValueOnce({ width: 99999, height: 1 });
    await expect(resolveScreenshotViewport(manager, 's1', { fullPage: true } as any)).resolves.toEqual({ width: 3840, height: 240 });
    await expect(resolveScreenshotViewport(manager, 's1', { viewport: 'desktop' } as any)).resolves.toEqual({ width: 1440, height: 900 });
    await expect(resolveScreenshotViewport(manager, 's1', { width: 1, height: 99999 } as any)).resolves.toEqual({ width: 320, height: 2160 });

    const red = await pngBase64({ r: 255, g: 0, b: 0 });
    const blue = await pngBase64({ r: 0, g: 0, b: 255 });
    await expect(compareScreenshotPixels(red, red, 999, false)).resolves.toMatchObject({ comparable: true, changedPixels: 0, threshold: 255 });
    await expect(compareScreenshotPixels(red, red, 0, true)).resolves.toMatchObject({ comparable: true, changedPixels: 0, diffImage: expect.objectContaining({ available: true, mimeType: 'image/png', bytes: expect.any(Number) }) });
    await expect(compareScreenshotPixels(red, blue, 0, true)).resolves.toMatchObject({ comparable: true, changedPixels: 1, diffImage: expect.objectContaining({ available: true, mimeType: 'image/png', bytes: expect.any(Number) }) });
    const wide = (await sharp({ create: { width: 2, height: 1, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } }).png().toBuffer()).toString('base64');
    await expect(compareScreenshotPixels(red, wide)).resolves.toMatchObject({ comparable: false, reason: expect.stringContaining('Image dimensions differ') });
    await expect(compareScreenshotPixels('not-base64', red)).resolves.toMatchObject({ comparable: false });
  });

  it('covers metadata-only browser definition and renderer-safe profile helpers', () => {
    expect(embeddedBrowserToolDefinition.name).toBe('browser');
    expect(embeddedBrowserToolDefinition.inputSchema.properties.workspaceRoot).toBeUndefined();
    expect(embeddedBrowserToolDefinition.inputSchema.properties.confirmationToken).toBeUndefined();
    const session = ChatSessionUtils.createDefaultChatSession('Browser Review');
    expect(session.chatSession_id).toMatch(/^chatSession_/);
    expect(ChatSessionUtils.isValidChatSession(session)).toBe(true);
    expect(ChatSessionUtils.sanitizeChatSessions([session, { bad: true }])).toEqual([session]);
  });
});
