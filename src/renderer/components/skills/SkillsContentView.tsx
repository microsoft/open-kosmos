'use client'

import React from 'react'
import '../../styles/ContentView.css'
import '../../styles/SkillsContentView.css'
import SkillListPanel from './SkillListPanel'
import SkillViewPanel from './SkillViewPanel'
import type { SkillConfig } from '../../lib/userData/types'
import { useI18n } from '../../lib/i18n/useI18n'

interface SkillsContentViewProps {
  skills: SkillConfig[]
  selectedSkill: SkillConfig | null
  isLoading: boolean
  onSelectSkill: (skill: SkillConfig | null) => void
  onSkillMenuToggle?: (skillName: string, buttonElement: HTMLElement) => void
}

const SkillsContentView: React.FC<SkillsContentViewProps> = ({
  skills,
  selectedSkill,
  isLoading,
  onSelectSkill,
  onSkillMenuToggle
}) => {
  const { t } = useI18n()

  // Trigger add Skill event
  const handleAddFromDeviceArtifact = () => {
    window.dispatchEvent(new CustomEvent('skills:addFromDeviceArtifact'))
  }

  const handleAddFromDeviceFolder = () => {
    window.dispatchEvent(new CustomEvent('skills:addFromDeviceFolder'))
  }

  // Show empty state when there are no Skills and not loading
  if (!isLoading && skills.length === 0) {
    return (
      <div className="skills-content-view">
        <div className="skills-empty-state">
          <div className="skills-empty-content">
            <p className="skills-empty-text">{t('skills.emptyDescription')}</p>
            <div className="skills-empty-actions">
              <button
                className="skills-empty-btn skills-empty-btn-primary"
                onClick={handleAddFromDeviceArtifact}
              >
                {t('skills.addFromDeviceArtifact')}
              </button>
              <button
                className="skills-empty-btn skills-empty-btn-secondary"
                onClick={handleAddFromDeviceFolder}
              >
                {t('skills.addFromDeviceFolder')}
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="skills-content-view">
      {/* Left: Skill list */}
      <div className="skill-list-panel">
        <SkillListPanel
          skills={skills}
          selectedSkill={selectedSkill}
          isLoading={isLoading}
          onSelectSkill={onSelectSkill}
          onSkillMenuToggle={onSkillMenuToggle}
        />
      </div>

      {/* Right: Skill file explorer/viewer */}
      <div className="skill-view-panel">
        <SkillViewPanel
          skill={selectedSkill}
        />
      </div>
    </div>
  )
}

export default SkillsContentView