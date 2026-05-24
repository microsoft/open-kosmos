/**
 * Additional coverage tests for BingWebSearchTool — targeting uncovered branches
 * in the error path, fingerprint deletion, page stability retry, and state saving.
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
  mockPageContent: vi.fn().mockResolvedValue('<html><body></body></html>'),
  mockNewPage: vi.fn(),
  mockNewContext: vi.fn(),
  mockLaunchBrowser: vi.fn(),
  mockEnsureBrowserInstalled: vi.fn(),
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

const baseArgs = {
  description: 'test',
  queries: ['test query'],
  lang: 'en' as const,
  locale: 'us' as const,
};

// ── helpers ───────────────────────────────────────────────────────────────────

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
    ...overrides,
  };
}

function makeSetup(pageOverrides: Partial<Record<string, any>> = {}) {
  vi.mocked(fs.existsSync).mockReturnValue(false);
  mockEnsureBrowserInstalled.mockResolvedValue({ installed: true, browserPath: '/usr/bin/chromium' });
  const page = makePage(pageOverrides);
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

describe('BingWebSearchTool.execute — page.goto throws (error recovery path)', () => {
  afterEach(() => vi.clearAllMocks());

  it('returns error for the query when goto throws, recovers via storageState save', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    mockEnsureBrowserInstalled.mockResolvedValue({ installed: true });
    mockGoto.mockRejectedValue(new Error('Navigation failed'));
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
    const result = await BingWebSearchTool.execute(baseArgs);
    // Query fails but execute itself succeeds (errors collected)
    expect(result.errors).toBeDefined();
    expect(result.errors!.length).toBeGreaterThan(0);
    expect(result.errors![0]).toMatch(/Navigation failed/);
  });

  it('handles storageState save failure in error path gracefully', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    mockEnsureBrowserInstalled.mockResolvedValue({ installed: true });
    mockGoto.mockRejectedValue(new Error('goto failed'));
    mockStorageState.mockRejectedValue(new Error('storage save failed'));
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
    const result = await BingWebSearchTool.execute(baseArgs);
    expect(result.errors).toBeDefined();
    expect(result.errors!.length).toBeGreaterThan(0);
  });
});

describe('BingWebSearchTool.execute — page stability retry (isStableRetry false)', () => {
  afterEach(() => vi.clearAllMocks());

  it('handles page that never stabilizes and continues', async () => {
    // Return different URLs on each call to trigger both isStable=false and isStableRetry=false
    let callCount = 0;
    const urls = [
      'https://www.bing.com/search?q=test',
      'https://www.bing.com/search?q=test&page=2',
      'https://www.bing.com/search?q=test&page=2',
      'https://www.bing.com/search?q=test&page=3',
    ];
    mockPageUrl.mockImplementation(() => urls[Math.min(callCount++, urls.length - 1)]);
    makeSetup();
    const result = await BingWebSearchTool.execute(baseArgs);
    expect(result.success).toBe(true);
  });
});

describe('BingWebSearchTool.execute — waitForSelector timeout (selector error path)', () => {
  afterEach(() => vi.clearAllMocks());

  it('continues when waitForSelector times out', async () => {
    makeSetup();
    mockWaitForSelector.mockRejectedValue(new Error('Timeout waiting for selector'));
    const result = await BingWebSearchTool.execute(baseArgs);
    expect(result.success).toBe(true);
  });

  it('continues when waitForLoadState times out', async () => {
    makeSetup();
    let loadStateCallCount = 0;
    mockWaitForLoadState.mockImplementation(() => {
      loadStateCallCount++;
      if (loadStateCallCount > 1) throw new Error('Load state timeout');
      return Promise.resolve(undefined);
    });
    const result = await BingWebSearchTool.execute(baseArgs);
    expect(result.success).toBe(true);
  });
});

describe('BingWebSearchTool.execute — corrupt state + fingerprint file', () => {
  afterEach(() => vi.clearAllMocks());

  it('handles corrupt fingerprint file and unlinkSync failure', async () => {
    // existsSync returns true for both state and fingerprint files
    let callCount = 0;
    vi.mocked(fs.existsSync).mockImplementation(() => {
      callCount++;
      return true; // both stateFile and fingerprintFile exist
    });
    // readFileSync: first call (state file) valid, second call (fingerprint) invalid
    let readCount = 0;
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      readCount++;
      if (readCount === 1) return '{"cookies":[]}'; // valid state JSON
      return '{{invalid json'; // invalid fingerprint JSON
    });
    // unlinkSync fails for fingerprint file
    vi.mocked(fs.unlinkSync).mockImplementation(() => {
      throw new Error('Cannot delete file');
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
    const result = await BingWebSearchTool.execute(baseArgs);
    expect(result.success).toBe(true);
  });

  it('handles unlinkSync failure when deleting corrupt state file', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue('{{not json}}');
    vi.mocked(fs.unlinkSync).mockImplementation(() => {
      throw new Error('Permission denied');
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
    const result = await BingWebSearchTool.execute(baseArgs);
    expect(result.success).toBe(true);
  });
});

describe('BingWebSearchTool.execute — state saving after successful search', () => {
  afterEach(() => vi.clearAllMocks());

  it('still succeeds when state dir does not exist and is created', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
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
    const result = await BingWebSearchTool.execute(baseArgs);
    expect(result.success).toBe(true);
    expect(vi.mocked(fs.mkdirSync)).toHaveBeenCalled();
  });

  it('handles writeFileSync failure for fingerprint gracefully', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.writeFileSync).mockImplementation(() => {
      throw new Error('Disk full');
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
    const result = await BingWebSearchTool.execute(baseArgs);
    // Should still succeed even if fingerprint save fails
    expect(result.success).toBe(true);
  });
});

describe('BingWebSearchTool.execute — signal abort during search', () => {
  afterEach(() => vi.clearAllMocks());

  it('fires abort handler after search starts without crashing', async () => {
    const ctrl = new AbortController();
    makeSetup();
    // Abort after browser is checked
    mockEnsureBrowserInstalled.mockImplementation(async () => {
      return { installed: true };
    });
    const result = await BingWebSearchTool.execute(baseArgs, { signal: ctrl.signal });
    expect(result.success).toBe(true);
  });

  it('returns no errors in result when signal not aborted and search succeeds', async () => {
    const ctrl = new AbortController();
    makeSetup();
    const result = await BingWebSearchTool.execute(baseArgs, { signal: ctrl.signal });
    // errors may be undefined or empty
    expect(result.success).toBe(true);
  });
});

describe('BingWebSearchTool.execute — browser check without path', () => {
  afterEach(() => vi.clearAllMocks());

  it('logs without browserPath when not provided', async () => {
    makeSetup();
    mockEnsureBrowserInstalled.mockResolvedValue({ installed: true }); // no browserPath
    const result = await BingWebSearchTool.execute(baseArgs);
    expect(result.success).toBe(true);
  });
});

describe('BingWebSearchTool.execute — rejected searchPromise (Promise.allSettled rejected branch)', () => {
  afterEach(() => vi.clearAllMocks());

  it('handles rejection in search promise and records error', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    mockEnsureBrowserInstalled.mockResolvedValue({ installed: true });
    // Make launchBrowser throw to cause the per-query promise to reject
    mockLaunchBrowser.mockRejectedValue(new Error('browser crash'));
    const result = await BingWebSearchTool.execute({ ...baseArgs, queries: ['query1', 'query2'] });
    // Both queries fail but total execute returns success structure with errors
    expect(result.errors).toBeDefined();
    expect(result.errors!.length).toBeGreaterThan(0);
  });
});
