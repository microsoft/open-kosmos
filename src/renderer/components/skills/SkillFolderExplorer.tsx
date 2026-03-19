'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Folder,
  FolderOpen,
  FileText,
  FileCode,
  FileJson,
  FileType,
  Palette,
  Globe,
  Image as ImageIcon,
} from 'lucide-react'
import { SkillConfig } from '../../lib/userData/types'
import { FileInfo } from './SkillViewPanel'

interface DirectoryItem {
  name: string
  path: string
  isDirectory: boolean
  isFile: boolean
  size: number
  modifiedTime: string
  extension: string | null
}

interface DirectoryContents {
  currentPath: string
  parentPath: string | null
  items: DirectoryItem[]
}

interface SkillFolderExplorerProps {
  skill: SkillConfig
  onFileSelect: (fileInfo: FileInfo) => void
}

// Loading spinner component
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
)

// File icon component - consistent with FileTreeExplorer
const FileIcon: React.FC<{ extension: string | null }> = ({ extension }) => {
  // Return different icons based on file extension, consistent with FileTreeExplorer
  const ext = extension?.toLowerCase()
  switch (ext) {
    case 'ts':
    case 'tsx':
    case 'js':
    case 'jsx':
      return <FileCode size={16} />
    case 'json':
      return <FileJson size={16} />
    case 'md':
      return <FileType size={16} />
    case 'css':
    case 'scss':
      return <Palette size={16} />
    case 'html':
      return <Globe size={16} />
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'svg':
      return <ImageIcon size={16} />
    default:
      return <FileText size={16} />
  }
}

