# Kosmos CancellationToken Migration Plan

## 📋 Executive Summary

Based on research into Roo-Code and vscode-copilot-chat, we recommend implementing the standard **CancellationToken pattern** for Kosmos to provide a unified, reliable conversation cancellation/pause feature.

## 🎯 Goals

1. **Unified cancellation mechanism**: Establish standard cancellation signal passing between the main process and renderer process
2. **Graceful termination**: Ensure proper resource cleanup (network connections, streaming, temporary state)
3. **State consistency**: Guarantee UI and backend state synchronization after cancellation
4. **User experience**: Provide immediate response and clear status feedback

## 🏗️ Architecture Design

### 1. Core Components

```
┌─────────────────────────────────────────────────────────────┐
│                       Frontend (Renderer)                       │
├─────────────────────────────────────────────────────────────┤
│  UI Layer                                                     │
│  ┌─────────────────┐           ┌──────────────────┐         │
│  │ Cancel Button   │──────────▶│ AgentChatIpc     │         │
│  └─────────────────┘           └──────────────────┘         │
│                                         │                     │
│                                         │ IPC                 │
└─────────────────────────────────────────┼─────────────────────┘
                                          │
┌─────────────────────────────────────────┼─────────────────────┐
│                       Main Process (Main)  │                     │
├─────────────────────────────────────────┼─────────────────────┤
│  ┌──────────────────────────────────────▼───────────────────┐ │
│  │         AgentChatManager                                 │ │
│  │  ┌────────────────────────────────────────────────┐     │ │
│  │  │ CancellationTokenSource Map                    │     │ │
│  │  │  chatId -> CancellationTokenSource             │     │ │
│  │  └────────────────────────────────────────────────┘     │ │
│  └──────────────────────────────────────┬───────────────────┘ │
│                                          │                     │
│  ┌──────────────────────────────────────▼───────────────────┐ │
│  │         AgentChat                                        │ │
│  │  ┌────────────────────────────────────────────────┐     │ │
│  │  │ private cancellationToken: CancellationToken   │     │ │
│  │  │ - isCancellationRequested: boolean             │     │ │
│  │  │ - onCancellationRequested: Event               │     │ │
│  │  └────────────────────────────────────────────────┘     │ │
│  │                                                          │ │
│  │  ┌────────────────────────────────────────────────┐     │ │
│  │  │ Streaming Loop                                 │     │ │
│  │  │  - Check token before each LLM call            │     │ │
│  │  │  - Check token in stream processing            │     │ │
│  │  │  - Check token before tool execution           │     │ │
│  │  └────────────────────────────────────────────────┘     │ │
│  └──────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### 2. Type Definitions

```typescript
// src/main/lib/cancellation/CancellationToken.ts

/**
 * Cancellation Token - Read-only interface
 * Used to check if cancellation has been requested
 */
export interface CancellationToken {
  /**
   * Whether cancellation has been requested
   */
  readonly isCancellationRequested: boolean;
  
  /**
   * Event fired when cancellation is requested
   */
  readonly onCancellationRequested: Event<void>;
}

/**
 * Cancellation Token Source - Manages the lifecycle of cancellation tokens
 */
export class CancellationTokenSource {
  private _token: MutableCancellationToken;
  private _disposed: boolean = false;
  
  constructor() {
    this._token = new MutableCancellationToken();
  }
  
  /**
   * Get the associated cancellation token
   */
  get token(): CancellationToken {
    return this._token;
  }
  
  /**
   * Request cancellation
   */
  cancel(): void {
    if (!this._disposed) {
      this._token.cancel();
    }
  }
  
  /**
   * Release resources
   */
  dispose(): void {
    if (!this._disposed) {
      this._disposed = true;
      this._token.dispose();
    }
  }
}

/**
 * Mutable cancellation token implementation
 */
class MutableCancellationToken implements CancellationToken {
  private _isCancellationRequested: boolean = false;
  private _emitter: EventEmitter<void>;
  
  constructor() {
    this._emitter = new EventEmitter<void>();
  }
  
  get isCancellationRequested(): boolean {
    return this._isCancellationRequested;
  }
  
  get onCancellationRequested(): Event<void> {
    return this._emitter.event;
  }
  
