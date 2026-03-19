// src/renderer/lib/ghcPerformanceOptimizer.ts
import { GhcSession } from '../../types/ghcAuthTypes';
import { GhcCopilotModel } from '../../types/ghcChatTypes';

/**
 * Performance optimization utilities for GitHub Copilot integration
 * This module implements caching, debouncing, and other performance optimizations
 */

// Cache configuration
const CACHE_CONFIG = {
  // Token cache - short lived for security
  TOKEN_CACHE_TTL: 5 * 60 * 1000, // 5 minutes
  
  // Model list cache - longer lived as it doesn't change often
  MODELS_CACHE_TTL: 30 * 60 * 1000, // 30 minutes
  
  // User info cache - medium lived
  USER_INFO_CACHE_TTL: 15 * 60 * 1000, // 15 minutes
  
  // Configuration cache - persistent
  CONFIG_CACHE_TTL: 60 * 60 * 1000, // 1 hour
  
  // API response cache for identical requests
  API_RESPONSE_CACHE_TTL: 2 * 60 * 1000, // 2 minutes
};

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

class PerformanceCache {
  private cache = new Map<string, CacheEntry<any>>();
  
  set<T>(key: string, data: T, ttl: number): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl
    });
    
    // Clean up expired entries periodically
    this.cleanup();
  }
  
  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    
    if (!entry) {
      return null;
    }
    
    // Check if expired
    if (Date.now() - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      return null;
    }
    
    return entry.data as T;
  }
  
  delete(key: string): void {
    this.cache.delete(key);
  }
  
  clear(): void {
    this.cache.clear();
  }
  
  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > entry.ttl) {
        this.cache.delete(key);
      }
    }
  }
  
  // Get cache statistics
  getStats() {
    return {
      size: this.cache.size,
      entries: Array.from(this.cache.keys())
    };
  }
}

// Global cache instance
const performanceCache = new PerformanceCache();

/**
 * Debounce utility for API calls
 */
class Debouncer {
  private timers = new Map<string, NodeJS.Timeout>();
  
  debounce<T extends (...args: any[]) => any>(
    key: string,
    fn: T,
    delay: number
  ): (...args: Parameters<T>) => Promise<ReturnType<T>> {
    return (...args: Parameters<T>): Promise<ReturnType<T>> => {
      return new Promise((resolve, reject) => {
        // Clear existing timer
        const existingTimer = this.timers.get(key);
        if (existingTimer) {
          clearTimeout(existingTimer);
        }
        
        // Set new timer
        const timer = setTimeout(async () => {
          try {
            const result = await fn(...args);
            resolve(result);
          } catch (error) {
            reject(error);
          } finally {
            this.timers.delete(key);
          }
        }, delay);
        
        this.timers.set(key, timer);
      });
    };
  }
  
  cancel(key: string): void {
    const timer = this.timers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(key);
    }
  }
  
  cancelAll(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }
}

// Global debouncer instance
const debouncer = new Debouncer();

/**
 * Request queue for managing concurrent API calls
 */
class RequestQueue {
  private queue: Array<() => Promise<any>> = [];
  private running = 0;
  private maxConcurrent = 3; // Limit concurrent requests
  
  async enqueue<T>(request: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try {
          const result = await request();
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });
      
      this.processQueue();
    });
  }
  
  private async processQueue(): Promise<void> {
    if (this.running >= this.maxConcurrent || this.queue.length === 0) {
      return;
    }
    
    this.running++;
    const request = this.queue.shift();
    
    if (request) {
      try {
        await request();
      } finally {
        this.running--;
        this.processQueue(); // Process next request
      }
    }
  }
  
  setMaxConcurrent(max: number): void {
    this.maxConcurrent = max;
  }
  
  getQueueLength(): number {
    return this.queue.length;
  }
  
  getRunningCount(): number {
    return this.running;
  }
}

// Global request queue
const requestQueue = new RequestQueue();

/**
 * Performance monitoring and metrics
 */
class PerformanceMonitor {
  private metrics = new Map<string, number[]>();
  
  startTimer(operation: string): () => number {
    const start = performance.now();
    
    return () => {
      const duration = performance.now() - start;
      this.recordMetric(operation, duration);
      return duration;
    };
  }
  
  recordMetric(operation: string, duration: number): void {
    const existing = this.metrics.get(operation) || [];
    existing.push(duration);
    
    // Keep only last 100 measurements
    if (existing.length > 100) {
      existing.shift();
    }
    
    this.metrics.set(operation, existing);
  }
  
  getMetrics(operation: string) {
    const durations = this.metrics.get(operation) || [];
    
    if (durations.length === 0) {
      return null;
    }
    
    const sorted = [...durations].sort((a, b) => a - b);
    const avg = durations.reduce((sum, d) => sum + d, 0) / durations.length;
    
    return {
      count: durations.length,
      average: avg,
      median: sorted[Math.floor(sorted.length / 2)],
      p95: sorted[Math.floor(sorted.length * 0.95)],
      min: sorted[0],
      max: sorted[sorted.length - 1]
    };
  }
  
  getAllMetrics() {
    const result: Record<string, any> = {};
    for (const [operation, _] of this.metrics) {
      result[operation] = this.getMetrics(operation);
    }
    return result;
  }
  
  clearMetrics(): void {
    this.metrics.clear();
  }
}

// Global performance monitor
const performanceMonitor = new PerformanceMonitor();

