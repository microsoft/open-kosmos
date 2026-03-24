/**
 * GoogleWebSearchTool built-in tool - implemented following bingWebSearchTool pattern
 * Provides LLM-invokable Google web search capability with parallel search and result merging
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

export interface GoogleSearchResult {
  index: number;
  title: string;
  url: string;
  caption: string;
  site: string;
  query?: string; // Source query identifier
}

export interface GoogleWebSearchToolArgs {
  description: string; // Brief description of what this search is for
  queries: string[]; // Array of search queries, supports multiple keywords
  maxResults?: number; // Maximum results per query, default 5
  timeout?: number; // Request timeout in ms, default 300000
}

export interface GoogleWebSearchToolResult {
  success: boolean;
  totalQueries: number;
  totalResults: number;
  results: GoogleSearchResult[];
  errors?: string[];
  timestamp: string;
}

export class GoogleWebSearchTool {

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

    // Choose an appropriate device name
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
   * Check if the page is stable (URL no longer changing)
   * Used to avoid race condition errors caused by calling page.content() during page navigation
   */
  private static async isPageStable(page: Page, checks: number = 1, delayMs: number = 500): Promise<boolean> {
    try {
      let previousUrl = page.url();
      
      for (let i = 0; i < checks; i++) {
        await page.waitForTimeout(delayMs);
        const currentUrl = page.url();
        
        if (currentUrl !== previousUrl) {
          logger.debug(`[GoogleWebSearchTool] Page URL changed: ${previousUrl} → ${currentUrl}`);
          return false;
        }
        
        previousUrl = currentUrl;
      }
      
      logger.debug(`[GoogleWebSearchTool] Page stability verification passed: ${previousUrl}`);
      return true;
    } catch (error) {
      logger.warn('[GoogleWebSearchTool] Page stability check failed:', String(error));
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
   * Parse Google search results from HTML content
   */
  private static parseGoogleSearchResults(html: string, query: string, maxResults: number = 5): GoogleSearchResult[] {
    const results: GoogleSearchResult[] = [];
    
    try {
      // 1. Find all caption containers as anchors
      const captionPattern = /<div[^>]*class="[^"]*VwiC3b[^"]*yXK7lf[^"]*p4wth[^"]*r025kc[^"]*Hdw6tb[^"]*"[^>]*>(.*?)<\/div>/gs;
      const captionMatches = Array.from(html.matchAll(captionPattern));
      
      
      for (let i = 0; i < captionMatches.length && results.length < maxResults; i++) {
        try {
          const captionMatch = captionMatches[i];
          const captionHtml = captionMatch[1];
          const captionIndex = captionMatch.index!;
          
          // Extract plain text description
          const caption = this.cleanTextContent(captionHtml);
          if (!caption || caption.length < 10) continue; // Skip descriptions that are too short
          
          // 2. Find the title before the caption
          const beforeCaption = html.substring(0, captionIndex);
          const titlePattern = /<h3[^>]*class="[^"]*LC20lb[^"]*MBeuO[^"]*DKV0Md[^"]*"[^>]*[^>]*>(.*?)<\/h3>/gs;
          const titleMatches = Array.from(beforeCaption.matchAll(titlePattern));
          
          if (titleMatches.length === 0) continue;
          
          const lastTitleMatch = titleMatches[titleMatches.length - 1];
          const title = this.cleanTextContent(lastTitleMatch[1]);
          if (!title) continue;
          
          // 3. Find the URL before the caption
          const urlPattern = /<a[^>]*jsname="UWckNb"[^>]*class="[^"]*zReHs[^"]*"[^>]*href="([^"]*)"[^>]*>/gs;
          const urlMatches = Array.from(beforeCaption.matchAll(urlPattern));
          
          if (urlMatches.length === 0) continue;
          
          let url = urlMatches[urlMatches.length - 1][1];
          url = this.cleanUrl(url);
          if (!url || !url.startsWith('http')) continue;
          
          // 4. Find the site before the caption
          const sitePattern = /<div[^>]*class="[^"]*byrV5b[^"]*"[^>]*>.*?<cite[^>]*class="[^"]*tjvcx[^"]*GvPZzd[^"]*dTxz9[^"]*cHaqb[^"]*"[^>]*[^>]*>(.*?)<\/cite>/gs;
          const siteMatches = Array.from(beforeCaption.matchAll(sitePattern));
          
          let site = '';
          if (siteMatches.length > 0) {
            site = this.cleanTextContent(siteMatches[siteMatches.length - 1][1]);
          }
          
          // Build search result
          const result: GoogleSearchResult = {
            index: results.length + 1,
            title: title,
            url: url,
            caption: caption,
            site: site || this.extractDomainFromUrl(url),
            query: query
          };
          
          results.push(result);
          logger.debug(`[GoogleWebSearchTool] Parsing result #${result.index}: "${result.title}"`);
          
        } catch (error) {
          logger.warn(`[GoogleWebSearchTool] Parsing result #${i + 1} search result error:`, String(error));
        }
      }
      
      return results;
      
    } catch (error) {
      logger.error('[GoogleWebSearchTool] Failed to parse Google search results:', String(error));
      return [];
    }
  }
  
  /**
   * Execute Google web search tool
   * Static method, supports direct LLM invocation
   */
  static async execute(args: GoogleWebSearchToolArgs): Promise<GoogleWebSearchToolResult> {
    try {
      // 🔍 Pre-execution check to ensure Playwright browser is installed
      logger.debug('[GoogleWebSearchTool] Checking Playwright Chromium browser...');
      const browserCheck = await ensureBrowserInstalled();
      if (!browserCheck.installed) {
        logger.error('[GoogleWebSearchTool] Playwright Chromium browser not installed and automatic installation failed');
        return {
          success: false,
          totalQueries: args.queries.length,
          totalResults: 0,
          results: [],
          errors: [`Playwright Chromium headless browser not installed. Please run 'npx playwright install chromium-headless-shell' to install manually. Error: ${browserCheck.error || 'Unknown error'}`],
          timestamp: new Date().toISOString()
        };
      }
      logger.debug(`[GoogleWebSearchTool] Browser check passed${browserCheck.browserPath ? ': ' + browserCheck.browserPath : ''}`);
      
      const allResults: GoogleSearchResult[] = [];
      const errors: string[] = [];
      
      // State file configuration
      const stateFile = path.join(os.tmpdir(), 'openkosmos-google-browser-state.json');
      const fingerprintFile = stateFile.replace('.json', '-fingerprint.json');
      
      // Load saved state
      let storageState: string | undefined = undefined;
      let savedState: SavedState = {};
      
      if (fs.existsSync(stateFile)) {
        logger.debug('[GoogleWebSearchTool] Browser state file found');
        
        // Validate the JSON format of the state file
        try {
          const stateContent = fs.readFileSync(stateFile, 'utf8');
          JSON.parse(stateContent); // Validate JSON format
          storageState = stateFile;
          logger.debug('[GoogleWebSearchTool] Browser state file verification passed');
        } catch (e) {
          logger.warn('[GoogleWebSearchTool] Browser state file is corrupted, will delete and recreate:', String(e));
          try {
            fs.unlinkSync(stateFile);
            logger.debug('[GoogleWebSearchTool] Corrupted state file deleted');
          } catch (deleteError) {
            logger.warn('[GoogleWebSearchTool] Unable to delete corrupted state file:', String(deleteError));
          }
          storageState = undefined;
        }
        
        if (fs.existsSync(fingerprintFile)) {
          try {
            const fingerprintData = fs.readFileSync(fingerprintFile, 'utf8');
            savedState = JSON.parse(fingerprintData);
            logger.debug('[GoogleWebSearchTool] Saved browser fingerprint configuration loaded');
          } catch (e) {
            logger.warn('[GoogleWebSearchTool] Unable to load fingerprint configuration file, will create new fingerprint');
            // If fingerprint file is also corrupted, delete it
            try {
              fs.unlinkSync(fingerprintFile);
              logger.debug('[GoogleWebSearchTool] Corrupted fingerprint file deleted');
            } catch (deleteError) {
              // Ignore delete failure
            }
          }
        }
      } else {
        logger.debug('[GoogleWebSearchTool] Browser state file not found, will create new browser session');
      }
      
      // Device and domain lists
      const deviceList = ['Desktop Chrome', 'Desktop Edge', 'Desktop Firefox', 'Desktop Safari'];
      const googleDomains = [
        'https://www.google.com',
        'https://www.google.co.uk', 
        'https://www.google.ca',
        'https://www.google.com.au'
      ];
      
      // Process each query in parallel
      
      const searchPromises = args.queries.map(async (query, queryIndex) => {
        
        try {
          const results = await this.performSingleSearch(
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
          logger.error(`[GoogleWebSearchTool] ${errorMsg}`);
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
          logger.error(`[GoogleWebSearchTool] ${errorMsg}`);
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
      logger.error('[GoogleWebSearchTool] Search execution failed:', String(error));
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
   * Execute a single search query (follows the test code logic exactly)
   */
  private static async performSingleSearch(
    query: string,
    deviceList: string[],
    googleDomains: string[],
    savedState: SavedState,
    storageState: string | undefined,
    stateFile: string,
    fingerprintFile: string,
    timeout: number,
    maxResults: number = 5
  ): Promise<GoogleSearchResult[]> {
    
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
      logger.debug('[GoogleWebSearchTool] Launching browser (headless mode)...');
      
      // Initialize browser, following the open-source project parameters exactly
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
        logger.debug(`[GoogleWebSearchTool] Using device configuration: ${deviceName}`);

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
          logger.debug('[GoogleWebSearchTool] Using saved browser fingerprint configuration');
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
          logger.debug(`[GoogleWebSearchTool] Generated new browser fingerprint configuration: ${hostConfig.locale}, ${hostConfig.timezoneId}`);
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
          // Use saved Google domain or randomly select one
          let selectedDomain: string;
          if (savedState.googleDomain) {
            selectedDomain = savedState.googleDomain;
            logger.debug(`[GoogleWebSearchTool] Using saved Google domain: ${selectedDomain}`);
          } else {
            selectedDomain = googleDomains[Math.floor(Math.random() * googleDomains.length)];
            savedState.googleDomain = selectedDomain;
            logger.debug(`[GoogleWebSearchTool] Randomly selected Google domain: ${selectedDomain}`);
          }

          logger.debug('[GoogleWebSearchTool] Navigating to Google search page...');

          // Navigate to Google search page - use domcontentloaded to avoid long waits for async resources
          const response = await page.goto(selectedDomain, {
            timeout,
            waitUntil: 'domcontentloaded'
          });

          // Check if redirected to CAPTCHA/verification page
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
            logger.error('[GoogleWebSearchTool] CAPTCHA page detected, search blocked');
            throw new Error('Google detected unusual traffic, please try again later or use Bing search instead');
          }

          logger.debug(`[GoogleWebSearchTool] Entering search keywords: "${query}"`);

          // Wait for search box to appear
          const searchInputSelectors = [
            "textarea[name='q']",
            "input[name='q']",
            "textarea[title='Search']",
            "input[title='Search']",
            "textarea[aria-label='Search']",
            "input[aria-label='Search']",
            'textarea'
          ];

          let searchInput = null;
          for (const selector of searchInputSelectors) {
            searchInput = await page.$(selector);
            if (searchInput) {
              logger.debug(`[GoogleWebSearchTool] Found search box: ${selector}`);
              break;
            }
          }

          if (!searchInput) {
            throw new Error('Unable to find search box');
          }

          // Click search box and enter query
          await searchInput.click();
          await page.keyboard.type(query, { delay: this.getRandomDelay(10, 30) });
          await page.waitForTimeout(this.getRandomDelay(100, 300));
          await page.keyboard.press('Enter');

          logger.debug('[GoogleWebSearchTool] Waiting for search results page to load...');
          // Wait for search results container to appear, instead of waiting for all network requests to complete
          try {
            await page.waitForSelector('div#search, div.g, div[data-hveid]', { timeout: Math.min(timeout, 30000) });
            logger.debug('[GoogleWebSearchTool] Search results appeared');
          } catch (selectorError) {
            logger.warn('[GoogleWebSearchTool] Search results selector timed out, attempting to continue...');
          }
          await page.waitForLoadState('domcontentloaded', { timeout });

          // Check if redirected to verification page after search
          const searchUrl = page.url();
          const isBlockedAfterSearch = sorryPatterns.some((pattern) => searchUrl.includes(pattern));

          if (isBlockedAfterSearch) {
            logger.error('[GoogleWebSearchTool] CAPTCHA page detected after search, search blocked');
            throw new Error('Google detected unusual traffic after search, please try again later or use Bing search instead');
          }

          // Get current page URL
          const finalUrl = page.url();
          logger.debug(`[GoogleWebSearchTool] Search results page loaded: ${finalUrl}`);

          // Wait for page to stabilize
          logger.debug('[GoogleWebSearchTool] Waiting for page to stabilize...');
          await page.waitForTimeout(1500);  // Slightly increase wait time to ensure content rendering
          try {
            await page.waitForLoadState('domcontentloaded', { timeout: Math.min(timeout, 15000) });
          } catch (loadError) {
            logger.warn('[GoogleWebSearchTool] Page load state timed out, continuing...');
          }

          // Page stability detection - avoid fetching content during page navigation
          logger.debug('[GoogleWebSearchTool] Checking page stability...');
          const isStable = await this.isPageStable(page);
          if (!isStable) {
            logger.warn('[GoogleWebSearchTool] Page still navigating, waiting longer...');
            await page.waitForTimeout(2000);
            try {
              await page.waitForLoadState('domcontentloaded', { timeout: Math.min(timeout, 15000) });
            } catch (loadError) {
              logger.warn('[GoogleWebSearchTool] Retry page load wait timed out, continuing...');
            }
            
            // Check stability again
            const isStableRetry = await this.isPageStable(page);
            if (!isStableRetry) {
              logger.warn('[GoogleWebSearchTool] Page did not fully stabilize, but continuing to parse results');
            }
          }

          // Get page HTML content
          const fullHtml = await page.content();

          // Remove CSS and JavaScript content, keep only pure HTML
          let html = fullHtml.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
          html = html.replace(/<link\s+[^>]*rel=["']stylesheet["'][^>]*>/gi, '');
          html = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');

          logger.debug(`[GoogleWebSearchTool] HTML content stats: original length ${fullHtml.length}, cleaned length ${html.length}`);

          // // Save HTML and screenshots to debug directory
          // try {
          //   const debugDir = path.join(process.cwd(), 'debug');
          //   if (!fs.existsSync(debugDir)) {
          //     fs.mkdirSync(debugDir, { recursive: true });
          //   }

          //   const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          //   const querySlug = query.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_').substring(0, 50);
            
          //   // Save original HTML
          //   const htmlPath = path.join(debugDir, `google_search_${querySlug}_${timestamp}.html`);
          //   fs.writeFileSync(htmlPath, fullHtml, 'utf8');
          //   logger.debug(`[GoogleWebSearchTool] HTML saved: ${htmlPath}`);

          //   // Save screenshot
          //   const screenshotPath = path.join(debugDir, `google_search_${querySlug}_${timestamp}.png`);
          //   await page.screenshot({ 
          //     path: screenshotPath, 
          //     fullPage: true,
          //     type: 'png'
          //   });
          //   logger.debug(`[GoogleWebSearchTool] Screenshot saved: ${screenshotPath}`);

          // } catch (debugError) {
          //   logger.warn('[GoogleWebSearchTool] Failed to save debug file:', String(debugError));
          // }

          // Save browser state
          try {
            logger.debug('[GoogleWebSearchTool] Saving browser state...');
            const stateDir = path.dirname(stateFile);
            if (!fs.existsSync(stateDir)) {
              fs.mkdirSync(stateDir, { recursive: true });
            }

            await context.storageState({ path: stateFile });
            logger.debug(`[GoogleWebSearchTool] Browser state saved: ${stateFile}`);

            // Save fingerprint configuration
            fs.writeFileSync(fingerprintFile, JSON.stringify(savedState, null, 2), 'utf8');
            logger.debug(`[GoogleWebSearchTool] Fingerprint configuration saved: ${fingerprintFile}`);
          } catch (stateError) {
            logger.warn('[GoogleWebSearchTool] Failed to save browser state:', String(stateError));
          }

          await page.close();
          await context.close();
          return html;

        } catch (error) {
          logger.error('[GoogleWebSearchTool] Error occurred during search:', String(error));

          // Try to save state even if an error occurred
          try {
            logger.debug('[GoogleWebSearchTool] Attempting to save browser state...');
            const stateDir = path.dirname(stateFile);
            if (!fs.existsSync(stateDir)) {
              fs.mkdirSync(stateDir, { recursive: true });
            }
            await context.storageState({ path: stateFile });
            fs.writeFileSync(fingerprintFile, JSON.stringify(savedState, null, 2), 'utf8');
            logger.debug('[GoogleWebSearchTool] Browser state saved');
          } catch (stateError) {
            logger.warn('[GoogleWebSearchTool] Failed to save browser state:', String(stateError));
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
    const results = this.parseGoogleSearchResults(html, query, maxResults);
    return results;
  }
  
  /**
   * Get tool definition (for registering with BuiltinToolsManager)
   */
  static getDefinition(): BuiltinToolDefinition {
    return {
      name: 'google_web_search',
      description: 'Search the web using Google search engine. Supports multiple queries and returns up to 5 results per query. Results include title, URL, description, and source site.\n\nDifferences from bing_web_search:\n- Uses Google\'s search algorithm and ranking\n- May have different result ordering and content\n- Better for academic and technical queries\n- Complementary to Bing search for comprehensive coverage',
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
   * Validate arguments
   */
  private static validateArgs(args: GoogleWebSearchToolArgs): { isValid: boolean; error?: string } {
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