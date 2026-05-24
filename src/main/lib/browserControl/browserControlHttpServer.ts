/**
 * Browser Control HTTP Server Manager
 *
 * Features:
 * 1. Hosts update.xml and CRX files for browser extension downloads
 * 2. Automatically starts when Browser Control is in the enabled state
 * 3. Receives Native Server lifecycle signals and manages MCP connections
 *
 * Singleton pattern, decoupled from IPC handlers
 */

import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { checkBrowserControlStatus } from './browserControlStatus';
import { createLogger } from '../unifiedLogger';
import { profileCacheManager } from "../userDataADO";
import { mcpClientManager } from "../mcpRuntime/mcpClientManager";
const logger = createLogger();

const HTTP_PORT = 8000;
const HTTP_HOST = '127.0.0.1';

class BrowserControlHttpServer {
  private server: http.Server | null = null;
  private isRunning: boolean = false;
  private browserControlDir: string = '';
  private currentUserAlias: string | null = null;

  /**
   * Start the HTTP server
   * @param userAlias Current user alias (used to check enabled state)
   * @returns Promise<boolean> Whether the server started successfully
   */
  async start(userAlias: string): Promise<boolean> {
    // Prevent duplicate start
    if (this.isRunning && this.server) {
      logger.debug('[BrowserControlHttpServer] Already running, skip');
      return true;
    }

    this.currentUserAlias = userAlias;
    this.browserControlDir = path.join(app.getAppPath(), 'resources', 'browser-control');

    // Check if enabled
    const isEnabled = await this.checkEnabled();
    if (!isEnabled) {
      logger.debug('[BrowserControlHttpServer] Browser Control not enabled, skip starting HTTP server');
      return false;
    }

    logger.debug('[BrowserControlHttpServer] Starting HTTP server...');

    try {
      await this.createAndStartServer();
      this.isRunning = true;
      logger.debug(`[BrowserControlHttpServer] Server started on http://${HTTP_HOST}:${HTTP_PORT}`);
      return true;
    } catch (error) {
      logger.error(`[BrowserControlHttpServer] Failed to start server: ${error instanceof Error ? error.message : String(error)}`)
      this.server = null;
      this.isRunning = false;
      return false;
    }
  }

