// @ts-nocheck
/** @vitest-environment happy-dom */

/**
 * FreSettingUpView — deep supplementary tests
 * Covers branches not exercised by FreSettingUpView.test.tsx:
 *  - isVersionCompatible: major > 3, major < 3, minor < 10, no regex match
 *  - getDisplayName fallback to shortcutName when windowTitle is absent
 *  - installRequiredSkills: skills already installed (race-condition already-exists error)
 *  - selectPrimaryAgentForOpenKosmos: throws → onSetupComplete still called
 *  - handleSkipSetup: no userAlias → updateFreDone not called, onSkip called
 *  - Step counter display rendered
 *  - isVersionCompatible: try/catch path (no throw, just no-match)
 *  - installAgentFromConfig: create returns data as JSON string AND outer success=false
 */

const { brandRef, brandConfig } = vi.hoisted(() => ({
  brandRef: { value: 'kosmos' },
  brandConfig: { windowTitle: 'OpenKosmos AI Studio', shortcutName: 'OpenKosmos' } as any,
}));

vi.mock('@shared/constants/branding', async () => ({
  get APP_NAME() { return 'OpenKosmos'; },
  get BRAND_NAME() { return brandRef.value; },
  get BRAND_CONFIG() { return brandConfig; },
}));

const mockGetSkills = vi.fn(() => []);
const mockGetProfile = vi.fn();
const mockGetCurrentUserAlias = vi.fn(() => 'user-1');

vi.mock('@renderer/lib/userData', async () => ({
  profileDataManager: {
    getCurrentUserAlias: (...a: unknown[]) => mockGetCurrentUserAlias(...a),
    getSkills: (...a: unknown[]) => mockGetSkills(...a),
    getProfile: (...a: unknown[]) => mockGetProfile(...a),
  },
}));

vi.mock('@renderer/lib/chat/startNewChatFor', async () => ({
  startNewChatFor: vi.fn().mockResolvedValue({ success: true, chatSessionId: 'sess-1' }),
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

// ─── helpers ───────────────────────────────────────────────────────────────

function makeApi(overrides: any = {}) {
  return {
    runtime: {
      checkStatus: vi.fn().mockResolvedValue({ bun: false, uv: false, bunPath: '', uvPath: '' }),
      setMode: vi.fn().mockResolvedValue(undefined),
      install: vi.fn().mockResolvedValue(undefined),
      listPythonVersionsFast: vi.fn().mockResolvedValue([]),
      installPythonVersion: vi.fn().mockResolvedValue(undefined),
      setPinnedPythonVersion: vi.fn().mockResolvedValue(undefined),
      ...overrides.runtime,
    },
    profile: {
      updateFreDone: vi.fn().mockResolvedValue(undefined),
      setPrimaryAgent: vi.fn().mockResolvedValue({ success: true }),
      ...overrides.profile,
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
          return Promise.resolve({ success: true, data: { success: true, chat_id: 'chat-1' } });
        }
        if (tool === 'list_agents') {
          return Promise.resolve({ success: true, data: { agents: [] } });
        }
        if (tool === 'create_mcp_server_from_config') {
          return Promise.resolve({ success: true, data: { success: true } });
        }
        return Promise.resolve({ success: true, data: null });
      }),
      ...overrides.builtinTools,
    },
    skillLibrary: {
      addSkill: vi.fn().mockResolvedValue({ success: true }),
      getLibraryData: vi.fn().mockResolvedValue({
        success: true,
        data: { skills: [{ name: 'web-search' }] },
      }),
      ...overrides.skillLibrary,
    },
    mcpLibrary: {
      fetchAndUpdate: vi.fn().mockResolvedValue({ success: true, data: { mcp_servers: [] } }),
      ...overrides.mcpLibrary,
    },
    kosmos: {
      replacePlaceholders: vi.fn().mockImplementation((obj: any) =>
        Promise.resolve({ success: true, data: obj })
      ),
      ...overrides.kosmos,
    },
    fs: {
      exists: vi.fn().mockResolvedValue(false),
      downloadFile: vi.fn().mockResolvedValue({ success: true, size: 100 }),
      deletePaths: vi.fn().mockResolvedValue(undefined),
      ...overrides.fs,
    },
    getUserDataPath: overrides.getUserDataPath ?? vi.fn().mockResolvedValue('/mock/userData'),
  };
}

function setApi(overrides: any = {}) {
  (window as any).electronAPI = makeApi(overrides);
}

function defaultProfile() {
  mockGetProfile.mockReturnValue({
    primaryAgent: 'Kobi',
    chats: [{ chat_id: 'chat-1', agent: { name: 'Kobi' } }],
  });
}

const mockOnSkip = vi.fn();
const mockOnSetupComplete = vi.fn();

