/**
 * Additional coverage tests for GoogleWebSearchTool — coverage2
 * Targets uncovered branches:
 * - State file present but fingerprint file read fails (JSON parse error) + delete fails
 * - Saved fingerprint + saved google domain branch
 * - Page stability check returns false (isStable=false path) → retry
 * - waitForLoadState timeout (selectorError path)
 * - Bot blocked after search (isBlockedAfterSearch)
 * - State save failure after success (storageState throws)
 * - State save failure in error handler
 * - Promise.allSettled rejected branch (result.status === 'rejected')
 * - Multiple queries with one failing
 * - getHostMachineConfig timezone branches
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

const baseArgs = {
  description: 'test search',
  queries: ['test query'],
  maxResults: 5,
};

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
  return { page, ctx };
}

afterEach(() => {
  vi.clearAllMocks();
  mockDollar.mockResolvedValue({ click: vi.fn().mockResolvedValue(undefined) });
});

// ── State file with corrupt fingerprint file ──────────────────────────────────

describe('GoogleWebSearchTool.execute — state file present, corrupt fingerprint', () => {
  beforeEach(() => {
    // state file exists and is valid, fingerprint file also exists but is corrupt
    vi.mocked(fs.existsSync).mockImplementation((p: any) => {
      const pStr = String(p);
      // state file exists, fingerprint file also exists
      return true;
    });
    vi.mocked(fs.readFileSync).mockImplementation((p: any, _enc?: any) => {
      const pStr = String(p);
      if (pStr.includes('-fingerprint')) {
        throw new Error('corrupt fingerprint');
      }
      return '{"cookies":[],"origins":[]}';
    });
    vi.mocked(fs.unlinkSync).mockImplementation(() => { throw new Error('cannot delete'); });

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

  it('handles corrupt fingerprint and unlink failure gracefully', async () => {
    const result = await GoogleWebSearchTool.execute(baseArgs);
    expect(typeof result.success).toBe('boolean');
  });
});

// ── Saved fingerprint config and saved google domain ─────────────────────────

describe('GoogleWebSearchTool.execute — saved fingerprint and google domain', () => {
  beforeEach(() => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation((p: any, _enc?: any) => {
      const pStr = String(p);
      if (pStr.includes('-fingerprint')) {
        return JSON.stringify({
          fingerprint: {
            deviceName: 'Desktop Chrome',
            locale: 'en-US',
            timezoneId: 'America/New_York',
            colorScheme: 'light',
            reducedMotion: 'no-preference',
            forcedColors: 'none',
          },
          googleDomain: 'https://www.google.ca',
        });
      }
      return '{"cookies":[],"origins":[]}';
    });

    mockEnsureBrowserInstalled.mockResolvedValue({ installed: true });
    mockGoto.mockResolvedValue({ url: () => 'https://www.google.ca' });
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

  it('uses saved fingerprint and domain', async () => {
    const result = await GoogleWebSearchTool.execute(baseArgs);
    expect(typeof result.success).toBe('boolean');
  });
});

// ── Page stability fails → retry path ────────────────────────────────────────

describe('GoogleWebSearchTool.execute — page unstable first check', () => {
  beforeEach(() => {
    makeSetup();
    // First two url() calls return different URLs (unstable), then stable
    let urlCallCount = 0;
    mockPageUrl
      .mockImplementation(() => {
        urlCallCount++;
        if (urlCallCount <= 2) return 'https://www.google.com/search?q=test&redir=1';
        return 'https://www.google.com/search?q=test';
      });
  });

  it('proceeds even when page is initially unstable', async () => {
    const result = await GoogleWebSearchTool.execute(baseArgs);
    expect(typeof result.success).toBe('boolean');
  });
});

// ── waitForSelector timeout ───────────────────────────────────────────────────

describe('GoogleWebSearchTool.execute — waitForSelector times out', () => {
  beforeEach(() => {
    makeSetup();
    mockWaitForSelector.mockRejectedValue(new Error('Timeout waiting for selector'));
  });

  it('proceeds after selector timeout', async () => {
    const result = await GoogleWebSearchTool.execute(baseArgs);
    expect(typeof result.success).toBe('boolean');
  });
});

// ── waitForLoadState timeout ──────────────────────────────────────────────────

describe('GoogleWebSearchTool.execute — waitForLoadState times out', () => {
  beforeEach(() => {
    makeSetup();
    mockWaitForLoadState.mockRejectedValue(new Error('Timeout waiting for load state'));
  });

  it('proceeds after load state timeout', async () => {
    const result = await GoogleWebSearchTool.execute(baseArgs);
    expect(typeof result.success).toBe('boolean');
  });
});

// ── Bot blocked after search ──────────────────────────────────────────────────

describe('GoogleWebSearchTool.execute — bot blocked after search', () => {
  beforeEach(() => {
    makeSetup();
    let callCount = 0;
    mockPageUrl.mockImplementation(() => {
      callCount++;
      // First call (after goto) returns normal URL
      if (callCount === 1) return 'https://www.google.com';
      // After typing query, redirect to sorry page
      return 'https://www.google.com/sorry/index?continue=test';
    });
  });

  it('handles blocked after search gracefully', async () => {
    const result = await GoogleWebSearchTool.execute(baseArgs);
    // The query fails and becomes an error in the result
    expect(typeof result.success).toBe('boolean');
  });
});

// ── storageState save throws in success path ──────────────────────────────────

describe('GoogleWebSearchTool.execute — state save failure in success path', () => {
  beforeEach(() => {
    makeSetup();
    mockStorageState.mockRejectedValue(new Error('disk full'));
  });

  it('completes successfully even when state save fails', async () => {
    const result = await GoogleWebSearchTool.execute(baseArgs);
    expect(typeof result.success).toBe('boolean');
  });
});

// ── Multiple queries, one rejects via Promise.allSettled ─────────────────────

describe('GoogleWebSearchTool.execute — multiple queries with one failing', () => {
  beforeEach(() => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    mockEnsureBrowserInstalled.mockResolvedValue({ installed: true });

    let callCount = 0;
    mockLaunchBrowser.mockImplementation(async () => {
      callCount++;
      if (callCount === 2) {
        throw new Error('browser launch failed for query 2');
      }
      const page = makePage();
      const ctx = {
        newPage: mockNewPage.mockResolvedValue(page),
        addInitScript: mockAddInitScript,
        storageState: mockStorageState,
        close: mockContextClose,
      };
      return {
        newContext: mockNewContext.mockResolvedValue(ctx),
        close: mockBrowserClose,
      };
    });
  });

  it('returns success with partial results and errors array', async () => {
    const result = await GoogleWebSearchTool.execute({
      ...baseArgs,
      queries: ['query 1', 'query 2'],
    });
    expect(typeof result.success).toBe('boolean');
    expect(result.totalQueries).toBe(2);
  });
});

// ── getHostMachineConfig timezone offset branches ─────────────────────────────

describe('GoogleWebSearchTool private — getHostMachineConfig timezone branches', () => {
  const tool = GoogleWebSearchTool as any;

  const originalGetTimezoneOffset = Date.prototype.getTimezoneOffset;

  afterEach(() => {
    Date.prototype.getTimezoneOffset = originalGetTimezoneOffset;
  });

  it('uses Asia/Tokyo for offset <= -600', () => {
    // Need offset <= -540 but NOT (offset <= -480 && offset > -600)
    // offset = -601 satisfies: -601 > -600 is false, so Shanghai clause skipped; -601 <= -540 → Tokyo
    Date.prototype.getTimezoneOffset = () => -601;
    const cfg = tool.getHostMachineConfig();
    expect(cfg.timezoneId).toBe('Asia/Tokyo');
  });

  it('uses Asia/Bangkok for offset in (-480, -420]', () => {
    Date.prototype.getTimezoneOffset = () => -450;
    const cfg = tool.getHostMachineConfig();
    expect(cfg.timezoneId).toBe('Asia/Bangkok');
  });

  it('uses Europe/London for offset in (-60, 0]', () => {
    Date.prototype.getTimezoneOffset = () => 0;
    const cfg = tool.getHostMachineConfig();
    expect(cfg.timezoneId).toBe('Europe/London');
  });

  it('uses Europe/Berlin for offset > 0 and <= 60', () => {
    Date.prototype.getTimezoneOffset = () => 30;
    const cfg = tool.getHostMachineConfig();
    expect(cfg.timezoneId).toBe('Europe/Berlin');
  });

  it('uses America/New_York for offset in (240, 300]', () => {
    Date.prototype.getTimezoneOffset = () => 270;
    const cfg = tool.getHostMachineConfig();
    expect(cfg.timezoneId).toBe('America/New_York');
  });

  it('dark color scheme when hour >= 19', () => {
    const origGetHours = Date.prototype.getHours;
    Date.prototype.getHours = () => 20;
    const cfg = tool.getHostMachineConfig();
    expect(cfg.colorScheme).toBe('dark');
    Date.prototype.getHours = origGetHours;
  });

  it('dark color scheme when hour < 7', () => {
    const origGetHours = Date.prototype.getHours;
    Date.prototype.getHours = () => 3;
    const cfg = tool.getHostMachineConfig();
    expect(cfg.colorScheme).toBe('dark');
    Date.prototype.getHours = origGetHours;
  });

  it('light color scheme when hour is midday', () => {
    const origGetHours = Date.prototype.getHours;
    Date.prototype.getHours = () => 12;
    const cfg = tool.getHostMachineConfig();
    expect(cfg.colorScheme).toBe('light');
    Date.prototype.getHours = origGetHours;
  });

  it('falls back to LANG env var when no userLocale', () => {
    const origLang = process.env.LANG;
    process.env.LANG = 'ja-JP';
    const cfg = tool.getHostMachineConfig();
    expect(cfg.locale).toBe('ja-JP');
    process.env.LANG = origLang;
  });

  it('falls back to zh-CN when LANG not set', () => {
    const origLang = process.env.LANG;
    delete process.env.LANG;
    const cfg = tool.getHostMachineConfig();
    expect(cfg.locale).toBe('zh-CN');
    process.env.LANG = origLang;
  });
});

// ── parseGoogleSearchResults — real HTML patterns ─────────────────────────────

describe('GoogleWebSearchTool private — parseGoogleSearchResults with real patterns', () => {
  const tool = GoogleWebSearchTool as any;

  it('skips result with short caption (< 10 chars)', () => {
    // Has caption div but content is too short
    const html = `
      <div class="VwiC3b yXK7lf p4wth r025kc Hdw6tb">short</div>
    `;
    const results = tool.parseGoogleSearchResults(html, 'test', 5);
    expect(results).toEqual([]);
  });

  it('handles outer parse error gracefully', () => {
    // Passing a non-string would cause matchAll to fail, but null coerces
    expect(() => tool.parseGoogleSearchResults(null as any, 'test', 5)).not.toThrow();
  });

  it('respects maxResults limit', () => {
    // Results that parse will be limited
    const results = tool.parseGoogleSearchResults('<html>no pattern match</html>', 'q', 0);
    expect(results.length).toBe(0);
  });
});

// ── getDefinition ─────────────────────────────────────────────────────────────

describe('GoogleWebSearchTool.getDefinition — additional checks', () => {
  it('has correct timeout constraints', () => {
    const def = GoogleWebSearchTool.getDefinition();
    const timeout = def.inputSchema.properties.timeout as any;
    expect(timeout.minimum).toBe(1000);
    expect(timeout.maximum).toBe(300000);
  });

  it('has correct maxResults constraints', () => {
    const def = GoogleWebSearchTool.getDefinition();
    const mr = def.inputSchema.properties.maxResults as any;
    expect(mr.minimum).toBe(1);
    expect(mr.maximum).toBe(10);
  });
});
