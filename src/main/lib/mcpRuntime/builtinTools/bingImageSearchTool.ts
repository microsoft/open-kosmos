/**
 * BingImageSearchTool built-in tool - uses Playwright browser automation
 * Provides Bing image search capability for LLM to actively invoke, supports parallel search and result merging
 * Note: This is a built-in tool, not an MCP protocol tool
 */

import { BuiltinToolDefinition } from './types';
import { chromium, Browser, Page, BrowserContext, devices, BrowserContextOptions } from 'playwright';
import { getUnifiedLogger } from '../../unifiedLogger';
import { ensureBrowserInstalled } from './playwrightBrowserHelper';
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
  bingDomain?: string;
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
  query?: string; // Source query identifier
}

type BingSafeSearchLevel = 'Off' | 'Moderate' | 'Strict';

export interface BingImageSearchToolArgs {
  description: string; // Brief description of what this search is for
  queries: string[];
  lang?: string;
  locale?: string;
  maxResults?: number;
  safeSearch?: BingSafeSearchLevel;
  timeout?: number;
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
   * Get the actual configuration of the host machine
   */
  private static getHostMachineConfig(userLocale?: string): FingerprintConfig {
    // Get system locale settings
    const systemLocale = userLocale || process.env.LANG || "zh-CN";

    // Get system timezone
    const timezoneOffset = new Date().getTimezoneOffset();
    let timezoneId = "Asia/Shanghai"; // Default to Shanghai timezone

    // Roughly infer timezone based on timezone offset
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

    // Select an appropriate device name
    const platform = os.platform();
    let deviceName = "Desktop Chrome";

    if (platform === "darwin") {
      deviceName = "Desktop Safari";
    } else if (platform === "win32") {
      deviceName = "Desktop Edge";
    } else if (platform === "linux") {
      deviceName = "Desktop Firefox";
    }

    // Ultimately use Chrome
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
   * Get a random delay time
   */
  private static getRandomDelay(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  /**
   * Check if the page is stable (URL no longer changes)
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
      
      logger.debug(`[BingImageSearchTool] Page stability verification passed: ${previousUrl}`);
      return true;
    } catch (error) {
      logger.warn('[BingImageSearchTool] Page stability check failed:', String(error));
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
   * Extract domain name from URL
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
   * Convert possible numeric fields uniformly to number
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
      
      logger.debug(`[BingImageSearchTool] Found ${iuscMatches.length}  image search result containers`);
      
      for (let i = 0; i < iuscMatches.length && results.length < maxResults; i++) {
        try {
          const metaAttr = iuscMatches[i][1];
          if (!metaAttr) continue;
          
          // Decode HTML entities and parse JSON
          const metaText = this.decodeHTMLEntities(metaAttr);
          const meta = JSON.parse(metaText);
          
          // Extract original image URL, thumbnail, source page, and other core fields
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
          logger.debug(`[BingImageSearchTool] Parsing result #${result.index} image result: "${result.title}"`);
          
        } catch (error) {
          logger.warn(`[BingImageSearchTool] Parsing result #${i + 1} image result error:`, String(error));
        }
      }
      
      return results;
      
    } catch (error) {
      logger.error('[BingImageSearchTool] Failed to parse Bing image search results:', String(error));
      return [];
    }
  }
  
  /**
   * Execute Bing image search tool
   */
  static async execute(args: BingImageSearchToolArgs): Promise<BingImageSearchToolResult> {
    try {
      // 🔍 Pre-execution check to ensure Playwright browser is installed
      logger.debug('[BingImageSearchTool] Checking Playwright Chromium browser...');
      const browserCheck = await ensureBrowserInstalled();
      if (!browserCheck.installed) {
        logger.error('[BingImageSearchTool] Playwright Chromium browser not installed and automatic installation failed');
        return {
          success: false,
          totalQueries: args.queries.length,
          totalResults: 0,
          results: [],
          errors: [`Playwright Chromium headless browser not installed. Please run 'npx playwright install chromium-headless-shell' to install manually. Error: ${browserCheck.error || 'Unknown error'}`],
          timestamp: new Date().toISOString()
        };
      }
      logger.debug(`[BingImageSearchTool] Browser check passed${browserCheck.browserPath ? ': ' + browserCheck.browserPath : ''}`);
      
      const allResults: BingImageSearchResult[] = [];
      const errors: string[] = [];
      
      // State file configuration
      const stateFile = path.join(os.tmpdir(), 'openkosmos-bing-image-browser-state.json');
      const fingerprintFile = stateFile.replace('.json', '-fingerprint.json');
      
      // Load saved state
      let storageState: string | undefined = undefined;
      let savedState: SavedState = {};
      
      if (fs.existsSync(stateFile)) {
        logger.debug('[BingImageSearchTool] Browser state file found');
        
        // Validate the JSON format of the state file
        try {
          const stateContent = fs.readFileSync(stateFile, 'utf8');
          JSON.parse(stateContent); // Validate JSON format
          storageState = stateFile;
          logger.debug('[BingImageSearchTool] Browser state file verification passed');
        } catch (e) {
          logger.warn('[BingImageSearchTool] Browser state file is corrupted, will delete and recreate:', String(e));
          try {
            fs.unlinkSync(stateFile);
            logger.debug('[BingImageSearchTool] Corrupted state file deleted');
          } catch (deleteError) {
            logger.warn('[BingImageSearchTool] Unable to delete corrupted state file:', String(deleteError));
          }
          storageState = undefined;
        }
        
        if (fs.existsSync(fingerprintFile)) {
          try {
            const fingerprintData = fs.readFileSync(fingerprintFile, 'utf8');
            savedState = JSON.parse(fingerprintData);
            logger.debug('[BingImageSearchTool] Saved browser fingerprint configuration loaded');
          } catch (e) {
            logger.warn('[BingImageSearchTool] Unable to load fingerprint configuration file, will create new fingerprint');
            // If the fingerprint file is also corrupted, delete it
            try {
              fs.unlinkSync(fingerprintFile);
              logger.debug('[BingImageSearchTool] Corrupted fingerprint file deleted');
            } catch (deleteError) {
              // Ignore deletion failure
            }
          }
        }
      } else {
        logger.debug('[BingImageSearchTool] Browser state file not found, will create new browser session');
      }
      
      // Device list
      const deviceList = ['Desktop Chrome', 'Desktop Edge', 'Desktop Firefox', 'Desktop Safari'];
      
      // Process each query in parallel
      
      const searchPromises = args.queries.map(async (query, queryIndex) => {
        
        try {
          const results = await this.performSingleImageSearch(
            query,
            args.lang || 'en',
            args.locale || 'us',
            deviceList,
            savedState,
            storageState,
            stateFile,
            fingerprintFile,
            (args.timeout ? args.timeout * 1000 : 60000),
            args.maxResults || 5,
            args.safeSearch || 'Moderate'
          );
          
          return { query, results, error: null };
          
        } catch (error) {
          const errorMsg = `Search query "${query}" failed: ${String(error)}`;
          logger.error(`[BingImageSearchTool] ${errorMsg}`);
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
          logger.error(`[BingImageSearchTool] ${errorMsg}`);
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
      logger.error('[BingImageSearchTool] Search execution failed:', String(error));
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
    query: string,
    lang: string,
    locale: string,
    deviceList: string[],
    savedState: SavedState,
    storageState: string | undefined,
    stateFile: string,
    fingerprintFile: string,
    timeout: number,
    maxResults: number = 5,
    safeSearch: BingSafeSearchLevel = 'Moderate'
  ): Promise<BingImageSearchResult[]> {
    
    // Get device configuration
    const getDeviceConfig= (): [string, any] => {
      if (savedState.fingerprint?.deviceName && devices[savedState.fingerprint.deviceName]) {
        return [savedState.fingerprint.deviceName, devices[savedState.fingerprint.deviceName]];
      } else {
        const randomDevice = deviceList[Math.floor(Math.random() * deviceList.length)];
        return [randomDevice, devices[randomDevice]];
      }
    };

    // Define search function (headless mode only)
    const performSearchAndGetHtml = async (): Promise<string> => {
      logger.debug('[BingImageSearchTool] Launching browser (headless mode)...');
      
      // Initialize browser
      const browser = await chromium.launch({
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
        logger.debug(`[BingImageSearchTool] Using device configuration: ${deviceName}`);

        // Create browser context options
        let contextOptions: BrowserContextOptions = {
          ...deviceConfig
        };

        // If saved fingerprint config exists, use it; otherwise use the host machine's actual settings
        if (savedState.fingerprint) {
          contextOptions = {
            ...contextOptions,
            locale: savedState.fingerprint.locale,
            timezoneId: savedState.fingerprint.timezoneId,
            colorScheme: savedState.fingerprint.colorScheme,
            reducedMotion: savedState.fingerprint.reducedMotion,
            forcedColors: savedState.fingerprint.forcedColors
          };
          logger.debug('[BingImageSearchTool] Using saved browser fingerprint configuration');
        } else {
          // Get the host machine's actual settings
          const hostConfig = this.getHostMachineConfig();

          contextOptions = {
            ...contextOptions,
            locale: hostConfig.locale,
            timezoneId: hostConfig.timezoneId,
            colorScheme: hostConfig.colorScheme,
            reducedMotion: hostConfig.reducedMotion,
            forcedColors: hostConfig.forcedColors
          };

          // Save the newly generated fingerprint configuration
          savedState.fingerprint = hostConfig;
          logger.debug(`[BingImageSearchTool] Generated new browser fingerprint configuration: ${hostConfig.locale}, ${hostConfig.timezoneId}`);
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

        // Set additional browser properties to avoid detection
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
          // Calculate the number of images to request
          const count = Math.min(Math.max(maxResults * 2, maxResults), 50);
          
          // Build Bing image search URL
          const searchUrl = `https://www.bing.com/images/search?q=${encodeURIComponent(query)}&setlang=${lang}&cc=${locale}&safesearch=${safeSearch}&count=${count}`;
          
          logger.debug(`[BingImageSearchTool] Navigating to Bing image search page: ${searchUrl}`);

          // Navigate to Bing image search page - use domcontentloaded instead of networkidle to avoid long waits for async resources
          const response = await page.goto(searchUrl, {
            timeout,
            waitUntil: 'domcontentloaded'  // networkidle is too strict; Bing image pages have many async loads that may cause timeouts
          });

          logger.debug('[BingImageSearchTool] Waiting for image search results page to load...');
          // Wait for image result container to appear, rather than waiting for networkidle
          try {
            await page.waitForSelector('.dgControl, .iusc, .mimg, img.mimg', { timeout: 10000 });
            logger.debug('[BingImageSearchTool] Image result containers appeared');
          } catch {
            logger.warn('[BingImageSearchTool] Standard image result containers not found, continuing...');
          }

          // Get current page URL
          const finalUrl = page.url();
          logger.debug(`[BingImageSearchTool] Image search results page loaded: ${finalUrl}`);

          // Wait for page to stabilize
          logger.debug('[BingImageSearchTool] Waiting for page to stabilize...');
          await page.waitForTimeout(1000);

          // Page stability detection - use more lenient detection, no longer relying on networkidle
          logger.debug('[BingImageSearchTool] Checking page stability...');
          const isStable = await this.isPageStable(page);
          if (!isStable) {
            logger.warn('[BingImageSearchTool] Page still navigating, waiting longer...');
            await page.waitForTimeout(2000);
            
            const isStableRetry = await this.isPageStable(page);
            if (!isStableRetry) {
              logger.warn('[BingImageSearchTool] Page did not fully stabilize, but continuing to avoid timeout');
            }
          }

          // Get page HTML content
          const fullHtml = await page.content();

          logger.debug(`[BingImageSearchTool] HTML content stats: full length ${fullHtml.length}`);

          // Save browser state
          try {
            logger.debug('[BingImageSearchTool] Saving browser state...');
            const stateDir = path.dirname(stateFile);
            if (!fs.existsSync(stateDir)) {
              fs.mkdirSync(stateDir, { recursive: true });
            }

            await context.storageState({ path: stateFile });
            logger.debug(`[BingImageSearchTool] Browser state saved: ${stateFile}`);

            // Save fingerprint configuration
            fs.writeFileSync(fingerprintFile, JSON.stringify(savedState, null, 2), 'utf8');
            logger.debug(`[BingImageSearchTool] Fingerprint configuration saved: ${fingerprintFile}`);
          } catch (stateError) {
            logger.warn('[BingImageSearchTool] Failed to save browser state:', String(stateError));
          }

          await page.close();
          await context.close();
          return fullHtml;

        } catch (error) {
          logger.error('[BingImageSearchTool] Error occurred during search:', String(error));

          // Try to save state even if an error occurred
          try {
            logger.debug('[BingImageSearchTool] Attempting to save browser state...');
            const stateDir = path.dirname(stateFile);
            if (!fs.existsSync(stateDir)) {
              fs.mkdirSync(stateDir, { recursive: true });
            }
            await context.storageState({ path: stateFile });
            fs.writeFileSync(fingerprintFile, JSON.stringify(savedState, null, 2), 'utf8');
            logger.debug('[BingImageSearchTool] Browser state saved');
          } catch (stateError) {
            logger.warn('[BingImageSearchTool] Failed to save browser state:', String(stateError));
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
    
    // Parse search results
    const results = this.parseBingImageSearchResults(fullHtml, query, maxResults);
    return results;
  }

  /**
   * Get tool definition (for registration with BuiltinToolsManager)
   */
  static getDefinition(): BuiltinToolDefinition {
    return {
      name: 'bing_image_search',
      description: `Search images using Bing image search with advanced browser automation. Supports multiple queries and returns up to 5 results per query. Each result includes the thumbnail URL, source page, and metadata.

Differences from google_image_search:
- Uses Bing's image search algorithm and ranking
- May have different result ordering and content
- Complementary to Google image search for comprehensive coverage

Features:
- Advanced browser automation with anti-detection measures
- Persistent browser fingerprint and session
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
          },
          timeout: {
            type: 'number',
            description: 'Request timeout in milliseconds (default: 60000)',
            minimum: 1000,
            maximum: 300000,
            default: 60000
          }
        },
        required: ['description', 'queries']
      }
    };
  }

  /**
   * Validate arguments
   */
  private static validateArgs(args: BingImageSearchToolArgs): { isValid: boolean; error?: string } {
    // Validate queries
    if (!args.queries || !Array.isArray(args.queries)) {
      return { isValid: false, error: 'queries is required and must be an array' };
    }

    // Queries must not be empty
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

    // Validate timeout range
    if (args.timeout !== undefined) {
      if (!Number.isInteger(args.timeout) || args.timeout < 1000 || args.timeout > 300000) {
        return { isValid: false, error: 'timeout must be an integer between 1000 and 300000 milliseconds' };
      }
    }

    return { isValid: true };
  }
}
