import { useState, useRef, useEffect, memo } from 'react';
import { profileDataManager } from '@/lib/userData/profileDataManager';
import { useAgentConfig } from '../../userData/userDataProvider';
import { getModelById, getModelCapabilities } from '@/lib/models/ghcModels';
import { useAvailableModels } from '@/lib/models/useAvailableModels';
import { useScrollSelectedIntoView } from '@/lib/hooks/useScrollSelectedIntoView';

interface Props {
  currentChatId: string | null;
  shouldLockComposeUi: boolean;
  setSupportsImages: (supports: boolean) => void;
}

function Selector(props: Props) {
  const { currentChatId, shouldLockComposeUi, setSupportsImages } = props;

  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const modelDropdownRef = useRef<HTMLDivElement>(null);
  // Get the current model from profileDataManager
  // Use currentChatId to look up the corresponding model id in config
  const [currentModel, setCurrentModel] = useState<string | null>(() => {
    return currentChatId ? profileDataManager.getSelectedModel(currentChatId) : null;
  });

  // Local pending state to immediately reflect UI selection
  const [pendingModel, setPendingModel] = useState<string | null>(null);

  // Use the pending model (or actual current model) to drive the UI
  const displayModel = pendingModel || currentModel;

  useEffect(() => {
    const currentModelCapabilities = displayModel
      ? getModelCapabilities(displayModel)
      : null;
    const supportsImages = currentModelCapabilities?.supportsImages ?? false;
    setSupportsImages(supportsImages);
  }, [displayModel, setSupportsImages]);

  // Handle clicking outside to close model dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        modelDropdownRef.current &&
        !modelDropdownRef.current.contains(event.target as Node)
      ) {
        setShowModelDropdown(false);
      }
    };

    if (showModelDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [showModelDropdown]);

  // Watch currentChatId changes and fetch the new model from profileDataManager
  useEffect(() => {
    if (currentChatId) {
      const newModel = profileDataManager.getSelectedModel(currentChatId);
      setCurrentModel(newModel);
      // Clear pending state and show the new agent's model
      setPendingModel(null);
    } else {
      setCurrentModel(null);
      setPendingModel(null);
    }
  }, [currentChatId]);

  // Watch ProfileDataManager config changes and update the model
  useEffect(() => {
    const unsubscribe = profileDataManager.subscribe((cache) => {
      if (!currentChatId) return;

      // Get the current chat's model from config
      const updatedModel = profileDataManager.getSelectedModel(currentChatId);

      // Only update when the model actually changes
      if (updatedModel !== currentModel) {
        setCurrentModel(updatedModel);
        // Clear pending state and use the latest value from ProfileDataManager
        setPendingModel(null);
      }
    });

    return unsubscribe;
  }, [currentChatId, currentModel]);

  // When currentModel updates, clear the pending state if it matches
  useEffect(() => {
    if (currentModel && pendingModel && currentModel === pendingModel) {
      setPendingModel(null);
    }
  }, [currentModel, pendingModel]);

  // Get the updateModel function and isLoading state
  const { updateModel, isLoading } = useAgentConfig();

  // Available OpenKosmos models — loaded from the renderer-side cache and kept
  // in sync with `modelCacheUpdated` events via the shared hook.
  const { models: availableModels } = useAvailableModels();

  // Scroll the currently selected option into view when the dropdown opens.
  const selectedOptionRef = useScrollSelectedIntoView<HTMLButtonElement>(
    showModelDropdown,
    displayModel,
    availableModels.length,
  );

  // Handle model selection
  const handleModelSelect = async (modelId: string) => {
    if (isLoading) return;

    // FIX: Set pending state immediately to update the UI
    setPendingModel(modelId);

    try {
      const result = await updateModel(modelId);

      if (result.success) {
      } else {
        // FIX: If the update fails, clear the pending state
        setPendingModel(null);
      }
    } catch (error) {
      // FIX: If an error occurs, clear the pending state
      setPendingModel(null);
    }

    setShowModelDropdown(false);
  };

  // Get current model info and capabilities - uses displayModel
  const currentModelInfo = displayModel ? getModelById(displayModel) : null;

  return (
    <div className="model-selector" ref={modelDropdownRef}>
      <button
        className="model-button"
        onClick={() => setShowModelDropdown(!showModelDropdown)}
        disabled={isLoading || shouldLockComposeUi}
        title="Select AI Model"
      >
        <span className="model-name">
          {currentModelInfo?.name || 'Select Model'}
        </span>
        <svg
          className={`dropdown-arrow ${showModelDropdown ? 'rotated' : ''
            }`}
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
                ref={displayModel === model.id ? selectedOptionRef : undefined}
                className={`model-option ${displayModel === model.id ? 'selected' : ''
                  }`}
                onClick={() => handleModelSelect(model.id)}
                disabled={isLoading || shouldLockComposeUi}
              >
                <div className="model-info chat-input-vertical">
                  <span className="model-option-name">{model.name}</span>
                  <div className="model-badges">
                    {(model.capabilities.family.includes('o3') ||
                      model.capabilities.family.includes('o4')) && (
                        <span className="badge reasoning">Reasoning</span>
                      )}
                    {model.capabilities.supports.tool_calls && (
                      <span className="badge tools">Tools</span>
                    )}
                    {model.capabilities.supports.vision && (
                      <span className="badge files">Image</span>
                    )}
                  </div>
                </div>
                {displayModel === model.id && (
                  <svg
                    className="check-icon"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export const ModelSelector = memo(Selector);
