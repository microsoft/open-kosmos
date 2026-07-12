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

// ── ArchiveOverlay — duck-typed atom mock ─────────────────────────────────────
const mockArchiveShow = vi.hoisted(() => vi.fn());
vi.mock('../../overlay/ArchiveOverlay', () => ({
  ArchiveConfirmAtom: {
    use:       () => [{ isOpen: false, chatId: null, agentName: null }, {}],
    useChange: () => ({ show: mockArchiveShow, cancel: vi.fn(), confirm: vi.fn() }),
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
    data: { profile: { primaryChat: overrides.primaryChat ?? 'other-chat' } },
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
        setPrimaryChat: vi.fn().mockResolvedValue({ success: true }),
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
    fireEvent.click(screen.getByRole('menuitem', { name: /delete/i }));
    expect(mockShowAgent).toHaveBeenCalledWith('c1', 'MyAgent', false);
  });

  it('Delete Agent falls back to "Unknown Agent" when no agent name', async () => {
    await renderOpenMenu('c1', { chats: [{ chat_id: 'c1', agent: {} }] });
    fireEvent.click(screen.getByRole('menuitem', { name: /delete/i }));
    expect(mockShowAgent).toHaveBeenCalledWith('c1', 'Unknown Agent', false);
  });

  it('Set as Primary Agent: success path calls showSuccess and refresh', async () => {
    await renderOpenMenu();
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: /^set as primary$/i }));
    });
    expect(mockShowSuccess).toHaveBeenCalledWith(expect.stringContaining('MyAgent'));
    expect(mockRefresh).toHaveBeenCalled();
  });

  it('Set as Primary Agent: result.success=false shows error with result.error', async () => {
    (window as any).electronAPI.profile.setPrimaryChat = vi.fn().mockResolvedValue({ success: false, error: 'permission denied' });
    await renderOpenMenu();
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: /^set as primary$/i }));
    });
    expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('permission denied'));
  });

  it('Set as Primary Agent: result.success=false with no error shows Unknown error', async () => {
    (window as any).electronAPI.profile.setPrimaryChat = vi.fn().mockResolvedValue({ success: false });
    await renderOpenMenu();
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: /^set as primary$/i }));
    });
    expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('Unknown error'));
  });

  it('Set as Primary Agent: no API shows error', async () => {
    (window as any).electronAPI.profile.setPrimaryChat = undefined;
    await renderOpenMenu();
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: /^set as primary$/i }));
    });
    expect(mockShowError).toHaveBeenCalledWith('setPrimaryChat API not available');
  });

  it('Set as Primary Agent: no electronAPI shows error', async () => {
    Object.defineProperty(window, 'electronAPI', { writable: true, configurable: true, value: undefined });
    await renderOpenMenu();
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: /^set as primary$/i }));
    });
    expect(mockShowError).toHaveBeenCalled();
  });

  it('Set as Primary Agent: chat not found shows error', async () => {
    // Toggle the menu for a chat id that is absent from the chats list, so the
    // handler's chat_id guard fires instead of resolving a primary chat.
    await renderOpenMenu('missing-chat', { chats: [{ chat_id: 'c1', agent: { name: 'MyAgent' } }] });
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: /^set as primary$/i }));
    });
    expect(mockShowError).toHaveBeenCalledWith('Chat not found');
  });

  it('Set as Primary Agent: exception shows error', async () => {
    (window as any).electronAPI.profile.setPrimaryChat = vi.fn().mockRejectedValue(new Error('network fail'));
    await renderOpenMenu();
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: /^set as primary$/i }));
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

  it('Archive: clicking shows archive confirmation with chatId and agentName', async () => {
    await renderOpenMenu();
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: /archive/i }));
    });
    expect(mockArchiveShow).toHaveBeenCalledWith('c1', 'MyAgent');
  });

  it('Archive: no archiveChatConfig API — still opens confirmation (logic moved to overlay)', async () => {
    (window as any).electronAPI.profile.archiveChatConfig = undefined;
    await renderOpenMenu();
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: /archive/i }));
    });
    expect(mockArchiveShow).toHaveBeenCalledWith('c1', 'MyAgent');
  });

  it('Archive: result.success=false — still opens confirmation (logic moved to overlay)', async () => {
    (window as any).electronAPI.profile.archiveChatConfig = vi.fn().mockResolvedValue({ success: false, error: 'locked' });
    await renderOpenMenu();
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: /archive/i }));
    });
    expect(mockArchiveShow).toHaveBeenCalledWith('c1', 'MyAgent');
  });

  it('Archive: exception — still opens confirmation (logic moved to overlay)', async () => {
    (window as any).electronAPI.profile.archiveChatConfig = vi.fn().mockRejectedValue(new Error('io err'));
    await renderOpenMenu();
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: /archive/i }));
    });
    expect(mockArchiveShow).toHaveBeenCalledWith('c1', 'MyAgent');
  });

  it('hides Archive and Delete when isBuiltinAgent returns true', async () => {
    mockIsBuiltinAgent.mockReturnValue(true);
    await renderOpenMenu();
    expect(screen.queryByRole('menuitem', { name: /archive/i })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /delete/i })).toBeNull();
  });

  it('hides Archive, Delete and "Set as Primary" when agent is already primary', async () => {
    await renderOpenMenu('c1', { primaryChat: 'c1' });
    expect(screen.queryByRole('menuitem', { name: /archive/i })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /delete/i })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /^set as primary$/i })).toBeNull();
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

  it('Archive: uses "Unknown Agent" fallback when chat has no agent name', async () => {
    await renderOpenMenu('c1', { chats: [{ chat_id: 'c1', agent: {} }] });
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: /archive/i }));
    });
    expect(mockArchiveShow).toHaveBeenCalledWith('c1', 'Unknown Agent');
  });

  it('Duplicate Agent calls onDuplicateAgent with chatId and agentName', async () => {
    await renderOpenMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /duplicate/i }));
    expect(mockDuplicateShow).toHaveBeenCalledWith('c1', 'MyAgent');
  });

  it('Set as Primary Agent: non-Error exception shows "Unknown error"', async () => {
    (window as any).electronAPI.profile.setPrimaryChat = vi.fn().mockRejectedValue('string error');
    await renderOpenMenu();
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: /^set as primary$/i }));
    });
    expect(mockShowError).toHaveBeenCalledWith('Failed to set primary: Unknown error');
  });

  it('Import Chat Session: non-Error exception shows "Unknown error"', async () => {
    (window as any).electronAPI.agentChat.importChatSession = vi.fn().mockRejectedValue('string error');
    await renderOpenMenu();
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: /import chat session/i }));
    });
    expect(mockShowError).toHaveBeenCalledWith('Import failed: Unknown error');
  });

  it('Import Chat Session: blocks double-click while importing', async () => {
    let resolveImport!: (v: any) => void;
    (window as any).electronAPI.agentChat.importChatSession = vi.fn(
      () => new Promise(r => { resolveImport = r; })
    );
    await renderOpenMenu();
    // First click starts import
    fireEvent.click(screen.getByRole('menuitem', { name: /import/i }));
    // Second click is ignored (isImporting guard)
    fireEvent.click(screen.getByRole('menuitem', { name: /import/i }));
    expect((window as any).electronAPI.agentChat.importChatSession).toHaveBeenCalledTimes(1);
    await act(async () => { resolveImport({ success: true, importedSessionId: 'x' }); });
  });

  it('Import Chat Session: failure without error message shows "Unknown error"', async () => {
    (window as any).electronAPI.agentChat.importChatSession = vi.fn().mockResolvedValue({ success: false });
    await renderOpenMenu();
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: /import chat session/i }));
    });
    expect(mockShowError).toHaveBeenCalledWith('Import failed: Unknown error');
  });

  it('AgentMenuAtom toggle: closing menu when same chatId is toggled', async () => {
    const { default: AgentDropdownMenu, AgentMenuAtom } = await import('../AgentDropdownMenu');
    mockUseProfileData.mockReturnValue(makeProfileData());

    const anchorEl = document.createElement('button');
    document.body.appendChild(anchorEl);

    const Wrapper = () => {
      const actions = AgentMenuAtom.useChange();
      return (
        <>
          <button data-testid="toggle" onClick={() => actions.toggle('c1', anchorEl)}>Toggle</button>
          <AgentDropdownMenu />
        </>
      );
    };

    render(<WithStore><Wrapper /></WithStore>);
    // Open menu
    await act(async () => { fireEvent.click(screen.getByTestId('toggle')); });
    expect(screen.getByRole('menu')).toBeInTheDocument();
    // Toggle same chatId → closes
    await act(async () => { fireEvent.click(screen.getByTestId('toggle')); });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    anchorEl.remove();
  });

  it('useLayoutEffect cleanup cancels animation frame', async () => {
    const cancelSpy = vi.spyOn(window, 'cancelAnimationFrame');
    const { unmount } = await renderOpenMenu();
    unmount();
    expect(cancelSpy).toHaveBeenCalled();
    cancelSpy.mockRestore();
  });
});
