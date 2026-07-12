/**
 * @vitest-environment happy-dom
 */

import React, { useRef, useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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
    registry,
    restore() {
      if (originalHighlight) testGlobal.Highlight = originalHighlight; else delete testGlobal.Highlight;
      if (originalCss) testGlobal.CSS = originalCss; else delete testGlobal.CSS;
    },
  };
}

function Harness({ sessionId = 's1' }: { sessionId?: string }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  return (
    <div>
      <button data-testid="external">outside</button>
      <FindBar rootRef={rootRef} scrollContainerRef={scrollContainerRef} sessionId={sessionId} />
      <div ref={scrollContainerRef} tabIndex={-1}>
        <div ref={rootRef} className="chat-message-flow-reverse">
          <p>alpha beta alpha gamma alpha</p>
        </div>
      </div>
    </div>
  );
}

function SessionHarness() {
  const [sessionId, setSessionId] = useState('s1');
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  return (
    <div>
      <button data-testid="switch-session" onClick={() => setSessionId('s2')}>switch</button>
      <FindBar rootRef={rootRef} scrollContainerRef={scrollContainerRef} sessionId={sessionId} />
      <div ref={scrollContainerRef} tabIndex={-1}>
        <div ref={rootRef} className="chat-message-flow-reverse">
          <p>alpha beta alpha</p>
        </div>
      </div>
    </div>
  );
}

