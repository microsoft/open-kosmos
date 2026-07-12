/**
 * @vitest-environment happy-dom
 */

import React, { useRef } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import FindBar from '../FindBar';

vi.mock('../FindBar.css', () => ({}));

class MockHighlight {
  ranges: Range[];

  constructor(...ranges: Range[]) {
    this.ranges = ranges;
  }
}

function installHighlightApi() {
  const registry = new Map<string, MockHighlight>();
  const testGlobal = globalThis as unknown as {
    Highlight?: typeof MockHighlight;
    CSS?: { highlights?: { set: (name: string, highlight: MockHighlight) => void; delete: (name: string) => void } };
  };
  const originalHighlight = testGlobal.Highlight;
  const originalCss = testGlobal.CSS;

  testGlobal.Highlight = MockHighlight;
  testGlobal.CSS = {
    ...originalCss,
    highlights: {
      set: (name, highlight) => registry.set(name, highlight),
      delete: (name) => { registry.delete(name); },
    },
  };

  return {
    restore() {
      if (originalHighlight) {
        testGlobal.Highlight = originalHighlight;
      } else {
        delete testGlobal.Highlight;
      }

      if (originalCss) {
        testGlobal.CSS = originalCss;
      } else {
        delete testGlobal.CSS;
      }
    },
  };
}

function FindBarHarness() {
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  return (
    <div>
      <FindBar rootRef={rootRef} scrollContainerRef={scrollContainerRef} sessionId="s1" />
      <aside>alpha outside</aside>
      <div ref={scrollContainerRef} tabIndex={-1}>
        <div ref={rootRef} className="chat-message-flow-reverse">
          <p>alpha beta alpha</p>
        </div>
      </div>
    </div>
  );
}

describe('FindBar', () => {
  let highlightApi: ReturnType<typeof installHighlightApi>;
  let originalRequestAnimationFrame: typeof window.requestAnimationFrame;
  let originalCancelAnimationFrame: typeof window.cancelAnimationFrame;

  beforeEach(() => {
    vi.useFakeTimers();
    highlightApi = installHighlightApi();
    originalRequestAnimationFrame = window.requestAnimationFrame;
    originalCancelAnimationFrame = window.cancelAnimationFrame;
    window.requestAnimationFrame = ((callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 0)) as typeof window.requestAnimationFrame;
    window.cancelAnimationFrame = ((handle: number) => window.clearTimeout(handle)) as typeof window.cancelAnimationFrame;
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    window.requestAnimationFrame = originalRequestAnimationFrame;
    window.cancelAnimationFrame = originalCancelAnimationFrame;
    highlightApi.restore();
  });

  it('opens with Ctrl+F, selects the latest match, and navigates with Enter', () => {
    render(<FindBarHarness />);

    fireEvent.keyDown(document, { key: 'f', ctrlKey: true });
    act(() => {
      vi.runOnlyPendingTimers();
    });

    const input = screen.getByRole('textbox', { name: 'Search text' });
    expect(document.activeElement).toBe(input);

    fireEvent.change(input, { target: { value: 'alpha' } });
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(screen.getByRole('status')).toHaveTextContent('2/2');

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByRole('status')).toHaveTextContent('1/2');

    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(screen.getByRole('status')).toHaveTextContent('2/2');
  });

  it('closes and clears with Escape', () => {
    render(<FindBarHarness />);

    fireEvent.keyDown(document, { key: 'f', ctrlKey: true });
    act(() => {
      vi.runOnlyPendingTimers();
    });

    const input = screen.getByRole('textbox', { name: 'Search text' });
    fireEvent.change(input, { target: { value: 'alpha' } });
    act(() => {
      vi.advanceTimersByTime(150);
    });

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('textbox', { name: 'Search text' })).toBeNull();
  });
});
