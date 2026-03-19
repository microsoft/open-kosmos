import React, { useState, useCallback, useEffect } from 'react'

import '../../../styles/Agent.css';
import { TabComponentProps, AgentContextEnhancement } from './types'
import { useToast } from '../../ui/ToastProvider'

const AgentContextEnhanceTab: React.FC<TabComponentProps> = ({
  mode,
  agentId,
  agentData,
  onSave,
  onDataChange,
  cachedData,
  readOnly = false
}) => {
  // Form state
  const [formData, setFormData] = useState<AgentContextEnhancement>({
    search_memory: {
      enabled: false,
      semantic_similarity_threshold: 0.0,
      semantic_top_n: 5
    },
    generate_memory: {
      enabled: false
    }
  })

  // UI state
  const [isInitialized, setIsInitialized] = useState(false)
  const [loadedAgentId, setLoadedAgentId] = useState<string | null>(null)
  
  // Initial data for comparing changes
  const [initialFormData, setInitialFormData] = useState<AgentContextEnhancement>({
    search_memory: {
      enabled: false,
      semantic_similarity_threshold: 0.0,
      semantic_top_n: 5
    },
    generate_memory: {
      enabled: false
    }
  })

  // Load existing data - only on first component load or when explicit re-sync is needed
  useEffect(() => {
    // In Update mode or when agent is already created in Add mode, sync data to form
    if (agentData && (mode === 'update' || (mode === 'add' && agentData.id))) {
      // Only reset form data when uninitialized or when agentId changes
      if (!isInitialized || loadedAgentId !== agentData.id) {
        const baseData = agentData.contextEnhancement || {
          search_memory: {
            enabled: false,
            semantic_similarity_threshold: 0.0,
            semantic_top_n: 5
          },
          generate_memory: {
            enabled: false
          }
        }
        
        // If cached data exists, use cached data first
        const finalData = cachedData?.contextEnhancement || baseData
        
        setFormData(finalData)
        setInitialFormData(baseData) // Initial data is always the original data
        setLoadedAgentId(agentData.id)
        setIsInitialized(true)
      }
    } else if (!isInitialized) {
      // Initial state in Add mode
      const defaultData = {
        search_memory: {
          enabled: false,
          semantic_similarity_threshold: 0.0,
          semantic_top_n: 5
        },
        generate_memory: {
          enabled: false
        }
      }
      
      // If cached data exists, use cached data
      const finalData = cachedData?.contextEnhancement || defaultData
      
      setFormData(finalData)
      setInitialFormData(defaultData)
      setLoadedAgentId(null)
      setIsInitialized(true)
    }
  }, [mode, agentData?.id, agentData?.contextEnhancement, isInitialized, loadedAgentId, cachedData])

  // Check if data has been modified
  const hasChanges = useCallback(() => {
    return JSON.stringify(formData) !== JSON.stringify(initialFormData)
  }, [formData, initialFormData])

  // Notify parent component when data changes
  useEffect(() => {
    if (isInitialized && onDataChange) {
      const changes = hasChanges()
      onDataChange('context', { contextEnhancement: formData }, changes)
    }
  }, [formData, hasChanges, isInitialized, onDataChange])

  // Handle input changes
  const handleInputChange = useCallback((field: keyof AgentContextEnhancement, subField: string, value: boolean | number) => {
    if (readOnly) return; // Modification not allowed in read-only mode
    
    setFormData(prev => ({
      ...prev,
      [field]: {
        ...prev[field],
        [subField]: value
      }
    }))
  }, [readOnly])

  // Handle threshold change (must be within 0.0-1.0 range)
  const handleThresholdChange = useCallback((value: string) => {
    const numValue = parseFloat(value)
    if (!isNaN(numValue) && numValue >= 0.0 && numValue <= 1.0) {
      handleInputChange('search_memory', 'semantic_similarity_threshold', numValue)
    }
  }, [handleInputChange])

  // Handle Top N change (must be within 1-50 range)
  const handleTopNChange = useCallback((value: string) => {
    const numValue = parseInt(value)
    if (!isNaN(numValue) && numValue >= 1 && numValue <= 50) {
      handleInputChange('search_memory', 'semantic_top_n', numValue)
    }
  }, [handleInputChange])

  return (
    <div className="agent-tab agent-context-enhance-tab">
      {/* Tab Body */}
      <div className="tab-body">
        
        {/* Memory Search Section */}
        <div className="form-section">
          {/* Memory Search Enable Toggle */}
          <div className="form-group">
            <div className="toggle-group">
              <label className="toggle-label">
                <input
                  type="checkbox"
                  className="toggle-checkbox"
                  checked={formData.search_memory.enabled}
                  onChange={(e) => handleInputChange('search_memory', 'enabled', e.target.checked)}
                  disabled={readOnly}
                />
                <span className="toggle-slider"></span>
                <span className="toggle-text">Enable Memory Search</span>
              </label>
              <p className="toggle-description">
                When enabled, the agent will search for relevant memories from past conversations to enhance context
              </p>
            </div>
          </div>

          {/* Memory Search Configuration - Only show when enabled */}
          {formData.search_memory.enabled && (
            <>
              {/* Semantic Similarity Threshold */}
              <div className="form-group">
                <label className="form-label">
                  Semantic Similarity Threshold
                  <span className="label-value">({formData.search_memory.semantic_similarity_threshold.toFixed(2)})</span>
                </label>
                <div className="range-input-group">
                  <input
                    type="range"
                    className="range-input"
                    min="0.0"
                    max="1.0"
                    step="0.1"
                    value={formData.search_memory.semantic_similarity_threshold}
                    onChange={(e) => handleThresholdChange(e.target.value)}
                    disabled={readOnly}
                  />
                  <div className="range-labels">
                    <span>0.0 (Less Relevant)</span>
                    <span>1.0 (More Relevant)</span>
                  </div>
                </div>
                <p className="form-description">
                  Minimum similarity score for memories to be included. Higher values return more relevant but fewer results.
                </p>
              </div>

              {/* Semantic Top N */}
              <div className="form-group">
                <label className="form-label">Maximum Memory Results</label>
                <div className="number-input-group">
                  <input
                    type="number"
                    className="number-input"
                    min="1"
                    max="50"
                    value={formData.search_memory.semantic_top_n}
                    onChange={(e) => handleTopNChange(e.target.value)}
                    placeholder="5"
                    disabled={readOnly}
                  />
                  <span className="input-suffix">memories</span>
                </div>
                <p className="form-description">
                  Maximum number of relevant memories to include in context (1-50)
                </p>
              </div>
            </>
          )}
        </div>

        {/* Memory Generation Section */}
        <div className="form-section">
          {/* Memory Generation Enable Toggle */}
          <div className="form-group">
            <div className="toggle-group">
              <label className="toggle-label">
                <input
                  type="checkbox"
                  className="toggle-checkbox"
                  checked={formData.generate_memory.enabled}
                  onChange={(e) => handleInputChange('generate_memory', 'enabled', e.target.checked)}
                  disabled={readOnly}
                />
                <span className="toggle-slider"></span>
                <span className="toggle-text">Enable Memory Generation</span>
              </label>
              <p className="toggle-description">
                When enabled, the agent will automatically extract and store important facts from conversations
              </p>
            </div>
          </div>
        </div>

      </div>

    </div>
  )
}

export default AgentContextEnhanceTab