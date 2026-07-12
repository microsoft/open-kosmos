// @ts-nocheck
/** @vitest-environment happy-dom */

import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { ReasoningEffortSelector } from '../ReasoningEffortSelector';
import { profileDataManager } from '@/lib/userData/profileDataManager';
import { getModelCapabilities } from '@/lib/models/ghcModels';

const mockUpdateConfig = vi.fn();
const subscribeCallbacks: Array<() => void> = [];
const clickOutHandlers: Array<() => void> = [];

vi.mock('@/lib/i18n/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key, language: 'en', setLanguage: vi.fn() })
}));

vi.mock('@/lib/userData/profileDataManager', () => ({
  profileDataManager: {
    getSelectedModel: vi.fn(),
    subscribe: vi.fn((cb: () => void) => {
      subscribeCallbacks.push(cb);
      return vi.fn();
    }),
    getReasoningEffort: vi.fn(),
  },
}));

vi.mock('../../../userData/userDataProvider', () => ({
  useAgentConfig: () => ({ updateConfig: mockUpdateConfig, isLoading: false }),
}));

vi.mock('@/lib/models/ghcModels', () => ({
  getModelCapabilities: vi.fn(),
}));

vi.mock('@/components/ui/use-click-out', () => ({
  useClickOut: (_ref: unknown, handler: () => void) => {
    clickOutHandlers.push(handler);
  },
}));

function renderSelector(currentChatId: string | null, modelId: string | null, efforts: string[], storedEffort?: string) {
  vi.mocked(profileDataManager.getSelectedModel).mockReturnValue(modelId);
  vi.mocked((profileDataManager as any).getReasoningEffort).mockReturnValue(storedEffort);
  vi.mocked(getModelCapabilities).mockReturnValue({ reasoningEfforts: efforts } as any);
  return render(<ReasoningEffortSelector currentChatId={currentChatId} shouldLockComposeUi={false} />);
}

describe('ReasoningEffortSelector supplemental coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    subscribeCallbacks.length = 0;
    clickOutHandlers.length = 0;
    mockUpdateConfig.mockResolvedValue({ success: true });
  });

  it('ignores subscription refreshes when currentChatId is null', () => {
    renderSelector(null, 'gpt-4o', ['low', 'high']);
    expect(subscribeCallbacks).toHaveLength(1);
    subscribeCallbacks[0]();
    expect(profileDataManager.getSelectedModel).not.toHaveBeenCalledWith(null);
  });

  it('falls back to Medium for Claude models when High is unavailable', () => {
    renderSelector('chat-1', 'claude-sonnet-4.5', ['low', 'medium']);
    expect(screen.getByText('Medium (default)')).toBeInTheDocument();
  });

  it('falls back to High for non-Claude models when Medium is unavailable', () => {
    renderSelector('chat-1', 'gpt-4o', ['low', 'high']);
    expect(screen.getByText('High (default)')).toBeInTheDocument();
  });

  it('formats an empty default effort label without crashing and closes via click-out', async () => {
    const user = userEvent.setup();
    renderSelector('chat-1', 'gpt-4o', ['', 'low']);

    await user.click(screen.getByTitle('chat.reasoning.title'));
    expect(screen.getByText('Low')).toBeInTheDocument();

    await act(async () => {
      clickOutHandlers[0]();
    });
    await waitFor(() => {
      expect(screen.queryByText('Low')).toBeNull();
    });
  });

  it('returns early when selecting the already stored effort with different casing', async () => {
    renderSelector('chat-1', 'gpt-4o', ['low', 'high'], 'low');

    fireEvent.click(screen.getByTitle('chat.reasoning.title'));
    const lowOption = document.querySelector('.reasoning-effort-dropdown .reasoning-effort-option') as HTMLButtonElement;
    await userEvent.click(lowOption);

    expect(mockUpdateConfig).not.toHaveBeenCalled();
  });
});
