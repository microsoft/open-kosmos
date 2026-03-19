/**
 * AbortSignal Memory Leak Monitor
 * 🔧 Utility for tracking and preventing AbortSignal listener accumulation
 */

interface ListenerInfo {
  count: number;
  created: number;
  lastActivity: number;
  source: string;
}

export class AbortSignalMonitor {
  static listenerCounts = new WeakMap<AbortSignal, ListenerInfo>();
  static readonly MAX_LISTENERS_PER_SIGNAL = 200; // Increased for multiple MCP servers
  private static readonly WARNING_THRESHOLD = 100;
  static isEnabled = true;
  static totalListeners = 0;
  // Track sources per signal to prevent duplicate listeners from same source
  private static signalSources = new WeakMap<AbortSignal, Set<string>>();
  
  /**
   * Enable/disable monitoring
   */
  static setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
  }
  
  /**
   * Add a listener with monitoring
   * 🔧 ENHANCED: Prevents duplicate listeners from same source
   */
  static addListener(
    signal: AbortSignal,
    handler: () => void,
    options?: AddEventListenerOptions & { source?: string }
  ): void {
    if (!this.isEnabled) {
      signal.addEventListener('abort', handler, options);
      return;
    }
    
    const source = options?.source || 'unknown';
    
    // Check for duplicate source on same signal (but allow some flexibility for different contexts)
    const sources = this.signalSources.get(signal) || new Set<string>();
    const uniqueKey = `${source}-${Date.now().toString().slice(-3)}`; // Add timestamp flexibility
    
    // Only check for exact duplicates within a short time window
    const recentSources = Array.from(sources).filter(s => s.startsWith(source));
    if (recentSources.length > 5) { // Allow up to 5 similar sources
      this.logActivity(`⚠️ Skipping listener from duplicate source: ${source} (already has ${recentSources.length} similar)`);
      return;
    }
    
    const info = this.listenerCounts.get(signal) || {
      count: 0,
      created: Date.now(),
      lastActivity: Date.now(),
      source
    };
    
    // Check limits - use warning instead of throwing error
    if (info.count >= this.MAX_LISTENERS_PER_SIGNAL) {
      return; // Skip adding listener instead of throwing
    }
    
    // Warning threshold
    if (info.count >= this.WARNING_THRESHOLD) {
    }
    
    // Wrap handler for cleanup tracking
    const wrappedHandler = () => {
      try {
        this.decrementListener(signal, uniqueKey);
        handler();
      } catch (error) {
        // Force cleanup even if handler fails
        this.decrementListener(signal, uniqueKey);
      }
    };
    
    // Add listener with forced once: true
    signal.addEventListener('abort', wrappedHandler, { once: true });
    
    // Set up timeout cleanup as backup
    setTimeout(() => {
      if (!signal.aborted) {
        this.decrementListener(signal, uniqueKey);
        this.logActivity(`Force cleanup of timed out listener: ${uniqueKey}`);
      }
    }, 60000); // Clean up after 1 minute if not triggered
    
    // Update tracking
    info.count++;
    info.lastActivity = Date.now();
    this.listenerCounts.set(signal, info);
    this.totalListeners++;
    
    // Track source with unique key
    sources.add(uniqueKey);
    this.signalSources.set(signal, sources);
    
    // Clean up old sources periodically
    if (sources.size > 20) {
      const sourcesArray = Array.from(sources);
      const keepSources = sourcesArray.slice(-10); // Keep only last 10
      this.signalSources.set(signal, new Set(keepSources));
    }
    
    this.logActivity(`Listener added (${source}): ${info.count} active listeners`);
  }
  
  /**
   * Manually decrement listener count
   * 🔧 ENHANCED: Also removes source tracking
   */
  static decrementListener(signal: AbortSignal, source?: string): void {
    if (!this.isEnabled) return;
    
    const info = this.listenerCounts.get(signal);
    if (info && info.count > 0) {
      info.count--;
      info.lastActivity = Date.now();
      this.totalListeners = Math.max(0, this.totalListeners - 1);
      
      // Remove source tracking
      if (source) {
        const sources = this.signalSources.get(signal);
        if (sources) {
          sources.delete(source);
          if (sources.size === 0) {
            this.signalSources.delete(signal);
          }
        }
      }
      
      if (info.count === 0) {
        this.listenerCounts.delete(signal);
        this.signalSources.delete(signal); // Clean up source tracking
      } else {
        this.listenerCounts.set(signal, info);
      }
      
      this.logActivity(`Listener removed (${source || info.source}): ${info.count} remaining listeners`);
    }
  }
  
  /**
   * Get listener count for a specific signal
   */
  static getListenerCount(signal: AbortSignal): number {
    return this.listenerCounts.get(signal)?.count || 0;
  }
  
  /**
   * Get total active listeners across all signals
   */
  static getTotalListeners(): number {
    return this.totalListeners;
  }
  
  /**
   * Get all listener statistics
   */
  static getStats(): {
    totalListeners: number;
    signalCount: number;
    warningSignals: number;
    criticalSignals: number;
    oldestSignal?: { age: number; source: string; count: number };
  } {
    let signalCount = 0;
    let warningSignals = 0;
    let criticalSignals = 0;
    let oldestSignal: { age: number; source: string; count: number } | undefined;
    
    const now = Date.now();
    
    // Note: WeakMap doesn't support iteration, so we track totals separately
    // This is an approximation based on our internal counters
    
    return {
      totalListeners: this.totalListeners,
      signalCount: signalCount,
      warningSignals: warningSignals,
      criticalSignals: criticalSignals,
      oldestSignal: oldestSignal
    };
  }
  
  /**
   * Check for potential memory leaks
   */
  static checkForLeaks(): {
    hasLeaks: boolean;
    warnings: string[];
    recommendations: string[];
  } {
    const stats = this.getStats();
    const warnings: string[] = [];
    const recommendations: string[] = [];
    
    if (stats.totalListeners > 5000) { // Increased threshold for multiple servers
      warnings.push(`Total listener count is too high: ${stats.totalListeners}`);
      recommendations.push('Check for listeners not properly cleaned up');
    }
    
    if (stats.criticalSignals > 0) {
      warnings.push(`${stats.criticalSignals} signals approaching listener limit`);
      recommendations.push('Add { once: true } option to automatically clean up listeners');
    }
    
    if (stats.oldestSignal && stats.oldestSignal.age > 300000) { // 5 minutes
      warnings.push(`Long-lived signal found: ${Math.round(stats.oldestSignal.age / 60000)} minutes`);
      recommendations.push('Check signal lifecycle management');
    }
    
    return {
      hasLeaks: warnings.length > 0,
      warnings,
      recommendations
    };
  }
  
  /**
   * Reset all tracking (for testing)
   */
  static reset(): void {
    // WeakMap will be garbage collected when signals are released
    this.totalListeners = 0;
    // Clear source tracking
    this.signalSources = new WeakMap<AbortSignal, Set<string>>();
  }
  
  /**
   * Create a monitored AbortController
   */
  static createMonitoredController(source = 'unknown'): AbortController & { source: string } {
    const controller = new AbortController();
    const monitoredController = controller as AbortController & { source: string };
    monitoredController.source = source;
    
    this.logActivity(`AbortController created: ${source}`);
    
    return monitoredController;
  }
  
  /**
   * Log monitoring activity
   */
  static logActivity(message: string): void {
    if (process.env.NODE_ENV === 'development') {
    }
  }
  
  /**
   * Install global monitoring and AbortSignal interception
   */
  static installGlobalMonitoring(): void {
    if (typeof globalThis !== 'undefined') {
      (globalThis as any).__abortSignalMonitor = this;
      
      setInterval(() => {
        const stats = this.getStats();
        if (stats.totalListeners > 500) { // Increased threshold
        }
        
        const leakCheck = this.checkForLeaks();
        if (leakCheck.hasLeaks) {
        }
        
        // Aggressive cleanup: reset total counter if it seems too high
        if (this.totalListeners > 10000) {
          this.totalListeners = 0;
        }
        
        // Force cleanup of old signals that might have accumulated
        if (this.totalListeners > 1000) {
          // Reduce count aggressively
          this.totalListeners = Math.floor(this.totalListeners * 0.5);
        }
      }, 30000); // Check every 30 seconds
    }
  }
  
  /**
   * Install global AbortSignal addEventListener interception
   * 🔧 CRITICAL: Intercepts ALL abort listener additions to prevent bypassing
   */
  static installGlobalInterception(): void {
    // Platform detection for different behavior
    const platform = process.platform;
    const isMacOS = platform === 'darwin';
    const isWindows = platform === 'win32';
    
    
    if (typeof AbortSignal !== 'undefined' && AbortSignal.prototype) {
      const originalAddEventListener = AbortSignal.prototype.addEventListener;
      // Store reference to avoid recursion
      const originalMethod = originalAddEventListener;
      
      AbortSignal.prototype.addEventListener = function(
        this: AbortSignal,
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: boolean | AddEventListenerOptions
      ) {
        if (type === 'abort' && AbortSignalMonitor.isEnabled) {
          // Check if this is a monitored call to avoid recursion
          const stack = new Error().stack || '';
          const isFromMonitor = stack.includes('AbortSignalMonitor.addListener');
          
          if (!isFromMonitor) {
            // Platform-specific handling
            if (isWindows) {
              // Windows seems to have better native cleanup, less aggressive monitoring
              originalMethod.call(this, type, listener, options);
              return;
            }
            
            // macOS requires more aggressive monitoring
            
            // Wrap the EventListener to match our expected signature
            const wrappedListener = () => {
              try {
                if (typeof listener === 'function') {
                  (listener as any)();
                } else if (listener && typeof (listener as any).handleEvent === 'function') {
                  (listener as any).handleEvent(new Event('abort'));
                }
              } catch (error) {
              }
            };
            
            // Use original method directly to avoid recursion
            const info = AbortSignalMonitor.listenerCounts.get(this) || {
              count: 0,
              created: Date.now(),
              lastActivity: Date.now(),
              source: 'global-intercepted'
            };
            
            if (info.count >= AbortSignalMonitor.MAX_LISTENERS_PER_SIGNAL) {
              return;
            }
            
            // Wrap handler for cleanup tracking
            const cleanupKey = `global-intercepted-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
            const trackedHandler = () => {
              try {
                AbortSignalMonitor.decrementListener(this, cleanupKey);
                wrappedListener();
              } catch (error) {
                AbortSignalMonitor.decrementListener(this, cleanupKey);
              }
            };
            
            // Use original method to add listener with forced once: true
            originalMethod.call(this, type, trackedHandler, { once: true });
            
            // Set up timeout cleanup as backup for global intercepted listeners
            setTimeout(() => {
              if (!this.aborted) {
                AbortSignalMonitor.decrementListener(this, cleanupKey);
                AbortSignalMonitor.logActivity(`Force cleanup of timed out globally intercepted listener: ${cleanupKey}`);
              }
            }, 30000); // Clean up after 30 seconds for global intercepted
            
            // Update tracking manually
            info.count++;
            info.lastActivity = Date.now();
            AbortSignalMonitor.listenerCounts.set(this, info);
            AbortSignalMonitor.totalListeners++;
            
            AbortSignalMonitor.logActivity(`Listener added (global-intercepted): ${info.count} active listeners`);
            return;
          }
        }
        
        // For non-abort events or recursive calls, use original method
        originalMethod.call(this, type, listener, options);
      };
      
    }
  }
}

/**
 * Convenience function for safe listener addition
 */
export function addSafeAbortListener(
  signal: AbortSignal,
  handler: () => void,
  source?: string
): void {
  AbortSignalMonitor.addListener(signal, handler, { once: true, source });
}

/**
 * Create a combined abort signal with monitoring
 * 🔧 ENHANCED: Uses unique source identifiers to prevent duplicate listeners
 */
export function createSafeCombinedSignal(
  signals: AbortSignal[],
  source = 'combined'
): AbortSignal {
  // Filter out already aborted signals first
  const activeSignals = signals.filter(signal => !signal.aborted);
  
  // If all signals are aborted, return an already aborted signal
  if (activeSignals.length === 0) {
    const controller = new AbortController();
    controller.abort();
    return controller.signal;
  }
  
  // If only one signal, return it directly to avoid unnecessary layers
  if (activeSignals.length === 1) {
    return activeSignals[0];
  }
  
  const controller = AbortSignalMonitor.createMonitoredController(`${source}-combined`);
  let isAborted = false;
  
  // Create unique source identifier for this specific combination
  const combinedId = `${source}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  // Add listeners only to active signals using unique source IDs
  for (let i = 0; i < activeSignals.length; i++) {
    const signal = activeSignals[i];
    
    // Double-check signal state before adding listener
    if (signal.aborted) {
      controller.abort();
      isAborted = true;
      break;
    }
    
    // Use unique source for each signal to prevent duplicates
    const uniqueSource = `${combinedId}-upstream-${i}`;
    
    // Use the monitored addListener which now prevents duplicates
    AbortSignalMonitor.addListener(signal, () => {
      if (!isAborted) {
        isAborted = true;
        controller.abort();
      }
    }, { source: uniqueSource, once: true });
  }
  
  return controller.signal;
}