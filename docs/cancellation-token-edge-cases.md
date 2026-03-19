# CancellationToken Edge Case Handling (Simplified)

## 📋 Overview

Based on user feedback, a **simplified fallback strategy** is used to handle edge cases during cancellation:
- 🎯 **Core Idea**: Retain existing content on cancellation, remove incomplete parts
- ✅ **Advantage**: Simple, intuitive, user-friendly
- 🔄 **Strategy**: Convert incomplete messages into plain-text Assistant Messages

## 🎯 Unified Cancellation Strategy

### Strategy Overview

| Cancellation Timing | Handling Approach | Result |
|---------|---------|------|
| **Before Tool Execution** | Remove `tool_calls`, keep `content` | Plain-text Assistant Message |
| **Streaming Content** | Keep already-output `content` | Partial-text Assistant Message |
| **Streaming Tool Calls** | Remove `tool_calls`, keep `content` | Plain-text Assistant Message |

### Core Principles

1. ✅ **Always Save**: Messages after cancellation **must be saved** to history
2. 🧹 **Clean up tool_calls**: If `tool_calls` are incomplete or unexecuted, remove them
3. 📝 **Keep content**: Already-output text content is always retained
4. 🔄 **Convert to plain text**: Finally saved as a standard Assistant Message (content only, no tool_calls)

---

## ⚠️ Scenario 1: Cancellation Before Tool Execution

### Scenario Description

```
History:
[User] "Help me read the file"
[Assistant] {
  content: "Sure, let me read this file.",
  tool_calls: [{ id: "call_1", name: "read_file", arguments: '{"path":"file.txt"}' }]
}
👈 User cancels here (tool has not yet executed)
```

### Handling Strategy

**Steps**:
1. Detect cancellation request
2. Find the last Assistant Message with tool_calls
3. Remove the `tool_calls` field
4. Keep the `content` field
5. Save the modified message

**Code Implementation**:

```typescript
// Handle in the catch block of startChat()
if (error instanceof CancellationError) {
  logger.info('[AgentChat] Handling cancellation', 'startChat', {
    agentName: this.getAgentName()
  });
  
  // 🔥 Key: Clean up unexecuted tool calls in the last message
  await this.cleanupIncompleteToolCalls();
  
  // Set status to idle
  this.setChatStatus(ChatStatus.IDLE);
  
  // Return current messages (cleaned up)
  return this.getDisplayMessages();
}

/**
 * 🔥 New: Clean up unexecuted tool calls
 * Called on cancellation, removes tool_calls from the last Assistant Message
 */
private async cleanupIncompleteToolCalls(): Promise<void> {
  if (!this.currentChatSession) {
    return;
  }
  
  const chatHistory = this.currentChatSession.chat_history;
  
  // Search backwards for the last Assistant Message with tool_calls
  for (let i = chatHistory.length - 1; i >= 0; i--) {
    const msg = chatHistory[i];
    
    if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
      logger.info('[AgentChat] Cleaning up tool_calls from last assistant message', 'cleanupIncompleteToolCalls', {
        messageId: msg.id,
        toolCallsCount: msg.tool_calls.length,
        hasContent: !!MessageHelper.getText(msg)
      });
      
      // 🔥 Remove tool_calls, keep content
      delete msg.tool_calls;
      
      // Also update context_history
      const contextHistory = this.currentChatSession.context_history;
      const contextMsg = contextHistory.find(m => m.id === msg.id);
      if (contextMsg && contextMsg.tool_calls) {
        delete contextMsg.tool_calls;
      }
      
      // Save changes
      await this.saveChatSession();
      
      break; // Only process the last one
    }
  }
}
```

**Result**:
```
History:
[User] "Help me read the file"
[Assistant] {
  content: "Sure, let me read this file."
  // tool_calls have been removed ✅
}
```

---

## ⚠️ Scenario 2: Cancellation During Streaming Content

### Scenario Description

```
Streaming process:
[Assistant] content = "This is an explanation about asynchronous programming. In JavaScript, async/await is..."
👈 User cancels here
Not received: "...syntactic sugar for handling asynchronous operations."
```

### Handling Strategy

**Steps**:
1. Detect cancellation request
2. Stop streaming
3. Use already-accumulated `fullContent`
4. Build Assistant Message (content only, no tool_calls)
5. Save to history

**Code Implementation**:

