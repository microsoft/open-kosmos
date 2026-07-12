'use client'

import React from 'react'
import { ChevronLeft, FileText } from 'lucide-react'
import { SkillConfig } from '../../lib/userData/types'
import { FileInfo } from './SkillViewPanel'
import FileContentRenderer from '../ui/FileContentRenderer'
import { useI18n } from '../../lib/i18n/useI18n'

const INERT_HTML_EXTENSIONS = new Set(['html', 'htm'])

interface SkillFileViewerProps {
  skill: SkillConfig
  fileInfo: FileInfo | null
  onBack: () => void
}

// Get language display name
const getLanguageDisplayName = (extension: string, textLabel: string): string => {
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
    'txt': textLabel
  }
  return languageMap[extension] || extension.toUpperCase()
}

// Get file icon color
const getFileIconColor = (extension: string): string => {
  const colorMap: Record<string, string> = {
    'md': 'var(--color-lang-markdown)',
    'js': 'var(--color-lang-javascript)',
    'jsx': 'var(--color-lang-javascript)',
    'ts': 'var(--color-lang-typescript)',
    'tsx': 'var(--color-lang-typescript)',
    'py': 'var(--color-lang-python)',
    'json': 'var(--color-neutral-500)',
    'css': 'var(--color-lang-css)',
    'html': 'var(--color-lang-html)'
  }
  return colorMap[extension] || 'var(--color-neutral-400)'
}

const SkillFileViewer: React.FC<SkillFileViewerProps> = ({
  skill,
  fileInfo,
  onBack
}) => {
  const { t } = useI18n()

  if (!fileInfo) {
    return (
      <div className="skill-file-viewer-empty">
        <span>{t('skills.file.noFileSelected')}</span>
      </div>
    )
  }

  // Render file content
  const renderContent = () => {
    // Unsupported file format
    if (!fileInfo.isSupported) {
      return (
        <div className="skill-file-unsupported">
          <FileText size={48} color="var(--color-neutral-400)" strokeWidth={1} />
          <span className="skill-file-unsupported-text">{t('skills.file.previewUnsupported')}</span>
          <span className="skill-file-unsupported-hint">
            {t('skills.file.fileType', { type: fileInfo.extension ? `.${fileInfo.extension}` : t('skills.file.unknownType') })}
          </span>
        </div>
      )
    }

    // No content
    if (!fileInfo.content) {
      return (
        <div className="skill-file-empty-content">
          <span>{t('skills.file.emptyContent')}</span>
        </div>
      )
    }

    return (
      <FileContentRenderer
        name={fileInfo.fileName}
        content={fileInfo.content}
        viewMode={INERT_HTML_EXTENSIONS.has(fileInfo.extension.toLowerCase()) ? 'source' : undefined}
      />
    )
  }

  return (
    <div className="skill-file-viewer">
      {/* Header: file name and back button */}
      <div className="skill-file-viewer-header">
        <button
          className="skill-file-back-btn"
          onClick={onBack}
          title={t('skills.file.backToFolder')}
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
            {getLanguageDisplayName(fileInfo.extension, t('skills.file.languageText'))}
          </span>
        </div>
      </div>

      {/* Content: file content */}
      <div className="skill-file-viewer-content">
        {renderContent()}
      </div>
    </div>
  )
}

export default SkillFileViewer