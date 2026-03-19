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
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import type * as monaco from 'monaco-editor';
import { FrontMatter, parseFrontMatter } from '../../lib/utils/yamlFrontMatter';
import '../../styles/OverlayFileViewer.css';

// ============================================================
// Types
// ============================================================

/** File type classification */
type FileCategory = 'code' | 'text' | 'json' | 'markdown' | 'html' | 'pdf' | 'office' | 'other';

/** View mode for renderable files */
type RenderViewMode = 'render' | 'source';

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
  file: OverlayFileDescriptor | null;
  isOpen: boolean;
  onClose: () => void;
  /** Callback when Install Skill button is clicked for .skill files */
  onInstallSkill?: (filePath: string) => void;
}

// ============================================================
// Helpers
// ============================================================

const HTML_EXTENSIONS = new Set(['html', 'htm']);

const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown']);

const JSON_EXTENSIONS = new Set(['json']);

/** File extension → Monaco Editor language identifier */
const MONACO_EXTENSION_LANG: Record<string, string> = {
  // Language mapping for Monaco Editor edit mode
  html: 'html', htm: 'html',
  md: 'markdown', markdown: 'markdown',
  json: 'json',
  txt: 'plaintext', csv: 'plaintext', tsv: 'plaintext',
  cfg: 'plaintext', conf: 'plaintext', env: 'plaintext', log: 'plaintext',
  gitignore: 'plaintext',
};

/** Code file extension → Prism language identifier */
const CODE_EXTENSION_LANG: Record<string, string> = {
  // Web
  js: 'javascript', jsx: 'jsx', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', tsx: 'tsx',
  css: 'css', scss: 'scss', less: 'less', sass: 'sass',
  // Python
  py: 'python',
  // Ruby
  rb: 'ruby',
  // JVM
  java: 'java', kt: 'kotlin', kts: 'kotlin', scala: 'scala', groovy: 'groovy',
  // C/C++
  c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', hxx: 'cpp',
  // C#
  cs: 'csharp',
  // Go
  go: 'go',
  // Rust
  rs: 'rust',
  // Swift / ObjC
  swift: 'swift', m: 'objectivec',
  // Shell
  sh: 'bash', bash: 'bash', zsh: 'bash', ps1: 'powershell',
  bat: 'batch', cmd: 'batch',
  // SQL
  sql: 'sql',
  // GraphQL
  graphql: 'graphql', gql: 'graphql',
  // Markup / Config
  xml: 'xml', svg: 'xml',
  yaml: 'yaml', yml: 'yaml',
  toml: 'toml',
  ini: 'ini',
  // Docker / Make
  dockerfile: 'docker',
  makefile: 'makefile',
  // PHP / Perl / Lua / R
  php: 'php',
  pl: 'perl', pm: 'perl',
  lua: 'lua',
  r: 'r',
  // Dart / Elixir / Haskell
  dart: 'dart',
  ex: 'elixir', exs: 'elixir',
  hs: 'haskell',
};

const CODE_EXTENSIONS = new Set(Object.keys(CODE_EXTENSION_LANG));

const TEXT_EXTENSIONS = new Set([
  'txt', 'csv', 'tsv',
  'cfg', 'conf', 'env', 'log',
  'gitignore',
]);

const PDF_EXTENSIONS = new Set(['pdf']);

const OFFICE_EXTENSIONS = new Set([
  'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  'odt', 'ods', 'odp',
]);

function getExtension(filename: string): string {
  const parts = filename.split('.');
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
}

function classifyFile(file: OverlayFileDescriptor): FileCategory {
  const ext = getExtension(file.name);

  // Prefer MIME type for classification
  if (file.mimeType) {
    if (file.mimeType === 'application/pdf') return 'pdf';
    if (file.mimeType === 'text/html') return 'html';
    if (file.mimeType === 'text/markdown') return 'markdown';
    if (file.mimeType === 'application/json') return 'json';
    if (file.mimeType.startsWith('text/')) return 'text';
    if (
      file.mimeType.includes('msword') ||
      file.mimeType.includes('spreadsheet') ||
      file.mimeType.includes('presentation') ||
      file.mimeType.includes('officedocument')
    )
      return 'office';
  }

  if (HTML_EXTENSIONS.has(ext)) return 'html';
  if (MARKDOWN_EXTENSIONS.has(ext)) return 'markdown';
  if (JSON_EXTENSIONS.has(ext)) return 'json';
  if (CODE_EXTENSIONS.has(ext)) return 'code';
  if (TEXT_EXTENSIONS.has(ext)) return 'text';
  if (PDF_EXTENSIONS.has(ext)) return 'pdf';
  if (OFFICE_EXTENSIONS.has(ext)) return 'office';
  return 'other';
}

