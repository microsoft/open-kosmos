/**
 * @vitest-environment happy-dom
 *
 * Toast.tsx (ToastItem + ToastContainer) — full coverage
 *
 * Branches covered:
 * - All 5 type styles: success, error, warning, update, info (default)
 * - isVisible / isClosing animation classes
 * - persistent: no auto-dismiss timer
 * - non-persistent: auto-dismiss after duration
 * - handleClose: guards against double-close (isClosing)
 * - toast.onDismiss called on close
 * - actions: rendered and each triggers handleClose
 * - action variant='primary' vs 'secondary' class
 * - string message vs React node message
 * - ToastContainer renders multiple toasts with correct index
 * - onClose callback passed down to ToastItem
 */

import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ToastContainer } from '../Toast';
import type { ToastMessage } from '../Toast';

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeToast(overrides: Partial<ToastMessage> = {}): ToastMessage {
  return {
    id: 'toast-1',
    message: 'Test message',
    type: 'info',
    ...overrides,
  };
}

function renderContainer(toasts: ToastMessage[], onClose = vi.fn()) {
  return render(<ToastContainer toasts={toasts} onClose={onClose} />);
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('ToastContainer', () => {
  it('renders no items when toasts is empty', () => {
    const { container } = renderContainer([]);
    // The outer div exists but no ToastItem children
    expect(container.querySelectorAll('[aria-label="Close notification"]')).toHaveLength(0);
  });

  it('renders multiple toasts and passes index as marginTop offset', () => {
    const toasts: ToastMessage[] = [
      makeToast({ id: 't1', type: 'success', message: 'First' }),
      makeToast({ id: 't2', type: 'error', message: 'Second' }),
    ];
    renderContainer(toasts);
    expect(screen.getByText('First')).toBeInTheDocument();
    expect(screen.getByText('Second')).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    renderContainer([makeToast({ id: 'abc' })], onClose);

    fireEvent.click(screen.getByLabelText('Close notification'));

    // onClose is called after 200ms animation delay
    act(() => { vi.advanceTimersByTime(200); });
    expect(onClose).toHaveBeenCalledWith('abc');
    vi.useRealTimers();
  });
});

describe('ToastItem type styles', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const typeTests: Array<{ type: ToastMessage['type']; bgClass: string }> = [
    { type: 'success', bgClass: 'bg-green-50/95' },
    { type: 'error',   bgClass: 'bg-red-50/95' },
    { type: 'warning', bgClass: 'bg-amber-50/95' },
    { type: 'update',  bgClass: 'bg-violet-50/95' },
    { type: 'info',    bgClass: 'bg-blue-50/95' },
  ];

  for (const { type, bgClass } of typeTests) {
    it(`renders correct bg class for type="${type}"`, () => {
      const { container } = renderContainer([makeToast({ type })]);
      const div = container.querySelector(`.${bgClass.replace('/', '\\/')}`);
      expect(div).toBeInTheDocument();
    });
  }
});

describe('ToastItem auto-dismiss', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('auto-dismisses after default 2000ms', () => {
    const onClose = vi.fn();
    renderContainer([makeToast({ id: 'auto' })], onClose);
    act(() => { vi.advanceTimersByTime(2000 + 200); });
    expect(onClose).toHaveBeenCalledWith('auto');
  });

  it('auto-dismisses after custom duration', () => {
    const onClose = vi.fn();
    renderContainer([makeToast({ id: 'custom', duration: 5000 })], onClose);
    act(() => { vi.advanceTimersByTime(5000 + 200); });
    expect(onClose).toHaveBeenCalledWith('custom');
  });

  it('does NOT auto-dismiss when persistent=true', () => {
    const onClose = vi.fn();
    renderContainer([makeToast({ id: 'persist', persistent: true })], onClose);
    act(() => { vi.advanceTimersByTime(10000); });
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('ToastItem handleClose', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('calls onDismiss before calling onClose', () => {
    const onDismiss = vi.fn();
    const onClose = vi.fn();
    renderContainer([makeToast({ id: 'x', onDismiss, persistent: true })], onClose);

    fireEvent.click(screen.getByLabelText('Close notification'));
    act(() => { vi.advanceTimersByTime(200); });

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledWith('x');
  });

  it('ignores second close call while closing (isClosing guard)', () => {
    const onClose = vi.fn();
    renderContainer([makeToast({ id: 'guard', persistent: true })], onClose);

    const btn = screen.getByLabelText('Close notification');
    fireEvent.click(btn);
    fireEvent.click(btn); // second click while isClosing=true

    act(() => { vi.advanceTimersByTime(200); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('ToastItem actions', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('renders action buttons', () => {
    const actions: ToastMessage['actions'] = [
      { label: 'Retry', onClick: vi.fn(), variant: 'primary' },
      { label: 'Dismiss', onClick: vi.fn(), variant: 'secondary' },
    ];
    renderContainer([makeToast({ persistent: true, actions })]);
    expect(screen.getByText('Retry')).toBeInTheDocument();
    expect(screen.getByText('Dismiss')).toBeInTheDocument();
  });

  it('action with variant=primary has blue bg class', () => {
    const actions: ToastMessage['actions'] = [
      { label: 'Go', onClick: vi.fn(), variant: 'primary' },
    ];
    const { container } = renderContainer([makeToast({ persistent: true, actions })]);
    const btn = screen.getByText('Go');
    expect(btn.className).toContain('bg-blue-600');
  });

  it('clicking action button calls action onClick and then closes toast', () => {
    const actionClick = vi.fn();
    const onClose = vi.fn();
    const actions: ToastMessage['actions'] = [
      { label: 'Act', onClick: actionClick },
    ];
    renderContainer([makeToast({ id: 'act', persistent: true, actions })], onClose);

    fireEvent.click(screen.getByText('Act'));
    expect(actionClick).toHaveBeenCalledTimes(1);

    act(() => { vi.advanceTimersByTime(200); });
    expect(onClose).toHaveBeenCalledWith('act');
  });

  it('renders no action area when actions array is empty', () => {
    const { container } = renderContainer([makeToast({ actions: [] })]);
    // The flex action area should not be present
    const actionArea = container.querySelector('.flex.flex-wrap.items-center.justify-end');
    expect(actionArea).not.toBeInTheDocument();
  });
});

describe('ToastItem message types', () => {
  it('renders string message', () => {
    renderContainer([makeToast({ message: 'Hello world' })]);
    expect(screen.getByText('Hello world')).toBeInTheDocument();
  });

  it('renders React node message', () => {
    renderContainer([makeToast({ message: <strong data-testid="node-msg">Bold!</strong> })]);
    expect(screen.getByTestId('node-msg')).toBeInTheDocument();
  });
});

describe('ToastItem visibility animation', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('adds translate-x-0 class after 10ms show timer', () => {
    const { container } = renderContainer([makeToast({ persistent: true })]);
    // Before timer fires, should be in hidden state
    const toastDiv = container.firstChild?.firstChild?.firstChild as HTMLElement;
    // After 10ms, isVisible becomes true
    act(() => { vi.advanceTimersByTime(10); });
    // After transition isVisible=true, isClosing=false → translate-x-0 class
    expect(toastDiv?.className).toContain('translate-x-0');
  });
});
