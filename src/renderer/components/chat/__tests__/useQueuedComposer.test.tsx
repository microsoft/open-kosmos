/** @vitest-environment happy-dom */

import { act, renderHook, waitFor } from '@testing-library/react';
import { MessageHelper, UserMessage } from '@shared/types/chatTypes';

const mockActions = vi.hoisted(() => ({
  queue: vi.fn(),
  submitEdit: vi.fn().mockResolvedValue(undefined),
  clearSession: vi.fn(),
}));

vi.mock('../queued-message.atom', () => ({
  queuedMessageAtom: { useChange: () => mockActions },
}));

import { useQueuedComposer, UseQueuedComposerOptions } from '../useQueuedComposer';

function userMessage(id: string, text: string): UserMessage {
  return MessageHelper.createTextMessage(text, 'user', id);
}

function makeQueued(overrides: Record<string, unknown> = {}) {
  return {
    id: 'q1',
    chatId: 'chat-1',
    chatSessionId: 'session-1',
    message: userMessage('q1', 'draft'),
    createdAt: 1,
    status: 'queued',
    ...overrides,
  } as UseQueuedComposerOptions['queuedMessages'][number];
}

function makeOptions(overrides: Partial<UseQueuedComposerOptions> = {}): UseQueuedComposerOptions {
  return {
    chatSessionId: 'session-1',
    currentChatId: 'chat-1',
    isEditMode: false,
    sessionIdle: true,
    queuedMessages: [],
    onSendMessage: vi.fn(),
    attachmentManager: { clear: vi.fn(), loadFromMessage: vi.fn() },
    textareaManager: { set: vi.fn() },
    textareaRef: { current: { focus: vi.fn() } as unknown as HTMLTextAreaElement },
    ...overrides,
  };
}

