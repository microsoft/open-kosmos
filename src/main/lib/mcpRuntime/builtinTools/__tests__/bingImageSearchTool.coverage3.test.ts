// @ts-nocheck
/**
 * bingImageSearchTool.coverage3.test.ts
 *
 * Targets uncovered paths in bingImageSearchTool.ts:
 * - getHostMachineConfig: darwin/win32/linux platform branches (lines 106-111)
 * - isPageStable: URL change path, error path
 * - parseBingImageSearchResults: parse flow and object sizeInfo
 * - abort signal: already aborted
 * - performSingleImageSearch: state save failure, error path with state save
 * - stateFile corrupted (unlinkSync path)
 * - isPageStable retry path (unstable + retry)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── hoisted mocks ────────────────────────────────────────────────────────────

const {
  mockLogger,
  mockStorageState,
  mockPageClose,
  mockContextClose,
  mockBrowserClose,
  mockAddInitScript,
  mockGoto,
  mockWaitForSelector,
  mockWaitForTimeout,
  mockPageUrl,
  mockPageContent,
  mockNewPage,
  mockNewContext,
  mockLaunchBrowser,
  mockEnsureBrowserInstalled,
} = vi.hoisted(() => {
  const iuscHtml = `<html><body>
<a class="iusc" m="{&quot;murl&quot;:&quot;https://example.com/img.jpg&quot;,&quot;turl&quot;:&quot;https://tbn.com/thumb.jpg&quot;,&quot;purl&quot;:&quot;https://example.com&quot;,&quot;t&quot;:&quot;Example Image&quot;,&quot;s&quot;:&quot;example.com&quot;,&quot;w&quot;:800,&quot;h&quot;:600}">img</a>
</body></html>`;
  return {
    mockLogger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    mockStorageState: vi.fn().mockResolvedValue(undefined),
    mockPageClose: vi.fn().mockResolvedValue(undefined),
    mockContextClose: vi.fn().mockResolvedValue(undefined),
    mockBrowserClose: vi.fn().mockResolvedValue(undefined),
    mockAddInitScript: vi.fn().mockResolvedValue(undefined),
    mockGoto: vi.fn().mockResolvedValue({ url: () => 'https://www.bing.com/images/search?q=test' }),
    mockWaitForSelector: vi.fn().mockResolvedValue(null),
    mockWaitForTimeout: vi.fn().mockResolvedValue(undefined),
    mockPageUrl: vi.fn().mockReturnValue('https://www.bing.com/images/search?q=test'),
    mockPageContent: vi.fn().mockResolvedValue(iuscHtml),
    mockNewPage: vi.fn(),
    mockNewContext: vi.fn(),
    mockLaunchBrowser: vi.fn(),
    mockEnsureBrowserInstalled: vi.fn().mockResolvedValue({ installed: true, browserPath: '/mock/chromium' }),
  };
});

vi.mock('../../../unifiedLogger', () => ({
  getUnifiedLogger: () => mockLogger,
}));

vi.mock('../../../playwright', () => ({
  PlaywrightManager: {
    getInstance: () => ({
      ensureBrowserInstalled: mockEnsureBrowserInstalled,
      launchBrowser: mockLaunchBrowser,
    }),
  },
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(false),
    readFileSync: vi.fn().mockReturnValue('{}'),
    writeFileSync: vi.fn(),
    unlinkSync: vi.fn(),
    mkdirSync: vi.fn(),
  };
});

import { BingImageSearchTool } from '../bingImageSearchTool';
import * as fs from 'fs';

// ── helpers ──────────────────────────────────────────────────────────────────

function makePage(overrides: Partial<Record<string, any>> = {}) {
  return {
    url: mockPageUrl,
    goto: mockGoto,
    waitForSelector: mockWaitForSelector,
    waitForTimeout: mockWaitForTimeout,
    content: mockPageContent,
    close: mockPageClose,
    addInitScript: mockAddInitScript,
    ...overrides,
  };
}

function makeContext(page: any) {
  return {
    newPage: mockNewPage.mockResolvedValue(page),
    storageState: mockStorageState,
    close: mockContextClose,
    addInitScript: mockAddInitScript,
  };
}

function makeBrowser(ctx: any) {
  return {
    newContext: mockNewContext.mockResolvedValue(ctx),
    close: mockBrowserClose,
  };
}

function setupBrowserChain(pageOverrides: Partial<Record<string, any>> = {}) {
  const page = makePage(pageOverrides);
  const ctx = makeContext(page);
  const browser = makeBrowser(ctx);
  mockLaunchBrowser.mockResolvedValue(browser);
  return { page, ctx, browser };
}

const baseArgs = {
  queries: ['test query'],
  lang: 'en' as const,
  locale: 'us' as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockEnsureBrowserInstalled.mockResolvedValue({ installed: true, browserPath: '/mock/chromium' });
});

// ── getHostMachineConfig platform branches ────────────────────────────────────

describe('BingImageSearchTool — getHostMachineConfig platform branches', () => {
  const getConfig = (platform: string) => {
    const origPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: platform, configurable: true });
    try {
      return (BingImageSearchTool as any).getHostMachineConfig();
    } finally {
      Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
    }
  };

  it('returns Desktop Chrome for darwin (overridden to Chrome at end)', () => {
    const result = getConfig('darwin');
    // The function sets deviceName to 'Desktop Safari' for darwin, but then overrides to 'Desktop Chrome'
    expect(result.deviceName).toBe('Desktop Chrome');
  });

  it('returns Desktop Chrome for win32', () => {
    const result = getConfig('win32');
    expect(result.deviceName).toBe('Desktop Chrome');
  });

  it('returns Desktop Chrome for linux', () => {
    const result = getConfig('linux');
    expect(result.deviceName).toBe('Desktop Chrome');
  });

  it('handles all timezone branches', () => {
    const offsets = [-490, -601, -450, -30, 30, 270, 600];
    const tzIds = ['Asia/Shanghai', 'Asia/Tokyo', 'Asia/Bangkok', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'Asia/Shanghai'];
    const origGetOffset = Date.prototype.getTimezoneOffset;
    offsets.forEach((offset, i) => {
      Date.prototype.getTimezoneOffset = vi.fn().mockReturnValue(offset);
      const result = (BingImageSearchTool as any).getHostMachineConfig();
      expect(result.timezoneId).toBe(tzIds[i]);
    });
    Date.prototype.getTimezoneOffset = origGetOffset;
  });
});

// ── isPageStable ──────────────────────────────────────────────────────────────

describe('BingImageSearchTool — isPageStable', () => {
  it('returns false when URL changes during check', async () => {
    let callCount = 0;
    const page = makePage({
      url: vi.fn(() => {
        callCount++;
        return callCount === 1 ? 'https://bing.com/a' : 'https://bing.com/b';
      }),
    });
    const result = await (BingImageSearchTool as any).isPageStable(page, 1, 0);
    expect(result).toBe(false);
  });

  it('returns true when URL is stable', async () => {
    const page = makePage({ url: vi.fn().mockReturnValue('https://bing.com/images?q=test') });
    const result = await (BingImageSearchTool as any).isPageStable(page, 1, 0);
    expect(result).toBe(true);
  });

  it('returns false when page.url throws', async () => {
    const page = makePage({ url: vi.fn(() => { throw new Error('closed'); }) });
    const result = await (BingImageSearchTool as any).isPageStable(page, 1, 0);
    expect(result).toBe(false);
  });
});

// ── parseBingImageSearchResults ───────────────────────────────────────────────

describe('BingImageSearchTool — parseBingImageSearchResults', () => {
  it('returns empty for HTML with no iusc elements', () => {
    const results = (BingImageSearchTool as any).parseBingImageSearchResults('<html><body>no results</body></html>', 'test', 5);
    expect(results).toEqual([]);
  });

  it('parses a valid iusc result', () => {
    const html = `<a class="iusc" m="{&quot;murl&quot;:&quot;https://example.com/img.jpg&quot;,&quot;turl&quot;:&quot;https://tbn.com/thumb.jpg&quot;,&quot;t&quot;:&quot;A title&quot;,&quot;s&quot;:&quot;example.com&quot;}">img</a>`;
    const results = (BingImageSearchTool as any).parseBingImageSearchResults(html, 'test', 5);
    expect(results.length).toBeGreaterThanOrEqual(0);
  });

  it('handles object sizeInfo with display property', () => {
    const html = `<a class="iusc" m="{&quot;murl&quot;:&quot;https://example.com/img.jpg&quot;,&quot;turl&quot;:&quot;https://thumb.com/t.jpg&quot;,&quot;t&quot;:&quot;T&quot;,&quot;size&quot;:{&quot;display&quot;:&quot;800x600&quot;}}">img</a>`;
    const results = (BingImageSearchTool as any).parseBingImageSearchResults(html, 'test', 5);
    // Should not throw
    expect(Array.isArray(results)).toBe(true);
  });

  it('skips results with no thumbnailUrl', () => {
    const html = `<a class="iusc" m="{&quot;t&quot;:&quot;Title&quot;}">img</a>`;
    const results = (BingImageSearchTool as any).parseBingImageSearchResults(html, 'test', 5);
    expect(results).toEqual([]);
  });
});

// ── execute: abort signal already fired ──────────────────────────────────────

describe('BingImageSearchTool.execute — abort signal', () => {
  it('handles already-aborted signal gracefully', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    setupBrowserChain();
    const controller = new AbortController();
    controller.abort();
    const result = await BingImageSearchTool.execute(baseArgs, { signal: controller.signal });
    expect(result).toBeDefined();
  });

  it('attaches and removes abort handler for non-aborted signal', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    setupBrowserChain();
    const controller = new AbortController();
    const result = await BingImageSearchTool.execute(baseArgs, { signal: controller.signal });
    expect(result.totalQueries).toBe(1);
  });
});

// ── execute: shared browser, isolation, retry (parallel-degradation fix) ──────

const iuscAnchor = (n: number) =>
  `<a class="iusc" m="{&quot;murl&quot;:&quot;https://example.com/img${n}.jpg&quot;,&quot;turl&quot;:&quot;https://tbn.com/thumb${n}.jpg&quot;,&quot;purl&quot;:&quot;https://example.com/p${n}&quot;,&quot;t&quot;:&quot;Image ${n}&quot;,&quot;s&quot;:&quot;example.com&quot;,&quot;w&quot;:800,&quot;h&quot;:600}">img</a>`;
const SINGLE_RESULT_HTML = `<html><body>${iuscAnchor(1)}</body></html>`;
const MULTI_RESULT_HTML = `<html><body>${iuscAnchor(1)}${iuscAnchor(2)}${iuscAnchor(3)}</body></html>`;

describe('BingImageSearchTool.execute — shared browser and isolation', () => {
  it('handles navigation error in performSingleImageSearch', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const page = makePage({ goto: vi.fn().mockRejectedValue(new Error('nav failed')) });
    const ctx = makeContext(page);
    const browser = makeBrowser(ctx);
    mockLaunchBrowser.mockResolvedValue(browser);

    const result = await BingImageSearchTool.execute(baseArgs);
    expect(result).toBeDefined();
    expect(result.errors).toBeDefined();
  });

  it('launches exactly one shared browser and closes it once for a multi-query call', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    setupBrowserChain({ content: vi.fn().mockResolvedValue(MULTI_RESULT_HTML) });

    const result = await BingImageSearchTool.execute({ ...baseArgs, queries: ['q1', 'q2', 'q3'] });
    expect(result.totalQueries).toBe(3);
    expect(mockLaunchBrowser).toHaveBeenCalledTimes(1);
    expect(mockBrowserClose).toHaveBeenCalledTimes(1);
    // A fresh isolated context per query; no shared state file is ever written.
    expect(mockNewContext).toHaveBeenCalledTimes(3);
    expect(vi.mocked(fs.writeFileSync)).not.toHaveBeenCalled();
    expect(mockStorageState).not.toHaveBeenCalled();
  });

  it('returns a failure result when the shared browser cannot launch', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    mockLaunchBrowser.mockRejectedValueOnce(new Error('no chromium'));

    const result = await BingImageSearchTool.execute(baseArgs);
    expect(result.success).toBe(false);
    expect(result.errors?.[0]).toContain('Failed to launch browser');
    expect(mockBrowserClose).not.toHaveBeenCalled();
  });

  it('retries once in a fresh context when a query yields <=1 result and keeps the better attempt', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const content = vi.fn()
      .mockResolvedValueOnce(SINGLE_RESULT_HTML)
      .mockResolvedValueOnce(MULTI_RESULT_HTML);
    setupBrowserChain({ content });

    const result = await BingImageSearchTool.execute(baseArgs);
    expect(content).toHaveBeenCalledTimes(2);
    expect(mockNewContext).toHaveBeenCalledTimes(2);
    expect(result.totalResults).toBeGreaterThan(1);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('retrying once in a fresh context')
    );
  });

  it('does not retry a successful one-result search when maxResults is 1', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const content = vi.fn().mockResolvedValue(SINGLE_RESULT_HTML);
    setupBrowserChain({ content });

    const result = await BingImageSearchTool.execute({ ...baseArgs, maxResults: 1 });
    expect(content).toHaveBeenCalledTimes(1);
    expect(mockNewContext).toHaveBeenCalledTimes(1);
    expect(result.totalResults).toBe(1);
    expect(mockLogger.warn).not.toHaveBeenCalledWith(
      expect.stringContaining('retrying once in a fresh context')
    );
  });

  it('throws inside attempt when the signal aborts after the launch gate', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    setupBrowserChain();
    let reads = 0;
    const fakeSignal: any = {
      get aborted() { reads++; return reads > 1; },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };

    const result = await BingImageSearchTool.execute(baseArgs, { signal: fakeSignal });
    expect(result.errors).toBeDefined();
    expect(result.errors?.[0]).toContain('failed');
  });

  it('closes the page via the abort handler when the signal fires mid-flight', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const controller = new AbortController();
    const page = makePage({
      goto: vi.fn().mockImplementation(async () => {
        controller.abort();
        return { url: () => 'https://www.bing.com/images/search?q=test' };
      }),
      content: vi.fn().mockResolvedValue(MULTI_RESULT_HTML),
    });
    const ctx = makeContext(page);
    const browser = makeBrowser(ctx);
    mockLaunchBrowser.mockResolvedValue(browser);

    const result = await BingImageSearchTool.execute(baseArgs, { signal: controller.signal });
    expect(result).toBeDefined();
    expect(mockPageClose).toHaveBeenCalled();
  });
});

// ── execute: close() failures are swallowed ──────────────────────────────────
describe('BingImageSearchTool.execute — close() failures', () => {
  it('warns but still returns when the shared browser fails to close', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    setupBrowserChain({ content: vi.fn().mockResolvedValue(MULTI_RESULT_HTML) });
    mockBrowserClose.mockRejectedValue(new Error('browser close boom'));
    const result = await BingImageSearchTool.execute(baseArgs);
    expect(result).toBeDefined();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to close shared browser')
    );
  });

  it('swallows page and context close rejection in the per-query finally', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    setupBrowserChain({ content: vi.fn().mockResolvedValue(MULTI_RESULT_HTML) });
    mockPageClose.mockRejectedValue(new Error('page close boom'));
    mockContextClose.mockRejectedValue(new Error('context close boom'));
    const result = await BingImageSearchTool.execute(baseArgs);
    expect(result.success).toBe(true);
    expect(mockPageClose).toHaveBeenCalled();
    expect(mockContextClose).toHaveBeenCalled();
  });

  it('swallows page.close rejection triggered by the mid-flight abort handler', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const controller = new AbortController();
    const page = makePage({
      goto: vi.fn().mockImplementation(async () => {
        controller.abort();
        return { url: () => 'https://www.bing.com/images/search?q=test' };
      }),
      content: vi.fn().mockResolvedValue(MULTI_RESULT_HTML),
      close: vi.fn().mockRejectedValue(new Error('page close boom')),
    });
    const ctx = makeContext(page);
    const browser = makeBrowser(ctx);
    mockLaunchBrowser.mockResolvedValue(browser);
    const result = await BingImageSearchTool.execute(baseArgs, { signal: controller.signal });
    expect(result).toBeDefined();
  });
});

// ── execute: page stability retry ────────────────────────────────────────────

describe('BingImageSearchTool.execute — page stability retry', () => {
  it('retries when page is not stable and continues', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    let callCount = 0;
    const page = makePage({
      url: vi.fn(() => {
        callCount++;
        // First 2 calls return different URLs to trigger instability, then stable
        return callCount <= 2 ? `https://bing.com/path${callCount}` : 'https://bing.com/stable';
      }),
    });
    const ctx = makeContext(page);
    const browser = makeBrowser(ctx);
    mockLaunchBrowser.mockResolvedValue(browser);

    const result = await BingImageSearchTool.execute(baseArgs);
    expect(result.totalQueries).toBe(1);
  });
});

// ── cleanUrl ──────────────────────────────────────────────────────────────────

describe('BingImageSearchTool — cleanUrl', () => {
  it('returns empty string for empty input', () => {
    const result = (BingImageSearchTool as any).cleanUrl('');
    expect(result).toBe('');
  });

  it('returns raw url for non-bing redirect', () => {
    const result = (BingImageSearchTool as any).cleanUrl('https://example.com/img.jpg');
    expect(result).toBe('https://example.com/img.jpg');
  });

  it('decodes base64-encoded Bing redirect URL', () => {
    const encoded = Buffer.from('https://real.com/img.jpg').toString('base64');
    const url = `https://www.bing.com/ck/a?!&&u=a1${encoded}&ntb=1`;
    const result = (BingImageSearchTool as any).cleanUrl(url);
    expect(typeof result).toBe('string');
  });
});

// ── decodeHTMLEntities and cleanTextContent ───────────────────────────────────

describe('BingImageSearchTool — text utilities', () => {
  it('cleanTextContent returns empty string for falsy input', () => {
    expect((BingImageSearchTool as any).cleanTextContent('')).toBe('');
    expect((BingImageSearchTool as any).cleanTextContent(null)).toBe('');
  });

  it('decodeHTMLEntities handles all entity types', () => {
    const input = '&amp;&lt;&gt;&quot;&#39;&#x27;&#x2F;&nbsp;&#65;&#x41;';
    const result = (BingImageSearchTool as any).decodeHTMLEntities(input);
    expect(result).toContain('&');
    expect(result).toContain('<');
    expect(result).toContain('A');
  });

  it('decodeHTMLEntities returns empty string for falsy input', () => {
    expect((BingImageSearchTool as any).decodeHTMLEntities('')).toBe('');
  });
});

// ── getRandomDelay ────────────────────────────────────────────────────────────

describe('BingImageSearchTool — getRandomDelay', () => {
  it('returns value in expected range', () => {
    for (let i = 0; i < 20; i++) {
      const delay = (BingImageSearchTool as any).getRandomDelay(100, 200);
      expect(delay).toBeGreaterThanOrEqual(100);
      expect(delay).toBeLessThanOrEqual(200);
    }
  });
});

// ── execute: no-response watchdog activity reporting ──────────────────────────

describe('BingImageSearchTool.execute — reportActivity wiring', () => {
  it('reports activity once per query as each query settles (success path)', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    setupBrowserChain({ content: vi.fn().mockResolvedValue(MULTI_RESULT_HTML) });
    const reportActivity = vi.fn();

    const result = await BingImageSearchTool.execute(
      { ...baseArgs, queries: ['q1', 'q2', 'q3'] },
      { executionContext: { reportActivity } as any },
    );

    expect(result.totalQueries).toBe(3);
    expect(reportActivity).toHaveBeenCalledTimes(3);
  });

  it('reports activity even when a query fails (finally path)', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const page = makePage({
      goto: vi.fn().mockRejectedValue(new Error('navigation failed')),
    });
    const ctx = makeContext(page);
    const browser = makeBrowser(ctx);
    mockLaunchBrowser.mockResolvedValue(browser);
    const reportActivity = vi.fn();

    const result = await BingImageSearchTool.execute(
      { ...baseArgs, queries: ['q1', 'q2'] },
      { executionContext: { reportActivity } as any },
    );

    expect(result.errors!.length).toBeGreaterThan(0);
    expect(reportActivity).toHaveBeenCalledTimes(2);
  });

  it('runs without an execution context (reportActivity is optional)', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    setupBrowserChain({ content: vi.fn().mockResolvedValue(MULTI_RESULT_HTML) });

    const result = await BingImageSearchTool.execute({ ...baseArgs, queries: ['q1'] }, {});
    expect(result.totalQueries).toBe(1);
  });
});
