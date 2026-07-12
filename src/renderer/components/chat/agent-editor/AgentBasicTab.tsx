import React, { useState, useCallback, useEffect } from 'react'

import '../../../styles/Agent.css';
import { TabComponentProps } from './types'
import { getAllOpenKosmosUsedModels, getDefaultModel } from '../../../lib/models/ghcModels'
import EmojiPicker from './EmojiPicker'
import { useChats } from '../../userData/userDataProvider'
import { AgentAvatar } from '../../common/AgentAvatar'
import ExternalAgentConnectionConfig from './ExternalAgentConnectionConfig'
import { useScrollSelectedIntoView } from '../../../lib/hooks/useScrollSelectedIntoView'
import { resolveChatAgent } from '@/lib/agent'
import { useI18n } from '../../../lib/i18n/useI18n'

const AgentBasicTab: React.FC<TabComponentProps> = ({
  mode,
  chatId,
  agentData,
  onSave,
  onAgentCreated,
  onDataChange,
  cachedData,
  fieldErrors,
  readOnly = false
}) => {
  // Get all chats for duplicate name checking
  const { chats } = useChats()
  const { t } = useI18n()

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    emoji: '🤖',
    avatar: '',
    role: '', // Retained but unused
    model: getDefaultModel()
  })

  // Agent metadata (read-only display)
  const [agentMeta, setAgentMeta] = useState({
    version: '',
    source: '' as '' | 'IN-LIBRARY' | 'ON-DEVICE' | 'EXTERNAL'
  })

  // UI state
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [showModelDropdown, setShowModelDropdown] = useState(false)
  const [isInitialized, setIsInitialized] = useState(false)
  const [loadedAgentId, setLoadedAgentId] = useState<string | null>(null)
  const [nameWarning, setNameWarning] = useState<string>('')

  // External Agent mode detection
  const isExternalAgent = agentData?.source === 'EXTERNAL'

  // Check if this is the Kobi Agent (emoji modification is prohibited)
  const isKobiAgent = agentData?.name?.toLowerCase() === 'kobi'

  const isAvatarNameDisabled = readOnly || isKobiAgent
  const isModelDisabled = readOnly

  // Initial data used to detect modifications
  const [initialData, setInitialData] = useState({
    name: '',
    emoji: '🤖',
    avatar: '',
    role: '',
    model: getDefaultModel()
  })

  // Available model list
  const [availableModels, setAvailableModels] = useState<any[]>([])
  const modelDropdownRef = React.useRef<HTMLDivElement>(null)
  const selectedModelOptionRef = useScrollSelectedIntoView<HTMLButtonElement>(
    showModelDropdown,
    formData.model,
    availableModels.length,
  )

  // Load available models (passive sync: initial load + listen for backend push updates)
  useEffect(() => {
    const loadModels = () => {
      const models = getAllOpenKosmosUsedModels()
      setAvailableModels(models)
    }
    loadModels()
    const handleModelCacheUpdated = () => { loadModels() }
    window.addEventListener('modelCacheUpdated', handleModelCacheUpdated)
    return () => { window.removeEventListener('modelCacheUpdated', handleModelCacheUpdated) }
  }, [])

  // Load existing data - only runs on initial component mount or when explicit re-sync is needed
  useEffect(() => {
    // In Update mode, or Add mode when agent is already created, sync data to form
    if (agentData && (mode === 'update' || (mode === 'add' && agentData.id))) {
      // Only reset form data when not yet initialized or chatId changes
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
          source: agentData.source || ''
        })

        // If cached data exists, prefer it over the base data
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
        source: ''
      })

      // If cached data exists, use it
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


  // Check for duplicate Agent name
  const checkDuplicateName = useCallback((name: string): boolean => {
    // In Update mode, exclude the agent currently being edited
    const currentAgentName = agentData?.name

    return chats.some(chat => {
      const agent = resolveChatAgent(chat)
      // Skip current agent being edited
      if (mode === 'update' && agent?.name === currentAgentName) {
        return false
      }
      return agent?.name === name.trim()
    })
  }, [chats, agentData?.name, mode])

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

  // Handle input change
  const handleInputChange = useCallback((field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }))

    // For the name field, check for duplicates in real time
    if (field === 'name') {
      if (value.trim() && checkDuplicateName(value)) {
        setNameWarning(t('agent.create.nameAlreadyExistsWarning'))
      } else {
        setNameWarning('')
      }
    }

    // When the user starts typing, the parent clears field errors via onDataChange
    // (which prompts the parent to refresh fieldErrors).
  }, [checkDuplicateName, t])

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

  return (
    <div className="agent-tab">
      {/* Tab Body */}
      <div className="tab-body">
        {/* Avatar Section */}
        <div className="form-section">
          <label className="form-label">{t('agent.create.avatar')}</label>
          <div className="emoji-section">
            <div
              className={`emoji-display ${isAvatarNameDisabled ? 'disabled' : ''}`}
              onClick={() => !isAvatarNameDisabled && setShowEmojiPicker(true)}
              title={readOnly ? t('agent.create.avatarReadonly') : isKobiAgent ? t('agent.create.kobiAvatarReadonly') : t('agent.create.clickChangeAvatar')}
              style={isAvatarNameDisabled ? { cursor: 'not-allowed', opacity: 0.6 } : undefined}
            >
              {/* Preserve persisted avatars while allowing local edits. */}
              <AgentAvatar
                emoji={formData.emoji}
                avatar={formData.avatar}
                source={agentMeta.source || 'ON-DEVICE'}
                name={formData.name}
                size="lg"
                version={agentMeta.version}
              />
            </div>
            <span className="emoji-hint">
              {readOnly ? t('agent.create.avatarReadonly') : isKobiAgent ? t('agent.create.kobiAvatarReadonly') : t('agent.create.clickChooseAvatar')}
            </span>
          </div>
        </div>

        {/* Agent Name */}
        <div className="form-section">
          <label className="form-label">{t('agent.create.name')}</label>
          <input
            type="text"
            className={`form-input ${fieldErrors?.name ? 'warning' : ''} ${nameWarning ? 'warning' : ''}`}
            value={formData.name}
            onChange={(e) => handleInputChange('name', e.target.value)}
            placeholder={t('agent.create.namePlaceholder')}
            disabled={isAvatarNameDisabled}
          />
          {fieldErrors?.name && (
            <div className="warning-message">{fieldErrors.name}</div>
          )}
          {nameWarning && !fieldErrors?.name && (
            <div className="warning-message">{nameWarning}</div>
          )}
        </div>

        {/* Model Selection (hidden for External Agent) */}
        {!isExternalAgent && (
        <div className="form-section">
          <label className="form-label">{t('agent.create.model')}</label>
          <div className="model-selector" ref={modelDropdownRef}>
            <button
              type="button"
              className="model-button"
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
                {availableModels.find(m => m.id === formData.model)?.name || t('agent.create.selectModel')}
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
                      ref={formData.model === model.id ? selectedModelOptionRef : undefined}
                      type="button"
                      className={`model-option ${formData.model === model.id ? 'selected' : ''}`}
                      onClick={() => handleModelSelect(model.id)}
                    >
                      <div className="model-info">
                        <span className="model-option-name">{model.name}</span>
                        <div className="model-badges">
                          {(model.capabilities.family.includes('o3') || model.capabilities.family.includes('o4')) && <span className="badge reasoning">{t('agent.create.badgeReasoning')}</span>}
                          {model.capabilities.supports.tool_calls && <span className="badge tools">{t('agent.create.badgeTools')}</span>}
                          {model.capabilities.supports.vision && <span className="badge files">{t('agent.create.badgeImage')}</span>}
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

        {/* Version and Source (Read-only, only show when has value) */}
        {(agentMeta.version || agentMeta.source) && (
          <div className="form-section agent-meta-section">
            <label className="form-label">{t('agent.create.agentInfo')}</label>
            <div className="agent-meta-row">
              {agentMeta.version && (
                <div className="agent-meta-item">
                  <span className="agent-meta-label">{t('agent.create.versionLabel')}</span>
                  <span className="agent-meta-value">{agentMeta.version}</span>
                </div>
              )}
              {agentMeta.source && (
                <div className="agent-meta-item">
                  <span className="agent-meta-label">{t('agent.create.sourceLabel')}</span>
                  <span className="agent-meta-badge device">
                    {agentMeta.source === 'EXTERNAL' ? t('agent.create.sourceExternal') : t('agent.create.sourceOnDevice')}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* External Agent Connection Config (only for EXTERNAL source agents) */}
        {isExternalAgent && <ExternalAgentConnectionConfig token={agentData?.authToken} />}
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
