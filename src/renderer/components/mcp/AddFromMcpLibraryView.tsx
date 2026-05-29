/**
 * AddFromMcpLibraryView Component
 * Main view component with top-bottom layout:
 * - Top: AddFromMcpLibraryViewHeader (using UnifiedHeader layout and styles)
 * - Bottom: AddFromMcpLibraryViewContent (preserves all existing functionality)
 */

import React from 'react'
import { useNavigate } from 'react-router-dom'
import AddFromMcpLibraryViewHeader from './AddFromMcpLibraryViewHeader'
import AddFromMcpLibraryViewContent from './AddFromMcpLibraryViewContent'
import '../../styles/AddFromMcpLibraryView.css'

interface AddFromMcpLibraryViewProps {
  onServerAdded?: (count: number) => void
}

const AddFromMcpLibraryView: React.FC<AddFromMcpLibraryViewProps> = ({
  onServerAdded
}) => {
  const navigate = useNavigate()

  const handleBack = () => {
    // Navigate back to settings/mcp
    navigate('/settings/mcp')
  }

  const handleServerAdded = (count: number) => {
    // Call parent callback if provided
    onServerAdded?.(count)
  }

  return (
    <div className="add-from-mcp-library-view">
      {/* Header */}
      <AddFromMcpLibraryViewHeader onBack={handleBack} />

      {/* Content */}
      <AddFromMcpLibraryViewContent onServerAdded={handleServerAdded} />
    </div>
  )
}

export default AddFromMcpLibraryView