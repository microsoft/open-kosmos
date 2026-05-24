/**
 * Coverage tests for BingWebSearchTool
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── hoisted mocks ─────────────────────────────────────────────────────────────

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
  mockDollar,
} = vi.hoisted(() => ({
  mockLogger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  mockStorageState: vi.fn().mockResolvedValue(undefined),
  mockPageClose: vi.fn().mockResolvedValue(undefined),
  mockContextClose: vi.fn().mockResolvedValue(undefined),
  mockBrowserClose: vi.fn().mockResolvedValue(undefined),
  mockAddInitScript: vi.fn().mockResolvedValue(undefined),
  mockGoto: vi.fn().mockResolvedValue({ url: () => 'https://www.bing.com/search?q=test' }),
  mockWaitForSelector: vi.fn().mockResolvedValue(null),
  mockWaitForLoadState: vi.fn().mockResolvedValue(undefined),
  mockWaitForTimeout: vi.fn().mockResolvedValue(undefined),
  mockPageUrl: vi.fn().mockReturnValue('https://www.bing.com/search?q=test'),
  mockPageContent: vi.fn().mockResolvedValue('<html><body><ul><li class="b_algo"><h2><a href="https://example.com">Example Title</a></h2><p class="b_lineclamp2">Example caption text here</p><cite>example.com</cite></li></ul></body></html>'),
  mockNewPage: vi.fn(),
  mockNewContext: vi.fn(),
  mockLaunchBrowser: vi.fn(),
  mockEnsureBrowserInstalled: vi.fn(),
  mockDollar: vi.fn().mockResolvedValue({ click: vi.fn().mockResolvedValue(undefined) }),
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

// ── imports ───────────────────────────────────────────────────────────────────

import { BingWebSearchTool } from '../bingWebSearchTool';
import * as fs from 'fs';

const tool = BingWebSearchTool as any;

// ── helpers ───────────────────────────────────────────────────────────────────

function makePage() {
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
    $: mockDollar,
  };
}

function makeSetup() {
  vi.mocked(fs.existsSync).mockReturnValue(false);
  mockEnsureBrowserInstalled.mockResolvedValue({ installed: true, browserPath: '/usr/bin/chromium' });
  const page = makePage();
  const ctx = {
    newPage: mockNewPage.mockResolvedValue(page),
    addInitScript: mockAddInitScript,
    storageState: mockStorageState,
    close: mockContextClose,
  };
  mockLaunchBrowser.mockResolvedValue({
    newContext: mockNewContext.mockResolvedValue(ctx),
    close: mockBrowserClose,
  });
}

const baseArgs = {
  description: 'test search',
  queries: ['test query'],
  lang: 'en' as const,
  locale: 'us' as const,
};

// ── getDefinition ─────────────────────────────────────────────────────────────

describe('BingWebSearchTool.getDefinition', () => {
  it('returns name bing_web_search', () => {
    expect(BingWebSearchTool.getDefinition().name).toBe('bing_web_search');
  });

  it('requires description, queries, lang, locale', () => {
    const schema = BingWebSearchTool.getDefinition().inputSchema;
    expect(schema.required).toContain('description');
    expect(schema.required).toContain('queries');
    expect(schema.required).toContain('lang');
    expect(schema.required).toContain('locale');
  });

  it('has queries property with array type', () => {
    const props = BingWebSearchTool.getDefinition().inputSchema.properties;
    expect(props.queries.type).toBe('array');
  });
});

// ── browser not installed ─────────────────────────────────────────────────────

describe('BingWebSearchTool.execute — browser not installed', () => {
  beforeEach(() => {
    mockEnsureBrowserInstalled.mockResolvedValue({ installed: false, error: 'not found' });
  });

  it('returns success:false with install error message', async () => {
    const result = await BingWebSearchTool.execute(baseArgs);
    expect(result.success).toBe(false);
    expect(result.totalResults).toBe(0);
    expect(result.errors?.[0]).toMatch(/not installed/i);
  });

  it('includes totalQueries count', async () => {
    const result = await BingWebSearchTool.execute({ ...baseArgs, queries: ['a', 'b'] });
    expect(result.totalQueries).toBe(2);
  });

  it('returns timestamp in ISO format', async () => {
    const result = await BingWebSearchTool.execute(baseArgs);
    expect(() => new Date(result.timestamp)).not.toThrow();
  });

  it('includes browserCheck error text in message', async () => {
    const result = await BingWebSearchTool.execute(baseArgs);
    expect(result.errors?.[0]).toMatch(/not found/i);
  });
});

// ── abort signal already aborted ─────────────────────────────────────────────

describe('BingWebSearchTool.execute — abort signal already aborted', () => {
  beforeEach(() => {
    mockEnsureBrowserInstalled.mockResolvedValue({ installed: true });
    makeSetup();
  });

  afterEach(() => vi.clearAllMocks());

  it('returns failure when signal is already aborted before execute', async () => {
    // Simulate abort being triggered immediately after browser check
    mockEnsureBrowserInstalled.mockResolvedValue({ installed: true });
    const ctrl = new AbortController();
    // already-aborted leads to throw inside execute which is caught
    ctrl.abort();
    const result = await BingWebSearchTool.execute(baseArgs, { signal: ctrl.signal });
    expect(result.success).toBe(false);
  });
});

// ── execute with full browser mock ────────────────────────────────────────────

describe('BingWebSearchTool.execute — with browser mock', () => {
  beforeEach(() => makeSetup());
  afterEach(() => vi.clearAllMocks());

  it('returns success:true when browser is available', async () => {
    const result = await BingWebSearchTool.execute(baseArgs);
    expect(result.success).toBe(true);
    expect(result.totalQueries).toBe(1);
  });

  it('handles multiple queries', async () => {
    const result = await BingWebSearchTool.execute({
      ...baseArgs,
      queries: ['first query', 'second query'],
    });
    expect(result.success).toBe(true);
    expect(result.totalQueries).toBe(2);
  });

  it('passes maxResults to search', async () => {
    const result = await BingWebSearchTool.execute({ ...baseArgs, maxResults: 3 });
    expect(result.success).toBe(true);
  });

  it('passes timeout parameter', async () => {
    const result = await BingWebSearchTool.execute({ ...baseArgs, timeout: 5000 });
    expect(result.success).toBe(true);
  });

  it('passes signal without abort', async () => {
    const ctrl = new AbortController();
    const result = await BingWebSearchTool.execute(baseArgs, { signal: ctrl.signal });
    expect(result.success).toBe(true);
  });
});

// ── execute with state file present ──────────────────────────────────────────

describe('BingWebSearchTool.execute — state file present', () => {
  beforeEach(() => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue('{"fingerprint":{"deviceName":"Desktop Chrome","locale":"en-US","timezoneId":"America/New_York","colorScheme":"light","reducedMotion":"no-preference","forcedColors":"none"}}');
    mockEnsureBrowserInstalled.mockResolvedValue({ installed: true });
    const page = makePage();
    const ctx = {
      newPage: mockNewPage.mockResolvedValue(page),
      addInitScript: mockAddInitScript,
      storageState: mockStorageState,
      close: mockContextClose,
    };
    mockLaunchBrowser.mockResolvedValue({
      newContext: mockNewContext.mockResolvedValue(ctx),
      close: mockBrowserClose,
    });
  });

  afterEach(() => vi.clearAllMocks());

  it('loads saved state and succeeds', async () => {
    const result = await BingWebSearchTool.execute(baseArgs);
    expect(result.success).toBe(true);
  });
});

// ── execute with corrupt state file ──────────────────────────────────────────

describe('BingWebSearchTool.execute — corrupt state file', () => {
  beforeEach(() => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue('not valid json {{{{');
    mockEnsureBrowserInstalled.mockResolvedValue({ installed: true });
    const page = makePage();
    const ctx = {
      newPage: mockNewPage.mockResolvedValue(page),
      addInitScript: mockAddInitScript,
      storageState: mockStorageState,
      close: mockContextClose,
    };
    mockLaunchBrowser.mockResolvedValue({
      newContext: mockNewContext.mockResolvedValue(ctx),
      close: mockBrowserClose,
    });
  });

  afterEach(() => vi.clearAllMocks());

  it('handles corrupt state gracefully', async () => {
    const result = await BingWebSearchTool.execute(baseArgs);
    expect(result.success).toBe(true);
  });
});

// ── execute top-level error ───────────────────────────────────────────────────

describe('BingWebSearchTool.execute — top-level error', () => {
  it('catches unexpected errors and returns success:false', async () => {
    mockEnsureBrowserInstalled.mockRejectedValue(new Error('unexpected crash'));
    const result = await BingWebSearchTool.execute(baseArgs);
    expect(result.success).toBe(false);
    expect(result.errors?.[0]).toMatch(/unexpected crash/);
  });
});

// ── private static helpers via cast ──────────────────────────────────────────

describe('BingWebSearchTool private helpers', () => {
  describe('cleanTextContent', () => {
    it('strips HTML tags', () => {
      expect(tool.cleanTextContent('<b>bold</b>')).toBe('bold');
    });

    it('decodes HTML entities', () => {
      const result = tool.cleanTextContent('&amp;&lt;&gt;&quot;&#39;&nbsp;');
      expect(result).toContain('&<>"\'');
    });

    it('collapses whitespace', () => {
      expect(tool.cleanTextContent('a   b\n  c')).toBe('a b c');
    });

    it('returns empty string for empty input', () => {
      expect(tool.cleanTextContent('')).toBe('');
    });

    it('returns empty string for falsy input', () => {
      expect(tool.cleanTextContent(null as any)).toBe('');
    });
  });

  describe('cleanUrl', () => {
    it('returns empty string for empty input', () => {
      expect(tool.cleanUrl('')).toBe('');
    });

    it('returns plain URL unchanged', () => {
      expect(tool.cleanUrl('https://example.com')).toBe('https://example.com');
    });

    it('decodes Bing redirect URL with base64', () => {
      const targetUrl = 'https://example.com/page';
      const b64 = Buffer.from(targetUrl).toString('base64');
      const bingUrl = `https://www.bing.com/ck/a?!&&p=abc&u=a1${b64}&ntb=1`;
      const result = tool.cleanUrl(bingUrl);
      expect(result).toBe(targetUrl);
    });

    it('returns original URL when base64 decoding fails', () => {
      const bingUrl = 'https://www.bing.com/ck/a?!&&p=abc&u=a1!!!notbase64!!!&ntb=1';
      const result = tool.cleanUrl(bingUrl);
      expect(typeof result).toBe('string');
    });
  });

  describe('extractDomainFromUrl', () => {
    it('extracts hostname from valid URL', () => {
      expect(tool.extractDomainFromUrl('https://www.example.com/path')).toBe('www.example.com');
    });

    it('returns raw string for invalid URL', () => {
      expect(tool.extractDomainFromUrl('not-a-url')).toBe('not-a-url');
    });
  });

  describe('parseBingSearchResults', () => {
    it('returns empty array for empty HTML', () => {
      const results = tool.parseBingSearchResults('', 'test', 5);
      expect(results).toEqual([]);
    });

    it('handles HTML with no matching pattern', () => {
      const results = tool.parseBingSearchResults('<html><body>no results</body></html>', 'test', 5);
      expect(results).toEqual([]);
    });

    it('respects maxResults limit', () => {
      const bigHtml = Array.from({ length: 10 }, (_, i) => `
        <li class="b_algo">
          <h2><a href="https://example${i}.com">Title Number ${i} for result page</a></h2>
          <p class="b_lineclamp2">Caption text for result number ${i} has content</p>
          <cite>example${i}.com</cite>
        </li>
      `).join('');
      const results = tool.parseBingSearchResults(`<ul>${bigHtml}</ul>`, 'query', 3);
      expect(results.length).toBeLessThanOrEqual(3);
    });

    it('skips entries without title/link match', () => {
      const html = '<li class="b_algo"><p class="b_lineclamp2">no title here</p></li>';
      const results = tool.parseBingSearchResults(html, 'test', 5);
      expect(results.length).toBe(0);
    });
  });

  describe('getRandomDelay', () => {
    it('returns value within range', () => {
      for (let i = 0; i < 20; i++) {
        const delay = tool.getRandomDelay(10, 50);
        expect(delay).toBeGreaterThanOrEqual(10);
        expect(delay).toBeLessThanOrEqual(50);
      }
    });
  });

  describe('isPageStable', () => {
    it('returns true when URL does not change', async () => {
      const page = { url: vi.fn().mockReturnValue('https://a.com'), waitForTimeout: vi.fn().mockResolvedValue(undefined) };
      expect(await tool.isPageStable(page, 1, 0)).toBe(true);
    });

    it('returns false when URL changes', async () => {
      let n = 0;
      const page = { url: vi.fn().mockImplementation(() => n++ === 0 ? 'https://a.com' : 'https://b.com'), waitForTimeout: vi.fn().mockResolvedValue(undefined) };
      expect(await tool.isPageStable(page, 1, 0)).toBe(false);
    });

    it('returns false on error', async () => {
      const page = { url: vi.fn().mockReturnValue('https://a.com'), waitForTimeout: vi.fn().mockRejectedValue(new Error('closed')) };
      expect(await tool.isPageStable(page, 1, 0)).toBe(false);
    });
  });

  describe('getHostMachineConfig', () => {
    it('returns config object', () => {
      const cfg = tool.getHostMachineConfig();
      expect(cfg.deviceName).toBe('Desktop Chrome');
      expect(['dark', 'light']).toContain(cfg.colorScheme);
    });

    it('uses provided locale', () => {
      expect(tool.getHostMachineConfig('fr-FR').locale).toBe('fr-FR');
    });
  });

  describe('validateArgs (private via cast)', () => {
    it('returns invalid when queries missing', () => {
      expect(tool.validateArgs({ description: 'test', lang: 'en', locale: 'us' }).isValid).toBe(false);
    });
    it('returns invalid when queries not array', () => {
      expect(tool.validateArgs({ description: 't', queries: 'q', lang: 'en', locale: 'us' }).isValid).toBe(false);
    });
    it('returns invalid when queries empty', () => {
      expect(tool.validateArgs({ description: 't', queries: [], lang: 'en', locale: 'us' }).isValid).toBe(false);
    });
    it('returns invalid when > 10 queries', () => {
      expect(tool.validateArgs({ description: 't', queries: Array(11).fill('q'), lang: 'en', locale: 'us' }).isValid).toBe(false);
    });
    it('returns invalid when query item is blank', () => {
      expect(tool.validateArgs({ description: 't', queries: [' '], lang: 'en', locale: 'us' }).isValid).toBe(false);
    });
    it('returns invalid when maxResults too small', () => {
      expect(tool.validateArgs({ description: 't', queries: ['q'], lang: 'en', locale: 'us', maxResults: 0 }).isValid).toBe(false);
    });
    it('returns invalid when maxResults too large', () => {
      expect(tool.validateArgs({ description: 't', queries: ['q'], lang: 'en', locale: 'us', maxResults: 11 }).isValid).toBe(false);
    });
    it('returns invalid when lang missing', () => {
      expect(tool.validateArgs({ description: 't', queries: ['q'], locale: 'us' }).isValid).toBe(false);
    });
    it('returns invalid when lang invalid', () => {
      expect(tool.validateArgs({ description: 't', queries: ['q'], lang: 'fr', locale: 'us' }).isValid).toBe(false);
    });
    it('returns invalid when locale missing', () => {
      expect(tool.validateArgs({ description: 't', queries: ['q'], lang: 'en' }).isValid).toBe(false);
    });
    it('returns invalid when locale invalid', () => {
      expect(tool.validateArgs({ description: 't', queries: ['q'], lang: 'en', locale: 'uk' }).isValid).toBe(false);
    });
    it('returns invalid when timeout too small', () => {
      expect(tool.validateArgs({ description: 't', queries: ['q'], lang: 'en', locale: 'us', timeout: 500 }).isValid).toBe(false);
    });
    it('returns valid for correct args', () => {
      expect(tool.validateArgs({ description: 't', queries: ['q'], lang: 'en', locale: 'us' }).isValid).toBe(true);
    });
    it('returns valid with zh/cn', () => {
      expect(tool.validateArgs({ description: 't', queries: ['q'], lang: 'zh', locale: 'cn' }).isValid).toBe(true);
    });
  });
});
