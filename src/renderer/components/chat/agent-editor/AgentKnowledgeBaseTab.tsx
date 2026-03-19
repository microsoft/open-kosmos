import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  Folder,
  FolderOpen,
  FileText,
  FileCode,
  FileJson,
  FileType,
  Palette,
  Globe,
  Image as ImageIcon,
  FolderPlus,
  ChevronLeft,
  ChevronRight,
  Plus,
  ChevronDown,
  File,
  Trash2,
  Clipboard,
} from 'lucide-react';

import '../../../styles/Agent.css';
import '../../../styles/SkillsContentView.css';  // Reuse skill-folder-explorer styles
import { TabComponentProps } from './types';
import {
  selectWorkspaceFolder,
  getWorkspaceFileTree,
  getDirectoryChildren,
  clearFileTreeCache,
  isValidWorkspacePath,
  startWatch,
  stopWatch,
  copyPathToWorkspace,
  FileTreeNode,
  FileTreeData,
  workspaceOps,
} from '../../../lib/chat/workspaceOps';
import { usePasteToWorkspace } from '../workspace/PasteToWorkspaceProvider';

// Shared ignore directory patterns for all features
const IGNORE_PATTERNS = [
  'node_modules', '.git', 'dist', 'build', '.next', 'out', 'coverage', '.vscode', '.idea'
];

// Image file extensions set
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'bmp', 'webp', 'ico', 'tiff', 'tif']);
const isImageFile = (filename: string): boolean => {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  return IMAGE_EXTENSIONS.has(ext);
};

/**
 * AgentKnowledgeBaseTab - Agent Knowledge Base configuration tab
 *
 * Features:
 * - Display and manage Agent Knowledge Base directory
 * - File/folder browsing and navigation
 * - Consistent styling with SkillFolderExplorer
 * - Image files use OverlayImageViewer on click, other files use OverlayFileViewer
 * - Folder watch sync consistent with WorkspaceExplorerSidepane
 * - Show different empty state prompts based on branding
 */

// File icon component - consistent with SkillFolderExplorer
const FileIcon: React.FC<{ extension: string | null; fileName?: string }> = ({ extension }) => {
  const ext = extension?.toLowerCase();
  switch (ext) {
    case 'ts':
    case 'tsx':
    case 'js':
    case 'jsx':
      return <FileCode size={16} />;
    case 'json':
      return <FileJson size={16} />;
    case 'md':
      return <FileType size={16} />;
    case 'css':
    case 'scss':
      return <Palette size={16} />;
    case 'html':
      return <Globe size={16} />;
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'svg':
      return <ImageIcon size={16} />;
    default:
      return <FileText size={16} />;
  }
};

// Loading animation component - consistent with SkillFolderExplorer
const LoadingSpinner = () => (
  <div className="skill-folder-loading">
    <svg
      width="32"
      height="32"
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ animation: 'spin 1s linear infinite' }}
    >
      <circle cx="16" cy="16" r="14" stroke="#e0e0e0" strokeWidth="2"/>
      <path d="M30 16C30 23.732 23.732 30 16 30" stroke="#272320" strokeWidth="2" strokeLinecap="round"/>
    </svg>
    <span>Loading directory...</span>
  </div>
);

// Format file size - consistent with SkillFolderExplorer
function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