function formatFileSize(bytes?: number): string {
  if (bytes === undefined || bytes === null) return 'Unknown';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function getFileIcon(category: FileCategory) {
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

function getOfficeLabel(ext: string): string {
  const map: Record<string, string> = {
    doc: 'Word Document',
    docx: 'Word Document',
    xls: 'Excel Spreadsheet',
    xlsx: 'Excel Spreadsheet',
    ppt: 'PowerPoint Presentation',
    pptx: 'PowerPoint Presentation',
    odt: 'OpenDocument Text',
    ods: 'OpenDocument Spreadsheet',
    odp: 'OpenDocument Presentation',
  };
  return map[ext] || 'Office File';
}

/**
 * Determine whether a URL is a local file path.
 * Local path forms:
 * - file:// protocol
 * - macOS/Linux absolute path (starts with /)
 * - Windows absolute path (e.g. C:\ or D:/)
 *
 * Everything else (http, https, blob, data, etc.) is considered non-local.
 */
function isLocalFile(url: string): boolean {
  if (url.startsWith('file://')) return true;
  if (url.startsWith('/')) return true; // macOS / Linux absolute path
  if (/^[a-zA-Z]:[/\\]/.test(url)) return true; // Windows absolute path
  return false;
}

/** Prism language name → Monaco language name mapping */
const PRISM_TO_MONACO: Record<string, string> = {
  javascript: 'javascript', jsx: 'javascript',
  typescript: 'typescript', tsx: 'typescript',
  css: 'css', scss: 'scss', less: 'less', sass: 'scss',
  python: 'python', ruby: 'ruby',
  java: 'java', kotlin: 'kotlin', scala: 'scala', groovy: 'plaintext',
  c: 'c', cpp: 'cpp', csharp: 'csharp',
  go: 'go', rust: 'rust', swift: 'swift',
  objectivec: 'objective-c',
  bash: 'shell', powershell: 'powershell', batch: 'bat',
  sql: 'sql', graphql: 'graphql',
  xml: 'xml', yaml: 'yaml', toml: 'plaintext', ini: 'ini',
  docker: 'dockerfile', makefile: 'plaintext',
  php: 'php', perl: 'perl', lua: 'lua', r: 'r',
  dart: 'dart', elixir: 'plaintext', haskell: 'plaintext',
};

/** Get Monaco Editor language identifier by file extension */
function getMonacoLanguage(ext: string): string {
  if (MONACO_EXTENSION_LANG[ext]) return MONACO_EXTENSION_LANG[ext];
  const prismLang = CODE_EXTENSION_LANG[ext];
  if (!prismLang) return 'plaintext';
  return PRISM_TO_MONACO[prismLang] || 'plaintext';
}

/** Extract local file path from url field (supports file:// prefix and bare paths) */
function getLocalPath(url: string): string {
  if (url.startsWith('file://')) {
    return decodeURIComponent(url.replace('file://', ''));
  }
  return url;
}

/** Read-only Monaco Editor viewer (for browsing text files in non-edit mode) */
const ReadonlyMonacoViewer: React.FC<{ content: string; language: string }> = ({ content, language }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;

    let destroyed = false;

    import(/* webpackChunkName: "monaco-editor" */ 'monaco-editor').then((monacoModule) => {
      if (destroyed || !containerRef.current) return;

      const editor = monacoModule.editor.create(containerRef.current, {
        value: content,
        language,
        theme: 'vs-dark',
        automaticLayout: true,
        readOnly: true,
        domReadOnly: true,
        minimap: { enabled: false },
        fontSize: 13,
        fontFamily: "'Menlo', 'Monaco', 'Courier New', monospace",
        lineHeight: 21,
        padding: { top: 16, bottom: 16 },
        scrollBeyondLastLine: false,
        wordWrap: 'off',
        tabSize: 2,
        renderWhitespace: 'none',
        overviewRulerLanes: 0,
        hideCursorInOverviewRuler: true,
        overviewRulerBorder: false,
        scrollbar: {
          verticalScrollbarSize: 10,
          horizontalScrollbarSize: 10,
        },
        folding: true,
        lineNumbers: 'on',
        contextmenu: false,
        cursorStyle: 'line',
        cursorBlinking: 'solid',
      });

      editorRef.current = editor;
      setIsReady(true);
    });

    return () => {
      destroyed = true;
      editorRef.current?.dispose();
      editorRef.current = null;
    };
  }, [content, language]);

  return (
    <div className="file-viewer-edit-wrapper" style={{ position: 'relative' }}>
      {!isReady && (
        <div className="file-viewer-loading">
          <div className="loading-spinner-large">
            <div className="spinner-circle-large"></div>
          </div>
          <div className="loading-text">Loading editor...</div>
        </div>
      )}
      <div ref={containerRef} className="file-viewer-monaco-container" />
    </div>
  );
};

