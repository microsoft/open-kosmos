/**
 * Unified Terminal Instance Manager
 * Responsible for creating, managing, and coordinating all terminal instances
 * Supports cross-platform operations for Windows and macOS
 */

import {
  ITerminalManager,
  ITerminalInstance,
  TerminalConfig,
  TerminalResult,
  TerminalInstanceInfo,
  TerminalInstanceType
} from './types';
import { TerminalInstance } from './TerminalInstance';
import { PlatformConfigManager } from './PlatformConfigManager';
import { getUnifiedLogger, UnifiedLogger } from '../unifiedLogger';

/**
 * Terminal instance pool configuration
 */
interface PoolConfig {
  maxInstances: number;
  idleTimeoutMs: number;
  cleanupIntervalMs: number;
}

/**
 * Default pool configuration
 */
const DEFAULT_POOL_CONFIG: PoolConfig = {
  maxInstances: 50,
  idleTimeoutMs: 300_000, // 5 minutes
  cleanupIntervalMs: 60_000 // 1 minute
};

/**
 * Unified terminal manager implementation
 */
export class TerminalManager implements ITerminalManager {
  private static instance: TerminalManager;
  
  private instances = new Map<string, ITerminalInstance>();
  private platformConfig: PlatformConfigManager;
  private poolConfig: PoolConfig;
  private cleanupTimer?: NodeJS.Timeout;
  private disposed = false;
  private logger: UnifiedLogger = getUnifiedLogger();
  private managerId: string;
  
  private constructor(poolConfig: Partial<PoolConfig> = {}) {
    this.managerId = this.generateManagerId();
    this.platformConfig = PlatformConfigManager.getInstance();
    this.poolConfig = { ...DEFAULT_POOL_CONFIG, ...poolConfig };
    
    this.logger.info(
      `TerminalManager initialized`,
      'TerminalManager',
      {
        managerId: this.managerId,
        poolConfig: this.poolConfig,
        platform: process.platform
      }
    );
    
    this.startCleanupTimer();
  }

