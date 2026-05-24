// src/renderer/lib/auth/tokenMonitorProxy.ts - Renderer process token monitor proxy

/**
 * Renderer process token monitor proxy - communicates with main process via IPC
 *
 * This class replaces the original renderer-process TokenMonitor; all functionality is delegated to the main process
 */
export class TokenMonitorProxy {
  private static instance: TokenMonitorProxy;
  private eventListeners: (() => void)[] = [];

  constructor() {
  }

  // Note: startMonitoring has been removed - token monitoring is now started automatically by setCurrentAuth() in the main process
  // The renderer no longer needs to start monitoring manually

  /**
   * Stop token monitoring
   */
  async stopMonitoring(): Promise<void> {

    // Clean up event listeners
    this.cleanupEventListeners();

    if (!(window as any).electronAPI?.auth?.stopTokenMonitoring) {
      return;
    }

    try {
      const result = await (window as any).electronAPI.auth.stopTokenMonitoring();
      if (result.success) {
      } else {
      }
    } catch (error) {
    }
  }

  /**
   * Manually trigger a token check
   */
  async manualCheck(): Promise<void> {

    if (!(window as any).electronAPI?.auth?.manualTokenCheck) {
      return;
    }

    try {
      const result = await (window as any).electronAPI.auth.manualTokenCheck();
      if (result.success) {
      } else {
      }
    } catch (error) {
    }
  }

  /**
   * Trigger an immediate check (e.g. after system sleep resume)
   */
  triggerImmediateCheck(): void {
    // Use setTimeout to ensure async execution
    setTimeout(async () => {
      await this.manualCheck();
    }, 100);
  }

  /**
   * Get monitoring status
   */
  async getMonitoringStatus(): Promise<{ isRunning: boolean; checkInterval: number; refreshThreshold: number }> {
    if (!(window as any).electronAPI?.auth?.getMonitoringStatus) {
      return {
        isRunning: false,
        checkInterval: 60000,
        refreshThreshold: 300000
      };
    }

    try {
      const result = await (window as any).electronAPI.auth.getMonitoringStatus();
      if (result.success) {
        return result.data;
      }
    } catch (error) {
    }

    return {
      isRunning: false,
      checkInterval: 60000,
      refreshThreshold: 300000
    };
  }

  /**
   * Check if currently running
   */
  async isRunning(): Promise<boolean> {
    const status = await this.getMonitoringStatus();
    return status.isRunning;
  }

  /**
   * Set up event listeners
   */
  private setupEventListeners(): void {
    if (!(window as any).electronAPI?.auth?.onTokenMonitor) {
      return;
    }

    // Listen for token monitor events
    const cleanup = (window as any).electronAPI.auth.onTokenMonitor((data: any) => {
      this.handleTokenMonitorEvent(data);
    });

    this.eventListeners.push(cleanup);
  }

  /**
   * Clean up event listeners
   */
  private cleanupEventListeners(): void {
    this.eventListeners.forEach(cleanup => cleanup());
    this.eventListeners = [];
  }

  /**
   * Handle token monitor events
   */
  private handleTokenMonitorEvent(data: any): void {

    switch (data.event) {
      case 'monitor_started':
        this.emitAuthEvent('monitor_started', data.data);
        break;

      case 'monitor_stopped':
        this.emitAuthEvent('monitor_stopped', data.data);
        break;

      case 'refresh_success':
        this.emitAuthEvent('refresh_success', data.data);
        break;

      case 'refresh_failed':
        this.emitAuthEvent('refresh_failed', data.data);
        break;

      case 'require_reauth':
        this.emitAuthEvent('require_reauth', data.data);
        break;

      case 'monitor_error':
        this.emitAuthEvent('monitor_error', data.data);
        break;

      default:
    }
  }

  /**
   * Dispatch auth events to the window (uniformly using the tokenMonitor: prefix)
   */
  private emitAuthEvent(type: string, data: any): void {
    // Uniformly dispatch events in tokenMonitor: format
    window.dispatchEvent(new CustomEvent(`tokenMonitor:${type}`, {
      detail: {
        reason: data?.reason,
        userMessage: data?.userMessage,
        error: data?.error,
        timestamp: Date.now(),
        ...data
      }
    }));
  }

  // Singleton pattern
  static getInstance(): TokenMonitorProxy {
    if (!TokenMonitorProxy.instance) {
      TokenMonitorProxy.instance = new TokenMonitorProxy();
    }
    return TokenMonitorProxy.instance;
  }

  static resetInstance(): void {
    TokenMonitorProxy.instance = null as any;
  }
}

// Export singleton instance
export const tokenMonitor = TokenMonitorProxy.getInstance();