  /**
   * Stop the HTTP server
   */
  async stop(): Promise<void> {
    if (!this.isRunning || !this.server) {
      return;
    }

    logger.debug('[BrowserControlHttpServer] Stopping HTTP server...');

    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          logger.debug('[BrowserControlHttpServer] Server stopped');
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
   * Get the server running status
   */
  getIsRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Get the server instance (for compatibility with legacy code)
   */
  getServer(): http.Server | null {
    return this.server;
  }

  /**
   * Check whether enabled (registry + MCP profile)
   */
  private async checkEnabled(): Promise<boolean> {
    if (!this.currentUserAlias) {
      return false;
    }

    try {
      // Read the browser type selected by the user
      const settings = profileCacheManager.getBrowserControlSettings(this.currentUserAlias);
      const browser = settings.browser || 'edge';

      // Use the shared status-check function
      return await checkBrowserControlStatus(browser, this.currentUserAlias);
    } catch (error) {
      logger.warn(`[BrowserControlHttpServer] checkEnabled failed: ${error instanceof Error ? error.message : String(error)}`)
      return false;
    }
  }

  /**
   * Create and start the HTTP server
   */
  private createAndStartServer(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        const rawUrl = req.url || '/';
        logger.debug(`[BrowserControlHttpServer] Request: ${rawUrl}`);

        // Parse URL, extract pathname without query parameters
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
        } else if (pathname === '/api/server-up' && req.method === 'POST') {
          // Native Server notification: started — trigger MCP connection
          this.readJsonBody(req, (body) => {
            logger.debug(`[BrowserControlHttpServer] Received server-up notification: ${JSON.stringify(body)}`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));

            // Execute MCP connection asynchronously, do not block response
            this.handleServerUp().catch(err => {
              logger.warn(`[BrowserControlHttpServer] handleServerUp error: ${err instanceof Error ? err.message : String(err)}`)
            });
          }, () => {
            res.writeHead(400);
            res.end('Invalid JSON');
          });
        } else if (pathname === '/api/server-down' && req.method === 'POST') {
          // Native Server notification: about to exit — trigger MCP disconnection
          this.readJsonBody(req, (body) => {
            logger.debug(`[BrowserControlHttpServer] Received server-down notification: ${JSON.stringify(body)}`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));

            // Execute MCP disconnection asynchronously, do not block response
            this.handleServerDown(body?.reason).catch(err => {
              logger.warn(`[BrowserControlHttpServer] handleServerDown error: ${err instanceof Error ? err.message : String(err)}`)
            });
          }, () => {
            res.writeHead(400);
            res.end('Invalid JSON');
          });
        } else {
          res.writeHead(404);
          res.end('Not found');
        }
      });

      this.server.on('error', (err: Error) => {
        logger.error(`[BrowserControlHttpServer] Server error: ${err.message}`);
        this.server = null;
        this.isRunning = false;
        reject(err);
      });

      this.server.listen(HTTP_PORT, HTTP_HOST, () => {
        resolve();
      });
    });
  }

  // ============================================================
  // Native Server Signal Handlers
  // ============================================================

  private static readonly MCP_SERVER_NAME = 'openkosmos-chrome-extension';

  /**
   * Read the JSON body of a POST request
   */
  private readJsonBody(
    req: http.IncomingMessage,
    onSuccess: (body: any) => void,
    onError: () => void,
  ): void {
    let data = '';
    req.on('data', (chunk: Buffer) => {
      data += chunk.toString();
      // Prevent excessively large body
      if (data.length > 4096) {
        req.destroy();
        onError();
      }
    });
    req.on('end', () => {
      try {
        const body = JSON.parse(data);
        onSuccess(body);
      } catch {
        onError();
      }
    });
    req.on('error', () => onError());
  }

  /**
   * Native Server up → connect MCP
   */
  private async handleServerUp(): Promise<void> {
    const runtimeState = mcpClientManager.getMcpServerRuntimeState(BrowserControlHttpServer.MCP_SERVER_NAME);
    const isConnected = runtimeState?.status === 'connected';
    const isConnecting = runtimeState?.status === 'connecting';

    if (!isConnected && !isConnecting) {
      logger.debug('[BrowserControlHttpServer] Native Server is up, connecting MCP...');
      try {
        await mcpClientManager.connect(BrowserControlHttpServer.MCP_SERVER_NAME);
        logger.debug('[BrowserControlHttpServer] MCP connected successfully');
      } catch (error) {
        logger.warn(`[BrowserControlHttpServer] MCP connect failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    } else {
      logger.debug('[BrowserControlHttpServer] MCP already connected/connecting, skip');
    }
  }

  /**
   * Native Server down → disconnect MCP
   */
  private async handleServerDown(reason?: string): Promise<void> {
    logger.debug(`[BrowserControlHttpServer] Native Server going down, reason: ${reason || 'unknown'}`);
    const runtimeState = mcpClientManager.getMcpServerRuntimeState(BrowserControlHttpServer.MCP_SERVER_NAME);
    const isConnected = runtimeState?.status === 'connected';
    const isConnecting = runtimeState?.status === 'connecting';

    if (isConnected || isConnecting) {
      logger.debug('[BrowserControlHttpServer] Disconnecting MCP...');
      try {
        await mcpClientManager.disconnect(BrowserControlHttpServer.MCP_SERVER_NAME);
        logger.debug('[BrowserControlHttpServer] MCP disconnected');
      } catch (error) {
        logger.warn(`[BrowserControlHttpServer] MCP disconnect failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  /**
   * Ensure the server is started (used in the enable flow, skips enabled-state check)
   * @returns Promise<boolean> Whether the server started successfully
   */
  async ensureStarted(): Promise<boolean> {
    if (this.isRunning && this.server) {
      return true;
    }

    this.browserControlDir = path.join(app.getAppPath(), 'resources', 'browser-control');

    try {
      await this.createAndStartServer();
      this.isRunning = true;
      logger.debug(`[BrowserControlHttpServer] Server ensured on http://${HTTP_HOST}:${HTTP_PORT}`);
      return true;
    } catch (error) {
      logger.error(`[BrowserControlHttpServer] Failed to ensure server: ${error instanceof Error ? error.message : String(error)}`)
      this.server = null;
      this.isRunning = false;
      return false;
    }
  }
}

// Export singleton
export const browserControlHttpServer = new BrowserControlHttpServer();
