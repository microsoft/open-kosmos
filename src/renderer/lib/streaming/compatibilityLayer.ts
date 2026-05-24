/**
 * Streaming rendering compatibility layer
 * Ensures the new typewriter effect is fully compatible with the existing system
 */

import { streamingConfigManager } from './streamingConfig';
import { streamingOptimizer } from './streamingOptimizer';
import { createLogger } from '../utilities/logger';
const logger = createLogger('[CompatibilityLayer]');

export interface CompatibilityConfig {
  enableLegacyMode: boolean;
  preserveOriginalBehavior: boolean;
  fallbackToOriginal: boolean;
  debugCompatibility: boolean;
}

export class StreamingCompatibilityLayer {
  private config: CompatibilityConfig = {
    enableLegacyMode: false,
    preserveOriginalBehavior: false,
    fallbackToOriginal: false,
    debugCompatibility: false
  };

  private hasInitialized = false;

  /**
   * Initialize the compatibility layer
   */
  async initialize(): Promise<void> {
    if (this.hasInitialized) return;

    try {
      // Check existing config
      const existingConfig = streamingConfigManager.getGlobalConfig();

      // If the existing config has user customizations, preserve compatibility
      if (this.hasUserCustomizations(existingConfig)) {
        this.config.preserveOriginalBehavior = true;
        if (this.config.debugCompatibility) {
          logger.debug('[StreamingCompatibility] Detected user customizations, preserving original behavior');
        }
      }

      // Ensure optimizer is initialized
      await streamingOptimizer.initialize();

      this.hasInitialized = true;
    } catch (error) {
      logger.warn('[StreamingCompatibility] Initialization failed, enabling fallback mode:', error);
      this.config.fallbackToOriginal = true;
    }
  }

  /**
   * Check whether the user has custom config
   */
  private hasUserCustomizations(config: any): boolean {
    // Check if config deviates from defaults
    const hasCustomBatchSize = config.batchSize !== 5;
    const hasCustomDelay = config.batchDelay !== 10;
    const hasCustomPerformanceSettings = !config.enableAdaptiveOptimization;

    return hasCustomBatchSize || hasCustomDelay || hasCustomPerformanceSettings;
  }

  /**
   * Get compatible config
   */
  getCompatibleConfig(text: string): {
    useOriginalMethod: boolean;
    optimizedConfig?: any;
    fallbackReason?: string;
  } {
    // If fallback mode is enabled, use original method
    if (this.config.fallbackToOriginal) {
      return {
        useOriginalMethod: true,
        fallbackReason: 'Compatibility layer fallback enabled'
      };
    }

    // If preserving original behavior, use simplified config
    if (this.config.preserveOriginalBehavior) {
      return {
        useOriginalMethod: false,
        optimizedConfig: {
          baseDelay: 10, // Use slightly slower speed to preserve original feel
          enableBatching: false, // Disable batching
          maxBatchSize: 1,
          enableSmartPausing: false,
          adaptiveSpeed: false,
          performanceMode: 'balanced'
        }
      };
    }

    // For simple text, skip optimization
    if (this.isSimpleText(text)) {
      return {
        useOriginalMethod: false,
        optimizedConfig: streamingOptimizer.getConfigForText(text)
      };
    }

    // Use full optimization for complex text
    return {
      useOriginalMethod: false,
      optimizedConfig: streamingOptimizer.getConfigForText(text)
    };
  }

  /**
   * Check if text is simple
   */
  private isSimpleText(text: string): boolean {
    return text.length < 50 && !text.includes('\n') && !/[.!?]{2,}/.test(text);
  }

  /**
   * Set compatibility mode
   */
  setCompatibilityMode(mode: 'legacy' | 'enhanced' | 'auto'): void {
    switch (mode) {
      case 'legacy':
        this.config.enableLegacyMode = true;
        this.config.preserveOriginalBehavior = true;
        break;
      case 'enhanced':
        this.config.enableLegacyMode = false;
        this.config.preserveOriginalBehavior = false;
        break;
      case 'auto':
      default:
        // Auto-detect best mode
        this.config.enableLegacyMode = false;
        this.config.preserveOriginalBehavior = false;
        break;
    }
  }

  /**
   * Enable debug mode
   */
  enableDebug(enabled: boolean = true): void {
    this.config.debugCompatibility = enabled;
  }

