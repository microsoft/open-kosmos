/**
 * @vitest-environment happy-dom
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../../../lib/userData/types';

const appDataMock = vi.hoisted(() => {
  const state = {
    currentConfig: {} as AppConfig,
    listeners: new Set<(config: AppConfig) => void>(),
  };
  const manager = {
    getConfig: vi.fn(() => state.currentConfig),
    updateConfig: vi.fn(),
    subscribe: vi.fn((listener: (config: AppConfig) => void) => {
      state.listeners.add(listener);
      return () => state.listeners.delete(listener);
    }),
  };
  return { manager, state };
});

const toastMock = vi.hoisted(() => ({
  showSuccess: vi.fn(),
  showError: vi.fn(),
}));

vi.mock('../../../lib/userData/appDataManager', () => ({
  appDataManager: appDataMock.manager,
}));

vi.mock('../../ui/ToastProvider', () => ({
  useToast: () => toastMock,
}));

import AppearanceSettingsView from '../AppearanceSettingsView';

function pushConfig(config: AppConfig) {
  appDataMock.state.currentConfig = config;
  appDataMock.state.listeners.forEach((listener) => listener(config));
}

describe('AppearanceSettingsView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    appDataMock.state.currentConfig = {};
    appDataMock.state.listeners.clear();
    appDataMock.manager.updateConfig.mockResolvedValue({ success: true });
  });

  it('renders light as the default appearance', () => {
    render(<AppearanceSettingsView />);

    expect(screen.getByText('Appearance')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Light/i })).toBeChecked();
    expect(screen.getByRole('radio', { name: /Dark/i })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: /System/i })).not.toBeChecked();
  });

  it('uses the initial app config appearance value', () => {
    appDataMock.state.currentConfig = { appearance: { themeSource: 'dark' } };

    render(<AppearanceSettingsView />);

    expect(screen.getByRole('radio', { name: /Dark/i })).toBeChecked();
  });

  it('updates when app config is pushed from the manager', async () => {
    render(<AppearanceSettingsView />);

    pushConfig({ appearance: { themeSource: 'system' } });

    await waitFor(() => {
      expect(screen.getByRole('radio', { name: /System/i })).toBeChecked();
    });
  });

  it('falls back to light when pushed app config has no appearance value', async () => {
    appDataMock.state.currentConfig = { appearance: { themeSource: 'system' } };
    render(<AppearanceSettingsView />);

    pushConfig({});

    await waitFor(() => {
      expect(screen.getByRole('radio', { name: /Light/i })).toBeChecked();
    });
  });

  it('ignores selecting the already active appearance mode', () => {
    render(<AppearanceSettingsView />);

    fireEvent.click(screen.getByRole('radio', { name: /Light/i }));

    expect(appDataMock.manager.updateConfig).not.toHaveBeenCalled();
  });

  it('persists a selected appearance mode', async () => {
    render(<AppearanceSettingsView />);

    fireEvent.click(screen.getByRole('radio', { name: /Dark/i }));

    await waitFor(() => {
      expect(appDataMock.manager.updateConfig).toHaveBeenCalledWith({
        appearance: { themeSource: 'dark' },
      });
      expect(toastMock.showSuccess).toHaveBeenCalledWith('Appearance set to Dark');
    });
  });

  it('shows an error when persistence fails', async () => {
    appDataMock.manager.updateConfig.mockResolvedValueOnce({ success: false, error: 'disk full' });
    render(<AppearanceSettingsView />);

    fireEvent.click(screen.getByRole('radio', { name: /Dark/i }));

    await waitFor(() => {
      expect(screen.getByText('Failed to update appearance: disk full')).toBeInTheDocument();
      expect(toastMock.showError).toHaveBeenCalledWith('Failed to update appearance: disk full');
    });
  });

  it('shows an unknown error when persistence fails without a message', async () => {
    appDataMock.manager.updateConfig.mockResolvedValueOnce({ success: false });
    render(<AppearanceSettingsView />);

    fireEvent.click(screen.getByRole('radio', { name: /Dark/i }));

    await waitFor(() => {
      expect(screen.getByText('Failed to update appearance: Unknown error')).toBeInTheDocument();
      expect(toastMock.showError).toHaveBeenCalledWith('Failed to update appearance: Unknown error');
    });
  });

  it('shows an error when persistence throws', async () => {
    appDataMock.manager.updateConfig.mockRejectedValueOnce(new Error('ipc failed'));
    render(<AppearanceSettingsView />);

    fireEvent.click(screen.getByRole('radio', { name: /Dark/i }));

    await waitFor(() => {
      expect(screen.getByText('Failed to update appearance: ipc failed')).toBeInTheDocument();
      expect(toastMock.showError).toHaveBeenCalledWith('Failed to update appearance: ipc failed');
    });
  });

  it('stringifies non-error thrown persistence failures', async () => {
    appDataMock.manager.updateConfig.mockRejectedValueOnce('ipc failed');
    render(<AppearanceSettingsView />);

    fireEvent.click(screen.getByRole('radio', { name: /Dark/i }));

    await waitFor(() => {
      expect(screen.getByText('Failed to update appearance: ipc failed')).toBeInTheDocument();
      expect(toastMock.showError).toHaveBeenCalledWith('Failed to update appearance: ipc failed');
    });
  });

  it('ignores duplicate selections and disables options while saving', async () => {
    let resolveUpdate: (value: { success: boolean }) => void = () => {};
    appDataMock.manager.updateConfig.mockImplementationOnce(() => new Promise((resolve) => {
      resolveUpdate = resolve;
    }));
    render(<AppearanceSettingsView />);

    fireEvent.click(screen.getByRole('radio', { name: /Dark/i }));
    fireEvent.click(screen.getByRole('radio', { name: /System/i }));

    expect(appDataMock.manager.updateConfig).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('radio', { name: /System/i })).toBeDisabled();

    resolveUpdate({ success: true });

    await waitFor(() => {
      expect(screen.getByRole('radio', { name: /System/i })).not.toBeDisabled();
    });
  });

  it('cleans up the app config subscription on unmount', () => {
    const { unmount } = render(<AppearanceSettingsView />);

    expect(appDataMock.state.listeners.size).toBe(1);
    unmount();
    expect(appDataMock.state.listeners.size).toBe(0);
  });
});
