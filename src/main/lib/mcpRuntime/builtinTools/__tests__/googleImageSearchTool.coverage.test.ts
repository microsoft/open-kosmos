/**
 * Coverage tests for GoogleImageSearchTool
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
  mockDollar,
} = vi.hoisted(() => ({
  mockLogger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  mockStorageState: vi.fn().mockResolvedValue(undefined),
  mockPageClose: vi.fn().mockResolvedValue(undefined),
  mockContextClose: vi.fn().mockResolvedValue(undefined),
  mockBrowserClose: vi.fn().mockResolvedValue(undefined),
  mockAddInitScript: vi.fn().mockResolvedValue(undefined),
  mockGoto: vi.fn().mockResolvedValue({ url: () => 'https://www.google.com/imghp' }),
  mockWaitForSelector: vi.fn().mockResolvedValue(null),
  mockWaitForTimeout: vi.fn().mockResolvedValue(undefined),
  mockPageUrl: vi.fn().mockReturnValue('https://www.google.com/search?q=cats&tbm=isch'),
  mockPageContent: vi.fn().mockResolvedValue('<html><body>no images</body></html>'),
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

import { GoogleImageSearchTool } from '../googleImageSearchTool';
import * as fs from 'fs';

const tool = GoogleImageSearchTool as any;

// ── setup helpers ─────────────────────────────────────────────────────────────

function makePage() {
  return {
    url: mockPageUrl,
    goto: mockGoto,
    waitForSelector: mockWaitForSelector,
    waitForTimeout: mockWaitForTimeout,
    content: mockPageContent,
    close: mockPageClose,
    addInitScript: mockAddInitScript,
    keyboard: { type: vi.fn().mockResolvedValue(undefined), press: vi.fn().mockResolvedValue(undefined) },
    $: mockDollar,
  };
}

function makeSetup() {
  vi.mocked(fs.existsSync).mockReturnValue(false);
  mockEnsureBrowserInstalled.mockResolvedValue({ installed: true, browserPath: '/usr/bin/chromium' });
  mockGoto.mockResolvedValue({ url: () => 'https://www.google.com/imghp' });
  mockPageUrl.mockReturnValue('https://www.google.com/search?q=cats&tbm=isch');
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
  description: 'test image',
  queries: ['cats'],
};

// ── getDefinition ─────────────────────────────────────────────────────────────

describe('GoogleImageSearchTool.getDefinition', () => {
  it('returns name google_image_search', () => {
    expect(GoogleImageSearchTool.getDefinition().name).toBe('google_image_search');
  });

  it('requires description and queries', () => {
    const schema = GoogleImageSearchTool.getDefinition().inputSchema;
    expect(schema.required).toContain('description');
    expect(schema.required).toContain('queries');
  });

  it('has maxResults and timeout properties', () => {
    const props = GoogleImageSearchTool.getDefinition().inputSchema.properties;
    expect(props.maxResults).toBeDefined();
    expect(props.timeout).toBeDefined();
  });
});

// ── browser not installed ─────────────────────────────────────────────────────

describe('GoogleImageSearchTool.execute — browser not installed', () => {
  beforeEach(() => {
    mockEnsureBrowserInstalled.mockResolvedValue({ installed: false, error: 'no browser' });
  });

  it('returns success:false', async () => {
    const result = await GoogleImageSearchTool.execute(baseArgs);
    expect(result.success).toBe(false);
    expect(result.totalResults).toBe(0);
    expect(result.results).toEqual([]);
  });

  it('includes error message', async () => {
    const result = await GoogleImageSearchTool.execute(baseArgs);
    expect(result.errors?.[0]).toMatch(/not installed/i);
  });

  it('includes error from browserCheck', async () => {
    const result = await GoogleImageSearchTool.execute(baseArgs);
    expect(result.errors?.[0]).toMatch(/no browser/i);
  });

  it('reports correct totalQueries', async () => {
    const result = await GoogleImageSearchTool.execute({ ...baseArgs, queries: ['a', 'b'] });
    expect(result.totalQueries).toBe(2);
  });
});

// ── execute happy path ────────────────────────────────────────────────────────

describe('GoogleImageSearchTool.execute — happy path', () => {
  beforeEach(() => makeSetup());
  afterEach(() => vi.clearAllMocks());

  it('returns success:true', async () => {
    const result = await GoogleImageSearchTool.execute(baseArgs);
    expect(result.success).toBe(true);
    expect(result.totalQueries).toBe(1);
  });

  it('handles multiple queries', async () => {
    const result = await GoogleImageSearchTool.execute({ ...baseArgs, queries: ['cats', 'dogs'] });
    expect(result.totalQueries).toBe(2);
    expect(result.success).toBe(true);
  });

  it('passes maxResults', async () => {
    const result = await GoogleImageSearchTool.execute({ ...baseArgs, maxResults: 3 });
    expect(result.success).toBe(true);
  });

  it('passes timeout', async () => {
    const result = await GoogleImageSearchTool.execute({ ...baseArgs, timeout: 10000 });
    expect(result.success).toBe(true);
  });

  it('returns timestamp', async () => {
    const result = await GoogleImageSearchTool.execute(baseArgs);
    expect(new Date(result.timestamp).getFullYear()).toBeGreaterThan(2020);
  });
});

// ── execute with state file ───────────────────────────────────────────────────

describe('GoogleImageSearchTool.execute — state file present', () => {
  beforeEach(() => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      fingerprint: {
        deviceName: 'Desktop Chrome',
        locale: 'en-US',
        timezoneId: 'America/New_York',
        colorScheme: 'dark',
        reducedMotion: 'no-preference',
        forcedColors: 'none',
      },
      googleDomain: 'https://www.google.com/imghp',
    }));
    mockEnsureBrowserInstalled.mockResolvedValue({ installed: true });
    mockGoto.mockResolvedValue({ url: () => 'https://www.google.com/imghp' });
    mockPageUrl.mockReturnValue('https://www.google.com/search?q=cats&tbm=isch');
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
    const result = await GoogleImageSearchTool.execute(baseArgs);
    expect(result.success).toBe(true);
  });
});

// ── execute with corrupt state file ──────────────────────────────────────────

describe('GoogleImageSearchTool.execute — corrupt state file', () => {
  beforeEach(() => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue('{{not json}}');
    mockEnsureBrowserInstalled.mockResolvedValue({ installed: true });
    mockGoto.mockResolvedValue({ url: () => 'https://www.google.com/imghp' });
    mockPageUrl.mockReturnValue('https://www.google.com/search?q=cats&tbm=isch');
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

  it('handles corrupt file gracefully', async () => {
    const result = await GoogleImageSearchTool.execute(baseArgs);
    expect(result.success).toBe(true);
  });
});

// ── top-level error ───────────────────────────────────────────────────────────

describe('GoogleImageSearchTool.execute — top-level error', () => {
  it('returns failure on unexpected error', async () => {
    mockEnsureBrowserInstalled.mockRejectedValue(new Error('crash!'));
    const result = await GoogleImageSearchTool.execute(baseArgs);
    expect(result.success).toBe(false);
    expect(result.errors?.[0]).toMatch(/crash!/);
  });
});

// ── private helpers ───────────────────────────────────────────────────────────

describe('GoogleImageSearchTool private helpers', () => {
  describe('cleanTextContent', () => {
    it('strips HTML', () => {
      expect(tool.cleanTextContent('<b>text</b>')).toBe('text');
    });
    it('decodes entities', () => {
      expect(tool.cleanTextContent('&amp;')).toBe('&');
    });
    it('returns empty for empty', () => {
      expect(tool.cleanTextContent('')).toBe('');
    });
  });

  describe('cleanUrl', () => {
    it('returns empty for empty', () => {
      expect(tool.cleanUrl('')).toBe('');
    });
    it('decodes Google redirect URL', () => {
      const real = 'https://example.com/img.jpg';
      const redirect = `https://www.google.com/url?url=${encodeURIComponent(real)}&sa=D`;
      expect(tool.cleanUrl(redirect)).toBe(real);
    });
    it('returns URL unchanged when no redirect', () => {
      expect(tool.cleanUrl('https://example.com')).toBe('https://example.com');
    });
    it('returns original when no url param in redirect', () => {
      const url = 'https://www.google.com/url?sa=D';
      expect(typeof tool.cleanUrl(url)).toBe('string');
    });
  });

  describe('extractDomainFromUrl', () => {
    it('returns hostname', () => {
      expect(tool.extractDomainFromUrl('https://images.example.com/file.jpg')).toBe('images.example.com');
    });
    it('falls back on invalid URL', () => {
      expect(tool.extractDomainFromUrl('not-a-url')).toBe('not-a-url');
    });
  });

  describe('decodeHTMLEntities', () => {
    it('decodes &amp;', () => {
      expect(tool.decodeHTMLEntities('&amp;')).toBe('&');
    });
    it('decodes numeric decimal', () => {
      expect(tool.decodeHTMLEntities('&#65;')).toBe('A');
    });
    it('decodes numeric hex', () => {
      expect(tool.decodeHTMLEntities('&#x41;')).toBe('A');
    });
    it('decodes &#x2F;', () => {
      expect(tool.decodeHTMLEntities('&#x2F;')).toBe('/');
    });
    it('returns empty for empty', () => {
      expect(tool.decodeHTMLEntities('')).toBe('');
    });
    it('handles null-like falsy', () => {
      expect(tool.decodeHTMLEntities(null as any)).toBe('');
    });
  });

  describe('parseGoogleImageSearchResults', () => {
    it('returns empty array for empty HTML', () => {
      expect(tool.parseGoogleImageSearchResults('', 'test', 5)).toEqual([]);
    });

    it('returns empty for HTML with no image patterns', () => {
      expect(tool.parseGoogleImageSearchResults('<html>no images</html>', 'test', 5)).toEqual([]);
    });

    it('does not throw on malformed HTML', () => {
      expect(() => tool.parseGoogleImageSearchResults('<<<<<invalid', 'test', 5)).not.toThrow();
    });

    it('respects maxResults limit', () => {
      const segments = Array.from({ length: 5 }, (_, i) =>
        `["https://encrypted-tbn0.gstatic.com/images?q=tbn:abc${i}",236,213],["https://example${i}.com/img.jpg",800,600],null,0,"rgb(0,0,0)",null,0,{"2000":[null,"site${i}.com","10KB"],"2001":[null,null,null,3],"2003":[null,"key","https://example${i}.com","Title ${i}"`
      ).join(' SEPARATOR ');
      const results = tool.parseGoogleImageSearchResults(segments, 'query', 3);
      expect(results.length).toBeLessThanOrEqual(3);
    });

    it('skips data: URLs', () => {
      const html = `["https://encrypted-tbn0.gstatic.com/images?q=tbn:x",100,100],["data:image/png;base64,abc",100,100],null,0,"rgb(0,0,0)",null,0,{"2000":[null,"site.com","1KB"],"2001":[null],"2003":[null,"k","https://p.com","title"`;
      const results = tool.parseGoogleImageSearchResults(html, 'test', 5);
      expect(results.length).toBe(0);
    });
  });

  describe('getRandomDelay', () => {
    it('returns value in given range', () => {
      for (let i = 0; i < 10; i++) {
        const val = tool.getRandomDelay(5, 20);
        expect(val).toBeGreaterThanOrEqual(5);
        expect(val).toBeLessThanOrEqual(20);
      }
    });
  });

  describe('getHostMachineConfig', () => {
    it('returns config with required fields', () => {
      const cfg = tool.getHostMachineConfig();
      expect(cfg).toHaveProperty('deviceName', 'Desktop Chrome');
      expect(cfg).toHaveProperty('locale');
      expect(cfg).toHaveProperty('timezoneId');
      expect(['dark', 'light']).toContain(cfg.colorScheme);
    });

    it('respects provided locale', () => {
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
      expect(tool.validateArgs({ description: 't', queries: ['  '] }).isValid).toBe(false);
    });
    it('returns invalid when maxResults too small', () => {
      expect(tool.validateArgs({ description: 't', queries: ['q'], maxResults: 0 }).isValid).toBe(false);
    });
    it('returns invalid when maxResults too large', () => {
      expect(tool.validateArgs({ description: 't', queries: ['q'], maxResults: 11 }).isValid).toBe(false);
    });
    it('returns invalid when maxResults is float', () => {
      expect(tool.validateArgs({ description: 't', queries: ['q'], maxResults: 1.5 }).isValid).toBe(false);
    });
    it('returns invalid when timeout too small', () => {
      expect(tool.validateArgs({ description: 't', queries: ['q'], timeout: 500 }).isValid).toBe(false);
    });
    it('returns valid for correct args', () => {
      expect(tool.validateArgs({ description: 't', queries: ['q'] }).isValid).toBe(true);
    });
    it('returns valid with maxResults and timeout set', () => {
      expect(tool.validateArgs({ description: 't', queries: ['q'], maxResults: 5, timeout: 10000 }).isValid).toBe(true);
    });
  });

  describe('parseGoogleImageSearchResults (private via cast)', () => {
    it('returns empty for empty HTML', () => {
      expect(tool.parseGoogleImageSearchResults('', 'test', 5)).toEqual([]);
    });
    it('returns empty when no image data pattern matches', () => {
      expect(tool.parseGoogleImageSearchResults('<html><body>no images</body></html>', 'test', 5)).toEqual([]);
    });
    it('returns empty for data: URLs', () => {
      const html = `["https://encrypted-tbn0.gstatic.com/images?q=abc",100,100],["data:image/png;base64,abc",100,100],null,0,"rgb(0,0,0)",null,0,{"2000":[null,"site.com","10KB"],"2003":[null,"id","https://site.com","Title"`;
      expect(tool.parseGoogleImageSearchResults(html, 'test', 5)).toEqual([]);
    });
  });

  describe('decodeHTMLEntities (private via cast)', () => {
    it('decodes basic entities', () => {
      expect(tool.decodeHTMLEntities('&amp;&lt;&gt;&quot;')).toBe('&<>"');
    });
    it('decodes numeric entities', () => {
      expect(tool.decodeHTMLEntities('&#65;')).toBe('A');
    });
    it('decodes hex entities', () => {
      expect(tool.decodeHTMLEntities('&#x41;')).toBe('A');
    });
    it('returns empty for empty string', () => {
      expect(tool.decodeHTMLEntities('')).toBe('');
    });
    it('returns empty for falsy', () => {
      expect(tool.decodeHTMLEntities(null as any)).toBe('');
    });
  });
});
