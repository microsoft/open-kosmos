# CancellationToken Implementation Detailed Task Checklist

## 📋 Overview

This document provides a complete implementation checklist for the CancellationToken feature, to be executed strictly according to the design documents ([main plan](./cancellation-token-migration-plan.md) + [edge cases](./cancellation-token-edge-cases.md)).

**Estimated total duration**: 7–9 days  
**Start date**: 2025-01-13  
**Target completion date**: 2025-01-22  

---

## Phase 1: Infrastructure (1–2 days)

### 1.1 Create CancellationToken Core Classes

**File**: `src/main/lib/cancellation/CancellationToken.ts`

- [x] Create `CancellationToken` interface
  - [x] Define `isCancellationRequested: boolean` property
  - [x] Define `onCancellationRequested: Event<void>` property
  
- [x] Implement `CancellationTokenSource` class
  - [x] Implement `constructor()`
  - [x] Implement `get token(): CancellationToken`
  - [x] Implement `cancel(): void` method
  - [x] Implement `dispose(): void` method
  
- [x] Implement `MutableCancellationToken` internal class
  - [x] Implement `_isCancellationRequested` private field
  - [x] Implement `_emitter: EventEmitter<void>` private field
  - [x] Implement `get isCancellationRequested(): boolean`
  - [x] Implement `get onCancellationRequested(): Event<void>`
  - [x] Implement `cancel(): void` method
  - [x] Implement `dispose(): void` method
  
- [x] Implement `EventEmitter<T>` helper class
  - [x] Implement `listeners: Array<(e: T) => void>` private field
  - [x] Implement `get event(): Event<T>`
  - [x] Implement `fire(event?: T): void` method
  - [x] Implement `dispose(): void` method

**Acceptance Criteria**:
- [x] All type definitions have no TypeScript errors
- [x] Code passes ESLint checks
- [x] Complete JSDoc comments added

---

### 1.2 Create Export Module

**File**: `src/main/lib/cancellation/index.ts`

- [x] Export `CancellationToken` interface
- [x] Export `CancellationTokenSource` class
- [x] Export `CancellationError` class
- [x] Create predefined token constants
  - [x] Create `CancellationTokenStatic.None`
  - [x] Create `CancellationTokenStatic.Cancelled`

**Acceptance Criteria**:
- [x] All exports can be correctly imported from other modules
- [x] TypeScript type resolution is correct

---

### 1.3 Create CancellationError Class

**File**: `src/main/lib/cancellation/CancellationToken.ts` (append)

- [x] Implement `CancellationError` class
  - [x] Extends `Error`
  - [x] Implement `constructor(message?: string)`
  - [x] Set `name = 'CancellationError'`

**Acceptance Criteria**:
- [x] Can correctly `throw new CancellationError()`
- [x] Can be detected via `error instanceof CancellationError`

---

### 1.4 Unit Tests

**File**: `src/main/lib/cancellation/__tests__/CancellationToken.test.ts`

- [x] Test `CancellationTokenSource` basic functionality
  - [x] Test initial state (not cancelled)
  - [x] Test state change after calling `cancel()`
  - [x] Test `onCancellationRequested` event firing
  - [x] Test multiple listeners
  - [x] Test no events fire after `dispose()`
  
- [x] Test predefined tokens
  - [x] Test `CancellationTokenStatic.None` never cancels
  - [x] Test `CancellationTokenStatic.Cancelled` is already cancelled
  
- [x] Test `CancellationError`
  - [x] Test error message
  - [x] Test error name
  - [x] Test `instanceof` detection

**Acceptance Criteria**:
- [x] All tests pass (26/26 tests pass ✅)
- [x] Test run time < 10s ✅

---

## Phase 2: AgentChatManager Integration (1 day)

### 2.1 Add CancellationTokenSource Management

**File**: `src/main/lib/chat/agentChatManager.ts`

- [ ] Import `CancellationTokenSource` and `CancellationError`
- [ ] Add private field `cancellationSources: Map<string, CancellationTokenSource>`
- [ ] Implement `getOrCreateCancellationSource(chatId: string)` method
  - [ ] Check if source already exists
  - [ ] Create new source if not
  - [ ] Return source

