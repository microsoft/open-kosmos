// src/renderer/components/chat/PresentedFilesCard.tsx
// File card component for presenting final deliverables, reuses file-attachment styles

import React, { useState } from 'react';
import ReactDOM from 'react-dom';
import { Package, MoreHorizontal, FolderOpen, Folder, Eye, Download } from 'lucide-react';
import FileTypeIcon from '../ui/FileTypeIcon';
import ApplySkillToAgentsDialog from '../skills/ApplySkillToAgentsDialog';
import { useToast } from '../ui/ToastProvider';

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg', 'ico', 'tiff', 'tif', 'avif']);

const isImageFile = (filePath: string): boolean => {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  return IMAGE_EXTENSIONS.has(ext);
};

export interface PresentedFile {
  filePath: string;
  description: string;
}

export interface PresentedFilesCardProps {
  files: PresentedFile[];
}

const getFileName = (filePath: string): string => {
  // Try Unix-style path separator first (Mac/Linux)
  if (filePath.includes('/')) {
    return filePath.split('/').pop() || filePath;
  }
  // Then try Windows-style path separator
  if (filePath.includes('\\')) {
    return filePath.split('\\').pop() || filePath;
  }
  // If neither, it's already a filename
  return filePath;
};

const handleOpenFile = (filePath: string) => {
  const fileName = getFileName(filePath);
  if (isImageFile(filePath)) {
    // Open image in OverlayImageViewer
    window.dispatchEvent(
      new CustomEvent('imageViewer:open', {
        detail: {
          images: [{ id: `presented-${filePath}`, url: filePath, alt: fileName }],
          initialIndex: 0,
        },
      }),
    );
  } else {
    // Open non-image in OverlayFileViewer
    window.dispatchEvent(
      new CustomEvent('fileViewer:open', {
        detail: {
          file: {
            name: fileName,
            url: filePath,
          },
        },
      }),
    );
  }
};

const handleOpenWithDefaultApp = async (filePath: string) => {
  try {
    await window.electronAPI?.workspace?.openPath(filePath);
  } catch (error) {
    console.error('[PresentedFilesCard] Error opening file with default app:', error);
  }
};

const handleShowInFolder = async (filePath: string) => {
  try {
    await window.electronAPI?.workspace?.showInFolder(filePath);
  } catch (error) {
    console.error('[PresentedFilesCard] Error revealing file:', error);
  }
};

const isSkillFile = (filePath: string): boolean => {
  return filePath.toLowerCase().endsWith('.skill');
};

/**
 * PresentedFilesCard Component
 * Displays final deliverables from the present tool
 * Reuses file-attachment styles
 */
