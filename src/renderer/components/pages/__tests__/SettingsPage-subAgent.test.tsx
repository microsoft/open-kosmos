/**
 * @vitest-environment happy-dom
 */

/**
 * SettingsPage Sub-Agent integration tests
 *
 * Tests sub-agent related functionality in SettingsPage:
 * - settingsContext includes sub-agent handlers
 * - Custom event listeners and state updates (subAgent:delete, subAgents:applyToAgents)
 * - Sub-agent menu toggle logic
 */

import React from 'react';
import { render, act, waitFor } from '@testing-library/react';

// Mock dependencies
const mockNavigate = vi.fn();
const mockLocation = { pathname: '/settings/sub-agents', state: null };
vi.mock('react-router-dom', async () => ({
  ...await vi.importActual('react-router-dom'),
  useNavigate: () => mockNavigate,
  useLocation: () => mockLocation,
  Outlet: (props: any) => {
    // Capture the context passed to Outlet
    const context = props.context || {};
    return <div data-testid="outlet" data-context={JSON.stringify({
      hasSubAgentMenuToggle: typeof context.onSubAgentMenuToggle === 'function',
      hasSubAgentMenuState: !!context.subAgentMenuState,
    })} />;
  },
}));

// Mock SettingsNavigation
vi.mock('../../settings/SettingsNavigation', async () => ({
  default: function MockSettingsNavigation() {
    return <div data-testid="settings-navigation" />;
  },
}));

// Mock floating menus to avoid complex rendering
vi.mock('../../menu', async () => ({
  McpServerDropdownMenu: () => null,
  McpAddMenuDropdown: () => null,
  SkillsAddMenuDropdown: () => null,
  SkillDropdownMenu: () => null,
}));

vi.mock('../../skills/ApplySkillToAgentsDialog', async () => ({
  default: function MockApplySkillDialog() {
    return null;
  },
}));

vi.mock('../../subAgents/SubAgentDropdownMenu', async () => ({
  default: function MockSubAgentDropdownMenu(props: any) {
    return <div data-testid="sub-agent-dropdown" data-name={props.subAgentName} />;
  },
}));

vi.mock('../../subAgents/ApplySubAgentToAgentsDialog', async () => ({
  default: function MockApplySubAgentDialog(props: any) {
    return <div data-testid="apply-sub-agent-dialog" data-open={props.open} data-name={props.subAgentName} />;
  },
}));

// Mock hooks
vi.mock('../../userData/userDataProvider', async () => ({
  useProfileData: () => ({
    chats: [
      {
        chatId: 'chat-1',
        agent: { name: 'Agent A', sub_agents: ['web-researcher'] },
      },
      {
        chatId: 'chat-2',
        agent: { name: 'Agent B', sub_agents: [] },
      },
    ],
  }),
  useChats: () => ({
    chats: [],
  }),
  useProfileDataRefresh: () => vi.fn(),
}));

vi.mock('../../ui/ToastProvider', async () => ({
  useToast: () => ({
    showSuccess: vi.fn(),
    showError: vi.fn(),
  }),
}));

vi.mock('../../ui/dialog', async () => ({
  Dialog: ({ children, open }: any) => open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <div>{children}</div>,
  DialogDescription: ({ children }: any) => <div>{children}</div>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
}));

// Mock CSS imports
vi.mock('../../../styles/ContentView.css', async () => ({}));
vi.mock('../../../styles/DropdownMenu.css', async () => ({}));

import SettingsPage from '../SettingsPage';

describe('SettingsPage - Sub-Agent Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ========== Context Propagation ==========

  describe('settingsContext sub-agent fields', () => {
    it('should pass onSubAgentMenuToggle in settings context', () => {
      const { getByTestId } = render(<SettingsPage />);
      const outlet = getByTestId('outlet');
      const context = JSON.parse(outlet.getAttribute('data-context') || '{}');
      expect(context.hasSubAgentMenuToggle).toBe(true);
    });

    it('should pass subAgentMenuState in settings context', () => {
      const { getByTestId } = render(<SettingsPage />);
      const outlet = getByTestId('outlet');
      const context = JSON.parse(outlet.getAttribute('data-context') || '{}');
      expect(context.hasSubAgentMenuState).toBe(true);
    });
  });

  // ========== Custom Event: subAgents:applyToAgents ==========

  describe('subAgents:applyToAgents event', () => {
    it('should show apply dialog when subAgents:applyToAgents event dispatched', async () => {
      const { getByTestId } = render(<SettingsPage />);

      act(() => {
        window.dispatchEvent(new CustomEvent('subAgents:applyToAgents', {
          detail: { subAgentName: 'web-researcher' },
        }));
      });

      await waitFor(() => {
        const dialog = getByTestId('apply-sub-agent-dialog');
        expect(dialog.getAttribute('data-open')).toBe('true');
        expect(dialog.getAttribute('data-name')).toBe('web-researcher');
      });
    });
  });

  // ========== Custom Event: subAgent:delete ==========

  describe('subAgent:delete event', () => {
    it('should show delete confirmation dialog when subAgent:delete event dispatched', async () => {
      const { getByTestId } = render(<SettingsPage />);

      act(() => {
        window.dispatchEvent(new CustomEvent('subAgent:delete', {
          detail: { subAgentName: 'web-researcher' },
        }));
      });

      // The delete dialog should show
      await waitFor(() => {
        const dialog = getByTestId('dialog');
        expect(dialog).toBeInTheDocument();
      });
    });
  });

  // ========== Rendering ==========

  describe('rendering', () => {
    it('should render SettingsNavigation', () => {
      const { getByTestId } = render(<SettingsPage />);
      expect(getByTestId('settings-navigation')).toBeInTheDocument();
    });

    it('should render Outlet for child routes', () => {
      const { getByTestId } = render(<SettingsPage />);
      expect(getByTestId('outlet')).toBeInTheDocument();
    });

    it('should render ApplySubAgentToAgentsDialog (initially closed)', () => {
      const { getByTestId } = render(<SettingsPage />);
      const dialog = getByTestId('apply-sub-agent-dialog');
      expect(dialog.getAttribute('data-open')).toBe('false');
    });
  });
});
