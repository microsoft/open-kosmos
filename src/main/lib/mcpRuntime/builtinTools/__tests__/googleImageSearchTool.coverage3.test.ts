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

import * as fs from 'fs';
import { GoogleImageSearchTool } from '../googleImageSearchTool';

const tool = GoogleImageSearchTool as any;

const baseArgs = {
  description: 'coverage3',
  queries: ['cats'],
};

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

describe('GoogleImageSearchTool additional coverage', () => {
  afterEach(() => {
    vi.clearAllMocks();
    mockEnsureBrowserInstalled.mockReset();
    mockStorageState.mockResolvedValue(undefined);
    mockGoto.mockResolvedValue({ url: () => 'https://www.google.com/imghp' });
    mockWaitForSelector.mockResolvedValue(null);
    mockWaitForTimeout.mockResolvedValue(undefined);
    mockPageUrl.mockReturnValue('https://www.google.com/search?q=cats&tbm=isch');
    mockPageContent.mockResolvedValue('<html><body>no images</body></html>');
    mockDollar.mockResolvedValue({ click: vi.fn().mockResolvedValue(undefined) });
    vi.mocked(fs.existsSync).mockReturnValue(false);
  });

  it('executes init scripts, finds a later image-search selector, and skips mkdir when the state directory already exists', async () => {
    makeSetup();
    let initScriptRuns = 0;
    mockAddInitScript.mockImplementation(async (script: () => void) => {
      initScriptRuns += 1;
      runInitScript(script);
    });
    const lateSelectorInput = { click: vi.fn().mockResolvedValue(undefined) };
    mockDollar.mockImplementation(async (selector: string) => (
      selector === "textarea[aria-label='Search']" ? lateSelectorInput : null
    ));
    vi.mocked(fs.existsSync).mockImplementation((target: fs.PathLike) => {
      const targetPath = String(target);
      return !targetPath.endsWith('openkosmos-google-image-browser-state.json');
    });

    const result = await GoogleImageSearchTool.execute(baseArgs);

    expect(result.success).toBe(true);
    expect(initScriptRuns).toBe(2);
    expect(mockDollar).toHaveBeenCalledWith("textarea[aria-label='Search']");
    expect(vi.mocked(fs.mkdirSync)).not.toHaveBeenCalled();
  });

  it('covers the unstable retry path and the state-save warning after a successful search', async () => {
    makeSetup();
    mockStorageState.mockRejectedValue(new Error('context closed'));
    let urlIndex = 0;
    const urlSequence = [
      'https://www.google.com/imghp',
      'https://www.google.com/search?q=cats&tbm=isch',
      'https://www.google.com/search?q=cats&tbm=isch',
      'https://www.google.com/search?q=cats&tbm=isch-1',
      'https://www.google.com/search?q=cats&tbm=isch-2',
      'https://www.google.com/search?q=cats&tbm=isch-2',
      'https://www.google.com/search?q=cats&tbm=isch-3',
    ];
    mockPageUrl.mockImplementation(() => urlSequence[Math.min(urlIndex++, urlSequence.length - 1)]);

    const result = await GoogleImageSearchTool.execute(baseArgs);

    expect(result.success).toBe(true);
    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to save browser state'));
    expect(mockWaitForTimeout).toHaveBeenCalled();
  });

  it('uses fallback source metadata and the default title when the parsed image entry omits them', () => {
    const html = `
      ["https://encrypted-tbn0.gstatic.com/images?q=tbn:abc",236,213],["https://images.example.com/cat.jpg",800,600],null,0,"rgb(0,0,0)",null,0,{"2000":[null,"","10KB"],"2003":[null,"id","",""]}
      ["https://encrypted-tbn0.gstatic.com/images?q=tbn:def",236,213],["https://images.example.com/dog.jpg",1024,768],null,0,"rgb(0,0,0)",null,0,{"2000":[null,"site.example","10KB"],"2003":[null,"id","https://site.example/page","Dog Title"]}
    `;

    const results = tool.parseGoogleImageSearchResults(html, 'pets', 1);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      thumbnailUrl: 'https://images.example.com/cat.jpg',
      sourcePageUrl: 'https://images.example.com/cat.jpg',
      source: 'images.example.com',
      title: 'Image 1 for "pets"',
    });
  });

  it('stops parsing once maxResults is reached', () => {
    const html = `
      ["https://encrypted-tbn0.gstatic.com/images?q=tbn:abc",236,213],["https://images.example.com/cat.jpg",800,600],null,0,"rgb(0,0,0)",null,0,{"2000":[null,"cats.example","10KB"],"2003":[null,"id","https://cats.example/page","Cat Title"]}
      ["https://encrypted-tbn0.gstatic.com/images?q=tbn:def",236,213],["https://images.example.com/dog.jpg",1024,768],null,0,"rgb(0,0,0)",null,0,{"2000":[null,"dogs.example","10KB"],"2003":[null,"id","https://dogs.example/page","Dog Title"]}
    `;

    expect(tool.parseGoogleImageSearchResults(html, 'animals', 1)).toHaveLength(1);
  });

  it('falls back to undefined width/height when parsed dimensions are zero', () => {
    const html = `
      ["https://encrypted-tbn0.gstatic.com/images?q=tbn:abc",236,213],["https://images.example.com/zero.jpg",0,0],null,0,"rgb(0,0,0)",null,0,{"2000":[null,"zero.example","10KB"],"2003":[null,"id","https://zero.example/page","Zero Title"]}
    `;

    const [result] = tool.parseGoogleImageSearchResults(html, 'zero', 5);
    expect(result.width).toBeUndefined();
    expect(result.height).toBeUndefined();
  });

  it('covers the per-match parse error branch when parseInt throws', () => {
    const originalParseInt = globalThis.parseInt;
    vi.stubGlobal('parseInt', ((value: string, radix?: number) => {
      if (value === '700') {
        throw new Error('parse failure');
      }
      return originalParseInt(value, radix);
    }) as typeof parseInt);

    try {
      const html = `
        ["https://encrypted-tbn0.gstatic.com/images?q=tbn:abc",236,213],["https://images.example.com/bird.jpg",700,500],null,0,"rgb(0,0,0)",null,0,{"2000":[null,"birds.example","10KB"],"2003":[null,"id","https://birds.example/page","Bird Title"]}
      `;
      expect(tool.parseGoogleImageSearchResults(html, 'birds', 5)).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('reports rejected Promise.allSettled entries from execute', async () => {
    makeSetup();
    const allSettledSpy = vi.spyOn(Promise, 'allSettled').mockResolvedValueOnce([
      { status: 'rejected', reason: new Error('settled rejection') },
    ] as PromiseSettledResult<any>[]);

    try {
      const result = await GoogleImageSearchTool.execute(baseArgs);
      expect(result.errors?.[0]).toContain('settled rejection');
    } finally {
      allSettledSpy.mockRestore();
    }
  });

  it('covers the no-mkdir branch on the error recovery path', async () => {
    makeSetup();
    mockGoto.mockRejectedValue(new Error('goto failed'));
    vi.mocked(fs.existsSync).mockImplementation((target: fs.PathLike) => {
      const targetPath = String(target);
      return !targetPath.endsWith('openkosmos-google-image-browser-state.json');
    });

    const result = await GoogleImageSearchTool.execute(baseArgs);

    expect(result.errors?.[0]).toContain('goto failed');
  });

  it('uses the unknown-error fallback when browser installation details are absent', async () => {
    mockEnsureBrowserInstalled.mockResolvedValue({ installed: false });

    const result = await GoogleImageSearchTool.execute(baseArgs);

    expect(result.errors?.[0]).toContain('Unknown error');
  });

  it('covers the timezone, locale, and color-scheme branches in getHostMachineConfig', () => {
    const originalGetTimezoneOffset = Date.prototype.getTimezoneOffset;
    const originalGetHours = Date.prototype.getHours;
    const originalLang = process.env.LANG;

    try {
      Date.prototype.getTimezoneOffset = () => -601;
      expect(tool.getHostMachineConfig().timezoneId).toBe('Asia/Tokyo');

      Date.prototype.getTimezoneOffset = () => -450;
      expect(tool.getHostMachineConfig().timezoneId).toBe('Asia/Bangkok');

      Date.prototype.getTimezoneOffset = () => 0;
      expect(tool.getHostMachineConfig().timezoneId).toBe('Europe/London');

      Date.prototype.getTimezoneOffset = () => 30;
      expect(tool.getHostMachineConfig().timezoneId).toBe('Europe/Berlin');

      Date.prototype.getTimezoneOffset = () => 270;
      expect(tool.getHostMachineConfig().timezoneId).toBe('America/New_York');

      Date.prototype.getHours = () => 20;
      expect(tool.getHostMachineConfig().colorScheme).toBe('dark');

      Date.prototype.getHours = () => 12;
      expect(tool.getHostMachineConfig().colorScheme).toBe('light');

      process.env.LANG = 'ja-JP';
      expect(tool.getHostMachineConfig().locale).toBe('ja-JP');

      delete process.env.LANG;
      expect(tool.getHostMachineConfig().locale).toBe('zh-CN');
    } finally {
      Date.prototype.getTimezoneOffset = originalGetTimezoneOffset;
      Date.prototype.getHours = originalGetHours;
      process.env.LANG = originalLang;
    }
  });
});