const SkillFolderExplorer: React.FC<SkillFolderExplorerProps> = ({
  skill,
  onFileSelect
}) => {
  const [currentPath, setCurrentPath] = useState<string>('')
  const [directoryContents, setDirectoryContents] = useState<DirectoryContents | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pathHistory, setPathHistory] = useState<string[]>([])

  // Load directory contents
  const loadDirectory = useCallback(async (relativePath: string = '') => {
    setIsLoading(true)
    setError(null)
    
    try {
      const result = await window.electronAPI?.skills?.getSkillDirectoryContents?.(skill.name, relativePath)
      
      if (result?.success && result.data) {
        setDirectoryContents(result.data)
        setCurrentPath(relativePath)
      } else {
        setError(result?.error || 'Failed to load directory contents')
        setDirectoryContents(null)
      }
    } catch (err) {
      console.error('Error loading directory:', err)
      setError(err instanceof Error ? err.message : 'Failed to load directory contents')
      setDirectoryContents(null)
    } finally {
      setIsLoading(false)
    }
  }, [skill.name])

  // Initially load root directory
  useEffect(() => {
    loadDirectory('')
    setPathHistory([])
  }, [skill.name, loadDirectory])

  // Listen for skill-folder-explorer refresh events
  useEffect(() => {
    const handleRefreshFolderExplorer = (event: CustomEvent) => {
      const { skillName } = event.detail;
      // Only refresh when the refreshed skill is the currently displayed skill
      if (skillName === skill.name) {
        // Reload current directory
        loadDirectory(currentPath);
      }
    };

    window.addEventListener(
      'skills:refreshFolderExplorer',
      handleRefreshFolderExplorer as EventListener
    );

    return () => {
      window.removeEventListener(
        'skills:refreshFolderExplorer',
        handleRefreshFolderExplorer as EventListener
      );
    };
  }, [skill.name, currentPath, loadDirectory]);

  // Handle directory click
  const handleDirectoryClick = useCallback((item: DirectoryItem) => {
    setPathHistory(prev => [...prev, currentPath])
    loadDirectory(item.path)
  }, [currentPath, loadDirectory])

  // Handle file click
  const handleFileClick = useCallback(async (item: DirectoryItem) => {
    try {
      const result = await window.electronAPI?.skills?.getSkillFileContent?.(skill.name, item.path)
      
      if (result?.success && result.data) {
        onFileSelect(result.data)
      } else {
        console.error('Failed to load file:', result?.error)
      }
    } catch (err) {
      console.error('Error loading file:', err)
    }
  }, [skill.name, onFileSelect])

  // Handle back button
  const handleBack = useCallback(() => {
    if (pathHistory.length > 0) {
      const previousPath = pathHistory[pathHistory.length - 1]
      setPathHistory(prev => prev.slice(0, -1))
      loadDirectory(previousPath)
    }
  }, [pathHistory, loadDirectory])

  // Get current directory name
  const getCurrentDirectoryName = () => {
    if (!currentPath) {
      return skill.name
    }
    const parts = currentPath.split(/[/\\]/)
    return parts[parts.length - 1] || skill.name
  }

  // Build breadcrumb path
  const getBreadcrumbParts = () => {
    const parts = [{ name: skill.name, path: '' }]
    if (currentPath) {
      const pathParts = currentPath.split(/[/\\]/).filter(Boolean)
      let accumulatedPath = ''
      pathParts.forEach(part => {
        accumulatedPath = accumulatedPath ? `${accumulatedPath}/${part}` : part
        parts.push({ name: part, path: accumulatedPath })
      })
    }
    return parts
  }

  // Handle breadcrumb click
  const handleBreadcrumbClick = useCallback((targetPath: string) => {
    // If clicking the current path, do nothing
    if (targetPath === currentPath) {
      return
    }
    
    // Build new history based on target path
    // All paths before the target path should become new history
    const pathParts = targetPath ? targetPath.split(/[/\\]/).filter(Boolean) : []
    const newHistory: string[] = [''] // Start from root directory (empty string represents root)
    let accumulatedPath = ''
    for (const part of pathParts) {
      accumulatedPath = accumulatedPath ? `${accumulatedPath}/${part}` : part
      if (accumulatedPath !== targetPath) {
        newHistory.push(accumulatedPath)
      }
    }
    // Remove root directory empty string, unless it's the only history entry
    if (targetPath !== '') {
      setPathHistory(newHistory.slice(1)) // Don't include root directory in history
    } else {
      setPathHistory([])
    }
    loadDirectory(targetPath)
  }, [loadDirectory, currentPath])

  return (
    <div className="skill-folder-explorer">
      {/* Header: Breadcrumb navigation */}
      <div className="skill-folder-explorer-header">
        {pathHistory.length > 0 && (
          <button 
            className="skill-folder-back-btn"
            onClick={handleBack}
            title="Go back"
          >
            <ChevronLeft size={20} strokeWidth={2} />
          </button>
        )}
        <div className="skill-folder-breadcrumb">
          {getBreadcrumbParts().map((part, index, arr) => (
            <React.Fragment key={part.path}>
              <button
                className={`skill-folder-breadcrumb-item ${index === arr.length - 1 ? 'active' : ''}`}
                onClick={() => handleBreadcrumbClick(part.path)}
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
      </div>

      {/* Content: File and directory list */}
      <div className="skill-folder-explorer-content">
        {isLoading ? (
          <LoadingSpinner />
        ) : error ? (
          <div className="skill-folder-error">
            <span>⚠️ {error}</span>
          </div>
        ) : directoryContents && directoryContents.items.length > 0 ? (
          <div className="skill-folder-items">
            {directoryContents.items.map((item) => (
              <div
                key={item.path}
                className={`skill-folder-item ${item.isDirectory ? 'directory' : 'file'}`}
                onClick={() => item.isDirectory ? handleDirectoryClick(item) : handleFileClick(item)}
              >
                <div className="skill-folder-item-icon">
                  {item.isDirectory ? (
                    <Folder size={16} />
                  ) : (
                    <FileIcon extension={item.extension} />
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
          <div className="skill-folder-empty">
            <span>This directory is empty</span>
          </div>
        )}
      </div>
    </div>
  )
}

// Format file size
function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

export default SkillFolderExplorer