**Acceptance Criteria**:
- [ ] Each chatId has its own independent CancellationTokenSource
- [ ] Source can be correctly retrieved and created

---

### 2.2 Implement cancelChat Method

**File**: `src/main/lib/chat/agentChatManager.ts` (append)

- [ ] Implement `cancelChat(chatId: string)` method
  - [ ] Get the corresponding CancellationTokenSource
  - [ ] Return error if not found
  - [ ] Call `source.cancel()`
  - [ ] Wait for chat status to become idle (using `waitForChatIdle`)
  - [ ] Dispose the old source
  - [ ] Delete from Map
  - [ ] Return success result
  
- [ ] Implement `waitForChatIdle(chatId: string, timeoutMs?: number)` private method
  - [ ] Get agentChat instance
  - [ ] Poll `getChatStatus()` to check if it is 'idle'
  - [ ] Force return after timeout
  - [ ] Use `setInterval` for polling

**Acceptance Criteria**:
- [ ] Chat status becomes idle after call
- [ ] Timeout mechanism works correctly (default 5000ms)
- [ ] Error handling is thorough

---

### 2.3 Modify streamMessage Method

**File**: `src/main/lib/chat/agentChatManager.ts` (modify)

- [ ] Modify `streamMessage` method signature (keep backward compatibility)
- [ ] Call `getOrCreateCancellationSource(chatId)` at method start
- [ ] Pass `source.token` to `agentChat.streamMessage(message, source.token)`
- [ ] Add `CancellationError` catch handling
  - [ ] Return `{ success: true, data: [] }` after catching (cancellation is not an error)
  - [ ] Log the event

**Acceptance Criteria**:
- [ ] Token is correctly passed to AgentChat
- [ ] CancellationError is correctly caught
- [ ] Existing functionality is unaffected

---

### 2.4 Cleanup Mechanism

**File**: `src/main/lib/chat/agentChatManager.ts` (modify)

- [ ] Clean up all CancellationTokenSources in the `destroy()` method
  - [ ] Iterate over the `cancellationSources` Map
  - [ ] Call `dispose()` on each source
  - [ ] Clear the Map

**Acceptance Criteria**:
- [ ] All resources are correctly released on destroy
- [ ] No memory leaks

---

## Phase 3: AgentChat Integration (2–3 days)

### 3.1 Modify streamMessage Method

**File**: `src/main/lib/chat/agentChat.ts`

- [ ] Import `CancellationToken`, `CancellationError`
- [ ] Add private field `currentCancellationToken: CancellationToken`
- [ ] Modify `streamMessage` method signature
  - [ ] Add `cancellationToken` parameter (default `CancellationToken.None`)
- [ ] Save token to `currentCancellationToken` at method start
- [ ] Call `throwIfCancellationRequested()` to check initial state
- [ ] Modify `catch` block to handle `CancellationError`
  - [ ] After catching, call `cleanupIncompleteToolCalls()`
  - [ ] Call `setChatStatus(ChatStatus.IDLE)`
  - [ ] Return `getDisplayMessages()`
- [ ] Reset token to `None` in `finally` block

**Acceptance Criteria**:
- [ ] Token is correctly passed to all sub-methods
- [ ] State is correct after cancellation
- [ ] Partial messages are saved

---

### 3.2 Implement Cancellation Check Method

**File**: `src/main/lib/chat/agentChat.ts` (append)

- [ ] Implement `throwIfCancellationRequested()` private method
  - [ ] Check `currentCancellationToken.isCancellationRequested`
  - [ ] If true, throw `CancellationError`

**Acceptance Criteria**:
- [ ] Method correctly checks cancellation state
- [ ] Thrown error type is correct

---

### 3.3 Add Checkpoints in startChat

**File**: `src/main/lib/chat/agentChat.ts` (modify)

- [ ] Add checkpoints at key locations in the `startChat` method
  - [ ] Checkpoint 1: Before each while loop iteration
  - [ ] Checkpoint 2: After `CheckAndCompress()`
  - [ ] Checkpoint 3: Before each tool call execution
  - [ ] Checkpoint 4: Before final save
