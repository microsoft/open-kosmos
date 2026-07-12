/**
 * @vitest-environment happy-dom
 *
 * Coverage tests for ContentContainer.tsx
 */

import React from 'react';
import { render, screen, act } from '@testing-library/react';

const mockNavigate = vi.fn();
const mockLocation = { pathname: '/agent/chat' };

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => mockLocation,
  Outlet: () => <div data-testid="outlet" />,
}));

vi.mock('../../../lib/chat/agentChatSessionCacheManager', () => ({
  useCurrentChatId: () => 'chat-123',
}));

vi.mock('../../../lib/utilities/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

import ContentContainer from '../ContentContainer';

describe('ContentContainer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (mockLocation as any).pathname = '/agent/chat';
  });

  it('renders main element with outlet', () => {
    render(<ContentContainer />);
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getByTestId('outlet')).toBeInTheDocument();
  });

  it('applies correct padding when sidebarVisible=true', () => {
    render(<ContentContainer sidebarVisible={true} />);
    const main = screen.getByRole('main');
    expect(main).toHaveStyle({ padding: '0 0 0 2px' });
  });

  it('applies correct padding when sidebarVisible=false', () => {
    render(<ContentContainer sidebarVisible={false} />);
    const main = screen.getByRole('main');
    expect(main).toHaveStyle({ padding: '0 0 0 8px' });
  });

  it('navigates to /agent/chat when at /agent root', async () => {
    (mockLocation as any).pathname = '/agent';
    render(<ContentContainer />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(mockNavigate).toHaveBeenCalledWith('/agent/chat', { replace: true });
  });

  it('does not navigate when at /agent/chat', async () => {
    (mockLocation as any).pathname = '/agent/chat';
    render(<ContentContainer />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('handles agent:newAgent custom event', async () => {
    render(<ContentContainer />);
    await act(async () => {
      window.dispatchEvent(new CustomEvent('agent:newAgent'));
    });
    expect(mockNavigate).toHaveBeenCalledWith('/agent/chat/creation');
  });

  it('handles agent:editAgent custom event with chatId', async () => {
    render(<ContentContainer />);
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent('agent:editAgent', { detail: { chatId: 'chat-abc', initialTab: 'mcp' } })
      );
    });
    expect(mockNavigate).toHaveBeenCalledWith('/agent/chat/chat-abc/settings/mcp_servers');
  });

  it('handles agent:editAgent event without chatId, uses currentChatId', async () => {
    render(<ContentContainer />);
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent('agent:editAgent', { detail: { chatId: null, initialTab: 'basic' } })
      );
    });
    expect(mockNavigate).toHaveBeenCalledWith('/agent/chat/chat-123/settings/basic');
  });

  it('falls back to basic route for an unknown initialTab', async () => {
    render(<ContentContainer />);
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent('agent:editAgent', { detail: { chatId: 'chat-x', initialTab: 'unknown-tab' } })
      );
    });
    expect(mockNavigate).toHaveBeenCalledWith('/agent/chat/chat-x/settings/basic');
  });

  it('falls back to basic route when initialTab is omitted', async () => {
    render(<ContentContainer />);
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent('agent:editAgent', { detail: { chatId: 'chat-y' } })
      );
    });
    expect(mockNavigate).toHaveBeenCalledWith('/agent/chat/chat-y/settings/basic');
  });

  it('ignores agent:editAgent when no chatId and no currentChatId', async () => {
    vi.resetModules();
    vi.doMock('../../../lib/chat/agentChatSessionCacheManager', () => ({
      useCurrentChatId: () => null,
    }));
    const { default: CC } = await import('../ContentContainer');
    render(<CC />);
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent('agent:editAgent', { detail: { chatId: null, initialTab: 'mcp' } })
      );
    });
    expect(mockNavigate).not.toHaveBeenCalledWith(expect.stringContaining('/settings/'));
    vi.doUnmock('../../../lib/chat/agentChatSessionCacheManager');
  });

  it('cleans up event listeners on unmount', () => {
    const removeEventListener = vi.spyOn(window, 'removeEventListener');
    const { unmount } = render(<ContentContainer />);
    unmount();
    expect(removeEventListener).toHaveBeenCalledWith('agent:newAgent', expect.any(Function));
    expect(removeEventListener).toHaveBeenCalledWith('agent:editAgent', expect.any(Function));
  });
});
