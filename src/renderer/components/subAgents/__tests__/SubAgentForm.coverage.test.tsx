/** @vitest-environment happy-dom */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Mock CSS
vi.mock('../../../styles/SubAgentsView.css', () => ({}));

// Mock SubAgentModelSelect
vi.mock('../SubAgentModelSelect', () => ({
  default: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <div data-testid="model-select">
      <button onClick={() => onChange('gpt-4')}>{value}</button>
    </div>
  ),
}));

// Mock electron API
Object.defineProperty(window, 'electronAPI', {
  value: {
    dialog: {
      showOpenDialog: vi.fn().mockResolvedValue({ filePaths: ['/some/path'] }),
    },
  },
  writable: true,
  configurable: true,
});

// Mock userDataProvider
const mockUseMCPServers = vi.fn(() => ({
  servers: [
    { name: 'server1', hidden: false, status: 'connected', tools: ['tool1', 'tool2'] },
    { name: 'server2', hidden: true, status: 'disconnected', tools: [] },
  ],
  isLoading: false,
}));
const mockUseSkills = vi.fn(() => ({
  skills: [
    { name: 'skill1', description: 'A skill' },
    { name: 'skill2', description: '' },
  ],
  isLoading: false,
}));
vi.mock('../../userData/userDataProvider', () => ({
  useMCPServers: () => mockUseMCPServers(),
  useSkills: () => mockUseSkills(),
}));

// Mock shared constants
vi.mock('@shared/constants/subAgent', () => ({
  INHERIT_MODEL_VALUE: 'inherit',
}));

import SubAgentForm, { DEFAULT_FORM_DATA, SubAgentFormData } from '../SubAgentForm';

const makeProps = (overrides: Partial<Parameters<typeof SubAgentForm>[0]> = {}) => ({
  formData: { ...DEFAULT_FORM_DATA },
  errors: {},
  isNameEditable: true,
  isSubmitting: false,
  submitLabel: 'Create',
  submittingLabel: 'Creating...',
  onUpdateField: vi.fn(),
  onUpdateFormData: vi.fn(),
  onSubmit: vi.fn(),
  onCancel: vi.fn(),
  ...overrides,
});

describe('SubAgentForm', () => {
  it('renders all key form fields', () => {
    render(<SubAgentForm {...makeProps()} />);
    expect(screen.getByPlaceholderText('e.g., web-researcher')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Describe what this sub-agent does/i)).toBeInTheDocument();
  });

  it('shows name field as disabled when isNameEditable=false', () => {
    render(<SubAgentForm {...makeProps({ isNameEditable: false })} />);
    const inputs = screen.getAllByRole('textbox');
    // First input is the disabled name field
    expect(inputs[0]).toBeDisabled();
  });

  it('calls onUpdateField when name changes', () => {
    const onUpdateField = vi.fn();
    render(<SubAgentForm {...makeProps({ isNameEditable: true, onUpdateField })} />);
    const nameInput = screen.getByPlaceholderText('e.g., web-researcher');
    fireEvent.change(nameInput, { target: { value: 'my-agent' } });
    expect(onUpdateField).toHaveBeenCalledWith('name', 'my-agent');
  });

  it('calls onSubmit when submit button clicked', () => {
    const onSubmit = vi.fn();
    render(<SubAgentForm {...makeProps({ onSubmit })} />);
    fireEvent.click(screen.getByText('Create'));
    expect(onSubmit).toHaveBeenCalled();
  });

  it('calls onCancel when cancel button clicked', () => {
    const onCancel = vi.fn();
    render(<SubAgentForm {...makeProps({ onCancel })} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalled();
  });

  it('shows submittingLabel when isSubmitting=true', () => {
    render(<SubAgentForm {...makeProps({ isSubmitting: true })} />);
    expect(screen.getByText('Creating...')).toBeInTheDocument();
  });

  it('renders error messages for fields', () => {
    render(<SubAgentForm {...makeProps({ errors: { name: 'Name is required', description: 'Too short' } })} />);
    expect(screen.getByText('Name is required')).toBeInTheDocument();
    expect(screen.getByText('Too short')).toBeInTheDocument();
  });

  it('renders MCP server checkboxes (non-hidden only)', () => {
    render(<SubAgentForm {...makeProps()} />);
    expect(screen.getByText('server1')).toBeInTheDocument();
    expect(screen.queryByText('server2')).not.toBeInTheDocument();
  });

  it('renders skill checkboxes', () => {
    render(<SubAgentForm {...makeProps()} />);
    expect(screen.getByText('skill1')).toBeInTheDocument();
    expect(screen.getByText('skill2')).toBeInTheDocument();
  });

  it('shows inherit hint for mcp when inherit_mcp_servers=true', () => {
    render(<SubAgentForm {...makeProps()} />);
    expect(screen.getByText(/All MCP servers will be inherited/i)).toBeInTheDocument();
  });

  it('calls onUpdateFormData when inherit_mcp_servers toggle changed', () => {
    const onUpdateFormData = vi.fn();
    render(<SubAgentForm {...makeProps({ onUpdateFormData })} />);
    // Find "Inherit from parent agent" checkboxes (first one is for MCP servers)
    const inheritCheckboxes = screen.getAllByRole('checkbox');
    fireEvent.click(inheritCheckboxes[0]);
    expect(onUpdateFormData).toHaveBeenCalled();
  });

  it('toggles skill when inherit_skills=false', () => {
    const onUpdateFormData = vi.fn();
    render(<SubAgentForm {...makeProps({ formData: { ...DEFAULT_FORM_DATA, inherit_skills: false }, onUpdateFormData })} />);
    const skillCheckboxes = screen.getAllByRole('checkbox');
    // Find one for skill1 (not an inherit checkbox)
    const skill1Checkbox = skillCheckboxes.find(c => !c.hasAttribute('checked') && c.closest('label')?.textContent?.includes('skill1'));
    if (skill1Checkbox) {
      fireEvent.click(skill1Checkbox);
      expect(onUpdateFormData).toHaveBeenCalled();
    }
  });

  it('shows loading state for servers', () => {
    mockUseMCPServers.mockReturnValueOnce({ servers: [], isLoading: true });
    render(<SubAgentForm {...makeProps()} />);
    expect(screen.getByText('Loading servers...')).toBeInTheDocument();
  });

  it('shows loading state for skills', () => {
    mockUseSkills.mockReturnValueOnce({ skills: [], isLoading: true });
    render(<SubAgentForm {...makeProps()} />);
    expect(screen.getByText('Loading skills...')).toBeInTheDocument();
  });

  it('shows empty state when no servers', () => {
    mockUseMCPServers.mockReturnValueOnce({ servers: [], isLoading: false });
    render(<SubAgentForm {...makeProps()} />);
    expect(screen.getByText(/No MCP servers configured/i)).toBeInTheDocument();
  });

  it('shows empty state when no skills', () => {
    mockUseSkills.mockReturnValueOnce({ skills: [], isLoading: false });
    render(<SubAgentForm {...makeProps()} />);
    expect(screen.getByText(/No skills installed/i)).toBeInTheDocument();
  });

  it('DEFAULT_FORM_DATA has expected shape', () => {
    expect(DEFAULT_FORM_DATA.name).toBe('');
    expect(DEFAULT_FORM_DATA.model).toBe('inherit');
    expect(DEFAULT_FORM_DATA.inherit_mcp_servers).toBe(true);
    expect((DEFAULT_FORM_DATA as any).max_turns).toBeUndefined();
  });
});
