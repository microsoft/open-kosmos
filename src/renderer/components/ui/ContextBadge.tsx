import React, { useState, useEffect, useCallback } from 'react';
import { Badge } from '../ui/badge';
import { useAgentConfig } from '../userData/userDataProvider';
import { getModelById } from '../../lib/models/ghcModels';
import { agentChatIpc } from '../../lib/chat/agentChatIpc';
import { agentChatSessionCacheManager } from '../../lib/chat/agentChatSessionCacheManager';
import { createLogger } from '../../lib/utilities/logger';
const logger = createLogger('[ContextBadge]');

// 🔄 Added: define ContextStats interface (consistent with the interface in AgentChat)
interface ContextStats {
  totalMessages: number      // Total message count
  contextMessages: number    // Message count after compression
  tokenCount: number         // Current token count
  compressionRatio: number   // Compression ratio (0.0-1.0)
}

/**
 * Format token count to k format
 * e.g.: 128000 -> 128.0k, 1900 -> 1.9k
 */
function formatTokenCount(tokens: number): string {
  if (tokens >= 1000) {
    const kValue = tokens / 1000;
    // Keep one decimal place, but don't show if decimal part is 0
    return kValue % 1 === 0 ? `${kValue.toFixed(0)}k` : `${kValue.toFixed(1)}k`;
  }
  return tokens.toString();
}