  /**
   * Generate a manager ID for log tracing
   */
  private generateManagerId(): string {
    return `mgr_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  }
  
  /**
   * Get the singleton instance
   */
  public static getInstance(poolConfig?: Partial<PoolConfig>): TerminalManager {
    if (!TerminalManager.instance) {
      TerminalManager.instance = new TerminalManager(poolConfig);
    }
    return TerminalManager.instance;
  }
  
  /**
   * Create a new terminal instance
   */
  public async createInstance(config: TerminalConfig): Promise<ITerminalInstance> {
    const startTime = Date.now();
    
    this.logger.info(
      `Creating new terminal instance`,
      'TerminalManager',
      {
        managerId: this.managerId,
        instanceType: config.type,
        command: config.command,
        cwd: config.cwd,
        persistent: config.persistent,
        currentInstanceCount: this.instances.size,
        maxInstances: this.poolConfig.maxInstances
      }
    );

    if (this.disposed) {
      this.logger.error(
        `Cannot create instance: TerminalManager has been disposed`,
        'TerminalManager',
        { managerId: this.managerId }
      );
      throw new Error('TerminalManager has been disposed');
    }
    
    // Check instance count limit
    if (this.instances.size >= this.poolConfig.maxInstances) {
      this.logger.warn(
        `Maximum instance limit reached, attempting cleanup`,
        'TerminalManager',
        {
          managerId: this.managerId,
          currentCount: this.instances.size,
          maxInstances: this.poolConfig.maxInstances
        }
      );
      
      await this.cleanupIdleInstances(true);
      
      if (this.instances.size >= this.poolConfig.maxInstances) {
        this.logger.error(
          `Cannot create instance: maximum limit reached after cleanup`,
          'TerminalManager',
          {
            managerId: this.managerId,
            currentCount: this.instances.size,
            maxInstances: this.poolConfig.maxInstances
          }
        );
        throw new Error(`Maximum number of terminal instances reached (${this.poolConfig.maxInstances})`);
      }
    }
    
    // Validate configuration
    this.logger.debug(`Validating terminal configuration`, 'TerminalManager', { managerId: this.managerId });
    this.validateConfig(config);
    
    // Create instance
    this.logger.debug(`Creating TerminalInstance`, 'TerminalManager', { managerId: this.managerId });
    const instance = new TerminalInstance(config);
    
    // Register event listeners
    this.setupInstanceEventHandlers(instance);
    
    // Add to pool
    this.instances.set(instance.id, instance);
    this.logger.debug(
      `Terminal instance added to pool`,
      'TerminalManager',
      {
        managerId: this.managerId,
        instanceId: instance.id,
        totalInstances: this.instances.size
      }
    );
    
    // Start instance (if needed)
    if (config.type === 'mcp_transport' || config.persistent) {
      this.logger.debug(
        `Starting terminal instance (persistent or MCP transport)`,
        'TerminalManager',
        { managerId: this.managerId, instanceId: instance.id, type: config.type }
      );
      await instance.start();
    }
    
    const creationTime = Date.now() - startTime;
    this.logger.info(
      `Terminal instance created successfully`,
      'TerminalManager',
      {
        managerId: this.managerId,
        instanceId: instance.id,
        instanceType: config.type,
        creationTimeMs: creationTime,
        totalInstances: this.instances.size
      }
    );
    
    return instance;
  }
  
  /**
   * Get an existing instance
   */
  public getInstance(id: string): ITerminalInstance | null {
    return this.instances.get(id) || null;
  }
  
  /**
   * Execute a one-time command
   */
  public async executeCommand(config: TerminalConfig): Promise<TerminalResult> {
    const executionId = this.generateExecutionId();
    const startTime = Date.now();
    
    this.logger.info(
      `Executing one-time command`,
      'TerminalManager',
      {
        managerId: this.managerId,
        executionId,
        command: config.command,
        cwd: config.cwd,
        timeoutMs: config.timeoutMs
      }
    );

    // Create temporary config for one-time execution
    const commandConfig: TerminalConfig = {
      ...config,
      type: 'command',
      persistent: false,
      instanceId: `cmd_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`
    };
    
    this.logger.debug(
      `Creating temporary instance for command execution`,
      'TerminalManager',
      { managerId: this.managerId, executionId, tempInstanceId: commandConfig.instanceId }
    );
    
    const instance = await this.createInstance(commandConfig);
    
    try {
      // Start and execute command
      this.logger.debug(
        `Starting and executing command`,
        'TerminalManager',
        { managerId: this.managerId, executionId, instanceId: instance.id }
      );
      
      await instance.start();
      const result = await instance.execute();
      
      const executionTime = Date.now() - startTime;
      this.logger.info(
        `Command execution completed`,
        'TerminalManager',
        {
          managerId: this.managerId,
          executionId,
          instanceId: instance.id,
          exitCode: result.exitCode,
          executionTimeMs: executionTime,
          stdoutLength: result.stdout.length,
          stderrLength: result.stderr.length,
          timedOut: result.timedOut
        }
      );
      
      return result;
    } catch (error) {
      const executionTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      this.logger.error(
        `Command execution failed`,
        'TerminalManager',
        {
          managerId: this.managerId,
          executionId,
          instanceId: instance.id,
          error: errorMessage,
          executionTimeMs: executionTime
        }
      );
      throw error;
    } finally {
      // Clean up temporary instance
      this.logger.debug(
        `Cleaning up temporary instance`,
        'TerminalManager',
        { managerId: this.managerId, executionId, instanceId: instance.id }
      );
      await this.stopInstance(instance.id, true);
    }
  }
  
  /**
   * Create a persistent MCP transport instance
   */
  public async createMcpTransport(config: TerminalConfig): Promise<ITerminalInstance> {
    this.logger.info(
      `Creating MCP transport instance`,
      'TerminalManager',
      {
        managerId: this.managerId,
        command: config.command,
        cwd: config.cwd,
        persistent: true
      }
    );

    const mcpConfig: TerminalConfig = {
      ...config,
      type: 'mcp_transport',
      persistent: true
    };
    
    const instance = await this.createInstance(mcpConfig);
    
    this.logger.info(
      `MCP transport instance created`,
      'TerminalManager',
      { managerId: this.managerId, instanceId: instance.id }
    );
    
    return instance;
  }

  /**
   * Generate an execution ID for log tracing
   */
  private generateExecutionId(): string {
    return `exec_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  }
  
  /**
   * Get all instance information
   */
  public getAllInstances(): TerminalInstanceInfo[] {
    return Array.from(this.instances.values()).map(instance => instance.getInfo());
  }
  