- [ ] Each checkpoint calls `throwIfCancellationRequested()`

**Acceptance Criteria**:
- [ ] Can stop within 500ms after cancellation
- [ ] All checkpoint locations are appropriate

---

### 3.4 Modify makeStreamingApiCall to Support Cancellation

**File**: `src/main/lib/chat/agentChat.ts` (modify)

- [ ] Modify method signature to add `cancellationToken` parameter
- [ ] Create `AbortController` instance
- [ ] Listen to `cancellationToken.onCancellationRequested` event
  - [ ] On event fire, call `abortController.abort()`
- [ ] Pass `abortController.signal` to `fetch()`
- [ ] Check for cancellation in the streaming loop
  - [ ] Check `cancellationToken.isCancellationRequested`
  - [ ] If true, call `reader.cancel()` and break
- [ ] Handle cancellation when building the final Message
  - [ ] If not cancelled and toolCalls exist, add to result
  - [ ] If cancelled, discard toolCalls, retain only content
- [ ] Dispose listener in finally block
- [ ] Distinguish AbortError from other errors in catch block
  - [ ] Convert AbortError to CancellationError
  - [ ] Rethrow CancellationError directly
  - [ ] Wrap other errors as GhcApiError

**Acceptance Criteria**:
- [ ] fetch requests can be correctly cancelled
- [ ] Streaming can be interrupted
- [ ] Partial content is correctly retained
- [ ] toolCalls are discarded on cancellation

---

### 3.5 Implement cleanupIncompleteToolCalls Method

**File**: `src/main/lib/chat/agentChat.ts` (append)

- [ ] Implement `cleanupIncompleteToolCalls()` private method
  - [ ] Check if `currentChatSession` exists
  - [ ] Get `chat_history`
  - [ ] Search backward for the last Assistant Message with tool_calls
  - [ ] Check if these tool_calls have corresponding tool messages
  - [ ] If not, delete the `tool_calls` field
  - [ ] Also update the corresponding message in `context_history`
  - [ ] Call `saveChatSession()` to save changes
  - [ ] Log detailed information

**Acceptance Criteria**:
- [ ] Orphan tool_calls are correctly removed
- [ ] Message content is retained
- [ ] chat_history and context_history are synced

---

### 3.6 Modify callWithToolsStreaming

**File**: `src/main/lib/chat/agentChat.ts` (modify)

- [ ] Modify method signature to add `cancellationToken` parameter
- [ ] Pass token to `makeStreamingApiCall()`

**Acceptance Criteria**:
- [ ] Token is correctly passed
- [ ] Functionality is unaffected

---

### 3.7 Extend StreamingChunk Type

**File**: `src/main/lib/types/streamingTypes.ts`

- [ ] Modify the `complete` field definition
  - [ ] Add `wasCancelled?: boolean` optional field

**Acceptance Criteria**:
- [ ] Type definition is correct
- [ ] Frontend can receive this field

---

## Phase 4: IPC Layer Integration (1 day)

### 4.1 Add Preload API

**File**: `src/preload/main.ts`

- [ ] Add methods in the `agentChat` namespace
  - [ ] Add `cancelChat: (chatId: string) => Promise<{success: boolean; error?: string}>`
  - [ ] Add `onChatStatusChanged: (callback) => () => void`

**Acceptance Criteria**:
- [ ] API definition is correct
- [ ] TypeScript types are complete

---

### 4.2 Add IPC Handler

**File**: `src/main/main.ts`

- [ ] Register `agentChat:cancelChat` IPC handler
  - [ ] Parse chatId parameter
  - [ ] Import `agentChatManager`
  - [ ] Call `agentChatManager.cancelChat(chatId)`
  - [ ] Return result
  - [ ] Add error handling

**Acceptance Criteria**:
- [ ] IPC communication works correctly
- [ ] Errors are correctly caught and returned

---

### 4.3 Send chatStatusChanged Event

**File**: `src/main/lib/chat/agentChat.ts` (modify)

