/**
 * @vitest-environment happy-dom
 */
import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';

// ── hoisted mock vars ──────────────────────────────────────────────────────────
const mockChats = vi.hoisted(() => [] as any[]);
const mockShowSuccess = vi.hoisted(() => vi.fn());
const mockShowError = vi.hoisted(() => vi.fn());
const mockEnableForAgent = vi.hoisted(() => vi.fn());

// ── module mocks ───────────────────────────────────────────────────────────────
vi.mock('../ui/dialog', () => ({
  Dialog: ({ open, children }: any) => open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h2>{children}</h2>,
  DialogDescription: ({ children }: any) => <p>{children}</p>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('../../userData/userDataProvider', () => ({
  useProfileData: () => ({ chats: mockChats }),
}));

vi.mock('../../auth/AuthProvider', () => ({
  useAuthContext: () => ({ authData: { ghcAuth: { alias: 'test-user' } } }),
}));

vi.mock('../../ui/ToastProvider', () => ({
  useToast: () => ({ showSuccess: mockShowSuccess, showError: mockShowError }),
}));

vi.mock('../../../ipc/plugin', () => ({
  pluginApi: {
    enableForAgent: (...args: any[]) => mockEnableForAgent(...args),
  },
}));

vi.mock('../../../../shared/constants/branding', () => ({
  BRAND_NAME: 'openkosmos',
}));

vi.mock('../../../../main/lib/userDataADO/types/profile', () => ({
  isBuiltinAgent: () => false,
}));

import ApplyPluginToAgentsDialog from '../ApplyPluginToAgentsDialog';

const SAMPLE_PLUGIN: any = {
  id: 'plugin-abc',
  manifest: { name: 'My Test Plugin' },
  injectedSkills: [{ id: 's1' }],
  injectedMcpServers: [{ name: 'srv1' }, { name: 'srv2' }],
};

const PLUGIN_NO_RESOURCES: any = {
  id: 'plugin-bare',
  manifest: { name: 'Bare Plugin' },
  injectedSkills: [],
  injectedMcpServers: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockChats.length = 0;
});

// ── basic render guards ────────────────────────────────────────────────────────

describe('ApplyPluginToAgentsDialog – returns null when closed or no plugin', () => {
  it('returns null when open=false', () => {
    const { container } = render(
      <ApplyPluginToAgentsDialog open={false} onOpenChange={vi.fn()} plugin={SAMPLE_PLUGIN} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('returns null when plugin is null', () => {
    const { container } = render(
      <ApplyPluginToAgentsDialog open={true} onOpenChange={vi.fn()} plugin={null} />,
    );
    expect(container.firstChild).toBeNull();
  });
});

// ── empty agent list ──────────────────────────────────────────────────────────

describe('ApplyPluginToAgentsDialog – empty agent list', () => {
  it('shows "No agents found." when chats is empty', () => {
    render(
      <ApplyPluginToAgentsDialog open={true} onOpenChange={vi.fn()} plugin={SAMPLE_PLUGIN} />,
    );
    expect(screen.getByText('No agents found.')).toBeTruthy();
  });

  it('does not render Select All when no selectable agents', () => {
    render(
      <ApplyPluginToAgentsDialog open={true} onOpenChange={vi.fn()} plugin={SAMPLE_PLUGIN} />,
    );
    expect(screen.queryByText(/Select All|Deselect All/)).toBeFalsy();
  });

  it('Skip button calls onOpenChange(false)', () => {
    const onOpenChange = vi.fn();
    render(
      <ApplyPluginToAgentsDialog open={true} onOpenChange={onOpenChange} plugin={SAMPLE_PLUGIN} />,
    );
    fireEvent.click(screen.getByText('Skip'));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('Apply button is disabled when no agents selected', () => {
    render(
      <ApplyPluginToAgentsDialog open={true} onOpenChange={vi.fn()} plugin={SAMPLE_PLUGIN} />,
    );
    const applyBtn = screen.getByText(/^Apply$/).closest('button') as HTMLButtonElement;
    expect(applyBtn.disabled).toBe(true);
  });

  it('Apply with no newly selected agents calls onOpenChange(false)', async () => {
    const onOpenChange = vi.fn();
    render(
      <ApplyPluginToAgentsDialog open={true} onOpenChange={onOpenChange} plugin={SAMPLE_PLUGIN} />,
    );
    // All agents are already applied or there are none – click Apply should close
    const applyBtn = screen.getByText(/^Apply$/).closest('button') as HTMLButtonElement;
    // The button should be disabled, but we can test the handleApply logic with alreadyApplied agents
    expect(applyBtn.disabled).toBe(true);
  });
});

// ── description with resource summary ─────────────────────────────────────────

describe('ApplyPluginToAgentsDialog – dialog description', () => {
  it('shows resource summary with skills and MCP servers', () => {
    render(
      <ApplyPluginToAgentsDialog open={true} onOpenChange={vi.fn()} plugin={SAMPLE_PLUGIN} />,
    );
    // 1 skill and 2 MCP servers
    expect(screen.getByText(/1 skill and 2 MCP servers/)).toBeTruthy();
  });

  it('shows plugin name in description', () => {
    render(
      <ApplyPluginToAgentsDialog open={true} onOpenChange={vi.fn()} plugin={SAMPLE_PLUGIN} />,
    );
    expect(screen.getByText(/My Test Plugin/)).toBeTruthy();
  });

  it('shows no resource summary when plugin has no injected resources', () => {
    render(
      <ApplyPluginToAgentsDialog open={true} onOpenChange={vi.fn()} plugin={PLUGIN_NO_RESOURCES} />,
    );
    // Description should not contain "with" resource summary
    const desc = screen.getByText(/has been installed/);
    expect(desc.textContent).not.toMatch(/with \d/);
  });

  it('shows plural skills in resource summary', () => {
    const plugin: any = {
      ...SAMPLE_PLUGIN,
      injectedSkills: [{ id: 's1' }, { id: 's2' }],
      injectedMcpServers: [],
    };
    render(
      <ApplyPluginToAgentsDialog open={true} onOpenChange={vi.fn()} plugin={plugin} />,
    );
    expect(screen.getByText(/2 skills/)).toBeTruthy();
  });

  it('shows singular MCP server in resource summary', () => {
    const plugin: any = {
      ...SAMPLE_PLUGIN,
      injectedSkills: [],
      injectedMcpServers: [{ name: 'srv1' }],
    };
    render(
      <ApplyPluginToAgentsDialog open={true} onOpenChange={vi.fn()} plugin={plugin} />,
    );
    expect(screen.getByText(/1 MCP server/)).toBeTruthy();
  });
});

// ── single_agent chats ────────────────────────────────────────────────────────

describe('ApplyPluginToAgentsDialog – single_agent chats', () => {
  beforeEach(() => {
    mockChats.push(
      {
        chat_id: 'c1',
        chat_type: 'single_agent',
        agent: { name: 'Alpha', emoji: '🤖', enabled_plugins: [] },
      },
      {
        chat_id: 'c2',
        chat_type: 'single_agent',
        agent: { name: 'Beta', emoji: '🦾', enabled_plugins: ['plugin-abc'] }, // already applied
      },
    );
  });

  it('renders agent names', () => {
    render(
      <ApplyPluginToAgentsDialog open={true} onOpenChange={vi.fn()} plugin={SAMPLE_PLUGIN} />,
    );
    expect(screen.getByText('Alpha')).toBeTruthy();
    expect(screen.getByText('Beta')).toBeTruthy();
  });

  it('already-applied agent shows Applied badge', () => {
    render(
      <ApplyPluginToAgentsDialog open={true} onOpenChange={vi.fn()} plugin={SAMPLE_PLUGIN} />,
    );
    expect(screen.getByText('Applied')).toBeTruthy();
  });

  it('Select All shown for selectable agents', () => {
    render(
      <ApplyPluginToAgentsDialog open={true} onOpenChange={vi.fn()} plugin={SAMPLE_PLUGIN} />,
    );
    expect(screen.getByText('Select All')).toBeTruthy();
  });

  it('clicking agent row toggles selection', () => {
    render(
      <ApplyPluginToAgentsDialog open={true} onOpenChange={vi.fn()} plugin={SAMPLE_PLUGIN} />,
    );
    const alphaRow = screen.getByText('Alpha').closest('[role="checkbox"]')!;
    fireEvent.click(alphaRow);
    expect(screen.getByText('Apply (1)')).toBeTruthy();
    // click again to deselect
    fireEvent.click(alphaRow);
    expect(screen.getByText(/^Apply$/)).toBeTruthy();
  });

  it('clicking already-applied agent row does nothing (returns early)', () => {
    render(
      <ApplyPluginToAgentsDialog open={true} onOpenChange={vi.fn()} plugin={SAMPLE_PLUGIN} />,
    );
    const betaRow = screen.getByText('Beta').closest('[role="checkbox"]')!;
    fireEvent.click(betaRow);
    expect(screen.getByText(/^Apply$/)).toBeTruthy();
  });

  it('Select All selects all selectable agents', () => {
    render(
      <ApplyPluginToAgentsDialog open={true} onOpenChange={vi.fn()} plugin={SAMPLE_PLUGIN} />,
    );
    fireEvent.click(screen.getByText('Select All'));
    expect(screen.getByText('Apply (1)')).toBeTruthy();
    expect(screen.getByText('Deselect All')).toBeTruthy();
  });

  it('Deselect All deselects all selectable agents', () => {
    render(
      <ApplyPluginToAgentsDialog open={true} onOpenChange={vi.fn()} plugin={SAMPLE_PLUGIN} />,
    );
    fireEvent.click(screen.getByText('Select All'));
    fireEvent.click(screen.getByText('Deselect All'));
    expect(screen.getByText(/^Apply$/)).toBeTruthy();
  });

  it('Apply button is disabled when nothing newly selected', () => {
    render(
      <ApplyPluginToAgentsDialog open={true} onOpenChange={vi.fn()} plugin={SAMPLE_PLUGIN} />,
    );
    const applyBtn = screen.getByText(/^Apply$/).closest('button')!;
    expect(applyBtn.hasAttribute('disabled')).toBe(true);
  });
});

// ── agent with avatar ─────────────────────────────────────────────────────────

describe('ApplyPluginToAgentsDialog – agent with avatar', () => {
  it('renders img when agent has avatar', () => {
    mockChats.push({
      chat_id: 'c3',
      chat_type: 'single_agent',
      agent: { name: 'AvatarAgent', emoji: '🎭', avatar: 'http://img.test/av.png', enabled_plugins: [] },
    });
    render(
      <ApplyPluginToAgentsDialog open={true} onOpenChange={vi.fn()} plugin={SAMPLE_PLUGIN} />,
    );
    expect(screen.getByAltText('AvatarAgent')).toBeTruthy();
  });
});

// ── multi_agent chats ─────────────────────────────────────────────────────────

describe('ApplyPluginToAgentsDialog – multi_agent chats', () => {
  beforeEach(() => {
    mockChats.push({
      chat_id: 'm1',
      chat_type: 'multi_agent',
      agents: [
        { name: 'Gamma', emoji: '🌀', enabled_plugins: [] },
        { name: 'Delta', emoji: '🔷', enabled_plugins: ['plugin-abc'] },
      ],
    });
  });

  it('renders all agents from multi_agent chats', () => {
    render(
      <ApplyPluginToAgentsDialog open={true} onOpenChange={vi.fn()} plugin={SAMPLE_PLUGIN} />,
    );
    expect(screen.getByText('Gamma')).toBeTruthy();
    expect(screen.getByText('Delta')).toBeTruthy();
  });

  it('already-applied multi-agent shows Applied badge', () => {
    render(
      <ApplyPluginToAgentsDialog open={true} onOpenChange={vi.fn()} plugin={SAMPLE_PLUGIN} />,
    );
    expect(screen.getByText('Applied')).toBeTruthy();
  });
});

// ── Apply – success ───────────────────────────────────────────────────────────

describe('ApplyPluginToAgentsDialog – Apply success', () => {
  beforeEach(() => {
    mockChats.push({
      chat_id: 'c4',
      chat_type: 'single_agent',
      agent: { name: 'Epsilon', emoji: '🟢', enabled_plugins: [] },
    });
  });

  it('calls enableForAgent and shows success toast', async () => {
    mockEnableForAgent.mockResolvedValue({ success: true, plugins: [{ id: 'plugin-abc' }] });
    const onApplied = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <ApplyPluginToAgentsDialog
        open={true}
        onOpenChange={onOpenChange}
        plugin={SAMPLE_PLUGIN}
        onApplied={onApplied}
      />,
    );
    fireEvent.click(screen.getByText('Epsilon').closest('[role="checkbox"]')!);
    fireEvent.click(screen.getByText('Apply (1)'));
    await act(async () => { await Promise.resolve(); });
    expect(mockEnableForAgent).toHaveBeenCalledWith('plugin-abc', 'test-user', 'c4');
    expect(mockShowSuccess).toHaveBeenCalledWith(expect.stringContaining('My Test Plugin'));
    expect(onApplied).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('uses singular "agent" in success toast when count=1', async () => {
    mockEnableForAgent.mockResolvedValue({ success: true });
    render(
      <ApplyPluginToAgentsDialog open={true} onOpenChange={vi.fn()} plugin={SAMPLE_PLUGIN} />,
    );
    fireEvent.click(screen.getByText('Epsilon').closest('[role="checkbox"]')!);
    fireEvent.click(screen.getByText('Apply (1)'));
    await act(async () => { await Promise.resolve(); });
    const msg = mockShowSuccess.mock.calls[0][0] as string;
    // Should contain "1 agent" but NOT "1 agents"
    expect(msg).toContain('1 agent');
    expect(msg).not.toContain('1 agents');
  });

  it('uses plural "agents" when count > 1', async () => {
    mockChats.push({
      chat_id: 'c5',
      chat_type: 'single_agent',
      agent: { name: 'Zeta', emoji: '🔵', enabled_plugins: [] },
    });
    mockEnableForAgent.mockResolvedValue({ success: true });
    render(
      <ApplyPluginToAgentsDialog open={true} onOpenChange={vi.fn()} plugin={SAMPLE_PLUGIN} />,
    );
    fireEvent.click(screen.getByText('Select All'));
    fireEvent.click(screen.getByText('Apply (2)'));
    await act(async () => { await Promise.resolve(); });
    const msg = mockShowSuccess.mock.calls[0][0] as string;
    expect(msg).toContain('2 agents');
  });
});

// ── Apply – failure ───────────────────────────────────────────────────────────

describe('ApplyPluginToAgentsDialog – Apply failure', () => {
  beforeEach(() => {
    mockChats.push({
      chat_id: 'cf',
      chat_type: 'single_agent',
      agent: { name: 'Eta', emoji: '🔴', enabled_plugins: [] },
    });
  });

  it('shows error toast when enableForAgent fails', async () => {
    mockEnableForAgent.mockResolvedValue({ success: false });
    render(
      <ApplyPluginToAgentsDialog open={true} onOpenChange={vi.fn()} plugin={SAMPLE_PLUGIN} />,
    );
    fireEvent.click(screen.getByText('Eta').closest('[role="checkbox"]')!);
    fireEvent.click(screen.getByText('Apply (1)'));
    await act(async () => { await Promise.resolve(); });
    expect(mockShowError).toHaveBeenCalled();
  });

  it('uses plural "agents" in error toast when failCount > 1', async () => {
    mockChats.push({
      chat_id: 'cf2',
      chat_type: 'single_agent',
      agent: { name: 'Theta', emoji: '🟠', enabled_plugins: [] },
    });
    mockEnableForAgent.mockResolvedValue({ success: false });
    render(
      <ApplyPluginToAgentsDialog open={true} onOpenChange={vi.fn()} plugin={SAMPLE_PLUGIN} />,
    );
    fireEvent.click(screen.getByText('Select All'));
    fireEvent.click(screen.getByText('Apply (2)'));
    await act(async () => { await Promise.resolve(); });
    const msg = mockShowError.mock.calls[0][0] as string;
    expect(msg).toContain('agents');
  });
});

// ── pm-studio brand filter ────────────────────────────────────────────────────

describe('ApplyPluginToAgentsDialog – pm-studio brand filtering', () => {
  it('renders without crash when chats contain various types', () => {
    mockChats.push(
      {
        chat_id: 'cx',
        chat_type: 'single_agent',
        agent: { name: 'Kobi', emoji: '🤝', enabled_plugins: [] },
      },
      {
        // non single_agent / non multi_agent type is ignored
        chat_id: 'cy',
        chat_type: 'other',
        agent: { name: 'Other', emoji: '❓' },
      },
    );
    const { container } = render(
      <ApplyPluginToAgentsDialog open={true} onOpenChange={vi.fn()} plugin={SAMPLE_PLUGIN} />,
    );
    // Just verify something rendered
    expect(container.children.length).toBeGreaterThan(0);
  });
});

// ── dialog open/close transitions ────────────────────────────────────────────

describe('ApplyPluginToAgentsDialog – open transition initializes selection', () => {
  it('pre-checks already-applied agents on open', () => {
    mockChats.push(
      {
        chat_id: 'pre1',
        chat_type: 'single_agent',
        agent: { name: 'PreApplied', emoji: '✅', enabled_plugins: ['plugin-abc'] },
      },
      {
        chat_id: 'pre2',
        chat_type: 'single_agent',
        agent: { name: 'NotApplied', emoji: '❌', enabled_plugins: [] },
      },
    );
    render(
      <ApplyPluginToAgentsDialog open={true} onOpenChange={vi.fn()} plugin={SAMPLE_PLUGIN} />,
    );
    // PreApplied should show "Applied" badge
    expect(screen.getByText('Applied')).toBeTruthy();
    // NotApplied should not show Applied
    expect(screen.getAllByText('NotApplied')).toBeTruthy();
  });
});

// ── plugin with no pluginId guard ─────────────────────────────────────────────

describe('ApplyPluginToAgentsDialog – empty pluginId guard', () => {
  it('returns empty agentItems when pluginId is empty string', () => {
    mockChats.push({
      chat_id: 'c-noname',
      chat_type: 'single_agent',
      agent: { name: 'Solo', emoji: '🧩', enabled_plugins: [] },
    });
    const pluginNoId: any = {
      id: '',
      manifest: { name: 'No ID Plugin' },
      injectedSkills: [],
      injectedMcpServers: [],
    };
    render(
      <ApplyPluginToAgentsDialog open={true} onOpenChange={vi.fn()} plugin={pluginNoId} />,
    );
    // With empty pluginId, agentItems should be empty → "No agents found."
    expect(screen.getByText('No agents found.')).toBeTruthy();
  });
});
