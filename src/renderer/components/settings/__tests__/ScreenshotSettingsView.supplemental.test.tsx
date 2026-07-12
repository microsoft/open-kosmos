// @ts-nocheck
/** @vitest-environment happy-dom */

import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import ScreenshotSettingsView from '../ScreenshotSettingsView';

const i18nState = vi.hoisted(() => {
  const makeTranslator = (language: string) => (key: string, vars?: Record<string, unknown>) =>
    `${language}:${key}:${vars?.error ?? ''}`;
  return {
    language: 'en',
    translators: {
      en: makeTranslator('en'),
      zh: makeTranslator('zh'),
    },
  };
});

vi.mock('@/lib/i18n/useI18n', () => ({
  useI18n: () => ({
    t: i18nState.translators[i18nState.language as 'en' | 'zh'],
    language: i18nState.language,
    setLanguage: vi.fn(),
  })
}));

const mockGetSettings = vi.fn();
const mockUpdateSettings = vi.fn();
const mockSelectSavePath = vi.fn();

vi.mock('../../../ipc/screenshot-main', () => ({
  screenshotApi: {
    getSettings: (...args: any[]) => mockGetSettings(...args),
    updateSettings: (...args: any[]) => mockUpdateSettings(...args),
    selectSavePath: (...args: any[]) => mockSelectSavePath(...args),
  },
}));

vi.mock('../../../styles/ScreenshotSettingsView.css', () => ({}));
vi.mock('../ScreenshotSettingsHeaderView', () => ({ default: () => <div data-testid="header" /> }));
vi.mock('../ScreenshotSettingsContentView', () => ({
  default: (props: any) => (
    <div>
      <div data-testid="error">{props.error ?? ''}</div>
      <button onClick={() => props.onShortcutChange('   ')}>blank shortcut</button>
      <button onClick={() => props.onSettingsChange({ ...props.settings, enabled: !props.settings.enabled })}>change settings</button>
      <button onClick={() => props.onSelectSavePath()}>select path</button>
    </div>
  ),
}));

describe('ScreenshotSettingsView supplemental coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    i18nState.language = 'en';
    mockGetSettings.mockResolvedValue({
      success: true,
      data: { enabled: true, shortcut: 'CommandOrControl+Shift+S', shortcutEnabled: false, savePath: '', freRejected: false },
    });
    mockUpdateSettings.mockResolvedValue({ success: true });
    mockSelectSavePath.mockResolvedValue({ success: true, data: '/saved/path' });
  });

  it('stringifies non-Error load failures', async () => {
    mockGetSettings.mockRejectedValue('load boom');
    render(<ScreenshotSettingsView />);
    await waitFor(() => expect(screen.getByTestId('error').textContent).toContain('load boom'));
  });

  it('does not save when the shortcut is blank', async () => {
    render(<ScreenshotSettingsView />);
    await waitFor(() => expect(mockGetSettings).toHaveBeenCalled());
    await userEvent.click(screen.getByText('blank shortcut'));
    expect(mockUpdateSettings).not.toHaveBeenCalled();
  });

  it('uses fallback save and path error strings when payloads are missing or non-Error values', async () => {
    mockUpdateSettings.mockResolvedValueOnce({ success: false });
    render(<ScreenshotSettingsView />);
    await waitFor(() => expect(mockGetSettings).toHaveBeenCalled());
    await act(async () => {
      fireEvent.click(screen.getByText('change settings'));
    });
    expect(screen.getByTestId('error').textContent).toContain('common.unknownError');

    mockUpdateSettings.mockRejectedValueOnce('save string');
    await act(async () => {
      fireEvent.click(screen.getByText('change settings'));
    });
    expect(screen.getByTestId('error').textContent).toContain('save string');

    mockSelectSavePath.mockRejectedValueOnce('path string');
    await userEvent.click(screen.getByText('select path'));
    expect(screen.getByTestId('error').textContent).toContain('path string');
  });

  it('does not save when selecting a path returns success without data', async () => {
    mockSelectSavePath.mockResolvedValue({ success: true, data: '' });
    render(<ScreenshotSettingsView />);
    await waitFor(() => expect(mockGetSettings).toHaveBeenCalled());
    await userEvent.click(screen.getByText('select path'));
    expect(mockUpdateSettings).not.toHaveBeenCalled();
  });

  it('does not reload screenshot settings when only language changes', async () => {
    const { rerender } = render(<ScreenshotSettingsView />);
    await waitFor(() => expect(mockGetSettings).toHaveBeenCalledTimes(1));

    await act(async () => {
      i18nState.language = 'zh';
      rerender(<ScreenshotSettingsView />);
    });

    expect(mockGetSettings).toHaveBeenCalledTimes(1);
  });
});