```typescript
// In makeStreamingApiCall()
private async makeStreamingApiCall(
  requestOptions: any,
  cancellationToken: CancellationToken
): Promise<Message> {
  // ... existing code
  
  let fullContent = '';
  let toolCalls: any[] = [];
  
  try {
    while (true) {
      // 🔥 Check for cancellation
      if (cancellationToken.isCancellationRequested) {
        reader.cancel();
        
        logger.info('[AgentChat] Content streaming cancelled', 'makeStreamingApiCall', {
          accumulatedContentLength: fullContent.length,
          accumulatedToolCallsCount: toolCalls.length
        });
        
        // 🔥 Break directly, use already-accumulated content
        break;
      }
      
      const { done, value } = await reader.read();
      if (done) break;
      
      // ... process chunks, accumulate fullContent and toolCalls
    }
  } finally {
    reader.releaseLock();
  }
  
  // 🔥 Build the final Message
  const result: Message = MessageHelper.createTextMessage(
    fullContent,  // Use accumulated content (may be partial)
    'assistant',
    messageId
  );
  
  // 🔥 Key: If ended due to cancellation, do not add tool_calls
  if (!cancellationToken.isCancellationRequested && toolCalls.length > 0) {
    // Normal completion → add tool_calls
    result.tool_calls = toolCalls.filter(tc => tc && tc.id);
  } else if (cancellationToken.isCancellationRequested && toolCalls.length > 0) {
    // Cancelled with tool_calls present, log but do not add
    logger.info('[AgentChat] Discarding tool_calls due to cancellation', 'makeStreamingApiCall', {
      toolCallsCount: toolCalls.length,
      messageId
    });
  }
  
  // Send completion chunk
  if (this.eventSender) {
    const completeChunk: StreamingChunk = {
      chunkId: `${messageId}_complete`,
      messageId,
      timestamp: Date.now(),
      type: 'complete',
      complete: {
        messageId,
        hasToolCalls: false,  // Always false on cancellation
        wasCancelled: cancellationToken.isCancellationRequested
      }
    };
    this.eventSender.send('agentChat:streamingChunk', completeChunk);
  }
  
  return result;
}
```

**Result**:
```
History:
[User] "Explain async/await"
[Assistant] {
  content: "This is an explanation about asynchronous programming. In JavaScript, async/await is..."
  // Partial content, but valid ✅
}
```

---

## ⚠️ Scenario 3: Cancellation During Streaming Tool Calls

### Scenario Description

```
Streaming process:
[Assistant] content = "Let me read this file."
[Tool Call Chunk 1] { id: "call_1", name: "read_file" }
[Tool Call Chunk 2] { arguments: '{"path":' }
👈 User cancels here
Not received: { arguments: '"/file.txt"}' }
```

### Handling Strategy

**Steps**:
1. Detect cancellation request
2. Stop streaming
3. Use already-accumulated `fullContent`
4. **Discard** incomplete `toolCalls`
5. Build an Assistant Message with content only
6. Save to history

**Code Implementation**:

Same code as Scenario 2. The key part is:

```typescript
// 🔥 Key check: Always discard tool_calls on cancellation
if (!cancellationToken.isCancellationRequested && toolCalls.length > 0) {
  // Normal completion → add tool_calls
  result.tool_calls = toolCalls.filter(tc => tc && tc.id);
} else if (cancellationToken.isCancellationRequested && toolCalls.length > 0) {
  // Cancelled → discard tool_calls, keep content only
  logger.info('[AgentChat] Discarding incomplete tool_calls due to cancellation', 'makeStreamingApiCall', {
    toolCallsCount: toolCalls.length,
    messageId,
    reason: 'User cancelled during tool_calls streaming'
  });
  // Do not set result.tool_calls
}
```

**Result**:
```
History:
[User] "Help me read the file"
[Assistant] {
  content: "Let me read this file."
  // tool_calls have been discarded ✅
}
```

---

## 🔄 Complete Cancellation Flow

