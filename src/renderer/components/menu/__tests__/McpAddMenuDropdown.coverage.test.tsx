// @ts-nocheck
/**
 * @vitest-environment happy-dom
 * Coverage tests for McpAddMenuDropdown.tsx
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockNavigate = vi.hoisted(() => vi.fn());

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock('@/lib/i18n/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock('../../../lib/utilities/dropdownPosition', () => ({
  adjustAnchoredDropdownToViewport: vi.fn(),
  AnchoredDropdownPosition: {},
}));

vi.mock('lucide-react', () => ({
  Plus: () => <svg data-testid="plus-icon" />,
  Import: () => <svg data-testid="import-icon" />,
  Store: () => <svg data-testid="store-icon" />,
}));

import McpAddMenuDropdown from '../McpAddMenuDropdown';

function makeRef() {
  const div = document.createElement('div');
  return { current: div } as React.RefObject<HTMLDivElement>;
}

const defaultPosition = { top: 100, left: 200 };

describe('McpAddMenuDropdown', () => {
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders local MCP creation and import actions', () => {
    render(
      <McpAddMenuDropdown
        mcpAddMenuRef={makeRef()}
        position={defaultPosition}
        onClose={onClose}
      />,
    );
    expect(screen.getByText('mcp.menu.newServer')).toBeTruthy();
    expect(screen.getByText('mcp.menu.importFromVsCode')).toBeTruthy();
  });

  it('navigates to /settings/mcp/new and calls onClose on New Server click', () => {
    render(
      <McpAddMenuDropdown
        mcpAddMenuRef={makeRef()}
        position={defaultPosition}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByText('mcp.menu.newServer'));
    expect(mockNavigate).toHaveBeenCalledWith('/settings/mcp/new');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('navigates to /settings/mcp/import-vscode on Import VS Code click', () => {
    render(
      <McpAddMenuDropdown
        mcpAddMenuRef={makeRef()}
        position={defaultPosition}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByText('mcp.menu.importFromVsCode'));
    expect(mockNavigate).toHaveBeenCalledWith('/settings/mcp/import-vscode');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('applies position styles', () => {
    const { container } = render(
      <McpAddMenuDropdown
        mcpAddMenuRef={makeRef()}
        position={{ top: 50, left: 80 }}
        onClose={onClose}
      />,
    );
    const menu = container.querySelector('.mcp-add-dropdown-menu');
    expect(menu?.style.top).toBe('50px');
    expect(menu?.style.left).toBe('80px');
  });

  it('has role=menu with menuitem children', () => {
    render(
      <McpAddMenuDropdown
        mcpAddMenuRef={makeRef()}
        position={defaultPosition}
        onClose={onClose}
      />,
    );
    expect(screen.getByRole('menu')).toBeTruthy();
    const items = screen.getAllByRole('menuitem');
    expect(items).toHaveLength(2);
  });
});