export const ContextBadge: React.FC = () => {
  const { currentModel } = useAgentConfig();
  const [contextTokens, setContextTokens] = useState<number>(0);
  const [modelContextWindow, setModelContextWindow] = useState<number>(0);
  const [loading, setLoading] = useState(false);

  // 🔥 Key: track current chatSessionId
  const [currentChatSessionId, setCurrentChatSessionId] = useState<string | null>(null);

  // 🔥 Track modelCacheManager data update version to ensure recalculation after model data sync
  const [modelCacheVersion, setModelCacheVersion] = useState<number>(0);

  // 🔥 Fix: extract model context window calculation into a callback for reuse across multiple effects
  const updateModelContextWindow = useCallback(() => {
    if (currentModel) {
      const model = getModelById(currentModel);
      if (model) {
        const limits = model.capabilities.limits;
        const effectiveInputLimit = limits?.max_prompt_tokens || limits?.max_context_window_tokens || 128000;
        setModelContextWindow(effectiveInputLimit);
      } else {
        // Model data not yet loaded or model ID invalid, use default value
        logger.warn('[ContextBadge] Model not found in cache, using default context window', { currentModel });
        setModelContextWindow(128000);
      }
    } else {
      setModelContextWindow(0);
    }
  }, [currentModel]);

  // Get model context window size
  // Use max_prompt_tokens (API actual input limit) instead of max_context_window_tokens (total window including output)
  // e.g. claude-sonnet-4.6: max_context_window_tokens=200k, but max_prompt_tokens=128k, API returns 400 at 128k
  useEffect(() => {
    updateModelContextWindow();
  }, [currentModel, modelCacheVersion, updateModelContextWindow]);

  // 🔥 Listen to modelCacheUpdated event, recalculate context window after backend model data sync completes
  useEffect(() => {
    const handleModelCacheUpdated = () => {
      logger.debug('[ContextBadge] 🔄 Model cache updated, refreshing context window size');
      setModelCacheVersion(v => v + 1);
    };

    window.addEventListener('modelCacheUpdated', handleModelCacheUpdated);
    return () => {
      window.removeEventListener('modelCacheUpdated', handleModelCacheUpdated);
    };
  }, []);

  // 🔥 Listen to agentChatSessionCacheManager changes to get currentChatSessionId
  useEffect(() => {
    // Initialize: get current value
    const sessionId = agentChatSessionCacheManager.getCurrentChatSessionId();
    setCurrentChatSessionId(sessionId);

    logger.debug('[ContextBadge] Initial chatSessionId', { sessionId });

    // Subscribe to currentChatSessionId changes
    const unsubscribe = agentChatSessionCacheManager.subscribeToCurrentChatSessionId((newSessionId) => {
      logger.debug('[ContextBadge] ChatSessionId changed', {
        oldSessionId: currentChatSessionId,
        newSessionId,
        format: 'chatSession_YYYYMMDDHHMMSS_<deviceid>_<random>'
      });
      setCurrentChatSessionId(newSessionId);
    });

    return unsubscribe;
  }, []);

  // 🔥 Core logic: initialize and listen to context changes
  useEffect(() => {
    let notificationReceived = false;
    let isMounted = true;

    const handleContextChange = (stats: ContextStats) => {
      if (!isMounted) return;

      logger.debug('[ContextBadge] 📊 Context change received', {
        tokenCount: stats.tokenCount,
        notificationReceived
      });

      notificationReceived = true;
      setContextTokens(stats.tokenCount);
      setLoading(false);
    };

    // 🔥 Key fix: proactively fetch initial Token data after Session switch
    const initializeTokenData = async () => {
      try {
        logger.debug('[ContextBadge] 🔄 Initializing token data...');
        setLoading(true);

        // Proactively pull current Session's token usage from backend
        const tokenUsage = await agentChatIpc.getCurrentContextTokenUsage();

        if (isMounted && tokenUsage) {
          logger.debug('[ContextBadge] ✅ Initial token data loaded', {
            tokenCount: tokenUsage.tokenCount
          });
          notificationReceived = true;
          setContextTokens(tokenUsage.tokenCount);
          setLoading(false);
        } else if (isMounted) {
          logger.warn('[ContextBadge] ⚠️ No token usage data available');
          setContextTokens(0);
          setLoading(false);
        }
      } catch (error) {
        logger.error('[ContextBadge] ❌ Failed to initialize token data:', error);
        if (isMounted) {
          setContextTokens(0);
          setLoading(false);
        }
      }
    };

    // Register listener (for subsequent dynamic updates)
    agentChatIpc.addContextChangeListener(handleContextChange);

    // Proactively pull initial data
    initializeTokenData();

    // 🔄 Fix: set timeout mechanism as fallback
    const fallbackTimeout = setTimeout(() => {
      if (!notificationReceived && isMounted) {
        logger.warn('[ContextBadge] ⏱️ Timeout: No context data received');
        setContextTokens(0);
        setLoading(false);
      }
    }, 5000);

    // Cleanup function
    return () => {
      isMounted = false;
      clearTimeout(fallbackTimeout);
      agentChatIpc.removeContextChangeListener(handleContextChange);
    };
  }, [currentChatSessionId]); // 🔥 Key: depends on currentChatSessionId, reinitializes when Session switches

  // Calculate utilization ratio
  const utilizationRatio = modelContextWindow > 0 ? contextTokens / modelContextWindow : 0;

  // Determine badge variant based on utilization ratio
  let variant: "default" | "secondary" | "destructive" | "outline" | "success" | "normal" = "normal";
  if (utilizationRatio > 0.9) {
    variant = "destructive"; // Show red when over 90%
  } else if (utilizationRatio > 0.7) {
    variant = "outline"; // Show warning color when over 70%
  } else if (utilizationRatio > 0) {
    variant = "normal"; // Show unified normal style when in use
  }

  const contextText = formatTokenCount(contextTokens);
  const windowText = formatTokenCount(modelContextWindow);

  return (
    <Badge
      variant={variant}
      className="text-xs"
      title={`Context usage: ${contextTokens.toLocaleString()} / ${modelContextWindow.toLocaleString()} tokens (${(utilizationRatio * 100).toFixed(1)}%)`}
    >
      {loading ? (
        'context: loading...'
      ) : (
        `context: ${contextText}/${windowText}`
      )}
    </Badge>
  );
};

export default ContextBadge;