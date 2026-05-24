/**
 * @vitest-environment happy-dom
 */
import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';

// ── Hoisted variables ──────────────────────────────────────────────────────

const { mockUpdateConfig, mockUseAgentConfig } = vi.hoisted(() => ({
  mockUpdateConfig: vi.fn(),
  mockUseAgentConfig: vi.fn(),
}));

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('@/lib/userData/profileDataManager', () => ({
  profileDataManager: {
    getSelectedModel: vi.fn(),
    subscribe: vi.fn(),
    getReasoningEffort: vi.fn(),
  },
}));

vi.mock('../../../userData/userDataProvider', () => ({
  useAgentConfig: () => mockUseAgentConfig(),
}));

vi.mock('@/lib/models/ghcModels', () => ({
  getModelCapabilities: vi.fn(),
}));

vi.mock('@/components/ui/use-click-out', () => ({
  useClickOut: vi.fn(),
}));

// ── Imports ────────────────────────────────────────────────────────────────

import { profileDataManager } from '@/lib/userData/profileDataManager';
import { getModelCapabilities } from '@/lib/models/ghcModels';
import { ReasoningEffortSelector } from '../ReasoningEffortSelector';

// ── Tests ──────────────────────────────────────────────────────────────────

describe('ReasoningEffortSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(profileDataManager.subscribe).mockReturnValue(vi.fn());
    vi.mocked((profileDataManager as any).getReasoningEffort).mockReturnValue(undefined);
    mockUseAgentConfig.mockReturnValue({ updateConfig: mockUpdateConfig, isLoading: false });
    mockUpdateConfig.mockResolvedValue({ success: true });
  });

  function renderSelector(modelId = 'o3-mini', efforts = ['low', 'medium', 'high']) {
    vi.mocked(profileDataManager.getSelectedModel).mockReturnValue(modelId);
    vi.mocked(getModelCapabilities).mockReturnValue({ reasoningEfforts: efforts } as any);
    return render(
      <ReasoningEffortSelector currentChatId="chat-1" shouldLockComposeUi={false} />,
    );
  }

  it('renders nothing when model has no reasoningEfforts', () => {
    vi.mocked(profileDataManager.getSelectedModel).mockReturnValue('gpt-4o');
    vi.mocked(getModelCapabilities).mockReturnValue({ reasoningEfforts: undefined } as any);
    const { container } = render(
      <ReasoningEffortSelector currentChatId="chat-1" shouldLockComposeUi={false} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when model has only one effort level', () => {
    vi.mocked(profileDataManager.getSelectedModel).mockReturnValue('o3-mini');
    vi.mocked(getModelCapabilities).mockReturnValue({ reasoningEfforts: ['high'] } as any);
    const { container } = render(
      <ReasoningEffortSelector currentChatId="chat-1" shouldLockComposeUi={false} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders button with default effort label for non-Claude model', () => {
    renderSelector('gpt-4o', ['low', 'medium', 'high']);
    // GPT default is 'medium'
    expect(screen.getByText('Medium (default)')).toBeTruthy();
  });

  it('renders button with default effort label for Claude model', () => {
    renderSelector('claude-sonnet', ['low', 'medium', 'high']);
    // Claude default is 'high'
    expect(screen.getByText('High (default)')).toBeTruthy();
  });

  it('opens dropdown when button is clicked', () => {
    renderSelector();
    // The dropdown opens on click — confirm 'Low' (non-default) is visible
    expect(screen.queryByText('Low')).toBeNull();
    fireEvent.click(screen.getByTitle('Reasoning effort'));
    expect(screen.getByText('Low')).toBeTruthy();
    expect(screen.getByText('High')).toBeTruthy();
    // Medium (default) appears in both button and dropdown item
    expect(screen.getAllByText(/Medium/i).length).toBeGreaterThan(0);
  });

  it('calls updateConfig with selected effort', async () => {
    renderSelector();
    fireEvent.click(screen.getByTitle('Reasoning effort'));
    await act(async () => {
      // 'Low' appears in the dropdown (not the button label)
      const lowOption = screen.getAllByText('Low')[0];
      fireEvent.click(lowOption);
    });
    expect(mockUpdateConfig).toHaveBeenCalledWith({ reasoningEffort: 'low' });
  });

  it('disables button when shouldLockComposeUi=true', () => {
    vi.mocked(profileDataManager.getSelectedModel).mockReturnValue('o3-mini');
    vi.mocked(getModelCapabilities).mockReturnValue({ reasoningEfforts: ['low', 'medium', 'high'] } as any);
    render(
      <ReasoningEffortSelector currentChatId="chat-1" shouldLockComposeUi={true} />,
    );
    expect((screen.getByTitle('Reasoning effort') as HTMLButtonElement).disabled).toBe(true);
  });

  it('reverts effort when updateConfig returns success=false', async () => {
    mockUpdateConfig.mockResolvedValue({ success: false });
    renderSelector('o3-mini', ['low', 'medium', 'high']);
    fireEvent.click(screen.getByTitle('Reasoning effort'));
    await act(async () => {
      const lowOption = screen.getAllByText('Low')[0];
      fireEvent.click(lowOption);
    });
    expect(mockUpdateConfig).toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByText('Medium (default)')).toBeTruthy();
    });
  });

  it('reverts effort when updateConfig throws', async () => {
    mockUpdateConfig.mockRejectedValue(new Error('network'));
    renderSelector('o3-mini', ['low', 'medium', 'high']);
    fireEvent.click(screen.getByTitle('Reasoning effort'));
    await act(async () => {
      const lowOption = screen.getAllByText('Low')[0];
      fireEvent.click(lowOption);
    });
    await waitFor(() => {
      expect(screen.getByText('Medium (default)')).toBeTruthy();
    });
  });

  it('renders nothing when currentChatId is null', () => {
    vi.mocked(profileDataManager.getSelectedModel).mockReturnValue(null);
    vi.mocked(getModelCapabilities).mockReturnValue({ reasoningEfforts: ['low', 'medium', 'high'] } as any);
    const { container } = render(
      <ReasoningEffortSelector currentChatId={null} shouldLockComposeUi={false} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('marks default effort with "(default)" text in dropdown', () => {
    renderSelector('gpt-4o', ['low', 'medium', 'high']);
    fireEvent.click(screen.getByTitle('Reasoning effort'));
    // In the dropdown, the default option item text includes "(default)"
    const allMedium = screen.getAllByText(/Medium/);
    const mediumWithDefault = allMedium.find(el => el.textContent?.includes('(default)'));
    expect(mediumWithDefault).toBeTruthy();
  });

  it('does not call updateConfig when same effort is already selected', async () => {
    vi.mocked((profileDataManager as any).getReasoningEffort).mockReturnValue('medium');
    renderSelector('o3-mini', ['low', 'medium', 'high']);
    fireEvent.click(screen.getByTitle('Reasoning effort'));
    await act(async () => {
      const mediumOptions = screen.getAllByText(/Medium/);
      fireEvent.click(mediumOptions[0]);
    });
    expect(mockUpdateConfig).not.toHaveBeenCalled();
  });
});