- [ ] Confirm that `setChatStatus` method already sends events
- [ ] Verify event data format
  - [ ] `chatId: string`
  - [ ] `chatStatus: string`
  - [ ] `agentName: string`
  - [ ] `timestamp: string`

**Acceptance Criteria**:
- [ ] Events are correctly sent to the renderer process
- [ ] Data format is correct

---

## Phase 5: Frontend Integration (2 days)

### 5.1 Update AgentChatIpc

**File**: `src/renderer/lib/chat/agentChatIpc.ts`

- [ ] Add private fields
  - [ ] `chatStatusListeners: Array<(status) => void>`
  - [ ] `chatStatusCleanup: (() => void) | null`
  
- [ ] Call `setupChatStatusListener()` in constructor
  
- [ ] Implement `setupChatStatusListener()` private method
  - [ ] Use `window.electronAPI.agentChat.onChatStatusChanged`
  - [ ] Save cleanup function to `chatStatusCleanup`
  - [ ] Trigger all `chatStatusListeners`
  
- [ ] Implement `cancelChat(chatId: string)` method
  - [ ] Call `window.electronAPI.agentChat.cancelChat(chatId)`
  - [ ] Handle error cases
  - [ ] Log the event
  
- [ ] Implement `addChatStatusListener(listener)` method
- [ ] Implement `removeChatStatusListener(listener)` method
  
- [ ] Clean up in `destroy()`
  - [ ] Call `chatStatusCleanup()` if it exists
  - [ ] Clear `chatStatusListeners` array

**Acceptance Criteria**:
- [ ] Status changes can be correctly listened to
- [ ] cancelChat method works correctly
- [ ] Resources are correctly cleaned up

---

### 5.2 Update AgentPage UI

**File**: `src/renderer/components/pages/AgentPage.tsx`

- [ ] Add state
  - [ ] `chatStatus: string` (default 'idle')
  - [ ] `isCancelling: boolean` (default false)
  
- [ ] Add useEffect to listen for status
  - [ ] Call `agentChatIpc.addChatStatusListener`
  - [ ] Update `chatStatus` state
  - [ ] Handle state reset after cancellation completes
  - [ ] Remove listener on cleanup
  
- [ ] Implement `handleCancelChat` method
  - [ ] Check `currentChatId` and `chatStatus`
  - [ ] Set `isCancelling = true`
  - [ ] Call `agentChatIpc.cancelChat(currentChatId)`
  - [ ] Handle errors (show toast)
  - [ ] Log the event
  
- [ ] Compute `canCancel` state
  - [ ] `chatStatus !== 'idle' && !isCancelling`
  
- [ ] Add cancel button UI
  - [ ] Show only when `canCancel`
  - [ ] Bind `handleCancelChat` event
  - [ ] Display cancellation status text
  - [ ] Handle disabled state
  
- [ ] Add status indicator UI
  - [ ] Display current `chatStatus`
  - [ ] Use different colors to distinguish states
  - [ ] Add CSS styles

**Acceptance Criteria**:
- [ ] Cancel button shows and hides correctly
- [ ] Clicking cancels the conversation
- [ ] Status indicator updates in real time
- [ ] User experience is smooth

---

### 5.3 Add CSS Styles

**File**: `src/renderer/styles/Agent.css` (or relevant style file)

- [ ] Add cancel button styles
  - [ ] `.cancel-button` base style
  - [ ] `:hover` state
  - [ ] `:disabled` state
  
- [ ] Add status indicator styles
  - [ ] `.chat-status-indicator` container
  - [ ] `.status-badge` base style
  - [ ] `.status-idle` style
  - [ ] `.status-sending_response` style
  - [ ] `.status-received_response` style
  - [ ] `.status-compressing_context` style

**Acceptance Criteria**:
- [ ] Styles look good
- [ ] Responsive design
- [ ] Consistent with existing UI style

---

## Phase 6: Testing (1–2 days)

### 6.1 Unit Tests

- [ ] **CancellationToken unit tests** (already in Phase 1.4)
  
