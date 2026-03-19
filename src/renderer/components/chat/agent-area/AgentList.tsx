import React, { useState, useEffect, useRef, useCallback } from 'react';
import { MoreHorizontal, GitFork, Trash2 } from 'lucide-react';
import { ChatConfigRuntime } from '../../../lib/userData/types';
import NavItem from '../../ui/navigation/NavItem';
import { AgentAvatar } from '../../common/AgentAvatar';
import { isBuiltinAgent } from '../../../lib/userData/types';
import { BRAND_NAME } from '@shared/constants/branding';
import '../../../styles/DropdownMenu.css';

// 🔥 New: Start New Conversation icon component
const StartNewConversationIcon = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M10.5 4.00002C10.7761 4.00002 11 4.22388 11 4.50002C10.9999 4.77612 10.7761 5.00002 10.5 5.00002L6 5.00002C4.89543 5.00002 4 5.89544 4 7.00001L4 14C4.00004 15.1045 4.89545 16 6 16L13 16C14.1045 16 14.9999 15.1045 15 14V9.5C15 9.22386 15.2238 9 15.5 9C15.7761 9 16 9.22386 16 9.5V14C15.9999 15.6568 14.6568 17 13 17H6C4.34317 17 3.00004 15.6568 3 14L3 7.00001C3 5.34316 4.34314 4.00002 6 4.00002L10.5 4.00002ZM16.1465 3.14651C16.3417 2.95125 16.6582 2.95125 16.8535 3.14651C17.0487 3.34177 17.0487 3.6583 16.8535 3.85353L9.06054 11.6455L7.99999 12L8.35351 10.9395L16.1465 3.14651Z" fill="#242424"/>
  </svg>
);

// 🔥 New: Loading icon component
const LoadingIcon = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 20 20"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    style={{
      animation: 'spin 1s linear infinite'
    }}
  >
    <g clipPath="url(#clip0_390_2677)">
      <circle cx="10" cy="10" r="9" stroke="black" strokeOpacity="0.15" strokeWidth="2"/>
      <path d="M19 10C19 12.3869 18.0518 14.6761 16.364 16.364C14.6761 18.0518 12.387 19 10 19" stroke="#272320" strokeWidth="2" strokeLinecap="round"/>
    </g>
    <defs>
      <clipPath id="clip0_390_2677">
        <rect width="20" height="20" fill="white"/>
      </clipPath>
    </defs>
  </svg>
);

interface AgentListProps {
  chats?: ChatConfigRuntime[];
  primaryAgent?: string; // 🔥 New: Primary Agent name, for priority display
  excludeBuiltinAgents?: boolean; // 🔥 Modified: Whether to exclude built-in agents (for main list)
  currentChatId?: string | null;
  onSelectChat?: (chatId: string) => void;
  onAgentMenuToggle?: (chatId: string, element: HTMLElement) => void;
  openMenuChatId?: string | null;
  activeView?: 'chat' | 'mcp' | 'skills' | 'memory' | 'settings-page' | 'settings'; // 🔥 New: Currently active view (including agent settings page)
  currentChatSessionId?: string | null; // 🔥 New: Currently selected ChatSession ID
  onSelectChatSession?: (chatId: string, sessionId: string) => void; // 🔥 New: Select ChatSession callback
  onChatSessionMenuToggle?: (chatId: string, sessionId: string, title: string, element: HTMLElement) => void; // 🔥 ChatSession menu toggle callback (with title)
  openMenuChatSessionId?: string | null; // 🔥 New: Currently open menu ChatSession ID
  onDeleteChatSession?: (chatId: string, sessionId: string) => void; // 🔥 New: Delete ChatSession callback
  onForkChatSession?: (chatId: string, sessionId: string) => void; // 🔥 New: Fork ChatSession callback
}

