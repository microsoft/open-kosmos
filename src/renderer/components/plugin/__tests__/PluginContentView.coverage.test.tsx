/**
 * @vitest-environment happy-dom
 *
 * Coverage tests for PluginContentView.tsx
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── hoisted mocks ─────────────────────────────────────────────────────────────
const mockShowSuccess = vi.hoisted(() => vi.fn());
const mockShowError = vi.hoisted(() => vi.fn());

// ── CSS / style mocks ─────────────────────────────────────────────────────────
vi.mock('../../../styles/PluginContentView.css', () => ({}));

// ── UI component mocks ────────────────────────────────────────────────────────
vi.mock('../../ui/ToastProvider', () => ({
  useToast: () => ({ showSuccess: mockShowSuccess, showError: mockShowError }),
}));

vi.mock('../../ui/ListSearchBox', () => ({
  default: ({ value, onChange, placeholder }: any) => (
    <input
      data-testid="search-box"
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

vi.mock('../../ui/dialog', () => ({
  Dialog: ({ open, onOpenChange, children }: any) =>
    open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <div data-testid="dialog-title">{children}</div>,
  DialogDescription: ({ children }: any) => <div data-testid="dialog-description">{children}</div>,
  DialogFooter: ({ children }: any) => <div data-testid="dialog-footer">{children}</div>,
}));

vi.mock('lucide-react', () => ({
  ChevronDown: () => <span data-testid="chevron-down" />,
  ChevronRight: () => <span data-testid="chevron-right" />,
}));

// ── import component ──────────────────────────────────────────────────────────
import PluginContentView from '../PluginContentView';
import type { PluginInfo } from '../PluginManagementView';

// ── helpers ───────────────────────────────────────────────────────────────────
function makePlugin(overrides: Partial<PluginInfo> = {}): PluginInfo {
  return {
    id: 'plugin-1',
    enabled: true,
    path: '/plugins/plugin-1',
    injectedMcpServers: [],
    injectedSkills: [],
    manifest: {
      name: 'Test Plugin',
      version: '1.0.0',
      description: 'A test plugin',
      author: { name: 'Author' },
      skills: [],
      mcpServers: {},
      hooks: {},
      commands: [],
      agents: [],
    },
    ...overrides,
  };
}

const defaultProps = {
  plugins: [],
  selectedPlugin: null,
  isLoading: false,
  onSelectPlugin: vi.fn(),
  onUninstall: vi.fn(),
  onToggleEnabled: vi.fn(),
  onRestart: vi.fn(),
};

describe('PluginContentView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Loading state ──────────────────────────────────────────────────────────
  it('renders loading state when isLoading is true', () => {
    render(<PluginContentView {...defaultProps} isLoading />);
    expect(screen.getByText('Loading plugins...')).toBeInTheDocument();
  });

  // ── Empty state ────────────────────────────────────────────────────────────
  it('renders empty state when no plugins installed', () => {
    render(<PluginContentView {...defaultProps} />);
    expect(screen.getByText('No Plugins Installed')).toBeInTheDocument();
  });

  // ── Plugin list renders ────────────────────────────────────────────────────
  it('renders plugin list when plugins provided', () => {
    const plugin = makePlugin();
    render(<PluginContentView {...defaultProps} plugins={[plugin]} />);
    expect(screen.getByText('Test Plugin')).toBeInTheDocument();
  });

  // ── Selecting a plugin ─────────────────────────────────────────────────────
  it('calls onSelectPlugin when plugin card clicked', () => {
    const plugin = makePlugin();
    const onSelect = vi.fn();
    render(<PluginContentView {...defaultProps} plugins={[plugin]} onSelectPlugin={onSelect} />);
    const card = document.querySelector('.plugin-card-wrapper') as HTMLElement;
    fireEvent.click(card);
    expect(onSelect).toHaveBeenCalledWith(plugin);
  });

  // ── Selected plugin shows detail ───────────────────────────────────────────
  it('renders detail view when selectedPlugin provided', () => {
    const plugin = makePlugin();
    render(
      <PluginContentView
        {...defaultProps}
        plugins={[plugin]}
        selectedPlugin={plugin}
      />
    );
    // Detail panel should show the plugin name in header
    expect(screen.getAllByText('Test Plugin').length).toBeGreaterThan(0);
  });

  // ── No selection state ─────────────────────────────────────────────────────
  it('renders "Select a Plugin" prompt when no plugin selected', () => {
    const plugin = makePlugin();
    render(<PluginContentView {...defaultProps} plugins={[plugin]} selectedPlugin={null} />);
    expect(screen.getByText('Select a Plugin')).toBeInTheDocument();
  });

  // ── Search filtering ───────────────────────────────────────────────────────
  it('filters plugins by search query matching name', async () => {
    const p1 = makePlugin({ id: 'p1', manifest: { ...makePlugin().manifest, name: 'Alpha Plugin' } });
    const p2 = makePlugin({ id: 'p2', manifest: { ...makePlugin().manifest, name: 'Beta Plugin' } });
    const onSelect = vi.fn();
    render(
      <PluginContentView {...defaultProps} plugins={[p1, p2]} onSelectPlugin={onSelect} />
    );
    const searchBox = screen.getByTestId('search-box');
    fireEvent.change(searchBox, { target: { value: 'Alpha' } });
    // After filtering, onSelectPlugin should be called to auto-select
    await waitFor(() => {
      expect(screen.getByText('Alpha Plugin')).toBeInTheDocument();
    });
  });

  // ── Search: no match → onSelectPlugin(null) ────────────────────────────────
  it('calls onSelectPlugin(null) when search yields no results', async () => {
    const plugin = makePlugin();
    const onSelect = vi.fn();
    render(
      <PluginContentView {...defaultProps} plugins={[plugin]} onSelectPlugin={onSelect} />
    );
    const searchBox = screen.getByTestId('search-box');
    act(() => {
      fireEvent.change(searchBox, { target: { value: 'ZZZNOMATCH' } });
    });
    await waitFor(() => {
      expect(onSelect).toHaveBeenCalledWith(null);
    });
  });

  // ── Search: current selection not in filtered results → auto-select first ──
  it('auto-selects first filtered plugin when current is not in results', async () => {
    const p1 = makePlugin({ id: 'p1', manifest: { ...makePlugin().manifest, name: 'Alpha Plugin' } });
    const p2 = makePlugin({ id: 'p2', manifest: { ...makePlugin().manifest, name: 'Beta Plugin' } });
    const onSelect = vi.fn();
    render(
      <PluginContentView
        {...defaultProps}
        plugins={[p1, p2]}
        selectedPlugin={p2}
        onSelectPlugin={onSelect}
      />
    );
    const searchBox = screen.getByTestId('search-box');
    act(() => {
      fireEvent.change(searchBox, { target: { value: 'Alpha' } });
    });
    await waitFor(() => {
      expect(onSelect).toHaveBeenCalledWith(p1);
    });
  });

  // ── Plugin version badge ───────────────────────────────────────────────────
  it('renders version badge when plugin has version', () => {
    const plugin = makePlugin();
    render(<PluginContentView {...defaultProps} plugins={[plugin]} />);
    expect(screen.getByText('v1.0.0')).toBeInTheDocument();
  });

  // ── Disabled plugin status ─────────────────────────────────────────────────
  it('renders disabled status for disabled plugin', () => {
    const plugin = makePlugin({ enabled: false });
    render(<PluginContentView {...defaultProps} plugins={[plugin]} />);
    expect(screen.getByText('disabled')).toBeInTheDocument();
  });

  // ── Extensions badge ───────────────────────────────────────────────────────
  it('renders extensions badge for plugin with extensions', () => {
    const plugin = makePlugin({
      manifest: {
        ...makePlugin().manifest,
        commands: [{ name: 'cmd', description: 'do something', promptBody: '', sourcePath: '' }],
      },
    });
    render(<PluginContentView {...defaultProps} plugins={[plugin]} />);
    expect(screen.getByText('1 extension')).toBeInTheDocument();
  });

  // ── Detail view: restart button ────────────────────────────────────────────
  it('calls onRestart when Restart button clicked', () => {
    const plugin = makePlugin();
    const onRestart = vi.fn();
    render(
      <PluginContentView
        {...defaultProps}
        plugins={[plugin]}
        selectedPlugin={plugin}
        onRestart={onRestart}
      />
    );
    fireEvent.click(screen.getByText('Restart'));
    expect(onRestart).toHaveBeenCalledWith('plugin-1');
  });

  // ── Detail view: uninstall dialog open ────────────────────────────────────
  it('opens uninstall dialog when Uninstall button clicked', () => {
    const plugin = makePlugin();
    render(
      <PluginContentView {...defaultProps} plugins={[plugin]} selectedPlugin={plugin} />
    );
    fireEvent.click(screen.getByText('Uninstall'));
    expect(screen.getByTestId('dialog')).toBeInTheDocument();
    expect(screen.getByTestId('dialog-title')).toHaveTextContent('Uninstall Plugin');
  });

  // ── Detail view: cancel uninstall ────────────────────────────────────────
  it('closes uninstall dialog when Cancel clicked', () => {
    const plugin = makePlugin();
    render(
      <PluginContentView {...defaultProps} plugins={[plugin]} selectedPlugin={plugin} />
    );
    fireEvent.click(screen.getByText('Uninstall'));
    expect(screen.getByTestId('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.queryByTestId('dialog')).not.toBeInTheDocument();
  });

  // ── Detail view: confirm uninstall ───────────────────────────────────────
  it('calls onUninstall and closes dialog on confirm', () => {
    const plugin = makePlugin();
    const onUninstall = vi.fn();
    render(
      <PluginContentView
        {...defaultProps}
        plugins={[plugin]}
        selectedPlugin={plugin}
        onUninstall={onUninstall}
      />
    );
    fireEvent.click(screen.getByText('Uninstall'));
    // There are two Uninstall texts now: the button and the dialog confirm button
    const confirmBtns = screen.getAllByText('Uninstall');
    // The last one in the dialog footer is the confirm button
    fireEvent.click(confirmBtns[confirmBtns.length - 1]);
    expect(onUninstall).toHaveBeenCalledWith('plugin-1');
    expect(screen.queryByTestId('dialog')).not.toBeInTheDocument();
  });

  // ── Detail: description section ──────────────────────────────────────────
  it('renders description section when plugin has description', () => {
    const plugin = makePlugin();
    render(
      <PluginContentView {...defaultProps} plugins={[plugin]} selectedPlugin={plugin} />
    );
    expect(screen.getByText('A test plugin')).toBeInTheDocument();
  });

  // ── Detail: skills section ───────────────────────────────────────────────
  it('renders skills section when plugin has skills', () => {
    const plugin = makePlugin({
      injectedSkills: ['MySkill'],
      manifest: { ...makePlugin().manifest, skills: ['skills/myskill.js'] },
    });
    render(
      <PluginContentView {...defaultProps} plugins={[plugin]} selectedPlugin={plugin} />
    );
    expect(screen.getByText('Skills')).toBeInTheDocument();
    expect(screen.getByText('MySkill')).toBeInTheDocument();
  });

  // ── Detail: string skill (single) ───────────────────────────────────────
  it('renders single skill when skills is a string', () => {
    const plugin = makePlugin({
      injectedSkills: [],
      manifest: { ...makePlugin().manifest, skills: 'skills/myskill.js' as any },
    });
    render(
      <PluginContentView {...defaultProps} plugins={[plugin]} selectedPlugin={plugin} />
    );
    expect(screen.getByText('Skills')).toBeInTheDocument();
  });

  // ── Detail: commands section ─────────────────────────────────────────────
  it('renders commands section when plugin has commands', () => {
    const plugin = makePlugin({
      manifest: {
        ...makePlugin().manifest,
        commands: [{ name: 'cmd', description: 'A command', promptBody: '', sourcePath: '' }],
      },
    });
    render(
      <PluginContentView {...defaultProps} plugins={[plugin]} selectedPlugin={plugin} />
    );
    expect(screen.getByText('Commands')).toBeInTheDocument();
    expect(screen.getByText('/cmd')).toBeInTheDocument();
    expect(screen.getByText('A command')).toBeInTheDocument();
  });

  // ── Detail: agents section ───────────────────────────────────────────────
  it('renders agents section when plugin has agents', () => {
    const plugin = makePlugin({
      manifest: {
        ...makePlugin().manifest,
        agents: [{
          name: 'MyAgent',
          description: 'An agent',
          model: 'gpt-4',
          systemPrompt: 'You are helpful',
          sourcePath: ''
        }],
      },
    });
    render(
      <PluginContentView {...defaultProps} plugins={[plugin]} selectedPlugin={plugin} />
    );
    expect(screen.getByText('Agents')).toBeInTheDocument();
    expect(screen.getByText('MyAgent')).toBeInTheDocument();
    expect(screen.getByText('model: gpt-4')).toBeInTheDocument();
  });

  // ── Detail: agent description truncation ─────────────────────────────────
  it('truncates long agent description to 80 chars', () => {
    const longDesc = 'A'.repeat(90);
    const plugin = makePlugin({
      manifest: {
        ...makePlugin().manifest,
        agents: [{
          name: 'MyAgent',
          description: longDesc,
          systemPrompt: '',
          sourcePath: ''
        }],
      },
    });
    render(
      <PluginContentView {...defaultProps} plugins={[plugin]} selectedPlugin={plugin} />
    );
    expect(screen.getByText('A'.repeat(80) + '...')).toBeInTheDocument();
  });

  // ── Detail: MCP servers section ──────────────────────────────────────────
  it('renders MCP Servers section when plugin has mcpServers', () => {
    const plugin = makePlugin({
      manifest: {
        ...makePlugin().manifest,
        mcpServers: {
          myServer: { command: 'node', args: ['server.js'] },
        },
      },
    });
    render(
      <PluginContentView {...defaultProps} plugins={[plugin]} selectedPlugin={plugin} />
    );
    expect(screen.getByText('MCP Servers')).toBeInTheDocument();
    expect(screen.getByText('myServer')).toBeInTheDocument();
  });

  // ── Detail: hooks section ─────────────────────────────────────────────────
  it('renders Hooks section when plugin has hooks', () => {
    const plugin = makePlugin({
      manifest: {
        ...makePlugin().manifest,
        hooks: { onStart: ['echo hello'] },
      },
    });
    render(
      <PluginContentView {...defaultProps} plugins={[plugin]} selectedPlugin={plugin} />
    );
    // Hooks CollapsibleSection is shown (even though defaultOpen=false, the header is always rendered)
    expect(screen.getByText('Hooks')).toBeInTheDocument();
    // The badge shows count
    expect(screen.getByText('1 event(s)')).toBeInTheDocument();
    // The section is collapsed by default; open it to see content
    const allHeaders = document.querySelectorAll('.section-header-collapsible');
    const hooksHeader = Array.from(allHeaders).find(el => el.textContent?.includes('Hooks'));
    if (hooksHeader) {
      fireEvent.click(hooksHeader);
      expect(screen.getByText('onStart')).toBeInTheDocument();
    }
  });

  // ── Detail: install location ──────────────────────────────────────────────
  it('renders install location path', () => {
    const plugin = makePlugin();
    render(
      <PluginContentView {...defaultProps} plugins={[plugin]} selectedPlugin={plugin} />
    );
    expect(screen.getByText('/plugins/plugin-1')).toBeInTheDocument();
  });

  // ── CollapsibleSection: toggle collapse ──────────────────────────────────
  it('collapses section when header clicked', () => {
    const plugin = makePlugin({
      manifest: {
        ...makePlugin().manifest,
        commands: [{ name: 'cmd', description: 'desc', promptBody: '', sourcePath: '' }],
      },
    });
    render(
      <PluginContentView {...defaultProps} plugins={[plugin]} selectedPlugin={plugin} />
    );
    // Commands section is open by default; clicking header collapses it
    const sectionHeader = document.querySelector('.section-header-collapsible') as HTMLElement;
    fireEvent.click(sectionHeader);
    // After collapse the content should be hidden
    expect(screen.queryByText('/cmd')).not.toBeInTheDocument();
  });

  // ── No restart button for disabled plugin ────────────────────────────────
  it('does not render Restart button when plugin is disabled', () => {
    const plugin = makePlugin({ enabled: false });
    render(
      <PluginContentView {...defaultProps} plugins={[plugin]} selectedPlugin={plugin} />
    );
    expect(screen.queryByText('Restart')).not.toBeInTheDocument();
  });

  // ── Uninstall dialog closes when plugin changes ───────────────────────────
  it('closes uninstall dialog when selected plugin changes', () => {
    const p1 = makePlugin({ id: 'p1', manifest: { ...makePlugin().manifest, name: 'P1' } });
    const p2 = makePlugin({ id: 'p2', manifest: { ...makePlugin().manifest, name: 'P2' } });
    const { rerender } = render(
      <PluginContentView {...defaultProps} plugins={[p1, p2]} selectedPlugin={p1} />
    );
    // Open the dialog
    fireEvent.click(screen.getAllByText('Uninstall')[0]);
    expect(screen.getByTestId('dialog')).toBeInTheDocument();
    // Switch plugin
    rerender(
      <PluginContentView {...defaultProps} plugins={[p1, p2]} selectedPlugin={p2} />
    );
    expect(screen.queryByTestId('dialog')).not.toBeInTheDocument();
  });

  // ── Skills section: skill without injectedSkill name ─────────────────────
  it('uses filename from path when injectedSkills is empty', () => {
    const plugin = makePlugin({
      injectedSkills: [],
      manifest: { ...makePlugin().manifest, skills: ['skills/myskill.js'] },
    });
    render(
      <PluginContentView {...defaultProps} plugins={[plugin]} selectedPlugin={plugin} />
    );
    expect(screen.getByText('myskill.js')).toBeInTheDocument();
  });

  // ── Multiple extensions badge ─────────────────────────────────────────────
  it('renders plural extensions badge for multiple extensions', () => {
    const plugin = makePlugin({
      manifest: {
        ...makePlugin().manifest,
        commands: [
          { name: 'cmd1', promptBody: '', sourcePath: '' },
          { name: 'cmd2', promptBody: '', sourcePath: '' },
        ],
      },
    });
    render(<PluginContentView {...defaultProps} plugins={[plugin]} />);
    expect(screen.getByText('2 extensions')).toBeInTheDocument();
  });
});
