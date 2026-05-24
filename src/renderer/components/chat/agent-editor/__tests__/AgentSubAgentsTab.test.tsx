/**
 * @vitest-environment happy-dom
 */

/**
 * AgentSubAgentsTab component tests
 *
 * Validates the Phase 5 Sub-Agent selection tab:
 * - Normal rendering of sub-agent card list
 * - Empty state (no available sub-agents)
 * - Loading state
 * - Checkbox toggle select and deselect
 * - onDataChange notification channel
 * - readOnly mode
 * - Navigation to settings page
 */

import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import type { AgentConfig, TabComponentProps } from '../types';

// ========== Mocks ==========

// Mock CSS imports (Jest cannot parse CSS files)
vi.mock('../../../../styles/Agent.css', async () => ({}));

const mockNavigate = vi.fn();
const mockLocation = { pathname: '/agent/chat/123/settings/sub_agents' };

vi.mock('react-router-dom', async () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => mockLocation,
}));

vi.mock('lucide-react', async () => ({
  Settings: () => <span data-testid="settings-icon">⚙</span>,
}));

// Mock useSubAgents
const mockUseSubAgents = vi.fn();
vi.mock('../../../userData/userDataProvider', async () => ({
  useSubAgents: () => mockUseSubAgents(),
}));

// Import component AFTER all vitest.mock calls so mocks are registered
import AgentSubAgentsTab from '../AgentSubAgentsTab';

// ========== Helpers ==========

function createSubAgentEntry(overrides: Record<string, unknown> = {}) {
  return {
    name: 'web-researcher',
    display_name: 'Web Researcher',
    description: 'Searches the web for information',
    emoji: '🔍',
    version: '1.0.0',
    source: 'ON-DEVICE' as const,
    context_access: 'isolated',
    system_prompt: 'You are a web researcher.',
    mcp_servers: [],
    skills: [],
    builtin_tools: [],
    max_turns: 25,
    ...overrides,
  };
}

