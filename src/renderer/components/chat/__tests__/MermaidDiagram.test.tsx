/**
 * @vitest-environment happy-dom
 *
 * MermaidDiagram — full coverage
 *
 * Branches covered:
 * - Empty definition: renders loading state (no render attempted)
 * - Successful render: displays SVG, fullscreen button
 * - Error render: displays error state with definition source
 * - Fullscreen open / close
 * - Cleanup of mermaid error element left in DOM
 * - Cancellation when definition changes while rendering
 */

import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';

// ── Mocks ──────────────────────────────────────────────────────────────────────

const mockMermaidRender = vi.fn();
const mockMermaidInitialize = vi.fn();

vi.mock('mermaid', () => ({
  default: {
    initialize: mockMermaidInitialize,
    render: mockMermaidRender,
  },
}));

vi.mock('../MermaidFullscreenView', () => ({
  default: ({ svgHtml, onClose }: { svgHtml: string; onClose: () => void }) => (
    <div data-testid="fullscreen-view">
      <span data-testid="fullscreen-svg">{svgHtml}</span>
      <button data-testid="fullscreen-close" onClick={onClose}>Close</button>
    </div>
  ),
}));

vi.mock('lucide-react', () => ({
  Maximize2: (props: any) => <span data-testid="maximize-icon" {...props} />,
}));

// ── Import after mocks ─────────────────────────────────────────────────────────

import MermaidDiagram from '../MermaidDiagram';

// ── Helpers ────────────────────────────────────────────────────────────────────

function flushPromises() {
  return act(async () => { await Promise.resolve(); });
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('MermaidDiagram', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMermaidInitialize.mockReturnValue(undefined);
  });

  it('renders loading state for empty definition', () => {
    render(<MermaidDiagram definition="" />);
    expect(document.querySelector('.mermaid-diagram-loading')).toBeInTheDocument();
  });

  it('renders loading state for whitespace-only definition', () => {
    render(<MermaidDiagram definition="   " />);
    expect(document.querySelector('.mermaid-diagram-loading')).toBeInTheDocument();
  });

  it('renders SVG after successful mermaid.render', async () => {
    mockMermaidRender.mockResolvedValue({ svg: '<svg><text>diagram</text></svg>' });

    render(<MermaidDiagram definition="graph TD; A-->B" />);

    // Initially loading
    expect(document.querySelector('.mermaid-diagram-loading')).toBeInTheDocument();

    await waitFor(() => {
      expect(document.querySelector('.mermaid-diagram-wrapper-interactive')).toBeInTheDocument();
    });

    expect(document.querySelector('.mermaid-diagram-wrapper-interactive')).toBeTruthy();
  });

  it('renders error state when mermaid.render throws an Error', async () => {
    mockMermaidRender.mockRejectedValue(new Error('Parse error on line 2'));

    render(<MermaidDiagram definition="invalid mermaid code" />);

    await waitFor(() => {
      expect(document.querySelector('.mermaid-diagram-error')).toBeInTheDocument();
    });

    expect(screen.getByText('Mermaid diagram error')).toBeInTheDocument();
    expect(screen.getByText('invalid mermaid code')).toBeInTheDocument();
  });

  it('renders error state when mermaid.render throws a non-Error', async () => {
    mockMermaidRender.mockRejectedValue('plain string error');

    render(<MermaidDiagram definition="bad" />);

    await waitFor(() => {
      expect(document.querySelector('.mermaid-diagram-error')).toBeInTheDocument();
    });
  });

  it('removes mermaid error element from DOM on render failure', async () => {
    mockMermaidRender.mockImplementation(async (id: string) => {
      // Simulate mermaid inserting an error element
      const el = document.createElement('div');
      el.id = `d${id}`;
      document.body.appendChild(el);
      throw new Error('render failed');
    });

    render(<MermaidDiagram definition="bad graph" />);

    await waitFor(() => {
      expect(document.querySelector('.mermaid-diagram-error')).toBeInTheDocument();
    });

    // The error element should have been removed
    // (id starts with 'd' + mermaid-<N>)
    expect(document.body.querySelector('[id^="dmermaid-"]')).toBeNull();
  });

  it('opens and closes fullscreen view', async () => {
    mockMermaidRender.mockResolvedValue({ svg: '<svg></svg>' });

    render(<MermaidDiagram definition="graph TD; A-->B" />);

    await waitFor(() => {
      expect(document.querySelector('.mermaid-diagram-wrapper-interactive')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('fullscreen-view')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTitle('Fullscreen'));
    expect(screen.getByTestId('fullscreen-view')).toBeInTheDocument();

    // Wrapper should be hidden while fullscreen is open
    const wrapper = document.querySelector('.mermaid-diagram-wrapper-interactive') as HTMLElement;
    expect(wrapper.style.visibility).toBe('hidden');

    fireEvent.click(screen.getByTestId('fullscreen-close'));
    expect(screen.queryByTestId('fullscreen-view')).not.toBeInTheDocument();
  });

  it('clears error and updates SVG when definition changes from bad to good', async () => {
    mockMermaidRender
      .mockRejectedValueOnce(new Error('bad'))
      .mockResolvedValue({ svg: '<svg>fixed</svg>' });

    const { rerender } = render(<MermaidDiagram definition="bad" />);

    await waitFor(() => {
      expect(document.querySelector('.mermaid-diagram-error')).toBeInTheDocument();
    });

    rerender(<MermaidDiagram definition="graph TD; A-->B" />);

    await waitFor(() => {
      expect(document.querySelector('.mermaid-diagram-wrapper-interactive')).toBeInTheDocument();
    });
  });

  it('does not update state when cancelled (component unmounted during render)', async () => {
    let resolveRender!: (v: any) => void;
    mockMermaidRender.mockReturnValue(new Promise(r => { resolveRender = r; }));

    const { unmount } = render(<MermaidDiagram definition="graph TD; A-->B" />);

    // Unmount before render resolves
    unmount();

    // Resolving after unmount should not cause errors
    await act(async () => {
      resolveRender({ svg: '<svg></svg>' });
      await Promise.resolve();
    });
  });

  it('renders loading code block with definition text while loading', async () => {
    // Never resolve so we stay in loading state
    mockMermaidRender.mockReturnValue(new Promise(() => {}));

    render(<MermaidDiagram definition="graph LR; X-->Y" />);

    const pre = document.querySelector('.mermaid-loading-code');
    expect(pre).toBeInTheDocument();
    expect(pre!.textContent).toContain('graph LR; X-->Y');
  });
});
