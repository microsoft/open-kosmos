import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  X,
  Download,
  FileText,
  FileSpreadsheet,
  FileIcon,
  File,
  FileType,
  Globe,
  Code,
  Eye,
  BookOpen,
  Braces,
  AlertTriangle,
  Pencil,
  Save,
  LogOut,
  Monitor,
  Minimize,
} from 'lucide-react';
import type * as monaco from 'monaco-editor';
import { atom } from '@/atom';
import { isInstallableSkillArtifact } from '../../lib/skills/installableSkillArtifacts';
import { useToast } from './ToastProvider';
import { useI18n } from '../../lib/i18n/useI18n';
import '../../styles/OverlayFileViewer.css';
import { createLogger } from '../../lib/utilities/logger';
import FileContentRenderer, {
  classifyFileContent,
  getFileExtension,
  getMonacoLanguage,
  type FileContentCategory,
  type FileContentViewMode,
} from './FileContentRenderer';
import { formatFileSize, getLocalPath, getOfficeLabel, isLocalFile } from './fileViewerMetadata';
const logger = createLogger('[OverlayFileViewer]');
type MonacoEditorModule = typeof import('monaco-editor');

const defaultLoadMonacoEditor = () => import(/* webpackChunkName: "monaco-editor" */ 'monaco-editor');
let loadMonacoEditor: () => Promise<MonacoEditorModule> = defaultLoadMonacoEditor;

export function __setLoadMonacoEditorForTests(loader: () => Promise<MonacoEditorModule>) {
  loadMonacoEditor = loader;
}

// ============================================================
// Types
// ============================================================

/** File descriptor passed as input */
export interface OverlayFileDescriptor {
  /** File name (including extension) */
  name: string;
  /**
   * File address, supports two sources:
   * - Local file: full path (e.g. /Users/x/file.txt or C:\Users\x\file.txt) or file:// URL
   * - Remote file: http:// or https:// URL
   */
  url: string;
  /** File MIME type (optional, inferred from extension if not provided) */
  mimeType?: string;
  /** File size (bytes) */
  size?: number;
  /** Last modified time */
  lastModified?: string;
}

export interface OverlayFileViewerProps {
  /** Callback when Install Skill button is clicked for installable skill artifacts */
  onInstallSkill?: (filePath: string) => void;
}

// ============================================================
// Atom – manages open/close and file descriptor
// ============================================================

interface FileViewerState {
  isOpen: boolean;
  file: OverlayFileDescriptor | null;
}

const zeroFileViewerState: FileViewerState = {
  isOpen: false,
  file: null,
};

export const FileViewerAtom = atom(zeroFileViewerState, (_get, set) => {
  function open(file: OverlayFileDescriptor) {
    set({ isOpen: true, file });
  }

  function close() {
    set(zeroFileViewerState);
  }

  return { open, close };
});

// ============================================================
// Helpers
// ============================================================

function getFileIcon(category: FileContentCategory) {
  switch (category) {
    case 'code':
      return <Code size={20} />;
    case 'text':
      return <FileText size={20} />;
    case 'json':
      return <Braces size={20} />;
    case 'markdown':
      return <BookOpen size={20} />;
    case 'html':
      return <Globe size={20} />;
    case 'pdf':
      return <FileType size={20} />;
    case 'office':
      return <FileSpreadsheet size={20} />;
    default:
      return <File size={20} />;
  }
}

// ============================================================
// Component
// ============================================================

