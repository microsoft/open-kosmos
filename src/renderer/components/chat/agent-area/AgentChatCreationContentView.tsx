import React, { useState, useCallback, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Sparkles, ArrowLeft } from 'lucide-react'
import { useChats } from '../../userData/userDataProvider'
import { useToast } from '../../ui/ToastProvider'
import AgentBasicTab from '../agent-editor/AgentBasicTab'
import { AgentConfig } from '../agent-editor/types'
import { getDefaultModel } from '../../../lib/models/ghcModels'
import { profileDataManager } from '../../../lib/userData/profileDataManager'
import '../../../styles/AgentChatCreation.css'

interface AgentChatCreationContentViewProps {
  onCustomAgent: () => void
}

/**
 * AgentChatCreationContentView - Content area of Agent creation page
 * 
 * Provides custom Agent creation options:
 * 1. Custom Agent - shows AgentBasicTab component on click
 */
const AgentChatCreationContentView: React.FC<AgentChatCreationContentViewProps> = ({
  onCustomAgent,
}) => {
  const navigate = useNavigate()
  const { addChat, chats } = useChats()
  const { showToast } = useToast()
  
  // View state: 'options' shows option cards, 'custom' shows AgentBasicTab
  const [viewMode, setViewMode] = useState<'options' | 'custom'>('options')
  
  // AgentBasicTab data cache
  const [basicTabData, setBasicTabData] = useState<Partial<AgentConfig> | null>(null)
  const [hasChanges, setHasChanges] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  
  // Validation state
  const [isFormValid, setIsFormValid] = useState(false)

  // Handle Custom Agent click - navigate to standalone CreateCustomAgentView
  const handleCustomAgentClick = useCallback(() => {
    navigate('/agent/chat/creation/custom-agent')
    onCustomAgent()
  }, [navigate, onCustomAgent])

  // Return to options view
  const handleBackToOptions = useCallback(() => {
    setViewMode('options')
    setBasicTabData(null)
    setHasChanges(false)
    setIsFormValid(false)
  }, [])

  // Validate Agent name logic
  const validateAgentName = useCallback((name: string): boolean => {
    if (!name || !name.trim()) {
      return false
    }
    
    // Check if name duplicates an existing Agent
    return !chats.some(chat => chat.agent?.name === name.trim())
  }, [chats])

  // Handle AgentBasicTab data changes
  const handleDataChange = useCallback((
    tabName: 'basic' | 'knowledge' | 'mcp' | 'skills' | 'prompt' | 'context',
    data: Partial<AgentConfig>,
    changes: boolean
  ) => {
    if (tabName === 'basic') {
      setBasicTabData(data)
      setHasChanges(changes)
      
      // Validate form data
      const isValid = data.name?.trim() && validateAgentName(data.name) && data.model
      setIsFormValid(Boolean(isValid))
    }
  }, [validateAgentName])

  // Handle save (no actual save needed here, just satisfying interface requirements)
  const handleSave = useCallback(async (data: Partial<AgentConfig>): Promise<AgentConfig> => {
    // Return a mock AgentConfig
    return {
      id: '',
      name: data.name || '',
      emoji: data.emoji || '🤖',
      role: '',
      model: data.model || getDefaultModel(),
      mcpServers: [],
      systemPrompt: '',
      createdAt: new Date(),
      updatedAt: new Date()
    }
  }, [])

  // Helper function to wait for ProfileDataManager cache update
  const waitForChatInCache = useCallback((chatId: string, timeout = 5000): Promise<boolean> => {
    return new Promise((resolve) => {
      // First check if already exists in cache
      const chats = profileDataManager.getChatConfigs()
      if (chats.some(c => c.chat_id === chatId)) {
        resolve(true)
        return
      }

      let timeoutId: NodeJS.Timeout
      
      // Subscribe to data changes
      const unsubscribe = profileDataManager.subscribe((data) => {
        if (data.chats.some(c => c.chat_id === chatId)) {
          clearTimeout(timeoutId)
          unsubscribe()
          resolve(true)
        }
      })

      // Set timeout
      timeoutId = setTimeout(() => {
        unsubscribe()
        resolve(false)
      }, timeout)
    })
  }, [])

  // Create and continue configuration
  const handleCreateAndContinue = useCallback(async () => {
    if (!isFormValid || !basicTabData?.name?.trim()) {
      showToast('Please enter a valid agent name', 'error')
      return
    }
    
    // Validate name duplication again (prevent concurrent creation)
    if (!validateAgentName(basicTabData.name)) {
      showToast('Agent name already exists. Please choose a different name.', 'error')
      return
    }

    setIsCreating(true)
    
    try {
      // Create new Chat configuration
      const result = await addChat({
        chat_type: 'single_agent',
        agent: {
          name: basicTabData.name.trim(),
          emoji: basicTabData.emoji || '🤖',
          role: '',
          model: basicTabData.model || getDefaultModel(),
          mcp_servers: [],
          system_prompt: '',
          skills: []
        }
      })

      if (result.success && result.data) {
        const chatId = result.data.chat_id
        
        // Wait for ProfileDataManager to receive the new Chat configuration
        console.log('[AgentChatCreationContentView] Waiting for chat to appear in cache:', chatId)
        const chatAvailable = await waitForChatInCache(chatId)
        
        if (chatAvailable) {
          showToast(`Agent "${basicTabData.name}" created successfully!`, 'success')
          // Navigate to agent/chat/{chat_id}/settings/workspace page
          navigate(`/agent/chat/${chatId}/settings/workspace`)
        } else {
          console.warn('[AgentChatCreationContentView] Chat not found in cache after timeout, navigating anyway')
          showToast(`Agent "${basicTabData.name}" created successfully!`, 'success')
          navigate(`/agent/chat/${chatId}/settings/workspace`)
        }
      } else {
        showToast(result.error || 'Failed to create agent', 'error')
      }
    } catch (error) {
      console.error('[AgentChatCreationContentView] Failed to create agent:', error)
      showToast('Failed to create agent', 'error')
    } finally {
      setIsCreating(false)
    }
  }, [basicTabData, addChat, navigate, showToast, waitForChatInCache, isFormValid, validateAgentName])

  // Render options view
  const renderOptionsView = () => (
    <div className="creation-options-container">
      <h2 className="creation-title">Create a New Agent</h2>
      <p className="creation-subtitle">Choose how you want to create your agent</p>
      
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
            <h3 className="option-title">Custom Agent</h3>
            <p className="option-description">
              Create a personalized agent with custom name, emoji, system prompt, and MCP servers configuration.
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
  )

  // Render custom Agent view
  const renderCustomAgentView = () => (
    <div className="custom-agent-container">
      {/* Back button and title */}
      <div className="custom-agent-header">
        <button 
          className="back-button"
          onClick={handleBackToOptions}
          type="button"
        >
          <ArrowLeft size={20} />
          <span>Back</span>
        </button>
        <h2 className="custom-agent-title">Create Custom Agent</h2>
      </div>
      
      {/* AgentBasicTab component */}
      <div className="custom-agent-form">
        <AgentBasicTab
          mode="add"
          onSave={handleSave}
          onDataChange={handleDataChange}
          cachedData={basicTabData}
        />
      </div>
      
      {/* Create and continue configuration button */}
      <div className="custom-agent-actions">
        <button
          className="create-continue-button"
          onClick={handleCreateAndContinue}
          disabled={isCreating || !isFormValid}
          type="button"
        >
          {isCreating ? 'Creating...' : 'Create and Continue Configuration'}
        </button>
      </div>
    </div>
  )

  return (
    <div className="agent-creation-content">
      {viewMode === 'options' ? renderOptionsView() : renderCustomAgentView()}
    </div>
  )
}

export default AgentChatCreationContentView