  /**
   * Check if a feature is available
   */
  isFeatureAvailable(feature: 'typewriter' | 'batching' | 'optimization'): boolean {
    switch (feature) {
      case 'typewriter':
        return !this.config.fallbackToOriginal;
      case 'batching':
        return !this.config.preserveOriginalBehavior && !this.config.fallbackToOriginal;
      case 'optimization':
        return !this.config.enableLegacyMode && !this.config.fallbackToOriginal;
      default:
        return true;
    }
  }

  /**
   * Get compatibility report
   */
  getCompatibilityReport(): string {
    const optimizer = streamingOptimizer.getCurrentConfig();
    const streamingConfig = streamingConfigManager.getGlobalConfig();

    return `
Streaming Rendering Compatibility Report
==================

Compatibility Status:
- Initialized: ${this.hasInitialized ? '✅' : '❌'}
- Legacy Mode: ${this.config.enableLegacyMode ? 'Enabled' : 'Disabled'}
- Preserve Original Behavior: ${this.config.preserveOriginalBehavior ? 'Yes' : 'No'}
- Fallback to Original: ${this.config.fallbackToOriginal ? 'Yes' : 'No'}

Feature Availability:
- Typewriter Effect: ${this.isFeatureAvailable('typewriter') ? '✅' : '❌'}
- Batching Optimization: ${this.isFeatureAvailable('batching') ? '✅' : '❌'}
- Performance Optimization: ${this.isFeatureAvailable('optimization') ? '✅' : '❌'}

Config Status:
- Streaming Enabled: ${streamingConfig.enabled ? '✅' : '❌'}
- Performance Tracking: ${streamingConfig.performanceTracking ? '✅' : '❌'}
- Adaptive Optimization: ${streamingConfig.enableAdaptiveOptimization ? '✅' : '❌'}

Optimizer Status:
- Performance Mode: ${optimizer.performanceMode}
- Base Delay: ${optimizer.baseDelay}ms
- Batching: ${optimizer.enableBatching ? 'Enabled' : 'Disabled'}
- Smart Pausing: ${optimizer.enableSmartPausing ? 'Enabled' : 'Disabled'}

Recommendations:
${this.getRecommendations().map(rec => `• ${rec}`).join('\n')}
`;
  }

  /**
   * Get recommendations
   */
  private getRecommendations(): string[] {
    const recommendations: string[] = [];

    if (this.config.fallbackToOriginal) {
      recommendations.push('Compatibility issue detected; check the console for error details');
    }

    if (this.config.preserveOriginalBehavior) {
      recommendations.push('User customizations detected; reset config to experience new features');
    }

    if (!streamingConfigManager.getGlobalConfig().enabled) {
      recommendations.push('Streaming rendering is disabled; enable it for a better experience');
    }

    if (!this.hasInitialized) {
      recommendations.push('Compatibility layer is not initialized; functionality may be affected');
    }

    if (recommendations.length === 0) {
      recommendations.push('All features are running normally — enjoy the smooth typewriter effect!');
    }

    return recommendations;
  }

  /**
   * Run compatibility test
   */
  async runCompatibilityTest(): Promise<{
    success: boolean;
    results: { [key: string]: boolean };
    errors: string[];
  }> {
    const results: { [key: string]: boolean } = {};
    const errors: string[] = [];

    try {
      // Test basic functionality
      results.initialization = this.hasInitialized;
      results.configManager = !!streamingConfigManager;
      results.optimizer = !!streamingOptimizer;

      // Test config generation
      try {
        const config = this.getCompatibleConfig('Hello World!');
        results.configGeneration = !!config;
      } catch (error) {
        results.configGeneration = false;
        errors.push(`Config generation failed: ${error}`);
      }

      // Test feature availability
      results.typewriterFeature = this.isFeatureAvailable('typewriter');
      results.batchingFeature = this.isFeatureAvailable('batching');
      results.optimizationFeature = this.isFeatureAvailable('optimization');

      const success = Object.values(results).every(result => result === true) && errors.length === 0;

      return { success, results, errors };
    } catch (error) {
      errors.push(`Compatibility test failed: ${error}`);
      return { success: false, results, errors };
    }
  }
}

// Export global instance
export const streamingCompatibility = new StreamingCompatibilityLayer();

// Auto-initialize
if (typeof window !== 'undefined') {
  // Defer initialization to avoid blocking
  requestAnimationFrame(() => {
    streamingCompatibility.initialize().catch(err => logger.warn('Failed to initialize streaming compatibility', err));
  });
}