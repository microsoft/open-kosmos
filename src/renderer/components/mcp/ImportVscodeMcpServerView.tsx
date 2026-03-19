/**
 * ImportVscodeMcpServerView Component
 * VSCode MCP server import view - vertical layout structure
 */

import React from 'react'
import { useNavigate } from 'react-router-dom'
import ImportVscodeMcpServerViewHeader from './ImportVscodeMcpServerViewHeader'
import ImportVscodeMcpServerViewContent from './ImportVscodeMcpServerViewContent'
import '../../styles/ContentView.css'

const ImportVscodeMcpServerView: React.FC = () => {
  const navigate = useNavigate()

  const handleBack = () => {
    // Navigate back to MCP settings page
    navigate('/settings/mcp')
  }

  const handleImportComplete = (importedCount: number) => {
    // Navigate back to MCP settings page after import completes
    navigate('/settings/mcp')
  }

  return (
    <div className="content-view">
      {/* Header */}
      <ImportVscodeMcpServerViewHeader onBack={handleBack} />
      
      {/* Content */}
      <div className="content-main">
        <div className="content-container">
          <ImportVscodeMcpServerViewContent 
            onImportComplete={handleImportComplete}
          />
        </div>
      </div>
    </div>
  )
}

export default ImportVscodeMcpServerView