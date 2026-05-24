/**
 * Unified Logger System - Save Log Manager (Singleton)
 *
 * Class save-log - Responsible for saving cached log objects to disk
 */

import { UnifiedLoggerConfig, FileOperationResult } from './types';
import { PendingSaveQueue } from './PendingSaveQueue';
import { CacheObject } from './CacheObject';
import * as FileOps from './FileOperations';

export class SaveLogManager {
  private static instance: SaveLogManager;
  private pendingSaveQueue: PendingSaveQueue;
  private isSaving: boolean = false;
  private config: UnifiedLoggerConfig;
  private logDirectory: string;
  private saveStats: {
    totalSaveOperations: number;
    totalFilesWritten: number;
    totalBytesWritten: number;
    totalCacheObjectsSaved: number;
    lastSaveTime?: Date;
    totalSaveTime: number;
    averageSaveTime: number;
  };

  private constructor(config: UnifiedLoggerConfig, pendingSaveQueue: PendingSaveQueue) {
    this.config = config;
    this.pendingSaveQueue = pendingSaveQueue;
    this.logDirectory = config.LOGGER_DIRECTORY || FileOps.getDefaultLogDirectory();
    this.saveStats = {
      totalSaveOperations: 0,
      totalFilesWritten: 0,
      totalBytesWritten: 0,
      totalCacheObjectsSaved: 0,
      totalSaveTime: 0,
      averageSaveTime: 0
    };

    // Perform initial cleanup asynchronously (only once at app startup)
    this.performInitialCleanup();
  }

  /**
   * Get the singleton instance
   * @param config - Configuration object (only used on first creation)
   * @param pendingSaveQueue - Pending save queue (only used on first creation)
   * @returns SaveLogManager instance
   */
  public static getInstance(config?: UnifiedLoggerConfig, pendingSaveQueue?: PendingSaveQueue): SaveLogManager {
    if (!SaveLogManager.instance) {
      if (!config || !pendingSaveQueue) {
        throw new Error('Configuration and pending save queue are required for first-time initialization');
      }
      SaveLogManager.instance = new SaveLogManager(config, pendingSaveQueue);
    }
    return SaveLogManager.instance;
  }

  /**
   * Receive a notification from "cache log" and trigger the save log method
   */
  public notifyPendingSaveAvailable(): void {
    try {
      // Start asynchronous save immediately without waiting for the result
      this.saveLogsToDisk().catch(error => {
      });
    } catch (error) {
    }
  }

  /**
   * Core save logic
   */
  private async saveLogsToDisk(): Promise<void> {
    if (this.isSaving) return; // Prevent duplicate execution

    this.isSaving = true;
    const startTime = Date.now();

    try {
      // While (pending save queue is not empty)
      while (!this.pendingSaveQueue.isEmpty()) {
        // Dequeue cache objects from the pending save queue and write them to disk log files
        const cacheObject = this.pendingSaveQueue.dequeue();
        if (cacheObject) {
          await this.writeCacheObjectToDisk(cacheObject);
        }
      }

      // Update statistics
      this.updateSaveStats(startTime);
    } catch (error) {
    } finally {
      this.isSaving = false;
    }
  }

  /**
   * Manually trigger the save log method (used for "logs to disk" and app shutdown)
   */
  public async manualSave(): Promise<void> {
    // Cleanup is only performed on manual save
    await this.cleanupOldLogFiles();
    await this.saveLogsToDisk();
  }

  /**
   * Perform cleanup on initialization (only executed once at app startup)
   */
  private async performInitialCleanup(): Promise<void> {
    try {
      // Delay execution slightly to avoid blocking initialization
      setTimeout(async () => {
        await this.cleanupOldLogFiles();
      }, 1000);
    } catch (error) {
    }
  }

  /**
   * Clean up old log files
   */
  private async cleanupOldLogFiles(): Promise<void> {
    try {
      const needsCleanup = await FileOps.needsCleanup(this.logDirectory);
      if (needsCleanup) {
        const cleanupResult = await FileOps.cleanupOldLogFiles(this.logDirectory);
        if (cleanupResult.success && cleanupResult.deletedFiles.length > 0) {
        }
      }
    } catch (error) {
    }
  }

  /**
   * Write a cache object to disk
   * @param cacheObject - The cache object to write
   */
  private async writeCacheObjectToDisk(cacheObject: CacheObject): Promise<void> {
    try {
      const result = await FileOps.writeCacheObjectToDisk(cacheObject, this.logDirectory);

      if (result.success) {
        this.saveStats.totalFilesWritten++;
        this.saveStats.totalBytesWritten += result.bytesWritten || 0;
        this.saveStats.totalCacheObjectsSaved++;
      } else {
      }
    } catch (error) {
    }
  }

  /**
   * Update save statistics
   * @param startTime - Start time
   */
  private updateSaveStats(startTime: number): void {
    const saveTime = Date.now() - startTime;
    this.saveStats.totalSaveOperations++;
    this.saveStats.lastSaveTime = new Date();
    this.saveStats.totalSaveTime += saveTime;
    this.saveStats.averageSaveTime = this.saveStats.totalSaveTime / this.saveStats.totalSaveOperations;
  }

  /**
   * Get save statistics
   * @returns Save statistics
   */
  public getSaveStats(): typeof SaveLogManager.prototype.saveStats {
    return { ...this.saveStats };
  }

