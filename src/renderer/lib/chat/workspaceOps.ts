/**
 * Workspace Operations
 *
 * Frontend Workspace operations coordination layer, interacts with main process via IPC
 * Provides unified Workspace management interface
 *
 * ✨ Simplified file monitoring strategy:
 * - Backend monitors file changes and merges events
 * - Frontend triggers complete refresh after receiving notifications
 * - Removed complex incremental update logic
 */

/**
 * File change type (corresponds to WorkspaceWatcher's FileChangeType)
 */
export enum FileChangeType {
  UPDATED = 0,
  ADDED = 1,
  DELETED = 2
}

/**
 * File change event
 */
export interface FileChange {
  type: FileChangeType;
  path: string;
}

/**
 * File tree node interface
 */
export interface FileTreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  children?: FileTreeNode[];
  isExpanded?: boolean;
}

/**
 * Workspace operation result interface
 */
export interface WorkspaceOperationResult {
  success: boolean;
  error?: string;
  data?: any;
}

/**
 * File tree data interface
 */
export interface FileTreeData {
  workspacePath: string;
  workspaceName: string;
  tree: FileTreeNode[];
}

/**
 * Workspace operations manager
 *
 * Simplified file monitoring architecture:
 * - Backend monitors file changes
 * - Frontend triggers complete refresh after receiving notifications
 * - Removed incremental update logic, keeping it simple and reliable
 */
export class WorkspaceOpsManager {
  private static instance: WorkspaceOpsManager;
  
  /**
   * File change listener list (for notifying refresh needed)
   */
  private refreshListeners: Array<() => void> = [];
  
  /**
   * Error listener list
   */
  private errorListeners: Array<(error: any) => void> = [];
  
  /**
   * Whether currently watching
   */
  private isWatching: boolean = false;
  
  /**
   * Currently watched workspace path
   */
  private currentWatchPath: string | null = null;

  private constructor() {
    this.setupEventListeners();
  }

  static getInstance(): WorkspaceOpsManager {
    if (!WorkspaceOpsManager.instance) {
      WorkspaceOpsManager.instance = new WorkspaceOpsManager();
    }
    return WorkspaceOpsManager.instance;
  }

  /**
   * Validate IPC API availability
   */
  private validateAPI(): boolean {
    return !!(
      (window as any).electronAPI?.workspace?.selectFolder &&
      (window as any).electronAPI?.workspace?.getFileTree
    );
  }