  cancel(): void {
    if (!this._isCancellationRequested) {
      this._isCancellationRequested = true;
      this._emitter.fire();
    }
  }
  
  dispose(): void {
    this._emitter.dispose();
  }
}

/**
 * Simple event emitter
 */
class EventEmitter<T> {
  private listeners: Array<(e: T) => void> = [];
  
  get event(): Event<T> {
    return (listener: (e: T) => void) => {
      this.listeners.push(listener);
      return {
        dispose: () => {
          const index = this.listeners.indexOf(listener);
          if (index > -1) {
            this.listeners.splice(index, 1);
          }
        }
      };
    };
  }
  
  fire(event?: T): void {
    this.listeners.forEach(listener => listener(event!));
  }
  
  dispose(): void {
    this.listeners = [];
  }
}

type Event<T> = (listener: (e: T) => void) => { dispose(): void };
```

## 🔄 Migration Steps

### Phase 1: Infrastructure (1-2 days)

#### 1.1 Create CancellationToken Implementation

**File**: `src/main/lib/cancellation/CancellationToken.ts`

```typescript
// Full implementation of the code from the type definitions above
```

**File**: `src/main/lib/cancellation/index.ts`

```typescript
export { CancellationToken, CancellationTokenSource } from './CancellationToken';

// Predefined cancellation tokens
export const CancellationToken = {
  None: {
    isCancellationRequested: false,
    onCancellationRequested: () => ({ dispose: () => {} })
  } as CancellationToken,
  
  Cancelled: {
    isCancellationRequested: true,
    onCancellationRequested: () => ({ dispose: () => {} })
  } as CancellationToken
};
```

#### 1.2 Integrate into AgentChatManager

**File**: `src/main/lib/chat/agentChatManager.ts`

```typescript
import { CancellationTokenSource } from '../cancellation';

export class AgentChatManager {
  // 🔥 New: Maintain CancellationTokenSource for each chat
  private cancellationSources: Map<string, CancellationTokenSource> = new Map();
  
  /**
   * 🔥 New: Create or get the CancellationTokenSource for the specified chat
   */
  private getOrCreateCancellationSource(chatId: string): CancellationTokenSource {
    let source = this.cancellationSources.get(chatId);
    if (!source) {
      source = new CancellationTokenSource();
      this.cancellationSources.set(chatId, source);
    }
    return source;
  }
  
  /**
   * 🔥 New: Cancel ongoing operations for the specified chat
   */
  async cancelChat(chatId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const source = this.cancellationSources.get(chatId);
      if (source) {
        logger.info('[AgentChatManager] 🛑 Cancelling chat', 'cancelChat', { chatId });
        source.cancel();
        
        // Wait for the operation to fully stop (monitored via chat status)
        await this.waitForChatIdle(chatId);
        
        // Clean up old source, create new one for next operation
        source.dispose();
        this.cancellationSources.delete(chatId);
        
        return { success: true };
      }
      
      return { success: false, error: 'No active operation to cancel' };
    } catch (error) {
      logger.error('[AgentChatManager] Failed to cancel chat', 'cancelChat', {
        chatId,
        error: error instanceof Error ? error.message : String(error)
      });
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }
  
  /**
   * 🔥 New: Wait for the chat to return to idle state
   */
  private async waitForChatIdle(chatId: string, timeoutMs: number = 5000): Promise<void> {
    const startTime = Date.now();
    const agentChat = this.agentInstances.get(chatId);
    
    if (!agentChat) return;
    
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        const status = agentChat.getChatStatus();
        
        if (status === 'idle' || Date.now() - startTime > timeoutMs) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 100);
    });
  }
  
  // Modify streamMessage method to pass cancellationToken
  async streamMessage(
    chatId: string,
    message: Message
  ): Promise<{ success: boolean; data?: Message[]; error?: string }> {
    const agentChat = this.agentInstances.get(chatId);
    if (!agentChat) {
      return { success: false, error: 'No agent instance found for this chat' };
    }
    
    try {
      // 🔥 Create new CancellationTokenSource for the new conversation turn
      const source = this.getOrCreateCancellationSource(chatId);
      
      // 🔥 Pass the token to AgentChat
      const messages = await agentChat.streamMessage(message, source.token);
      
      return { success: true, data: messages };
    } catch (error) {
      // Check if failure was due to cancellation
      if (error instanceof CancellationError) {
        logger.info('[AgentChatManager] Operation cancelled', 'streamMessage', { chatId });
        return { success: true, data: [] }; // Cancellation is not an error
      }
      
      logger.error('[AgentChatManager] Stream message failed', 'streamMessage', {
        chatId,
        error: error instanceof Error ? error.message : String(error)
      });
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }
}
```

### Phase 2: Integrate into AgentChat (2-3 days)

#### 2.1 Modify AgentChat Class

**File**: `src/main/lib/chat/agentChat.ts`

```typescript
import { CancellationToken, CancellationToken as CancellationTokenStatic } from '../cancellation';

