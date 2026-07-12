/** @vitest-environment happy-dom */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import QueuedMessageList from '../QueuedMessageList';
import { MessageHelper } from '@shared/types/chatTypes';

const mockActions = vi.hoisted(() => ({
  steerNow: vi.fn(),
  cancel: vi.fn(),
  startEdit: vi.fn(),
}));

vi.mock('../queued-message.atom', async () => ({
  queuedMessageAtom: {
    useChange: () => mockActions,
  },
}));

function makeQueued(overrides: any = {}) {
  return {
    id: 'queued-1',
    chatId: 'chat-1',
    chatSessionId: 'session-1',
    message: MessageHelper.createTextMessage('Change it', 'user'),
    createdAt: 1,
    status: 'queued',
    ...overrides,
  };
}

describe('QueuedMessageList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing without queued items', () => {
    const { container } = render(<QueuedMessageList chatSessionId="session-1" items={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders queued items with steer, delete, and edit actions', () => {
    render(<QueuedMessageList chatSessionId="session-1" items={[makeQueued()]} />);
    expect(screen.getByText('Change it')).toBeInTheDocument();
    expect(screen.getByTitle('Move to front and send next')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Steer/ }));
    expect(mockActions.steerNow).toHaveBeenCalledWith('session-1', 'queued-1');

    fireEvent.click(screen.getByRole('button', { name: 'Cancel queued message' }));
    expect(mockActions.cancel).toHaveBeenCalledWith('session-1', 'queued-1');

    fireEvent.click(screen.getByRole('button', { name: 'Edit queued message' }));
    expect(mockActions.startEdit).toHaveBeenCalledWith('session-1', 'queued-1');
  });

  it('shows pending steer state while a queued item is editing', () => {
    render(<QueuedMessageList chatSessionId="session-1" items={[makeQueued({ status: 'editing', pendingSteer: true })]} />);
    expect(screen.getByText('Editing, then steering')).toBeInTheDocument();
    expect(screen.getByTitle('Move to front after editing is submitted')).toBeInTheDocument();
  });

  it('does not render a steering status for queued items', () => {
    render(<QueuedMessageList chatSessionId="session-1" items={[makeQueued()]} />);
    expect(screen.queryByText('Steering...')).not.toBeInTheDocument();
  });

  it('renders nothing when chatSessionId is null', () => {
    const { container } = render(<QueuedMessageList chatSessionId={null} items={[makeQueued()]} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows a plain editing status when not pending steer', () => {
    render(<QueuedMessageList chatSessionId="session-1" items={[makeQueued({ status: 'editing' })]} />);
    expect(screen.getByText('Editing')).toBeInTheDocument();
    expect(screen.queryByText('Editing, then steering')).not.toBeInTheDocument();
  });

  it('falls back to a placeholder label for empty messages', () => {
    render(
      <QueuedMessageList
        chatSessionId="session-1"
        items={[makeQueued({ message: MessageHelper.createTextMessage('   ', 'user') })]}
      />,
    );
    expect(screen.getByText('Queued message')).toBeInTheDocument();
  });
});
