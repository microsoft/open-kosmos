'use client'

import React from 'react'
import { MoreHorizontal } from 'lucide-react'
import { SkillConfig } from '../../lib/userData/types'
import { isBuiltinSkill } from '../../../shared/constants/builtinSkills'
import '../../styles/ServerCard.css'

interface SkillListPanelProps {
  skills: SkillConfig[]
  selectedSkill: SkillConfig | null
  isLoading: boolean
  onSelectSkill: (skill: SkillConfig) => void
  onSkillMenuToggle?: (skillName: string, buttonElement: HTMLElement) => void
}

// Loading spinner component
const LoadingSpinner = () => (
  <div className="skill-loading-spinner">
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ animation: 'spin 1s linear infinite' }}
    >
      <circle cx="12" cy="12" r="10" stroke="#e0e0e0" strokeWidth="2"/>
      <path d="M22 12C22 17.5228 17.5228 22 12 22" stroke="#272320" strokeWidth="2" strokeLinecap="round"/>
    </svg>
  </div>
)

// Skill card component - consistent structure with MCP ServerCard
interface SkillCardProps {
  skill: SkillConfig
  isSelected: boolean
  onSelect: () => void
  onMenuClick: (e: React.MouseEvent) => void
}

const SkillCard: React.FC<SkillCardProps> = ({
  skill,
  isSelected,
  onSelect,
  onMenuClick
}) => {
  const isBuiltin = isBuiltinSkill(skill.name)

  return (
    <div
      className={`skill-card-wrapper ${isSelected ? 'selected' : ''}`}
      onClick={onSelect}
    >
      <div className="skill-card">
        <div className="skill-card-header">
          <div className="skill-card-info">
            <div className="skill-card-name-group">
              <div className="skill-card-title-row">
                <span className="skill-card-name">{skill.name}</span>
                {isBuiltin && <span className="builtin-badge">Built-in</span>}
              </div>
              <div style={{ display: 'flex', flexDirection: 'row', gap: '6px', alignItems: 'center' }}>
                {skill.version && (
                  <span className="skill-card-version">v{skill.version}</span>
                )}
                {skill.source && (
                  <span className="skill-card-version">{skill.source}</span>
                )}
              </div>
            </div>
          </div>
          <div className="skill-menu-container">
            <button
              className="skill-menu-btn"
              onClick={onMenuClick}
            >
              <MoreHorizontal size={16} strokeWidth={1.5} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

const SkillListPanel: React.FC<SkillListPanelProps> = ({
  skills,
  selectedSkill,
  isLoading,
  onSelectSkill,
  onSkillMenuToggle
}) => {
  const handleMenuClick = (skill: SkillConfig, e: React.MouseEvent) => {
    e.stopPropagation()
    if (onSkillMenuToggle) {
      const buttonElement = e.currentTarget as HTMLElement
      onSkillMenuToggle(skill.name, buttonElement)
    }
  }

  if (isLoading) {
    return (
      <div className="skill-list-loading">
        <LoadingSpinner />
        <span>Loading skills...</span>
      </div>
    )
  }

  if (skills.length === 0) {
    return (
      <div className="skill-list-empty">
        <span>No skills available</span>
        <span className="skill-list-empty-hint">Add a skill to get started</span>
      </div>
    )
  }

  // Sort skills: built-in skills first, then the rest
  const sortedSkills = [...skills].sort((a, b) => {
    const aBuiltin = isBuiltinSkill(a.name)
    const bBuiltin = isBuiltinSkill(b.name)
    if (aBuiltin && !bBuiltin) return -1
    if (!aBuiltin && bBuiltin) return 1
    return 0
  })

  return (
    <div className="skill-list-container">
      <div className="skill-cards">
        {sortedSkills.map((skill) => (
          <SkillCard
            key={skill.name}
            skill={skill}
            isSelected={selectedSkill?.name === skill.name}
            onSelect={() => onSelectSkill(skill)}
            onMenuClick={(e) => handleMenuClick(skill, e)}
          />
        ))}
      </div>
    </div>
  )
}

export default SkillListPanel