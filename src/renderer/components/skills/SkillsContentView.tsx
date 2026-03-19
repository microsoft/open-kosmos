'use client'

import React from 'react'
import '../../styles/ContentView.css'
import '../../styles/SkillsContentView.css'
import SkillListPanel from './SkillListPanel'
import SkillViewPanel from './SkillViewPanel'
import { SkillConfig } from '../../lib/userData/types'

interface SkillsContentViewProps {
  skills: SkillConfig[]
  selectedSkill: SkillConfig | null
  isLoading: boolean
  onSelectSkill: (skill: SkillConfig) => void
  onSkillMenuToggle?: (skillName: string, buttonElement: HTMLElement) => void
}

const SkillsContentView: React.FC<SkillsContentViewProps> = ({
  skills,
  selectedSkill,
  isLoading,
  onSelectSkill,
  onSkillMenuToggle
}) => {
  // Trigger add Skill event
  const handleAddFromDevice = () => {
    window.dispatchEvent(new CustomEvent('skills:addFromDevice'))
  }

  // When there are no Skills and not loading, show empty state page
  if (!isLoading && skills.length === 0) {
    return (
      <div className="skills-content-view">
        <div className="skills-empty-state">
          <div className="skills-empty-content">
            <p className="skills-empty-text">No Skills available, please add a skill (.zip)</p>
            <div className="skills-empty-actions">
              <button
                className="skills-empty-btn skills-empty-btn-primary"
                onClick={handleAddFromDevice}
              >
                Add from Device
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="skills-content-view">
      {/* Left side: Skill list */}
      <div className="skill-list-panel">
        <SkillListPanel
          skills={skills}
          selectedSkill={selectedSkill}
          isLoading={isLoading}
          onSelectSkill={onSelectSkill}
          onSkillMenuToggle={onSkillMenuToggle}
        />
      </div>

      {/* Right side: Skill file explorer/viewer */}
      <div className="skill-view-panel">
        <SkillViewPanel
          skill={selectedSkill}
        />
      </div>
    </div>
  )
}

export default SkillsContentView