import React, { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import AgentChatCreationHeaderView from './AgentChatCreationHeaderView'
import AgentChatCreationContentView from './AgentChatCreationContentView'
import '../../../styles/AgentChatCreation.css'

/**
 * AgentChatCreationView - Agent creation view
 * 
 * Route: /agent/chat/creation
 * 
 * Provides entry point for creating custom Agents
 * 
 * Layout: top-bottom layout
 * - Top: AgentChatCreationHeaderView (unified Header style)
 * - Bottom: AgentChatCreationContentView (creation options)
 */
const AgentChatCreationView: React.FC = () => {
  const navigate = useNavigate()
  const location = useLocation()
  
  // 🔥 New: Key for tracking component refresh state
  const [refreshKey, setRefreshKey] = useState(0)

  // 🔥 Listen for refresh signal from navigation
  useEffect(() => {
    if (location.state?.refresh) {
      // Reset component state to defaults
      setRefreshKey(prev => prev + 1)
      console.log('[AgentChatCreationView] Refreshed to default state')
    }
  }, [location.state?.refresh])

  // Navigate back to previous page
  const handleBack = () => {
    navigate(-1)
  }

  // Custom Agent
  const handleCustomAgent = () => {
    console.log('[AgentChatCreationView] Custom Agent clicked')
  }

  return (
    <div className="agent-creation-view" key={refreshKey}>
      {/* Header */}
      <AgentChatCreationHeaderView onBack={handleBack} />
      
      {/* Content */}
      <AgentChatCreationContentView
        key={`content-${refreshKey}`}
        onCustomAgent={handleCustomAgent}
      />
    </div>
  )
}

export default AgentChatCreationView
