// @vitest-environment happy-dom
/**
 * Tests for overlay components:
 * - DeleteOverlay
 * - DuplicateAgentOverlay
 * - RenameChatSessionOverlay
 * - ModifyMsgConfimOverlay (Overlay)
 *
 * Strategy: mock atom `.use()` hooks, router hooks, and ToastProvider
 * so we can control rendered state without running real IPC or navigation.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Shared mocks
// ---------------------------------------------------------------------------

// react-router-dom
const mockNavigate = vi.fn();
const mockLocation = { pathname: '/agent/chat/agent-1' };
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => mockLocation,
}));

// ToastProvider
const mockToast = {
  showSuccess: vi.fn(),
  showError: vi.fn(),
  showWarning: vi.fn(),
  showInfo: vi.fn(),
};
vi.mock('@renderer/components/ui/ToastProvider', () => ({
  useToast: () => mockToast,
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// userData provider
vi.mock('@renderer/components/userData/userDataProvider', () => ({
  useProfileData: () => ({
    data: { profile: { alias: 'test-user' }, chats: [] },
    chats: [],
  }),
  useAgentConfig: () => ({ currentModel: 'gpt-4o' }),
  useMCPServers: () => ({ servers: [] }),
}));
vi.mock('../userData/userDataProvider', () => ({
  useProfileData: () => ({
    data: { profile: { alias: 'test-user' }, chats: [] },
    chats: [],
  }),
}));

// profileDataManager
vi.mock('@renderer/lib/userData/profileDataManager', () => ({
  profileDataManager: {
    getCache: vi.fn(() => ({ profile: { alias: 'test-user', primaryAgent: 'Kobi' }, chats: [] })),
    refresh: vi.fn(() => Promise.resolve()),
    subscribe: vi.fn(() => vi.fn()),
    getChatConfigs: vi.fn(() => []),
    getSkills: vi.fn(() => []),
  },
}));

// chatOps
vi.mock('@renderer/lib/chat/chatOps', () => ({
  chatOps: {
    deleteChatConfig: vi.fn(() => Promise.resolve({ success: true })),
    duplicateChatConfig: vi.fn(() => Promise.resolve({ success: true })),
  },
}));

// chatSessionOps
vi.mock('@renderer/lib/chat/chatSessionOps', () => ({
  deleteChatSession: vi.fn(() => Promise.resolve({ success: true })),
}));

// startNewChatFor
vi.mock('@renderer/lib/chat/startNewChatFor', () => ({
  startNewChatFor: vi.fn(() =>
    Promise.resolve({ success: true, chatSessionId: 'new-session-id' }),
  ),
}));

// pmAgentSayHi
vi.mock('@renderer/lib/chat/pmAgentSayHi', () => ({
  getPmAgentSayHiMessageConfig: vi.fn(() => ({})),
}));

// agentChatSessionCacheManager
vi.mock('@renderer/lib/chat/agentChatSessionCacheManager', () => ({
  agentChatSessionCacheManager: {
    getCurrentChatId: vi.fn(() => 'agent-1'),
    getCurrentChatSessionId: vi.fn(() => 'session-1'),
    subscribeToCurrentChatSessionId: vi.fn(() => vi.fn()),
  },
}));

// mcpClientCacheManager
vi.mock('@renderer/lib/mcp/mcpClientCacheManager', () => ({
  mcpClientCacheManager: {
    getAgentSpecificTools: vi.fn(() => []),
  },
}));

// logger
vi.mock('@renderer/lib/utilities/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}));

// atom – return real implementation but wrap components with WithStore
import { WithStore } from '@/atom';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function wrap(ui: React.ReactElement) {
  return render(<WithStore>{ui}</WithStore>);
}

// ---------------------------------------------------------------------------
// DeleteOverlay
// ---------------------------------------------------------------------------
import { DeleteOverlay, DeleteConfirmAtom } from '../DeleteOverlay';

describe('DeleteOverlay', () => {
  beforeEach(() => {
    // Reset atom state
    DeleteConfirmAtom.useChange; // access getter - reset via actions
    vi.clearAllMocks();
  });

  it('renders nothing when closed', () => {
    // atom starts with isOpen=false
    wrap(<DeleteOverlay />);
    expect(screen.queryByText('Delete Agent')).not.toBeInTheDocument();
  });

  it('renders agent deletion dialog when opened via showAgent', async () => {
    wrap(
      <WithStore>
        <TestController type="agent" />
        <DeleteOverlay />
      </WithStore>,
    );
    // Trigger showAgent via button
    await act(async () => {
      fireEvent.click(screen.getByTestId('open-btn'));
    });
    expect(screen.getByRole('heading', { name: 'Delete Agent' })).toBeInTheDocument();
    expect(screen.getByText(/my-agent/)).toBeInTheDocument();
  });

  it('closes when Cancel is clicked', async () => {
    wrap(
      <WithStore>
        <TestController type="agent" />
        <DeleteOverlay />
      </WithStore>,
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId('open-btn'));
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Cancel'));
    });
    expect(screen.queryByRole('heading', { name: 'Delete Agent' })).not.toBeInTheDocument();
  });

  it('renders chat-session deletion dialog with current-session warning', async () => {
    wrap(
      <WithStore>
        <TestController type="chat-session" isCurrentSession />
        <DeleteOverlay />
      </WithStore>,
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId('open-btn'));
    });
    expect(screen.getByRole('heading', { name: 'Delete Chat Session' })).toBeInTheDocument();
    expect(
      screen.getByText(/currently selected session/),
    ).toBeInTheDocument();
  });

  it('renders standard warning text for non-current-session', async () => {
    wrap(
      <WithStore>
        <TestController type="chat-session" isCurrentSession={false} />
        <DeleteOverlay />
      </WithStore>,
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId('open-btn'));
    });
    expect(screen.getByText(/cannot be undone/)).toBeInTheDocument();
    expect(screen.queryByText(/currently selected/)).not.toBeInTheDocument();
  });
});

/** Helper component that opens the overlay */
function TestController({
  type,
  isCurrentSession = false,
}: {
  type: 'agent' | 'chat-session';
  isCurrentSession?: boolean;
}) {
  const [, actions] = DeleteConfirmAtom.use();
  return (
    <button
      data-testid="open-btn"
      onClick={() => {
        if (type === 'agent') {
          actions.showAgent('agent-id-1', 'my-agent');
        } else {
          actions.showChatSession('session-id-1', 'my-session', isCurrentSession);
        }
      }}
    >
      Open
    </button>
  );
}

