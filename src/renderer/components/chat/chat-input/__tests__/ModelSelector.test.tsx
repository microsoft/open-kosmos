/**
 * @vitest-environment happy-dom
 */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';

// ── Hoisted variables ──────────────────────────────────────────────────────

const { mockUpdateModel, mockUseAgentConfig } = vi.hoisted(() => ({
  mockUpdateModel: vi.fn(),
  mockUseAgentConfig: vi.fn(),
}));

// ── Mocks ──────────────────────────────────────────────────────────────────

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
    subscribe: vi.fn(),
  },
}));

vi.mock('@/lib/models/useAvailableModels', () => ({
  useAvailableModels: vi.fn(),
}));

vi.mock('@/lib/hooks/useScrollSelectedIntoView', () => ({
  useScrollSelectedIntoView: vi.fn(),
}));

// ── Imports (after mocks) ──────────────────────────────────────────────────

import { getModelById, getModelCapabilities } from '@/lib/models/ghcModels';
import { profileDataManager } from '@/lib/userData/profileDataManager';
import { useAvailableModels } from '@/lib/models/useAvailableModels';
import { useScrollSelectedIntoView } from '@/lib/hooks/useScrollSelectedIntoView';
import { ModelSelector } from '../ModelSelector';

// ── Helpers ────────────────────────────────────────────────────────────────

const fakeModels = [
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    capabilities: {
      family: 'gpt',
      supports: { tool_calls: true, vision: true },
    },
  },
  {
    id: 'gpt-4.1',
    name: 'GPT-4.1',
    capabilities: {
      family: 'gpt',
      supports: { tool_calls: true, vision: false },
    },
  },
];

// ── Tests ──────────────────────────────────────────────────────────────────

describe('ModelSelector', () => {
  const setSupportsImages = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(profileDataManager.getSelectedModel).mockReturnValue('gpt-4o');
    vi.mocked(profileDataManager.subscribe).mockReturnValue(vi.fn());
    mockUseAgentConfig.mockReturnValue({ updateModel: mockUpdateModel, isLoading: false });
    vi.mocked(useAvailableModels).mockReturnValue({ models: fakeModels } as any);
    vi.mocked(getModelCapabilities).mockReturnValue({ supportsImages: true } as any);
    vi.mocked(getModelById).mockReturnValue(fakeModels[0] as any);
    vi.mocked(useScrollSelectedIntoView).mockReturnValue(undefined as any);
    mockUpdateModel.mockResolvedValue({ success: true });
  });

  function renderSelector(props?: Partial<React.ComponentProps<typeof ModelSelector>>) {
    return render(
      <ModelSelector
        currentChatId="chat-1"
        shouldLockComposeUi={false}
        setSupportsImages={setSupportsImages}
        {...props}
      />,
    );
  }

  it('renders the current model name', () => {
    renderSelector();
    expect(screen.getByText('GPT-4o')).toBeTruthy();
  });

  it('renders "Select Model" when getModelById returns nothing', () => {
    vi.mocked(getModelById).mockReturnValue(undefined as any);
    renderSelector();
    expect(screen.getByText('Select Model')).toBeTruthy();
  });

  it('shows dropdown on button click', () => {
    renderSelector();
    expect(screen.queryByText('GPT-4.1')).toBeNull();
    fireEvent.click(screen.getByTitle('Select AI Model'));
    expect(screen.getByText('GPT-4.1')).toBeTruthy();
  });

  it('hides dropdown after second button click', () => {
    renderSelector();
    const btn = screen.getByTitle('Select AI Model');
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(screen.queryByText('GPT-4.1')).toBeNull();
  });

  it('calls updateModel on model option click', async () => {
    renderSelector();
    fireEvent.click(screen.getByTitle('Select AI Model'));
    await act(async () => {
      fireEvent.click(screen.getByText('GPT-4.1'));
    });
    expect(mockUpdateModel).toHaveBeenCalledWith('gpt-4.1');
  });

  it('does not call updateModel when isLoading=true', () => {
    mockUseAgentConfig.mockReturnValue({ updateModel: mockUpdateModel, isLoading: true });
    renderSelector();
    // The button is disabled when isLoading, so dropdown cannot be opened
    expect((screen.getByTitle('Select AI Model') as HTMLButtonElement).disabled).toBe(true);
    expect(mockUpdateModel).not.toHaveBeenCalled();
  });

  it('disables button when shouldLockComposeUi=true', () => {
    renderSelector({ shouldLockComposeUi: true });
    expect((screen.getByTitle('Select AI Model') as HTMLButtonElement).disabled).toBe(true);
  });

  it('calls setSupportsImages with false when model has no capabilities', () => {
    vi.mocked(profileDataManager.getSelectedModel).mockReturnValue(null);
    vi.mocked(getModelCapabilities).mockReturnValue(null as any);
    renderSelector({ currentChatId: null });
    expect(setSupportsImages).toHaveBeenCalledWith(false);
  });

  it('calls setSupportsImages with true when model supports images', () => {
    vi.mocked(getModelCapabilities).mockReturnValue({ supportsImages: true } as any);
    renderSelector();
    expect(setSupportsImages).toHaveBeenCalledWith(true);
  });

  it('renders Reasoning badge for o3 family models', () => {
    vi.mocked(useAvailableModels).mockReturnValue({
      models: [
        {
          id: 'o3-mini',
          name: 'O3 Mini',
          capabilities: { family: 'o3', supports: { tool_calls: false, vision: false } },
        },
      ],
    } as any);
    renderSelector();
    fireEvent.click(screen.getByTitle('Select AI Model'));
    expect(screen.getByText('Reasoning')).toBeTruthy();
  });

  it('renders Tools badge for models with tool_calls', () => {
    renderSelector();
    fireEvent.click(screen.getByTitle('Select AI Model'));
    expect(screen.getAllByText('Tools').length).toBeGreaterThan(0);
  });

  it('renders Image badge for models with vision', () => {
    renderSelector();
    fireEvent.click(screen.getByTitle('Select AI Model'));
    expect(screen.getAllByText('Image').length).toBeGreaterThan(0);
  });

  it('clears pending model on failed updateModel and dropdown closes', async () => {
    mockUpdateModel.mockResolvedValue({ success: false });
    renderSelector();
    fireEvent.click(screen.getByTitle('Select AI Model'));
    await act(async () => {
      fireEvent.click(screen.getByText('GPT-4.1'));
    });
    expect(mockUpdateModel).toHaveBeenCalled();
    // Dropdown should be closed
    expect(screen.queryByText('GPT-4.1')).toBeNull();
  });
});
