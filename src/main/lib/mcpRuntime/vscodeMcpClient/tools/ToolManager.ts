/**
 * VSCode MCP Client - Tool Management System
 * Advanced tool lifecycle management, versioning, and security
 */

import { EventEmitter } from 'events';
import {
  McpTool,
  McpServerDefinition,
  ToolCallOptions,
  ToolCallResult,
} from '../types/mcpTypes';

// ==================== Tool Management Types ====================

export interface ToolManagerConfig {
  enableVersioning: boolean;
  enablePermissions: boolean;
  enableAuditLog: boolean;
  maxToolCacheSize: number;
  toolExecutionTimeout: number;
  enableSandbox: boolean;
  enableRateLimiting: boolean;
  maxConcurrentTools: number;
}

const DEFAULT_TOOL_CONFIG: ToolManagerConfig = {
  enableVersioning: true,
  enablePermissions: true,
  enableAuditLog: true,
  maxToolCacheSize: 1000,
  toolExecutionTimeout: 30000,
  enableSandbox: true,
  enableRateLimiting: true,
  maxConcurrentTools: 10,
};

// ==================== Tool Metadata ====================

export interface ToolMetadata {
  id: string;
  name: string;
  serverId: string;
  version: string;
  description?: string;
  inputSchema: any;
  outputSchema?: any;
  category?: string;
  tags: string[];
  permissions: ToolPermissions;
  registeredAt: number;
  lastUsed: number;
  usageCount: number;
  averageExecutionTime: number;
  successRate: number;
  deprecated: boolean;
  deprecationReason?: string;
}

export interface ToolPermissions {
  allowedUsers?: string[];
  allowedRoles?: string[];
  requiredPermissions: string[];
  restricted: boolean;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  requiresApproval: boolean;
  maxExecutionsPerHour?: number;
  maxExecutionsPerDay?: number;
}

// ==================== Tool Execution Context ====================

export interface ToolExecutionContext {
  userId?: string;
  sessionId?: string;
  requestId: string;
  timestamp: number;
  serverId: string;
  toolName: string;
  arguments: Record<string, any>;
  options?: ToolCallOptions;
  environment: 'development' | 'staging' | 'production';
  traceId?: string;
}

export interface ToolExecutionResult {
  executionId: string;
  context: ToolExecutionContext;
  result: ToolCallResult;
  executionTime: number;
  success: boolean;
  error?: Error;
  warnings: string[];
  metrics: ToolExecutionMetrics;
}

export interface ToolExecutionMetrics {
  cpuTime?: number;
  memoryUsage?: number;
  networkCalls?: number;
  diskIO?: number;
  cacheHits?: number;
  cacheMisses?: number;
}

// ==================== Tool Registry ====================

export interface ToolRegistry {
  tools: Map<string, ToolMetadata>;
  categories: Map<string, string[]>;
  versions: Map<string, ToolMetadata[]>;
  permissions: Map<string, ToolPermissions>;
}

// ==================== Audit and Logging ====================

export interface ToolAuditEntry {
  id: string;
  timestamp: number;
  userId?: string;
  action: 'register' | 'unregister' | 'execute' | 'permission_change' | 'version_update';
  toolId: string;
  toolName: string;
  serverId: string;
  details: Record<string, any>;
  result: 'success' | 'failure' | 'blocked';
  error?: string;
  riskLevel: string;
}

// ==================== Events ====================

export interface ToolManagerEvents {
  toolRegistered: { tool: ToolMetadata };
  toolUnregistered: { toolId: string; tool: ToolMetadata };
  toolExecuted: { result: ToolExecutionResult };
  toolExecutionBlocked: { context: ToolExecutionContext; reason: string };
  permissionDenied: { context: ToolExecutionContext; permissions: ToolPermissions };
  auditLog: { entry: ToolAuditEntry };
  rateLimitExceeded: { toolId: string; userId?: string };
}

// ==================== Tool Manager Implementation ====================

export class ToolManager extends EventEmitter {
  private config: ToolManagerConfig;
  private registry: ToolRegistry;
  private auditLog: ToolAuditEntry[] = [];
  private executionHistory = new Map<string, ToolExecutionResult[]>();
  private activeExecutions = new Map<string, ToolExecutionContext>();
  private rateLimitTracking = new Map<string, { count: number; resetTime: number }>();