describe('useQueuedComposer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockActions.submitEdit.mockResolvedValue(undefined);
  });

  it('sends immediately when idle with an empty queue', async () => {
    const onComposeCleared = vi.fn();
    const options = makeOptions({ onComposeCleared });
    const { result } = renderHook(() => useQueuedComposer(options));
    const message = userMessage('m1', 'hello');

    await act(async () => {
      await result.current.submitComposeMessage(message);
    });

    expect(options.onSendMessage).toHaveBeenCalledWith(message);
    expect(options.textareaManager.set).toHaveBeenCalledWith('');
    expect(options.attachmentManager.clear).toHaveBeenCalled();
    expect(onComposeCleared).toHaveBeenCalledTimes(1);
    expect(result.current.pendingQueueStartMessage).toBeNull();
  });

  it('queues the draft when the session is not idle', async () => {
    const options = makeOptions({ sessionIdle: false });
    const { result } = renderHook(() => useQueuedComposer(options));
    const message = userMessage('m1', 'hello');

    await act(async () => {
      await result.current.submitComposeMessage(message);
    });

    expect(mockActions.queue).toHaveBeenCalledWith('chat-1', 'session-1', message);
    expect(options.onSendMessage).not.toHaveBeenCalled();
  });

  it('does not queue or clear busy submissions when queueing is disabled', async () => {
    const options = makeOptions({ sessionIdle: false, canQueueWhenBusy: false });
    const { result } = renderHook(() => useQueuedComposer(options));

    await act(async () => {
      await result.current.submitComposeMessage(userMessage('m1', 'hello'));
    });

    expect(mockActions.queue).not.toHaveBeenCalled();
    expect(options.onSendMessage).not.toHaveBeenCalled();
    expect(options.textareaManager.set).not.toHaveBeenCalledWith('');
    expect(options.attachmentManager.clear).not.toHaveBeenCalled();
  });

  it('defers to the start-with-queue confirmation when idle with a non-empty queue', async () => {
    const options = makeOptions({ queuedMessages: [makeQueued()] });
    const { result } = renderHook(() => useQueuedComposer(options));
    const message = userMessage('m1', 'hello');

    await act(async () => {
      await result.current.submitComposeMessage(message);
    });

    expect(result.current.pendingQueueStartMessage).toBe(message);
    expect(options.onSendMessage).not.toHaveBeenCalled();
  });

  it('loads a queued draft into the composer when it enters editing', async () => {
    const editing = makeQueued({ id: 'q-edit', status: 'editing', message: userMessage('q-edit', 'to edit') });
    const options = makeOptions({ queuedMessages: [editing] });
    const { result } = renderHook(() => useQueuedComposer(options));

    await waitFor(() => expect(result.current.editingQueuedMessageId).toBe('q-edit'));
    expect(options.attachmentManager.loadFromMessage).toHaveBeenCalledWith(editing.message);
    expect(options.textareaManager.set).toHaveBeenCalledWith('to edit');
  });

  it('updates the queued draft in place when submitting while editing', async () => {
    const editing = makeQueued({ id: 'q-edit', status: 'editing', message: userMessage('q-edit', 'to edit') });
    const options = makeOptions({ queuedMessages: [editing] });
    const { result } = renderHook(() => useQueuedComposer(options));

    await waitFor(() => expect(result.current.editingQueuedMessageId).toBe('q-edit'));
    const updated = userMessage('q-edit', 'edited');

    await act(async () => {
      await result.current.submitComposeMessage(updated);
    });

    expect(mockActions.submitEdit).toHaveBeenCalledWith('session-1', 'q-edit', updated);
    expect(options.onSendMessage).not.toHaveBeenCalled();
  });

  it('does not reload the same editing draft twice', async () => {
    const options = makeOptions({
      queuedMessages: [makeQueued({ id: 'q-edit', status: 'editing', message: userMessage('q-edit', 'x') })],
    });
    const { result, rerender } = renderHook(
      (props: UseQueuedComposerOptions) => useQueuedComposer(props),
      { initialProps: options },
    );

    await waitFor(() => expect(result.current.editingQueuedMessageId).toBe('q-edit'));
    expect(options.attachmentManager.loadFromMessage).toHaveBeenCalledTimes(1);

    rerender({
      ...options,
      queuedMessages: [makeQueued({ id: 'q-edit', status: 'editing', message: userMessage('q-edit', 'x') })],
    });

    expect(options.attachmentManager.loadFromMessage).toHaveBeenCalledTimes(1);
  });

  it('restores compose draft state when the editing draft leaves the queue', async () => {
    const onComposeCleared = vi.fn();
    const textareaManager = { set: vi.fn() };
    const onQueuedEditCleared = vi.fn(() => {
      textareaManager.set('restored draft');
    });
    const options = makeOptions({
      queuedMessages: [makeQueued({ id: 'q-edit', status: 'editing', message: userMessage('q-edit', 'x') })],
      textareaManager,
      onComposeCleared,
      onQueuedEditCleared,
    });
    const { result, rerender } = renderHook(
      (props: UseQueuedComposerOptions) => useQueuedComposer(props),
      { initialProps: options },
    );

    await waitFor(() => expect(result.current.editingQueuedMessageId).toBe('q-edit'));

    rerender({ ...options, queuedMessages: [] });

    await waitFor(() => expect(result.current.editingQueuedMessageId).toBeNull());
    expect(options.textareaManager.set).toHaveBeenLastCalledWith('restored draft');
    expect(options.attachmentManager.clear).toHaveBeenCalled();
    expect(onComposeCleared).not.toHaveBeenCalled();
    expect(onQueuedEditCleared).toHaveBeenCalledTimes(1);
  });

  it('ignores queued editing state in inline edit mode', async () => {
    const options = makeOptions({
      isEditMode: true,
      queuedMessages: [makeQueued({ id: 'q-edit', status: 'editing' })],
    });
    const { result } = renderHook(() => useQueuedComposer(options));

    await Promise.resolve();
    expect(result.current.editingQueuedMessageId).toBeNull();
    expect(options.attachmentManager.loadFromMessage).not.toHaveBeenCalled();
  });

  it('clears composer state when the chat session changes', async () => {
    const options = makeOptions();
    const { rerender } = renderHook(
      (props: UseQueuedComposerOptions) => useQueuedComposer(props),
      { initialProps: options },
    );

    rerender({ ...options, chatSessionId: 'session-2' });

    await waitFor(() => expect(options.textareaManager.set).toHaveBeenCalledWith(''));
    expect(options.attachmentManager.clear).toHaveBeenCalled();
  });

  it('does not clear composer on session change during inline edit', async () => {
    const options = makeOptions({ isEditMode: true });
    const { rerender } = renderHook(
      (props: UseQueuedComposerOptions) => useQueuedComposer(props),
      { initialProps: options },
    );
    vi.clearAllMocks();

    rerender({ ...options, isEditMode: true, chatSessionId: 'session-2' });

    await Promise.resolve();
    expect(options.attachmentManager.clear).not.toHaveBeenCalled();
  });

  it('does nothing when re-rendered with the same chat session', async () => {
    const options = makeOptions();
    const { rerender } = renderHook(
      (props: UseQueuedComposerOptions) => useQueuedComposer(props),
      { initialProps: options },
    );
    vi.clearAllMocks();

    rerender({ ...options });

    await Promise.resolve();
    expect(options.attachmentManager.clear).not.toHaveBeenCalled();
  });

  it('submitPendingQueueStartMessage is a no-op when nothing is pending', () => {
    const options = makeOptions();
    const { result } = renderHook(() => useQueuedComposer(options));

    act(() => {
      result.current.submitPendingQueueStartMessage(true);
    });

    expect(options.onSendMessage).not.toHaveBeenCalled();
    expect(mockActions.clearSession).not.toHaveBeenCalled();
  });

  it('submitPendingQueueStartMessage clears the queue and sends when requested', async () => {
    const options = makeOptions({ queuedMessages: [makeQueued()] });
    const { result } = renderHook(() => useQueuedComposer(options));
    const message = userMessage('m1', 'hello');

    await act(async () => {
      await result.current.submitComposeMessage(message);
    });
    act(() => {
      result.current.submitPendingQueueStartMessage(true);
    });

    expect(mockActions.clearSession).toHaveBeenCalledWith('session-1');
    expect(options.onSendMessage).toHaveBeenCalledWith(message);
    expect(result.current.pendingQueueStartMessage).toBeNull();
  });

  it('submitPendingQueueStartMessage keeps the queue when not requested', async () => {
    const options = makeOptions({ queuedMessages: [makeQueued()] });
    const { result } = renderHook(() => useQueuedComposer(options));

    await act(async () => {
      await result.current.submitComposeMessage(userMessage('m1', 'hello'));
    });
    act(() => {
      result.current.submitPendingQueueStartMessage(false);
    });

    expect(mockActions.clearSession).not.toHaveBeenCalled();
    expect(options.onSendMessage).toHaveBeenCalled();
  });

  it('drops the pending start-message when the chat session changes', async () => {
    const options = makeOptions({ queuedMessages: [makeQueued()] });
    const { result, rerender } = renderHook(
      (props: UseQueuedComposerOptions) => useQueuedComposer(props),
      { initialProps: options },
    );

    await act(async () => {
      await result.current.submitComposeMessage(userMessage('m1', 'hello'));
    });
    expect(result.current.pendingQueueStartMessage).not.toBeNull();

    rerender({ ...options, chatSessionId: 'session-2' });

    await waitFor(() => expect(result.current.pendingQueueStartMessage).toBeNull());
  });

  it('confirming a start-message after switching sessions is a no-op', async () => {
    const options = makeOptions({ queuedMessages: [makeQueued()] });
    const { result, rerender } = renderHook(
      (props: UseQueuedComposerOptions) => useQueuedComposer(props),
      { initialProps: options },
    );

    await act(async () => {
      await result.current.submitComposeMessage(userMessage('m1', 'hello'));
    });
    rerender({ ...options, chatSessionId: 'session-2' });
    await waitFor(() => expect(result.current.pendingQueueStartMessage).toBeNull());

    act(() => {
      result.current.submitPendingQueueStartMessage(true);
    });

    expect(mockActions.clearSession).not.toHaveBeenCalled();
    expect(options.onSendMessage).not.toHaveBeenCalled();
  });

  it('cancelPendingQueueStart clears the pending message', async () => {
    const options = makeOptions({ queuedMessages: [makeQueued()] });
    const { result } = renderHook(() => useQueuedComposer(options));

    await act(async () => {
      await result.current.submitComposeMessage(userMessage('m1', 'hello'));
    });
    expect(result.current.pendingQueueStartMessage).not.toBeNull();

    act(() => {
      result.current.cancelPendingQueueStart();
    });

    expect(result.current.pendingQueueStartMessage).toBeNull();
  });

  it('tolerates a missing textarea ref when focusing the composer', async () => {
    const options = makeOptions({ textareaRef: { current: null } });
    const { result } = renderHook(() => useQueuedComposer(options));

    await act(async () => {
      await result.current.submitComposeMessage(userMessage('m1', 'hello'));
    });

    expect(options.onSendMessage).toHaveBeenCalled();
  });
});
