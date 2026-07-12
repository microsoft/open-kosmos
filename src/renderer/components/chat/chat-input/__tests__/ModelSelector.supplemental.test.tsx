// @ts-nocheck
/** @vitest-environment happy-dom */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { ModelSelector } from '../ModelSelector';
import { profileDataManager } from '@/lib/userData/profileDataManager';
import { useAvailableModels } from '@/lib/models/useAvailableModels';
import { getModelById, getModelCapabilities } from '@/lib/models/ghcModels';

const mockUpdateModel = vi.fn();
const mockUseAgentConfig = vi.fn();
const subscribeCallbacks: Array<(cache?: unknown) => void> = [];

vi.mock('@/lib/i18n/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key, language: 'en', setLanguage: vi.fn() })
}));

vi.mock('@/lib/models/ghcModels', () => ({
  getModelById: vi.fn(),
  getModelCapabilities: vi.fn(),
}));

vi.mock('../../../userData/userDataProvider', () => ({
  useAgentConfig: () => mockUseAgentConfig(),
}));

vi.mock('@/lib/userData/profileDataManager', () => ({
  profileDataManager: {
    getSelectedModel: vi.fn(),
    subscribe: vi.fn((cb: (cache?: unknown) => void) => {
      subscribeCallbacks.push(cb);
      return vi.fn();
    }),
  },
}));

vi.mock('@/lib/models/useAvailableModels', () => ({
  useAvailableModels: vi.fn(),
}));

vi.mock('@/lib/hooks/useScrollSelectedIntoView', () => ({
  useScrollSelectedIntoView: vi.fn(() => undefined),
}));

const models = [
  { id: 'gpt-4o', name: 'GPT-4o', capabilities: { family: 'gpt', supports: { tool_calls: true, vision: true } } },
  { id: 'gpt-4.1', name: 'GPT-4.1', capabilities: { family: 'gpt', supports: { tool_calls: true, vision: false } } },
];

function renderSelector(props: Partial<React.ComponentProps<typeof ModelSelector>> = {}) {
  return render(
    <ModelSelector
      currentChatId="chat-1"
      shouldLockComposeUi={false}
      setSupportsImages={vi.fn()}
      {...props}
    />,
  );
}

describe('ModelSelector supplemental coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    subscribeCallbacks.length = 0;
    vi.mocked(profileDataManager.getSelectedModel).mockReturnValue('gpt-4o');
    vi.mocked(useAvailableModels).mockReturnValue({ models } as any);
    vi.mocked(getModelCapabilities).mockReturnValue({ supportsImages: true } as any);
    vi.mocked(getModelById).mockImplementation((id: string) => models.find(model => model.id === id) as any);
    mockUpdateModel.mockResolvedValue({ success: true });
    mockUseAgentConfig.mockReturnValue({ updateModel: mockUpdateModel, isLoading: false });
  });

  it('closes the dropdown when clicking outside the selector', async () => {
    renderSelector();
    await userEvent.click(screen.getByTitle('chat.model.selectAiModel'));
    expect(screen.getByText('GPT-4.1')).toBeInTheDocument();

    fireEvent.mouseDown(document.body);
    await waitFor(() => {
      expect(screen.queryByText('GPT-4.1')).toBeNull();
    });
  });

  it('ignores subscription updates when there is no current chat id', () => {
    renderSelector({ currentChatId: null });
    expect(subscribeCallbacks).toHaveLength(1);

    subscribeCallbacks[0]();
    expect(profileDataManager.getSelectedModel).not.toHaveBeenCalledWith(null);
  });

  it('applies a subscribed model change and clears the pending selection', async () => {
    const user = userEvent.setup();
    renderSelector();

    await user.click(screen.getByTitle('chat.model.selectAiModel'));
    await user.click(screen.getByText('GPT-4.1'));
    expect(mockUpdateModel).toHaveBeenCalledWith('gpt-4.1');

    vi.mocked(profileDataManager.getSelectedModel).mockReturnValue('gpt-4.1');
    subscribeCallbacks[0]();

    await waitFor(() => {
      expect(screen.getByText('GPT-4.1')).toBeInTheDocument();
    });
  });

  it('returns early when an option click happens while loading is true', async () => {
    const { rerender } = renderSelector();
    fireEvent.click(screen.getByTitle('chat.model.selectAiModel'));

    mockUseAgentConfig.mockReturnValue({ updateModel: mockUpdateModel, isLoading: true });
    rerender(
      <ModelSelector currentChatId="chat-1" shouldLockComposeUi={false} setSupportsImages={vi.fn()} />,
    );

    const option = screen.getByText('GPT-4.1').closest('button') as HTMLButtonElement;
    option.disabled = false;
    fireEvent.click(option);

    expect(mockUpdateModel).not.toHaveBeenCalled();
  });
});