  // Statistics
  private stats = {
    totalTools: 0,
    totalExecutions: 0,
    successfulExecutions: 0,
    blockedExecutions: 0,
    averageExecutionTime: 0,
    totalExecutionTime: 0,
  };

  public static readonly EVENTS = {
    TOOL_REGISTERED: 'toolRegistered',
    TOOL_UNREGISTERED: 'toolUnregistered',
    TOOL_EXECUTED: 'toolExecuted',
    TOOL_EXECUTION_BLOCKED: 'toolExecutionBlocked',
    PERMISSION_DENIED: 'permissionDenied',
    AUDIT_LOG: 'auditLog',
    RATE_LIMIT_EXCEEDED: 'rateLimitExceeded',
  } as const;

  constructor(config: Partial<ToolManagerConfig> = {}) {
    super();
    
    this.config = { ...DEFAULT_TOOL_CONFIG, ...config };
    this.registry = {
      tools: new Map(),
      categories: new Map(),
      versions: new Map(),
      permissions: new Map(),
    };
  }

  // ==================== Tool Registration ====================

  /**
   * Register a tool from an MCP server
   */
  registerTool(
    tool: McpTool,
    serverId: string,
    options: {
      category?: string;
      permissions?: Partial<ToolPermissions>;
      version?: string;
      tags?: string[];
    } = {}
  ): string {
    const toolId = this.generateToolId(tool.name, serverId);
    
    // Check if tool already exists
    if (this.registry.tools.has(toolId)) {
      throw new Error(`Tool ${tool.name} from server ${serverId} already registered`);
    }

    // Create tool metadata
    const metadata: ToolMetadata = {
      id: toolId,
      name: tool.name,
      serverId,
      version: options.version || '1.0.0',
      description: tool.description,
      inputSchema: tool.inputSchema,
      category: options.category || 'general',
      tags: options.tags || [],
      permissions: {
        requiredPermissions: [],
        restricted: false,
        riskLevel: 'low',
        requiresApproval: false,
        ...options.permissions,
      },
      registeredAt: Date.now(),
      lastUsed: 0,
      usageCount: 0,
      averageExecutionTime: 0,
      successRate: 1.0,
      deprecated: false,
    };

    // Register tool
    this.registry.tools.set(toolId, metadata);
    this.stats.totalTools++;

    // Update category index
    const category = metadata.category || 'general';
    if (!this.registry.categories.has(category)) {
      this.registry.categories.set(category, []);
    }
    this.registry.categories.get(category)!.push(toolId);

    // Update version index
    if (this.config.enableVersioning) {
      const versionKey = `${tool.name}@${serverId}`;
      if (!this.registry.versions.has(versionKey)) {
        this.registry.versions.set(versionKey, []);
      }
      this.registry.versions.get(versionKey)!.push(metadata);
    }

    // Store permissions
    this.registry.permissions.set(toolId, metadata.permissions);

    // Audit log
    if (this.config.enableAuditLog) {
      this.addAuditEntry({
        action: 'register',
        toolId,
        toolName: tool.name,
        serverId,
        details: { category, version: metadata.version, permissions: metadata.permissions },
        result: 'success',
        riskLevel: metadata.permissions.riskLevel,
      });
    }

    this.emit(ToolManager.EVENTS.TOOL_REGISTERED, { tool: metadata });
    return toolId;
  }

  /**
   * Unregister a tool
   */
  unregisterTool(toolId: string): boolean {
    const tool = this.registry.tools.get(toolId);
    if (!tool) {
      return false;
    }

    // Remove from registry
    this.registry.tools.delete(toolId);
    this.registry.permissions.delete(toolId);
    this.stats.totalTools--;

    // Remove from category index
    const category = tool.category;
    if (category && this.registry.categories.has(category)) {
      const tools = this.registry.categories.get(category)!;
      const index = tools.indexOf(toolId);
      if (index > -1) {
        tools.splice(index, 1);
      }
    }

    // Remove from version index
    if (this.config.enableVersioning) {
      const versionKey = `${tool.name}@${tool.serverId}`;
      if (this.registry.versions.has(versionKey)) {
        const versions = this.registry.versions.get(versionKey)!;
        const index = versions.findIndex(v => v.id === toolId);
        if (index > -1) {
          versions.splice(index, 1);
        }
      }
    }

    // Audit log
    if (this.config.enableAuditLog) {
      this.addAuditEntry({
        action: 'unregister',
        toolId,
        toolName: tool.name,
        serverId: tool.serverId,
        details: {},
        result: 'success',
        riskLevel: tool.permissions.riskLevel,
      });
    }

    this.emit(ToolManager.EVENTS.TOOL_UNREGISTERED, { toolId, tool });
    return true;
  }

