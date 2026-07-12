/**
 * GoogleImageSearchTool built-in tool - implemented following googleWebSearchTool
 * Provides LLM-callable Google image search with parallel search support and result merging
 * @deprecated Deprecated and unregistered from BuiltinToolsManager; retained for legacy reference only.
 * Note: This is a built-in tool, not an MCP protocol tool
 */

import { BuiltinToolDefinition, ToolExecutionResult } from './types';
import { Browser, Page, BrowserContext, devices, BrowserContextOptions } from 'playwright-core';
import { getUnifiedLogger } from '../../unifiedLogger';
import { PlaywrightManager } from '../../playwright';
import * as fs from 'fs';
import * as path from 'path';
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

// Saved state file interface
interface SavedState {
  fingerprint?: FingerprintConfig;
  googleDomain?: string;
}

// Search options interface
interface SearchOptions {
  timeout?: number;
  stateFile?: string;
  noSaveState?: boolean;
  locale?: string;
}

// HTML response interface
interface HtmlResponse {
  query: string;
  html: string;
  url: string;
  savedPath?: string;
  screenshotPath?: string;
  originalHtmlLength?: number;
}

export interface GoogleImageSearchResult {
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

export interface GoogleImageSearchToolArgs {
  description: string; // Brief description of what this search is for
  queries: string[]; // Array of search queries, supports multiple keywords
  maxResults?: number; // Maximum results per query, default 5
  timeout?: number; // Request timeout in ms, default 300000
}

export interface GoogleImageSearchToolResult {
  success: boolean;
  totalQueries: number;
  totalResults: number;
  results: GoogleImageSearchResult[];
  errors?: string[];
  timestamp: string;
}

export class GoogleImageSearchTool {

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
   * Used to avoid race condition errors from calling page.content() during page navigation
   */
  private static async isPageStable(page: Page, checks: number = 1, delayMs: number = 500): Promise<boolean> {
    try {
      let previousUrl = page.url();

      for (let i = 0; i < checks; i++) {
        await page.waitForTimeout(delayMs);
        const currentUrl = page.url();

        if (currentUrl !== previousUrl) {
          logger.debug(`[GoogleImageSearchTool] Page URL changed: ${previousUrl} → ${currentUrl}`);
          return false;
        }

        previousUrl = currentUrl;
      }

      logger.debug(`[GoogleImageSearchTool] Page stability verified: ${previousUrl}`);
      return true;
    } catch (error) {
      logger.warn(`[GoogleImageSearchTool] Page stability check failed: ${String(error)}`);
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
   * Clean URL
   */
  private static cleanUrl(url: string): string {
    if (!url) return '';

    // Handle Google redirect URLs
    if (url.includes('google.com/url?')) {
      const urlParams = new URLSearchParams(url.split('?')[1]);
      const realUrl = urlParams.get('url');
      if (realUrl) return realUrl;
    }

    return url;
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
   * Parse Google image search results from HTML content
   * Uses specific regular expressions to match the Google image data structure
   */
  private static parseGoogleImageSearchResults(html: string, query: string, maxResults: number = 5): GoogleImageSearchResult[] {
    const results: GoogleImageSearchResult[] = [];

    try {

      // // Save HTML content to a separate parse debug file
      // try {
      //   const debugDir = path.join(process.cwd(), 'debug');
      //   if (!fs.existsSync(debugDir)) {
      //     fs.mkdirSync(debugDir, { recursive: true });
      //   }

      //   const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      //   const querySlug = query.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_').substring(0, 50);

      //   // Save HTML content for parsing
      //   const parseHtmlPath = path.join(debugDir, `parse_debug_${querySlug}_${timestamp}.html`);
      //   fs.writeFileSync(parseHtmlPath, html, 'utf8');
      //   logger.debug(`[GoogleImageSearchTool] Parse debug HTML saved: ${parseHtmlPath}`);

      // } catch (debugError) {
      //   logger.warn('[GoogleImageSearchTool] Failed to save parse debug file:', String(debugError));
      // }

      // Specific pattern for Google image data:
      // [encrypted-url, w, h], [real-url, w, h], null, 0, "color", null, 0, {metadata}
      // Exact matching pattern based on actual HTML analysis:
      // ["https://encrypted-tbn0.gstatic.com/images?q\u003dtbn:ANd9GcQaMCnoCBL3LdOtopN1e6eI97Fk78Rb7MCu_Q\u0026s",236,213],["https://q5.itc.cn/images01/20240320/e2c7f95da03249c8afee7ca94a017404.jpeg",1196,1080],null,0,"rgb(152,114,82)",null,0,{"2000":[null,"www.sohu.com","68KB"],"2001":[null,null,null,3,9,null,9],"2003":[null,"LJNe5BB21_y0_M","https://www.sohu.com/a/765546267_121922110","盘点十种非常可爱的小猫咪你最喜欢哪一个品种呢_搜狐网"
      const imageDataRegex = /\["https:\/\/encrypted-tbn[^"]+",\d+,\d+\],\["([^"]+)",(\d+),(\d+)\],null,0,"[^"]*",null,0,\{"2000":\[null,"([^"]*)","[^"]*"\][^}]*"2003":\[null,"[^"]*","([^"]*)","([^"]*)"/g;

      let match;
      let index = 1;

      while ((match = imageDataRegex.exec(html)) !== null && index <= 20) {
        try {
          const [, imageUrl, width, height, domain, sourcePageUrl, title] = match;

          // Validate whether the URL is valid
          if (!imageUrl || imageUrl.startsWith('data:') || !imageUrl.startsWith('http')) {
            continue;
          }

          // Clean and validate each field
          const cleanedImageUrl = imageUrl.trim();
          const cleanedSourcePageUrl = sourcePageUrl ? sourcePageUrl.trim() : cleanedImageUrl;
          const cleanedDomain = domain ? domain.trim() : this.extractDomainFromUrl(cleanedImageUrl);
          const cleanedTitle = this.decodeHTMLEntities(title ? title.trim() : `Image ${index} for "${query}"`);

          // Build result object
          const result: GoogleImageSearchResult = {
            index: index,
            title: cleanedTitle,
            thumbnailUrl: cleanedImageUrl,
            sourcePageUrl: cleanedSourcePageUrl,
            source: cleanedDomain,
            width: parseInt(width, 10) || undefined,
            height: parseInt(height, 10) || undefined,
            query: query
          };

          results.push(result);
          index++;

          logger.debug(`[GoogleImageSearchTool] Extracted image ${index - 1}: ${result.thumbnailUrl.substring(0, 100)}...`);

          // Exit loop if maximum number of results has been reached
          if (results.length >= maxResults) {
            break;
          }

        } catch (e) {
          logger.warn(`[GoogleImageSearchTool] Failed to parse image data:`, e instanceof Error ? e.message : String(e));
          continue;
        }
      }

      return results;

    } catch (error) {
      logger.error(`[GoogleImageSearchTool] Failed to parse Google image search results: ${String(error)}`);
      return [];
    }
  }

  /**
   * Execute Google image search tool
   * Static method, supports direct LLM invocation
   */
  static async execute(args: GoogleImageSearchToolArgs): Promise<GoogleImageSearchToolResult> {
    try {
      // 🔍 Check and ensure Playwright browser is installed before execution
      logger.debug('[GoogleImageSearchTool] Checking Playwright Chromium browser...');
      const browserCheck = await PlaywrightManager.getInstance().ensureBrowserInstalled();
      if (!browserCheck.installed) {
        logger.error('[GoogleImageSearchTool] Playwright Chromium browser not installed and auto-install failed');
        return {
          success: false,
          totalQueries: args.queries.length,
          totalResults: 0,
          results: [],
          errors: [`Playwright Chromium headless browser is not installed. Please run 'npx playwright install chromium-headless-shell' to install manually. Error: ${browserCheck.error || 'Unknown error'}`],
          timestamp: new Date().toISOString()
        };
      }
      logger.debug(`[GoogleImageSearchTool] Browser check passed${browserCheck.browserPath ? ': ' + browserCheck.browserPath : ''}`);

      const allResults: GoogleImageSearchResult[] = [];
      const errors: string[] = [];

      // State file configuration
      const stateFile = path.join(os.tmpdir(), 'openkosmos-google-image-browser-state.json');
      const fingerprintFile = stateFile.replace('.json', '-fingerprint.json');

      // Load saved state
      let storageState: string | undefined = undefined;
      let savedState: SavedState = {};

      if (fs.existsSync(stateFile)) {
        logger.debug('[GoogleImageSearchTool] Browser state file found');

        // Validate that the state file has valid JSON format
        try {
          const stateContent = fs.readFileSync(stateFile, 'utf8');
          JSON.parse(stateContent); // Validate JSON format
          storageState = stateFile;
          logger.debug('[GoogleImageSearchTool] Browser state file validated');
        } catch (e) {
          logger.warn(`[GoogleImageSearchTool] Browser state file is corrupted, deleting and recreating: ${String(e)}`);
          try {
            fs.unlinkSync(stateFile);
            logger.debug('[GoogleImageSearchTool] Corrupted state file deleted');
          } catch (deleteError) {
            logger.warn(`[GoogleImageSearchTool] Unable to delete corrupted state file: ${String(deleteError)}`);
          }
          storageState = undefined;
        }

        if (fs.existsSync(fingerprintFile)) {
          try {
            const fingerprintData = fs.readFileSync(fingerprintFile, 'utf8');
            savedState = JSON.parse(fingerprintData);
            logger.debug('[GoogleImageSearchTool] Loaded saved browser fingerprint configuration');
          } catch (e) {
            logger.warn('[GoogleImageSearchTool] Unable to load fingerprint config file, will create new fingerprint');
            // If the fingerprint file is also corrupted, delete it
            try {
              fs.unlinkSync(fingerprintFile);
              logger.debug('[GoogleImageSearchTool] Corrupted fingerprint file deleted');
            } catch (deleteError) {
              // Ignore deletion failure
            }
          }
        }
      } else {
        logger.debug('[GoogleImageSearchTool] No browser state file found, creating new browser session');
      }

      // Device and domain lists
      const deviceList = ['Desktop Chrome', 'Desktop Edge', 'Desktop Firefox', 'Desktop Safari'];
      const googleDomains = [
        'https://www.google.com/imghp',
        'https://www.google.co.uk/imghp',
        'https://www.google.ca/imghp',
        'https://www.google.com.au/imghp'
      ];

      // Process each query in parallel

      const searchPromises = args.queries.map(async (query, queryIndex) => {

        try {
          const results = await this.performSingleImageSearch(
            query,
            deviceList,
            googleDomains,
            savedState,
            storageState,
            stateFile,
            fingerprintFile,
            (args.timeout ? args.timeout * 1000 : 300000),
            args.maxResults || 5
          );

          return { query, results, error: null };

        } catch (error) {
          const errorMsg = `Search query "${query}" failed: ${String(error)}`;
          logger.error(`[GoogleImageSearchTool] ${errorMsg}`);
          return { query, results: [], error: errorMsg };
        }
      });

      // Wait for all searches to complete
      const searchResults = await Promise.allSettled(searchPromises);

      // Process search results
      searchResults.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          const { query, results, error } = result.value;
          allResults.push(...results);
          if (error) {
            errors.push(error);
          }
        } else {
          const query = args.queries[index];
          const errorMsg = `Search query "${query}" failed: ${String(result.reason)}`;
          logger.error(`[GoogleImageSearchTool] ${errorMsg}`);
          errors.push(errorMsg);
        }
      });


      return {
        success: true,
        totalQueries: args.queries.length,
        totalResults: allResults.length,
        results: allResults,
        errors: errors.length > 0 ? errors : undefined,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      logger.error(`[GoogleImageSearchTool] Search execution failed: ${String(error)}`);
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
   * Execute a single image search query (following googleWebSearchTool logic)
   */
  private static async performSingleImageSearch(
    query: string,
    deviceList: string[],
    googleDomains: string[],
    savedState: SavedState,
    storageState: string | undefined,
    stateFile: string,
    fingerprintFile: string,
    timeout: number,
    maxResults: number = 5
  ): Promise<GoogleImageSearchResult[]> {

    // Get device configuration
    const getDeviceConfig = (): [string, any] => {
      if (savedState.fingerprint?.deviceName && devices[savedState.fingerprint.deviceName]) {
        return [savedState.fingerprint.deviceName, devices[savedState.fingerprint.deviceName]];
      } else {
        const randomDevice = deviceList[Math.floor(Math.random() * deviceList.length)];
        return [randomDevice, devices[randomDevice]];
      }
    };

    // Define search function (headless mode only)
    const performSearchAndGetHtml = async (): Promise<string> => {
      logger.debug('[GoogleImageSearchTool] Starting browser (headless mode)...');

      // Initialize browser — use PlaywrightManager instead of direct import,
      // so that path changes or browser deletion trigger the auto-reinstall logic.
      const browser = await PlaywrightManager.getInstance().launchBrowser({
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

      try {
        // Get device configuration
        const [deviceName, deviceConfig] = getDeviceConfig();
        logger.debug(`[GoogleImageSearchTool] Using device configuration: ${deviceName}`);

        // Create browser context options
        let contextOptions: BrowserContextOptions = {
          ...deviceConfig
        };

        // Use saved fingerprint config if available; otherwise use host machine actual settings
        if (savedState.fingerprint) {
          contextOptions = {
            ...contextOptions,
            locale: savedState.fingerprint.locale,
            timezoneId: savedState.fingerprint.timezoneId,
            colorScheme: savedState.fingerprint.colorScheme,
            reducedMotion: savedState.fingerprint.reducedMotion,
            forcedColors: savedState.fingerprint.forcedColors
          };
          logger.debug('[GoogleImageSearchTool] Using saved browser fingerprint configuration');
        } else {
          // Get actual host machine settings
          const hostConfig = this.getHostMachineConfig();

          contextOptions = {
            ...contextOptions,
            locale: hostConfig.locale,
            timezoneId: hostConfig.timezoneId,
            colorScheme: hostConfig.colorScheme,
            reducedMotion: hostConfig.reducedMotion,
            forcedColors: hostConfig.forcedColors
          };

          // Save newly generated fingerprint configuration
          savedState.fingerprint = hostConfig;
          logger.debug(`[GoogleImageSearchTool] Generated new browser fingerprint configuration: ${hostConfig.locale}, ${hostConfig.timezoneId}`);
        }

        // Add common options - ensure desktop configuration is used
        contextOptions = {
          ...contextOptions,
          permissions: ['geolocation', 'notifications'],
          acceptDownloads: true,
          isMobile: false,
          hasTouch: false,
          javaScriptEnabled: true
        };

        const context = await browser.newContext(
          storageState ? { ...contextOptions, storageState } : contextOptions
        );

        // Set extra browser properties to avoid detection
        await context.addInitScript(() => {
          // Override navigator properties
          Object.defineProperty(navigator, 'webdriver', { get: () => false });
          Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
          Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en', 'zh-CN'] });

          // Override window properties
          (window as any).chrome = {
            runtime: {},
            loadTimes: function () {},
            csi: function () {},
            app: {}
          };

          // Add WebGL fingerprint randomization
          if (typeof WebGLRenderingContext !== 'undefined') {
            const getParameter = WebGLRenderingContext.prototype.getParameter;
            WebGLRenderingContext.prototype.getParameter = function (parameter: number) {
              if (parameter === 37445) return 'Intel Inc.';
              if (parameter === 37446) return 'Intel Iris OpenGL Engine';
              return getParameter.call(this, parameter);
            };
          }
        });

        const page = await context.newPage();

        // Set additional page properties
        await page.addInitScript(() => {
          Object.defineProperty(window.screen, 'width', { get: () => 1920 });
          Object.defineProperty(window.screen, 'height', { get: () => 1080 });
          Object.defineProperty(window.screen, 'colorDepth', { get: () => 24 });
          Object.defineProperty(window.screen, 'pixelDepth', { get: () => 24 });
        });

        try {
          // Use saved Google domain or randomly select one (image search dedicated URL)
          let selectedDomain: string;
          if (savedState.googleDomain && googleDomains.includes(savedState.googleDomain)) {
            selectedDomain = savedState.googleDomain;
            logger.debug(`[GoogleImageSearchTool] Using saved Google image search domain: ${selectedDomain}`);
          } else {
            selectedDomain = googleDomains[Math.floor(Math.random() * googleDomains.length)];
            savedState.googleDomain = selectedDomain;
            logger.debug(`[GoogleImageSearchTool] Randomly selected Google image search domain: ${selectedDomain}`);
          }

          logger.debug('[GoogleImageSearchTool] Navigating to Google image search page...');

          // Navigate to Google image search page - use domcontentloaded instead of networkidle to avoid long waits for async resources
          const response = await page.goto(selectedDomain, {
            timeout,
            waitUntil: 'domcontentloaded'  // networkidle is too strict; Google image pages have heavy async loading that may cause timeouts
          });

          // Check whether redirected to a CAPTCHA page
          const currentUrl = page.url();
          const sorryPatterns = [
            'google.com/sorry/index',
            'google.com/sorry',
            'recaptcha',
            'captcha',
            'unusual traffic'
          ];

          const isBlockedPage = sorryPatterns.some(
            (pattern) =>
              currentUrl.includes(pattern) ||
              (response && response.url().toString().includes(pattern))
          );

          if (isBlockedPage) {
            logger.error('[GoogleImageSearchTool] CAPTCHA page detected, search blocked');
            throw new Error('Google detected unusual traffic, please retry later or use Bing search instead');
          }

          logger.debug(`[GoogleImageSearchTool] Entering search keyword: "${query}"`);

          // Wait for search box to appear (image search page search box)
          const searchInputSelectors = [
            "input[name='q']",
            "textarea[name='q']",
            "input[title='Search']",
            "textarea[title='Search']",
            "input[aria-label='Search']",
            "textarea[aria-label='Search']",
            'input[type="text"]'
          ];

          let searchInput = null;
          for (const selector of searchInputSelectors) {
            searchInput = await page.$(selector);
            if (searchInput) {
              logger.debug(`[GoogleImageSearchTool] Search box found: ${selector}`);
              break;
            }
          }

          if (!searchInput) {
            throw new Error('Unable to find image search box');
          }

          // Click the search box and enter the query
          await searchInput.click();
          await page.keyboard.type(query, { delay: this.getRandomDelay(10, 30) });
          await page.waitForTimeout(this.getRandomDelay(100, 300));
          await page.keyboard.press('Enter');

          logger.debug('[GoogleImageSearchTool] Waiting for image search results page to load...');
          // Wait for image result container to appear instead of waiting for networkidle
          try {
            await page.waitForSelector('div[data-ri], div.isv-r, img[data-src], div[jsname="dTDiAc"]', { timeout: 10000 });
            logger.debug('[GoogleImageSearchTool] Image result container appeared');
          } catch {
            logger.warn('[GoogleImageSearchTool] Standard image result container not found, continuing...');
          }

          // Check whether redirected to CAPTCHA page after search
          const searchUrl = page.url();
          const isBlockedAfterSearch = sorryPatterns.some((pattern) => searchUrl.includes(pattern));

          if (isBlockedAfterSearch) {
            logger.error('[GoogleImageSearchTool] CAPTCHA page detected after search, search blocked');
            throw new Error('Google detected unusual traffic after image search, please retry later or use Bing image search instead');
          }

          // Get current page URL
          const finalUrl = page.url();
          logger.debug(`[GoogleImageSearchTool] Image search results page loaded: ${finalUrl}`);

          // Wait for page to stabilize
          logger.debug('[GoogleImageSearchTool] Waiting for page to stabilize...');
          await page.waitForTimeout(1000);

          // Page stability detection - using more lenient detection, no longer relying on networkidle
          logger.debug('[GoogleImageSearchTool] Checking page stability...');
          const isStable = await this.isPageStable(page);
          if (!isStable) {
            logger.warn('[GoogleImageSearchTool] Page is still navigating, waiting longer...');
            await page.waitForTimeout(2000);

            // Check stability again
            const isStableRetry = await this.isPageStable(page);
            if (!isStableRetry) {
              logger.warn('[GoogleImageSearchTool] Page did not fully stabilize, but continuing to avoid timeout');
            }
          }

          // Get page HTML content - keep full HTML including JavaScript (image data is stored in JS)
          const fullHtml = await page.content();

          logger.debug(`[GoogleImageSearchTool] HTML content stats: full length ${fullHtml.length}`);

          // // Save HTML and screenshot to debug directory
          // try {
          //   const debugDir = path.join(process.cwd(), 'debug');
          //   if (!fs.existsSync(debugDir)) {
          //     fs.mkdirSync(debugDir, { recursive: true });
          //   }

          //   const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          //   const querySlug = query.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_').substring(0, 50);

          //   // Save raw HTML
          //   const htmlPath = path.join(debugDir, `google_image_search_${querySlug}_${timestamp}.html`);
          //   fs.writeFileSync(htmlPath, fullHtml, 'utf8');
          //   logger.debug(`[GoogleImageSearchTool] HTML saved: ${htmlPath}`);

          //   // Save screenshot
          //   const screenshotPath = path.join(debugDir, `google_image_search_${querySlug}_${timestamp}.png`);
          //   await page.screenshot({
          //     path: screenshotPath,
          //     fullPage: true,
          //     type: 'png'
          //   });
          //   logger.debug(`[GoogleImageSearchTool] Screenshot saved: ${screenshotPath}`);

          // } catch (debugError) {
          //   logger.warn('[GoogleImageSearchTool] Failed to save debug files:', String(debugError));
          // }

          // Save browser state
          try {
            logger.debug('[GoogleImageSearchTool] Saving browser state...');
            const stateDir = path.dirname(stateFile);
            if (!fs.existsSync(stateDir)) {
              fs.mkdirSync(stateDir, { recursive: true });
            }

            await context.storageState({ path: stateFile });
            logger.debug(`[GoogleImageSearchTool] Browser state saved: ${stateFile}`);

            // Save fingerprint configuration
            fs.writeFileSync(fingerprintFile, JSON.stringify(savedState, null, 2), 'utf8');
            logger.debug(`[GoogleImageSearchTool] Fingerprint configuration saved: ${fingerprintFile}`);
          } catch (stateError) {
            logger.warn(`[GoogleImageSearchTool] Failed to save browser state: ${String(stateError)}`);
          }

          await page.close();
          await context.close();
          return fullHtml;

        } catch (error) {
          logger.error(`[GoogleImageSearchTool] Error occurred during search: ${String(error)}`);

          // Attempt to save state even if an error occurred
          try {
            logger.debug('[GoogleImageSearchTool] Attempting to save browser state...');
            const stateDir = path.dirname(stateFile);
            if (!fs.existsSync(stateDir)) {
              fs.mkdirSync(stateDir, { recursive: true });
            }
            await context.storageState({ path: stateFile });
            fs.writeFileSync(fingerprintFile, JSON.stringify(savedState, null, 2), 'utf8');
            logger.debug('[GoogleImageSearchTool] Browser state saved');
          } catch (stateError) {
            logger.warn(`[GoogleImageSearchTool] Failed to save browser state: ${String(stateError)}`);
          }

          await page.close();
          await context.close();
          throw error;
        }
      } finally {
        await browser.close();
      }
    };

    const fullHtml = await performSearchAndGetHtml();

    // Parse search results - using full HTML (contains JavaScript data)
    const results = this.parseGoogleImageSearchResults(fullHtml, query, maxResults);
    return results;
  }

  /**
   * Get tool definition (for registration with BuiltinToolsManager)
   */
  static getDefinition(): BuiltinToolDefinition {
    return {
      name: 'google_image_search',
      description: 'Search images using Google image search engine. Supports multiple queries and returns up to 5 results per query. Each result includes thumbnail URL, source page, and metadata.\n\nDifferences from bing_image_search:\n- Uses Google\'s image search algorithm and ranking\n- May have different result ordering and content\n- Better for finding diverse image types\n- Complementary to Bing image search for comprehensive coverage\n\nFeatures:\n- Advanced browser automation with anti-detection\n- Parallel query processing for improved performance\n- Comprehensive image metadata extraction\n- State persistence for session management',
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
          maxResults: {
            type: 'number',
            description: 'Maximum number of results to return per query (default: 5)',
            minimum: 1,
            maximum: 10,
            default: 5
          },
          timeout: {
            type: 'number',
            description: 'Request timeout in milliseconds (default: 300000)',
            minimum: 1000,
            maximum: 300000,
            default: 300000
          }
        },
        required: ['description', 'queries']
      }
    };
  }

  /**
   * Validate parameters
   */
  private static validateArgs(args: GoogleImageSearchToolArgs): { isValid: boolean; error?: string } {
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

    // Validate timeout
    if (args.timeout !== undefined) {
      if (!Number.isInteger(args.timeout) || args.timeout < 1000 || args.timeout > 300000) {
        return { isValid: false, error: 'timeout must be an integer between 1000 and 300000 milliseconds' };
      }
    }

    return { isValid: true };
  }
}