// Front Matter table component (for displaying YAML metadata in Markdown files)
const OverlayFrontMatterTable: React.FC<{ frontMatter: FrontMatter }> = ({ frontMatter }) => {
  const entries = Object.entries(frontMatter);
  if (entries.length === 0) return null;

  return (
    <div className="file-viewer-frontmatter">
      <table className="file-viewer-frontmatter-table">
        <tbody>
          {entries.map(([key, value]) => (
            <tr key={key}>
              <td className="file-viewer-frontmatter-key">{key}</td>
              <td className="file-viewer-frontmatter-value">{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

// ============================================================
// Component
// ============================================================

export const OverlayFileViewer: React.FC<OverlayFileViewerProps> = ({
  file,
  isOpen,
  onClose,
  onInstallSkill,
}) => {
  const [textContent, setTextContent] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<RenderViewMode>('render');
  const [isContentReady, setIsContentReady] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [fileSize, setFileSize] = useState<number | undefined>(undefined);
  const [isEditorLoading, setIsEditorLoading] = useState(false);
  const monacoEditorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoContainerRef = useRef<HTMLDivElement>(null);
  /** Baseline content for isDirty comparison (last saved value or initial value) */
  const savedContentRef = useRef<string>('');
  const iframeRef = useRef<HTMLIFrameElement>(null);
  // Track the currently loaded file identifier for synchronous file change detection
  const loadedFileKeyRef = useRef<string | null>(null);

  // File unique identifier
  const fileKey = file ? `${file.name}|${file.url}` : null;

  // Classification
  const category: FileCategory = file ? classifyFile(file) : 'other';

  // Synchronously generate blob URL for HTML content (avoids blank screen from useEffect async race conditions)
  const htmlBlobUrl = useMemo(() => {
    if (category !== 'html' || !textContent) return null;
    return URL.createObjectURL(new Blob([textContent], { type: 'text/html;charset=utf-8' }));
  }, [category, textContent]);

  // Clean up old blob URL
  useEffect(() => {
    return () => {
      if (htmlBlobUrl) URL.revokeObjectURL(htmlBlobUrl);
    };
  }, [htmlBlobUrl]);

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
        // Local file: read via electronAPI
        const localPath = getLocalPath(file.url);
        window.electronAPI?.fs
          ?.readFile(localPath, 'utf-8')
          .then((result) => {
            if (cancelled) return;
            if (result.success && result.content !== undefined) {
              setTextContent(result.content);
              loadedFileKeyRef.current = fileKey;
            } else {
              setLoadError(result.error || 'Failed to load file');
            }
            setIsLoading(false);
          })
          .catch((err) => {
            if (cancelled) return;
            console.error('[OverlayFileViewer] Failed to load local text:', err);
            setLoadError('Failed to load file');
            setIsLoading(false);
          });
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
            console.error('[OverlayFileViewer] Failed to load remote text:', err);
            setLoadError('Failed to load file');
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
  }, [isOpen, file, category]);

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
    if (!isEditing || !monacoContainerRef.current || textContent === null) return;

    // Set baseline content
    savedContentRef.current = textContent;

    // Get Monaco language ID
    const ext = file ? getExtension(file.name) : '';
    const monacoLang = getMonacoLanguage(ext);

    let destroyed = false;
    let disposableRef: { dispose: () => void } | null = null;

    setIsEditorLoading(true);

    import(/* webpackChunkName: "monaco-editor" */ 'monaco-editor').then((monacoModule) => {
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
  }, [isEditing]); // Only create/destroy when isEditing toggles

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
        'You have unsaved changes. Do you want to discard them?'
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
  }, [isDirty]);

  // Save edit
  const handleSave = useCallback(async () => {
    if (!file || !isEditable || !isDirty) return;
    const content = monacoEditorRef.current?.getValue() ?? '';
    setIsSaving(true);
    setSaveError(null);
    try {
      const localPath = getLocalPath(file.url);
      const result = await window.electronAPI?.fs?.writeFile(localPath, content, 'utf-8');
      if (result?.success) {
        setTextContent(content);
        savedContentRef.current = content;
        setIsDirty(false);
      } else {
        setSaveError(result?.error || 'Failed to save file');
      }
    } catch (err) {
      console.error('[OverlayFileViewer] Failed to save file:', err);
      setSaveError('Failed to save file');
    } finally {
      setIsSaving(false);
    }
  }, [file, isEditable, isDirty]);

  // Keyboard events
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isEditing) {
          handleCancelEdit();
        } else {
          onClose();
        }
      }
      // Cmd/Ctrl+S to save in edit mode
      if (isEditing && (e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, isEditing, handleCancelEdit, handleSave]);

  // Close viewer (check for unsaved changes in edit mode)
  const handleClose = useCallback(() => {
    if (isDirty) {
      const discard = window.confirm(
        'You have unsaved changes. Do you want to discard them?'
      );
      if (!discard) return;
    }
    onClose();
  }, [isDirty, onClose]);

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
      console.error('Failed to download file:', error);
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

  const ext = getExtension(file.name);

  // ---- Render file body ----
  const renderBody = () => {
    // Non-text file types (pdf / office / other) don't need text content loading, render directly
    const isNonTextCategory = category === 'pdf' || category === 'office' || category === 'other';
    
    // Text-based files: loading / content not ready / file has changed
    if (!isNonTextCategory && (isLoading || !isContentReady || loadedFileKeyRef.current !== fileKey)) {
      return (
        <div className="file-viewer-loading">
          <div className="loading-spinner-large">
            <div className="spinner-circle-large"></div>
          </div>
          <div className="loading-text">Loading...</div>
        </div>
      );
    }

    // Load failed
    if (loadError) {
      return (
        <div className="file-viewer-error">
          <p>{loadError}</p>
          <button onClick={onClose}>Close</button>
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
              <div className="loading-text">Loading editor...</div>
            </div>
          )}
          {saveError && (
            <div className="file-viewer-save-error">
              <AlertTriangle size={14} />
              <span>{saveError}</span>
            </div>
          )}
          <div
            ref={monacoContainerRef}
            className="file-viewer-monaco-container"
          />
        </div>
      );
    }

    switch (category) {
      // ---------- HTML Rendering ----------
      case 'html': {
        if (viewMode === 'source') {
          return <ReadonlyMonacoViewer content={textContent ?? ''} language="html" />;
        }
        // Render mode: load HTML via blob URL (separate CSP context, allows external resources)
        if (!htmlBlobUrl) return null;
        return (
          <iframe
            ref={iframeRef}
            className="file-viewer-html-embed"
            src={htmlBlobUrl}
            title={file.name}
            sandbox="allow-scripts allow-popups"
          />
        );
      }

      // ---------- JSON ----------
      case 'json':
        return <ReadonlyMonacoViewer content={textContent ?? ''} language="json" />;

      // ---------- Markdown Rendering ----------
      case 'markdown': {
        if (viewMode === 'source') {
          return <ReadonlyMonacoViewer content={textContent ?? ''} language="markdown" />;
        }
        const { frontMatter, content: markdownBody } = parseFrontMatter(textContent ?? '');
        return (
          <div className="file-viewer-markdown-content">
            {frontMatter && <OverlayFrontMatterTable frontMatter={frontMatter} />}
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeRaw]}
              components={{
                a: ({ href, children, ...props }) => {
                  // External links (http/https) open with system default browser
                  if (href && /^https?:\/\//.test(href)) {
                    return (
                      <a
                        {...props}
                        href={href}
                        onClick={(e) => {
                          e.preventDefault();
                          window.open(href, '_blank', 'noopener,noreferrer');
                        }}
                        title={href}
                        style={{ cursor: 'pointer' }}
                      >
                        {children}
                      </a>
                    );
                  }
                  return <a {...props} href={href}>{children}</a>;
                },
              }}
            >
              {markdownBody}
            </ReactMarkdown>
          </div>
        );
      }

      // ---------- Code Files ----------
      case 'code':
        return <ReadonlyMonacoViewer content={textContent ?? ''} language={getMonacoLanguage(ext)} />;

      // ---------- Text ----------
      case 'text':
        return <ReadonlyMonacoViewer content={textContent ?? ''} language={getMonacoLanguage(ext)} />;

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
              This file format ({getOfficeLabel(ext)}) cannot be previewed directly. You can open it with your default application.
            </p>
            <table className="file-viewer-metadata-table">
              <tbody>
                <tr>
                  <td>Filename</td>
                  <td>{file.name}</td>
                </tr>
                <tr>
                  <td>Type</td>
                  <td>{getOfficeLabel(ext)}</td>
                </tr>
                <tr>
                  <td>Size</td>
                  <td>{formatFileSize(fileSize)}</td>
                </tr>
                {file.lastModified && (
                  <tr>
                    <td>Modified</td>
                    <td>{file.lastModified}</td>
                  </tr>
                )}
              </tbody>
            </table>
            <button
              className="file-viewer-office-open-btn"
              onClick={handleOpenExternal}
            >
              Open with Default App
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
              This file type ({ext.toUpperCase() || file.mimeType || 'Unknown'}) is not supported for preview. You can open it with your default application.
            </p>
            <table className="file-viewer-metadata-table">
              <tbody>
                <tr>
                  <td>Filename</td>
                  <td>{file.name}</td>
                </tr>
                <tr>
                  <td>Type</td>
                  <td>{file.mimeType || ext.toUpperCase() || 'Unknown'}</td>
                </tr>
                <tr>
                  <td>Size</td>
                  <td>{formatFileSize(fileSize)}</td>
                </tr>
                {file.lastModified && (
                  <tr>
                    <td>Modified</td>
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
                Open with Default App
              </button>
              {ext === 'skill' && onInstallSkill && isLocalFile(file.url) && (
                <button
                  className="file-viewer-install-skill-btn"
                  onClick={() => onInstallSkill(getLocalPath(file.url))}
                >
                  <Download size={16} />
                  Install Skill
                </button>
              )}
            </div>
          </div>
        );
    }
  };

  return (
    <div className="file-viewer-overlay">
      {/* Content panel */}
      <div className="file-viewer-content" onClick={(e) => e.stopPropagation()}>
        {/* Header info + action buttons */}
        <div className="file-viewer-header">
          <div className="file-viewer-icon">{getFileIcon(category)}</div>
          <div className="file-viewer-file-info">
            <div className="file-viewer-filename">{file.name}</div>
            <div className="file-viewer-file-meta">
              {ext.toUpperCase()} {fileSize !== undefined ? `· ${formatFileSize(fileSize)}` : ''}
              <span className={`file-viewer-mode-badge ${isEditing ? 'file-viewer-mode-edit' : 'file-viewer-mode-preview'}`}>
                {isEditing ? 'EDIT' : 'PREVIEW'}
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
                  aria-label="Save"
                  title={isDirty ? 'Save (⌘S)' : 'No changes'}
                >
                  <Save size={24} />
                </button>
                <button
                  className="file-viewer-header-btn"
                  onClick={handleCancelEdit}
                  disabled={isSaving}
                  aria-label="Exit editing"
                  title="Exit Edit Mode"
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
                    aria-label={viewMode === 'render' ? 'View source code' : 'View rendered'}
                    title={viewMode === 'render' ? 'View Source' : 'View Rendered'}
                  >
                    {viewMode === 'render' ? <Code size={24} /> : <Eye size={24} />}
                  </button>
                )}
                {isEditable && (
                  <button
                    className="file-viewer-header-btn file-viewer-edit"
                    onClick={handleEdit}
                    aria-label="Edit file"
                    title="Edit"
                  >
                    <Pencil size={24} />
                  </button>
                )}
                <button
                  className="file-viewer-header-btn"
                  onClick={handleDownload}
                  aria-label="Download"
                  title="Download"
                >
                  <Download size={24} />
                </button>
              </>
            )}
            <button
              className="file-viewer-header-btn file-viewer-close"
              onClick={handleClose}
              aria-label="Close file viewer"
              title="Close"
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
