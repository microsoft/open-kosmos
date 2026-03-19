import React, { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import CreateCustomAgentViewHeader from './CreateCustomAgentViewHeader'
import CreateCustomAgentViewContent from './CreateCustomAgentViewContent'
import '../../../styles/ContentView.css'

/**
 * CreateCustomAgentView - Create Custom Agent view
 *
 * Route: /agent/chat/creation/custom-agent
 *
 * Directly displays custom Agent creation interface, containing:
 * - AgentBasicTab for entering basic information
 * - Create and continue configuration button
 *
 * Layout: top-bottom layout, using unified content-view structure
 * - Top: CreateCustomAgentViewHeader
 * - Bottom: CreateCustomAgentViewContent (wrapped in content-main > content-container)
 */
const CreateCustomAgentView: React.FC = () => {
  const navigate = useNavigate()
  const location = useLocation()
  
  // 🔥 New: Key for tracking component refresh state
  const [refreshKey, setRefreshKey] = useState(0)

  // 🔥 Listen for refresh signal from navigation
  useEffect(() => {
    if (location.state?.refresh) {
      // Reset component state to defaults
      setRefreshKey(prev => prev + 1)
      console.log('[CreateCustomAgentView] Refreshed to default state')
    }
  }, [location.state?.refresh])

  // Navigate back to new agent page
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