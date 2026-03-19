/**
 * Kosmos Streaming v2 configuration management and toggle control
 * Provides dynamic configuration, feature toggles, and performance tuning
 */

export interface StreamingV2Config {
  enabled: boolean;
  batchSize: number;
  batchDelay: number; // ms
  performanceTracking: boolean;
  fallbackToV1OnError: boolean;
  maxRetries: number;
  showStreamingMetrics: boolean;
  enableAdaptiveOptimization: boolean;
  debugMode: boolean;
}

export interface StreamingV2PerformanceConfig {
  targetFPS: number;
  adaptiveThrottling: boolean;
  memoryOptimization: boolean;
  bufferSize: number;
  flushThreshold: number;
}

export interface StreamingV2UIConfig {
  showCursor: boolean;
  cursorAnimation: 'blink' | 'pulse' | 'fade' | 'smooth' | 'none';
  smoothScrolling: boolean;
  autoScrollThreshold: number; // px from bottom
  renderingMode: 'immediate' | 'batched' | 'adaptive';
}

export interface AgentStreamingConfig {
  agentId: string;
  streamingV2?: StreamingV2Config;
  performance?: StreamingV2PerformanceConfig;
  ui?: StreamingV2UIConfig;
}

// ========== Default Configuration ==========

export const DEFAULT_STREAMING_V2_CONFIG: StreamingV2Config = {
  enabled: true,
  batchSize: 10,  // 🚀 Increase batch size for fastest output
  batchDelay: 5, // 🚀 Minimum delay, maximum speed
  performanceTracking: true,
  fallbackToV1OnError: true,
  maxRetries: 3,
  showStreamingMetrics: false,
  enableAdaptiveOptimization: true,
  debugMode: false
};

export const DEFAULT_PERFORMANCE_CONFIG: StreamingV2PerformanceConfig = {
  targetFPS: 120, // High frame rate ensures smoothness
  adaptiveThrottling: false, // 🚀 Disable throttling, maximum speed
  memoryOptimization: true,
  bufferSize: 200, // 🚀 Larger buffer supports ultra-fast output
  flushThreshold: 300 // 🚀 Lower threshold, faster output
};

export const DEFAULT_UI_CONFIG: StreamingV2UIConfig = {
  showCursor: false, // No cursor output
  cursorAnimation: 'none', // No cursor animation
  smoothScrolling: true,
  autoScrollThreshold: 150,
  renderingMode: 'immediate' // Use immediate rendering mode to maximize output speed
};

// ========== Configuration Manager ==========

export class StreamingConfigManager {
  private globalConfig: StreamingV2Config;
  private performanceConfig: StreamingV2PerformanceConfig;
  private uiConfig: StreamingV2UIConfig;
  private agentConfigs: Map<string, AgentStreamingConfig> = new Map();
  private configListeners: Array<(config: StreamingV2Config) => void> = [];

  constructor() {
    // Always use default configuration from code, do not load from localStorage
    this.globalConfig = { ...DEFAULT_STREAMING_V2_CONFIG };
    this.performanceConfig = { ...DEFAULT_PERFORMANCE_CONFIG };
    this.uiConfig = { ...DEFAULT_UI_CONFIG };
    
    this.setupPerformanceMonitoring();
  }

  // ========== Global Configuration Management ==========

  getGlobalConfig(): StreamingV2Config {
    return { ...this.globalConfig };
  }

  updateGlobalConfig(updates: Partial<StreamingV2Config>): void {
    this.globalConfig = { ...this.globalConfig, ...updates };
    this.notifyConfigListeners();
    
    // Apply adaptive optimization
    if (updates.enableAdaptiveOptimization !== undefined) {
      this.applyAdaptiveOptimization();
    }
  }

  getPerformanceConfig(): StreamingV2PerformanceConfig {
    return { ...this.performanceConfig };
  }

  updatePerformanceConfig(updates: Partial<StreamingV2PerformanceConfig>): void {
    this.performanceConfig = { ...this.performanceConfig, ...updates };
  }

