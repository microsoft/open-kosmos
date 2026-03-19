/**
 * BingWebSearchTool built-in tool - uses Playwright browser automation
 * Provides Bing web search capability for LLM to actively invoke, supports parallel search and result merging
 * Note: This is a built-in tool, not an MCP protocol tool
 */

import { BuiltinToolDefinition, ToolExecutionResult } from './types';
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

export interface BingSearchResult {
  index: number;
  title: string;
  url: string;
  caption: string;
  site: string;
  query?: string; // Source query identifier
}

export interface BingWebSearchToolArgs {
  description: string; // Brief description of what this search is for
  queries: string[]; // Array of search queries, supports multiple keywords
  lang: string; // Search language, REQUIRED - 'en' (English) or 'zh' (Chinese)
  locale: string; // Search region, REQUIRED - 'us' or 'cn'
  maxResults?: number; // Maximum results per query, default 5
  timeout?: number; // Request timeout in ms, default 60000
}

export interface BingWebSearchToolResult {
  success: boolean;
  totalQueries: number;
  totalResults: number;
  results: BingSearchResult[];
  errors?: string[];
  timestamp: string;
}


export class BingWebSearchTool {

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
          logger.debug(`[BingWebSearchTool] Page URL changed: ${previousUrl} → ${currentUrl}`);
          return false;
        }
        
        previousUrl = currentUrl;
      }
      
      logger.debug(`[BingWebSearchTool] Page stability verification passed: ${previousUrl}`);
      return true;
    } catch (error) {
      logger.warn('[BingWebSearchTool] Page stability check failed:', String(error));
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
   * Parse Bing search results from HTML content
   */
  private static parseBingSearchResults(html: string, query: string, maxResults: number = 5): BingSearchResult[] {
    const results: BingSearchResult[] = [];
    
    try {
      // Find all search result items (li.b_algo)
      const algoPattern = /<li[^>]*class="[^"]*b_algo[^"]*"[^>]*>(.*?)<\/li>/gs;
      const algoMatches = Array.from(html.matchAll(algoPattern));
      
      logger.debug(`[BingWebSearchTool] Found ${algoMatches.length}  search result containers`);
      
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
          
          // Extract website source
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
          logger.debug(`[BingWebSearchTool] Parsing result #${result.index}: "${result.title}"`);
          
        } catch (error) {
          logger.warn(`[BingWebSearchTool] Parsing result #${i + 1} search result error:`, String(error));
        }
      }
      
      return results;
      
    } catch (error) {
      logger.error('[BingWebSearchTool] Failed to parse Bing search results:', String(error));
      return [];
    }
  }
  
  /**
   * Execute Bing web search tool
   * Static method, supports direct invocation by LLM
   */
  static async execute(args: BingWebSearchToolArgs): Promise<BingWebSearchToolResult> {
    try {
      // 🔍 Pre-execution check to ensure Playwright browser is installed
      logger.debug('[BingWebSearchTool] Checking Playwright Chromium browser...');
      const browserCheck = await ensureBrowserInstalled();
      if (!browserCheck.installed) {
        logger.error('[BingWebSearchTool] Playwright Chromium browser not installed and automatic installation failed');
        return {
          success: false,
          totalQueries: args.queries.length,
          totalResults: 0,
          results: [],
          errors: [`Playwright Chromium headless browser not installed. Please run 'npx playwright install chromium-headless-shell' to install manually. Error: ${browserCheck.error || 'Unknown error'}`],
          timestamp: new Date().toISOString()
        };
      }
      logger.debug(`[BingWebSearchTool] Browser check passed${browserCheck.browserPath ? ': ' + browserCheck.browserPath : ''}`);
      
      const allResults: BingSearchResult[] = [];
      const errors: string[] = [];
      
      // State file configuration
      const stateFile = path.join(os.tmpdir(), 'kosmos-bing-browser-state.json');
      const fingerprintFile = stateFile.replace('.json', '-fingerprint.json');
      
      // Load saved state
      let storageState: string | undefined = undefined;
      let savedState: SavedState = {};
      
      if (fs.existsSync(stateFile)) {
        logger.debug('[BingWebSearchTool] Browser state file found');
        
        // Validate the JSON format of the state file
        try {
          const stateContent = fs.readFileSync(stateFile, 'utf8');
          JSON.parse(stateContent); // Validate JSON format
          storageState = stateFile;
          logger.debug('[BingWebSearchTool] Browser state file verification passed');
        } catch (e) {
          logger.warn('[BingWebSearchTool] Browser state file is corrupted, will delete and recreate:', String(e));
          try {
            fs.unlinkSync(stateFile);
            logger.debug('[BingWebSearchTool] Corrupted state file deleted');
          } catch (deleteError) {
            logger.warn('[BingWebSearchTool] Unable to delete corrupted state file:', String(deleteError));
          }
          storageState = undefined;
        }
        
        if (fs.existsSync(fingerprintFile)) {
          try {
            const fingerprintData = fs.readFileSync(fingerprintFile, 'utf8');
            savedState = JSON.parse(fingerprintData);
            logger.debug('[BingWebSearchTool] Saved browser fingerprint configuration loaded');
          } catch (e) {
            logger.warn('[BingWebSearchTool] Unable to load fingerprint configuration file, will create new fingerprint');
            // If the fingerprint file is also corrupted, delete it
            try {
              fs.unlinkSync(fingerprintFile);
              logger.debug('[BingWebSearchTool] Corrupted fingerprint file deleted');
            } catch (deleteError) {
              // Ignore deletion failure
            }
          }
        }
      } else {
        logger.debug('[BingWebSearchTool] Browser state file not found, will create new browser session');
      }
      
      // Device list
      const deviceList = ['Desktop Chrome', 'Desktop Edge', 'Desktop Firefox', 'Desktop Safari'];
      
      // Process each query in parallel
      
      const searchPromises = args.queries.map(async (query, queryIndex) => {
        
        try {
          const results = await this.performSingleSearch(
            query,
            args.lang,
            args.locale,
            deviceList,
            savedState,
            storageState,
            stateFile,
            fingerprintFile,
            (args.timeout ? args.timeout * 1000 : 60000),
            args.maxResults || 5
          );
          
          return { query, results, error: null };
          
        } catch (error) {
          const errorMsg = `Search query "${query}" failed: ${String(error)}`;
          logger.error(`[BingWebSearchTool] ${errorMsg}`);
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
          logger.error(`[BingWebSearchTool] ${errorMsg}`);
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
      logger.error('[BingWebSearchTool] Search execution failed:', String(error));
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
    query: string,
    lang: string,
    locale: string,
    deviceList: string[],
    savedState: SavedState,
    storageState: string | undefined,
    stateFile: string,
    fingerprintFile: string,
    timeout: number,
    maxResults: number = 5
  ): Promise<BingSearchResult[]> {
    
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
      logger.debug('[BingWebSearchTool] Launching browser (headless mode)...');
      
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
        logger.debug(`[BingWebSearchTool] Using device configuration: ${deviceName}`);

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
          logger.debug('[BingWebSearchTool] Using saved browser fingerprint configuration');
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
          logger.debug(`[BingWebSearchTool] Generated new browser fingerprint configuration: ${hostConfig.locale}, ${hostConfig.timezoneId}`);
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
          // Build Bing search URL
          const searchUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=${lang}&cc=${locale}`;
          
          logger.debug(`[BingWebSearchTool] Navigating to Bing search page: ${searchUrl}`);

          // Navigate to Bing search page - use domcontentloaded instead of networkidle to avoid long waits for async resources
          const response = await page.goto(searchUrl, {
            timeout,
            waitUntil: 'domcontentloaded'  // networkidle is too strict; Bing pages have many async loads that may cause timeouts
          });

          logger.debug('[BingWebSearchTool] Waiting for search results page to load...');
          // Wait for search result container to appear, rather than waiting for all network requests to complete
          try {
            await page.waitForSelector('li.b_algo', { timeout: Math.min(timeout, 30000) });
            logger.debug('[BingWebSearchTool] Search results appeared');
          } catch (selectorError) {
            logger.warn('[BingWebSearchTool] Search results selector timed out, attempting to continue...');
          }
          await page.waitForLoadState('domcontentloaded', { timeout });

          // Get current page URL
          const finalUrl = page.url();
          logger.debug(`[BingWebSearchTool] Search results page loaded: ${finalUrl}`);

          // Wait for page to stabilize
          logger.debug('[BingWebSearchTool] Waiting for page to stabilize...');
          await page.waitForTimeout(1500);  // Slightly increase wait time to ensure content renders
          try {
            await page.waitForLoadState('domcontentloaded', { timeout: Math.min(timeout, 15000) });
          } catch (loadError) {
            logger.warn('[BingWebSearchTool] Page load state timed out, continuing...');
          }

          // Page stability detection
          logger.debug('[BingWebSearchTool] Checking page stability...');
          const isStable = await this.isPageStable(page);
          if (!isStable) {
            logger.warn('[BingWebSearchTool] Page still navigating, waiting longer...');
            await page.waitForTimeout(2000);
            try {
              await page.waitForLoadState('domcontentloaded', { timeout: Math.min(timeout, 15000) });
            } catch (loadError) {
              logger.warn('[BingWebSearchTool] Retry page load wait timed out, continuing...');
            }
            
            const isStableRetry = await this.isPageStable(page);
            if (!isStableRetry) {
              logger.warn('[BingWebSearchTool] Page did not fully stabilize, but continuing to parse results');
            }
          }

          // Get page HTML content
          const fullHtml = await page.content();

          // Remove CSS and JavaScript content, keep only plain HTML
          let html = fullHtml.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
          html = html.replace(/<link\s+[^>]*rel=["']stylesheet["'][^>]*>/gi, '');
          html = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');

          logger.debug(`[BingWebSearchTool] HTML content stats: original length ${fullHtml.length}, cleaned length ${html.length}`);

          // Save browser state
          try {
            logger.debug('[BingWebSearchTool] Saving browser state...');
            const stateDir = path.dirname(stateFile);
            if (!fs.existsSync(stateDir)) {
              fs.mkdirSync(stateDir, { recursive: true });
            }

            await context.storageState({ path: stateFile });
            logger.debug(`[BingWebSearchTool] Browser state saved: ${stateFile}`);

            // Save fingerprint configuration
            fs.writeFileSync(fingerprintFile, JSON.stringify(savedState, null, 2), 'utf8');
            logger.debug(`[BingWebSearchTool] Fingerprint configuration saved: ${fingerprintFile}`);
          } catch (stateError) {
            logger.warn('[BingWebSearchTool] Failed to save browser state:', String(stateError));
          }

          await page.close();
          await context.close();
          return html;

        } catch (error) {
          logger.error('[BingWebSearchTool] Error occurred during search:', String(error));

          // Try to save state even if an error occurred
          try {
            logger.debug('[BingWebSearchTool] Attempting to save browser state...');
            const stateDir = path.dirname(stateFile);
            if (!fs.existsSync(stateDir)) {
              fs.mkdirSync(stateDir, { recursive: true });
            }
            await context.storageState({ path: stateFile });
            fs.writeFileSync(fingerprintFile, JSON.stringify(savedState, null, 2), 'utf8');
            logger.debug('[BingWebSearchTool] Browser state saved');
          } catch (stateError) {
            logger.warn('[BingWebSearchTool] Failed to save browser state:', String(stateError));
          }

          await page.close();
          await context.close();
          throw error;
        }
      } finally {
        await browser.close();
      }
    };

    const html = await performSearchAndGetHtml();
    
    // Parse search results
    const results = this.parseBingSearchResults(html, query, maxResults);
    return results;
  }
  
  /**
   * Get tool definition (for registration with BuiltinToolsManager)
   */
  static getDefinition(): BuiltinToolDefinition {
    return {
      name: 'bing_web_search',
      description: 'Search the web using Bing search engine with advanced browser automation. Supports multiple queries and returns up to 5 results per query. Results include title, URL, description, and source site.\n\nDifferences from google_web_search:\n- Uses Bing\'s search algorithm and ranking\n- May have different result ordering and content\n- Complementary to Google search for comprehensive coverage\n\nFeatures:\n- Advanced browser automation with anti-detection measures\n- Persistent browser fingerprint and session\n- Automatic handling of page navigation\n\nIMPORTANT: Language and locale detection:\n- If the user query contains Chinese characters, set lang="zh" and locale="cn"\n- For all other cases (English, numbers, symbols, etc.), use lang="en" and locale="us"\n- The AI model should analyze the query content and determine the appropriate language parameters before calling this tool',
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
          },
          timeout: {
            type: 'number',
            description: 'Request timeout in milliseconds (default: 60000)',
            minimum: 1000,
            maximum: 300000,
            default: 60000
          }
        },
        required: ['description', 'queries', 'lang', 'locale']
      }
    };
  }
  
  /**
   * Validate arguments
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
    
    // Validate timeout
    if (args.timeout !== undefined) {
      if (!Number.isInteger(args.timeout) || args.timeout < 1000 || args.timeout > 300000) {
        return { isValid: false, error: 'timeout must be an integer between 1000 and 300000 milliseconds' };
      }
    }
    
    return { isValid: true };
  }
}