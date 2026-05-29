/**
 * @vitest-environment happy-dom
 */

/**
 * SubAgentListItem component rendering tests
 *
 * Tests that the component correctly renders SubAgentConfig data:
 * - description
 * - meta row (MCP count, Skills count, Context access)
 * - menu button click
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

// Mock CSS imports
vi.mock('../../../styles/SubAgentsView.css', async () => ({}));

import SubAgentListItem from '../SubAgentListItem';
import type { SubAgentConfig } from '../../../lib/userData/types';

// Helper: create test SubAgentConfig
function createTestConfig(overrides: Partial<SubAgentConfig> = {}): SubAgentConfig {
  return {
    name: 'web-researcher',
    description: 'Searches the web and summarizes findings',
    system_prompt: 'You are a web researcher.',
    mcpServers: [],
    skills: [],
    builtin_tools: [],
    ...overrides,
  };
}

describe('SubAgentListItem', () => {
  const defaultProps = {
    config: createTestConfig(),
    isSelected: false,
    onClick: vi.fn(),
    onMenuToggle: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ========== Rendering ==========

  describe('rendering', () => {
    it('should render description', () => {
      render(<SubAgentListItem {...defaultProps} />);
      expect(screen.getByText('Searches the web and summarizes findings')).toBeInTheDocument();
    });

    it('should render menu button (⋮)', () => {
      render(<SubAgentListItem {...defaultProps} />);
      expect(screen.getByText('⋮')).toBeInTheDocument();
    });
  });

  // ========== Meta Row ==========

  describe('meta row', () => {
    it('should show MCP count of 0 with inherit hint when no mcp_servers', () => {
      render(<SubAgentListItem {...defaultProps} />);
      // Default parentMcpCount=0, inherit enabled → shows "0 (+inherit)"
      expect(screen.getByText('MCP: 0 (+inherit)')).toBeInTheDocument();
    });

    it('should show correct MCP count with inherit hint', () => {
      const config = createTestConfig({
        mcpServers: [
          { name: 'server-1', enabled: true },
          { name: 'server-2', enabled: true },
        ] as any[],
      });
      render(<SubAgentListItem {...defaultProps} config={config} />);
      // Default parentMcpCount=0, inherit enabled → shows "2 (+inherit)"
      expect(screen.getByText('MCP: 2 (+inherit)')).toBeInTheDocument();
    });

    it('should show MCP count with inherited count when parentMcpCount > 0', () => {
      const config = createTestConfig({
        mcpServers: [
          { name: 'server-1', enabled: true },
        ] as any[],
      });
      render(<SubAgentListItem {...defaultProps} config={config} parentMcpCount={3} />);
      // 1 own + 3 inherited = 4 total, shows "4 (3 inherited)"
      expect(screen.getByText('MCP: 4 (3 inherited)')).toBeInTheDocument();
    });

    it('should show Skills count of 0 with inherit hint when no skills', () => {
      render(<SubAgentListItem {...defaultProps} />);
      // Default parentSkillsCount=0, inherit enabled → shows "0 (+inherit)"
      expect(screen.getByText('Skills: 0 (+inherit)')).toBeInTheDocument();
    });

    it('should show correct Skills count with inherit hint', () => {
      const config = createTestConfig({
        skills: ['skill-a', 'skill-b', 'skill-c'],
      });
      render(<SubAgentListItem {...defaultProps} config={config} />);
      // Default parentSkillsCount=0, inherit enabled → shows "3 (+inherit)"
      expect(screen.getByText('Skills: 3 (+inherit)')).toBeInTheDocument();
    });

    it('should show Skills count with inherited count when parentSkillsCount > 0', () => {
      const config = createTestConfig({
        skills: ['skill-a', 'skill-b'],
      });
      render(<SubAgentListItem {...defaultProps} config={config} parentSkillsCount={2} />);
      // 2 own + 2 inherited = 4 total, shows "4 (2 inherited)"
      expect(screen.getByText('Skills: 4 (2 inherited)')).toBeInTheDocument();
    });

    it('should show Context access label as Isolated', () => {
      render(<SubAgentListItem {...defaultProps} />);
      expect(screen.getByText('Context: Isolated')).toBeInTheDocument();
    });
  });

  // ========== Interactions ==========

  describe('interactions', () => {
    it('should call onClick when item is clicked', () => {
      const onClick = vi.fn();
      render(<SubAgentListItem {...defaultProps} onClick={onClick} />);

      fireEvent.click(screen.getByText('Searches the web and summarizes findings'));
      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('should call onMenuToggle when menu button is clicked', () => {
      const onMenuToggle = vi.fn();
      render(<SubAgentListItem {...defaultProps} onMenuToggle={onMenuToggle} />);

      fireEvent.click(screen.getByText('⋮'));
      expect(onMenuToggle).toHaveBeenCalledTimes(1);
    });

    it('should not call onClick when menu button is clicked (stopPropagation)', () => {
      const onClick = vi.fn();
      const onMenuToggle = vi.fn();
      render(<SubAgentListItem {...defaultProps} onClick={onClick} onMenuToggle={onMenuToggle} />);

      fireEvent.click(screen.getByText('⋮'));
      // onClick should NOT be called because menu button uses stopPropagation
      expect(onClick).not.toHaveBeenCalled();
      expect(onMenuToggle).toHaveBeenCalledTimes(1);
    });
  });

  // ========== Edge Cases ==========

  describe('edge cases', () => {
    it('should handle missing skills array', () => {
      const config = createTestConfig({ skills: undefined });
      render(<SubAgentListItem {...defaultProps} config={config} />);
      expect(screen.getByText('Skills: 0 (+inherit)')).toBeInTheDocument();
    });

    it('should handle missing mcp_servers array', () => {
      const config = createTestConfig({ mcpServers: undefined as any });
      render(<SubAgentListItem {...defaultProps} config={config} />);
      expect(screen.getByText('MCP: 0 (+inherit)')).toBeInTheDocument();
    });

    it('should handle empty description', () => {
      const config = createTestConfig({ description: '' });
      const { container } = render(<SubAgentListItem {...defaultProps} config={config} />);
      // Component should still render without errors
      expect(container.querySelector('.sub-agent-card-wrapper')).toBeInTheDocument();
    });

    it('should handle long name', () => {
      const config = createTestConfig({ name: 'a-very-long-sub-agent-name-that-might-overflow' });
      const { container } = render(<SubAgentListItem {...defaultProps} config={config} />);
      expect(container.querySelector('.sub-agent-card-wrapper')).toBeInTheDocument();
    });
  });
});
