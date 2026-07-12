'use client'

import React, { useState, useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import type { SkillConfig } from '../../lib/userData/types'
import { createLogger } from '../../lib/utilities/logger';
import { useI18n } from '../../lib/i18n/useI18n';
const logger = createLogger('[SkillDetailView]');

interface SkillDetailViewProps {
  skill: SkillConfig | null
}

// Loading spinner component
const LoadingSpinner = () => {
  const { t } = useI18n();

  return (
    <div className="skill-detail-loading">
      <svg
        width="32"
        height="32"
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{ animation: 'spin 1s linear infinite' }}
      >
        <circle cx="16" cy="16" r="14" stroke="var(--color-neutral-200)" strokeWidth="2"/>
        <path d="M30 16C30 23.732 23.732 30 16 30" stroke="var(--color-warm-900)" strokeWidth="2" strokeLinecap="round"/>
      </svg>
      <span>{t('skills.detail.loading')}</span>
    </div>
  )
}

const SkillDetailView: React.FC<SkillDetailViewProps> = ({
  skill
}) => {
  const { t } = useI18n();
  const tRef = useRef(t)
  const [markdownContent, setMarkdownContent] = useState<string>('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    tRef.current = t
  }, [t])

  // Load SKILL.md content
  useEffect(() => {
    if (!skill) {
      setMarkdownContent('')
      setError(null)
      return
    }

    const loadSkillMarkdown = async () => {
      setIsLoading(true)
      setError(null)

      try {
        // Read SKILL.md file via IPC call to the main process
        const result = await window.electronAPI?.skills?.getSkillMarkdown?.(skill.name)

        if (result?.success && result.content) {
          setMarkdownContent(result.content)
        } else {
          setError(result?.error || tRef.current('skills.detail.loadFailed'))
          setMarkdownContent('')
        }
      } catch (err) {
        logger.error('Error loading skill markdown:', err)
        setError(err instanceof Error ? err.message : tRef.current('skills.detail.loadFailed'))
        setMarkdownContent('')
      } finally {
        setIsLoading(false)
      }
    }

    loadSkillMarkdown()
  }, [skill?.name])

  if (!skill) {
    return (
      <div className="skill-detail-empty">
        <span>{t('skills.detail.selectSkill')}</span>
      </div>
    )
  }

  return (
    <div className="skill-detail-container">
      {/* Skill detail header */}
      <div className="skill-detail-header">
        <div className="skill-detail-title">
          <h2>{skill.name}</h2>
          {skill.version && (
            <span className="skill-detail-version">v{skill.version}</span>
          )}
        </div>
        {skill.description && (
          <p className="skill-detail-description">{skill.description}</p>
        )}
      </div>

      {/* Skill detail content */}
      <div className="skill-detail-content">
        {isLoading ? (
          <LoadingSpinner />
        ) : error ? (
          <div className="skill-detail-error">
            <span>⚠️ {error}</span>
          </div>
        ) : markdownContent ? (
          <div className="skill-markdown-content">
            <ReactMarkdown>{markdownContent}</ReactMarkdown>
          </div>
        ) : (
          <div className="skill-detail-no-content">
            <span>{t('skills.detail.noContent')}</span>
          </div>
        )}
      </div>
    </div>
  )
}

export default SkillDetailView