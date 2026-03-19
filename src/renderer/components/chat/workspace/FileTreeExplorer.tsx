import React, { useState, useCallback, useMemo } from 'react';
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
  ChevronRight,
  ChevronDown,
} from 'lucide-react';
import { FileTreeNode } from '../../../lib/chat/workspaceOps';

interface FileTreeExplorerProps {
  nodes: FileTreeNode[];
  workspacePath: string;
  onFileClick?: (node: FileTreeNode) => void;
  className?: string;
  directoryStack?: FileTreeNode[];
  onDirectoryStackChange?: (stack: FileTreeNode[]) => void;
  showBreadcrumb?: boolean; // Whether to show breadcrumb navigation
  onFileTreeNodeMenuToggle?: (event: React.MouseEvent, node: any, workspacePath: string) => void;
  /** Lazy loading callback: called when expanding directory, parent component responsible for fetching and injecting child nodes */
  onLoadChildren?: (dirPath: string) => Promise<void>;
}

interface FileTreeNodeItemProps {
  node: FileTreeNode;
  workspacePath: string;
  level?: number;
  onFileClick?: (node: FileTreeNode) => void;
  expandedDirs: Set<string>;
  onToggleExpand?: (path: string) => void;
  onLoadChildren?: (dirPath: string) => Promise<void>;
  onFileTreeNodeMenuToggle?: (event: React.MouseEvent, node: any, workspacePath: string) => void;
}

/**
 * Single file/folder node component (Tree View)
 */
const FileTreeNodeItem: React.FC<FileTreeNodeItemProps> = React.memo(({
  node,
  workspacePath,
  level = 0,
  onFileClick,
  expandedDirs,
  onToggleExpand,
  onLoadChildren,
  onFileTreeNodeMenuToggle
}) => {
  
  const isExpanded = expandedDirs.has(node.path);
  const hasChildren = node.type === 'directory' && node.children && node.children.length > 0;
  const isDirectory = node.type === 'directory';

  const handleClick = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    
    if (node.type === 'file') {
      // File click: handle through onFileClick callback
      if (onFileClick) {
        onFileClick(node);
      } else {
        // Fallback: open with system default application
        try {
          if (window.electronAPI?.workspace?.openPath) {
            await window.electronAPI.workspace.openPath(node.path);
          }
        } catch (error) {
          console.error('[FileTreeExplorer] Error opening file:', error);
        }
      }
    } else if (node.type === 'directory' && onToggleExpand) {
      const isCurrentlyExpanded = expandedDirs.has(node.path);
      // When expanding, first toggle state (immediate response), then lazy load child nodes
      onToggleExpand(node.path);
      if (!isCurrentlyExpanded && onLoadChildren) {
        await onLoadChildren(node.path);
      }
    }
  }, [node, onToggleExpand, onFileClick, expandedDirs, onLoadChildren]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (onFileTreeNodeMenuToggle) {
      onFileTreeNodeMenuToggle(e, node, workspacePath);
    }
  }, [onFileTreeNodeMenuToggle, node, workspacePath]);

  // Get icon
  const getIcon = useMemo(() => {
    if (node.type === 'directory') {
      return isExpanded ? <FolderOpen size={16} /> : <Folder size={16} />;
    }
    
    // Return different icons based on file extension
    const ext = node.name.split('.').pop()?.toLowerCase();
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
  }, [node.type, node.name, isExpanded]);

  return (
    <>
      <div
        className="file-tree-node"
        style={{ paddingLeft: `${level * 16}px` }}
      >
        <div
          className={`file-tree-node-content tree-view ${node.type === 'file' ? 'file' : 'directory'}`}
          onClick={handleClick}
          onContextMenu={handleContextMenu}
          title={node.path}
        >
          {isDirectory && (
            <span className="expand-icon">
              {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </span>
          )}
          <span className="node-icon">{getIcon}</span>
          <span className="node-name">{node.name}</span>
        </div>
      </div>
      
      {/* Recursively render child nodes */}
      {isDirectory && isExpanded && hasChildren && (
        <div className="file-tree-children">
          {node.children!.map((child) => (
            <FileTreeNodeItem
              key={child.path}
              node={child}
              workspacePath={workspacePath}
              level={level + 1}
              onFileClick={onFileClick}
              expandedDirs={expandedDirs}
              onToggleExpand={onToggleExpand}
              onLoadChildren={onLoadChildren}
              onFileTreeNodeMenuToggle={onFileTreeNodeMenuToggle}
            />
          ))}
        </div>
      )}
    </>
  );
});

