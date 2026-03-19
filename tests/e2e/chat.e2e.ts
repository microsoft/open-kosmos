/**
 * Phase 3 — Chat E2E Tests
 *
 * Uses mockedChatReadyApp fixture (pre-seeded auth + chat-ready environment)
 * Tests basic Agent chat functionality
 *
 * All API requests are mocked, no real endpoints are called.
 * Chat responses are simulated by the agentChat:streamMessage mock handler in mockedApp.ts.
 *
 * Test scenarios:
 * 1. Chat UI element validation — textarea, send button, model selector
 * 2. Send message — type text, click send, verify user message display
 * 3. Receive AI response — verify assistant message rendering
 * 4. Keyboard shortcut — Enter to send message
 */
import { mockedChatReadyTest, expect } from './fixtures/mockedApp';
import { Selectors } from './helpers/selectors';

mockedChatReadyTest.describe('Chat Functionality Tests', () => {
  // ==================== Test 1: Chat UI Element Validation ====================

  mockedChatReadyTest(
    'Chat UI elements visible — textarea, send button',
    async ({ chatWindow }) => {
      // 1. Verify reached /agent route
      const currentUrl = chatWindow.url();
      expect(currentUrl).toContain('#/agent');

      // 2. Verify chat textarea is visible
      const textarea = chatWindow.locator(Selectors.CHAT_TEXTAREA);
      await expect(textarea).toBeVisible({ timeout: 10_000 });

      // 3. Verify send button is visible
      const sendButton = chatWindow.locator(Selectors.CHAT_SEND_BUTTON);
      await expect(sendButton).toBeVisible({ timeout: 5_000 });

      // 4. Verify page has actual content
      const rootElement = chatWindow.locator('#root');
      await expect(rootElement).toBeVisible({ timeout: 5_000 });
    },
  );

  // ==================== Test 2: Send Message ====================

  mockedChatReadyTest(
    'Send message — type text and click send, verify user message display',
    async ({ chatWindow }) => {
      // 1. Wait for textarea to be available
      const textarea = chatWindow.locator(Selectors.CHAT_TEXTAREA);
      await expect(textarea).toBeVisible({ timeout: 10_000 });

      // 2. Type message
      const testMessage = 'Hello, Kobi! This is a test message.';
      await textarea.click();
      await textarea.pressSequentially(testMessage);

      // 3. Verify textarea has text
      const textareaValue = await textarea.inputValue();
      expect(textareaValue).toBe(testMessage);

      // 4. Click send button
      const sendButton = chatWindow.locator(Selectors.CHAT_SEND_BUTTON);
      await expect(sendButton).toBeVisible({ timeout: 5_000 });
      await sendButton.click();

      // 5. Verify user message appears in chat area
      //    ChatInput.handleSend() → AgentPage.sendMessage() →
      //    agentChatSessionCacheManager.addUserMessage() → UI updates immediately
      const userMessage = chatWindow.locator(Selectors.CHAT_USER_MESSAGE);
      await expect(userMessage.first()).toBeVisible({ timeout: 10_000 });

      // 6. Verify user message content
      const userMessageContent = userMessage
        .first()
        .locator(Selectors.CHAT_MESSAGE_CONTENT)
        .first();
      await expect(userMessageContent).toContainText(testMessage, {
        timeout: 5_000,
      });
    },
  );

  // ==================== Test 3: Receive AI Response ====================

  mockedChatReadyTest(
    'Receive AI response — verify assistant message renders after sending message',
    async ({ chatApp, chatWindow }) => {
      // 1. Wait for textarea to be available
      const textarea = chatWindow.locator(Selectors.CHAT_TEXTAREA);
      await expect(textarea).toBeVisible({ timeout: 10_000 });

      // 2. Send message
      const testMessage = 'Hi Kobi, how are you?';
      await textarea.click();
      await textarea.pressSequentially(testMessage);

      const sendButton = chatWindow.locator(Selectors.CHAT_SEND_BUTTON);
      await sendButton.click();

      // 3. Wait for mock handler to store pendingStreamResponse, then push streaming events from fixture side
      //    (setTimeout + webContents.send is unreliable in test env, need to push from fixture side)
      let streamInfo: { assistantMessageId: string; mockResponse: string; chatId: string; chatSessionId: string } | null = null;
      for (let i = 0; i < 50; i++) {
        streamInfo = await chatApp.evaluate(() => {
          return (global as any).__e2e_pendingStreamResponse ?? null;
        });
        if (streamInfo?.assistantMessageId) break;
        await chatWindow.waitForTimeout(100);
      }
      expect(streamInfo).not.toBeNull();
      if (!streamInfo) throw new Error('streamInfo is null');

      // Push streaming event sequence from fixture side
      await chatApp.evaluate(({ BrowserWindow }, info) => {
        const wins = BrowserWindow.getAllWindows();
        if (wins.length === 0) return;
        const wc = wins[0].webContents;

        // Status: sending_response
        wc.send('agentChat:chatStatusChanged', {
          chatId: info.chatId,
          chatSessionId: info.chatSessionId,
          chatStatus: 'sending_response',
        });
      }, streamInfo);

      // Brief wait for status change to reach renderer process
      await chatWindow.waitForTimeout(100);

      // Push content chunk
      await chatApp.evaluate(({ BrowserWindow }, info) => {
        const wins = BrowserWindow.getAllWindows();
        if (wins.length === 0) return;
        const wc = wins[0].webContents;

        wc.send('agentChat:streamingChunk', {
          chunkId: 'chunk_content_' + Date.now(),
          messageId: info.assistantMessageId,
          chatId: info.chatId,
          chatSessionId: info.chatSessionId,
          timestamp: Date.now(),
          type: 'content',
          contentDelta: { text: info.mockResponse },
        });
      }, streamInfo);

      await chatWindow.waitForTimeout(100);

      // Push complete chunk
      await chatApp.evaluate(({ BrowserWindow }, info) => {
        const wins = BrowserWindow.getAllWindows();
        if (wins.length === 0) return;
        const wc = wins[0].webContents;

        wc.send('agentChat:streamingChunk', {
          chunkId: 'chunk_complete_' + Date.now(),
          messageId: info.assistantMessageId,
          chatId: info.chatId,
          chatSessionId: info.chatSessionId,
          timestamp: Date.now(),
          type: 'complete',
          complete: { messageId: info.assistantMessageId, hasToolCalls: false },
        });
      }, streamInfo);

      await chatWindow.waitForTimeout(100);

      // Status: received_response → idle
      await chatApp.evaluate(({ BrowserWindow }, info) => {
        const wins = BrowserWindow.getAllWindows();
        if (wins.length === 0) return;
        const wc = wins[0].webContents;

        wc.send('agentChat:chatStatusChanged', {
          chatId: info.chatId,
          chatSessionId: info.chatSessionId,
          chatStatus: 'received_response',
        });
      }, streamInfo);

      await chatWindow.waitForTimeout(100);

      await chatApp.evaluate(({ BrowserWindow }, info) => {
        const wins = BrowserWindow.getAllWindows();
        if (wins.length === 0) return;
        const wc = wins[0].webContents;

        wc.send('agentChat:chatStatusChanged', {
          chatId: info.chatId,
          chatSessionId: info.chatSessionId,
          chatStatus: 'idle',
        });
      }, streamInfo);

      // 4. Wait for assistant message to appear
      const assistantMessage = chatWindow.locator(
        Selectors.CHAT_ASSISTANT_MESSAGE,
      );
      await expect(assistantMessage.first()).toBeVisible({ timeout: 15_000 });

      // 5. Verify assistant message contains mock response content
      //    Mock response: "Hello! I am Kobi, your AI assistant. How can I help you today?"
      const assistantContent = assistantMessage
        .first()
        .locator(Selectors.CHAT_MESSAGE_CONTENT)
        .first();
      await expect(assistantContent).toContainText('Kobi', {
        timeout: 10_000,
      });

      // 6. Verify send button returns to idle state (cancel button disappears)
      await expect(
        chatWindow.locator(Selectors.CHAT_SEND_BUTTON),
      ).toBeVisible({ timeout: 10_000 });
    },
  );

  // ==================== Test 4: Enter Key Sends Message ====================

  mockedChatReadyTest(
    'Keyboard Enter sends message',
    async ({ chatWindow }) => {
      // 1. Wait for textarea to be available
      const textarea = chatWindow.locator(Selectors.CHAT_TEXTAREA);
      await expect(textarea).toBeVisible({ timeout: 10_000 });

      // 2. Type message
      const testMessage = 'Testing Enter key send';
      await textarea.click();
      await textarea.pressSequentially(testMessage);

      // 3. Press Enter to send
      await textarea.press('Enter');

      // 4. Verify user message appears
      const userMessage = chatWindow.locator(Selectors.CHAT_USER_MESSAGE);
      await expect(userMessage.first()).toBeVisible({ timeout: 10_000 });

      // 5. Verify user message content
      const userMessageContent = userMessage
        .first()
        .locator(Selectors.CHAT_MESSAGE_CONTENT)
        .first();
      await expect(userMessageContent).toContainText(testMessage, {
        timeout: 5_000,
      });
    },
  );
});
