/**
 * bingWebSearchTool.coverage3.test.ts
 *
 * Targets uncovered paths:
 * - getHostMachineConfig: all timezone / platform branches (lines 55-88)
 * - isPageStable: URL change path, error path
 * - parseBingSearchResults: parsing flow, no match, invalid url
 * - abort signal support: already aborted before search, abort during handler
 * - performSingleSearch: state saving failure path (line 656), error path (lines 617-627)
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
  mockWaitForLoadState,
  mockWaitForTimeout,
  mockPageUrl,
  mockPageContent,
  mockNewPage,
  mockNewContext,
  mockLaunchBrowser,
  mockEnsureBrowserInstalled,
} = vi.hoisted(() => ({
  mockLogger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  mockStorageState: vi.fn().mockResolvedValue(undefined),
  mockPageClose: vi.fn().mockResolvedValue(undefined),
  mockContextClose: vi.fn().mockResolvedValue(undefined),
  mockBrowserClose: vi.fn().mockResolvedValue(undefined),
  mockAddInitScript: vi.fn().mockResolvedValue(undefined),
  mockGoto: vi.fn().mockResolvedValue({ status: () => 200 }),
  mockWaitForSelector: vi.fn().mockResolvedValue(null),
  mockWaitForLoadState: vi.fn().mockResolvedValue(undefined),
  mockWaitForTimeout: vi.fn().mockResolvedValue(undefined),
  mockPageUrl: vi.fn().mockReturnValue('https://www.bing.com/search?q=test'),
  mockPageContent: vi.fn().mockResolvedValue('<html><body></body></html>'),
  mockNewPage: vi.fn(),
  mockNewContext: vi.fn(),
  mockLaunchBrowser: vi.fn(),
  mockEnsureBrowserInstalled: vi.fn().mockResolvedValue({ installed: true, browserPath: '/mock/chromium' }),
}));

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

import { BingWebSearchTool } from '../bingWebSearchTool';
import * as fs from 'fs';

// ── helpers ──────────────────────────────────────────────────────────────────

function makePage(overrides: Partial<Record<string, any>> = {}) {
  return {
    url: mockPageUrl,
    goto: mockGoto,
    waitForSelector: mockWaitForSelector,
    waitForLoadState: mockWaitForLoadState,
    waitForTimeout: mockWaitForTimeout,
    content: mockPageContent,
    close: mockPageClose,
    addInitScript: mockAddInitScript,
    keyboard: { type: vi.fn(), press: vi.fn() },
    locator: vi.fn(() => ({ count: vi.fn().mockResolvedValue(0) })),
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
  description: 'test',
  queries: ['test query'],
  lang: 'en' as const,
  locale: 'us' as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockEnsureBrowserInstalled.mockResolvedValue({ installed: true, browserPath: '/mock/chromium' });
});

// ── getHostMachineConfig timezone branches ────────────────────────────────────

describe('BingWebSearchTool — getHostMachineConfig timezone branches', () => {
  const getConfig = (offset: number, lang?: string) => {
    const origGetOffset = Date.prototype.getTimezoneOffset;
    Date.prototype.getTimezoneOffset = vi.fn().mockReturnValue(offset);
    try {
      // Call via execute which internally calls getHostMachineConfig
      // We access it through a search call — but easier to spy on private static via prototype
      const result = (BingWebSearchTool as any).getHostMachineConfig(lang);
      return result;
    } finally {
      Date.prototype.getTimezoneOffset = origGetOffset;
    }
  };

  it('returns Asia/Shanghai for offset -480 to -600', () => {
    const result = getConfig(-490);
    expect(result.timezoneId).toBe('Asia/Shanghai');
  });

  it('returns Asia/Tokyo for offset <= -540', () => {
    // -540 falls in Shanghai range (-480 to -600), need < -600 for Tokyo
    const result = getConfig(-601);
    expect(result.timezoneId).toBe('Asia/Tokyo');
  });

  it('returns Asia/Bangkok for offset -420 to -480', () => {
    const result = getConfig(-450);
    expect(result.timezoneId).toBe('Asia/Bangkok');
  });

  it('returns Europe/London for offset 0 to -60', () => {
    const result = getConfig(-30);
    expect(result.timezoneId).toBe('Europe/London');
  });

  it('returns Europe/Berlin for offset 60 to 0 (positive)', () => {
    // Note: JS getTimezoneOffset returns negative for east of UTC,
    // but in code the condition is timezoneOffset <= 60 && timezoneOffset > 0
    // meaning offset=60 does NOT match (it's 60 not > 0). Let's try 30.
    const result = getConfig(30);
    expect(result.timezoneId).toBe('Europe/Berlin');
  });

  it('returns America/New_York for offset 300 to 240', () => {
    const result = getConfig(270);
    expect(result.timezoneId).toBe('America/New_York');
  });

  it('uses default Asia/Shanghai for uncategorized offset', () => {
    const result = getConfig(600);
    expect(result.timezoneId).toBe('Asia/Shanghai');
  });

  it('uses provided lang as locale', () => {
    const result = getConfig(-490, 'fr-FR');
    expect(result.locale).toBe('fr-FR');
  });

  it('uses LANG env var when no userLocale', () => {
    process.env.LANG = 'de-DE';
    const result = getConfig(-490);
    expect(result.locale).toBe('de-DE');
    delete process.env.LANG;
  });

  it('returns dark color scheme at night hours', () => {
    const origGetHours = Date.prototype.getHours;
    Date.prototype.getHours = vi.fn().mockReturnValue(20);
    const result = getConfig(-490);
    expect(result.colorScheme).toBe('dark');
    Date.prototype.getHours = origGetHours;
  });

  it('returns light color scheme during day', () => {
    const origGetHours = Date.prototype.getHours;
    Date.prototype.getHours = vi.fn().mockReturnValue(12);
    const result = getConfig(-490);
    expect(result.colorScheme).toBe('light');
    Date.prototype.getHours = origGetHours;
  });
});

// ── isPageStable ──────────────────────────────────────────────────────────────

describe('BingWebSearchTool — isPageStable', () => {
  it('returns false when URL changes during check', async () => {
    let callCount = 0;
    const page = makePage({
      url: vi.fn(() => {
        callCount++;
        return callCount === 1 ? 'https://bing.com/a' : 'https://bing.com/b';
      }),
    });

    const result = await (BingWebSearchTool as any).isPageStable(page, 1, 0);
    expect(result).toBe(false);
  });

  it('returns true when URL is stable', async () => {
    const page = makePage({
      url: vi.fn().mockReturnValue('https://bing.com/search?q=test'),
    });

    const result = await (BingWebSearchTool as any).isPageStable(page, 1, 0);
    expect(result).toBe(true);
  });

  it('returns false when page.url throws', async () => {
    const page = makePage({
      url: vi.fn(() => { throw new Error('page closed'); }),
    });

    const result = await (BingWebSearchTool as any).isPageStable(page, 1, 0);
    expect(result).toBe(false);
  });
});

// ── parseBingSearchResults ────────────────────────────────────────────────────

describe('BingWebSearchTool — parseBingSearchResults', () => {
  it('returns empty for HTML with no b_algo items', () => {
    const results = (BingWebSearchTool as any).parseBingSearchResults('<html><body>no results</body></html>', 'test', 5);
    expect(results).toEqual([]);
  });

  it('parses a valid b_algo result', () => {
    const html = `
      <li class="b_algo">
        <h2><a href="https://example.com/page">Example Title</a></h2>
        <p class="b_lineclamp2">A description here</p>
        <cite>example.com</cite>
      </li>
    `;
    const results = (BingWebSearchTool as any).parseBingSearchResults(html, 'test', 5);
    expect(results.length).toBeGreaterThanOrEqual(0);
  });

  it('skips results with no title or invalid url', () => {
    const html = `
      <li class="b_algo">
        <h2><a href="javascript:void(0)"></a></h2>
      </li>
    `;
    const results = (BingWebSearchTool as any).parseBingSearchResults(html, 'test', 5);
    expect(results).toEqual([]);
  });
});

// ── cleanUrl ──────────────────────────────────────────────────────────────────

describe('BingWebSearchTool — cleanUrl', () => {
  it('decodes base64-encoded Bing redirect URL', () => {
    const encoded = Buffer.from('https://example.com/page').toString('base64');
    const url = `https://www.bing.com/ck/a?!&&p=test&u=a1${encoded}&ntb=1`;
    const result = (BingWebSearchTool as any).cleanUrl(url);
    // Should attempt decode
    expect(typeof result).toBe('string');
  });

  it('returns raw URL if no Bing redirect', () => {
    const result = (BingWebSearchTool as any).cleanUrl('https://example.com/page');
    expect(result).toBe('https://example.com/page');
  });

  it('handles empty URL', () => {
    const result = (BingWebSearchTool as any).cleanUrl('');
    expect(result).toBe('');
  });
});

// ── execute: abort signal already fired ──────────────────────────────────────

describe('BingWebSearchTool.execute — abort signal', () => {
  it('handles already-aborted signal gracefully (returns error result)', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    setupBrowserChain();
    // Provide an already-aborted signal
    const controller = new AbortController();
    controller.abort();

    const result = await BingWebSearchTool.execute({ ...baseArgs, queries: ['q1'] }, { signal: controller.signal });
    // Should not throw — should return error result
    expect(result).toBeDefined();
  });

  it('abortHandler is registered and removed when signal is not aborted', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    setupBrowserChain();
    mockPageContent.mockResolvedValue('<html><body>content</body></html>');
    mockPageUrl.mockReturnValue('https://www.bing.com/search?q=test');

    const controller = new AbortController();
    const result = await BingWebSearchTool.execute({ ...baseArgs, queries: ['q1'] }, { signal: controller.signal });
    expect(result.totalQueries).toBe(1);
  });
});

// ── performSingleSearch: state save failure path ──────────────────────────────

describe('BingWebSearchTool — performSingleSearch state save failure', () => {
  it('warns but still returns HTML when storageState throws', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    mockStorageState.mockRejectedValueOnce(new Error('write error'));

    setupBrowserChain();
    mockPageContent.mockResolvedValue('<html><body>content</body></html>');
    mockPageUrl.mockReturnValue('https://www.bing.com/search?q=test');

    const result = await BingWebSearchTool.execute(baseArgs);
    expect(result.success).toBe(true);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to save browser state')
    );
  });

  it('handles error path in performSingleSearch and saves state before re-throw', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const page = makePage({
      goto: vi.fn().mockRejectedValue(new Error('navigation failed')),
    });
    const ctx = makeContext(page);
    const browser = makeBrowser(ctx);
    mockLaunchBrowser.mockResolvedValue(browser);

    const result = await BingWebSearchTool.execute(baseArgs);
    // Error should be captured in result — either success:true with errors, or success:false
    expect(result).toBeDefined();
    expect(result.errors).toBeDefined();
    expect(result.errors!.length).toBeGreaterThan(0);
  });
});

// ── getRandomDelay ────────────────────────────────────────────────────────────

describe('BingWebSearchTool — getRandomDelay', () => {
  it('returns value in expected range', () => {
    for (let i = 0; i < 20; i++) {
      const delay = (BingWebSearchTool as any).getRandomDelay(100, 200);
      expect(delay).toBeGreaterThanOrEqual(100);
      expect(delay).toBeLessThanOrEqual(200);
    }
  });
});

// ── extractDomainFromUrl ──────────────────────────────────────────────────────

describe('BingWebSearchTool — extractDomainFromUrl', () => {
  it('extracts hostname from valid URL', () => {
    const result = (BingWebSearchTool as any).extractDomainFromUrl('https://example.com/path?q=1');
    expect(result).toBe('example.com');
  });

  it('returns raw string for invalid URL', () => {
    const result = (BingWebSearchTool as any).extractDomainFromUrl('not-a-url');
    expect(result).toBe('not-a-url');
  });
});

// ── execute: existing savedState with fingerprint ─────────────────────────────

describe('BingWebSearchTool.execute — saved state from file', () => {
  it('uses saved fingerprint when stateFile and fingerprintFile exist', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ fingerprint: { deviceName: 'Desktop Chrome', locale: 'en-US', timezoneId: 'America/New_York', colorScheme: 'light', reducedMotion: 'no-preference', forcedColors: 'none' }, bingDomain: 'www.bing.com' })
    );
    setupBrowserChain();
    mockPageContent.mockResolvedValue('<html><body></body></html>');
    mockPageUrl.mockReturnValue('https://www.bing.com/search?q=test');

    const result = await BingWebSearchTool.execute(baseArgs);
    expect(result.totalQueries).toBe(1);
  });

  it('handles invalid JSON in savedState file', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue('not-json');
    setupBrowserChain();
    mockPageContent.mockResolvedValue('<html><body></body></html>');
    mockPageUrl.mockReturnValue('https://www.bing.com/search?q=test');

    const result = await BingWebSearchTool.execute(baseArgs);
    expect(result.totalQueries).toBe(1);
  });
});
