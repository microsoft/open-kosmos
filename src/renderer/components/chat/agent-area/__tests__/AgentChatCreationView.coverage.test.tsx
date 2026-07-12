// @ts-nocheck
/**
 * @vitest-environment happy-dom
 * Coverage tests for AgentChatCreationView.tsx
 */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockNavigate = vi.hoisted(() => vi.fn());
const mockLocation = vi.hoisted(() => ({ state: null as any }));

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => mockLocation,
}));

vi.mock('../../../lib/utilities/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn() }),
}));

vi.mock('@/lib/i18n/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock('../AgentChatCreationHeaderView', () => ({
  default: ({ onBack }: { onBack: () => void }) => (
    <div data-testid="creation-header">
      <button onClick={onBack} data-testid="back-btn">back</button>
    </div>
  ),
}));

vi.mock('../../../styles/AgentChatCreation.css', () => ({}));

import AgentChatCreationView from '../AgentChatCreationView';

describe('AgentChatCreationView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLocation.state = null;
  });

  it('navigates to custom agent on button click', () => {
    render(<AgentChatCreationView />);
    const buttons = screen.getAllByRole('button');
    // The custom agent button (first creation-option-card)
    const customAgentBtn = buttons.find((b) => b.textContent?.includes('agent.create.customAgent'));
    fireEvent.click(customAgentBtn!);
    expect(mockNavigate).toHaveBeenCalledWith('/agent/chat/creation/custom-agent');
  });

  it('calls navigate(-1) on back button click', () => {
    render(<AgentChatCreationView />);
    fireEvent.click(screen.getByTestId('back-btn'));
    expect(mockNavigate).toHaveBeenCalledWith(-1);
  });

  it('updates refresh key when location.state.refresh is set', () => {
    mockLocation.state = { refresh: true };
    // Should render without error
    const { container } = render(<AgentChatCreationView />);
    expect(container.querySelector('.agent-creation-view')).toBeTruthy();
  });
});
