/** @vitest-environment happy-dom */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ExternalAgentConnectionConfig from '../ExternalAgentConnectionConfig';

const mockGetConnectionInfo = vi.fn();
let statusCb: ((event: unknown, status: { connected: boolean }) => void) | null = null;
const mockOff = vi.fn();
const mockShowToast = vi.fn();

vi.mock('../../../../ipc/externalAgent', () => ({
  externalAgentApi: {
    getConnectionInfo: (...args: unknown[]) => mockGetConnectionInfo(...args),
  },
  externalAgentEvents: {
    statusChanged: (cb: (event: unknown, status: { connected: boolean }) => void) => {
      statusCb = cb;
      return mockOff;
    },
  },
}));

vi.mock('../../../ui/ToastProvider', () => ({
  useToast: () => ({ showToast: mockShowToast }),
}));

const writeText = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  statusCb = null;
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  });
});

const connected = {
  addresses: ['192.168.1.5', '10.0.0.2'],
  port: 8123,
  connected: true,
};

async function renderWith(info: unknown | null, token?: string) {
  mockGetConnectionInfo.mockResolvedValue(info ? { success: true, data: info } : { success: false });
  const utils = render(<ExternalAgentConnectionConfig token={token} />);
  if (info) await screen.findByText('External Agent Connection');
  return utils;
}

describe('ExternalAgentConnectionConfig', () => {
  it('renders nothing until connection info resolves / when info missing', async () => {
    const { container } = await renderWith(null);
    await waitFor(() => expect(mockGetConnectionInfo).toHaveBeenCalled());
    expect(container.querySelector('.form-section')).toBeNull();
  });

  it('shows connected status, WS urls and copies a url', async () => {
    await renderWith(connected, 'secret-token');
    expect(screen.getByText('● Connected')).toBeTruthy();
    const badge = screen.getByText('● Connected');
    // happy-dom drops a nested var() from the style attribute (Chromium keeps it);
    // assert no raw hex leaked rather than the exact token string.
    expect(badge.getAttribute('style') || '').not.toMatch(/#[0-9a-fA-F]{3,6}/);
    // two addresses -> two ws urls
    expect(screen.getByText('ws://192.168.1.5:8123')).toBeTruthy();
    expect(screen.getByText('ws://10.0.0.2:8123')).toBeTruthy();
    const copyBtns = screen.getAllByText('Copy');
    fireEvent.click(copyBtns[0]);
    expect(writeText).toHaveBeenCalledWith('ws://192.168.1.5:8123');
    expect(mockShowToast).toHaveBeenCalledWith('Copied to clipboard', 'success');
  });

  it('shows disconnected status with secondary color', async () => {
    await renderWith({ ...connected, connected: false });
    const badge = screen.getByText('○ Disconnected');
    expect(badge.getAttribute('style')).toContain('var(--text-secondary)');
  });

  it('toggles token visibility and copies the token', async () => {
    await renderWith(connected, 'my-auth-token');
    expect(screen.getByText('••••••••••••••••')).toBeTruthy();
    fireEvent.click(screen.getByText('Show'));
    expect(screen.getByText('my-auth-token')).toBeTruthy();
    fireEvent.click(screen.getByText('Hide'));
    expect(screen.getByText('••••••••••••••••')).toBeTruthy();
    // last Copy button copies the token
    const copyBtns = screen.getAllByText('Copy');
    fireEvent.click(copyBtns[copyBtns.length - 1]);
    expect(writeText).toHaveBeenCalledWith('my-auth-token');
  });

  it('omits WS url block when there are no addresses and shows <your-ip> hint', async () => {
    await renderWith({ addresses: [], port: 9000, connected: true });
    expect(screen.queryByText(/^ws:\/\//)).toBeNull();
    expect(screen.getByText(/ws:\/\/<your-ip>:9000/)).toBeTruthy();
    // token absent -> no token hint
    expect(screen.getByText(/<no token>/)).toBeTruthy();
  });

  it('updates connected state from a pushed status event', async () => {
    await renderWith({ ...connected, connected: false });
    expect(screen.getByText('○ Disconnected')).toBeTruthy();
    expect(statusCb).toBeTypeOf('function');
    statusCb!(null, { connected: true });
    await waitFor(() => expect(screen.getByText('● Connected')).toBeTruthy());
  });

  it('unsubscribes from status events on unmount', async () => {
    const { unmount } = await renderWith(connected);
    unmount();
    expect(mockOff).toHaveBeenCalled();
  });
});
