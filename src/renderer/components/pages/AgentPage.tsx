import React, { memo, useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useAuthContext } from '../auth/AuthProvider';
import AppLayout from '../layout/AppLayout';
import { profileDataManager } from '../../lib/userData';
import { FreOverlay, InstallUpdateOnStartupView } from '../fre';
// Read data from AgentChatSessionCacheManager
import {
  useMessagesWithStream,
  CurrentSessionStatus,
  useCurrentChatSessionId,
  useCurrentChatId,
} from '../../lib/chat/agentChatSessionCacheManager';
import { getPmAgentSayHiMessageConfig } from '../../lib/chat/pmAgentSayHi';
import { startNewChatFor } from '../../lib/chat/startNewChatFor';
import { createLogger } from '../../lib/utilities/logger';
const logger = createLogger('[AgentPage]');

/**
 * Module-level in-memory state: whether to show InstallUpdateOnStartupView
 * Defaults to true; set to false after FRE ends or the first InstallUpdateOnStartupView ends
 * Module-level variables persist within the Electron window lifecycle and are not reset across component mount/unmount
 */
let needsShowInstallUpdateOnStartupView = true;
let hasAutoSelectedPrimaryAgentOnStartup = false;

const DevMonitor = memo(() => {
  const { messages, streamingMessageId } = useMessagesWithStream();
  const { chatStatus, chatSessionId } = CurrentSessionStatus.use();

    // Development debug
  useEffect(() => {
    logger.debug('[AgentPage] 📊 Cache Manager Data:', {
      messagesCount: messages.length,
      chatSessionId,
      chatStatus,
      streamingMessageId,
      streamingMessageIdType: typeof streamingMessageId,
      isStreaming:
        streamingMessageId !== null && streamingMessageId !== undefined,
      lastMessageId:
        messages.length > 0
          ? messages[messages.length - 1].id
          : 'none',
    });
  }, [
    messages.length,
    chatSessionId,
    chatStatus,
    streamingMessageId,
  ]);

  return null;
});

