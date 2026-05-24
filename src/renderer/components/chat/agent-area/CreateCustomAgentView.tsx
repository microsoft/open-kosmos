import React, { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import CreateCustomAgentViewHeader from './CreateCustomAgentViewHeader'
import CreateCustomAgentViewContent from './CreateCustomAgentViewContent'
import '../../../styles/ContentView.css'
import { createLogger } from '../../../lib/utilities/logger';
const logger = createLogger('[CreateCustomAgentView]');

/**
 * CreateCustomAgentView - Create Custom Agent view
 *
 * Route: /agent/chat/creation/custom-agent
 *
 * Directly shows the custom Agent creation interface, including:
 * - AgentBasicTab for entering basic information
 * - Create and continue configuration button
 *
 * Layout: top-bottom layout using the unified content-view structure
 * - Top: CreateCustomAgentViewHeader
 * - Bottom: CreateCustomAgentViewContent (wrapped in content-main > content-container)
 */
const CreateCustomAgentView: React.FC = () => {
  const navigate = useNavigate()
  const location = useLocation()

  // 🔥 Added: key used to track component refresh state
  const [refreshKey, setRefreshKey] = useState(0)

  // 🔥 Listen for refresh signal from navigation
  useEffect(() => {
    if (location.state?.refresh) {
      // Reset component state to default values
      setRefreshKey(prev => prev + 1)
      logger.debug('[CreateCustomAgentView] Refreshed to default state')
    }
  }, [location.state?.refresh])

  // Navigate back to the new agent page
  const handleBack = () => {
    navigate('/agent/chat/creation')
  }

  return (
    <div className="content-view" key={refreshKey}>
      {/* Header */}
      <CreateCustomAgentViewHeader onBack={handleBack} />

      {/* Content */}
      <div className="content-main">
        <div className="content-container">
          <CreateCustomAgentViewContent key={`content-${refreshKey}`} />
        </div>
      </div>
    </div>
  )
}

export default CreateCustomAgentView