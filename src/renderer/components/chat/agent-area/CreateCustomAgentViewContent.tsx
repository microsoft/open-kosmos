import React, { useState, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useChats } from '../../userData/userDataProvider'
import { useToast } from '../../ui/ToastProvider'
import { getDefaultModel, getAllKosmosUsedModels } from '../../../lib/models/ghcModels'
import { profileDataManager } from '../../../lib/userData/profileDataManager'
import EmojiPicker from '../agent-editor/EmojiPicker'
import '../../../styles/AgentChatCreation.css'

interface CreateCustomAgentViewContentProps {
  // Add needed props here
}

// Simplified Agent data type
interface AgentFormData {
  name: string
  emoji: string
  model: string
}

/**
 * CreateCustomAgentViewContent - Content area of Create Custom Agent page
 *
 * References AddNewMcpServerViewContent layout structure
 */
const CreateCustomAgentViewContent: React.FC<CreateCustomAgentViewContentProps> = () => {
  const navigate = useNavigate()
  const { addChat, chats } = useChats()
  const { showToast } = useToast()
  
  // Form data
  const [formData, setFormData] = useState<AgentFormData>({
    name: '',
    emoji: '🤖',
    model: getDefaultModel()
  })
  const [isCreating, setIsCreating] = useState(false)
  
  // UI state
  const [showModelDropdown, setShowModelDropdown] = useState(false)
  const [availableModels, setAvailableModels] = useState<any[]>([])
  const [isFormValid, setIsFormValid] = useState(false)
  const [nameWarning, setNameWarning] = useState<string>('')
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({})
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const modelDropdownRef = React.useRef<HTMLDivElement>(null)
  
  // Load available models
  React.useEffect(() => {
    const models = getAllKosmosUsedModels()
    setAvailableModels(models)
  }, [])

  // Handle clicking outside to close model dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(event.target as Node)) {
        setShowModelDropdown(false)
      }
    }

    if (showModelDropdown) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => {
        document.removeEventListener('mousedown', handleClickOutside)
      }
    }
  }, [showModelDropdown])

  // Validate Agent name logic
  const validateAgentName = useCallback((name: string): boolean => {
    if (!name || !name.trim()) {
      return false
    }
    
    // Check if name duplicates an existing Agent
    return !chats.some(chat => chat.agent?.name === name.trim())
  }, [chats])

  // Validate form data
  React.useEffect(() => {
    const isValid = formData.name.trim() && validateAgentName(formData.name) && formData.model
    setIsFormValid(Boolean(isValid))
  }, [formData, validateAgentName])

  // Handle input changes
  const handleInputChange = useCallback((field: keyof AgentFormData, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }))
    
    // If name field, check for duplicates and validity in real time
    if (field === 'name') {
      if (value.trim() && !validateAgentName(value)) {
        setNameWarning('⚠️ This agent name already exists')
      } else {
        setNameWarning('')
      }
      
      // Clear validation errors for this field
      if (validationErrors.name) {
        setValidationErrors(prev => {
          const newErrors = { ...prev }
          delete newErrors.name
          return newErrors
        })
      }
    }
  }, [validateAgentName, validationErrors])

  // Handle model selection
  const handleModelSelect = useCallback((modelId: string) => {
    handleInputChange('model', modelId)
    setShowModelDropdown(false)
  }, [handleInputChange])

  // Handle Emoji selection
  const handleEmojiSelect = useCallback((emoji: string) => {
    handleInputChange('emoji', emoji)
    setShowEmojiPicker(false)
  }, [handleInputChange])

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
    if (!isFormValid || !formData.name.trim()) {
      showToast('Please enter a valid agent name', 'error')
      return
    }
    
    // Validate name duplication again (prevent concurrent creation)
    if (!validateAgentName(formData.name)) {
      showToast('Agent name already exists. Please choose a different name.', 'error')
      return
    }

    setIsCreating(true)
    
    try {
      // Create new Chat configuration
      const result = await addChat({
        chat_type: 'single_agent',
        agent: {
          name: formData.name.trim(),
          emoji: formData.emoji,
          role: '',
          model: formData.model,
          // 🆕 Added from Custom Agent: use 1.0.0
          version: '1.0.0',
          mcp_servers: [],
          system_prompt: '',
          skills: []
        }
      })

      if (result.success && result.data) {
        const chatId = result.data.chat_id
        
        // Wait for ProfileDataManager to receive the new Chat configuration
        console.log('[CreateCustomAgentViewContent] Waiting for chat to appear in cache:', chatId)
        const chatAvailable = await waitForChatInCache(chatId)
        
        if (chatAvailable) {
          showToast(`Agent "${formData.name}" created successfully!`, 'success')
          // Navigate to agent/chat/{chat_id}/settings/workspace page
          navigate(`/agent/chat/${chatId}/settings/workspace`)
        } else {
          console.warn('[CreateCustomAgentViewContent] Chat not found in cache after timeout, navigating anyway')
          showToast(`Agent "${formData.name}" created successfully!`, 'success')
          navigate(`/agent/chat/${chatId}/settings/workspace`)
        }
      } else {
        showToast(result.error || 'Failed to create agent', 'error')
      }
    } catch (error) {
      console.error('[CreateCustomAgentViewContent] Failed to create agent:', error)
      showToast('Failed to create agent', 'error')
    } finally {
      setIsCreating(false)
    }
  }, [formData, addChat, navigate, showToast, waitForChatInCache, validateAgentName])

  return (
    <div className="create-agent-content">
      {/* Agent Avatar section */}
      <div className="agent-avatar-section">
        <label className="form-label">Agent Avatar</label>
        <div className="emoji-section">
          <div
            className="emoji-display"
            onClick={() => setShowEmojiPicker(true)}
            title="Click to change emoji"
          >
            {formData.emoji}
          </div>
          <span className="emoji-hint">Click to choose avatar</span>
        </div>
      </div>

      {/* Agent Name section */}
      <div className="agent-name-section">
        <label className="form-label">Agent Name</label>
        <input
          type="text"
          className={`agent-name-input ${validationErrors.name ? 'error' : ''} ${nameWarning ? 'warning' : ''}`}
          value={formData.name}
          onChange={(e) => handleInputChange('name', e.target.value)}
          placeholder="Enter agent name..."
        />
        {validationErrors.name && (
          <div className="validation-error">
            {validationErrors.name}
          </div>
        )}
        {nameWarning && !validationErrors.name && (
          <div className="warning-message">
            {nameWarning}
          </div>
        )}
      </div>

      {/* Agent Model section */}
      <div className="agent-model-section">
        <label className="form-label">Agent Model</label>
        <div className="model-selector" ref={modelDropdownRef}>
          <button
            type="button"
            className="model-button"
            onClick={() => setShowModelDropdown(!showModelDropdown)}
          >
            <svg
              className="model-icon"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
              />
            </svg>
            <span className="model-name">
              {availableModels.find(m => m.id === formData.model)?.name || 'Select Model'}
            </span>
            <svg
              className={`dropdown-arrow ${showModelDropdown ? 'rotated' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </button>
          
          {/* Model dropdown */}
          {showModelDropdown && (
            <div className="model-dropdown">
              <div className="model-list">
                {availableModels.map((model) => (
                  <button
                    key={model.id}
                    type="button"
                    className={`model-option ${formData.model === model.id ? 'selected' : ''}`}
                    onClick={() => handleModelSelect(model.id)}
                  >
                    <div className="model-info">
                      <span className="model-option-name">{model.name}</span>
                      <div className="model-badges">
                        {(model.capabilities.family.includes('o3') || model.capabilities.family.includes('o4')) && <span className="badge reasoning">Reasoning</span>}
                        {model.capabilities.supports.tool_calls && <span className="badge tools">Tools</span>}
                        {model.capabilities.supports.vision && <span className="badge files">Image</span>}
                      </div>
                    </div>
                    {formData.model === model.id && (
                      <svg className="check-icon" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Action buttons */}
      <div className="agent-actions">
        <button
          className="btn-secondary"
          onClick={() => navigate('/agent/chat/creation')}
        >
          Cancel
        </button>
        
        <button
          className="btn-primary"
          onClick={handleCreateAndContinue}
          disabled={isCreating || !isFormValid}
          type="button"
        >
          {isCreating ? 'Creating...' : 'Create and Continue Configuration'}
        </button>
      </div>

      {/* Emoji Picker Modal */}
      <EmojiPicker
        isOpen={showEmojiPicker}
        onClose={() => setShowEmojiPicker(false)}
        onEmojiSelect={handleEmojiSelect}
        currentEmoji={formData.emoji}
      />
    </div>
  )
}

export default CreateCustomAgentViewContent