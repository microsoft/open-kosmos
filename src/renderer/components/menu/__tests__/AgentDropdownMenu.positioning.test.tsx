/**
 * @vitest-environment happy-dom
 */

import React from 'react';
import { render } from '@testing-library/react';
import { WithStore } from '@/atom';
import AgentDropdownMenu, { AgentMenuAtom } from '../AgentDropdownMenu';

const mockUseProfileData = vi.fn();

vi.mock('react-router-dom', async () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('../../ui/ToastProvider', async () => ({
  useToast: () => ({
    showSuccess: vi.fn(),
    showError: vi.fn(),
  }),
}));

vi.mock('../../userData/userDataProvider', async () => ({
  useProfileData: () => mockUseProfileData(),
}));

vi.mock('../../../lib/utilities/dropdownPosition', async () => ({
  adjustAnchoredDropdownToViewport: vi.fn(),
  getAnchoredDropdownPosition: vi.fn().mockImplementation((_el: HTMLElement, size: any) => ({
    top: 396,
    left: 60,
    triggerTop: 620,
    triggerBottom: 640,
    triggerRight: 300,
  })),
  ANCHORED_DROPDOWN_SIZE_PRESETS: { agentMenu: { estimatedWidth: 240, estimatedHeight: 300 } },
}));

describe('AgentDropdownMenu positioning', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockUseProfileData.mockReturnValue({
      chats: [
        {
          chat_id: 'chat-builtin',
          agent: {
            name: 'PM Agent',
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
  });

  it('renders the menu when atom state is open', () => {
    const anchorElement = document.createElement('button');
    document.body.appendChild(anchorElement);

    const Wrapper = () => {
      const actions = AgentMenuAtom.useChange();
      React.useEffect(() => {
        actions.toggle('chat-builtin', anchorElement);
      }, []);
      return <AgentDropdownMenu />;
    };

    try {
      const { container } = render(<WithStore><Wrapper /></WithStore>);
      const menu = container.querySelector('.agent-dropdown-menu') as HTMLDivElement | null;
      expect(menu).not.toBeNull();
    } finally {
      anchorElement.remove();
    }
  });
});
