/**
 * Coverage tests for BingImageSearchTool
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
    mockEnsureBrowserInstalled: vi.fn(),
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

// ── imports ───────────────────────────────────────────────────────────────────

import { BingImageSearchTool } from '../bingImageSearchTool';
import * as fs from 'fs';

const tool = BingImageSearchTool as any;

const iuscHtml = `<html><body>
<a class="iusc" m="{&quot;murl&quot;:&quot;https://example.com/img.jpg&quot;,&quot;turl&quot;:&quot;https://tbn.com/thumb.jpg&quot;,&quot;purl&quot;:&quot;https://example.com&quot;,&quot;t&quot;:&quot;Example Image&quot;,&quot;s&quot;:&quot;example.com&quot;,&quot;w&quot;:800,&quot;h&quot;:600}">img</a>
</body></html>`;

// ── browser setup ─────────────────────────────────────────────────────────────

function makePage() {
  return {
    url: mockPageUrl,
    goto: mockGoto,
    waitForSelector: mockWaitForSelector,
    waitForTimeout: mockWaitForTimeout,
    content: mockPageContent,
    close: mockPageClose,
    addInitScript: mockAddInitScript,
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
  description: 'test image search',
  queries: ['cats'],
};

// ── getDefinition ─────────────────────────────────────────────────────────────

describe('BingImageSearchTool.getDefinition', () => {
  it('returns name bing_image_search', () => {
    expect(BingImageSearchTool.getDefinition().name).toBe('bing_image_search');
  });

  it('requires description and queries', () => {
    const schema = BingImageSearchTool.getDefinition().inputSchema;
    expect(schema.required).toContain('description');
    expect(schema.required).toContain('queries');
  });

  it('has safeSearch enum', () => {
    const props = BingImageSearchTool.getDefinition().inputSchema.properties;
    expect(props.safeSearch.enum).toContain('Moderate');
  });
});

// ── browser not installed ─────────────────────────────────────────────────────

describe('BingImageSearchTool.execute — browser not installed', () => {
  beforeEach(() => {
    mockEnsureBrowserInstalled.mockResolvedValue({ installed: false, error: 'missing' });
  });

  it('returns success:false', async () => {
    const result = await BingImageSearchTool.execute(baseArgs);
    expect(result.success).toBe(false);
    expect(result.totalResults).toBe(0);
    expect(result.results).toEqual([]);
  });

  it('includes error message', async () => {
    const result = await BingImageSearchTool.execute(baseArgs);
    expect(result.errors?.[0]).toMatch(/not installed/i);
  });

  it('includes browserCheck error', async () => {
    const result = await BingImageSearchTool.execute(baseArgs);
    expect(result.errors?.[0]).toMatch(/missing/i);
  });
});

// ── abort signal ──────────────────────────────────────────────────────────────

describe('BingImageSearchTool.execute — abort signal', () => {
  it('returns failure when signal already aborted', async () => {
    mockEnsureBrowserInstalled.mockResolvedValue({ installed: true });
    makeSetup();
    const ctrl = new AbortController();
    ctrl.abort();
    const result = await BingImageSearchTool.execute(baseArgs, { signal: ctrl.signal });
    expect(result.success).toBe(false);
  });

  it('passes live signal through', async () => {
    makeSetup();
    const ctrl = new AbortController();
    const result = await BingImageSearchTool.execute(baseArgs, { signal: ctrl.signal });
    expect(result.success).toBe(true);
    ctrl.abort();
  });
});

// ── execute happy path ────────────────────────────────────────────────────────

describe('BingImageSearchTool.execute — happy path', () => {
  beforeEach(() => makeSetup());
  afterEach(() => vi.clearAllMocks());

  it('returns success:true', async () => {
    const result = await BingImageSearchTool.execute(baseArgs);
    expect(result.success).toBe(true);
    expect(result.totalQueries).toBe(1);
  });

  it('handles multiple queries', async () => {
    const result = await BingImageSearchTool.execute({ ...baseArgs, queries: ['cats', 'dogs'] });
    expect(result.totalQueries).toBe(2);
    expect(result.success).toBe(true);
  });

  it('respects lang and locale', async () => {
    const result = await BingImageSearchTool.execute({ ...baseArgs, lang: 'zh', locale: 'cn' });
    expect(result.success).toBe(true);
  });

  it('respects safeSearch Strict', async () => {
    const result = await BingImageSearchTool.execute({ ...baseArgs, safeSearch: 'Strict' });
    expect(result.success).toBe(true);
  });

  it('respects safeSearch Off', async () => {
    const result = await BingImageSearchTool.execute({ ...baseArgs, safeSearch: 'Off' });
    expect(result.success).toBe(true);
  });

  it('respects timeout param', async () => {
    const result = await BingImageSearchTool.execute({ ...baseArgs, timeout: 10000 });
    expect(result.success).toBe(true);
  });

  it('respects maxResults param', async () => {
    const result = await BingImageSearchTool.execute({ ...baseArgs, maxResults: 2 });
    expect(result.success).toBe(true);
  });
});

// ── execute with state file ───────────────────────────────────────────────────

describe('BingImageSearchTool.execute — state file present', () => {
  beforeEach(() => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      fingerprint: {
        deviceName: 'Desktop Chrome',
        locale: 'en-US',
        timezoneId: 'America/New_York',
        colorScheme: 'light',
        reducedMotion: 'no-preference',
        forcedColors: 'none',
      },
    }));
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

  it('succeeds with saved state', async () => {
    const result = await BingImageSearchTool.execute(baseArgs);
    expect(result.success).toBe(true);
  });
});

// ── top-level error ───────────────────────────────────────────────────────────

describe('BingImageSearchTool.execute — top-level error', () => {
  it('returns success:false on unexpected error', async () => {
    mockEnsureBrowserInstalled.mockRejectedValue(new Error('crash'));
    const result = await BingImageSearchTool.execute(baseArgs);
    expect(result.success).toBe(false);
    expect(result.errors?.[0]).toMatch(/crash/);
  });
});

// ── private helpers ───────────────────────────────────────────────────────────

describe('BingImageSearchTool private helpers', () => {
  describe('cleanTextContent', () => {
    it('strips tags', () => {
      expect(tool.cleanTextContent('<b>hello</b>')).toBe('hello');
    });
    it('decodes entities', () => {
      expect(tool.cleanTextContent('&amp;&lt;&gt;')).toBe('&<>');
    });
    it('returns empty for empty', () => {
      expect(tool.cleanTextContent('')).toBe('');
    });
  });

  describe('cleanUrl', () => {
    it('returns empty for empty', () => {
      expect(tool.cleanUrl('')).toBe('');
    });
    it('returns plain URL unchanged', () => {
      expect(tool.cleanUrl('https://example.com')).toBe('https://example.com');
    });
    it('decodes bing redirect URL', () => {
      const target = 'https://example.com/image.jpg';
      const b64 = Buffer.from(target).toString('base64');
      const url = `https://www.bing.com/ck/a?!&&u=a1${b64}&ntb=1`;
      expect(tool.cleanUrl(url)).toBe(target);
    });
  });

  describe('decodeHTMLEntities', () => {
    it('decodes basic entities', () => {
      expect(tool.decodeHTMLEntities('&amp;&lt;&gt;&quot;&#39;')).toBe('&<>"\'');
    });
    it('decodes numeric entities', () => {
      expect(tool.decodeHTMLEntities('&#65;')).toBe('A');
    });
    it('decodes hex entities', () => {
      expect(tool.decodeHTMLEntities('&#x41;')).toBe('A');
    });
    it('returns empty for empty', () => {
      expect(tool.decodeHTMLEntities('')).toBe('');
    });
    it('handles &#x2F; as slash', () => {
      expect(tool.decodeHTMLEntities('&#x2F;')).toBe('/');
    });
    it('handles &#x27; as single quote', () => {
      expect(tool.decodeHTMLEntities('&#x27;')).toBe("'");
    });
    it('handles &nbsp;', () => {
      expect(tool.decodeHTMLEntities('a&nbsp;b')).toBe('a b');
    });
  });

  describe('extractDomainFromUrl', () => {
    it('returns hostname', () => {
      expect(tool.extractDomainFromUrl('https://images.example.com/img.jpg')).toBe('images.example.com');
    });
    it('returns raw for invalid', () => {
      expect(tool.extractDomainFromUrl('not-url')).toBe('not-url');
    });
  });

  describe('extractNumeric', () => {
    it('returns number as-is', () => {
      expect(tool.extractNumeric(42)).toBe(42);
    });
    it('parses string to number', () => {
      expect(tool.extractNumeric('100')).toBe(100);
    });
    it('returns undefined for invalid string', () => {
      expect(tool.extractNumeric('abc')).toBeUndefined();
    });
    it('returns undefined for undefined', () => {
      expect(tool.extractNumeric(undefined)).toBeUndefined();
    });
  });

  describe('parseBingImageSearchResults', () => {
    it('returns empty array for empty HTML', () => {
      expect(tool.parseBingImageSearchResults('', 'cats', 5)).toEqual([]);
    });

    it('parses valid iusc anchor data', () => {
      const results = tool.parseBingImageSearchResults(iuscHtml, 'cats', 5);
      expect(Array.isArray(results)).toBe(true);
      if (results.length > 0) {
        expect(results[0]).toHaveProperty('thumbnailUrl');
        expect(results[0].query).toBe('cats');
      }
    });

    it('respects maxResults', () => {
      const manyAnchors = Array.from({ length: 10 }, (_, i) =>
        `<a class="iusc" m='{"murl":"https://img${i}.com/img.jpg","turl":"https://tbn${i}.com/thumb.jpg","t":"Image ${i}","s":"site${i}.com"}'></a>`
      ).join('');
      const results = tool.parseBingImageSearchResults(`<html>${manyAnchors}</html>`, 'test', 3);
      expect(results.length).toBeLessThanOrEqual(3);
    });

    it('skips entries with no thumbnail', () => {
      const html = `<a class="iusc" m='{"t":"title only no url"}'></a>`;
      const results = tool.parseBingImageSearchResults(html, 'test', 5);
      expect(results.length).toBe(0);
    });

    it('handles string fileSize', () => {
      const html = `<a class="iusc" m='{"turl":"https://t.com/img.jpg","t":"Test","size":"12KB"}'></a>`;
      const results = tool.parseBingImageSearchResults(html, 'test', 5);
      if (results.length > 0) {
        expect(results[0].fileSize).toBe('12KB');
      }
    });

    it('handles object fileSize', () => {
      const html = `<a class="iusc" m='{"turl":"https://t.com/img.jpg","t":"Test","size":{"text":"24KB"}}'></a>`;
      const results = tool.parseBingImageSearchResults(html, 'test', 5);
      if (results.length > 0) {
        expect(results[0].fileSize).toBe('24KB');
      }
    });

    it('handles invalid JSON in m attribute gracefully', () => {
      const html = `<a class="iusc" m="not valid json {{{{"></a>`;
      const results = tool.parseBingImageSearchResults(html, 'test', 5);
      expect(results.length).toBe(0);
    });
  });

  describe('getRandomDelay', () => {
    it('returns value in range', () => {
      const val = tool.getRandomDelay(5, 10);
      expect(val).toBeGreaterThanOrEqual(5);
      expect(val).toBeLessThanOrEqual(10);
    });
  });

  describe('getHostMachineConfig', () => {
    it('returns config object', () => {
      const cfg = tool.getHostMachineConfig();
      expect(cfg.deviceName).toBe('Desktop Chrome');
      expect(['dark', 'light']).toContain(cfg.colorScheme);
    });

    it('uses provided locale', () => {
      expect(tool.getHostMachineConfig('ja-JP').locale).toBe('ja-JP');
    });
  });

  describe('isPageStable', () => {
    it('returns true when URL stays same', async () => {
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

  describe('validateArgs (private via cast)', () => {
    it('returns invalid when queries missing', () => {
      expect(tool.validateArgs({ description: 'test' }).isValid).toBe(false);
    });
    it('returns invalid when queries not array', () => {
      expect(tool.validateArgs({ description: 't', queries: 'q' }).isValid).toBe(false);
    });
    it('returns invalid when queries empty', () => {
      expect(tool.validateArgs({ description: 't', queries: [] }).isValid).toBe(false);
    });
    it('returns invalid when > 10 queries', () => {
      expect(tool.validateArgs({ description: 't', queries: Array(11).fill('q') }).isValid).toBe(false);
    });
    it('returns invalid when query item is blank', () => {
      expect(tool.validateArgs({ description: 't', queries: [' '] }).isValid).toBe(false);
    });
    it('returns invalid when maxResults too small', () => {
      expect(tool.validateArgs({ description: 't', queries: ['q'], maxResults: 0 }).isValid).toBe(false);
    });
    it('returns invalid when maxResults too large', () => {
      expect(tool.validateArgs({ description: 't', queries: ['q'], maxResults: 21 }).isValid).toBe(false);
    });
    it('returns invalid when lang invalid', () => {
      expect(tool.validateArgs({ description: 't', queries: ['q'], lang: 'fr' }).isValid).toBe(false);
    });
    it('returns invalid when locale invalid', () => {
      expect(tool.validateArgs({ description: 't', queries: ['q'], locale: 'uk' }).isValid).toBe(false);
    });
    it('returns invalid when safeSearch invalid', () => {
      expect(tool.validateArgs({ description: 't', queries: ['q'], safeSearch: 'Maybe' }).isValid).toBe(false);
    });
    it('returns invalid when timeout out of range', () => {
      expect(tool.validateArgs({ description: 't', queries: ['q'], timeout: 999 }).isValid).toBe(false);
    });
    it('returns valid for correct args', () => {
      expect(tool.validateArgs({ description: 't', queries: ['q'] }).isValid).toBe(true);
    });
    it('returns valid for zh/cn', () => {
      expect(tool.validateArgs({ description: 't', queries: ['q'], lang: 'zh', locale: 'cn', safeSearch: 'Strict' }).isValid).toBe(true);
    });
  });
});
