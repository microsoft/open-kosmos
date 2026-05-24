/**
 * Phase 3 — Chat E2E Tests
 *
 * Uses the mockedChatReadyApp fixture (pre-configured auth + chat-ready environment)
 * to test basic Agent chat functionality.
 *
 * All API requests are mocked — no real network calls are made.
 * Chat responses are simulated by the agentChat:streamMessage mock handler in mockedApp.ts.
 *
 * Test scenarios:
 * 1. Chat UI element validation — textarea, send button, model selector
 * 2. Send message — input text, click send, verify user message display
 * 3. Receive AI response — verify assistant message rendering
 * 4. Keyboard shortcut — Enter sends message
 */
import { mockedChatReadyTest, expect } from './fixtures/mockedApp';
import { Selectors } from './helpers/selectors';

type PendingStreamInfo = {
  assistantMessageId: string;
  mockResponse: string;
  chatId: string;
  chatSessionId: string;
};

const TARGET_SESSION_ID = 'session-history-target';
const TARGET_SESSION_TITLE = 'Archived Session Scroll Target';
const TARGET_SESSION_OLDEST_MARKER = 'OLDEST_TARGET_MARKER';
const TARGET_SESSION_NEWEST_MARKER = 'NEWEST_TARGET_MARKER';

async function ensureKobiSessionListVisible(chatWindow: any): Promise<void> {
  const sessionList = chatWindow.locator(Selectors.CHAT_SESSION_LIST).first();

  if (await sessionList.isVisible().catch(() => false)) {
    return;
  }

  await chatWindow.getByRole('button', { name: 'Kobi' }).first().click();
  await expect(sessionList).toBeVisible({ timeout: 10_000 });
}

async function waitForMessageVisibleInsideChat(
  chatWindow: any,
  marker: string,
): Promise<void> {
  await chatWindow.waitForFunction(
    ({ expectedMarker }: { expectedMarker: string }) => {
      const container = document.querySelector('.chat-container-reverse');
      if (!(container instanceof HTMLElement)) {
        return false;
      }

      const target = Array.from(document.querySelectorAll('.message-container')).find(
        (element) => element.textContent?.includes(expectedMarker),
      );

      if (!(target instanceof HTMLElement)) {
        return false;
      }

      const containerRect = container.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const intersectsViewport =
        targetRect.bottom > containerRect.top &&
        targetRect.top < containerRect.bottom;

      return intersectsViewport;
    },
    { expectedMarker: marker },
    { timeout: 15_000 },
  );
}

async function isMessageVisibleInsideChat(
  chatWindow: any,
  marker: string,
): Promise<boolean> {
  return chatWindow.evaluate(({ expectedMarker }: { expectedMarker: string }) => {
    const container = document.querySelector('.chat-container-reverse');
    if (!(container instanceof HTMLElement)) {
      return false;
    }

    const target = Array.from(document.querySelectorAll('.message-container')).find(
      (element) => element.textContent?.includes(expectedMarker),
    );

    if (!(target instanceof HTMLElement)) {
      return false;
    }

    const containerRect = container.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();

    return (
      targetRect.bottom > containerRect.top &&
      targetRect.top < containerRect.bottom
    );
  }, { expectedMarker: marker });
}

async function waitForPendingStream(chatApp: any, chatWindow: any): Promise<PendingStreamInfo> {
  let streamInfo: PendingStreamInfo | null = null;
  for (let index = 0; index < 50; index += 1) {
    streamInfo = await chatApp.evaluate(() => {
      return (global as any).__e2e_pendingStreamResponse ?? null;
    });
    if (streamInfo?.assistantMessageId) {
      return streamInfo;
    }
    await chatWindow.waitForTimeout(100);
  }

  throw new Error('streamInfo is null');
}

