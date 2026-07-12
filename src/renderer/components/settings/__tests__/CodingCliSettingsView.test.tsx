// @ts-nocheck
/**
 * @vitest-environment happy-dom
 */
/**
 * CodingCliSettingsView tests (integration over View + HeaderView + ContentView):
 * the master switch (default off), initial load (settings +
 * availability), error handling, selection persistence (success / failure / throw),
 * re-detect, and loading/detecting states.
 *
 * The page now leads with an "Enable Coding Agent" master switch. While it is off the
 * CLI selection card and the header re-detect button are hidden. While it is on, each
 * CLI is a `<label>` whose native `runtime-radio` drives selection.
 */

import React from 'react';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';

const mockShowSuccess = vi.fn();
const mockShowError = vi.fn();
vi.mock('../../ui/ToastProvider', () => ({
  useToast: () => ({ showSuccess: mockShowSuccess, showError: mockShowError }),
}));

vi.mock('../../../lib/utilities/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}));

const mockRefresh = vi.fn();
vi.mock('../../../lib/mcp/mcpClientCacheManager', () => ({
  mcpClientCacheManager: { refresh: () => mockRefresh() },
}));

const mockGetSettings = vi.fn();
const mockUpdateSettings = vi.fn();
const mockDetectAvailability = vi.fn();
vi.mock('../../../ipc/codingCli', () => ({
  codingCliApi: {
    getSettings: () => mockGetSettings(),
    updateSettings: (s: any) => mockUpdateSettings(s),
    detectAvailability: () => mockDetectAvailability(),
  },
}));

import CodingCliSettingsView from '../CodingCliSettingsView';

const CLIS = [
  { id: 'claude', displayName: 'Claude Code', binaryName: 'claude', installHint: 'npm i -g @anthropic-ai/claude-code', docsUrl: 'https://claude', available: true, path: '/usr/local/bin/claude' },
  { id: 'codex', displayName: 'Codex CLI', binaryName: 'codex', installHint: 'npm i -g @openai/codex', docsUrl: 'https://codex', available: false, path: null },
];

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const radio = (name: string) => screen.getByLabelText(`Select ${name}`) as HTMLInputElement;
const toggle = () => screen.getByLabelText('Enable Coding Agent') as HTMLInputElement;

describe('CodingCliSettingsView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSettings.mockResolvedValue({ success: true, data: { enabled: true, cli: 'claude' } });
    mockUpdateSettings.mockResolvedValue({ success: true });
    mockDetectAvailability.mockResolvedValue({ success: true, data: { clis: CLIS } });
  });

  it('loads settings and availability, marking the active CLI selected', async () => {
    mockGetSettings.mockResolvedValue({ success: true, data: { enabled: true, cli: 'codex' } });
    render(<CodingCliSettingsView />);

    await waitFor(() => expect(screen.getByText('Claude Code')).toBeTruthy());
    expect(screen.getByText('Codex CLI')).toBeTruthy();
    expect(screen.getByText('Not found')).toBeTruthy();
    expect(screen.getByText('/usr/local/bin/claude')).toBeTruthy();
    expect(screen.getByText('npm i -g @openai/codex')).toBeTruthy();

    expect(radio('Codex CLI').checked).toBe(true);
    expect(radio('Claude Code').checked).toBe(false);
  });

  it('reflects the enabled master switch as checked', async () => {
    render(<CodingCliSettingsView />);
    await waitFor(() => expect(screen.getByText('Claude Code')).toBeTruthy());
    expect(toggle().checked).toBe(true);
  });

  it('renders an empty state when no CLIs are returned', async () => {
    mockDetectAvailability.mockResolvedValue({ success: true, data: { clis: [] } });
    render(<CodingCliSettingsView />);
    await waitFor(() => expect(screen.getByText('No coding CLIs available.')).toBeTruthy());
  });

  it('renders an available CLI with a null path (defensive title fallback)', async () => {
    mockDetectAvailability.mockResolvedValue({
      success: true,
      data: { clis: [{ ...CLIS[0], available: true, path: null }] },
    });
    render(<CodingCliSettingsView />);
    await waitFor(() => expect(screen.getByText('Claude Code')).toBeTruthy());
    expect(radio('Claude Code')).toBeTruthy();
  });

  it('shows an error when availability detection returns success:false', async () => {
    mockDetectAvailability.mockResolvedValue({ success: false, error: 'detect boom' });
    render(<CodingCliSettingsView />);
    await waitFor(() => expect(mockShowError).toHaveBeenCalled());
    expect(mockShowError.mock.calls[0][0]).toContain('detect boom');
  });

  it('shows "Unknown error" when availability succeeds without data', async () => {
    mockDetectAvailability.mockResolvedValue({ success: true, data: undefined });
    render(<CodingCliSettingsView />);
    await waitFor(() => expect(mockShowError).toHaveBeenCalled());
    expect(mockShowError.mock.calls[0][0]).toContain('Unknown error');
  });

  it('shows an error when availability detection throws (Error)', async () => {
    mockDetectAvailability.mockRejectedValue(new Error('netfail'));
    render(<CodingCliSettingsView />);
    await waitFor(() => expect(mockShowError).toHaveBeenCalled());
    expect(mockShowError.mock.calls[0][0]).toContain('netfail');
  });

  it('shows an error when availability detection throws (non-Error)', async () => {
    mockDetectAvailability.mockRejectedValue('weirdfail');
    render(<CodingCliSettingsView />);
    await waitFor(() => expect(mockShowError).toHaveBeenCalled());
    expect(mockShowError.mock.calls[0][0]).toContain('weirdfail');
  });

  // ── Master switch OFF: hides the CLI selection and the re-detect action ──

  it('hides the CLI selection and re-detect button when the master switch is off', async () => {
    mockGetSettings.mockResolvedValue({ success: true, data: { enabled: false, cli: 'claude' } });
    render(<CodingCliSettingsView />);

    await waitFor(() => expect(screen.getByText('Enable Coding Agent')).toBeTruthy());
    expect(toggle().checked).toBe(false);
    expect(screen.queryByText('Default Coding CLI')).toBeNull();
    expect(screen.queryByLabelText('Select Claude Code')).toBeNull();
    expect(screen.queryByLabelText('Re-detect coding CLIs')).toBeNull();
  });

  it('keeps the master switch off when getSettings returns success:false', async () => {
    mockGetSettings.mockResolvedValue({ success: false });
    render(<CodingCliSettingsView />);
    await waitFor(() => expect(screen.getByText('Enable Coding Agent')).toBeTruthy());
    expect(toggle().checked).toBe(false);
    expect(screen.queryByText('Default Coding CLI')).toBeNull();
  });

  it('does not crash when getSettings throws', async () => {
    mockGetSettings.mockRejectedValue(new Error('settings boom'));
    render(<CodingCliSettingsView />);
    await waitFor(() => expect(screen.getByText('Enable Coding Agent')).toBeTruthy());
    expect(toggle().checked).toBe(false);
  });

  // ── Master switch toggling ──

  it('enables the feature, refreshes the MCP cache, and reveals the CLI selection', async () => {
    mockGetSettings.mockResolvedValue({ success: true, data: { enabled: false, cli: 'claude' } });
    render(<CodingCliSettingsView />);
    await waitFor(() => expect(screen.getByText('Enable Coding Agent')).toBeTruthy());
    expect(screen.queryByText('Default Coding CLI')).toBeNull();

    await act(async () => { fireEvent.click(toggle()); });

    expect(mockUpdateSettings).toHaveBeenCalledWith({ enabled: true });
    expect(mockRefresh).toHaveBeenCalled();
    await waitFor(() => expect(mockShowSuccess).toHaveBeenCalledWith('Coding Agent enabled'));
    expect(screen.getByText('Default Coding CLI')).toBeTruthy();
  });

  it('disables the feature, refreshes the MCP cache, and hides the CLI selection', async () => {
    render(<CodingCliSettingsView />);
    await waitFor(() => expect(screen.getByText('Default Coding CLI')).toBeTruthy());

    await act(async () => { fireEvent.click(toggle()); });

    expect(mockUpdateSettings).toHaveBeenCalledWith({ enabled: false });
    expect(mockRefresh).toHaveBeenCalled();
    await waitFor(() => expect(mockShowSuccess).toHaveBeenCalledWith('Coding Agent disabled'));
    expect(screen.queryByText('Default Coding CLI')).toBeNull();
  });

  it('reverts the toggle and shows an error when saving the switch returns success:false', async () => {
    mockGetSettings.mockResolvedValue({ success: true, data: { enabled: false, cli: 'claude' } });
    mockUpdateSettings.mockResolvedValue({ success: false, error: 'toggle savefail' });
    render(<CodingCliSettingsView />);
    await waitFor(() => expect(screen.getByText('Enable Coding Agent')).toBeTruthy());

    await act(async () => { fireEvent.click(toggle()); });

    await waitFor(() => expect(mockShowError).toHaveBeenCalled());
    expect(mockShowError.mock.calls.at(-1)[0]).toContain('toggle savefail');
    expect(mockRefresh).not.toHaveBeenCalled();
    expect(toggle().checked).toBe(false);
  });

  it('reverts the toggle and shows "Unknown error" when saving the switch fails without an error field', async () => {
    mockGetSettings.mockResolvedValue({ success: true, data: { enabled: false, cli: 'claude' } });
    mockUpdateSettings.mockResolvedValue({});
    render(<CodingCliSettingsView />);
    await waitFor(() => expect(screen.getByText('Enable Coding Agent')).toBeTruthy());

    await act(async () => { fireEvent.click(toggle()); });

    await waitFor(() => expect(mockShowError).toHaveBeenCalled());
    expect(mockShowError.mock.calls.at(-1)[0]).toContain('Unknown error');
    expect(toggle().checked).toBe(false);
  });

  it('reverts the toggle and shows an error when saving the switch throws', async () => {
    mockGetSettings.mockResolvedValue({ success: true, data: { enabled: false, cli: 'claude' } });
    mockUpdateSettings.mockRejectedValue(new Error('toggle throwfail'));
    render(<CodingCliSettingsView />);
    await waitFor(() => expect(screen.getByText('Enable Coding Agent')).toBeTruthy());

    await act(async () => { fireEvent.click(toggle()); });

    await waitFor(() => expect(mockShowError).toHaveBeenCalled());
    expect(mockShowError.mock.calls.at(-1)[0]).toContain('toggle throwfail');
    expect(toggle().checked).toBe(false);
  });

  it('reverts the toggle and shows a stringified error when saving the switch throws a non-Error', async () => {
    mockGetSettings.mockResolvedValue({ success: true, data: { enabled: false, cli: 'claude' } });
    mockUpdateSettings.mockRejectedValue('toggle strthrow');
    render(<CodingCliSettingsView />);
    await waitFor(() => expect(screen.getByText('Enable Coding Agent')).toBeTruthy());

    await act(async () => { fireEvent.click(toggle()); });

    await waitFor(() => expect(mockShowError).toHaveBeenCalled());
    expect(mockShowError.mock.calls.at(-1)[0]).toContain('toggle strthrow');
    expect(toggle().checked).toBe(false);
  });

  // ── CLI selection (master switch on) ──

  it('persists a new selection and shows success', async () => {
    render(<CodingCliSettingsView />);
    await waitFor(() => expect(screen.getByText('Codex CLI')).toBeTruthy());

    await act(async () => { fireEvent.click(radio('Codex CLI')); });

    expect(mockUpdateSettings).toHaveBeenCalledWith({ cli: 'codex' });
    await waitFor(() => expect(mockShowSuccess).toHaveBeenCalledWith('Coding CLI set to codex'));
  });

  it('ignores a click on the already-selected CLI', async () => {
    render(<CodingCliSettingsView />);
    await waitFor(() => expect(screen.getByText('Claude Code')).toBeTruthy());

    await act(async () => { fireEvent.click(radio('Claude Code')); });

    expect(mockUpdateSettings).not.toHaveBeenCalled();
  });

  it('does not select a CLI when its documentation link is clicked', async () => {
    render(<CodingCliSettingsView />);
    await waitFor(() => expect(screen.getByText('Codex CLI')).toBeTruthy());

    const docsLinks = screen.getAllByRole('link');
    await act(async () => { fireEvent.click(docsLinks[1]); });

    expect(mockUpdateSettings).not.toHaveBeenCalled();
  });

  it('reverts and shows an error when saving returns success:false', async () => {
    mockUpdateSettings.mockResolvedValue({ success: false, error: 'savefail' });
    render(<CodingCliSettingsView />);
    await waitFor(() => expect(screen.getByText('Codex CLI')).toBeTruthy());

    await act(async () => { fireEvent.click(radio('Codex CLI')); });

    await waitFor(() => expect(mockShowError).toHaveBeenCalled());
    expect(mockShowError.mock.calls.at(-1)[0]).toContain('savefail');
    expect(radio('Claude Code').checked).toBe(true);
  });

  it('reverts and shows "Unknown error" when saving fails without an error field', async () => {
    mockUpdateSettings.mockResolvedValue({});
    render(<CodingCliSettingsView />);
    await waitFor(() => expect(screen.getByText('Codex CLI')).toBeTruthy());

    await act(async () => { fireEvent.click(radio('Codex CLI')); });

    await waitFor(() => expect(mockShowError).toHaveBeenCalled());
    expect(mockShowError.mock.calls.at(-1)[0]).toContain('Unknown error');
    expect(radio('Claude Code').checked).toBe(true);
  });

  it('reverts and shows an error when saving throws', async () => {
    mockUpdateSettings.mockRejectedValue(new Error('throwfail'));
    render(<CodingCliSettingsView />);
    await waitFor(() => expect(screen.getByText('Codex CLI')).toBeTruthy());

    await act(async () => { fireEvent.click(radio('Codex CLI')); });

    await waitFor(() => expect(mockShowError).toHaveBeenCalled());
    expect(mockShowError.mock.calls.at(-1)[0]).toContain('throwfail');
  });

  it('reverts and shows a stringified error when saving throws a non-Error', async () => {
    mockUpdateSettings.mockRejectedValue('strthrow');
    render(<CodingCliSettingsView />);
    await waitFor(() => expect(screen.getByText('Codex CLI')).toBeTruthy());

    await act(async () => { fireEvent.click(radio('Codex CLI')); });

    await waitFor(() => expect(mockShowError).toHaveBeenCalled());
    expect(mockShowError.mock.calls.at(-1)[0]).toContain('strthrow');
  });

  it('shows a loading state until the initial load resolves', async () => {
    const availD = deferred<any>();
    mockGetSettings.mockResolvedValue({ success: true, data: { enabled: true, cli: 'claude' } });
    mockDetectAvailability.mockReturnValue(availD.promise);

    render(<CodingCliSettingsView />);
    // Settings resolves first (enabled → true, so the CLI card mounts) while
    // availability detection is still pending, so the card shows "Loading...".
    await waitFor(() => expect(screen.getByText('Loading...')).toBeTruthy());

    await act(async () => { availD.resolve({ success: true, data: { clis: CLIS } }); });
    await waitFor(() => expect(screen.queryByText('Loading...')).toBeNull());
  });

  it('disables the re-detect button while detecting and re-runs detection', async () => {
    render(<CodingCliSettingsView />);
    await waitFor(() => expect(screen.getByText('Claude Code')).toBeTruthy());
    expect(mockDetectAvailability).toHaveBeenCalledTimes(1);

    const redetectD = deferred<any>();
    mockDetectAvailability.mockReturnValue(redetectD.promise);

    const redetectBtn = screen.getByLabelText('Re-detect coding CLIs') as HTMLButtonElement;
    await act(async () => { fireEvent.click(redetectBtn); });
    expect(redetectBtn.disabled).toBe(true);
    expect(mockDetectAvailability).toHaveBeenCalledTimes(2);

    await act(async () => { redetectD.resolve({ success: true, data: { clis: CLIS } }); });
    await waitFor(() => expect((screen.getByLabelText('Re-detect coding CLIs') as HTMLButtonElement).disabled).toBe(false));
  });
});
