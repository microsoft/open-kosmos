import React from 'react'
import { useNavigate } from 'react-router-dom'
import '../../styles/Header.css'

interface ImportVscodeMcpServerViewHeaderProps {
  onBack?: () => void
}

const ImportVscodeMcpServerViewHeader: React.FC<ImportVscodeMcpServerViewHeaderProps> = ({
  onBack
}) => {
  const navigate = useNavigate()

  const handleBack = () => {
    if (onBack) {
      onBack()
    } else {
      // Default behavior: navigate back to settings/mcp
      navigate('/settings/mcp')
    }
  }

  return (
    <div className="unified-header">
      <div className="header-title">
        <button
          className="btn-action"
          onClick={handleBack}
          title="Back"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M20 11H7.83L13.42 5.41L12 4L4 12L12 20L13.41 18.59L7.83 13H20V11Z" fill="#272320"/>
          </svg>
        </button>
        <span className="header-name">Import from VS Code</span>
      </div>
      <div className="header-actions">
        {/* Right side can add other action buttons, currently empty */}
      </div>
    </div>
  )
}

export default ImportVscodeMcpServerViewHeader