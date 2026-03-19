'use client'

import React, { useState, useCallback } from 'react'
import { SkillConfig } from '../../lib/userData/types'
import SkillFolderExplorer from './SkillFolderExplorer'
import SkillFileViewer from './SkillFileViewer'

interface SkillViewPanelProps {
  skill: SkillConfig | null
}

// View state type
type ViewMode = 'folder' | 'file'

export interface FileInfo {
  fileName: string
  path: string
  extension: string
  content: string | null
  isSupported: boolean
  size: number
  modifiedTime: string
}

const SkillViewPanel: React.FC<SkillViewPanelProps> = ({
  skill
}) => {
  // View mode: folder (directory browsing) or file (file viewing)
  const [viewMode, setViewMode] = useState<ViewMode>('folder')
  // Currently selected file info
  const [selectedFile, setSelectedFile] = useState<FileInfo | null>(null)

  // Handle file click - switch to file viewing mode
  const handleFileSelect = useCallback((fileInfo: FileInfo) => {
    setSelectedFile(fileInfo)
    setViewMode('file')
  }, [])

  // Handle returning to directory browsing
  const handleBackToFolder = useCallback(() => {
    setViewMode('folder')
    setSelectedFile(null)
  }, [])

  // When skill changes, reset to directory browsing mode
  React.useEffect(() => {
    setViewMode('folder')
    setSelectedFile(null)
  }, [skill?.name])

  // Listen for skill refresh events, handle file viewing mode refresh
  React.useEffect(() => {
    const handleRefreshFolderExplorer = async (event: Event) => {
      const customEvent = event as CustomEvent;
      const { skillName } = customEvent.detail;
      
      // Only process when the refreshed skill is the currently displayed skill
      if (skill && skillName === skill.name) {
        if (viewMode === 'file' && selectedFile) {
          // If currently viewing a file, reload file content
          try {
            const result = await window.electronAPI?.skills?.getSkillFileContent?.(skill.name, selectedFile.path);
            
            if (result?.success && result.data) {
              setSelectedFile(result.data);
            }
          } catch (error) {
            console.error('Error refreshing file content:', error);
          }
        }
        // Folder mode refresh is handled by SkillFolderExplorer itself
      }
    };

    window.addEventListener(
      'skills:refreshFolderExplorer',
      handleRefreshFolderExplorer
    );

    return () => {
      window.removeEventListener(
        'skills:refreshFolderExplorer',
        handleRefreshFolderExplorer
      );
    };
  }, [skill, viewMode, selectedFile]);

  if (!skill) {
    return (
      <div className="skill-view-panel-empty">
        <span>Select a skill to view details</span>
      </div>
    )
  }

  return (
    <div className="skill-view-panel-container">
      {viewMode === 'folder' ? (
        <SkillFolderExplorer
          skill={skill}
          onFileSelect={handleFileSelect}
        />
      ) : (
        <SkillFileViewer
          skill={skill}
          fileInfo={selectedFile}
          onBack={handleBackToFolder}
        />
      )}
    </div>
  )
}

export default SkillViewPanel