import { afterEach, describe, expect, it, vi } from 'vitest';

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

import * as fs from 'fs';
import * as path from 'path';
import { GoogleWebSearchTool } from '../googleWebSearchTool';

const tool = GoogleWebSearchTool as any;

const baseArgs = {
  description: 'coverage3',
  queries: ['test query'],
};

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
    keyboard: { type: vi.fn().mockResolvedValue(undefined), press: vi.fn().mockResolvedValue(undefined) },
    $: mockDollar,
    ...overrides,
  };
}

function makeSetup() {
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
  return { page, ctx };
}

function runInitScript(script: () => void) {
  const originalNavigator = (globalThis as any).navigator;
  const originalWindow = (globalThis as any).window;
  const originalWebGL = (globalThis as any).WebGLRenderingContext;

  class FakeWebGLRenderingContext {
    getParameter(parameter: number) {
      return `original-${parameter}`;
    }
  }

  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    writable: true,
    value: {},
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: { screen: {} },
  });
  Object.defineProperty(globalThis, 'WebGLRenderingContext', {
    configurable: true,
    writable: true,
    value: FakeWebGLRenderingContext,
  });

  try {
    script();
    void (globalThis as any).navigator.webdriver;
    void (globalThis as any).navigator.plugins;
    void (globalThis as any).navigator.languages;
    if ((globalThis as any).window.chrome?.loadTimes) {
      (globalThis as any).window.chrome.loadTimes();
    }
    if ((globalThis as any).window.chrome?.csi) {
      (globalThis as any).window.chrome.csi();
    }
    if ((globalThis as any).WebGLRenderingContext) {
      const webgl = new (globalThis as any).WebGLRenderingContext();
      webgl.getParameter(37445);
      webgl.getParameter(37446);
      webgl.getParameter(12345);
    }
    void (globalThis as any).window.screen.width;
    void (globalThis as any).window.screen.height;
    void (globalThis as any).window.screen.colorDepth;
    void (globalThis as any).window.screen.pixelDepth;
  } finally {
    Object.defineProperty(globalThis, 'navigator', { configurable: true, writable: true, value: originalNavigator });
    Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: originalWindow });
    Object.defineProperty(globalThis, 'WebGLRenderingContext', { configurable: true, writable: true, value: originalWebGL });
  }
}

