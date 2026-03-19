import React, { useState, useCallback, useEffect } from 'react'

import '../../../styles/Agent.css';
import { TabComponentProps } from './types'
import { getAllKosmosUsedModels, getDefaultModel } from '../../../lib/models/ghcModels'
import EmojiPicker from './EmojiPicker'
import { useToast } from '../../ui/ToastProvider'
import { useChats } from '../../userData/userDataProvider'
import { AgentAvatar } from '../../common/AgentAvatar'

const AgentBasicTab: React.FC<TabComponentProps> = ({
  mode,
  agentId,
  agentData,
  onSave,
  onAgentCreated,
  onDataChange,
  cachedData,
  fieldErrors,
  readOnly = false,
  isFromLibrary = false
}) => {
  // Get all chats for name duplication check
  const { chats } = useChats()
  
  // Form state
  const [formData, setFormData] = useState({
    name: '',
    emoji: '🤖',
    avatar: '', // Agent avatar URL
    role: '', // Reserved but not used
    model: getDefaultModel()
  })

  // Agent metadata (read-only display)
  const [agentMeta, setAgentMeta] = useState({
    version: '',
  })

  // UI state
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [showModelDropdown, setShowModelDropdown] = useState(false)
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({})
  const [isInitialized, setIsInitialized] = useState(false)
  const [loadedAgentId, setLoadedAgentId] = useState<string | null>(null)
  const [nameWarning, setNameWarning] = useState<string>('')
  
  // Check if this is a Kobi Agent (emoji modification disabled)
  const isKobiAgent = agentData?.name?.toLowerCase() === 'kobi'
  
  // Editing permissions:
  // - avatar/emoji/name: not editable for Kobi
  // - model: editable
  const isAvatarNameDisabled = readOnly || isKobiAgent
  const isModelDisabled = readOnly
  
  // Initial data for comparing changes
  const [initialData, setInitialData] = useState({
    name: '',
    emoji: '🤖',
    avatar: '',
    role: '',
    model: getDefaultModel()
  })

  // Available models list
  const [availableModels, setAvailableModels] = useState<any[]>([])
  const modelDropdownRef = React.useRef<HTMLDivElement>(null)

  // Load available models
  useEffect(() => {
    const models = getAllKosmosUsedModels()
    setAvailableModels(models)
  }, [])

  // Load existing data - only on first component load or when explicit re-sync is needed
  useEffect(() => {
    // In Update mode or when agent is already created in Add mode, sync data to form
    if (agentData && (mode === 'update' || (mode === 'add' && agentData.id))) {
      // Only reset form data when uninitialized or when agentId changes
      if (!isInitialized || loadedAgentId !== agentData.id) {
        const baseData = {
          name: agentData.name,
          emoji: agentData.emoji,
          avatar: agentData.avatar || '', // Agent avatar URL
          role: '', // Always set to empty
          model: agentData.model
        }
        
        // Set metadata (read-only)
        setAgentMeta({
          version: agentData.version || '',
        })
        
        // If cached data exists, use cached data first
        const finalData = cachedData ? {
          name: cachedData.name !== undefined ? cachedData.name : baseData.name,
          emoji: cachedData.emoji !== undefined ? cachedData.emoji : baseData.emoji,
          avatar: cachedData.avatar !== undefined ? cachedData.avatar : baseData.avatar,
          role: cachedData.role !== undefined ? cachedData.role : baseData.role,
          model: cachedData.model !== undefined ? cachedData.model : baseData.model
        } : baseData
        
        setFormData(finalData)
        setInitialData(baseData) // Initial data is always the original data
        setLoadedAgentId(agentData.id)
        setIsInitialized(true)
      }
    } else if (!isInitialized) {
      // Initial state in Add mode
      const defaultInitialData = {
        name: '',
        emoji: '🤖',
        avatar: '',
        role: '',
        model: getDefaultModel()
      }
      
      // Reset metadata
      setAgentMeta({
        version: '',
      })
      
      // If cached data exists, use cached data
      const finalData = cachedData ? {
        name: cachedData.name !== undefined ? cachedData.name : defaultInitialData.name,
        emoji: cachedData.emoji !== undefined ? cachedData.emoji : defaultInitialData.emoji,
        avatar: cachedData.avatar !== undefined ? cachedData.avatar : defaultInitialData.avatar,
        role: cachedData.role !== undefined ? cachedData.role : defaultInitialData.role,
        model: cachedData.model !== undefined ? cachedData.model : defaultInitialData.model
      } : defaultInitialData
      
      setFormData(finalData)
      setInitialData(defaultInitialData)
      setLoadedAgentId(null)
      setIsInitialized(true)
    }
  }, [mode, agentData?.id, isInitialized, loadedAgentId, cachedData])

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


  // Check if Agent name is duplicated
  const checkDuplicateName = useCallback((name: string): boolean => {
    if (!name.trim()) return false
    
    // In Update mode, exclude the currently editing Agent
    const currentAgentName = agentData?.name
    
    return chats.some(chat => {
      // If this is the currently editing Agent, skip
      if (mode === 'update' && chat.agent?.name === currentAgentName) {
        return false
      }
      return chat.agent?.name === name.trim()
    })
  }, [chats, agentData?.name, mode])

  // Form validation
  const validateForm = useCallback(() => {
    const errors: Record<string, string> = {}

    if (!formData.name.trim()) {
      errors.name = 'Agent name is required'
    } else if (checkDuplicateName(formData.name)) {
      errors.name = 'Agent name already exists'
    }

    if (!formData.model) {
      errors.model = 'Model selection is required'
    }

    setValidationErrors(errors)
    return Object.keys(errors).length === 0
  }, [formData, checkDuplicateName])

  // Check if data has been modified
  const hasChanges = useCallback(() => {
    return (
      formData.name !== initialData.name ||
      formData.emoji !== initialData.emoji ||
      formData.avatar !== initialData.avatar ||
      formData.role !== initialData.role ||
      formData.model !== initialData.model
    )
  }, [formData, initialData])

  // Notify parent component when data changes
  useEffect(() => {
    if (isInitialized && onDataChange) {
      const changes = hasChanges()
      onDataChange('basic', formData, changes)
    }
  }, [formData, hasChanges, isInitialized, onDataChange])

  // Handle input changes
  const handleInputChange = useCallback((field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }))
    
    // If it is the name field, check for duplicates in real time
    if (field === 'name') {
      if (value.trim() && checkDuplicateName(value)) {
        setNameWarning('⚠️ This agent name already exists')
      } else {
        setNameWarning('')
      }
    }
    
    // Clear validation errors for this field
    if (validationErrors[field]) {
      setValidationErrors(prev => {
        const newErrors = { ...prev }
        delete newErrors[field]
        return newErrors
      })
    }
    
    // When user types, notify parent to clear field errors (triggers parent to update fieldErrors via onDataChange)
    // This way errors from Save All Changes are cleared when user starts modifying the name
  }, [validationErrors, checkDuplicateName])

  // Handle Emoji selection
  const handleEmojiSelect = useCallback((emoji: string) => {
    handleInputChange('emoji', emoji)
    setShowEmojiPicker(false)
  }, [handleInputChange])

  // Handle model selection
  const handleModelSelect = useCallback((modelId: string) => {
    handleInputChange('model', modelId)
    setShowModelDropdown(false)
  }, [handleInputChange])

  // Dynamically determine the current actual mode
  const getCurrentMode = useCallback(() => {
    // If in Add mode but Agent is already created, handle as Update mode
    if (mode === 'add' && agentData?.id) {
      return 'update'
    }
    return mode
  }, [mode, agentData?.id])

  return (
    <div className="agent-tab">
      {/* Tab Body */}
      <div className="tab-body">
        {/* Avatar Section */}
        <div className="form-section">
          <label className="form-label">Agent Avatar</label>
          <div className="emoji-section">
            <div
              className={`emoji-display ${isAvatarNameDisabled ? 'disabled' : ''}`}
              onClick={() => !isAvatarNameDisabled && setShowEmojiPicker(true)}
              title={readOnly ? "Avatar cannot be modified" : isKobiAgent ? "Kobi Agent's avatar cannot be modified" : "Click to change avatar"}
              style={isAvatarNameDisabled ? { cursor: 'not-allowed', opacity: 0.6 } : undefined}
            >
              {/* Use AgentAvatar component */}
              <AgentAvatar
                emoji={formData.emoji}
                avatar={formData.avatar}
                name={formData.name}
                size="lg"
                version={agentMeta.version}
              />
            </div>
            <span className="emoji-hint">
              {readOnly ? "Avatar cannot be modified" : isKobiAgent ? "Kobi Agent's avatar cannot be modified" : "Click to choose avatar"}
            </span>
          </div>
        </div>

        {/* Agent Name */}
        <div className="form-section">
          <label className="form-label">Agent Name</label>
          <input
            type="text"
            className={`form-input ${(validationErrors.name || fieldErrors?.name) ? 'warning' : ''} ${nameWarning ? 'warning' : ''}`}
            value={formData.name}
            onChange={(e) => handleInputChange('name', e.target.value)}
            placeholder="Enter agent name..."
            disabled={isAvatarNameDisabled} // Not editable for read-only mode or Kobi
          />
          {(validationErrors.name || fieldErrors?.name) && (
            <div className="warning-message">{validationErrors.name || fieldErrors?.name}</div>
          )}
          {nameWarning && !validationErrors.name && !fieldErrors?.name && (
            <div className="warning-message">{nameWarning}</div>
          )}
        </div>

        {/* Model Selection */}
        <div className="form-section">
          <label className="form-label">Agent Model</label>
          <div className="model-selector" ref={modelDropdownRef}>
            <button
              type="button"
              className={`model-button ${validationErrors.model ? 'error' : ''}`}
              onClick={() => !isModelDisabled && setShowModelDropdown(!showModelDropdown)}
              disabled={isModelDisabled}
              style={isModelDisabled ? { cursor: 'not-allowed', opacity: 0.7 } : undefined}
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
            {showModelDropdown && !isModelDisabled && (
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
          {validationErrors.model && (
            <div className="error-message">{validationErrors.model}</div>
          )}
        </div>

        {/* Version (Read-only, only show when has value) */}
        {agentMeta.version && (
          <div className="form-section agent-meta-section">
            <label className="form-label">Agent Info</label>
            <div className="agent-meta-row">
              <div className="agent-meta-item">
                <span className="agent-meta-label">Version:</span>
                <span className="agent-meta-value">{agentMeta.version}</span>
              </div>
            </div>
          </div>
        )}
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

export default AgentBasicTab
