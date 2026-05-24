import React, { useState, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useChats } from '../../userData/userDataProvider'
import { useToast } from '../../ui/ToastProvider'
import { getDefaultModel, getAllOpenKosmosUsedModels } from '../../../lib/models/ghcModels'
import { profileDataManager } from '../../../lib/userData/profileDataManager'
import EmojiPicker from '../agent-editor/EmojiPicker'
import { BUILTIN_SKILL_NAMES } from '../../../../shared/constants/builtinSkills'
import '../../../styles/AgentChatCreation.css'
import { createLogger } from '../../../lib/utilities/logger';
import { useFeatureFlag } from '../../../lib/featureFlags';
import { useScrollSelectedIntoView } from '../../../lib/hooks/useScrollSelectedIntoView'
const logger = createLogger('[CreateCustomAgentViewContent]');

interface CreateCustomAgentViewContentProps {
  // Add needed props here
}

type AgentSource = 'ON-DEVICE' | 'EXTERNAL';

// Simplified Agent data type
interface AgentFormData {
  name: string
  emoji: string
  model: string
  source: AgentSource
}

const CreateCustomAgentViewContent: React.FC<CreateCustomAgentViewContentProps> = () => {
  const navigate = useNavigate()
  const { addChat, chats } = useChats()
  const { showToast } = useToast()
  const externalAgentEnabled = useFeatureFlag('openkosmosFeatureExternalAgent');

  // Form data
  const [formData, setFormData] = useState<AgentFormData>({
    name: '',
    emoji: '🤖',
    model: getDefaultModel(),
    source: 'ON-DEVICE'
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
  const selectedModelOptionRef = useScrollSelectedIntoView<HTMLButtonElement>(
    showModelDropdown,
    formData.model,
    availableModels.length,
  )

  // Load available models (passive sync mode: initial load + listen for backend push updates)
  React.useEffect(() => {
    const loadModels = () => {
      const models = getAllOpenKosmosUsedModels()
      setAvailableModels(models)
    }
    loadModels()
    const handleModelCacheUpdated = () => { loadModels() }
    window.addEventListener('modelCacheUpdated', handleModelCacheUpdated)
    return () => { window.removeEventListener('modelCacheUpdated', handleModelCacheUpdated) }
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

    // Check if the name duplicates an existing Agent
    return !chats.some(chat => chat.agent?.name === name.trim())
  }, [chats])

  // Validate form data
  React.useEffect(() => {
    const isValid = formData.name.trim() && validateAgentName(formData.name) && (formData.source === 'EXTERNAL' || formData.model)
    setIsFormValid(Boolean(isValid))
  }, [formData, validateAgentName])

  // Handle input changes
  const handleInputChange = useCallback((field: keyof AgentFormData, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }))

    // For the name field, check for duplicates and validity in real time
    if (field === 'name') {
      if (value.trim() && !validateAgentName(value)) {
        setNameWarning('⚠️ This agent name already exists')
      } else {
        setNameWarning('')
      }

      // Clear the validation error for this field
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

  // Helper function to wait for ProfileDataManager cache to update
  const waitForChatInCache = useCallback((chatId: string, timeout = 5000): Promise<boolean> => {
    return new Promise((resolve) => {
      // Check first whether the chat already exists in the cache
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

  // Create and continue to configure
  const handleCreateAndContinue = useCallback(async () => {
    if (!isFormValid || !formData.name.trim()) {
      showToast('Please enter a valid agent name', 'error')
      return
    }

    // Re-validate the name for duplicates (guard against concurrent creation)
    if (!validateAgentName(formData.name)) {
      showToast('Agent name already exists. Please choose a different name.', 'error')
      return
    }

    setIsCreating(true)

    try {
      const isExternal = formData.source === 'EXTERNAL';

      // Create the new Chat configuration
      const result = await addChat({
        chat_type: 'single_agent',
        agent: {
          name: formData.name.trim(),
          emoji: formData.emoji,
          role: '',
          model: formData.model,
          version: '1.0.0',
          source: formData.source,
          system_prompt: '',
          mcp_servers: isExternal ? [] : [{ name: 'builtin-tools', tools: [] }],
          skills: isExternal ? [] : [...BUILTIN_SKILL_NAMES],
          ...(isExternal && { authToken: crypto.randomUUID() }),
        }
      })

      if (result.success && result.data) {
        const chatId = result.data.chat_id

        // Wait for ProfileDataManager to receive the new Chat configuration
        logger.debug('[CreateCustomAgentViewContent] Waiting for chat to appear in cache:', chatId)
        const chatAvailable = await waitForChatInCache(chatId)

        if (chatAvailable) {
          showToast(`Agent "${formData.name}" created successfully!`, 'success')
          // Navigate to the agent/chat/{chat_id}/settings/workspace page
          navigate(`/agent/chat/${chatId}/settings/workspace`)
        } else {
          logger.warn('[CreateCustomAgentViewContent] Chat not found in cache after timeout, navigating anyway')
          showToast(`Agent "${formData.name}" created successfully!`, 'success')
          navigate(`/agent/chat/${chatId}/settings/workspace`)
        }
      } else {
        showToast(result.error || 'Failed to create agent', 'error')
      }
    } catch (error) {
      logger.error('[CreateCustomAgentViewContent] Failed to create agent:', error)
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

      {/* Agent Source section — only show when External Agent feature is enabled */}
      {externalAgentEnabled && (
      <div className="agent-model-section">
        <label className="form-label">Agent Source</label>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            type="button"
            className={`model-option ${formData.source === 'ON-DEVICE' ? 'selected' : ''}`}
            onClick={() => {
              setFormData(prev => ({ ...prev, source: 'ON-DEVICE' }))
            }}
            style={{
              flex: 1,
              padding: '8px 12px',
              borderRadius: '6px',
              border: `1px solid ${formData.source === 'ON-DEVICE' ? 'var(--accent-color, #0078d4)' : 'var(--border-color, #ddd)'}`,
              backgroundColor: formData.source === 'ON-DEVICE' ? 'var(--accent-bg, rgba(0,120,212,0.1))' : 'transparent',
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            <div style={{ fontWeight: 500 }}>🤖 Normal Agent</div>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>AI agent powered by your configured model</div>
          </button>
          <button
            type="button"
            className={`model-option ${formData.source === 'EXTERNAL' ? 'selected' : ''}`}
            onClick={() => {
              setFormData(prev => ({ ...prev, source: 'EXTERNAL' }))
            }}
            style={{
              flex: 1,
              padding: '8px 12px',
              borderRadius: '6px',
              border: `1px solid ${formData.source === 'EXTERNAL' ? 'var(--accent-color, #0078d4)' : 'var(--border-color, #ddd)'}`,
              backgroundColor: formData.source === 'EXTERNAL' ? 'var(--accent-bg, rgba(0,120,212,0.1))' : 'transparent',
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            <div style={{ fontWeight: 500 }}>🐾 External Agent</div>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>Connect to an external AI service</div>
          </button>
        </div>
      </div>
      )}

      {/* Agent Model section (hidden for External Agent — external LLM) */}
      {formData.source !== 'EXTERNAL' && (
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
                    ref={formData.model === model.id ? selectedModelOptionRef : undefined}
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
      )}

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