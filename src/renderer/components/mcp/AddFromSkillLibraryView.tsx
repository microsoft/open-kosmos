/**
 * AddFromSkillLibraryView Component
 * Main view component with top-bottom layout:
 * - Top: AddFromSkillLibraryViewHeader (using UnifiedHeader layout and styles)
 * - Bottom: AddFromSkillLibraryViewContent (preserves all existing functionality)
 */

import React from 'react'
import { useNavigate } from 'react-router-dom'
import AddFromSkillLibraryViewHeader from './AddFromSkillLibraryViewHeader'
import AddFromSkillLibraryViewContent from './AddFromSkillLibraryViewContent'
import '../../styles/AddFromMcpLibraryView.css'

interface AddFromSkillLibraryViewProps {
  onSkillAdded?: (count: number) => void
}

const AddFromSkillLibraryView: React.FC<AddFromSkillLibraryViewProps> = ({
  onSkillAdded
}) => {
  const navigate = useNavigate()

  const handleBack = () => {
    // Navigate back to settings/skills
    navigate('/settings/skills')
  }

  const handleSkillAdded = (count: number) => {
    // Call parent callback if provided
    onSkillAdded?.(count)
  }

  return (
    <div className="add-from-mcp-library-view">
      {/* Header */}
      <AddFromSkillLibraryViewHeader onBack={handleBack} />

      {/* Content */}
      <AddFromSkillLibraryViewContent onSkillAdded={handleSkillAdded} />
    </div>
  )
}

export default AddFromSkillLibraryView