  // ==================== Tool Execution ====================

  /**
   * Execute a tool with full lifecycle management
   */
  async executeTool(
    toolId: string,
    args: Record<string, any>,
    context: Partial<ToolExecutionContext> = {}
  ): Promise<ToolExecutionResult> {
    const tool = this.registry.tools.get(toolId);
    if (!tool) {
      throw new Error(`Tool ${toolId} not found`);
    }

    // Create execution context
    const executionContext: ToolExecutionContext = {
      requestId: this.generateRequestId(),
      timestamp: Date.now(),
      serverId: tool.serverId,
      toolName: tool.name,
      arguments: args,
      environment: 'development',
      ...context,
    };

    const executionId = this.generateExecutionId();

    try {
      // Pre-execution checks
      await this.preExecutionChecks(tool, executionContext);

      // Track active execution
      this.activeExecutions.set(executionId, executionContext);

      // Execute with timeout
      const startTime = Date.now();
      const result = await this.executeWithTimeout(tool, executionContext);
      const executionTime = Date.now() - startTime;

      // Create execution result
      const executionResult: ToolExecutionResult = {
        executionId,
        context: executionContext,
        result,
        executionTime,
        success: !result.isError,
        warnings: [],
        metrics: {
          // Placeholder metrics - would be populated by actual execution
          cpuTime: 0,
          memoryUsage: 0,
          networkCalls: 0,
        },
      };

      // Post-execution processing
      await this.postExecutionProcessing(tool, executionResult);

      return executionResult;

    } catch (error) {
      // Handle execution error
      const executionResult: ToolExecutionResult = {
        executionId,
        context: executionContext,
        result: {
          content: null,
          isError: true,
          meta: { error: error instanceof Error ? error.message : String(error) },
        },
        executionTime: Date.now() - executionContext.timestamp,
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
        warnings: [],
        metrics: {},
      };

      await this.postExecutionProcessing(tool, executionResult);
      throw error;

    } finally {
      // Clean up active execution
      this.activeExecutions.delete(executionId);
    }
  }

  // ==================== Tool Discovery and Querying ====================

  /**
   * Get tool by ID
   */
  getTool(toolId: string): ToolMetadata | null {
    return this.registry.tools.get(toolId) || null;
  }

  /**
   * List all tools
   */
  listTools(filters: {
    serverId?: string;
    category?: string;
    tags?: string[];
    permissions?: string[];
    deprecated?: boolean;
  } = {}): ToolMetadata[] {
    const tools = Array.from(this.registry.tools.values());
    
    return tools.filter(tool => {
      if (filters.serverId && tool.serverId !== filters.serverId) return false;
      if (filters.category && tool.category !== filters.category) return false;
      if (filters.deprecated !== undefined && tool.deprecated !== filters.deprecated) return false;
      
      if (filters.tags && filters.tags.length > 0) {
        const hasAllTags = filters.tags.every(tag => tool.tags.includes(tag));
        if (!hasAllTags) return false;
      }
      
      if (filters.permissions && filters.permissions.length > 0) {
        const hasAllPermissions = filters.permissions.every(perm => 
          tool.permissions.requiredPermissions.includes(perm)
        );
        if (!hasAllPermissions) return false;
      }
      
      return true;
    });
  }

  /**
   * Search tools by name or description
   */
  searchTools(query: string): ToolMetadata[] {
    const lowerQuery = query.toLowerCase();
    return Array.from(this.registry.tools.values()).filter(tool => 
      tool.name.toLowerCase().includes(lowerQuery) ||
      (tool.description && tool.description.toLowerCase().includes(lowerQuery)) ||
      tool.tags.some(tag => tag.toLowerCase().includes(lowerQuery))
    );
  }

