// @ts-nocheck
/**
 * @vitest-environment happy-dom
 *
 * AgentDropdownMenu — additional coverage
 */

import React from 'react';
import { fireEvent, render, screen, act } from '@testing-library/react';
import { WithStore } from '@/atom';

// ── Hoisted mock vars ────────────────────────────────────────────────────────
const mockShowAgent = vi.hoisted(() => vi.fn());

// ── Drop-down position ───────────────────────────────────────────────────────
vi.mock('../../../lib/utilities/dropdownPosition', () => ({
  adjustAnchoredDropdownToViewport: vi.fn(),
  getAnchoredDropdownPosition: vi.fn().mockReturnValue({ top: 10, left: 10, triggerTop: 10, triggerRight: 10 }),
  ANCHORED_DROPDOWN_SIZE_PRESETS: { agentMenu: { estimatedWidth: 200, estimatedHeight: 300 } },
}));

// ── Router ───────────────────────────────────────────────────────────────────
const mockNavigate = vi.hoisted(() => vi.fn());
vi.mock('react-router-dom', () => ({ useNavigate: () => mockNavigate }));

// ── Toast ─────────────────────────────────────────────────────────────────────
const mockShowSuccess = vi.hoisted(() => vi.fn());
const mockShowError   = vi.hoisted(() => vi.fn());
vi.mock('../../ui/ToastProvider', () => ({
  useToast: () => ({ showSuccess: mockShowSuccess, showError: mockShowError }),
}));

// ── ProfileData ───────────────────────────────────────────────────────────────
const mockUseProfileData = vi.hoisted(() => vi.fn());
vi.mock('../../userData/userDataProvider', () => ({
  useProfileData: () => mockUseProfileData(),
}));

// ── isBuiltinAgent ────────────────────────────────────────────────────────────
const mockIsBuiltinAgent = vi.hoisted(() => vi.fn(() => false));
vi.mock('../../../lib/userData/types', () => ({
  isBuiltinAgent: (...args: any[]) => mockIsBuiltinAgent(...args),
}));

// ── profileDataManager ────────────────────────────────────────────────────────
const mockRefresh = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('../../../lib/userData', () => ({
  profileDataManager: { refresh: () => mockRefresh() },
}));

// ── use-click-out ─────────────────────────────────────────────────────────────
vi.mock('../../ui/use-click-out', () => ({ useClickOut: vi.fn() }));

// ── BRAND_NAME ────────────────────────────────────────────────────────────────
vi.mock('@shared/constants/branding', () => ({ BRAND_NAME: 'openkosmos' }));

// ── DuplicateAgentOverlay — duck-typed atom mock ──────────────────────────────
const mockDuplicateShow = vi.hoisted(() => vi.fn());
vi.mock('../../overlay/DuplicateAgentOverlay', () => ({
  DuplicateAgentAtom: {
    use:       () => [{ isOpen: false, chatId: null, agentName: null, newName: '' }, {}],
    useChange: () => ({ show: mockDuplicateShow, cancel: vi.fn(), setNewName: vi.fn(), confirm: vi.fn() }),
    useData:   () => ({ isOpen: false }),
  },
}));

// ── DeleteOverlay — duck-typed atom mock ──────────────────────────────────────
vi.mock('../../overlay/DeleteOverlay', () => ({
  DeleteConfirmAtom: {
    use:       () => [{ isOpen: false }, {}],
    useChange: () => ({ showAgent: mockShowAgent, close: vi.fn() }),
    useData:   () => ({ isOpen: false }),
  },
}));

