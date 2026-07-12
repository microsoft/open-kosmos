/** @vitest-environment happy-dom */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UiLanguage } from '../../../lib/userData/types';

const mockShowSuccess = vi.hoisted(() => vi.fn());
const mockShowError = vi.hoisted(() => vi.fn());
const mockSetLanguage = vi.hoisted(() => vi.fn());
const i18nState = vi.hoisted(() => ({ language: 'en' as UiLanguage }));

const labels: Record<string, string> = {
  'common.error': 'Error:',
  'common.language.english': 'English',
  'common.language.chinese': 'Chinese',
  'common.unknownError': 'Unknown error',
  'settings.language.title': 'Language',
  'settings.language.displayLanguage': 'Display language',
  'settings.language.displayLanguageDescription': 'The change applies immediately and is saved for this device.',
  'settings.language.englishDescription': 'Use English for the interface.',
  'settings.language.chineseDescription': 'Use Simplified Chinese for the interface.',
  'settings.language.updateSuccess': 'Language updated',
  'settings.language.updateFailure': 'Failed to update language: {error}',
};

function t(key: string, params: Record<string, unknown> = {}) {
  const template = labels[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (match, paramName) => (
    params[paramName] === undefined || params[paramName] === null ? match : String(params[paramName])
  ));
}

vi.mock('../../ui/ToastProvider', () => ({
  useToast: () => ({ showSuccess: mockShowSuccess, showError: mockShowError }),
}));

vi.mock('../../../lib/i18n/useI18n', () => ({
  useI18n: () => ({
    language: i18nState.language,
    setLanguage: mockSetLanguage,
    t,
  }),
}));

import LanguageSettingsView from '../LanguageSettingsView';

describe('LanguageSettingsView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    i18nState.language = 'en';
    mockSetLanguage.mockResolvedValue({ success: true });
  });

  it('renders the language choices with the current language selected', () => {
    render(<LanguageSettingsView />);

    expect(screen.getByText('Language')).toBeTruthy();
    expect(screen.getByText('Display language')).toBeTruthy();
    expect(screen.getByLabelText('English')).toBeChecked();
    expect(screen.getByLabelText('Chinese')).not.toBeChecked();
  });

  it('saves a new language and shows a success toast', async () => {
    render(<LanguageSettingsView />);

    fireEvent.click(screen.getByLabelText('Chinese'));

    await waitFor(() => {
      expect(mockSetLanguage).toHaveBeenCalledWith('zh-CN');
      expect(mockShowSuccess).toHaveBeenCalledWith('语言已更新');
    });
  });

  it('does not save when selecting the current language', () => {
    render(<LanguageSettingsView />);

    const englishRadio = screen.getByLabelText('English') as HTMLInputElement;
    const checkedSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'checked',
    )?.set;
    checkedSetter?.call(englishRadio, false);
    fireEvent.click(englishRadio);

    expect(mockSetLanguage).not.toHaveBeenCalled();
  });

  it('shows inline and toast errors when saving fails', async () => {
    mockSetLanguage.mockResolvedValue({ success: false, error: 'disk full' });
    render(<LanguageSettingsView />);

    fireEvent.click(screen.getByLabelText('Chinese'));

    await waitFor(() => {
      expect(mockShowError).toHaveBeenCalledWith('Failed to update language: disk full');
      expect(screen.getByText('Failed to update language: disk full')).toBeTruthy();
    });
  });

  it('uses the unknown-error fallback when saving fails without an error', async () => {
    mockSetLanguage.mockResolvedValue({ success: false });
    render(<LanguageSettingsView />);

    fireEvent.click(screen.getByLabelText('Chinese'));

    await waitFor(() => {
      expect(mockShowError).toHaveBeenCalledWith('Failed to update language: Unknown error');
    });
  });
});
