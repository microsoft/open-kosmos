/**
 * @vitest-environment happy-dom
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('AboutAppContentView branch coverage', () => {
  beforeEach(() => {
    vi.resetModules();
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        getVersion: vi.fn().mockResolvedValue('9.9.9'),
        getPlatformInfo: vi.fn().mockResolvedValue({ platform: 'darwin', arch: 'arm64' }),
      },
    });
  });

  it('falls back to APP_NAME and renders the feedback link when branding omits a product name', async () => {
    vi.doMock('../../../styles/ContentView.css', () => ({}));
    vi.doMock('../../../styles/ToolbarSettingsView.css', () => ({}));
    vi.doMock('../../../styles/AboutAppView.css', () => ({}));
    vi.doMock('../../../lib/brandIcon', () => ({ appIcon: 'icon.png' }));
    vi.doMock('../../../lib/i18n/useI18n', () => ({
      useI18n: () => ({
        t: (_key: string, values?: { productName?: string }) => `Learn more about ${values?.productName}`,
      }),
    }));
    vi.doMock('../../../lib/utilities/logger', () => ({
      createLogger: () => ({ error: vi.fn() }),
    }));
    vi.doMock('@shared/constants/branding', () => ({
      APP_NAME: 'Fallback App',
      BRAND_CONFIG: {
        productName: '',
        feedbackLink: 'https://example.com/feedback',
      },
    }));

    const { default: AboutAppContentView } = await import('../AboutAppContentView');
    render(<AboutAppContentView />);

    await waitFor(() => expect(screen.getByText('9.9.9')).toBeInTheDocument());
    expect(screen.getByText('Fallback App')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Learn more about Fallback App' })).toHaveAttribute(
      'href',
      'https://example.com/feedback',
    );
  });
});
