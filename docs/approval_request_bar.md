# Approval Request / Approval Bar Archive

## Status

This document is archived.

The old split implementation based on `ApprovalBar`, `AskForInfo`, `pendingApprovalRequests`, and dedicated approval/info-input IPC channels has been removed from the shipped path.

## Replacement

Interactive pauses inside a chat session now use the unified interactive request model:

1. `approval`
2. `choice`
3. `form`

The current design and rollout details live in:

1. `docs/chat-session-interactive-request-prd.md`
2. `docs/chat-session-interactive-request-tech-doc.md`
3. `src/main/lib/chat/ai.prompt.md`
4. `src/renderer/components/chat/ai.prompt.md`

## Historical Note

This file is kept only as a migration breadcrumb for older discussions and commit history. Its previous architecture, event names, and component references no longer describe the current runtime.
- **Path display**: Supports single-path direct display and multi-path collapsed display
- **Independent actions**: Each request has its own Approve/Reject buttons

### 6.2 Integration
[`ChatInput.tsx:1110-1118`](src/renderer/components/chat/ChatInput.tsx:1110-1118)
```typescript
{/* ApprovalBar is embedded directly above the input-area */}
{approvalRequests.length > 0 && onApproveRequest && onRejectRequest && (
  <ApprovalBar
    requests={approvalRequests}
    onApprove={onApproveRequest}
    onReject={onRejectRequest}
    onTimeoutAutoReject={onTimeoutAutoReject}
  />
)}
```

## 7. User Response Handling

### 7.1 Approve/Reject Flow
[`ChatView.tsx:802-831`](src/renderer/components/chat/ChatView.tsx:802-831)
```typescript
const handleApprove = useCallback(async (requestId: string) => {
  const request = batchApprovalRequests.find(r => r.requestId === requestId);
  if (!request) return;

  try {
    // Send approval response to the main process
    await window.electronAPI.agentChat.sendBatchApprovalResponse({
      batchRequestId,
      requestId: request.requestId,
      toolCallId: request.toolCallId,
      approved: true,
    });
  } catch (error) {
    console.error('Failed to approve request:', error);
  }
}, [batchRequestId, batchApprovalRequests]);
```

### 7.2 Timeout Handling
[`ApprovalBar.tsx:50-59`](src/renderer/components/chat/ApprovalBar.tsx:50-59)
```typescript
useEffect(() => {
  const timer = setInterval(() => {
    setCountdown((prev) => {
      if (prev <= 1) {
        clearInterval(timer);
        // Countdown ends: batch-send reject responses
        if (onTimeoutAutoReject && currentRequestIds.length > 0) {
          onTimeoutAutoReject(currentRequestIds);
        }
        return 0;
      }
      return prev - 1;
    });
  }, 1000);
  
  return () => clearInterval(timer);
}, [requests.length, onTimeoutAutoReject]);
```

## 8. Session Switching

### 8.1 Automatic Adaptation
- The `useCurrentChatSessionId()` hook automatically tracks the currently active session
- The `usePendingApprovalRequests()` hook automatically subscribes to the new session state
- Enables seamless switching between sessions

### 8.2 State Persistence
- Each session's approval state is independently cached in `ChatSessionCache`
- Supports parallel work across multiple sessions
- When switching back to a previous session, approval state is correctly restored

## 9. Key Design Properties

### 9.1 Security
- **Reject by default**: Timeout or explicit rejection both prevent tool execution
- **Path validation**: Only paths outside the workspace require approval
- **Batch processing**: A single request can include multiple paths from multiple tools

### 9.2 User Experience
- **Intuitive UI**: Clearly shows tool name, access path, and countdown
- **Real-time updates**: State syncs automatically without refresh
- **Session isolation**: State is managed correctly in multi-agent/multi-session environments

### 9.3 Performance Optimization
- **Smart rendering**: Only approval requests for the current session trigger UI updates
- **Caching**: Inactive session requests are cached to avoid unnecessary re-renders
- **Responsive design**: Efficient state management using React Hooks

## 10. Data Flow Summary

The overall data flow can be summarized as:

```
Tool execution request → Security validation → Generate approval request →
IPC (with chatSessionId) → Frontend caches by session →
React Hook subscription → UI component render → User action →
Response sent back → Backend processing → State cleanup notification
```

This design ensures that in complex multi-agent, multi-session environments, the approval system operates correctly, safely, and efficiently, providing users with a clear authorization control interface.
