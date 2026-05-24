/**
 * @vitest-environment happy-dom
 */

/**
 * SubAgentDropdownMenu component tests
 *
 * Tests menu rendering, button actions, and custom event dispatching
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

// Mock react-router-dom
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => ({
  ...await vi.importActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}));

vi.mock('../../../lib/utilities/dropdownPosition', async () => ({
  adjustAnchoredDropdownToViewport: vi.fn(),
}));

// Mock useToast
const mockShowSuccess = vi.fn();
const mockShowError = vi.fn();
vi.mock('../../ui/ToastProvider', async () => ({
  useToast: () => ({ showSuccess: mockShowSuccess, showError: mockShowError }),
}));

import SubAgentDropdownMenu from '../SubAgentDropdownMenu';

describe('SubAgentDropdownMenu', () => {
  const defaultProps = {
    subAgentMenuRef: React.createRef<HTMLDivElement>(),
    subAgentName: 'web-researcher',
    position: { top: 100, left: 200, triggerTop: 90, triggerRight: 300 },
    onClose: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    // Reset electronAPI mock between tests
    (window as any).electronAPI = undefined;
    // Provide URL.createObjectURL/revokeObjectURL for jsdom
    if (!global.URL.createObjectURL) {
      global.URL.createObjectURL = vi.fn(() => 'blob:mock');
    }
    if (!global.URL.revokeObjectURL) {
      global.URL.revokeObjectURL = vi.fn();
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ========== Rendering ==========

  describe('rendering', () => {
    it('should render Edit button', () => {
      render(<SubAgentDropdownMenu {...defaultProps} />);
      expect(screen.getByText('Edit')).toBeInTheDocument();
    });

    it('should render Apply to Agents button', () => {
      render(<SubAgentDropdownMenu {...defaultProps} />);
      expect(screen.getByText('Apply to Agents...')).toBeInTheDocument();
    });

    it('should render Delete button', () => {
      render(<SubAgentDropdownMenu {...defaultProps} />);
      expect(screen.getByText('Delete')).toBeInTheDocument();
    });

    it('should render Export as Claude Code Format button', () => {
      render(<SubAgentDropdownMenu {...defaultProps} />);
      expect(screen.getByText('Export as Claude Code Format')).toBeInTheDocument();
    });

    it('should render Open in File Explorer button', () => {
      render(<SubAgentDropdownMenu {...defaultProps} />);
      expect(screen.getByText('Open in File Explorer')).toBeInTheDocument();
    });

    it('should render at specified position', () => {
      const { container } = render(<SubAgentDropdownMenu {...defaultProps} />);
      const menu = container.querySelector('.dropdown-menu');
      expect(menu).toHaveStyle({ top: '100px', left: '200px' });
    });
  });

  // ========== Edit Action ==========

  describe('Edit action', () => {
    it('should navigate to edit route on Edit click', () => {
      render(<SubAgentDropdownMenu {...defaultProps} />);
      fireEvent.click(screen.getByText('Edit'));
      expect(mockNavigate).toHaveBeenCalledWith('/settings/sub-agents/edit/web-researcher');
    });

    it('should close menu on Edit click', () => {
      render(<SubAgentDropdownMenu {...defaultProps} />);
      fireEvent.click(screen.getByText('Edit'));
      expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
    });

    it('should encode subAgentName in URL', () => {
      render(<SubAgentDropdownMenu {...defaultProps} subAgentName="agent with spaces" />);
      fireEvent.click(screen.getByText('Edit'));
      expect(mockNavigate).toHaveBeenCalledWith('/settings/sub-agents/edit/agent%20with%20spaces');
    });
  });

  // ========== Delete Action ==========

  describe('Delete action', () => {
    it('should dispatch subAgent:delete custom event on Delete click', () => {
      const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
      render(<SubAgentDropdownMenu {...defaultProps} />);
      fireEvent.click(screen.getByText('Delete'));

      expect(dispatchSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'subAgent:delete',
          detail: { subAgentName: 'web-researcher' },
        })
      );
      dispatchSpy.mockRestore();
    });

    it('should close menu on Delete click', () => {
      render(<SubAgentDropdownMenu {...defaultProps} />);
      fireEvent.click(screen.getByText('Delete'));
      expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
    });
  });

  // ========== Apply to Agents Action ==========

  describe('Apply to Agents action', () => {
    it('should dispatch subAgents:applyToAgents custom event', () => {
      const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
      render(<SubAgentDropdownMenu {...defaultProps} />);
      fireEvent.click(screen.getByText('Apply to Agents...'));

      expect(dispatchSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'subAgents:applyToAgents',
          detail: { subAgentName: 'web-researcher' },
        })
      );
      dispatchSpy.mockRestore();
    });

    it('should close menu on Apply to Agents click', () => {
      render(<SubAgentDropdownMenu {...defaultProps} />);
      fireEvent.click(screen.getByText('Apply to Agents...'));
      expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
    });
  });

  // ========== Export as Claude Code Action ==========

  describe('Export as Claude Code action', () => {
    it('should show error when API not available', async () => {
      render(<SubAgentDropdownMenu {...defaultProps} />);
      fireEvent.click(screen.getByText('Export as Claude Code Format'));
      await Promise.resolve();
      expect(mockShowError).toHaveBeenCalledWith('Export API not available');
    });

    it('should close menu on Export click', () => {
      render(<SubAgentDropdownMenu {...defaultProps} />);
      fireEvent.click(screen.getByText('Export as Claude Code Format'));
      expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
    });

    it('should call exportAsClaudeCode IPC and trigger download on success', async () => {
      const mockExport = vi.fn().mockResolvedValue({ success: true, data: '---\nname: web-researcher\n---' });
      (window as any).electronAPI = { subAgent: { exportAsClaudeCode: mockExport } };

      // Mock DOM click — use a targeted spy that only intercepts 'a' element creation
      const mockClick = vi.fn();
      const mockAnchor = { href: '', download: '', click: mockClick };
      const originalCreateElement = document.createElement.bind(document);
      vi.spyOn(document, 'createElement').mockImplementation((tagName: string, options?: any) => {
        if (tagName === 'a') return mockAnchor as any;
        return originalCreateElement(tagName, options);
      });
      // URL.createObjectURL/revokeObjectURL already set up in beforeEach

      render(<SubAgentDropdownMenu {...defaultProps} />);
      fireEvent.click(screen.getByText('Export as Claude Code Format'));
      await Promise.resolve(); await Promise.resolve();

      expect(mockExport).toHaveBeenCalledWith('web-researcher');
      expect(mockClick).toHaveBeenCalled();
      expect(mockShowSuccess).toHaveBeenCalledWith('Sub-agent "web-researcher" exported successfully');
    });
  });

  // ========== Open in File Explorer Action ==========

  describe('Open in File Explorer action', () => {
    it('should show error when API not available', async () => {
      render(<SubAgentDropdownMenu {...defaultProps} />);
      fireEvent.click(screen.getByText('Open in File Explorer'));
      await Promise.resolve();
      expect(mockShowError).toHaveBeenCalledWith('Open in Explorer API not available');
    });

    it('should close menu on Open in File Explorer click', () => {
      render(<SubAgentDropdownMenu {...defaultProps} />);
      fireEvent.click(screen.getByText('Open in File Explorer'));
      expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
    });

    it('should call openInExplorer IPC on click', async () => {
      const mockOpen = vi.fn().mockResolvedValue({ success: true });
      (window as any).electronAPI = { subAgent: { openInExplorer: mockOpen } };

      render(<SubAgentDropdownMenu {...defaultProps} />);
      fireEvent.click(screen.getByText('Open in File Explorer'));
      await Promise.resolve(); await Promise.resolve();

      expect(mockOpen).toHaveBeenCalledWith('web-researcher');
    });

    it('should show error when openInExplorer returns failure', async () => {
      const mockOpen = vi.fn().mockResolvedValue({ success: false, error: 'Folder not found' });
      (window as any).electronAPI = { subAgent: { openInExplorer: mockOpen } };

      render(<SubAgentDropdownMenu {...defaultProps} />);
      fireEvent.click(screen.getByText('Open in File Explorer'));
      await Promise.resolve(); await Promise.resolve();

      expect(mockShowError).toHaveBeenCalledWith('Folder not found');
    });

    it('should show error when openInExplorer throws an exception', async () => {
      const mockOpen = vi.fn().mockRejectedValue(new Error('Unexpected error'));
      (window as any).electronAPI = { subAgent: { openInExplorer: mockOpen } };

      render(<SubAgentDropdownMenu {...defaultProps} />);
      fireEvent.click(screen.getByText('Open in File Explorer'));
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

      expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('Unexpected error'));
    });
  });

  // ========== Export error paths ==========

  describe('Export additional error paths', () => {
    it('should show error when exportAsClaudeCode returns failure result', async () => {
      const mockExport = vi.fn().mockResolvedValue({ success: false, error: 'Export error' });
      (window as any).electronAPI = { subAgent: { exportAsClaudeCode: mockExport } };

      render(<SubAgentDropdownMenu {...defaultProps} />);
      fireEvent.click(screen.getByText('Export as Claude Code Format'));
      await Promise.resolve(); await Promise.resolve();

      expect(mockShowError).toHaveBeenCalledWith('Export error');
    });

    it('should show error when exportAsClaudeCode throws an exception', async () => {
      const mockExport = vi.fn().mockRejectedValue(new Error('IPC error'));
      (window as any).electronAPI = { subAgent: { exportAsClaudeCode: mockExport } };

      render(<SubAgentDropdownMenu {...defaultProps} />);
      fireEvent.click(screen.getByText('Export as Claude Code Format'));
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

      expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('IPC error'));
    });
  });

  // ========== Mouse hover events ==========

  describe('mouse hover events', () => {
    it('should change background on Edit button mouseEnter and mouseLeave', () => {
      render(<SubAgentDropdownMenu {...defaultProps} />);
      const editBtn = screen.getByText('Edit');
      fireEvent.mouseEnter(editBtn);
      expect((editBtn as HTMLElement).style.backgroundColor).toBe('rgba(0, 0, 0, 0.04)');
      fireEvent.mouseLeave(editBtn);
      expect((editBtn as HTMLElement).style.backgroundColor).toBe('transparent');
    });

    it('should change background on Delete button mouseEnter and mouseLeave', () => {
      render(<SubAgentDropdownMenu {...defaultProps} />);
      const deleteBtn = screen.getByText('Delete');
      fireEvent.mouseEnter(deleteBtn);
      expect((deleteBtn as HTMLElement).style.backgroundColor).toBe('rgba(239, 68, 68, 0.04)');
      fireEvent.mouseLeave(deleteBtn);
      expect((deleteBtn as HTMLElement).style.backgroundColor).toBe('transparent');
    });
  });
});