  getUIConfig(): StreamingV2UIConfig {
    return { ...this.uiConfig };
  }

  updateUIConfig(updates: Partial<StreamingV2UIConfig>): void {
    this.uiConfig = { ...this.uiConfig, ...updates };
  }

  // ========== Agent-Specific Configuration Management ==========

  getAgentConfig(agentId: string): AgentStreamingConfig {
    const existing = this.agentConfigs.get(agentId);
    if (existing) {
      return { ...existing };
    }
    
    // Return default agent configuration based on global config
    return {
      agentId,
      streamingV2: { ...this.globalConfig },
      performance: { ...this.performanceConfig },
      ui: { ...this.uiConfig }
    };
  }

  updateAgentConfig(agentId: string, updates: Partial<AgentStreamingConfig>): void {
    const currentConfig = this.getAgentConfig(agentId);
    const newConfig: AgentStreamingConfig = {
      ...currentConfig,
      ...updates,
      agentId
    };
    
    this.agentConfigs.set(agentId, newConfig);
  }

  removeAgentConfig(agentId: string): void {
    this.agentConfigs.delete(agentId);
  }

  // ========== Feature Toggles ==========

  isStreamingV2Enabled(agentId?: string): boolean {
    if (agentId) {
      const agentConfig = this.getAgentConfig(agentId);
      return agentConfig.streamingV2?.enabled ?? this.globalConfig.enabled;
    }
    return this.globalConfig.enabled;
  }

  toggleStreamingV2(enabled: boolean, agentId?: string): void {
    if (agentId) {
      const agentConfig = this.getAgentConfig(agentId);
      this.updateAgentConfig(agentId, {
        streamingV2: {
          ...DEFAULT_STREAMING_V2_CONFIG,
          ...agentConfig.streamingV2,
          enabled
        }
      });
    } else {
      this.updateGlobalConfig({ enabled });
    }
    
  }

  isPerformanceTrackingEnabled(agentId?: string): boolean {
    if (agentId) {
      const agentConfig = this.getAgentConfig(agentId);
      return agentConfig.streamingV2?.performanceTracking ?? this.globalConfig.performanceTracking;
    }
    return this.globalConfig.performanceTracking;
  }

  isDebugModeEnabled(agentId?: string): boolean {
    if (agentId) {
      const agentConfig = this.getAgentConfig(agentId);
      return agentConfig.streamingV2?.debugMode ?? this.globalConfig.debugMode;
    }
    return this.globalConfig.debugMode;
  }

  // ========== Configuration Listeners ==========

  addConfigListener(listener: (config: StreamingV2Config) => void): () => void {
    this.configListeners.push(listener);
    
    // Return unsubscribe function
    return () => {
      const index = this.configListeners.indexOf(listener);
      if (index > -1) {
        this.configListeners.splice(index, 1);
      }
    };
  }

  private notifyConfigListeners(): void {
    for (const listener of this.configListeners) {
      try {
        listener(this.globalConfig);
      } catch (error) {
      }
    }
  }

  // ========== Adaptive Optimization ==========

  private setupPerformanceMonitoring(): void {
    // Monitor performance metrics, automatically adjust configuration
    if (typeof window !== 'undefined') {
      let lastPerformanceCheck = Date.now();
      let performanceCheckCount = 0;
      let lastOptimizationTime = 0;
      
      setInterval(() => {
        if (this.globalConfig.enableAdaptiveOptimization) {
          performanceCheckCount++;
          // Only optimize during first few checks, then reduce frequency
          if (performanceCheckCount <= 3 || (Date.now() - lastOptimizationTime) > 60000) {
            this.checkAndOptimizePerformance();
            lastOptimizationTime = Date.now();
          }
        }
      }, 10000); // Check every 10 seconds, reduced frequency
    }
  }

