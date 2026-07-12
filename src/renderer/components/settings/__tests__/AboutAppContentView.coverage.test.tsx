/**
 * @vitest-environment happy-dom
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../styles/ContentView.css', () => ({}));
vi.mock('../../../styles/ToolbarSettingsView.css', () => ({}));
vi.mock('../../../styles/AboutAppView.css', () => ({}));
vi.mock('../../../lib/brandIcon', () => ({ appIcon: 'icon.png' }));
const mockLoggerError = vi.hoisted(() => vi.fn());
vi.mock('@shared/constants/branding', () => ({
  APP_NAME: 'OpenKosmos',
  BRAND_CONFIG: {
    productName: 'OpenKosmos',
    feedbackLink: '',
  },
}));
vi.mock('../../../lib/i18n/useI18n', () => ({
  useI18n: () => ({
    t: (_key: string, values?: { productName?: string }) => `Learn more about ${values?.productName}`,
  }),
}));
vi.mock('../../../lib/utilities/logger', () => ({
  createLogger: () => ({ error: mockLoggerError }),
}));

import AboutAppContentView from '../AboutAppContentView';

describe('AboutAppContentView', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        getVersion: vi.fn().mockResolvedValue('2.8.17'),
        getPlatformInfo: vi.fn().mockResolvedValue({ platform: 'darwin', arch: 'arm64' }),
      },
    });
  });

  it('renders local application and platform information', async () => {
    render(<AboutAppContentView />);

    await waitFor(() => expect(screen.getByText('2.8.17')).toBeTruthy());
    expect(screen.getByText('macOS arm64')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('maps Windows platform information', async () => {
    window.electronAPI.getPlatformInfo = vi.fn().mockResolvedValue({ platform: 'win32', arch: 'x64' });
    render(<AboutAppContentView />);

    await waitFor(() => expect(screen.getByText('Windows x64')).toBeTruthy());
  });

  it('shows placeholders when application APIs are unavailable', () => {
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: {} });
    render(<AboutAppContentView />);

    expect(screen.getAllByText('-')).toHaveLength(2);
  });

  it('maps Linux platform information', async () => {
    window.electronAPI.getPlatformInfo = vi.fn().mockResolvedValue({ platform: 'linux', arch: 'x64' });
    render(<AboutAppContentView />);

    await waitFor(() => expect(screen.getByText('Linux x64')).toBeTruthy());
  });

  it('logs and keeps placeholders when app info loading fails', async () => {
    window.electronAPI.getVersion = vi.fn().mockRejectedValue(new Error('version failed'));
    render(<AboutAppContentView />);

    await waitFor(() => expect(mockLoggerError).toHaveBeenCalled());
    expect(screen.getAllByText('-')).toHaveLength(2);
  });
});
