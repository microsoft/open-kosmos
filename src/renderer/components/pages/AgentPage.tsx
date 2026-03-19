import React, { useCallback, useEffect, useState } from 'react';

import { useAuthContext } from '../auth/AuthProvider';
import AppLayout from '../layout/AppLayout';
import { Message, Config as ChatConfig, MessageHelper } from '../../types/chatTypes';
import { agentChatIpc } from '../../lib/chat/agentChatIpc';
import { useAgentConfig } from '../userData/userDataProvider';
import { useToast } from '../ui/ToastProvider';
import { profileDataManager } from '../../lib/userData';
import { FreOverlay } from '../fre';
// Read data from AgentChatSessionCacheManager
import {
  useMessages,
  useChatStatus,
  useCurrentChatSessionId,
  useStreamingMessageId,
  agentChatSessionCacheManager
} from '../../lib/chat/agentChatSessionCacheManager';

export const AgentPage: React.FC = () => {
  const { authData, signOut } = useAuthContext();
  const { showToast } = useToast();

  // 🔥 Refactor: Read flat message array directly from Cache Manager
  const messages = useMessages();
  const chatStatus = useChatStatus();
  const cacheCurrentChatSessionId = useCurrentChatSessionId();
  const streamingMessageId = useStreamingMessageId() || undefined;

  // 🔥 New: Use local state to track streaming messages for immediate updates
  const [streamingMessage, setStreamingMessage] = useState<Message | null>(
    null,
  );

  // 🔥 FRE (First Run Experience) state
  const [showFreOverlay, setShowFreOverlay] = useState<boolean>(false);

  // Get current chatId and chatSessionId from agentChatSessionCacheManager
  const [currentChatId, setCurrentChatId] = React.useState<string | null>(
    agentChatSessionCacheManager.getCurrentChatId(),
  );
  const [currentChatSessionId, setCurrentChatSessionId] = React.useState<
    string | null
  >(agentChatSessionCacheManager.getCurrentChatSessionId());

  // Subscribe to currentChatSessionId changes
  React.useEffect(() => {
    const unsubscribe =
      agentChatSessionCacheManager.subscribeToCurrentChatSessionId(() => {
        const newChatId = agentChatSessionCacheManager.getCurrentChatId();
        const newChatSessionId =
          agentChatSessionCacheManager.getCurrentChatSessionId();
        setCurrentChatId(newChatId);
        setCurrentChatSessionId(newChatSessionId);
      });
    return unsubscribe;
  }, []);

  // 🔥 Register direct callback for immediate streaming rendering
  useEffect(() => {
    if (!cacheCurrentChatSessionId) {
      return;
    }

    console.log(
      '[AgentPage] 🔥 Registering direct callback for:',
      cacheCurrentChatSessionId,
    );

    const unregister =
      agentChatSessionCacheManager.registerDirectMessageUpdateCallback(
        cacheCurrentChatSessionId,
        (message: Message, chatSessionId: string) => {
          // 🔥 Direct callback: execute immediately in the same call stack
          const contentLength =
            message.content[0]?.type === 'text'
              ? message.content[0].text.length
              : 0;
          console.log('[AgentPage] 🔥 Direct callback triggered:', {
            messageId: message.id,
            chatSessionId,
            contentLength,
          });

          // Use normal React scheduling for updates to avoid Maximum update depth exceeded from flushSync
          setStreamingMessage({ ...message });
        },
      );

    return () => {
      console.log(
        '[AgentPage] 🔥 Unregistering direct callback for:',
        cacheCurrentChatSessionId,
      );
      unregister();
      setStreamingMessage(null);
    };
  }, [cacheCurrentChatSessionId]);

  const { agent: currentAgent } = useAgentConfig();
  const currentChat = currentChatId
    ? profileDataManager.getCurrentChat()
    : null;

  // 🔥 Track whether primary agent has been auto-selected to prevent duplicate calls
  const primaryAgentSelectedRef = React.useRef(false);

  // 🔥 FRE detection: check if FRE Overlay needs to be shown on page load
  useEffect(() => {
    const checkFreStatus = async () => {
      const needsFre = profileDataManager.needsFRE();
      console.log('[AgentPage] 🎯 FRE check:', { needsFre });
      setShowFreOverlay(needsFre);
      
      // When FRE is done, auto-select primary agent
      if (!needsFre) {
        if (!primaryAgentSelectedRef.current) {
          primaryAgentSelectedRef.current = true;
          await selectPrimaryAgentOnStartup();
        }
      }
    };

    // Initial check
    checkFreStatus();

    // Subscribe to profile data changes to re-check after data updates
    const unsubscribe = profileDataManager.subscribe(() => {
      checkFreStatus();
    });

    return () => {
      unsubscribe();
    };
  }, []);

  // 🔥 When FREDone=true: auto-select primary agent and call startNewChatFor
  const selectPrimaryAgentOnStartup = useCallback(async () => {
    console.log('[AgentPage] 🚀 Selecting primary agent on startup (FREDone=true)...');
    
    try {
      const profile = profileDataManager.getProfile();
      if (!profile) {
        console.warn('[AgentPage] No profile found, skipping primary agent selection');
        return;
      }
      
      const primaryAgentName = (profile as any).primaryAgent || 'Kobi';
      const chats = (profile as any).chats || [];
      console.log('[AgentPage] Primary agent name:', primaryAgentName, 'Chats count:', chats.length);
      
      if (chats.length === 0) {
        console.warn('[AgentPage] No chats found in profile');
        return;
      }
      
      // Find the chatId for the primary agent from profile.chats
      const primaryChat = chats.find((chat: any) => chat.agent?.name === primaryAgentName);
      
      let targetChatId: string | undefined;
      
      if (primaryChat?.chat_id) {
        targetChatId = primaryChat.chat_id;
        console.log('[AgentPage] Found primary agent chatId:', targetChatId);
      } else {
        // If primary agent not found, use the first chat
        const firstChat = chats[0];
        if (firstChat?.chat_id) {
          targetChatId = firstChat.chat_id;
          console.log('[AgentPage] Primary agent not found, falling back to first chat:', targetChatId);
        }
      }
      
      if (!targetChatId) {
        console.warn('[AgentPage] No valid chatId found for primary agent selection');
        return;
      }
      
      // Call startNewChatFor to start a new chat session
      if (window.electronAPI?.agentChat?.startNewChatFor) {
        const result = await window.electronAPI.agentChat.startNewChatFor(targetChatId);
        if (result.success && result.chatSessionId) {
          console.log('[AgentPage] ✅ Primary agent selected successfully:', {
            chatId: targetChatId,
            chatSessionId: result.chatSessionId
          });
        } else {
          console.warn('[AgentPage] Failed to start new chat for primary agent:', result.error);
        }
      } else {
        console.warn('[AgentPage] startNewChatFor API not available');
      }
    } catch (error) {
      console.error('[AgentPage] Error selecting primary agent on startup:', error);
    }
  }, []);

  // 🔥 FRE: Handle skip click event
  // Flow: update freDone → ProfileDataManager receives update → FRE view auto-closes
  const handleFreSkip = useCallback(async () => {
    try {
      console.log('[AgentPage] 🎯 FRE: Skip clicked');

      // Update freDone status - ProfileCacheManager will send update notification
      // ProfileDataManager receives notification and triggers subscribe callback
      // FRE detection effect monitors needsFRE() changes and auto-dismisses overlay
      const userAlias = profileDataManager.getCurrentUserAlias();
      if (userAlias && window.electronAPI?.profile?.updateFreDone) {
        await window.electronAPI.profile.updateFreDone(userAlias, true);
        console.log(
          '[AgentPage] ✅ FRE: freDone updated to true (skipped), waiting for ProfileDataManager notification...',
        );
      }
    } catch (error) {
      console.error('[AgentPage] ❌ FRE: Error updating freDone:', error);
    }
  }, []);

  // Approval request state
  const [pendingApprovalRequest, setPendingApprovalRequest] = React.useState<{
    requestId: string;
    toolName: string;
    path: string;
  } | null>(null);

  // Switch ChatSession
  const syncWithAgentChatManager = useCallback(async () => {
    if (!currentChatId) return;

    console.log('[AgentPage] 📊 Sync check:', {
      currentChatId,
      currentChatSessionId,
      cacheCurrentChatSessionId,
    });

    // If no chatSessionId, need to initialize
    if (!currentChatSessionId) {
      console.log(
        '[AgentPage] 🚀 No chatSessionId, calling startNewChatFor to initialize',
      );

      if (window.electronAPI?.agentChat?.startNewChatFor) {
        const result = await window.electronAPI.agentChat.startNewChatFor(
          currentChatId,
        );

        if (result.success && result.chatSessionId) {
          console.log(
            '[AgentPage] 📝 Auto-initialized chatSessionId:',
            result.chatSessionId,
          );
          // ✅ Backend auto-syncs via IPC events, Cache Manager updates automatically
        } else {
          console.error(
            '[AgentPage] ❌ Failed to auto-initialize chatSessionId',
          );
          return;
        }
      } else {
        console.warn('[AgentPage] ⚠️ startNewChatFor not available');
        return;
      }
    } else {
      // Switch to specified ChatSession
      console.log(
        '[AgentPage] 🔄 Switching to ChatSession:',
        currentChatSessionId,
      );
      await agentChatIpc.switchToChatSession(
        currentChatId,
        currentChatSessionId,
      );
      // ✅ Cache Manager auto-updates via IPC events
    }
  }, [currentChatId, currentChatSessionId, cacheCurrentChatSessionId]);

  // Listen for chat and session changes
  useEffect(() => {
    syncWithAgentChatManager();
  }, [currentChatId, currentChatSessionId, syncWithAgentChatManager]);

  // Listen for approval requests
  useEffect(() => {
    const handleApprovalRequest = (request: {
      requestId: string;
      toolName: string;
      path: string;
    }) => {
      setPendingApprovalRequest(request);
    };

    agentChatIpc.addApprovalRequestListener(handleApprovalRequest);

    return () => {
      agentChatIpc.removeApprovalRequestListener(handleApprovalRequest);
    };
  }, []);

  // Handle user approval decision
  const handleApprovalResponse = useCallback(
    async (approved: boolean) => {
      if (!pendingApprovalRequest) return;

      try {
        await agentChatIpc.sendApprovalResponse(
          pendingApprovalRequest.requestId,
          approved ? 'approved' : 'rejected',
        );

        setPendingApprovalRequest(null);

        showToast(
          approved
            ? `Access to ${pendingApprovalRequest.path} approved`
            : `Access to ${pendingApprovalRequest.path} rejected`,
          approved ? 'success' : 'info',
        );
      } catch (error) {
        showToast('Failed to send approval response', 'error');
      }
    },
    [pendingApprovalRequest, showToast],
  );

  // New Chat handler
  const handleNewChat = useCallback(async () => {
    if (!currentChatId) {
      console.error('[AgentPage] No currentChatId available for new chat');
      return;
    }

    console.log('[AgentPage] 🚀 Starting new chat for chatId:', currentChatId);

    try {
      if (window.electronAPI?.agentChat?.startNewChatFor) {
        const result = await window.electronAPI.agentChat.startNewChatFor(
          currentChatId,
        );

        if (result.success && result.chatSessionId) {
          console.log(
            '[AgentPage] 📝 New chat session created:',
            result.chatSessionId,
          );
          // ✅ Cache Manager auto-updates via IPC events
        } else {
          console.error('[AgentPage] ❌ Failed to create new chat session');
        }
      }

      console.log('[AgentPage] ✅ New chat started');
    } catch (error) {
      console.error('[AgentPage] Error starting new chat:', error);
    }
  }, [currentChatId]);

  // Listen for agent:startNewChat event
  useEffect(() => {
    const handleStartNewChat = async (event: CustomEvent) => {
      const { chatId } = event.detail;

      console.log(
        '[AgentPage] 🚀 Received startNewChat event for chatId:',
        chatId,
      );

      if (chatId !== currentChatId) {
        console.error(
          '[AgentPage] ❌ ChatId mismatch - use NavigationSection to switch agents',
        );
        return;
      }

      await handleNewChat();
    };

    window.addEventListener(
      'agent:startNewChat',
      handleStartNewChat as unknown as EventListener,
    );

    return () => {
      window.removeEventListener(
        'agent:startNewChat',
        handleStartNewChat as unknown as EventListener,
      );
    };
  }, [currentChatId, handleNewChat]);

  if (!authData) {
    return null;
  }

  // 🔥 Refactor: Directly use flat message array returned by useMessages
  const displayMessages = React.useMemo(() => {
    // If there's a streaming message, merge it into the list
    if (streamingMessage && streamingMessageId) {
      const existingIndex = messages.findIndex(
        (msg) => msg.id === streamingMessage.id,
      );

      if (existingIndex !== -1) {
        // Update existing message
        return [
          ...messages.slice(0, existingIndex),
          streamingMessage,
          ...messages.slice(existingIndex + 1),
        ];
      } else {
        // Add new message
        return [...messages, streamingMessage];
      }
    }

    return messages;
  }, [messages, streamingMessage, streamingMessageId]);

  // Development debugging
  useEffect(() => {
    console.log('[AgentPage] 📊 Cache Manager Data:', {
      messagesCount: displayMessages.length,
      currentChatSessionId: cacheCurrentChatSessionId,
      chatStatus,
      streamingMessageId,
      streamingMessageIdType: typeof streamingMessageId,
      isStreaming:
        streamingMessageId !== null && streamingMessageId !== undefined,
      lastMessageId:
        displayMessages.length > 0
          ? displayMessages[displayMessages.length - 1].id
          : 'none',
    });
  }, [
    displayMessages.length,
    cacheCurrentChatSessionId,
    chatStatus,
    streamingMessageId,
  ]);

  const sendMessage = async (message: Message) => {
    try {
      console.log('[AgentPage] 📤 Sending message...');

      const userMsg: Message = {
        ...message,
        id: message.id || Date.now().toString(),
        streamingComplete: true,
      };

      // 🔥 Refactor: Use new addUserMessage method (replaces addUserMessageAndCreateTurn)
      if (cacheCurrentChatSessionId) {
        agentChatSessionCacheManager.addUserMessage(
          cacheCurrentChatSessionId,
          userMsg,
        );
        console.log('[AgentPage] ✅ User message added to cache');
      }

      // Send to backend, Cache Manager will automatically handle subsequent assistant messages
      await agentChatIpc.streamMessage(userMsg, {
        onAssistantMessage: (msg: any) => {
          console.log('[AgentPage] 📨 Assistant message:', msg.id);
        },
        onToolUse: (toolName: string) => {
          console.log('[AgentPage] 🔧 Tool used:', toolName);
        },
        onToolResult: (toolMessage: any) => {
          console.log('[AgentPage] 📦 Tool result received:', toolMessage.id);
        },
      });

      console.log('[AgentPage] ✅ Message sent successfully');
    } catch (error) {
      console.error('[AgentPage] ❌ Error sending message:', error);
      
      // Extract error message for display
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      // 🔥 Capture current chatSessionId for setting error message and retry
      const failedChatSessionId = cacheCurrentChatSessionId;
      
      // 🔥 Set error message to ChatSessionCache, rendered by ErrorBar
      if (failedChatSessionId) {
        agentChatSessionCacheManager.setErrorMessage(failedChatSessionId, errorMessage);
      } else {
        console.error('[AgentPage] ❌ No chat session ID to set error message');
      }
    }
  };

  // Cancel chat
  const handleCancelChat = useCallback(async () => {
    try {
      console.log('[AgentPage] 🛑 Cancelling chat...');

      if (!currentChatId) {
        console.warn('[AgentPage] No current chat ID to cancel');
        showToast('No active chat to cancel', 'warning');
        return;
      }

      await agentChatIpc.cancelChat(currentChatId);

      console.log('[AgentPage] ✅ Chat cancelled successfully');
    } catch (error) {
      console.error('[AgentPage] ❌ Error cancelling chat:', error);
    }
  }, [showToast, currentChatId]);

  const saveConfig = async (newConfig: ChatConfig) => {
    // Deprecated
  };

  return (
    <>
      {/* FRE Overlay */}
      {showFreOverlay && (
        <FreOverlay
          onSkip={handleFreSkip}
        />
      )}

      <AppLayout
        authData={authData}
        onLogout={async () => {
          try {
            await signOut();
          } catch (error) {
            console.error('[AgentPage] Error signing out:', error);
          }
        }}
        messages={displayMessages}
        allMessages={displayMessages}
        streamingMessageId={streamingMessageId}
        onSendMessage={sendMessage}
        onCancelChat={handleCancelChat}
        onApprovalResponse={handleApprovalResponse}
        pendingApprovalRequest={pendingApprovalRequest}
        config={{
          apiKey: '',
          endpoint: '',
          deploymentName: '',
          apiVersion: '2023-05-15',
        }}
        onSaveConfig={saveConfig}
        onNewAgent={() => {
          window.dispatchEvent(new CustomEvent('agent:newAgent'));
        }}
        onEditAgent={(chatId: string) => {
          window.dispatchEvent(
            new CustomEvent('agent:editAgent', {
              detail: { chatId },
            }),
          );
        }}
        onDeleteAgent={(chatId: string) => {
          window.dispatchEvent(
            new CustomEvent('agent:deleteAgent', {
              detail: { chatId },
            }),
          );
        }}
      />
    </>
  );
};