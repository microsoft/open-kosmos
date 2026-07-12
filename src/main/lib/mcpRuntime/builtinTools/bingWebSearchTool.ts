/**
 * BingWebSearchTool built-in tool - uses Playwright browser automation
 * Provides LLM-callable Bing web search with parallel search support and result merging
 * Note: This is a built-in tool, not an MCP protocol tool
 */

import { BuiltinToolDefinition, ToolExecutionResult } from './types';
import { Browser, Page, devices, BrowserContextOptions } from 'playwright-core';
import { getUnifiedLogger } from '../../unifiedLogger';
import { PlaywrightManager } from '../../playwright';
import * as os from 'os';
import { WebSearchResultItem, WebSearchToolArgs, WebSearchToolResult } from '@shared/types/toolCallArgs';
import type { ToolExecutionContext } from '../../subAgent/types';

export type BingSearchResult = WebSearchResultItem;
export type BingWebSearchToolArgs = Omit<WebSearchToolArgs, 'timeout'> & { lang: string; locale: string; };
export type BingWebSearchToolResult = WebSearchToolResult;

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

export class BingWebSearchTool {

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
          logger.debug(`[BingWebSearchTool] Page URL changed: ${previousUrl} → ${currentUrl}`);
          return false;
        }

        previousUrl = currentUrl;
      }

      logger.debug(`[BingWebSearchTool] Page stability verified: ${previousUrl}`);
      return true;
    } catch (error) {
      logger.warn(`[BingWebSearchTool] Page stability check failed: ${String(error)}`);
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
   * Parse Bing search results from HTML content
   */
  private static parseBingSearchResults(html: string, query: string, maxResults: number = 5): BingSearchResult[] {
    const results: BingSearchResult[] = [];

    try {
      // Find all search result items (li.b_algo)
      const algoPattern = /<li[^>]*class="[^"]*b_algo[^"]*"[^>]*>(.*?)<\/li>/gs;
      const algoMatches = Array.from(html.matchAll(algoPattern));

      logger.debug(`[BingWebSearchTool] Found ${algoMatches.length} search result containers`);

      for (let i = 0; i < algoMatches.length && results.length < maxResults; i++) {
        try {
          const algoHtml = algoMatches[i][1];

          // Extract title and link
          const titlePattern = /<h2[^>]*>.*?<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/s;
          const titleMatch = algoHtml.match(titlePattern);

          if (!titleMatch) continue;

          const url = this.cleanUrl(titleMatch[1]);
          const title = this.cleanTextContent(titleMatch[2]);

          if (!title || !url || !url.startsWith('http')) continue;

          // Extract description (caption)
          const captionPattern = /<p[^>]*class="[^"]*b_lineclamp[^"]*"[^>]*>(.*?)<\/p>/s;
          const captionMatch = algoHtml.match(captionPattern);
          const caption = captionMatch ? this.cleanTextContent(captionMatch[1]) : '';

          // Extract site source
          const sitePattern = /<cite[^>]*>(.*?)<\/cite>/s;
          const siteMatch = algoHtml.match(sitePattern);
          const site = siteMatch ? this.cleanTextContent(siteMatch[1]) : '';

          // Build search result
          const result: BingSearchResult = {
            index: results.length + 1,
            title: title,
            url: url,
            caption: caption || '',
            site: site || this.extractDomainFromUrl(url),
            query: query
          };

          results.push(result);
          logger.debug(`[BingWebSearchTool] Parsing result # ${result.index} : "${result.title}"`);

        } catch (error) {
          logger.warn(`[BingWebSearchTool] Parsing result # ${i + 1} :`, String(error));
        }
      }

      return results;

    } catch (error) {
      logger.error(`[BingWebSearchTool] Failed to parse Bing search results: ${String(error)}`);
      return [];
    }
  }

  /**
   * Execute Bing web search tool
   * Static method, supports direct LLM invocation
   */
  static async execute(args: BingWebSearchToolArgs, options?: { signal?: AbortSignal; executionContext?: ToolExecutionContext | null }): Promise<BingWebSearchToolResult> {
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
      logger.debug('[BingWebSearchTool] Checking Playwright Chromium browser...');
      const browserCheck = await PlaywrightManager.getInstance().ensureBrowserInstalled();
      if (!browserCheck.installed) {
        logger.error('[BingWebSearchTool] Playwright Chromium browser not installed and auto-install failed');
        return {
          success: false,
          totalQueries: args.queries.length,
          totalResults: 0,
          results: [],
          errors: [`Playwright Chromium headless browser is not installed. Please run 'npx playwright install chromium-headless-shell' to install manually. Error: ${browserCheck.error || 'Unknown error'}`],
          timestamp: new Date().toISOString()
        };
      }
      logger.debug(`[BingWebSearchTool] Browser check passed${browserCheck.browserPath ? ': ' + browserCheck.browserPath : ''}`);

      const allResults: BingSearchResult[] = [];
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
        if (signal.aborted) throw new Error('Bing search aborted');
        abortHandler = () => {
          logger.debug('[BingWebSearchTool] External abort signal received');
        };
        signal.addEventListener('abort', abortHandler, { once: true });
      }

      // Fixed internal navigation timeout (ms). Not agent-configurable: the unified
      // 10-minute no-response watchdog governs overall tool runtime; this only bounds a
      // single page navigation so a dead endpoint fails fast.
      const timeoutMs = 60000;

      // Launch ONE shared browser for the whole call. Per-query isolation is achieved
      // with a fresh browser.newContext() (see performSingleSearch); we no longer launch
      // a browser per query or persist any shared state file, both of which caused a
      // same-IP burst + state-file race that degraded results to ~1 junk hit per query.
      // See ai.prompt/postmortem-bing-search-parallel-degradation.md.
      let browser: Browser;
      try {
        browser = await this.launchHeadlessBrowser(timeoutMs);
      } catch (error) {
        if (signal && abortHandler) signal.removeEventListener('abort', abortHandler);
        logger.error(`[BingWebSearchTool] Failed to launch browser: ${String(error)}`);
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
              const results = await this.performSingleSearch(
                browser,
                query,
                args.lang,
                args.locale,
                deviceList,
                timeoutMs,
                args.maxResults || 5,
                signal
              );
              return { query, results, error: null as string | null };
            } catch (error) {
              const errorMsg = `Search query "${query}" failed: ${String(error)}`;
              logger.error(`[BingWebSearchTool] ${errorMsg}`);
              return { query, results: [] as BingSearchResult[], error: errorMsg };
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
          logger.warn(`[BingWebSearchTool] Failed to close shared browser: ${String(closeError)}`);
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
      logger.error(`[BingWebSearchTool] Search execution failed: ${String(error)}`);
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
   * Execute a single search query (using Playwright browser)
   */
  private static async performSingleSearch(
    browser: Browser,
    query: string,
    lang: string,
    locale: string,
    deviceList: string[],
    timeout: number,
    maxResults: number = 5,
    externalSignal?: AbortSignal
  ): Promise<BingSearchResult[]> {

    // Pick a desktop device profile at random so each query context varies its fingerprint.
    const getDeviceConfig = (): [string, any] => {
      const randomDevice = deviceList[Math.floor(Math.random() * deviceList.length)];
      return [randomDevice, devices[randomDevice]];
    };

    // One isolated attempt: fresh context (no shared cookies, no persisted state),
    // navigate, parse, then tear the context down. The shared browser is owned by
    // execute() and is intentionally NOT closed here.
    const attempt = async (): Promise<BingSearchResult[]> => {
      if (externalSignal?.aborted) {
        throw new Error('Bing search aborted');
      }

      const [deviceName, deviceConfig] = getDeviceConfig();
      logger.debug(`[BingWebSearchTool] Using device configuration: ${deviceName}`);

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
        const searchUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=${lang}&cc=${locale}`;
        logger.debug(`[BingWebSearchTool] Navigating to Bing search page: ${searchUrl}`);

        // Use domcontentloaded instead of networkidle to avoid long waits for async resources.
        await page.goto(searchUrl, {
          timeout,
          waitUntil: 'domcontentloaded'
        });

        // Wait for the search results container instead of waiting for all network requests.
        try {
          await page.waitForSelector('li.b_algo', { timeout: Math.min(timeout, 30000) });
          logger.debug('[BingWebSearchTool] Search results appeared');
        } catch {
          logger.warn('[BingWebSearchTool] Timed out waiting for search results selector, trying to continue...');
        }
        await page.waitForLoadState('domcontentloaded', { timeout });

        // Wait for page to stabilize.
        await page.waitForTimeout(1500);
        const isStable = await this.isPageStable(page);
        if (!isStable) {
          logger.warn('[BingWebSearchTool] Page is still navigating, waiting longer...');
          await page.waitForTimeout(2000);
          await this.isPageStable(page);
        }

        const fullHtml = await page.content();

        // Remove CSS and JavaScript content, keep only pure HTML.
        let html = fullHtml.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
        html = html.replace(/<link\s+[^>]*rel=["']stylesheet["'][^>]*>/gi, '');
        html = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');

        logger.debug(`[BingWebSearchTool] HTML content stats: original length ${fullHtml.length}, cleaned length ${html.length}`);

        return this.parseBingSearchResults(html, query, maxResults);
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
      logger.warn(`[BingWebSearchTool] Query "${query}" returned ${results.length} result(s); retrying once in a fresh context...`);
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
      name: 'bing_web_search',
      description: 'Search the web using Bing search engine with advanced browser automation. Supports multiple queries and returns up to 5 results per query. Results include title, URL, description, and source site.\n\nFeatures:\n- Advanced browser automation with anti-detection measures\n- A fresh, isolated browser session per query (no cross-query state)\n- Automatic handling of page navigation\n\nIMPORTANT: Language and locale detection:\n- If the user query contains Chinese characters, set lang="zh" and locale="cn"\n- For all other cases (English, numbers, symbols, etc.), use lang="en" and locale="us"\n- The AI model should analyze the query content and determine the appropriate language parameters before calling this tool',
      inputSchema: {
        type: 'object',
        properties: {
          description: {
            type: 'string',
            description: 'A brief description of what this search is for (for UI display). E.g., "Searching for latest news", "Finding documentation"'
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
            description: 'Search language code. REQUIRED - Use "zh" for Chinese queries, "en" for all others',
            enum: ['en', 'zh']
          },
          locale: {
            type: 'string',
            description: 'Search locale/region code. REQUIRED - Use "cn" for Chinese queries, "us" for all others',
            enum: ['us', 'cn']
          },
          maxResults: {
            type: 'number',
            description: 'Maximum number of results to return per query (default: 5)',
            minimum: 1,
            maximum: 10,
            default: 5
          }
        },
        required: ['description', 'queries', 'lang', 'locale']
      }
    };
  }

  /**
   * Validate parameters
   */
  private static validateArgs(args: BingWebSearchToolArgs): { isValid: boolean; error?: string } {
    // Validate queries
    if (!args.queries || !Array.isArray(args.queries)) {
      return { isValid: false, error: 'queries is required and must be an array' };
    }

    if (args.queries.length === 0) {
      return { isValid: false, error: 'queries array cannot be empty' };
    }

    if (args.queries.length > 10) {
      return { isValid: false, error: 'queries array cannot contain more than 10 items' };
    }

    for (let i = 0; i < args.queries.length; i++) {
      if (typeof args.queries[i] !== 'string' || args.queries[i].trim().length === 0) {
        return { isValid: false, error: `Query at index ${i} must be a non-empty string` };
      }
    }

    // Validate maxResults
    if (args.maxResults !== undefined) {
      if (!Number.isInteger(args.maxResults) || args.maxResults < 1 || args.maxResults > 10) {
        return { isValid: false, error: 'maxResults must be an integer between 1 and 10' };
      }
    }

    // Validate lang (REQUIRED)
    if (!args.lang) {
      return { isValid: false, error: 'lang is required' };
    }
    if (!['en', 'zh'].includes(args.lang)) {
      return { isValid: false, error: 'lang must be either "en" or "zh"' };
    }

    // Validate locale (REQUIRED)
    if (!args.locale) {
      return { isValid: false, error: 'locale is required' };
    }
    if (!['us', 'cn'].includes(args.locale)) {
      return { isValid: false, error: 'locale must be either "us" or "cn"' };
    }

    return { isValid: true };
  }
}