const AgentKnowledgeBaseTab: React.FC<TabComponentProps> = ({
  mode,
  agentId,
  agentData,
  onSave,
  onDataChange,
  cachedData,
  readOnly = false,
  isFromLibrary = false,
}) => {
  const isWorkspacePathDisabled = readOnly
  
  // Knowledge Base directory path
  const [workspacePath, setWorkspacePath] = useState<string>('');
  
  // File tree data
  const [fileTree, setFileTree] = useState<FileTreeNode[]>([]);
  
  // Loading state
  const [isLoading, setIsLoading] = useState(false);
  
  // Current browsing directory path stack
  const [directoryStack, setDirectoryStack] = useState<FileTreeNode[]>([]);
  
  // History path stack (for navigation back)
  const [pathHistory, setPathHistory] = useState<string[]>([]);
  
  // Initialization flag
  const [isInitialized, setIsInitialized] = useState(false);
  
  // Initial data for comparison to detect changes
  const [initialWorkspace, setInitialWorkspace] = useState<string>('');
  
  // Saved workspace path (to determine if file management is available)
  const [savedWorkspacePath, setSavedWorkspacePath] = useState<string>('');
  
  // Drag state
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  
  // Add dropdown menu state
  const [showAddMenu, setShowAddMenu] = useState(false);
  const addMenuRef = useRef<HTMLDivElement>(null);
  
  // Selection and deletion related state
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  
  // Paste to Knowledge Base - use global context
  const { openPasteDialog } = usePasteToWorkspace();
  
  // File watching related refs - consistent with WorkspaceExplorerSidepane
  const watchStartedRef = useRef(false);
  const fileChangeListenerRef = useRef<(() => void) | null>(null);
  // Subdirectory lazy loading cache: key = directory absolute path, value = child nodes list
  const childrenCache = useRef<Map<string, FileTreeNode[]>>(new Map());

  // Load existing data
  useEffect(() => {
    if (agentData?.id) {
      const baseWorkspace = agentData?.knowledgeBase || '';
      
      // If cached data exists, prioritize using cached data
      const finalWorkspace = cachedData?.knowledgeBase !== undefined 
        ? cachedData.knowledgeBase 
        : baseWorkspace;
      
      setWorkspacePath(finalWorkspace || '');
      
      if (!isInitialized) {
        setInitialWorkspace(baseWorkspace);
        setSavedWorkspacePath(baseWorkspace); // Initialize saved path
        setIsInitialized(true);
      }
    }
  }, [agentData?.id, agentData?.knowledgeBase, cachedData?.knowledgeBase, isInitialized]);

  // Check if data has been modified
  const hasChanges = useMemo(() => {
    return workspacePath !== initialWorkspace;
  }, [workspacePath, initialWorkspace]);

  // Check if workspace path has unsaved changes (to control file management features)
  // If current path differs from saved path, disable Add/Delete features
  const hasUnsavedWorkspacePath = useMemo(() => {
    return workspacePath !== savedWorkspacePath;
  }, [workspacePath, savedWorkspacePath]);

  // Listen to agentData.knowledgeBase changes, update savedWorkspacePath (triggered after successful save)
  useEffect(() => {
    if (isInitialized && agentData?.knowledgeBase !== undefined) {
      setSavedWorkspacePath(agentData.knowledgeBase || '');
    }
  }, [agentData?.knowledgeBase, isInitialized]);

  // Notify parent component when data changes
  const lastNotifiedDataRef = useRef<string | null>(null);
  
  useEffect(() => {
    if (isInitialized && onDataChange) {
      const dataKey = workspacePath;
      
      if (lastNotifiedDataRef.current !== dataKey) {
        lastNotifiedDataRef.current = dataKey;
        onDataChange('knowledge', { knowledgeBase: workspacePath }, hasChanges);
      }
    }
  }, [workspacePath, hasChanges, isInitialized, onDataChange]);

// Load file tree (only load direct children of root directory, subdirectories are lazy-loaded)
  const loadFileTree = useCallback(async (path: string) => {
    if (!path || path.trim() === '') {
      setFileTree([]);
      return;
    }

    setIsLoading(true);
    try {
      const result = await getWorkspaceFileTree(path, {
        maxDepth: 1,  // Only load direct children of root level
        ignorePatterns: IGNORE_PATTERNS
      });

      if (!result.success) {
        throw new Error(result.error || 'Failed to load file tree');
      }

      const treeData = result.data as FileTreeData;
      setFileTree(treeData.tree || []);
    } catch (error) {
      console.error('[AgentKnowledgeBaseTab] Failed to load file tree:', error);
      setFileTree([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Load file tree when workspacePath changes
  useEffect(() => {
    if (isValidWorkspacePath(workspacePath)) {
      loadFileTree(workspacePath);
      // Reset directory stack
      setDirectoryStack([]);
      setPathHistory([]);
    } else {
      setFileTree([]);
      setDirectoryStack([]);
      setPathHistory([]);
    }
  }, [workspacePath, loadFileTree]);

  // ========== File watching feature - consistent with WorkspaceExplorerSidepane ==========
  
  /**
   * Handle file change events: clear lazy loading cache and reload root directory
   */
  const handleFileChanges = useCallback(async () => {
    if (isValidWorkspacePath(workspacePath)) {
      // Clear all path caches (no parameters), including subdirectory lazy loading cache
      childrenCache.current.clear();
      try {
        await clearFileTreeCache();
      } catch (error) {
        console.error('[AgentKnowledgeBaseTab] Failed to clear cache:', error);
      }
      // Reset navigation to root directory
      setDirectoryStack([]);
      setPathHistory([]);
      // Reload root level
      await loadFileTree(workspacePath);
    }
  }, [workspacePath, loadFileTree]);

  /**
   * Start file watching
   */
  const startFileWatcher = useCallback(async (path: string) => {
    if (!path || !isValidWorkspacePath(path)) {
      return;
    }
    
    // Avoid duplicate starts
    if (watchStartedRef.current) {
      return;
    }
    
    try {
      // Remove old listener
      if (fileChangeListenerRef.current) {
        fileChangeListenerRef.current();
        fileChangeListenerRef.current = null;
      }
      
      // Add simplified refresh listener
      const removeListener = workspaceOps.onRefresh(handleFileChanges);
      fileChangeListenerRef.current = removeListener;
      
      // Start backend file watching
      const result = await startWatch(path, {
        excludes: [
          'node_modules',
          '.git',
          'dist',
          'build',
          '.next',
          'out',
          'coverage',
          '.vscode',
          '.idea',
          '.DS_Store',
          'Thumbs.db'
        ]
      });
      
      if (result.success) {
        watchStartedRef.current = true;
      }
    } catch (error) {
      console.error('[AgentKnowledgeBaseTab] Failed to start file watcher:', error);
    }
  }, [handleFileChanges]);
  
  /**
   * Stop file watching
   */
  const stopFileWatcher = useCallback(async () => {
    if (!watchStartedRef.current) {
      return;
    }
    
    try {
      // Remove listener
      if (fileChangeListenerRef.current) {
        fileChangeListenerRef.current();
        fileChangeListenerRef.current = null;
      }
      
      // Stop file watching
      await stopWatch();
      watchStartedRef.current = false;
    } catch (error) {
      console.error('[AgentKnowledgeBaseTab] Failed to stop file watcher:', error);
    }
  }, []);
  
  /**
   * Restart file watching when workspace changes
   */
  useEffect(() => {
    if (isValidWorkspacePath(workspacePath)) {
      // First stop old watcher
      stopFileWatcher().then(() => {
        // Then start new watcher
        startFileWatcher(workspacePath);
      });
    } else {
      // If path is invalid, stop watching
      stopFileWatcher();
    }
    
    // Cleanup on component unmount
    return () => {
      stopFileWatcher();
    };
  }, [workspacePath, startFileWatcher, stopFileWatcher]);

  // Handle workspace folder selection
  const handleSelectWorkspace = useCallback(async () => {
    if (readOnly) return;
    
    try {
      const result = await selectWorkspaceFolder();
      if (result.success && result.data) {
        setWorkspacePath(result.data);
      }
    } catch (error) {
      console.error('[AgentKnowledgeBaseTab] Failed to select workspace folder:', error);
    }
  }, [readOnly]);

  // Get currently displayed nodes (convert FileTreeNode to DirectoryItem format)
  const currentItems = useMemo(() => {
    let nodes: FileTreeNode[];
    if (directoryStack.length === 0) {
      nodes = fileTree;
    } else {
      const currentDir = directoryStack[directoryStack.length - 1];
      nodes = currentDir.children || [];
    }
    
    // Convert to same format as SkillFolderExplorer
    return nodes.map(node => ({
      name: node.name,
      path: node.path,
      isDirectory: node.type === 'directory',
      isFile: node.type === 'file',
      size: (node as any).size || 0,
      modifiedTime: (node as any).modifiedTime || '',
      extension: node.type === 'file' ? node.name.split('.').pop() || null : null,
    }));
  }, [fileTree, directoryStack]);

  // Get current path (relative path)
  const currentRelativePath = useMemo(() => {
    if (directoryStack.length === 0) {
      return '';
    }
    // Build relative path
    return directoryStack.map(node => node.name).join('/');
  }, [directoryStack]);

  // Build breadcrumb path - consistent with SkillFolderExplorer
  const getBreadcrumbParts = useCallback(() => {
    const rootName = workspacePath ? workspacePath.split(/[/\\]/).pop() || 'Workspace' : 'Workspace';
    const parts = [{ name: rootName, path: '' }];
    
    if (directoryStack.length > 0) {
      let accumulatedPath = '';
      directoryStack.forEach(node => {
        accumulatedPath = accumulatedPath ? `${accumulatedPath}/${node.name}` : node.name;
        parts.push({ name: node.name, path: accumulatedPath });
      });
    }
    
    return parts;
  }, [workspacePath, directoryStack]);

  // Handle back button
  const handleBack = useCallback(() => {
    if (pathHistory.length > 0) {
      const previousStackLength = pathHistory[pathHistory.length - 1];
      setPathHistory(prev => prev.slice(0, -1));
      setDirectoryStack(prev => prev.slice(0, parseInt(previousStackLength, 10)));
    } else if (directoryStack.length > 0) {
      setDirectoryStack(prev => prev.slice(0, -1));
    }
  }, [pathHistory, directoryStack]);

  // Handle breadcrumb click
  const handleBreadcrumbClick = useCallback((targetIndex: number) => {
    // If clicking current location, do nothing
    if (targetIndex === directoryStack.length) {
      return;
    }
    
    if (targetIndex === 0) {
      // Return to root directory
      setPathHistory([]);
      setDirectoryStack([]);
    } else {
      // Navigate to specified directory
      setPathHistory(prev => [...prev, String(directoryStack.length)]);
      setDirectoryStack(prev => prev.slice(0, targetIndex));
    }
  }, [directoryStack]);

  // Handle directory click: lazy load children, prioritize cache
  const handleDirectoryClick = useCallback(async (item: { path: string; name: string }) => {
    let children = childrenCache.current.get(item.path);
    if (children === undefined) {
      // Cache miss, get direct children of this directory from main process
      setIsLoading(true);
      try {
        const result = await getDirectoryChildren(item.path, { ignorePatterns: IGNORE_PATTERNS });
        children = result.success ? (result.data?.children as FileTreeNode[] || []) : [];
      } catch (error) {
        console.error('[AgentKnowledgeBaseTab] Failed to load directory children:', error);
        children = [];
      } finally {
        setIsLoading(false);
      }
      childrenCache.current.set(item.path, children);
    }
    // Push directory node with loaded children onto stack
    const node: FileTreeNode = { name: item.name, path: item.path, type: 'directory', children };
    setPathHistory(prev => [...prev, String(directoryStack.length)]);
    setDirectoryStack(prev => [...prev, node]);
  }, [directoryStack]);

  // Handle file click - use OverlayImageViewer for images, OverlayFileViewer for other files
  const handleFileClick = useCallback((item: { path: string; name: string; size?: number }) => {
    if (isImageFile(item.name)) {
      // Collect all image files in current directory
      const imageItems = currentItems.filter(i => i.isFile && isImageFile(i.name));
      const images = imageItems.map(i => ({
        id: i.path,
        url: `file://${i.path}`,
        alt: i.name,
      }));
      const index = imageItems.findIndex(i => i.path === item.path);
      window.dispatchEvent(new CustomEvent('imageViewer:open', {
        detail: { images, initialIndex: index >= 0 ? index : 0 },
      }));
    } else {
      window.dispatchEvent(new CustomEvent('fileViewer:open', {
        detail: {
          file: {
            name: item.name,
            url: item.path,
            size: item.size,
          },
        },
      }));
    }
  }, [currentItems]);

  // ========== Drag and drop feature - consistent with WorkspaceExplorerSidepane ==========
  
  // Handle drag enter
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!readOnly && isValidWorkspacePath(workspacePath)) {
      setIsDraggingOver(true);
    }
  }, [readOnly, workspacePath]);
  
  // Handle drag leave
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Check if really left the container (and not just entered a child element)
    const relatedTarget = e.relatedTarget as Node | null;
    const currentTarget = e.currentTarget as Node;
    if (!relatedTarget || !currentTarget.contains(relatedTarget)) {
      setIsDraggingOver(false);
    }
  }, []);
  
  // Handle file drop
  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);
    
    console.log('[AgentKnowledgeBaseTab] handleDrop triggered');
    console.log('[AgentKnowledgeBaseTab] readOnly:', readOnly);
    console.log('[AgentKnowledgeBaseTab] workspacePath:', workspacePath);
    console.log('[AgentKnowledgeBaseTab] isValidWorkspacePath:', isValidWorkspacePath(workspacePath));
    
    if (readOnly || !isValidWorkspacePath(workspacePath)) {
      console.log('[AgentKnowledgeBaseTab] Drop aborted - readOnly or invalid path');
      return;
    }
    
    // Get dragged file paths
    const files = e.dataTransfer.files;
    console.log('[AgentKnowledgeBaseTab] Files count:', files.length);
    
    if (files.length === 0) {
      console.log('[AgentKnowledgeBaseTab] No files in drop');
      return;
    }
    
    // Determine target directory (current browsing directory or root)
    const targetDir = directoryStack.length > 0 
      ? directoryStack[directoryStack.length - 1].path 
      : workspacePath;
    
    console.log('[AgentKnowledgeBaseTab] Target directory:', targetDir);
    
    // Process each dragged file/directory
    let successCount = 0;
    let failCount = 0;
    
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      
      // 🔥 Use Electron webUtils.getPathForFile() API to get file path
      let sourcePath: string | undefined;
      
      // First try using Electron API
      if (window.electronAPI?.fs?.getPathForFile) {
        try {
          sourcePath = window.electronAPI.fs.getPathForFile(file);
          console.log('[AgentKnowledgeBaseTab] Got path from webUtils.getPathForFile:', sourcePath);
        } catch (err) {
          console.warn('[AgentKnowledgeBaseTab] webUtils.getPathForFile failed:', err);
        }
      }
      
      // If Electron API fails, try using file.path (legacy Electron)
      if (!sourcePath && (file as any).path) {
        sourcePath = (file as any).path;
        console.log('[AgentKnowledgeBaseTab] Got path from file.path:', sourcePath);
      }
      
      console.log('[AgentKnowledgeBaseTab] Processing file:', file.name, 'path:', sourcePath);
      
      if (!sourcePath) {
        console.log('[AgentKnowledgeBaseTab] No path for file:', file.name);
        continue;
      }
      
      try {
        console.log('[AgentKnowledgeBaseTab] Copying from', sourcePath, 'to', targetDir);
        const result = await copyPathToWorkspace(sourcePath, targetDir);
        
        console.log('[AgentKnowledgeBaseTab] Copy result:', result);
        
        if (result.success) {
          successCount++;
        } else {
          failCount++;
          console.error('[AgentKnowledgeBaseTab] Failed to copy:', sourcePath, result.error);
        }
      } catch (error) {
        failCount++;
        console.error('[AgentKnowledgeBaseTab] Error copying file:', sourcePath, error);
      }
    }
    
    console.log('[AgentKnowledgeBaseTab] Copy complete. Success:', successCount, 'Failed:', failCount);
    
    // Refresh file tree after copying
    if (successCount > 0) {
      try {
        await clearFileTreeCache(workspacePath);
        await loadFileTree(workspacePath);
        console.log('[AgentKnowledgeBaseTab] File tree refreshed');
      } catch (error) {
        console.error('[AgentKnowledgeBaseTab] Failed to refresh file tree:', error);
      }
    }
  }, [readOnly, workspacePath, directoryStack, loadFileTree]);

  // ========== Add Files feature ==========
  
  // Handle add files button click
  const handleAddFiles = useCallback(async () => {
    if (readOnly || !isValidWorkspacePath(workspacePath)) {
      return;
    }
    
    // Determine target directory (current browsing directory or root)
    const targetDir = directoryStack.length > 0 
      ? directoryStack[directoryStack.length - 1].path 
      : workspacePath;
    
    console.log('[AgentKnowledgeBaseTab] handleAddFiles - target directory:', targetDir);
    
    try {
      // Show file selection dialog, supports multiple files and directories
      const result = await window.electronAPI?.fs?.selectFiles?.({
        title: 'Select Files or Folders to Add',
        allowMultiple: true,
      });
      
      console.log('[AgentKnowledgeBaseTab] File selection result:', result);
      
      if (!result?.success || !result.filePaths || result.filePaths.length === 0) {
        console.log('[AgentKnowledgeBaseTab] File selection canceled or no files selected');
        return;
      }
      
      // Copy selected files/directories to target directory
      let successCount = 0;
      let failCount = 0;
      
      for (const sourcePath of result.filePaths) {
        try {
          console.log('[AgentKnowledgeBaseTab] Copying from', sourcePath, 'to', targetDir);
          const copyResult = await copyPathToWorkspace(sourcePath, targetDir);
          
          if (copyResult.success) {
            successCount++;
          } else {
            failCount++;
            console.error('[AgentKnowledgeBaseTab] Failed to copy:', sourcePath, copyResult.error);
          }
        } catch (error) {
          failCount++;
          console.error('[AgentKnowledgeBaseTab] Error copying:', sourcePath, error);
        }
      }
      
      console.log('[AgentKnowledgeBaseTab] Add Files complete. Success:', successCount, 'Failed:', failCount);
      
      // Refresh file tree after copying
      if (successCount > 0) {
        try {
          await clearFileTreeCache(workspacePath);
          await loadFileTree(workspacePath);
          console.log('[AgentKnowledgeBaseTab] File tree refreshed after adding files');
        } catch (error) {
          console.error('[AgentKnowledgeBaseTab] Failed to refresh file tree:', error);
        }
      }
    } catch (error) {
      console.error('[AgentKnowledgeBaseTab] Error in handleAddFiles:', error);
    }
    setShowAddMenu(false);
  }, [readOnly, workspacePath, directoryStack, loadFileTree]);

  // Handle add folder button click
  const handleAddFolder = useCallback(async () => {
    if (readOnly || !isValidWorkspacePath(workspacePath)) {
      return;
    }
    
    // Determine target directory (current browsing directory or root)
    const targetDir = directoryStack.length > 0 
      ? directoryStack[directoryStack.length - 1].path 
      : workspacePath;
    
    console.log('[AgentKnowledgeBaseTab] handleAddFolder - target directory:', targetDir);
    
    try {
      // Show folder selection dialog
      const result = await window.electronAPI?.workspace?.selectFolder?.();
      
      console.log('[AgentKnowledgeBaseTab] Folder selection result:', result);
      
      if (!result?.success || !result.folderPath) {
        console.log('[AgentKnowledgeBaseTab] Folder selection canceled');
        return;
      }
      
      // Copy selected folder to target directory
      try {
        console.log('[AgentKnowledgeBaseTab] Copying folder from', result.folderPath, 'to', targetDir);
        const copyResult = await copyPathToWorkspace(result.folderPath, targetDir);
        
        if (copyResult.success) {
          console.log('[AgentKnowledgeBaseTab] Folder copied successfully');
          // Refresh file tree after copying
          try {
            await clearFileTreeCache(workspacePath);
            await loadFileTree(workspacePath);
            console.log('[AgentKnowledgeBaseTab] File tree refreshed after adding folder');
          } catch (error) {
            console.error('[AgentKnowledgeBaseTab] Failed to refresh file tree:', error);
          }
        } else {
          console.error('[AgentKnowledgeBaseTab] Failed to copy folder:', copyResult.error);
        }
      } catch (error) {
        console.error('[AgentKnowledgeBaseTab] Error copying folder:', error);
      }
    } catch (error) {
      console.error('[AgentKnowledgeBaseTab] Error in handleAddFolder:', error);
    }
    setShowAddMenu(false);
  }, [readOnly, workspacePath, directoryStack, loadFileTree]);

  // ========== Paste to Knowledge Base feature ==========
  
  // Open paste dialog - use global context
  const handleOpenPasteDialog = useCallback(() => {
    if (readOnly || hasUnsavedWorkspacePath || !workspacePath) {
      return;
    }
    // Determine target directory (current browsing directory or root)
    const targetDir = directoryStack.length > 0 
      ? directoryStack[directoryStack.length - 1].path 
      : workspacePath;
    
    openPasteDialog(workspacePath, targetDir, () => {
      // Success callback: refresh file tree
      loadFileTree(workspacePath);
    });
  }, [readOnly, hasUnsavedWorkspacePath, workspacePath, directoryStack, openPasteDialog, loadFileTree]);

  // ========== Selection and deletion features ==========
  
  // Toggle selection state
  const handleToggleSelect = useCallback((e: React.MouseEvent, itemPath: string) => {
    e.stopPropagation(); // Prevent triggering item click event
    setSelectedPaths(prev => {
      const newSet = new Set(prev);
      if (newSet.has(itemPath)) {
        newSet.delete(itemPath);
      } else {
        newSet.add(itemPath);
      }
      return newSet;
    });
  }, []);
  
  // Select / Deselect All
  const handleSelectAll = useCallback(() => {
    if (currentItems.length === 0) return;
    const allPaths = currentItems.map(item => item.path);
    const allSelected = allPaths.every(p => selectedPaths.has(p));
    if (allSelected) {
      // Deselect all
      setSelectedPaths(new Set());
    } else {
      // Select all
      setSelectedPaths(new Set(allPaths));
    }
  }, [currentItems, selectedPaths]);

  // Compute select-all checkbox state
  const isAllSelected = useMemo(() => {
    if (currentItems.length === 0) return false;
    return currentItems.every(item => selectedPaths.has(item.path));
  }, [currentItems, selectedPaths]);

  const isIndeterminate = useMemo(() => {
    if (currentItems.length === 0) return false;
    const someSelected = currentItems.some(item => selectedPaths.has(item.path));
    return someSelected && !isAllSelected;
  }, [currentItems, selectedPaths, isAllSelected]);

  // Clear all selections
  const clearSelection = useCallback(() => {
    setSelectedPaths(new Set());
  }, []);
  
  // Clear selection when changing directories
  useEffect(() => {
    clearSelection();
  }, [directoryStack, clearSelection]);
  
  // Handle delete selected items
  const handleDeleteSelected = useCallback(async () => {
    if (readOnly || selectedPaths.size === 0) {
      return;
    }
    
    const pathsToDelete = Array.from(selectedPaths);
    const itemCount = pathsToDelete.length;
    
    // Use system confirmation dialog
    const confirmMessage = itemCount === 1
      ? `Are you sure you want to delete this item?\n\n${pathsToDelete[0].split(/[/\\]/).pop()}\n\nThis action cannot be undone.`
      : `Are you sure you want to delete ${itemCount} items?\n\nThis action cannot be undone.`;
    
    const confirmed = window.confirm(confirmMessage);
    
    if (!confirmed) {
      return;
    }
    
    console.log('[AgentKnowledgeBaseTab] Deleting paths:', pathsToDelete);
    
    try {
      const result = await window.electronAPI?.fs?.deletePaths?.(pathsToDelete);
      
      console.log('[AgentKnowledgeBaseTab] Delete result:', result);
      
      if (result?.successCount && result.successCount > 0) {
        // Clear selection
        clearSelection();
        
        // Refresh file tree
        try {
          await clearFileTreeCache(workspacePath);
          await loadFileTree(workspacePath);
          console.log('[AgentKnowledgeBaseTab] File tree refreshed after deletion');
        } catch (error) {
          console.error('[AgentKnowledgeBaseTab] Failed to refresh file tree:', error);
        }
      }
      
      if (result?.failCount && result.failCount > 0) {
        console.error('[AgentKnowledgeBaseTab] Some deletions failed:', result.results?.filter(r => !r.success));
      }
    } catch (error) {
      console.error('[AgentKnowledgeBaseTab] Error deleting paths:', error);
    }
  }, [readOnly, selectedPaths, workspacePath, loadFileTree, clearSelection]);

  // Click outside to close dropdown menu
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (addMenuRef.current && !addMenuRef.current.contains(event.target as Node)) {
        setShowAddMenu(false);
      }
    };
    
    if (showAddMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showAddMenu]);

  // Get empty state message
  const getEmptyStateMessage = useCallback(() => {
    const agentName = agentData?.name || 'Agent';
    
    // Kosmos or default
    return {
      title: 'Add documents, code files, images, and more.',
      subtitle: `${agentName} can use them as references when you chat.`
    };
  }, [agentData?.name]);

  const emptyMessage = getEmptyStateMessage();

  const breadcrumbParts = getBreadcrumbParts();

  return (
    <div 
      className={`agent-tab agent-workspace-tab ${isDraggingOver ? 'dragging-over' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drop Overlay */}
      {isDraggingOver && (
        <div className="workspace-drop-overlay">
          <div className="workspace-drop-overlay-content">
            <div className="workspace-drop-icon">📁</div>
            <p>Drop files or folders here to add to Knowledge Base</p>
          </div>
        </div>
      )}
      
      {/* Tab Body - consistent structure with SkillFolderExplorer */}
      <div className="tab-body workspace-tab-body">
        {/* Knowledge Base Path Selector */}
        <div className="workspace-path-section">
          <label className="section-label">Knowledge Base Path</label>
          <div className="workspace-path-row">
            <input
              type="text"
              className="workspace-path-input"
              value={workspacePath}
              onChange={(e) => !isWorkspacePathDisabled && setWorkspacePath(e.target.value)}
              placeholder="Select or enter knowledge base path..."
              disabled={isWorkspacePathDisabled}
              readOnly
            />
            <button
              type="button"
              className="select-path-btn"
              onClick={handleSelectWorkspace}
              disabled={isWorkspacePathDisabled}
              title={"Select knowledge base folder"}
            >
              <FolderOpen size={16} />
              <span>Select Path</span>
            </button>
          </div>
        </div>

        {/* Workspace Content - use skill-folder-explorer styles */}
        {isValidWorkspacePath(workspacePath) ? (
          <div className="skill-folder-explorer">
            {/* Header: breadcrumb navigation - consistent with SkillFolderExplorer */}
            <div className="skill-folder-explorer-header">
              <Folder size={18} className="skill-folder-header-icon" />
              {directoryStack.length > 0 && (
                <button 
                  className="skill-folder-back-btn"
                  onClick={handleBack}
                  title="Go back"
                >
                  <ChevronLeft size={20} strokeWidth={2} />
                </button>
              )}
              <div className="skill-folder-breadcrumb">
                {breadcrumbParts.map((part, index, arr) => (
                  <React.Fragment key={part.path}>
                    <button
                      className={`skill-folder-breadcrumb-item ${index === arr.length - 1 ? 'active' : ''}`}
                      onClick={() => handleBreadcrumbClick(index)}
                      disabled={index === arr.length - 1}
                    >
                      {part.name}
                    </button>
                    {index < arr.length - 1 && (
                      <span className="skill-folder-breadcrumb-separator">/</span>
                    )}
                  </React.Fragment>
                ))}
              </div>
              
              {/* Action Section - fixed on the right */}
              {!readOnly && (
                <div className="workspace-actions">
                  {/* Hint when workspace path is unsaved */}
                  {hasUnsavedWorkspacePath && (
                    <span className="workspace-unsaved-hint" style={{
                      fontSize: '12px',
                      color: '#dc2626',
                      marginRight: '8px',
                      whiteSpace: 'nowrap'
                    }}>
                      Save to enable file management
                    </span>
                  )}
                  
                  {/* Delete button - show when selected items > 0, disabled when path unsaved */}
                  {selectedPaths.size > 0 && (
                    <button
                      className="workspace-delete-btn"
                      onClick={handleDeleteSelected}
                      disabled={hasUnsavedWorkspacePath}
                      title={hasUnsavedWorkspacePath 
                        ? 'Save knowledge base path first to enable delete' 
                        : `Delete ${selectedPaths.size} selected item(s)`}
                      style={hasUnsavedWorkspacePath ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
                    >
                      <Trash2 size={16} />
                      <span>Delete {selectedPaths.size} {selectedPaths.size === 1 ? 'item' : 'items'}</span>
                    </button>
                  )}
                  
                  {/* Add dropdown menu - disabled when path unsaved */}
                  <div className="workspace-add-menu-container" ref={addMenuRef}>
                    <button
                      className="workspace-add-files-btn"
                      onClick={() => !hasUnsavedWorkspacePath && setShowAddMenu(!showAddMenu)}
                      disabled={hasUnsavedWorkspacePath}
                      title={hasUnsavedWorkspacePath 
                        ? 'Save knowledge base path first to add files' 
                        : 'Add files or folders'}
                      style={hasUnsavedWorkspacePath ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
                    >
                      <Plus size={16} />
                      <span>Add</span>
                      <ChevronDown size={14} className={`workspace-add-chevron ${showAddMenu ? 'open' : ''}`} />
                    </button>
                    
                    {showAddMenu && !hasUnsavedWorkspacePath && (
                      <div className="workspace-add-dropdown">
                        <button
                          className="workspace-add-dropdown-item"
                          onClick={handleAddFiles}
                        >
                          <File size={16} />
                          <span>Add Files</span>
                        </button>
                        <button
                          className="workspace-add-dropdown-item"
                          onClick={handleAddFolder}
                        >
                          <FolderPlus size={16} />
                          <span>Add Folder</span>
                        </button>
                        <button
                          className="workspace-add-dropdown-item"
                          onClick={handleOpenPasteDialog}
                        >
                          <Clipboard size={16} />
                          <span>Paste Text</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Content: file and directory list */}
            <div className="skill-folder-explorer-content">
              {isLoading ? (
                <LoadingSpinner />
              ) : currentItems.length > 0 ? (
                <div className="skill-folder-items">
                  {/* Select All / Deselect All */}
                  {!readOnly && !hasUnsavedWorkspacePath && currentItems.length > 0 && (
                    <div className="workspace-select-all-row">
                      <label className="workspace-select-all-label" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isAllSelected}
                          ref={(el) => { if (el) el.indeterminate = isIndeterminate; }}
                          onChange={handleSelectAll}
                        />
                        <span className="workspace-select-all-text">
                          {isAllSelected ? 'Deselect All' : 'Select All'}
                        </span>
                      </label>
                    </div>
                  )}
                  {currentItems.map((item) => (
                    <div
                      key={item.path}
                      className={`skill-folder-item ${item.isDirectory ? 'directory' : 'file'} ${selectedPaths.has(item.path) ? 'selected' : ''}`}
                      onClick={() => item.isDirectory ? handleDirectoryClick(item) : handleFileClick(item)}
                    >
                      {/* Checkbox - only show in non-readonly mode and when path is saved */}
                      {!readOnly && !hasUnsavedWorkspacePath && (
                        <label 
                          className="skill-folder-item-checkbox"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            checked={selectedPaths.has(item.path)}
                            onChange={() => {
                              setSelectedPaths(prev => {
                                const newSet = new Set(prev);
                                if (newSet.has(item.path)) {
                                  newSet.delete(item.path);
                                } else {
                                  newSet.add(item.path);
                                }
                                return newSet;
                              });
                            }}
                          />
                        </label>
                      )}
                      <div className="skill-folder-item-icon">
                        {item.isDirectory ? (
                          <Folder size={16} />
                        ) : (
                          <FileIcon extension={item.extension} fileName={item.name} />
                        )}
                      </div>
                      <div className="skill-folder-item-info">
                        <span className="skill-folder-item-name">{item.name}</span>
                        {item.isFile && (
                          <span className="skill-folder-item-size">
                            {formatFileSize(item.size)}
                          </span>
                        )}
                      </div>
                      {item.isDirectory && (
                        <div className="skill-folder-item-arrow">
                          <ChevronRight size={20} />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                /* Empty folder state - reference skills-empty-state design */
                <div className="workspace-folder-empty-state">
                  <div className="workspace-folder-empty-content">
                    <div className="workspace-folder-empty-icon">
                      <FolderOpen size={56} />
                    </div>
                    <p className="workspace-folder-empty-text">{emptyMessage.title}</p>
                    <p className="workspace-folder-empty-subtext">{emptyMessage.subtitle}</p>
                    {/* Show hint when workspace path is unsaved */}
                    {!readOnly && hasUnsavedWorkspacePath && (
                      <p style={{
                        fontSize: '13px',
                        color: '#dc2626',
                        marginTop: '12px',
                        marginBottom: '8px'
                      }}>
                        Save knowledge base path first to manage files
                      </p>
                    )}
                    {!readOnly && !hasUnsavedWorkspacePath && (
                      <div className="workspace-folder-empty-actions">
                        <button
                          className="workspace-folder-empty-btn primary"
                          onClick={handleAddFiles}
                        >
                          <File size={18} />
                          <span>Add Files</span>
                        </button>
                        <button
                          className="workspace-folder-empty-btn secondary"
                          onClick={handleAddFolder}
                        >
                          <FolderPlus size={18} />
                          <span>Add Folder</span>
                        </button>
                        <button
                          className="workspace-folder-empty-btn secondary"
                          onClick={handleOpenPasteDialog}
                        >
                          <Clipboard size={18} />
                          <span>Paste Text</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* No Knowledge Base Path State */
          <div className="workspace-empty-state no-path">
            <div className="empty-icon">
              <FolderPlus size={48} />
            </div>
            <p className="empty-title">{emptyMessage.title}</p>
            <p className="empty-subtitle">{emptyMessage.subtitle}</p>
            {!isWorkspacePathDisabled && (
              <button
                className="workspace-action-btn add-btn primary"
                onClick={handleSelectWorkspace}
              >
                <FolderOpen size={16} />
                <span>Select Knowledge Base Folder</span>
              </button>
            )}
          </div>
        )}
      </div>

    </div>
  );
};

export default AgentKnowledgeBaseTab;
