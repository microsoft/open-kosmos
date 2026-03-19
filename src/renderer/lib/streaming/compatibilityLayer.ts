/**
 * Streaming rendering compatibility layer
 * Ensures new typewriter effects are fully compatible with existing systems
 */

import { streamingConfigManager } from './streamingConfig';
import { streamingOptimizer } from './streamingOptimizer';

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
   * Initialize compatibility layer
   */
  async initialize(): Promise<void> {
    if (this.hasInitialized) return;

    try {
      // Check existing configuration
      const existingConfig = streamingConfigManager.getGlobalConfig();
      
      // If existing config has been customized by user, maintain compatibility
      if (this.hasUserCustomizations(existingConfig)) {
        this.config.preserveOriginalBehavior = true;
        if (this.config.debugCompatibility) {
          console.log('[StreamingCompatibility] Detected user customizations, preserving original behavior');
        }
      }

      // Ensure optimizer is initialized
      await streamingOptimizer.initialize();
      
      this.hasInitialized = true;
    } catch (error) {
      console.warn('[StreamingCompatibility] Initialization failed, enabling fallback mode:', error);
      this.config.fallbackToOriginal = true;
    }
  }

  /**
   * Check if there are user-customized configurations
   */
  private hasUserCustomizations(config: any): boolean {
    // Check if configuration deviates from defaults
    const hasCustomBatchSize = config.batchSize !== 5;
    const hasCustomDelay = config.batchDelay !== 10;
    const hasCustomPerformanceSettings = !config.enableAdaptiveOptimization;
    
    return hasCustomBatchSize || hasCustomDelay || hasCustomPerformanceSettings;
  }

  /**
   * Get compatible configuration
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

    // If preserving original behavior, use simplified configuration
    if (this.config.preserveOriginalBehavior) {
      return {
        useOriginalMethod: false,
        optimizedConfig: {
          baseDelay: 10, // Use slightly slower speed to maintain original feel
          enableBatching: false, // Disable batch processing
          maxBatchSize: 1,
          enableSmartPausing: false,
          adaptiveSpeed: false,
          performanceMode: 'balanced'
        }
      };
    }

    // Check text complexity, use original method for simple text
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
        // Auto-detect optimal mode
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
   * Check if feature is available
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
- Initialization Complete: ${this.hasInitialized ? '✅' : '❌'}
- Legacy Mode: ${this.config.enableLegacyMode ? 'Enabled' : 'Disabled'}
- Preserve Original Behavior: ${this.config.preserveOriginalBehavior ? 'Yes' : 'No'}
- Fallback to Original: ${this.config.fallbackToOriginal ? 'Yes' : 'No'}

Feature Availability:
- Typewriter Effect: ${this.isFeatureAvailable('typewriter') ? '✅' : '❌'}
- Batch Optimization: ${this.isFeatureAvailable('batching') ? '✅' : '❌'}
- Performance Optimization: ${this.isFeatureAvailable('optimization') ? '✅' : '❌'}

Configuration Status:
- Streaming Rendering Enabled: ${streamingConfig.enabled ? '✅' : '❌'}
- Performance Tracking: ${streamingConfig.performanceTracking ? '✅' : '❌'}
- Adaptive Optimization: ${streamingConfig.enableAdaptiveOptimization ? '✅' : '❌'}

Optimizer Status:
- Performance Mode: ${optimizer.performanceMode}
- Base Delay: ${optimizer.baseDelay}ms
- Batching: ${optimizer.enableBatching ? 'Enabled' : 'Disabled'}
- Smart Pausing: ${optimizer.enableSmartPausing ? 'Enabled' : 'Disabled'}

Suggestions:
${this.getRecommendations().map(rec => `• ${rec}`).join('\n')}
`;
  }

  /**
   * Get recommendations
   */
  private getRecommendations(): string[] {
    const recommendations: string[] = [];

    if (this.config.fallbackToOriginal) {
      recommendations.push('Compatibility issues detected. Please check the console for error messages');
    }

    if (this.config.preserveOriginalBehavior) {
      recommendations.push('Custom user configuration detected. Reset configuration to try new features');
    }

    if (!streamingConfigManager.getGlobalConfig().enabled) {
      recommendations.push('Streaming rendering is disabled. Enable it for a better experience');
    }

    if (!this.hasInitialized) {
      recommendations.push('Compatibility layer not initialized. This may affect normal functionality');
    }

    if (recommendations.length === 0) {
      recommendations.push('All features are running normally. Enjoy the smooth typewriter effect!');
    }

    return recommendations;
  }

  /**
   * Test compatibility
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

      // Test configuration retrieval
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
  // Delayed initialization to avoid blocking
  requestAnimationFrame(() => {
    streamingCompatibility.initialize().catch(console.warn);
  });
}