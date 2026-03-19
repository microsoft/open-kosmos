/**
 * Streaming rendering optimizer
 * Dynamically adjusts typewriter effect configuration based on performance test results
 */

// Removed dependency on typewriterPerformanceTest

export interface StreamingOptimizationConfig {
  baseDelay: number;
  enableBatching: boolean;
  maxBatchSize: number;
  enableSmartPausing: boolean;
  adaptiveSpeed: boolean;
  performanceMode: 'smooth' | 'balanced' | 'fast';
}

export interface DeviceCapabilities {
  cpuScore: number; // 0-100
  memoryMB: number;
  isLowEndDevice: boolean;
  preferredFramerate: number;
}

export class StreamingOptimizer {
  private currentConfig: StreamingOptimizationConfig;
  private deviceCapabilities: DeviceCapabilities | null = null;

  constructor() {
    // 🚀 Default configuration - ultra-fast mode
    this.currentConfig = {
      baseDelay: 2, // 🚀 Minimum delay, ultra-fast output
      enableBatching: true,
      maxBatchSize: 8, // 🚀 Maximum batch processing, faster speed
      enableSmartPausing: false, // 🚀 Disable smart pausing, maintain high speed
      adaptiveSpeed: false, // 🚀 Fixed high speed, no adaptive adjustment
      performanceMode: 'fast'
    };
  }

  /**
   * Initialize optimizer - detect device capabilities
   */
  async initialize(): Promise<void> {
    this.deviceCapabilities = await this.detectDeviceCapabilities();
    this.currentConfig = this.getOptimalConfigForDevice(this.deviceCapabilities);
    
    // Configuration optimized based on device capabilities
  }

  /**
   * Detect device capabilities
   */
  private async detectDeviceCapabilities(): Promise<DeviceCapabilities> {
    // CPU performance test
    const cpuScore = await this.measureCPUPerformance();
    
    // Memory information
    let memoryMB = 4096; // Default 4GB
    if ('memory' in performance) {
      const memInfo = (performance as any).memory;
      memoryMB = memInfo.jsHeapSizeLimit / 1024 / 1024;
    }

    // Determine if it's a low-end device
    const isLowEndDevice = cpuScore < 30 || memoryMB < 2048 || this.isSlowDevice();

    return {
      cpuScore,
      memoryMB,
      isLowEndDevice,
      preferredFramerate: isLowEndDevice ? 30 : 60
    };
  }

  /**
   * CPU performance test
   */
  private async measureCPUPerformance(): Promise<number> {
    const iterations = 10000;
    const startTime = performance.now();
    
    // Simple compute-intensive task
    let result = 0;
    for (let i = 0; i < iterations; i++) {
      result += Math.sin(i) * Math.cos(i) * Math.sqrt(i);
    }
    
    const endTime = performance.now();
    const duration = endTime - startTime;
    
    // Convert to 0-100 score (assuming 1ms is full score)
    const score = Math.max(0, Math.min(100, 100 - duration));
    return score;
  }

  /**
   * Detect slow devices
   */
  private isSlowDevice(): boolean {
    // Check for low-end device identifiers in User Agent
    const userAgent = navigator.userAgent.toLowerCase();
    const slowDeviceIndicators = [
      'android 4', 'android 5', 'android 6', // Older Android versions
      'iphone os 9', 'iphone os 10', 'iphone os 11', // Older iOS versions
      'samsung-sm-', // Some Samsung low-end devices
      'cpu os 9', 'cpu os 10' // Older iPads
    ];

    return slowDeviceIndicators.some(indicator => userAgent.includes(indicator));
  }

  /**
   * Get optimal configuration based on device capabilities
   */
  private getOptimalConfigForDevice(capabilities: DeviceCapabilities): StreamingOptimizationConfig {
    if (capabilities.isLowEndDevice) {
      // Low-end device - still fast
      return {
        baseDelay: 5, // 🚀 As fast as possible
        enableBatching: true,
        maxBatchSize: 8, // Larger batch processing to compensate for performance
        enableSmartPausing: false,
        adaptiveSpeed: false,
        performanceMode: 'fast'
      };
    } else if (capabilities.cpuScore > 80) {
      // High-end device - ultra-fast mode
      return {
        baseDelay: 1, // 🚀 Maximum speed
        enableBatching: true,
        maxBatchSize: 10, // 🚀 Maximum batch processing
        enableSmartPausing: false,
        adaptiveSpeed: false,
        performanceMode: 'fast'
      };
    } else {
      // Mid-range device - fast mode
      return {
        baseDelay: 2, // 🚀 Fast
        enableBatching: true,
        maxBatchSize: 8,
        enableSmartPausing: false,
        adaptiveSpeed: false,
        performanceMode: 'fast'
      };
    }
  }

  /**
   * Simplified performance adjustment - removed complex performance tests
   */
  private adjustConfigBasedOnDevice(): void {
    if (this.deviceCapabilities?.isLowEndDevice) {
      this.adjustConfigForPoorPerformance();
    }
  }