/**
 * GitHub Copilot specific optimizations
 */
export class GhcPerformanceOptimizer {
  // Cached token validation to avoid repeated API calls
  static async validateTokenCached(token: string): Promise<boolean> {
    const cacheKey = `token_validation_${token.slice(-8)}`; // Use last 8 chars as key
    
    const cached = performanceCache.get<boolean>(cacheKey);
    if (cached !== null) {
      return cached;
    }
    
    const endTimer = performanceMonitor.startTimer('token_validation');
    
    try {
      // Actual validation logic would go here
      const isValid = await this.performTokenValidation(token);
      
      // Cache the result
      performanceCache.set(cacheKey, isValid, CACHE_CONFIG.TOKEN_CACHE_TTL);
      
      return isValid;
    } finally {
      endTimer();
    }
  }
  
  private static async performTokenValidation(token: string): Promise<boolean> {
    // Placeholder for actual validation
    return token.length > 0;
  }
  
  // Cached model list retrieval
  static async getModelsCached(): Promise<GhcCopilotModel[]> {
    const cacheKey = 'ghc_models_list';

    const cached = performanceCache.get<GhcCopilotModel[]>(cacheKey);
    if (cached) {
      return cached;
    }
    
    const endTimer = performanceMonitor.startTimer('models_fetch');
    
    try {
      // Use request queue to prevent duplicate requests
      const models = await requestQueue.enqueue(async () => {
        // Actual API call would go here
        return this.fetchModelsFromAPI();
      });
      
      // Cache the result
      performanceCache.set(cacheKey, models, CACHE_CONFIG.MODELS_CACHE_TTL);
      
      return models;
    } finally {
      endTimer();
    }
  }
  
  private static async fetchModelsFromAPI(): Promise<GhcCopilotModel[]> {
    // Placeholder for actual API call
    return [];
  }
  
  // Debounced configuration updates
  static updateConfigDebounced = debouncer.debounce(
    'config_update',
    async (config: any) => {
      const endTimer = performanceMonitor.startTimer('config_update');
      try {
        // Actual config update logic
        await this.performConfigUpdate(config);
        
        // Clear related caches
        performanceCache.delete('user_config');
      } finally {
        endTimer();
      }
    },
    1000 // 1 second debounce
  );
  
  private static async performConfigUpdate(config: any): Promise<void> {
    // Placeholder for actual config update
  }
  
  // Optimized session management
  static async getSessionCached(): Promise<GhcSession | null> {
    const cacheKey = 'current_session';
    
    const cached = performanceCache.get<GhcSession>(cacheKey);
    if (cached) {
      // Verify session is still valid
      const isValid = await this.validateTokenCached(cached.accessToken);
      if (isValid) {
        return cached;
      } else {
        performanceCache.delete(cacheKey);
      }
    }
    
    return null;
  }
  
  static cacheSession(session: GhcSession): void {
    performanceCache.set('current_session', session, CACHE_CONFIG.USER_INFO_CACHE_TTL);
  }
  
  static clearSessionCache(): void {
    performanceCache.delete('current_session');
  }
  
  // Memory optimization for large responses
  static optimizeStreamingResponse(chunks: string[]): string {
    // Join chunks efficiently
    if (chunks.length === 1) {
      return chunks[0];
    }
    
    // Use array join for better performance than string concatenation
    return chunks.join('');
  }
  
  // Preload critical resources
  static async preloadCriticalResources(): Promise<void> {
    const endTimer = performanceMonitor.startTimer('resource_preload');
    
    try {
      // Preload models list
      const modelsPromise = this.getModelsCached();
      
      // Preload user session if available
      const sessionPromise = this.getSessionCached();
      
      // Wait for critical resources
      await Promise.all([modelsPromise, sessionPromise]);
    } finally {
      endTimer();
    }
  }
  
  // Performance diagnostics
  static getDiagnostics() {
    return {
      cache: performanceCache.getStats(),
      requestQueue: {
        pending: requestQueue.getQueueLength(),
        running: requestQueue.getRunningCount()
      },
      metrics: performanceMonitor.getAllMetrics(),
      memory: {
        used: (performance as any).memory?.usedJSHeapSize || 'unknown',
        total: (performance as any).memory?.totalJSHeapSize || 'unknown'
      }
    };
  }
  
  // Clean up resources
  static cleanup(): void {
    performanceCache.clear();
    debouncer.cancelAll();
    performanceMonitor.clearMetrics();
  }
  
  // Configure performance settings
  static configure(options: {
    maxConcurrentRequests?: number;
    cacheSettings?: Partial<typeof CACHE_CONFIG>;
  }): void {
    if (options.maxConcurrentRequests) {
      requestQueue.setMaxConcurrent(options.maxConcurrentRequests);
    }
    
    if (options.cacheSettings) {
      Object.assign(CACHE_CONFIG, options.cacheSettings);
    }
  }
}

// Export performance utilities
export {
  performanceCache,
  debouncer,
  requestQueue,
  performanceMonitor,
  CACHE_CONFIG
};

// Performance optimization hooks for React components
export const useGhcPerformance = () => {
  return {
    getDiagnostics: GhcPerformanceOptimizer.getDiagnostics,
    preloadResources: GhcPerformanceOptimizer.preloadCriticalResources,
    cleanup: GhcPerformanceOptimizer.cleanup
  };
};