  /**
   * Get tools by category
   */
  getToolsByCategory(category: string): ToolMetadata[] {
    const toolIds = this.registry.categories.get(category) || [];
    return toolIds.map(id => this.registry.tools.get(id)!).filter(Boolean);
  }

  // ==================== Permission Management ====================

  /**
   * Update tool permissions
   */
  updateToolPermissions(toolId: string, permissions: Partial<ToolPermissions>): boolean {
    const tool = this.registry.tools.get(toolId);
    if (!tool) {
      return false;
    }

    const oldPermissions = { ...tool.permissions };
    tool.permissions = { ...tool.permissions, ...permissions };
    this.registry.permissions.set(toolId, tool.permissions);

    // Audit log
    if (this.config.enableAuditLog) {
      this.addAuditEntry({
        action: 'permission_change',
        toolId,
        toolName: tool.name,
        serverId: tool.serverId,
        details: { oldPermissions, newPermissions: tool.permissions },
        result: 'success',
        riskLevel: tool.permissions.riskLevel,
      });
    }

    return true;
  }

  /**
   * Check if execution is permitted
   */
  private async checkPermissions(
    tool: ToolMetadata,
    context: ToolExecutionContext
  ): Promise<boolean> {
    if (!this.config.enablePermissions) {
      return true;
    }

    const permissions = tool.permissions;

    // Check if tool is restricted
    if (permissions.restricted) {
      return false;
    }

    // Check user permissions (if applicable)
    if (context.userId && permissions.allowedUsers) {
      if (!permissions.allowedUsers.includes(context.userId)) {
        return false;
      }
    }

    // Check rate limits
    if (this.config.enableRateLimiting && context.userId) {
      const rateLimitKey = `${tool.id}:${context.userId}`;
      if (!this.checkRateLimit(rateLimitKey, permissions)) {
        return false;
      }
    }

    return true;
  }

  // ==================== Private Methods ====================

  private async preExecutionChecks(
    tool: ToolMetadata,
    context: ToolExecutionContext
  ): Promise<void> {
    // Check permissions
    const hasPermission = await this.checkPermissions(tool, context);
    if (!hasPermission) {
      this.emit(ToolManager.EVENTS.PERMISSION_DENIED, { context, permissions: tool.permissions });
      throw new Error(`Permission denied for tool ${tool.name}`);
    }

    // Check concurrent execution limit
    if (this.activeExecutions.size >= this.config.maxConcurrentTools) {
      this.emit(ToolManager.EVENTS.TOOL_EXECUTION_BLOCKED, { 
        context, 
        reason: 'Maximum concurrent tools limit reached' 
      });
      throw new Error('Maximum concurrent tool executions reached');
    }

    // Check if tool is deprecated
    if (tool.deprecated) {
      // Log warning but allow execution
    }
  }