async function emitAssistantResponse(
  chatApp: any,
  chatWindow: any,
  streamInfo: PendingStreamInfo,
  responseText: string,
): Promise<void> {
  await chatApp.evaluate(({ BrowserWindow }: { BrowserWindow: any }, info: PendingStreamInfo) => {
    const wins = BrowserWindow.getAllWindows();
    if (wins.length === 0) return;
    const wc = wins[0].webContents;

    wc.send('agentChat:chatStatusChanged', {
      chatId: info.chatId,
      chatSessionId: info.chatSessionId,
      chatStatus: 'sending_response',
    });
  }, streamInfo);

  await chatWindow.waitForTimeout(100);

  await chatApp.evaluate(({ BrowserWindow }: { BrowserWindow: any }, payload: { streamInfo: PendingStreamInfo; responseText: string }) => {
    const wins = BrowserWindow.getAllWindows();
    if (wins.length === 0) return;
    const wc = wins[0].webContents;

    wc.send('agentChat:streamingChunk', {
      chunkId: 'chunk_content_' + Date.now(),
      messageId: payload.streamInfo.assistantMessageId,
      chatId: payload.streamInfo.chatId,
      chatSessionId: payload.streamInfo.chatSessionId,
      timestamp: Date.now(),
      type: 'content',
      contentDelta: { text: payload.responseText },
    });
  }, { streamInfo, responseText });

  await chatWindow.waitForTimeout(100);

  await chatApp.evaluate(({ BrowserWindow }: { BrowserWindow: any }, info: PendingStreamInfo) => {
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

  await chatApp.evaluate(({ BrowserWindow }: { BrowserWindow: any }, info: PendingStreamInfo) => {
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

  await chatApp.evaluate(({ BrowserWindow }: { BrowserWindow: any }, info: PendingStreamInfo) => {
    const wins = BrowserWindow.getAllWindows();
    if (wins.length === 0) return;
    const wc = wins[0].webContents;

    wc.send('agentChat:chatStatusChanged', {
      chatId: info.chatId,
      chatSessionId: info.chatSessionId,
      chatStatus: 'idle',
    });
  }, streamInfo);
}

mockedChatReadyTest.describe('Chat functionality tests', () => {
  // Chat tests need extra time on CI: chatApp fixture launches Electron + injects
  // IPC mocks, then chatWindow fixture navigates through /auto-login → /loading → /agent,
  // waits for chat textarea (up to 45 s), and initializes the chat session.
  mockedChatReadyTest.setTimeout(180_000);

  mockedChatReadyTest(
    'navigates to primary agent session on startup without duplicate new-chat',
    async ({ chatApp, chatWindow }) => {
      const textarea = chatWindow.locator(Selectors.CHAT_TEXTAREA);
      await expect(textarea).toBeVisible({ timeout: 30_000 });

      await chatWindow.waitForFunction(() => {
        return /#\/agent\/chat\/[^/]+\/[^/]+$/.test(window.location.hash);
      }, undefined, { timeout: 15_000 });

      const startupState = await chatApp.evaluate(async () => {
        const now = () => Date.now();
        const readState = () => ({
          startNewChatForCallCount:
            (global as any).__e2e_startNewChatForCallCount ?? 0,
          lastStartNewChatForChatId:
            (global as any).__e2e_lastStartNewChatForChatId ?? null,
        });

        const timeoutAt = now() + 10_000;
        let stableSince: number | null = null;

        while (now() < timeoutAt) {
          const state = readState();
          if (state.startNewChatForCallCount === 1) {
            if (stableSince === null) {
              stableSince = now();
            }
            if (now() - stableSince >= 1_000) {
              return state;
            }
          } else {
            stableSince = null;
          }

          await new Promise((resolve) => setTimeout(resolve, 100));
        }

        return readState();
      });

      const currentInstance = await chatWindow.evaluate(async () => {
        return (window as any).electronAPI?.agentChat?.getCurrentInstance?.();
      });

      expect(startupState.startNewChatForCallCount).toBe(1);
      expect(startupState.lastStartNewChatForChatId).toBe(
        currentInstance?.data?.chatId,
      );
      expect(currentInstance?.data?.chatSessionId).toBeTruthy();
      expect(chatWindow.url()).toContain(
        `#/agent/chat/${currentInstance.data.chatId}/${currentInstance.data.chatSessionId}`,
      );
    },
  );

  // ==================== Test 1: Chat UI element validation ====================

  mockedChatReadyTest(
    'chat UI elements are visible — textarea, send button',
    async ({ chatWindow }) => {
      // 1. Verify we are on the /agent route
      const currentUrl = chatWindow.url();
      expect(currentUrl).toContain('#/agent');

      // 2. Verify chat textarea is visible
      const textarea = chatWindow.locator(Selectors.CHAT_TEXTAREA);
      await expect(textarea).toBeVisible({ timeout: 30_000 });

      // 3. Verify send button is visible
      const sendButton = chatWindow.locator(Selectors.CHAT_SEND_BUTTON);
      await expect(sendButton).toBeVisible({ timeout: 5_000 });

      // 4. Verify page has actual content
      const rootElement = chatWindow.locator('#root');
      await expect(rootElement).toBeVisible({ timeout: 5_000 });
    },
  );

  // ==================== Test 2: Send message ====================

  mockedChatReadyTest(
    'send message — type text and click send, verify user message displayed',
    async ({ chatWindow }) => {
      // 1. Wait for textarea to be ready
      const textarea = chatWindow.locator(Selectors.CHAT_TEXTAREA);
      await expect(textarea).toBeVisible({ timeout: 30_000 });

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

      // 5. Verify user message appears in the chat area
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

  // ==================== Test 3: Receive AI response ====================

  mockedChatReadyTest(
    'receive AI response — verify assistant message renders after sending',
    async ({ chatApp, chatWindow }) => {
      // 1. Wait for textarea to be ready
      const textarea = chatWindow.locator(Selectors.CHAT_TEXTAREA);
      await expect(textarea).toBeVisible({ timeout: 30_000 });

      // 2. Send message
      const testMessage = 'Hi Kobi, how are you?';
      await textarea.click();
      await textarea.pressSequentially(testMessage);

      const sendButton = chatWindow.locator(Selectors.CHAT_SEND_BUTTON);
      await sendButton.click();

      // 3. Wait for the mock handler to store pendingStreamResponse, then push streaming events from the fixture side
      //    (setTimeout + webContents.send is unreliable in test environments; push from fixture side instead)
      const streamInfo = await waitForPendingStream(chatApp, chatWindow);
      await emitAssistantResponse(
        chatApp,
        chatWindow,
        streamInfo,
        streamInfo.mockResponse,
      );

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

  // ==================== Test 4: Enter key sends message ====================

  mockedChatReadyTest(
    'keyboard Enter sends message',
    async ({ chatWindow }) => {
      // 1. Wait for textarea to be ready
      const textarea = chatWindow.locator(Selectors.CHAT_TEXTAREA);
      await expect(textarea).toBeVisible({ timeout: 30_000 });

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

  mockedChatReadyTest(
    'assistant text does not overflow horizontally or get clipped on the right in a narrow window',
    async ({ chatApp, chatWindow }) => {
      await chatApp.evaluate(({ BrowserWindow }: { BrowserWindow: any }) => {
        const win = BrowserWindow.getAllWindows()[0];
        if (!win) return;
        win.setBounds({ width: 820, height: 900 });
      });

      await chatWindow.waitForTimeout(250);

      const textarea = chatWindow.locator(Selectors.CHAT_TEXTAREA);
      await expect(textarea).toBeVisible({ timeout: 30_000 });

      const testMessage = 'Trigger a long assistant response in a narrow window';
      await textarea.click();
      await textarea.pressSequentially(testMessage);
      await chatWindow.locator(Selectors.CHAT_SEND_BUTTON).click();

      const streamInfo = await waitForPendingStream(chatApp, chatWindow);
      const longResponse = 'This is a deliberately long assistant response used to verify wrapping inside a narrow Electron window. '.repeat(12);
      await emitAssistantResponse(chatApp, chatWindow, streamInfo, longResponse);

      const assistantContent = chatWindow
        .locator(Selectors.CHAT_ASSISTANT_MESSAGE)
        .first()
        .locator(Selectors.CHAT_MESSAGE_CONTENT)
        .first();

      await expect(assistantContent).toContainText('deliberately long assistant response', {
        timeout: 10_000,
      });

      const layout = await assistantContent.evaluate((element) => {
        const htmlElement = element as HTMLElement;
        return {
          clientWidth: htmlElement.clientWidth,
          scrollWidth: htmlElement.scrollWidth,
          overflowX: window.getComputedStyle(htmlElement).overflowX,
        };
      });

      expect(layout.overflowX).toBe('hidden');
      expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth + 1);
    },
  );

  mockedChatReadyTest(
    'long inline code wraps instead of being clipped on the right in a narrow window',
    async ({ chatApp, chatWindow }) => {
      await chatApp.evaluate(({ BrowserWindow }: { BrowserWindow: any }) => {
        const win = BrowserWindow.getAllWindows()[0];
        if (!win) return;
        win.setBounds({ width: 820, height: 900 });
      });

      await chatWindow.waitForTimeout(250);

      const textarea = chatWindow.locator(Selectors.CHAT_TEXTAREA);
      await expect(textarea).toBeVisible({ timeout: 30_000 });

      await textarea.click();
      await textarea.pressSequentially('Trigger a long inline code markdown response');
      await chatWindow.locator(Selectors.CHAT_SEND_BUTTON).click();

      const streamInfo = await waitForPendingStream(chatApp, chatWindow);
      const inlineCodeResponse = [
        'Got it.',
        '',
        '- `Install Skills through the Claude web interface for non technical users and quick setup`',
        '- `Install Skills via the filesystem for development workflows and team sharing`',
        '- `Install via plugins marketplace when a long highlighted example needs to stay visible in narrow chat layouts`',
      ].join('\n');

      await emitAssistantResponse(chatApp, chatWindow, streamInfo, inlineCodeResponse);

      const firstInlineCode = chatWindow
        .locator(Selectors.CHAT_ASSISTANT_MESSAGE)
        .first()
        .locator('code.inline-code')
        .first();

      await expect(firstInlineCode).toContainText('Install Skills through the Claude web interface', {
        timeout: 10_000,
      });

      const layout = await firstInlineCode.evaluate((element) => {
        const htmlElement = element as HTMLElement;
        const style = window.getComputedStyle(htmlElement);
        return {
          clientWidth: htmlElement.clientWidth,
          scrollWidth: htmlElement.scrollWidth,
          whiteSpace: style.whiteSpace,
          overflowWrap: style.overflowWrap,
        };
      });

      expect(layout.whiteSpace).toBe('break-spaces');
      expect(layout.overflowWrap).toBe('anywhere');
      expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth + 1);
    },
  );

  mockedChatReadyTest(
    'scrolls stably to the latest message after switching to a historical session',
    async ({ chatWindow }) => {
      await ensureKobiSessionListVisible(chatWindow);

      const targetSession = chatWindow
        .locator(Selectors.CHAT_SESSION_ITEM)
        .filter({ hasText: TARGET_SESSION_TITLE })
        .first();

      await expect(targetSession).toBeVisible({ timeout: 15_000 });
      await targetSession.click();

      await expect(chatWindow).toHaveURL(
        new RegExp(`#/agent/chat/mock-chat-kobi/${TARGET_SESSION_ID}$`),
        { timeout: 15_000 },
      );

      await expect(
        chatWindow
          .locator(Selectors.CHAT_ASSISTANT_MESSAGE)
          .filter({ hasText: TARGET_SESSION_NEWEST_MARKER })
          .first(),
      ).toBeVisible({ timeout: 15_000 });

      await waitForMessageVisibleInsideChat(
        chatWindow,
        TARGET_SESSION_NEWEST_MARKER,
      );

      expect(
        await isMessageVisibleInsideChat(
          chatWindow,
          TARGET_SESSION_OLDEST_MARKER,
        ),
      ).toBe(false);
    },
  );

});