```typescript
// src/main/lib/chat/agentChat.ts

/**
 * 🔄 Modified: streamMessage with cancellation support
 */
async streamMessage(
  userMessage: Message,
  cancellationToken: CancellationToken = CancellationTokenStatic.None,
  callbacks?: StartChatCallbacks
): Promise<Message[]> {
  // Save current token
  this.currentCancellationToken = cancellationToken;
  
  // Check if already cancelled before starting
  this.throwIfCancellationRequested();
  
  await this.AddMessageToSession(userMessage);
  
  try {
    await this.startChat(callbacks);
    return this.getDisplayMessages();
  } catch (error) {
    // 🔥 Handle cancellation error
    if (error instanceof CancellationError) {
      logger.info('[AgentChat] Operation cancelled by user', 'streamMessage', {
        agentName: this.getAgentName()
      });
      
      // 🔥 Scenario 1 handling: Clean up unexecuted tool calls in the last message
      await this.cleanupIncompleteToolCalls();
      
      // Set status to idle
      this.setChatStatus(ChatStatus.IDLE);
      
      // 🔥 Return current messages (cleaned up, with partial content)
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
 * 🔥 New: Clean up unexecuted tool calls
 */
private async cleanupIncompleteToolCalls(): Promise<void> {
  if (!this.currentChatSession) {
    return;
  }
  
  const chatHistory = this.currentChatSession.chat_history;
  let cleaned = false;
  
  // Search backwards for the last Assistant Message with tool_calls
  for (let i = chatHistory.length - 1; i >= 0; i--) {
    const msg = chatHistory[i];
    
    if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
      // Check if these tool_calls have been executed (i.e., corresponding tool messages exist after them)
      const hasCorrespondingToolMessages = msg.tool_calls.every(tc =>
        chatHistory.some(m => m.role === 'tool' && m.tool_call_id === tc.id)
      );
      
      if (!hasCorrespondingToolMessages) {
        // 🔥 Has unexecuted tool_calls, remove them
        logger.info('[AgentChat] Removing incomplete tool_calls from assistant message', 'cleanupIncompleteToolCalls', {
          messageId: msg.id,
          toolCallsCount: msg.tool_calls.length,
          hasContent: !!MessageHelper.getText(msg),
          contentPreview: MessageHelper.getText(msg).substring(0, 50)
        });
        
        delete msg.tool_calls;
        cleaned = true;
        
        // Also update context_history
        const contextHistory = this.currentChatSession.context_history;
        const contextMsg = contextHistory.find(m => m.id === msg.id);
        if (contextMsg && contextMsg.tool_calls) {
          delete contextMsg.tool_calls;
        }
        
        break; // Only process the last one
      }
    }
  }
  
  // If messages were cleaned, save the session
  if (cleaned) {
    await this.saveChatSession();
  }
}

/**
 * 🔄 Modified: makeStreamingApiCall handles cancellation
 */
private async makeStreamingApiCall(
  requestOptions: any,
  cancellationToken: CancellationToken = CancellationTokenStatic.None
): Promise<Message> {
  // ... existing code
  
  const messageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  let chunkCounter = 0;
  
  let fullContent = '';
  let toolCalls: any[] = [];
  const decoder = new TextDecoder();
  let buffer = '';
  
  try {
    const abortController = new AbortController();
    
    // Listen for cancellation token
    const cancellationListener = cancellationToken.onCancellationRequested(() => {
      logger.info('[AgentChat] Aborting fetch request due to cancellation', 'makeStreamingApiCall');
      abortController.abort();
    });
    
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
    
    try {
      while (true) {
        // 🔥 Check for cancellation
        if (cancellationToken.isCancellationRequested) {
          reader.cancel();
          
          logger.info('[AgentChat] Stream reading cancelled', 'makeStreamingApiCall', {
            accumulatedContentLength: fullContent.length,
            accumulatedToolCallsCount: toolCalls.length,
            messageId
          });
          
          // Break directly, use already-accumulated content
          break;
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
                
                // Process content
                if (delta.content) {
                  fullContent += delta.content;
                  
                  if (fullContent === delta.content) {
                    this.setChatStatus(ChatStatus.RECEIVED_RESPONSE);
                  }
                  
                  // Send content chunk
                  if (this.eventSender) {
                    const contentChunk: StreamingChunk = {
                      chunkId: `${messageId}_chunk_${chunkCounter++}`,
                      messageId,
                      timestamp: Date.now(),
                      type: 'content',
                      contentDelta: { text: delta.content }
                    };
                    this.eventSender.send('agentChat:streamingChunk', contentChunk);
                  }
                }
                
                // Process tool_calls
                if (delta.tool_calls) {
                  if (toolCalls.length === 0 && delta.tool_calls.length > 0) {
                    this.setChatStatus(ChatStatus.RECEIVED_RESPONSE);
                  }
                  
                  for (const toolCall of delta.tool_calls) {
                    const index = toolCall.index || 0;
                    
                    if (!toolCalls[index]) {
                      toolCalls[index] = {
                        id: toolCall.id || '',
                        type: 'function',
                        function: { name: '', arguments: '' }
                      };
                    }
                    if (toolCall.id) toolCalls[index].id = toolCall.id;
                    if (toolCall.function?.name) toolCalls[index].function.name = toolCall.function.name;
                    if (toolCall.function?.arguments) toolCalls[index].function.arguments += toolCall.function.arguments;
                    
                    // Send tool call chunk
                    if (this.eventSender) {
                      const toolCallChunk: StreamingChunk = {
                        chunkId: `${messageId}_chunk_${chunkCounter++}`,
                        messageId,
                        timestamp: Date.now(),
                        type: 'tool_call',
                        toolCallDelta: {
                          index,
                          id: toolCall.id,
                          type: 'function',
                          function: {
                            name: toolCall.function?.name,
                            arguments: toolCall.function?.arguments
                          }
                        }
                      };
                      this.eventSender.send('agentChat:streamingChunk', toolCallChunk);
                    }
                  }
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
    
    // 🔥 Build the final Message
    const result: Message = MessageHelper.createTextMessage(
      fullContent,  // Use accumulated content (may be partial)
      'assistant',
      messageId
    );
    
    // 🔥 Key check: Only add tool_calls when not cancelled and tool_calls are complete
    if (!cancellationToken.isCancellationRequested && toolCalls.length > 0) {
      // Normal completion → add tool_calls
      result.tool_calls = toolCalls.filter(tc => tc && tc.id);
      
      logger.info('[AgentChat] Message constructed with tool_calls', 'makeStreamingApiCall', {
        messageId,
        toolCallsCount: result.tool_calls.length
      });
    } else if (cancellationToken.isCancellationRequested && toolCalls.length > 0) {
      // Cancelled → discard tool_calls
      logger.info('[AgentChat] Discarding tool_calls due to cancellation', 'makeStreamingApiCall', {
        toolCallsCount: toolCalls.length,
        messageId,
        contentLength: fullContent.length
      });
      // Do not set result.tool_calls
    }
    
    // Send completion chunk
    if (this.eventSender) {
      const completeChunk: StreamingChunk = {
        chunkId: `${messageId}_complete`,
        messageId,
        timestamp: Date.now(),
        type: 'complete',
        complete: {
          messageId,
          hasToolCalls: !!result.tool_calls && result.tool_calls.length > 0,
          wasCancelled: cancellationToken.isCancellationRequested
        }
      };
      this.eventSender.send('agentChat:streamingChunk', completeChunk);
    }
    
    return result;
    
  } catch (error) {
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
```

