'use client'

import React, { useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ChevronLeft, FileText } from 'lucide-react'
import { SkillConfig } from '../../lib/userData/types'
import { FileInfo } from './SkillViewPanel'
import { FrontMatter, parseFrontMatter } from '../../lib/utils/yamlFrontMatter'

interface SkillFileViewerProps {
  skill: SkillConfig
  fileInfo: FileInfo | null
  onBack: () => void
}

// Front Matter table component
const FrontMatterTable: React.FC<{ frontMatter: FrontMatter }> = ({ frontMatter }) => {
  const entries = Object.entries(frontMatter)
  
  if (entries.length === 0) return null
  
  return (
    <div className="skill-file-frontmatter">
      <table className="skill-file-frontmatter-table">
        <tbody>
          {entries.map(([key, value]) => (
            <tr key={key}>
              <td className="skill-file-frontmatter-key">{key}</td>
              <td className="skill-file-frontmatter-value">{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// Code highlighting component (simple implementation)
const CodeBlock: React.FC<{ code: string; language: string }> = ({ code, language }) => {
  return (
    <div className="skill-file-code-block">
      <div className="skill-file-code-header">
        <span className="skill-file-code-language">{language}</span>
      </div>
      <pre className="skill-file-code-content">
        <code>{code}</code>
      </pre>
    </div>
  )
}

// Get language display name
const getLanguageDisplayName = (extension: string): string => {
  const languageMap: Record<string, string> = {
    'md': 'Markdown',
    'js': 'JavaScript',
    'jsx': 'JavaScript (JSX)',
    'ts': 'TypeScript',
    'tsx': 'TypeScript (TSX)',
    'py': 'Python',
    'json': 'JSON',
    'yaml': 'YAML',
    'yml': 'YAML',
    'css': 'CSS',
    'html': 'HTML',
    'xml': 'XML',
    'txt': 'Text'
  }
  return languageMap[extension] || extension.toUpperCase()
}

// Get file icon color
const getFileIconColor = (extension: string): string => {
  const colorMap: Record<string, string> = {
    'md': '#0066cc',
    'js': '#f7df1e',
    'jsx': '#f7df1e',
    'ts': '#3178c6',
    'tsx': '#3178c6',
    'py': '#3776ab',
    'json': '#6b7280',
    'css': '#264de4',
    'html': '#e34f26'
  }
  return colorMap[extension] || '#9c9c9c'
}

const SkillFileViewer: React.FC<SkillFileViewerProps> = ({
  skill,
  fileInfo,
  onBack
}) => {
  if (!fileInfo) {
    return (
      <div className="skill-file-viewer-empty">
        <span>No file selected</span>
      </div>
    )
  }

  // Render file content
  const renderContent = () => {
    // Unsupported file format
    if (!fileInfo.isSupported) {
      return (
        <div className="skill-file-unsupported">
          <FileText size={48} color="#9c9c9c" strokeWidth={1} />
          <span className="skill-file-unsupported-text">Preview not supported for this format</span>
          <span className="skill-file-unsupported-hint">
            File type: {fileInfo.extension ? `.${fileInfo.extension}` : 'Unknown'}
          </span>
        </div>
      )
    }

    // No content
    if (!fileInfo.content) {
      return (
        <div className="skill-file-empty-content">
          <span>File content is empty</span>
        </div>
      )
    }

    // Render content by file type
    switch (fileInfo.extension) {
      case 'md':
        // Markdown rendering (supports YAML front matter and GFM tables)
        const { frontMatter, content: markdownContent } = parseFrontMatter(fileInfo.content)
        return (
          <div className="skill-file-markdown">
            {frontMatter && <FrontMatterTable frontMatter={frontMatter} />}
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdownContent}</ReactMarkdown>
          </div>
        )
      
      case 'js':
      case 'jsx':
      case 'ts':
      case 'tsx':
      case 'py':
      case 'json':
      case 'yaml':
      case 'yml':
      case 'css':
      case 'html':
      case 'xml':
        // Code file rendering
        return (
          <CodeBlock 
            code={fileInfo.content} 
            language={getLanguageDisplayName(fileInfo.extension)} 
          />
        )
      
      default:
        // Plain text rendering
        return (
          <div className="skill-file-text">
            <pre>{fileInfo.content}</pre>
          </div>
        )
    }
  }

  return (
    <div className="skill-file-viewer">
      {/* Header: File name and back button */}
      <div className="skill-file-viewer-header">
        <button 
          className="skill-file-back-btn"
          onClick={onBack}
          title="Back to folder"
        >
          <ChevronLeft size={20} strokeWidth={2} />
        </button>
        <div className="skill-file-info">
          <FileText 
            size={18} 
            color={getFileIconColor(fileInfo.extension)} 
            strokeWidth={1.5} 
          />
          <span className="skill-file-name">{fileInfo.fileName}</span>
          <span className="skill-file-type">
            {getLanguageDisplayName(fileInfo.extension)}
          </span>
        </div>
      </div>

      {/* Content: File content */}
      <div className="skill-file-viewer-content">
        {renderContent()}
      </div>
    </div>
  )
}

export default SkillFileViewer