/**
 * Browser Control HTTP server management
 * 
 * Features:
 * 1. Host update.xml and CRX files for browser extension downloads
 * 2. Automatically start when Browser Control is in the enabled state
 * 3. Coordinate lifecycle with browserControlMonitor
 * 
 * Singleton pattern, decoupled from IPC handlers
 */

import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { checkBrowserControlStatus } from './browserControlStatus';

const HTTP_PORT = 8000;
const HTTP_HOST = 'localhost';

class BrowserControlHttpServer {
  private server: http.Server | null = null;
  private isRunning: boolean = false;
  private browserControlDir: string = '';
  private currentUserAlias: string | null = null;

  /**
   * Start HTTP server
   * @param userAlias Current user alias (used to check enabled state)
   * @returns Promise<boolean> Whether started successfully
   */
  async start(userAlias: string): Promise<boolean> {
    // Prevent duplicate starts
    if (this.isRunning && this.server) {
      console.log('[BrowserControlHttpServer] Already running, skip');
      return true;
    }

    this.currentUserAlias = userAlias;
    this.browserControlDir = path.join(app.getAppPath(), 'resources', 'browser-control');

    // Check if enabled
    const isEnabled = await this.checkEnabled();
    if (!isEnabled) {
      console.log('[BrowserControlHttpServer] Browser Control not enabled, skip starting HTTP server');
      return false;
    }

    console.log('[BrowserControlHttpServer] Starting HTTP server...');

    try {
      await this.createAndStartServer();
      this.isRunning = true;
      console.log(`[BrowserControlHttpServer] Server started on http://${HTTP_HOST}:${HTTP_PORT}`);
      return true;
    } catch (error) {
      console.error('[BrowserControlHttpServer] Failed to start server:', error);
      this.server = null;
      this.isRunning = false;
      return false;
    }
  }

  /**
   * Stop HTTP server
   */
  async stop(): Promise<void> {
    if (!this.isRunning || !this.server) {
      return;
    }

    console.log('[BrowserControlHttpServer] Stopping HTTP server...');

    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          console.log('[BrowserControlHttpServer] Server stopped');
          this.server = null;
          this.isRunning = false;
          this.currentUserAlias = null;
          resolve();
        });
      } else {
        this.isRunning = false;
        this.currentUserAlias = null;
        resolve();
      }
    });
  }

  /**
   * Get server running status
   */
  getIsRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Get server instance (for backward compatibility with legacy code)
   */
  getServer(): http.Server | null {
    return this.server;
  }

  /**
   * Check if enabled (registry + MCP profile)
   */
  private async checkEnabled(): Promise<boolean> {
    if (!this.currentUserAlias) {
      return false;
    }

    try {
      // Read the user's selected browser type
      const { profileCacheManager } = await import('../userDataADO');
      const settings = profileCacheManager.getBrowserControlSettings(this.currentUserAlias);
      const browser = settings.browser || 'edge';

      // Use shared status check function
      return await checkBrowserControlStatus(browser, this.currentUserAlias);
    } catch (error) {
      console.warn('[BrowserControlHttpServer] checkEnabled failed:', error);
      return false;
    }
  }

  /**
   * Create and start HTTP server
   */
  private createAndStartServer(): Promise<void> {
    return new Promise((resolve, reject) => {
      const { URL } = require('url');

      this.server = http.createServer((req, res) => {
        const rawUrl = req.url || '/';
        console.log(`[BrowserControlHttpServer] Request: ${rawUrl}`);

        // Parse URL, extract path without query parameters
        const parsedUrl = new URL(rawUrl, `http://${req.headers.host || HTTP_HOST}`);
        const pathname = parsedUrl.pathname;

        if (pathname.startsWith('/update.xml')) {
          // Host update.xml
          const updateXmlPath = path.join(this.browserControlDir, 'update.xml');
          if (fs.existsSync(updateXmlPath)) {
            const content = fs.readFileSync(updateXmlPath, 'utf8');
            res.writeHead(200, {
              'Content-Type': 'application/xml',
              'Access-Control-Allow-Origin': '*'
            });
            res.end(content);
          } else {
            res.writeHead(404);
            res.end('update.xml not found');
          }
        } else if (pathname.endsWith('.crx')) {
          // Host CRX file
          const crxFileName = path.basename(pathname);
          const crxPath = path.join(this.browserControlDir, crxFileName);
          if (fs.existsSync(crxPath)) {
            const content = fs.readFileSync(crxPath);
            res.writeHead(200, {
              'Content-Type': 'application/x-chrome-extension',
              'Access-Control-Allow-Origin': '*'
            });
            res.end(content);
          } else {
            res.writeHead(404);
            res.end('CRX file not found');
          }
        } else {
          res.writeHead(404);
          res.end('Not found');
        }
      });

      this.server.on('error', (err: Error) => {
        console.error('[BrowserControlHttpServer] Server error:', err.message);
        this.server = null;
        this.isRunning = false;
        reject(err);
      });

      this.server.listen(HTTP_PORT, HTTP_HOST, () => {
        resolve();
      });
    });
  }

  /**
   * Ensure server is started (used during the enable flow, does not check enabled state)
   * @returns Promise<boolean> Whether started successfully
   */
  async ensureStarted(): Promise<boolean> {
    if (this.isRunning && this.server) {
      return true;
    }

    this.browserControlDir = path.join(app.getAppPath(), 'resources', 'browser-control');

    try {
      await this.createAndStartServer();
      this.isRunning = true;
      console.log(`[BrowserControlHttpServer] Server ensured on http://${HTTP_HOST}:${HTTP_PORT}`);
      return true;
    } catch (error) {
      console.error('[BrowserControlHttpServer] Failed to ensure server:', error);
      this.server = null;
      this.isRunning = false;
      return false;
    }
  }
}

// Export singleton
export const browserControlHttpServer = new BrowserControlHttpServer();
