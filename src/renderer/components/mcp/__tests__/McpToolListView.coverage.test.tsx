// @ts-nocheck
/**
 * @vitest-environment happy-dom
 * Coverage tests for McpToolListView.tsx
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/i18n/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock('../../styles/McpToolListView.css', () => ({}));

vi.mock('lucide-react', () => ({
  Wrench: (props: any) => <svg data-testid="wrench-icon" size={props.size} className={props.className} />,
  Loader2: (props: any) => <svg data-testid="loader-icon" className={props.className} />,
  ChevronRight: (props: any) => <svg data-testid="chevron-icon" size={props.size} />,
}));

import McpToolListView from '../McpToolListView';

function makeTool(name: string, serverId = 'server-1') {
  return { name, serverId, description: `desc for ${name}`, inputSchema: {} };
}

describe('McpToolListView', () => {
  const onSelectTool = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading state when isLoading=true', () => {
    render(
      <McpToolListView
        tools={[]}
        selectedTool={null}
        onSelectTool={onSelectTool}
        isLoading={true}
      />,
    );
    expect(screen.getByText('mcp.tool.loading')).toBeTruthy();
    expect(screen.getByTestId('loader-icon')).toBeTruthy();
  });

  it('shows empty state when tools array is empty', () => {
    render(
      <McpToolListView
        tools={[]}
        selectedTool={null}
        onSelectTool={onSelectTool}
        isLoading={false}
      />,
    );
    expect(screen.getByText('mcp.tool.empty')).toBeTruthy();
  });

  it('renders tools list when tools are provided', () => {
    const tools = [makeTool('tool-a'), makeTool('tool-b')];
    render(
      <McpToolListView
        tools={tools}
        selectedTool={null}
        onSelectTool={onSelectTool}
        isLoading={false}
      />,
    );
    expect(screen.getByText('tool-a')).toBeTruthy();
    expect(screen.getByText('tool-b')).toBeTruthy();
  });

  it('calls onSelectTool when a tool is clicked', () => {
    const tools = [makeTool('my-tool')];
    render(
      <McpToolListView
        tools={tools}
        selectedTool={null}
        onSelectTool={onSelectTool}
        isLoading={false}
      />,
    );
    fireEvent.click(screen.getByText('my-tool').closest('.tool-item')!);
    expect(onSelectTool).toHaveBeenCalledWith(tools[0]);
  });

  it('marks selected tool with selected class', () => {
    const tools = [makeTool('sel-tool'), makeTool('other-tool')];
    render(
      <McpToolListView
        tools={tools}
        selectedTool={tools[0]}
        onSelectTool={onSelectTool}
        isLoading={false}
      />,
    );
    const selectedItem = screen.getByText('sel-tool').closest('.tool-item');
    expect(selectedItem?.className).toContain('selected');
    const otherItem = screen.getByText('other-tool').closest('.tool-item');
    expect(otherItem?.className).not.toContain('selected');
  });

  it('isLoading defaults to false', () => {
    render(
      <McpToolListView
        tools={[]}
        selectedTool={null}
        onSelectTool={onSelectTool}
      />,
    );
    expect(screen.getByText('mcp.tool.empty')).toBeTruthy();
  });
});