// ── Lucide icons ──────────────────────────────────────────────────────────────
vi.mock('lucide-react', () => ({
  Pencil:  (p: any) => <span {...p}>Pencil</span>,
  Trash2:  (p: any) => <span {...p}>Trash2</span>,
  Copy:    (p: any) => <span {...p}>Copy</span>,
  Upload:  (p: any) => <span {...p}>Upload</span>,
  Archive: (p: any) => <span {...p}>Archive</span>,
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeProfileData(overrides: any = {}) {
  return {
    chats: overrides.chats ?? [
      { chat_id: 'c1', agent: { name: 'MyAgent' } },
    ],
    data: { profile: { primaryAgent: overrides.primaryAgent ?? 'OtherAgent' } },
  };
}

async function renderOpenMenu(chatId = 'c1', profileOverrides: any = {}) {
  const { default: AgentDropdownMenu, AgentMenuAtom } = await import('../AgentDropdownMenu');
  mockUseProfileData.mockReturnValue(makeProfileData(profileOverrides));

  const anchorEl = document.createElement('button');
  document.body.appendChild(anchorEl);

  const Wrapper = () => {
    const actions = AgentMenuAtom.useChange();
    React.useEffect(() => {
      actions.toggle(chatId, anchorEl);
      return () => { anchorEl.remove(); };
    }, []);
    return <AgentDropdownMenu />;
  };

  return render(<WithStore><Wrapper /></WithStore>);
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockIsBuiltinAgent.mockReturnValue(false);
  mockRefresh.mockResolvedValue(undefined);

  Object.defineProperty(window, 'electronAPI', {
    writable: true, configurable: true,
    value: {
      profile: {
        setPrimaryAgent: vi.fn().mockResolvedValue({ success: true }),
        archiveChatConfig: vi.fn().mockResolvedValue({ success: true }),
      },
      agentChat: {
        importChatSession: vi.fn().mockResolvedValue({ success: true, importedSessionId: 'sess-1' }),
      },
    },
  });
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AgentDropdownMenu — coverage', () => {
  it('default export returns null when menu is closed', async () => {
    const { default: AgentDropdownMenu } = await import('../AgentDropdownMenu');
    mockUseProfileData.mockReturnValue(makeProfileData());
    const { container } = render(<WithStore><AgentDropdownMenu /></WithStore>);
    expect(container.firstChild).toBeNull();
  });

  it('Edit Agent button dispatches agent:editAgent event', async () => {
    const listener = vi.fn();
    window.addEventListener('agent:editAgent', listener);
    await renderOpenMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /edit agent/i }));
    expect(listener).toHaveBeenCalled();
    window.removeEventListener('agent:editAgent', listener);
  });

  it('Delete Agent calls showAgent with correct args', async () => {
    await renderOpenMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /delete agent/i }));
    expect(mockShowAgent).toHaveBeenCalledWith('c1', 'MyAgent', false);
  });

  it('Delete Agent falls back to "Unknown Agent" when no agent name', async () => {
    await renderOpenMenu('c1', { chats: [{ chat_id: 'c1', agent: {} }] });
    fireEvent.click(screen.getByRole('menuitem', { name: /delete agent/i }));
    expect(mockShowAgent).toHaveBeenCalledWith('c1', 'Unknown Agent', false);
  });

  it('Set as Primary Agent: success path calls showSuccess and refresh', async () => {
    await renderOpenMenu();
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: /set as primary agent/i }));
    });
    expect(mockShowSuccess).toHaveBeenCalledWith(expect.stringContaining('MyAgent'));
    expect(mockRefresh).toHaveBeenCalled();
  });

  it('Set as Primary Agent: result.success=false shows error with result.error', async () => {
    (window as any).electronAPI.profile.setPrimaryAgent = vi.fn().mockResolvedValue({ success: false, error: 'permission denied' });
    await renderOpenMenu();
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: /set as primary agent/i }));
    });
    expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('permission denied'));
  });

  it('Set as Primary Agent: result.success=false with no error shows Unknown error', async () => {
    (window as any).electronAPI.profile.setPrimaryAgent = vi.fn().mockResolvedValue({ success: false });
    await renderOpenMenu();
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: /set as primary agent/i }));
    });
    expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('Unknown error'));
  });

  it('Set as Primary Agent: no API shows error', async () => {
    (window as any).electronAPI.profile.setPrimaryAgent = undefined;
    await renderOpenMenu();
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: /set as primary agent/i }));
    });
    expect(mockShowError).toHaveBeenCalledWith('setPrimaryAgent API not available');
  });

  it('Set as Primary Agent: no electronAPI shows error', async () => {
    Object.defineProperty(window, 'electronAPI', { writable: true, configurable: true, value: undefined });
    await renderOpenMenu();
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: /set as primary agent/i }));
    });
    expect(mockShowError).toHaveBeenCalled();
  });

  it('Set as Primary Agent: no agent name shows error', async () => {
    await renderOpenMenu('c1', { chats: [{ chat_id: 'c1' }] });
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: /set as primary agent/i }));
    });
    expect(mockShowError).toHaveBeenCalledWith('Agent name not found');
  });

  it('Set as Primary Agent: exception shows error', async () => {
    (window as any).electronAPI.profile.setPrimaryAgent = vi.fn().mockRejectedValue(new Error('network fail'));
    await renderOpenMenu();
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: /set as primary agent/i }));
    });
    expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('network fail'));
  });

  it('Import Chat Session: success with importedSessionId navigates and shows success', async () => {
    await renderOpenMenu();
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: /import chat session/i }));
    });
    expect(mockNavigate).toHaveBeenCalledWith('/agent/chat/c1/sess-1');
    expect(mockShowSuccess).toHaveBeenCalledWith('Successfully imported chat session');
  });

  it('Import Chat Session: success without importedSessionId shows success but no navigate', async () => {
    (window as any).electronAPI.agentChat.importChatSession = vi.fn().mockResolvedValue({ success: true });
    await renderOpenMenu();
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: /import chat session/i }));
    });
    expect(mockShowSuccess).toHaveBeenCalledWith('Successfully imported chat session');
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('Import Chat Session: File selection canceled does NOT call showError', async () => {
    (window as any).electronAPI.agentChat.importChatSession = vi.fn().mockResolvedValue({ success: false, error: 'File selection canceled' });
    await renderOpenMenu();
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: /import chat session/i }));
    });
    expect(mockShowError).not.toHaveBeenCalled();
  });

  it('Import Chat Session: failure with error shows showError', async () => {
    (window as any).electronAPI.agentChat.importChatSession = vi.fn().mockResolvedValue({ success: false, error: 'bad file' });
    await renderOpenMenu();
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: /import chat session/i }));
    });
    expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('bad file'));
  });

  it('Import Chat Session: no API shows error', async () => {
    (window as any).electronAPI.agentChat = undefined;
    await renderOpenMenu();
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: /import chat session/i }));
    });
    expect(mockShowError).toHaveBeenCalledWith('Import API not available');
  });

  it('Import Chat Session: exception shows error', async () => {
    (window as any).electronAPI.agentChat.importChatSession = vi.fn().mockRejectedValue(new Error('crash'));
    await renderOpenMenu();
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: /import chat session/i }));
    });
    expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('crash'));
  });

  it('Archive Agent: success shows success toast and refreshes', async () => {
    await renderOpenMenu();
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: /archive agent/i }));
    });
    expect(mockShowSuccess).toHaveBeenCalledWith(expect.stringContaining('archived successfully'));
    expect(mockRefresh).toHaveBeenCalled();
  });

  it('Archive Agent: no archiveChatConfig API shows error', async () => {
    (window as any).electronAPI.profile.archiveChatConfig = undefined;
    await renderOpenMenu();
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: /archive agent/i }));
    });
    expect(mockShowError).toHaveBeenCalledWith('Archive API not available');
  });

  it('Archive Agent: result.success=false shows error with result.error', async () => {
    (window as any).electronAPI.profile.archiveChatConfig = vi.fn().mockResolvedValue({ success: false, error: 'locked' });
    await renderOpenMenu();
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: /archive agent/i }));
    });
    expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('locked'));
  });

  it('Archive Agent: exception shows error', async () => {
    (window as any).electronAPI.profile.archiveChatConfig = vi.fn().mockRejectedValue(new Error('io err'));
    await renderOpenMenu();
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: /archive agent/i }));
    });
    expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('io err'));
  });

  it('hides Archive and Delete when isBuiltinAgent returns true', async () => {
    mockIsBuiltinAgent.mockReturnValue(true);
    await renderOpenMenu();
    expect(screen.queryByRole('menuitem', { name: /archive agent/i })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /delete agent/i })).toBeNull();
  });

  it('hides Archive, Delete and "Set as Primary" when agent is already primary', async () => {
    await renderOpenMenu('c1', { primaryAgent: 'MyAgent' });
    expect(screen.queryByRole('menuitem', { name: /archive agent/i })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /delete agent/i })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /set as primary agent/i })).toBeNull();
  });

  it('hides Duplicate button when currentChat has no agent.name', async () => {
    await renderOpenMenu('c1', { chats: [{ chat_id: 'c1', agent: {} }] });
    expect(screen.queryByRole('menuitem', { name: /duplicate/i })).toBeNull();
  });

  it('Import shows "Importing..." label while in progress', async () => {
    let resolveImport!: (v: any) => void;
    (window as any).electronAPI.agentChat.importChatSession = vi.fn(
      () => new Promise(r => { resolveImport = r; })
    );
    await renderOpenMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /import chat session/i }));
    expect(screen.getByText(/importing\.\.\./i)).toBeInTheDocument();
    await act(async () => { resolveImport({ success: false, error: 'canceled' }); });
  });

  it('Archive Agent: uses "Unknown Agent" fallback when chat has no agent name', async () => {
    await renderOpenMenu('c1', { chats: [{ chat_id: 'c1', agent: {} }] });
    // No agent name means no Duplicate button, but Archive and Delete are still shown if not builtin/primary
    // agent.name is undefined so Archive should still appear (onArchiveAgent is always set)
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: /archive agent/i }));
    });
    expect(mockShowSuccess).toHaveBeenCalledWith(expect.stringContaining('Unknown Agent'));
  });

  it('Duplicate Agent calls onDuplicateAgent with chatId and agentName', async () => {
    await renderOpenMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /duplicate/i }));
    expect(mockDuplicateShow).toHaveBeenCalledWith('c1', 'MyAgent');
  });
});
