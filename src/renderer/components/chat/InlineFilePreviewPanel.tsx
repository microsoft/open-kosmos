/**
 * InlineFilePreviewPanel — Inline file preview panel for chat view
 *
 * Renders as a flex sibling of .chat-content inside .chat-content-wrapper,
 * splitting the horizontal space 50/50 so the user can read a file while
 * continuing to chat.
 *
 * Supports: Markdown (rendered), code (Monaco), JSON, HTML, PDF, text.
 * Read-only previews use the shared OverlayFileViewer content renderer; local
 * text-like files can still enter inline edit mode.
 */

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  X,
  ArrowLeft,
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
  Download,
  ExternalLink,
  Pencil,
  Save,
  LogOut,
  Monitor,
  Minimize,
} from 'lucide-react';
import { isInstallableSkillArtifact } from '../../lib/skills/installableSkillArtifacts';
import type * as monaco from 'monaco-editor';
import FileContentRenderer, {
  classifyFileContent,
  getFileExtension,
  getMonacoLanguage,
  isTextFileContentCategory,
  type FileContentCategory,
  type FileContentViewMode,
} from '../ui/FileContentRenderer';
import { useToast } from '../ui/ToastProvider';
import { useI18n } from '../../lib/i18n/useI18n';
import '../../styles/InlineFilePreviewPanel.css';
import { createLogger } from '../../lib/utilities/logger';
import { formatFileSize, getLocalPath, isLocalFile } from '../ui/fileViewerMetadata';
const logger = createLogger('[InlineFilePreviewPanel]');

// ============================================================
// Types (reuse the same descriptor shape as OverlayFileViewer)
// ============================================================

export interface InlineFileDescriptor {
  name: string;
  url: string;
  mimeType?: string;
  size?: number;
  lastModified?: string;
}

export interface InlineFilePreviewPanelProps {
  file: InlineFileDescriptor | null;
  isOpen: boolean;
  onClose: () => void;
  /**
   * Optional back affordance. When provided, a left-arrow button renders at the
   * start of the header and returns to the workspace file tree (instead of
   * destroying the sidepane). Used only for tree-origin previews.
   */
  onBack?: () => void;
  onDirtyStateChange?: (isDirty: boolean) => void;
  onInstallSkill?: (filePath: string) => void;
  style?: React.CSSProperties;
}

// ============================================================
// Helpers
// ============================================================

function getFileIcon(category: FileContentCategory) {
  switch (category) {
    case 'code': return <Code size={16} />;
    case 'text': return <FileText size={16} />;
    case 'json': return <Braces size={16} />;
    case 'markdown': return <BookOpen size={16} />;
    case 'html': return <Globe size={16} />;
    case 'pdf': return <FileType size={16} />;
    case 'office': return <FileSpreadsheet size={16} />;
    default: return <File size={16} />;
  }
}

// ============================================================
// Component
// ============================================================

