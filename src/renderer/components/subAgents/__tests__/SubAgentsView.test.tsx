/**
 * @vitest-environment happy-dom
 */

/**
 * SubAgentsView component tests
 *
 * Tests the correctness of the refactored CSS class layout (based on SkillsView):
 * - unified-header rendering (icon, title, Badge, + button)
 * - Empty state display (Create Custom button)
 * - List rendering (SubAgentListItem)
 * - Loading state
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

// Mock CSS imports
vi.mock('../../../styles/Header.css', async () => ({}));
vi.mock('../../../styles/SubAgentsView.css', async () => ({}));

// ──── Mocks ────

const mockNavigate = vi.fn();
const mockOnSubAgentsAddMenuToggle = vi.fn();
const mockOnSubAgentMenuToggle = vi.fn();
const mockRefresh = vi.fn().mockResolvedValue(undefined);

vi.mock('react-router-dom', async () => ({
  ...await vi.importActual('react-router-dom'),
  useNavigate: () => mockNavigate,
  useOutletContext: () => ({
    sidepaneWidth: 300,
    setSidepaneWidth: vi.fn(),
    isDragging: false,
    onSubAgentsAddMenuToggle: mockOnSubAgentsAddMenuToggle,
    onSubAgentMenuToggle: mockOnSubAgentMenuToggle,
  }),
}));

// Mock SubAgentListItem to simplify tests
vi.mock('../SubAgentListItem', async () => ({
  default: function MockSubAgentListItem(props: any) {
    return (
      <div data-testid={`sub-agent-item-${props.config.name}`} onClick={props.onClick}>
        {props.config.name}
      </div>
    );
  },
}));

const mockUseSubAgents = vi.fn();
vi.mock('../../userData/userDataProvider', async () => ({
  useSubAgents: () => mockUseSubAgents(),
  useMCPServers: () => ({ servers: [] }),
  useSkills: () => ({ skills: [] }),
  useProfileDataRefresh: () => ({ refresh: mockRefresh }),
}));

vi.mock('../../ui/ToastProvider', async () => ({
  useToast: () => ({
    showSuccess: vi.fn(),
    showError: vi.fn(),
  }),
}));

vi.mock('../../ui/badge', async () => ({
  Badge: ({ children, ...props }: any) => <span data-testid="badge" {...props}>{children}</span>,
}));

import SubAgentsView from '../SubAgentsView';

describe('SubAgentsView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ========== Layout Structure ==========

  describe('layout structure', () => {
    it('should render .sub-agents-view root container', () => {
      mockUseSubAgents.mockReturnValue({ subAgents: [], stats: { total: 0 }, isLoading: false });
      const { container } = render(<SubAgentsView />);
      expect(container.querySelector('.sub-agents-view')).toBeInTheDocument();
    });

    it('should render .unified-header', () => {
      mockUseSubAgents.mockReturnValue({ subAgents: [], stats: { total: 0 }, isLoading: false });
      const { container } = render(<SubAgentsView />);
      expect(container.querySelector('.unified-header')).toBeInTheDocument();
    });

    it('should render header name "Sub-Agents"', () => {
      mockUseSubAgents.mockReturnValue({ subAgents: [], stats: { total: 0 }, isLoading: false });
      render(<SubAgentsView />);
      expect(screen.getByText('Sub-Agents')).toBeInTheDocument();
    });

    it('should render Badge with total count', () => {
      mockUseSubAgents.mockReturnValue({ subAgents: [], stats: { total: 5 }, isLoading: false });
      render(<SubAgentsView />);
      expect(screen.getByText('available sub-agents: 5')).toBeInTheDocument();
    });

    it('should render .sub-agents-content-view', () => {
      mockUseSubAgents.mockReturnValue({ subAgents: [], stats: { total: 0 }, isLoading: false });
      const { container } = render(<SubAgentsView />);
      expect(container.querySelector('.sub-agents-content-view')).toBeInTheDocument();
    });
  });

  // ========== Loading State ==========

  describe('loading state', () => {
    it('should show loading spinner when isLoading is true', () => {
      mockUseSubAgents.mockReturnValue({ subAgents: [], stats: { total: 0 }, isLoading: true });
      const { container } = render(<SubAgentsView />);
      expect(container.querySelector('.sub-agent-list-loading')).toBeInTheDocument();
      expect(container.querySelector('.loading-spinner')).toBeInTheDocument();
    });
  });

  // ========== Empty State ==========

  describe('empty state', () => {
    it('should show empty state when no sub-agents', () => {
      mockUseSubAgents.mockReturnValue({ subAgents: [], stats: { total: 0 }, isLoading: false });
      const { container } = render(<SubAgentsView />);
      expect(container.querySelector('.sub-agents-empty-state')).toBeInTheDocument();
    });

    it('should show "No sub-agents configured yet." text', () => {
      mockUseSubAgents.mockReturnValue({ subAgents: [], stats: { total: 0 }, isLoading: false });
      render(<SubAgentsView />);
      expect(screen.getByText('No sub-agents configured yet.')).toBeInTheDocument();
    });

    it('should show Create Custom button that navigates to new', () => {
      mockUseSubAgents.mockReturnValue({ subAgents: [], stats: { total: 0 }, isLoading: false });
      render(<SubAgentsView />);

      const createBtn = screen.getByText('Create Custom');
      fireEvent.click(createBtn);
      expect(mockNavigate).toHaveBeenCalledWith('/settings/sub-agents/new');
    });
  });

  // ========== List Rendering ==========

  describe('list rendering', () => {
    const mockSubAgents: any[] = [
      { name: 'web-researcher', description: 'Searches web', system_prompt: '', mcp_servers: [], skills: [], builtin_tools: [] },
      { name: 'code-reviewer', description: 'Reviews code', system_prompt: '', mcp_servers: [], skills: [], builtin_tools: [] },
    ];

    it('should render .sub-agent-cards container', () => {
      mockUseSubAgents.mockReturnValue({ subAgents: mockSubAgents, stats: { total: 2 }, isLoading: false });
      const { container } = render(<SubAgentsView />);
      expect(container.querySelector('.sub-agent-cards')).toBeInTheDocument();
    });

    it('should render all sub-agents', () => {
      mockUseSubAgents.mockReturnValue({ subAgents: mockSubAgents, stats: { total: 2 }, isLoading: false });
      render(<SubAgentsView />);
      expect(screen.getByText('web-researcher')).toBeInTheDocument();
      expect(screen.getByText('code-reviewer')).toBeInTheDocument();
    });

    it('should not show empty state when sub-agents exist', () => {
      mockUseSubAgents.mockReturnValue({ subAgents: mockSubAgents, stats: { total: 2 }, isLoading: false });
      const { container } = render(<SubAgentsView />);
      expect(container.querySelector('.sub-agents-empty-state')).not.toBeInTheDocument();
    });
  });

  // ========== Header Actions ==========

  describe('header actions', () => {
    it('should render add button with title "Add Sub-Agent"', () => {
      mockUseSubAgents.mockReturnValue({ subAgents: [], stats: { total: 0 }, isLoading: false });
      render(<SubAgentsView />);
      expect(screen.getByTitle('Add Sub-Agent')).toBeInTheDocument();
    });

    it('should call onSubAgentsAddMenuToggle when add button is clicked', () => {
      mockUseSubAgents.mockReturnValue({ subAgents: [], stats: { total: 0 }, isLoading: false });
      render(<SubAgentsView />);

      const addBtn = screen.getByTitle('Add Sub-Agent');
      fireEvent.click(addBtn);
      expect(mockOnSubAgentsAddMenuToggle).toHaveBeenCalledTimes(1);
    });
  });

  // ========== Import from Claude Code ==========

  describe('import from Claude Code', () => {
    it('should render hidden file input', () => {
      mockUseSubAgents.mockReturnValue({ subAgents: [], stats: { total: 0 }, isLoading: false });
      const { container } = render(<SubAgentsView />);
      const fileInput = container.querySelector('input[type="file"][accept=".md"]');
      expect(fileInput).toBeInTheDocument();
      expect(fileInput).toHaveStyle({ display: 'none' });
    });

    it('should trigger file input click on subAgents:importFromClaudeCode event', () => {
      mockUseSubAgents.mockReturnValue({ subAgents: [], stats: { total: 0 }, isLoading: false });
      const { container } = render(<SubAgentsView />);
      const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
      const clickSpy = vi.spyOn(fileInput, 'click');

      window.dispatchEvent(new CustomEvent('subAgents:importFromClaudeCode'));
      expect(clickSpy).toHaveBeenCalledTimes(1);
    });
  });
});
