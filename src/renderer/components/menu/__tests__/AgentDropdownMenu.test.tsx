/**
 * @vitest-environment happy-dom
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { WithStore } from '@/atom';

vi.mock('../../../lib/utilities/dropdownPosition', async () => ({
  adjustAnchoredDropdownToViewport: vi.fn(),
  getAnchoredDropdownPosition: vi.fn().mockReturnValue({ top: 0, left: 0, triggerTop: 0, triggerRight: 0 }),
  ANCHORED_DROPDOWN_SIZE_PRESETS: { agentMenu: { estimatedWidth: 200, estimatedHeight: 300 } },
}));

const mockNavigate = vi.fn();
const mockShowSuccess = vi.fn();
const mockShowError = vi.fn();
const mockUseProfileData = vi.fn();

vi.mock('react-router-dom', async () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock('../../ui/ToastProvider', async () => ({
  useToast: () => ({
    showSuccess: mockShowSuccess,
    showError: mockShowError,
  }),
}));

vi.mock('../../userData/userDataProvider', async () => ({
  useProfileData: () => mockUseProfileData(),
}));

describe('AgentDropdownMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseProfileData.mockReturnValue({
      chats: [],
      data: {
        profile: {
          primaryAgent: 'Primary Agent',
        },
      },
    });
  });

  it('shows Duplicate for on-device agents and forwards the callback', async () => {
    const { default: AgentDropdownMenu, AgentMenuAtom: agentMenuAtom } = await import('../AgentDropdownMenu');
    const { DuplicateAgentAtom: duplicateAgentAtom } = await import('../../overlay/DuplicateAgentOverlay');

    let capturedState: any = null;
    const StateReader = () => {
      const [state] = duplicateAgentAtom.use();
      capturedState = state;
      return null;
    };

    mockUseProfileData.mockReturnValue({
      chats: [
        {
          chat_id: 'chat-on-device',
          agent: {
            name: 'Custom Agent',
            source: 'ON-DEVICE',
          },
        },
      ],
      data: {
        profile: {
          primaryAgent: 'Primary Agent',
        },
      },
    });

    const Wrapper = () => {
      const actions = agentMenuAtom.useChange();
      React.useEffect(() => {
        const btn = document.createElement('button');
        document.body.appendChild(btn);
        actions.toggle('chat-on-device', btn);
        return () => { document.body.removeChild(btn); };
      }, []);
      return (
        <>
          <AgentDropdownMenu />
          <StateReader />
        </>
      );
    };

    render(<WithStore><Wrapper /></WithStore>);

    fireEvent.click(screen.getByRole('menuitem', { name: 'Duplicate' }));

    expect(capturedState.isOpen).toBe(true);
    expect(capturedState.chatId).toBe('chat-on-device');
    expect(capturedState.agentName).toBe('Custom Agent');
  });

  it('shows Duplicate for built-in agents and forwards the callback', async () => {
    const { default: AgentDropdownMenu, AgentMenuAtom: agentMenuAtom } = await import('../AgentDropdownMenu');
    const { DuplicateAgentAtom: duplicateAgentAtom } = await import('../../overlay/DuplicateAgentOverlay');

    let capturedState: any = null;
    const StateReader = () => {
      const [state] = duplicateAgentAtom.use();
      capturedState = state;
      return null;
    };

    mockUseProfileData.mockReturnValue({
      chats: [
        {
          chat_id: 'chat-builtin',
          agent: {
            name: 'Kobi',
            source: 'ON-DEVICE',
          },
        },
      ],
      data: {
        profile: {
          primaryAgent: 'Primary Agent',
        },
      },
    });

    const Wrapper = () => {
      const actions = agentMenuAtom.useChange();
      React.useEffect(() => {
        const btn = document.createElement('button');
        document.body.appendChild(btn);
        actions.toggle('chat-builtin', btn);
        return () => { document.body.removeChild(btn); };
      }, []);
      return (
        <>
          <AgentDropdownMenu />
          <StateReader />
        </>
      );
    };

    render(<WithStore><Wrapper /></WithStore>);

    fireEvent.click(screen.getByRole('menuitem', { name: 'Duplicate' }));

    expect(capturedState.isOpen).toBe(true);
    expect(capturedState.chatId).toBe('chat-builtin');
    expect(capturedState.agentName).toBe('Kobi');
  });
});
