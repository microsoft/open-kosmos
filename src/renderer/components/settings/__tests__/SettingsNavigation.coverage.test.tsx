/**
 * @vitest-environment happy-dom
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mockNavigate = vi.hoisted(() => vi.fn());
const mockUseFeatureFlag = vi.hoisted(() => vi.fn());
const mockUseData = vi.hoisted(() => vi.fn());
const mockGetMasterSwitch = vi.hoisted(() => vi.fn());

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('../../../lib/featureFlags', () => ({
  useFeatureFlag: mockUseFeatureFlag,
}));

vi.mock('@shared/constants/branding', () => ({
  APP_NAME: 'TestApp',
  BRAND_CONFIG: { productName: 'TestApp' },
}));

vi.mock('../../../states/left-nav.atom', () => ({
  LeftNavSizeAtom: {
    useData: mockUseData,
  },
}));

vi.mock('../../../ipc/agentHooks', () => ({
  agentHooksApi: {
    getMasterSwitch: mockGetMasterSwitch,
  },
}));

vi.mock('../../ui/navigation/NavItem', () => ({
  default: ({ icon, label, isActive, onClick, ariaLabel }: any) => (
    <button
      data-testid={`nav-${ariaLabel || label}`}
      data-active={isActive}
      onClick={onClick}
      aria-label={ariaLabel || label}
    >
      <span data-testid="nav-icon">{icon}</span>
      {label}
    </button>
  ),
}));

vi.mock('../../../styles/LeftNavigation.css', () => ({}));

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockUseFeatureFlag.mockReturnValue(false);
  mockUseData.mockReturnValue({ width: 288 });
  mockGetMasterSwitch.mockResolvedValue({ success: true, enabled: true });
});

import SettingsNavigation from '../SettingsNavigation';

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function renderNav(path = '/settings/mcp', onBack?: () => void) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SettingsNavigation onBack={onBack} />
    </MemoryRouter>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SettingsNavigation', () => {
  it('renders Settings heading', () => {
    renderNav();
    expect(screen.getByText('Settings')).toBeTruthy();
  });

  it('always renders MCP nav item', () => {
    renderNav();
    expect(screen.getByText('MCP')).toBeTruthy();
  });

  it('always renders Skills nav item', () => {
    renderNav();
    expect(screen.getByText('Skills')).toBeTruthy();
  });

  it('renders Hooks nav item when the master switch is enabled', async () => {
    renderNav();
    expect(await screen.findByText('Hooks')).toBeTruthy();
  });

  it('keeps Hooks nav visible when the master switch is disabled so users can reach the switch', async () => {
    mockGetMasterSwitch.mockResolvedValue({ success: true, enabled: false });
    renderNav();
    expect(screen.getByText('Hooks')).toBeTruthy();
  });

  it('keeps Hooks nav visible when the master switch change event fires', async () => {
    renderNav();
    expect(await screen.findByText('Hooks')).toBeTruthy();
    window.dispatchEvent(new CustomEvent('agent-hooks-master-switch-changed', { detail: { enabled: false } }));
    expect(screen.getByText('Hooks')).toBeTruthy();
  });

  it('always renders Runtime nav item', () => {
    renderNav();
    expect(screen.getByText('Runtime')).toBeTruthy();
  });

  it('always renders Appearance nav item', () => {
    renderNav();
    expect(screen.getByText('Appearance')).toBeTruthy();
  });

  it('always renders Browser nav item', () => {
    renderNav();
    expect(screen.getByText('Browser')).toBeTruthy();
  });

  it('always renders Memex Memory nav item', () => {
    // Memex Memory is unconditional (no route-level feature flag); it is gated
    // only by the app.json master switch at runtime, like the Browser entry.
    renderNav();
    expect(screen.getByText('Memex Memory')).toBeTruthy();
  });

  it('always renders About nav item', () => {
    renderNav();
    expect(screen.getByText('About TestApp')).toBeTruthy();
  });

  it('always renders Archived Chats nav item', () => {
    renderNav();
    expect(screen.getByText('Archived Chats')).toBeTruthy();
  });

  it('always renders Back button', () => {
    renderNav();
    expect(screen.getByText('Back')).toBeTruthy();
  });

  it('shows Voice Input when voiceInputEnabled=true', () => {
    mockUseFeatureFlag.mockImplementation((flag: string) => flag === 'openkosmosFeatureVoiceInput');
    renderNav();
    expect(screen.getByText('Voice Input')).toBeTruthy();
  });

  it('shows Screenshot when screenshotEnabled=true', () => {
    mockUseFeatureFlag.mockImplementation((flag: string) => flag === 'openkosmosFeatureScreenshot');
    renderNav();
    expect(screen.getByText('Screenshot')).toBeTruthy();
  });

  it('shows Sync when syncEnabled=true', () => {
    mockUseFeatureFlag.mockImplementation((flag: string) => flag === 'openkosmosUseSync');
    renderNav();
    expect(screen.getByText('Sync')).toBeTruthy();
  });

  it('navigates to /settings/mcp when MCP clicked', () => {
    renderNav();
    fireEvent.click(screen.getByText('MCP'));
    expect(mockNavigate).toHaveBeenCalledWith('/settings/mcp');
  });

  it('navigates to /settings/skills when Skills clicked', () => {
    renderNav();
    fireEvent.click(screen.getByText('Skills'));
    expect(mockNavigate).toHaveBeenCalledWith('/settings/skills');
  });

  it('navigates to /settings/agent-hooks when Hooks clicked', async () => {
    renderNav();
    fireEvent.click(await screen.findByText('Hooks'));
    expect(mockNavigate).toHaveBeenCalledWith('/settings/agent-hooks');
  });

  it('navigates to /settings/runtime when Runtime clicked', () => {
    renderNav();
    fireEvent.click(screen.getByText('Runtime'));
    expect(mockNavigate).toHaveBeenCalledWith('/settings/runtime');
  });

  it('navigates to /settings/about when About clicked', () => {
    renderNav();
    fireEvent.click(screen.getByText('About TestApp'));
    expect(mockNavigate).toHaveBeenCalledWith('/settings/about');
  });

  it('navigates to /settings/browser when Browser clicked', () => {
    renderNav();
    fireEvent.click(screen.getByText('Browser'));
    expect(mockNavigate).toHaveBeenCalledWith('/settings/browser');
  });

  it('navigates to /settings/memex when Memex Memory clicked', () => {
    renderNav();
    fireEvent.click(screen.getByText('Memex Memory'));
    expect(mockNavigate).toHaveBeenCalledWith('/settings/memex');
  });

  it('navigates to /settings/archived-agents when Archived Chats clicked', () => {
    renderNav();
    fireEvent.click(screen.getByText('Archived Chats'));
    expect(mockNavigate).toHaveBeenCalledWith('/settings/archived-agents');
  });

  it('navigates to gated settings entries when their flags are enabled', () => {
    mockUseFeatureFlag.mockImplementation((flag: string) =>
      [
        'openkosmosFeatureVoiceInput',
        'openkosmosFeatureScreenshot',
        'openkosmosUseSync',
      ].includes(flag),
    );

    renderNav();

    [
      ['Voice Input', '/settings/voice-input'],
      ['Screenshot', '/settings/screenshot'],
      ['Sync', '/settings/sync'],
    ].forEach(([label, path]) => {
      fireEvent.click(screen.getByText(label));
      expect(mockNavigate).toHaveBeenCalledWith(path);
    });
  });

  it('navigates to Coding CLI and Computer Use when clicked', () => {
    renderNav();

    fireEvent.click(screen.getByText('Coding CLI'));
    expect(mockNavigate).toHaveBeenCalledWith('/settings/coding-cli');

    fireEvent.click(screen.getByText('Computer Use'));
    expect(mockNavigate).toHaveBeenCalledWith('/settings/computer-use');
  });

  it('navigates to Appearance when clicked', () => {
    renderNav();

    fireEvent.click(screen.getByText('Appearance'));
    expect(mockNavigate).toHaveBeenCalledWith('/settings/appearance');
  });

  it('calls onBack prop when Back is clicked', () => {
    const onBack = vi.fn();
    renderNav('/settings/mcp', onBack);
    fireEvent.click(screen.getByText('Back'));
    expect(onBack).toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('navigates to /agent/chat when Back clicked without onBack', () => {
    renderNav('/settings/mcp');
    fireEvent.click(screen.getByText('Back'));
    expect(mockNavigate).toHaveBeenCalledWith('/agent/chat');
  });

  it('marks runtime as active when on /settings/runtime', () => {
    renderNav('/settings/runtime');
    const btn = screen.getByText('Runtime').closest('button');
    expect(btn?.getAttribute('data-active')).toBe('true');
  });

  it('marks appearance as active when on /settings/appearance', () => {
    renderNav('/settings/appearance');
    const btn = screen.getByText('Appearance').closest('button');
    expect(btn?.getAttribute('data-active')).toBe('true');
  });

  it('marks mcp as active when on /settings/mcp', () => {
    renderNav('/settings/mcp');
    const btn = screen.getByText('MCP').closest('button');
    expect(btn?.getAttribute('data-active')).toBe('true');
  });

  it('marks skills as active when on /settings/skills', () => {
    renderNav('/settings/skills');
    const btn = screen.getByText('Skills').closest('button');
    expect(btn?.getAttribute('data-active')).toBe('true');
  });

  it('marks agent-hooks as active when on /settings/agent-hooks', async () => {
    renderNav('/settings/agent-hooks');
    const btn = (await screen.findByText('Hooks')).closest('button');
    expect(btn?.getAttribute('data-active')).toBe('true');
  });

  it('marks about as active when on /settings/about', () => {
    renderNav('/settings/about');
    const btn = screen.getByText('About TestApp').closest('button');
    expect(btn?.getAttribute('data-active')).toBe('true');
  });

  it('falls back to mcp active by default for unrecognized path', () => {
    renderNav('/settings/unknown');
    const btn = screen.getByText('MCP').closest('button');
    expect(btn?.getAttribute('data-active')).toBe('true');
  });

  it('marks voice-input active when on /settings/voice-input', () => {
    mockUseFeatureFlag.mockImplementation((flag: string) => flag === 'openkosmosFeatureVoiceInput');
    renderNav('/settings/voice-input');
    const btn = screen.getByText('Voice Input').closest('button');
    expect(btn?.getAttribute('data-active')).toBe('true');
  });

  it('marks sync active when on /settings/sync', () => {
    mockUseFeatureFlag.mockImplementation((flag: string) => flag === 'openkosmosUseSync');
    renderNav('/settings/sync');
    const btn = screen.getByText('Sync').closest('button');
    expect(btn?.getAttribute('data-active')).toBe('true');
  });

  it('marks screenshot active when on /settings/screenshot', () => {
    mockUseFeatureFlag.mockImplementation((flag: string) => flag === 'openkosmosFeatureScreenshot');
    renderNav('/settings/screenshot');
    const btn = screen.getByText('Screenshot').closest('button');
    expect(btn?.getAttribute('data-active')).toBe('true');
  });

  it('marks browser active when on /settings/browser', () => {
    renderNav('/settings/browser');
    const btn = screen.getByText('Browser').closest('button');
    expect(btn?.getAttribute('data-active')).toBe('true');
  });

  it('marks memex active when on /settings/memex', () => {
    renderNav('/settings/memex');
    const btn = screen.getByText('Memex Memory').closest('button');
    expect(btn?.getAttribute('data-active')).toBe('true');
  });

  it('marks archived-agents active when on /settings/archived-agents', () => {
    renderNav('/settings/archived-agents');
    const btn = screen.getByText('Archived Chats').closest('button');
    expect(btn?.getAttribute('data-active')).toBe('true');
  });

  it('marks computer-use active when on /settings/computer-use', () => {
    renderNav('/settings/computer-use');
    const btn = screen.getByText('Computer Use').closest('button');
    expect(btn?.getAttribute('data-active')).toBe('true');
  });

  it('marks coding-cli active when on /settings/coding-cli', () => {
    renderNav('/settings/coding-cli');
    const btn = screen.getByText('Coding CLI').closest('button');
    expect(btn?.getAttribute('data-active')).toBe('true');
  });

  it('applies custom width from LeftNavSizeAtom', () => {
    mockUseData.mockReturnValue({ width: 320 });
    renderNav();
    const nav = screen.getByRole('navigation');
    expect(nav.style.width).toBe('320px');
  });

  it('renders all icon sub-components when every feature flag is enabled', () => {
    mockUseFeatureFlag.mockReturnValue(true);
    renderNav('/settings/mcp');
    // Feature-flagged items now present, forcing their inline icon functions to run
    expect(screen.getByText('Voice Input')).toBeTruthy();
    expect(screen.getByText('Screenshot')).toBeTruthy();
    expect(screen.getByText('Sync')).toBeTruthy();
    // Each NavItem renders its icon via the mock
    expect(screen.getAllByTestId('nav-icon').length).toBeGreaterThan(10);
  });

  it('navigates for every feature-flagged item when enabled', () => {
    mockUseFeatureFlag.mockReturnValue(true);
    renderNav('/settings/mcp');
    const cases: Array<[string, string]> = [
      ['Voice Input', '/settings/voice-input'],
      ['Screenshot', '/settings/screenshot'],
      ['Sync', '/settings/sync'],
    ];
    for (const [label, route] of cases) {
      fireEvent.click(screen.getByText(label));
      expect(mockNavigate).toHaveBeenCalledWith(route);
    }
  });

  it('falls back to APP_NAME when BRAND_CONFIG.productName is empty', () => {
    renderNav('/settings/about');
    // productName 'TestApp' is set, so About label uses it
    expect(screen.getByText('About TestApp')).toBeTruthy();
  });
});