- [ ] **AgentChat unit tests**
  - **File**: `src/main/lib/chat/__tests__/agentChat.cancel.test.ts`
  - [ ] Test `cleanupIncompleteToolCalls()` method
  - [ ] Test `throwIfCancellationRequested()` method
  - [ ] Test state reset after cancellation
  
- [ ] **AgentChatManager unit tests**
  - **File**: `src/main/lib/chat/__tests__/agentChatManager.cancel.test.ts`
  - [ ] Test `cancelChat()` method
  - [ ] Test `getOrCreateCancellationSource()` method
  - [ ] Test independent cancellation of multiple chats

**Acceptance Criteria**:
- [ ] All unit tests pass
- [ ] Code coverage > 80%

---

### 6.2 Integration Tests

- [ ] **Scenario 1: Cancellation before tool execution**
  - **File**: `src/main/lib/chat/__tests__/integration/cancel-before-tool.test.ts`
  - [ ] Send a message that triggers a tool call
  - [ ] Wait to receive assistant message with tool_calls
  - [ ] Cancel immediately
  - [ ] Verify tool_calls are removed
  - [ ] Verify content is retained
  - [ ] Verify message is saved
  
- [ ] **Scenario 2: Cancellation during Streaming Content**
  - **File**: `src/main/lib/chat/__tests__/integration/cancel-during-content.test.ts`
  - [ ] Send a message
  - [ ] Wait to receive some content chunks
  - [ ] Cancel
  - [ ] Verify partial content is retained
  - [ ] Verify message is saved
  
- [ ] **Scenario 3: Cancellation during Streaming Tool Calls**
  - **File**: `src/main/lib/chat/__tests__/integration/cancel-during-toolcalls.test.ts`
  - [ ] Send a message that triggers a tool call
  - [ ] Wait until tool_calls chunks start arriving
  - [ ] Cancel immediately
  - [ ] Verify tool_calls are discarded
  - [ ] Verify content is retained
  - [ ] Verify message is saved
  
- [ ] **Scenario 4: Rapid successive cancellation**
  - **File**: `src/main/lib/chat/__tests__/integration/cancel-rapid.test.ts`
  - [ ] Send a message
  - [ ] Cancel immediately
  - [ ] Send another message
  - [ ] Verify new message is processed normally

**Acceptance Criteria**:
- [ ] All integration tests pass
- [ ] Tests run stably
- [ ] Edge cases are fully covered

---

### 6.3 E2E Tests

- [ ] **E2E test: complete cancellation flow**
  - **File**: `tests/e2e/cancellation.spec.ts`
  - [ ] Start application
  - [ ] Sign in
  - [ ] Create new conversation
  - [ ] Send message
  - [ ] Click cancel button
  - [ ] Verify conversation stops
  - [ ] Verify status is updated
  - [ ] Verify partial message is displayed

**Acceptance Criteria**:
- [ ] E2E tests pass
- [ ] User experience meets expectations

---

### 6.4 Performance Tests

- [ ] **Cancellation response time test**
  - [ ] Measure time from clicking cancel to stopping output
  - [ ] Verify < 500ms
  
- [ ] **Memory leak test**
  - [ ] Repeat cancellation operation 100 times
  - [ ] Monitor memory usage
  - [ ] Verify no memory growth
  
- [ ] **Concurrent cancellation test**
  - [ ] Cancel multiple chats simultaneously
  - [ ] Verify each chat works independently
  - [ ] Verify no race conditions

**Acceptance Criteria**:
- [ ] Performance metrics are met
- [ ] No memory leaks
- [ ] Concurrency is safe

---

## Phase 7: Documentation and Wrap-Up (1 day)

### 7.1 Code Documentation

- [ ] Add JSDoc comments to all public methods
- [ ] Add usage examples
- [ ] Update TypeScript type definitions

**Acceptance Criteria**:
- [ ] All public APIs have complete documentation
- [ ] Code readability is good

---

### 7.2 User Documentation

- [ ] **User manual update**
  - **File**: `docs/user-guide.md` (or relevant file)
  - [ ] Add "How to cancel a conversation" section
  - [ ] Add screenshots
  - [ ] Explain status indicator meanings
  
