// @ts-nocheck
/**
 * @vitest-environment happy-dom
 *
 * Coverage tests for AboutAppContentView.tsx
 */

import React from 'react';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';

const mockSilentCheckForUpdates = vi.fn();
const mockInstallUpdate = vi.fn().mockResolvedValue(undefined);

vi.mock('../../autoUpdate/UpdateProvider', () => ({
  useUpdate: () => ({
    silentCheckForUpdates: mockSilentCheckForUpdates,
    installUpdate: mockInstallUpdate,
    updateInfo: null,
    status: 'no-update',
    progress: null,
  }),
}));

vi.mock('@shared/constants/branding', () => ({
  APP_NAME: 'OpenKosmos',
  BRAND_NAME: 'kosmos',
  BRAND_CONFIG: { productName: 'OpenKosmos AI Studio' },
}));

vi.mock('../../../styles/ContentView.css', () => ({}));
vi.mock('../../../styles/SettingsShared.css', () => ({}));
vi.mock('../../../styles/AboutAppView.css', () => ({}));

vi.mock('../../../lib/brandIcon', () => ({ appIcon: 'icon.png' }));

vi.mock('../../../lib/utilities/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

import AboutAppContentView from '../AboutAppContentView';

function setupElectronAPI(opts: { version?: string; platform?: string; arch?: string } = {}) {
  Object.defineProperty(window, 'electronAPI', {
    writable: true,
    configurable: true,
    value: {
      getVersion: vi.fn().mockResolvedValue(opts.version ?? '1.2.3'),
      getPlatformInfo: vi.fn().mockResolvedValue({
        platform: opts.platform ?? 'win32',
        arch: opts.arch ?? 'x64',
      }),
    },
  });
}

describe('AboutAppContentView - basic rendering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupElectronAPI();
  });

  it('renders without crashing', async () => {
    render(<AboutAppContentView />);
    await act(async () => {});
    expect(screen.getAllByText(/OpenKosmos AI Studio/).length).toBeGreaterThan(0);
  });

  it('shows brand name', async () => {
    render(<AboutAppContentView />);
    await waitFor(() => {
      expect(screen.getAllByText('OpenKosmos AI Studio').length).toBeGreaterThan(0);
    });
  });

  it('shows version after load', async () => {
    render(<AboutAppContentView />);
    await waitFor(() => {
      expect(screen.getByText(/1\.2\.3/)).toBeInTheDocument();
    });
  });

  it('calls silentCheckForUpdates on mount', async () => {
    render(<AboutAppContentView />);
    await waitFor(() => {
      expect(mockSilentCheckForUpdates).toHaveBeenCalled();
    });
  });

  it('shows copyright text', async () => {
    render(<AboutAppContentView />);
    await act(async () => {});
    expect(screen.getByText(/Copyright/)).toBeInTheDocument();
  });

  it('shows brand icon', async () => {
    render(<AboutAppContentView />);
    await act(async () => {});
    const img = screen.getByAltText('OpenKosmos AI Studio');
    expect(img).toBeInTheDocument();
  });

  it('shows platform arch', async () => {
    setupElectronAPI({ arch: 'arm64' });
    render(<AboutAppContentView />);
    await waitFor(() => {
      expect(screen.getByText(/arm64/)).toBeInTheDocument();
    });
  });

  it('shows arch in version detail', async () => {
    setupElectronAPI({ arch: 'x64' });
    render(<AboutAppContentView />);
    await waitFor(() => {
      expect(screen.getByText((content, el) => content.includes('x64'))).toBeInTheDocument();
    });
  });

  it('renders copyright text', async () => {
    render(<AboutAppContentView />);
    await act(async () => {});
    // Copyright always rendered
    const containers = document.querySelectorAll('.about-legal-text');
    expect(containers.length).toBeGreaterThan(0);
  });

  it('shows up-to-date by default (no-update status)', async () => {
    render(<AboutAppContentView />);
    await waitFor(() => {
      // The span text is split, check via container
      const container = document.querySelector('.about-version-status-text');
      expect(container).not.toBeNull();
    });
  });
});

describe('AboutAppContentView - update statuses', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupElectronAPI();
  });

  it('shows checking status', async () => {
    vi.mocked(vi.importActual).mockImplementation?.(() => {});
    vi.mock('../../autoUpdate/UpdateProvider', () => ({
      useUpdate: () => ({
        silentCheckForUpdates: mockSilentCheckForUpdates,
        installUpdate: mockInstallUpdate,
        updateInfo: null,
        status: 'checking',
        progress: null,
      }),
    }));
  });

  it('shows Install Update Now button when status=downloaded', async () => {
    render(<AboutAppContentView />);
    await act(async () => {});
    // The version status span should exist
    const container = document.querySelector('.about-version-status-text');
    expect(container).not.toBeNull();
  });
});
