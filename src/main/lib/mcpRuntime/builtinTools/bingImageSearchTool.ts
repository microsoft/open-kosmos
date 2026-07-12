/**
 * BingImageSearchTool built-in tool - uses Playwright browser automation
 * Provides LLM-callable Bing image search with parallel search support and result merging
 * Note: This is a built-in tool, not an MCP protocol tool
 */

import { BuiltinToolDefinition } from './types';
import { Browser, Page, devices, BrowserContextOptions } from 'playwright-core';
import { getUnifiedLogger } from '../../unifiedLogger';
import { PlaywrightManager } from '../../playwright';
import type { ToolExecutionContext } from '../../subAgent/types';
import * as os from 'os';

const logger = getUnifiedLogger();

// Fingerprint configuration interface
interface FingerprintConfig {
  deviceName: string;
  locale: string;
  timezoneId: string;
  colorScheme: "dark" | "light";
  reducedMotion: "reduce" | "no-preference";
  forcedColors: "active" | "none";
}

export interface BingImageSearchResult {
  index: number;
  title: string;
  thumbnailUrl: string;
  sourcePageUrl: string;
  source?: string;
  width?: number;
  height?: number;
  fileSize?: string;
  query?: string; // Add source query identifier
}

type BingSafeSearchLevel = 'Off' | 'Moderate' | 'Strict';

export interface BingImageSearchToolArgs {
  description: string; // Brief description of what this search is for
  queries: string[];
  lang?: string;
  locale?: string;
  maxResults?: number;
  safeSearch?: BingSafeSearchLevel;
}

export interface BingImageSearchToolResult {
  success: boolean;
  totalQueries: number;
  totalResults: number;
  results: BingImageSearchResult[];
  errors?: string[];
  timestamp: string;
}

export class BingImageSearchTool {

  /**
   * Maximum number of queries executed concurrently within a single tool call.
   * Bounded to avoid the same-IP burst that makes Bing serve degraded result pages.
   * See ai.prompt/postmortem-bing-search-parallel-degradation.md.
   */
  private static readonly QUERY_CONCURRENCY = 2;

  /**
   * Get the actual configuration of the host machine
   */
  private static getHostMachineConfig(userLocale?: string): FingerprintConfig {
    // Get system locale
    const systemLocale = userLocale || process.env.LANG || "zh-CN";

    // Get system timezone
    const timezoneOffset = new Date().getTimezoneOffset();
    let timezoneId = "Asia/Shanghai"; // Default to Shanghai timezone

    // Roughly infer timezone from UTC offset
    if (timezoneOffset <= -480 && timezoneOffset > -600) {
      timezoneId = "Asia/Shanghai";
    } else if (timezoneOffset <= -540) {
      timezoneId = "Asia/Tokyo";
    } else if (timezoneOffset <= -420 && timezoneOffset > -480) {
      timezoneId = "Asia/Bangkok";
    } else if (timezoneOffset <= 0 && timezoneOffset > -60) {
      timezoneId = "Europe/London";
    } else if (timezoneOffset <= 60 && timezoneOffset > 0) {
      timezoneId = "Europe/Berlin";
    } else if (timezoneOffset <= 300 && timezoneOffset > 240) {
      timezoneId = "America/New_York";
    }

    // Detect system color scheme
    const hour = new Date().getHours();
    const colorScheme = hour >= 19 || hour < 7 ? ("dark" as const) : ("light" as const);

    // Use reasonable defaults for other settings
    const reducedMotion = "no-preference" as const;
    const forcedColors = "none" as const;

    // Select a suitable device name
    const platform = os.platform();
    let deviceName = "Desktop Chrome";

    if (platform === "darwin") {
      deviceName = "Desktop Safari";
    } else if (platform === "win32") {
      deviceName = "Desktop Edge";
    } else if (platform === "linux") {
      deviceName = "Desktop Firefox";
    }

    // Finally use Chrome
    deviceName = "Desktop Chrome";

    return {
      deviceName,
      locale: systemLocale,
      timezoneId,
      colorScheme,
      reducedMotion,
      forcedColors,
    };
  }