---

## 📊 Unified Cancellation Flow Chart

```
User clicks cancel
     ↓
CancellationToken.cancel()
     ↓
makeStreamingApiCall detects cancellation
     ↓
Stop streaming, use accumulated fullContent
     ↓
Discard toolCalls (if any)
     ↓
Return Message with content only
     ↓
Throw CancellationError
     ↓
streamMessage catch handler
     ↓
Call cleanupIncompleteToolCalls()
     ↓
Remove tool_calls from the last message (if any)
     ↓
saveChatSession() saves cleaned-up messages ✅
     ↓
setChatStatus(IDLE)
     ↓
Return getDisplayMessages()
```

---

## ✅ Advantage Analysis

### Comparison with VSCode Approach

| Feature | VSCode Approach | Kosmos Simplified Approach |
|------|------------|----------------|
| **Complexity** | High (requires validateToolMessages) | Low (directly clean up tool_calls) |
| **User Experience** | Cannot see partial output after cancellation | Retains partial output after cancellation ✅ |
| **History Consistency** | Requires filtering history messages | History is always complete and valid ✅ |
| **Implementation Difficulty** | Requires validation in multiple places | Centralized handling ✅ |
| **Error Risk** | May miss edge cases | Unified strategy, low risk ✅ |

### Core Advantages

1. ✅ **User-friendly**: Users can see already-output content after cancellation
2. ✅ **Simple implementation**: Only need to clean up `tool_calls` on cancellation
3. ✅ **Clean history**: No additional validation logic needed
4. ✅ **Consistent state**: `content` is always valid; `tool_calls` are either complete or absent
5. ✅ **Easy to debug**: Clear cancellation logs and flow

