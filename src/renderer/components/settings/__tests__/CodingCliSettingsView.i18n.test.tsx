/**
 * @vitest-environment happy-dom
 */
import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import CodingCliSettingsView from '../CodingCliSettingsView';

const i18nState = vi.hoisted(() => {
  const makeTranslator = (language: string) => (key: string, params?: Record<string, unknown>) =>
    `${language}:${key}:${params?.error ?? ''}`;
  return {
    language: 'en',
    translators: {
      en: makeTranslator('en'),
      zh: makeTranslator('zh'),
    },
  };
});

const codingCliMocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  detectAvailability: vi.fn(),
  updateSettings: vi.fn(),
}));
const toastMocks = vi.hoisted(() => ({
  showSuccess: vi.fn(),
  showError: vi.fn(),
}));

vi.mock('../../ui/ToastProvider', () => ({
  useToast: () => toastMocks,
}));
vi.mock('../../../lib/i18n/useI18n', () => ({
  useI18n: () => ({
    t: i18nState.translators[i18nState.language as 'en' | 'zh'],
  }),
}));
vi.mock('../../../lib/utilities/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}));
vi.mock('../../../lib/mcp/mcpClientCacheManager', () => ({
  mcpClientCacheManager: { refresh: vi.fn() },
}));
vi.mock('../../../ipc/codingCli', () => ({
  codingCliApi: {
    getSettings: codingCliMocks.getSettings,
    detectAvailability: codingCliMocks.detectAvailability,
    updateSettings: codingCliMocks.updateSettings,
  },
}));
vi.mock('../CodingCliSettingsHeaderView', () => ({
  default: ({ isDetecting }: { isDetecting: boolean }) => (
    <div data-testid="coding-cli-header" data-detecting={String(isDetecting)} />
  ),
}));
vi.mock('../CodingCliSettingsContentView', () => ({
  default: ({ enabled, selectedCli, isLoading, clis }: any) => (
    <div data-testid="coding-cli-content">
      <span data-testid="enabled">{String(enabled)}</span>
      <span data-testid="selected-cli">{selectedCli}</span>
      <span data-testid="loading">{String(isLoading)}</span>
      <span data-testid="cli-count">{clis.length}</span>
    </div>
  ),
}));

describe('CodingCliSettingsView i18n stability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    i18nState.language = 'en';
    codingCliMocks.getSettings.mockResolvedValue({ success: true, data: { enabled: true, cli: 'claude' } });
    codingCliMocks.detectAvailability.mockResolvedValue({
      success: true,
      data: {
        clis: [
          { id: 'claude', displayName: 'Claude Code', binaryName: 'claude', installHint: '', docsUrl: '', available: true, path: '/bin/claude' },
        ],
      },
    });
    codingCliMocks.updateSettings.mockResolvedValue({ success: true });
  });

  it('does not re-detect availability or reload settings when only language changes', async () => {
    const { rerender } = render(<CodingCliSettingsView />);
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
    expect(codingCliMocks.getSettings).toHaveBeenCalledTimes(1);
    expect(codingCliMocks.detectAvailability).toHaveBeenCalledTimes(1);

    await act(async () => {
      i18nState.language = 'zh';
      rerender(<CodingCliSettingsView />);
    });

    expect(codingCliMocks.getSettings).toHaveBeenCalledTimes(1);
    expect(codingCliMocks.detectAvailability).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('selected-cli')).toHaveTextContent('claude');
    expect(screen.getByTestId('cli-count')).toHaveTextContent('1');
  });
});