FileTreeNodeItem.displayName = 'FileTreeNodeItem';

/**
 * Find node in tree
 */
const findNodeInTree = (nodes: FileTreeNode[], targetPath: string): FileTreeNode | null => {
  for (const node of nodes) {
    if (node.path === targetPath) {
      return node;
    }
    if (node.children) {
      const found = findNodeInTree(node.children, targetPath);
      if (found) return found;
    }
  }
  return null;
};

/**
 * File tree Explorer component
 * Tree View, supports expanding/collapsing multiple directory levels
 */
const FileTreeExplorer: React.FC<FileTreeExplorerProps> = ({
  nodes,
  workspacePath,
  onFileClick,
  className = '',
  directoryStack: externalDirectoryStack,
  onDirectoryStackChange,
  showBreadcrumb = true, // Keep this parameter for backward compatibility, but not used in Tree View
  onFileTreeNodeMenuToggle,
  onLoadChildren
}) => {
  // Use localStorage key to save expansion state for each workspace
  const storageKey = `fileTree_expanded_${workspacePath}`;
  
  // Load saved expansion state from localStorage
  const loadExpandedDirs = useCallback((): Set<string> => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const paths = JSON.parse(saved) as string[];
        return new Set(paths);
      }
    } catch (error) {
      console.error('[FileTreeExplorer] Failed to load expanded dirs:', error);
    }
    
    // Default expand root directory
    const initialExpanded = new Set<string>();
    if (nodes.length === 1 && nodes[0].type === 'directory') {
      initialExpanded.add(nodes[0].path);
    }
    return initialExpanded;
  }, [storageKey, nodes]);
  
  // Save expansion state to localStorage
  const saveExpandedDirs = useCallback((dirs: Set<string>) => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(Array.from(dirs)));
    } catch (error) {
      console.error('[FileTreeExplorer] Failed to save expanded dirs:', error);
    }
  }, [storageKey]);
  
  // Expanded directories set (using path as key)
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(() => loadExpandedDirs());

  // When workspacePath switches, restore expansion state from localStorage.
  // Note: Do not trim and write back when nodes only have shallow data, otherwise deep expansion records will be mistakenly deleted.
  React.useEffect(() => {
    const savedDirs = loadExpandedDirs();
    setExpandedDirs(savedDirs);
  }, [storageKey, loadExpandedDirs]);

  // Toggle directory expansion/collapse state
  const handleToggleExpand = useCallback((path: string) => {
    setExpandedDirs(prev => {
      const newSet = new Set(prev);
      if (newSet.has(path)) {
        newSet.delete(path);
      } else {
        newSet.add(path);
      }
      // Save to localStorage
      saveExpandedDirs(newSet);
      return newSet;
    });
  }, [saveExpandedDirs]);

  if (!nodes || nodes.length === 0) {
    return (
      <div className={`file-tree-explorer empty ${className}`}>
        <div className="empty-state">
          <div className="empty-icon">📂</div>
          <p>No files in workspace</p>
          <small>The workspace folder is empty or inaccessible</small>
        </div>
      </div>
    );
  }

  return (
    <div className={`file-tree-explorer tree-view ${className}`}>
      {/* Tree View content */}
      <div className="tree-content">
        {nodes.map((node) => (
          <FileTreeNodeItem
            key={node.path}
            node={node}
            workspacePath={workspacePath}
            level={0}
            onFileClick={onFileClick}
            expandedDirs={expandedDirs}
            onToggleExpand={handleToggleExpand}
            onLoadChildren={onLoadChildren}
            onFileTreeNodeMenuToggle={onFileTreeNodeMenuToggle}
          />
        ))}
      </div>
    </div>
  );
};

export default FileTreeExplorer;