describe('GoogleWebSearchTool additional coverage', () => {
  afterEach(() => {
    vi.clearAllMocks();
    mockEnsureBrowserInstalled.mockReset();
    mockStorageState.mockResolvedValue(undefined);
    mockGoto.mockResolvedValue({ url: () => 'https://www.google.com' });
    mockWaitForSelector.mockResolvedValue(null);
    mockWaitForLoadState.mockResolvedValue(undefined);
    mockWaitForTimeout.mockResolvedValue(undefined);
    mockPageUrl.mockReturnValue('https://www.google.com/search?q=test');
    mockPageContent.mockResolvedValue('<html><body>no results</body></html>');
    mockDollar.mockResolvedValue({ click: vi.fn().mockResolvedValue(undefined) });
    vi.mocked(fs.existsSync).mockReturnValue(false);
  });

  it('executes context/page init scripts, uses a later selector, and skips mkdir when the state directory already exists', async () => {
    makeSetup();
    let initScriptRuns = 0;
    mockAddInitScript.mockImplementation(async (script: () => void) => {
      initScriptRuns += 1;
      runInitScript(script);
    });
    mockGoto.mockResolvedValue(null);
    vi.mocked(fs.existsSync).mockImplementation((target: fs.PathLike) => {
      const targetPath = String(target);
      return !targetPath.endsWith('openkosmos-google-browser-state.json');
    });
    const lateSelectorInput = { click: vi.fn().mockResolvedValue(undefined) };
    mockDollar.mockImplementation(async (selector: string) => (
      selector === "input[title='Search']" ? lateSelectorInput : null
    ));

    const result = await GoogleWebSearchTool.execute(baseArgs);

    expect(result.success).toBe(true);
    expect(initScriptRuns).toBe(2);
    expect(mockDollar).toHaveBeenCalledWith("input[title='Search']");
    expect(vi.mocked(fs.mkdirSync)).not.toHaveBeenCalled();
  });

  it('covers the unstable-page retry path and the state-save warning on the success path', async () => {
    makeSetup();
    mockStorageState.mockRejectedValue(new Error('disk full'));
    let urlIndex = 0;
    const urlSequence = [
      'https://www.google.com',
      'https://www.google.com/search?q=test',
      'https://www.google.com/search?q=test',
      'https://www.google.com/search?q=test',
      'https://www.google.com/search?q=test-2',
      'https://www.google.com/search?q=test-2',
      'https://www.google.com/search?q=test-3',
    ];
    mockPageUrl.mockImplementation(() => urlSequence[Math.min(urlIndex++, urlSequence.length - 1)]);

    const result = await GoogleWebSearchTool.execute(baseArgs);

    expect(result.success).toBe(true);
    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to save browser state'));
    expect(mockWaitForTimeout).toHaveBeenCalledWith(2000);
  });

  it('parses valid Google result markup, falls back to the URL host when the site label is missing, and skips invalid URLs', () => {
    const validResultHtml = `
      <h3 class="LC20lb MBeuO DKV0Md">Valid Result Title</h3>
      <a jsname="UWckNb" class="zReHs qwd" href="https://www.google.com/url?url=${encodeURIComponent('https://example.com/article')}"></a>
      <div class="byrV5b"><cite class="tjvcx GvPZzd dTxz9 cHaqb">Example Site</cite></div>
      <div class="VwiC3b yXK7lf p4wth r025kc Hdw6tb">This is a sufficiently descriptive caption for the parser.</div>
      <h3 class="LC20lb MBeuO DKV0Md"></h3>
      <a jsname="UWckNb" class="zReHs qwd" href="/relative"></a>
      <div class="VwiC3b yXK7lf p4wth r025kc Hdw6tb">This caption reaches the URL validation branch.</div>
    `;
    const fallbackSiteHtml = `
      <h3 class="LC20lb MBeuO DKV0Md">Host Fallback Title</h3>
      <a jsname="UWckNb" class="zReHs qwd" href="https://fallback.example.com/path"></a>
      <div class="VwiC3b yXK7lf p4wth r025kc Hdw6tb">Another sufficiently descriptive caption for host fallback.</div>
    `;

    const results = tool.parseGoogleSearchResults(validResultHtml, 'coverage', 5);
    const fallbackResults = tool.parseGoogleSearchResults(fallbackSiteHtml, 'coverage', 5);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      title: 'Valid Result Title',
      url: 'https://example.com/article',
      site: 'Example Site',
    });
    expect(fallbackResults[0]).toMatchObject({
      title: 'Host Fallback Title',
      url: 'https://fallback.example.com/path',
      site: 'fallback.example.com',
    });
  });

  it('handles captions that are missing a title or URL before them', () => {
    const missingTitle = `
      <div class="VwiC3b yXK7lf p4wth r025kc Hdw6tb">This caption has no preceding title element at all.</div>
    `;
    const missingUrl = `
      <h3 class="LC20lb MBeuO DKV0Md">Title Only</h3>
      <div class="VwiC3b yXK7lf p4wth r025kc Hdw6tb">This caption has no matching URL anchor before it.</div>
    `;

    expect(tool.parseGoogleSearchResults(missingTitle, 'coverage', 5)).toEqual([]);
    expect(tool.parseGoogleSearchResults(missingUrl, 'coverage', 5)).toEqual([]);
  });

  it('reports rejected Promise.allSettled entries from execute', async () => {
    makeSetup();
    const allSettledSpy = vi.spyOn(Promise, 'allSettled').mockResolvedValueOnce([
      { status: 'rejected', reason: new Error('settled rejection') },
    ] as PromiseSettledResult<any>[]);

    try {
      const result = await GoogleWebSearchTool.execute(baseArgs);
      expect(result.errors?.[0]).toContain('settled rejection');
    } finally {
      allSettledSpy.mockRestore();
    }
  });

  it('covers the timeout-too-large validation branch', () => {
    expect(tool.validateArgs({ description: 'test', queries: ['q'], timeout: 300001 }).isValid).toBe(false);
  });
});
