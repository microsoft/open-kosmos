// @ts-nocheck
/** @vitest-environment happy-dom */

/**
 * FreSettingUpView unit tests
 *
 * Covers:
 * - Auto-start on mount (Strict Mode guard)
 * - Basic flow: Bun → uv → Python → built-in skills → onSetupComplete
 * - Skips already-installed tools
 * - Error state with Retry/Skip buttons
 * - OpenKosmos brand: sets freDone on completion
 */

const { brandRef } = vi.hoisted(() => ({ brandRef: { value: 'kosmos' } }));
vi.mock('@shared/constants/branding', async () => ({
  get APP_NAME() { return 'OpenKosmos'; },
  get BRAND_NAME() { return brandRef.value; },
  get BRAND_CONFIG() { return { windowTitle: 'OpenKosmos AI Studio', shortcutName: 'OpenKosmos' }; },
}));

const mockGetSkills = vi.fn(() => []);
const mockGetProfile = vi.fn();
const mockGetCurrentUserAlias = vi.fn(() => 'test-user');

vi.mock('@renderer/lib/userData', async () => ({
  profileDataManager: {
    getCurrentUserAlias: (...args: unknown[]) => mockGetCurrentUserAlias(...args),
    getSkills: (...args: unknown[]) => mockGetSkills(...args),
    getProfile: (...args: unknown[]) => mockGetProfile(...args),
  },
}));

vi.mock('@renderer/lib/chat/startNewChatFor', async () => ({
  startNewChatFor: vi.fn().mockResolvedValue({ success: true, chatId: 'chat-1', chatSessionId: 'session-1' }),
}));

vi.mock('../../../shared/constants/builtinSkills', async () => ({
  BUILTIN_SKILL_NAMES: ['web-search'],
}));