  private checkAndOptimizePerformance(): void {
    const now = performance.now();
    const memoryInfo = (performance as any).memory;
    
    if (memoryInfo) {
      const memoryUsageRatio = memoryInfo.usedJSHeapSize / memoryInfo.jsHeapSizeLimit;
      
      // Stricter thresholds to reduce unnecessary optimization
      if (memoryUsageRatio > 0.85) {
        this.optimizeForMemory();
      } else if (memoryUsageRatio < 0.3) {
        this.optimizeForPerformance();
      }
    }
  }

  private optimizeForMemory(): void {
    
    // Reduce update frequency to avoid frequent configuration changes
    this.updatePerformanceConfigSilent({
      bufferSize: Math.max(this.performanceConfig.bufferSize - 10, 20),
      flushThreshold: Math.max(this.performanceConfig.flushThreshold - 100, 500)
    });
    
    this.updateGlobalConfigSilent({
      batchSize: Math.max(this.globalConfig.batchSize - 5, 10),
      batchDelay: Math.min(this.globalConfig.batchDelay + 5, 100)
    });
  }

  private optimizeForPerformance(): void {
    
    // Reduce update frequency to avoid frequent configuration changes
    this.updatePerformanceConfigSilent({
      bufferSize: Math.min(this.performanceConfig.bufferSize + 10, 100),
      flushThreshold: Math.min(this.performanceConfig.flushThreshold + 100, 2000)
    });
    
    this.updateGlobalConfigSilent({
      batchSize: Math.min(this.globalConfig.batchSize + 5, 50),
      batchDelay: Math.max(this.globalConfig.batchDelay - 5, 10)
    });
  }

  // Silent update methods that don't trigger listeners
  private updateGlobalConfigSilent(updates: Partial<StreamingV2Config>): void {
    this.globalConfig = { ...this.globalConfig, ...updates };
    // Don't call notifyConfigListeners() to avoid frequent updates
  }

  private updatePerformanceConfigSilent(updates: Partial<StreamingV2PerformanceConfig>): void {
    this.performanceConfig = { ...this.performanceConfig, ...updates };
  }

  private applyAdaptiveOptimization(): void {
    if (this.globalConfig.enableAdaptiveOptimization) {
      // Initialize adaptive optimization
      this.checkAndOptimizePerformance();
    } else {
    }
  }

  // ========== Reset Configuration ==========

  resetToDefaults(): void {
    this.globalConfig = { ...DEFAULT_STREAMING_V2_CONFIG };
    this.performanceConfig = { ...DEFAULT_PERFORMANCE_CONFIG };
    this.uiConfig = { ...DEFAULT_UI_CONFIG };
    this.agentConfigs.clear();
    this.notifyConfigListeners();
  }

  resetAgentConfig(agentId: string): void {
    this.agentConfigs.delete(agentId);
  }
}

// ========== Configuration Validator ==========

export class StreamingConfigValidator {
  static validateConfig(config: Partial<StreamingV2Config>): {
    isValid: boolean;
    errors: string[];
    warnings: string[];
  } {
    const errors: string[] = [];
    const warnings: string[] = [];
    
    // Validate required fields
    if (config.batchSize !== undefined && (config.batchSize < 1 || config.batchSize > 100)) {
      errors.push('batchSize must be between 1 and 100');
    }
    
    if (config.batchDelay !== undefined && (config.batchDelay < 1 || config.batchDelay > 1000)) {
      errors.push('batchDelay must be between 1 and 1000ms');
    }
    
    if (config.maxRetries !== undefined && (config.maxRetries < 0 || config.maxRetries > 10)) {
      errors.push('maxRetries must be between 0 and 10');
    }
    
    // Performance warnings
    if (config.batchSize !== undefined && config.batchSize > 50) {
      warnings.push('Large batch size may impact performance');
    }
    
    if (config.batchDelay !== undefined && config.batchDelay < 10) {
      warnings.push('Very low batch delay may cause excessive CPU usage');
    }
    
    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }
}

// ========== Export Singleton Instance ==========

export const streamingConfigManager = new StreamingConfigManager();