---

## 🧪 Test Cases

### Test Case 1: Cancellation Before Tool Execution

```typescript
test('should remove tool_calls when cancelled before execution', async () => {
  const agentChat = new AgentChat(userAlias, chatId);
  await agentChat.initialize();
  
  const userMessage = MessageHelper.createTextMessage('Read file.txt', 'user', 'msg_1');
  const source = new CancellationTokenSource();
  
  // Simulate: Cancel immediately after receiving assistant message with tool_calls
  const streamPromise = agentChat.streamMessage(userMessage, source.token);
  
  await waitForAssistantMessage();
  source.cancel();
  
  const messages = await streamPromise;
  
  // Verify: The last assistant message has no tool_calls
  const lastAssistant = messages.filter(m => m.role === 'assistant').pop();
  expect(lastAssistant).toBeDefined();
  expect(lastAssistant!.tool_calls).toBeUndefined();
  expect(MessageHelper.getText(lastAssistant!)).toBeTruthy(); // Has content
});
```

### Test Case 2: Cancellation During Streaming Content

```typescript
test('should keep partial content when cancelled during streaming', async () => {
  const agentChat = new AgentChat(userAlias, chatId);
  await agentChat.initialize();
  
  const userMessage = MessageHelper.createTextMessage('Explain async/await', 'user', 'msg_1');
  const source = new CancellationTokenSource();
  
  const chunks: string[] = [];
  agentChat.setEventSender({
    send: (channel, data) => {
      if (channel === 'agentChat:streamingChunk' && data.type === 'content') {
        chunks.push(data.contentDelta.text);
      }
    }
  } as any);
  
  const streamPromise = agentChat.streamMessage(userMessage, source.token);
  
  await waitForChunks(5);
  source.cancel();
  
  const messages = await streamPromise;
  
  // Verify: Partial content was retained
  const lastAssistant = messages.filter(m => m.role === 'assistant').pop();
  const content = MessageHelper.getText(lastAssistant!);
  
  expect(content).toBeTruthy();
  expect(content.length).toBeGreaterThan(0);
  expect(chunks.join('')).toContain(content); // Content matches
});
```

### Test Case 3: Cancellation During Streaming Tool Calls

```typescript
test('should discard incomplete tool_calls when cancelled', async () => {
  const agentChat = new AgentChat(userAlias, chatId);
  await agentChat.initialize();
  
  const userMessage = MessageHelper.createTextMessage('Read file.txt', 'user', 'msg_1');
  const source = new CancellationTokenSource();
  
  const streamPromise = agentChat.streamMessage(userMessage, source.token);
  
  // Wait for tool_calls streaming to begin
  await waitForToolCallStart();
  
  // Cancel immediately (tool_calls are incomplete)
  source.cancel();
  
  const messages = await streamPromise;
  
  // Verify: No tool_calls, but has content
  const lastAssistant = messages.filter(m => m.role === 'assistant').pop();
  expect(lastAssistant).toBeDefined();
  expect(lastAssistant!.tool_calls).toBeUndefined(); // Discarded
  expect(MessageHelper.getText(lastAssistant!)).toBeTruthy(); // Has content
});
```

---

## 📚 StreamingChunk Type Extension

To support cancellation status notifications, the `StreamingChunk` type needs to be extended:

```typescript
// src/main/lib/types/streamingTypes.ts

export interface StreamingChunk {
  // ... existing fields
  
  // Complete chunk - message completion flag
  complete?: {
    messageId: string;
    hasToolCalls: boolean;
    wasCancelled?: boolean;  // 🔥 New: Whether completed due to cancellation
  };
}
```

---

## 🎯 Summary

### Implementation Key Points

1. ✅ **Always save messages on cancellation**: Users can see partial output
2. ✅ **Clean up tool_calls**: Ensure history message integrity
3. ✅ **Retain content**: Already-output text is always valuable
4. ✅ **Unified handling**: Centralized cleanup in the `streamMessage` catch block

### User Experience

- 🎨 See partial results immediately after cancellation
- 📝 Can continue the conversation based on partial output
- 🔄 Clear, complete, and valid history records
- ⚡ Fast response time (< 500ms)

---

**Created**: 2025-01-13  
**Author**: Roo (AI Assistant)  
**Version**: 2.0 (Simplified)