- [ ] **API documentation update**
  - **File**: `docs/api-reference.md` (or relevant file)
  - [ ] Document the `cancelChat` API
  - [ ] Document the `onChatStatusChanged` event
  - [ ] Document the CancellationToken type

**Acceptance Criteria**:
- [ ] Documentation is complete and clear
- [ ] Examples are accurate

---

### 7.3 Changelog

- [ ] **Update CHANGELOG.md**
  - [ ] Add new version number
  - [ ] List new features
    - [ ] Support cancelling/pausing conversations
    - [ ] Add real-time status indicator
  - [ ] List API changes
  - [ ] List fixed issues

**Acceptance Criteria**:
- [ ] CHANGELOG follows standard format
- [ ] All changes are recorded

---

### 7.4 Code Review

- [ ] Self code review
  - [ ] Check naming consistency
  - [ ] Check error handling completeness
  - [ ] Check logging adequacy
  - [ ] Check performance optimizations
  
- [ ] Team code review (if applicable)
  - [ ] Create Pull Request
  - [ ] Address review comments
  - [ ] Obtain approval

**Acceptance Criteria**:
- [ ] Code quality meets standards
- [ ] No obvious issues

---

### 7.5 Release Preparation

- [ ] Run all test suites
  - [ ] Unit tests
  - [ ] Integration tests
  - [ ] E2E tests
  
- [ ] Update version number
  - [ ] `package.json`
  - [ ] Other related files
  
- [ ] Create release tag
- [ ] Prepare release notes

**Acceptance Criteria**:
- [ ] All tests pass
- [ ] Version number is correct
- [ ] Release process is ready

---

## 📊 Progress Tracking

### Completion Statistics

- **Total tasks**: 140+
- **Completed**: ___
- **In progress**: ___
- **Not started**: ___
- **Completion percentage**: ___%

### Daily Progress Log

| Date | Completed Tasks | Issues Encountered | Solutions | Notes |
|------|----------------|--------------------|-----------|-------|
| YYYY-MM-DD | | | | |
| YYYY-MM-DD | | | | |
| YYYY-MM-DD | | | | |

---

## 🎯 Key Milestones

- [ ] **Milestone 1**: Infrastructure complete (Phase 1)
  - **Target date**: ___________
  - **Actual completion**: ___________
  
- [ ] **Milestone 2**: Main process integration complete (Phases 2–3)
  - **Target date**: ___________
  - **Actual completion**: ___________
  
- [ ] **Milestone 3**: Frontend integration complete (Phases 4–5)
  - **Target date**: ___________
  - **Actual completion**: ___________
  
- [ ] **Milestone 4**: Testing complete (Phase 6)
  - **Target date**: ___________
  - **Actual completion**: ___________
  
- [ ] **Milestone 5**: Release ready (Phase 7)
  - **Target date**: ___________
  - **Actual completion**: ___________

---

## 📚 Reference Documents

- [Main migration plan](./cancellation-token-migration-plan.md)
- [Edge case handling](./cancellation-token-edge-cases.md)
- [VS Code CancellationToken API](https://code.visualstudio.com/api/references/vscode-api#CancellationToken)
- [AbortController MDN](https://developer.mozilla.org/en-US/docs/Web/API/AbortController)

---

## ⚠️ Risks and Considerations

### Known Risks

1. **Concurrency issues**
   - Risk: Cancelling multiple chats simultaneously may cause race conditions
   - Mitigation: Each chat uses its own independent CancellationTokenSource
   
2. **Memory leaks**
   - Risk: Event listeners not correctly cleaned up
   - Mitigation: Strictly use dispose pattern
   
3. **State synchronization**
   - Risk: Frontend and backend states become inconsistent
   - Mitigation: Keep in sync via chatStatusChanged events

### Considerations

- ⚠️ Must check cancellation state after every async operation
- ⚠️ Must correctly handle CancellationError — it must not be treated as a regular error
- ⚠️ Must test all edge cases
- ⚠️ Must ensure dispose is called to prevent memory leaks

---

**Document version**: 1.0  
**Created**: 2025-01-13  
**Last updated**: 2025-01-13  
**Maintainer**: Development team