  /**
   * Stop a specific instance
   */
  public async stopInstance(id: string, force: boolean = false): Promise<void> {
    this.logger.debug(
      `Stopping terminal instance`,
      'TerminalManager',
      { managerId: this.managerId, instanceId: id, force }
    );

    const instance = this.instances.get(id);
    if (!instance) {
      this.logger.debug(
        `Instance not found, skipping stop operation`,
        'TerminalManager',
        { managerId: this.managerId, instanceId: id }
      );
      return; // Instance does not exist, no action needed
    }
    
    const startTime = Date.now();
    try {
      await instance.stop(force);
      const stopTime = Date.now() - startTime;
      this.logger.info(
        `Terminal instance stopped successfully`,
        'TerminalManager',
        { managerId: this.managerId, instanceId: id, force, stopTimeMs: stopTime }
      );
    } catch (error) {
      const stopTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to stop terminal instance`,
        'TerminalManager',
        { managerId: this.managerId, instanceId: id, error: errorMessage, stopTimeMs: stopTime }
      );
      throw error;
    } finally {
      // Remove from pool
      this.instances.delete(id);
      instance.dispose();
      this.logger.debug(
        `Terminal instance removed from pool`,
        'TerminalManager',
        { managerId: this.managerId, instanceId: id, remainingInstances: this.instances.size }
      );
    }
  }

  /**
   * Stop all instances
   */
  public async stopAllInstances(force: boolean = false): Promise<void> {
    const instanceCount = this.instances.size;
    
    this.logger.info(
      `Stopping all terminal instances`,
      'TerminalManager',
      { managerId: this.managerId, instanceCount, force }
    );

    if (instanceCount === 0) {
      this.logger.debug(
        `No instances to stop`,
        'TerminalManager',
        { managerId: this.managerId }
      );
      return;
    }

    const startTime = Date.now();
    const stopPromises = Array.from(this.instances.keys()).map(id =>
      this.stopInstance(id, force)
    );
    
    const results = await Promise.allSettled(stopPromises);
    const stopTime = Date.now() - startTime;
    
    const successful = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;
    
    this.logger.info(
      `All terminal instances stop operation completed`,
      'TerminalManager',
      {
        managerId: this.managerId,
        totalInstances: instanceCount,
        successful,
        failed,
        stopTimeMs: stopTime,
        force
      }
    );
  }

  /**
   * Clean up resources
   */
  public async dispose(): Promise<void> {
    this.logger.info(
      `Disposing TerminalManager`,
      'TerminalManager',
      { managerId: this.managerId, currentInstances: this.instances.size, disposed: this.disposed }
    );

    if (this.disposed) {
      this.logger.debug(
        `TerminalManager already disposed`,
        'TerminalManager',
        { managerId: this.managerId }
      );
      return;
    }
    
    const startTime = Date.now();
    this.disposed = true;
    
    // Stop cleanup timer
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
      this.logger.debug(
        `Cleanup timer stopped`,
        'TerminalManager',
        { managerId: this.managerId }
      );
    }
    
    // Stop all instances
    await this.stopAllInstances(true);
    
    // Clear singleton reference
    TerminalManager.instance = null as any;
    
    const disposeTime = Date.now() - startTime;
    this.logger.info(
      `TerminalManager disposed successfully`,
      'TerminalManager',
      { managerId: this.managerId, disposeTimeMs: disposeTime }
    );
  }
  
  /**
   * Get manager statistics
   */
  public getStats(): {
    totalInstances: number;
    runningInstances: number;
    idleInstances: number;
    errorInstances: number;
    instancesByType: Record<TerminalInstanceType, number>;
  } {
    const instances = this.getAllInstances();
    
    const stats = {
      totalInstances: instances.length,
      runningInstances: 0,
      idleInstances: 0,
      errorInstances: 0,
      instancesByType: {
        command: 0,
        mcp_transport: 0
      } as Record<TerminalInstanceType, number>
    };
    
    for (const instance of instances) {
      // Categorize by state
      switch (instance.state) {
        case 'running':
          stats.runningInstances++;
          break;
        case 'idle':
          stats.idleInstances++;
          break;
        case 'error':
          stats.errorInstances++;
          break;
      }
      
      // Categorize by type
      stats.instancesByType[instance.type]++;
    }
    
    return stats;
  }
  
  private validateConfig(config: TerminalConfig): void {
    if (!config.command || !config.command.trim()) {
      throw new Error('Command is required and cannot be empty');
    }
    
    if (!config.cwd || !config.cwd.trim()) {
      throw new Error('Working directory (cwd) is required and cannot be empty');
    }
    
    if (!Array.isArray(config.args)) {
      throw new Error('Args must be an array');
    }
    
    if (config.timeoutMs !== undefined && (!Number.isFinite(config.timeoutMs) || config.timeoutMs <= 0)) {
      throw new Error('TimeoutMs must be a positive finite number');
    }
    
    if (config.maxOutputLength !== undefined && (!Number.isFinite(config.maxOutputLength) || config.maxOutputLength <= 0)) {
      throw new Error('MaxOutputLength must be a positive finite number');
    }
  }
  
  private setupInstanceEventHandlers(instance: ITerminalInstance): void {
    this.logger.debug(
      `Setting up event handlers for terminal instance`,
      'TerminalManager',
      { managerId: this.managerId, instanceId: instance.id }
    );

    instance.on('error', (error: Error) => {
      this.logger.error(
        `Terminal instance error occurred`,
        'TerminalManager',
        {
          managerId: this.managerId,
          instanceId: instance.id,
          error: error.message,
          stack: error.stack
        }
      );
    });
    
    instance.on('exit', (code: number | null, signal: string | null) => {
      // If non-persistent instance or unexpected exit, remove from pool
      const info = instance.getInfo();
      const isUnexpectedExit = !info.config.persistent || (code !== 0 && code !== null);
      
      this.logger.info(
        `Terminal instance process exited`,
        'TerminalManager',
        {
          managerId: this.managerId,
          instanceId: instance.id,
          exitCode: code,
          signal,
          persistent: info.config.persistent,
          willAutoCleanup: isUnexpectedExit
        }
      );
      
      if (isUnexpectedExit) {
        this.logger.debug(
          `Scheduling auto-cleanup for non-persistent or failed instance`,
          'TerminalManager',
          { managerId: this.managerId, instanceId: instance.id }
        );
        
        setTimeout(() => {
          if (this.instances.has(instance.id)) {
            this.logger.debug(
              `Auto-cleaning up terminal instance`,
              'TerminalManager',
              { managerId: this.managerId, instanceId: instance.id }
            );
            this.instances.delete(instance.id);
            instance.dispose();
          }
        }, 1000); // Delay 1 second to ensure all callbacks complete
      }
    });
    
    instance.on('stateChange', (state) => {
      this.logger.debug(
        `Terminal instance state changed`,
        'TerminalManager',
        { managerId: this.managerId, instanceId: instance.id, newState: state }
      );
    });
    
    this.logger.debug(
      `Event handlers setup completed for terminal instance`,
      'TerminalManager',
      { managerId: this.managerId, instanceId: instance.id }
    );
  }
  
  private startCleanupTimer(): void {
    this.logger.debug(
      `Starting cleanup timer`,
      'TerminalManager',
      { managerId: this.managerId, intervalMs: this.poolConfig.cleanupIntervalMs }
    );

    this.cleanupTimer = setInterval(() => {
      this.cleanupIdleInstances(false).catch(error => {
        this.logger.error(
          `Cleanup timer error`,
          'TerminalManager',
          { managerId: this.managerId, error: error instanceof Error ? error.message : String(error) }
        );
      });
    }, this.poolConfig.cleanupIntervalMs);
    
    // Ensure the timer does not prevent the program from exiting
    this.cleanupTimer.unref();
    
    this.logger.debug(
      `Cleanup timer started successfully`,
      'TerminalManager',
      { managerId: this.managerId }
    );
  }
  
  private async cleanupIdleInstances(force: boolean): Promise<void> {
    const startTime = Date.now();
    this.logger.debug(
      `Starting idle instances cleanup`,
      'TerminalManager',
      { managerId: this.managerId, force, currentInstances: this.instances.size }
    );

    const now = Date.now();
    const instancesToCleanup: string[] = [];
    
    for (const [id, instance] of Array.from(this.instances.entries())) {
      const info = instance.getInfo();
      
      // Skip persistent instances (unless forced cleanup)
      if (info.config.persistent && !force) {
        continue;
      }
      
      // Check if idle timeout has been exceeded
      const idleTime = now - info.lastActivity;
      const shouldCleanup = force ||
        (info.state === 'idle' && idleTime > this.poolConfig.idleTimeoutMs) ||
        (info.state === 'error') ||
        (info.state === 'stopped');
      
      if (shouldCleanup) {
        instancesToCleanup.push(id);
        this.logger.debug(
          `Instance marked for cleanup`,
          'TerminalManager',
          {
            managerId: this.managerId,
            instanceId: id,
            state: info.state,
            idleTime,
            persistent: info.config.persistent,
            reason: force ? 'force' : info.state
          }
        );
      }
    }
    
    if (instancesToCleanup.length === 0) {
      this.logger.debug(
        `No instances need cleanup`,
        'TerminalManager',
        { managerId: this.managerId, totalInstances: this.instances.size }
      );
      return;
    }
    
    this.logger.info(
      `Cleaning up idle instances`,
      'TerminalManager',
      { managerId: this.managerId, instancesToCleanup: instancesToCleanup.length, force }
    );
    
    // Parallel cleanup
    const cleanupPromises = instancesToCleanup.map(id =>
      this.stopInstance(id, true).catch(error => {
        this.logger.error(
          `Failed to cleanup instance`,
          'TerminalManager',
          { managerId: this.managerId, instanceId: id, error: error instanceof Error ? error.message : String(error) }
        );
      })
    );
    
    await Promise.allSettled(cleanupPromises);
    
    const cleanupTime = Date.now() - startTime;
    this.logger.info(
      `Idle instances cleanup completed`,
      'TerminalManager',
      {
        managerId: this.managerId,
        cleanedInstances: instancesToCleanup.length,
        remainingInstances: this.instances.size,
        cleanupTimeMs: cleanupTime
      }
    );
  }
}

/**
 * Get the global terminal manager instance
 */
export function getTerminalManager(config?: Partial<PoolConfig>): TerminalManager {
  return TerminalManager.getInstance(config);
}