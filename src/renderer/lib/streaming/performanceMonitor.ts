/**
 * Streaming performance monitoring tool
 * Monitors typewriter effect performance metrics and provides optimization suggestions
 */

export interface PerformanceMetrics {
  // Rendering performance
  averageRenderTime: number;
  peakRenderTime: number;
  totalRenders: number;
  
  // Frame rate
  currentFPS: number;
  averageFPS: number;
  minFPS: number;
  
  // Memory
  memoryUsageMB: number;
  memoryDeltaMB: number;
  
  // Typewriter performance
  charactersPerSecond: number;
  averageCharDelay: number;
  
  // Timestamp
  timestamp: number;
}

export interface PerformanceAlert {
  level: 'info' | 'warning' | 'critical';
  message: string;
  metric: string;
  value: number;
  threshold: number;
  timestamp: number;
}

export class StreamingPerformanceMonitor {
  private renderTimes: number[] = [];
  private frameTimes: number[] = [];
  private lastFrameTime: number = 0;
  private renderCount: number = 0;
  private startMemory: number = 0;
  private charCount: number = 0;
  private charStartTime: number = 0;
  private alerts: PerformanceAlert[] = [];
  private isMonitoring: boolean = false;
  
  // Performance threshold configuration
  private readonly thresholds = {
    maxRenderTime: 16.67, // 60fps = 16.67ms per frame
    minFPS: 30,
    maxMemoryDeltaMB: 50,
    minCharsPerSecond: 20
  };
  
  constructor() {
    this.resetMetrics();
  }
  
  /**
   * Start monitoring
   */
  startMonitoring(): void {
    if (this.isMonitoring) return;
    
    this.isMonitoring = true;
    this.resetMetrics();
    this.charStartTime = performance.now();
    
    // Record initial memory
    if ('memory' in performance) {
      const memInfo = (performance as any).memory;
      this.startMemory = memInfo.usedJSHeapSize / 1024 / 1024;
    }
    
    console.log('[PerformanceMonitor] Started monitoring performance');
  }
  
  /**
   * Stop monitoring
   */
  stopMonitoring(): PerformanceMetrics {
    if (!this.isMonitoring) {
      return this.getMetrics();
    }
    
    this.isMonitoring = false;
    const metrics = this.getMetrics();
    
    console.log('[PerformanceMonitor] Stopped monitoring, final metrics:', metrics);
    
    // Check performance alerts
    this.checkPerformanceAlerts(metrics);
    
    return metrics;
  }
  
  /**
   * Record a single render
   */
  recordRender(renderTime: number): void {
    if (!this.isMonitoring) return;
    
    this.renderTimes.push(renderTime);
    this.renderCount++;
    
    // Keep the most recent 100 render records
    if (this.renderTimes.length > 100) {
      this.renderTimes.shift();
    }
    
    // Check if render time exceeds threshold
    if (renderTime > this.thresholds.maxRenderTime) {
      this.addAlert({
        level: 'warning',
        message: `Render time too long: ${renderTime.toFixed(2)}ms`,
        metric: 'renderTime',
        value: renderTime,
        threshold: this.thresholds.maxRenderTime,
        timestamp: Date.now()
      });
    }
  }
  
  /**
   * Record frame update
   */
  recordFrame(): void {
    if (!this.isMonitoring) return;
    
    const now = performance.now();
    if (this.lastFrameTime > 0) {
      const frameTime = now - this.lastFrameTime;
      this.frameTimes.push(frameTime);
      
      // Keep the most recent 60 frame records
      if (this.frameTimes.length > 60) {
        this.frameTimes.shift();
      }
      
      // Check if frame rate is too low
      const fps = 1000 / frameTime;
      if (fps < this.thresholds.minFPS) {
        this.addAlert({
          level: 'warning',
          message: `Frame rate too low: ${fps.toFixed(1)} FPS`,
          metric: 'fps',
          value: fps,
          threshold: this.thresholds.minFPS,
          timestamp: Date.now()
        });
      }
    }
    this.lastFrameTime = now;
  }
  
  /**
   * Record character update
   */
  recordCharacters(count: number): void {
    if (!this.isMonitoring) return;
    this.charCount += count;
  }
  
