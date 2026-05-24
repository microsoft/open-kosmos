import React, { useState, useCallback, useEffect } from 'react'

import '../../../styles/Agent.css';
import { TabComponentProps } from './types'
import MarkdownEditor from './MarkdownEditor'
import { useToast } from '../../ui/ToastProvider'

const AgentSystemPromptTab: React.FC<TabComponentProps> = ({
  mode,
  agentId,
  agentData,
  onSave,
  onDataChange,
  cachedData,
  readOnly = false
}) => {
  // Check if this is the Kobi Agent (system prompt modification is prohibited)
  const isKobiAgent = agentData?.name?.toLowerCase() === 'kobi'

  // Check if editing is disabled (read-only mode or Kobi Agent)
  const isEditDisabled = readOnly || isKobiAgent

  const [systemPrompt, setSystemPrompt] = useState('')
  const [showPreview, setShowPreview] = useState(false)
  const [isOptimizing, setIsOptimizing] = useState(false)
  const [optimizationError, setOptimizationError] = useState<string | null>(null)
  const [optimizationWarnings, setOptimizationWarnings] = useState<string[]>([])
  const [isInitialized, setIsInitialized] = useState(false)

  // Initial data used to detect modifications
  const [initialSystemPrompt, setInitialSystemPrompt] = useState('')

  // Load existing system prompt - only runs on initial component mount or when explicit re-sync is needed
  useEffect(() => {
    // Avoid resetting state while user is editing
    if (!isInitialized) {
      let basePrompt = ''
      if (agentData?.systemPrompt !== undefined) {
        // If systemPrompt has an explicit value (including empty string)
        basePrompt = agentData.systemPrompt
      } else if (mode === 'update') {
        // Only set default system prompt in update mode
        basePrompt = `You are a helpful AI assistant.

Please follow these guidelines:
- Be concise and clear
- Provide accurate information
- Ask clarifying questions when needed

## Specific Instructions
Add your specific instructions here...`
      }

      // If cached data exists, prefer it over the base prompt
      const finalPrompt = cachedData?.systemPrompt !== undefined ? cachedData.systemPrompt : basePrompt

      setSystemPrompt(finalPrompt)
      setInitialSystemPrompt(basePrompt) // Initial data is always the original data
      setIsInitialized(true)
    }
  }, [agentData?.id, mode, isInitialized, cachedData])

  // Check if data has been modified
  const hasChanges = useCallback(() => {
    return systemPrompt !== initialSystemPrompt
  }, [systemPrompt, initialSystemPrompt])

  // Notify parent component when data changes
  useEffect(() => {
    if (isInitialized && onDataChange) {
      const changes = hasChanges()
      onDataChange('prompt', { systemPrompt }, changes)
    }
  }, [systemPrompt, hasChanges, isInitialized, onDataChange])

  // Toggle edit/preview mode
  const handleTogglePreview = useCallback(() => {
    setShowPreview(prev => !prev)
  }, [])

  // Handle content change
  const handleContentChange = useCallback((value: string) => {
    setSystemPrompt(value)
    // When content changes, clear previous errors and warnings
    if (optimizationError) {
      setOptimizationError(null)
    }
    if (optimizationWarnings.length > 0) {
      setOptimizationWarnings([])
    }
  }, [optimizationError, optimizationWarnings.length])

  // AI optimization feature
  const handleAIOptimize = useCallback(async () => {
    // Clear previous errors and warnings
    setOptimizationError(null)
    setOptimizationWarnings([])

    // Validate that input is not empty
    const trimmedPrompt = systemPrompt.trim()
    if (!trimmedPrompt) {
      setOptimizationError('System prompt cannot be empty.')
      return
    }

    setIsOptimizing(true)
    try {

      // Call the main process systemPromptLlmWriter via IPC
      const ipcResult = await window.electronAPI?.llm?.improveSystemPrompt(trimmedPrompt)

      if (!ipcResult) {
        throw new Error('LLM API not available')
      }


      if (ipcResult.success && ipcResult.data) {
        const result = ipcResult.data

        if (result.success && result.improvedPrompt) {
          setSystemPrompt(result.improvedPrompt)
          if (result.warnings && result.warnings.length > 0) {
            setOptimizationWarnings(result.warnings)
          }
        } else {
          const errorMessages = result.errors || ['AI optimization failed with unknown error']
          setOptimizationError(errorMessages.join('; '))
        }
      } else {
        throw new Error(ipcResult.error || 'AI optimization failed')
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred during AI optimization'
      setOptimizationError(`AI optimization failed: ${errorMessage}`)
    } finally {
      setIsOptimizing(false)
    }
  }, [systemPrompt])

  return (
    <div className="agent-tab">
      {/* Tab Header */}
      <div className="tab-header">
        <div className="header-tabs">
          <div
            className={`header-tab ${!showPreview ? 'active' : ''}`}
            onClick={() => !showPreview || handleTogglePreview()}
          >
            Contents
          </div>
          <div
            className={`header-tab ${showPreview ? 'active' : ''}`}
            onClick={() => showPreview || handleTogglePreview()}
          >
            Preview
          </div>
        </div>
        <div className="header-actions">
          {!isEditDisabled && (
            <button
              className="system-btn"
              onClick={handleAIOptimize}
              disabled={isOptimizing || !systemPrompt.trim()}
              title={!systemPrompt.trim() ? 'Enter a prompt first' : 'Polish prompt'}
            >
              {isOptimizing ? 'Polishing...' : 'Polish with AI'}
            </button>
          )}
        </div>
      </div>

      {/* Tab Body */}
      <div className="tab-body">
        <MarkdownEditor
          value={systemPrompt}
          onChange={handleContentChange}
          showPreview={showPreview}
          onTogglePreview={handleTogglePreview}
          readOnly={isEditDisabled}
        />
        {isEditDisabled && (
          <div style={{
            marginTop: '12px',
            padding: '12px',
            backgroundColor: '#fef3c7',
            borderRadius: '8px',
            color: '#92400e',
            fontSize: '14px'
          }}>
            ⚠️ {readOnly ? "Library Agent's system prompt cannot be modified." : "Kobi Agent's system prompt cannot be modified."}
          </div>
        )}
      </div>

    </div>
  )
}

export default AgentSystemPromptTab