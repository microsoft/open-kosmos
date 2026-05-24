/**
 * Browser Configuration Module
 * 
 * Manages the selected browser (chrome/edge) configuration.
 * - Loads from selectedBrowser.json at startup
 * - Can be updated at runtime via HTTP API
 */
import * as fs from 'fs';
import * as path from 'path';

export type BrowserType = 'chrome' | 'edge';

interface BrowserConfigFile {
  browser: BrowserType;
}

class BrowserConfig {
  private selectedBrowser: BrowserType = 'edge';

  /**
   * Load browser configuration from file at startup.
   * The config file is located at {native-server}/selectedBrowser.json
   * (one level up from dist/ where index.js runs)
   */
  load(): void {
    // __dirname is dist/config/ when running, selectedBrowser.json is in native-server root
    const configPath = path.join(__dirname, '..', '..', 'selectedBrowser.json');
    console.error(`[BrowserConfig] Looking for config at: ${configPath}`);
    
    try {
      if (fs.existsSync(configPath)) {
        const content = fs.readFileSync(configPath, 'utf-8');
        const config: BrowserConfigFile = JSON.parse(content);
        
        if (config.browser === 'chrome' || config.browser === 'edge') {
          this.selectedBrowser = config.browser;
          console.error(`[BrowserConfig] Loaded browser config: ${this.selectedBrowser}`);
        } else {
          console.error(`[BrowserConfig] Invalid browser value in config, using default: ${this.selectedBrowser}`);
        }
      } else {
        console.error(`[BrowserConfig] Config file not found at: ${configPath}, using default: ${this.selectedBrowser}`);
      }
    } catch (error) {
      console.error(`[BrowserConfig] Failed to load config, using default: ${this.selectedBrowser}`, error);
    }
  }

  /**
   * Update the selected browser at runtime.
   * Called by HTTP API when Kosmos changes the browser selection.
   */
  setBrowser(browser: BrowserType): void {
    this.selectedBrowser = browser;
    console.error(`[BrowserConfig] Browser updated to: ${this.selectedBrowser}`);
  }

  /**
   * Get the currently selected browser.
   */
  getBrowser(): BrowserType {
    return this.selectedBrowser;
  }
}

export const browserConfig = new BrowserConfig();
