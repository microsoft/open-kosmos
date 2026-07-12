import React, { useEffect, useState, useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Sparkles } from 'lucide-react'
import AgentChatCreationHeaderView from './AgentChatCreationHeaderView'
import '../../../styles/AgentChatCreation.css'
import { createLogger } from '../../../lib/utilities/logger';
import { useI18n } from '../../../lib/i18n/useI18n';
const logger = createLogger('[AgentChatCreationView]');

/**
 * AgentChatCreationView - Agent creation view
 *
 * Route: /agent/chat/creation
 *
 * Provides local custom Agent creation.
 */
const AgentChatCreationView: React.FC = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const { t } = useI18n()

  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    if (location.state?.refresh) {
      setRefreshKey(prev => prev + 1)
      logger.debug('[AgentChatCreationView] Refreshed to default state')
    }
  }, [location.state?.refresh])

  const handleBack = () => {
    navigate(-1)
  }

  const handleCustomAgentClick = useCallback(() => {
    navigate('/agent/chat/creation/custom-agent')
  }, [navigate])

  return (
    <div className="agent-creation-view" key={refreshKey}>
      {/* Header */}
      <AgentChatCreationHeaderView onBack={handleBack} />

      {/* Content */}
      <div className="agent-creation-content">
        <div className="creation-options-container" key={`content-${refreshKey}`}>
        <h2 className="creation-title">{t('agent.create.creationTitle')}</h2>
        <p className="creation-subtitle">{t('agent.create.creationSubtitle')}</p>

        <div className="creation-options">
          {/* Custom Agent option */}
          <button
            className="creation-option-card"
            onClick={handleCustomAgentClick}
            type="button"
          >
            <div className="option-icon">
              <Sparkles size={32} strokeWidth={1.5} />
            </div>
            <div className="option-content">
              <h3 className="option-title">{t('agent.create.customAgent')}</h3>
              <p className="option-description">
                {t('agent.create.customAgentDescription')}
              </p>
            </div>
            <div className="option-arrow">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M7.5 15L12.5 10L7.5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
          </button>

        </div>
        </div>
      </div>
    </div>
  )
}

export default AgentChatCreationView