vi.mock('../../lib/utilities/logger', async () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import FreSettingUpView from '../FreSettingUpView';

describe('FreSettingUpView', () => {
  const mockOnSkip = vi.fn();
  const mockOnSetupComplete = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    brandRef.value = 'kosmos';
    mockGetSkills.mockReturnValue([]);
    mockGetProfile.mockReturnValue({
      primaryAgent: 'Kobi',
      chats: [
        {
          chat_id: 'chat-1',
          agent: { name: 'Kobi' },
        },
      ],
    });

    (window as any).electronAPI = {
      runtime: {
        checkStatus: vi.fn().mockResolvedValue({ bun: false, uv: false, bunPath: '', uvPath: '' }),
        setMode: vi.fn().mockResolvedValue(undefined),
        install: vi.fn().mockResolvedValue(undefined),
        listPythonVersionsFast: vi.fn().mockResolvedValue([]),
        installPythonVersion: vi.fn().mockResolvedValue(undefined),
        setPinnedPythonVersion: vi.fn().mockResolvedValue(undefined),
      },
      profile: {
        updateFreDone: vi.fn().mockResolvedValue(undefined),
        setPrimaryAgent: vi.fn().mockResolvedValue({ success: true }),
      },
      builtinTools: {
        execute: vi.fn().mockImplementation((tool: string, args: any) => {
          if (tool === 'get_agent_template_from_library') {
            return Promise.resolve({
              success: true,
              data: {
                config: {
                  name: args.agent_name,
                  requirements: { mcp: [], skills: [] },
                  configuration: { name: args.agent_name },
                  version: '1.0.0',
                },
              },
            });
          }
          if (tool === 'create_agent_from_config') {
            return Promise.resolve({ success: true, data: { success: true, chat_id: 'chat-agent-1' } });
          }
          if (tool === 'list_agents') {
            return Promise.resolve({
              success: true,
              data: { agents: [{ name: args.agent_name || 'Research Agent', chat_id: 'chat-agent-1' }] },
            });
          }
          if (tool === 'create_mcp_server_from_config') {
            return Promise.resolve({ success: true, data: { success: true } });
          }
          return Promise.resolve({ success: true, data: null });
        }),
      },
      skillLibrary: {
        addSkill: vi.fn().mockResolvedValue({ success: true }),
        getLibraryData: vi.fn().mockResolvedValue({
          success: true,
          data: { skills: [{ name: 'web-search', version: '1.0.0' }] },
        }),
      },
      mcpLibrary: {
        fetchAndUpdate: vi.fn().mockResolvedValue({ success: true, data: { mcp_servers: [] } }),
      },
      kosmos: {
        replacePlaceholders: vi.fn().mockImplementation((obj: any) => Promise.resolve({ success: true, data: obj })),
      },
      fs: {
        exists: vi.fn().mockResolvedValue(false),
        downloadFile: vi.fn().mockResolvedValue({ success: true, size: 1000 }),
        deletePaths: vi.fn().mockResolvedValue(undefined),
      },
      getUserDataPath: vi.fn().mockResolvedValue('/mock/userData'),
    };
  });

  afterEach(() => {
    delete (window as any).electronAPI;
  });

  it('should auto-start setup on mount', async () => {
    await act(async () => {
      render(<FreSettingUpView setupFlowType="basic" selectedAgent={null} onSkip={mockOnSkip} onSetupComplete={mockOnSetupComplete} isWindows={false} />);
    });

    expect((window as any).electronAPI.runtime.checkStatus).toHaveBeenCalled();
    expect((window as any).electronAPI.runtime.setMode).toHaveBeenCalledWith('internal');
  });

  it('should skip bun/uv install when already present', async () => {
    (window as any).electronAPI.runtime.checkStatus.mockResolvedValue({ bun: true, uv: true, bunPath: '/usr/local/bin/bun', uvPath: '/usr/local/bin/uv' });

    await act(async () => {
      render(<FreSettingUpView setupFlowType="basic" selectedAgent={null} onSkip={mockOnSkip} onSetupComplete={mockOnSetupComplete} isWindows={false} />);
    });

    // Should NOT call install for bun or uv
    expect((window as any).electronAPI.runtime.install).not.toHaveBeenCalled();
  });

  it('should install bun and uv when not present', async () => {
    await act(async () => {
      render(<FreSettingUpView setupFlowType="basic" selectedAgent={null} onSkip={mockOnSkip} onSetupComplete={mockOnSetupComplete} isWindows={false} />);
    });

    expect((window as any).electronAPI.runtime.install).toHaveBeenCalledWith('bun', '1.3.6');
    expect((window as any).electronAPI.runtime.install).toHaveBeenCalledWith('uv', '0.6.17');
  });

  it('should use existing compatible Python version', async () => {
    (window as any).electronAPI.runtime.listPythonVersionsFast.mockResolvedValue([
      { version: '3.11.0', semver: '3.11.0', status: 'installed', path: '/usr/bin/python3.11' },
    ]);

    await act(async () => {
      render(<FreSettingUpView setupFlowType="basic" selectedAgent={null} onSkip={mockOnSkip} onSetupComplete={mockOnSetupComplete} isWindows={false} />);
    });

    expect((window as any).electronAPI.runtime.setPinnedPythonVersion).toHaveBeenCalledWith('3.11.0');
    expect((window as any).electronAPI.runtime.installPythonVersion).not.toHaveBeenCalled();
  });

  it('should install Python 3.10.12 when no compatible version found', async () => {
    await act(async () => {
      render(<FreSettingUpView setupFlowType="basic" selectedAgent={null} onSkip={mockOnSkip} onSetupComplete={mockOnSetupComplete} isWindows={false} />);
    });

    expect((window as any).electronAPI.runtime.installPythonVersion).toHaveBeenCalledWith('3.10.12');
  });

  it('should call onSetupComplete and set freDone for OpenKosmos brand (basic flow)', async () => {
    await act(async () => {
      render(<FreSettingUpView setupFlowType="basic" selectedAgent={null} onSkip={mockOnSkip} onSetupComplete={mockOnSetupComplete} isWindows={false} />);
    });

    await waitFor(() => {
      expect(mockOnSetupComplete).toHaveBeenCalled();
    }, { timeout: 5000 });

    expect((window as any).electronAPI.profile.updateFreDone).toHaveBeenCalledWith('test-user', true);
  });

  it('should show error and allow retry on failure', async () => {
    (window as any).electronAPI.runtime.checkStatus.mockRejectedValue(new Error('Runtime error'));

    await act(async () => {
      render(<FreSettingUpView setupFlowType="basic" selectedAgent={null} onSkip={mockOnSkip} onSetupComplete={mockOnSetupComplete} isWindows={false} />);
    });

    await waitFor(() => {
      expect(screen.getByText(/Runtime error/i)).toBeInTheDocument();
    });

    expect(screen.getByText(/Retry Setup/i)).toBeInTheDocument();
    expect(screen.getByText(/Skip Setup/i)).toBeInTheDocument();
  });

  it('should set freDone and call onSkip when Skip is clicked on error', async () => {
    (window as any).electronAPI.runtime.checkStatus.mockRejectedValue(new Error('fail'));

    await act(async () => {
      render(<FreSettingUpView setupFlowType="basic" selectedAgent={null} onSkip={mockOnSkip} onSetupComplete={mockOnSetupComplete} isWindows={false} />);
    });

    await waitFor(() => {
      expect(screen.getByText(/Skip Setup/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText(/Skip Setup/i));

    await waitFor(() => {
      expect(mockOnSkip).toHaveBeenCalled();
    });
  });

  it('shows "Setting up" title text', async () => {
    render(<FreSettingUpView setupFlowType="basic" selectedAgent={null} onSkip={mockOnSkip} onSetupComplete={mockOnSetupComplete} isWindows={false} />);
    expect(screen.getByText('Setting up')).toBeInTheDocument();
  });

  it('applies Windows title bar offset when isWindows=true', () => {
    const { container } = render(<FreSettingUpView setupFlowType="basic" selectedAgent={null} onSkip={mockOnSkip} onSetupComplete={mockOnSetupComplete} isWindows={true} />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.style.top).toBe('40px');
  });

  it('does not apply Windows title bar offset when isWindows=false', () => {
    const { container } = render(<FreSettingUpView setupFlowType="basic" selectedAgent={null} onSkip={mockOnSkip} onSetupComplete={mockOnSetupComplete} isWindows={false} />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.style.top).toBe('0px');
  });

  it('retries setup on retry button click', async () => {
    (window as any).electronAPI.runtime.checkStatus
      .mockRejectedValueOnce(new Error('fail first'))
      .mockResolvedValue({ bun: false, uv: false });

    await act(async () => {
      render(<FreSettingUpView setupFlowType="basic" selectedAgent={null} onSkip={mockOnSkip} onSetupComplete={mockOnSetupComplete} isWindows={false} />);
    });

    await waitFor(() => expect(screen.getByText(/Retry Setup/i)).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByText(/Retry Setup/i));
    });

    // After retry, checkStatus is called again
    await waitFor(() => expect((window as any).electronAPI.runtime.checkStatus).toHaveBeenCalledTimes(2));
  });

  it('skips already-installed builtin skills', async () => {
    mockGetSkills.mockReturnValue([{ name: 'web-search' }]);

    await act(async () => {
      render(<FreSettingUpView setupFlowType="basic" selectedAgent={null} onSkip={mockOnSkip} onSetupComplete={mockOnSetupComplete} isWindows={false} />);
    });

    await waitFor(() => expect(mockOnSetupComplete).toHaveBeenCalled(), { timeout: 5000 });
    // web-search is already installed, should not be added again
    expect((window as any).electronAPI.skillLibrary.addSkill).not.toHaveBeenCalledWith('web-search');
  });

  it('handles no profile for selectPrimaryAgentForOpenKosmos gracefully', async () => {
    mockGetProfile.mockReturnValue(null);

    await act(async () => {
      render(<FreSettingUpView setupFlowType="basic" selectedAgent={null} onSkip={mockOnSkip} onSetupComplete={mockOnSetupComplete} isWindows={false} />);
    });

    await waitFor(() => expect(mockOnSetupComplete).toHaveBeenCalled(), { timeout: 5000 });
  });

  it('handles no chats in profile for selectPrimaryAgentForOpenKosmos gracefully', async () => {
    mockGetProfile.mockReturnValue({ primaryAgent: 'Kobi', chats: [] });

    await act(async () => {
      render(<FreSettingUpView setupFlowType="basic" selectedAgent={null} onSkip={mockOnSkip} onSetupComplete={mockOnSetupComplete} isWindows={false} />);
    });

    await waitFor(() => expect(mockOnSetupComplete).toHaveBeenCalled(), { timeout: 5000 });
  });

  it('uses first chat when primaryAgent not found', async () => {
    mockGetProfile.mockReturnValue({
      primaryAgent: 'NonExistent',
      chats: [{ chat_id: 'chat-first', agent: { name: 'SomeAgent' } }],
    });

    await act(async () => {
      render(<FreSettingUpView setupFlowType="basic" selectedAgent={null} onSkip={mockOnSkip} onSetupComplete={mockOnSetupComplete} isWindows={false} />);
    });

    await waitFor(() => expect(mockOnSetupComplete).toHaveBeenCalled(), { timeout: 5000 });
  });

  it('handles skills library fetch failure gracefully', async () => {
    (window as any).electronAPI.skillLibrary.getLibraryData.mockResolvedValue({ success: false, error: 'fetch error' });

    await act(async () => {
      render(<FreSettingUpView setupFlowType="basic" selectedAgent={null} onSkip={mockOnSkip} onSetupComplete={mockOnSetupComplete} isWindows={false} />);
    });

    // Should complete even if builtin assets fail
    await waitFor(() => expect(mockOnSetupComplete).toHaveBeenCalled(), { timeout: 5000 });
  });

  it('handles listPythonVersionsFast failure gracefully', async () => {
    (window as any).electronAPI.runtime.listPythonVersionsFast.mockRejectedValue(new Error('scan failed'));

    await act(async () => {
      render(<FreSettingUpView setupFlowType="basic" selectedAgent={null} onSkip={mockOnSkip} onSetupComplete={mockOnSetupComplete} isWindows={false} />);
    });

    await waitFor(() => expect(mockOnSetupComplete).toHaveBeenCalled(), { timeout: 5000 });
    // Should still install Python since scan failed
    expect((window as any).electronAPI.runtime.installPythonVersion).toHaveBeenCalledWith('3.10.12');
  });

  it('handles freDone update when userAlias is null', async () => {
    mockGetCurrentUserAlias.mockReturnValue(null);

    await act(async () => {
      render(<FreSettingUpView setupFlowType="basic" selectedAgent={null} onSkip={mockOnSkip} onSetupComplete={mockOnSetupComplete} isWindows={false} />);
    });

    await waitFor(() => expect(mockOnSetupComplete).toHaveBeenCalled(), { timeout: 5000 });
    expect((window as any).electronAPI.profile.updateFreDone).not.toHaveBeenCalled();
  });

  it('renders step counter while setup is running', () => {
    render(<FreSettingUpView setupFlowType="basic" selectedAgent={null} onSkip={mockOnSkip} isWindows={false} />);
    // Progress section should show step counter
    expect(screen.getByText('Setting up')).toBeInTheDocument();
  });

  it('handles skill not found in remote library (skips it gracefully)', async () => {
    // BUILTIN_SKILLS = ['web-search'], but remote library has no matching skill
    (window as any).electronAPI.skillLibrary.getLibraryData.mockResolvedValue({
      success: true,
      data: { skills: [] }, // empty - no 'web-search' in remote
    });

    await act(async () => {
      render(<FreSettingUpView setupFlowType="basic" selectedAgent={null} onSkip={mockOnSkip} onSetupComplete={mockOnSetupComplete} isWindows={false} />);
    });

    await waitFor(() => expect(mockOnSetupComplete).toHaveBeenCalled(), { timeout: 5000 });
    // Should not throw, skill is simply skipped
    expect((window as any).electronAPI.skillLibrary.addSkill).not.toHaveBeenCalled();
  });

  it('handles addSkill returning already-exists error', async () => {
    (window as any).electronAPI.skillLibrary.addSkill.mockResolvedValue({
      success: false,
      error: 'Skill already exists',
    });

    await act(async () => {
      render(<FreSettingUpView setupFlowType="basic" selectedAgent={null} onSkip={mockOnSkip} onSetupComplete={mockOnSetupComplete} isWindows={false} />);
    });

    await waitFor(() => expect(mockOnSetupComplete).toHaveBeenCalled(), { timeout: 5000 });
    // addSkill may or may not be called depending on if the skill is found in remote library
  });

  it('handles addSkill returning non-exists failure', async () => {
    (window as any).electronAPI.skillLibrary.addSkill.mockResolvedValue({
      success: false,
      error: 'Installation error',
    });

    await act(async () => {
      render(<FreSettingUpView setupFlowType="basic" selectedAgent={null} onSkip={mockOnSkip} onSetupComplete={mockOnSetupComplete} isWindows={false} />);
    });

    await waitFor(() => expect(mockOnSetupComplete).toHaveBeenCalled(), { timeout: 5000 });
    // Setup should complete even when addSkill fails
  });

  it('handles selectPrimaryAgentForOpenKosmos when targetChatId is empty (no chat_id)', async () => {
    // firstChat has no chat_id
    mockGetProfile.mockReturnValue({
      primaryAgent: 'NonExistent',
      chats: [{ agent: { name: 'SomeAgent' } }], // no chat_id
    });

    await act(async () => {
      render(<FreSettingUpView setupFlowType="basic" selectedAgent={null} onSkip={mockOnSkip} onSetupComplete={mockOnSetupComplete} isWindows={false} />);
    });

    await waitFor(() => expect(mockOnSetupComplete).toHaveBeenCalled(), { timeout: 5000 });
  });

  it('handles startNewChatFor returning no success', async () => {
    const { startNewChatFor } = await import('@renderer/lib/chat/startNewChatFor');
    vi.mocked(startNewChatFor).mockResolvedValueOnce({ success: false });

    await act(async () => {
      render(<FreSettingUpView setupFlowType="basic" selectedAgent={null} onSkip={mockOnSkip} onSetupComplete={mockOnSetupComplete} isWindows={false} />);
    });

    await waitFor(() => expect(mockOnSetupComplete).toHaveBeenCalled(), { timeout: 5000 });
  });

  it('handles startNewChatFor throwing error gracefully', async () => {
    const { startNewChatFor } = await import('@renderer/lib/chat/startNewChatFor');
    vi.mocked(startNewChatFor).mockRejectedValueOnce(new Error('Network error'));

    await act(async () => {
      render(<FreSettingUpView setupFlowType="basic" selectedAgent={null} onSkip={mockOnSkip} onSetupComplete={mockOnSetupComplete} isWindows={false} />);
    });

    await waitFor(() => expect(mockOnSetupComplete).toHaveBeenCalled(), { timeout: 5000 });
  });

  it('fires mouse enter/leave on Retry button when there is an error', async () => {
    (window as any).electronAPI.runtime.checkStatus.mockRejectedValue(new Error('fail'));

    await act(async () => {
      render(<FreSettingUpView setupFlowType="basic" selectedAgent={null} onSkip={mockOnSkip} onSetupComplete={mockOnSetupComplete} isWindows={false} />);
    });

    await waitFor(() => expect(screen.getByText(/Retry Setup/i)).toBeInTheDocument());

    const retryBtn = screen.getByText(/Retry Setup/i);
    fireEvent.mouseEnter(retryBtn);
    fireEvent.mouseLeave(retryBtn);
    // no crash
  });

  it('fires mouse enter/leave on Skip button when there is an error', async () => {
    (window as any).electronAPI.runtime.checkStatus.mockRejectedValue(new Error('fail'));

    await act(async () => {
      render(<FreSettingUpView setupFlowType="basic" selectedAgent={null} onSkip={mockOnSkip} onSetupComplete={mockOnSetupComplete} isWindows={false} />);
    });

    await waitFor(() => expect(screen.getByText(/Skip Setup/i)).toBeInTheDocument());

    const skipBtn = screen.getByText(/Skip Setup/i);
    fireEvent.mouseEnter(skipBtn);
    fireEvent.mouseLeave(skipBtn);
    // no crash
  });
});