export class AgentChat {
  // 🔥 New: Cancellation token for the current operation
  private currentCancellationToken: CancellationToken = CancellationTokenStatic.None;
  
  /**
   * 🔥 Modified: streamMessage accepts CancellationToken
   */
  async streamMessage(
    userMessage: Message,
    cancellationToken: CancellationToken = CancellationTokenStatic.None,
    callbacks?: StartChatCallbacks
  ): Promise<Message[]> {
    // Save the current token
    this.currentCancellationToken = cancellationToken;
    
    // 🔥 Check if already cancelled before starting
    this.throwIfCancellationRequested();
    
    await this.AddMessageToSession(userMessage);
    
    try {
      await this.startChat(callbacks);
      return this.getDisplayMessages();
    } catch (error) {
      // 🔥 CancellationError should be handled gracefully
      if (error instanceof CancellationError) {
        logger.info('[AgentChat] Operation cancelled by user', 'streamMessage', {
          agentName: this.getAgentName()
        });
        
        // Set status to idle
        this.setChatStatus(ChatStatus.IDLE);
        
        // Return current messages (partially completed conversation)
        return this.getDisplayMessages();
      }
      
      logger.error(`[AgentChat] Conversation processing failed: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    } finally {
      // Clean up token reference
      this.currentCancellationToken = CancellationTokenStatic.None;
    }
  }
  
  /**
   * 🔥 New: Check for cancellation request and throw exception
   */
  private throwIfCancellationRequested(): void {
    if (this.currentCancellationToken.isCancellationRequested) {
      throw new CancellationError('Operation was cancelled');
    }
  }
  
  /**
   * 🔥 Modified: Check for cancellation at critical points
   */
  private async startChat(callbacks: StartChatCallbacks = {}): Promise<void> {
    let requiresFollowUp = true;
    
    try {
      const sessionData = await this.getSessionFromAuthManager();
      if (!sessionData) {
        throw new GhcApiError('GitHub Copilot authentication required', 401);
      }
      
      while (requiresFollowUp) {
        // 🔥 Checkpoint 1: Check before each loop iteration
        this.throwIfCancellationRequested();
        
        await this.CheckAndCompress();
        
        // 🔥 Checkpoint 2: Check after compression
        this.throwIfCancellationRequested();
        
        this.setChatStatus(ChatStatus.SENDING_RESPONSE);
        
        // 🔥 Pass the token to the API call
        const response = await this.callWithToolsStreaming(this.currentCancellationToken);
        
        this.setChatStatus(ChatStatus.RECEIVED_RESPONSE);
        
        let responseText = MessageHelper.getText(response).trimEnd();
        const hasToolCalls = response.tool_calls && response.tool_calls.length > 0;
        
        if (hasToolCalls) {
          const normalizedToolCalls = normalizeToolCalls(response.tool_calls);
          if (normalizedToolCalls) {
            response.tool_calls = normalizedToolCalls;
          }
          
          await this.AddMessageToSession(response);
        } else if (responseText) {
          await this.AddMessageToSession(response);
        }
        
        if (hasToolCalls && response.tool_calls) {
          const approvalMap = await this.batchValidateAndRequestApproval(response.tool_calls);
          
          for (const toolCall of response.tool_calls) {
            // 🔥 Checkpoint 3: Check before each tool execution
            this.throwIfCancellationRequested();
            
            const toolName = toolCall.function.name;
            const approved = approvalMap.get(toolCall.id);
            
            try {
              const toolResult = await this.executeToolCall(toolCall, approved);
              // ... handle result
            } catch (error) {
              // ... error handling
            }
          }
          
          requiresFollowUp = true;
        } else {
          // 🔥 Checkpoint 4: Check before final save
          this.throwIfCancellationRequested();
          
          // Storage compression and fact extraction
          await this.applyStorageCompressionAndSave();
          await this.extractFactsFromConversation();
          
          requiresFollowUp = false;
          this.setChatStatus(ChatStatus.IDLE);
        }
      }
    } catch (error) {
      // CancellationError will propagate to streamMessage
      throw error;
    }
  }
  
  /**
   * 🔥 Modified: makeStreamingApiCall supports cancellation
   */
  private async makeStreamingApiCall(
    requestOptions: any,
    cancellationToken: CancellationToken = CancellationTokenStatic.None
  ): Promise<Message> {
    const session = await this.getSessionFromAuthManager();
    if (!session) {
      throw new GhcApiError('No GitHub Copilot session available', 401);
    }
    
    const url = `${GHC_CONFIG.API_ENDPOINT}/chat/completions`;
    const hasImageContent = hasImageContentInMessages(requestOptions.messages);
    
    const messageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    let chunkCounter = 0;
    
    // 🔥 Create AbortController for cancelling fetch
    const abortController = new AbortController();
    
    // 🔥 Listen to the cancellation token
    const cancellationListener = cancellationToken.onCancellationRequested(() => {
      logger.info('[AgentChat] Aborting fetch request due to cancellation', 'makeStreamingApiCall');
      abortController.abort();
    });
    
    try {
      const headers: Record<string, string> = {
        'Authorization': `Bearer ${session.accessToken}`,
        'Content-Type': 'application/json',
        'User-Agent': GHC_CONFIG.USER_AGENT,
        'Editor-Version': GHC_CONFIG.EDITOR_VERSION,
        'Editor-Plugin-Version': GHC_CONFIG.EDITOR_PLUGIN_VERSION
      };
      
      if (hasImageContent) {
        headers['Copilot-Vision-Request'] = 'true';
      }
      
      const requestBody = JSON.stringify(requestOptions);
      
      // 🔥 Pass AbortSignal to fetch
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: requestBody,
        signal: abortController.signal
      });
      
      if (!response.ok) {
        // Error handling...
        throw new GhcApiError(`GitHub Copilot API error: ${response.status}`, response.status);
      }
      
      const reader = response.body?.getReader();
      if (!reader) {
        throw new GhcApiError('Failed to get response stream reader', 500);
      }
      
      let fullContent = '';
      let toolCalls: any[] = [];
      const decoder = new TextDecoder();
      let buffer = '';
      
      try {
        while (true) {
          // 🔥 Check for cancellation before each read
          if (cancellationToken.isCancellationRequested) {
            reader.cancel();
            throw new CancellationError('Stream reading cancelled');
          }
          
          const { done, value } = await reader.read();
          if (done) break;
          
          const chunk = decoder.decode(value, { stream: true });
          buffer += chunk;
          
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          
          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed === '' || trimmed === 'data: [DONE]') continue;
            
            if (trimmed.startsWith('data: ')) {
              try {
                const jsonStr = trimmed.slice(6);
                const data = JSON.parse(jsonStr);
                
                if (data.choices && data.choices[0] && data.choices[0].delta) {
                  const delta = data.choices[0].delta;
                  
                  // Handle content and tool_calls...
                  if (delta.content) {
                    fullContent += delta.content;
                    
                    if (fullContent === delta.content) {
                      this.setChatStatus(ChatStatus.RECEIVED_RESPONSE);
                    }
                    
                    // Send chunk...
                  }
                  
                  if (delta.tool_calls) {
                    // Handle tool calls...
                  }
                }
              } catch (e) {
                logger.warn('[AgentChat] Failed to parse streaming chunk:', trimmed);
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
        cancellationListener.dispose();
      }
      
      // Build the final Message...
      const result: Message = MessageHelper.createTextMessage(fullContent, 'assistant', messageId);
      if (toolCalls.length > 0) {
        result.tool_calls = toolCalls.filter(tc => tc && tc.id);
      }
      
      // Send completion chunk...
      return result;
      
    } catch (error) {
      cancellationListener.dispose();
      
      // 🔥 Distinguish cancellation errors from other errors
      if (error instanceof Error && error.name === 'AbortError') {
        throw new CancellationError('Request aborted due to cancellation');
      }
      
      if (error instanceof CancellationError) {
        throw error;
      }
      
      logger.error(`[AgentChat] Network error during streaming: ${error instanceof Error ? error.message : String(error)}`);
      throw new GhcApiError(
        `Network error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        0
      );
    }
  }
}