function createAgentData(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    id: 'agent-001',
    name: 'Test Agent',
    emoji: '🧪',
    role: 'General assistant',
    model: 'gpt-4o',
    mcpServers: [],
    systemPrompt: 'You are a test agent.',
    subAgents: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function renderTab(propsOverride: Partial<TabComponentProps> = {}) {
  const defaultProps: TabComponentProps = {
    mode: 'update',
    agentId: 'agent-001',
    agentData: createAgentData(),
    onSave: vi.fn().mockResolvedValue(createAgentData()),
    onDataChange: vi.fn(),
    cachedData: null,
    readOnly: false,
    ...propsOverride,
  };
  return { ...render(<AgentSubAgentsTab {...defaultProps} />), props: defaultProps };
}

// ========== Tests ==========

describe('AgentSubAgentsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: two available sub-agents, not loading
    mockUseSubAgents.mockReturnValue({
      subAgents: [
        createSubAgentEntry(),
        createSubAgentEntry({
          name: 'code-reviewer',
          display_name: 'Code Reviewer',
          description: 'Reviews code and suggests improvements',
          emoji: '🔎',
          version: '2.0.0',
          source: 'ON-DEVICE',
          context_access: 'full',
        }),
      ],
      stats: { total: 2, library: 1, device: 1 },
      getSubAgentByName: vi.fn(),
      isLoading: false,
    });
  });

  // ========== Loading ==========

  describe('loading state', () => {
    it('should show loading spinner when isLoading is true', () => {
      mockUseSubAgents.mockReturnValue({
        subAgents: [],
        stats: { total: 0, library: 0, device: 0 },
        getSubAgentByName: vi.fn(),
        isLoading: true,
      });
      renderTab();
      expect(screen.getByText('Loading Sub-Agents...')).toBeInTheDocument();
    });
  });

  // ========== Empty state ==========

  describe('empty state', () => {
    it('should show empty state when no sub-agents available', () => {
      mockUseSubAgents.mockReturnValue({
        subAgents: [],
        stats: { total: 0, library: 0, device: 0 },
        getSubAgentByName: vi.fn(),
        isLoading: false,
      });
      renderTab();
      expect(screen.getByText('No available Sub-Agents to select')).toBeInTheDocument();
    });

    it('should show "Go to Manage Available Sub-Agents" button in empty state', () => {
      mockUseSubAgents.mockReturnValue({
        subAgents: [],
        stats: { total: 0, library: 0, device: 0 },
        getSubAgentByName: vi.fn(),
        isLoading: false,
      });
      renderTab();
      expect(screen.getByText('Go to Manage Available Sub-Agents')).toBeInTheDocument();
    });
  });

  // ========== Rendering ==========

  describe('rendering sub-agent cards', () => {
    it('should render all available sub-agents', () => {
      renderTab();
      expect(screen.getByText('Web Researcher')).toBeInTheDocument();
      expect(screen.getByText('Code Reviewer')).toBeInTheDocument();
    });

    it('should render emoji for each sub-agent', () => {
      renderTab();
      expect(screen.getByText('🔍')).toBeInTheDocument();
      expect(screen.getByText('🔎')).toBeInTheDocument();
    });

    it('should render version with v prefix', () => {
      renderTab();
      expect(screen.getByText('v1.0.0')).toBeInTheDocument();
      expect(screen.getByText('v2.0.0')).toBeInTheDocument();
    });

    it('should render descriptions', () => {
      renderTab();
      expect(screen.getByText('Searches the web for information')).toBeInTheDocument();
      expect(screen.getByText('Reviews code and suggests improvements')).toBeInTheDocument();
    });

    it('should render context_access text', () => {
      renderTab();
      expect(screen.getByText('isolated')).toBeInTheDocument();
      expect(screen.getByText('full')).toBeInTheDocument();
    });

    it('should show header with "0 selected" initially', () => {
      renderTab();
      expect(screen.getByText(/0 selected/)).toBeInTheDocument();
    });

    it('should show "Manage Available Sub-Agents" button in header', () => {
      renderTab();
      expect(screen.getByText('Manage Available Sub-Agents')).toBeInTheDocument();
    });
  });

  // ========== Selection ==========

  describe('selection', () => {
    it('should have all checkboxes unchecked initially when agent has no subAgents', () => {
      renderTab();
      const checkboxes = screen.getAllByRole('checkbox');
      checkboxes.forEach((cb) => expect(cb).not.toBeChecked());
    });

    it('should have checkboxes checked for pre-selected subAgents', () => {
      renderTab({
        agentData: createAgentData({ subAgents: ['web-researcher'] }),
      });
      const checkboxes = screen.getAllByRole('checkbox');
      // First checkbox (web-researcher) should be checked
      expect(checkboxes[0]).toBeChecked();
      expect(checkboxes[1]).not.toBeChecked();
    });

    it('should toggle checkbox on card click', () => {
      renderTab();
      const checkboxes = screen.getAllByRole('checkbox');
      expect(checkboxes[0]).not.toBeChecked();

      // Click the card
      const card = screen.getByText('Web Researcher').closest('.skill-card');
      if (card) {
        fireEvent.click(card);
      }

      expect(checkboxes[0]).toBeChecked();
    });

    it('should toggle checkbox on checkbox click', () => {
      renderTab();
      const checkboxes = screen.getAllByRole('checkbox');
      expect(checkboxes[0]).not.toBeChecked();

      fireEvent.click(checkboxes[0]);
      expect(checkboxes[0]).toBeChecked();
    });

    it('should uncheck checkbox on second click', () => {
      renderTab({
        agentData: createAgentData({ subAgents: ['web-researcher'] }),
      });
      const checkboxes = screen.getAllByRole('checkbox');
      expect(checkboxes[0]).toBeChecked();

      const card = screen.getByText('Web Researcher').closest('.skill-card');
      if (card) {
        fireEvent.click(card);
      }

      expect(checkboxes[0]).not.toBeChecked();
    });

    it('should show selected count in header after selecting', () => {
      renderTab({
        agentData: createAgentData({ subAgents: ['web-researcher', 'code-reviewer'] }),
      });
      expect(screen.getByText(/2 selected/)).toBeInTheDocument();
    });
  });

  // ========== onDataChange notification ==========

  describe('onDataChange notification', () => {
    it('should call onDataChange with initial data on mount', async () => {
      const onDataChange = vi.fn();
      renderTab({
        onDataChange,
        agentData: createAgentData({ subAgents: ['web-researcher'] }),
      });

      // useEffect runs after render — wait for it
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });

      expect(onDataChange).toHaveBeenCalledWith(
        'sub_agents',
        expect.objectContaining({ subAgents: expect.any(Array) }),
        expect.any(Boolean),
      );
    });

    it('should report hasChanges=true when selection differs from initial', async () => {
      const onDataChange = vi.fn();
      renderTab({
        onDataChange,
        agentData: createAgentData({ subAgents: [] }),
      });

      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });

      // Toggle a sub-agent
      const checkboxes = screen.getAllByRole('checkbox');
      await act(async () => {
        fireEvent.click(checkboxes[0]);
        await new Promise((r) => setTimeout(r, 0));
      });

      // Should have been called with hasChanges=true after selection
      const calls = onDataChange.mock.calls;
      const lastCall = calls[calls.length - 1];
      expect(lastCall[0]).toBe('sub_agents');
      expect(lastCall[2]).toBe(true); // hasChanges
    });
  });

  // ========== readOnly ==========

  describe('readOnly mode', () => {
    it('should disable checkboxes when readOnly is true', () => {
      renderTab({ readOnly: true });
      const checkboxes = screen.getAllByRole('checkbox');
      checkboxes.forEach((cb) => expect(cb).toBeDisabled());
    });

    it('should not toggle on card click when readOnly is true', () => {
      renderTab({ readOnly: true });
      const checkboxes = screen.getAllByRole('checkbox');
      expect(checkboxes[0]).not.toBeChecked();

      const card = screen.getByText('Web Researcher').closest('.skill-card');
      if (card) {
        fireEvent.click(card);
      }

      expect(checkboxes[0]).not.toBeChecked();
    });
  });

  // ========== Navigation ==========

  describe('navigation', () => {
    it('should navigate to /settings/sub-agents when Manage button clicked', () => {
      renderTab();
      const manageBtn = screen.getByText('Manage Available Sub-Agents');
      fireEvent.click(manageBtn);
      expect(mockNavigate).toHaveBeenCalledWith('/settings/sub-agents');
    });

    it('should store current path in sessionStorage before navigating', () => {
      renderTab();
      const manageBtn = screen.getByText('Manage Available Sub-Agents');
      fireEvent.click(manageBtn);
      expect(sessionStorage.getItem('previousPath')).toBe(mockLocation.pathname);
    });
  });

  // ========== cachedData ==========

  describe('cachedData priority', () => {
    it('should prefer cachedData over agentData for selection', () => {
      renderTab({
        agentData: createAgentData({ subAgents: ['web-researcher'] }),
        cachedData: { subAgents: ['code-reviewer'] },
      });
      const checkboxes = screen.getAllByRole('checkbox');
      // cachedData selects code-reviewer (index 1), not web-researcher (index 0)
      expect(checkboxes[0]).not.toBeChecked();
      expect(checkboxes[1]).toBeChecked();
    });
  });
});
