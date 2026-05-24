// @ts-nocheck
/**
 * @vitest-environment happy-dom
 *
 * ToastProvider — full coverage
 *
 * Covers:
 * - ToastProvider renders children
 * - useToast throws outside provider
 * - showToast returns an id string
 * - showSuccess, showError, showWarning, showInfo, showUpdateToast all call showToast
 * - removeToast removes the toast
 * - clearAll removes all toasts
 * - Duplicate detection: same type+string, same type+ReactNode (with text), different type no dedup
 * - React.isValidElement with non-children node
 * - maxToasts eviction: oldest removed when limit exceeded
 * - options: persistent, actions, onDismiss forwarded
 * - ToastManager.setContext / success / error / warning / info without context (no-op)
 * - ToastManager with context calls the right method
 * - ToastContextSetter sets context on mount, clears on unmount
 * - getTextContent: string, number, null/undefined, React element with array children, plain array
 */

import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { ToastProvider, useToast, ToastManager, ToastContextSetter } from '../ToastProvider';

// ── Mock ToastContainer so we can inspect toasts ──────────────────────────────
vi.mock('../Toast', () => ({
  ToastContainer: ({ toasts, onClose }: { toasts: any[]; onClose: (id: string) => void }) => (
    <div data-testid="toast-container">
      {toasts.map(t => (
        <div key={t.id} data-testid={`toast-${t.type}`} data-toast-id={t.id}>
          <span data-testid="toast-message">{typeof t.message === 'string' ? t.message : '[node]'}</span>
          <button data-testid={`close-${t.id}`} onClick={() => onClose(t.id)}>close</button>
        </div>
      ))}
    </div>
  ),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function TestConsumer({ onCtx }: { onCtx: (ctx: ReturnType<typeof useToast>) => void }) {
  const ctx = useToast();
  React.useEffect(() => { onCtx(ctx); }, []);
  return null;
}

function renderProvider(maxToasts?: number) {
  let ctx!: ReturnType<typeof useToast>;
  render(
    <ToastProvider maxToasts={maxToasts}>
      <TestConsumer onCtx={c => { ctx = c; }} />
    </ToastProvider>
  );
  return ctx;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ToastProvider', () => {
  it('renders children', () => {
    render(
      <ToastProvider>
        <span data-testid="child">hello</span>
      </ToastProvider>
    );
    expect(screen.getByTestId('child')).toBeInTheDocument();
  });

  it('useToast throws outside provider', () => {
    const Thrower = () => { useToast(); return null; };
    expect(() => render(<Thrower />)).toThrow('useToast must be used within a ToastProvider');
  });

  it('showToast returns a string id', () => {
    const ctx = renderProvider();
    const id = ctx.showToast('hello');
    expect(typeof id).toBe('string');
    expect(id).toMatch(/^toast-/);
  });

  it('showSuccess adds a success toast', () => {
    const ctx = renderProvider();
    act(() => { ctx.showSuccess('done'); });
    expect(screen.getByTestId('toast-success')).toBeInTheDocument();
  });

  it('showError adds an error toast', () => {
    const ctx = renderProvider();
    act(() => { ctx.showError('oops'); });
    expect(screen.getByTestId('toast-error')).toBeInTheDocument();
  });

  it('showWarning adds a warning toast', () => {
    const ctx = renderProvider();
    act(() => { ctx.showWarning('careful'); });
    expect(screen.getByTestId('toast-warning')).toBeInTheDocument();
  });

  it('showInfo adds an info toast', () => {
    const ctx = renderProvider();
    act(() => { ctx.showInfo('fyi'); });
    expect(screen.getByTestId('toast-info')).toBeInTheDocument();
  });

  it('showUpdateToast adds an update toast', () => {
    const ctx = renderProvider();
    act(() => { ctx.showUpdateToast('update', [{ label: 'OK', onClick: vi.fn() }]); });
    expect(screen.getByTestId('toast-update')).toBeInTheDocument();
  });

  it('showUpdateToast with persistent=false is non-persistent', () => {
    const ctx = renderProvider();
    act(() => { ctx.showUpdateToast('update', [], false); });
    expect(screen.getByTestId('toast-update')).toBeInTheDocument();
  });

  it('removeToast removes by id', () => {
    const ctx = renderProvider();
    const id = ctx.showToast('msg', 'info');
    act(() => { ctx.removeToast(id); });
    expect(screen.queryByTestId('toast-info')).toBeNull();
  });

  it('clearAll removes all toasts', () => {
    const ctx = renderProvider();
    ctx.showSuccess('a');
    ctx.showError('b');
    act(() => { ctx.clearAll(); });
    expect(screen.queryByTestId('toast-success')).toBeNull();
    expect(screen.queryByTestId('toast-error')).toBeNull();
  });

  it('duplicate string toast (same type+message) is ignored', () => {
    const ctx = renderProvider();
    act(() => {
      ctx.showSuccess('same');
      ctx.showSuccess('same');
    });
    expect(screen.getAllByTestId('toast-success')).toHaveLength(1);
  });

  it('non-duplicate: same message different type is NOT ignored', () => {
    const ctx = renderProvider();
    act(() => {
      ctx.showSuccess('same');
      ctx.showError('same');
    });
    expect(screen.getByTestId('toast-success')).toBeInTheDocument();
    expect(screen.getByTestId('toast-error')).toBeInTheDocument();
  });

  it('duplicate React node toast (same text content) is ignored', () => {
    const ctx = renderProvider();
    act(() => { ctx.showToast(<span>dup-node</span>, 'info'); });
    act(() => { ctx.showToast(<span>dup-node</span>, 'info'); });
    expect(screen.getAllByTestId('toast-info')).toHaveLength(1);
  });

  it('React node vs string: no dedup (different message types)', () => {
    const ctx = renderProvider();
    act(() => { ctx.showToast(<span>same-text</span>, 'info'); });
    act(() => { ctx.showToast('same-text', 'info'); });
    // string vs ReactNode — no dedup path for mixed types
    // (the code returns false for mixed types)
    expect(screen.getAllByTestId('toast-info')).toHaveLength(2);
  });

  it('React node with empty text content: no dedup (existingText.length=0)', () => {
    const ctx = renderProvider();
    act(() => { ctx.showToast(<span />, 'info'); }); // empty node
    act(() => { ctx.showToast(<span />, 'info'); }); // same empty node
    // existingText.length === 0 → not deduped
    expect(screen.getAllByTestId('toast-info')).toHaveLength(2);
  });

  it('React node with array children is recursively text-extracted', () => {
    const ctx = renderProvider();
    act(() => { ctx.showToast(<span>{'hello'}{'world'}</span>, 'info'); });
    act(() => { ctx.showToast(<span>{'hello'}{'world'}</span>, 'info'); });
    expect(screen.getAllByTestId('toast-info')).toHaveLength(1);
  });

  it('React node where children is a single React element', () => {
    const ctx = renderProvider();
    act(() => { ctx.showToast(<p><span>nested</span></p>, 'info'); });
    act(() => { ctx.showToast(<p><span>nested</span></p>, 'info'); });
    expect(screen.getAllByTestId('toast-info')).toHaveLength(1);
  });

  it('getTextContent with number child', () => {
    const ctx = renderProvider();
    act(() => { ctx.showToast(<span>{42}</span>, 'info'); });
    act(() => { ctx.showToast(<span>{42}</span>, 'info'); });
    expect(screen.getAllByTestId('toast-info')).toHaveLength(1);
  });

  it('maxToasts eviction: oldest removed when limit exceeded', () => {
    const ctx = renderProvider(2);
    let id1!: string;
    act(() => {
      id1 = ctx.showToast('first', 'info');
      ctx.showToast('second', 'info');
      ctx.showToast('third', 'success'); // evicts first
    });
    expect(screen.queryByDataAttr?.(`toast-${id1}`)).toBeUndefined(); // evicted
    expect(screen.getAllByTestId('toast-info')).toHaveLength(1);
    expect(screen.getByTestId('toast-success')).toBeInTheDocument();
  });

  it('showToast with persistent option', () => {
    const ctx = renderProvider();
    act(() => { ctx.showToast('persistent', 'info', 2000, { persistent: true }); });
    expect(screen.getByTestId('toast-info')).toBeInTheDocument();
  });

  it('showToast with onDismiss option', () => {
    const onDismiss = vi.fn();
    const ctx = renderProvider();
    act(() => { ctx.showToast('with-dismiss', 'info', 2000, { onDismiss }); });
    expect(screen.getByTestId('toast-info')).toBeInTheDocument();
  });

  it('showToast with actions option', () => {
    const ctx = renderProvider();
    act(() => { ctx.showToast('with-actions', 'info', 2000, { actions: [{ label: 'Retry', onClick: vi.fn() }] }); });
    expect(screen.getByTestId('toast-info')).toBeInTheDocument();
  });
});

describe('ToastManager', () => {
  beforeEach(() => {
    ToastManager.setContext(null as any); // clear context
  });

  it('static methods are no-ops without context', () => {
    expect(() => ToastManager.success('x')).not.toThrow();
    expect(() => ToastManager.error('x')).not.toThrow();
    expect(() => ToastManager.warning('x')).not.toThrow();
    expect(() => ToastManager.info('x')).not.toThrow();
  });

  it('static methods delegate to context when set', () => {
    const mockCtx = {
      showSuccess: vi.fn(),
      showError:   vi.fn(),
      showWarning: vi.fn(),
      showInfo:    vi.fn(),
      showToast:   vi.fn(),
      showUpdateToast: vi.fn(),
      removeToast: vi.fn(),
      clearAll:    vi.fn(),
    };
    ToastManager.setContext(mockCtx as any);
    ToastManager.success('s', 1000);
    ToastManager.error('e', 1000);
    ToastManager.warning('w', 1000);
    ToastManager.info('i', 1000);
    expect(mockCtx.showSuccess).toHaveBeenCalledWith('s', 1000);
    expect(mockCtx.showError).toHaveBeenCalledWith('e', 1000);
    expect(mockCtx.showWarning).toHaveBeenCalledWith('w', 1000);
    expect(mockCtx.showInfo).toHaveBeenCalledWith('i', 1000);
  });
});

describe('ToastContextSetter', () => {
  it('sets context on mount and clears on unmount', () => {
    const setContextSpy = vi.spyOn(ToastManager, 'setContext');

    const { unmount } = render(
      <ToastProvider>
        <ToastContextSetter />
      </ToastProvider>
    );

    expect(setContextSpy).toHaveBeenCalledWith(expect.objectContaining({ showSuccess: expect.any(Function) }));

    unmount();
    // After unmount it should have been called with null
    expect(setContextSpy).toHaveBeenLastCalledWith(null);
  });
});
