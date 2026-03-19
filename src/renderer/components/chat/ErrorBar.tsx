import React from 'react';
import '../../styles/ErrorBar.css';
import { MODEL_CATEGORIES } from '../../lib/models/ghcModels';
import { profileDataManager } from '../../lib/userData';
import { agentChatSessionCacheManager } from '../../lib/chat/agentChatSessionCacheManager';

interface ErrorBarProps {
  errorMessage: string;
  chatSessionId: string;
  onRetry: (chatSessionId: string) => void;
}

/**
 * Get the currently used model ID based on chatSessionId
 */
function getCurrentModelForSession(chatSessionId: string): string | null {
  const cache = agentChatSessionCacheManager.getChatSessionCache(chatSessionId);
  if (cache?.chatId) {
    return profileDataManager.getSelectedModel(cache.chatId);
  }
  return profileDataManager.getCurrentModel();
}

/**
 * Check if the model is a Claude series model
 */
function isClaudeModel(modelId: string): boolean {
  return MODEL_CATEGORIES.claude.some(
    (id) => modelId.toLowerCase().includes(id.toLowerCase()) || id.toLowerCase().includes(modelId.toLowerCase())
  );
}

/**
 * Generate fix suggestions based on error message and current model
 * @param errorMessage Error message text
 * @param chatSessionId Current ChatSession ID
 * @returns Fix suggestion text, or null if none
 */
function getFixSuggestion(errorMessage: string, chatSessionId: string): string | null {
  const lowerMsg = errorMessage.toLowerCase();
  const currentModel = getCurrentModelForSession(chatSessionId);
  const isClaude = currentModel ? isClaudeModel(currentModel) : false;

  if (
    isClaude &&
    (lowerMsg.includes('model is not supported') ||
      lowerMsg.includes('not available') ||
      lowerMsg.includes('region') ||
      lowerMsg.includes('blocked'))
  ) {
    return 'Please check if your VPN is connected. Claude models are restricted in some regions (e.g., mainland China). You need to use a VPN to connect from a supported region.';
  }

  // 🔥 Network interruption/connection termination errors
  if (
    lowerMsg.includes('terminated') ||
    lowerMsg.includes('connection terminated') ||
    lowerMsg.includes('network connection') ||
    lowerMsg.includes('fetch failed')
  ) {
    return 'This is usually caused by network interruption during streaming. Please check your VPN/network connection and click Retry.';
  }

  // 🔥 500 Internal server error
  if (
    lowerMsg.includes('internal error') ||
    lowerMsg.includes('server internal error') ||
    lowerMsg.includes('status: 500')
  ) {
    return 'Server encountered an internal error. This may be caused by overly long context or complex tool calls. Try starting a new conversation or simplifying your request.';
  }

  // 🔥 Truncation related errors
  if (
    lowerMsg.includes('truncat') ||
    lowerMsg.includes('incomplete json')
  ) {
    return 'The response was truncated. Try breaking down your request into smaller, simpler tasks.';
  }

  return null;
}

/**
 * ErrorBar - Error notification bar component
 *
 * Displayed above ChatInput, similar to ApprovalBar
 * Shows error message on the left, Retry button on the right
 * Automatically shows fix suggestions when known error patterns are detected
 */
const ErrorBar: React.FC<ErrorBarProps> = ({ errorMessage, chatSessionId, onRetry }) => {
  const handleRetry = () => {
    onRetry(chatSessionId);
  };

  const fixSuggestion = getFixSuggestion(errorMessage, chatSessionId);

  return (
    <div className="error-bar">
      <div className="error-bar-content">
        <div className="error-bar-icon">⚠️</div>
        <div className="error-bar-message">
          {errorMessage}
          {fixSuggestion && (
            <span> {fixSuggestion}</span>
          )}
        </div>
        <button
          className="error-bar-btn retry"
          onClick={handleRetry}
          title="Retry the failed request"
          aria-label="Retry"
        >
          Retry
        </button>
      </div>
    </div>
  );
};

export default ErrorBar;
