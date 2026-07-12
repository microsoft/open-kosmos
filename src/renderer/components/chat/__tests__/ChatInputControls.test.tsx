/**
 * @vitest-environment happy-dom
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('../chat-input/Attachments', () => ({
  AttachmentList: () => <div data-testid="attachments" />,
  AttachmentsStatus: () => <div data-testid="attachment-status" />,
}));
vi.mock('../chat-input/Textarea', () => ({
  TextArea: ({ handleSend, onDraftChange }: any) => (
    <textarea
      aria-label="composer"
      onChange={(event) => onDraftChange(event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          void handleSend();
        }
      }}
    />
  ),
}));
vi.mock('../chat-input/ModelSelector', () => ({
  ModelSelector: () => <div data-testid="model-selector" />,
}));
vi.mock('../chat-input/ReasoningEffortSelector', () => ({
  ReasoningEffortSelector: () => <div data-testid="reasoning-selector" />,
}));
vi.mock('../VoiceInputButton', () => ({
  VoiceInputButton: ({ onTranscript, disabled }: any) => (
    <button type="button" disabled={disabled} onClick={() => onTranscript('voice', true)}>Voice</button>
  ),
}));
vi.mock('../chat-input/Icons', () => ({
  attachment_icon_1: <span>attach</span>,
  attachment_icon_2: <span>edit</span>,
  cancel_icon: <span>cancel-icon</span>,
  send_icon: <span>send-icon</span>,
  send_icon_disabled: <span>disabled-icon</span>,
  send_icon_spin: <span>spin-icon</span>,
}));

import { ChatInputControls } from '../chat-input/ChatInputControls';

function renderControls(overrides: Partial<React.ComponentProps<typeof ChatInputControls>> = {}) {
  const props: React.ComponentProps<typeof ChatInputControls> = {
    attachmentsStateAtom: {} as any,
    textareaStateAtom: {} as any,
    fileInputRef: React.createRef<HTMLInputElement>(),
    textareaRef: React.createRef<HTMLTextAreaElement>(),
    handleImageSelect: vi.fn().mockResolvedValue(undefined),
    handleSend: vi.fn().mockResolvedValue(undefined),
    handleElectronFileSelect: vi.fn().mockResolvedValue(undefined),
    handleUnifiedFileInputChange: vi.fn().mockResolvedValue(undefined),
    onCancelChat: vi.fn().mockResolvedValue(undefined),
    onCancelEdit: vi.fn(),
    onDraftChange: vi.fn(),
    onVoiceTranscript: vi.fn(),
    attachMenuActions: { toggle: vi.fn() },
    editAgentMenuActions: { toggle: vi.fn() },
    enableContextMenu: true,
    chatInputShortcutHint: 'Enter to send',
    currentChatId: 'chat-1',
    effectiveSupportsImages: true,
    shouldLockComposeUi: false,
    isExternalAgent: false,
    isEditMode: false,
    isProcessing: false,
    isSubmittingEdit: false,
    isAwaitingEditConfirmation: false,
    enableVoiceInput: false,
    voiceInputUserEnabled: false,
    sessionIdle: true,
    editingQueuedMessageId: null,
    hasValidInput: true,
    setSupportsImages: vi.fn(),
    updatePromptHistoryDraft: true,
    ...overrides,
  };
  const result = render(<ChatInputControls {...props} />);
  return { ...result, props };
}

describe('ChatInputControls', () => {
  it('routes attach clicks through file picker in edit mode and menu toggle in compose mode', () => {
    const edit = renderControls({ isEditMode: true });
    fireEvent.click(screen.getByTitle('Attach'));
    expect(edit.props.handleElectronFileSelect).toHaveBeenCalled();
    edit.unmount();

    const compose = renderControls();
    fireEvent.click(screen.getByTitle('Attach'));
    expect(compose.props.attachMenuActions.toggle).toHaveBeenCalled();
  });

  it('does not open the edit-agent menu while compose UI is locked', () => {
    const unlocked = renderControls();
    fireEvent.click(screen.getByTitle('Edit Agent (MCP Tools & System Prompt)'));
    expect(unlocked.props.editAgentMenuActions.toggle).toHaveBeenCalled();
    unlocked.unmount();

    const { props } = renderControls({ shouldLockComposeUi: true });
    fireEvent.click(screen.getByTitle('Edit Agent (MCP Tools & System Prompt)'));
    expect(props.editAgentMenuActions.toggle).not.toHaveBeenCalled();
  });

  it('renders inline edit send states for sending and awaiting confirmation', () => {
    const sending = renderControls({ isEditMode: true, isSubmittingEdit: true });
    expect(screen.getByRole('button', { name: 'Send' })).toHaveTextContent('Sending...');
    sending.unmount();

    const ready = renderControls({ isEditMode: true });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(ready.props.handleSend).toHaveBeenCalled();
    ready.unmount();

    renderControls({ isEditMode: true, isAwaitingEditConfirmation: true });
    expect(screen.getByRole('button', { name: 'Send' })).toHaveTextContent('Waiting...');
  });

  it('renders queued update and non-idle queue/cancel variants', () => {
    const queued = renderControls({ editingQueuedMessageId: 'q1', isProcessing: true });
    expect(screen.getByRole('button', { name: 'Update queued message' })).toHaveTextContent('spin-icon');
    queued.unmount();

    const queuedClickable = renderControls({ editingQueuedMessageId: 'q1' });
    fireEvent.click(screen.getByRole('button', { name: 'Update queued message' }));
    expect(queuedClickable.props.handleSend).toHaveBeenCalled();
    queuedClickable.unmount();

    const queuedLocked = renderControls({ editingQueuedMessageId: 'q1', shouldLockComposeUi: true });
    expect(screen.getByRole('button', { name: 'Update queued message' })).toBeDisabled();
    queuedLocked.unmount();

    const busyQueue = renderControls({ sessionIdle: false, hasValidInput: true });
    expect(screen.getByRole('button', { name: 'Queue message after current response' })).toBeInTheDocument();
    busyQueue.unmount();

    const busyQueuedUpdate = renderControls({ sessionIdle: false, editingQueuedMessageId: 'q1', isProcessing: true });
    expect(screen.getByRole('button', { name: 'Update queued message' })).toHaveTextContent('spin-icon');
    busyQueuedUpdate.unmount();

    const busyQueuedUpdateClickable = renderControls({ sessionIdle: false, editingQueuedMessageId: 'q1' });
    fireEvent.click(screen.getByRole('button', { name: 'Update queued message' }));
    expect(busyQueuedUpdateClickable.props.handleSend).toHaveBeenCalled();
    busyQueuedUpdateClickable.unmount();

    const busyCancel = renderControls({ sessionIdle: false, hasValidInput: false, isExternalAgent: true, shouldLockComposeUi: true });
    expect(screen.getByRole('button', { name: 'Cancel current response' })).toBeDisabled();
    busyCancel.unmount();

    const busyCancelClickable = renderControls({ sessionIdle: false, hasValidInput: false, isExternalAgent: true });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel current response' }));
    expect(busyCancelClickable.props.onCancelChat).toHaveBeenCalled();
    busyCancelClickable.unmount();

    const busyEditSubmitting = renderControls({ sessionIdle: false, isEditMode: true, isSubmittingEdit: true });
    expect(screen.getByRole('button', { name: 'Send' })).toHaveTextContent('Sending...');
    busyEditSubmitting.unmount();

    renderControls({ sessionIdle: false, isEditMode: true, isAwaitingEditConfirmation: true });
    expect(screen.getByRole('button', { name: 'Send' })).toHaveTextContent('Waiting...');
  });

  it('sends the normal idle compose message', () => {
    const normal = renderControls();
    fireEvent.click(screen.getByTitle('Enter to send'));
    expect(normal.props.handleSend).toHaveBeenCalled();
  });

  it('wires hidden file input changes, voice transcripts, and development stats', () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    const { container, props } = renderControls({ enableVoiceInput: true, voiceInputUserEnabled: true });

    fireEvent.change(screen.getByLabelText('composer'), { target: { value: 'draft' } });
    expect(props.onDraftChange).toHaveBeenCalledWith('draft');

    fireEvent.click(screen.getByText('Voice'));
    expect(props.onVoiceTranscript).toHaveBeenCalledWith('voice', true);

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [] } });
    expect(props.handleUnifiedFileInputChange).toHaveBeenCalled();
    expect(screen.getByTestId('attachment-status')).toBeInTheDocument();
    process.env.NODE_ENV = originalEnv;
  });
});
