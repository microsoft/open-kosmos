'use client'

import React, { useState, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import { SkillConfig } from '../../lib/userData/types'

interface SkillDetailViewProps {
  skill: SkillConfig | null
}

// Loading spinner component
const LoadingSpinner = () => (
  <div className="skill-detail-loading">
    <svg
      width="32"
      height="32"
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ animation: 'spin 1s linear infinite' }}
    >
      <circle cx="16" cy="16" r="14" stroke="#e0e0e0" strokeWidth="2"/>
      <path d="M30 16C30 23.732 23.732 30 16 30" stroke="#272320" strokeWidth="2" strokeLinecap="round"/>
    </svg>
    <span>Loading skill content...</span>
  </div>
)

const SkillDetailView: React.FC<SkillDetailViewProps> = ({
  skill
}) => {
  const [markdownContent, setMarkdownContent] = useState<string>('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
        // Read SKILL.md file via IPC call to main process
        const result = await window.electronAPI?.skills?.getSkillMarkdown?.(skill.name)
        
        if (result?.success && result.content) {
          setMarkdownContent(result.content)
        } else {
          setError(result?.error || 'Failed to load skill content')
          setMarkdownContent('')
        }
      } catch (err) {
        console.error('Error loading skill markdown:', err)
        setError(err instanceof Error ? err.message : 'Failed to load skill content')
        setMarkdownContent('')
      } finally {
        setIsLoading(false)
      }
    }

    loadSkillMarkdown()
  }, [skill])

  if (!skill) {
    return (
      <div className="skill-detail-empty">
        <span>Select a skill to view details</span>
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
            <span>No SKILL.md content available</span>
          </div>
        )}
      </div>
    </div>
  )
}

export default SkillDetailView