  /**
   * Get current performance metrics
   */
  getMetrics(): PerformanceMetrics {
    const now = performance.now();
    const elapsedTime = (now - this.charStartTime) / 1000; // seconds
    
    // Calculate rendering performance
    const averageRenderTime = this.renderTimes.length > 0
      ? this.renderTimes.reduce((a, b) => a + b, 0) / this.renderTimes.length
      : 0;
    const peakRenderTime = this.renderTimes.length > 0
      ? Math.max(...this.renderTimes)
      : 0;
    
    // Calculate frame rate
    const recentFrameTimes = this.frameTimes.slice(-30); // Last 30 frames
    const averageFPS = recentFrameTimes.length > 0
      ? 1000 / (recentFrameTimes.reduce((a, b) => a + b, 0) / recentFrameTimes.length)
      : 0;
    const currentFPS = this.frameTimes.length > 0
      ? 1000 / this.frameTimes[this.frameTimes.length - 1]
      : 0;
    const minFPS = recentFrameTimes.length > 0
      ? 1000 / Math.max(...recentFrameTimes)
      : 0;
    
    // Calculate memory usage
    let memoryUsageMB = 0;
    let memoryDeltaMB = 0;
    if ('memory' in performance) {
      const memInfo = (performance as any).memory;
      memoryUsageMB = memInfo.usedJSHeapSize / 1024 / 1024;
      memoryDeltaMB = memoryUsageMB - this.startMemory;
    }
    
    // Calculate typewriter performance
    const charactersPerSecond = elapsedTime > 0 ? this.charCount / elapsedTime : 0;
    const averageCharDelay = charactersPerSecond > 0 ? 1000 / charactersPerSecond : 0;
    
    return {
      averageRenderTime,
      peakRenderTime,
      totalRenders: this.renderCount,
      currentFPS,
      averageFPS,
      minFPS,
      memoryUsageMB,
      memoryDeltaMB,
      charactersPerSecond,
      averageCharDelay,
      timestamp: Date.now()
    };
  }
  
  /**
   * Check performance alerts
   */
  private checkPerformanceAlerts(metrics: PerformanceMetrics): void {
    // Check average frame rate
    if (metrics.averageFPS < this.thresholds.minFPS) {
      this.addAlert({
        level: 'critical',
        message: `Average frame rate too low: ${metrics.averageFPS.toFixed(1)} FPS`,
        metric: 'averageFPS',
        value: metrics.averageFPS,
        threshold: this.thresholds.minFPS,
        timestamp: Date.now()
      });
    }
    
    // Check memory growth
    if (metrics.memoryDeltaMB > this.thresholds.maxMemoryDeltaMB) {
      this.addAlert({
        level: 'critical',
        message: `Memory growth too large: ${metrics.memoryDeltaMB.toFixed(2)} MB`,
        metric: 'memoryDelta',
        value: metrics.memoryDeltaMB,
        threshold: this.thresholds.maxMemoryDeltaMB,
        timestamp: Date.now()
      });
    }
    
    // Check typing speed
    if (metrics.charactersPerSecond < this.thresholds.minCharsPerSecond) {
      this.addAlert({
        level: 'warning',
        message: `Typing speed too slow: ${metrics.charactersPerSecond.toFixed(1)} chars/s`,
        metric: 'charsPerSecond',
        value: metrics.charactersPerSecond,
        threshold: this.thresholds.minCharsPerSecond,
        timestamp: Date.now()
      });
    }
  }
  
  /**
   * Add performance alert
   */
  private addAlert(alert: PerformanceAlert): void {
    this.alerts.push(alert);
    
    // Keep only the most recent 20 alerts
    if (this.alerts.length > 20) {
      this.alerts.shift();
    }
    
    // Output log based on level
    const logMessage = `[PerformanceAlert] ${alert.level.toUpperCase()}: ${alert.message}`;
    switch (alert.level) {
      case 'critical':
        console.error(logMessage);
        break;
      case 'warning':
        console.warn(logMessage);
        break;
      default:
        console.info(logMessage);
    }
  }
  
  /**
   * Get performance alerts
   */
  getAlerts(level?: 'info' | 'warning' | 'critical'): PerformanceAlert[] {
    if (level) {
      return this.alerts.filter(alert => alert.level === level);
    }
    return [...this.alerts];
  }
  
  /**
   * Clear alerts
   */
  clearAlerts(): void {
    this.alerts = [];
  }
  
