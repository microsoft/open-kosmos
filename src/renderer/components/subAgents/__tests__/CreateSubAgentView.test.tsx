/**
 * @vitest-environment happy-dom
 */

/**
 * CreateSubAgentView component tests
 *
 * Tests the correctness of the refactored CSS class layout (based on SkillsView):
 * - unified-header rendering (back button + title "Create Sub-Agent")
 * - Form field rendering (name, description, system_prompt, model, mcp_servers, skills)
 * - Capabilities section (MCP Servers + inherit toggle, Skills + inherit toggle)
 * - Form validation
 * - Form submission
 * - Cancel navigation
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Mock CSS imports
vi.mock('../../../styles/Header.css', async () => ({}));
vi.mock('../../../styles/SubAgentsView.css', async () => ({}));

// ──── Mocks ────

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => ({
  ...await vi.importActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}));

const mockShowSuccess = vi.fn();
const mockShowError = vi.fn();
vi.mock('../../ui/ToastProvider', async () => ({
  useToast: () => ({
    showSuccess: mockShowSuccess,
    showError: mockShowError,
  }),
}));

const mockRefresh = vi.fn().mockResolvedValue(undefined);
const mockUseMCPServers = vi.fn();
const mockUseSkills = vi.fn();
const mockOpenKosmosModels = vi.hoisted(() => [
  {
    id: 'claude-sonnet-4.5',
    name: 'Claude Sonnet 4.5',
    capabilities: {
      family: 'claude',
      supports: { tool_calls: true, vision: false },
    },
  },
  {
    id: 'gpt-4.1',
    name: 'GPT-4.1',
    capabilities: {
      family: 'gpt',
      supports: { tool_calls: true, vision: true },
    },
  },
]);
vi.mock('../../userData/userDataProvider', async () => ({
  useProfileDataRefresh: () => ({ refresh: mockRefresh }),
  useMCPServers: () => mockUseMCPServers(),
  useSkills: () => mockUseSkills(),
}));
vi.mock('@/lib/models/ghcModels', async () => ({
  getAllOpenKosmosUsedModels: () => mockOpenKosmosModels,
}));

import CreateSubAgentView from '../CreateSubAgentView';

describe('CreateSubAgentView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseMCPServers.mockReturnValue({ servers: [], isLoading: false });
    mockUseSkills.mockReturnValue({ skills: [], isLoading: false });
    // Ensure electronAPI mock is present
    (window as any).electronAPI = {
      subAgent: {
        add: vi.fn().mockResolvedValue({ success: true }),
      },
    };
  });

  afterEach(() => {
    delete (window as any).electronAPI;
  });

  // ========== Layout Structure ==========

  describe('layout structure', () => {
    it('should render .sub-agent-form-view root container', () => {
      const { container } = render(<CreateSubAgentView />);
      expect(container.querySelector('.sub-agent-form-view')).toBeInTheDocument();
    });

    it('should render .unified-header', () => {
      const { container } = render(<CreateSubAgentView />);
      expect(container.querySelector('.unified-header')).toBeInTheDocument();
    });

    it('should render header name "Create Sub-Agent"', () => {
      const { container } = render(<CreateSubAgentView />);
      const headerName = container.querySelector('.header-name');
      expect(headerName).toBeInTheDocument();
      expect(headerName?.textContent).toBe('Create Sub-Agent');
    });

    it('should render back button with title "Back"', () => {
      render(<CreateSubAgentView />);
      expect(screen.getByTitle('Back')).toBeInTheDocument();
    });

    it('should navigate to /settings/sub-agents when back button is clicked', () => {
      render(<CreateSubAgentView />);
      fireEvent.click(screen.getByTitle('Back'));
      expect(mockNavigate).toHaveBeenCalledWith('/settings/sub-agents');
    });

    it('should render .sub-agent-form-content (scrollable area)', () => {
      const { container } = render(<CreateSubAgentView />);
      expect(container.querySelector('.sub-agent-form-content')).toBeInTheDocument();
    });

    it('should render .sub-agent-form-inner', () => {
      const { container } = render(<CreateSubAgentView />);
      expect(container.querySelector('.sub-agent-form-inner')).toBeInTheDocument();
    });
  });

  // ========== Form Fields ==========

  describe('form fields', () => {
    it('should render Name field with placeholder', () => {
      render(<CreateSubAgentView />);
      expect(screen.getByPlaceholderText('e.g., web-researcher')).toBeInTheDocument();
    });

    it('should render Description textarea', () => {
      render(<CreateSubAgentView />);
      expect(screen.getByPlaceholderText('Describe what this sub-agent does...')).toBeInTheDocument();
    });

    it('should render System Prompt textarea', () => {
      render(<CreateSubAgentView />);
      expect(screen.getByPlaceholderText("Provide the system prompt that defines this sub-agent's behavior...")).toBeInTheDocument();
    });

    it('should render Model dropdown with inherit default', () => {
      render(<CreateSubAgentView />);
      expect(screen.getByRole('button', { name: /Inherit parent model/i })).toBeInTheDocument();
    });

    it('should render available models in Model dropdown', () => {
      render(<CreateSubAgentView />);

      fireEvent.click(screen.getByRole('button', { name: /Inherit parent model/i }));

      expect(screen.getByRole('button', { name: /Claude Sonnet 4.5/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /GPT-4.1/i })).toBeInTheDocument();
    });

  });

  // ========== Capabilities Section ==========

  describe('capabilities section', () => {
    it('should render Capabilities heading', () => {
      render(<CreateSubAgentView />);
      expect(screen.getByText('Capabilities')).toBeInTheDocument();
    });

    it('should render MCP Servers capability label', () => {
      render(<CreateSubAgentView />);
      expect(screen.getByText('MCP Servers')).toBeInTheDocument();
    });

    it('should render Skills capability label', () => {
      render(<CreateSubAgentView />);
      expect(screen.getByText('Skills')).toBeInTheDocument();
    });

    it('should show inherit hint when inherit_mcp_servers is checked', () => {
      render(<CreateSubAgentView />);
      expect(screen.getByText('All MCP servers will be inherited from the parent agent and cannot be changed individually.')).toBeInTheDocument();
    });

    it('should show empty MCP message when no servers configured', () => {
      render(<CreateSubAgentView />);
      expect(screen.getByText('No MCP servers configured. Add servers in Settings → MCP.')).toBeInTheDocument();
    });

    it('should show empty Skills message when no skills installed', () => {
      render(<CreateSubAgentView />);
      expect(screen.getByText('No skills installed. Add skills in Settings → Skills.')).toBeInTheDocument();
    });

    it('should render MCP servers list when servers exist', () => {
      mockUseMCPServers.mockReturnValue({
        servers: [
          { name: 'server-1', status: 'connected', tools: [{ name: 't1' }] },
          { name: 'server-2', status: 'disconnected', tools: [] },
        ],
        isLoading: false,
      });
      render(<CreateSubAgentView />);
      expect(screen.getByText('server-1')).toBeInTheDocument();
      expect(screen.getByText('server-2')).toBeInTheDocument();
      expect(screen.getByText('(1 tools)')).toBeInTheDocument();
    });

    it('should render skills list when skills exist', () => {
      mockUseSkills.mockReturnValue({
        skills: [
          { name: 'skill-a', description: 'Skill A description' },
          { name: 'skill-b', description: '' },
        ],
        isLoading: false,
      });
      render(<CreateSubAgentView />);
      expect(screen.getByText('skill-a')).toBeInTheDocument();
      expect(screen.getByText('skill-b')).toBeInTheDocument();
      expect(screen.getByText('— Skill A description')).toBeInTheDocument();
    });

    it('should show MCP servers as checked and disabled when inherit_mcp_servers is true (default)', () => {
      mockUseMCPServers.mockReturnValue({
        servers: [
          { name: 'server-1', status: 'connected', tools: [{ name: 't1' }] },
          { name: 'server-2', status: 'disconnected', tools: [] },
        ],
        isLoading: false,
      });
      const { container } = render(<CreateSubAgentView />);

      const mcpItems = container.querySelectorAll('.sub-agent-capability-card:first-child .sub-agent-capability-item');
      mcpItems.forEach(item => {
        const checkbox = item.querySelector('input[type="checkbox"]') as HTMLInputElement;
        expect(checkbox.checked).toBe(true);
        expect(checkbox.disabled).toBe(true);
        expect(item.classList.contains('inherited')).toBe(true);
      });
    });

    it('should show skills as checked and disabled when inherit_skills is true (default)', () => {
      mockUseSkills.mockReturnValue({
        skills: [
          { name: 'skill-a', description: 'Skill A description' },
          { name: 'skill-b', description: '' },
        ],
        isLoading: false,
      });
      const { container } = render(<CreateSubAgentView />);

      const skillCards = container.querySelectorAll('.sub-agent-capability-card');
      const skillItems = skillCards[1].querySelectorAll('.sub-agent-capability-item');
      skillItems.forEach(item => {
        const checkbox = item.querySelector('input[type="checkbox"]') as HTMLInputElement;
        expect(checkbox.checked).toBe(true);
        expect(checkbox.disabled).toBe(true);
        expect(item.classList.contains('inherited')).toBe(true);
      });
    });

    it('should show inherit hint for skills when inherit_skills is true', () => {
      render(<CreateSubAgentView />);
      expect(screen.getByText('All skills will be inherited from the parent agent and cannot be changed individually.')).toBeInTheDocument();
    });
  });

  // ========== Form Validation ==========

  describe('form validation', () => {
    it('should show errors when submitting empty form', () => {
      render(<CreateSubAgentView />);
      fireEvent.click(screen.getByRole('button', { name: 'Create Sub-Agent' }));

      expect(screen.getByText('Name is required')).toBeInTheDocument();
      expect(screen.getByText('Description is required')).toBeInTheDocument();
      expect(screen.getByText('System prompt is required')).toBeInTheDocument();
    });

    it('should clear field error when user types', () => {
      render(<CreateSubAgentView />);

      // Trigger validation
      fireEvent.click(screen.getByRole('button', { name: 'Create Sub-Agent' }));
      expect(screen.getByText('Description is required')).toBeInTheDocument();

      // Type in description
      const descriptionInput = screen.getByPlaceholderText('Describe what this sub-agent does...');
      fireEvent.change(descriptionInput, { target: { value: 'A test agent' } });
      expect(screen.queryByText('Description is required')).not.toBeInTheDocument();
    });
  });

  // ========== Action Buttons ==========

  describe('action buttons', () => {
    it('should render Cancel and Create Sub-Agent buttons', () => {
      render(<CreateSubAgentView />);
      expect(screen.getByText('Cancel')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Create Sub-Agent' })).toBeInTheDocument();
    });

    it('should navigate to /settings/sub-agents on Cancel click', () => {
      render(<CreateSubAgentView />);
      fireEvent.click(screen.getByText('Cancel'));
      expect(mockNavigate).toHaveBeenCalledWith('/settings/sub-agents');
    });

    it('should render .sub-agent-form-actions container', () => {
      const { container } = render(<CreateSubAgentView />);
      expect(container.querySelector('.sub-agent-form-actions')).toBeInTheDocument();
    });
  });

  // ========== Form Submission ==========

  describe('form submission', () => {
    it('should call electronAPI.subAgent.add on valid submission', async () => {
      const mockAdd = vi.fn().mockResolvedValue({ success: true });
      (window as any).electronAPI = { subAgent: { add: mockAdd } };

      render(<CreateSubAgentView />);

      // Fill required fields
      fireEvent.change(screen.getByPlaceholderText('e.g., web-researcher'), { target: { value: 'test-agent' } });
      fireEvent.change(screen.getByPlaceholderText('Describe what this sub-agent does...'), { target: { value: 'A test agent' } });
      fireEvent.change(screen.getByPlaceholderText("Provide the system prompt that defines this sub-agent's behavior..."), { target: { value: 'You are a test agent' } });

      fireEvent.click(screen.getByRole('button', { name: 'Create Sub-Agent' }));

      await waitFor(() => {
        expect(mockAdd).toHaveBeenCalledTimes(1);
        expect(mockAdd).toHaveBeenCalledWith(
          expect.objectContaining({
            name: 'test-agent',
            description: 'A test agent',
            system_prompt: 'You are a test agent',
            version: '1.0.0',
            source: 'ON-DEVICE',
            model: 'inherit',
          }),
        );
      });
    });

    it('should show success toast and navigate on successful creation', async () => {
      const mockAdd = vi.fn().mockResolvedValue({ success: true });
      (window as any).electronAPI = { subAgent: { add: mockAdd } };

      render(<CreateSubAgentView />);

      // Fill required fields
      fireEvent.change(screen.getByPlaceholderText('e.g., web-researcher'), { target: { value: 'test-agent' } });
      fireEvent.change(screen.getByPlaceholderText('Describe what this sub-agent does...'), { target: { value: 'desc' } });
      fireEvent.change(screen.getByPlaceholderText("Provide the system prompt that defines this sub-agent's behavior..."), { target: { value: 'prompt' } });

      fireEvent.click(screen.getByRole('button', { name: 'Create Sub-Agent' }));

      await waitFor(() => {
        expect(mockShowSuccess).toHaveBeenCalledWith(expect.stringContaining('test-agent'));
        expect(mockNavigate).toHaveBeenCalledWith('/settings/sub-agents');
      });
    });

    it('should submit selected model from dropdown', async () => {
      const mockAdd = vi.fn().mockResolvedValue({ success: true });
      (window as any).electronAPI = { subAgent: { add: mockAdd } };

      render(<CreateSubAgentView />);

      fireEvent.change(screen.getByPlaceholderText('e.g., web-researcher'), { target: { value: 'test-agent' } });
      fireEvent.change(screen.getByPlaceholderText('Describe what this sub-agent does...'), { target: { value: 'A test agent' } });
      fireEvent.change(screen.getByPlaceholderText("Provide the system prompt that defines this sub-agent's behavior..."), { target: { value: 'You are a test agent' } });
      fireEvent.click(screen.getByRole('button', { name: /Inherit parent model/i }));
      fireEvent.click(screen.getByRole('button', { name: /Claude Sonnet 4.5/i }));

      fireEvent.click(screen.getByRole('button', { name: 'Create Sub-Agent' }));

      await waitFor(() => {
        expect(mockAdd).toHaveBeenCalledWith(
          expect.objectContaining({ model: 'claude-sonnet-4.5' }),
        );
      });
    });

    it('should show error toast on failed creation', async () => {
      const mockAdd = vi.fn().mockResolvedValue({ success: false, error: 'Name already exists' });
      (window as any).electronAPI = { subAgent: { add: mockAdd } };

      render(<CreateSubAgentView />);

      // Fill required fields
      fireEvent.change(screen.getByPlaceholderText('e.g., web-researcher'), { target: { value: 'test-agent' } });
      fireEvent.change(screen.getByPlaceholderText('Describe what this sub-agent does...'), { target: { value: 'desc' } });
      fireEvent.change(screen.getByPlaceholderText("Provide the system prompt that defines this sub-agent's behavior..."), { target: { value: 'prompt' } });

      fireEvent.click(screen.getByRole('button', { name: 'Create Sub-Agent' }));

      await waitFor(() => {
        expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('Name already exists'));
      });
    });

    it('should show error when electronAPI is unavailable', async () => {
      (window as any).electronAPI = {};

      render(<CreateSubAgentView />);

      // Fill required fields
      fireEvent.change(screen.getByPlaceholderText('e.g., web-researcher'), { target: { value: 'test-agent' } });
      fireEvent.change(screen.getByPlaceholderText('Describe what this sub-agent does...'), { target: { value: 'desc' } });
      fireEvent.change(screen.getByPlaceholderText("Provide the system prompt that defines this sub-agent's behavior..."), { target: { value: 'prompt' } });

      fireEvent.click(screen.getByRole('button', { name: 'Create Sub-Agent' }));

      await waitFor(() => {
        expect(mockShowError).toHaveBeenCalledWith('Sub-agent API not available');
      });
    });

    it('should show error when API throws an exception', async () => {
      const mockAdd = vi.fn().mockRejectedValue(new Error('Network failure'));
      (window as any).electronAPI = { subAgent: { add: mockAdd } };

      render(<CreateSubAgentView />);

      fireEvent.change(screen.getByPlaceholderText('e.g., web-researcher'), { target: { value: 'test-agent' } });
      fireEvent.change(screen.getByPlaceholderText('Describe what this sub-agent does...'), { target: { value: 'desc' } });
      fireEvent.change(screen.getByPlaceholderText("Provide the system prompt that defines this sub-agent's behavior..."), { target: { value: 'prompt' } });

      fireEvent.click(screen.getByRole('button', { name: 'Create Sub-Agent' }));

      await waitFor(() => {
        expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('Network failure'));
      });
    });
  });

  // ========== Validation edge cases ==========

  describe('form validation edge cases', () => {
    it('should show error for invalid name (starts with hyphen)', async () => {
      render(<CreateSubAgentView />);

      fireEvent.change(screen.getByPlaceholderText('e.g., web-researcher'), { target: { value: '-invalid' } });
      fireEvent.click(screen.getByRole('button', { name: 'Create Sub-Agent' }));

      await waitFor(() => {
        expect(screen.getByText(/lowercase letters, numbers, and hyphens/)).toBeInTheDocument();
      });
    });

    it('should show error for invalid name (ends with hyphen)', async () => {
      render(<CreateSubAgentView />);

      fireEvent.change(screen.getByPlaceholderText('e.g., web-researcher'), { target: { value: 'invalid-' } });
      fireEvent.click(screen.getByRole('button', { name: 'Create Sub-Agent' }));

      await waitFor(() => {
        expect(screen.getByText(/lowercase letters, numbers, and hyphens/)).toBeInTheDocument();
      });
    });

    it('should accept valid name with hyphens', async () => {
      const mockAdd = vi.fn().mockResolvedValue({ success: true });
      (window as any).electronAPI = { subAgent: { add: mockAdd } };

      render(<CreateSubAgentView />);

      fireEvent.change(screen.getByPlaceholderText('e.g., web-researcher'), { target: { value: 'my-agent-123' } });
      fireEvent.change(screen.getByPlaceholderText('Describe what this sub-agent does...'), { target: { value: 'desc' } });
      fireEvent.change(screen.getByPlaceholderText("Provide the system prompt that defines this sub-agent's behavior..."), { target: { value: 'prompt' } });

      fireEvent.click(screen.getByRole('button', { name: 'Create Sub-Agent' }));

      await waitFor(() => {
        expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({ name: 'my-agent-123' }));
      });
    });
  });
});