const AgentList: React.FC<AgentListProps> = ({
  chats = [],
  primaryAgent, // 🔥 Fix: Do not set default value, allow undefined
  excludeBuiltinAgents = true, // 🔥 Modified: Exclude built-in agents by default (used in main list)
  currentChatId,
  onSelectChat,
  onAgentMenuToggle,
  openMenuChatId,
  activeView = 'chat', // 🔥 Default value is 'chat'
  currentChatSessionId,
  onSelectChatSession,
  onChatSessionMenuToggle,
  openMenuChatSessionId,
  onDeleteChatSession,
  onForkChatSession
}) => {
  // Get profile data for alias field (used to load more ChatSessions)
  const { useProfileData } = require('../../userData/userDataProvider');
  const { data } = useProfileData();
  
  // 🔥 New: Expanded Agent ID
  const [expandedAgentId, setExpandedAgentId] = useState<string | null>(null);
  
  // 🔥 New: Track status of each ChatSession
  const [chatSessionStatuses, setChatSessionStatuses] = useState<Map<string, string>>(new Map());
  
  // 🔥 New: Scroll loading state (pagination state per chat)
  const [paginationState, setPaginationState] = useState<Map<string, {
    hasMore: boolean;
    nextMonthIndex: number;
    isLoading: boolean;
  }>>(new Map());

  // 🔥 New: Temporary "all loaded" hint display state (chatId -> whether to show)
  const [showAllLoadedHint, setShowAllLoadedHint] = useState<Map<string, boolean>>(new Map());

  // 🔥 Key fix: Ensure ChatSession sub-menu is expanded when Agent is selected (only in chat view)
  useEffect(() => {
    if (currentChatId && activeView === 'chat') {
      // When Agent is selected and in chat view, auto-expand its ChatSession list
      setExpandedAgentId(currentChatId);
    } else if (activeView !== 'chat' && activeView !== 'settings') {
      // When switching to other views (not chat or settings), collapse all ChatSession lists
      setExpandedAgentId(null);
    } else if (activeView === 'settings') {
      // 🔥 In settings view, collapse ChatSession list but keep Agent selected
      setExpandedAgentId(null);
    }
  }, [currentChatId, activeView]);

  // 🔥 Extra protection: If an Agent is already selected during init and in chat view, ensure expanded
  useEffect(() => {
    if (currentChatId && activeView === 'chat' && !expandedAgentId) {
      setExpandedAgentId(currentChatId);
    }
  }, [currentChatId, activeView, expandedAgentId]);
  
  // 🔥 New: Listen for Chat status change events
  useEffect(() => {
    const handleChatStatusChanged = (data: {chatId: string; chatSessionId: string; chatStatus: string; agentName?: string; timestamp?: string}) => {
      const { chatSessionId, chatStatus } = data;
      
      // 🔥 Fix: Use chatSessionId directly without filtering, so all ChatSession status changes are recorded
      // This way background ChatSession status changes are also updated
      if (chatSessionId && chatStatus) {
        setChatSessionStatuses(prev => {
          const newMap = new Map(prev);
          newMap.set(chatSessionId, chatStatus);
          return newMap;
        });
      }
    };
    
    // Listen for Chat status change events from main process
    if (window.electronAPI?.agentChat?.onChatStatusChanged) {
      const cleanup = window.electronAPI.agentChat.onChatStatusChanged(handleChatStatusChanged);
      
      return () => {
        if (cleanup) cleanup();
      };
    }
  }, []); // 🔥 Removed dependencies since we no longer need filtering

  const handleMenuToggle = (chatId: string, event: React.MouseEvent<HTMLElement>) => {
    event.stopPropagation();
    onAgentMenuToggle?.(chatId, event.currentTarget);
  };

  // 🔥 Fix: Handle Agent click - start new AgentChat and expand Chat Session list
  const handleAgentClick = (chatId: string) => {
    // Always expand current Agent Chat Session list
    setExpandedAgentId(chatId);
    
    // Select this Agent (this starts a new AgentChat)
    onSelectChat?.(chatId);
  };

  // 🔥 Fix: Handle ChatSession click - ensure Agent is selected and expanded
  const handleChatSessionClick = (chatId: string, sessionId: string, event: React.MouseEvent) => {
    event.stopPropagation();
    
    // Ensure Agent is expanded
    if (expandedAgentId !== chatId) {
      setExpandedAgentId(chatId);
    }
    
    // Ensure Agent is selected
    if (currentChatId !== chatId) {
      onSelectChat?.(chatId);
    }
    
    // Select ChatSession (use setTimeout to ensure Agent state is updated)
    setTimeout(() => {
      onSelectChatSession?.(chatId, sessionId);
    }, 0);
  };

  // 🔥 New: Handle ChatSession menu toggle
  const handleChatSessionMenuToggle = (chatId: string, sessionId: string, title: string, event: React.MouseEvent<HTMLElement>) => {
    event.stopPropagation();
    onChatSessionMenuToggle?.(chatId, sessionId, title, event.currentTarget);
  };

  // 🔥 New: Handle delete ChatSession
  const handleDeleteChatSession = (chatId: string, sessionId: string, event: React.MouseEvent) => {
    event.stopPropagation();
    onDeleteChatSession?.(chatId, sessionId);
  };

  // 🔥 New: Handle fork ChatSession
  const handleForkChatSession = (chatId: string, sessionId: string, event: React.MouseEvent) => {
    event.stopPropagation();
    onForkChatSession?.(chatId, sessionId);
  };

  // 🔥 New: Sort chats by primaryAgent, placing primaryAgent chat first
  // When excludeBuiltinAgents is true, all built-in agents are excluded from the list (displayed separately below Divider)
  const sortedChats = React.useMemo(() => {
    if (!chats.length) return [];
    
    let filteredChats = chats;
    
    // 🔥 If excludeBuiltinAgents is true, exclude all built-in agents from main list
    // Built-in agents are displayed separately below Divider, so exclude them here
    if (excludeBuiltinAgents) {
      filteredChats = chats.filter(chat => !isBuiltinAgent(chat.agent?.name, BRAND_NAME));
    }
    
    const primaryChat = filteredChats.find(chat => chat.agent?.name === primaryAgent);
    const otherChats = filteredChats.filter(chat => chat.agent?.name !== primaryAgent);
    
    // primaryAgent chat is placed first, other chats maintain original order
    return primaryChat ? [primaryChat, ...otherChats] : filteredChats;
  }, [chats, primaryAgent, excludeBuiltinAgents]);

  // 🔥 New: Scroll container ref (scroll container per chat)
  const scrollContainerRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  
  // 🔥 New: Last scroll position ref (for detecting scroll direction)
  const lastScrollTopRef = useRef<Map<string, number>>(new Map());
  
  // 🔥 New: Whether already at bottom state (for detecting continued downward scroll intent)
  const wasAtBottomRef = useRef<Map<string, boolean>>(new Map());
  
  // 🔥 New: Pull-to-load trigger state (for "can only re-trigger after scroll stops" logic)
  // Set to true after triggering a load, reset to false after user stops scrolling
  const pullToLoadTriggeredRef = useRef<Map<string, boolean>>(new Map());
  
  // 🔥 New: Scroll stop detection timer
  const scrollStopTimerRef = useRef<Map<string, NodeJS.Timeout>>(new Map());
  
  // Scroll stop threshold: 300ms without wheel events is considered stopped
  const SCROLL_STOP_DELAY = 300;

  // 🔥 New: Function to show "all loaded" hint (with debounce to avoid frequent triggers)
  const showAllLoadedHintTimerRef = useRef<Map<string, NodeJS.Timeout>>(new Map());
  
  const triggerAllLoadedHint = useCallback((chatId: string) => {
    // If hint is already showing, do not trigger again
    if (showAllLoadedHint.get(chatId)) {
      return;
    }
    
    // Show hint
    setShowAllLoadedHint(prev => {
      const newMap = new Map(prev);
      newMap.set(chatId, true);
      return newMap;
    });
    
    // Clear previous timer
    const existingTimer = showAllLoadedHintTimerRef.current.get(chatId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }
    
    // Auto-hide hint after 800ms
    const timer = setTimeout(() => {
      setShowAllLoadedHint(prev => {
        const newMap = new Map(prev);
        newMap.set(chatId, false);
        return newMap;
      });
      showAllLoadedHintTimerRef.current.delete(chatId);
    }, 800);
    
    showAllLoadedHintTimerRef.current.set(chatId, timer);
  }, [showAllLoadedHint]);

  // 🔥 New: Function to load more ChatSessions
  const loadMoreChatSessions = useCallback(async (chatId: string) => {
    const state = paginationState.get(chatId);
    
    // If currently loading, skip
    if (state?.isLoading) {
      return;
    }
    
    // 🔥 If no more data, show hint directly (spring bounce effect)
    if (!state?.hasMore) {
      triggerAllLoadedHint(chatId);
      return;
    }

    // Get current user alias
    const alias = data?.profile?.alias;
    if (!alias) {
      console.warn('[AgentList] Cannot load more: no user alias');
      return;
    }

    // Set loading state
    setPaginationState(prev => {
      const newMap = new Map(prev);
      const currentState = newMap.get(chatId);
      if (currentState) {
        newMap.set(chatId, { ...currentState, isLoading: true });
      }
      return newMap;
    });

    try {
      // Call IPC to load more
      const result = await window.electronAPI?.profile?.getMoreChatSessions(alias, chatId, state.nextMonthIndex);
      
      if (result?.success && result.data) {
        const { hasMore, nextMonthIndex } = result.data;
        
        // Update pagination state
        setPaginationState(prev => {
          const newMap = new Map(prev);
          newMap.set(chatId, {
            hasMore,
            nextMonthIndex,
            isLoading: false
          });
          return newMap;
        });
        
        // 🔥 If no more data, trigger hint display (using unified function)
        if (!hasMore) {
          triggerAllLoadedHint(chatId);
        }
        
        // Note: Newly loaded sessions sync to profileDataManager automatically via profile:cacheUpdated IPC event
        // Then passed in via chats prop, no manual update needed here
      } else {
        // Load failed, reset loading state
        setPaginationState(prev => {
          const newMap = new Map(prev);
          const currentState = newMap.get(chatId);
          if (currentState) {
            newMap.set(chatId, { ...currentState, isLoading: false });
          }
          return newMap;
        });
      }
    } catch (error) {
      console.error('[AgentList] Failed to load more chat sessions:', error);
      // Load failed, reset loading state
      setPaginationState(prev => {
        const newMap = new Map(prev);
        const currentState = newMap.get(chatId);
        if (currentState) {
          newMap.set(chatId, { ...currentState, isLoading: false });
        }
        return newMap;
      });
    }
  }, [paginationState, data?.profile?.alias, triggerAllLoadedHint]);

  // 🔥 New: Handle scroll event (only for updating scroll state)
  const handleScroll = useCallback((chatId: string, event: React.UIEvent<HTMLDivElement>) => {
    const target = event.target as HTMLDivElement;
    const { scrollTop, scrollHeight, clientHeight } = target;
    
    // Check if at bottom (within 5px of bottom is considered at bottom)
    const isAtBottom = scrollTop + clientHeight >= scrollHeight - 5;
    
    // Update state
    lastScrollTopRef.current.set(chatId, scrollTop);
    wasAtBottomRef.current.set(chatId, isAtBottom);
  }, []);

  // 🔥 New: Handle wheel event, implementing "can only re-trigger after scroll stops" Pull-to-load experience
  const handleWheel = useCallback((chatId: string, event: React.WheelEvent<HTMLDivElement>) => {
    const target = event.currentTarget;
    const { scrollTop, scrollHeight, clientHeight } = target;
    
    // Check if at bottom (within 5px of bottom is considered at bottom)
    const isAtBottom = scrollTop + clientHeight >= scrollHeight - 5;
    
    // Clear previous scroll stop timer (user is still scrolling)
    const existingTimer = scrollStopTimerRef.current.get(chatId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }
    
    // Set new scroll stop timer: 300ms later, consider user has stopped scrolling, reset trigger state
    const timer = setTimeout(() => {
      pullToLoadTriggeredRef.current.set(chatId, false);
      scrollStopTimerRef.current.delete(chatId);
    }, SCROLL_STOP_DELAY);
    scrollStopTimerRef.current.set(chatId, timer);
    
    // 🔥 Key logic: Only when already at bottom, user continues scrolling down (deltaY > 0), and this scroll session has not triggered a load yet
    if (isAtBottom && event.deltaY > 0) {
      const hasTriggered = pullToLoadTriggeredRef.current.get(chatId) || false;
      
      if (!hasTriggered) {
        // Mark this scroll session as triggered
        pullToLoadTriggeredRef.current.set(chatId, true);
        // Trigger load
        loadMoreChatSessions(chatId);
      }
    }
  }, [loadMoreChatSessions]);

  // 🔥 New: Initialize pagination state (when chats update)
  useEffect(() => {
    // Initialize pagination state for each chat (default hasMore=true, updated during actual loading)
    chats.forEach(chat => {
      if (!paginationState.has(chat.chat_id)) {
        setPaginationState(prev => {
          const newMap = new Map(prev);
          newMap.set(chat.chat_id, {
            hasMore: true, // Default: assume more data exists
            nextMonthIndex: 1, // Start from second month (initial load already loaded first batch)
            isLoading: false
          });
          return newMap;
        });
      }
    });
  }, [chats]);

  // 🔥 New: Monitor ChatSessions changes, scroll to top when new session is added
  // Used after fork session to ensure user can see the newly created session
  const prevChatSessionsCountRef = useRef<Map<string, number>>(new Map());
  
  useEffect(() => {
    chats.forEach(chat => {
      const currentCount = chat.chatSessions?.length || 0;
      const prevCount = prevChatSessionsCountRef.current.get(chat.chat_id) || 0;
      
      // If session count increased (meaning new session added, e.g., fork operation)
      if (currentCount > prevCount && prevCount > 0) {
        // Get the scroll container for this chat and scroll to top
        const scrollContainer = scrollContainerRefs.current.get(chat.chat_id);
        if (scrollContainer) {
          scrollContainer.scrollTop = 0;
          console.log('[AgentList] 🔝 Scrolled to top after new session added', {
            chatId: chat.chat_id,
            prevCount,
            currentCount
          });
        }
      }
      
      // Update recorded count
      prevChatSessionsCountRef.current.set(chat.chat_id, currentCount);
    });
  }, [chats]);

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'flex-start',
      padding: '0px',
      gap: '8px',
      width: '100%'
    }}>
      {chats.length === 0 ? (
        <div>
          <p>No chats available</p>
          <p>Create your first chat to get started</p>
        </div>
      ) : (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          width: '100%'
        }}>
          {sortedChats.map((chat) => {
            // 🔥 Check if Built-in Agent (list varies by branding)
            const isBuiltinAgentFlag = isBuiltinAgent(chat.agent?.name, BRAND_NAME);
            // 🔥 Check if Primary Agent
            const isPrimaryAgent = chat.agent?.name === primaryAgent;
            // 🔥 Check if Example Agent (demo sample)
            const isExampleAgent = chat.agent?.name === 'PM Agent - Journeys';
            const agentName = chat.agent?.name || 'Unnamed Agent';
            
            return (
              <div key={chat.chat_id} style={{ width: '100%' }}>
              <NavItem
                icon={
                  <AgentAvatar
                    emoji={chat.agent?.emoji}
                    avatar={chat.agent?.avatar}
                    name={chat.agent?.name}
                    size="sm"
                    version={chat.agent?.version}
                  />
                }
                label={
                  <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    {agentName}
                    {isBuiltinAgentFlag && (
                      <span className="kobi-builtin-badge">Built-in</span>
                    )}
                    {/* Primary badge hidden, but isPrimaryAgent logic retained for other features */}
                    {isExampleAgent && (
                      <span className="example-agent-badge">Example</span>
                    )}
                  </span>
                }
                ariaLabel={agentName}
                isActive={
                  (activeView === 'chat' || activeView === 'settings') &&
                  chat.chat_id === currentChatId &&
                  (activeView === 'settings' || !currentChatSessionId || !chat.chatSessions?.some(s => s.chatSession_id === currentChatSessionId))
                } // 🔥 Agent selection condition: (in chat or settings view) AND is current Agent AND (in settings view OR no selected session OR selected session not in list)
                onClick={() => handleAgentClick(chat.chat_id)}
                rightContent={
                  onAgentMenuToggle && chat.agent ? (
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px'
                    }}>
                      {/* 🔥 New: Start New Conversation button */}
                      <div
                        className="dropdown-menu-container"
                        style={{
                          opacity: currentChatSessionId && chat.chatSessions?.some(s => s.chatSession_id === currentChatSessionId) ? 1 : 0,
                          transition: 'opacity 0.2s ease-in-out'
                        }}
                      >
                        <div
                          className="dropdown-menu-trigger"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleAgentClick(chat.chat_id);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              e.stopPropagation();
                              handleAgentClick(chat.chat_id);
                            }
                          }}
                          title="Start new conversation"
                          aria-label="Start new conversation"
                          role="button"
                          tabIndex={0}
                          style={{ cursor: 'pointer' }}
                        >
                          <StartNewConversationIcon />
                        </div>
                      </div>
                      
                      {/* More options button */}
                      <div className="dropdown-menu-container" style={{
                        opacity: currentChatSessionId && chat.chatSessions?.some(s => s.chatSession_id === currentChatSessionId) ? 1 : 0,
                        transition: 'opacity 0.2s ease-in-out'
                      }}>
                        <div
                          className="dropdown-menu-trigger"
                          onClick={(e) => handleMenuToggle(chat.chat_id, e)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              e.stopPropagation();
                              onAgentMenuToggle?.(chat.chat_id, e.currentTarget);
                            }
                          }}
                          title="More options"
                          aria-label="More options"
                          aria-expanded={openMenuChatId === chat.chat_id}
                          aria-haspopup="menu"
                          role="button"
                          tabIndex={0}
                          style={{ cursor: 'pointer' }}
                        >
                          <MoreHorizontal size={20} strokeWidth={1.5} />
                        </div>
                      </div>
                    </div>
                  ) : undefined
                }
              />
              
              {/* 🔥 New: ChatSession sub-list */}
              {expandedAgentId === chat.chat_id && chat.chatSessions && chat.chatSessions.length > 0 && (
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                    paddingLeft: '0px',
                    paddingTop: '4px',
                    paddingBottom: '4px',
                    maxHeight: 'calc(5 * (40px + 4px))', // Height of 5 items: item height 40px + gap 4px
                    overflowY: 'auto',
                    scrollbarWidth: 'none', // Firefox
                    msOverflowStyle: 'none', // IE/Edge
                  }}
                  className="chat-sessions-list"
                  onScroll={(e) => handleScroll(chat.chat_id, e)}
                  onWheel={(e) => handleWheel(chat.chat_id, e)}
                  ref={(el) => {
                    if (el) {
                      scrollContainerRefs.current.set(chat.chat_id, el);
                    }
                  }}
                >
                  {chat.chatSessions
                    .sort((a, b) => new Date(b.last_updated).getTime() - new Date(a.last_updated).getTime())
                    .map((session) => (
                      <div
                        key={session.chatSession_id}
                        onClick={(e) => handleChatSessionClick(chat.chat_id, session.chatSession_id, e)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          padding: '0px 20px 0px 12px',
                          borderRadius: '12px',
                          cursor: 'pointer',
                          fontSize: '15px',
                          height: '40px',
                          minHeight: '40px',
                          color: currentChatSessionId === session.chatSession_id ? '#272320' : '#6C6C70',
                          backgroundColor: currentChatSessionId === session.chatSession_id ? 'rgba(0, 0, 0, 0.05)' : 'transparent',
                          transition: 'background-color 0.2s ease',
                          position: 'relative',
                        }}
                        className={`chat-session-item ${
                          openMenuChatSessionId === session.chatSession_id ? 'menu-open' : ''
                        }`}
                        onMouseEnter={(e) => {
                          if (currentChatSessionId !== session.chatSession_id) {
                            e.currentTarget.style.backgroundColor = 'rgba(0, 0, 0, 0.05)';
                          }
                          // Show more option button
                          const moreBtn = e.currentTarget.querySelector('.chat-session-more-btn') as HTMLElement;
                          if (moreBtn) {
                            moreBtn.style.opacity = '1';
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (currentChatSessionId !== session.chatSession_id) {
                            e.currentTarget.style.backgroundColor = 'transparent';
                          }
                          // Hide more option button (unless menu is open)
                          if (openMenuChatSessionId !== session.chatSession_id) {
                            const moreBtn = e.currentTarget.querySelector('.chat-session-more-btn') as HTMLElement;
                            if (moreBtn) {
                              moreBtn.style.opacity = '0';
                            }
                          }
                        }}
                        title={session.title}
                      >
                        {/* 🔥 New: Left-side loading icon area */}
                        <div style={{
                          width: '28px',
                          height: '40px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0
                        }}>
                          {(() => {
                            const status = chatSessionStatuses.get(session.chatSession_id);
                            const isLoading = status && status !== 'idle';
                            return isLoading ? <LoadingIcon /> : null;
                          })()}
                        </div>
                        
                        <span style={{
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          fontWeight: 410,
                          lineHeight: '20px',
                          fontVariationSettings: '\'opsz\' 10.5',
                          width: '184px',
                          padding: '10px 10px 10px 0px'
                        }}>
                          {session.title}
                        </span>
                        
                        {/* 🔥 New: More Option button - right-aligned, hover style controlled by CSS */}
                        {(onDeleteChatSession || onForkChatSession) && (
                          <div
                            className="chat-session-more-btn"
                            onClick={(e) => handleChatSessionMenuToggle(chat.chat_id, session.chatSession_id, session.title, e)}
                            style={{
                              opacity: openMenuChatSessionId === session.chatSession_id ? '1' : '0',
                              marginLeft: 'auto'
                            }}
                            title="More options"
                          >
                            <MoreHorizontal size={20} strokeWidth={1.5} />
                          </div>
                        )}
                        
                      </div>
                    ))}
                  
                  {/* 🔥 New: Scroll-to-load-more loading indicator */}
                  {paginationState.get(chat.chat_id)?.isLoading && (
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: '8px',
                      color: '#6C6C70',
                      fontSize: '13px'
                    }}>
                      <LoadingIcon />
                      <span style={{ marginLeft: '8px' }}>Loading...</span>
                    </div>
                  )}
                  
                  {/* 🔥 New: Temporary no-more-data hint (auto-hides after display) */}
                  {showAllLoadedHint.get(chat.chat_id) && (
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: '8px',
                      color: '#9E9E9E',
                      fontSize: '12px'
                    }}>
                      All conversations loaded
                    </div>
                  )}
                </div>
              )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default AgentList;