  /**
   * Adjust configuration for poor performance
   */
  private adjustConfigForPoorPerformance(): void {
    // Increase delay, reduce CPU load
    this.currentConfig.baseDelay = Math.min(this.currentConfig.baseDelay * 1.5, 20);
    
    // Increase batch processing size
    if (this.currentConfig.enableBatching) {
      this.currentConfig.maxBatchSize = Math.min(this.currentConfig.maxBatchSize + 1, 8);
    }
    
    // Disable adaptive speed
    this.currentConfig.adaptiveSpeed = false;
  }

  /**
   * Get current configuration
   */
  getCurrentConfig(): StreamingOptimizationConfig {
    return { ...this.currentConfig };
  }

  /**
   * Set performance mode
   */
  setPerformanceMode(mode: 'smooth' | 'balanced' | 'fast'): void {
    switch (mode) {
      case 'smooth':
        this.currentConfig = {
          baseDelay: 3, // 🚀 Fast even in smooth mode
          enableBatching: true,
          maxBatchSize: 5,
          enableSmartPausing: false,
          adaptiveSpeed: false,
          performanceMode: 'smooth'
        };
        break;
      
      case 'balanced':
        this.currentConfig = {
          baseDelay: 2, // 🚀 Fast
          enableBatching: true,
          maxBatchSize: 8,
          enableSmartPausing: false,
          adaptiveSpeed: false,
          performanceMode: 'balanced'
        };
        break;
      
      case 'fast':
        this.currentConfig = {
          baseDelay: 1, // 🚀 Ultra-fast
          enableBatching: true,
          maxBatchSize: 10, // 🚀 Maximum batch processing
          enableSmartPausing: false,
          adaptiveSpeed: false,
          performanceMode: 'fast'
        };
        break;
    }
  }

  /**
   * Dynamically adjust configuration based on text characteristics
   */
  getConfigForText(text: string): StreamingOptimizationConfig {
    const config = { ...this.currentConfig };
    
    // 🚀 Faster for long text - increase batch processing
    if (text.length > 500) {
      config.maxBatchSize = Math.min(config.maxBatchSize + 3, 15);
      config.baseDelay = Math.max(config.baseDelay - 1, 1);
    }
    
    // 🚀 Fast for code text too
    if (this.isCodeText(text)) {
      config.enableSmartPausing = false;
      config.baseDelay = Math.max(config.baseDelay - 1, 1);
      config.maxBatchSize = Math.min(config.maxBatchSize + 2, 12);
    }
    
    // 🚀 Maintain high speed for multi-language content
    if (this.hasMultiLanguage(text)) {
      config.maxBatchSize = Math.max(config.maxBatchSize, 6); // Maintain larger batch processing
    }

    return config;
  }

  /**
   * Detect if text is code
   */
  private isCodeText(text: string): boolean {
    const codeIndicators = [
      'function', 'const', 'let', 'var', 'class', 'import', 'export',
      '{', '}', ';', '//', '/*', '*/', '===', '!==', '=>'
    ];
    
    return codeIndicators.some(indicator => text.includes(indicator));
  }

  /**
   * Detect if text contains multi-language content
   */
  private hasMultiLanguage(text: string): boolean {
    const hasEnglish = /[a-zA-Z]/.test(text);
    const hasChinese = /[\u4e00-\u9fff]/.test(text);
    const hasJapanese = /[\u3040-\u309f\u30a0-\u30ff]/.test(text);
    const hasKorean = /[\uac00-\ud7af]/.test(text);
    
    const languageCount = [hasEnglish, hasChinese, hasJapanese, hasKorean].filter(Boolean).length;
    return languageCount > 1;
  }

  /**
   * Get device information report
   */
  getDeviceReport(): string {
    if (!this.deviceCapabilities) {
      return 'Device capabilities not yet detected';
    }

    const caps = this.deviceCapabilities;
    return `
Device Performance Report
============

CPU Score: ${caps.cpuScore}/100
Memory Size: ${caps.memoryMB.toFixed(0)}MB
Device Type: ${caps.isLowEndDevice ? 'Low-end Device' : 'High-end Device'}
Recommended FPS: ${caps.preferredFramerate}FPS

Current Configuration:
- Base Delay: ${this.currentConfig.baseDelay}ms
- Batching: ${this.currentConfig.enableBatching ? 'Enabled' : 'Disabled'}
- Max Batch Size: ${this.currentConfig.maxBatchSize}
- Smart Pausing: ${this.currentConfig.enableSmartPausing ? 'Enabled' : 'Disabled'}
- Adaptive Speed: ${this.currentConfig.adaptiveSpeed ? 'Enabled' : 'Disabled'}
- Performance Mode: ${this.currentConfig.performanceMode}

`;
  }
}

// Export global instance
export const streamingOptimizer = new StreamingOptimizer();

// Auto-initialize
if (typeof window !== 'undefined') {
  // Delayed initialization to avoid blocking page load
  setTimeout(() => {
    streamingOptimizer.initialize().catch(console.error);
  }, 1000);
}