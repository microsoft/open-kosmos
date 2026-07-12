/** @vitest-environment happy-dom */

vi.mock('@renderer/lib/userData', () => ({
  profileDataManager: {
    getCurrentUserAlias: vi.fn(() => 'test-user'),
  },
}));

vi.mock('../../lib/i18n/useI18n', () => ({
  useI18n: () => ({
    t: (key: string) => key === 'fre.welcome.title'
      ? 'Hi {userName}, welcome to {productName}!'
      : key,
  }),
}));

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { profileDataManager } from '@renderer/lib/userData';
import FreOverlay from '../FreOverlay';

describe('FreOverlay', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      writable: true,
      value: {
        platform: 'darwin',
        getPlatformInfo: vi.fn().mockResolvedValue({ platform: 'darwin' }),
      },
    });
  });

  it('renders an offline welcome and completes without fetching a catalog', () => {
    const onSkip = vi.fn();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    render(<FreOverlay onSkip={onSkip} />);

    expect(screen.getByText(/test-user/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(onSkip).toHaveBeenCalledOnce();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('falls back to a generic user name', () => {
    vi.mocked(profileDataManager.getCurrentUserAlias).mockReturnValueOnce('');

    render(<FreOverlay onSkip={vi.fn()} />);

    expect(screen.getByText(/there/)).toBeInTheDocument();
  });

  it('keeps the Windows title bar offset when the platform is already known', () => {
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      writable: true,
      value: {
        platform: 'win32',
        getPlatformInfo: vi.fn(),
      },
    });

    const { container } = render(<FreOverlay onSkip={vi.fn()} />);

    expect(window.electronAPI.getPlatformInfo).not.toHaveBeenCalled();
    expect((container.firstChild as HTMLElement).style.top).toBe('40px');
  });

  it('loads platform info when platform is initially unavailable', async () => {
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      writable: true,
      value: {
        getPlatformInfo: vi.fn().mockResolvedValue({ platform: 'win32' }),
      },
    });

    const { container, findByText } = render(<FreOverlay onSkip={vi.fn()} />);
    await findByText(/test-user/);

    expect(window.electronAPI.getPlatformInfo).toHaveBeenCalledOnce();
    expect((container.firstChild as HTMLElement).style.top).toBe('40px');
  });

  it('ignores platform lookup failures and keeps the non-Windows layout', async () => {
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      writable: true,
      value: {
        getPlatformInfo: vi.fn().mockRejectedValue(new Error('lookup failed')),
      },
    });

    const { container, findByText } = render(<FreOverlay onSkip={vi.fn()} />);
    await findByText(/test-user/);

    expect(window.electronAPI.getPlatformInfo).toHaveBeenCalledOnce();
    expect((container.firstChild as HTMLElement).style.top).toBe('0px');
  });
});
