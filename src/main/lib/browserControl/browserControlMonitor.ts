/**
 * Browser Control heartbeat monitor
 * 
 * Features:
 * 1. Periodically ping Native Server to detect if the browser is running
 * 2. Automatically connect MCP when the browser starts
 * 3. Automatically disconnect MCP when the browser closes
 * 
 * Note: HTTP server is independently managed by the caller (main.ts), not started/stopped in the monitor
 * Monitoring is only performed when Browser Control is in the enabled state
 */

import { exec } from 'child_process';
import { checkBrowserControlStatus } from './browserControlStatus';

const MCP_SERVER_NAME = 'kosmos-chrome-extension';
const PING_URL = 'http://127.0.0.1:12306/ping';
const POLL_INTERVAL = 2000;  // 2-second polling
const PING_TIMEOUT = 1000;   // 1-second timeout

class BrowserControlMonitor {
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  private currentUserAlias: string | null = null;
  
  // Previous Native Server state, used to detect state changes
  private lastServerRunning: boolean | null = null;

  /**
   * Start monitoring
   * @param userAlias Current user alias
   */
  async start(userAlias: string): Promise<void> {
    // Prevent duplicate starts
    if (this.isRunning) {
      console.log('[BrowserControlMonitor] Already running, skip');
      return;
    }
    
    this.currentUserAlias = userAlias;
    
    // Check if enabled
    const isEnabled = await this.checkEnabled();
    if (!isEnabled) {
      console.log('[BrowserControlMonitor] Browser Control not enabled, skip monitoring');
      return;
    }
    
    console.log('[BrowserControlMonitor] Starting monitoring...');
    this.isRunning = true;
    this.lastServerRunning = null; // Reset state
    
    // Execute a check immediately
    await this.check();
    
    // Start periodic polling
    this.intervalId = setInterval(() => {
      this.check().catch(err => {
        console.warn('[BrowserControlMonitor] Check failed:', err);
      });
    }, POLL_INTERVAL);
  }

  /**
   * Stop monitoring
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }
    
    console.log('[BrowserControlMonitor] Stopping monitoring...');
    
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    
    this.isRunning = false;
    this.currentUserAlias = null;
    this.lastServerRunning = null;
  }

  /**
   * Check if enabled (registry + MCP profile)
   * Uses shared browserControlStatus utility functions
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
      console.warn('[BrowserControlMonitor] checkEnabled failed:', error);
      return false;
    }
  }

  /**
   * Execute a single heartbeat check
   */
  private async check(): Promise<void> {
    // 1. Ping Native Server
    const isServerRunning = await this.pingNativeServer();
    
    // No state change, skip
    if (isServerRunning === this.lastServerRunning) {
      return;
    }
    
    console.log(`[BrowserControlMonitor] Native Server state changed: ${this.lastServerRunning} -> ${isServerRunning}`);
    this.lastServerRunning = isServerRunning;
    
    // 2. Get MCP runtime state
    const { mcpClientManager } = await import('../mcpRuntime/mcpClientManager');
    const runtimeState = mcpClientManager.getMcpServerRuntimeState(MCP_SERVER_NAME);
    const isConnected = runtimeState?.status === 'connected';
    const isConnecting = runtimeState?.status === 'connecting';
    
    // 3. Take action based on state differences
    if (isServerRunning && !isConnected && !isConnecting) {
      // Native Server is running, but MCP is not connected → try to connect
      console.log('[BrowserControlMonitor] Native Server is up, connecting MCP...');
      try {
        await mcpClientManager.connect(MCP_SERVER_NAME);
        console.log('[BrowserControlMonitor] MCP connected successfully');
      } catch (error) {
        console.warn('[BrowserControlMonitor] MCP connect failed:', error);
      }
    } else if (!isServerRunning && (isConnected || isConnecting)) {
      // Native Server stopped, but MCP is still connected → disconnect
      console.log('[BrowserControlMonitor] Native Server is down, disconnecting MCP...');
      try {
        await mcpClientManager.disconnect(MCP_SERVER_NAME);
        console.log('[BrowserControlMonitor] MCP disconnected');
      } catch (error) {
        console.warn('[BrowserControlMonitor] MCP disconnect failed:', error);
      }
    }
  }

  /**
   * Ping Native Server
   */
  private async pingNativeServer(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), PING_TIMEOUT);
      
      const response = await fetch(PING_URL, {
        method: 'GET',
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Get monitoring status
   */
  isMonitoring(): boolean {
    return this.isRunning;
  }
}

// Export singleton
export const browserControlMonitor = new BrowserControlMonitor();
