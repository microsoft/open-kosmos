import React, { useState, useEffect } from 'react';
import { Badge } from '../ui/badge';
import { useAgentConfig } from '../userData/userDataProvider';
import { getModelById } from '../../lib/models/ghcModels';
import { agentChatIpc } from '../../lib/chat/agentChatIpc';
import { agentChatSessionCacheManager } from '../../lib/chat/agentChatSessionCacheManager';
import { TextContentPart } from '../../types/chatTypes';

// 🔄 New: Define ContextStats interface (consistent with AgentChat interface)
interface ContextStats {
  totalMessages: number      // Total message count
  contextMessages: number    // Compressed message count
  tokenCount: number         // Current token count
  compressionRatio: number   // Compression ratio (0.0-1.0)
}

interface ContextBadgeProps {
  // 🔄 Modified: No longer needs agentChat prop, use global agentChatIpc directly
  agentChat?: any | null; // Kept for backward compatibility, but no longer used
}

/**
 * Format token count to k format
 * e.g.: 128000 -> 128.0k, 1900 -> 1.9k
 */
function formatTokenCount(tokens: number): string {
  if (tokens >= 1000) {
    const kValue = tokens / 1000;
    // Keep one decimal place, but omit if decimal part is 0
    return kValue % 1 === 0 ? `${kValue.toFixed(0)}k` : `${kValue.toFixed(1)}k`;
  }
  return tokens.toString();
}

export const ContextBadge: React.FC<ContextBadgeProps> = ({ agentChat }) => {
  const { currentModel } = useAgentConfig();
  const [contextTokens, setContextTokens] = useState<number>(0);
  const [modelContextWindow, setModelContextWindow] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  
  // 🔥 Key: Track current chatSessionId
  const [currentChatSessionId, setCurrentChatSessionId] = useState<string | null>(null);

  // Get model's context window size
  useEffect(() => {
    if (currentModel) {
      const model = getModelById(currentModel);
      if (model) {
        setModelContextWindow(model.capabilities.limits?.max_context_window_tokens || 128000);
      }
    }
  }, [currentModel]);

  // 🔥 Listen for agentChatSessionCacheManager changes to get currentChatSessionId
  useEffect(() => {
    // Initialize: get current value
    const sessionId = agentChatSessionCacheManager.getCurrentChatSessionId();
    setCurrentChatSessionId(sessionId);
    
    console.log('[ContextBadge] Initial chatSessionId', { sessionId });
    
    // Subscribe to currentChatSessionId changes
    const unsubscribe = agentChatSessionCacheManager.subscribeToCurrentChatSessionId((newSessionId) => {
      console.log('[ContextBadge] ChatSessionId changed', {
        oldSessionId: currentChatSessionId,
        newSessionId,
        format: 'chatSession_YYYYMMDDHHMMSS'
      });
      setCurrentChatSessionId(newSessionId);
    });
    
    return unsubscribe;
  }, []);

  // 🔥 Core logic: Initialize and listen for context changes
  useEffect(() => {
    let notificationReceived = false;
    let isMounted = true;
    
    const handleContextChange = (stats: ContextStats) => {
      if (!isMounted) return;
      
      console.log('[ContextBadge] 📊 Context change received', {
        tokenCount: stats.tokenCount,
        notificationReceived
      });
      
      notificationReceived = true;
      setContextTokens(stats.tokenCount);
      setLoading(false);
    };

    // 🔥 Critical fix: Proactively fetch initial token data after session switch
    const initializeTokenData = async () => {
      try {
        console.log('[ContextBadge] 🔄 Initializing token data...');
        setLoading(true);
        
        // Proactively pull current session's token usage from backend
        const tokenUsage = await agentChatIpc.getCurrentContextTokenUsage();
        
        if (isMounted && tokenUsage) {
          console.log('[ContextBadge] ✅ Initial token data loaded', {
            tokenCount: tokenUsage.tokenCount
          });
          notificationReceived = true;
          setContextTokens(tokenUsage.tokenCount);
          setLoading(false);
        } else if (isMounted) {
          console.warn('[ContextBadge] ⚠️ No token usage data available');
          setContextTokens(0);
          setLoading(false);
        }
      } catch (error) {
        console.error('[ContextBadge] ❌ Failed to initialize token data:', error);
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
    
    // 🔄 Fix: Set timeout mechanism as fallback
    const fallbackTimeout = setTimeout(() => {
      if (!notificationReceived && isMounted) {
        console.warn('[ContextBadge] ⏱️ Timeout: No context data received');
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
  }, [currentChatSessionId]); // 🔥 Key: Depends on currentChatSessionId, re-initialize on session switch

  // Calculate utilization ratio
  const utilizationRatio = modelContextWindow > 0 ? contextTokens / modelContextWindow : 0;
  
  // Determine badge variant based on utilization ratio
  let variant: "default" | "secondary" | "destructive" | "outline" | "success" | "normal" = "normal";
  if (utilizationRatio > 0.9) {
    variant = "destructive"; // Red when over 90%
  } else if (utilizationRatio > 0.7) {
    variant = "outline"; // Warning when over 70%
  } else if (utilizationRatio > 0) {
    variant = "normal"; // Normal style when in use
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