// ---------------------------------------------------------------------------
// DuplicateAgentOverlay
// ---------------------------------------------------------------------------
import { DuplicateAgentOverlay, DuplicateAgentAtom } from '../DuplicateAgentOverlay';

function DuplicateTestController() {
  const [, actions] = DuplicateAgentAtom.use();
  return (
    <button
      data-testid="open-dup-btn"
      onClick={() => actions.show('chat-1', 'My Agent')}
    >
      Open
    </button>
  );
}

describe('DuplicateAgentOverlay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when closed', () => {
    wrap(<DuplicateAgentOverlay />);
    expect(screen.queryByText('Duplicate Agent')).not.toBeInTheDocument();
  });

  it('opens and shows agent name', async () => {
    wrap(
      <WithStore>
        <DuplicateTestController />
        <DuplicateAgentOverlay />
      </WithStore>,
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId('open-dup-btn'));
    });
    expect(screen.getByText('Duplicate Agent')).toBeInTheDocument();
    expect(screen.getByText(/My Agent/)).toBeInTheDocument();
  });

  it('prefills input with "<name> Copy"', async () => {
    wrap(
      <WithStore>
        <DuplicateTestController />
        <DuplicateAgentOverlay />
      </WithStore>,
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId('open-dup-btn'));
    });
    const input = screen.getByRole('textbox');
    expect(input).toHaveValue('My Agent Copy');
  });

  it('closes on Cancel', async () => {
    wrap(
      <WithStore>
        <DuplicateTestController />
        <DuplicateAgentOverlay />
      </WithStore>,
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId('open-dup-btn'));
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Cancel'));
    });
    expect(screen.queryByText('Duplicate Agent')).not.toBeInTheDocument();
  });

  it('Duplicate button is enabled when name is filled and unique', async () => {
    wrap(
      <WithStore>
        <DuplicateTestController />
        <DuplicateAgentOverlay />
      </WithStore>,
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId('open-dup-btn'));
    });
    const btn = screen.getByRole('button', { name: 'Duplicate' });
    expect(btn).not.toBeDisabled();
  });

  it('Duplicate button is disabled when name is empty', async () => {
    wrap(
      <WithStore>
        <DuplicateTestController />
        <DuplicateAgentOverlay />
      </WithStore>,
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId('open-dup-btn'));
    });
    const input = screen.getByRole('textbox');
    await act(async () => {
      fireEvent.change(input, { target: { value: '' } });
    });
    expect(screen.getByRole('button', { name: 'Duplicate' })).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// RenameChatSessionOverlay
// ---------------------------------------------------------------------------
import {
  RenameChatSessionOverlay,
  RenameChatSessionAtom,
} from '../RenameChatSessionOverlay';

function RenameTestController() {
  const [, actions] = RenameChatSessionAtom.use();
  return (
    <button
      data-testid="open-rename-btn"
      onClick={() => actions.show('chat-1', 'session-1', 'Old Name')}
    >
      Open
    </button>
  );
}

describe('RenameChatSessionOverlay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when closed', () => {
    wrap(<RenameChatSessionOverlay />);
    expect(screen.queryByText('Rename Chat Session')).not.toBeInTheDocument();
  });

  it('opens and shows current title in input', async () => {
    wrap(
      <WithStore>
        <RenameTestController />
        <RenameChatSessionOverlay />
      </WithStore>,
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId('open-rename-btn'));
    });
    expect(screen.getByText('Rename Chat Session')).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveValue('Old Name');
  });

  it('closes on Cancel', async () => {
    wrap(
      <WithStore>
        <RenameTestController />
        <RenameChatSessionOverlay />
      </WithStore>,
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId('open-rename-btn'));
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Cancel'));
    });
    expect(screen.queryByText('Rename Chat Session')).not.toBeInTheDocument();
  });

  it('Rename button disabled when title is empty', async () => {
    wrap(
      <WithStore>
        <RenameTestController />
        <RenameChatSessionOverlay />
      </WithStore>,
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId('open-rename-btn'));
    });
    await act(async () => {
      fireEvent.change(screen.getByRole('textbox'), { target: { value: '  ' } });
    });
    expect(screen.getByRole('button', { name: 'Rename' })).toBeDisabled();
  });

  it('Enter key triggers confirm', async () => {
    wrap(
      <WithStore>
        <RenameTestController />
        <RenameChatSessionOverlay />
      </WithStore>,
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId('open-rename-btn'));
    });
    const input = screen.getByRole('textbox');
    // type new name then press Enter
    await act(async () => {
      fireEvent.change(input, { target: { value: 'New Name' } });
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    // overlay should close after confirm
    expect(screen.queryByText('Rename Chat Session')).not.toBeInTheDocument();
  });
});
