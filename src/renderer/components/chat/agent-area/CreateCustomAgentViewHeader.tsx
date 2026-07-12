import React from 'react'
import '../../../styles/Header.css'
import { useI18n } from '../../../lib/i18n/useI18n'

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
 * CreateCustomAgentViewHeader - Header component for the Create Custom Agent page
 *
 * Uses the unified header style (unified-header)
 * Layout: [Back button] "Create Custom Agent"
 */
const CreateCustomAgentViewHeader: React.FC<CreateCustomAgentViewHeaderProps> = ({ onBack }) => {
  const { t } = useI18n()

  return (
    <header className="unified-header">
      <div className="header-title">
        {onBack && (
          <button
            className="btn-action"
            onClick={onBack}
            type="button"
            aria-label={t('common.back')}
          >
            <BackArrowIcon />
          </button>
        )}
        <span className="header-name">{t('agent.create.createCustomAgent')}</span>
      </div>
      <div className="header-actions">
        {/* Reserved space for action buttons */}
      </div>
    </header>
  )
}

export default CreateCustomAgentViewHeader