  /**
   * Get a random delay duration
   */
  private static getRandomDelay(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  /**
   * Check whether the page is stable (URL no longer changes)
   */
  private static async isPageStable(page: Page, checks: number = 1, delayMs: number = 500): Promise<boolean> {
    try {
      let previousUrl = page.url();

      for (let i = 0; i < checks; i++) {
        await page.waitForTimeout(delayMs);
        const currentUrl = page.url();

        if (currentUrl !== previousUrl) {
          logger.debug(`[BingImageSearchTool] Page URL changed: ${previousUrl} → ${currentUrl}`);
          return false;
        }

        previousUrl = currentUrl;
      }

      logger.debug(`[BingImageSearchTool] Page stability verified: ${previousUrl}`);
      return true;
    } catch (error) {
      logger.warn(`[BingImageSearchTool] Page stability check failed: ${String(error)}`);
      return false;
    }
  }

  /**
   * Clean HTML text content
   */
  private static cleanTextContent(html: string): string {
    if (!html) return '';

    return html
      .replace(/<[^>]*>/g, '') // Remove HTML tags
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ') // Replace multiple whitespace characters with a single space
      .trim();
  }

  /**
   * Decode HTML entities
   */
  private static decodeHTMLEntities(text: string): string {
    if (!text) return '';

    return text
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#x27;/g, "'")
      .replace(/&#x2F;/g, '/')
      .replace(/&nbsp;/g, ' ')
      .replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(dec))
      .replace(/&#x([0-9a-f]+);/gi, (match, hex) => String.fromCharCode(parseInt(hex, 16)));
  }

  /**
   * Clean URL, handle Bing redirect URLs
   */
  private static cleanUrl(rawUrl: string): string {
    if (!rawUrl) return '';

    // Handle base64-encoded URLs in Bing redirect URLs
    if (rawUrl.includes('bing.com/ck/a') && rawUrl.includes('&u=a')) {
      const match = rawUrl.match(/[&?]u=(a[12][A-Za-z0-9+/=]+)/);
      if (match) {
        const encodedUrl = match[1];
        const base64Part = encodedUrl.slice(2);

        try {
          const decodedUrl = Buffer.from(base64Part, 'base64').toString('utf8');
          return decodedUrl;
        } catch (error) {
          return rawUrl;
        }
      }
    }

    return rawUrl;
  }

  /**
   * Extract domain from HTML
   */
  private static extractDomainFromUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname;
    } catch {
      return url;
    }
  }

  /**
   * Uniformly convert potentially numeric fields to number
   */
  private static extractNumeric(value: any): number | undefined {
    if (typeof value === 'number') {
      return value;
    }
    if (typeof value === 'string') {
      const num = parseInt(value, 10);
      return Number.isFinite(num) ? num : undefined;
    }
    return undefined;
  }

  /**
   * Parse Bing image search results from HTML content
   */
  private static parseBingImageSearchResults(html: string, query: string, maxResults: number = 5): BingImageSearchResult[] {
    const results: BingImageSearchResult[] = [];

    try {
      // Find all image search entries (a.iusc)
      const iuscPattern = /<a[^>]*class="[^"]*iusc[^"]*"[^>]*m="([^"]*)"[^>]*>/g;
      const iuscMatches = Array.from(html.matchAll(iuscPattern));

      logger.debug(`[BingImageSearchTool] Found ${iuscMatches.length} image search result containers`);

      for (let i = 0; i < iuscMatches.length && results.length < maxResults; i++) {
        try {
          const metaAttr = iuscMatches[i][1];
          if (!metaAttr) continue;

          // Decode HTML entities and parse JSON
          const metaText = this.decodeHTMLEntities(metaAttr);
          const meta = JSON.parse(metaText);

          // Extract core fields: original image URL, thumbnail, source page, etc.
          const originalImageUrl = this.cleanUrl(meta.murl || meta.imgurl || '');
          const thumbnailUrl = this.cleanUrl(meta.turl || meta.thumbUrl || originalImageUrl);
          const sourcePageUrl = this.cleanUrl(meta.purl || meta.surl || meta.pgUrl || '');
          const title = this.cleanTextContent(meta.t || meta.title || '');
          const source = this.cleanTextContent(meta.s || meta.site || meta.desc || '');

          if (!thumbnailUrl) continue;

          // Parse image size information
          const sizeInfo = meta.size || meta.imgSize || meta.sz || undefined;
          let fileSize: string | undefined;
          if (typeof sizeInfo === 'string') {
            fileSize = sizeInfo;
          } else if (sizeInfo && typeof sizeInfo === 'object') {
            fileSize = sizeInfo.text || sizeInfo.display;
          }

          // Extract pixel dimensions
          const width = this.extractNumeric(meta.w || meta.width || meta.pixelWidth || meta.thumbWidth);
          const height = this.extractNumeric(meta.h || meta.height || meta.pixelHeight || meta.thumbHeight);

          // Build search result
          const result: BingImageSearchResult = {
            index: results.length + 1,
            title: title || `Image ${results.length + 1} for "${query}"`,
            thumbnailUrl: thumbnailUrl,
            sourcePageUrl: sourcePageUrl || thumbnailUrl,
            source: source || this.extractDomainFromUrl(thumbnailUrl),
            width: width,
            height: height,
            fileSize: fileSize,
            query: query
          };

          results.push(result);
          logger.debug(`[BingImageSearchTool] Parsing result # ${result.index} : "${result.title}"`);

        } catch (error) {
          logger.warn(`[BingImageSearchTool] Parsing result # ${i + 1} :`, String(error));
        }
      }