  /**
   * Reset all metrics
   */
  resetMetrics(): void {
    this.renderTimes = [];
    this.frameTimes = [];
    this.lastFrameTime = 0;
    this.renderCount = 0;
    this.charCount = 0;
    this.charStartTime = performance.now();
    this.alerts = [];
    
    if ('memory' in performance) {
      const memInfo = (performance as any).memory;
      this.startMemory = memInfo.usedJSHeapSize / 1024 / 1024;
    }
  }
  
  /**
   * Generate performance report
   */
  generateReport(): string {
    const metrics = this.getMetrics();
    const criticalAlerts = this.getAlerts('critical');
    const warningAlerts = this.getAlerts('warning');
    
    let report = `
═══════════════════════════════════════
    Streaming Performance Report
═══════════════════════════════════════

📊 Rendering Performance
  • Average Render Time: ${metrics.averageRenderTime.toFixed(2)}ms
  • Peak Render Time: ${metrics.peakRenderTime.toFixed(2)}ms
  • Total Renders: ${metrics.totalRenders}

🎬 Frame Rate Metrics
  • Current FPS: ${metrics.currentFPS.toFixed(1)} FPS
  • Average FPS: ${metrics.averageFPS.toFixed(1)} FPS
  • Minimum FPS: ${metrics.minFPS.toFixed(1)} FPS

💾 Memory Usage
  • Current Memory: ${metrics.memoryUsageMB.toFixed(2)} MB
  • Memory Growth: ${metrics.memoryDeltaMB.toFixed(2)} MB

⌨️ Typewriter Performance
  • Character Speed: ${metrics.charactersPerSecond.toFixed(1)} chars/s
  • Average Delay: ${metrics.averageCharDelay.toFixed(2)}ms

`;

    if (criticalAlerts.length > 0) {
      report += `\n🚨 Critical Alerts (${criticalAlerts.length})\n`;
      criticalAlerts.slice(-5).forEach(alert => {
        report += `  • ${alert.message}\n`;
      });
    }
    
    if (warningAlerts.length > 0) {
      report += `\n⚠️ Warnings (${warningAlerts.length})\n`;
      warningAlerts.slice(-5).forEach(alert => {
        report += `  • ${alert.message}\n`;
      });
    }
    
    // Performance score
    const score = this.calculatePerformanceScore(metrics);
    report += `\n📈 Performance Score: ${score}/100\n`;
    report += this.getPerformanceRecommendations(metrics, score);
    
    report += `\n═══════════════════════════════════════\n`;
    
    return report;
  }
  
  /**
   * Calculate performance score (0-100)
   */
  private calculatePerformanceScore(metrics: PerformanceMetrics): number {
    let score = 100;
    
    // Frame rate score (40 points)
    const fpsScore = Math.min(40, (metrics.averageFPS / 60) * 40);
    score = fpsScore;
    
    // Render time score (30 points)
    const renderScore = metrics.averageRenderTime < 16.67
      ? 30
      : Math.max(0, 30 - (metrics.averageRenderTime - 16.67) * 2);
    score += renderScore;
    
    // Memory score (20 points)
    const memoryScore = metrics.memoryDeltaMB < 20
      ? 20
      : Math.max(0, 20 - (metrics.memoryDeltaMB - 20) * 0.5);
    score += memoryScore;
    
    // Typing speed score (10 points)
    const charsScore = metrics.charactersPerSecond > 50
      ? 10
      : (metrics.charactersPerSecond / 50) * 10;
    score += charsScore;
    
    return Math.round(Math.max(0, Math.min(100, score)));
  }
  
  /**
   * Get performance optimization recommendations
   */
  private getPerformanceRecommendations(metrics: PerformanceMetrics, score: number): string {
    let recommendations = '\n💡 Optimization Suggestions:\n';
    
    if (score >= 90) {
      recommendations += '  ✅ Excellent performance, no optimization needed\n';
      return recommendations;
    }
    
    if (metrics.averageFPS < 45) {
      recommendations += '  • Low frame rate, consider enabling incremental rendering\n';
    }
    
    if (metrics.averageRenderTime > 20) {
      recommendations += '  • Render time too long, consider reducing batch size\n';
    }
    
    if (metrics.memoryDeltaMB > 30) {
      recommendations += '  • High memory growth, consider clearing old render cache\n';
    }
    
    if (metrics.charactersPerSecond < 30) {
      recommendations += '  • Slow typing speed, consider increasing batch size\n';
    }
    
    return recommendations;
  }
}

// Export global instance
export const streamingPerformanceMonitor = new StreamingPerformanceMonitor();