describe('FindBar extra coverage', () => {
  let highlightApi: ReturnType<typeof installHighlightApi>;
  let originalRaf: typeof window.requestAnimationFrame;
  let originalCaf: typeof window.cancelAnimationFrame;

  beforeEach(() => {
    vi.useFakeTimers();
    highlightApi = installHighlightApi();
    originalRaf = window.requestAnimationFrame;
    originalCaf = window.cancelAnimationFrame;
    window.requestAnimationFrame = ((cb: FrameRequestCallback) => window.setTimeout(() => cb(performance.now()), 0)) as typeof window.requestAnimationFrame;
    window.cancelAnimationFrame = ((handle: number) => window.clearTimeout(handle)) as typeof window.cancelAnimationFrame;
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    window.requestAnimationFrame = originalRaf;
    window.cancelAnimationFrame = originalCaf;
    highlightApi.restore();
    vi.restoreAllMocks();
  });

  it('opens with F3 when closed and navigates with F3 / Shift+F3', () => {
    render(<Harness />);

    // F3 opens the bar when it is closed.
    fireEvent.keyDown(document, { key: 'F3' });
    act(() => { vi.runOnlyPendingTimers(); });
    const input = screen.getByRole('textbox', { name: 'Search text' });

    fireEvent.change(input, { target: { value: 'alpha' } });
    act(() => { vi.advanceTimersByTime(150); });
    expect(screen.getByRole('status')).toHaveTextContent('3/3');

    // F3 moves to the next match.
    fireEvent.keyDown(document, { key: 'F3' });
    expect(screen.getByRole('status')).toHaveTextContent('1/3');

    // Shift+F3 moves to the previous match.
    fireEvent.keyDown(document, { key: 'F3', shiftKey: true });
    expect(screen.getByRole('status')).toHaveTextContent('3/3');
  });

  it('closes on Escape dispatched at the document level', () => {
    render(<Harness />);
    fireEvent.keyDown(document, { key: 'f', ctrlKey: true });
    act(() => { vi.runOnlyPendingTimers(); });
    expect(screen.getByRole('textbox', { name: 'Search text' })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('textbox', { name: 'Search text' })).toBeNull();
  });

  it('seeds the query from the current selection when opening with Ctrl+F', () => {
    vi.spyOn(window, 'getSelection').mockReturnValue({
      toString: () => '  alpha  ',
    } as unknown as Selection);

    render(<Harness />);
    fireEvent.keyDown(document, { key: 'f', ctrlKey: true });
    act(() => { vi.runOnlyPendingTimers(); });

    const input = screen.getByRole('textbox', { name: 'Search text' }) as HTMLInputElement;
    expect(input.value).toBe('alpha');
    expect(screen.getByRole('status')).toHaveTextContent('3/3');
  });

  it('navigates and closes via the toolbar buttons', () => {
    render(<Harness />);
    fireEvent.keyDown(document, { key: 'f', ctrlKey: true });
    act(() => { vi.runOnlyPendingTimers(); });

    const input = screen.getByRole('textbox', { name: 'Search text' });
    fireEvent.change(input, { target: { value: 'alpha' } });
    act(() => { vi.advanceTimersByTime(150); });
    expect(screen.getByRole('status')).toHaveTextContent('3/3');

    const prev = screen.getByRole('button', { name: 'Previous match' });
    const next = screen.getByRole('button', { name: 'Next match' });
    const close = screen.getByRole('button', { name: 'Close find bar' });

    fireEvent.mouseDown(next);
    fireEvent.click(next);
    expect(screen.getByRole('status')).toHaveTextContent('1/3');

    fireEvent.mouseDown(prev);
    fireEvent.click(prev);
    expect(screen.getByRole('status')).toHaveTextContent('3/3');

    fireEvent.mouseDown(close);
    fireEvent.click(close);
    expect(screen.queryByRole('textbox', { name: 'Search text' })).toBeNull();
  });

  it('handles IME composition without searching mid-composition', () => {
    render(<Harness />);
    fireEvent.keyDown(document, { key: 'f', ctrlKey: true });
    act(() => { vi.runOnlyPendingTimers(); });

    const input = screen.getByRole('textbox', { name: 'Search text' });
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: 'alp' } });
    act(() => { vi.advanceTimersByTime(150); });
    // Mid-composition change is not searched.
    expect(screen.getByRole('status')).toHaveTextContent('0/0');

    fireEvent.compositionEnd(input, { target: { value: 'alpha' } });
    act(() => { vi.runOnlyPendingTimers(); });
    expect(screen.getByRole('status')).toHaveTextContent('3/3');
  });

  it('handles Enter and Shift+Enter inside the input', () => {
    render(<Harness />);
    fireEvent.keyDown(document, { key: 'f', ctrlKey: true });
    act(() => { vi.runOnlyPendingTimers(); });
    const input = screen.getByRole('textbox', { name: 'Search text' });
    fireEvent.change(input, { target: { value: 'alpha' } });
    act(() => { vi.advanceTimersByTime(150); });

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByRole('status')).toHaveTextContent('1/3');
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(screen.getByRole('status')).toHaveTextContent('3/3');
  });

  it('restores focus to the previously focused element on close', () => {
    render(<Harness />);
    const external = screen.getByTestId('external') as HTMLButtonElement;
    external.focus();
    expect(document.activeElement).toBe(external);

    fireEvent.keyDown(document, { key: 'f', ctrlKey: true });
    act(() => { vi.runOnlyPendingTimers(); });

    fireEvent.keyDown(document, { key: 'Escape' });
    act(() => { vi.runOnlyPendingTimers(); });
    expect(document.activeElement).toBe(external);
  });

  it('falls back to the scroll container when the previous focus is gone', () => {
    render(<Harness />);
    const external = screen.getByTestId('external') as HTMLButtonElement;
    external.focus();

    fireEvent.keyDown(document, { key: 'f', ctrlKey: true });
    act(() => { vi.runOnlyPendingTimers(); });

    // Remove the previously focused element so it is no longer connected.
    external.remove();

    fireEvent.keyDown(document, { key: 'Escape' });
    act(() => { vi.runOnlyPendingTimers(); });
    expect(screen.queryByRole('textbox', { name: 'Search text' })).toBeNull();
  });

  it('closes automatically when the session id changes', () => {
    render(<SessionHarness />);
    fireEvent.keyDown(document, { key: 'f', ctrlKey: true });
    act(() => { vi.runOnlyPendingTimers(); });
    expect(screen.getByRole('textbox', { name: 'Search text' })).toBeInTheDocument();

    act(() => {
      fireEvent.click(screen.getByTestId('switch-session'));
    });
    act(() => { vi.runOnlyPendingTimers(); });
    expect(screen.queryByRole('textbox', { name: 'Search text' })).toBeNull();
  });

  it('shows "Unavailable" when the Highlight API is not supported', () => {
    highlightApi.restore(); // remove Highlight API before mount

    render(<Harness />);
    fireEvent.keyDown(document, { key: 'f', ctrlKey: true });
    act(() => { vi.runOnlyPendingTimers(); });

    const input = screen.getByRole('textbox', { name: 'Search text' });
    fireEvent.change(input, { target: { value: 'alpha' } });
    act(() => { vi.advanceTimersByTime(150); });

    expect(screen.getByRole('status')).toHaveTextContent('Unavailable');
    expect(screen.getByRole('button', { name: 'Next match' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Previous match' })).toBeDisabled();

    // re-install so afterEach restore stays symmetric
    highlightApi = installHighlightApi();
  });

  it('opens with an empty query when there is no selection', () => {
    vi.spyOn(window, 'getSelection').mockReturnValue(null);

    render(<Harness />);
    fireEvent.keyDown(document, { key: 'f', ctrlKey: true });
    act(() => { vi.runOnlyPendingTimers(); });

    const input = screen.getByRole('textbox', { name: 'Search text' }) as HTMLInputElement;
    expect(input.value).toBe('');
  });

  it('does not overwrite the tracked focus target when reopened from inside the bar', () => {
    render(<Harness />);
    const external = screen.getByTestId('external') as HTMLButtonElement;
    external.focus();

    fireEvent.keyDown(document, { key: 'f', ctrlKey: true });
    act(() => { vi.runOnlyPendingTimers(); });
    const input = screen.getByRole('textbox', { name: 'Search text' });
    expect(document.activeElement).toBe(input);

    // Reopen while focus is already inside the find bar; previous focus stays external.
    fireEvent.keyDown(document, { key: 'f', ctrlKey: true });
    act(() => { vi.runOnlyPendingTimers(); });

    fireEvent.keyDown(document, { key: 'Escape' });
    act(() => { vi.runOnlyPendingTimers(); });
    expect(document.activeElement).toBe(external);
  });
});
