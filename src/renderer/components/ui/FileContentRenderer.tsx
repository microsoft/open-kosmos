import React, { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import type * as monaco from 'monaco-editor';
import { FrontMatter, parseFrontMatter } from '../../lib/utils/yamlFrontMatter';
import { useI18n } from '../../lib/i18n/useI18n';
import '../../styles/OverlayFileViewer.css';

export type FileContentCategory = 'code' | 'text' | 'json' | 'markdown' | 'html' | 'pdf' | 'office' | 'other';
export type FileContentViewMode = 'render' | 'source';

export interface FileContentDescriptor {
  name: string;
  mimeType?: string;
}

interface FileContentRendererProps extends FileContentDescriptor {
  content: string;
  viewMode?: FileContentViewMode;
  markdownWikilinks?: {
    resolveTarget: (target: string) => string | null;
    onNavigate: (slug: string) => void;
  };
}

const HTML_EXTENSIONS = new Set(['html', 'htm']);
const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown']);
const JSON_EXTENSIONS = new Set(['json']);

const MONACO_EXTENSION_LANG: Record<string, string> = {
  html: 'html', htm: 'html',
  md: 'markdown', markdown: 'markdown',
  json: 'json',
  txt: 'plaintext', csv: 'plaintext', tsv: 'plaintext',
  cfg: 'plaintext', conf: 'plaintext', env: 'plaintext', log: 'plaintext',
  gitignore: 'plaintext',
};

const CODE_EXTENSION_LANG: Record<string, string> = {
  js: 'javascript', jsx: 'jsx', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', tsx: 'tsx',
  css: 'css', scss: 'scss', less: 'less', sass: 'sass',
  py: 'python',
  rb: 'ruby',
  java: 'java', kt: 'kotlin', kts: 'kotlin', scala: 'scala', groovy: 'groovy',
  c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', hxx: 'cpp',
  cs: 'csharp',
  go: 'go',
  rs: 'rust',
  swift: 'swift', m: 'objectivec',
  sh: 'bash', bash: 'bash', zsh: 'bash', ps1: 'powershell',
  bat: 'batch', cmd: 'batch',
  sql: 'sql',
  graphql: 'graphql', gql: 'graphql',
  xml: 'xml', svg: 'xml',
  yaml: 'yaml', yml: 'yaml',
  toml: 'toml',
  ini: 'ini',
  dockerfile: 'docker',
  makefile: 'makefile',
  php: 'php',
  pl: 'perl', pm: 'perl',
  lua: 'lua',
  r: 'r',
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

const MEMEX_WIKILINK_HREF_PREFIX = '#memex-card:';

export function getFileExtension(filename: string): string {
  const parts = filename.split('.');
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
}

export function classifyFileContent(file: FileContentDescriptor): FileContentCategory {
  const ext = getFileExtension(file.name);

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
    ) {
      return 'office';
    }
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

export function isTextFileContentCategory(category: FileContentCategory): boolean {
  return category === 'text' ||
    category === 'code' ||
    category === 'json' ||
    category === 'markdown' ||
    category === 'html';
}

export function getMonacoLanguage(ext: string): string {
  if (MONACO_EXTENSION_LANG[ext]) return MONACO_EXTENSION_LANG[ext];
  const prismLang = CODE_EXTENSION_LANG[ext];
  if (!prismLang) return 'plaintext';
  return PRISM_TO_MONACO[prismLang] || 'plaintext';
}

function escapeMarkdownLinkText(value: string): string {
  return value.replace(/([\\[\]])/g, '\\$1');
}

function buildMemexWikilinkHref(slug: string): string {
  return `${MEMEX_WIKILINK_HREF_PREFIX}${encodeURIComponent(slug)}`;
}

function parseMemexWikilinkHref(href: string): string | null {
  if (!href.startsWith(MEMEX_WIKILINK_HREF_PREFIX)) return null;
  try {
    return decodeURIComponent(href.slice(MEMEX_WIKILINK_HREF_PREFIX.length));
  } catch {
    return null;
  }
}

function replaceMemexWikilinksInSegment(
  segment: string,
  markdownWikilinks: NonNullable<FileContentRendererProps['markdownWikilinks']>,
): string {
  return segment.replace(/\[\[([^\]\n]+)\]\]/g, (match, rawInner: string) => {
    const [rawTarget, ...aliasParts] = rawInner.split('|');
    const target = rawTarget.trim();
    if (!target) return match;
    const resolvedSlug = markdownWikilinks.resolveTarget(target);
    if (!resolvedSlug) return match;
    const label = aliasParts.join('|').trim() || target;
    return `[${escapeMarkdownLinkText(label)}](${buildMemexWikilinkHref(resolvedSlug)})`;
  });
}

function renderMemexWikilinks(
  markdown: string,
  markdownWikilinks?: FileContentRendererProps['markdownWikilinks'],
): string {
  if (!markdownWikilinks) return markdown;

  const codePattern = /```[\s\S]*?```|`[^`\n]+`/g;
  let rendered = '';
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = codePattern.exec(markdown)) !== null) {
    rendered += replaceMemexWikilinksInSegment(
      markdown.slice(lastIndex, match.index),
      markdownWikilinks,
    );
    rendered += match[0];
    lastIndex = match.index + match[0].length;
  }

  rendered += replaceMemexWikilinksInSegment(markdown.slice(lastIndex), markdownWikilinks);
  return rendered;
}

export const ReadonlyMonacoViewer: React.FC<{
  content: string;
  language: string;
}> = ({ content, language }) => {
  const { t } = useI18n();
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
          <div className="loading-text">{t('viewer.loadingEditor')}</div>
        </div>
      )}
      <div ref={containerRef} className="file-viewer-monaco-container" />
    </div>
  );
};

const FileViewerFrontMatterTable: React.FC<{
  frontMatter: FrontMatter;
}> = ({ frontMatter }) => {
  const entries = Object.entries(frontMatter);
  if (entries.length === 0) return null;

  return (
    <div className="file-viewer-frontmatter">
      <table className="file-viewer-frontmatter-table">
        <tbody>
          {entries.map(([key, value]) => (
            <tr key={key}>
              <td className="file-viewer-frontmatter-key">{key}</td>
              <td className="file-viewer-frontmatter-value">{String(value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export const FileContentRenderer: React.FC<FileContentRendererProps> = ({
  name,
  mimeType,
  content,
  viewMode = 'render',
  markdownWikilinks,
}) => {
  const category = classifyFileContent({ name, mimeType });
  const ext = getFileExtension(name);
  const htmlBlobUrl = useMemo(() => {
    if (category !== 'html' || !content || viewMode === 'source') return null;
    return URL.createObjectURL(new Blob([content], { type: 'text/html;charset=utf-8' }));
  }, [category, content, viewMode]);

  useEffect(() => {
    return () => {
      if (htmlBlobUrl) URL.revokeObjectURL(htmlBlobUrl);
    };
  }, [htmlBlobUrl]);

  switch (category) {
    case 'html':
      if (viewMode === 'source') {
        return <ReadonlyMonacoViewer content={content} language="html" />;
      }
      if (!htmlBlobUrl) return null;
      return (
        <iframe
          className="file-viewer-html-embed"
          src={htmlBlobUrl}
          title={name}
          sandbox="allow-scripts allow-popups"
        />
      );

    case 'json':
      return <ReadonlyMonacoViewer content={content} language="json" />;

    case 'markdown': {
      if (viewMode === 'source') {
        return <ReadonlyMonacoViewer content={content} language="markdown" />;
      }
      const { frontMatter, content: markdownBody } = parseFrontMatter(content);
      const renderedMarkdownBody = renderMemexWikilinks(markdownBody, markdownWikilinks);
      return (
        <div className="file-viewer-markdown-content">
          {frontMatter && <FileViewerFrontMatterTable frontMatter={frontMatter} />}
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeRaw]}
            components={{
              a: ({ href, children, className, ...props }) => {
                const memexSlug = href ? parseMemexWikilinkHref(href) : null;
                if (memexSlug && markdownWikilinks) {
                  return (
                    <a
                      {...props}
                      href={href}
                      className={[className, 'file-viewer-wikilink'].filter(Boolean).join(' ')}
                      onClick={(e) => {
                        e.preventDefault();
                        markdownWikilinks.onNavigate(memexSlug);
                      }}
                      title={memexSlug}
                      data-memex-slug={memexSlug}
                    >
                      {children}
                    </a>
                  );
                }
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
            {renderedMarkdownBody}
          </ReactMarkdown>
        </div>
      );
    }

    case 'code':
    case 'text':
      return <ReadonlyMonacoViewer content={content} language={getMonacoLanguage(ext)} />;

    default:
      return <ReadonlyMonacoViewer content={content} language="plaintext" />;
  }
};

export default FileContentRenderer;
