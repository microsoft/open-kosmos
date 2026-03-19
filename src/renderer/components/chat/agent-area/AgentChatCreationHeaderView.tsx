import React from 'react'
import '../../../styles/Header.css'

const PlusIcon = () => (
  <svg
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <mask
      id="mask0_322_2677"
      style={{ maskType: 'alpha' }}
      maskUnits="userSpaceOnUse"
      x="0"
      y="0"
      width="24"
      height="24"
    >
      <path
        d="M12 3.25C12.4142 3.25 12.75 3.58579 12.75 4V11.25H20C20.4142 11.25 20.75 11.5858 20.75 12C20.75 12.4142 20.4142 12.75 20 12.75H12.75V20C12.75 20.4142 12.4142 20.75 12 20.75C11.5858 20.75 11.25 20.4142 11.25 20V12.75H4C3.58579 12.75 3.25 12.4142 3.25 12C3.25 11.5858 3.58579 11.25 4 11.25H11.25V4C11.25 3.58579 11.5858 3.25 12 3.25Z"
        fill="#242424"
      />
    </mask>
    <g mask="url(#mask0_322_2677)">
      <rect width="24" height="24" fill="#272320" />
    </g>
  </svg>
);

interface AgentChatCreationHeaderViewProps {
  onBack?: () => void
}

/**
 * AgentChatCreationHeaderView - Header component for Agent creation page
 *
 * Uses unified Header style (unified-header)
 */
const AgentChatCreationHeaderView: React.FC<AgentChatCreationHeaderViewProps> = ({ onBack }) => {
  return (
    <header className="unified-header">
      <div className="header-title">
        <span className="header-icon"><PlusIcon /></span>
        <span className="header-name">New Agent</span>
      </div>
      <div className="header-actions">
        {/* Reserved space for action buttons */}
      </div>
    </header>
  )
}

export default AgentChatCreationHeaderView
