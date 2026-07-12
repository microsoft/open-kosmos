/**
 * @vitest-environment happy-dom
 */
import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';

// ── hoisted mock vars ──────────────────────────────────────────────────────────
const mockChats = vi.hoisted(() => [] as any[]);
const mockUpdateChatAgent = vi.hoisted(() => vi.fn());
const mockUpdateChatConfig = vi.hoisted(() => vi.fn());
const mockShowSuccess = vi.hoisted(() => vi.fn());
const mockShowError = vi.hoisted(() => vi.fn());

// ── module mocks ───────────────────────────────────────────────────────────────
vi.mock('../../ui/dialog', () => ({
  Dialog: ({ open, onOpenChange, children }: any) =>
    open ? (
      <div data-testid="dialog">
        <button data-testid="dialog-dismiss" onClick={() => onOpenChange(false)}>
          dismiss
        </button>
        {children}
      </div>
    ) : null,
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h2>{children}</h2>,
  DialogDescription: ({ children }: any) => <p>{children}</p>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('../../userData/userDataProvider', () => ({
  useProfileData: () => ({
    chats: mockChats,
    chatOps: {
      updateChatAgent: mockUpdateChatAgent,
      updateChatConfig: mockUpdateChatConfig,
    },
  }),
}));

vi.mock('../../ui/ToastProvider', () => ({
  useToast: () => ({ showSuccess: mockShowSuccess, showError: mockShowError }),
}));

import ApplyHookToAgentsDialog from '../ApplyHookToAgentsDialog';

function singleChat(
  chatId: string,
  agentName: string,
  opts: { hooks?: string[]; avatar?: string; emoji?: string; source?: string } = {},
) {
  return {
    chat_id: chatId,
    chat_type: 'single_agent',
    agent: { name: agentName, emoji: opts.emoji ?? '🤖', avatar: opts.avatar, hooks: opts.hooks, source: opts.source },
  };
}

function renderDialog(onClose = vi.fn()) {
  render(<ApplyHookToAgentsDialog hookId="h1" hookName="My Hook" onClose={onClose} />);
  return onClose;
}

function applyButton() {
  return screen.getByRole('button', { name: /Apply/ });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockChats.length = 0;
  mockUpdateChatAgent.mockResolvedValue({ success: true });
  mockUpdateChatConfig.mockResolvedValue({ success: true });
});

describe('ApplyHookToAgentsDialog', () => {
  it('shows "No agents found" and hides Select All when there are no agents', () => {
    renderDialog();
    expect(screen.getByText('No agents found.')).toBeTruthy();
    expect(screen.queryByText('Select All')).toBeNull();
  });

  it('renders agents, pre-checks already-applied ones, and ignores filtered chats', () => {
    mockChats.push(
      singleChat('c1', 'Applied Agent', { hooks: ['h1'], avatar: 'avatar.png' }),
      singleChat('c2', 'Free Agent'),
      { chat_id: 'c3', chat_type: 'single_agent' }, // no agent -> filtered
      { chat_id: 'c4', chat_type: 'multi_agent' }, // no agents -> filtered
      { chat_id: 'c5', chat_type: 'group' }, // unknown type -> filtered
    );
    renderDialog();

    // Already-applied agent: rendered, marked Applied, avatar image present.
    expect(screen.getByText('Applied Agent')).toBeTruthy();
    expect(screen.getByText('Applied')).toBeTruthy();
    expect(screen.getByRole('img')).toBeTruthy();

    // Free agent rendered with emoji (no avatar).
    expect(screen.getByText('Free Agent')).toBeTruthy();
    expect(screen.getByText('🤖')).toBeTruthy();

    // Filtered chats do not produce rows.
    expect(screen.queryByText('group')).toBeNull();
  });

  it('excludes external agents because they do not run the local Hook runtime', () => {
    mockChats.push(
      singleChat('c1', 'External Single', { source: 'EXTERNAL' }),
      singleChat('c2', 'Local Single', { source: 'ON-DEVICE' }),
      {
        chat_id: 'm1',
        chat_type: 'multi_agent',
        agents: [
          { name: 'External Member', emoji: '🌐', source: 'EXTERNAL' },
          { name: 'Local Member', emoji: '🧩', source: 'ON-DEVICE' },
        ],
      },
    );

    renderDialog();

    expect(screen.queryByText('External Single')).toBeNull();
    expect(screen.queryByText('External Member')).toBeNull();
    expect(screen.getByText('Local Single')).toBeTruthy();
    expect(screen.getByText('Local Member')).toBeTruthy();
  });

  it('does nothing when clicking an already-applied agent row', () => {
    mockChats.push(singleChat('c1', 'Applied Agent', { hooks: ['h1'] }));
    renderDialog();
    // No selectable agents -> Apply is disabled.
    expect((applyButton() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByText('Applied Agent'));
    expect((applyButton() as HTMLButtonElement).disabled).toBe(true);
  });

  it('toggles a single agent on and off', () => {
    mockChats.push(singleChat('c2', 'Free Agent'));
    renderDialog();
    expect(applyButton().textContent).toBe('Apply');
    fireEvent.click(screen.getByText('Free Agent'));
    expect(applyButton().textContent).toBe('Apply (1)');
    fireEvent.click(screen.getByText('Free Agent'));
    expect(applyButton().textContent).toBe('Apply');
    expect((applyButton() as HTMLButtonElement).disabled).toBe(true);
  });

  it('applies the hook to one selected agent and reports success (singular)', async () => {
    mockChats.push(singleChat('c2', 'Free Agent', { hooks: ['existing'] }));
    const onClose = renderDialog();
    fireEvent.click(screen.getByText('Free Agent'));
    fireEvent.click(applyButton());
    await waitFor(() => expect(mockUpdateChatAgent).toHaveBeenCalledWith('c2', { hooks: ['existing', 'h1'] }));
    expect(mockShowSuccess).toHaveBeenCalledWith('Hook "My Hook" applied to 1 agent');
    expect(mockShowError).not.toHaveBeenCalled();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('select-all applies to multiple agents (plural) and can deselect all', async () => {
    mockChats.push(singleChat('c2', 'Agent Two'), singleChat('c3', 'Agent Three'));
    const onClose = renderDialog();

    fireEvent.click(screen.getByText('Select All'));
    expect(applyButton().textContent).toBe('Apply (2)');
    expect(screen.getByText('Deselect All')).toBeTruthy();

    // Deselect all then re-select all to exercise both branches.
    fireEvent.click(screen.getByText('Deselect All'));
    expect((applyButton() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByText('Select All'));

    fireEvent.click(applyButton());
    await waitFor(() => expect(mockUpdateChatAgent).toHaveBeenCalledTimes(2));
    expect(mockShowSuccess).toHaveBeenCalledWith('Hook "My Hook" applied to 2 agents');
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('reports failures when applying to multiple agents fails (plural)', async () => {
    mockChats.push(singleChat('c2', 'Agent Two'), singleChat('c3', 'Agent Three'));
    mockUpdateChatAgent.mockResolvedValue({ success: false });
    const onClose = renderDialog();
    fireEvent.click(screen.getByText('Select All'));
    fireEvent.click(applyButton());
    await waitFor(() => expect(mockShowError).toHaveBeenCalledWith('Failed to apply hook to 2 agents'));
    expect(mockShowSuccess).not.toHaveBeenCalled();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('reports a single failure (singular)', async () => {
    mockChats.push(singleChat('c2', 'Agent Two'));
    mockUpdateChatAgent.mockResolvedValue({ success: false });
    renderDialog();
    fireEvent.click(screen.getByText('Agent Two'));
    fireEvent.click(applyButton());
    await waitFor(() => expect(mockShowError).toHaveBeenCalledWith('Failed to apply hook to 1 agent'));
  });

  it('reports a failure when a selected single agent disappears before apply', async () => {
    const chat = singleChat('c2', 'Agent Two');
    mockChats.push(chat);
    renderDialog();
    fireEvent.click(screen.getByText('Agent Two'));
    (chat as any).agent = undefined;
    fireEvent.click(applyButton());
    await waitFor(() => expect(mockShowError).toHaveBeenCalledWith('Failed to apply hook to 1 agent'));
    expect(mockUpdateChatAgent).not.toHaveBeenCalled();
  });

  it('applies to a multi-agent chat and pre-checks an already-applied member', async () => {
    mockChats.push({
      chat_id: 'm1',
      chat_type: 'multi_agent',
      agents: [
        { name: 'Bound Member', emoji: '🧩', hooks: ['h1'] },
        { name: 'Other Member', emoji: '🧪', hooks: ['other'] },
        { name: 'Open Member', emoji: '🔧' },
      ],
    });
    renderDialog();
    expect(screen.getByText('Applied')).toBeTruthy();
    fireEvent.click(screen.getByText('Open Member'));
    fireEvent.click(applyButton());
    await waitFor(() => expect(mockUpdateChatConfig).toHaveBeenCalledWith('m1', {
      agents: [
        { name: 'Bound Member', emoji: '🧩', hooks: ['h1'] },
        { name: 'Other Member', emoji: '🧪', hooks: ['other'] },
        { name: 'Open Member', emoji: '🔧', hooks: ['h1'] },
      ],
    }));
    expect(mockUpdateChatAgent).not.toHaveBeenCalled();
  });

  it('applies to multiple selected members in one multi-agent chat with a single merged update', async () => {
    mockChats.push({
      chat_id: 'm1',
      chat_type: 'multi_agent',
      agents: [
        { name: 'First Member', emoji: '1️⃣', hooks: ['existing'] },
        { name: 'Second Member', emoji: '2️⃣' },
        { name: 'Third Member', emoji: '3️⃣', hooks: ['h1'] },
      ],
    });
    renderDialog();
    fireEvent.click(screen.getByText('First Member'));
    fireEvent.click(screen.getByText('Second Member'));
    fireEvent.click(applyButton());
    await waitFor(() => expect(mockUpdateChatConfig).toHaveBeenCalledTimes(1));
    expect(mockUpdateChatConfig).toHaveBeenCalledWith('m1', {
      agents: [
        { name: 'First Member', emoji: '1️⃣', hooks: ['existing', 'h1'] },
        { name: 'Second Member', emoji: '2️⃣', hooks: ['h1'] },
        { name: 'Third Member', emoji: '3️⃣', hooks: ['h1'] },
      ],
    });
    expect(mockShowSuccess).toHaveBeenCalledWith('Hook "My Hook" applied to 2 agents');
  });

  it('reports a failure when a selected multi-agent member disappears before apply', async () => {
    const chat = {
      chat_id: 'm1',
      chat_type: 'multi_agent',
      agents: [
        { name: 'Open Member', emoji: '🔧' },
      ],
    };
    mockChats.push(chat);
    renderDialog();
    fireEvent.click(screen.getByText('Open Member'));
    chat.agents = undefined as any;
    fireEvent.click(applyButton());
    await waitFor(() => expect(mockShowError).toHaveBeenCalledWith('Failed to apply hook to 1 agent'));
    expect(mockUpdateChatConfig).not.toHaveBeenCalled();
  });

  it('shows the applying state while the update is in flight', async () => {
    mockChats.push(singleChat('c2', 'Free Agent'));
    let resolveUpdate: (v: { success: boolean }) => void = () => {};
    mockUpdateChatAgent.mockImplementation(
      () => new Promise(resolve => {
        resolveUpdate = resolve;
      }),
    );
    renderDialog();
    fireEvent.click(screen.getByText('Free Agent'));
    fireEvent.click(applyButton());
    expect(applyButton().textContent).toBe('Applying...');
    await act(async () => {
      resolveUpdate({ success: true });
    });
    await waitFor(() => expect(mockShowSuccess).toHaveBeenCalled());
  });

  it('closes via the Skip button without applying', () => {
    mockChats.push(singleChat('c2', 'Free Agent'));
    const onClose = renderDialog();
    fireEvent.click(screen.getByText('Skip'));
    expect(onClose).toHaveBeenCalled();
    expect(mockUpdateChatAgent).not.toHaveBeenCalled();
  });

  it('closes when the dialog requests to close', () => {
    const onClose = renderDialog();
    fireEvent.click(screen.getByTestId('dialog-dismiss'));
    expect(onClose).toHaveBeenCalled();
  });
});
