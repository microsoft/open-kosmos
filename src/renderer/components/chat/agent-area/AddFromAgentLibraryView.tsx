/**
 * AddFromAgentLibraryView Component
 * Main view component with top-bottom layout:
 * - Top: AddFromAgentLibraryViewHeader (using UnifiedHeader layout and styles)
 * - Bottom: AddFromAgentLibraryViewContent (agent library list and details)
 *
 * Route: /agent/chat/creation/agent-library
 * This is a sub-view of /agent/chat/creation, so "new agent" remains selected in navigation
 */

import React from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import AddFromAgentLibraryViewHeader from './AddFromAgentLibraryViewHeader'
import AddFromAgentLibraryViewContent from './AddFromAgentLibraryViewContent'
import '../../../styles/AddFromMcpLibraryView.css'

interface AddFromAgentLibraryViewProps {
  onAgentAdded?: (count: number) => void
}

const AddFromAgentLibraryView: React.FC<AddFromAgentLibraryViewProps> = ({
  onAgentAdded
}) => {
  const navigate = useNavigate()
  const location = useLocation()

  const handleBack = () => {
    const backTo = (location.state as { backTo?: string })?.backTo
    navigate(backTo || '/agent/chat/creation')
  }

  const handleAgentAdded = (count: number) => {
    // Call parent callback if provided
    onAgentAdded?.(count)
  }

  return (
    <div className="add-from-mcp-library-view">
      {/* Header */}
      <AddFromAgentLibraryViewHeader onBack={handleBack} />

      {/* Content */}
      <AddFromAgentLibraryViewContent onAgentAdded={handleAgentAdded} />
    </div>
  )
}

export default AddFromAgentLibraryView
