import React, { useEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { Package, MoreHorizontal, FolderOpen, Folder, Eye, Download, BookPlus, Copy } from 'lucide-react';

import FileTypeIcon from '../../ui/FileTypeIcon';
import { useToast } from '../../ui/ToastProvider';
import { useAgentConfig } from '../../userData/userDataProvider';
import { moveFileToKnowledgeBase, shouldShowMoveToKnowledgeBaseOption } from '../../../lib/chat/moveToKnowledgeBase';
import { useCurrentChatId, CurrentSessionIdle } from '../../../lib/chat/agentChatSessionCacheManager';
import { isInstallableSkillArtifact } from '../../../lib/skills/installableSkillArtifacts';
import { createLogger } from '../../../lib/utilities/logger';
import { ApplySkillDialogAtom } from '../../skills/ApplySkillToAgentsDialog';
const logger = createLogger('[GeneratedFileCards]');

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg', 'ico', 'tiff', 'tif', 'avif']);

export interface GeneratedFileCardItem {
  filePath: string;
  groupLabel?: string;
  exists?: boolean;
}

export interface PresentedFile {
  filePath: string;
  description: string;
}

export interface GeneratedFileCardsProps {
  items: GeneratedFileCardItem[];
}

export function normalizePresentedFilesToGeneratedFileItems(files: PresentedFile[]): GeneratedFileCardItem[] {
  return files.flatMap((file) => {
    try {
      const parsed = JSON.parse(file.filePath);
      if (Array.isArray(parsed)) {
        return parsed.map((filePath: string) => ({
          filePath: typeof filePath === 'string' ? filePath.trim() : filePath,
          groupLabel: file.description || 'Final deliverables',
        }));
      }
    } catch {
      // Fall through to single-path handling.
    }

    return [{
      filePath: file.filePath.trim(),
      groupLabel: file.description || 'Final deliverables',
    }];
  });
}

function getFileName(filePath: string): string {
  if (filePath.includes('/')) {
    return filePath.split('/').pop() || filePath;
  }
  if (filePath.includes('\\')) {
    return filePath.split('\\').pop() || filePath;
  }
  return filePath;
}

function isImageFile(filePath: string): boolean {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  return IMAGE_EXTENSIONS.has(ext);
}

function previewGeneratedFile(filePath: string): void {
  const fileName = getFileName(filePath);
  if (isImageFile(filePath)) {
    window.dispatchEvent(
      new CustomEvent('imageViewer:open', {
        detail: {
          images: [{ id: `generated-file-${filePath}`, url: filePath, alt: fileName }],
          initialIndex: 0,
        },
      }),
    );
    return;
  }

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

export const GeneratedFileCards: React.FC<GeneratedFileCardsProps> = ({ items }) => {
  const [fileMenuOpen, setFileMenuOpen] = useState<Record<string, boolean>>({});
  const [fileMenuPosition, setFileMenuPosition] = useState<Record<string, { top: number; left: number }>>({});
  const [fileExistsCache, setFileExistsCache] = useState<Record<string, boolean>>(() => {
    const initialState: Record<string, boolean> = {};
    items.forEach((item) => {
      if (typeof item.exists === 'boolean') {
        initialState[item.filePath] = item.exists;
      }
    });
    return initialState;
  });

  const checkedPathsRef = useRef<Set<string>>(new Set());
  const isMountedRef = useRef(true);
  useEffect(() => () => { isMountedRef.current = false; }, []);
  const { showToast } = useToast();
  const { agent: currentAgent } = useAgentConfig();
  const currentChatId = useCurrentChatId();

  const allFilePaths = useMemo(() => items.map(item => item.filePath), [items]);
  const allFilePathsKey = useMemo(() => allFilePaths.join('\0'), [allFilePaths]);
  const installSkillActions = ApplySkillDialogAtom.useChange();

  const groupedItems = useMemo(() => {
    const groups = new Map<string, GeneratedFileCardItem[]>();

    items.forEach((item) => {
      const key = item.groupLabel?.trim() || '';
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(item);
    });

    return Array.from(groups.entries()).map(([label, groupItems]) => ({
      label,
      items: groupItems,
    }));
  }, [items]);

  const hasGroupHeaders = groupedItems.some(group => group.label);
  const isSessionIdle = CurrentSessionIdle.use();

  useEffect(() => {
    const initialState: Record<string, boolean> = {};
    items.forEach((item) => {
      if (typeof item.exists === 'boolean') {
        initialState[item.filePath] = item.exists;
      }
    });
    setFileExistsCache(prev => ({ ...prev, ...initialState }));
  }, [items]);

  useEffect(() => {
    if (allFilePaths.length === 0) {
      return;
    }

    const uncheckedPaths = allFilePaths.filter(filePath => !checkedPathsRef.current.has(filePath));
    if (uncheckedPaths.length === 0) {
      return;
    }

    uncheckedPaths.forEach(filePath => checkedPathsRef.current.add(filePath));

    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    (async () => {
      const results: Record<string, boolean> = {};
      await Promise.all(
        uncheckedPaths.map(async (filePath) => {
          try {
            if (window.electronAPI?.fs?.exists) {
              results[filePath] = await window.electronAPI.fs.exists(filePath);
            } else if (typeof fileExistsCache[filePath] === 'boolean') {
              results[filePath] = fileExistsCache[filePath];
            } else {
              results[filePath] = false;
            }
          } catch {
            results[filePath] = typeof fileExistsCache[filePath] === 'boolean' ? fileExistsCache[filePath] : false;
          }
        }),
      );

      if (!isMountedRef.current) {
        return;
      }
      setFileExistsCache(prev => ({ ...prev, ...results }));

      const missingPaths = Object.entries(results)
        .filter(([_, exists]) => !exists)
        .map(([filePath]) => filePath);

      if (missingPaths.length > 0) {
        retryTimer = setTimeout(async () => {
          const retryResults: Record<string, boolean> = {};
          await Promise.all(
            missingPaths.map(async (filePath) => {
              try {
                if (window.electronAPI?.fs?.exists) {
                  retryResults[filePath] = await window.electronAPI.fs.exists(filePath);
                }
              } catch {
                // Ignore retry failures.
              }
            }),
          );

          if (isMountedRef.current && Object.keys(retryResults).length > 0) {
            setFileExistsCache(prev => ({ ...prev, ...retryResults }));
          }
        }, 2000);
      }
    })();

    return () => {
      if (retryTimer) {
        clearTimeout(retryTimer);
      }
    };
    // Depend only on the stable string key. allFilePaths reference changes every
    // parent render, and including fileExistsCache would re-trigger this effect
    // on every check result, causing cleanup-races that discarded async results
    // before they could write to the cache.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allFilePathsKey]);

  useEffect(() => {
    const handleClickOutside = () => {
      setFileMenuOpen({});
    };

    if (Object.values(fileMenuOpen).some(Boolean)) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [fileMenuOpen]);

  if (items.length === 0) {
    return null;
  }

  const handleFileMenuToggle = (filePath: string, event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();

    const rect = event.currentTarget.getBoundingClientRect();
    const isCurrentlyOpen = fileMenuOpen[filePath];

    setFileMenuOpen({ [filePath]: !isCurrentlyOpen });

    if (!isCurrentlyOpen) {
      setFileMenuPosition(prev => ({
        ...prev,
        [filePath]: {
          top: rect.bottom + 4,
          left: hasGroupHeaders ? rect.left - 180 : rect.left,
        },
      }));
    }
  };

  const handleOpenWithDefaultApp = async (filePath: string) => {
    try {
      const result = await window.electronAPI?.workspace?.openPath(filePath);
      if (result?.success) {
        setFileMenuOpen({});
      } else {
        showToast(result?.error || 'Unable to open file', 'error');
      }
    } catch (error) {
      logger.error('[GeneratedFileCards] Failed to open file:', error);
      showToast('Unable to open file', 'error');
    }
  };

  const handleShowInFolder = async (filePath: string) => {
    try {
      const result = await window.electronAPI?.workspace?.showInFolder(filePath);
      if (result?.success) {
        setFileMenuOpen({});
      } else {
        showToast(result?.error || 'Unable to open folder', 'error');
      }
    } catch (error) {
      logger.error('[GeneratedFileCards] Failed to show in folder:', error);
      showToast('Unable to open folder', 'error');
    }
  };

  const handleAddToKnowledge = async (filePath: string) => {
    try {
      setFileMenuOpen({});
      const knowledgeBasePath = currentAgent?.knowledge?.knowledgeBase ?? currentAgent?.knowledgeBase;
      if (!knowledgeBasePath) {
        showToast('Current agent has no knowledge base configured', 'error');
        return;
      }

      const result = await moveFileToKnowledgeBase(filePath, knowledgeBasePath);
      if (result?.success) {
        showToast('File moved to knowledge base', 'success', 5000, {
          actions: [
            {
              label: 'Open Knowledge Base',
              onClick: async () => {
                try {
                  const openResult = await window.electronAPI?.workspace?.openPath(knowledgeBasePath);
                  if (!openResult?.success) {
                    showToast(openResult?.error || 'Unable to open knowledge base', 'error');
                  }
                } catch (error) {
                  logger.error('[GeneratedFileCards] Failed to open knowledge base:', error);
                  showToast('Unable to open knowledge base', 'error');
                }
              },
              variant: 'primary',
            },
          ],
        });
      } else if (result?.error !== 'User cancelled replacement') {
        showToast(result?.error || 'Failed to move file to knowledge base', 'error');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      showToast(`Failed to move to knowledge base: ${errorMessage}`, 'error');
    }
  };

  const handleInstallSkill = async (filePath: string) => {
    try {
      if (!window.electronAPI?.skillLibrary?.installSkillFromFilePath) {
        showToast('Install skill API not available', 'error');
        return;
      }

      const result = await window.electronAPI.skillLibrary.installSkillFromFilePath(filePath, {
        chatId: currentChatId || undefined,
        applyToCurrentAgent: !!currentChatId,
        requestSource: 'generated-file',
      });

      if (result.success) {
        showToast(result.message || `Skill "${result.skillName}" installed successfully`, 'success');

        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('skills:refreshFolderExplorer', {
            detail: { skillName: result.skillName },
          }));
        }, 600);

        if (result.skillName && result.resolution === 'installed_but_needs_target_selection') {
          installSkillActions.setSkill(result.skillName);
        }
      } else if (result.error && result.error !== 'User cancelled the operation') {
        showToast(result.error, 'error', undefined, { persistent: true });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      showToast(`Failed to install skill: ${errorMessage}`, 'error');
    }
  };

  const renderGeneratedFileItem = (item: GeneratedFileCardItem, index: number) => {
    const filePath = item.filePath;
    const fileName = getFileName(filePath);
    const fileExists = fileExistsCache[filePath] ?? item.exists ?? true;
    const isAvailable = fileExists;
    const responsiveCardStyle: React.CSSProperties = {
      width: 'min(100%, 400px)',
      maxWidth: '100%',
      minWidth: 0,
    };

    return (
      <div
        key={`${filePath}-${index}`}
        className={`file-attachment-item ${isAvailable ? 'clickable' : 'deleted'}`}
        onClick={() => isAvailable && previewGeneratedFile(filePath)}
        title={!fileExists ? `File deleted: ${filePath}` : `Click to open: ${filePath}`}
        style={
          !isAvailable
            ? { ...responsiveCardStyle, opacity: 0.6, cursor: 'not-allowed' }
            : responsiveCardStyle
        }
      >
        <span className="file-attachment-icon">
          <FileTypeIcon fileName={fileName} size={24} />
        </span>
        <span className="file-attachment-name" title={filePath}>
          {fileName}
        </span>
        {!fileExists && (
          <span className="file-attachment-deleted-badge" style={{
            marginLeft: '6px',
            fontSize: '11px',
            color: '#ef4444',
            backgroundColor: 'rgba(239, 68, 68, 0.1)',
            padding: '1px 6px',
            borderRadius: '4px',
            fontWeight: 500,
          }}>
            deleted
          </span>
        )}
        {isAvailable && (
          <button
            className="file-attachment-menu-trigger"
            onClick={(event) => handleFileMenuToggle(filePath, event)}
            title="More options"
          >
            <MoreHorizontal size={16} strokeWidth={2} />
          </button>
        )}
      </div>
    );
  };

  return (
    <>
      <div className={hasGroupHeaders ? 'presented-files-card' : 'message-file-attachments'}>
        {groupedItems.map((group, groupIndex) => (
          <div key={`${group.label || 'default'}-${groupIndex}`} className={hasGroupHeaders ? 'presented-files-group' : undefined}>
            {group.label && (
              <div className="presented-files-header">
                <Package size={18} className="presented-files-icon" />
                <span className="presented-files-description">{group.label}</span>
              </div>
            )}

            <div className="file-attachments-list">
              {group.items.map(renderGeneratedFileItem)}
            </div>
          </div>
        ))}
      </div>

      {Object.entries(fileMenuOpen).map(([filePath, isOpen]) => {
        if (!isOpen || fileExistsCache[filePath] === false) {
          return null;
        }

        const menuPos = fileMenuPosition[filePath];
        if (!menuPos) {
          return null;
        }

        return ReactDOM.createPortal(
          <div
            key={filePath}
            className="file-attachment-menu"
            style={{
              top: `${menuPos.top}px`,
              left: `${menuPos.left}px`,
            }}
          >
            <button
              className="file-attachment-menu-item"
              onClick={() => {
                setFileMenuOpen({});
                previewGeneratedFile(filePath);
              }}
            >
              <span className="file-attachment-menu-item-icon">
                <Eye size={16} strokeWidth={2} />
              </span>
              <span className="file-attachment-menu-item-text">Preview file</span>
            </button>
            <button
              className="file-attachment-menu-item"
              onClick={() => handleOpenWithDefaultApp(filePath)}
            >
              <span className="file-attachment-menu-item-icon">
                <FolderOpen size={16} strokeWidth={2} />
              </span>
              <span className="file-attachment-menu-item-text">Open file with default app</span>
            </button>
            <button
              className="file-attachment-menu-item"
              onClick={() => handleShowInFolder(filePath)}
            >
              <span className="file-attachment-menu-item-icon">
                <Folder size={16} strokeWidth={2} />
              </span>
              <span className="file-attachment-menu-item-text">Open file in folder</span>
            </button>
            <button
              className="file-attachment-menu-item"
              onClick={() => {
                navigator.clipboard.writeText(filePath);
                setFileMenuOpen({});
              }}
            >
              <span className="file-attachment-menu-item-icon">
                <Copy size={16} strokeWidth={2} />
              </span>
              <span className="file-attachment-menu-item-text">Copy file path</span>
            </button>
            {isInstallableSkillArtifact(filePath) && (
              <button
                className="file-attachment-menu-item"
                onClick={() => {
                  setFileMenuOpen({});
                  handleInstallSkill(filePath);
                }}
              >
                <span className="file-attachment-menu-item-icon">
                  <Download size={16} strokeWidth={2} />
                </span>
                <span className="file-attachment-menu-item-text">Install skill</span>
              </button>
            )}
            {shouldShowMoveToKnowledgeBaseOption(filePath, currentAgent?.knowledge?.knowledgeBase ?? currentAgent?.knowledgeBase, isSessionIdle) && (
              <button
                className="file-attachment-menu-item"
                onClick={() => handleAddToKnowledge(filePath)}
              >
                <span className="file-attachment-menu-item-icon">
                  <BookPlus size={16} strokeWidth={2} />
                </span>
                <span className="file-attachment-menu-item-text">Move to Knowledge Base</span>
              </button>
            )}
          </div>,
          document.body,
        );
      })}
    </>
  );
};

export default GeneratedFileCards;