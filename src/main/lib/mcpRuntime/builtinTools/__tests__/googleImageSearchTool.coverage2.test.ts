/**
 * Additional coverage tests for GoogleImageSearchTool — targeting uncovered branches
 * in error recovery, CAPTCHA detection, state saving, and fingerprint handling.
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

const baseArgs = {
  description: 'test',
  queries: ['cats'],
};

// ── helpers ───────────────────────────────────────────────────────────────────

function makePage(overrides: Partial<Record<string, any>> = {}) {
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
    ...overrides,
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
  return { page, ctx };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('GoogleImageSearchTool.execute — CAPTCHA detected on initial page load', () => {
  afterEach(() => vi.clearAllMocks());

  it('throws error and records it when CAPTCHA page detected', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    mockEnsureBrowserInstalled.mockResolvedValue({ installed: true });
    // Return CAPTCHA URL
    mockPageUrl.mockReturnValue('https://www.google.com/sorry/index?continue=...');
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
    const result = await GoogleImageSearchTool.execute(baseArgs);
    expect(result.errors).toBeDefined();
    expect(result.errors!.length).toBeGreaterThan(0);
    expect(result.errors![0]).toMatch(/unusual traffic|CAPTCHA|sorry/i);
  });
});

describe('GoogleImageSearchTool.execute — no search box found', () => {
  afterEach(() => vi.clearAllMocks());

  it('records error when search input not found on page', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    mockEnsureBrowserInstalled.mockResolvedValue({ installed: true });
    mockPageUrl.mockReturnValue('https://www.google.com/search?q=cats&tbm=isch');
    mockGoto.mockResolvedValue({ url: () => 'https://www.google.com/imghp' });
    const page = makePage({ $: vi.fn().mockResolvedValue(null) });
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
    const result = await GoogleImageSearchTool.execute(baseArgs);
    expect(result.errors).toBeDefined();
    expect(result.errors![0]).toMatch(/image search box|search box/i);
  });
});

describe('GoogleImageSearchTool.execute — CAPTCHA after search', () => {
  afterEach(() => vi.clearAllMocks());

  it('records error when CAPTCHA detected after search submit', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    mockEnsureBrowserInstalled.mockResolvedValue({ installed: true });
    mockGoto.mockResolvedValue({ url: () => 'https://www.google.com/imghp' });
    // First url() call (initial CAPTCHA check) returns normal URL
    // Second url() call (post-search check) returns CAPTCHA URL
    let urlCallCount = 0;
    mockPageUrl.mockImplementation(() => {
      urlCallCount++;
      if (urlCallCount === 1) return 'https://www.google.com/imghp'; // initial check → OK
      return 'https://www.google.com/sorry?continue=x'; // post-search → CAPTCHA
    });
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
    const result = await GoogleImageSearchTool.execute(baseArgs);
    expect(result.errors).toBeDefined();
    expect(result.errors!.length).toBeGreaterThan(0);
  });
});

describe('GoogleImageSearchTool.execute — state saving and fingerprint', () => {
  afterEach(() => vi.clearAllMocks());

  it('creates state dir and saves fingerprint when not existing', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    mockEnsureBrowserInstalled.mockResolvedValue({ installed: true });
    makeSetup();
    const result = await GoogleImageSearchTool.execute(baseArgs);
    expect(result.success).toBe(true);
    expect(vi.mocked(fs.mkdirSync)).toHaveBeenCalled();
    expect(vi.mocked(fs.writeFileSync)).toHaveBeenCalled();
  });

  it('handles writeFileSync failure gracefully', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.writeFileSync).mockImplementation(() => { throw new Error('No space'); });
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
    const result = await GoogleImageSearchTool.execute(baseArgs);
    expect(result.success).toBe(true);
  });

  it('handles storageState save failure gracefully', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    mockStorageState.mockRejectedValue(new Error('context closed'));
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
    const result = await GoogleImageSearchTool.execute(baseArgs);
    expect(result.success).toBe(true);
  });
});

describe('GoogleImageSearchTool.execute — corrupt fingerprint file with unlinkSync failure', () => {
  afterEach(() => vi.clearAllMocks());

  it('handles corrupt fingerprint and delete failure', async () => {
    let readCount = 0;
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      readCount++;
      if (readCount === 1) return '{"cookies":[]}'; // valid state
      return '{{broken'; // invalid fingerprint
    });
    vi.mocked(fs.unlinkSync).mockImplementation(() => {
      throw new Error('Cannot delete');
    });
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
    const result = await GoogleImageSearchTool.execute(baseArgs);
    expect(result.success).toBe(true);
  });
});

describe('GoogleImageSearchTool.execute — page stability retry', () => {
  afterEach(() => vi.clearAllMocks());

  it('handles page that changes URL twice (isStable=false, isStableRetry=false)', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    mockEnsureBrowserInstalled.mockResolvedValue({ installed: true });
    mockGoto.mockResolvedValue({ url: () => 'https://www.google.com/imghp' });
    let urlCallCount = 0;
    const urlSequence = [
      'https://www.google.com/imghp',           // initial
      'https://www.google.com/search?q=cats',    // first isPageStable check (initial)
      'https://www.google.com/search?q=cats2',   // first isPageStable check (after wait) → changed → false
      'https://www.google.com/search?q=cats2',   // second isPageStable check (initial)
      'https://www.google.com/search?q=cats3',   // second isPageStable check (after wait) → changed → false
    ];
    mockPageUrl.mockImplementation(() => urlSequence[Math.min(urlCallCount++, urlSequence.length - 1)]);
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
    const result = await GoogleImageSearchTool.execute(baseArgs);
    expect(result.success).toBe(true);
  });
});

describe('GoogleImageSearchTool.execute — error path state saving', () => {
  afterEach(() => vi.clearAllMocks());

  it('saves state when goto throws and recovers', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    mockEnsureBrowserInstalled.mockResolvedValue({ installed: true });
    mockGoto.mockRejectedValue(new Error('goto failed'));
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
    const result = await GoogleImageSearchTool.execute(baseArgs);
    expect(result.errors).toBeDefined();
    expect(result.errors!.length).toBeGreaterThan(0);
    expect(result.errors![0]).toMatch(/goto failed/);
  });

  it('handles storageState failure in error recovery path', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    mockEnsureBrowserInstalled.mockResolvedValue({ installed: true });
    mockGoto.mockRejectedValue(new Error('page crashed'));
    mockStorageState.mockRejectedValue(new Error('storage failed'));
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
    const result = await GoogleImageSearchTool.execute(baseArgs);
    expect(result.errors).toBeDefined();
    expect(result.errors![0]).toMatch(/page crashed/);
  });
});

describe('GoogleImageSearchTool.execute — launchBrowser rejects', () => {
  afterEach(() => vi.clearAllMocks());

  it('handles promise rejection in searchPromise (allSettled rejected branch)', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    mockEnsureBrowserInstalled.mockResolvedValue({ installed: true });
    mockLaunchBrowser.mockRejectedValue(new Error('browser launch failed'));
    const result = await GoogleImageSearchTool.execute({ ...baseArgs, queries: ['a', 'b'] });
    expect(result.errors).toBeDefined();
    expect(result.errors!.length).toBeGreaterThan(0);
  });
});

describe('GoogleImageSearchTool.execute — saved googleDomain not in list', () => {
  afterEach(() => vi.clearAllMocks());

  it('uses random domain when saved domain not in list', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation((f) => {
      const fStr = String(f);
      if (fStr.endsWith('-fingerprint.json')) {
        return JSON.stringify({
          fingerprint: {
            deviceName: 'Desktop Chrome',
            locale: 'en-US',
            timezoneId: 'America/New_York',
            colorScheme: 'light',
            reducedMotion: 'no-preference',
            forcedColors: 'none',
          },
          googleDomain: 'https://www.google.de/imghp', // not in the list
        });
      }
      return '{"cookies":[]}'; // valid state JSON
    });
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
    const result = await GoogleImageSearchTool.execute(baseArgs);
    expect(result.success).toBe(true);
  });
});

describe('GoogleImageSearchTool.execute — waitForSelector timeout', () => {
  afterEach(() => vi.clearAllMocks());

  it('continues when waitForSelector throws (image container not found)', async () => {
    makeSetup();
    mockWaitForSelector.mockRejectedValue(new Error('Timeout'));
    const result = await GoogleImageSearchTool.execute(baseArgs);
    expect(result.success).toBe(true);
  });
});

describe('GoogleImageSearchTool.execute — no browserPath in check result', () => {
  afterEach(() => vi.clearAllMocks());

  it('succeeds without browserPath in ensureBrowserInstalled result', async () => {
    makeSetup();
    mockEnsureBrowserInstalled.mockResolvedValue({ installed: true }); // no browserPath
    const result = await GoogleImageSearchTool.execute(baseArgs);
    expect(result.success).toBe(true);
  });
});