  /**
   * Get the current save status
   * @returns Current status information
   */
  public getStatus(): {
    isSaving: boolean;
    pendingSaveQueueSize: number;
    logDirectory: string;
    stats: typeof SaveLogManager.prototype.saveStats;
  } {
    return {
      isSaving: this.isSaving,
      pendingSaveQueueSize: this.pendingSaveQueue.size(),
      logDirectory: this.logDirectory,
      stats: this.getSaveStats()
    };
  }

  /**
   * Update configuration
   * @param newConfig - New configuration object
   */
  public updateConfig(newConfig: Partial<UnifiedLoggerConfig>): void {
    this.config = { ...this.config, ...newConfig };

    // If the log directory changes, update the directory
    if (newConfig.LOGGER_DIRECTORY) {
      this.logDirectory = newConfig.LOGGER_DIRECTORY;
    }
  }

  /**
   * Get the current configuration
   * @returns Current configuration object
   */
  public getConfig(): UnifiedLoggerConfig {
    return { ...this.config };
  }

  /**
   * Get log directory statistics
   * @returns Directory statistics
   */
  public async getLogDirectoryStats(): Promise<ReturnType<typeof FileOps.getLogDirectoryStats>> {
    return await FileOps.getLogDirectoryStats(this.logDirectory);
  }

  /**
   * Validate the log directory
   * @returns Validation result
   */
  public async validateLogDirectory(): Promise<ReturnType<typeof FileOps.validateLogDirectory>> {
    return await FileOps.validateLogDirectory(this.logDirectory);
  }

  /**
   * Manually clean up old files
   * @returns Cleanup result
   */
  public async manualCleanup(): Promise<ReturnType<typeof FileOps.cleanupOldLogFiles>> {
    return await FileOps.cleanupOldLogFiles(this.logDirectory);
  }

  /**
   * Get information about all log files
   * @returns Array of log file information
   */
  public async getAllLogFiles(): Promise<ReturnType<typeof FileOps.getAllLogFiles>> {
    return await FileOps.getAllLogFiles(this.logDirectory);
  }

  /**
   * Force save a single cache object (for emergency use)
   * @param cacheObject - The cache object to save
   * @returns Save result
   */
  public async forceSaveCacheObject(cacheObject: CacheObject): Promise<FileOperationResult> {
    return await FileOps.writeCacheObjectToDisk(cacheObject, this.logDirectory);
  }

  /**
   * Get detailed information about the pending save queue
   * @returns Queue detailed information
   */
  public getPendingSaveQueueInfo(): ReturnType<PendingSaveQueue['getDetailedInfo']> {
    return this.pendingSaveQueue.getDetailedInfo();
  }

  /**
   * Validate the integrity of SaveLogManager
   * @returns Validation result
   */
  public validateIntegrity(): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!this.pendingSaveQueue) {
      errors.push('Pending save queue is not initialized');
    } else {
      const queueValidation = this.pendingSaveQueue.validateIntegrity();
      if (!queueValidation.isValid) {
        errors.push(`Pending save queue validation failed: ${queueValidation.errors.join(', ')}`);
      }
    }

    if (!this.config) {
      errors.push('Configuration is not set');
    }

    if (!this.logDirectory || typeof this.logDirectory !== 'string') {
      errors.push('Invalid log directory');
    }

    if (!this.saveStats) {
      errors.push('Save statistics not initialized');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Get detailed debug information
   * @returns Detailed debug information
   */
  public async getDetailedInfo(): Promise<{
    status: ReturnType<SaveLogManager['getStatus']>;
    pendingSaveQueue: ReturnType<PendingSaveQueue['getDetailedInfo']>;
    directoryStats: Awaited<ReturnType<typeof FileOps.getLogDirectoryStats>>;
    directoryValidation: Awaited<ReturnType<typeof FileOps.validateLogDirectory>>;
    validation: ReturnType<SaveLogManager['validateIntegrity']>;
  }> {
    const [directoryStats, directoryValidation] = await Promise.all([
      this.getLogDirectoryStats(),
      this.validateLogDirectory()
    ]);

    return {
      status: this.getStatus(),
      pendingSaveQueue: this.getPendingSaveQueueInfo(),
      directoryStats,
      directoryValidation,
      validation: this.validateIntegrity()
    };
  }

  /**
   * Wait for the current save operation to complete
   * @param timeoutMs - Timeout in milliseconds
   * @returns Whether it completed before the timeout
   */
  public async waitForSaveComplete(timeoutMs: number = 10000): Promise<boolean> {
    const startTime = Date.now();

    while (this.isSaving && (Date.now() - startTime) < timeoutMs) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    return !this.isSaving;
  }

  /**
   * Reset statistics
   */
  public resetStats(): void {
    this.saveStats = {
      totalSaveOperations: 0,
      totalFilesWritten: 0,
      totalBytesWritten: 0,
      totalCacheObjectsSaved: 0,
      totalSaveTime: 0,
      averageSaveTime: 0
    };
  }

  /**
   * Reset the singleton instance (primarily for testing)
   */
  public static resetInstance(): void {
    SaveLogManager.instance = undefined as any;
  }

  /**
   * Check whether the manager has been initialized
   * @returns Whether it is initialized
   */
  public static isInitialized(): boolean {
    return SaveLogManager.instance !== undefined;
  }
}
