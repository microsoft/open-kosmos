import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { GhcCopilotModel } from '@shared/types/ghcChatTypes'
import { INHERIT_MODEL_VALUE } from '@shared/constants/subAgent'
import { useAvailableModels } from '@/lib/models/useAvailableModels'
import { useScrollSelectedIntoView } from '@/lib/hooks/useScrollSelectedIntoView'
import '../../styles/SubAgentModelSelect.css'

interface SubAgentModelSelectProps {
  value: string
  onChange: (value: string) => void
}

const SubAgentModelSelect: React.FC<SubAgentModelSelectProps> = ({ value, onChange }) => {
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const {
    models: availableModels,
    isLoading: isLoadingModels,
    error: modelLoadError,
    refresh: refreshModels,
  } = useAvailableModels({ fetchOnEmpty: true })

  const selectedValue = value?.trim() || INHERIT_MODEL_VALUE
  const selectedOptionRef = useScrollSelectedIntoView<HTMLButtonElement>(
    isOpen,
    selectedValue,
    availableModels.length,
  )
  const selectedModel = useMemo(
    () => availableModels.find(model => model.id === selectedValue),
    [availableModels, selectedValue],
  )
  const selectedLabel = selectedValue === INHERIT_MODEL_VALUE
    ? 'Inherit parent model'
    : selectedModel?.name || selectedValue
  const shouldShowCurrentModelOption = selectedValue !== INHERIT_MODEL_VALUE && !selectedModel

  useEffect(() => {
    if (!isOpen) return

    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  const handleSelect = (modelId: string) => {
    onChange(modelId)
    setIsOpen(false)
  }

  const handleToggle = () => {
    const nextOpen = !isOpen
    setIsOpen(nextOpen)
    if (nextOpen && availableModels.length === 0 && !isLoadingModels) {
      void refreshModels(true)
    }
  }

  const renderModelBadges = (model: GhcCopilotModel) => {
    const supports = model.capabilities?.supports

    return (
      <div className="model-badges">
        {supports?.tool_calls && <span className="badge tools">Tools</span>}
        {supports?.vision && <span className="badge files">Image</span>}
      </div>
    )
  }

  const renderCheckIcon = (isSelected: boolean) => isSelected ? (
    <svg className="check-icon" fill="currentColor" viewBox="0 0 20 20">
      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
    </svg>
  ) : null

  return (
    <div className="sub-agent-model-selector" ref={dropdownRef}>
      <button
        type="button"
        className="model-button"
        onClick={handleToggle}
        title="Select AI Model"
      >
        <span className="model-name">{selectedLabel}</span>
        <svg
          className={`dropdown-arrow ${isOpen ? 'rotated' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="model-dropdown">
          <div className="model-list">
            <button
              ref={selectedValue === INHERIT_MODEL_VALUE ? selectedOptionRef : undefined}
              type="button"
              className={`model-option ${selectedValue === INHERIT_MODEL_VALUE ? 'selected' : ''}`}
              onClick={() => handleSelect(INHERIT_MODEL_VALUE)}
            >
              <div className="model-info">
                <span className="model-option-name">Inherit parent model</span>
                <div className="model-badges">
                  <span className="badge default">Default</span>
                </div>
              </div>
              {renderCheckIcon(selectedValue === INHERIT_MODEL_VALUE)}
            </button>

            {shouldShowCurrentModelOption && (
              <button
                ref={selectedOptionRef}
                type="button"
                className="model-option selected"
                onClick={() => handleSelect(selectedValue)}
              >
                <div className="model-info">
                  <span className="model-option-name">{selectedValue}</span>
                  <div className="model-badges">
                    <span className="badge current">Current</span>
                  </div>
                </div>
                {renderCheckIcon(true)}
              </button>
            )}

            {availableModels.map(model => (
              <button
                key={model.id}
                ref={selectedValue === model.id ? selectedOptionRef : undefined}
                type="button"
                className={`model-option ${selectedValue === model.id ? 'selected' : ''}`}
                onClick={() => handleSelect(model.id)}
              >
                <div className="model-info">
                  <span className="model-option-name">{model.name}</span>
                  {renderModelBadges(model)}
                </div>
                {renderCheckIcon(selectedValue === model.id)}
              </button>
            ))}

            {isLoadingModels && (
              <button type="button" className="model-option disabled" disabled>
                <div className="model-info">
                  <span className="model-option-name">Loading models...</span>
                </div>
              </button>
            )}

            {!isLoadingModels && availableModels.length === 0 && (
              <button type="button" className="model-option disabled" disabled>
                <div className="model-info">
                  <span className="model-option-name">
                    {modelLoadError || 'No specific models available'}
                  </span>
                </div>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default SubAgentModelSelect