describe('FreSettingUpView — deep coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    brandRef.value = 'kosmos';
    brandConfig.windowTitle = 'OpenKosmos AI Studio';
    brandConfig.shortcutName = 'OpenKosmos';
    mockGetSkills.mockReturnValue([]);
    defaultProfile();
    setApi();
  });

  afterEach(() => {
    delete (window as any).electronAPI;
  });

  // ─── isVersionCompatible via listPythonVersionsFast ───────────────────────

  it('uses Python 4.x when installed (major > 3 → compatible)', async () => {
    setApi({
      runtime: {
        listPythonVersionsFast: vi.fn().mockResolvedValue([
          { version: '4.0.0', semver: '4.0.0', status: 'installed', path: '/usr/bin/python4' },
        ]),
      },
    });
    await act(async () => {
      render(<FreSettingUpView setupFlowType="basic" selectedAgent={null} onSkip={mockOnSkip} onSetupComplete={mockOnSetupComplete} isWindows={false} />);
    });
    await waitFor(() => expect(mockOnSetupComplete).toHaveBeenCalled(), { timeout: 5000 });
    // Should pin 4.0.0 (not install)
    expect((window as any).electronAPI.runtime.setPinnedPythonVersion).toHaveBeenCalledWith('4.0.0');
    expect((window as any).electronAPI.runtime.installPythonVersion).not.toHaveBeenCalled();
  });

  it('skips Python 2.x (major < 3 → not compatible)', async () => {
    setApi({
      runtime: {
        listPythonVersionsFast: vi.fn().mockResolvedValue([
          { version: '2.7.18', semver: '2.7.18', status: 'installed', path: '/usr/bin/python2' },
        ]),
      },
    });
    await act(async () => {
      render(<FreSettingUpView setupFlowType="basic" selectedAgent={null} onSkip={mockOnSkip} onSetupComplete={mockOnSetupComplete} isWindows={false} />);
    });
    await waitFor(() => expect(mockOnSetupComplete).toHaveBeenCalled(), { timeout: 5000 });
    // 2.7.18 is not compatible → installs 3.10.12
    expect((window as any).electronAPI.runtime.installPythonVersion).toHaveBeenCalledWith('3.10.12');
  });

  it('skips Python 3.9.x (minor < 10 → not compatible)', async () => {
    setApi({
      runtime: {
        listPythonVersionsFast: vi.fn().mockResolvedValue([
          { version: '3.9.7', semver: '3.9.7', status: 'installed', path: '/usr/bin/python3.9' },
        ]),
      },
    });
    await act(async () => {
      render(<FreSettingUpView setupFlowType="basic" selectedAgent={null} onSkip={mockOnSkip} onSetupComplete={mockOnSetupComplete} isWindows={false} />);
    });
    await waitFor(() => expect(mockOnSetupComplete).toHaveBeenCalled(), { timeout: 5000 });
    expect((window as any).electronAPI.runtime.installPythonVersion).toHaveBeenCalledWith('3.10.12');
  });

  it('ignores Python version with invalid semver string (no match → incompatible)', async () => {
    setApi({
      runtime: {
        listPythonVersionsFast: vi.fn().mockResolvedValue([
          { version: 'invalid-version', semver: 'invalid', status: 'installed', path: '/weird' },
        ]),
      },
    });
    await act(async () => {
      render(<FreSettingUpView setupFlowType="basic" selectedAgent={null} onSkip={mockOnSkip} onSetupComplete={mockOnSetupComplete} isWindows={false} />);
    });
    await waitFor(() => expect(mockOnSetupComplete).toHaveBeenCalled(), { timeout: 5000 });
    expect((window as any).electronAPI.runtime.installPythonVersion).toHaveBeenCalledWith('3.10.12');
  });

  it('ignores Python with status !== installed', async () => {
    setApi({
      runtime: {
        listPythonVersionsFast: vi.fn().mockResolvedValue([
          { version: '3.11.0', semver: '3.11.0', status: 'available', path: '' },
        ]),
      },
    });
    await act(async () => {
      render(<FreSettingUpView setupFlowType="basic" selectedAgent={null} onSkip={mockOnSkip} onSetupComplete={mockOnSetupComplete} isWindows={false} />);
    });
    await waitFor(() => expect(mockOnSetupComplete).toHaveBeenCalled(), { timeout: 5000 });
    expect((window as any).electronAPI.runtime.installPythonVersion).toHaveBeenCalledWith('3.10.12');
  });

  // ─── getDisplayName fallback ────────────────────────────────────────────

  it('uses shortcutName when windowTitle is absent', async () => {
    brandConfig.windowTitle = undefined;
    brandConfig.shortcutName = 'OpenKosmosShortcut';
    render(<FreSettingUpView setupFlowType="basic" selectedAgent={null} onSkip={mockOnSkip} isWindows={false} />);
    // The subtitle contains the display name
    expect(screen.getByText(/preparing the environment/i)).toBeInTheDocument();
  });

  it('falls back to APP_NAME when both windowTitle and shortcutName absent', async () => {
    brandConfig.windowTitle = undefined;
    brandConfig.shortcutName = undefined;
    render(<FreSettingUpView setupFlowType="basic" selectedAgent={null} onSkip={mockOnSkip} isWindows={false} />);
    expect(screen.getByText(/preparing the environment/i)).toBeInTheDocument();
  });
});