export const PresentedFilesCard: React.FC<PresentedFilesCardProps> = ({ files }) => {
  const [fileMenuOpen, setFileMenuOpen] = useState<{ [key: string]: boolean }>({});
  const [fileMenuPosition, setFileMenuPosition] = useState<{ [key: string]: { top: number; left: number } }>({});
  const [applyDialogOpen, setApplyDialogOpen] = useState(false);
  const [applySkillName, setApplySkillName] = useState('');
  const { showSuccess, showError, showToast } = useToast();

  const handleInstallSkill = async (filePath: string) => {
    try {
      if (!window.electronAPI?.skillLibrary?.installSkillFromFilePath) {
        showError('Install skill API not available');
        return;
      }

      const result = await window.electronAPI.skillLibrary.installSkillFromFilePath(filePath);

      if (result.success) {
        showSuccess(`Skill "${result.skillName}" installed successfully`);
        // Trigger skills list refresh
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('skills:refreshFolderExplorer', {
            detail: { skillName: result.skillName }
          }));
        }, 600);

        // Show Apply to Agents dialog only for new installs (not overwrites)
        if (result.skillName && !result.isOverwrite) {
          setApplySkillName(result.skillName);
          setApplyDialogOpen(true);
        }
      } else if (result.error && result.error !== 'User cancelled the operation') {
        showToast(result.error, 'error', undefined, { persistent: true });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      showError(`Failed to install skill: ${errorMessage}`);
    }
  };

  if (!files || files.length === 0) {
    return null;
  }

  // Merge all files, group by description
  const groupedFiles = files.reduce((acc, file) => {
    const key = file.description || 'Final deliverables';
    if (!acc[key]) {
      acc[key] = [];
    }
    // Parse filePaths (may be a JSON array string)
    try {
      const paths = JSON.parse(file.filePath);
      if (Array.isArray(paths)) {
        acc[key].push(...paths);
      } else {
        acc[key].push(file.filePath);
      }
    } catch {
      acc[key].push(file.filePath);
    }
    return acc;
  }, {} as Record<string, string[]>);

  const handleFileMenuToggle = (filePath: string, event: React.MouseEvent) => {
    event.stopPropagation();
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();

    setFileMenuOpen(prev => {
      const newState = { ...prev };
      // Close other menus
      Object.keys(newState).forEach(key => {
        if (key !== filePath) newState[key] = false;
      });
      newState[filePath] = !prev[filePath];
      return newState;
    });

    setFileMenuPosition(prev => ({
      ...prev,
      [filePath]: {
        top: rect.bottom + 4,
        left: rect.left - 180 // Menu width ~200px, offset left
      }
    }));
  };

  // Close menu on outside click
  React.useEffect(() => {
    const handleClickOutside = () => {
      setFileMenuOpen({});
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  return (
    <>
      <div className="presented-files-card">
        {Object.entries(groupedFiles).map(([description, filePaths], groupIndex) => (
          <div key={groupIndex} className="presented-files-group">
            {/* Header: icon + description */}
            <div className="presented-files-header">
              <Package size={18} className="presented-files-icon" />
              <span className="presented-files-description">{description}</span>
            </div>

            {/* File list - reuses file-attachment styles */}
            <div className="file-attachments-list">
              {filePaths.map((filePath, index) => {
                const fileName = getFileName(filePath);
                return (
                  <div
                    key={index}
                    className="file-attachment-item clickable"
                    onClick={() => handleOpenFile(filePath)}
                    title={`Click to open: ${filePath}`}
                  >
                    <span className="file-attachment-icon">
                      <FileTypeIcon fileName={fileName} size={24} />
                    </span>
                    <span className="file-attachment-name" title={filePath}>
                      {fileName}
                    </span>
                    <button
                      className="file-attachment-menu-trigger"
                      onClick={(e) => handleFileMenuToggle(filePath, e)}
                      title="More options"
                    >
                      <MoreHorizontal size={16} strokeWidth={2} />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Render menu using Portal to body */}
      {Object.entries(fileMenuOpen).map(([filePath, isOpen]) => {
        if (!isOpen) return null;
        const menuPos = fileMenuPosition[filePath];
        if (!menuPos) return null;

        return ReactDOM.createPortal(
          <div
            key={filePath}
            className="file-attachment-menu"
            style={{
              top: `${menuPos.top}px`,
              left: `${menuPos.left}px`
            }}
          >
            <button
              className="file-attachment-menu-item"
              onClick={() => { setFileMenuOpen({}); handleOpenFile(filePath); }}
            >
              <span className="file-attachment-menu-item-icon">
                <Eye size={16} strokeWidth={2} />
              </span>
              <span className="file-attachment-menu-item-text">Preview file</span>
            </button>
            <button
              className="file-attachment-menu-item"
              onClick={() => { setFileMenuOpen({}); handleOpenWithDefaultApp(filePath); }}
            >
              <span className="file-attachment-menu-item-icon">
                <FolderOpen size={16} strokeWidth={2} />
              </span>
              <span className="file-attachment-menu-item-text">Open file with default app</span>
            </button>
            <button
              className="file-attachment-menu-item"
              onClick={() => { setFileMenuOpen({}); handleShowInFolder(filePath); }}
            >
              <span className="file-attachment-menu-item-icon">
                <Folder size={16} strokeWidth={2} />
              </span>
              <span className="file-attachment-menu-item-text">Open file in folder</span>
            </button>
            {isSkillFile(filePath) && (
              <button
                className="file-attachment-menu-item"
                onClick={() => { setFileMenuOpen({}); handleInstallSkill(filePath); }}
              >
                <span className="file-attachment-menu-item-icon">
                  <Download size={16} strokeWidth={2} />
                </span>
                <span className="file-attachment-menu-item-text">Install skill</span>
              </button>
            )}
          </div>,
          document.body
        );
      })}

      {ReactDOM.createPortal(
        <ApplySkillToAgentsDialog
          open={applyDialogOpen}
          onOpenChange={setApplyDialogOpen}
          skillName={applySkillName}
        />,
        document.body
      )}
    </>
  );
};

export default PresentedFilesCard;