/**
 * 🔥 New: Cancellation error class
 */
export class CancellationError extends Error {
  constructor(message: string = 'Operation was cancelled') {
    super(message);
    this.name = 'CancellationError';
  }
}
```

### Phase 3: IPC Layer and Frontend Integration (2 days)

#### 3.1 Add IPC Handlers

**File**: `src/main/preload.ts`

```typescript
// Add to the agentChat namespace

agentChat: {
  // ... existing methods
  
  /**
   * 🔥 New: Cancel current conversation
   */
  cancelChat: (chatId: string) => ipcRenderer.invoke('agentChat:cancelChat', chatId),
  
  /**
   * 🔥 New: Listen for chat status changes
   */
  onChatStatusChanged: (callback: (data: {
    chatId: string;
    chatStatus: string;
    agentName: string;
    timestamp: string;
  }) => void) => {
    const listener = (_event: any, data: any) => callback(data);
    ipcRenderer.on('agentChat:chatStatusChanged', listener);
    return () => ipcRenderer.removeListener('agentChat:chatStatusChanged', listener);
  }
}
```

**File**: `src/main/main.ts`

```typescript
// Add to IPC handlers

ipcMain.handle('agentChat:cancelChat', async (event, chatId: string) => {
  try {
    const { agentChatManager } = await import('./lib/chat/agentChatManager');
    const result = await agentChatManager.cancelChat(chatId);
    return result;
  } catch (error) {
    logger.error('[IPC] agentChat:cancelChat failed', 'ipcMain', {
      chatId,
      error: error instanceof Error ? error.message : String(error)
    });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
});
```

#### 3.2 Frontend UI Integration

**File**: `src/renderer/lib/chat/agentChatIpc.ts`

```typescript
class AgentChatIpc {
  // 🔥 New: Chat status listeners
  private chatStatusListeners: ((status: {
    chatId: string;
    chatStatus: string;
    agentName: string;
  }) => void)[] = [];
  
  private chatStatusCleanup: (() => void) | null = null;
  
  constructor() {
    // ... existing initialization
    this.setupChatStatusListener();
  }
  
  /**
   * 🔥 New: Set up chat status listener
   */
  private setupChatStatusListener(): void {
    this.chatStatusCleanup = window.electronAPI.agentChat.onChatStatusChanged((data) => {
      console.log('[AgentChatIpc] Chat status changed', data);
      
      this.chatStatusListeners.forEach(listener => {
        try {
          listener(data);
        } catch (error) {
          console.error('[AgentChatIpc] Error in chat status listener:', error);
        }
      });
    });
  }
  
  /**
   * 🔥 New: Cancel current conversation
   */
  async cancelChat(chatId: string): Promise<void> {
    console.log('[AgentChatIpc] Cancelling chat', { chatId });
    const result = await window.electronAPI.agentChat.cancelChat(chatId);
    if (!result.success) {
      throw new Error(result.error || 'Failed to cancel chat');
    }
  }
  
  /**
   * 🔥 New: Add chat status listener
   */
  addChatStatusListener(listener: (status: {
    chatId: string;
    chatStatus: string;
    agentName: string;
  }) => void): void {
    this.chatStatusListeners.push(listener);
  }
  
  /**
   * 🔥 New: Remove chat status listener
   */
  removeChatStatusListener(listener: (status: {
    chatId: string;
    chatStatus: string;
    agentName: string;
  }) => void): void {
    const index = this.chatStatusListeners.indexOf(listener);
    if (index > -1) {
      this.chatStatusListeners.splice(index, 1);
    }
  }
  
  destroy(): void {
    // ... existing cleanup
    
    if (this.chatStatusCleanup) {
      this.chatStatusCleanup();
      this.chatStatusCleanup = null;
    }
    
    this.chatStatusListeners = [];
  }
}
```

**File**: `src/renderer/components/pages/AgentPage.tsx`

```typescript
// Add cancel button and status display to the component

const AgentPage: React.FC = () => {
  // ... existing state
  
  // 🔥 New: Chat status
  const [chatStatus, setChatStatus] = useState<string>('idle');
  const [isCancelling, setIsCancelling] = useState(false);
  
  useEffect(() => {
    // 🔥 Listen for chat status changes
    const statusListener = (status: {
      chatId: string;
      chatStatus: string;
      agentName: string;
    }) => {
      if (status.chatId === currentChatId) {
        console.log('[AgentPage] Chat status changed', status);
        setChatStatus(status.chatStatus);
        
        // Reset state after cancellation completes
        if (isCancelling && status.chatStatus === 'idle') {
          setIsCancelling(false);
        }
      }
    };
    
    agentChatIpc.addChatStatusListener(statusListener);
    
    return () => {
      agentChatIpc.removeChatStatusListener(statusListener);
    };
  }, [currentChatId, isCancelling]);
  
  /**
   * 🔥 New: Cancel current conversation
   */
  const handleCancelChat = async () => {
    if (!currentChatId || chatStatus === 'idle') {
      return;
    }
    
    try {
      setIsCancelling(true);
      console.log('[AgentPage] Cancelling chat', { chatId: currentChatId });
      
      await agentChatIpc.cancelChat(currentChatId);
      
      console.log('[AgentPage] Chat cancelled successfully');
      
      // UI will auto-update via chatStatus listener
    } catch (error) {
      console.error('[AgentPage] Failed to cancel chat', error);
      setIsCancelling(false);
      
      // Show error notification
      // TODO: Add toast notification
    }
  };
  
  // 🔥 Calculate whether cancellation is possible
  const canCancel = chatStatus !== 'idle' && !isCancelling;
  
  return (
    <div className="agent-page">
      {/* ... existing UI */}
      
      {/* 🔥 New: Cancel button */}
      {canCancel && (
        <button
          className="cancel-button"
          onClick={handleCancelChat}
          disabled={isCancelling}
        >
          {isCancelling ? 'Cancelling...' : 'Cancel Conversation'}
        </button>
      )}
      
      {/* 🔥 New: Status indicator */}
      <div className="chat-status-indicator">
        <span className={`status-badge status-${chatStatus}`}>
          {getChatStatusText(chatStatus)}
        </span>
      </div>
      
      {/* ... other UI */}
    </div>
  );
};

/**
 * 🔥 Helper function: Get status display text
 */
function getChatStatusText(status: string): string {
  switch (status) {
    case 'idle':
      return 'Ready';
    case 'sending_response':
      return 'Waiting for response...';
    case 'received_response':
      return 'Receiving...';
    case 'compressing_context':
      return 'Compressing context...';
    case 'compressed_context':
      return 'Compression complete';
    default:
      return status;
  }
}
```

### Phase 4: Testing and Optimization (1-2 days)

#### 4.1 Unit Tests

**File**: `src/main/lib/cancellation/__tests__/CancellationToken.test.ts`

```typescript
import { CancellationTokenSource, CancellationError } from '../CancellationToken';

describe('CancellationToken', () => {
  test('should not be cancelled initially', () => {
    const source = new CancellationTokenSource();
    expect(source.token.isCancellationRequested).toBe(false);
    source.dispose();
  });
  
  test('should be cancelled after calling cancel()', () => {
    const source = new CancellationTokenSource();
    source.cancel();
    expect(source.token.isCancellationRequested).toBe(true);
    source.dispose();
  });
  
  test('should fire onCancellationRequested event', (done) => {
    const source = new CancellationTokenSource();
    
    source.token.onCancellationRequested(() => {
      expect(source.token.isCancellationRequested).toBe(true);
      source.dispose();
      done();
    });
    
    source.cancel();
  });
  
  test('should handle multiple listeners', () => {
    const source = new CancellationTokenSource();
    let count = 0;
    
    source.token.onCancellationRequested(() => count++);
    source.token.onCancellationRequested(() => count++);
    source.token.onCancellationRequested(() => count++);
    
    source.cancel();
    
    expect(count).toBe(3);
    source.dispose();
  });
  
  test('should not fire event after dispose', () => {
    const source = new CancellationTokenSource();
    let fired = false;
    
    source.token.onCancellationRequested(() => {
      fired = true;
    });
    
    source.dispose();
    source.cancel(); // Should not fire after dispose
    
    expect(fired).toBe(false);
  });
});
```

#### 4.2 Integration Test Scenarios

1. **Scenario 1: Cancel LLM response generation**
      - Start conversation → Wait 1 second → Click cancel
      - Verify: Status becomes idle, partial messages are preserved

2. **Scenario 2: Cancel tool execution**
      - Trigger tool call → Cancel during tool execution
      - Verify: Current tool execution completes, subsequent tools are not executed

3. **Scenario 3: Cancel compression operation**
      - Trigger context compression → Cancel during compression
      - Verify: Compression interrupted, uncompressed history is used

4. **Scenario 4: Rapid consecutive cancellation**
      - Start conversation → Cancel immediately → Start conversation again
      - Verify: New conversation proceeds normally

## 📊 Expected Results

### User Experience Improvements

1. **Immediate response**: Output stops within < 500ms after clicking the cancel button
2. **Clear status**: Real-time display of current operation status (waiting for response, receiving, compressing, etc.)
3. **Non-destructive cancellation**: Completed messages are preserved, conversation can continue
4. **Resource release**: Network connections and memory are released immediately upon cancellation

### Performance Metrics

- Cancellation response time: < 500ms
- Memory leaks: 0 (via dispose pattern)
- State synchronization accuracy: 100%

## 🔍 Key Decisions

### Why CancellationToken Instead of AbortFlag?

| Feature | CancellationToken | AbortFlag |
|------|-------------------|-----------|
| **Standardization** | ✅ VS Code standard pattern | ❌ Custom implementation |
| **Event-driven** | ✅ Supports listeners | ❌ Polling check |
| **Lifecycle management** | ✅ Dispose pattern | ⚠️ Manual management |
| **Test-friendly** | ✅ Easy to mock | ⚠️ Requires extra work |
| **Composability** | ✅ Can be chained | ❌ Difficult to compose |

### Relationship with Existing ChatStatus

- **ChatStatus**: Describes the current operation **type** (idle, sending, receiving, compressing)
- **CancellationToken**: Controls whether the operation **should continue** (cancelled or not)

The two are complementary, not conflicting:
```typescript
// ChatStatus tells the UI "what is currently happening"
setChatStatus(ChatStatus.SENDING_RESPONSE);

// CancellationToken tells the backend "whether it should stop"
if (cancellationToken.isCancellationRequested) {
  throw new CancellationError();
}
```

## 📝 Future Optimization Directions

1. **Support pause/resume** (Phase 2)
      - Add `pause()` and `resume()` methods
      - Save state snapshot when paused

2. **Automatic timeout cancellation** (Phase 3)
      - Add timeout mechanism for long-running operations
      - Implement automatic cancellation with CancellationToken

3. **Batch operation cancellation** (Phase 4)
      - Support batch cancellation across multiple chats
      - Provide "cancel all" functionality

## 📚 References

- [VS Code CancellationToken Documentation](https://code.visualstudio.com/api/references/vscode-api#CancellationToken)
- [vscode-copilot-chat Implementation](https://github.com/microsoft/vscode-copilot-release)
- [AbortController MDN Documentation](https://developer.mozilla.org/en-US/docs/Web/API/AbortController)

## ✅ Acceptance Criteria

- [ ] CancellationToken base class implementation completed and unit tests passed
- [ ] AgentChatManager integrated with CancellationTokenSource
- [ ] AgentChat checks for cancellation requests at critical points
- [ ] IPC layer cancelChat method added
- [ ] Frontend UI cancel button and status display added
- [ ] All integration test scenarios passed
- [ ] Performance metrics meet expectations
- [ ] Documentation updated (API docs, user manual)

---

**Created**: 2025-01-13  
**Author**: Roo (AI Assistant)  
**Version**: 1.0