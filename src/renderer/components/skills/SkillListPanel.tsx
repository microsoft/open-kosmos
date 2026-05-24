'use client'

import React, { useState, useEffect, useMemo } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { SkillConfig } from '../../lib/userData/types'
import { isBuiltinSkill } from '../../../shared/constants/builtinSkills'
import '../../styles/ServerCard.css'
import ListSearchBox from '../ui/ListSearchBox'

interface SkillListPanelProps {
  skills: SkillConfig[]
  selectedSkill: SkillConfig | null
  isLoading: boolean
  onSelectSkill: (skill: SkillConfig | null) => void
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
  const isPlugin = skill.source === 'PLUGIN' || skill.name.startsWith('plugin--')

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
                {isPlugin && <span className="builtin-badge" style={{ background: 'var(--color-accent-secondary, #6b5ce7)', opacity: 0.85 }}>Plugin</span>}
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
          {!isPlugin && (
            <div className="skill-menu-container">
              <button
                className="skill-menu-btn"
                onClick={onMenuClick}
              >
                <MoreHorizontal size={16} strokeWidth={1.5} />
              </button>
            </div>
          )}
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
  // Search filter — hooks must be at top level, before any early returns
  const [searchQuery, setSearchQuery] = useState('')

  // Sort skills: built-in skills first, then the rest
  const sortedSkills = useMemo(() => [...skills].sort((a, b) => {
    const aBuiltin = isBuiltinSkill(a.name)
    const bBuiltin = isBuiltinSkill(b.name)
    if (aBuiltin && !bBuiltin) return -1
    if (!aBuiltin && bBuiltin) return 1
    return 0
  }), [skills])

  const filteredSkills = searchQuery
    ? sortedSkills.filter(s => s.name.includes(searchQuery))
    : sortedSkills

  // Stable identity for filtered list — catches same-length content changes
  const filteredIdentity = useMemo(
    () => filteredSkills.map(s => s.name).join('\0'),
    [filteredSkills]
  )

  // Keep selection in sync with filtered results (also handles initial selection)
  // Depend on selectedSkill?.name so external selection changes (e.g. skills:selectSkill event) are caught
  useEffect(() => {
    if (filteredSkills.length === 0) {
      if (selectedSkill) {
        onSelectSkill(null)
      }
      return
    }
    if (!selectedSkill) {
      onSelectSkill(filteredSkills[0])
      return
    }
    const currentInFiltered = filteredSkills.some(s => s.name === selectedSkill.name)
    if (!currentInFiltered) {
      // External selection of an off-filter item — clear search to reveal it
      if (searchQuery && sortedSkills.some(s => s.name === selectedSkill.name)) {
        setSearchQuery('')
        return
      }
      onSelectSkill(filteredSkills[0])
    }
  }, [searchQuery, filteredIdentity, selectedSkill?.name])

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

  return (
    <div className="skill-list-container">
      <div className="skill-cards">
        <ListSearchBox
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="Search skills..."
        />
        {filteredSkills.map((skill) => (
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