      return results;

    } catch (error) {
      logger.error(`[BingImageSearchTool] Failed to parse Bing image search results: ${String(error)}`);
      return [];
    }
  }

  /**
   * Execute Bing image search tool
   */
  static async execute(args: BingImageSearchToolArgs, options?: { signal?: AbortSignal; executionContext?: ToolExecutionContext | null }): Promise<BingImageSearchToolResult> {
    const validation = this.validateArgs(args);
    if (!validation.isValid) {
      return {
        success: false,
        totalQueries: 0,
        totalResults: 0,
        results: [],
        errors: [validation.error!],
        timestamp: new Date().toISOString()
      };
    }

    try {
      // 🔍 Check and ensure Playwright browser is installed before execution
      logger.debug('[BingImageSearchTool] Checking Playwright Chromium browser...');
      const browserCheck = await PlaywrightManager.getInstance().ensureBrowserInstalled();
      if (!browserCheck.installed) {
        logger.error('[BingImageSearchTool] Playwright Chromium browser not installed and auto-install failed');
        return {
          success: false,
          totalQueries: args.queries.length,
          totalResults: 0,
          results: [],
          errors: [`Playwright Chromium headless browser is not installed. Please run 'npx playwright install chromium-headless-shell' to install manually. Error: ${browserCheck.error || 'Unknown error'}`],
          timestamp: new Date().toISOString()
        };
      }
      logger.debug(`[BingImageSearchTool] Browser check passed${browserCheck.browserPath ? ': ' + browserCheck.browserPath : ''}`);

      const allResults: BingImageSearchResult[] = [];
      const errors: string[] = [];

      // Device list - one is picked at random per query context to vary fingerprints.
      const deviceList = ['Desktop Chrome', 'Desktop Edge', 'Desktop Firefox', 'Desktop Safari'];

      // External abort signal support
      const signal = options?.signal;
      // Genuine per-query progress resets the central no-response watchdog so a long
      // multi-query search is governed by the no-response budget, not an effective total cap.
      const reportActivity = options?.executionContext?.reportActivity;
      let abortHandler: (() => void) | undefined;
      if (signal) {
        if (signal.aborted) throw new Error('Bing image search aborted');
        abortHandler = () => {
          logger.debug('[BingImageSearchTool] External abort signal received');
        };
        signal.addEventListener('abort', abortHandler, { once: true });
      }

      // Fixed internal navigation timeout (ms). Not agent-configurable: the unified
      // 10-minute no-response watchdog governs overall tool runtime; this only bounds a
      // single page navigation so a dead endpoint fails fast.
      const timeoutMs = 60000;

      // Launch ONE shared browser for the whole call. Per-query isolation is achieved
      // with a fresh browser.newContext() (see performSingleImageSearch); we no longer
      // launch a browser per query or persist any shared state file, both of which
      // caused a same-IP burst + state-file race that degraded results to ~1 junk hit
      // per query. See ai.prompt/postmortem-bing-search-parallel-degradation.md.
      let browser: Browser;
      try {
        browser = await this.launchHeadlessBrowser(timeoutMs);
      } catch (error) {
        if (signal && abortHandler) signal.removeEventListener('abort', abortHandler);
        logger.error(`[BingImageSearchTool] Failed to launch browser: ${String(error)}`);
        return {
          success: false,
          totalQueries: args.queries.length,
          totalResults: 0,
          results: [],
          errors: [`Failed to launch browser: ${String(error)}`],
          timestamp: new Date().toISOString()
        };
      }

      try {
        // Run queries with bounded concurrency to avoid the same-IP burst.
        const searchResults = await this.runWithConcurrency(
          args.queries,
          this.QUERY_CONCURRENCY,
          async (query) => {
            try {
              const results = await this.performSingleImageSearch(
                browser,
                query,
                args.lang || 'en',
                args.locale || 'us',
                deviceList,
                timeoutMs,
                args.maxResults || 5,
                args.safeSearch || 'Moderate',
                signal
              );
              return { query, results, error: null as string | null };
            } catch (error) {
              const errorMsg = `Search query "${query}" failed: ${String(error)}`;
              logger.error(`[BingImageSearchTool] ${errorMsg}`);
              return { query, results: [] as BingImageSearchResult[], error: errorMsg };
            } finally {
              // Each settled query (success or failure) is real progress; reset the
              // central no-response watchdog so an actively-advancing search is not idle-killed.
              reportActivity?.();
            }
          }
        );

        // Aggregate results in original query order.
        searchResults.forEach(({ results, error }) => {
          allResults.push(...results);
          if (error) {
            errors.push(error);
          }
        });
      } finally {
        if (signal && abortHandler) signal.removeEventListener('abort', abortHandler);
        await browser.close().catch((closeError) => {
          logger.warn(`[BingImageSearchTool] Failed to close shared browser: ${String(closeError)}`);
        });
      }


      return {
        success: true,
        totalQueries: args.queries.length,
        totalResults: allResults.length,
        results: allResults,
        errors: errors.length > 0 ? errors : undefined,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      logger.error(`[BingImageSearchTool] Search execution failed: ${String(error)}`);
      return {
        success: false,
        totalQueries: args.queries.length,
        totalResults: 0,
        results: [],
        errors: [`Search execution failed: ${String(error)}`],
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Execute a single image search query (using Playwright browser)
   */
  private static async performSingleImageSearch(
    browser: Browser,
    query: string,
    lang: string,
    locale: string,
    deviceList: string[],
    timeout: number,
    maxResults: number = 5,
    safeSearch: BingSafeSearchLevel = 'Moderate',
    externalSignal?: AbortSignal
  ): Promise<BingImageSearchResult[]> {

    // Pick a desktop device profile at random so each query context varies its fingerprint.
    const getDeviceConfig = (): [string, any] => {
      const randomDevice = deviceList[Math.floor(Math.random() * deviceList.length)];
      return [randomDevice, devices[randomDevice]];
    };

    // One isolated attempt: fresh context (no shared cookies, no persisted state),
    // navigate, parse, then tear the context down. The shared browser is owned by
    // execute() and is intentionally NOT closed here.
    const attempt = async (): Promise<BingImageSearchResult[]> => {
      if (externalSignal?.aborted) {
        throw new Error('Bing image search aborted');
      }

      const [deviceName, deviceConfig] = getDeviceConfig();
      logger.debug(`[BingImageSearchTool] Using device configuration: ${deviceName}`);

      // Always build a fresh fingerprint; nothing is persisted across queries.
      const hostConfig = this.getHostMachineConfig();
      const contextOptions: BrowserContextOptions = {
        ...deviceConfig,
        locale: hostConfig.locale,
        timezoneId: hostConfig.timezoneId,
        colorScheme: hostConfig.colorScheme,
        reducedMotion: hostConfig.reducedMotion,
        forcedColors: hostConfig.forcedColors,
        permissions: ['geolocation', 'notifications'],
        acceptDownloads: true,
        isMobile: false,
        hasTouch: false,
        javaScriptEnabled: true
      };

      // Fresh, isolated context. No storageState is loaded, so queries cannot
      // cross-contaminate cookies or ranking personalization.
      const context = await browser.newContext(contextOptions);

      // Anti-detection init script (context-level).
      // The callback below is serialized by Playwright and executed inside the
      // browser page, not in this process. It references browser-only globals
      // (window, WebGLRenderingContext) and can never run under Vitest's node
      // environment, so it is excluded from coverage.
      /* v8 ignore start */
      await context.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en', 'zh-CN'] });
        (window as any).chrome = {
          runtime: {},
          loadTimes: function () {},
          csi: function () {},
          app: {}
        };
        if (typeof WebGLRenderingContext !== 'undefined') {
          const getParameter = WebGLRenderingContext.prototype.getParameter;
          WebGLRenderingContext.prototype.getParameter = function (parameter: number) {
            if (parameter === 37445) return 'Intel Inc.';
            if (parameter === 37446) return 'Intel Iris OpenGL Engine';
            return getParameter.call(this, parameter);
          };
        }
      });
      /* v8 ignore stop */

      const page = await context.newPage();

      // Register external abort signal to close the page, which causes page.goto() to throw.
      let pageAbortHandler: (() => void) | undefined;
      if (externalSignal) {
        pageAbortHandler = () => { page.close().catch(() => {}); };
        externalSignal.addEventListener('abort', pageAbortHandler, { once: true });
      }

      // Set additional page properties.
      // Browser-only init script (see note above); excluded from coverage.
      /* v8 ignore start */
      await page.addInitScript(() => {
        Object.defineProperty(window.screen, 'width', { get: () => 1920 });
        Object.defineProperty(window.screen, 'height', { get: () => 1080 });
        Object.defineProperty(window.screen, 'colorDepth', { get: () => 24 });
        Object.defineProperty(window.screen, 'pixelDepth', { get: () => 24 });
      });
      /* v8 ignore stop */

      try {
        // Calculate the number of requested images.
        const count = Math.min(Math.max(maxResults * 2, maxResults), 50);

        const searchUrl = `https://www.bing.com/images/search?q=${encodeURIComponent(query)}&setlang=${lang}&cc=${locale}&safesearch=${safeSearch}&count=${count}`;
        logger.debug(`[BingImageSearchTool] Navigating to Bing image search page: ${searchUrl}`);

        // Use domcontentloaded instead of networkidle to avoid long waits for async resources.
        await page.goto(searchUrl, {
          timeout,
          waitUntil: 'domcontentloaded'
        });

        // Wait for the image result container to appear instead of waiting for networkidle.
        try {
          await page.waitForSelector('.dgControl, .iusc, .mimg, img.mimg', { timeout: 10000 });
          logger.debug('[BingImageSearchTool] Image result container appeared');
        } catch {
          logger.warn('[BingImageSearchTool] Standard image result container not found, continuing...');
        }

        // Wait for page to stabilize.
        await page.waitForTimeout(1000);
        const isStable = await this.isPageStable(page);
        if (!isStable) {
          logger.warn('[BingImageSearchTool] Page is still navigating, waiting longer...');
          await page.waitForTimeout(2000);
          await this.isPageStable(page);
        }

        const fullHtml = await page.content();
        logger.debug(`[BingImageSearchTool] HTML content stats: full length ${fullHtml.length}`);

        return this.parseBingImageSearchResults(fullHtml, query, maxResults);
      } finally {
        await page.close().catch(() => {});
        await context.close().catch(() => {});
        if (externalSignal && pageAbortHandler) {
          externalSignal.removeEventListener('abort', pageAbortHandler);
        }
      }
    };

    let results = await attempt();

    // Self-heal a degraded/anti-bot page. A single result is suspicious only
    // when the caller requested room for more than one result.
    if (results.length === 0 || (maxResults > 1 && results.length <= 1)) {
      logger.warn(`[BingImageSearchTool] Query "${query}" returned ${results.length} result(s); retrying once in a fresh context...`);
      const retryResults = await attempt();
      if (retryResults.length > results.length) {
        results = retryResults;
      }
    }

    return results;
  }

  /**
   * Launch the single shared headless browser used for every query in one call.
   * Per-query isolation comes from browser.newContext(), not from separate browsers.
   */
  private static async launchHeadlessBrowser(timeout: number): Promise<Browser> {
    return PlaywrightManager.getInstance().launchBrowser({
      headless: true,
      timeout: timeout * 2,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-site-isolation-trials',
        '--disable-web-security',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
        '--hide-scrollbars',
        '--mute-audio',
        '--disable-background-networking',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-breakpad',
        '--disable-component-extensions-with-background-pages',
        '--disable-extensions',
        '--disable-features=TranslateUI',
        '--disable-ipc-flooding-protection',
        '--disable-renderer-backgrounding',
        '--enable-features=NetworkService,NetworkServiceInProcess',
        '--force-color-profile=srgb',
        '--metrics-recording-only'
      ],
      ignoreDefaultArgs: ['--enable-automation']
    });
  }

  /**
   * Run an async worker over items with a bounded number of concurrent executions,
   * preserving input order in the returned results. The worker is expected to handle
   * its own errors; any thrown error rejects the whole batch.
   */
  private static async runWithConcurrency<T, R>(
    items: T[],
    limit: number,
    worker: (item: T, index: number) => Promise<R>
  ): Promise<R[]> {
    const results: R[] = new Array(items.length);
    const pool = Math.max(1, Math.min(limit, items.length));
    let cursor = 0;
    const runNext = async (): Promise<void> => {
      while (cursor < items.length) {
        const index = cursor++;
        results[index] = await worker(items[index], index);
      }
    };
    const runners: Promise<void>[] = [];
    for (let i = 0; i < pool; i++) {
      runners.push(runNext());
    }
    await Promise.all(runners);
    return results;
  }

  /**
   * Get tool definition (for registration with BuiltinToolsManager)
   */
  static getDefinition(): BuiltinToolDefinition {
    return {
      name: 'bing_image_search',
      description: `Search images using Bing image search with advanced browser automation. Supports multiple queries and returns up to 5 results per query. Each result includes the thumbnail URL, source page, and metadata.

Features:
- Advanced browser automation with anti-detection measures
- A fresh, isolated browser session per query (no cross-query state)
- Automatic handling of page navigation
- Support for safe search levels (Off, Moderate, Strict)

IMPORTANT: Language and locale detection:
- If the query contains Chinese characters, set lang="zh" and locale="cn"
- Otherwise use lang="en" and locale="us"
- Adjust safeSearch when necessary (Off, Moderate, Strict)`,
      inputSchema: {
        type: 'object',
        properties: {
          description: {
            type: 'string',
            description: 'A brief description of what this image search is for (for UI display). E.g., "Finding product images", "Searching for icons"'
          },
          queries: {
            type: 'array',
            items: {
              type: 'string'
            },
            description: 'Array of search queries to execute in parallel',
            minItems: 1,
            maxItems: 10
          },
          lang: {
            type: 'string',
            description: 'Search language code. Use "zh" for Chinese queries, "en" for all others (default: "en")',
            enum: ['en', 'zh'],
            default: 'en'
          },
          locale: {
            type: 'string',
            description: 'Search locale/region code. Use "cn" for Chinese queries, "us" for all others (default: "us")',
            enum: ['us', 'cn'],
            default: 'us'
          },
          maxResults: {
            type: 'number',
            description: 'Maximum number of results to return per query (default: 5, max: 20)',
            minimum: 1,
            maximum: 20,
            default: 5
          },
          safeSearch: {
            type: 'string',
            description: 'Safe search level (Off, Moderate, Strict)',
            enum: ['Off', 'Moderate', 'Strict'],
            default: 'Moderate'
          }
        },
        required: ['description', 'queries']
      }
    };
  }

  /**
   * Validate parameters
   */
  private static validateArgs(args: BingImageSearchToolArgs): { isValid: boolean; error?: string } {
    // Validate queries
    if (!args.queries || !Array.isArray(args.queries)) {
      return { isValid: false, error: 'queries is required and must be an array' };
    }

    // queries must not be empty
    if (args.queries.length === 0) {
      return { isValid: false, error: 'queries array cannot be empty' };
    }

    if (args.queries.length > 10) {
      return { isValid: false, error: 'queries array cannot contain more than 10 items' };
    }

    // Each query must be a non-empty string
    for (let i = 0; i < args.queries.length; i++) {
      if (typeof args.queries[i] !== 'string' || args.queries[i].trim().length === 0) {
        return { isValid: false, error: `Query at index ${i} must be a non-empty string` };
      }
    }

    // Validate maxResults range
    if (args.maxResults !== undefined) {
      if (!Number.isInteger(args.maxResults) || args.maxResults < 1 || args.maxResults > 20) {
        return { isValid: false, error: 'maxResults must be an integer between 1 and 20' };
      }
    }

    // Validate lang parameter
    if (args.lang !== undefined && !['en', 'zh'].includes(args.lang)) {
      return { isValid: false, error: 'lang must be either "en" or "zh"' };
    }

    // Validate locale parameter
    if (args.locale !== undefined && !['us', 'cn'].includes(args.locale)) {
      return { isValid: false, error: 'locale must be either "us" or "cn"' };
    }

    // Validate safeSearch enum
    if (args.safeSearch !== undefined && !['Off', 'Moderate', 'Strict'].includes(args.safeSearch)) {
      return { isValid: false, error: 'safeSearch must be one of Off, Moderate, Strict' };
    }

    return { isValid: true };
  }
}