export const InlineFilePreviewPanel: React.FC<InlineFilePreviewPanelProps> = ({
  file,
  isOpen,
  onClose,
  onBack,
  onDirtyStateChange,
  onInstallSkill,
  style,
}) => {
  const { showSuccess, showError } = useToast();
  const { t } = useI18n();
  const tRef = useRef(t);

  useEffect(() => {
    tRef.current = t;
  }, [t]);

  const [textContent, setTextContent] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<FileContentViewMode>('render');
  const [isContentReady, setIsContentReady] = useState(false);
  const [fileSize, setFileSize] = useState<number | undefined>(undefined);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [isEditorLoading, setIsEditorLoading] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const loadedFileKeyRef = useRef<string | null>(null);
  const monacoEditorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoContainerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const savedContentRef = useRef<string>('');

  const fileKey = file ? `${file.name}|${file.url}` : null;
  const category: FileContentCategory = file ? classifyFileContent(file) : 'other';
  const isEditable = useMemo(() => {
    if (!file) return false;
    if (!isLocalFile(file.url)) return false;
    return isTextFileContentCategory(category);
  }, [file, category]);

  useEffect(() => {
    onDirtyStateChange?.(isDirty);
  }, [isDirty, onDirtyStateChange]);

  // Load file content
  useEffect(() => {
    if (!isOpen || !file) {
      setTextContent(null); setLoadError(null); setIsContentReady(false);
      setIsEditing(false); setIsDirty(false); setSaveError(null);
      loadedFileKeyRef.current = null;
      if (monacoEditorRef.current) {
        monacoEditorRef.current.dispose();
        monacoEditorRef.current = null;
      }
      return;
    }

    let cancelled = false;
    loadedFileKeyRef.current = null;
    setTextContent(null); setLoadError(null); setIsContentReady(false);
    setFileSize(file.size);
    setViewMode('render');
    setIsEditing(false);
    setIsDirty(false);
    setSaveError(null);

    if (!isTextFileContentCategory(category)) {
      setIsLoading(false); setIsContentReady(true); loadedFileKeyRef.current = fileKey;
      return;
    }

    setIsLoading(true);
    if (isLocalFile(file.url)) {
      const localPath = getLocalPath(file.url);
      (async () => {
        try {
          const stat = await window.electronAPI?.fs?.stat(localPath);
          if (cancelled) return;
          if (stat?.success && stat.stats?.size !== undefined) setFileSize(stat.stats.size);
          if (!stat?.success) { setLoadError(tRef.current('viewer.file.fileNotFound', { path: localPath })); setIsLoading(false); return; }
          const result = await window.electronAPI?.fs?.readFile(localPath, 'utf-8');
          if (cancelled) return;
          if (result?.success && result.content !== undefined) {
            setTextContent(result.content); loadedFileKeyRef.current = fileKey;
          } else {
            setLoadError(result?.error || tRef.current('viewer.file.failedToLoadFile'));
          }
          setIsLoading(false);
        } catch {
          if (!cancelled) { setLoadError(tRef.current('viewer.file.cannotRead', { path: localPath })); setIsLoading(false); }
        }
      })();
    } else {
      fetch(file.url)
        .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); })
        .then(text => { if (!cancelled) { setTextContent(text); loadedFileKeyRef.current = fileKey; setIsLoading(false); } })
        .catch(() => { if (!cancelled) { setLoadError(tRef.current('viewer.file.failedToLoadFile')); setIsLoading(false); } });
    }
    return () => { cancelled = true; };
  }, [isOpen, file, category, fileKey]);

  // Auto-refresh: poll file mtime and re-read when changed on disk
  const lastMtimeRef = useRef<number | null>(null);
  useEffect(() => {
    if (!isOpen || !file || !isLocalFile(file.url) || isEditing) {
      lastMtimeRef.current = null;
      return;
    }
    if (!isTextFileContentCategory(category)) return;

    const localPath = getLocalPath(file.url);

    // Seed the initial mtime from the already-loaded file
    (async () => {
      try {
        const stat = await window.electronAPI?.fs?.stat(localPath);
        if (stat?.success && stat.stats?.mtime) {
          lastMtimeRef.current = stat.stats.mtime;
        }
      } catch { /* ignore */ }
    })();

    const interval = setInterval(async () => {
      try {
        const stat = await window.electronAPI?.fs?.stat(localPath);
        if (!stat?.success || !stat.stats?.mtime) return;
        const mtime = stat.stats.mtime;
        if (lastMtimeRef.current !== null && mtime !== lastMtimeRef.current) {
          // File changed on disk — re-read
          const result = await window.electronAPI?.fs?.readFile(localPath, 'utf-8');
          if (result?.success && result.content !== undefined) {
            setTextContent(result.content);
            if (stat.stats.size !== undefined) setFileSize(stat.stats.size);
          }
        }
        lastMtimeRef.current = mtime;
      } catch { /* ignore */ }
    }, 1000);

    return () => clearInterval(interval);
  }, [isOpen, file, category, isEditing]);

  useEffect(() => {
    if (!isLoading && textContent !== null && !loadError) {
      const t = setTimeout(() => setIsContentReady(true), 30);
      return () => clearTimeout(t);
    }
  }, [isLoading, textContent, loadError]);

  useEffect(() => {
    if (!isEditing || !monacoContainerRef.current || textContent === null) return;

    savedContentRef.current = textContent;

    const ext = file ? getFileExtension(file.name) : '';
    const language = getMonacoLanguage(ext);

    let destroyed = false;
    let disposableRef: { dispose: () => void } | null = null;

    setIsEditorLoading(true);

    import(/* webpackChunkName: "monaco-editor" */ 'monaco-editor').then((mod) => {
      if (destroyed || !monacoContainerRef.current) return;

      const editor = mod.editor.create(monacoContainerRef.current, {
        value: textContent,
        language,
        theme: 'vs-dark',
        automaticLayout: true,
        minimap: { enabled: false },
        fontSize: 15,
        fontFamily: "'Menlo','Monaco','Courier New',monospace",
        lineHeight: 23,
        padding: { top: 12, bottom: 12 },
        scrollBeyondLastLine: false,
        wordWrap: 'off',
        tabSize: 2,
        insertSpaces: true,
        renderWhitespace: 'none',
        overviewRulerLanes: 0,
        hideCursorInOverviewRuler: true,
        overviewRulerBorder: false,
        scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
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
      disposableRef = editor.onDidChangeModelContent(() => {
        setIsDirty(editor.getValue() !== savedContentRef.current);
      });
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
  }, [isEditing, textContent, file]);

  const confirmDiscardChanges = useCallback(() => {
    if (!isDirty) return true;
    return window.confirm(t('viewer.file.discardUnsavedConfirm'));
  }, [isDirty, t]);

  const handleEdit = useCallback(() => {
    if (!isEditable || textContent === null) return;
    setIsDirty(false);
    setIsEditing(true);
    setSaveError(null);
  }, [isEditable, textContent]);

  const handleCancelEdit = useCallback(() => {
    if (!confirmDiscardChanges()) return;
    if (monacoEditorRef.current) {
      monacoEditorRef.current.dispose();
      monacoEditorRef.current = null;
    }
    setIsEditing(false);
    setIsDirty(false);
    setSaveError(null);
  }, [confirmDiscardChanges]);

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
    } catch {
      showError(t('viewer.file.saveFailed'));
      setSaveError(t('viewer.file.saveFailed'));
    } finally {
      setIsSaving(false);
    }
  }, [file, isEditable, isDirty, showError, showSuccess, t]);

  const handleDownload = useCallback(() => {
    if (!file) return;
    try {
      if (isLocalFile(file.url)) {
        const localPath = getLocalPath(file.url);
        window.electronAPI?.workspace?.showInFolder(localPath);
      } else {
        const link = document.createElement('a');
        link.href = file.url; link.download = file.name;
        document.body.appendChild(link); link.click(); document.body.removeChild(link);
      }
    } catch (error) {
      logger.error('Failed to download file:', error);
    }
  }, [file]);

  const handleOpenExternal = useCallback(() => {
    if (!file) return;
    if (isLocalFile(file.url)) {
      window.electronAPI?.workspace?.openPath(getLocalPath(file.url));
    } else {
      window.open(file.url, '_blank');
    }
  }, [file]);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement === contentRef.current) {
        await document.exitFullscreen();
      } else if (contentRef.current?.requestFullscreen) {
        await contentRef.current.requestFullscreen();
      }
    } catch (error) {
      logger.error('[InlineFilePreviewPanel] Failed to toggle fullscreen:', error);
    }
  }, []);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const handleClose = useCallback(() => {
    if (!confirmDiscardChanges()) return;
    onClose();
  }, [confirmDiscardChanges, onClose]);

  const handleBack = useCallback(() => {
    if (!onBack) return;
    if (!confirmDiscardChanges()) return;
    onBack();
  }, [confirmDiscardChanges, onBack]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isEditing) {
          handleCancelEdit();
        } else {
          handleClose();
        }
      }

      if (isEditing && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void handleSave();
      }

      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        void toggleFullscreen();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isEditing, handleCancelEdit, handleClose, handleSave, toggleFullscreen]);

  if (!isOpen || !file) return null;

  const ext = getFileExtension(file.name);

  const renderBody = () => {
    const isNonText = category === 'pdf' || category === 'office' || category === 'other';

    if (loadError) {
      return <div className="inline-preview-error"><AlertTriangle size={32} /><p>{loadError}</p></div>;
    }

    if (!isNonText && (isLoading || !isContentReady || loadedFileKeyRef.current !== fileKey)) {
      return <div className="inline-preview-loading"><div className="inline-preview-spinner" /><span>{t('viewer.inline.loading')}</span></div>;
    }

    if (isEditing) {
      return (
        <div className="inline-preview-edit-wrapper">
          {isEditorLoading && <div className="inline-preview-loading"><div className="inline-preview-spinner" /><span>{t('viewer.loadingEditor')}</span></div>}
          {saveError && (
            <div className="inline-preview-save-error">
              <AlertTriangle size={14} />
              <span>{saveError}</span>
            </div>
          )}
          <div ref={monacoContainerRef} className="inline-preview-monaco-container" />
        </div>
      );
    }

    switch (category) {
      case 'json':
      case 'markdown':
      case 'code':
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

      case 'pdf': {
        const src = isLocalFile(file.url) ? `file://${getLocalPath(file.url)}` : file.url;
        return <iframe className="inline-preview-iframe" src={`${src}#view=FitH`} title={file.name} />;
      }

      case 'office':
      case 'other':
      default:
        return (
          <div className="inline-preview-fallback">
            <FileIcon size={40} />
            <p>{t('viewer.file.inlineUnsupported')}</p>
            <button className="inline-preview-open-btn" onClick={handleOpenExternal}>{t('viewer.file.openDefaultApp')}</button>
          </div>
        );
    }
  };

  return (
    <div className={`inline-file-preview-panel${isFullscreen ? ' inline-preview-fullscreen' : ''}`} ref={contentRef} style={style}>
      {/* Header */}
      <div className="inline-preview-header">
        <div className="inline-preview-file-info">
          {onBack && (
            <button className="inline-preview-btn inline-preview-back" onClick={handleBack} title={t('viewer.file.backToFiles')}>
              <ArrowLeft size={16} />
            </button>
          )}
          <span className="inline-preview-icon">{getFileIcon(category)}</span>
          <div className="inline-preview-title-block">
            <span className="inline-preview-filename" title={file.name}>{file.name}</span>
            <span className="inline-preview-meta">
              {ext.toUpperCase() || t('viewer.file.fileLabel')}
              {fileSize !== undefined ? ` · ${formatFileSize(fileSize)}` : ''}
              {file.lastModified ? ` · ${file.lastModified}` : ''}
              <span className={`inline-preview-mode-badge ${isEditing ? 'inline-preview-mode-edit' : 'inline-preview-mode-preview'}`}>
                {isEditing ? t('viewer.file.editMode') : t('viewer.file.previewMode')}
              </span>
            </span>
          </div>
        </div>
        <div className="inline-preview-actions">
          {isEditing ? (
            <>
              <button className={`inline-preview-btn ${isDirty ? 'inline-preview-btn-dirty' : ''}`} onClick={handleSave} disabled={isSaving || !isDirty} title={isDirty ? t('viewer.file.saveCtrlShortcut') : t('viewer.file.noChanges')}>
                <Save size={16} />
              </button>
              <button className="inline-preview-btn" onClick={handleCancelEdit} disabled={isSaving} title={t('viewer.file.exitEditMode')}>
                <LogOut size={16} />
              </button>
            </>
          ) : (
            <>
              {(category === 'html' || category === 'markdown') && (
                <button className="inline-preview-btn" onClick={() => setViewMode(v => v === 'render' ? 'source' : 'render')}
                  title={viewMode === 'render' ? t('viewer.file.viewSource') : t('viewer.file.viewRenderedTitle')}>
                  {viewMode === 'render' ? <Code size={16} /> : <Eye size={16} />}
                </button>
              )}
              {isEditable && (
                <button className="inline-preview-btn" onClick={handleEdit} title={t('common.edit')}>
                  <Pencil size={16} />
                </button>
              )}
              <button className="inline-preview-btn" onClick={handleOpenExternal} title={t('viewer.file.openExternally')}>
                <ExternalLink size={16} />
              </button>
              <button className="inline-preview-btn" onClick={handleDownload} title={t('viewer.file.showInFolder')}>
                <Download size={16} />
              </button>
              {onInstallSkill && isLocalFile(file.url) && isInstallableSkillArtifact(getLocalPath(file.url)) && (
                <button className="inline-preview-btn inline-preview-btn-install" onClick={() => onInstallSkill(getLocalPath(file.url))} title={t('viewer.file.installSkill')}>
                  <Download size={16} />
                </button>
              )}
              <button className="inline-preview-btn" onClick={() => { void toggleFullscreen(); }} title={isFullscreen ? t('viewer.file.exitFullscreenCtrlShortcut') : t('viewer.file.fullscreenCtrlShortcut')}>
                {isFullscreen ? <Minimize size={16} /> : <Monitor size={16} />}
              </button>
            </>
          )}
          <button className="inline-preview-btn inline-preview-close" onClick={handleClose} title={t('viewer.file.closePreview')}>
            <X size={16} />
          </button>
        </div>
      </div>
      {/* Body */}
      <div className="inline-preview-body">
        {renderBody()}
      </div>
    </div>
  );
};

export default InlineFilePreviewPanel;
