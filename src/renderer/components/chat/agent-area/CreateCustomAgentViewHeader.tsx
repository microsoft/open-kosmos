import React from 'react'
import '../../../styles/Header.css'

// Back Arrow Icon Component
const BackArrowIcon = () => (
  <svg
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M19 12H5M12 19l-7-7 7-7"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

interface CreateCustomAgentViewHeaderProps {
  onBack?: () => void
}

/**
 * CreateCustomAgentViewHeader - Header component for Create Custom Agent page
 *
 * Uses unified Header style (unified-header)
 * Layout: [Back button] "Create Custom Agent"
 */
const CreateCustomAgentViewHeader: React.FC<CreateCustomAgentViewHeaderProps> = ({ onBack }) => {
  return (
    <header className="unified-header">
      <div className="header-title">
        {onBack && (
          <button 
            className="btn-action" 
            onClick={onBack}
            type="button"
            aria-label="Back"
          >
            <BackArrowIcon />
          </button>
        )}
        <span className="header-name">Create Custom Agent</span>
      </div>
      <div className="header-actions">
        {/* Reserved space for action buttons */}
      </div>
    </header>
  )
}

export default CreateCustomAgentViewHeader