export const AgentPage: React.FC = () => {
  const { authData } = useAuthContext();
  const navigate = useNavigate();

  // Refactor: read flat message array directly from Cache Manager
  const currentChatSessionId = useCurrentChatSessionId();
  const currentChatId = useCurrentChatId();

  // FRE (First Run Experience) state
  const [showFreOverlay, setShowFreOverlay] = useState<boolean>(false);

  // Startup Update state
  const [showStartupUpdate, setShowStartupUpdate] = useState<boolean>(false);
  const [isWindows, setIsWindows] = useState(false);


  // Detect platform
  useEffect(() => {
    const checkPlatform = async () => {
      if (window.electronAPI && window.electronAPI.platform === 'win32') {
        setIsWindows(true);
      } else {
        try {
          const info = await window.electronAPI.getPlatformInfo();
          if (info.platform === 'win32') {
            setIsWindows(true);
          }
        } catch (e) {
          // Ignore - assume not Windows
        }
      }
    };
    checkPlatform();
  }, []);

  // FRE detection: check on page load whether FRE Overlay needs to be shown
  // If FREDone=true, show Startup Update check (first time only)
  // FRE and InstallUpdateOnStartupView are mutually exclusive paths:
  //   - FRE path: FreSettingUpView (first install, includes built-in assets installation)
  //   - NON-FRE path: InstallUpdateOnStartupView (subsequent launches, check for updates)
  useEffect(() => {
    // Record initial FRE state: if FRE is needed initially, skip InstallUpdateOnStartupView after FRE completes
    const initialNeedsFre = profileDataManager.needsFRE();

    const checkFreStatus = () => {
      const needsFre = profileDataManager.needsFRE();
      logger.debug('[AgentPage] 🎯 FRE check:', { needsFre, initialNeedsFre });
      setShowFreOverlay(needsFre);

      // When FREDone=true: check if Startup Update should be shown (only when needsShowInstallUpdateOnStartupView=true)
      // Key: if transitioning to !needsFre after FRE flow (initialNeedsFre=true),
      // skip InstallUpdateOnStartupView because FRE already installed built-in assets
      if (!needsFre && needsShowInstallUpdateOnStartupView) {
        if (initialNeedsFre) {
          // FRE just completed → skip InstallUpdateOnStartupView
          logger.debug('[AgentPage] 🎯 FRE just completed, skipping InstallUpdateOnStartupView');
          needsShowInstallUpdateOnStartupView = false;
        } else {
          // Non-FRE path → show Startup Update view
          setShowStartupUpdate(true);
        }
      }
    };

    // Initial check
    checkFreStatus();

    // Subscribe to profile data changes to re-check after updates
    const unsubscribe = profileDataManager.subscribe(() => {
      checkFreStatus();
    });

    return () => {
      unsubscribe();
    };
  }, []);

  // When FREDone=true: auto-select primary agent and call startNewChatFor
  const selectPrimaryAgentOnStartup = useCallback(async () => {
    logger.debug('[AgentPage] 🚀 Selecting primary agent on startup (FREDone=true)...');

    try {
      const profile = profileDataManager.getProfile();
      if (!profile) {
        logger.warn('[AgentPage] No profile found, skipping primary agent selection');
        return;
      }

      const primaryAgentName = profile.primaryAgent || 'Kobi';
      const chats = profileDataManager.getChatConfigs();
      logger.debug('[AgentPage] Primary agent name:', primaryAgentName, 'Chats count:', chats.length);

      if (chats.length === 0) {
        logger.warn('[AgentPage] No chats found in profile');
        return;
      }

      // Find the chatId corresponding to the primary agent in chats
      const primaryChat = chats.find((chat) => chat.agent?.name === primaryAgentName);

      let targetChatId: string | undefined;

      if (primaryChat?.chat_id) {
        targetChatId = primaryChat.chat_id;
        logger.debug('[AgentPage] Found primary agent chatId:', targetChatId);
      } else {
        // If primary agent not found, use the first chat
        const firstChat = chats[0];
        if (firstChat?.chat_id) {
          targetChatId = firstChat.chat_id;
          logger.debug('[AgentPage] Primary agent not found, falling back to first chat:', targetChatId);
        }
      }

      if (!targetChatId) {
        logger.warn('[AgentPage] No valid chatId found for primary agent selection');
        return;
      }

      // Call startNewChatFor to start a new chat session
      const result = await startNewChatFor(
        targetChatId,
        getPmAgentSayHiMessageConfig(targetChatId),
      );
      if (result.success && result.chatSessionId) {
        logger.debug('[AgentPage] ✅ Primary agent selected successfully:', {
          chatId: targetChatId,
          chatSessionId: result.chatSessionId
        });
        // Navigate directly to the chat session without relying on the IPC event subscription chain
        navigate(`/agent/chat/${targetChatId}/${result.chatSessionId}`, { replace: true });
      } else {
        logger.warn('[AgentPage] Failed to start new chat for primary agent:', result.error);
      }
    } catch (error) {
      logger.error('[AgentPage] Error selecting primary agent on startup:', error);
    }
  }, [navigate]);

  // Startup Update complete callback
  const handleStartupUpdateComplete = useCallback(async () => {
    logger.debug('[AgentPage] 🎯 Startup update complete, selecting primary agent...');
    needsShowInstallUpdateOnStartupView = false;
    setShowStartupUpdate(false);

    if (!hasAutoSelectedPrimaryAgentOnStartup) {
      hasAutoSelectedPrimaryAgentOnStartup = true;
      await selectPrimaryAgentOnStartup();
    }
  }, [selectPrimaryAgentOnStartup]);

  const handleStartupUpdateSkip = useCallback(async () => {
    logger.debug('[AgentPage] 🎯 Startup update skipped, selecting primary agent...');
    needsShowInstallUpdateOnStartupView = false;
    setShowStartupUpdate(false);

    if (!hasAutoSelectedPrimaryAgentOnStartup) {
      hasAutoSelectedPrimaryAgentOnStartup = true;
      await selectPrimaryAgentOnStartup();
    }
  }, [selectPrimaryAgentOnStartup]);

  // Normal startup path: when FREDone=true and no StartupUpdate, auto-navigate to primary agent
  // Independent effect runs only on mount to avoid re-triggering on every profile update
  // needsShowInstallUpdateOnStartupView=false means StartupUpdate has been handled (or skipped),
  // meaning handleStartupUpdateComplete/Skip has already called selectPrimaryAgentOnStartup.
  // Only needs to be called again if AgentPage remounts and module-level startup selection hasn't run yet.
  useEffect(() => {
    if (!needsShowInstallUpdateOnStartupView && !profileDataManager.needsFRE()) {
      if (!hasAutoSelectedPrimaryAgentOnStartup) {
        hasAutoSelectedPrimaryAgentOnStartup = true;
        logger.debug('[AgentPage] 🚀 Remount startup path, selecting primary agent...');
        void selectPrimaryAgentOnStartup();
      }
    }
  }, [selectPrimaryAgentOnStartup]);

  // FRE: handle skip click event
  // Flow: update freDone → ProfileDataManager receives update → FRE view auto-closes
  const handleFreSkip = useCallback(async () => {
    try {
      logger.debug('[AgentPage] 🎯 FRE: Skip clicked');

      // Update freDone state - ProfileCacheManager will send update notification
      // ProfileDataManager triggers subscribe callback upon receiving notification
      // FRE detection effect monitors needsFRE() changes and auto-dismisses the overlay
      const userAlias = profileDataManager.getCurrentUserAlias();
      if (userAlias && window.electronAPI?.profile?.updateFreDone) {
        await window.electronAPI.profile.updateFreDone(userAlias, true);
        logger.debug(
          '[AgentPage] ✅ FRE: freDone updated to true (skipped), waiting for ProfileDataManager notification...',
        );
      }
    } catch (error) {
      logger.error('[AgentPage] ❌ FRE: Error updating freDone:', error);
    }
  }, []);

  // Initialize an empty session when a chat is selected without a session.
  // Important: AgentPage must NOT switch an existing session here.
  // ChatView already owns route -> backend session switching.
  // If both AgentPage and ChatView call switchToChatSession() for the same route change,
  // the renderer can receive two cache-refresh snapshots for the same session.
  // During active streaming, that duplicate refresh may replay an older backend snapshot and
  // temporarily overwrite newer frontend cache content, which is exactly what caused streamed
  // text to appear "lost" after switching away and back.
  // Therefore the contract is:
  // - ChatView owns switching an existing session selected by route.
  // - AgentPage only bootstraps a brand-new empty session when no sessionId exists yet.
  const syncWithAgentChatManager = useCallback(async () => {
    if (!currentChatId) return;

    logger.debug('[AgentPage] 📊 Sync check:', {
      currentChatId,
      currentChatSessionId,
    });

    if (currentChatSessionId) {
      return;
    }

    logger.debug(
      '[AgentPage] 🚀 No chatSessionId, calling startNewChatFor to initialize',
    );

    const result = await startNewChatFor(
      currentChatId,
      getPmAgentSayHiMessageConfig(currentChatId),
    );

    if (result.success && result.chatSessionId) {
      logger.debug(
        '[AgentPage] 📝 Auto-initialized chatSessionId:',
        result.chatSessionId,
      );
    } else {
      logger.error(
        '[AgentPage] ❌ Failed to auto-initialize chatSessionId',
      );
    }
    return;
  }, [currentChatId, currentChatSessionId]);

  // Listen for chat and session changes
  useEffect(() => {
    syncWithAgentChatManager();
  }, [currentChatId, currentChatSessionId, syncWithAgentChatManager]);

  if (!authData) {
    return null;
  }

  return (
    <>
      {/* FRE Overlay */}
      {showFreOverlay && <FreOverlay onSkip={handleFreSkip} />}

      {/* Startup Update Overlay - shown after FRE is done */}
      {!showFreOverlay && showStartupUpdate && (
        <InstallUpdateOnStartupView
          onComplete={handleStartupUpdateComplete}
          onSkip={handleStartupUpdateSkip}
          isWindows={isWindows}
        />
      )}

      <AppLayout />
      {process.env.NODE_ENV === 'development' && <DevMonitor />}
    </>
  );
};