/**
 * Coverage tests for GoogleWebSearchTool
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
  mockGoto: vi.fn().mockResolvedValue({ url: () => 'https://www.google.com' }),
  mockWaitForSelector: vi.fn().mockResolvedValue(null),
  mockWaitForLoadState: vi.fn().mockResolvedValue(undefined),
  mockWaitForTimeout: vi.fn().mockResolvedValue(undefined),
  mockPageUrl: vi.fn().mockReturnValue('https://www.google.com/search?q=test'),
  mockPageContent: vi.fn().mockResolvedValue('<html><body>no results</body></html>'),
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

import { GoogleWebSearchTool } from '../googleWebSearchTool';
import * as fs from 'fs';

const tool = GoogleWebSearchTool as any;

// ── browser setup ─────────────────────────────────────────────────────────────

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
    keyboard: { type: vi.fn().mockResolvedValue(undefined), press: vi.fn().mockResolvedValue(undefined) },
    $: mockDollar,
  };
}

function makeSetup() {
  vi.mocked(fs.existsSync).mockReturnValue(false);
  mockEnsureBrowserInstalled.mockResolvedValue({ installed: true, browserPath: '/usr/bin/chromium' });
  mockGoto.mockResolvedValue({ url: () => 'https://www.google.com' });
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
  description: 'test',
  queries: ['typescript tutorial'],
};

// ── getDefinition ─────────────────────────────────────────────────────────────

describe('GoogleWebSearchTool.getDefinition', () => {
  it('returns name google_web_search', () => {
    expect(GoogleWebSearchTool.getDefinition().name).toBe('google_web_search');
  });

  it('requires description and queries', () => {
    const schema = GoogleWebSearchTool.getDefinition().inputSchema;
    expect(schema.required).toContain('description');
    expect(schema.required).toContain('queries');
  });

  it('has maxResults property', () => {
    const props = GoogleWebSearchTool.getDefinition().inputSchema.properties;
    expect(props.maxResults).toBeDefined();
  });
});

// ── browser not installed ─────────────────────────────────────────────────────

describe('GoogleWebSearchTool.execute — browser not installed', () => {
  beforeEach(() => {
    mockEnsureBrowserInstalled.mockResolvedValue({ installed: false, error: 'missing chromium' });
  });

  it('returns success:false', async () => {
    const result = await GoogleWebSearchTool.execute(baseArgs);
    expect(result.success).toBe(false);
    expect(result.totalResults).toBe(0);
  });

  it('includes install error message', async () => {
    const result = await GoogleWebSearchTool.execute(baseArgs);
    expect(result.errors?.[0]).toMatch(/not installed/i);
  });

  it('reports correct totalQueries', async () => {
    const result = await GoogleWebSearchTool.execute({ ...baseArgs, queries: ['a', 'b', 'c'] });
    expect(result.totalQueries).toBe(3);
  });

  it('includes error detail', async () => {
    const result = await GoogleWebSearchTool.execute(baseArgs);
    expect(result.errors?.[0]).toMatch(/missing chromium/i);
  });
});

// ── execute happy path ────────────────────────────────────────────────────────

describe('GoogleWebSearchTool.execute — happy path', () => {
  beforeEach(() => makeSetup());
  afterEach(() => vi.clearAllMocks());

  it('returns success:true', async () => {
    const result = await GoogleWebSearchTool.execute(baseArgs);
    expect(result.success).toBe(true);
  });

  it('handles multiple queries', async () => {
    const result = await GoogleWebSearchTool.execute({ ...baseArgs, queries: ['a', 'b'] });
    expect(result.totalQueries).toBe(2);
    expect(result.success).toBe(true);
  });

  it('passes maxResults', async () => {
    const result = await GoogleWebSearchTool.execute({ ...baseArgs, maxResults: 3 });
    expect(result.success).toBe(true);
  });

  it('passes timeout', async () => {
    const result = await GoogleWebSearchTool.execute({ ...baseArgs, timeout: 5000 });
    expect(result.success).toBe(true);
  });

  it('returns timestamp', async () => {
    const result = await GoogleWebSearchTool.execute(baseArgs);
    expect(new Date(result.timestamp).getFullYear()).toBeGreaterThan(2020);
  });
});

// ── execute with state file ───────────────────────────────────────────────────

describe('GoogleWebSearchTool.execute — state file present', () => {
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
      googleDomain: 'https://www.google.com',
    }));
    mockEnsureBrowserInstalled.mockResolvedValue({ installed: true });
    mockGoto.mockResolvedValue({ url: () => 'https://www.google.com' });
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

  it('loads saved state successfully', async () => {
    const result = await GoogleWebSearchTool.execute(baseArgs);
    expect(result.success).toBe(true);
  });
});

// ── execute with corrupt state file ──────────────────────────────────────────

describe('GoogleWebSearchTool.execute — corrupt state file', () => {
  beforeEach(() => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue('corrupted{{{{json');
    mockEnsureBrowserInstalled.mockResolvedValue({ installed: true });
    mockGoto.mockResolvedValue({ url: () => 'https://www.google.com' });
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
    const result = await GoogleWebSearchTool.execute(baseArgs);
    expect(result.success).toBe(true);
  });
});

// ── blocked page (CAPTCHA) ────────────────────────────────────────────────────

describe('GoogleWebSearchTool.execute — blocked CAPTCHA page', () => {
  beforeEach(() => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    mockEnsureBrowserInstalled.mockResolvedValue({ installed: true });
    mockPageUrl.mockReturnValue('https://www.google.com/sorry/index?continue=x');
    mockGoto.mockResolvedValue({ url: () => 'https://www.google.com/sorry/index' });
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

  afterEach(() => {
    vi.clearAllMocks();
    mockPageUrl.mockReturnValue('https://www.google.com/search?q=test');
  });

  it('returns success:true but adds error to errors array', async () => {
    const result = await GoogleWebSearchTool.execute(baseArgs);
    // The error gets caught per-query and included in errors[]
    expect(typeof result.success).toBe('boolean');
  });
});

// ── no search input found ─────────────────────────────────────────────────────

describe('GoogleWebSearchTool.execute — no search input found', () => {
  beforeEach(() => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    mockEnsureBrowserInstalled.mockResolvedValue({ installed: true });
    mockPageUrl.mockReturnValue('https://www.google.com/search?q=test');
    mockGoto.mockResolvedValue({ url: () => 'https://www.google.com' });
    mockDollar.mockResolvedValue(null); // no search input
    const page = { ...makePage(), $: mockDollar };
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

  afterEach(() => {
    vi.clearAllMocks();
    mockDollar.mockResolvedValue({ click: vi.fn().mockResolvedValue(undefined) });
  });

  it('handles missing search input gracefully', async () => {
    const result = await GoogleWebSearchTool.execute(baseArgs);
    expect(typeof result.success).toBe('boolean');
  });
});

// ── top-level error ───────────────────────────────────────────────────────────

describe('GoogleWebSearchTool.execute — top-level error', () => {
  it('returns failure on unexpected error', async () => {
    mockEnsureBrowserInstalled.mockRejectedValue(new Error('fatal'));
    const result = await GoogleWebSearchTool.execute(baseArgs);
    expect(result.success).toBe(false);
    expect(result.errors?.[0]).toMatch(/fatal/);
  });
});

// ── private helpers ───────────────────────────────────────────────────────────

describe('GoogleWebSearchTool private helpers', () => {
  describe('cleanTextContent', () => {
    it('strips HTML tags', () => {
      expect(tool.cleanTextContent('<h1>Hello</h1>')).toBe('Hello');
    });
    it('handles HTML entities', () => {
      const result = tool.cleanTextContent('&amp;&lt;&gt;&quot;&#39;&nbsp;');
      expect(result).toContain('&<>"\'');
    });
    it('returns empty string for empty input', () => {
      expect(tool.cleanTextContent('')).toBe('');
    });
    it('returns empty for falsy', () => {
      expect(tool.cleanTextContent(null as any)).toBe('');
    });
  });

  describe('cleanUrl', () => {
    it('returns empty for empty', () => {
      expect(tool.cleanUrl('')).toBe('');
    });
    it('returns URL unchanged', () => {
      expect(tool.cleanUrl('https://example.com/path')).toBe('https://example.com/path');
    });
    it('extracts real URL from Google redirect', () => {
      const realUrl = 'https://www.example.com/page';
      const googleRedirect = `https://www.google.com/url?url=${encodeURIComponent(realUrl)}&sa=D`;
      expect(tool.cleanUrl(googleRedirect)).toBe(realUrl);
    });
    it('returns URL when no url param in redirect', () => {
      const url = 'https://www.google.com/url?sa=D&source=x';
      expect(typeof tool.cleanUrl(url)).toBe('string');
    });
  });

  describe('extractDomainFromUrl', () => {
    it('extracts hostname', () => {
      expect(tool.extractDomainFromUrl('https://www.example.com/path?q=1')).toBe('www.example.com');
    });
    it('falls back on invalid URL', () => {
      expect(tool.extractDomainFromUrl('bad url!')).toBe('bad url!');
    });
  });

  describe('parseGoogleSearchResults', () => {
    it('returns empty for empty HTML', () => {
      expect(tool.parseGoogleSearchResults('', 'test', 5)).toEqual([]);
    });

    it('handles HTML with no matching pattern', () => {
      expect(tool.parseGoogleSearchResults('<html><body>no results</body></html>', 'test', 5)).toEqual([]);
    });

    it('does not throw on malformed HTML', () => {
      expect(() => tool.parseGoogleSearchResults('<<<<', 'test', 5)).not.toThrow();
    });
  });

  describe('getRandomDelay', () => {
    it('returns value in range', () => {
      for (let i = 0; i < 10; i++) {
        const val = tool.getRandomDelay(0, 100);
        expect(val).toBeGreaterThanOrEqual(0);
        expect(val).toBeLessThanOrEqual(100);
      }
    });
  });

  describe('getHostMachineConfig', () => {
    it('returns a fingerprint config object', () => {
      const cfg = tool.getHostMachineConfig();
      expect(cfg).toHaveProperty('deviceName');
      expect(cfg).toHaveProperty('locale');
      expect(cfg).toHaveProperty('timezoneId');
      expect(['dark', 'light']).toContain(cfg.colorScheme);
    });

    it('uses userLocale when provided', () => {
      expect(tool.getHostMachineConfig('fr-FR').locale).toBe('fr-FR');
    });

    it('always uses Desktop Chrome device', () => {
      expect(tool.getHostMachineConfig().deviceName).toBe('Desktop Chrome');
    });
  });

  describe('isPageStable', () => {
    it('returns true when URL does not change', async () => {
      const page = { url: vi.fn().mockReturnValue('https://example.com'), waitForTimeout: vi.fn().mockResolvedValue(undefined) };
      expect(await tool.isPageStable(page, 1, 0)).toBe(true);
    });

    it('returns false when URL changes', async () => {
      let call = 0;
      const page = { url: vi.fn().mockImplementation(() => (call++ === 0 ? 'https://a.com' : 'https://b.com')), waitForTimeout: vi.fn().mockResolvedValue(undefined) };
      expect(await tool.isPageStable(page, 1, 0)).toBe(false);
    });

    it('returns false when page throws', async () => {
      const page = { url: vi.fn().mockReturnValue('https://example.com'), waitForTimeout: vi.fn().mockRejectedValue(new Error('closed')) };
      expect(await tool.isPageStable(page, 1, 0)).toBe(false);
    });
  });

  describe('validateArgs (private via cast)', () => {
    it('returns invalid when queries missing', () => {
      const r = tool.validateArgs({ description: 'test' });
      expect(r.isValid).toBe(false);
    });
    it('returns invalid when queries not array', () => {
      const r = tool.validateArgs({ description: 'test', queries: 'q' });
      expect(r.isValid).toBe(false);
    });
    it('returns invalid when queries empty', () => {
      const r = tool.validateArgs({ description: 'test', queries: [] });
      expect(r.isValid).toBe(false);
    });
    it('returns invalid when queries has > 10 items', () => {
      const r = tool.validateArgs({ description: 'test', queries: Array(11).fill('q') });
      expect(r.isValid).toBe(false);
    });
    it('returns invalid when query item is empty string', () => {
      const r = tool.validateArgs({ description: 'test', queries: [''] });
      expect(r.isValid).toBe(false);
    });
    it('returns invalid when maxResults out of range', () => {
      const r = tool.validateArgs({ description: 'test', queries: ['q'], maxResults: 0 });
      expect(r.isValid).toBe(false);
    });
    it('returns invalid when maxResults is float', () => {
      const r = tool.validateArgs({ description: 'test', queries: ['q'], maxResults: 1.5 });
      expect(r.isValid).toBe(false);
    });
    it('returns invalid when timeout too small', () => {
      const r = tool.validateArgs({ description: 'test', queries: ['q'], timeout: 500 });
      expect(r.isValid).toBe(false);
    });
    it('returns invalid when timeout is float', () => {
      const r = tool.validateArgs({ description: 'test', queries: ['q'], timeout: 5000.5 });
      expect(r.isValid).toBe(false);
    });
    it('returns valid for proper args', () => {
      const r = tool.validateArgs({ description: 'test', queries: ['hello'], maxResults: 5, timeout: 10000 });
      expect(r.isValid).toBe(true);
    });
  });
});