export const OverlayFileViewer: React.FC<OverlayFileViewerProps> = ({
  onInstallSkill,
}) => {
  const [{ isOpen, file }, actions] = FileViewerAtom.use();
  const onClose = actions.close;

  const { showSuccess, showError } = useToast();
  const { t } = useI18n();
  const tRef = useRef(t);

  useEffect(() => {
    tRef.current = t;
  }, [t]);

  // Listen for fileViewer:open custom events
  useEffect(() => {
    const handleOpenFileViewer = (event: CustomEvent) => {
      if ((window as any).__inlineFilePreviewEnabled) {
        return;
      }
      if ((event as any)._inlineHandled) return;
      const { file } = event.detail;
      actions.open(file);
    };

    window.addEventListener(
      'fileViewer:open',
      handleOpenFileViewer as EventListener,
    );

    return () => {
      window.removeEventListener(
        'fileViewer:open',
        handleOpenFileViewer as EventListener,
      );
    };
  }, []);

  const [textContent, setTextContent] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<FileContentViewMode>('render');
  const [isContentReady, setIsContentReady] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [fileSize, setFileSize] = useState<number | undefined>(undefined);
  const [isEditorLoading, setIsEditorLoading] = useState(false);
  const [editorContainerReady, setEditorContainerReady] = useState(false);
  const monacoEditorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoContainerRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  /** Baseline content for isDirty comparison (last saved value or initial value) */
  const savedContentRef = useRef<string>('');
  // Track the currently loaded file identifier for synchronous file change detection
  const loadedFileKeyRef = useRef<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // File unique identifier
  const fileKey = file ? `${file.name}|${file.url}` : null;

  // Classification
  const category: FileContentCategory = file ? classifyFileContent(file) : 'other';

  const setMonacoContainer = useCallback((node: HTMLDivElement | null) => {
    monacoContainerRef.current = node;
    setEditorContainerReady(Boolean(node));
  }, []);

  // Sync fullscreen state with browser Fullscreen API
  useEffect(() => {
    if (!isOpen) {
      setIsFullscreen(false);
      return;
    }

    const handleFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === contentRef.current);
    };

    handleFullscreenChange();
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, [isOpen]);

  // Determine if file is editable (only local text-based files are editable)
  const isEditable = useMemo(() => {
    if (!file) return false;
    if (!isLocalFile(file.url)) return false;
    return category === 'text' || category === 'code' || category === 'json' || category === 'markdown' || category === 'html';
  }, [file, category]);

  // Auto-fetch file size (when file.size is missing and file is local)
  useEffect(() => {
    if (!isOpen || !file) {
      setFileSize(undefined);
      return;
    }
    if (file.size !== undefined) {
      setFileSize(file.size);
      return;
    }
    if (isLocalFile(file.url)) {
      const localPath = getLocalPath(file.url);
      window.electronAPI?.fs?.stat(localPath).then((result) => {
        if (result.success && result.stats) {
          setFileSize(result.stats.size);
        }
      }).catch(() => {});
    }
  }, [isOpen, file]);

  // Load text content
  useEffect(() => {
    if (!isOpen || !file) {
      // Reset all state when closing, ensuring a clean state on next open
      setTextContent(null);
      setIsLoading(true);
      setLoadError(null);
      setIsContentReady(false);
      setIsEditing(false);
      setIsDirty(false);
      setSaveError(null);
      loadedFileKeyRef.current = null;
      // Destroy Monaco editor
      if (monacoEditorRef.current) {
        monacoEditorRef.current.dispose();
        monacoEditorRef.current = null;
      }
      return;
    }

    // Reset all state on open
    let cancelled = false;
    loadedFileKeyRef.current = null;
    setTextContent(null);
    setLoadError(null);
    setIsContentReady(false);
    setIsEditing(false);
    setIsDirty(false);
    setSaveError(null);

    // text / json / code / markdown / html all need text content loading
    if (category === 'text' || category === 'code' || category === 'json' || category === 'markdown' || category === 'html') {
      setIsLoading(true);
      setViewMode('render'); // Reset view mode

      if (isLocalFile(file.url)) {
        // Local file: check existence first, then read via electronAPI
        const localPath = getLocalPath(file.url);
        const doRead = async () => {
          try {
            // Check if file exists
            const statResult = await window.electronAPI?.fs?.stat(localPath);
            if (!statResult?.success) {
              if (cancelled) return;
              setLoadError(tRef.current('viewer.file.fileNotFound', { path: localPath }));
              setIsLoading(false);
              return;
            }
            // Read file content
            const result = await window.electronAPI?.fs?.readFile(localPath, 'utf-8');
            if (cancelled) return;
            if (result?.success && result.content !== undefined) {
              setTextContent(result.content);
              loadedFileKeyRef.current = fileKey;
            } else {
              setLoadError(result?.error || tRef.current('viewer.file.failedToLoadFile'));
            }
            setIsLoading(false);
          } catch (err) {
            if (cancelled) return;
            logger.error('[OverlayFileViewer] Failed to load local text:', err);
            setLoadError(tRef.current('viewer.file.cannotReadOrNotFound', { path: localPath }));
            setIsLoading(false);
          }
        };
        doRead();
      } else {
        // Non-local file (http, https, blob, data, etc.): load via fetch
        fetch(file.url)
          .then((res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.text();
          })
          .then((text) => {
            if (cancelled) return;
            setTextContent(text);
            loadedFileKeyRef.current = fileKey;
            setIsLoading(false);
          })
          .catch((err) => {
            if (cancelled) return;
            logger.error('[OverlayFileViewer] Failed to load remote text:', err);
            setLoadError(tRef.current('viewer.file.failedToLoadFile'));
            setIsLoading(false);
          });
      }
    } else {
      // Types that don't need text content loading: pdf / office / other
      setIsLoading(false);
      setIsContentReady(true);
      loadedFileKeyRef.current = fileKey;
    }

    return () => { cancelled = true; };
  }, [isOpen, file, category, fileKey]);

  // Delay rendering heavy content after loading, ensuring loading spinner is painted to screen first
  useEffect(() => {
    if (!isLoading && textContent !== null && !loadError) {
      // Use setTimeout to ensure the browser has a chance to paint the loading state
      const timerId = setTimeout(() => {
        setIsContentReady(true);
      }, 50);
      return () => clearTimeout(timerId);
    }
  }, [isLoading, textContent, loadError]);

  // Monaco Editor lifecycle management
  useEffect(() => {
    if (!isEditing || !editorContainerReady || !monacoContainerRef.current || textContent === null) return;

    // Set baseline content
    savedContentRef.current = textContent;

    // Get Monaco language ID
    const ext = file ? getFileExtension(file.name) : '';
    const monacoLang = getMonacoLanguage(ext);

    let destroyed = false;
    let disposableRef: { dispose: () => void } | null = null;

    setIsEditorLoading(true);

    loadMonacoEditor().then((monacoModule) => {
      if (destroyed || !monacoContainerRef.current) return;

      const editor = monacoModule.editor.create(monacoContainerRef.current, {
        value: textContent,
        language: monacoLang,
        theme: 'vs-dark',
        automaticLayout: true,
        minimap: { enabled: false },
        fontSize: 13,
        fontFamily: "'Menlo', 'Monaco', 'Courier New', monospace",
        lineHeight: 21,
        padding: { top: 16, bottom: 16 },
        scrollBeyondLastLine: false,
        wordWrap: 'off',
        tabSize: 2,
        insertSpaces: true,
        renderWhitespace: 'none',
        overviewRulerLanes: 0,
        hideCursorInOverviewRuler: true,
        overviewRulerBorder: false,
        scrollbar: {
          verticalScrollbarSize: 10,
          horizontalScrollbarSize: 10,
        },
        readOnly: false,
        contextmenu: true,
        quickSuggestions: false,
        parameterHints: { enabled: false },
        suggestOnTriggerCharacters: false,
        acceptSuggestionOnEnter: 'off',
        tabCompletion: 'off',
        wordBasedSuggestions: 'off',
      });

      monacoEditorRef.current = editor;

      // Listen for content changes to update isDirty
      disposableRef = editor.onDidChangeModelContent(() => {
        const currentValue = editor.getValue();
        setIsDirty(currentValue !== savedContentRef.current);
      });

      // Focus editor
      editor.focus();
      setIsEditorLoading(false);
    });

    return () => {
      destroyed = true;
      disposableRef?.dispose();
      monacoEditorRef.current?.dispose();
      monacoEditorRef.current = null;
      setIsEditorLoading(false);
    };
  }, [isEditing, editorContainerReady]);

  // Enter edit mode
  const handleEdit = useCallback(() => {
    if (!isEditable || textContent === null) return;
    setIsDirty(false);
    setIsEditing(true);
    setSaveError(null);
  }, [isEditable, textContent]);

  // Cancel editing
  const handleCancelEdit = useCallback(() => {
    if (isDirty) {
      const discard = window.confirm(
        t('viewer.file.discardUnsavedConfirm')
      );
      if (!discard) return;
    }
    // Destroy Monaco editor
    if (monacoEditorRef.current) {
      monacoEditorRef.current.dispose();
      monacoEditorRef.current = null;
    }
    setIsEditing(false);
    setIsDirty(false);
    setSaveError(null);
  }, [isDirty, t]);

  // Save edit
  const handleSave = useCallback(async () => {
    if (!file || !isEditable || !isDirty) return;
    const content = monacoEditorRef.current?.getValue() ?? '';
    setIsSaving(true);
    setSaveError(null);
    try {
      const localPath = getLocalPath(file.url);
      const result = await window.electronAPI?.fs?.writeFile(localPath, content, 'utf-8', {
        conflictResolution: 'replace',
      });
      if (result?.success) {
        setTextContent(content);
        savedContentRef.current = content;
        setIsDirty(false);
        showSuccess(t('viewer.file.saved', { name: file.name }));
      } else {
        const errorMessage = result?.error || t('viewer.file.saveFailed');
        setSaveError(errorMessage);
        showError(errorMessage);
      }
    } catch (err) {
      logger.error('[OverlayFileViewer] Failed to save file:', err);
      showError(t('viewer.file.saveFailed'));
      setSaveError(t('viewer.file.saveFailed'));
    } finally {
      setIsSaving(false);
    }
  }, [file, isEditable, isDirty, showError, showSuccess, t]);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement === contentRef.current) {
        await document.exitFullscreen();
      } else if (contentRef.current?.requestFullscreen) {
        await contentRef.current.requestFullscreen();
      }
    } catch (error) {
      logger.error('[OverlayFileViewer] Failed to toggle fullscreen:', error);
    }
  }, []);

  // Keyboard events
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (document.fullscreenElement === contentRef.current) {
          return;
        }
        if (isEditing) {
          handleCancelEdit();
        } else {
          onClose();
        }
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        void toggleFullscreen();
      }
      // Cmd/Ctrl+S to save in edit mode
      if (isEditing && (e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, isEditing, handleCancelEdit, handleSave, toggleFullscreen]);

  // Close viewer (check for unsaved changes in edit mode)
  const handleClose = useCallback(async () => {
    if (isDirty) {
      const discard = window.confirm(
        t('viewer.file.discardUnsavedConfirm')
      );
      if (!discard) return;
    }
    if (document.fullscreenElement === contentRef.current) {
      await document.exitFullscreen();
    }
    onClose();
  }, [isDirty, onClose, t]);

  // Prevent background scrolling
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  // Download / open file location
  const handleDownload = useCallback(() => {
    if (!file) return;
    try {
      if (isLocalFile(file.url)) {
        // Local file: show in Finder / Explorer
        const localPath = getLocalPath(file.url);
        window.electronAPI?.workspace?.openPath(localPath);
      } else {
        // Non-local file: trigger browser download
        const link = document.createElement('a');
        link.href = file.url;
        link.download = file.name;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
    } catch (error) {
      logger.error('Failed to download file:', error);
    }
  }, [file]);

  // Open file with system default application
  const handleOpenExternal = useCallback(() => {
    if (!file) return;
    if (isLocalFile(file.url)) {
      // Local file: open with system default application
      const localPath = getLocalPath(file.url);
      window.electronAPI?.workspace?.openPath(localPath);
    } else {
      // Non-local file: open in browser
      window.open(file.url, '_blank');
    }
  }, [file]);

  // ---- guard ----
  if (!isOpen || !file) return null;

  const ext = getFileExtension(file.name);

  // ---- Render file body ----
  const renderBody = () => {
    // Non-text file types (pdf / office / other) don't need text content loading, render directly
    const isNonTextCategory = category === 'pdf' || category === 'office' || category === 'other';

    // Load failed (check before loading state to avoid permanent spinner when file doesn't exist)
    if (loadError) {
      return (
        <div className="file-viewer-error">
          <AlertTriangle size={48} />
          <p>{loadError}</p>
          <button onClick={onClose}>{t('viewer.file.close')}</button>
        </div>
      );
    }

    // Text-based files: loading / content not ready / file has changed
    if (!isNonTextCategory && (isLoading || !isContentReady || loadedFileKeyRef.current !== fileKey)) {
      return (
        <div className="file-viewer-loading">
          <div className="loading-spinner-large">
            <div className="spinner-circle-large"></div>
          </div>
          <div className="loading-text">{t('viewer.loading')}</div>
        </div>
      );
    }

    // ---- Edit mode (Monaco Editor) ----
    if (isEditing) {
      return (
        <div className="file-viewer-edit-wrapper" style={{ position: 'relative' }}>
          {isEditorLoading && (
            <div className="file-viewer-loading">
              <div className="loading-spinner-large">
                <div className="spinner-circle-large"></div>
              </div>
              <div className="loading-text">{t('viewer.loadingEditor')}</div>
            </div>
          )}
          {saveError && (
            <div className="file-viewer-save-error">
              <AlertTriangle size={14} />
              <span>{saveError}</span>
            </div>
          )}
          <div
            ref={setMonacoContainer}
            className="file-viewer-monaco-container"
          />
        </div>
      );
    }

    switch (category) {
      // ---------- HTML Rendering ----------
      // ---------- JSON ----------
      case 'json':
      // ---------- Markdown Rendering ----------
      case 'markdown':
      // ---------- Code Files ----------
      case 'code':
      // ---------- Text ----------
      case 'text':
      case 'html':
        return (
          <FileContentRenderer
            name={file.name}
            mimeType={file.mimeType}
            content={textContent ?? ''}
            viewMode={viewMode}
          />
        );

      // ---------- PDF ----------
      case 'pdf': {
        // Local PDF uses file:// protocol, remote PDF uses URL directly
        const pdfSrc = isLocalFile(file.url)
          ? `file://${getLocalPath(file.url)}`
          : file.url;
        return (
          <iframe
            className="file-viewer-pdf-embed"
            src={`${pdfSrc}#view=FitH`}
            title={file.name}
          />
        );
      }

      // ---------- Office ----------
      case 'office': {
        // Remote Office files use Microsoft Office Online Viewer
        if (!isLocalFile(file.url)) {
          const viewerUrl = `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(file.url)}`;
          return (
            <iframe
              className="file-viewer-pdf-embed"
              src={viewerUrl}
              title={file.name}
              allowFullScreen
            />
          );
        }
        // Local Office files show metadata + open button
        return (
          <div className="file-viewer-metadata">
            <div className="file-viewer-metadata-icon">
              <FileSpreadsheet size={48} />
            </div>
            <p className="file-viewer-metadata-hint">
              {t('viewer.file.officeUnsupported', { type: getOfficeLabel(ext, t) })}
            </p>
            <table className="file-viewer-metadata-table">
              <tbody>
                <tr>
                  <td>{t('viewer.file.filename')}</td>
                  <td>{file.name}</td>
                </tr>
                <tr>
                  <td>{t('viewer.file.type')}</td>
                  <td>{getOfficeLabel(ext, t)}</td>
                </tr>
                <tr>
                  <td>{t('viewer.file.size')}</td>
                  <td>{formatFileSize(fileSize, t('viewer.file.unknown'))}</td>
                </tr>
                {file.lastModified && (
                  <tr>
                    <td>{t('viewer.file.modified')}</td>
                    <td>{file.lastModified}</td>
                  </tr>
                )}
              </tbody>
            </table>
            <button
              className="file-viewer-office-open-btn"
              onClick={handleOpenExternal}
            >
              {t('viewer.file.openDefaultApp')}
            </button>
          </div>
        );
      }

      // ---------- Other ----------
      default:
        return (
          <div className="file-viewer-metadata">
            <div className="file-viewer-metadata-icon">
              <FileIcon size={48} />
            </div>
            <p className="file-viewer-metadata-hint">
              {t('viewer.file.typeUnsupported', { type: ext.toUpperCase() || file.mimeType || t('viewer.file.unknown') })}
            </p>
            <table className="file-viewer-metadata-table">
              <tbody>
                <tr>
                  <td>{t('viewer.file.filename')}</td>
                  <td>{file.name}</td>
                </tr>
                <tr>
                  <td>{t('viewer.file.type')}</td>
                  <td>{file.mimeType || ext.toUpperCase() || t('viewer.file.unknown')}</td>
                </tr>
                <tr>
                  <td>{t('viewer.file.size')}</td>
                  <td>{formatFileSize(fileSize, t('viewer.file.unknown'))}</td>
                </tr>
                {file.lastModified && (
                  <tr>
                    <td>{t('viewer.file.modified')}</td>
                    <td>{file.lastModified}</td>
                  </tr>
                )}
              </tbody>
            </table>
            <div className="file-viewer-metadata-actions">
              <button
                className="file-viewer-office-open-btn"
                onClick={handleOpenExternal}
              >
                {t('viewer.file.openDefaultApp')}
              </button>
              {onInstallSkill && isLocalFile(file.url) && isInstallableSkillArtifact(getLocalPath(file.url)) && (
                <button
                  className="file-viewer-install-skill-btn"
                  onClick={() => onInstallSkill(getLocalPath(file.url))}
                >
                  <Download size={16} />
                  {t('viewer.file.installSkill')}
                </button>
              )}
            </div>
          </div>
        );
    }
  };

  return (
    <div className={`file-viewer-overlay${isFullscreen ? ' file-viewer-overlay-fullscreen' : ''}`}>
      {/* Content panel */}
      <div
        ref={contentRef}
        className={`file-viewer-content${isFullscreen ? ' file-viewer-content-fullscreen' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header info + action buttons */}
        <div className="file-viewer-header">
          <div className="file-viewer-icon">{getFileIcon(category)}</div>
          <div className="file-viewer-file-info">
            <div className="file-viewer-filename">{file.name}</div>
            <div className="file-viewer-file-meta">
              {ext.toUpperCase()} {fileSize !== undefined ? `· ${formatFileSize(fileSize)}` : ''}
              <span className={`file-viewer-mode-badge ${isEditing ? 'file-viewer-mode-edit' : 'file-viewer-mode-preview'}`}>
                {isEditing ? t('viewer.file.editMode') : t('viewer.file.previewMode')}
              </span>
            </div>
          </div>
          {/* Action buttons */}
          <div className="file-viewer-header-actions">
            {isEditing ? (
              /* Edit mode: save & cancel */
              <>
                <button
                  className={`file-viewer-header-btn file-viewer-save${isDirty ? ' file-viewer-save-dirty' : ''}`}
                  onClick={handleSave}
                  disabled={isSaving || !isDirty}
                  aria-label={t('viewer.file.save')}
                  title={isDirty ? t('viewer.file.saveShortcut') : t('viewer.file.noChanges')}
                >
                  <Save size={24} />
                </button>
                <button
                  className="file-viewer-header-btn"
                  onClick={handleCancelEdit}
                  disabled={isSaving}
                  aria-label={t('viewer.file.exitEditing')}
                  title={t('viewer.file.exitEditMode')}
                >
                  <LogOut size={24} />
                </button>
              </>
            ) : (
              /* View mode */
              <>
                {(category === 'html' || category === 'markdown') && (
                  <button
                    className="file-viewer-header-btn"
                    onClick={() => setViewMode(viewMode === 'render' ? 'source' : 'render')}
                    aria-label={viewMode === 'render' ? t('viewer.file.viewSourceCode') : t('viewer.file.viewRendered')}
                    title={viewMode === 'render' ? t('viewer.file.viewSource') : t('viewer.file.viewRenderedTitle')}
                  >
                    {viewMode === 'render' ? <Code size={24} /> : <Eye size={24} />}
                  </button>
                )}
                <button
                  className={`file-viewer-header-btn${isFullscreen ? ' file-viewer-header-btn-active' : ''}`}
                  onClick={() => { void toggleFullscreen(); }}
                  aria-label={isFullscreen ? t('viewer.file.exitFullscreen') : t('viewer.file.enterFullscreen')}
                  title={isFullscreen ? t('viewer.file.exitFullscreenShortcut') : t('viewer.file.fullscreenShortcut')}
                >
                  {isFullscreen ? <Minimize size={24} /> : <Monitor size={24} />}
                </button>
                {isEditable && (
                  <button
                    className="file-viewer-header-btn file-viewer-edit"
                    onClick={handleEdit}
                    aria-label={t('viewer.file.editFile')}
                    title={t('common.edit')}
                  >
                    <Pencil size={24} />
                  </button>
                )}
                <button
                  className="file-viewer-header-btn"
                  onClick={handleDownload}
                  aria-label={t('viewer.file.download')}
                  title={t('viewer.file.download')}
                >
                  <Download size={24} />
                </button>
              </>
            )}
            <button
              className="file-viewer-header-btn file-viewer-close"
              onClick={handleClose}
              aria-label={t('viewer.file.closeViewer')}
              title={t('viewer.file.close')}
            >
              <X size={24} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="file-viewer-body">{renderBody()}</div>
      </div>
    </div>
  );
};

export const __testables = {
  formatFileSize,
  getFileExtension,
  getLocalPath,
  getMonacoLanguage,
  isLocalFile,
};