  private async executeWithTimeout(
    tool: ToolMetadata,
    context: ToolExecutionContext
  ): Promise<ToolCallResult> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Tool execution timed out after ${this.config.toolExecutionTimeout}ms`));
      }, this.config.toolExecutionTimeout);

      // Mock execution - in real implementation, this would call the actual tool
      const mockResult: ToolCallResult = {
        content: `Mock result for ${tool.name}`,
        isError: false,
        meta: { executionTime: Date.now() - context.timestamp },
      };

      clearTimeout(timeout);
      resolve(mockResult);
    });
  }

  private async postExecutionProcessing(
    tool: ToolMetadata,
    result: ToolExecutionResult
  ): Promise<void> {
    // Update tool statistics
    tool.lastUsed = Date.now();
    tool.usageCount++;
    
    const totalTime = tool.averageExecutionTime * (tool.usageCount - 1) + result.executionTime;
    tool.averageExecutionTime = totalTime / tool.usageCount;
    
    if (result.success) {
      this.stats.successfulExecutions++;
    }

    // Update global statistics
    this.stats.totalExecutions++;
    this.stats.totalExecutionTime += result.executionTime;
    this.stats.averageExecutionTime = this.stats.totalExecutionTime / this.stats.totalExecutions;

    // Store execution history
    if (!this.executionHistory.has(tool.id)) {
      this.executionHistory.set(tool.id, []);
    }
    this.executionHistory.get(tool.id)!.push(result);

    // Audit log
    if (this.config.enableAuditLog) {
      this.addAuditEntry({
        action: 'execute',
        toolId: tool.id,
        toolName: tool.name,
        serverId: tool.serverId,
        details: { 
          arguments: result.context.arguments,
          executionTime: result.executionTime,
          success: result.success,
        },
        result: result.success ? 'success' : 'failure',
        error: result.error?.message,
        riskLevel: tool.permissions.riskLevel,
      });
    }

    this.emit(ToolManager.EVENTS.TOOL_EXECUTED, { result });
  }

  private checkRateLimit(key: string, permissions: ToolPermissions): boolean {
    const now = Date.now();
    const hourlyLimit = permissions.maxExecutionsPerHour;
    const dailyLimit = permissions.maxExecutionsPerDay;

    if (!hourlyLimit && !dailyLimit) {
      return true;
    }

    const tracking = this.rateLimitTracking.get(key) || { count: 0, resetTime: now + 3600000 };

    // Reset if time window passed
    if (now > tracking.resetTime) {
      tracking.count = 0;
      tracking.resetTime = now + 3600000; // 1 hour
    }

    // Check limits
    if (hourlyLimit && tracking.count >= hourlyLimit) {
      this.emit(ToolManager.EVENTS.RATE_LIMIT_EXCEEDED, { toolId: key.split(':')[0] });
      return false;
    }

    // Increment counter
    tracking.count++;
    this.rateLimitTracking.set(key, tracking);

    return true;
  }

  private addAuditEntry(entry: Omit<ToolAuditEntry, 'id' | 'timestamp'>): void {
    const auditEntry: ToolAuditEntry = {
      id: this.generateAuditId(),
      timestamp: Date.now(),
      ...entry,
    };

    this.auditLog.push(auditEntry);
    this.emit(ToolManager.EVENTS.AUDIT_LOG, { entry: auditEntry });

    // Keep audit log size manageable
    if (this.auditLog.length > 10000) {
      this.auditLog = this.auditLog.slice(-5000);
    }
  }

  private generateToolId(toolName: string, serverId: string): string {
    return `${serverId}:${toolName}`;
  }

  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateExecutionId(): string {
    return `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateAuditId(): string {
    return `audit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // ==================== Statistics and Info ====================

  getStats(): typeof this.stats & {
    registry: {
      totalTools: number;
      categories: number;
      averageSuccessRate: number;
    };
    execution: {
      activeExecutions: number;
      totalExecutionHistory: number;
    };
    audit: {
      totalEntries: number;
    };
  } {
    const tools = Array.from(this.registry.tools.values());
    const averageSuccessRate = tools.length > 0 
      ? tools.reduce((sum, tool) => sum + tool.successRate, 0) / tools.length 
      : 0;

    return {
      ...this.stats,
      registry: {
        totalTools: this.registry.tools.size,
        categories: this.registry.categories.size,
        averageSuccessRate,
      },
      execution: {
        activeExecutions: this.activeExecutions.size,
        totalExecutionHistory: Array.from(this.executionHistory.values())
          .reduce((sum, history) => sum + history.length, 0),
      },
      audit: {
        totalEntries: this.auditLog.length,
      },
    };
  }

  getAuditLog(filter?: {
    toolId?: string;
    action?: string;
    timeRange?: { start: number; end: number };
  }): ToolAuditEntry[] {
    let filtered = this.auditLog;

    if (filter) {
      filtered = filtered.filter(entry => {
        if (filter.toolId && entry.toolId !== filter.toolId) return false;
        if (filter.action && entry.action !== filter.action) return false;
        if (filter.timeRange) {
          if (entry.timestamp < filter.timeRange.start || entry.timestamp > filter.timeRange.end) {
            return false;
          }
        }
        return true;
      });
    }

    return filtered;
  }

  // ==================== Disposal ====================

  dispose(): void {
    this.registry.tools.clear();
    this.registry.categories.clear();
    this.registry.versions.clear();
    this.registry.permissions.clear();
    this.executionHistory.clear();
    this.activeExecutions.clear();
    this.rateLimitTracking.clear();
    this.auditLog.length = 0;
    this.removeAllListeners();
  }
}