  /**
   * Select Workspace folder
   * Opens system folder selection dialog
   */
  async selectWorkspaceFolder(): Promise<WorkspaceOperationResult> {
    try {
      if (!this.validateAPI()) {
        return {
          success: false,
          error: 'Workspace API not available'
        };
      }

      const result = await (window as any).electronAPI.workspace.selectFolder();
      
      if (!result.success) {
        return {
          success: false,
          error: result.error || 'Failed to select folder'
        };
      }

      return {
        success: true,
        data: result.folderPath
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Get Workspace file tree
   * @param workspacePath Workspace path
   * @param options Optional configuration (max depth, ignore patterns, etc.)
   */
  async getWorkspaceFileTree(
    workspacePath: string,
    options?: {
      maxDepth?: number;
      ignorePatterns?: string[];
    }
  ): Promise<WorkspaceOperationResult> {
    try {
      if (!this.validateAPI()) {
        return {
          success: false,
          error: 'Workspace API not available'
        };
      }

      if (!workspacePath || workspacePath.trim() === '') {
        return {
          success: false,
          error: 'Invalid workspace path'
        };
      }

      const result = await (window as any).electronAPI.workspace.getFileTree(
        workspacePath,
        options
      );
      
      if (!result.success) {
        return {
          success: false,
          error: result.error || 'Failed to get file tree'
        };
      }

      const treeData = result.data as FileTreeData;
      
      return {
        success: true,
        data: treeData
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Get directory direct children (lazy loading)
   * Only returns single level, no recursion, for file tree lazy loading
   * @param dirPath Directory absolute path
   * @param options Optional configuration
   */
  async getDirectoryChildren(
    dirPath: string,
    options?: { ignorePatterns?: string[] }
  ): Promise<WorkspaceOperationResult> {
    try {
      if (!this.validateAPI()) {
        return { success: false, error: 'Workspace API not available' };
      }
      if (!dirPath || dirPath.trim() === '') {
        return { success: false, error: 'Invalid directory path' };
      }
      const result = await (window as any).electronAPI.workspace.getDirectoryChildren(
        dirPath,
        options
      );
      if (!result.success) {
        return { success: false, error: result.error || 'Failed to get directory children' };
      }
      return { success: true, data: result.data };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Clear file tree cache (for refresh functionality)
   * @param workspacePath Optional Workspace path, if provided only clears cache for that path
   */
  async clearFileTreeCache(workspacePath?: string): Promise<WorkspaceOperationResult> {
    try {
      if (!this.validateAPI()) {
        return {
          success: false,
          error: 'Workspace API not available'
        };
      }


      const result = await (window as any).electronAPI.workspace.clearFileTreeCache(workspacePath);
      
      if (!result.success) {
        return {
          success: false,
          error: result.error || 'Failed to clear file tree cache'
        };
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Update Chat's Workspace configuration
   * Updates specified Chat's agent.workspace field via ChatOps
   * @param chatId Chat ID
   * @param workspacePath Workspace path
   */
  async updateChatWorkspace(
    chatId: string,
    workspacePath: string
  ): Promise<WorkspaceOperationResult> {
    try {
      // Dynamically import ChatOps to avoid circular dependencies
      const { updateChatAgent } = await import('./chatOps');
      
      // 🔄 workspace has been moved to agent level
      const result = await updateChatAgent(chatId, {
        workspace: workspacePath
      });

      if (!result.success) {
        return {
          success: false,
          error: result.error || 'Failed to update chat workspace'
        };
      }

      return {
        success: true,
        data: { chatId, workspacePath }
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Update Chat's KnowledgeBase configuration
   * Updates specified Chat's agent.knowledgeBase field via ChatOps
   * @param chatId Chat ID
   * @param knowledgeBasePath KnowledgeBase path
   */
  async updateChatKnowledgeBase(
    chatId: string,
    knowledgeBasePath: string
  ): Promise<WorkspaceOperationResult> {
    try {
      // Dynamically import ChatOps to avoid circular dependencies
      const { updateChatAgent } = await import('./chatOps');
      
      const result = await updateChatAgent(chatId, {
        knowledgeBase: knowledgeBasePath
      });

      if (!result.success) {
        return {
          success: false,
          error: result.error || 'Failed to update chat knowledge base'
        };
      }

      return {
        success: true,
        data: { chatId, knowledgeBasePath }
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Get Workspace name (extracted from path)
   * @param workspacePath Workspace path
   */
  getWorkspaceName(workspacePath: string): string {
    if (!workspacePath || workspacePath.trim() === '') {
      return 'No Workspace';
    }

    // Normalize path, remove trailing slashes, then extract last path part as name
    const normalizedPath = workspacePath.replace(/\\/g, '/').replace(/\/+$/, '');
    const parts = normalizedPath.split('/');
    const lastPart = parts[parts.length - 1];
    
    return lastPart || 'Workspace';
  }

  /**
   * Validate if Workspace path is valid
   * @param workspacePath Workspace path
   */
  isValidWorkspacePath(workspacePath: string): boolean {
    return !!(workspacePath && workspacePath.trim() !== '');
  }
  
  // ========== VSCode-style advanced file watching feature ==========
  
  /**
   * Setup simplified event listeners (only handle refresh notifications)
   */
  private setupEventListeners(): void {
    // Listen to backend file change events, directly trigger refresh
    const removeFileChangedListener = (window as any).electronAPI?.workspace?.onFileChanged?.(
      (changes: FileChange[]) => {
        
        // Simple strategy: notify all listeners that refresh is needed
        this.notifyRefreshListeners();
      }
    );
    
    // Listen to error events
    const removeErrorListener = (window as any).electronAPI?.workspace?.onWatchError?.(
      (error: any) => {
        this.notifyErrorListeners(error);
      }
    );
    
    // Save cleanup functions
    if (removeFileChangedListener) {
      (this as any)._removeFileChangedListener = removeFileChangedListener;
    }
    if (removeErrorListener) {
      (this as any)._removeErrorListener = removeErrorListener;
    }
  }

  /**
   * Notify all refresh listeners
   */
  private notifyRefreshListeners(): void {
    for (const listener of this.refreshListeners) {
      try {
        listener();
      } catch (error) {
      }
    }
  }

  /**
   * Manually trigger a refresh for all registered listeners.
   * Call this after an explicit file operation (delete, move) to ensure all
   * FileExplorerSection instances reload their trees immediately.
   */
  triggerRefresh(): void {
    this.notifyRefreshListeners();
  }

  /**
   * Add refresh listener
   * @param listener Listener callback function
   * @returns Function to remove listener
   */
  onRefresh(listener: () => void): () => void {
    this.refreshListeners.push(listener);
    
    return () => {
      const index = this.refreshListeners.indexOf(listener);
      if (index > -1) {
        this.refreshListeners.splice(index, 1);
      }
    };
  }
  
  /**
   * Start watching Workspace file changes
   * @param workspacePath Workspace path
   * @param options Watch options (exclude, include rules)
   */
  async startWatch(
    workspacePath: string,
    options?: {
      excludes?: string[];
      includes?: string[];
    }
  ): Promise<WorkspaceOperationResult> {
    try {
      if (!this.validateAPI()) {
        return {
          success: false,
          error: 'Workspace API not available'
        };
      }
      
      if (!workspacePath || workspacePath.trim() === '') {
        return {
          success: false,
          error: 'Invalid workspace path'
        };
      }
      
      // If already watching the same path, skip
      if (this.isWatching && this.currentWatchPath === workspacePath) {
        return { success: true };
      }
      
      // If watching other path, stop first
      if (this.isWatching && this.currentWatchPath !== workspacePath) {
        await this.stopWatch();
      }
      
      
      const result = await (window as any).electronAPI.workspace.startWatch(
        workspacePath,
        options
      );
      
      if (!result.success) {
        return {
          success: false,
          error: result.error || 'Failed to start file watcher'
        };
      }
      
      this.isWatching = true;
      this.currentWatchPath = workspacePath;
      
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
  
  /**
   * Stop watching Workspace file changes
   */
  async stopWatch(): Promise<WorkspaceOperationResult> {
    try {
      if (!this.validateAPI()) {
        return {
          success: false,
          error: 'Workspace API not available'
        };
      }
      
      if (!this.isWatching) {
        return { success: true };
      }
      
      
      const result = await (window as any).electronAPI.workspace.stopWatch();
      
      if (!result.success) {
        return {
          success: false,
          error: result.error || 'Failed to stop file watcher'
        };
      }
      
      this.isWatching = false;
      this.currentWatchPath = null;
      
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
  
  /**
   * Get file watching statistics
   */
  async getWatcherStats(): Promise<WorkspaceOperationResult> {
    try {
      if (!this.validateAPI()) {
        return {
          success: false,
          error: 'Workspace API not available'
        };
      }
      
      const result = await (window as any).electronAPI.workspace.getWatcherStats();
      
      if (!result.success) {
        return {
          success: false,
          error: result.error || 'Failed to get watcher stats'
        };
      }
      
      return {
        success: true,
        data: result.data
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
  
  /**
   * Add file change listener (kept for compatibility, actually triggers refresh)
   * @param listener Listener callback function
   * @returns Function to remove listener
   */
  onFileChange(listener: (changes: FileChange[]) => void): () => void {
    // Convert to refresh listener
    const refreshListener = () => {
      // Call original listener, pass empty change array since we no longer care about specific changes
      listener([]);
    };
    
    return this.onRefresh(refreshListener);
  }
  
  /**
   * Add error listener
   * @param listener Listener callback function
   * @returns Function to remove listener
   */
  onError(listener: (error: any) => void): () => void {
    this.errorListeners.push(listener);
    
    return () => {
      const index = this.errorListeners.indexOf(listener);
      if (index > -1) {
        this.errorListeners.splice(index, 1);
      }
    };
  }
  
  
  /**
   * Notify all error listeners
   */
  private notifyErrorListeners(error: any): void {
    for (const listener of this.errorListeners) {
      try {
        listener(error);
      } catch (err) {
      }
    }
  }
  
  /**
   * Get current watch status
   */
  getWatchStatus(): {
    isWatching: boolean;
    currentPath: string | null;
  } {
    return {
      isWatching: this.isWatching,
      currentPath: this.currentWatchPath
    };
  }
  
  /**
   * Copy file or directory to target Workspace
   * @param sourcePath Source file or directory path
   * @param destPath Target Workspace path
   */
  async copyPathToWorkspace(
    sourcePath: string,
    destPath: string
  ): Promise<WorkspaceOperationResult> {
    try {
      if (!this.validateAPI()) {
        return {
          success: false,
          error: 'Workspace API not available'
        };
      }
      
      if (!sourcePath || !destPath) {
        return {
          success: false,
          error: 'Invalid source or destination path'
        };
      }
      
      
      const result = await (window as any).electronAPI.workspace.copyPath(
        sourcePath,
        destPath
      );
      
      if (!result.success) {
        return {
          success: false,
          error: result.error || 'Failed to copy path'
        };
      }
      
      return {
        success: true,
        data: result.data
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Open specified path in system file explorer
   * @param path File or directory path to open
   */
  async openInSystemExplorer(path: string): Promise<WorkspaceOperationResult> {
    try {
      if (!this.validateAPI()) {
        return {
          success: false,
          error: 'Workspace API not available'
        };
      }
      
      if (!path || path.trim() === '') {
        return {
          success: false,
          error: 'Invalid path'
        };
      }
      
      
      // Use showInFolder method to display path in system file explorer
      const result = await (window as any).electronAPI.workspace.showInFolder(path);
      
      if (!result.success) {
        return {
          success: false,
          error: result.error || 'Failed to open in system explorer'
        };
      }
      
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
}

// Export singleton instance
export const workspaceOps = WorkspaceOpsManager.getInstance();

// ========== Convenience functions ==========

/**
 * Select Workspace folder
 */
export async function selectWorkspaceFolder(): Promise<WorkspaceOperationResult> {
  return await workspaceOps.selectWorkspaceFolder();
}

/**
 * Get Workspace file tree
 */
export async function getWorkspaceFileTree(
  workspacePath: string,
  options?: {
    maxDepth?: number;
    ignorePatterns?: string[];
  }
): Promise<WorkspaceOperationResult> {
  return await workspaceOps.getWorkspaceFileTree(workspacePath, options);
}

/**
 * Get directory direct children (lazy loading)
 */
export async function getDirectoryChildren(
  dirPath: string,
  options?: { ignorePatterns?: string[] }
): Promise<WorkspaceOperationResult> {
  return await workspaceOps.getDirectoryChildren(dirPath, options);
}

/**
 * Clear file tree cache
 */
export async function clearFileTreeCache(workspacePath?: string): Promise<WorkspaceOperationResult> {
  return await workspaceOps.clearFileTreeCache(workspacePath);
}

/**
 * Update Chat's Workspace configuration
 */
export async function updateChatWorkspace(
  chatId: string,
  workspacePath: string
): Promise<WorkspaceOperationResult> {
  return await workspaceOps.updateChatWorkspace(chatId, workspacePath);
}

/**
 * Update Chat's KnowledgeBase configuration
 */
export async function updateChatKnowledgeBase(
  chatId: string,
  knowledgeBasePath: string
): Promise<WorkspaceOperationResult> {
  return await workspaceOps.updateChatKnowledgeBase(chatId, knowledgeBasePath);
}

/**
 * Get Workspace name
 */
export function getWorkspaceName(workspacePath: string): string {
  return workspaceOps.getWorkspaceName(workspacePath);
}

/**
 * Validate Workspace path
 */
export function isValidWorkspacePath(workspacePath: string): boolean {
  return workspaceOps.isValidWorkspacePath(workspacePath);
}

/**
 * Start watching Workspace file changes
 */
export async function startWatch(
  workspacePath: string,
  options?: {
    excludes?: string[];
    includes?: string[];
  }
): Promise<WorkspaceOperationResult> {
  return await workspaceOps.startWatch(workspacePath, options);
}

/**
 * Stop watching Workspace file changes
 */
export async function stopWatch(): Promise<WorkspaceOperationResult> {
  return await workspaceOps.stopWatch();
}

/**
 * Get file watching statistics
 */
export async function getWatcherStats(): Promise<WorkspaceOperationResult> {
  return await workspaceOps.getWatcherStats();
}

/**
 * Add file change listener
 */
export function onFileChange(listener: (changes: FileChange[]) => void): () => void {
  return workspaceOps.onFileChange(listener);
}

/**
 * Add error listener
 */
export function onError(listener: (error: any) => void): () => void {
  return workspaceOps.onError(listener);
}

/**
 * Manually trigger a refresh for all registered listeners.
 * Use after explicit file operations (delete, move) to force all
 * FileExplorerSection instances to reload their trees.
 */
export function triggerRefresh(): void {
  workspaceOps.triggerRefresh();
}

/**
 * Get current watch status
 */
export function getWatchStatus(): {
  isWatching: boolean;
  currentPath: string | null;
} {
  return workspaceOps.getWatchStatus();
}

/**
 * Copy file or directory to target Workspace
 */
export async function copyPathToWorkspace(
  sourcePath: string,
  destPath: string
): Promise<WorkspaceOperationResult> {
  return await workspaceOps.copyPathToWorkspace(sourcePath, destPath);
}

/**
 * Open specified path in system file explorer
 */
export async function openInSystemExplorer(path: string): Promise<WorkspaceOperationResult> {
  return await workspaceOps.openInSystemExplorer(path);
}