/**
 * @vitest-environment happy-dom
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../../../styles/SubAgentsView.css', async () => ({}));
vi.mock('../../../styles/SubAgentModelSelect.css', async () => ({}));

const mockGetAllOpenKosmosUsedModels = vi.fn();
vi.mock('@/lib/models/ghcModels', async () => ({
  getAllOpenKosmosUsedModels: () => mockGetAllOpenKosmosUsedModels(),
}));

import SubAgentModelSelect from '../SubAgentModelSelect';

const backendModels = [
  {
    id: 'claude-sonnet-4.5',
    name: 'Claude Sonnet 4.5',
    capabilities: {
      family: 'claude',
      supports: { tool_calls: true, vision: false },
    },
  },
];

describe('SubAgentModelSelect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAllOpenKosmosUsedModels.mockReturnValue([]);
    (window as any).electronAPI = {
      models: {
        getAllOpenKosmosUsedModels: vi.fn().mockResolvedValue({ success: true, data: backendModels }),
      },
    };
  });

  afterEach(() => {
    delete (window as any).electronAPI;
  });

  it('always renders inherit as the default selection', async () => {
    render(<SubAgentModelSelect value="inherit" onChange={vi.fn()} />);

    // Wait for the initial async loadModels effect to settle so React state updates
    // are not flagged with the "wrap in act(...)" warning.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Inherit parent model/i })).toBeInTheDocument();
    });
  });

  it('loads models from backend when the renderer model cache is empty', async () => {
    render(<SubAgentModelSelect value="inherit" onChange={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /Inherit parent model/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Claude Sonnet 4.5/i })).toBeInTheDocument();
    });
    expect(window.electronAPI.models.getAllOpenKosmosUsedModels).toHaveBeenCalled();
  });

  it('selects backend-loaded model ids', async () => {
    const handleChange = vi.fn();
    render(<SubAgentModelSelect value="inherit" onChange={handleChange} />);

    fireEvent.click(screen.getByRole('button', { name: /Inherit parent model/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Claude Sonnet 4.5/i }));

    expect(handleChange).toHaveBeenCalledWith('claude-sonnet-4.5');
  });

  it('closes dropdown on outside click', async () => {
    render(
      <div>
        <SubAgentModelSelect value="inherit" onChange={vi.fn()} />
        <button data-testid="outside">Outside</button>
      </div>
    );

    // Open dropdown
    fireEvent.click(screen.getByRole('button', { name: /Inherit parent model/i }));
    // Wait for dropdown to appear
    await screen.findByRole('button', { name: /Claude Sonnet 4.5/i });

    // Click outside
    fireEvent.mouseDown(screen.getByTestId('outside'));

    // Dropdown should be gone
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Claude Sonnet 4.5/i })).not.toBeInTheDocument();
    });
  });

  it('shows current model option when value is not in available models', async () => {
    render(<SubAgentModelSelect value="custom-model-id" onChange={vi.fn()} />);

    // The button should display the raw model id
    expect(screen.getByRole('button', { name: /custom-model-id/i })).toBeInTheDocument();

    // Open dropdown
    fireEvent.click(screen.getByRole('button', { name: /custom-model-id/i }));

    await waitFor(() => {
      // The "Current" badge option should appear for the unknown model
      const currentBadges = screen.queryAllByText('Current');
      expect(currentBadges.length).toBeGreaterThan(0);
    });
  });

  it('selects the current (unknown) model option', async () => {
    const handleChange = vi.fn();
    render(<SubAgentModelSelect value="custom-model-id" onChange={handleChange} />);

    // Open the dropdown
    const toggleBtn = screen.getByRole('button', { name: /custom-model-id/i });
    fireEvent.click(toggleBtn);

    // Wait for the dropdown list to appear and find the Current badge option
    await waitFor(() => {
      const currentBadges = screen.queryAllByText('Current');
      expect(currentBadges.length).toBeGreaterThan(0);
    });

    // Click the model-option button that contains the current model
    const buttons = document.querySelectorAll('button.model-option');
    const currentBtn = Array.from(buttons).find(btn => btn.textContent?.includes('custom-model-id'));
    if (currentBtn) {
      fireEvent.click(currentBtn);
      expect(handleChange).toHaveBeenCalledWith('custom-model-id');
    }
  });
});
